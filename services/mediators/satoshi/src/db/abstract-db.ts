import { MediatorDb, MediatorDbInterface } from '../types.js';

export default abstract class AbstractDB implements MediatorDbInterface {
    private lock: Promise<void> = Promise.resolve();

    abstract loadDb(): Promise<MediatorDb | null>;
    abstract saveDb(db: MediatorDb): Promise<boolean>;

    async updateDb(mutator: (db: MediatorDb) => void | Promise<void>): Promise<void> {
        const run = async () => {
            const db = (await this.loadDb()) ?? this.defaultDb();
            await mutator(db);
            await this.saveDb(db);
        };
        const chained = this.lock.then(run, run);
        this.lock = chained.catch(() => {});
        return chained;
    }

    protected defaultDb(): MediatorDb {
        return {
            height: 0,
            hash: '',
            time: '',
            blockCount: 0,
            blocksScanned: 0,
            blocksPending: 0,
            txnsScanned: 0,
            registered: [],
            discovered: [],
        };
    }
}
