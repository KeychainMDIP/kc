import {
    ApplyIndexPageOptions,
    ApplyIndexPageResult,
    BlockId,
    BlockInfo,
    ChallengeReceiptListOptions,
    ChallengeReceiptListResult,
    ChallengeReceiptRecord,
    ChallengeReceiptUsageOptions,
    ChallengeReceiptUsageRecord,
    ChallengeReceiptUsageResult,
    DIDsDb,
    DIDEventHistory,
    DIDEventListOptions,
    DIDEventListResult,
    NetworkMetricSnapshot,
    PublishedCredentialListOptions,
    PublishedCredentialListResult,
    PublishedCredentialRecord,
    PublishedCredentialSchemaCount,
    GatekeeperEvent,
} from "../types.js";
import { copyJSON, getEventDisplayTime, stableStringify } from "./db-utils.js";
import { deduplicateDIDPrefixReferences } from '../published-credentials.js';
import {
    AMBIGUOUS_DID_PREFIX,
    classifyDIDPrefix,
    getDIDPrefix,
    getDIDSuffix,
    isAgentDID,
} from '../did-aliases.js';

type JSONObject = Record<string, unknown>;

export default class DIDsDbMemory implements DIDsDb {
    private docs = new Map<string, JSONObject>();
    private didsBySuffix = new Map<string, string>();
    private authoritativeDIDPrefixes = new Map<string, string>();
    private agentDIDSuffixes = new Set<string>();
    private syncState = new Map<string, string>();
    private events = new Map<string, GatekeeperEvent[]>();
    private blocks = new Map<string, Map<string, BlockInfo>>();
    private publishedCredentials = new Map<string, PublishedCredentialRecord[]>();
    private didPrefixReferences = new Map<string, string[]>();
    private challengeReceipts = new Map<string, ChallengeReceiptRecord[]>();
    private networkMetricSnapshots = new Map<string, NetworkMetricSnapshot>();
    private static readonly ARRAY_WILDCARD_END = /\[\*]$/;
    private static readonly ARRAY_WILDCARD_MID = /\[\*]\./;

    async connect(): Promise<void> {};
    async disconnect(): Promise<void> {};

    async loadSyncState(key: string): Promise<string | null> {
        return this.syncState.get(key) ?? null;
    }

    async saveSyncState(key: string, value: string | null): Promise<void> {
        if (value === null) {
            this.syncState.delete(key);
            return;
        }

        this.syncState.set(key, value);
    }

    async getDIDEvents(did: string): Promise<GatekeeperEvent[]> {
        return copyJSON(this.events.get(did) ?? []);
    }

    async findDIDBySuffix(suffix: string, didPrefix?: string): Promise<string | null> {
        const did = this.didsBySuffix.get(suffix);
        if (!did || !didPrefix) {
            return did ?? null;
        }

        const prefix = this.effectiveDIDPrefix(suffix, this.publishedReferencePrefixes());
        return prefix === didPrefix ? did : null;
    }

    async getBlock(registry: string, blockId?: BlockId): Promise<BlockInfo | null> {
        const registryBlocks = this.blocks.get(registry);

        if (!registryBlocks || registryBlocks.size === 0) {
            return null;
        }

        if (blockId === undefined) {
            const latest = Array.from(registryBlocks.values())
                .sort((a, b) => b.height - a.height)[0];
            return copyJSON(latest);
        }

        if (typeof blockId === 'number') {
            const block = Array.from(registryBlocks.values())
                .find(candidate => candidate.height === blockId);
            return block ? copyJSON(block) : null;
        }

        const block = registryBlocks.get(blockId);
        return block ? copyJSON(block) : null;
    }

