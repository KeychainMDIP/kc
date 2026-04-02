import fs from 'fs';
import os from 'os';
import path from 'path';
import { jest } from '@jest/globals';
import { setLogger } from '../../packages/common/src/logger.ts';
import DIDsDbMemory from '../../services/search-server/src/db/json-memory.ts';
import Sqlite from '../../services/search-server/src/db/sqlite.ts';
import DidIndexer from '../../services/search-server/src/DidIndexer.ts';
import { extractPublishedCredentials } from '../../services/search-server/src/published-credentials.ts';
import type {
    DIDsDb,
    PublishedCredentialRecord,
    PublishedCredentialSchemaCount,
} from '../../services/search-server/src/types.ts';

function createPublishedCredential(
    schemaDid: string,
    issuerDid: string,
    subjectDid: string,
    options: { reveal?: boolean; signed?: string } = {}
) {
    const {
        reveal = false,
        signed = '2026-03-31T10:30:00.000Z',
    } = options;

    return {
        "@context": [
            "https://www.w3.org/ns/credentials/v2",
            "https://www.w3.org/ns/credentials/examples/v2"
        ],
        type: ['VerifiableCredential', schemaDid],
        issuer: issuerDid,
        validFrom: '2026-03-31T10:00:00.000Z',
        credentialSubject: {
            id: subjectDid,
        },
        signature: {
            signed,
        },
        credential: reveal ? { score: 100 } : null,
    };
}

function createSubjectDoc(
    holderDid: string,
    manifest: Record<string, unknown>,
    updatedAt = '2026-03-31T11:00:00.000Z'
) {
    return {
        didDocument: {
            id: holderDid,
        },
        didDocumentData: {
            manifest,
        },
        didDocumentMetadata: {
            updated: updatedAt,
        },
    };
}

function createQueryableDoc(
    did: string,
    {
        name,
        tags,
        nestedKinds,
        manifest,
        coordinates,
    }: {
        name: string;
        tags: string[];
        nestedKinds: string[];
        manifest: Record<string, { issuer: string }>;
        coordinates: string[];
    }
) {
    return {
        didDocument: {
            id: did,
        },
        didDocumentData: {
            profile: {
                name,
            },
            tags,
            nested: nestedKinds.map(kind => ({ kind })),
            coordinates,
            manifest,
        },
    };
}

type DbHarness = {
    db: DIDsDb;
    cleanup: () => Promise<void>;
};

const adapterFactories = [
    {
        name: 'memory',
        create: async (): Promise<DbHarness> => {
            const db = new DIDsDbMemory();
            await db.connect();

            return {
                db,
                cleanup: async () => {
                    await db.disconnect();
                },
            };
        },
    },
    {
        name: 'sqlite',
        create: async (): Promise<DbHarness> => {
            const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'search-server-query-'));
            const db = await Sqlite.create('query.db', tempDir);

            return {
                db,
                cleanup: async () => {
                    await db.disconnect();
                    fs.rmSync(tempDir, { recursive: true, force: true });
                },
            };
        },
    },
] as const;

beforeEach(() => {
    const logger = {
        child: jest.fn(),
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
    };

    logger.child.mockReturnValue(logger);
    setLogger(logger as any);
});

