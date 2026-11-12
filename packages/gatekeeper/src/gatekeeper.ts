import CipherNode from '@mdip/cipher/node';
import { copyJSON, compareOrdinals } from '@mdip/common/utils';
import { isValidDID, generateCID } from '@mdip/ipfs/utils';
import {
    InvalidParameterError,
    InvalidOperationError
} from '@mdip/common/errors';
import { childLogger, createConsoleLogger, type LoggerLike } from '@mdip/common/logger';
import { IPFSClient } from '@mdip/ipfs/types';
import {
    DIDLifecycle,
    ExpirationContinuation,
    CollectExpiredDIDsOptions,
    CollectExpiredDIDsResult,
    BlockId,
    BlockInfo,
    CheckDIDsOptions,
    GatekeeperDb,
    GatekeeperInterface,
    GatekeeperEvent,
    GatekeeperOptions,
    ImportEventsResult,
    Operation,
    MdipDocument,
    ResolveDIDOptions,
    GetDIDOptions,
    CheckDIDsResult,
    ImportBatchResult,
    ProcessEventsResult,
    VerifyDbResult,
    Signature,
} from './types.js';
import {
    generateDIDFromOperation,
    generateDocFromOperation,
    isValidDIDPrefix,
    resolveDIDFromEvents,
    ValidRegistries,
    ValidTypes,
    ValidVersions,
} from './did-resolver.js';

export {
    generateDIDFromOperation,
    generateDocFromOperation,
    generateOperationCID,
    resolveDIDFromEvents,
} from './did-resolver.js';

import { LIFECYCLE_PAGE_SIZE, lifecycleLimit } from './db/lifecycle.js';

const MAX_HISTORY_CID_CACHE_ENTRIES = 10_000;
const MAX_HISTORY_CID_CACHE_BYTES = 64 * 1024 * 1024;

enum ImportStatus {
    ADDED = 'added',
    MERGED = 'merged',
    REJECTED = 'rejected',
    DEFERRED = 'deferred',
}

class IncompleteDatabaseAuditError extends Error {
    constructor(did: string, reason: string, cause?: unknown) {
        super(`Database audit incomplete for ${did}: ${reason}`, { cause });
        this.name = 'IncompleteDatabaseAuditError';
    }
}

class InvalidDatabaseSignatureError extends Error {
    constructor(readonly did: string) { super(`Invalid stored signature for ${did}`); }
}

export default class Gatekeeper implements GatekeeperInterface {
    private db: GatekeeperDb;
    private eventsQueue: GatekeeperEvent[];
    private deferredEvents = new WeakSet<GatekeeperEvent>();
    private processingEventCount = 0;
    private readonly eventsSeen: Record<string, boolean>;
    private isProcessingEvents: boolean;
    private ipfs?: IPFSClient;
    private cipher: CipherNode;
    readonly didPrefix: string;
    private log: LoggerLike;
    private readonly maxOpBytes: number;
    private readonly maxQueueSize: number;
    private readonly ipfsEnabled: boolean;
    supportedRegistries: string[];
    private didLocks = new Map<string, Promise<void>>();
    private controllerGraphLock: Promise<void> = Promise.resolve();
    private verifyDbInFlight?: Promise<VerifyDbResult>;
    private eventQueueBarrier: Promise<void> = Promise.resolve();
    private eventQueueWork = new Set<Promise<unknown>>();
    private historicalOperationCids = new Map<string, string>();
    private historicalOperationCidBytes = 0;
    private maxHistoryCidCacheEntries = MAX_HISTORY_CID_CACHE_ENTRIES;
    private maxHistoryCidCacheBytes = MAX_HISTORY_CID_CACHE_BYTES;
    constructor(options: GatekeeperOptions) {
        if (!options || !options.db) {
            throw new InvalidParameterError('missing options.db');
        }
        this.db = options.db;

        this.log = options.console
            ? createConsoleLogger(options.console)
            : childLogger({ service: 'gatekeeper' });

        this.eventsQueue = [];
        this.eventsSeen = {};
        this.isProcessingEvents = false;
        this.ipfsEnabled = options.ipfsEnabled ?? true;
        if (this.ipfsEnabled) {
            if (!options.ipfs) {
                throw new InvalidParameterError('missing options.ipfs');
            }
            this.ipfs = options.ipfs;
        }
        this.cipher = new CipherNode();
        this.didPrefix = options.didPrefix || 'did:test';
        this.maxOpBytes = options.maxOpBytes || 64 * 1024; // 64KB
        this.maxQueueSize = options.maxQueueSize || 100;

        // Only DIDs registered on supported registries will be created by this node
        this.supportedRegistries = options.registries || ['local', 'hyperswarm'];

        for (const registry of this.supportedRegistries) {
            if (!ValidRegistries.includes(registry)) {
                throw new InvalidParameterError(`registry=${registry}`);
            }
        }
    }

    private clearEventsSeen(): void {
        for (const key of Object.keys(this.eventsSeen)) {
            delete this.eventsSeen[key];
        }
    }

    private withEventQueueWork<T>(fn: () => Promise<T>): Promise<T> {
        const work = this.eventQueueBarrier.then(fn).finally(() => {
            this.eventQueueWork.delete(work);
        });
        this.eventQueueWork.add(work);
        return work;
    }

    private async assertIndexEpoch(expectedIndexEpoch?: string): Promise<void> {
        if (expectedIndexEpoch !== undefined &&
            expectedIndexEpoch !== (await this.db.getLifecycleMetadata()).epoch) {
            throw Object.assign(new Error('Gatekeeper index epoch changed'), {
                code: 'gatekeeper_index_epoch_changed',
            });
        }
    }

    private didKey(did: string): string {
        return did.split(':').pop() || did;
    }

    private async didMatchesOperation(did: string, operation: Operation): Promise<boolean> {
        const operationDID = operation.type === 'create'
            ? await this.generateDID(operation)
            : operation.did;

        return !!operationDID && this.didKey(did) === this.didKey(operationDID);
    }

    private async withDidLock<T>(did: string, fn: () => Promise<T>): Promise<T> {
        const key = this.didKey(did);
        const prev = this.didLocks.get(key) ?? Promise.resolve();
        let release: () => void = () => { };
        const gate = new Promise<void>(r => (release = r));
        const current = prev.then(() => gate, () => gate);

        this.didLocks.set(key, current);

        try {
            await prev;
            return await fn();
        } finally {
            release();
            if (this.didLocks.get(key) === current) {
                this.didLocks.delete(key);
            }
        }
    }

    // Controller edges span DIDs, so validate and persist graph changes serially.
    private async withControllerGraphLock<T>(fn: () => Promise<T>): Promise<T> {
        const prev = this.controllerGraphLock;
        let release: () => void = () => { };
        const gate = new Promise<void>(r => (release = r));
        const current = prev.then(() => gate, () => gate);

        this.controllerGraphLock = current;

        try {
            await prev;
            return await fn();
        } finally {
            release();
            if (this.controllerGraphLock === current) {
                this.controllerGraphLock = Promise.resolve();
            }
        }
    }

    private maintenanceLock: Promise<void> = Promise.resolve();

    private withMaintenance<T>(fn: () => Promise<T>): Promise<T> {
        const result = this.maintenanceLock.then(fn, fn);
        this.maintenanceLock = result.then(() => undefined, () => undefined);
        return result;
    }

    private withDIDsAndGraph<T>(dids: string[], fn: () => Promise<T>): Promise<T> {
        const keys = [...new Set(dids.map(did => this.didKey(did)))].sort();
        const lock = (index: number): Promise<T> => index < keys.length
            ? this.withDidLock(keys[index], () => lock(index + 1))
            : this.withControllerGraphLock(fn);
        return lock(0);
    }

    private lifecycleDID(row: DIDLifecycle): string {
        return row.did.startsWith('did:') ? row.did : `${this.didPrefix}:${row.suffix}`;
    }

