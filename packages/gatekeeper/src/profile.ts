import type {
    BlockId,
    BlockInfo,
    GatekeeperDb,
    GatekeeperEvent,
    JsonDbFile,
    Operation,
} from './types.js';

const DURATION_BUCKETS_MS = [
    0.05,
    0.1,
    0.25,
    0.5,
    1,
    2,
    5,
    10,
    20,
    50,
    100,
    250,
    500,
    1000,
    2000,
    5000,
    10000,
    30000,
    60000,
    120000,
];

const VALUE_BUCKETS = [
    0,
    1,
    2,
    4,
    8,
    16,
    32,
    64,
    128,
    256,
    512,
    1024,
    2048,
    4096,
    8192,
];

type ProfileContext = Record<string, unknown>;

interface HistogramMetric {
    count: number;
    total: number;
    min: number;
    max: number;
    buckets: number[];
}

interface SlowSpanRecord {
    durationMs: number;
    capturedAt: string;
    context: ProfileContext;
}

export interface GatekeeperProfilerOptions {
    enabled?: boolean;
    topN?: number;
    meta?: Record<string, unknown>;
}

export interface GatekeeperProfileSpan {
    end(extraContext?: ProfileContext): number;
}

const noopProfileSpan: GatekeeperProfileSpan = {
    end(): number {
        return 0;
    },
};

function createMetric(bucketTemplate: number[]): HistogramMetric {
    return {
        count: 0,
        total: 0,
        min: Number.POSITIVE_INFINITY,
        max: 0,
        buckets: new Array(bucketTemplate.length + 1).fill(0),
    };
}

function roundMetric(value: number): number {
    if (!Number.isFinite(value)) {
        return 0;
    }

    return Math.round(value * 1000) / 1000;
}

function updateMetric(metric: HistogramMetric, value: number, bucketTemplate: number[]): void {
    if (!Number.isFinite(value) || value < 0) {
        return;
    }

    metric.count += 1;
    metric.total += value;
    metric.min = Math.min(metric.min, value);
    metric.max = Math.max(metric.max, value);

    let bucketIndex = bucketTemplate.length;
    for (let i = 0; i < bucketTemplate.length; i++) {
        if (value <= bucketTemplate[i]) {
            bucketIndex = i;
            break;
        }
    }
    metric.buckets[bucketIndex] += 1;
}

function percentileFromHistogram(metric: HistogramMetric, bucketTemplate: number[], percentile: number): number {
    if (metric.count === 0) {
        return 0;
    }

    const target = Math.ceil(metric.count * percentile);
    let seen = 0;

    for (let i = 0; i < metric.buckets.length; i++) {
        seen += metric.buckets[i];
        if (seen >= target) {
            if (i >= bucketTemplate.length) {
                return metric.max;
            }
            return bucketTemplate[i];
        }
    }

    return metric.max;
}

function summarizeMetric(metric: HistogramMetric | undefined, bucketTemplate: number[], totalKey: string) {
    if (!metric || metric.count === 0) {
        return {
            count: 0,
            [totalKey]: 0,
            avg: 0,
            min: 0,
            p50: 0,
            p95: 0,
            p99: 0,
            max: 0,
        };
    }

    return {
        count: metric.count,
        [totalKey]: roundMetric(metric.total),
        avg: roundMetric(metric.total / metric.count),
        min: roundMetric(metric.min === Number.POSITIVE_INFINITY ? 0 : metric.min),
        p50: roundMetric(percentileFromHistogram(metric, bucketTemplate, 0.5)),
        p95: roundMetric(percentileFromHistogram(metric, bucketTemplate, 0.95)),
        p99: roundMetric(percentileFromHistogram(metric, bucketTemplate, 0.99)),
        max: roundMetric(metric.max),
    };
}

function didSuffix(did?: string): string | undefined {
    if (!did) {
        return undefined;
    }

    const suffix = did.split(':').pop();
    return suffix || did;
}

function normalizeContextValue(value: unknown, depth = 0): unknown {
    if (value == null || typeof value === 'number' || typeof value === 'boolean') {
        return value;
    }

    if (typeof value === 'string') {
        if (value.length <= 160) {
            return value;
        }
        return `${value.slice(0, 80)}...${value.slice(-40)}`;
    }

    if (typeof value === 'bigint') {
        return value.toString();
    }

    if (value instanceof Date) {
        return value.toISOString();
    }

    if (Array.isArray(value)) {
        if (depth >= 2) {
            return `[array(${value.length})]`;
        }

        return value.slice(0, 10).map(item => normalizeContextValue(item, depth + 1));
    }

    if (typeof value === 'object') {
        if (depth >= 2) {
            return '[object]';
        }

        const entries = Object.entries(value as Record<string, unknown>).slice(0, 10);
        return Object.fromEntries(
            entries.map(([key, item]) => [key, normalizeContextValue(item, depth + 1)])
        );
    }

    return String(value);
}

