import {
    generateDIDFromOperation,
    resolveDIDFromEvents,
} from '@mdip/gatekeeper';
import type {
    GatekeeperEvent,
    Operation,
} from '@mdip/gatekeeper/types';

const cid = 'z3v8AuacR4diTuCgtbEfLDo2LzQNEDHgqBSNLMs5Szuq3WHcQdB';
const did = `did:test:${cid}`;
const createOperation: Operation = {
    type: 'create',
    created: '2026-04-01T10:00:00.000Z',
    mdip: {
        version: 1,
        type: 'asset',
        registry: 'local',
    },
    controller: did,
    data: { name: 'resolver-options' },
};
const createEvent: GatekeeperEvent = {
    registry: 'local',
    time: '2026-04-01T10:00:00.000Z',
    ordinal: [0],
    did,
    operation: createOperation,
};

describe('DID resolver injectable generation and verification options', () => {
    it('generates DIDs with injectable CID generation and prefix fallback', async () => {
        await expect(generateDIDFromOperation(createOperation, {
            didPrefix: 'did:custom',
            generateCID: async () => cid,
        })).resolves.toBe(`did:custom:${cid}`);

        await expect(generateDIDFromOperation({
            ...createOperation,
            mdip: {
                ...createOperation.mdip!,
                prefix: 'did:operation',
            },
        }, {
            didPrefix: 'did:custom',
            generateCID: async () => cid,
        })).resolves.toBe(`did:operation:${cid}`);
    });

    it('resolves create events using the default injectable DID generator', async () => {
        const doc = await resolveDIDFromEvents({
            did,
            events: [createEvent],
            generateCID: async () => cid,
        });

        expect(doc.didDocument).toMatchObject({
            id: did,
            controller: did,
        });
        expect(doc.didDocumentData).toStrictEqual({ name: 'resolver-options' });
    });

    it('returns notFound when versionTime precedes creation', async () => {
        const doc = await resolveDIDFromEvents({
            did,
            events: [createEvent],
            options: { versionTime: '2026-04-01T09:59:59.999Z' },
            generateCID: async () => cid,
        });

        expect(doc.didResolutionMetadata?.error).toBe('notFound');
    });

    it('requires native-registry confirmation of the create event', async () => {
        const operation = {
            ...createOperation,
            mdip: {
                ...createOperation.mdip!,
                registry: 'hyperswarm',
            },
        } satisfies Operation;
        const unconfirmedEvent = {
            ...createEvent,
            operation,
        };

        const unconfirmed = await resolveDIDFromEvents({
            did,
            events: [unconfirmedEvent],
            generateCID: async () => cid,
        });
        const confirmedOnly = await resolveDIDFromEvents({
            did,
            events: [unconfirmedEvent],
            options: { confirm: true },
            generateCID: async () => cid,
        });
        const confirmed = await resolveDIDFromEvents({
            did,
            events: [{ ...unconfirmedEvent, registry: 'hyperswarm' }],
            options: { confirm: true },
            generateCID: async () => cid,
        });

        expect(unconfirmed.didDocumentMetadata?.confirmed).toBe(false);
        expect(confirmedOnly.didResolutionMetadata?.error).toBe('notFound');
        expect(confirmed.didDocumentMetadata?.confirmed).toBe(true);
    });

    it('requires create and update verifiers when verify mode is enabled', async () => {
        await expect(resolveDIDFromEvents({
            did,
            events: [createEvent],
            options: { verify: true },
            generateCID: async () => cid,
        })).rejects.toThrow('verifyCreateOperation');

        await expect(resolveDIDFromEvents({
            did,
            events: [
                createEvent,
                {
                    registry: 'local',
                    time: '2026-04-01T11:00:00.000Z',
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
                            didDocumentData: { name: 'updated' },
                            mdip: createOperation.mdip,
                        },
                    },
                },
            ],
            options: { verify: true },
            generateCID: async () => cid,
            verifyCreateOperation: async () => true,
        })).rejects.toThrow('verifyUpdateOperation');
    });
});