    private async currentExpiration(did: string): Promise<{ doc: MdipDocument; expiresAt?: number }> {
        const doc = await this.resolveDID(did);
        if (doc.didResolutionMetadata?.error) throw new Error(`Cannot resolve expiration candidate ${did}`);
        const time = doc.mdip?.validUntil ? Date.parse(doc.mdip.validUntil) : NaN;
        return { doc, expiresAt: Number.isFinite(time) ? time : undefined };
    }

    async collectExpiredDIDs(options: CollectExpiredDIDsOptions = {}): Promise<CollectExpiredDIDsResult> {
        const limit = lifecycleLimit(options.limit ?? LIFECYCLE_PAGE_SIZE);
        return this.withMaintenance(() => this.collectExpiredDIDsPage(options, limit));
    }

    private async collectExpiredDIDsPage(
        options: CollectExpiredDIDsOptions,
        limit: number,
        onRemoved?: (did: string) => void,
    ): Promise<CollectExpiredDIDsResult> {
        const metadata = await this.db.getLifecycleMetadata();
        const pass: ExpirationContinuation = options.continuation
            ? copyJSON(options.continuation)
            : { epoch: metadata.epoch, cutoff: Date.now(), dueComplete: false, jobsComplete: false, next: 'job' };
        this.validateExpirationPass(pass, metadata.epoch);
        const totals = { examined: 0, expired: 0, deferred: 0 };
        const seen = new Set<string>();
        const removedSuffixes = new Set<string>();
        const removed = (did: string): void => {
            const suffix = this.didKey(did);
            seen.add(suffix);
            if (!removedSuffixes.has(suffix)) {
                removedSuffixes.add(suffix);
                totals.expired += 1;
                onRemoved?.(did);
            }
        };
        try {
            while (totals.examined < limit && (!pass.dueComplete || !pass.jobsComplete)) {
                const jobs = !pass.jobsComplete && (pass.next === 'job' || pass.dueComplete);
                pass.next = jobs ? 'due' : 'job';
                const rows = jobs
                    ? await this.db.getExpirationJobs(1, pass.jobCursor)
                    : await this.db.getDueDIDs(pass.cutoff, 1, pass.dueCursor);
                const row = rows[0];
                if (!row) {
                    if (jobs) pass.jobsComplete = true;
                    else pass.dueComplete = true;
                    continue;
                }
                const previousJobCursor = pass.jobCursor;
                if (jobs) pass.jobCursor = row.suffix;
                else pass.dueCursor = { expiresAt: row.expiresAt!, suffix: row.suffix };
                if (seen.has(row.suffix)) {
                    totals.examined += 1;
                    continue;
                }
                seen.add(row.suffix);
                const before = totals.examined;
                const did = this.lifecycleDID(row);
                try {
                    if (row.type === 'agent') {
                        const resume = await this.collectExpiredAgent(row, pass, limit, jobs, totals, removed);
                        if (resume) {
                            // An unfinished job may sort before the current job-page position.
                            pass.jobCursor = jobs ? previousJobCursor : undefined;
                            pass.jobsComplete = false;
                            break;
                        }
                    } else {
                        totals.examined += 1;
                        const deleted = await this.withDIDsAndGraph([did], async () => {
                            await this.assertExpirationEpoch(pass.epoch);
                            const current = await this.db.getLifecycle(did);
                            if (!current || current.unresolved || current.type === 'agent') return false;
                            const { doc, expiresAt } = await this.currentExpiration(did);
                            if (doc.mdip?.type === 'agent' || expiresAt === undefined || expiresAt >= pass.cutoff) return false;
                            return !!await this.db.deleteEvents(did, { epoch: pass.epoch, revision: current.revision });
                        });
                        if (deleted) removed(did);
                        else totals.deferred += 1;
                    }
                } catch (error) {
                    await this.assertExpirationEpoch(pass.epoch);
                    if (totals.examined === before) totals.examined += 1;
                    totals.deferred += 1;
                    this.log.error({ err: error, did }, 'Expiration candidate deferred');
                }
            }
            await this.assertExpirationEpoch(pass.epoch);
        } catch (error) {
            const failure = new Error('Expiration collection interrupted', { cause: error });
            Object.assign(failure, { progress: { ...totals }, continuation: pass });
            throw failure;
        }
        const hasMore = !pass.dueComplete || !pass.jobsComplete;
        return { ...totals, hasMore, ...(hasMore && { continuation: pass }) };
    }

    private validateExpirationPass(pass: ExpirationContinuation, epoch: string): void {
        if (pass.epoch !== epoch) throw new Error('Expiration pass invalidated by database reset');
        const validInstant = (time: number) => Number.isSafeInteger(time) && Math.abs(time) <= 8_640_000_000_000_000;
        if (!validInstant(pass.cutoff) || pass.cutoff > Date.now() ||
            typeof pass.dueComplete !== 'boolean' || typeof pass.jobsComplete !== 'boolean' ||
            (pass.next !== undefined && pass.next !== 'due' && pass.next !== 'job') ||
            (pass.jobCursor !== undefined && (typeof pass.jobCursor !== 'string' || !pass.jobCursor)) ||
            (pass.dueCursor !== undefined && (!pass.dueCursor || typeof pass.dueCursor !== 'object' ||
                !validInstant(pass.dueCursor.expiresAt) || typeof pass.dueCursor.suffix !== 'string' || !pass.dueCursor.suffix))) {
            throw new InvalidParameterError('expiration continuation');
        }
    }

    private async assertExpirationEpoch(epoch: string): Promise<void> {
        if ((await this.db.getLifecycleMetadata()).epoch !== epoch) {
            throw new Error('Expiration pass invalidated by database reset');
        }
    }

    private async collectExpiredAgent(
        row: DIDLifecycle,
        pass: ExpirationContinuation,
        limit: number,
        resumed: boolean,
        totals: { examined: number; expired: number; deferred: number },
        removed: (did: string) => void,
    ): Promise<boolean> {
        const did = this.lifecycleDID(row);
        const selectedJob = await this.db.getExpirationJob(row.suffix);
        const rootCost = resumed ? 0 : 1;
        const capacity = limit - totals.examined - rootCost;
        const children = capacity > 0
            ? await this.db.getControlledDIDs(row.suffix, capacity, selectedJob?.dependentCursor)
            : [];
        return this.withDIDsAndGraph([did, ...children.map(child => this.lifecycleDID(child))], async () => {
            await this.assertExpirationEpoch(pass.epoch);
            totals.examined += rootCost;
            const saved = await this.db.getExpirationJob(row.suffix);
            const current = await this.db.getLifecycle(did);
            const events = await this.db.getEvents(did);
            let job = saved ?? { ...row };
            if (events.length > 0) {
                const agent = await this.currentExpiration(did);
                if (!current || current.unresolved || agent.doc.mdip?.type !== 'agent' ||
                    agent.expiresAt === undefined || agent.expiresAt >= pass.cutoff) {
                    await this.db.saveExpirationJob(row.suffix, null);
                    if (!rootCost) totals.examined += 1;
                    totals.deferred += 1;
                    return false;
                }
                if ((selectedJob?.dependentCursor !== saved?.dependentCursor) ||
                    (saved && saved.expiresAt !== agent.expiresAt)) {
                    // Reselect the page under its canonical locks after lifecycle changes.
                    job = { ...current };
                    await this.db.saveExpirationJob(row.suffix, job);
                    if (!rootCost) totals.examined += 1;
                    return true;
                }
                job = { ...job, ...current };
            } else if (!saved || saved.expiresAt === undefined || saved.expiresAt >= pass.cutoff) {
                if (!rootCost) totals.examined += 1;
                totals.deferred += 1;
                return false;
            }
            if (await this.db.hasUnresolvedLifecycle()) {
                if (!rootCost) totals.examined += 1;
                totals.deferred += 1;
                return false;
            }
            await this.db.saveExpirationJob(row.suffix, job);
            for (const child of children) {
                totals.examined += 1;
                const childDID = this.lifecycleDID(child);
                try {
                    const currentChild = await this.db.getLifecycle(childDID);
                    const childDoc = await this.resolveDID(childDID);
                    if (childDoc.didResolutionMetadata?.error === 'notFound') {
                        job.dependentCursor = child.suffix;
                        continue;
                    }
                    if (childDoc.didResolutionMetadata?.error || !currentChild) {
                        throw new Error(`Cannot revalidate controlled asset ${childDID}`);
                    }
                    if (childDoc.mdip?.type === 'asset' && childDoc.didDocument?.controller &&
                        this.didKey(childDoc.didDocument.controller) === row.suffix) {
                        if (await this.db.deleteEvents(childDID, { epoch: pass.epoch, revision: currentChild.revision })) removed(childDID);
                        else totals.deferred += 1;
                    }
                } catch (error) {
                    totals.deferred += 1;
                    this.log.error({ err: error, did: childDID }, 'Controlled expiration candidate deferred');
                }
                job.dependentCursor = child.suffix;
            }
            await this.db.saveExpirationJob(row.suffix, job);
            const remaining = await this.db.getControlledDIDs(row.suffix, 1);
            if (!remaining.length) {
                if (!rootCost && totals.examined === limit) return true;
                if (!rootCost) totals.examined += 1;
                if (current && events.length > 0) {
                    if (!await this.db.deleteEvents(did, { epoch: pass.epoch, revision: current.revision })) {
                        totals.deferred += 1;
                        return false;
                    }
                    removed(did);
                }
                await this.db.saveExpirationJob(row.suffix, null);
                return false;
            }
            const after = await this.db.getControlledDIDs(row.suffix, 1, job.dependentCursor);
            if (after.length > 0) return true;
            // Earlier failures and arrivals are retried in the next pass, not a busy loop.
            delete job.dependentCursor;
            await this.db.saveExpirationJob(row.suffix, job);
            if (!rootCost && children.length === 0) totals.examined += 1;
            return false;
        });
    }