function normalizeContext(context: ProfileContext): ProfileContext {
    return Object.fromEntries(
        Object.entries(context)
            .filter(([, value]) => value !== undefined)
            .map(([key, value]) => [key, normalizeContextValue(value)])
    );
}

function toIsoOrNull(timestampMs: number | undefined): string | null {
    if (!timestampMs || !Number.isFinite(timestampMs) || timestampMs <= 0) {
        return null;
    }

    return new Date(timestampMs).toISOString();
}

export class GatekeeperProfiler {
    private readonly enabledFlag: boolean;
    private readonly topN: number;
    private readonly meta: Record<string, unknown>;
    private startedAtMs: number;
    private readonly durationMetrics = new Map<string, HistogramMetric>();
    private readonly valueMetrics = new Map<string, HistogramMetric>();
    private readonly counters = new Map<string, number>();
    private readonly gauges = new Map<string, number>();
    private readonly slowest = new Map<string, SlowSpanRecord[]>();

    constructor(options: GatekeeperProfilerOptions = {}) {
        this.enabledFlag = options.enabled ?? false;
        this.topN = options.topN ?? 20;
        this.meta = { ...(options.meta || {}) };
        this.startedAtMs = Date.now();
    }

    isEnabled(): boolean {
        return this.enabledFlag;
    }

    startSpan(name: string, context: ProfileContext = {}): GatekeeperProfileSpan {
        if (!this.enabledFlag) {
            return noopProfileSpan;
        }

        const startedAt = process.hrtime.bigint();
        const initialContext = normalizeContext(context);

        return {
            end: (extraContext: ProfileContext = {}): number => {
                const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
                const mergedContext = {
                    ...initialContext,
                    ...normalizeContext(extraContext),
                };
                this.recordDuration(name, durationMs, mergedContext);
                return durationMs;
            },
        };
    }

    recordDuration(name: string, durationMs: number, context: ProfileContext = {}): void {
        if (!this.enabledFlag || !Number.isFinite(durationMs) || durationMs < 0) {
            return;
        }

        const metric = this.durationMetrics.get(name) ?? createMetric(DURATION_BUCKETS_MS);
        updateMetric(metric, durationMs, DURATION_BUCKETS_MS);
        this.durationMetrics.set(name, metric);
        this.recordSlowSpan(name, durationMs, context);
    }

    recordNumber(name: string, value: number): void {
        if (!this.enabledFlag || !Number.isFinite(value) || value < 0) {
            return;
        }

        const metric = this.valueMetrics.get(name) ?? createMetric(VALUE_BUCKETS);
        updateMetric(metric, value, VALUE_BUCKETS);
        this.valueMetrics.set(name, metric);
    }

    incrementCounter(name: string, delta = 1): void {
        if (!this.enabledFlag || !Number.isFinite(delta)) {
            return;
        }

        this.counters.set(name, (this.counters.get(name) || 0) + delta);
    }

    setGauge(name: string, value: number): void {
        if (!this.enabledFlag || !Number.isFinite(value)) {
            return;
        }

        this.gauges.set(name, value);
    }

    reset(): void {
        this.startedAtMs = Date.now();
        this.durationMetrics.clear();
        this.valueMetrics.clear();
        this.counters.clear();
        this.gauges.clear();
        this.slowest.clear();
    }

