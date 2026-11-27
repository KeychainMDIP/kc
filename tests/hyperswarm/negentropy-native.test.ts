import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { createRequire } from 'module';
import path from 'path';

interface RecordFixture {
    timestamp: number;
    id: string;
}

interface ConformanceFixture {
    source: {
        sha256: string;
        protocolByte: string;
    };
    clientRecords: RecordFixture[];
    serverRecords: RecordFixture[];
    expectedClientOrder: string[];
    expectedClientFingerprint: string;
    expectedFrames: string[];
    expectedHave: string[];
    expectedNeed: string[];
}

interface FrameLimitCase {
    client: RecordFixture[];
    server: RecordFixture[];
    expectedHave: string[];
    expectedNeed: string[];
}

interface NativeStorage {
    insert(timestamp: number, id: string): void;
    seal(): void;
    size(): number;
    getItem(index: number): { id: Uint8Array };
    fingerprint(begin: number, end: number): Promise<Uint8Array>;
}

type NativeFrame = string | Uint8Array;

interface NativeNegentropy {
    initiate(): Promise<NativeFrame>;
    reconcile(frame: NativeFrame): Promise<[NativeFrame | null, NativeFrame[], NativeFrame[]]>;
}

interface NativeModule {
    Negentropy: new (storage: NativeStorage, frameSizeLimit?: number) => NativeNegentropy;
    NegentropyStorageVector: new () => NativeStorage;
}

const require = createRequire(import.meta.url);
const nativePath = path.resolve('services/mediators/hyperswarm/src/negentropy/Negentropy.cjs');
const native = require(nativePath) as NativeModule;
const fixture = JSON.parse(readFileSync(
    path.resolve('tests/hyperswarm/fixtures/negentropy-native-conformance.json'),
    'utf8',
)) as ConformanceFixture;

function frameHex(frame: NativeFrame): string {
    return typeof frame === 'string' ? frame : Buffer.from(frame).toString('hex');
}

function makeStorage(records: RecordFixture[]): NativeStorage {
    const storage = new native.NegentropyStorageVector();
    for (const record of records) {
        storage.insert(record.timestamp, record.id);
    }
    storage.seal();
    return storage;
}

async function reconcile(
    clientRecords: RecordFixture[],
    serverRecords: RecordFixture[],
    clientFrameLimit = 0,
    serverFrameLimit = 0,
): Promise<{ frames: string[]; have: string[]; need: string[] }> {
    const client = new native.Negentropy(makeStorage(clientRecords), clientFrameLimit);
    const server = new native.Negentropy(makeStorage(serverRecords), serverFrameLimit);
    const frames: string[] = [];
    const have = new Set<string>();
    const need = new Set<string>();
    let query = await client.initiate();
    frames.push(frameHex(query));

    for (let round = 0; round < 100; round += 1) {
        const [response] = await server.reconcile(query);
        if (response === null) {
            throw new Error('Negentropy responder ended without a response');
        }
        frames.push(frameHex(response));

        const [next, roundHave, roundNeed] = await client.reconcile(response);
        roundHave.map(frameHex).forEach(id => have.add(id));
        roundNeed.map(frameHex).forEach(id => need.add(id));
        if (next === null) {
            return { frames, have: [...have].sort(), need: [...need].sort() };
        }

        query = next;
        frames.push(frameHex(query));
    }

    throw new Error('Negentropy did not converge within 100 rounds');
}

function littleEndianId(sequence: number): string {
    const id = Buffer.alloc(32);
    id.writeBigUInt64LE(BigInt(sequence));
    return id.toString('hex');
}

function upstreamFrameLimitCase(): FrameLimitCase {
    const client: RecordFixture[] = [];
    const server: RecordFixture[] = [];
    const expectedHave: string[] = [];
    const expectedNeed: string[] = [];
    let sequence = 1;
    const nextId = () => littleEndianId(sequence++);
    const addClient = (timestamp: number, shared = false) => {
        const id = nextId();
        client.push({ timestamp, id });
        if (shared) {
            server.push({ timestamp, id });
        } else {
            expectedHave.push(id);
        }
    };
    const addServer = (timestamp: number) => {
        const id = nextId();
        server.push({ timestamp, id });
        expectedNeed.push(id);
    };

    for (let i = 0; i < 1500; i += 1) {
        addClient(1000 + i * 10, true);
    }
    for (let i = 0; i < 15; i += 1) {
        addServer(1000 + i * 1000 + 5);
    }
    for (let bucket = 0; bucket < 2; bucket += 1) {
        for (let i = 0; i < 35; i += 1) {
            addClient(1000 + bucket * 1000 + 201 + i % 8);
        }
    }
    for (let i = 0; i < 40; i += 1) {
        addClient(15900 + i * 2, true);
    }
    addServer(15999);
    for (let i = 0; i < 110; i += 1) {
        addClient(50000 + i * 10);
    }

    return {
        client,
        server,
        expectedHave: expectedHave.sort(),
        expectedNeed: expectedNeed.sort(),
    };
}

describe('vendored native Negentropy engine', () => {
    it('matches the pinned official source', () => {
        const digest = createHash('sha256').update(readFileSync(nativePath)).digest('hex');
        expect(digest).toBe(fixture.source.sha256);
    });

    it('matches the language-neutral ordering, fingerprint, and frame fixture', async () => {
        const clientStorage = makeStorage(fixture.clientRecords);
        const order = Array.from({ length: clientStorage.size() }, (_, index) => (
            Buffer.from(clientStorage.getItem(index).id).toString('hex')
        ));
        const fingerprint = Buffer.from(
            await clientStorage.fingerprint(0, clientStorage.size()),
        ).toString('hex');
        const result = await reconcile(fixture.clientRecords, fixture.serverRecords);

        expect(fixture.expectedFrames[0].slice(0, 2)).toBe(fixture.source.protocolByte);
        expect(order).toStrictEqual(fixture.expectedClientOrder);
        expect(fingerprint).toBe(fixture.expectedClientFingerprint);
        expect(result.frames).toStrictEqual(fixture.expectedFrames);
        expect(result.have).toStrictEqual(fixture.expectedHave);
        expect(result.need).toStrictEqual(fixture.expectedNeed);
    });

    it('does not omit the remaining range when a frame limit drops pending output', async () => {
        const testCase = upstreamFrameLimitCase();
        const result = await reconcile(testCase.client, testCase.server, 4096, 4767);

        expect(result.have).toStrictEqual(testCase.expectedHave);
        expect(result.need).toStrictEqual(testCase.expectedNeed);
    });
});
