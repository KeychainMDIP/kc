import { MediatorDb, MediatorDbInterface } from '../types.js';

export default abstract class AbstractDB implements MediatorDbInterface {
    private lock: Promise<void> = Promise.resolve();
    private stopPromise: Promise<void> | null = null;

    abstract loadDb(): Promise<MediatorDb | null>;
    abstract saveDb(db: MediatorDb): Promise<boolean>;

    async updateDb(mutator: (db: MediatorDb) => void | Promise<void>): Promise<void> {
        if (this.stopPromise) {
            throw new Error('Database is stopping');
        }

        const run = async () => {
            const db = (await this.loadDb()) ?? this.defaultDb();
            await mutator(db);
            await this.saveDb(db);
        };
        const chained = this.lock.then(run, run);
        this.lock = chained.catch(() => {});
        return chained;
    }

    stop(): Promise<void> {
        if (!this.stopPromise) {
            this.stopPromise = this.lock.then(() => this.disconnect());
            this.lock = this.stopPromise.catch(() => {});
        }

        return this.stopPromise;
    }

    protected async disconnect(): Promise<void> { }

    protected defaultDb(): MediatorDb {
        return {
            height: 0,
            hash: '',
            time: '',
            blockCount: 0,
            blocksScanned: 0,
            blocksPending: 0,
            txnsScanned: 0,
            discovered: [],
        };
    }
}