    snapshot(extraMeta: Record<string, unknown> = {}): Record<string, unknown> {
        const capturedAtMs = Date.now();
        const acceptedOps = this.counter('gatekeeper.processEvents.added')
            + this.counter('gatekeeper.processEvents.merged');
        const processEventsDuration = this.durationMetricTotal('gatekeeper.processEvents');
        const currentPendingEvents = this.gauge('gatekeeper.currentPendingEvents');
        const lastMutationAtMs = this.gauge('db.lastMutationAtMs');

        return {
            meta: {
                ...this.meta,
                ...extraMeta,
                enabled: this.enabledFlag,
                topN: this.topN,
                startedAt: new Date(this.startedAtMs).toISOString(),
                capturedAt: new Date(capturedAtMs).toISOString(),
                uptimeMs: capturedAtMs - this.startedAtMs,
            },
            api: {
                batchImport: this.durationSummaryMs('api.batchImport.request'),
                eventsProcess: this.durationSummaryMs('api.eventsProcess.request'),
            },
            gatekeeper: {
                importBatch: {
                    calls: this.durationMetricCount('gatekeeper.importBatch'),
                    opsSeen: this.counter('gatekeeper.importBatch.opsSeen'),
                    queued: this.counter('gatekeeper.importBatch.queued'),
                    duplicates: this.counter('gatekeeper.importBatch.duplicates'),
                    rejected: this.counter('gatekeeper.importBatch.rejected'),
                    batchSize: this.valueSummary('gatekeeper.importBatch.batchSize'),
                    queueDepthAfter: this.valueSummary('gatekeeper.importBatch.queueDepthAfter'),
                    verifyEventMs: this.durationSummaryMs('gatekeeper.importBatch.verifyEvent'),
                    durationMs: this.durationSummaryMs('gatekeeper.importBatch'),
                },
                processEvents: {
                    calls: this.durationMetricCount('gatekeeper.processEvents'),
                    passes: this.counter('gatekeeper.processEvents.passes'),
                    added: this.counter('gatekeeper.processEvents.added'),
                    merged: this.counter('gatekeeper.processEvents.merged'),
                    rejected: this.counter('gatekeeper.processEvents.rejected'),
                    deferred: this.counter('gatekeeper.importEvents.deferred'),
                    pendingStart: this.valueSummary('gatekeeper.processEvents.pendingStart'),
                    pendingEnd: this.valueSummary('gatekeeper.processEvents.pendingEnd'),
                    passDurationMs: this.durationSummaryMs('gatekeeper.processEvents.pass'),
                    durationMs: this.durationSummaryMs('gatekeeper.processEvents'),
                },
                importEvent: {
                    calls: this.durationMetricCount('gatekeeper.importEvent'),
                    byStatus: {
                        added: this.counter('gatekeeper.importEvent.status.added'),
                        merged: this.counter('gatekeeper.importEvent.status.merged'),
                        rejected: this.counter('gatekeeper.importEvent.status.rejected'),
                        deferred: this.counter('gatekeeper.importEvent.status.deferred'),
                    },
                    currentEventsLen: this.valueSummary('gatekeeper.importEvent.currentEventsLen'),
                    opidBackfills: this.counter('gatekeeper.importEvent.opidBackfills'),
                    didDerived: this.counter('gatekeeper.importEvent.didDerived'),
                    didGenerated: this.counter('gatekeeper.importEvent.didGenerated'),
                    eventOpidGenerated: this.counter('gatekeeper.importEvent.eventOpidGenerated'),
                    addEventAppends: this.counter('gatekeeper.importEvent.addEventAppends'),
                    setEventsRewrites: this.counter('gatekeeper.importEvent.setEventsRewrites'),
                    durationMs: this.durationSummaryMs('gatekeeper.importEvent'),
                },
                verifyCreateOperation: {
                    calls: this.durationMetricCount('gatekeeper.verifyCreateOperation'),
                    controllerResolveMs: this.durationSummaryMs('gatekeeper.verifyCreateOperation.controllerResolve'),
                    durationMs: this.durationSummaryMs('gatekeeper.verifyCreateOperation'),
                },
                verifyUpdateOperation: {
                    calls: this.durationMetricCount('gatekeeper.verifyUpdateOperation'),
                    controllerResolveMs: this.durationSummaryMs('gatekeeper.verifyUpdateOperation.controllerResolve'),
                    durationMs: this.durationSummaryMs('gatekeeper.verifyUpdateOperation'),
                },
                resolveDID: {
                    calls: this.durationMetricCount('gatekeeper.resolveDID'),
                    confirmCalls: this.counter('gatekeeper.resolveDID.confirmCalls'),
                    verifyCalls: this.counter('gatekeeper.resolveDID.verifyCalls'),
                    versionTimeCalls: this.counter('gatekeeper.resolveDID.versionTimeCalls'),
                    versionSequenceCalls: this.counter('gatekeeper.resolveDID.versionSequenceCalls'),
                    eventsLen: this.valueSummary('gatekeeper.resolveDID.eventsLen'),
                    scannedEvents: this.valueSummary('gatekeeper.resolveDID.scannedEvents'),
                    blockLookups: this.valueSummary('gatekeeper.resolveDID.blockLookups'),
                    durationMs: this.durationSummaryMs('gatekeeper.resolveDID'),
                },
                generateCID: {
                    calls: this.durationMetricCount('gatekeeper.generateCID'),
                    saveTrue: this.counter('gatekeeper.generateCID.saveTrue'),
                    saveFalse: this.counter('gatekeeper.generateCID.saveFalse'),
                    durationMs: this.durationSummaryMs('gatekeeper.generateCID'),
                },
            },
            db: {
                getEvents: {
                    calls: this.durationMetricCount('db.getEvents'),
                    resultLength: this.valueSummary('db.getEvents.resultLength'),
                    durationMs: this.durationSummaryMs('db.getEvents'),
                },
                addEvent: {
                    calls: this.durationMetricCount('db.addEvent'),
                    durationMs: this.durationSummaryMs('db.addEvent'),
                },
                setEvents: {
                    calls: this.durationMetricCount('db.setEvents'),
                    eventsLength: this.valueSummary('db.setEvents.eventsLength'),
                    durationMs: this.durationSummaryMs('db.setEvents'),
                },
                getBlock: {
                    calls: this.durationMetricCount('db.getBlock'),
                    durationMs: this.durationSummaryMs('db.getBlock'),
                },
            },
            derived: {
                acceptedOps,
                processMsPerAcceptedOp: acceptedOps > 0 ? roundMetric(processEventsDuration / acceptedOps) : 0,
                getEventsCallsPerAcceptedOp: acceptedOps > 0
                    ? roundMetric(this.durationMetricCount('db.getEvents') / acceptedOps)
                    : 0,
                resolveDidCallsPerAcceptedOp: acceptedOps > 0
                    ? roundMetric(this.durationMetricCount('gatekeeper.resolveDID') / acceptedOps)
                    : 0,
                deferredPerAcceptedOp: acceptedOps > 0
                    ? roundMetric(this.counter('gatekeeper.importEvents.deferred') / acceptedOps)
                    : 0,
                currentPendingEvents,
                lastMutationAt: toIsoOrNull(lastMutationAtMs),
            },
            slowest: {
                importEvent: this.getSlowest('gatekeeper.importEvent'),
                resolveDID: this.getSlowest('gatekeeper.resolveDID'),
                'db.getEvents': this.getSlowest('db.getEvents'),
                'db.setEvents': this.getSlowest('db.setEvents'),
            },
        };
    }