describe('extractPublishedCredentials', () => {
    it('extracts normalized rows from a valid manifest using signature.signed as the published timestamp', () => {
        const holderDid = 'did:test:subject-1';
        const schemaDid = 'did:test:schema-1';
        const issuerDid = 'did:test:issuer-1';
        const credentialDid = 'did:test:credential-1';
        const signedAt = '2026-03-31T10:41:22.000Z';
        const doc = createSubjectDoc(holderDid, {
            [credentialDid]: createPublishedCredential(schemaDid, issuerDid, holderDid, {
                signed: signedAt,
            }),
        });

        expect(extractPublishedCredentials(holderDid, doc)).toStrictEqual<PublishedCredentialRecord[]>([
            {
                holderDid,
                credentialDid,
                schemaDid,
                issuerDid,
                subjectDid: holderDid,
                revealed: false,
                updatedAt: signedAt,
            },
        ]);
    });

    it('falls back to the subject DID document timestamp when signature.signed is missing', () => {
        const holderDid = 'did:test:subject-1';
        const credentialDid = 'did:test:credential-1';
        const doc = createSubjectDoc(holderDid, {
            [credentialDid]: {
                "@context": [
                    "https://www.w3.org/ns/credentials/v2",
                    "https://www.w3.org/ns/credentials/examples/v2"
                ],
                type: ['VerifiableCredential', 'did:test:schema-1'],
                issuer: 'did:test:issuer-1',
                credentialSubject: {
                    id: holderDid,
                },
                credential: null,
            },
        }, '2026-03-31T11:00:00.000Z');

        expect(extractPublishedCredentials(holderDid, doc)).toStrictEqual<PublishedCredentialRecord[]>([
            {
                holderDid,
                credentialDid,
                schemaDid: 'did:test:schema-1',
                issuerDid: 'did:test:issuer-1',
                subjectDid: holderDid,
                revealed: false,
                updatedAt: '2026-03-31T11:00:00.000Z',
            },
        ]);
    });

    it('ignores malformed or mismatched manifest entries', () => {
        const holderDid = 'did:test:subject-1';
        const doc = createSubjectDoc(holderDid, {
            'did:test:not-vc': {
                type: ['NotVC', 'did:test:schema-1'],
                issuer: 'did:test:issuer-1',
                credentialSubject: { id: holderDid },
            },
            'did:test:mismatch': createPublishedCredential(
                'did:test:schema-2',
                'did:test:issuer-2',
                'did:test:someone-else'
            ),
            'not-a-did': createPublishedCredential(
                'did:test:schema-3',
                'did:test:issuer-3',
                holderDid
            ),
        });

        expect(extractPublishedCredentials(holderDid, doc)).toStrictEqual([]);
    });

    it('counts reveal=false and reveal=true manifests equally', () => {
        const holderDid = 'did:test:subject-1';
        const doc = createSubjectDoc(holderDid, {
            'did:test:credential-1': createPublishedCredential(
                'did:test:schema-1',
                'did:test:issuer-1',
                holderDid
            ),
            'did:test:credential-2': createPublishedCredential(
                'did:test:schema-1',
                'did:test:issuer-2',
                holderDid,
                { reveal: true }
            ),
        });

        const rows = extractPublishedCredentials(holderDid, doc);
        expect(rows).toHaveLength(2);
        expect(rows.map(row => ({ schemaDid: row.schemaDid, revealed: row.revealed }))).toStrictEqual([
            { schemaDid: 'did:test:schema-1', revealed: false },
            { schemaDid: 'did:test:schema-1', revealed: true },
        ]);
    });
});