    verifyDb(options?: { chatty?: boolean }): Promise<VerifyDbResult> {
        this.verifyDbInFlight ??= this.withMaintenance(() => this.runVerifyDb(options)).finally(() => {
            this.verifyDbInFlight = undefined;
        });
        return this.verifyDbInFlight;
    }

    private async auditHistory(
        did: string, history: GatekeeperEvent[], ancestors = new Set<string>(), options: ResolveDIDOptions = {},
    ): Promise<MdipDocument> {
        const key = this.didKey(did);
        if (!history.length || ancestors.has(key)) throw new IncompleteDatabaseAuditError(did, 'missing or cyclic controller history');
        const visiting = new Set(ancestors).add(key);
        const captured = copyJSON(history);
        if (captured[0].operation.type !== 'create' || captured.slice(1).some(event => event.operation.type === 'create')) {
            throw new IncompleteDatabaseAuditError(did, 'history must contain exactly one initial create');
        }
        const metadataIssues = new WeakSet<Operation>();
        let usedMetadataIssue = false;
        for (const event of captured) {
            const cid = await this.generateCID(event.operation);
            if (event.opid && event.opid !== cid) metadataIssues.add(event.operation);
            if (event.did && this.didKey(event.did) !== key) metadataIssues.add(event.operation);
            event.opid = cid;
            if (event.operation.type !== 'create' && (!event.operation.did || this.didKey(event.operation.did) !== key)) metadataIssues.add(event.operation);
        }
        try {
            if (!(await this.didMatchesOperation(did, captured[0].operation))) metadataIssues.add(captured[0].operation);
        } catch (error) {
            throw new IncompleteDatabaseAuditError(did, 'unsupported create identity', error);
        }
        const trustedController = async (controller: string, signed: string): Promise<MdipDocument> => {
            const events = await this.db.getEvents(controller);
            const confirmed = await this.auditHistory(controller, events, visiting, { confirm: true, versionTime: signed });
            const doc = confirmed.didResolutionMetadata?.error === 'notFound'
                ? await this.auditHistory(controller, events, visiting, { versionSequence: 1, versionTime: signed })
                : confirmed;
            if (!doc.didDocument || doc.didResolutionMetadata?.error) {
                throw new IncompleteDatabaseAuditError(did, `unavailable controller ${controller}`);
            }
            return doc;
        };
        const signingKey = async (doc: MdipDocument, signed: string, seen: Set<string>): Promise<NonNullable<Operation['publicJwk']>> => {
            const controller = doc.didDocument?.controller;
            if (controller) {
                const suffix = this.didKey(controller);
                if (seen.has(suffix)) throw new IncompleteDatabaseAuditError(did, 'cyclic signing dependency');
                seen.add(suffix);
                return signingKey(await trustedController(controller, signed), signed, seen);
            }
            const jwk = doc.didDocument?.verificationMethod?.[0]?.publicKeyJwk;
            if (!jwk) throw new IncompleteDatabaseAuditError(did, 'unavailable signing key');
            return jwk;
        };
        const verify = async (operation: Operation, doc?: MdipDocument): Promise<boolean> => {
            if (metadataIssues.has(operation)) usedMetadataIssue = true;
            const signature = operation.signature;
            if (!signature || !this.verifySignatureFormat(signature)) throw new IncompleteDatabaseAuditError(did, 'unsupported signature structure');
            const jwk = operation.type === 'create' && operation.mdip?.type === 'agent'
                ? operation.publicJwk
                : operation.type === 'create'
                    ? await signingKey(await trustedController(operation.controller ?? '', signature.signed), signature.signed, new Set())
                    : await signingKey(doc!, signature.signed, new Set());
            if (!jwk || jwk.kty !== 'EC' || jwk.crv !== 'secp256k1') {
                throw new IncompleteDatabaseAuditError(did, 'unsupported signing key');
            }
            const unsigned = copyJSON(operation);
            delete unsigned.signature;
            const hash = this.cipher.hashJSON(unsigned);
            let valid: boolean;
            try {
                valid = this.cipher.verifySig(hash, signature.value, jwk);
            } catch (error) {
                throw new IncompleteDatabaseAuditError(did, 'unsupported cryptographic input', error);
            }
            if (!valid) throw new InvalidDatabaseSignatureError(did);
            // A newer admission policy is not evidence that a historical signature was forged.
            try {
                const supported = operation.type === 'create'
                    ? await this.verifyCreateOperation(operation)
                    : await this.verifyUpdateOperation(operation, doc!);
                if (!supported || signature.hash !== hash) throw new Error('unsupported historical operation');
            } catch (error) {
                throw new IncompleteDatabaseAuditError(did, 'historical admission policy or dependency', error);
            }
            return true;
        };
        let doc: MdipDocument;
        try {
            doc = await resolveDIDFromEvents({
                did, events: captured, options: { ...options, verify: true }, didPrefix: this.didPrefix,
                verifyCreateOperation: operation => verify(operation),
                verifyUpdateOperation: (operation, previous) => verify(operation, previous),
            });
        } catch (error) {
            if (error instanceof InvalidDatabaseSignatureError || error instanceof IncompleteDatabaseAuditError) throw error;
            throw new IncompleteDatabaseAuditError(did, 'history cannot be verified', error);
        }
        if (usedMetadataIssue || (doc.didResolutionMetadata?.error && doc.didResolutionMetadata.error !== 'notFound') || !doc.didDocument) {
            throw new IncompleteDatabaseAuditError(did, 'history identity or version metadata mismatch');
        }
        return doc;
    }

