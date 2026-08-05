import { resolveDIDFromEvents } from '@mdip/gatekeeper';
import { findDIDReadTarget } from '../../services/search-server/src/did-aliases.ts';
import DIDsDbMemory from '../../services/search-server/src/db/json-memory.ts';
import type { GatekeeperEvent } from '../../services/search-server/src/types.ts';
import { seedDID } from './db-seed.ts';

const did = 'did:test:z3v8AuacR4diTuCgtbEfLDo2LzQNEDHgqBSNLMs5Szuq3WHcQdB';

function createEvent(
    time: string,
    data: Record<string, unknown>,
    registry = 'local'
): GatekeeperEvent {
    return {
        registry,
        time,
        ordinal: [0],
        did,
        operation: {
            type: 'create',
            created: '2026-04-01T10:00:00.000Z',
            mdip: {
                version: 1,
                type: 'asset',
                registry,
            },
            controller: did,
            data,
        },
    };
}

function updateEvent(time: string, data: Record<string, unknown>): GatekeeperEvent {
    return {
        registry: 'local',
        time,
        ordinal: [1],
        did,
        operation: {
            type: 'update',
            did,
            doc: {
                didDocument: {
                    id: did,
                    controller: did,
                },
                didDocumentData: data,
                mdip: {
                    version: 1,
                    type: 'asset',
                    registry: 'local',
                },
            },
        },
    };
}

describe('search-server DID read model', () => {
    it('resolves DID prefix aliases by their CID suffix', async () => {
        const db = new DIDsDbMemory();
        const event = createEvent('2026-04-01T10:00:00.000Z', { schema: true });
        const alias = did.replace('did:test:', 'did:mdip:');
        await seedDID(db, did, { events: [event] });

        expect(await findDIDReadTarget(db, did)).toStrictEqual({
            storedDid: did,
            events: [event],
        });
        const target = await findDIDReadTarget(db, alias);
        expect(target).toStrictEqual({ storedDid: did, events: [event] });
        const doc = await resolveDIDFromEvents({
            did: alias,
            events: target.events,
            getBlock: (registry, block) => db.getBlock(registry, block),
        });

        expect(doc.didDocument?.id).toBe(alias);
        expect(await findDIDReadTarget(
            db,
            'did:mdip:z3v8AuaZxKbN4T6CQTAnjH4T3mR5EmUq4yFW3pMjPyiUefFd63M'
        )).toMatchObject({ events: [] });
        expect(await findDIDReadTarget(db, 'did:mdip:not-a-cid')).toStrictEqual({
            storedDid: 'did:mdip:not-a-cid',
            events: [],
        });
    });

    it('reconstructs DID document versions from stored raw events', async () => {
        const db = new DIDsDbMemory();
        await seedDID(db, did, { events: [
            createEvent('2026-04-01T10:00:00.000Z', { version: 'first' }),
            updateEvent('2026-04-01T11:00:00.000Z', { version: 'second' }),
        ] });

        const events = await db.getDIDEvents(did);
        const first = await resolveDIDFromEvents({
            did,
            events,
            options: { versionSequence: 1 },
            getBlock: (registry, block) => db.getBlock(registry, block),
        });
        const latest = await resolveDIDFromEvents({
            did,
            events,
            getBlock: (registry, block) => db.getBlock(registry, block),
        });

        expect(first.didDocumentMetadata?.version).toBe('1');
        expect(first.didDocumentData).toStrictEqual({ version: 'first' });
        expect(latest.didDocumentMetadata?.version).toBe('2');
        expect(latest.didDocumentData).toStrictEqual({ version: 'second' });
    });

    it('paginates and filters events for the explorer events view', async () => {
        const db = new DIDsDbMemory();
        const otherDid = 'did:test:z3v8AuaZxKbN4T6CQTAnjH4T3mR5EmUq4yFW3pMjPyiUefFd63M';
        const first = createEvent('2026-04-01T10:00:00.000Z', { order: 1 });
        const second = updateEvent('2026-04-01T11:00:00.000Z', { order: 2 });
        const third: GatekeeperEvent = {
            ...createEvent('2026-04-01T12:00:00.000Z', { order: 3 }, 'TFTC'),
            did: otherDid,
            operation: {
                ...createEvent('2026-04-01T12:00:00.000Z', { order: 3 }, 'TFTC').operation,
                controller: otherDid,
            },
        };

        await seedDID(db, did, { events: [first, second] });
        await seedDID(db, otherDid, { events: [third] });

        expect(await db.listEvents({
            registry: 'local',
            updatedAfter: first.time,
            updatedBefore: '2026-04-01T12:00:00.000Z',
            limit: 1,
            offset: 0,
        })).toStrictEqual({
            total: 1,
            events: [{
                did,
                registry: 'local',
                time: second.time,
                event: second,
            }],
        });

        const secondPage = await db.listEvents({
            limit: 1,
            offset: 1,
        });

        expect(secondPage.total).toBe(3);
        expect(secondPage.events).toStrictEqual([{
            did,
            registry: 'local',
            time: second.time,
            event: second,
        }]);
    });
});