describe('published credential aggregation', () => {
    it('deduplicates duplicate published credential rows when replacing holder rows', async () => {
        const db = new DIDsDbMemory();

        await db.replacePublishedCredentials('did:test:subject-1', [
            {
                holderDid: 'did:test:subject-1',
                credentialDid: 'did:test:credential-1',
                schemaDid: 'did:test:schema-1',
                issuerDid: 'did:test:issuer-1',
                subjectDid: 'did:test:subject-1',
                revealed: false,
                updatedAt: '2026-03-31T11:05:00.000Z',
            },
            {
                holderDid: 'did:test:subject-1',
                credentialDid: 'did:test:credential-1',
                schemaDid: 'did:test:schema-1',
                issuerDid: 'did:test:issuer-1',
                subjectDid: 'did:test:subject-1',
                revealed: false,
                updatedAt: '2026-03-31T11:05:00.000Z',
            },
        ]);

        expect(await db.listPublishedCredentials({
            schemaDid: 'did:test:schema-1',
            limit: 10,
            offset: 0,
        })).toStrictEqual({
            total: 1,
            credentials: [
                {
                    holderDid: 'did:test:subject-1',
                    credentialDid: 'did:test:credential-1',
                    schemaDid: 'did:test:schema-1',
                    issuerDid: 'did:test:issuer-1',
                    subjectDid: 'did:test:subject-1',
                    revealed: false,
                    updatedAt: '2026-03-31T11:05:00.000Z',
                },
            ],
        });
    });

    it('aggregates counts in memory and supports replacing holder rows', async () => {
        const db = new DIDsDbMemory();
        const subject1Doc = createSubjectDoc('did:test:subject-1', {
            'did:test:credential-1': createPublishedCredential(
                'did:test:schema-1',
                'did:test:issuer-1',
                'did:test:subject-1',
                { reveal: true }
            ),
            'did:test:credential-2': createPublishedCredential(
                'did:test:schema-1',
                'did:test:issuer-2',
                'did:test:subject-1'
            ),
        }, '2026-03-31T11:05:00.000Z');
        const subject2Doc = createSubjectDoc('did:test:subject-2', {
            'did:test:credential-3': createPublishedCredential(
                'did:test:schema-2',
                'did:test:issuer-1',
                'did:test:subject-2'
            ),
        }, '2026-03-31T11:10:00.000Z');

        await db.storeDID('did:test:subject-1', subject1Doc);
        await db.storeDID('did:test:subject-2', subject2Doc);

        await db.replacePublishedCredentials('did:test:subject-1', [
            {
                holderDid: 'did:test:subject-1',
                credentialDid: 'did:test:credential-1',
                schemaDid: 'did:test:schema-1',
                issuerDid: 'did:test:issuer-1',
                subjectDid: 'did:test:subject-1',
                revealed: true,
                updatedAt: '2026-03-31T11:05:00.000Z',
            },
            {
                holderDid: 'did:test:subject-1',
                credentialDid: 'did:test:credential-2',
                schemaDid: 'did:test:schema-1',
                issuerDid: 'did:test:issuer-2',
                subjectDid: 'did:test:subject-1',
                revealed: false,
                updatedAt: '2026-03-31T11:05:00.000Z',
            },
        ]);

        await db.replacePublishedCredentials('did:test:subject-2', [
            {
                holderDid: 'did:test:subject-2',
                credentialDid: 'did:test:credential-3',
                schemaDid: 'did:test:schema-2',
                issuerDid: 'did:test:issuer-1',
                subjectDid: 'did:test:subject-2',
                revealed: false,
                updatedAt: '2026-03-31T11:10:00.000Z',
            },
        ]);

        expect(await db.getPublishedCredentialCountsBySchema()).toStrictEqual<PublishedCredentialSchemaCount[]>([
            { schemaDid: 'did:test:schema-1', count: 2 },
            { schemaDid: 'did:test:schema-2', count: 1 },
        ]);

        expect(await db.listPublishedCredentials({
            schemaDid: 'did:test:schema-1',
            limit: 1,
            offset: 0,
        })).toStrictEqual({
            total: 2,
            credentials: [
                {
                    holderDid: 'did:test:subject-1',
                    credentialDid: 'did:test:credential-1',
                    schemaDid: 'did:test:schema-1',
                    issuerDid: 'did:test:issuer-1',
                    subjectDid: 'did:test:subject-1',
                    revealed: true,
                    updatedAt: '2026-03-31T11:05:00.000Z',
                },
            ],
        });

        expect(await db.listPublishedCredentials({
            schemaDid: 'did:test:schema-1',
            revealed: false,
            limit: 10,
            offset: 0,
        })).toStrictEqual({
            total: 1,
            credentials: [
                {
                    holderDid: 'did:test:subject-1',
                    credentialDid: 'did:test:credential-2',
                    schemaDid: 'did:test:schema-1',
                    issuerDid: 'did:test:issuer-2',
                    subjectDid: 'did:test:subject-1',
                    revealed: false,
                    updatedAt: '2026-03-31T11:05:00.000Z',
                },
            ],
        });

        expect(await db.listPublishedCredentials({
            credentialDid: 'did:test:credential-3',
            limit: 10,
            offset: 0,
        })).toStrictEqual({
            total: 1,
            credentials: [
                {
                    holderDid: 'did:test:subject-2',
                    credentialDid: 'did:test:credential-3',
                    schemaDid: 'did:test:schema-2',
                    issuerDid: 'did:test:issuer-1',
                    subjectDid: 'did:test:subject-2',
                    revealed: false,
                    updatedAt: '2026-03-31T11:10:00.000Z',
                },
            ],
        });

        await db.replacePublishedCredentials('did:test:subject-1', []);

        expect(await db.getPublishedCredentialCountsBySchema()).toStrictEqual([
            { schemaDid: 'did:test:schema-2', count: 1 },
        ]);
    });

    it('aggregates counts in sqlite', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'search-server-sqlite-'));
        const db = await Sqlite.create('metrics.db', tempDir) as Sqlite;

        try {
            const subject1Doc = createSubjectDoc('did:test:subject-1', {
                'did:test:credential-1': createPublishedCredential(
                    'did:test:schema-1',
                    'did:test:issuer-1',
                    'did:test:subject-1',
                    { reveal: true }
                ),
                'did:test:credential-2': createPublishedCredential(
                    'did:test:schema-1',
                    'did:test:issuer-2',
                    'did:test:subject-1'
                ),
            }, '2026-03-31T11:05:00.000Z');
            const subject2Doc = createSubjectDoc('did:test:subject-2', {
                'did:test:credential-3': createPublishedCredential(
                    'did:test:schema-2',
                    'did:test:issuer-1',
                    'did:test:subject-2'
                ),
            }, '2026-03-31T11:10:00.000Z');

            await db.storeDID('did:test:subject-1', subject1Doc);
            await db.storeDID('did:test:subject-2', subject2Doc);

            await db.replacePublishedCredentials('did:test:subject-1', [
                {
                    holderDid: 'did:test:subject-1',
                    credentialDid: 'did:test:credential-1',
                    schemaDid: 'did:test:schema-1',
                    issuerDid: 'did:test:issuer-1',
                    subjectDid: 'did:test:subject-1',
                    revealed: true,
                    updatedAt: '2026-03-31T11:05:00.000Z',
                },
                {
                    holderDid: 'did:test:subject-1',
                    credentialDid: 'did:test:credential-2',
                    schemaDid: 'did:test:schema-1',
                    issuerDid: 'did:test:issuer-2',
                    subjectDid: 'did:test:subject-1',
                    revealed: false,
                    updatedAt: '2026-03-31T11:05:00.000Z',
                },
            ]);

            await db.replacePublishedCredentials('did:test:subject-2', [
                {
                    holderDid: 'did:test:subject-2',
                    credentialDid: 'did:test:credential-3',
                    schemaDid: 'did:test:schema-2',
                    issuerDid: 'did:test:issuer-1',
                    subjectDid: 'did:test:subject-2',
                    revealed: false,
                    updatedAt: '2026-03-31T11:10:00.000Z',
                },
            ]);

            expect(await db.getPublishedCredentialCountsBySchema()).toStrictEqual([
                { schemaDid: 'did:test:schema-1', count: 2 },
                { schemaDid: 'did:test:schema-2', count: 1 },
            ]);

            expect(await db.listPublishedCredentials({
                schemaDid: 'did:test:schema-1',
                issuerDid: 'did:test:issuer-2',
                limit: 10,
                offset: 0,
            })).toStrictEqual({
                total: 1,
                credentials: [
                    {
                        holderDid: 'did:test:subject-1',
                        credentialDid: 'did:test:credential-2',
                        schemaDid: 'did:test:schema-1',
                        issuerDid: 'did:test:issuer-2',
                        subjectDid: 'did:test:subject-1',
                        revealed: false,
                        updatedAt: '2026-03-31T11:05:00.000Z',
                    },
                ],
            });

            expect(await db.listPublishedCredentials({
                credentialDid: 'did:test:credential-3',
                limit: 10,
                offset: 0,
            })).toStrictEqual({
                total: 1,
                credentials: [
                    {
                        holderDid: 'did:test:subject-2',
                        credentialDid: 'did:test:credential-3',
                        schemaDid: 'did:test:schema-2',
                        issuerDid: 'did:test:issuer-1',
                        subjectDid: 'did:test:subject-2',
                        revealed: false,
                        updatedAt: '2026-03-31T11:10:00.000Z',
                    },
                ],
            });

            await db.replacePublishedCredentials('did:test:subject-2', [
                {
                    holderDid: 'did:test:subject-2',
                    credentialDid: 'did:test:credential-3',
                    schemaDid: 'did:test:schema-2',
                    issuerDid: 'did:test:issuer-1',
                    subjectDid: 'did:test:subject-2',
                    revealed: false,
                    updatedAt: '2026-03-31T11:10:00.000Z',
                },
                {
                    holderDid: 'did:test:subject-2',
                    credentialDid: 'did:test:credential-3',
                    schemaDid: 'did:test:schema-2',
                    issuerDid: 'did:test:issuer-1',
                    subjectDid: 'did:test:subject-2',
                    revealed: false,
                    updatedAt: '2026-03-31T11:10:00.000Z',
                },
            ]);

            expect(await db.listPublishedCredentials({
                schemaDid: 'did:test:schema-2',
                limit: 10,
                offset: 0,
            })).toStrictEqual({
                total: 1,
                credentials: [
                    {
                        holderDid: 'did:test:subject-2',
                        credentialDid: 'did:test:credential-3',
                        schemaDid: 'did:test:schema-2',
                        issuerDid: 'did:test:issuer-1',
                        subjectDid: 'did:test:subject-2',
                        revealed: false,
                        updatedAt: '2026-03-31T11:10:00.000Z',
                    },
                ],
            });

            await db.replacePublishedCredentials('did:test:subject-1', []);

            expect(await db.getPublishedCredentialCountsBySchema()).toStrictEqual([
                { schemaDid: 'did:test:schema-2', count: 1 },
            ]);
        }
        finally {
            await db.disconnect();
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });
});