    private async runVerifyDb(options?: { chatty?: boolean }): Promise<VerifyDbResult> {
        const epoch = (await this.db.getLifecycleMetadata()).epoch;
        const cutoff = Date.now();
        const dids = await this.getDIDs() as string[];
        const snapshot = new Set(dids.map(did => this.didKey(did)));
        const verified = new Set<string>();
        const invalid = new Set<string>();
        let examined = 0;
        for (const did of dids) {
            await this.withDIDsAndGraph([did], async () => {
                await this.assertExpirationEpoch(epoch);
                try {
                    const history = await this.db.getEvents(did);
                    const doc = await this.auditHistory(did, history);
                    if (doc.didResolutionMetadata?.error) throw new IncompleteDatabaseAuditError(did, 'history not found');
                    verified.add(this.didKey(did));
                } catch (error) {
                    if (error instanceof InvalidDatabaseSignatureError && this.didKey(error.did) === this.didKey(did)) {
                        await this.removeDIDUnlocked(did);
                        invalid.add(this.didKey(did));
                    } else {
                        throw error instanceof IncompleteDatabaseAuditError ? error
                            : new IncompleteDatabaseAuditError(did, 'verification dependency failed', error);
                    }
                }
            });
            if (++examined % LIFECYCLE_PAGE_SIZE === 0) await new Promise<void>(resolve => setImmediate(resolve));
        }
        // Audit signatures before expiry repair removes controller keys needed by those histories.
        const expired = new Set<string>();
        let continuation: ExpirationContinuation | undefined = {
            epoch, cutoff, dueComplete: false, jobsComplete: false, next: 'job',
        };
        for (let pages = 0; pages < 50; pages += 1) {
            const page = await this.collectExpiredDIDsPage({ continuation }, LIFECYCLE_PAGE_SIZE, did => {
                const key = this.didKey(did);
                if (snapshot.has(key) && !invalid.has(key)) expired.add(key);
            });
            continuation = page.continuation;
            if (!continuation) break;
            await new Promise<void>(resolve => setImmediate(resolve));
        }
        await this.assertExpirationEpoch(epoch);
        // A missing snapshot DID without a successful repair is not a verified retained record.
        for (const did of dids) {
            if (verified.has(this.didKey(did)) && !expired.has(this.didKey(did)) && !(await this.db.getEvents(did)).length) {
                throw new IncompleteDatabaseAuditError(did, 'history removed concurrently');
            }
        }
        await this.assertExpirationEpoch(epoch);
        const result = { total: snapshot.size, verified: verified.size - expired.size, expired: expired.size, invalid: invalid.size };
        if (options?.chatty ?? true) this.log.info(result, 'Database integrity audit complete');
        return result;
    }

    async checkDIDs(options?: CheckDIDsOptions): Promise<CheckDIDsResult> {
        const chatty = options?.chatty ?? false;
        let dids = options?.dids;

        if (!dids) {
            dids = await this.getDIDs() as string[];
        }

        const total = dids.length;
        let n = 0;
        let agents = 0;
        let assets = 0;
        let confirmed = 0;
        let unconfirmed = 0;
        let ephemeral = 0;
        let invalid = 0;
        const byRegistry: Record<string, number> = {}
        const byVersion: Record<number, number> = {}

        for (const did of dids) {
            n += 1;
            try {
                const doc = await this.resolveDID(did);

                if (doc.didResolutionMetadata?.error) {
                    invalid += 1;
                    if (chatty) {
                        this.log.warn(`can't resolve ${n}/${total} ${did} ${doc.didResolutionMetadata.error}`);
                    }
                    continue;
                }

                if (chatty) {
                    this.log.debug(`resolved ${n}/${total} ${did} OK`);
                }

                if (doc.mdip?.type === 'agent') {
                    agents += 1;
                }

                if (doc.mdip?.type === 'asset') {
                    assets += 1;
                }

                if (doc.didDocumentMetadata?.confirmed) {
                    confirmed += 1;
                }
                else {
                    unconfirmed += 1;
                }

                if (doc.mdip?.validUntil) {
                    ephemeral += 1;
                }

                const registry = doc.mdip?.registry;
                if (registry) {
                    byRegistry[registry] = (byRegistry[registry] || 0) + 1;
                }

                const version = doc.didDocumentMetadata?.version;
                if (version != null) {
                    const versionNum = parseInt(version, 10);
                    if (!isNaN(versionNum)) {
                        byVersion[versionNum] = (byVersion[versionNum] || 0) + 1;
                    }
                }
            }
            catch {
            }
        }

        const byType = { agents, assets, confirmed, unconfirmed, ephemeral, invalid };
        const eventsQueue = this.eventsQueue;
        return { total, byType, byRegistry, byVersion, eventsQueue };
    }

    getQueueStatus() {
        let pending = 0;
        for (const event of this.eventsQueue) {
            if (this.deferredEvents.has(event)) pending += 1;
        }
        return {
            staged: this.eventsQueue.length - pending,
            pending,
            processing: this.processingEventCount,
            total: this.eventsQueue.length + this.processingEventCount,
            active: this.isProcessingEvents || this.processingEventCount > 0,
        };
    }

    async listRegistries(): Promise<string[]> {
        return this.supportedRegistries;
    }

    // For testing purposes
    async resetDb(): Promise<boolean> {
        // Finish admitted work before reset and hold new requests behind it.
        const reset = Promise.allSettled([this.eventQueueBarrier, ...this.eventQueueWork])
            .then(() => this.withControllerGraphLock(async () => {
                await this.db.resetDb();
                this.historicalOperationCids.clear();
                this.historicalOperationCidBytes = 0;
                await this.db.initializeLifecycleIndex();
                this.clearEventsSeen();
                this.eventsQueue = [];
                this.deferredEvents = new WeakSet();
                return true;
            }));
        this.eventQueueBarrier = reset.then(() => {}, () => {});
        return reset;
    }

    async generateCID(operation: unknown): Promise<string> {
        const canonical = this.cipher.canonicalizeJSON(operation);
        return generateCID(JSON.parse(canonical));
    }

    private async historicalOperationCID(operation: Operation): Promise<string> {
        // Key by contents, never by an unverified stored opid or mutable object identity.
        const contents = JSON.stringify(operation);
        const cached = this.historicalOperationCids.get(contents);
        if (cached !== undefined) {
            this.historicalOperationCids.delete(contents);
            this.historicalOperationCids.set(contents, cached);
            return cached;
        }

        const cid = await this.generateCID(operation);
        const bytes = 2 * (contents.length + cid.length);
        if (bytes <= this.maxHistoryCidCacheBytes) {
            while (this.historicalOperationCids.size >= this.maxHistoryCidCacheEntries
                || this.historicalOperationCidBytes + bytes > this.maxHistoryCidCacheBytes) {
                const [oldContents, oldCid] = this.historicalOperationCids.entries().next().value!;
                this.historicalOperationCids.delete(oldContents);
                this.historicalOperationCidBytes -= 2 * (oldContents.length + oldCid.length);
            }
            this.historicalOperationCids.set(contents, cid);
            this.historicalOperationCidBytes += bytes;
        }
        return cid;
    }

    async generateDID(operation: Operation): Promise<string> {
        return generateDIDFromOperation(operation, {
            didPrefix: this.didPrefix,
            generateCID: (operation) => this.generateCID(operation),
        });
    }

    async verifyOperation(operation: Operation): Promise<boolean> {
        return this.verifyOperationWithHistory(operation);
    }

    private async verifyOperationWithHistory(operation: Operation, events?: GatekeeperEvent[]): Promise<boolean> {
        if (operation.type === 'create') {
            const valid = await this.verifyCreateOperation(operation);
            return valid && !(await this.operationIntroducesControllerCycle(operation));
        }

        if (operation.type === 'update' || operation.type === 'delete') {
            const doc = events === undefined
                ? await this.resolveDID(operation.did)
                : await this.resolveHistory(operation.did, copyJSON(events));
            const valid = await this.verifyUpdateOperation(operation, doc);
            return valid && !(await this.operationIntroducesControllerCycle(operation));
        }

        return false;
    }

    verifyDIDFormat(did: string): boolean {
        return did.startsWith('did:');
    }

    verifyDateFormat(time?: string): boolean {
        if (!time) {
            return false;
        }
        const date = new Date(time);
        return !isNaN(date.getTime());
    }

    verifyHashFormat(hash: string): boolean {
        // Check if hash is a hexadecimal string of length 64
        const hex64Regex = /^[a-f0-9]{64}$/i;
        return hex64Regex.test(hash);
    }

    verifySignatureFormat(signature?: Signature): boolean {
        if (!signature) {
            return false;
        }

        if (!this.verifyDateFormat(signature.signed)) {
            return false;
        }

        if (!this.verifyHashFormat(signature.hash)) {
            return false;
        }

        // eslint-disable-next-line
        if (signature.signer && !this.verifyDIDFormat(signature.signer)) {
            return false;
        }

        return true;
    }