    private recordSlowSpan(name: string, durationMs: number, context: ProfileContext): void {
        if (this.topN <= 0) {
            return;
        }

        const records = this.slowest.get(name) ?? [];
        const normalizedContext = normalizeContext(context);
        const record: SlowSpanRecord = {
            durationMs: roundMetric(durationMs),
            capturedAt: new Date().toISOString(),
            context: normalizedContext,
        };

        if (records.length < this.topN) {
            records.push(record);
            records.sort((a, b) => b.durationMs - a.durationMs);
            this.slowest.set(name, records);
            return;
        }

        const slowestTail = records[records.length - 1];
        if (!slowestTail || record.durationMs <= slowestTail.durationMs) {
            return;
        }

        records.pop();
        records.push(record);
        records.sort((a, b) => b.durationMs - a.durationMs);
        this.slowest.set(name, records);
    }

    private durationMetricCount(name: string): number {
        return this.durationMetrics.get(name)?.count ?? 0;
    }

    private durationMetricTotal(name: string): number {
        return this.durationMetrics.get(name)?.total ?? 0;
    }

    private durationSummaryMs(name: string) {
        return summarizeMetric(this.durationMetrics.get(name), DURATION_BUCKETS_MS, 'totalMs');
    }

    private valueSummary(name: string) {
        return summarizeMetric(this.valueMetrics.get(name), VALUE_BUCKETS, 'total');
    }

    private counter(name: string): number {
        return this.counters.get(name) ?? 0;
    }

    private gauge(name: string): number {
        return this.gauges.get(name) ?? 0;
    }

    private getSlowest(name: string): SlowSpanRecord[] {
        return [...(this.slowest.get(name) ?? [])];
    }
}