describe.each(adapterFactories)('$name query and utility behavior', ({ create }) => {
    it('round-trips config and docs, supports search and query variants, and wipes all state', async () => {
        const { db, cleanup } = await create();

        try {
            const did1 = 'did:test:query-1';
            const did2 = 'did:test:query-2';
            const doc1 = createQueryableDoc(did1, {
                name: 'Needle Alpha',
                tags: ['alpha', 'shared'],
                nestedKinds: ['first', 'shared'],
                coordinates: ['zero', 'one'],
                manifest: {
                    'did:test:credential-a': { issuer: 'did:test:issuer-1' },
                    'did:test:credential-b': { issuer: 'did:test:issuer-2' },
                },
            });
            const doc2 = createQueryableDoc(did2, {
                name: 'Haystack Beta',
                tags: ['beta'],
                nestedKinds: ['second'],
                coordinates: ['left', 'right'],
                manifest: {
                    'did:test:credential-c': { issuer: 'did:test:issuer-3' },
                },
            });

            expect(await db.loadUpdatedAfter()).toBeNull();

            await db.saveUpdatedAfter('2026-04-01T12:34:00.000Z');
            expect(await db.loadUpdatedAfter()).toBe('2026-04-01T12:34:00.000Z');

            await db.storeDID(did1, doc1);
            await db.storeDID(did2, doc2);

            const storedDoc = await db.getDID(did1) as Record<string, any>;
            expect(storedDoc).toStrictEqual(doc1);
            storedDoc.didDocumentData.profile.name = 'Mutated';
            expect((await db.getDID(did1) as any).didDocumentData.profile.name).toBe('Needle Alpha');
            expect(await db.getDID('did:test:missing')).toBeNull();

            await db.replacePublishedCredentials(did1, [
                {
                    holderDid: did1,
                    credentialDid: 'did:test:credential-a',
                    schemaDid: 'did:test:schema-a',
                    issuerDid: 'did:test:issuer-1',
                    subjectDid: did1,
                    revealed: true,
                    updatedAt: '2026-04-01T12:35:00.000Z',
                },
            ]);

            expect(await db.searchDocs('Needle')).toStrictEqual([did1]);
            expect(await db.queryDocs({
                '$.didDocument.id': { $in: [did1] },
            })).toStrictEqual([did1]);
            expect(await db.queryDocs({
                'didDocumentData.tags[*]': { $in: ['shared'] },
            })).toStrictEqual([did1]);
            expect(await db.queryDocs({
                'didDocumentData.nested[*].kind': { $in: ['shared'] },
            })).toStrictEqual([did1]);
            expect(await db.queryDocs({
                'didDocumentData.manifest.*': { $in: ['did:test:credential-b'] },
            })).toStrictEqual([did1]);
            expect(await db.queryDocs({
                'didDocumentData.manifest.*.issuer': { $in: ['did:test:issuer-3'] },
            })).toStrictEqual([did2]);

            await expect(db.queryDocs({
                'didDocument.id': {},
            } as any)).rejects.toThrow('Only {$in:[…]} supported');

            await db.wipeDb();

            expect(await db.loadUpdatedAfter()).toBeNull();
            expect(await db.searchDocs('Needle')).toStrictEqual([]);
            expect(await db.getDID(did1)).toBeNull();
            expect(await db.getPublishedCredentialCountsBySchema()).toStrictEqual([]);
            expect(await db.listPublishedCredentials({ limit: 10, offset: 0 })).toStrictEqual({
                total: 0,
                credentials: [],
            });
        }
        finally {
            await cleanup();
        }
    });
});