    private verifySignature(msgHash: string, value: string, publicJwk: NonNullable<Operation['publicJwk']>): boolean {
        try {
            return this.cipher.verifySig(msgHash, value, publicJwk);
        }
        catch {
            return false;
        }
    }

    private getVerifiedOperationHash(operation: Operation): string | null {
        const operationCopy = copyJSON(operation);
        delete operationCopy.signature;
        const msgHash = this.cipher.hashJSON(operationCopy);
        return operation.signature?.hash === msgHash ? msgHash : null;
    }

    private operationExceedsMaxBytes(operation: Operation): boolean {
        return Buffer.byteLength(JSON.stringify(operation), 'utf8') > this.maxOpBytes;
    }

    private async resolveControllerForVerification(did: string, versionTime: string): Promise<MdipDocument> {
        const confirmed = await this.resolveDID(did, { confirm: true, versionTime });
        // The immutable create key remains usable locally while registry confirmation is pending.
        return confirmed.didResolutionMetadata?.error === 'notFound'
            ? this.resolveDID(did, { versionSequence: 1, versionTime })
            : confirmed;
    }

    async verifyCreateOperation(operation: Operation): Promise<boolean> {
        if (!operation) {
            throw new InvalidOperationError('missing');
        }

        if (this.operationExceedsMaxBytes(operation)) {
            throw new InvalidOperationError('size');
        }

        if (operation.type !== "create") {
            throw new InvalidOperationError(`type=${operation.type}`);
        }

        if (!this.verifyDateFormat(operation.created)) {
            // TBD ensure valid timestamp format
            throw new InvalidOperationError(`created=${operation.created}`);
        }

        if (!operation.mdip) {
            throw new InvalidOperationError('mdip');
        }

        if (!ValidVersions.includes(operation.mdip.version)) {
            throw new InvalidOperationError(`mdip.version=${operation.mdip.version}`);
        }

        if (!ValidTypes.includes(operation.mdip.type)) {
            throw new InvalidOperationError(`mdip.type=${operation.mdip.type}`);
        }

        if (!ValidRegistries.includes(operation.mdip.registry)) {
            throw new InvalidOperationError(`mdip.registry=${operation.mdip.registry}`);
        }

        if (operation.mdip.prefix !== undefined && !isValidDIDPrefix(operation.mdip.prefix)) {
            throw new InvalidOperationError(`mdip.prefix=${operation.mdip.prefix}`);
        }

        if (!this.verifySignatureFormat(operation.signature)) {
            throw new InvalidOperationError('signature');
        }

        if (operation.mdip.validUntil && !this.verifyDateFormat(operation.mdip.validUntil)) {
            throw new InvalidOperationError(`mdip.validUntil=${operation.mdip.validUntil}`);
        }

        if (operation.mdip.type === 'agent') {
            if (!operation.publicJwk) {
                throw new InvalidOperationError('publicJwk');
            }

            const msgHash = this.getVerifiedOperationHash(operation);
            if (!msgHash) {
                return false;
            }
            return this.verifySignature(msgHash, operation.signature!.value, operation.publicJwk);
        }

        if (operation.mdip.type === 'asset') {
            const controllerDid = operation.signature?.signer;
            if (!controllerDid) {
                throw new InvalidOperationError('signature.signer');
            }

            if (operation.controller !== controllerDid) {
                throw new InvalidOperationError('signer is not controller');
            }

            const doc = await this.resolveControllerForVerification(
                controllerDid,
                operation.signature!.signed
            );

            if (doc.mdip && doc.mdip.registry === 'local' && operation.mdip.registry !== 'local') {
                throw new InvalidOperationError(`non-local registry=${operation.mdip.registry}`);
            }

            const msgHash = this.getVerifiedOperationHash(operation);
            if (!msgHash) {
                return false;
            }
            if (!doc.didDocument ||
                !doc.didDocument.verificationMethod ||
                doc.didDocument.verificationMethod.length === 0 ||
                !doc.didDocument.verificationMethod[0].publicKeyJwk) {
                throw new InvalidOperationError('didDocument missing verificationMethod');
            }
            // TBD select the right key here, not just the first one
            const publicJwk = doc.didDocument.verificationMethod[0].publicKeyJwk;
            return this.verifySignature(msgHash, operation.signature!.value, publicJwk);
        }

        throw new InvalidOperationError(`mdip.type=${operation.mdip.type}`);
    }

    private async controllerChainHasCycle(
        did: string,
        visited: Set<string>
    ): Promise<boolean> {
        const key = this.didKey(did);
        if (visited.has(key)) {
            return true;
        }
        visited.add(key);

        const doc = await this.resolveDID(did);
        const controller = doc.didDocument?.controller;
        return controller
            ? this.controllerChainHasCycle(controller, visited)
            : false;
    }

    private async operationIntroducesControllerCycle(operation: Operation): Promise<boolean> {
        const did = operation.type === 'create'
            ? await this.generateDID(operation)
            : operation.did;
        const nextController = operation.type === 'create' && operation.mdip?.type === 'asset'
            ? operation.controller
            : operation.type === 'update'
                ? operation.doc?.didDocument?.controller
                : undefined;
        if (!did || !nextController) {
            return false;
        }

        // Check whether the proposed controller chain would introduce a cycle.
        const visited = new Set([this.didKey(did)]);
        return this.controllerChainHasCycle(nextController, visited);
    }

    private async verifyUpdateOperationSignature(
        operation: Operation,
        doc: MdipDocument,
        visited: Set<string>,
        did?: string
    ): Promise<boolean> {
        if (this.operationExceedsMaxBytes(operation)) {
            throw new InvalidOperationError('size');
        }

        if (!this.verifySignatureFormat(operation.signature)) {
            throw new InvalidOperationError('signature');
        }

        if (!doc?.didDocument) {
            throw new InvalidOperationError('doc.didDocument');
        }

        if (doc.didDocumentMetadata?.deactivated) {
            throw new InvalidOperationError('DID deactivated');
        }

        const currentDid = did ?? doc.didDocument.id;
        if (currentDid) {
            const key = this.didKey(currentDid);
            if (visited.has(key)) {
                return false;
            }
            visited.add(key);
        }

        if (doc.didDocument.controller) {
            // This DID is an asset, verify with controller's keys
            const controllerDoc = await this.resolveControllerForVerification(
                doc.didDocument.controller,
                operation.signature!.signed
            );
            return this.verifyUpdateOperationSignature(
                operation,
                controllerDoc,
                visited,
                doc.didDocument.controller
            );
        }

        if (!doc.didDocument.verificationMethod) {
            throw new InvalidOperationError('doc.didDocument.verificationMethod');
        }

        const signature = operation.signature!;
        const jsonCopy = copyJSON(operation);
        delete jsonCopy.signature;
        const msgHash = this.cipher.hashJSON(jsonCopy);

        if (signature.hash && signature.hash !== msgHash) {
            return false;
        }

        if (doc.didDocument.verificationMethod.length === 0 ||
            !doc.didDocument.verificationMethod[0].publicKeyJwk) {
            throw new InvalidOperationError('didDocument missing verificationMethod');
        }

        // TBD get the right signature, not just the first one
        const publicJwk = doc.didDocument.verificationMethod[0].publicKeyJwk;
        return this.verifySignature(msgHash, signature.value, publicJwk);
    }

    private verifyUpdateOperationStructure(operation: Operation, doc: MdipDocument): boolean {
        if ((operation.type !== 'update' && operation.type !== 'delete') || !operation.did || !doc.mdip) {
            return false;
        }

        const currentDid = doc.didDocument?.id;
        if (currentDid && this.didKey(currentDid) !== this.didKey(operation.did)) {
            return false;
        }

        if (operation.type === 'delete') {
            return true;
        }

        const replacement = operation.doc;
        if (!replacement || typeof replacement !== 'object' || Array.isArray(replacement) ||
            !replacement.didDocument || typeof replacement.didDocument !== 'object' ||
            Array.isArray(replacement.didDocument) ||
            !replacement.mdip || typeof replacement.mdip !== 'object' || Array.isArray(replacement.mdip) ||
            !ValidVersions.includes(replacement.mdip.version) ||
            !Object.hasOwn(replacement, 'didDocumentData') || replacement.didDocumentData === undefined) {
            return false;
        }

        const replacementDid = replacement.didDocument.id;
        return typeof replacementDid === 'string' &&
            isValidDID(replacementDid) &&
            this.didKey(replacementDid) === this.didKey(operation.did) &&
            replacement.mdip.type === doc.mdip.type &&
            replacement.mdip.registry === doc.mdip.registry;
    }

