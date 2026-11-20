import { createPeerAdmissionPolicy } from '../../services/mediators/hyperswarm/src/peer-admission.ts';

describe('peer admission policy', () => {
    it('escalates new violations without extending cooldowns for rejected reconnects', () => {
        let now = 1_000;
        const policy = createPeerAdmissionPolicy({ now: () => now });

        expect(policy.noteViolation('peer', 'first')).toMatchObject({ strikes: 1, until: 61_000 });
        expect(policy.noteRejectedConnection('peer')).toMatchObject({
            strikes: 1,
            until: 61_000,
            rejectedConnections: 1,
            shouldWarn: true,
        });
        now += 10_000;
        expect(policy.noteRejectedConnection('peer')).toMatchObject({
            until: 61_000,
            rejectedConnections: 2,
            shouldWarn: false,
        });

        now = 61_000;
        expect(policy.getRestriction('peer')).toBeNull();
        expect(policy.counts()).toEqual({ punitive: 0, compatibility: 0, retainedStrikes: 1, total: 1 });
        expect(policy.noteViolation('peer', 'second')).toMatchObject({ strikes: 2, until: 361_000 });
    });

    it('resets strike escalation after 24 hours without another violation', () => {
        let now = 1_000;
        const policy = createPeerAdmissionPolicy({ now: () => now });
        policy.noteViolation('peer', 'first');

        now += 24 * 60 * 60 * 1_000;
        expect(policy.noteViolation('peer', 'after-decay')).toMatchObject({ strikes: 1 });
    });

    it('keeps compatibility delays separate from punitive strikes', () => {
        let now = 1_000;
        const policy = createPeerAdmissionPolicy({ now: () => now });

        expect(policy.noteCompatibilityMismatch('peer', 'old-version')).toMatchObject({
            kind: 'compatibility',
            strikes: 0,
            until: 61_000,
        });
        expect(policy.counts()).toEqual({ punitive: 0, compatibility: 1, retainedStrikes: 0, total: 1 });
        now = 61_000;
        expect(policy.getRestriction('peer')).toBeNull();
        expect(policy.counts().total).toBe(0);
    });

    it('evicts compatibility entries before retained strikes and active punitive cooldowns', () => {
        let now = 0;
        const policy = createPeerAdmissionPolicy({ now: () => now, maxEntries: 2 });
        policy.noteViolation('punitive', 'bad-frame');
        now = 60_000;
        expect(policy.getRestriction('punitive')).toBeNull();
        policy.noteCompatibilityMismatch('compatibility', 'old-version');
        now += 1;
        policy.noteViolation('new-punitive', 'bad-page');

        expect(policy.counts()).toEqual({ punitive: 1, compatibility: 0, retainedStrikes: 1, total: 2 });
        expect(policy.getRestriction('new-punitive')).not.toBeNull();
        expect(policy.noteRejectedConnection('compatibility')).toBeNull();
        expect(policy.getRestriction('punitive')).toBeNull();

        now += 1;
        policy.noteViolation('third-punitive', 'bad-content');
        expect(policy.counts()).toEqual({ punitive: 2, compatibility: 0, retainedStrikes: 0, total: 2 });
        expect(policy.getRestriction('new-punitive')).not.toBeNull();
        expect(policy.getRestriction('third-punitive')).not.toBeNull();
    });

    it('does not let compatibility churn erase a retained violation history', () => {
        let now = 0;
        const policy = createPeerAdmissionPolicy({ now: () => now, maxEntries: 2 });
        policy.noteViolation('known-violator', 'bad-frame');
        now = 60_000;
        policy.noteCompatibilityMismatch('first-old-peer', 'old-version');
        now += 1;
        policy.noteCompatibilityMismatch('second-old-peer', 'old-version');

        expect(policy.counts()).toEqual({ punitive: 0, compatibility: 1, retainedStrikes: 1, total: 2 });
        expect(policy.noteViolation('known-violator', 'bad-page')).toMatchObject({ strikes: 2 });
    });

    it('evicts the least recently updated entry regardless of insertion order', () => {
        let now = 0;
        const policy = createPeerAdmissionPolicy({ now: () => now, maxEntries: 2 });
        policy.noteCompatibilityMismatch('first', 'old-version');
        now += 1;
        policy.noteCompatibilityMismatch('second', 'old-version');
        now += 1;
        policy.noteCompatibilityMismatch('first', 'still-old-version');
        now += 1;
        policy.noteCompatibilityMismatch('third', 'old-version');

        expect(policy.getRestriction('first')).not.toBeNull();
        expect(policy.getRestriction('second')).toBeNull();
        expect(policy.getRestriction('third')).not.toBeNull();
    });

    it('rejects invalid capacity configuration and resets all state', () => {
        expect(() => createPeerAdmissionPolicy({ maxEntries: 0 })).toThrow('maxEntries must be a positive integer');
        const policy = createPeerAdmissionPolicy();
        expect(policy.noteRejectedConnection('unknown')).toBeNull();
        policy.noteViolation('peer', 'bad');
        policy.reset();
        expect(policy.counts()).toEqual({ punitive: 0, compatibility: 0, retainedStrikes: 0, total: 0 });
    });
});