describe('memory adapter query edge cases', () => {
    it('returns no matches for an empty where clause and supports numeric array path segments', async () => {
        const db = new DIDsDbMemory();
        const did = 'did:test:memory-query-1';

        await db.connect();
        await db.storeDID(did, createQueryableDoc(did, {
            name: 'Indexed Value',
            tags: ['memory'],
            nestedKinds: ['only'],
            coordinates: ['zero', 'one'],
            manifest: {
                'did:test:credential-memory': { issuer: 'did:test:issuer-memory' },
            },
        }));

        expect(await db.queryDocs({})).toStrictEqual([]);
        expect(await db.queryDocs({
            '$.didDocumentData.coordinates.1': { $in: ['one'] },
        })).toStrictEqual([did]);

        await db.disconnect();
    });
});

describe('sqlite adapter disconnected behavior', () => {
    it('throws consistent errors when used before connect', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'search-server-sqlite-disconnected-'));
        const db = new Sqlite('disconnected.db', tempDir);

        try {
            await expect(db.loadUpdatedAfter()).rejects.toThrow('DB not connected');
            await expect(db.saveUpdatedAfter('2026-04-01T12:00:00.000Z')).rejects.toThrow('DB not connected');
            await expect(db.storeDID('did:test:doc', {})).rejects.toThrow('DB not connected');
            await expect(db.replacePublishedCredentials('did:test:doc', [])).rejects.toThrow('DB not connected');
            await expect(db.getDID('did:test:doc')).rejects.toThrow('DB not connected');
            await expect(db.getPublishedCredentialCountsBySchema()).rejects.toThrow('DB not connected');
            await expect(db.listPublishedCredentials()).rejects.toThrow('DB not connected');
            await expect(db.searchDocs('doc')).rejects.toThrow('DB not connected');
            await expect(db.queryDocs({
                'didDocument.id': { $in: ['did:test:doc'] },
            })).rejects.toThrow('DB not connected');
            await expect(db.wipeDb()).rejects.toThrow('DB not connected');
        }
        finally {
            await db.disconnect();
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });
});

