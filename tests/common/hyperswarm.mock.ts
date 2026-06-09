import { EventEmitter } from 'events';

export type HyperswarmConnection = EventEmitter & {
    remotePublicKey: Buffer;
    write(data: Buffer | string): void;
    destroy(): void;
};

export default class HyperswarmMock extends EventEmitter {
    keyPair = {
        publicKey: Buffer.alloc(32, 1),
    };

    join(): { flushed(): Promise<void> } {
        return {
            flushed: async () => undefined,
        };
    }

    destroy(): void {
        this.removeAllListeners();
    }
}
