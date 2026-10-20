import type KeymasterClient from '@mdip/keymaster/client';
import type KuboClient from '@mdip/ipfs/kubo';
import type { PeeringPeer } from '@mdip/ipfs/kubo';

import { childLogger } from '@mdip/common/logger';
import type { NodeInfo } from './mediator-state.js';
import {
    KUBO_PEERING_TIMEOUT_MS,
    MAX_ADVERTISED_PEERS,
    MAX_IPFS_PEER_ADDRESSES,
    MAX_IPFS_PEER_ADDRESS_BYTES,
    MAX_KUBO_PEERING_PEERS,
    MAX_PEER_DIRECTORY_CONCURRENCY,
    MAX_PEER_DIRECTORY_FAILURES,
    MAX_PEER_DIRECTORY_QUEUE,
    MAX_PEER_DIRECTORY_RECORDS,
    MAX_PROTOCOL_STRING_BYTES,
    PEER_DIRECTORY_RETRY_DELAY_MS,
} from './protocol-limits.js';

const log = childLogger({ service: 'hyperswarm-mediator' });

type PeeringOwnership = 'local' | 'mediator' | 'operator';
type PeerStatus = 'confirmed' | 'provisional';

interface PeerDirectoryRecord {
    did: string;
    peerId: string;
    name: string;
    addresses: string[];
    ownership: PeeringOwnership;
    status: PeerStatus;
}

interface PeerDirectoryLimits {
    maxQueued: number;
    maxConcurrent: number;
    maxRecords: number;
    maxFailures: number;
    maxKuboPeers: number;
    retryDelayMs: number;
    maxAddresses: number;
    maxAddressBytes: number;
    maxMetadataBytes: number;
    kuboTimeoutMs: number;
}

interface PeerDirectoryOptions {
    enabled: boolean;
    keymaster: Pick<KeymasterClient, 'resolveDID'>;
    ipfs: Pick<KuboClient, 'addPeeringPeer' | 'getPeeringPeers' | 'removePeeringPeer'>;
    getLocalIpfsId(): string | null;
    limits?: Partial<PeerDirectoryLimits>;
    now?: () => number;
}

const DEFAULT_LIMITS: PeerDirectoryLimits = {
    maxQueued: MAX_PEER_DIRECTORY_QUEUE,
    maxConcurrent: MAX_PEER_DIRECTORY_CONCURRENCY,
    maxRecords: MAX_PEER_DIRECTORY_RECORDS,
    maxFailures: MAX_PEER_DIRECTORY_FAILURES,
    maxKuboPeers: MAX_KUBO_PEERING_PEERS,
    retryDelayMs: PEER_DIRECTORY_RETRY_DELAY_MS,
    maxAddresses: MAX_IPFS_PEER_ADDRESSES,
    maxAddressBytes: MAX_IPFS_PEER_ADDRESS_BYTES,
    maxMetadataBytes: MAX_PROTOCOL_STRING_BYTES,
    kuboTimeoutMs: KUBO_PEERING_TIMEOUT_MS,
};

function canonicalDidSuffix(did: string): string | null {
    const separator = did.lastIndexOf(':');
    return separator > 3 && separator < did.length - 1 ? did.slice(separator + 1) : null;
}

function hasBoundedText(value: unknown, maxBytes: number): value is string {
    return typeof value === 'string'
        && value.length > 0
        && Buffer.byteLength(value, 'utf8') <= maxBytes;
}

function validatePeeringPeers(value: unknown): PeeringPeer[] {
    if (!Array.isArray(value) || value.some(peer =>
        !peer || typeof peer !== 'object' || Array.isArray(peer)
        || typeof peer.ID !== 'string' || !peer.ID
        || !Array.isArray(peer.Addrs) || peer.Addrs.some((address: unknown) => typeof address !== 'string')
    )) {
        throw new Error('Invalid Kubo peering configuration');
    }

    return value as PeeringPeer[];
}

