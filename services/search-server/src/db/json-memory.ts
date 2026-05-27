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
    DIDEventListOptions,
    DIDEventListResult,
    PublishedCredentialListOptions,
    PublishedCredentialListResult,
    PublishedCredentialRecord,
    PublishedCredentialSchemaCount,
    GatekeeperEvent,
} from "../types.js";
import { copyJSON, getEventDisplayTime, stableStringify } from "./db-utils.js";

type JSONObject = Record<string, unknown>;

export default class DIDsDbMemory implements DIDsDb {
    private docs = new Map<string, JSONObject>();
    private syncState = new Map<string, string>();
    private events = new Map<string, GatekeeperEvent[]>();
    private blocks = new Map<string, Map<string, BlockInfo>>();
    private publishedCredentials = new Map<string, PublishedCredentialRecord[]>();
    private challengeReceipts = new Map<string, ChallengeReceiptRecord[]>();
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
                this.challengeReceipts.delete(record.did);
                result.removedDids += 1;
                continue;
            }

            this.events.set(record.did, copyJSON(record.events));

            if (record.doc) {
                this.docs.set(record.did, copyJSON(record.doc) as JSONObject);
            }

            this.publishedCredentials.set(
                record.did,
                copyJSON(record.publishedCredentials ?? [])
            );
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

    async getPublishedCredentialCountsBySchema(): Promise<PublishedCredentialSchemaCount[]> {
        const counts = new Map<string, number>();

        for (const record of this.flattenPublishedCredentials()) {
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
            credentialDid,
            schemaDid,
            issuerDid,
            subjectDid,
            revealed,
            limit = 50,
            offset = 0,
        } = options;

        const filtered = this.flattenPublishedCredentials()
            .filter(record => !credentialDid || record.credentialDid === credentialDid)
            .filter(record => !schemaDid || record.schemaDid === schemaDid)
            .filter(record => !issuerDid || record.issuerDid === issuerDid)
            .filter(record => !subjectDid || record.subjectDid === subjectDid)
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
            const key = `${record.attesterDid}\u0000${record.schemaDid}\u0000${record.requesterDid}`;
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
            registry,
            updatedAfter,
            updatedBefore,
            limit = 50,
            offset = 0,
        } = options;
        const filtered = Array.from(this.events.entries())
            .flatMap(([did, events]) =>
                events.map(event => ({
                    did,
                    registry: event.registry,
                    time: getEventDisplayTime(event),
                    event: copyJSON(event),
                }))
            )
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

    async searchDocs(q: string): Promise<string[]> {
        const out: string[] = [];
        for (const [did, doc] of this.docs.entries()) {
            if (JSON.stringify(doc).includes(q)) out.push(did);
        }
        return out;
    }

    async queryDocs(where: Record<string, unknown>): Promise<string[]> {
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

        for (const [did, doc] of this.docs.entries()) {
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
                result.push(did);
            }
        }

        return result;
    }

    async wipeDb(): Promise<void> {
        this.docs.clear();
        this.syncState.clear();
        this.events.clear();
        this.blocks.clear();
        this.publishedCredentials.clear();
        this.challengeReceipts.clear();
    }

    private flattenPublishedCredentials(): PublishedCredentialRecord[] {
        return Array.from(this.publishedCredentials.values()).flatMap(records =>
            records.map(record => ({ ...record }))
        );
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

        return this.flattenChallengeReceipts()
            .filter(record => !receiptDid || record.receiptDid === receiptDid)
            .filter(record => !attesterDid || record.attesterDid === attesterDid)
            .filter(record => !schemaDid || record.schemaDid === schemaDid)
            .filter(record => !requesterDid || record.requesterDid === requesterDid)
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