export function createProfiledGatekeeperDb(
    db: GatekeeperDb,
    profiler: GatekeeperProfiler,
): GatekeeperDb {
    if (!profiler.isEnabled()) {
        return db;
    }

    return {
        async start(): Promise<void> {
            const span = profiler.startSpan('db.start');
            try {
                return await db.start();
            } finally {
                span.end();
            }
        },

        async stop(): Promise<void> {
            const span = profiler.startSpan('db.stop');
            try {
                return await db.stop();
            } finally {
                span.end();
            }
        },

        async resetDb(): Promise<void | number | JsonDbFile> {
            const span = profiler.startSpan('db.resetDb');
            try {
                return await db.resetDb();
            } finally {
                span.end();
                profiler.setGauge('db.lastMutationAtMs', Date.now());
            }
        },

        async addEvent(did: string, event: GatekeeperEvent): Promise<void | number> {
            const span = profiler.startSpan('db.addEvent', {
                didSuffix: didSuffix(did),
                operationType: event.operation?.type,
            });
            try {
                return await db.addEvent(did, event);
            } finally {
                span.end();
                profiler.setGauge('db.lastMutationAtMs', Date.now());
            }
        },

        async getEvents(did: string): Promise<GatekeeperEvent[]> {
            const context = { didSuffix: didSuffix(did) };
            const span = profiler.startSpan('db.getEvents', context);
            try {
                const events = await db.getEvents(did);
                profiler.recordNumber('db.getEvents.resultLength', events.length);
                span.end({ ...context, resultLength: events.length });
                return events;
            } catch (error) {
                span.end({ ...context, error: error instanceof Error ? error.message : String(error) });
                throw error;
            }
        },

        async setEvents(did: string, events: GatekeeperEvent[]): Promise<number | void> {
            const context = {
                didSuffix: didSuffix(did),
                eventsLength: events.length,
            };
            const span = profiler.startSpan('db.setEvents', context);
            try {
                profiler.recordNumber('db.setEvents.eventsLength', events.length);
                return await db.setEvents(did, events);
            } finally {
                span.end(context);
                profiler.setGauge('db.lastMutationAtMs', Date.now());
            }
        },

        async deleteEvents(did: string): Promise<void | number> {
            const context = { didSuffix: didSuffix(did) };
            const span = profiler.startSpan('db.deleteEvents', context);
            try {
                return await db.deleteEvents(did);
            } finally {
                span.end(context);
                profiler.setGauge('db.lastMutationAtMs', Date.now());
            }
        },

        async getAllKeys(): Promise<string[]> {
            const span = profiler.startSpan('db.getAllKeys');
            try {
                const keys = await db.getAllKeys();
                profiler.recordNumber('db.getAllKeys.resultLength', keys.length);
                span.end({ resultLength: keys.length });
                return keys;
            } catch (error) {
                span.end({ error: error instanceof Error ? error.message : String(error) });
                throw error;
            }
        },

        async queueOperation(registry: string, op: Operation): Promise<number> {
            const context = {
                registry,
                operationType: op.type,
            };
            const span = profiler.startSpan('db.queueOperation', context);
            try {
                return await db.queueOperation(registry, op);
            } finally {
                span.end(context);
                profiler.setGauge('db.lastMutationAtMs', Date.now());
            }
        },

        async getQueue(registry: string): Promise<Operation[]> {
            const context = { registry };
            const span = profiler.startSpan('db.getQueue', context);
            try {
                const queue = await db.getQueue(registry);
                profiler.recordNumber('db.getQueue.resultLength', queue.length);
                span.end({ ...context, resultLength: queue.length });
                return queue;
            } catch (error) {
                span.end({ ...context, error: error instanceof Error ? error.message : String(error) });
                throw error;
            }
        },

        async clearQueue(registry: string, batch: Operation[]): Promise<boolean> {
            const context = {
                registry,
                batchLength: batch.length,
            };
            const span = profiler.startSpan('db.clearQueue', context);
            try {
                return await db.clearQueue(registry, batch);
            } finally {
                span.end(context);
                profiler.setGauge('db.lastMutationAtMs', Date.now());
            }
        },

        async addBlock(registry: string, blockInfo: BlockInfo): Promise<boolean> {
            const context = {
                registry,
                height: blockInfo.height,
                hash: blockInfo.hash,
            };
            const span = profiler.startSpan('db.addBlock', context);
            try {
                return await db.addBlock(registry, blockInfo);
            } finally {
                span.end(context);
                profiler.setGauge('db.lastMutationAtMs', Date.now());
            }
        },

        async getBlock(registry: string, blockId?: BlockId): Promise<BlockInfo | null> {
            const context = {
                registry,
                blockId: blockId == null ? 'latest' : blockId,
            };
            const span = profiler.startSpan('db.getBlock', context);
            try {
                const block = await db.getBlock(registry, blockId);
                span.end({
                    ...context,
                    found: !!block,
                    height: block?.height,
                });
                return block;
            } catch (error) {
                span.end({ ...context, error: error instanceof Error ? error.message : String(error) });
                throw error;
            }
        },
    };
}
