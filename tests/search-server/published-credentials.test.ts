import fs from 'fs';
import os from 'os';
import path from 'path';
import { jest } from '@jest/globals';
import { setLogger } from '../../packages/common/src/logger.ts';
import DIDsDbMemory from '../../services/search-server/src/db/json-memory.ts';
import Sqlite from '../../services/search-server/src/db/sqlite.ts';
import DidIndexer, { type GatekeeperIndexClient } from '../../services/search-server/src/DidIndexer.ts';
import { extractPublishedCredentials } from '../../services/search-server/src/published-credentials.ts';
import type {
    ApplyIndexPageResult,
    DIDsDb,
    GatekeeperEvent,
    PublishedCredentialRecord,
    PublishedCredentialSchemaCount,
} from '../../services/search-server/src/types.ts';
import { createSeedEvent, seedDID } from './db-seed.ts';

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

function createAssetEvent(
    did: string,
    data: unknown,
    created = '2026-03-31T11:00:00.000Z',
    options: {
        blockid?: string;
    } = {}
): GatekeeperEvent {
    return {
        registry: 'local',
        time: created,
        ordinal: [0],
        did,
        operation: {
            type: 'create',
            created,
            mdip: {
                version: 1,
                type: 'asset',
                registry: 'local',
            },
            controller: did,
            data,
            blockid: options.blockid,
        },
    };
}

function createSnapshotResponse(did: string, data: unknown) {
    const create = createAssetEvent(did, {});
    create.operation.mdip!.type = 'agent';

    return {
        mode: 'snapshot' as const,
        indexEpoch: 'epoch-test',
        cursor: did,
        checkpointCursor: '0',
        hasMore: false,
        blocks: [],
        dids: [{
            did,
            events: [
                create,
                {
                    ...create,
                    operation: {
                        type: 'update' as const,
                        did,
                        doc: {
                            didDocument: { id: did },
                            didDocumentData: data,
                            mdip: { version: 1, type: 'agent' as const, registry: 'local' },
                        },
                    },
                },
            ],
        }],
    };
}