export function createPeerDirectory(options: PeerDirectoryOptions) {
    const limits = { ...DEFAULT_LIMITS, ...options.limits };
    const now = options.now ?? Date.now;
    const records = new Map<string, PeerDirectoryRecord>();
    const peerKeys = new Map<string, Set<string>>();
    const peerNames = new Map<string, string>();
    const mediatorPeerIds = new Set<string>();
    const reservedPeerIds = new Set<string>();
    const failed = new Map<string, number>();
    const queuedKeys = new Set<string>();
    const inFlightKeys = new Set<string>();
    const queue: Array<{ key: string; did: string }> = [];
    const activeWorkers = new Set<Promise<void>>();
    const idleWaiters = new Set<() => void>();
    const abortController = new AbortController();
    let baselineReady = false;
    let localDid: string | null = null;
    let localKey: string | null = null;
    let stopping = false;
    let mutationTail = Promise.resolve();
    const metrics = {
        admissionDrops: 0,
        recordEvictions: 0,
        kuboPeerEvictions: 0,
        kuboCapacityRefusals: 0,
        kuboUnknownCapacityRefusals: 0,
        negativeCacheHits: 0,
        negativeCacheEvictions: 0,
    };

    function kuboOptions() {
        return {
            signal: abortController.signal,
            timeoutMs: limits.kuboTimeoutMs,
        };
    }

    function serializeMutation<T>(work: () => Promise<T>): Promise<T> {
        const result = mutationTail.then(work, work);
        mutationTail = result.then(() => undefined, () => undefined);
        return result;
    }

    function notifyIdle(): void {
        if (queue.length > 0 || activeWorkers.size > 0) {
            return;
        }
        for (const resolve of idleWaiters) {
            resolve();
        }
        idleWaiters.clear();
    }

    function rememberFailure(key: string): void {
        failed.delete(key);
        failed.set(key, now() + limits.retryDelayMs);
        while (failed.size > limits.maxFailures) {
            const oldest = failed.keys().next().value as string;
            failed.delete(oldest);
            metrics.negativeCacheEvictions += 1;
        }
    }

    function isRetryDelayed(key: string): boolean {
        const retryAt = failed.get(key);
        if (retryAt === undefined) {
            return false;
        }
        if (retryAt > now()) {
            metrics.negativeCacheHits += 1;
            return true;
        }
        failed.delete(key);
        return false;
    }

    function addRecord(key: string, record: PeerDirectoryRecord): void {
        records.set(key, record);
        let keys = peerKeys.get(record.peerId);
        if (!keys) {
            keys = new Set<string>();
            peerKeys.set(record.peerId, keys);
        }
        keys.add(key);
        if (!peerNames.has(record.peerId)) {
            peerNames.set(record.peerId, record.name);
        }
    }

    function detachRecord(key: string): void {
        const record = records.get(key)!;
        records.delete(key);
        const keys = peerKeys.get(record.peerId);
        keys?.delete(key);
        if (keys?.size === 0) {
            peerKeys.delete(record.peerId);
            peerNames.delete(record.peerId);
        }
    }

    function setPeerStatus(peerId: string, status: PeerStatus): void {
        for (const key of peerKeys.get(peerId) ?? []) {
            records.get(key)!.status = status;
        }
    }

    async function readKuboPeers(): Promise<PeeringPeer[]> {
        const peers = validatePeeringPeers(await options.ipfs.getPeeringPeers(kuboOptions()));
        return peers;
    }

    async function ensureBaseline(): Promise<boolean> {
        if (baselineReady) {
            return true;
        }
        try {
            await readKuboPeers();
            baselineReady = true;
            return true;
        }
        catch (error) {
            if (!stopping) {
                log.error({ error }, 'Unable to read Kubo peering configuration');
            }
            return false;
        }
    }

    function validateNodeInfo(value: unknown): { name: string; id: string; addresses: string[] } | null {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            return null;
        }
        const node = value as NodeInfo;
        if (!hasBoundedText(node.name, limits.maxMetadataBytes)
            || !node.ipfs || typeof node.ipfs !== 'object' || Array.isArray(node.ipfs)
            || !hasBoundedText(node.ipfs.id, limits.maxMetadataBytes)
            || !Array.isArray(node.ipfs.addresses)
            || node.ipfs.addresses.length === 0
            || node.ipfs.addresses.length > limits.maxAddresses
            || node.ipfs.addresses.some((address: unknown) =>
                !hasBoundedText(address, limits.maxAddressBytes)
            )) {
            return null;
        }

        return {
            name: node.name,
            id: node.ipfs.id,
            addresses: [...new Set<string>(node.ipfs.addresses)],
        };
    }

    function provisionalPeersMissingFrom(peers: PeeringPeer[]): number {
        const present = new Set(peers.map(peer => peer.ID));
        let missing = 0;
        for (const peerId of mediatorPeerIds) {
            const keys = peerKeys.get(peerId);
            const provisional = [...(keys ?? [])].some(key => records.get(key)?.status === 'provisional');
            if (provisional && !present.has(peerId)) {
                missing += 1;
            }
        }
        return missing;
    }

    async function removeForEviction(key: string): Promise<boolean> {
        const record = records.get(key)!;
        const references = peerKeys.get(record.peerId);
        if ((references?.size ?? 0) > 1 || record.ownership !== 'mediator') {
            detachRecord(key);
            metrics.recordEvictions += 1;
            return true;
        }

        try {
            await options.ipfs.removePeeringPeer(record.peerId, kuboOptions());
        }
        catch (error) {
            log.warn({ error, peerId: record.peerId }, 'Kubo peering removal returned an error');
        }

        let peers: PeeringPeer[];
        try {
            peers = await readKuboPeers();
        }
        catch (error) {
            log.error({ error, peerId: record.peerId }, 'Unable to confirm Kubo peering removal');
            return false;
        }
        if (peers.some(peer => peer.ID === record.peerId)) {
            return false;
        }

        mediatorPeerIds.delete(record.peerId);
        detachRecord(key);
        metrics.recordEvictions += 1;
        metrics.kuboPeerEvictions += 1;
        return true;
    }

    async function makeRecordRoom(replacementPeerId?: string): Promise<boolean> {
        if (records.size < limits.maxRecords) {
            return true;
        }
        const oldest = records.keys().next().value as string | undefined;
        if (oldest !== undefined && records.get(oldest)?.peerId === replacementPeerId) {
            detachRecord(oldest);
            metrics.recordEvictions += 1;
            return true;
        }
        return oldest !== undefined && removeForEviction(oldest);
    }

    async function confirmProvisional(key: string): Promise<boolean> {
        const record = records.get(key)!;

        const peers = await readKuboPeers();
        if (peers.some(peer => peer.ID === record.peerId)) {
            setPeerStatus(record.peerId, 'confirmed');
            failed.delete(key);
            return true;
        }

        for (const peerKey of [...(peerKeys.get(record.peerId) ?? [])]) {
            const peerRecord = records.get(peerKey);
            if (peerRecord?.status === 'provisional') {
                detachRecord(peerKey);
                rememberFailure(peerKey);
            }
        }
        if (!peerKeys.has(record.peerId)) {
            mediatorPeerIds.delete(record.peerId);
        }
        return false;
    }

    async function admitResolved(
        key: string,
        did: string,
        peer: { name: string; id: string; addresses: string[] },
    ): Promise<boolean> {
        if (!await ensureBaseline()) {
            metrics.kuboUnknownCapacityRefusals += 1;
            return false;
        }

        const existingKeys = peerKeys.get(peer.id);
        if (existingKeys?.size) {
            const existing = records.get(existingKeys.values().next().value as string)!;
            if (!await makeRecordRoom(peer.id)) {
                return false;
            }
            addRecord(key, {
                did,
                peerId: peer.id,
                name: existing.name,
                addresses: existing.addresses,
                ownership: existing.ownership,
                status: existing.status,
            });
            return true;
        }

        const localPeerId = options.getLocalIpfsId();
        if (peer.id === localPeerId) {
            if (!await makeRecordRoom()) {
                return false;
            }
            addRecord(key, {
                did,
                peerId: peer.id,
                name: peer.name,
                addresses: peer.addresses,
                ownership: 'local',
                status: 'confirmed',
            });
            return true;
        }

        let peers: PeeringPeer[];
        try {
            peers = await readKuboPeers();
        }
        catch (error) {
            log.error({ error }, 'Unable to inspect Kubo peering configuration');
            metrics.kuboUnknownCapacityRefusals += 1;
            return false;
        }
        if (peers.some(existing => existing.ID === peer.id)) {
            if (!await makeRecordRoom()) {
                return false;
            }
            addRecord(key, {
                did,
                peerId: peer.id,
                name: peer.name,
                addresses: peer.addresses,
                ownership: mediatorPeerIds.has(peer.id) ? 'mediator' : 'operator',
                status: 'confirmed',
            });
            return true;
        }

        const accountedPeers = peers.length + provisionalPeersMissingFrom(peers) + reservedPeerIds.size;
        if (accountedPeers >= limits.maxKuboPeers) {
            metrics.kuboCapacityRefusals += 1;
            return false;
        }
        if (!await makeRecordRoom()) {
            return false;
        }

        reservedPeerIds.add(peer.id);
        let addError: unknown;
        try {
            await options.ipfs.addPeeringPeer(peer.id, peer.addresses, kuboOptions());
        }
        catch (error) {
            addError = error;
        }

        try {
            peers = await readKuboPeers();
        }
        catch (error) {
            mediatorPeerIds.add(peer.id);
            addRecord(key, {
                did,
                peerId: peer.id,
                name: peer.name,
                addresses: peer.addresses,
                ownership: 'mediator',
                status: 'provisional',
            });
            log.warn({ error, addError, peerId: peer.id }, 'Unable to confirm Kubo peering addition');
            return true;
        }
        finally {
            reservedPeerIds.delete(peer.id);
        }

        if (!peers.some(existing => existing.ID === peer.id)) {
            if (addError) {
                log.warn({ error: addError, peerId: peer.id }, 'Kubo peering addition failed');
            }
            return false;
        }

        mediatorPeerIds.add(peer.id);
        addRecord(key, {
            did,
            peerId: peer.id,
            name: peer.name,
            addresses: peer.addresses,
            ownership: 'mediator',
            status: 'confirmed',
        });
        return true;
    }

    async function processCandidate(key: string, did: string): Promise<void> {
        try {
            const existing = records.get(key);
            if (existing?.status === 'provisional') {
                if (!await serializeMutation(() => confirmProvisional(key))) {
                    rememberFailure(key);
                }
                return;
            }

            const docs = await options.keymaster.resolveDID(did);
            const data = docs.didDocumentData as { node?: unknown } | undefined;
            const peer = validateNodeInfo(data?.node);
            if (!peer) {
                rememberFailure(key);
                return;
            }

            const admitted = await serializeMutation(() => admitResolved(key, did, peer));
            if (!admitted) {
                rememberFailure(key);
                return;
            }

            failed.delete(key);
            log.info(`Added IPFS peer: ${did} ${JSON.stringify(data?.node, null, 4)}`);
        }
        catch (error) {
            if (!stopping) {
                rememberFailure(key);
                log.error({ error }, `Error adding IPFS peer: ${did}`);
            }
        }
    }

    function pump(): void {
        while (!stopping && activeWorkers.size < limits.maxConcurrent && queue.length > 0) {
            const candidate = queue.shift()!;
            queuedKeys.delete(candidate.key);
            inFlightKeys.add(candidate.key);
            const worker = processCandidate(candidate.key, candidate.did).finally(() => {
                inFlightKeys.delete(candidate.key);
                activeWorkers.delete(worker);
                pump();
                notifyIdle();
            });
            activeWorkers.add(worker);
        }
        notifyIdle();
    }

    function addPeers(dids: string[]): void {
        if (!options.enabled || stopping) {
            return;
        }
        for (const did of dids) {
            const key = canonicalDidSuffix(did);
            if (!key || key === localKey || queuedKeys.has(key) || inFlightKeys.has(key)
                || records.get(key)?.status === 'confirmed' || isRetryDelayed(key)) {
                continue;
            }
            if (queue.length >= limits.maxQueued) {
                metrics.admissionDrops += 1;
                continue;
            }
            queue.push({ key, did });
            queuedKeys.add(key);
        }
        pump();
    }

    return {
        getMetrics() {
            return {
                ...metrics,
                queued: queue.length,
                active: activeWorkers.size,
                records: records.size,
                failed: failed.size,
                mediatorKuboPeers: mediatorPeerIds.size,
            };
        },
        async initialize(): Promise<void> {
            if (!options.enabled || stopping) {
                return;
            }
            await serializeMutation(async () => {
                await ensureBaseline();
            });
        },
        addPeers,
        getKnownDids(): string[] {
            const confirmed = [...records.values()]
                .filter(record => record.status === 'confirmed' && canonicalDidSuffix(record.did) !== localKey)
                .map(record => record.did);
            const remoteLimit = localDid ? MAX_ADVERTISED_PEERS - 1 : MAX_ADVERTISED_PEERS;
            const recent = confirmed.slice(-remoteLimit);
            return localDid ? [localDid, ...recent] : recent;
        },
        getPeerName(peerId: string): string | undefined {
            return peerNames.get(peerId);
        },
        registerNode(did: string): void {
            const key = canonicalDidSuffix(did);
            if (!key) {
                throw new Error(`Invalid local node DID: ${did}`);
            }
            localDid = did;
            localKey = key;
        },
        waitForIdle(): Promise<void> {
            if (queue.length === 0 && activeWorkers.size === 0) {
                return Promise.resolve();
            }
            return new Promise(resolve => idleWaiters.add(resolve));
        },
        async shutdown(): Promise<void> {
            if (stopping) {
                await Promise.allSettled([...activeWorkers]);
                await mutationTail;
                return;
            }
            stopping = true;
            queue.length = 0;
            queuedKeys.clear();
            abortController.abort();
            notifyIdle();
            await Promise.allSettled([...activeWorkers]);
            await mutationTail;
        },
    };
}
