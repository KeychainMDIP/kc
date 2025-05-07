import { InvalidDIDError } from '@mdip/common/errors';
import {
    BlockId,
    BlockInfo,
    JsonDbFile,
    GatekeeperDb,
    GatekeeperEvent,
    Operation
} from '../types.js';

export abstract class AbstractJson implements GatekeeperDb {
    protected readonly dataFolder: string;
    protected readonly dbName: string;

    protected constructor(name: string, folder: string = 'data') {
        this.dataFolder = folder;
        this.dbName = `${this.dataFolder}/${name}.json`;
    }

    protected abstract loadDb(): JsonDbFile;

    protected abstract writeDb(db: JsonDbFile): void;

    abstract resetDb(): Promise<void | number | JsonDbFile>;

    async addEvent(did: string, event: GatekeeperEvent): Promise<void> {
        const db = this.loadDb();

        if (!did) {
            throw new InvalidDIDError();
        }

        const suffix = did.split(':').pop() as string;

        if (Object.keys(db.dids).includes(suffix)) {
            db.dids[suffix].push(event);
        }
        else {
            db.dids[suffix] = [event];
        }

        this.writeDb(db);
    }

    async getEvents(did: string): Promise<GatekeeperEvent[]> {
        try {
            const db = this.loadDb();
            const suffix = did.split(':').pop() as string;
            const updates = db.dids[suffix] || [];
            return JSON.parse(JSON.stringify(updates));
        }
        catch {
            return [];
        }
    }

    async setEvents(did: string, events: GatekeeperEvent[]): Promise<void> {
        if (!did) {
            throw new InvalidDIDError();
        }

        const db = this.loadDb();
        const suffix = did.split(':').pop() as string;

        db.dids[suffix] = events;
        this.writeDb(db);
    }

    async deleteEvents(did: string): Promise<void> {
        const db = this.loadDb();
        const suffix = did.split(':').pop() as string;

        if (db.dids[suffix]) {
            delete db.dids[suffix];
            this.writeDb(db);
        }
    }

    async queueOperation(registry: string, op: Operation): Promise<number> {
        const db = this.loadDb();

        if (!db.queue) {
            db.queue = {};
        }

        if (registry in db.queue) {
            db.queue[registry].push(op);
        }
        else {
            db.queue[registry] = [op];
        }

        this.writeDb(db);

        return db.queue[registry].length;
    }

    async getQueue(registry: string): Promise<Operation[]> {
        try {
            const db = this.loadDb();
            if (!db.queue || !db.queue[registry]) {
                return []
            }
            return db.queue[registry]
        }
        catch {
            return [];
        }
    }

    async clearQueue(registry: string, batch: Operation[]): Promise<boolean> {
        try {
            const db = this.loadDb();

            if (!db.queue) {
                return true;
            }

            const oldQueue = db.queue[registry];

            if (!oldQueue) {
                return true;
            }

            db.queue[registry] = oldQueue.filter(item => !batch.some(op => op.signature?.value === item.signature?.value));
            this.writeDb(db);

            return true;
        }
        catch (error) {
            return false;
        }
    }

    async getAllKeys(): Promise<string[]> {
        const db = this.loadDb();
        return Object.keys(db.dids);
    }

    async addBlock(registry: string, blockInfo: BlockInfo): Promise<boolean> {
        const db = this.loadDb();

        if (!db.blocks) {
            db.blocks = {};
        }

        if (!(registry in db.blocks)) {
            db.blocks[registry] = {};
        }

        db.blocks[registry][blockInfo.hash] = blockInfo;
        this.writeDb(db);

        return true;
    }

    async getBlock(registry: string, blockId?: BlockId): Promise<BlockInfo | null> {
        const db = this.loadDb();

        const registryBlocks = db.blocks?.[registry] as Record<string, BlockInfo> | undefined;
        if (!registryBlocks) return null;

        const blockEntries = Object.entries(registryBlocks);

        if (blockEntries.length === 0) return null;

        if (blockId === undefined) {
            // Get block with max height
            let maxBlock: BlockInfo | null = null;
            for (const [, block] of blockEntries) {
                if (!maxBlock || block.height > maxBlock.height) {
                    maxBlock = block;
                }
            }
            return maxBlock;
        }

        if (typeof blockId === 'number') {
            // Search for block with matching height
            for (const [, block] of blockEntries) {
                if (block.height === blockId) return block;
            }
            return null;
        }

        // Lookup by hash (O(1))
        return registryBlocks[blockId] || null;
    }
}