    async applyIndexPage(page: ApplyIndexPageOptions): Promise<ApplyIndexPageResult> {
        const result: ApplyIndexPageResult = {
            changedDids: [],
            storedBlocks: 0,
            removedBlocks: 0,
            removedDids: 0,
        };

        for (const { registry, block, removed } of page.blocks) {
            const registryBlocks = this.blocks.get(registry) ?? new Map<string, BlockInfo>();

            if (removed) {
                if (registryBlocks.delete(block.hash)) {
                    result.removedBlocks += 1;
                }
            }
            else {
                registryBlocks.set(block.hash, copyJSON(block));
                result.storedBlocks += 1;
            }

            if (registryBlocks.size > 0) {
                this.blocks.set(registry, registryBlocks);
            }
            else {
                this.blocks.delete(registry);
            }
        }

        for (const record of page.dids) {
            const suffix = getDIDSuffix(record.did);
            const previousDid = this.didsBySuffix.get(suffix);
            if (previousDid && previousDid !== record.did) {
                this.events.delete(previousDid);
                this.docs.delete(previousDid);
                this.publishedCredentials.delete(previousDid);
                this.didPrefixReferences.delete(previousDid);
                this.challengeReceipts.delete(previousDid);
                this.didsBySuffix.delete(suffix);
                this.authoritativeDIDPrefixes.delete(suffix);
                this.agentDIDSuffixes.delete(suffix);
            }

            const oldEvents = this.events.get(record.did) ?? [];
            const changed = stableStringify(oldEvents) !== stableStringify(record.events);

            if (!changed && !record.removed) {
                continue;
            }

            result.changedDids.push(record.did);

            if (record.removed) {
                this.events.delete(record.did);
                this.docs.delete(record.did);
                this.publishedCredentials.delete(record.did);
                this.didPrefixReferences.delete(record.did);
                this.challengeReceipts.delete(record.did);
                if (this.didsBySuffix.get(suffix) === record.did) {
                    this.didsBySuffix.delete(suffix);
                    this.authoritativeDIDPrefixes.delete(suffix);
                    this.agentDIDSuffixes.delete(suffix);
                }
                result.removedDids += 1;
                continue;
            }

            this.didsBySuffix.set(suffix, record.did);
            const classification = classifyDIDPrefix(record.events);
            if (classification.authoritative) {
                this.authoritativeDIDPrefixes.set(suffix, classification.prefix);
            }
            else {
                this.authoritativeDIDPrefixes.delete(suffix);
            }
            if (isAgentDID(record.events)) {
                this.agentDIDSuffixes.add(suffix);
            }
            else {
                this.agentDIDSuffixes.delete(suffix);
            }
            this.events.set(record.did, copyJSON(record.events));

            if (record.doc) {
                this.docs.set(record.did, copyJSON(record.doc) as JSONObject);
            }

            this.publishedCredentials.set(
                record.did,
                copyJSON(record.publishedCredentials ?? [])
            );
            this.didPrefixReferences.set(record.did, deduplicateDIDPrefixReferences(
                record.didPrefixReferences ?? [],
                record.publishedCredentials
            ));
            this.challengeReceipts.set(
                record.did,
                copyJSON(record.challengeReceipts ?? [])
            );
        }

        for (const [key, value] of Object.entries(page.syncStateUpdates ?? {})) {
            await this.saveSyncState(key, value);
        }

        return result;
    }

    async getDID(did: string): Promise<object | null> {
        const v = this.docs.get(did);
        return v ? JSON.parse(JSON.stringify(v)) : null;
    }

    async getPublishedCredentialCountsBySchema(didPrefix?: string): Promise<PublishedCredentialSchemaCount[]> {
        const counts = new Map<string, number>();

        for (const record of this.canonicalPublishedCredentials()
            .filter(record => !didPrefix || getDIDPrefix(record.credentialDid) === didPrefix)
            .filter(record => !didPrefix || getDIDPrefix(record.schemaDid) === didPrefix)) {
            counts.set(record.schemaDid, (counts.get(record.schemaDid) ?? 0) + 1);
        }

        return Array.from(counts.entries())
            .map(([schemaDid, count]) => ({ schemaDid, count }))
            .sort((a, b) => b.count - a.count || a.schemaDid.localeCompare(b.schemaDid));
    }

    async listPublishedCredentials(
        options: PublishedCredentialListOptions = {}
    ): Promise<PublishedCredentialListResult> {
        const {
            didPrefix,
            credentialDid,
            schemaDid,
            issuerDid,
            subjectDid,
            revealed,
            limit = 50,
            offset = 0,
        } = options;

        const filtered = this.canonicalPublishedCredentials()
            .filter(record => !didPrefix || getDIDPrefix(record.credentialDid) === didPrefix)
            .filter(record => !credentialDid || getDIDSuffix(record.credentialDid) === getDIDSuffix(credentialDid))
            .filter(record => !schemaDid || getDIDSuffix(record.schemaDid) === getDIDSuffix(schemaDid))
            .filter(record => !issuerDid || getDIDSuffix(record.issuerDid) === getDIDSuffix(issuerDid))
            .filter(record => !subjectDid || getDIDSuffix(record.subjectDid) === getDIDSuffix(subjectDid))
            .filter(record => typeof revealed !== 'boolean' || record.revealed === revealed)
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.credentialDid.localeCompare(b.credentialDid));