function createEmptySnapshotResponse() {
    return {
        mode: 'snapshot' as const,
        indexEpoch: 'epoch-test',
        cursor: null,
        checkpointCursor: '0',
        hasMore: false,
        blocks: [],
        dids: [],
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

function createLogger() {
    const logger = {
        child: jest.fn(),
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
    };

    logger.child.mockReturnValue(logger);
    return logger;
}

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

    it('normalizes a subject prefix alias to the canonical holder DID', () => {
        const holderDid = 'did:test:subject-1';
        const holderAlias = 'did:mdip:subject-1';
        const credentialDid = 'did:mdip:credential-1';
        const schemaDid = 'did:mdip:schema-1';
        const issuerDid = 'did:mdip:issuer-1';
        const doc = createSubjectDoc(holderAlias, {
            [credentialDid]: createPublishedCredential(schemaDid, issuerDid, holderAlias),
        });

        expect(extractPublishedCredentials(holderDid, doc)).toStrictEqual([
            expect.objectContaining({
                holderDid,
                subjectDid: holderDid,
            }),
        ]);
    });

    it('rejects a manifest without a valid canonical holder DID', () => {
        const holderDid = 'did:test:subject-1';

        expect(extractPublishedCredentials('not-a-did', createSubjectDoc(holderDid, {
            'did:test:credential-1': createPublishedCredential(
                'did:test:schema-1',
                'did:test:issuer-1',
                holderDid
            ),
        }))).toStrictEqual([]);
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

    it('returns an empty list when the manifest is missing or invalid', () => {
        expect(extractPublishedCredentials('did:test:subject-1', {})).toStrictEqual([]);
        expect(extractPublishedCredentials('did:test:subject-1', {
            didDocumentData: {
                manifest: [],
            },
        })).toStrictEqual([]);
    });

    it('falls back to the default holder DID and created timestamp when needed', () => {
        const defaultHolderDid = 'did:test:subject-1';
        const credentialDid = 'did:test:credential-1';
        const schemaDid = 'did:test:schema-1';
        const issuerDid = 'did:test:issuer-1';
        const createdAt = '2026-03-31T09:59:00.000Z';

        expect(extractPublishedCredentials(defaultHolderDid, {
            didDocument: {
                id: 'not-a-did',
            },
            didDocumentData: {
                manifest: {
                    [credentialDid]: {
                        type: ['VerifiableCredential', schemaDid],
                        issuer: issuerDid,
                        credentialSubject: {
                            id: defaultHolderDid,
                        },
                    },
                },
            },
            didDocumentMetadata: {
                created: createdAt,
            },
        })).toStrictEqual<PublishedCredentialRecord[]>([
            {
                holderDid: defaultHolderDid,
                credentialDid,
                schemaDid,
                issuerDid,
                subjectDid: defaultHolderDid,
                revealed: false,
                updatedAt: createdAt,
            },
        ]);
    });
});

describe('published credential aggregation', () => {
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

        await seedDID(db, 'did:test:subject-1', {
            doc: subject1Doc,
            publishedCredentials: [
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
            ],
        });

        await seedDID(db, 'did:test:subject-2', {
            doc: subject2Doc,
            publishedCredentials: [
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

        await seedDID(db, 'did:test:subject-1', {
            doc: subject1Doc,
            publishedCredentials: [],
        });

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

            await seedDID(db, 'did:test:subject-1', {
                doc: subject1Doc,
                publishedCredentials: [
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
                ],
            });

            await seedDID(db, 'did:test:subject-2', {
                doc: subject2Doc,
                publishedCredentials: [
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

            await seedDID(db, 'did:test:subject-2', {
                doc: subject2Doc,
                publishedCredentials: [
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
                ],
            });

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

            await seedDID(db, 'did:test:subject-1', {
                doc: subject1Doc,
                publishedCredentials: [],
            });

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
    it('round-trips sync state and docs, supports search and query variants, and wipes all state', async () => {
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

            expect(await db.loadSyncState('test.cursor')).toBeNull();

            await db.saveSyncState('test.cursor', '2026-04-01T12:34:00.000Z');
            expect(await db.loadSyncState('test.cursor')).toBe('2026-04-01T12:34:00.000Z');

            await seedDID(db, did1, {
                doc: doc1,
                publishedCredentials: [
                    {
                        holderDid: did1,
                        credentialDid: 'did:test:credential-a',
                        schemaDid: 'did:test:schema-a',
                        issuerDid: 'did:test:issuer-1',
                        subjectDid: did1,
                        revealed: true,
                        updatedAt: '2026-04-01T12:35:00.000Z',
                    },
                ],
            });
            await seedDID(db, did2, { doc: doc2 });

            const storedDoc = await db.getDID(did1) as Record<string, any>;
            expect(storedDoc).toStrictEqual(doc1);
            storedDoc.didDocumentData.profile.name = 'Mutated';
            expect((await db.getDID(did1) as any).didDocumentData.profile.name).toBe('Needle Alpha');
            expect(await db.getDID('did:test:missing')).toBeNull();

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

            expect(await db.loadSyncState('test.cursor')).toBeNull();
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

    it('filters indexed results by canonical DID prefix', async () => {
        const { db, cleanup } = await create();
        const testHolder = 'did:test:test-holder';
        const mdipHolder = 'did:mdip:mdip-holder';
        const testCredential = 'did:test:test-credential';
        const mdipCredential = 'did:mdip:mdip-credential';
        const testSchema = 'did:test:test-schema';
        const mdipSchema = 'did:mdip:mdip-schema';
        const testPublishedCredential = {
            holderDid: testHolder,
            credentialDid: testCredential,
            schemaDid: testSchema,
            issuerDid: testHolder,
            subjectDid: testHolder,
            revealed: true,
            updatedAt: '2026-04-01T12:00:00.000Z',
        };
        const mdipPublishedCredential = {
            holderDid: mdipHolder,
            credentialDid: mdipCredential,
            schemaDid: mdipSchema,
            issuerDid: mdipHolder,
            subjectDid: mdipHolder,
            revealed: true,
            updatedAt: '2026-04-01T12:00:00.000Z',
        };
        const explicitCreate = (did: string) => {
            const event = createSeedEvent(did);
            event.operation.mdip!.prefix = did.split(':', 2).join(':');
            return event;
        };

        try {
            for (const did of [testCredential, mdipCredential, testSchema, mdipSchema]) {
                await seedDID(db, did, { events: [explicitCreate(did)] });
            }
            await seedDID(db, testHolder, {
                events: [explicitCreate(testHolder)],
                doc: { didDocumentData: { searchable: 'shared-network-value' } },
                publishedCredentials: [
                    testPublishedCredential,
                    {
                        ...testPublishedCredential,
                        credentialDid: 'did:mdip:test-credential',
                        schemaDid: 'did:mdip:test-schema',
                    },
                ],
            });
            await seedDID(db, mdipHolder, {
                events: [explicitCreate(mdipHolder)],
                doc: { didDocumentData: { searchable: 'shared-network-value' } },
                publishedCredentials: [
                    mdipPublishedCredential,
                    {
                        ...mdipPublishedCredential,
                        credentialDid: 'did:test:mdip-credential',
                        schemaDid: 'did:test:mdip-schema',
                    },
                ],
            });

            expect(await db.searchDocs('shared-network-value', 'did:mdip')).toStrictEqual([mdipHolder]);
            expect(await db.queryDocs({
                'didDocumentData.searchable': { $in: ['shared-network-value'] },
            }, 'did:test')).toStrictEqual([testHolder]);
            expect((await db.listEvents({ didPrefix: 'did:mdip' })).events.every(
                event => event.did.startsWith('did:mdip:')
            )).toBe(true);
            expect(await db.findDIDBySuffix('mdip-holder', 'did:test')).toBeNull();
            expect(await db.findDIDBySuffix('mdip-holder', 'did:mdip')).toBe(mdipHolder);
            expect(await db.listPublishedCredentials({ didPrefix: 'did:test', limit: 1, offset: 1 }))
                .toStrictEqual({ total: 1, credentials: [] });
            expect(await db.getPublishedCredentialCountsBySchema('did:test')).toStrictEqual([
                { schemaDid: testSchema, count: 1 },
            ]);
            expect(await db.getPublishedCredentialCountsBySchema('did:mdip')).toStrictEqual([
                { schemaDid: mdipSchema, count: 1 },
            ]);

            await seedDID(db, 'did:test:reclassified');
            await seedDID(db, 'did:mdip:reclassified');
            expect(await db.getDIDEvents('did:test:reclassified')).toStrictEqual([]);
            expect(await db.findDIDBySuffix('reclassified')).toBe('did:mdip:reclassified');
        }
        finally {
            await cleanup();
        }
    });

    it('matches subjectDid and issuerDid aliases by CID suffix', async () => {
        const { db, cleanup } = await create();
        const holderDid = 'did:mdip:alias-holder';
        const holderAlias = 'did:test:alias-holder';
        const credential = {
            holderDid,
            credentialDid: 'did:mdip:alias-credential',
            schemaDid: 'did:mdip:alias-schema',
            issuerDid: holderDid,
            subjectDid: holderDid,
            revealed: false,
            updatedAt: '2026-04-01T12:00:00.000Z',
        };
        const event = createSeedEvent(holderDid);
        event.operation.mdip!.type = 'agent';
        event.operation.mdip!.prefix = 'did:mdip';

        try {
            await seedDID(db, holderDid, {
                events: [event],
                publishedCredentials: [credential],
            });

            expect(await db.listPublishedCredentials({ subjectDid: holderAlias })).toStrictEqual({
                total: 1,
                credentials: [credential],
            });
            expect(await db.listPublishedCredentials({ issuerDid: holderAlias })).toStrictEqual({
                total: 1,
                credentials: [credential],
            });
            expect(await db.listPublishedCredentials({ subjectDid: 'did:test:other-holder' }))
                .toStrictEqual({ total: 0, credentials: [] });
        }
        finally {
            await cleanup();
        }
    });

    it('uses unique published references for prefix-less credential and schema assets', async () => {
        const { db, cleanup } = await create();
        const holderDid = 'did:test:legacy-holder';
        const storedCredentialDid = 'did:test:legacy-credential';
        const storedSchemaDid = 'did:test:legacy-schema';
        const publishedCredentialDid = 'did:mdip:legacy-credential';
        const publishedSchemaDid = 'did:mdip:legacy-schema';
        const holderEvents = [createSeedEvent(holderDid)];

        try {
            await seedDID(db, storedCredentialDid);
            await seedDID(db, storedSchemaDid, {
                doc: { didDocumentData: { searchable: 'legacy-network-schema' } },
            });
            await seedDID(db, holderDid, {
                events: holderEvents,
                publishedCredentials: [{
                    holderDid,
                    credentialDid: publishedCredentialDid,
                    schemaDid: publishedSchemaDid,
                    issuerDid: holderDid,
                    subjectDid: holderDid,
                    revealed: false,
                    updatedAt: '2026-04-01T12:00:00.000Z',
                }],
            });

            expect(await db.getPublishedCredentialCountsBySchema('did:mdip')).toStrictEqual([
                { schemaDid: publishedSchemaDid, count: 1 },
            ]);
            expect(await db.listPublishedCredentials({ didPrefix: 'did:mdip' })).toMatchObject({
                total: 1,
                credentials: [{
                    credentialDid: publishedCredentialDid,
                    schemaDid: publishedSchemaDid,
                }],
            });
            expect(await db.findDIDBySuffix('legacy-schema', 'did:mdip')).toBe(storedSchemaDid);
            expect(await db.findDIDBySuffix('legacy-schema', 'did:test')).toBeNull();
            expect(await db.searchDocs('legacy-network-schema', 'did:mdip')).toStrictEqual([
                publishedSchemaDid,
            ]);
            expect(await db.searchDocs('legacy-network-schema', 'did:test')).toStrictEqual([]);
            expect(await db.queryDocs({
                'didDocumentData.searchable': { $in: ['legacy-network-schema'] },
            }, 'did:mdip')).toStrictEqual([publishedSchemaDid]);
            expect((await db.listEvents({ didPrefix: 'did:mdip' })).events.some(
                event => event.did === publishedSchemaDid
            )).toBe(true);
            expect((await db.listEvents({ didPrefix: 'did:test' })).events.some(
                event => event.did.endsWith(':legacy-schema')
            )).toBe(false);

            await seedDID(db, holderDid, {
                events: [...holderEvents, {
                    ...holderEvents[0],
                    time: '2026-04-01T13:00:00.000Z',
                    operation: {
                        type: 'update',
                        did: holderDid,
                        doc: {
                            didDocument: { id: holderDid },
                            didDocumentData: { manifest: {} },
                        },
                    },
                }],
                didPrefixReferences: [publishedCredentialDid, publishedSchemaDid],
                publishedCredentials: [],
            });

            expect(await db.getPublishedCredentialCountsBySchema('did:mdip')).toStrictEqual([]);
            expect(await db.findDIDBySuffix('legacy-schema', 'did:mdip')).toBe(storedSchemaDid);
            expect(await db.findDIDBySuffix('legacy-schema', 'did:test')).toBeNull();
            expect(await db.searchDocs('legacy-network-schema', 'did:mdip')).toStrictEqual([
                publishedSchemaDid,
            ]);
        }
        finally {
            await cleanup();
        }
    });

    it('does not let manifest references reclassify AgentDIDs', async () => {
        const { db, cleanup } = await create();
        const holderDid = 'did:test:agent-holder';
        const credentialDid = 'did:test:credential-agent';
        const schemaDid = 'did:test:schema-agent';
        const mdipCredentialDid = credentialDid.replace('did:test:', 'did:mdip:');
        const mdipSchemaDid = schemaDid.replace('did:test:', 'did:mdip:');
        const agentEvent = (did: string) => {
            const event = createSeedEvent(did);
            event.operation.mdip!.type = 'agent';
            return event;
        };

        try {
            await seedDID(db, credentialDid, {
                events: [agentEvent(credentialDid)],
                doc: { didDocumentData: { searchable: 'credential-agent-collision' } },
            });
            await seedDID(db, schemaDid, {
                events: [agentEvent(schemaDid)],
                doc: { didDocumentData: { searchable: 'schema-agent-collision' } },
            });
            await seedDID(db, holderDid, {
                events: [agentEvent(holderDid)],
                didPrefixReferences: [mdipCredentialDid, mdipSchemaDid],
                publishedCredentials: [{
                    holderDid,
                    credentialDid: mdipCredentialDid,
                    schemaDid: mdipSchemaDid,
                    issuerDid: holderDid,
                    subjectDid: holderDid,
                    revealed: false,
                    updatedAt: '2026-04-01T12:00:00.000Z',
                }],
            });

            expect(await db.findDIDBySuffix('credential-agent', 'did:test')).toBe(credentialDid);
            expect(await db.findDIDBySuffix('credential-agent', 'did:mdip')).toBeNull();
            expect(await db.searchDocs('credential-agent-collision', 'did:test')).toStrictEqual([credentialDid]);
            expect(await db.searchDocs('credential-agent-collision', 'did:mdip')).toStrictEqual([]);
            expect(await db.queryDocs({
                'didDocumentData.searchable': { $in: ['schema-agent-collision'] },
            }, 'did:test')).toStrictEqual([schemaDid]);
            expect((await db.listEvents({ didPrefix: 'did:mdip' })).events.some(
                event => event.did === mdipCredentialDid || event.did === mdipSchemaDid
            )).toBe(false);
            expect(await db.listPublishedCredentials({ didPrefix: 'did:test' })).toMatchObject({
                total: 1,
                credentials: [{ credentialDid, schemaDid }],
            });
            expect(await db.listPublishedCredentials({ didPrefix: 'did:mdip' })).toMatchObject({ total: 0 });
            expect(await db.getPublishedCredentialCountsBySchema('did:test')).toStrictEqual([
                { schemaDid, count: 1 },
            ]);
            expect(await db.getPublishedCredentialCountsBySchema('did:mdip')).toStrictEqual([]);
        }
        finally {
            await cleanup();
        }
    });

    it('keeps conflicting operation prefixes in the test network despite mdip manifest evidence', async () => {
        const { db, cleanup } = await create();
        const holderDid = 'did:test:conflicting-holder';
        const credentialDid = 'did:test:conflicting-credential';
        const schemaDid = 'did:test:conflicting-schema';
        const mdipCredentialDid = credentialDid.replace('did:test:', 'did:mdip:');
        const mdipSchemaDid = schemaDid.replace('did:test:', 'did:mdip:');
        const conflictingEvents = (did: string): GatekeeperEvent[] => {
            const create = createSeedEvent(did);

            return [
                create,
                {
                    ...create,
                    operation: { type: 'update', did },
                },
                {
                    ...create,
                    operation: { type: 'update', did: did.replace('did:test:', 'did:mdip:') },
                },
            ];
        };

        try {
            await seedDID(db, credentialDid, { events: conflictingEvents(credentialDid) });
            await seedDID(db, schemaDid, {
                events: conflictingEvents(schemaDid),
                doc: { didDocumentData: { searchable: 'conflicting-prefix-schema' } },
            });
            await seedDID(db, holderDid, {
                didPrefixReferences: [mdipCredentialDid, mdipSchemaDid],
                publishedCredentials: [{
                    holderDid,
                    credentialDid: mdipCredentialDid,
                    schemaDid: mdipSchemaDid,
                    issuerDid: holderDid,
                    subjectDid: holderDid,
                    revealed: false,
                    updatedAt: '2026-04-01T12:00:00.000Z',
                }],
            });

            expect(await db.findDIDBySuffix('conflicting-credential', 'did:test')).toBe(credentialDid);
            expect(await db.findDIDBySuffix('conflicting-credential', 'did:mdip')).toBeNull();
            expect(await db.listPublishedCredentials({ didPrefix: 'did:test' })).toMatchObject({
                total: 1,
                credentials: [{ credentialDid, schemaDid }],
            });
            expect(await db.listPublishedCredentials({ didPrefix: 'did:mdip' })).toMatchObject({ total: 0 });
            expect(await db.getPublishedCredentialCountsBySchema('did:test')).toStrictEqual([
                { schemaDid, count: 1 },
            ]);
            expect(await db.getPublishedCredentialCountsBySchema('did:mdip')).toStrictEqual([]);
            expect(await db.searchDocs('conflicting-prefix-schema', 'did:test')).toStrictEqual([schemaDid]);
            expect(await db.searchDocs('conflicting-prefix-schema', 'did:mdip')).toStrictEqual([]);
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
        await seedDID(db, did, {
            doc: createQueryableDoc(did, {
                name: 'Indexed Value',
                tags: ['memory'],
                nestedKinds: ['only'],
                coordinates: ['zero', 'one'],
                manifest: {
                    'did:test:credential-memory': { issuer: 'did:test:issuer-memory' },
                },
            }),
        });

        expect(await db.queryDocs({})).toStrictEqual([]);
        expect(await db.queryDocs({
            '$.didDocumentData.coordinates.1': { $in: ['one'] },
        })).toStrictEqual([did]);

        await db.disconnect();
    });

    it('exposes getPath edge cases through direct calls', () => {
        const db = new DIDsDbMemory() as any;
        const root = {
            profile: {
                nested: [
                    {
                        value: 'found',
                    },
                ],
            },
        };

        expect(db.getPath(root, '')).toBeUndefined();
        expect(db.getPath(root, '$')).toBe(root);
        expect(db.getPath(root, '$.profile.missing.value')).toBeUndefined();
        expect(db.getPath({ profile: 'text' }, '$.profile.value')).toBeUndefined();
        expect(db.getPath(root, '$.profile.nested.0.value')).toBe('found');
    });
});

describe('sqlite adapter disconnected behavior', () => {
    it('throws consistent errors when used before connect', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'search-server-sqlite-disconnected-'));
        const db = new Sqlite('disconnected.db', tempDir);

        try {
            await expect(db.loadSyncState('test.cursor')).rejects.toThrow('DB not connected');
            await expect(db.saveSyncState('test.cursor', '2026-04-01T12:00:00.000Z')).rejects.toThrow('DB not connected');
            await expect(db.applyIndexPage({ dids: [], blocks: [] })).rejects.toThrow('DB not connected');
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

    it('rolls back failed replacements and supports subject/revealed filters', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'search-server-sqlite-rollback-'));
        const db = await Sqlite.create('rollback.db', tempDir) as Sqlite;

        try {
            await seedDID(db, 'did:test:subject-1', {
                publishedCredentials: [
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
                subjectDid: 'did:test:subject-1',
                revealed: true,
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
                        revealed: true,
                        updatedAt: '2026-03-31T11:05:00.000Z',
                    },
                ],
            });

            await expect(seedDID(db, 'did:test:subject-1', {
                publishedCredentials: [
                    {
                        holderDid: 'did:test:subject-1',
                        credentialDid: 'did:test:credential-2',
                        schemaDid: null as any,
                        issuerDid: 'did:test:issuer-2',
                        subjectDid: 'did:test:subject-1',
                        revealed: false,
                        updatedAt: '2026-03-31T11:06:00.000Z',
                    },
                ],
            } as any)).rejects.toBeTruthy();

            expect(await db.listPublishedCredentials({
                subjectDid: 'did:test:subject-1',
                revealed: true,
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
                        revealed: true,
                        updatedAt: '2026-03-31T11:05:00.000Z',
                    },
                ],
            });
        }
        finally {
            await db.disconnect();
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });
});

describe('postgres adapter with mocked pool', () => {
    async function loadPostgresModule() {
        jest.resetModules();
        const module = await import('../../services/search-server/src/db/postgres.ts');
        return module.default;
    }

    it('covers connect, read/write helpers, query variants, and wipe behavior', async () => {
        let syncStateReads = 0;
        let didReads = 0;
        const poolQuery = jest.fn(async (sql: string, params?: unknown[]) => {
            const text = String(sql);

            if (text.includes('CREATE TABLE IF NOT EXISTS did_docs')) {
                return { rowCount: 0, rows: [] };
            }
            if (text.includes('CREATE INDEX IF NOT EXISTS idx_published_credentials_schema_revealed')) {
                return { rowCount: 0, rows: [] };
            }
            if (text.includes('SELECT value FROM sync_state WHERE key = $1 LIMIT 1')) {
                syncStateReads += 1;
                if (syncStateReads === 1) {
                    return { rowCount: 0, rows: [] };
                }

                return { rowCount: 1, rows: [{ value: '2026-04-02T09:00:00.000Z' }] };
            }
            if (text.includes('INSERT INTO sync_state (key, value) VALUES ($1, $2)')) {
                return { rowCount: 1, rows: [] };
            }
            if (text.includes('SELECT event FROM did_events WHERE did = $1 ORDER BY event_index ASC')) {
                return { rowCount: 0, rows: [] };
            }
            if (text.includes('SELECT doc FROM did_docs WHERE did = $1 LIMIT 1')) {
                didReads += 1;
                if (didReads === 1) {
                    return { rowCount: 1, rows: [{ doc: '{"stored":true}' }] };
                }
                if (didReads === 2) {
                    return { rowCount: 1, rows: [{ doc: { stored: 'object' } }] };
                }

                return { rowCount: 0, rows: [] };
            }
            if (text.includes('COUNT(*)::int AS count')) {
                return { rowCount: 1, rows: [{ schemaDid: 'did:test:schema-1', count: 2 }] };
            }
            if (text.includes('COUNT(*)::int AS total')) {
                return { rowCount: 1, rows: [{ total: 1 }] };
            }
            if (text.includes('holder_did AS "holderDid"')) {
                return {
                    rowCount: 1,
                    rows: [{
                        holderDid: 'did:test:subject-1',
                        credentialDid: 'did:test:credential-1',
                        schemaDid: 'did:test:schema-1',
                        issuerDid: 'did:test:issuer-1',
                        subjectDid: 'did:test:subject-1',
                        revealed: true,
                        updatedAt: '2026-04-02T09:05:00.000Z',
                    }],
                };
            }
            if (text.includes("doc::text LIKE '%' || $1 || '%'")) {
                return { rowCount: 1, rows: [{ did: 'did:test:search-1' }] };
            }
            if (text.includes('did AS "storedDid", prefix')) {
                const dids = params?.[0] as string[];
                const prefix = params?.[1] as string | undefined;
                const rows = dids
                    .filter(did => !prefix || did.startsWith(`${prefix}:`))
                    .map(did => ({ storedDid: did, did }));
                return { rowCount: rows.length, rows };
            }
            if (text.includes('JOIN LATERAL jsonb_array_elements') && text.includes('elem.value = expected.value::jsonb')) {
                return { rowCount: 1, rows: [{ did: 'did:test:array-tail' }] };
            }
            if (text.includes('JOIN LATERAL jsonb_array_elements') && text.includes('elem.value #> $2::text[] = expected.value::jsonb')) {
                return { rowCount: 1, rows: [{ did: 'did:test:array-mid' }] };
            }
            if (text.includes('JOIN LATERAL jsonb_each') && text.includes('member.key = ANY($2::text[])')) {
                return { rowCount: 1, rows: [{ did: 'did:test:key-wildcard' }] };
            }
            if (text.includes('JOIN LATERAL jsonb_each') && text.includes('member.value #> $2::text[] = expected.value::jsonb')) {
                return { rowCount: 1, rows: [{ did: 'did:test:value-wildcard' }] };
            }
            if (text.includes('WHERE EXISTS (') && text.includes('did_docs.doc #> $1::text[] = expected.value::jsonb')) {
                return { rowCount: 1, rows: [{ did: 'did:test:plain-path' }] };
            }
            if (text === 'DELETE FROM did_docs' ||
                text === 'DELETE FROM did_events' ||
                text === 'DELETE FROM blocks' ||
                text === 'DELETE FROM published_credentials' ||
                text === 'DELETE FROM challenge_receipts' ||
                text === 'DELETE FROM sync_state') {
                return { rowCount: 1, rows: [] };
            }

            return { rowCount: 0, rows: [] };
        });
        const mockClient = {
            query: jest.fn(),
            release: jest.fn(),
        };
        const mockPool = {
            query: poolQuery,
            connect: jest.fn<() => Promise<typeof mockClient>>().mockResolvedValue(mockClient),
            end: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
        };
        const Postgres = await loadPostgresModule();
        const db = new Postgres('postgresql://example');
        (db as any).pool = mockPool;

        expect(await db.loadSyncState('test.cursor')).toBeNull();
        expect(await db.saveSyncState('test.cursor', '2026-04-02T09:00:00.000Z')).toBeUndefined();
        expect(await db.loadSyncState('test.cursor')).toBe('2026-04-02T09:00:00.000Z');
        expect(await db.applyIndexPage({
            dids: [{
                did: 'did:test:doc-1',
                events: [createAssetEvent('did:test:doc-1', {})],
                doc: { stored: true },
            }],
            blocks: [],
        })).toStrictEqual({
            changedDids: ['did:test:doc-1'],
            storedBlocks: 0,
            removedBlocks: 0,
            removedDids: 0,
        });
        expect(await db.getDID('did:test:doc-1')).toStrictEqual({ stored: true });
        expect(await db.getDID('did:test:doc-2')).toStrictEqual({ stored: 'object' });
        expect(await db.getDID('did:test:doc-3')).toBeNull();
        expect(await db.getPublishedCredentialCountsBySchema()).toStrictEqual([
            { schemaDid: 'did:test:schema-1', count: 2 },
        ]);
        expect(await db.listPublishedCredentials({
            didPrefix: 'did:test',
            credentialDid: 'did:test:credential-1',
            schemaDid: 'did:test:schema-1',
            issuerDid: 'did:mdip:issuer-1',
            subjectDid: 'did:test:subject-1',
            revealed: true,
            limit: 5,
            offset: 10,
        })).toStrictEqual({
            total: 1,
            credentials: [{
                holderDid: 'did:test:subject-1',
                credentialDid: 'did:test:credential-1',
                schemaDid: 'did:test:schema-1',
                issuerDid: 'did:test:issuer-1',
                subjectDid: 'did:test:subject-1',
                revealed: true,
                updatedAt: '2026-04-02T09:05:00.000Z',
            }],
        });
        expect(await db.searchDocs('search')).toStrictEqual(['did:test:search-1']);

        expect(await db.queryDocs({})).toStrictEqual([]);
        await expect(db.queryDocs({ '$.didDocument.id': {} } as any)).rejects.toThrow('Only {$in:[…]} supported');
        expect(await db.queryDocs({ '$.didDocument.id': { $in: [] } })).toStrictEqual([]);
        expect(await db.queryDocs({ '$.didDocumentData.tags[*]': { $in: ['tag', undefined] } })).toStrictEqual(['did:test:array-tail']);
        expect(await db.queryDocs({ '$.didDocumentData.nested[*].kind': { $in: ['shared'] } })).toStrictEqual(['did:test:array-mid']);
        expect(await db.queryDocs({ '$.didDocumentData.manifest.*': { $in: ['cred'] } })).toStrictEqual(['did:test:key-wildcard']);
        expect(await db.queryDocs({ '$.didDocumentData.manifest.*.issuer': { $in: ['issuer'] } })).toStrictEqual(['did:test:value-wildcard']);
        expect(await db.queryDocs({ '$.didDocument.id': { $in: ['did:test:plain-path'] } })).toStrictEqual(['did:test:plain-path']);

        await db.wipeDb();
        await db.disconnect();
        await db.disconnect();

        expect(mockPool.end).toHaveBeenCalledTimes(1);

        const arrayTailCall = poolQuery.mock.calls.find(([sql]) =>
            String(sql).includes('elem.value = expected.value::jsonb')
        );
        const defaultPathCall = poolQuery.mock.calls.find(([sql]) =>
            String(sql).includes('did_docs.doc #> $1::text[] = expected.value::jsonb')
        );
        const subjectFilterCall = poolQuery.mock.calls.find(([sql]) =>
            String(sql).includes('SELECT did FROM did_classifications WHERE suffix = $5')
        );
        const issuerFilterCall = poolQuery.mock.calls.find(([sql]) =>
            String(sql).includes("right(pc.issuer_did, length($4) + 1) = ':' || $4")
        );

        expect(arrayTailCall?.[1]).toStrictEqual([
            ['didDocumentData', 'tags'],
            ['"tag"', 'null'],
        ]);
        expect(defaultPathCall?.[1]).toStrictEqual([
            ['didDocument', 'id'],
            ['"did:test:plain-path"'],
        ]);
        expect(subjectFilterCall?.[1]).toContain('subject-1');
        expect(issuerFilterCall?.[1]).toContain('issuer-1');
    });

    it('throws when disconnected and rolls back failed replacements', async () => {
        const clientError = new Error('insert failed');
        const mockClient = {
            query: jest.fn<(...args: unknown[]) => Promise<unknown>>()
                .mockResolvedValueOnce(undefined)
                .mockResolvedValueOnce({ rowCount: 0, rows: [] })
                .mockRejectedValueOnce(clientError)
                .mockResolvedValueOnce(undefined),
            release: jest.fn(),
        };
        const mockPool = {
            query: jest.fn<(...args: unknown[]) => Promise<unknown>>()
                .mockResolvedValue({ rowCount: 0, rows: [] }),
            connect: jest.fn<() => Promise<typeof mockClient>>().mockResolvedValue(mockClient),
            end: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
        };
        const Postgres = await loadPostgresModule();
        const disconnectedDb = new Postgres('postgresql://example');

        await expect(disconnectedDb.loadSyncState('test.cursor')).rejects.toThrow('Postgres DB not connected');

        const db = new Postgres('postgresql://example');
        (db as any).pool = mockPool;

        await expect(db.applyIndexPage({
            dids: [{
                did: 'did:test:subject-1',
                events: [createAssetEvent('did:test:subject-1', {})],
                publishedCredentials: [
                    {
                        holderDid: 'did:test:subject-1',
                        credentialDid: 'did:test:credential-1',
                        schemaDid: 'did:test:schema-1',
                        issuerDid: 'did:test:issuer-1',
                        subjectDid: 'did:test:subject-1',
                        revealed: false,
                        updatedAt: '2026-04-02T09:05:00.000Z',
                    },
                ],
            }],
            blocks: [],
        })).rejects.toThrow(clientError);

        expect(mockClient.query).toHaveBeenNthCalledWith(1, 'BEGIN');
        expect(mockClient.query).toHaveBeenNthCalledWith(
            3,
            'DELETE FROM did_events WHERE did = $1',
            ['did:test:subject-1']
        );
        expect(mockClient.query).toHaveBeenNthCalledWith(4, 'ROLLBACK');
        expect(mockClient.release).toHaveBeenCalledTimes(1);
    });

    it('covers static create plus real connect and disconnect branches with spied pool methods', async () => {
        const Postgres = await loadPostgresModule();
        const mockPool = {
            query: jest.fn<(...args: unknown[]) => Promise<unknown>>()
                .mockResolvedValue({ rowCount: 0, rows: [] }),
            end: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
        };

        class TestPostgres extends Postgres {
            static readonly sharedPool = mockPool;

            protected createPool(): any {
                return TestPostgres.sharedPool;
            }
        }

        const db = await TestPostgres.create('postgresql://example');

        await (db as any).connect();
        await db.disconnect();
        await db.disconnect();

        expect(mockPool.query).toHaveBeenCalledTimes(1);
        expect(mockPool.end).toHaveBeenCalledTimes(1);

        const disconnectedDb = new TestPostgres('postgresql://example');
        await disconnectedDb.disconnect();
    });

    it('commits successful replacements and covers path helper fallbacks', async () => {
        const mockClient = {
            query: jest.fn<(...args: unknown[]) => Promise<unknown>>()
                .mockResolvedValue(undefined),
            release: jest.fn(),
        };
        const mockPool = {
            query: jest.fn<(...args: unknown[]) => Promise<unknown>>()
                .mockResolvedValue({ rowCount: 0, rows: [] }),
            connect: jest.fn<() => Promise<typeof mockClient>>().mockResolvedValue(mockClient),
            end: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
        };
        const Postgres = await loadPostgresModule();
        const db = new Postgres('postgresql://example');
        (db as any).pool = mockPool;

        await db.applyIndexPage({
            dids: [{
                did: 'did:test:subject-1',
                events: [createAssetEvent('did:test:subject-1', {})],
                publishedCredentials: [
                    {
                        holderDid: 'did:test:subject-1',
                        credentialDid: 'did:test:credential-1',
                        schemaDid: 'did:test:schema-1',
                        issuerDid: 'did:test:issuer-1',
                        subjectDid: 'did:test:subject-1',
                        revealed: true,
                        updatedAt: '2026-04-02T09:05:00.000Z',
                    },
                ],
            }],
            blocks: [],
        });

        expect(mockClient.query).toHaveBeenNthCalledWith(1, 'BEGIN');
        expect(mockClient.query).toHaveBeenCalledWith(
            expect.stringContaining('ON CONFLICT (holder_did, credential_suffix)'),
            expect.any(Array)
        );
        expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
        expect(mockClient.release).toHaveBeenCalledTimes(1);

        expect((db as any).normalizePath('$')).toBe('');
        expect((db as any).normalizePath('$.profile.name')).toBe('profile.name');
        expect((db as any).normalizePath('$profile.name')).toBe('profile.name');
        expect((db as any).normalizePath('profile.name')).toBe('profile.name');
        expect((db as any).toPathTokens('$')).toStrictEqual([]);
        expect((db as any).toPathTokens('$.items[0].name')).toStrictEqual(['items', '0', 'name']);
        expect((db as any).toPathTokens('[0]')).toStrictEqual(['0']);
        expect((db as any).toJsonLiterals([undefined, Symbol('x'), 'text'])).toStrictEqual([
            'null',
            'null',
            '"text"',
        ]);
    });

    it('uses default list filters and falls back total to zero when the count query is empty', async () => {
        const poolQuery = jest.fn(async (sql: string, params?: unknown[]) => {
            const text = String(sql);

            if (text.includes('COUNT(*)::int AS total')) {
                return { rowCount: 0, rows: [] };
            }

            if (text.includes('holder_did AS "holderDid"')) {
                return { rowCount: 0, rows: [] };
            }

            return { rowCount: 0, rows: [] };
        });
        const mockPool = {
            query: poolQuery,
            end: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
        };
        const Postgres = await loadPostgresModule();
        const db = new Postgres('postgresql://example');
        (db as any).pool = mockPool;

        expect(await db.listPublishedCredentials()).toStrictEqual({
            total: 0,
            credentials: [],
        });

        const totalCall = poolQuery.mock.calls.find(([sql]) =>
            String(sql).includes('COUNT(*)::int AS total')
        );
        const rowsCall = poolQuery.mock.calls.find(([sql]) =>
            String(sql).includes('holder_did AS "holderDid"')
        );

        expect(totalCall?.[0]).not.toContain('WHERE');
        expect(totalCall?.[1]).toStrictEqual([]);
        expect(rowsCall?.[1]).toStrictEqual([50, 0]);
    });

    it('constructs a real pool instance in createPool without connecting', async () => {
        const Postgres = await loadPostgresModule();
        const db = new Postgres('postgresql://example');
        const pool = (db as any).createPool();

        expect(pool).toBeTruthy();
        await pool.end();
    });
});

describe('DidIndexer published credential indexing', () => {
    it('stores published credential rows during refresh', async () => {
        const db = new DIDsDbMemory();
        const holderDid = 'did:test:z3v8AuaTV5VKcT9MJoSHkSTRLpXDoqcgqiKkwGBNSV4nVzb6kLk';
        const schemaDid = 'did:test:schema-1';
        const issuerDid = 'did:test:issuer-1';
        const credentialDid = 'did:test:credential-1';
        const data = {
            manifest: {
                [credentialDid]: createPublishedCredential(schemaDid, issuerDid, holderDid),
            },
        };
        const gatekeeper = {
            isReady: jest.fn<GatekeeperIndexClient['isReady']>().mockResolvedValue(true),
            exportIndex: jest.fn<GatekeeperIndexClient['exportIndex']>()
                .mockResolvedValue(createSnapshotResponse(holderDid, data)),
            getDIDs: jest.fn(),
            resolveDID: jest.fn(),
        };
        const indexer = new DidIndexer(gatekeeper as any, db, { intervalMs: 60_000 });

        await indexer.startIndexing();
        indexer.stopIndexing();

        expect(gatekeeper.exportIndex).toHaveBeenCalledWith({
            mode: 'snapshot',
            cursor: null,
            limit: 500,
        });
        expect(gatekeeper.getDIDs).not.toHaveBeenCalled();
        expect(gatekeeper.resolveDID).not.toHaveBeenCalled();
        expect(await db.loadSyncState('index.snapshot.complete')).toBe('true');
        expect(await db.getDIDEvents(holderDid)).toHaveLength(2);
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

    it('does not rebuild unchanged DID projections on incremental sync', async () => {
        const db = new DIDsDbMemory();
        const holderDid = 'did:test:z3v8AuaUaK93ip2KsM5KGsWXWqgXFSNQxRkcMReXe4LheX5CkHe';
        const schemaDid = 'did:test:schema-1';
        const issuerDid = 'did:test:issuer-1';
        const credentialDid = 'did:test:credential-1';
        const data = {
            manifest: {
                [credentialDid]: createPublishedCredential(schemaDid, issuerDid, holderDid),
            },
        };
        const event = createAssetEvent(holderDid, data);
        event.operation.mdip!.type = 'agent';

        await db.saveSyncState('index.snapshot.complete', 'true');
        await seedDID(db, holderDid, {
            events: [event],
            doc: createSubjectDoc(holderDid, {
                [credentialDid]: createPublishedCredential(schemaDid, issuerDid, holderDid),
            }),
            publishedCredentials: [{
                holderDid,
                credentialDid,
                schemaDid,
                issuerDid,
                subjectDid: holderDid,
                revealed: false,
                updatedAt: '2026-03-31T10:30:00.000Z',
            }],
        });

        const gatekeeper = {
            isReady: jest.fn<GatekeeperIndexClient['isReady']>().mockResolvedValue(true),
            exportIndex: jest.fn<GatekeeperIndexClient['exportIndex']>().mockResolvedValue({
                mode: 'changes' as const,
                indexEpoch: 'epoch-test',
                cursor: '1',
                checkpointCursor: '1',
                hasMore: false,
                blocks: [],
                dids: [{
                    did: holderDid,
                    events: [event],
                }],
            }),
        };
        const indexer = new DidIndexer(gatekeeper as any, db, { intervalMs: 60_000 });
        const applySpy = jest.spyOn(db, 'applyIndexPage');

        await indexer.startIndexing();
        indexer.stopIndexing();

        expect(gatekeeper.exportIndex).toHaveBeenCalledWith({
            mode: 'changes',
            cursor: null,
            limit: 500,
        });
        expect(applySpy.mock.results[0].type).toBe('return');
        const result = await applySpy.mock.results[0].value as ApplyIndexPageResult;
        expect(result.changedDids).toStrictEqual([]);
        expect(await db.loadSyncState('index.changes.cursor')).toBe('1');
        expect(await db.getPublishedCredentialCountsBySchema()).toStrictEqual([
            { schemaDid, count: 1 },
        ]);
    });

    it('resumes an incomplete snapshot from the saved opaque cursor and checkpoint cursor', async () => {
        const db = new DIDsDbMemory();
        const firstDid = 'did:test:z3v8AuaX8nDuXtLHrLAGmgfeVwCGfX9nMmZPTVbCDfaoiGvLuTv';
        const secondDid = 'did:test:z3v8AuaZUTzAPHj4oUwYqjHuhBr9HczoLsfT4hZtx4iBkpsFKbL';
        const savedCursor = 'opaque-resume-cursor';
        const firstPageCursor = 'opaque-page-1';
        const secondPageCursor = 'opaque-page-2';
        const checkpointCursor = '12';
        await db.saveSyncState('index.snapshot.cursor', savedCursor);
        await db.saveSyncState('index.snapshot.checkpointCursor', checkpointCursor);
        const gatekeeper = {
            isReady: jest.fn<GatekeeperIndexClient['isReady']>().mockResolvedValue(true),
            exportIndex: jest.fn<GatekeeperIndexClient['exportIndex']>()
                .mockResolvedValueOnce({
                    mode: 'snapshot' as const,
                    indexEpoch: 'epoch-test',
                    cursor: firstPageCursor,
                    checkpointCursor,
                    hasMore: true,
                    blocks: [],
                    dids: [{
                        did: firstDid,
                        events: [createAssetEvent(firstDid, {})],
                    }],
                })
                .mockResolvedValueOnce({
                    mode: 'snapshot' as const,
                    indexEpoch: 'epoch-test',
                    cursor: secondPageCursor,
                    checkpointCursor,
                    hasMore: false,
                    blocks: [],
                    dids: [{
                        did: secondDid,
                        events: [createAssetEvent(secondDid, {})],
                    }],
                }),
        };
        const indexer = new DidIndexer(gatekeeper as any, db, { intervalMs: 60_000, pageLimit: 2 });

        await (indexer as any).refreshIndex();

        expect(gatekeeper.exportIndex).toHaveBeenNthCalledWith(1, {
            mode: 'snapshot',
            cursor: savedCursor,
            checkpointCursor,
            limit: 2,
        });
        expect(gatekeeper.exportIndex).toHaveBeenNthCalledWith(2, {
            mode: 'snapshot',
            cursor: firstPageCursor,
            checkpointCursor,
            limit: 2,
        });
        expect(await db.loadSyncState('index.snapshot.cursor')).toBe(secondPageCursor);
        expect(await db.loadSyncState('index.snapshot.checkpointCursor')).toBe(checkpointCursor);
        expect(await db.loadSyncState('index.snapshot.complete')).toBe('true');
        expect(await db.loadSyncState('index.changes.cursor')).toBe(checkpointCursor);
    });

    it('does not advance the snapshot cursor when projection rebuild fails', async () => {
        const db = new DIDsDbMemory();
        const did = 'did:test:z3v8Auah2NPDigFc3qKx183QKL6vY8fJYQk6NeLz7KF2RFtC9c8';
        const gatekeeper = {
            isReady: jest.fn<GatekeeperIndexClient['isReady']>().mockResolvedValue(true),
            exportIndex: jest.fn<GatekeeperIndexClient['exportIndex']>().mockResolvedValue({
                mode: 'snapshot' as const,
                indexEpoch: 'epoch-test',
                cursor: did,
                checkpointCursor: '0',
                hasMore: false,
                blocks: [],
                dids: [{
                    did,
                    events: [{
                        registry: 'local',
                        time: '2026-03-31T11:00:00.000Z',
                        did,
                        operation: {
                            type: 'create',
                        },
                    }],
                }],
            }),
        };
        const indexer = new DidIndexer(gatekeeper as any, db, { intervalMs: 60_000 });

        await (indexer as any).refreshIndex();

        expect(await db.loadSyncState('index.snapshot.cursor')).toBeNull();
        expect(await db.loadSyncState('index.snapshot.complete')).toBeNull();
        expect(await db.loadSyncState('index.lastSyncError')).toContain('RangeError');
    });

    it('uses page block records while rebuilding DID projections', async () => {
        const db = new DIDsDbMemory();
        const did = 'did:test:z3v8AuakAd5R7WeGZUin2TtsqyxJPxouLfMEbpn5CmaNXChWq7r';
        const block = {
            height: 7,
            hash: 'block-lower-bound',
            time: 1775037600,
        };
        const gatekeeper = {
            isReady: jest.fn<GatekeeperIndexClient['isReady']>().mockResolvedValue(true),
            exportIndex: jest.fn<GatekeeperIndexClient['exportIndex']>().mockResolvedValue({
                mode: 'snapshot' as const,
                indexEpoch: 'epoch-test',
                cursor: did,
                checkpointCursor: '0',
                hasMore: false,
                blocks: [{
                    registry: 'local',
                    block,
                }],
                dids: [{
                    did,
                    events: [createAssetEvent(did, {}, '2026-03-31T11:00:00.000Z', {
                        blockid: block.hash,
                    })],
                }],
            }),
        };
        const indexer = new DidIndexer(gatekeeper as any, db, { intervalMs: 60_000 });

        await (indexer as any).refreshIndex();

        const doc = await db.getDID(did) as any;
        expect(doc.didDocumentMetadata.timestamp.lowerBound).toStrictEqual({
            time: block.time,
            timeISO: '2026-04-01T10:00:00.000Z',
            blockid: block.hash,
            height: block.height,
        });
        expect(await db.getBlock('local', block.hash)).toStrictEqual(block);
    });

    it('skips refresh work when gatekeeper is not ready', async () => {
        const db = new DIDsDbMemory();
        const gatekeeper = {
            isReady: jest.fn<GatekeeperIndexClient['isReady']>().mockResolvedValue(false),
            exportIndex: jest.fn<GatekeeperIndexClient['exportIndex']>(),
        };
        const indexer = new DidIndexer(gatekeeper as any, db, { intervalMs: 60_000 });

        await (indexer as any).refreshIndex();

        expect(gatekeeper.exportIndex).not.toHaveBeenCalled();
        expect(await db.loadSyncState('index.lastSyncStartedAt')).toBeNull();
    });

    it('skips overlapping refresh calls while one is already in progress', async () => {
        let resolveExportIndex: ((value: ReturnType<typeof createEmptySnapshotResponse>) => void) | null = null;
        const exportIndexPromise = new Promise<ReturnType<typeof createEmptySnapshotResponse>>((resolve) => {
            resolveExportIndex = resolve;
        });
        const db = new DIDsDbMemory();
        const gatekeeper = {
            isReady: jest.fn<GatekeeperIndexClient['isReady']>().mockResolvedValue(true),
            exportIndex: jest.fn<GatekeeperIndexClient['exportIndex']>()
                .mockReturnValue(exportIndexPromise),
        };
        const indexer = new DidIndexer(gatekeeper as any, db, { intervalMs: 60_000 });

        const firstRefresh = (indexer as any).refreshIndex();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        await (indexer as any).refreshIndex();

        expect(gatekeeper.exportIndex).toHaveBeenCalledTimes(1);

        resolveExportIndex!(createEmptySnapshotResponse());
        await firstRefresh;
    });

    it('logs refresh errors and resets state for later runs', async () => {
        const logger = createLogger();
        setLogger(logger as any);

        const db = new DIDsDbMemory();
        const error = new Error('boom');
        const gatekeeper = {
            isReady: jest.fn<GatekeeperIndexClient['isReady']>().mockResolvedValue(true),
            exportIndex: jest.fn<GatekeeperIndexClient['exportIndex']>()
                .mockRejectedValueOnce(error)
                .mockResolvedValueOnce(createEmptySnapshotResponse()),
        };
        const indexer = new DidIndexer(gatekeeper as any, db, { intervalMs: 60_000 });

        await (indexer as any).refreshIndex();
        await (indexer as any).refreshIndex();

        expect(logger.error).toHaveBeenCalledWith({ error }, 'Error in refreshIndex');
        expect(await db.loadSyncState('index.lastSyncError')).toBeNull();
        expect(await db.loadSyncState('index.snapshot.complete')).toBe('true');
    });

    it('logs rejected interval refreshes from the timer callback', async () => {
        const logger = createLogger();
        setLogger(logger as any);

        const db = new DIDsDbMemory();
        const gatekeeper = {
            isReady: jest.fn<GatekeeperIndexClient['isReady']>().mockResolvedValue(true),
            exportIndex: jest.fn<GatekeeperIndexClient['exportIndex']>()
                .mockResolvedValue(createEmptySnapshotResponse()),
        };
        const setIntervalSpy = jest.spyOn(global, 'setInterval');
        const clearIntervalSpy = jest.spyOn(global, 'clearInterval').mockImplementation(() => undefined as any);
        let intervalCallback: (() => Promise<void>) | undefined;

        setIntervalSpy.mockImplementation(((callback: () => Promise<void>) => {
            intervalCallback = callback;
            return {} as NodeJS.Timeout;
        }) as any);

        try {
            const indexer = new DidIndexer(gatekeeper as any, db as any, { intervalMs: 60_000 });
            await indexer.startIndexing();
            (indexer as any).refreshIndex = jest.fn<() => Promise<void>>()
                .mockRejectedValue(new Error('timer boom'));

            await intervalCallback!();

            expect(logger.error).toHaveBeenCalledWith(
                { error: expect.any(Error) },
                'refreshIndex error'
            );

            indexer.stopIndexing();
        }
        finally {
            setIntervalSpy.mockRestore();
            clearIntervalSpy.mockRestore();
        }
    });
});