    async verifyUpdateOperation(operation: Operation, doc: MdipDocument): Promise<boolean> {
        if (!doc?.didDocument || doc.didResolutionMetadata?.error) {
            throw new InvalidOperationError('doc.didDocument');
        }

        if (!this.verifyUpdateOperationStructure(operation, doc)) {
            return false;
        }

        // Verify authorization against the existing controller chain.
        return this.verifyUpdateOperationSignature(
            operation,
            doc,
            new Set(),
            doc.didDocument?.id ?? operation.did
        );
    }

    private publicationRegistries(registry: string): string[] {
        if (registry === 'local') {
            return [];
        }
        return registry === 'hyperswarm'
            ? ['hyperswarm']
            : ['hyperswarm', registry];
    }

    private async checkQueueCapacity(registry: string, queueSize?: number): Promise<void> {
        if (registry === 'local' || registry === 'hyperswarm') {
            return;
        }
        const size = queueSize ?? (await this.db.getQueue(registry)).length;
        if (size >= this.maxQueueSize) {
            this.supportedRegistries = this.supportedRegistries.filter(reg => reg !== registry);
        }
    }

    async queueOperation(registry: string, operation: Operation) {
        for (const target of this.publicationRegistries(registry)) {
            const queueSize = await this.db.queueOperation(target, operation);
            if (target === registry) {
                await this.checkQueueCapacity(registry, queueSize);
            }
        }
    }

    async createDID(operation: Operation): Promise<string> {
        if (!operation) throw new InvalidOperationError('missing');
        if (this.operationExceedsMaxBytes(operation)) throw new InvalidOperationError('size');
        operation = copyJSON(operation);
        const did = await this.generateDID(operation);

        return this.withDidLock(did, () => this.withControllerGraphLock(async () => {
            const valid = await this.verifyCreateOperation(operation);
            if (!valid) {
                throw new InvalidOperationError('signature')
            }

            const registry = operation.mdip!.registry;

            // Reject operations with unsupported registries
            if (!registry || !this.supportedRegistries.includes(registry)) {
                throw new InvalidOperationError(`registry ${registry} not supported`);
            }
            const ops = await this.exportDID(did);

            // Check to see if we already have this DID in the db
            if (ops.length > 0) {
                return did;
            }

            if (await this.operationIntroducesControllerCycle(operation)) {
                throw new InvalidOperationError('controller cycle');
            }

            await this.db.addEventAndQueue(did, {
                registry: 'local',
                time: operation.created!,
                ordinal: [0],
                operation,
                did
            }, this.publicationRegistries(registry));
            await this.checkQueueCapacity(registry);
            return did;
        }));
    }

    async generateDoc(anchor: Operation, defaultDID?: string): Promise<MdipDocument> {
        return generateDocFromOperation(anchor, {
            defaultDID,
            didPrefix: this.didPrefix,
            generateDID: (operation) => this.generateDID(operation),
        });
    }

    async resolveDID(
        did?: string,
        options?: ResolveDIDOptions
    ): Promise<MdipDocument> {
        const events = did && isValidDID(did)
            ? await this.db.getEvents(did)
            : [];

        return this.resolveHistory(did, events, options);
    }

    private async resolveHistory(
        did: string | undefined,
        events: GatekeeperEvent[],
        options?: ResolveDIDOptions,
    ): Promise<MdipDocument> {
        return resolveDIDFromEvents({
            did,
            events,
            options,
            didPrefix: this.didPrefix,
            generateCID: (operation) => this.generateCID(operation),
            generateDID: (operation) => this.generateDID(operation),
            getBlock: (registry, block) => this.db.getBlock(registry, block),
            verifyCreateOperation: (operation) => this.verifyCreateOperation(operation),
            verifyUpdateOperation: (operation, doc) => this.verifyUpdateOperation(operation, doc),
        });
    }

    async updateDID(operation: Operation): Promise<boolean> {
        if (!operation.did) {
            throw new InvalidOperationError('missing operation.did')
        }

        return this.withDidLock(operation.did, () => this.withControllerGraphLock(async () => {
            const doc = await this.resolveDID(operation.did);

            const updateValid = await this.verifyUpdateOperation(operation, doc);

            if (!updateValid) {
                return false;
            }

            // Legacy compatibility: updates without previd cannot be checked for staleness.
            if (operation.previd !== undefined && operation.previd !== doc.didDocumentMetadata?.versionId) {
                return false;
            }

            if (await this.operationIntroducesControllerCycle(operation)) {
                return false;
            }

            const registry = doc.mdip?.registry;

            // Reject operations with unsupported registries
            if (!registry || !this.supportedRegistries.includes(registry)) {
                throw new InvalidOperationError(`registry ${registry} not supported`);
            }

            await this.db.addEventAndQueue(operation.did!, {
                registry: 'local',
                time: operation.signature?.signed || '',
                ordinal: [0],
                operation,
                did: operation.did
            }, this.publicationRegistries(registry));
            await this.checkQueueCapacity(registry);

            return true;
        }));
    }

    async deleteDID(operation: Operation): Promise<boolean> {
        return this.updateDID(operation)
    }

    async getDIDs(options?: GetDIDOptions): Promise<string[] | MdipDocument[]> {
        let { dids, updatedAfter, updatedBefore, confirm, verify, resolve } = options || {};
        if (!dids) {
            const keys = await this.db.getAllKeys();
            dids = keys.map(key => `${this.didPrefix}:${key}`);
        }

        if (updatedAfter || updatedBefore || resolve) {
            const start = updatedAfter ? new Date(updatedAfter) : null;
            const end = updatedBefore ? new Date(updatedBefore) : null;
            const docList: MdipDocument[] = [];
            const didList: string[] = [];

            for (const did of dids) {
                try {
                    const doc = await this.resolveDID(did, { confirm, verify });
                    if (confirm && doc.didResolutionMetadata?.error === 'notFound') {
                        continue;
                    }
                    const updatedStr = doc.didDocumentMetadata?.updated ?? doc.didDocumentMetadata?.created ?? 0;
                    const updated = new Date(updatedStr);

                    if (start && updated <= start) {
                        continue;
                    }

                    if (end && updated >= end) {
                        continue;
                    }

                    if (resolve) {
                        docList.push(doc);
                    } else {
                        didList.push(did);
                    }
                } catch {
                    continue;
                }
            }

            if (resolve) {
                return docList;
            }

            return didList;
        }

        return dids;
    }

    async exportDID(did: string): Promise<GatekeeperEvent[]> {
        return this.db.getEvents(did);
    }

    async exportDIDs(dids?: string[]): Promise<GatekeeperEvent[][]> {
        if (!dids) {
            dids = await this.getDIDs() as string[];
        }

        const batch = [];

        for (const did of dids) {
            batch.push(await this.exportDID(did));
        }

        return batch;
    }

    async importDIDs(dids: GatekeeperEvent[][]): Promise<ImportBatchResult> {
        return this.importBatch(dids.flat());
    }

    private async removeDIDUnlocked(did: string): Promise<void> {
        await this.db.deleteEvents(did);
    }

    async removeDIDs(dids: string[]): Promise<boolean> {
        if (!Array.isArray(dids)) {
            throw new InvalidParameterError('dids');
        }

        for (const did of dids) {
            await this.withDIDsAndGraph([did], () => this.removeDIDUnlocked(did));
        }

        return true;
    }

