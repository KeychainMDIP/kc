import { jest } from '@jest/globals';
import type KeymasterClient from '@mdip/keymaster/client';
import type KuboClient from '@mdip/ipfs/kubo';
import type { KuboRequestOptions, PeeringPeer } from '@mdip/ipfs/kubo';

import { createPeerDirectory } from '../../services/mediators/hyperswarm/src/peer-directory.ts';

type DirectoryOptions = Parameters<typeof createPeerDirectory>[0];
type FakeKubo = Pick<KuboClient, 'addPeeringPeer' | 'getPeeringPeers' | 'removePeeringPeer'>;

function nodeDocument(did: string, peerId = `${did}-peer`) {
    return {
        didDocumentData: {
            node: {
                name: did,
                ipfs: {
                    id: peerId,
                    addresses: [`/ip4/203.0.113.1/tcp/4001/p2p/${peerId}`],
                },
            },
        },
    };
}

function createFakeKubo(initial: PeeringPeer[] = []) {
    let peers = initial.map(peer => ({ ID: peer.ID, Addrs: [...peer.Addrs] }));
    const getPeeringPeers = jest.fn(async () => peers.map(peer => ({ ID: peer.ID, Addrs: [...peer.Addrs] })));
    const addPeeringPeer = jest.fn(async (
        id: string,
        addresses: string[],
        _options?: KuboRequestOptions,
    ) => {
        if (!peers.some(peer => peer.ID === id)) {
            peers.push({ ID: id, Addrs: [...addresses] });
        }
    });
    const removePeeringPeer = jest.fn(async (id: string, _options?: KuboRequestOptions) => {
        peers = peers.filter(peer => peer.ID !== id);
    });

    return {
        ipfs: { addPeeringPeer, getPeeringPeers, removePeeringPeer } as FakeKubo,
        addPeeringPeer,
        getPeeringPeers,
        removePeeringPeer,
        get peers() {
            return peers;
        },
    };
}

function createDirectory(options: Partial<DirectoryOptions> = {}) {
    const kubo = createFakeKubo();
    const resolveDID = jest.fn(async (did: string) => nodeDocument(did));
    const directory = createPeerDirectory({
        enabled: true,
        keymaster: { resolveDID } as unknown as Pick<KeymasterClient, 'resolveDID'>,
        ipfs: kubo.ipfs,
        getLocalIpfsId: () => 'local-id',
        ...options,
    });
    return { directory, kubo, resolveDID };
}