describe('DidIndexer published credential indexing', () => {
    it('stores published credential rows during refresh', async () => {
        const db = new DIDsDbMemory();
        const holderDid = 'did:test:subject-1';
        const schemaDid = 'did:test:schema-1';
        const issuerDid = 'did:test:issuer-1';
        const credentialDid = 'did:test:credential-1';
        const doc = createSubjectDoc(holderDid, {
            [credentialDid]: createPublishedCredential(schemaDid, issuerDid, holderDid),
        });
        const gatekeeper = {
            isReady: jest.fn().mockResolvedValue(true),
            getDIDs: jest.fn().mockResolvedValue([holderDid]),
            resolveDID: jest.fn().mockResolvedValue(doc),
        };
        const indexer = new DidIndexer(gatekeeper as any, db, { intervalMs: 60_000 });

        await indexer.startIndexing();
        indexer.stopIndexing();

        expect(await db.getPublishedCredentialCountsBySchema()).toStrictEqual([
            { schemaDid, count: 1 },
        ]);
        expect(await db.listPublishedCredentials({ schemaDid, limit: 10, offset: 0 })).toStrictEqual({
            total: 1,
            credentials: [
                {
                    holderDid,
                    credentialDid,
                    schemaDid,
                    issuerDid,
                    subjectDid: holderDid,
                    revealed: false,
                    updatedAt: '2026-03-31T10:30:00.000Z',
                },
            ],
        });
    });
});