    async importEvent(event: GatekeeperEvent): Promise<ImportStatus> {
        try {
            if (!event.did) {
                if (event.operation.did) {
                    event.did = event.operation.did;
                }
                else {
                    event.did = await this.generateDID(event.operation);
                }
            }

            const did = event.did;
            if (!did || !(await this.didMatchesOperation(did, event.operation))) {
                return ImportStatus.REJECTED;
            }

            return await this.withDidLock(did, () => this.withControllerGraphLock(async () => {
                const lockedDid = did;
                const currentEvents = await this.db.getEvents(lockedDid);

                const eventOperationCid = await this.generateCID(event.operation);
                if (event.opid !== undefined && event.opid !== eventOperationCid) {
                    return ImportStatus.REJECTED;
                }
                event.opid = eventOperationCid;
                let opMatchIndex = -1;

                for (let i = 0; i < currentEvents.length; i++) {
                    const e = currentEvents[i];
                    const operationCid = await this.historicalOperationCID(e.operation);

                    if (!e.opid) {
                        e.opid = operationCid;
                    }

                    if (opMatchIndex === -1 && operationCid === eventOperationCid) {
                        opMatchIndex = i;
                    }
                }

                const opMatch = currentEvents[opMatchIndex];

                if (opMatch) {
                    const valid = event.operation.type === 'create'
                        ? await this.verifyCreateOperation(event.operation)
                        : await this.verifyUpdateOperation(
                            event.operation,
                            await this.resolveHistory(lockedDid, copyJSON(currentEvents), { versionSequence: opMatchIndex })
                        );

                    if (!valid || !(await this.didMatchesOperation(lockedDid, event.operation))) {
                        return ImportStatus.REJECTED;
                    }

                    const first = currentEvents[0];
                    const nativeRegistry = first.operation.mdip?.registry;

                    if (opMatch.registry === nativeRegistry) {
                        // If this event is already confirmed on the native registry, no need to update
                        return ImportStatus.MERGED;
                    }

                    if (event.registry === nativeRegistry) {
                        // If this import is on the native registry, merge its confirmation metadata
                        currentEvents[opMatchIndex] = {
                            ...event,
                            did: lockedDid,
                            opid: eventOperationCid,
                            operation: opMatch.operation,
                        };
                        await this.db.setEvents(lockedDid, currentEvents);
                        return ImportStatus.ADDED;
                    }

                    return ImportStatus.MERGED;
                } else {
                    const ok = await this.verifyOperationWithHistory(event.operation, currentEvents);

                    if (!ok || !(await this.didMatchesOperation(lockedDid, event.operation))) {
                        return ImportStatus.REJECTED;
                    }

                    if (currentEvents.length === 0) {
                        await this.db.addEvent(lockedDid, event);
                        return ImportStatus.ADDED;
                    }

                    // TEMP during did:test, operation.previd is optional
                    if (!event.operation.previd) {
                        await this.db.addEvent(lockedDid, event);
                        return ImportStatus.ADDED;
                    }

                    const idMatch = currentEvents.find(item => item.opid === event.operation.previd);

                    if (!idMatch) {
                        return ImportStatus.DEFERRED;
                    }

                    const index = currentEvents.indexOf(idMatch);

                    if (index === currentEvents.length - 1) {
                        await this.db.addEvent(lockedDid, event);
                        return ImportStatus.ADDED;
                    }

                    const first = currentEvents[0];
                    const nativeRegistry = first.operation.mdip?.registry;

                    if (event.registry === nativeRegistry) {
                        const nextEvent = currentEvents[index + 1];

                        if (nextEvent.registry !== event.registry ||
                            (event.ordinal && nextEvent.ordinal && compareOrdinals(event.ordinal, nextEvent.ordinal) < 0)) {
                            // reorg event, discard the rest of the operation sequence and replace with this event
                            const newSequence = [...currentEvents.slice(0, index + 1), event];
                            await this.db.setEvents(lockedDid, newSequence, {
                                operationEvents: [event],
                            });
                            return ImportStatus.ADDED;
                        }
                    }
                }

                return ImportStatus.REJECTED;
            }));
        } catch (error: any) {
            if (error.type === 'Invalid operation') {
                // Could be an event with a controller DID that hasn't been imported yet
                return ImportStatus.DEFERRED;
            }
            throw error;
        }
    }

    async importEvents(): Promise<ImportEventsResult> {
        const passQueue = this.eventsQueue;
        const passEvents = new Set(passQueue);
        const total = passQueue.length;
        let remaining = total;
        this.processingEventCount += total;
        let i = 0;
        let added = 0;
        let merged = 0;
        let rejected = 0;
        const acceptedHashes: string[] = [];
        const acceptedEvents: GatekeeperEvent[] = [];
        const rejectedOperations: Operation[] = [];

        this.eventsQueue = [];

        try {
            for (const event of passQueue) {
                i += 1;

                const status = await this.importEvent(event);

                if (status !== ImportStatus.DEFERRED) this.deferredEvents.delete(event);

                if (status === ImportStatus.ADDED) {
                    added += 1;
                    if (event.operation.signature?.hash) {
                        acceptedHashes.push(event.operation.signature.hash.toLowerCase());
                    }
                    acceptedEvents.push(event);
                    this.log.debug(`import ${i}/${total}: added event for ${event.did}`);
                }
                else if (status === ImportStatus.MERGED) {
                    merged += 1;
                    if (event.operation.signature?.hash) {
                        acceptedHashes.push(event.operation.signature.hash.toLowerCase());
                    }
                    acceptedEvents.push(event);
                    this.log.debug(`import ${i}/${total}: merged event for ${event.did}`);
                }
                else if (status === ImportStatus.REJECTED) {
                    rejected += 1;
                    rejectedOperations.push(event.operation);
                    delete this.eventsSeen[`${event.registry}/${event.operation.signature?.hash}`];
                    this.log.debug(`import ${i}/${total}: rejected event for ${event.did}`);
                }
                else if (status === ImportStatus.DEFERRED) {
                    this.deferredEvents.add(event);
                    this.eventsQueue.push(event);
                    this.log.debug(`import ${i}/${total}: deferred event for ${event.did}`);
                }
                remaining -= 1;
                this.processingEventCount -= 1;
            }
        }
        catch (error) {
            const concurrentlyQueued = this.eventsQueue.filter(event => !passEvents.has(event));
            this.eventsQueue = [...passQueue, ...concurrentlyQueued];
            throw error;
        }
        finally {
            this.processingEventCount -= remaining;
        }

        return { added, merged, rejected, acceptedHashes, acceptedEvents, rejectedOperations };
    }

    async processEvents(expectedIndexEpoch?: string): Promise<ProcessEventsResult> {
        return this.withEventQueueWork(async () => {
            await this.assertIndexEpoch(expectedIndexEpoch);
            return this.processQueuedEvents();
        });
    }

    private async processQueuedEvents(): Promise<ProcessEventsResult> {
        if (this.isProcessingEvents) {
            return { busy: true };
        }

        let added = 0;
        let merged = 0;
        let rejected = 0;
        let done = false;
        const acceptedHashes = new Set<string>();
        const acceptedEventsByHash = new Map<string, GatekeeperEvent>();
        const rejectedOperations: Operation[] = [];
        const attemptedEvents: GatekeeperEvent[] = [];
        const attemptedEventSet = new Set<GatekeeperEvent>();

        try {
            this.isProcessingEvents = true;

            while (!done) {
                for (const event of this.eventsQueue) {
                    if (!attemptedEventSet.has(event)) {
                        attemptedEventSet.add(event);
                        attemptedEvents.push(event);
                    }
                }
                const response = await this.importEvents();

                added += response.added;
                merged += response.merged;
                rejected += response.rejected;
                for (const hash of response.acceptedHashes) {
                    acceptedHashes.add(hash);
                }
                for (const event of response.acceptedEvents) {
                    const hash = event.operation.signature?.hash?.toLowerCase();
                    if (hash && !acceptedEventsByHash.has(hash)) {
                        acceptedEventsByHash.set(hash, event);
                    }
                }
                rejectedOperations.push(...(response.rejectedOperations ?? []));

                done = (response.added === 0 && response.merged === 0);
            }
        }
        catch (error) {
            if (attemptedEvents.length > 0) {
                const concurrentlyQueued = this.eventsQueue.filter(event => !attemptedEventSet.has(event));
                this.eventsQueue = [...attemptedEvents, ...concurrentlyQueued];
            }
            this.log.error({ error }, 'processEvents error');
            throw error;
        }
        finally {
            this.isProcessingEvents = false;
        }

        const pending = this.eventsQueue.length;
        const response = {
            added,
            merged,
            rejected,
            pending,
            acceptedHashes: Array.from(acceptedHashes),
            acceptedEvents: Array.from(acceptedEventsByHash.values()),
            ...(rejectedOperations.length > 0 && { rejectedOperations }),
        };

        const { acceptedEvents, rejectedOperations: rejectedOperationList, ...logResponseBase } = response;
        const logResponse = {
            ...logResponseBase,
            acceptedEventsCount: acceptedEvents.length,
            rejectedOperationsCount: rejectedOperationList?.length ?? 0,
        };
        this.log.debug(`processEvents: ${JSON.stringify(logResponse)}`);

        return response;
    }

