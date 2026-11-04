import AbstractDB from '../../services/mediators/satoshi-inscription/src/db/abstract-db.ts';
import { MediatorDb } from '../../services/mediators/satoshi-inscription/src/types.ts';

class TestDB extends AbstractDB {
    data: MediatorDb | null = null;
    disconnected = false;
    disconnectCount = 0;

    async loadDb(): Promise<MediatorDb | null> {
        return this.data;
    }

    async saveDb(data: MediatorDb): Promise<boolean> {
        this.data = data;
        return true;
    }

    async disconnect(): Promise<void> {
        this.disconnected = true;
        this.disconnectCount++;
    }
}

describe('Satoshi inscription mediator database lifecycle', () => {
    it('waits for an active update before disconnecting', async () => {
        const db = new TestDB();
        let release!: () => void;
        const blocked = new Promise<void>(resolve => { release = resolve; });
        const update = db.updateDb(async data => {
            data.height = 42;
            await blocked;
        });

        await Promise.resolve();
        const stopping = db.stop();
        expect(db.disconnected).toBe(false);

        release();
        await update;
        await stopping;

        expect(db.data?.height).toBe(42);
        expect(db.disconnected).toBe(true);
    });

    it('does not accept updates after shutdown begins', async () => {
        const db = new TestDB();
        const stopping = db.stop();

        await expect(db.updateDb(data => { data.height = 42; }))
            .rejects
            .toThrow('Database is stopping');
        await stopping;
        await db.stop();

        expect(db.data).toBeNull();
        expect(db.disconnectCount).toBe(1);
    });
});
