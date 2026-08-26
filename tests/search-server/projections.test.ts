import DIDsDbMemory from '../../services/search-server/src/db/json-memory.ts';
import { buildDIDProjectionUpdate } from '../../services/search-server/src/projections.ts';
import type { GatekeeperEvent } from '../../services/search-server/src/types.ts';

const did = 'did:test:z3v8AuacR4diTuCgtbEfLDo2LzQNEDHgqBSNLMs5Szuq3WHcQdB';

function createEvent(): GatekeeperEvent {
    return {
        registry: 'local',
        time: '2026-04-01T10:00:00.000Z',
        ordinal: [0],
        did,
        operation: {
            type: 'create',
            created: '2026-04-01T10:00:00.000Z',
            mdip: {
                version: 1,
                type: 'asset',
                registry: 'local',
            },
            controller: did,
            data: { name: 'projection' },
        },
    };
}

describe('search-server DID projections', () => {
    it('returns a removal projection without resolving a document', async () => {
        const events = [createEvent()];
        const projection = await buildDIDProjectionUpdate(new DIDsDbMemory(), did, events, {
            removed: true,
        });

        expect(projection).toStrictEqual({
            did,
            events,
            removed: true,
            didPrefixReferences: [],
            publishedCredentials: [],
            challengeReceipts: [],
        });
    });

    it('resolves current projections using the database block lookup by default', async () => {
        const event = createEvent();
        const events = [{
            ...event,
            blockchain: {
                height: 7,
                txid: 'tx-7',
                index: 0,
                batch: 'batch-7',
                opidx: 0,
            },
            operation: {
                ...event.operation,
                blockid: 'block-7',
            },
        } as GatekeeperEvent];
        const db = new DIDsDbMemory();

        await db.applyIndexPage({
            dids: [],
            blocks: [{
                registry: 'local',
                block: {
                    height: 7,
                    hash: 'block-7',
                    time: 1775037600,
                },
            }],
        });

        const projection = await buildDIDProjectionUpdate(db, did, events);

        expect(projection.did).toBe(did);
        expect(projection.events).toStrictEqual(events);
        expect(projection.doc).toMatchObject({
            didDocument: { id: did },
            didDocumentData: { name: 'projection' },
            didDocumentMetadata: { confirmed: true },
        });
        expect(projection.didPrefixReferences).toStrictEqual([]);
        expect(projection.publishedCredentials).toStrictEqual([]);
        expect(projection.challengeReceipts).toStrictEqual([]);
    });

    it('retains prefix references from credentials absent from the current manifest', async () => {
        const credentialDid = 'did:mdip:historical-credential';
        const schemaDid = 'did:mdip:historical-schema';
        const update = (manifest: Record<string, unknown>, time: string): GatekeeperEvent => ({
            registry: 'local',
            time,
            did,
            operation: {
                type: 'update',
                did,
                doc: {
                    didDocument: { id: did, controller: did },
                    didDocumentData: { manifest },
                    mdip: { version: 1, type: 'agent', registry: 'local' },
                },
            },
        });
        const events = [
            createEvent(),
            update({
                [credentialDid]: {
                    type: ['VerifiableCredential', schemaDid],
                    issuer: did,
                    credentialSubject: { id: did },
                },
            }, '2026-04-01T11:00:00.000Z'),
            update({}, '2026-04-01T12:00:00.000Z'),
        ];
        events[0].operation.mdip!.type = 'agent';

        const projection = await buildDIDProjectionUpdate(new DIDsDbMemory(), did, events);

        expect(projection.publishedCredentials).toStrictEqual([]);
        expect(projection.didPrefixReferences).toStrictEqual([credentialDid, schemaDid]);
    });

    it('ignores credential manifests on non-AgentDID assets', async () => {
        const credentialDid = 'did:mdip:asset-credential';
        const schemaDid = 'did:mdip:asset-schema';
        const events = [
            createEvent(),
            {
                registry: 'local',
                time: '2026-04-01T11:00:00.000Z',
                did,
                operation: {
                    type: 'update',
                    did,
                    doc: {
                        didDocument: { id: did, controller: did },
                        didDocumentData: {
                            manifest: {
                                [credentialDid]: {
                                    type: ['VerifiableCredential', schemaDid],
                                    issuer: did,
                                    credentialSubject: { id: did },
                                },
                            },
                        },
                        mdip: { version: 1, type: 'asset', registry: 'local' },
                    },
                },
            } as GatekeeperEvent,
        ];

        const projection = await buildDIDProjectionUpdate(new DIDsDbMemory(), did, events);

        expect(projection.publishedCredentials).toStrictEqual([]);
        expect(projection.didPrefixReferences).toStrictEqual([]);
    });
});