describe('peer directory', () => {
    it('deduplicates DID aliases and does not add the local IPFS peer', async () => {
        const kubo = createFakeKubo();
        const resolveDID = jest.fn(async (did: string) => nodeDocument(
            did,
            did.endsWith('self') ? 'local-id' : 'remote-id',
        ));
        const directory = createPeerDirectory({
            enabled: true,
            keymaster: { resolveDID } as unknown as Pick<KeymasterClient, 'resolveDID'>,
            ipfs: kubo.ipfs,
            getLocalIpfsId: () => 'local-id',
        });

        await directory.initialize();
        directory.addPeers(['did:test:remote', 'did:alias:remote', 'did:test:self']);
        await directory.waitForIdle();

        expect(resolveDID).toHaveBeenCalledTimes(2);
        expect(kubo.addPeeringPeer).toHaveBeenCalledTimes(1);
        expect(directory.getKnownDids().sort()).toEqual(['did:test:remote', 'did:test:self']);
        expect(directory.getPeerName('remote-id')).toBe('did:test:remote');
    });

    it('bounds queued resolution work and resolves at most four peers concurrently', async () => {
        let release!: () => void;
        const gate = new Promise<void>(resolve => {
            release = resolve;
        });
        let active = 0;
        let maximumActive = 0;
        const resolveDID = jest.fn(async (did: string) => {
            active += 1;
            maximumActive = Math.max(maximumActive, active);
            await gate;
            active -= 1;
            return nodeDocument(did);
        });
        const kubo = createFakeKubo();
        const directory = createPeerDirectory({
            enabled: true,
            keymaster: { resolveDID } as unknown as Pick<KeymasterClient, 'resolveDID'>,
            ipfs: kubo.ipfs,
            getLocalIpfsId: () => 'local-id',
            limits: { maxConcurrent: 4, maxQueued: 6 },
        });

        directory.addPeers(Array.from({ length: 7 }, (_, index) => `did:test:${index}`));
        await new Promise(resolve => setImmediate(resolve));
        expect(resolveDID).toHaveBeenCalledTimes(4);

        release();
        await directory.waitForIdle();

        expect(maximumActive).toBe(4);
        expect(resolveDID).toHaveBeenCalledTimes(6);

        directory.addPeers(['did:test:6']);
        await directory.waitForIdle();
        expect(resolveDID).toHaveBeenCalledTimes(7);
    });

    it('delays failed candidates and retries them after the bounded deadline', async () => {
        let currentTime = 1_000;
        const kubo = createFakeKubo();
        const resolveDID = jest.fn<Pick<KeymasterClient, 'resolveDID'>['resolveDID']>()
            .mockRejectedValueOnce(new Error('temporary failure'))
            .mockResolvedValue(nodeDocument('did:test:retry'));
        const directory = createPeerDirectory({
            enabled: true,
            keymaster: { resolveDID },
            ipfs: kubo.ipfs,
            getLocalIpfsId: () => 'local-id',
            now: () => currentTime,
            limits: { retryDelayMs: 500 },
        });

        directory.addPeers(['did:test:retry']);
        await directory.waitForIdle();
        directory.addPeers(['did:test:retry']);
        await directory.waitForIdle();
        expect(resolveDID).toHaveBeenCalledTimes(1);

        currentTime += 500;
        directory.addPeers(['did:test:retry']);
        await directory.waitForIdle();
        expect(resolveDID).toHaveBeenCalledTimes(2);
        expect(directory.getKnownDids()).toEqual(['did:test:retry']);
    });

    it('bounds the failed-candidate cache with FIFO eviction', async () => {
        const kubo = createFakeKubo();
        const resolveDID = jest.fn(async () => {
            throw new Error('unavailable');
        });
        const directory = createPeerDirectory({
            enabled: true,
            keymaster: { resolveDID } as unknown as Pick<KeymasterClient, 'resolveDID'>,
            ipfs: kubo.ipfs,
            getLocalIpfsId: () => 'local-id',
            limits: { maxFailures: 1 },
        });

        directory.addPeers(['did:test:first', 'did:test:second']);
        await directory.waitForIdle();
        directory.addPeers(['did:test:first', 'did:test:second']);
        await directory.waitForIdle();

        expect(resolveDID).toHaveBeenCalledTimes(3);
    });

    it('serializes concurrent Kubo mutations', async () => {
        let release!: () => void;
        const firstAdd = new Promise<void>(resolve => {
            release = resolve;
        });
        const kubo = createFakeKubo();
        kubo.addPeeringPeer.mockImplementationOnce(async (id, addresses) => {
            await firstAdd;
            kubo.peers.push({ ID: id, Addrs: [...addresses] });
        });
        const { directory } = createDirectory({
            ipfs: kubo.ipfs,
            limits: { maxConcurrent: 4 },
        });

        directory.addPeers(['did:test:first', 'did:test:second']);
        await new Promise(resolve => setImmediate(resolve));
        expect(kubo.addPeeringPeer).toHaveBeenCalledTimes(1);

        release();
        await directory.waitForIdle();
        expect(kubo.addPeeringPeer).toHaveBeenCalledTimes(2);
    });

    it('does not rewrite or remove pre-existing operator-managed peers', async () => {
        const kubo = createFakeKubo([{ ID: 'operator', Addrs: ['/operator'] }]);
        const resolveDID = jest.fn(async (did: string) => nodeDocument(
            did,
            did.endsWith('operator') ? 'operator' : 'local-id',
        ));
        const directory = createPeerDirectory({
            enabled: true,
            keymaster: { resolveDID } as unknown as Pick<KeymasterClient, 'resolveDID'>,
            ipfs: kubo.ipfs,
            getLocalIpfsId: () => 'local-id',
            limits: { maxRecords: 1 },
        });

        await directory.initialize();
        directory.addPeers(['did:test:operator']);
        await directory.waitForIdle();
        directory.addPeers(['did:test:replacement']);
        await directory.waitForIdle();

        expect(kubo.addPeeringPeer).not.toHaveBeenCalled();
        expect(kubo.removePeeringPeer).not.toHaveBeenCalled();
        expect(kubo.peers).toEqual([{ ID: 'operator', Addrs: ['/operator'] }]);
        expect(directory.getKnownDids()).toEqual(['did:test:replacement']);
    });

    it('counts pre-existing Kubo peers against the persistent limit', async () => {
        const kubo = createFakeKubo([{ ID: 'operator', Addrs: ['/operator'] }]);
        const { directory } = createDirectory({
            ipfs: kubo.ipfs,
            limits: { maxKuboPeers: 1 },
        });

        await directory.initialize();
        directory.addPeers(['did:test:new']);
        await directory.waitForIdle();

        expect(kubo.addPeeringPeer).not.toHaveBeenCalled();
        expect(kubo.peers).toEqual([{ ID: 'operator', Addrs: ['/operator'] }]);
        expect(directory.getKnownDids()).toEqual([]);
    });

    it('keeps shared Kubo peers until their final retained DID is evicted', async () => {
        const kubo = createFakeKubo();
        const resolveDID = jest.fn(async (did: string) => nodeDocument(
            did,
            did.endsWith('a') || did.endsWith('b') ? 'shared' : 'other',
        ));
        const directory = createPeerDirectory({
            enabled: true,
            keymaster: { resolveDID } as unknown as Pick<KeymasterClient, 'resolveDID'>,
            ipfs: kubo.ipfs,
            getLocalIpfsId: () => 'local-id',
            limits: { maxRecords: 2 },
        });

        directory.addPeers(['did:test:a', 'did:test:b']);
        await directory.waitForIdle();
        directory.addPeers(['did:test:c']);
        await directory.waitForIdle();

        expect(kubo.addPeeringPeer).toHaveBeenCalledTimes(2);
        expect(kubo.removePeeringPeer).not.toHaveBeenCalled();
        expect(kubo.peers.map(peer => peer.ID).sort()).toEqual(['other', 'shared']);
        expect(directory.getKnownDids()).toEqual(['did:test:b', 'did:test:c']);
    });

    it('replaces a DID alias without removing and re-adding its shared Kubo peer', async () => {
        const kubo = createFakeKubo();
        const resolveDID = jest.fn(async (did: string) => nodeDocument(did, 'shared'));
        const directory = createPeerDirectory({
            enabled: true,
            keymaster: { resolveDID } as unknown as Pick<KeymasterClient, 'resolveDID'>,
            ipfs: kubo.ipfs,
            getLocalIpfsId: () => 'local-id',
            limits: { maxRecords: 1 },
        });

        directory.addPeers(['did:test:first']);
        await directory.waitForIdle();
        directory.addPeers(['did:test:second']);
        await directory.waitForIdle();

        expect(kubo.addPeeringPeer).toHaveBeenCalledTimes(1);
        expect(kubo.removePeeringPeer).not.toHaveBeenCalled();
        expect(directory.getKnownDids()).toEqual(['did:test:second']);
    });

    it('removes mediator-managed Kubo peers when the final DID is evicted', async () => {
        const { directory, kubo } = createDirectory({
            limits: { maxRecords: 2 },
        });

        directory.addPeers(['did:test:a', 'did:test:b']);
        await directory.waitForIdle();
        directory.addPeers(['did:test:c']);
        await directory.waitForIdle();

        expect(kubo.removePeeringPeer).toHaveBeenCalledWith(
            'did:test:a-peer',
            expect.objectContaining({ timeoutMs: 10_000 }),
        );
        expect(kubo.peers.map(peer => peer.ID).sort()).toEqual([
            'did:test:b-peer',
            'did:test:c-peer',
        ]);
        expect(directory.getKnownDids()).toEqual(['did:test:b', 'did:test:c']);
    });

    it('retains the old record and drops a replacement when Kubo removal is not confirmed', async () => {
        const { directory, kubo } = createDirectory({
            limits: { maxRecords: 1 },
        });
        kubo.removePeeringPeer.mockImplementation(async () => undefined);

        directory.addPeers(['did:test:old']);
        await directory.waitForIdle();
        directory.addPeers(['did:test:new']);
        await directory.waitForIdle();

        expect(kubo.addPeeringPeer).toHaveBeenCalledTimes(1);
        expect(directory.getKnownDids()).toEqual(['did:test:old']);
        expect(kubo.peers.map(peer => peer.ID)).toEqual(['did:test:old-peer']);
    });

    it('accepts a replacement when a failed remove response is confirmed absent', async () => {
        const { directory, kubo } = createDirectory({
            limits: { maxRecords: 1 },
        });
        kubo.removePeeringPeer.mockImplementationOnce(async id => {
            const index = kubo.peers.findIndex(peer => peer.ID === id);
            kubo.peers.splice(index, 1);
            throw new Error('response lost');
        });

        directory.addPeers(['did:test:old']);
        await directory.waitForIdle();
        directory.addPeers(['did:test:new']);
        await directory.waitForIdle();

        expect(directory.getKnownDids()).toEqual(['did:test:new']);
        expect(kubo.peers.map(peer => peer.ID)).toEqual(['did:test:new-peer']);
    });

    it('retains the old record when Kubo removal cannot be confirmed', async () => {
        const { directory, kubo } = createDirectory({
            limits: { maxRecords: 1 },
        });
        let reads = 0;
        const originalGet = kubo.getPeeringPeers.getMockImplementation()!;
        kubo.getPeeringPeers.mockImplementation(async (...args) => {
            reads += 1;
            if (reads === 5) {
                throw new Error('confirmation unavailable');
            }
            return originalGet(...args);
        });

        directory.addPeers(['did:test:old']);
        await directory.waitForIdle();
        directory.addPeers(['did:test:new']);
        await directory.waitForIdle();

        expect(directory.getKnownDids()).toEqual(['did:test:old']);
    });

    it('does not exceed the DID bound when a required eviction fails', async () => {
        const sharedKubo = createFakeKubo();
        const sharedResolve = jest.fn(async (did: string) => nodeDocument(
            did,
            did.includes('target') ? 'target-peer' : `${did}-peer`,
        ));
        const sharedDirectory = createPeerDirectory({
            enabled: true,
            keymaster: { resolveDID: sharedResolve } as unknown as Pick<KeymasterClient, 'resolveDID'>,
            ipfs: sharedKubo.ipfs,
            getLocalIpfsId: () => 'local-id',
            limits: { maxRecords: 2 },
        });
        sharedKubo.removePeeringPeer.mockImplementation(async () => undefined);
        sharedDirectory.addPeers(['did:test:old', 'did:test:target']);
        await sharedDirectory.waitForIdle();
        sharedDirectory.addPeers(['did:test:target-alias']);
        await sharedDirectory.waitForIdle();
        expect(sharedDirectory.getKnownDids()).toEqual(['did:test:old', 'did:test:target']);

        const localKubo = createFakeKubo();
        localKubo.removePeeringPeer.mockImplementation(async () => undefined);
        const localResolve = jest.fn(async (did: string) => nodeDocument(
            did,
            did.endsWith('local') ? 'local-id' : 'old-peer',
        ));
        const localDirectory = createPeerDirectory({
            enabled: true,
            keymaster: { resolveDID: localResolve } as unknown as Pick<KeymasterClient, 'resolveDID'>,
            ipfs: localKubo.ipfs,
            getLocalIpfsId: () => 'local-id',
            limits: { maxRecords: 1 },
        });
        localDirectory.addPeers(['did:test:old']);
        await localDirectory.waitForIdle();
        localDirectory.addPeers(['did:test:local']);
        await localDirectory.waitForIdle();
        expect(localDirectory.getKnownDids()).toEqual(['did:test:old']);

        const operatorKubo = createFakeKubo([{ ID: 'operator-peer', Addrs: ['/operator'] }]);
        operatorKubo.removePeeringPeer.mockImplementation(async () => undefined);
        const operatorResolve = jest.fn(async (did: string) => nodeDocument(
            did,
            did.endsWith('operator') ? 'operator-peer' : 'old-peer',
        ));
        const operatorDirectory = createPeerDirectory({
            enabled: true,
            keymaster: { resolveDID: operatorResolve } as unknown as Pick<KeymasterClient, 'resolveDID'>,
            ipfs: operatorKubo.ipfs,
            getLocalIpfsId: () => 'local-id',
            limits: { maxRecords: 1 },
        });
        operatorDirectory.addPeers(['did:test:old']);
        await operatorDirectory.waitForIdle();
        operatorDirectory.addPeers(['did:test:operator']);
        await operatorDirectory.waitForIdle();
        expect(operatorDirectory.getKnownDids()).toEqual(['did:test:old']);
    });

    it('keeps an ambiguous addition provisional until Kubo confirms it', async () => {
        const kubo = createFakeKubo();
        const originalGet = kubo.getPeeringPeers.getMockImplementation()!;
        let reads = 0;
        kubo.getPeeringPeers.mockImplementation(async (...args) => {
            reads += 1;
            if (reads === 3) {
                throw new Error('confirmation unavailable');
            }
            return originalGet(...args);
        });
        const { directory } = createDirectory({ ipfs: kubo.ipfs });

        await directory.initialize();
        directory.addPeers(['did:test:ambiguous']);
        await directory.waitForIdle();
        expect(directory.getKnownDids()).toEqual([]);

        directory.addPeers(['did:test:ambiguous']);
        await directory.waitForIdle();
        expect(directory.getKnownDids()).toEqual(['did:test:ambiguous']);
        expect(kubo.addPeeringPeer).toHaveBeenCalledTimes(1);
    });

    it('drops an unconfirmed addition and delays its retry', async () => {
        let currentTime = 0;
        const kubo = createFakeKubo();
        kubo.addPeeringPeer.mockImplementation(async () => undefined);
        const { directory } = createDirectory({
            ipfs: kubo.ipfs,
            now: () => currentTime,
            limits: { retryDelayMs: 10 },
        });

        directory.addPeers(['did:test:unusable']);
        await directory.waitForIdle();
        directory.addPeers(['did:test:unusable']);
        await directory.waitForIdle();
        expect(kubo.addPeeringPeer).toHaveBeenCalledTimes(1);
        expect(directory.getKnownDids()).toEqual([]);

        currentTime = 10;
        directory.addPeers(['did:test:unusable']);
        await directory.waitForIdle();
        expect(kubo.addPeeringPeer).toHaveBeenCalledTimes(2);
    });

    it('confirms an addition that committed before Kubo returned an error', async () => {
        const kubo = createFakeKubo();
        kubo.addPeeringPeer.mockImplementationOnce(async (id, addresses) => {
            kubo.peers.push({ ID: id, Addrs: [...addresses] });
            throw new Error('response lost');
        });
        const { directory } = createDirectory({ ipfs: kubo.ipfs });

        directory.addPeers(['did:test:committed']);
        await directory.waitForIdle();

        expect(directory.getKnownDids()).toEqual(['did:test:committed']);
    });

    it('removes a provisional record when later confirmation finds no Kubo peer', async () => {
        let reads = 0;
        const kubo = createFakeKubo();
        kubo.addPeeringPeer.mockImplementation(async () => undefined);
        const originalGet = kubo.getPeeringPeers.getMockImplementation()!;
        kubo.getPeeringPeers.mockImplementation(async (...args) => {
            reads += 1;
            if (reads === 3) {
                throw new Error('confirmation unavailable');
            }
            return originalGet(...args);
        });
        const { directory } = createDirectory({ ipfs: kubo.ipfs });

        await directory.initialize();
        directory.addPeers(['did:test:missing']);
        await directory.waitForIdle();
        directory.addPeers(['did:test:missing']);
        await directory.waitForIdle();

        expect(directory.getKnownDids()).toEqual([]);
        expect(kubo.addPeeringPeer).toHaveBeenCalledTimes(1);
    });

    it('counts an unconfirmed provisional addition against Kubo capacity', async () => {
        let reads = 0;
        const kubo = createFakeKubo();
        kubo.addPeeringPeer.mockImplementation(async () => undefined);
        const originalGet = kubo.getPeeringPeers.getMockImplementation()!;
        kubo.getPeeringPeers.mockImplementation(async (...args) => {
            reads += 1;
            if (reads === 3) {
                throw new Error('confirmation unavailable');
            }
            return originalGet(...args);
        });
        const { directory } = createDirectory({
            ipfs: kubo.ipfs,
            limits: { maxKuboPeers: 1 },
        });

        await directory.initialize();
        directory.addPeers(['did:test:first']);
        await directory.waitForIdle();
        directory.addPeers(['did:test:second']);
        await directory.waitForIdle();

        expect(kubo.addPeeringPeer).toHaveBeenCalledTimes(1);
        expect(directory.getKnownDids()).toEqual([]);
    });

    it('fails closed after a startup read error and enables mutations after a later read', async () => {
        let currentTime = 0;
        const kubo = createFakeKubo();
        kubo.getPeeringPeers
            .mockRejectedValueOnce(new Error('startup unavailable'))
            .mockRejectedValueOnce(new Error('still unavailable'));
        const { directory } = createDirectory({
            ipfs: kubo.ipfs,
            now: () => currentTime,
            limits: { retryDelayMs: 10 },
        });

        await directory.initialize();
        directory.addPeers(['did:test:peer']);
        await directory.waitForIdle();
        expect(kubo.addPeeringPeer).not.toHaveBeenCalled();

        currentTime = 10;
        directory.addPeers(['did:test:peer']);
        await directory.waitForIdle();
        expect(kubo.addPeeringPeer).toHaveBeenCalledTimes(1);
        expect(directory.getKnownDids()).toEqual(['did:test:peer']);
    });

    it('does not mutate Kubo when a post-startup configuration read fails', async () => {
        const kubo = createFakeKubo();
        kubo.getPeeringPeers
            .mockResolvedValueOnce([])
            .mockRejectedValueOnce(new Error('read unavailable'));
        const { directory } = createDirectory({ ipfs: kubo.ipfs });

        await directory.initialize();
        directory.addPeers(['did:test:peer']);
        await directory.waitForIdle();

        expect(kubo.addPeeringPeer).not.toHaveBeenCalled();
        expect(directory.getKnownDids()).toEqual([]);
    });

    it('rejects invalid resolved peer metadata before calling Kubo', async () => {
        const kubo = createFakeKubo();
        const resolveDID = jest.fn(async () => ({
            didDocumentData: {
                node: {
                    name: 'node',
                    ipfs: {
                        id: 'peer',
                        addresses: Array.from({ length: 17 }, () => '/ip4/203.0.113.1/tcp/4001'),
                    },
                },
            },
        }));
        const directory = createPeerDirectory({
            enabled: true,
            keymaster: { resolveDID } as unknown as Pick<KeymasterClient, 'resolveDID'>,
            ipfs: kubo.ipfs,
            getLocalIpfsId: () => 'local-id',
        });

        directory.addPeers(['did:test:invalid']);
        await directory.waitForIdle();

        expect(kubo.addPeeringPeer).not.toHaveBeenCalled();
        expect(directory.getKnownDids()).toEqual([]);
    });

    it('rejects missing resolved node metadata before calling Kubo', async () => {
        const kubo = createFakeKubo();
        const resolveDID = jest.fn(async () => ({ didDocumentData: { node: 'invalid' } }));
        const directory = createPeerDirectory({
            enabled: true,
            keymaster: { resolveDID } as unknown as Pick<KeymasterClient, 'resolveDID'>,
            ipfs: kubo.ipfs,
            getLocalIpfsId: () => 'local-id',
        });

        directory.addPeers(['did:test:invalid']);
        await directory.waitForIdle();

        expect(kubo.addPeeringPeer).not.toHaveBeenCalled();
    });

    it('fails closed when Kubo returns malformed peering configuration', async () => {
        const kubo = createFakeKubo();
        kubo.getPeeringPeers.mockResolvedValueOnce([{ ID: '', Addrs: [] }]);
        const { directory } = createDirectory({ ipfs: kubo.ipfs });

        await directory.initialize();
        directory.addPeers(['did:test:peer']);
        await directory.waitForIdle();

        expect(kubo.addPeeringPeer).toHaveBeenCalledTimes(1);
        expect(directory.getKnownDids()).toEqual(['did:test:peer']);
    });

    it('does no work when disabled and rejects an invalid local DID', async () => {
        const { directory, kubo, resolveDID } = createDirectory({ enabled: false });

        await directory.initialize();
        directory.addPeers(['did:test:peer']);
        await directory.waitForIdle();
        expect(resolveDID).not.toHaveBeenCalled();
        expect(kubo.getPeeringPeers).not.toHaveBeenCalled();
        expect(() => directory.registerNode('invalid')).toThrow('Invalid local node DID');

        await directory.shutdown();
        await directory.shutdown();
    });

    it('pins the local DID and advertises only the 255 most recent remote DIDs', async () => {
        const { directory } = createDirectory();
        directory.registerNode('did:test:local');
        directory.addPeers(Array.from({ length: 256 }, (_, index) => `did:test:remote-${index}`));
        await directory.waitForIdle();

        const advertised = directory.getKnownDids();
        expect(advertised).toHaveLength(256);
        expect(advertised[0]).toBe('did:test:local');
        expect(advertised).not.toContain('did:test:remote-0');
        expect(advertised.at(-1)).toBe('did:test:remote-255');
    });

    it('aborts Kubo work and discards queued candidates during shutdown', async () => {
        const kubo = createFakeKubo();
        let receivedSignal: AbortSignal | undefined;
        kubo.addPeeringPeer.mockImplementation(async (_id, _addresses, options) => {
            receivedSignal = options?.signal;
            await new Promise<void>((_resolve, reject) => {
                options?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
            });
        });
        const { directory } = createDirectory({
            ipfs: kubo.ipfs,
            limits: { maxConcurrent: 1, maxQueued: 1 },
        });

        directory.addPeers(['did:test:active', 'did:test:queued']);
        while (!receivedSignal) {
            await new Promise(resolve => setImmediate(resolve));
        }
        await directory.shutdown();

        expect(receivedSignal.aborted).toBe(true);
        expect(directory.getKnownDids()).toEqual([]);
    });
});
