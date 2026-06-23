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
