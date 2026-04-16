import CipherNode from '@mdip/cipher/node';
import Gatekeeper from '@mdip/gatekeeper';
import DbJsonMemory from '@mdip/gatekeeper/db/json-memory.ts';
import TestHelper from './helper.ts';
import {
    createProfiledGatekeeperDb,
    GatekeeperProfiler,
} from '../../packages/gatekeeper/src/profile.ts';

const mockConsole = {
    log: (): void => { },
    error: (): void => { },
    time: (): void => { },
    timeEnd: (): void => { },
} as unknown as typeof console;

describe('GatekeeperProfiler', () => {
    it('captures structured import/process metrics', async () => {
        const profiler = new GatekeeperProfiler({ enabled: true, topN: 5 });
        const rawDb = new DbJsonMemory('profile-test');
        const db = createProfiledGatekeeperDb(rawDb, profiler);
        const cipher = new CipherNode();
        const gatekeeper = new Gatekeeper({
            db,
            console: mockConsole,
            ipfsEnabled: false,
            registries: ['local', 'hyperswarm'],
            profile: profiler,
        });
        const helper = new TestHelper(gatekeeper, cipher);

        await gatekeeper.resetDb();

        const keypair = cipher.generateRandomJwk();
        const controllerOp = await helper.createAgentOp(keypair, { registry: 'hyperswarm' });
        const controllerDid = await gatekeeper.createDID(controllerOp);
        const assetOp = await helper.createAssetOp(controllerDid, keypair, { registry: 'hyperswarm' });
        const did = await gatekeeper.createDID(assetOp);
        const batch = await gatekeeper.exportBatch([did]);

        profiler.reset();

        const importResponse = await gatekeeper.importBatch(batch);
        expect(importResponse.queued).toBe(1);

        const processResponse = await gatekeeper.processEvents();
        expect(processResponse.merged).toBe(1);

        const summary = profiler.snapshot({
            db: 'json-memory',
            ipfsEnabled: false,
        }) as any;

        expect(summary.meta.enabled).toBe(true);
        expect(summary.gatekeeper.importBatch.opsSeen).toBe(1);
        expect(summary.gatekeeper.importBatch.queued).toBe(1);
        expect(summary.gatekeeper.processEvents.calls).toBe(1);
        expect(summary.gatekeeper.importEvent.byStatus.merged).toBe(1);
        expect(summary.db.getEvents.calls).toBeGreaterThan(0);
        expect(summary.derived.acceptedOps).toBe(1);
        expect(Array.isArray(summary.slowest.importEvent)).toBe(true);
    });
});
