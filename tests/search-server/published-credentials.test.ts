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
