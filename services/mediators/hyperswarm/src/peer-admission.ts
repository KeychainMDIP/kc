export type PeerRestrictionKind = 'punitive' | 'compatibility';

export interface PeerRestriction {
    kind: PeerRestrictionKind;
    reason: string;
    strikes: number;
    until: number;
    rejectedConnections: number;
    shouldWarn: boolean;
}

interface PeerAdmissionState {
    strikes: number;
    lastViolationAt: number;
    punitiveUntil: number;
    compatibilityUntil: number;
    punitiveReason: string;
    compatibilityReason: string;
    rejectedConnections: number;
    lastRejectLogAt: number | null;
    updatedAt: number;
}

export interface PeerAdmissionPolicyOptions {
    now?: () => number;
    maxEntries?: number;
}

const DEFAULT_MAX_ENTRIES = 4_096;
const STRIKE_DECAY_MS = 24 * 60 * 60 * 1_000;
const COMPATIBILITY_DELAY_MS = 60 * 1_000;
const REJECT_LOG_INTERVAL_MS = 60 * 1_000;
const PUNITIVE_COOLDOWNS_MS = [
    60 * 1_000,
    5 * 60 * 1_000,
    30 * 60 * 1_000,
    6 * 60 * 60 * 1_000,
];

export function createPeerAdmissionPolicy(options: PeerAdmissionPolicyOptions = {}) {
    const now = options.now ?? (() => Date.now());
    const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    if (!Number.isInteger(maxEntries) || maxEntries <= 0) {
        throw new Error('maxEntries must be a positive integer');
    }

    const states = new Map<string, PeerAdmissionState>();

    function pruneState(peerKey: string, at: number): PeerAdmissionState | null {
        const state = states.get(peerKey);
        if (!state) {
            return null;
        }

        if (state.strikes > 0 && (at - state.lastViolationAt) >= STRIKE_DECAY_MS) {
            state.strikes = 0;
            state.punitiveUntil = 0;
        }
        if (state.compatibilityUntil <= at) {
            state.compatibilityUntil = 0;
        }
        if (state.strikes === 0 && state.compatibilityUntil === 0) {
            states.delete(peerKey);
            return null;
        }
        return state;
    }

    function prune(at = now()): void {
        for (const peerKey of states.keys()) {
            pruneState(peerKey, at);
        }
    }

    function evictOldest(candidates: Array<[string, PeerAdmissionState]>): void {
        let oldest = candidates[0];
        for (const candidate of candidates.slice(1)) {
            if (candidate[1].updatedAt < oldest[1].updatedAt) {
                oldest = candidate;
            }
        }
        states.delete(oldest[0]);
    }

    function enforceBound(at: number): void {
        prune(at);
        while (states.size > maxEntries) {
            const entries = Array.from(states.entries());
            const compatibility = entries.filter(([, state]) =>
                state.punitiveUntil <= at && state.compatibilityUntil > at
            );
            const retainedStrikes = entries.filter(([, state]) =>
                state.punitiveUntil <= at && state.compatibilityUntil <= at
            );
            evictOldest(compatibility.length > 0
                ? compatibility
                : retainedStrikes.length > 0 ? retainedStrikes : entries);
        }
    }

    function getOrCreate(peerKey: string, at: number): PeerAdmissionState {
        const existing = pruneState(peerKey, at);
        if (existing) {
            return existing;
        }
        const state: PeerAdmissionState = {
            strikes: 0,
            lastViolationAt: 0,
            punitiveUntil: 0,
            compatibilityUntil: 0,
            punitiveReason: '',
            compatibilityReason: '',
            rejectedConnections: 0,
            lastRejectLogAt: null,
            updatedAt: at,
        };
        states.set(peerKey, state);
        return state;
    }

    function noteViolation(peerKey: string, reason: string): PeerRestriction {
        const at = now();
        const state = getOrCreate(peerKey, at);
        state.strikes += 1;
        state.lastViolationAt = at;
        state.punitiveReason = reason;
        state.updatedAt = at;
        state.rejectedConnections = 0;
        state.lastRejectLogAt = null;
        const cooldown = PUNITIVE_COOLDOWNS_MS[Math.min(state.strikes, PUNITIVE_COOLDOWNS_MS.length) - 1];
        state.punitiveUntil = at + cooldown;
        enforceBound(at);
        return {
            kind: 'punitive',
            reason,
            strikes: state.strikes,
            until: state.punitiveUntil,
            rejectedConnections: 0,
            shouldWarn: true,
        };
    }

    function noteCompatibilityMismatch(peerKey: string, reason: string): PeerRestriction {
        const at = now();
        const state = getOrCreate(peerKey, at);
        state.compatibilityUntil = at + COMPATIBILITY_DELAY_MS;
        state.compatibilityReason = reason;
        state.updatedAt = at;
        state.rejectedConnections = 0;
        state.lastRejectLogAt = null;
        enforceBound(at);
        return {
            kind: 'compatibility',
            reason,
            strikes: state.strikes,
            until: state.compatibilityUntil,
            rejectedConnections: 0,
            shouldWarn: true,
        };
    }

    function getRestriction(peerKey: string): PeerRestriction | null {
        const at = now();
        const state = pruneState(peerKey, at);
        if (!state) {
            return null;
        }
        if (state.punitiveUntil > at) {
            return {
                kind: 'punitive',
                reason: state.punitiveReason,
                strikes: state.strikes,
                until: state.punitiveUntil,
                rejectedConnections: state.rejectedConnections,
                shouldWarn: false,
            };
        }
        if (state.compatibilityUntil > at) {
            return {
                kind: 'compatibility',
                reason: state.compatibilityReason,
                strikes: state.strikes,
                until: state.compatibilityUntil,
                rejectedConnections: state.rejectedConnections,
                shouldWarn: false,
            };
        }
        return null;
    }

    function noteRejectedConnection(peerKey: string): PeerRestriction | null {
        const at = now();
        const restriction = getRestriction(peerKey);
        const state = states.get(peerKey);
        if (!restriction || !state) {
            return null;
        }
        state.rejectedConnections += 1;
        const shouldWarn = state.lastRejectLogAt === null
            || (at - state.lastRejectLogAt) >= REJECT_LOG_INTERVAL_MS;
        if (shouldWarn) {
            state.lastRejectLogAt = at;
        }
        return {
            ...restriction,
            rejectedConnections: state.rejectedConnections,
            shouldWarn,
        };
    }

    function counts(): { punitive: number; compatibility: number; retainedStrikes: number; total: number } {
        const at = now();
        prune(at);
        let punitive = 0;
        let compatibility = 0;
        let retainedStrikes = 0;
        for (const state of states.values()) {
            if (state.punitiveUntil > at) {
                punitive += 1;
            } else if (state.compatibilityUntil > at) {
                compatibility += 1;
            } else if (state.strikes > 0) {
                retainedStrikes += 1;
            }
        }
        return { punitive, compatibility, retainedStrikes, total: states.size };
    }

    return {
        counts,
        getRestriction,
        noteCompatibilityMismatch,
        noteRejectedConnection,
        noteViolation,
        reset(): void {
            states.clear();
        },
    };
}