        const normalizedLimit = Math.max(0, limit);
        const normalizedOffset = Math.max(0, offset);

        return {
            total: filtered.length,
            credentials: filtered
                .slice(normalizedOffset, normalizedOffset + normalizedLimit)
                .map(record => ({ ...record })),
        };
    }

    async listChallengeReceipts(
        options: ChallengeReceiptListOptions = {}
    ): Promise<ChallengeReceiptListResult> {
        const {
            limit = 50,
            offset = 0,
        } = options;
        const filtered = this.filterChallengeReceipts(options)
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.receiptDid.localeCompare(b.receiptDid));
        const normalizedLimit = Math.max(0, limit);
        const normalizedOffset = Math.max(0, offset);

        return {
            total: filtered.length,
            receipts: filtered
                .slice(normalizedOffset, normalizedOffset + normalizedLimit)
                .map(record => ({ ...record })),
        };
    }

    async getChallengeReceiptUsage(
        options: ChallengeReceiptUsageOptions = {}
    ): Promise<ChallengeReceiptUsageResult> {
        const {
            limit = 50,
            offset = 0,
        } = options;
        const groups = new Map<string, {
            commitments: Set<string>;
            record: ChallengeReceiptUsageRecord;
        }>();

        for (const record of this.filterChallengeReceipts(options)) {
            const key = [record.attesterDid, record.schemaDid, record.requesterDid]
                .map(getDIDSuffix)
                .join('\u0000');
            const existing = groups.get(key);

            if (!existing) {
                groups.set(key, {
                    commitments: new Set([record.responseCommitment]),
                    record: {
                        attesterDid: record.attesterDid,
                        schemaDid: record.schemaDid,
                        requesterDid: record.requesterDid,
                        count: 1,
                        firstUpdatedAt: record.updatedAt,
                        lastUpdatedAt: record.updatedAt,
                    },
                });
                continue;
            }

            existing.commitments.add(record.responseCommitment);
            if (record.attesterDid < existing.record.attesterDid) {
                existing.record.attesterDid = record.attesterDid;
            }
            if (record.schemaDid < existing.record.schemaDid) {
                existing.record.schemaDid = record.schemaDid;
            }
            if (record.requesterDid < existing.record.requesterDid) {
                existing.record.requesterDid = record.requesterDid;
            }
            existing.record.count = existing.commitments.size;
            if (record.updatedAt < existing.record.firstUpdatedAt) {
                existing.record.firstUpdatedAt = record.updatedAt;
            }
            if (record.updatedAt > existing.record.lastUpdatedAt) {
                existing.record.lastUpdatedAt = record.updatedAt;
            }
        }

        const usage = Array.from(groups.values())
            .map(group => group.record)
            .sort((a, b) =>
                b.count - a.count ||
                a.schemaDid.localeCompare(b.schemaDid) ||
                a.requesterDid.localeCompare(b.requesterDid)
            );
        const normalizedLimit = Math.max(0, limit);
        const normalizedOffset = Math.max(0, offset);

        return {
            total: usage.length,
            usage: usage.slice(normalizedOffset, normalizedOffset + normalizedLimit),
        };
    }

    async listEvents(options: DIDEventListOptions = {}): Promise<DIDEventListResult> {
        const {
            didPrefix,
            registry,
            updatedAfter,
            updatedBefore,
            limit = 50,
            offset = 0,
        } = options;
        const publishedPrefixes = this.publishedReferencePrefixes();
        const filtered = Array.from(this.events.entries())
            .flatMap(([did, events]) =>
                events.map(event => ({
                    did: this.effectiveDID(did, publishedPrefixes),
                    registry: event.registry,
                    time: getEventDisplayTime(event),
                    event: copyJSON(event),
                }))
            )
            .filter(record => !didPrefix || getDIDPrefix(record.did) === didPrefix)
            .filter(record => !registry || record.registry === registry)
            .filter(record => !updatedAfter || record.time > updatedAfter)
            .filter(record => !updatedBefore || record.time < updatedBefore)
            .sort((a, b) => b.time.localeCompare(a.time) || a.did.localeCompare(b.did));
        const normalizedLimit = Math.max(0, limit);
        const normalizedOffset = Math.max(0, offset);

        return {
            total: filtered.length,
            events: filtered.slice(normalizedOffset, normalizedOffset + normalizedLimit),
        };
    }

    async *iterateDIDEventHistories(): AsyncIterable<DIDEventHistory> {
        for (const [did, events] of Array.from(this.events.entries()).sort(([a], [b]) => a.localeCompare(b))) {
            yield { did, events: copyJSON(events) };
        }
    }

    async replaceNetworkMetricSnapshots(snapshots: NetworkMetricSnapshot[]): Promise<void> {
        this.networkMetricSnapshots = new Map(
            snapshots.map(snapshot => [snapshot.date, copyJSON(snapshot)])
        );
    }

    async getNetworkMetricSnapshot(date: string): Promise<NetworkMetricSnapshot | null> {
        const snapshot = this.networkMetricSnapshots.get(date);
        return snapshot ? copyJSON(snapshot) : null;
    }

    async searchDocs(q: string, didPrefix?: string): Promise<string[]> {
        const out: string[] = [];
        const publishedPrefixes = this.publishedReferencePrefixes();
        for (const [did, doc] of this.docs.entries()) {
            const effectiveDid = this.effectiveDID(did, publishedPrefixes);
            if (didPrefix && getDIDPrefix(effectiveDid) !== didPrefix) continue;
            if (JSON.stringify(doc).includes(q)) out.push(effectiveDid);
        }
        return out;
    }

    async queryDocs(where: Record<string, unknown>, didPrefix?: string): Promise<string[]> {
        const entry = Object.entries(where)[0] as [string, any] | undefined;
        if (!entry) {
            return [];
        }
        const [rawPath, cond] = entry;
        if (typeof cond !== 'object' || !Array.isArray(cond.$in)) {
            throw new Error('Only {$in:[…]} supported');
        }
        const list = cond.$in;

        const isKeyWildcard = rawPath.endsWith('.*');
        const isValueWildcard = rawPath.includes('.*.');
        const isArrayTail = DIDsDbMemory.ARRAY_WILDCARD_END.test(rawPath);
        const isArrayMid = DIDsDbMemory.ARRAY_WILDCARD_MID.test(rawPath);

        const result: string[] = [];
        const publishedPrefixes = this.publishedReferencePrefixes();

        for (const [did, doc] of this.docs.entries()) {
            const effectiveDid = this.effectiveDID(did, publishedPrefixes);
            if (didPrefix && getDIDPrefix(effectiveDid) !== didPrefix) {
                continue;
            }
            let match = false;

            if (isArrayTail) {
                const basePath = rawPath.replace(DIDsDbMemory.ARRAY_WILDCARD_END, '');
                const arr = this.getPath(doc, basePath);
                if (Array.isArray(arr)) {
                    match = arr.some(v => list.includes(v));
                }
            } else if (isArrayMid) {
                const [prefix, suffix] = rawPath.split('[*].');
                const arr = this.getPath(doc, prefix);
                if (Array.isArray(arr)) {
                    match = arr.some(el => list.includes(this.getPath(el, suffix)));
                }
            } else if (isKeyWildcard) {
                const basePath = rawPath.slice(0, -2);
                const obj = this.getPath(doc, basePath);
                if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
                    const keys = Object.keys(obj as Record<string, unknown>);
                    match = keys.some(k => list.includes(k));
                }
            } else if (isValueWildcard) {
                const [prefix, suffix] = rawPath.split('.*.');
                const obj = this.getPath(doc, prefix);
                if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
                    const values = Object.values(obj as Record<string, unknown>);
                    match = values.some(v => list.includes(this.getPath(v, suffix)));
                }
            } else {
                const val = this.getPath(doc, rawPath);
                match = list.includes(val);
            }

            if (match) {
                result.push(effectiveDid);
            }
        }

        return result;
    }

    async wipeDb(): Promise<void> {
        this.docs.clear();
        this.didsBySuffix.clear();
        this.authoritativeDIDPrefixes.clear();
        this.agentDIDSuffixes.clear();
        this.syncState.clear();
        this.events.clear();
        this.blocks.clear();
        this.publishedCredentials.clear();
        this.didPrefixReferences.clear();
        this.challengeReceipts.clear();
        this.networkMetricSnapshots.clear();
    }

    private flattenPublishedCredentials(): PublishedCredentialRecord[] {
        return Array.from(this.publishedCredentials.values()).flatMap(records =>
            records.map(record => ({ ...record }))
        );
    }

    private publishedReferencePrefixes(): Map<string, Set<string>> {
        const prefixes = new Map<string, Set<string>>();

        for (const references of this.didPrefixReferences.values()) {
            for (const did of references) {
                const suffix = getDIDSuffix(did);
                const found = prefixes.get(suffix) ?? new Set<string>();
                found.add(getDIDPrefix(did));
                prefixes.set(suffix, found);
            }
        }

        return prefixes;
    }

    private publishedReferencePrefix(suffix: string, prefixes: Map<string, Set<string>>): string {
        const found = prefixes.get(suffix);
        return found?.size === 1
            ? found.values().next().value as string
            : AMBIGUOUS_DID_PREFIX;
    }

    private effectiveDIDPrefix(suffix: string, prefixes: Map<string, Set<string>>): string {
        return this.authoritativeDIDPrefixes.get(suffix)
            ?? (this.agentDIDSuffixes.has(suffix)
                ? AMBIGUOUS_DID_PREFIX
                : this.publishedReferencePrefix(suffix, prefixes));
    }

    private effectiveDID(did: string, prefixes: Map<string, Set<string>>): string {
        const suffix = getDIDSuffix(did);
        return `${this.effectiveDIDPrefix(suffix, prefixes)}:${suffix}`;
    }

    private canonicalPublishedCredentials(): PublishedCredentialRecord[] {
        const credentials = new Map<string, PublishedCredentialRecord>();
        const prefixes = this.publishedReferencePrefixes();

        for (const record of this.flattenPublishedCredentials()) {
            credentials.set(`${record.holderDid}\0${getDIDSuffix(record.credentialDid)}`, {
                ...record,
                credentialDid: this.effectiveDID(record.credentialDid, prefixes),
                schemaDid: this.effectiveDID(record.schemaDid, prefixes),
            });
        }

        return Array.from(credentials.values());
    }

    private flattenChallengeReceipts(): ChallengeReceiptRecord[] {
        return Array.from(this.challengeReceipts.values()).flatMap(records =>
            records.map(record => ({ ...record }))
        );
    }

    private filterChallengeReceipts(
        options: ChallengeReceiptListOptions | ChallengeReceiptUsageOptions
    ): ChallengeReceiptRecord[] {
        const {
            attesterDid,
            schemaDid,
            requesterDid,
            updatedAfter,
            updatedBefore,
        } = options;
        const receiptDid = 'receiptDid' in options ? options.receiptDid : undefined;
        const responseCommitment = 'responseCommitment' in options ? options.responseCommitment : undefined;

        const prefixes = this.publishedReferencePrefixes();

        return this.flattenChallengeReceipts()
            .map(record => ({
                ...record,
                receiptDid: this.effectiveDID(record.receiptDid, prefixes),
            }))
            .filter(record => !options.didPrefix || getDIDPrefix(record.receiptDid) === options.didPrefix)
            .filter(record => !receiptDid || getDIDSuffix(record.receiptDid) === getDIDSuffix(receiptDid))
            .filter(record => !attesterDid || getDIDSuffix(record.attesterDid) === getDIDSuffix(attesterDid))
            .filter(record => !schemaDid || getDIDSuffix(record.schemaDid) === getDIDSuffix(schemaDid))
            .filter(record => !requesterDid || getDIDSuffix(record.requesterDid) === getDIDSuffix(requesterDid))
            .filter(record => !responseCommitment || record.responseCommitment === responseCommitment)
            .filter(record => !updatedAfter || record.updatedAt >= updatedAfter)
            .filter(record => !updatedBefore || record.updatedAt <= updatedBefore);
    }

    private getPath(root: unknown, path: string): unknown {
        if (!path || root == null) {
            return undefined;
        }

        const clean = path.startsWith('$.') ? path.slice(2) : path.startsWith('$') ? path.slice(1) : path;
        if (!clean) {
            return root;
        }

        const parts = clean.split('.');

        let cur: any = root;
        for (const rawPart of parts) {
            if (cur == null) {
                return undefined;
            }

            const idx = Number.isInteger(+rawPart) ? +rawPart : null;

            if (idx !== null && Array.isArray(cur)) {
                cur = cur[idx];
                continue;
            }

            if (typeof cur === 'object') {
                cur = (cur as Record<string, unknown>)[rawPart];
            } else {
                return undefined;
            }
        }
        return cur;
    }
}