    async verifyEvent(event: GatekeeperEvent): Promise<boolean> {
        if (!event.registry || !event.time || !event.operation) {
            return false;
        }

        const eventTime = new Date(event.time).getTime();

        if (isNaN(eventTime)) {
            return false;
        }

        const operation = event.operation;

        if (this.operationExceedsMaxBytes(operation)) {
            return false;
        }

        if (!this.verifySignatureFormat(operation.signature)) {
            return false;
        }

        if (operation.type === 'create' && !this.getVerifiedOperationHash(operation)) {
            return false;
        }

        if (operation.type === 'create') {
            if (!operation.created) {
                return false;
            }

            if (!operation.mdip) {
                return false;
            }

            if (!ValidVersions.includes(operation.mdip.version)) {
                return false;
            }

            if (!ValidTypes.includes(operation.mdip.type)) {
                return false;
            }

            if (!ValidRegistries.includes(operation.mdip.registry)) {
                return false;
            }

            if (operation.mdip.prefix !== undefined && !isValidDIDPrefix(operation.mdip.prefix)) {
                return false;
            }

            // eslint-disable-next-line
            if (operation.mdip.type === 'agent') {
                if (!operation.publicJwk) {
                    return false;
                }
            }

            // eslint-disable-next-line
            if (operation.mdip.type === 'asset') {
                if (operation.controller !== operation.signature?.signer) {
                    return false;
                }
            }
        }
        else if (operation.type === 'update') {
            const doc = operation.doc;

            if (!doc || !doc.didDocument || !doc.didDocumentData || !doc.mdip) {
                return false;
            }

            if (!operation.did) {
                return false;
            }
        }
        else if (operation.type === 'delete') {
            if (!operation.did) {
                return false;
            }
        }
        else {
            return false;
        }

        return !event.did || this.didMatchesOperation(event.did, event.operation);
    }

    async importBatch(batch: GatekeeperEvent[], expectedIndexEpoch?: string): Promise<ImportBatchResult> {
        return this.withEventQueueWork(async () => {
            await this.assertIndexEpoch(expectedIndexEpoch);
            return this.admitBatch(batch);
        });
    }

    private async admitBatch(batch: GatekeeperEvent[]): Promise<ImportBatchResult> {
        if (!batch || !Array.isArray(batch) || batch.length < 1) {
            throw new InvalidParameterError('batch');
        }

        let queued = 0;
        let processed = 0;
        const rejectedIndices: number[] = [];

        for (let i = 0; i < batch.length; i++) {
            const event = batch[i];
            const ok = await this.verifyEvent(event);

            if (ok) {
                const eventKey = `${event.registry}/${event.operation.signature?.hash}`;
                if (!this.eventsSeen[eventKey]) {
                    this.eventsSeen[eventKey] = true;
                    this.eventsQueue.push(event);
                    queued += 1;
                }
                else {
                    processed += 1;
                }
            }
            else {
                rejectedIndices.push(i);
            }
        }

        return {
            queued,
            processed,
            rejected: rejectedIndices.length,
            total: this.eventsQueue.length,
            rejectedIndices,
        };
    }

    async exportBatch(dids?: string[]): Promise<GatekeeperEvent[]> {
        const allDIDs = await this.exportDIDs(dids);
        const nonlocalDIDs = allDIDs.filter(events => {
            if (events.length > 0) {
                const create = events[0];
                const registry = create.operation?.mdip?.registry;
                return registry && registry !== 'local'
            }
            return false;
        });

        const events = nonlocalDIDs.flat();
        return events.sort((a, b) => new Date(a.operation.signature?.signed ?? 0).getTime() - new Date(b.operation.signature?.signed ?? 0).getTime());
    }

    async getQueue(registry: string): Promise<Operation[]> {
        if (!ValidRegistries.includes(registry)) {
            throw new InvalidParameterError(`registry=${registry}`);
        }

        if (!this.supportedRegistries.includes(registry)) {
            this.supportedRegistries.push(registry);
        }

        return this.db.getQueue(registry);
    }

    async clearQueue(registry: string, events: Operation[] | string[], expectedIndexEpoch?: string): Promise<boolean> {
        return this.withEventQueueWork(async () => {
            await this.assertIndexEpoch(expectedIndexEpoch);
            return this.clearRegistryQueue(registry, events);
        });
    }

    private async clearRegistryQueue(registry: string, events: Operation[] | string[]): Promise<boolean> {
        if (!ValidRegistries.includes(registry)) {
            throw new InvalidParameterError(`registry=${registry}`);
        }

        if (!Array.isArray(events) || events.length === 0) {
            return true;
        }

        const isHashArray = events.every(item => typeof item === 'string');
        if (isHashArray) {
            const hashes = new Set((events as string[]).filter(Boolean));
            if (hashes.size === 0) {
                return true;
            }

            const queue = await this.db.getQueue(registry);
            const toClear = queue.filter(op => {
                const hash = op.signature?.hash;
                return hash ? hashes.has(hash) : false;
            });

            if (toClear.length === 0) {
                return true;
            }

            return this.db.clearQueue(registry, toClear);
        }

        return this.db.clearQueue(registry, events as Operation[]);
    }

    async getBlock(registry: string, block?: BlockId): Promise<BlockInfo | null> {
        if (!ValidRegistries.includes(registry)) {
            throw new InvalidParameterError(`registry=${registry}`);
        }

        return this.db.getBlock(registry, block);
    }

    async addBlock(registry: string, block: BlockInfo): Promise<boolean> {
        if (!ValidRegistries.includes(registry)) {
            throw new InvalidParameterError(`registry=${registry}`);
        }

        return this.db.addBlock(registry, block)
    }

    async addText(text: string): Promise<string> {
        if (!this.ipfs) {
            // eslint-disable-next-line sonarjs/no-duplicate-string
            throw new InvalidOperationError('IPFS disabled');
        }
        return this.ipfs.addText(text);
    }

    async getText(cid: string): Promise<string | null> {
        if (!this.ipfs) {
            // eslint-disable-next-line sonarjs/no-duplicate-string
            throw new InvalidOperationError('IPFS disabled');
        }
        return this.ipfs.getText(cid);
    }

    async addData(data: Buffer): Promise<string> {
        if (!this.ipfs) {
            // eslint-disable-next-line sonarjs/no-duplicate-string
            throw new InvalidOperationError('IPFS disabled');
        }
        return this.ipfs.addData(data);
    }

    async getData(cid: string): Promise<Buffer | null> {
        if (!this.ipfs) {
            // eslint-disable-next-line sonarjs/no-duplicate-string
            throw new InvalidOperationError('IPFS disabled');
        }
        return this.ipfs.getData(cid);
    }

    async addJSON(json: object): Promise<string> {
        if (!this.ipfs) {
            throw new InvalidOperationError('IPFS disabled');
        }
        return this.ipfs.addJSON(json);
    }

    async getJSON(cid: string): Promise<object | null> {
        if (!this.ipfs) {
            throw new InvalidOperationError('IPFS disabled');
        }
        return this.ipfs.getJSON(cid);
    }
}
