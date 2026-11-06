import { randomUUID } from 'crypto';
import type { DIDLifecycle, ExpirationJob, GatekeeperEvent, LifecycleMetadata } from '../types.js';

export const LIFECYCLE_VERSION = 1;
export const LIFECYCLE_PAGE_SIZE = 100;
export const MAX_LIFECYCLE_PAGE_SIZE = 1000;

export function lifecycleSuffix(did: string): string {
    return did.split(':').pop() || did;
}

export function lifecycleLimit(limit: number): number {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIFECYCLE_PAGE_SIZE) {
        throw new Error(`Lifecycle limit must be an integer between 1 and ${MAX_LIFECYCLE_PAGE_SIZE}`);
    }
    return limit;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isNonemptyString(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0;
}

export function isDIDLifecycle(value: unknown): value is DIDLifecycle {
    return isRecord(value) && isNonemptyString(value.suffix) &&
        isNonemptyString(value.did) && lifecycleSuffix(value.did) === value.suffix &&
        isNonemptyString(value.revision) &&
        (value.type === undefined || value.type === 'agent' || value.type === 'asset') &&
        (value.expiresAt === undefined || (typeof value.expiresAt === 'number' &&
            Number.isSafeInteger(value.expiresAt) && Math.abs(value.expiresAt) <= 8_640_000_000_000_000)) &&
        (value.controller === undefined || isNonemptyString(value.controller)) &&
        (value.unresolved === undefined || typeof value.unresolved === 'boolean') &&
        (value.controllerUnknown === undefined || typeof value.controllerUnknown === 'boolean');
}

export function isExpirationJob(value: unknown): value is ExpirationJob {
    return isDIDLifecycle(value) && value.type === 'agent' && value.expiresAt !== undefined &&
        !value.unresolved && !value.controllerUnknown &&
        (!('dependentCursor' in value) || value.dependentCursor === undefined ||
            isNonemptyString(value.dependentCursor));
}

export function isLifecycleMetadata(value: unknown): value is LifecycleMetadata {
    return isRecord(value) && typeof value.version === 'number' &&
        Number.isSafeInteger(value.version) && value.version > 0 &&
        isNonemptyString(value.epoch) && typeof value.complete === 'boolean' &&
        typeof value.checkedCursor === 'string' && value.checkedCursor.length <= 20 &&
        /^(0|[1-9]\d*)$/.test(value.checkedCursor) &&
        (value.backfillCursor === undefined || isNonemptyString(value.backfillCursor));
}

// Updates replace the document. Deletes retain MDIP fields but remove its controller.
export function projectLifecycle(
    did: string,
    events: GatekeeperEvent[],
    previous?: DIDLifecycle | null,
): DIDLifecycle | null {
    let result = previous ? { ...previous } : undefined;
    let hasState = !!previous;
    for (const { operation } of events) {
        // Resolution initializes from its anchor and later creates do not replace its state.
        if (operation.type === 'create' && hasState) continue;
        hasState = true;
        if (operation.type === 'delete') {
            if (result) {
                if (result.controllerUnknown && result.type && result.expiresAt !== undefined) {
                    delete result.unresolved;
                }
                delete result.controller;
                delete result.controllerUnknown;
            }
            else if (previous === undefined) {
                result = { suffix: lifecycleSuffix(did), did, revision: '', unresolved: true, controllerUnknown: true };
            }
            continue;
        }
        const mdip = operation.type === 'create' ? operation.mdip : operation.doc?.mdip;
        const controller = operation.type === 'create'
            ? (mdip?.type === 'asset' ? operation.controller : undefined)
            : operation.doc?.didDocument?.controller;
        result = {
            suffix: lifecycleSuffix(did), did, revision: '',
            type: mdip?.type === 'agent' || mdip?.type === 'asset' ? mdip.type : undefined,
        };
        if ((operation.type !== 'create' && operation.type !== 'update') ||
            !mdip || (mdip.type !== 'agent' && mdip.type !== 'asset')) {
            result.unresolved = true;
            result.controllerUnknown = true;
        }
        if (mdip?.validUntil) {
            const time = typeof mdip.validUntil === 'string' ? Date.parse(mdip.validUntil) : NaN;
            if (Number.isFinite(time)) result.expiresAt = time;
            else result.unresolved = true;
        }
        if (controller) {
            if (typeof controller === 'string') {
                result.controller = lifecycleSuffix(controller);
            } else {
                result.unresolved = true;
                result.controllerUnknown = true;
            }
        }
        if (operation.type === 'update' && !operation.doc?.didDocument) {
            result.unresolved = true;
            result.controllerUnknown = true;
        }
    }
    if (!result || (!result.unresolved && result.expiresAt === undefined && !result.controller)) {
        return null;
    }
    result.revision = randomUUID();
    return result;
}

// The offset preserves numeric timestamp order, including dates before the Unix epoch.
export function expirationKey(record: Pick<DIDLifecycle, 'expiresAt' | 'suffix'>): string {
    return `${String(BigInt(record.expiresAt!) + 8_640_000_000_000_000n).padStart(17, '0')}/${record.suffix}`;
}
