export class HyperswarmConnection {
    write(_chunk: string): void {}
}

export default class Hyperswarm {
    keyPair = {
        publicKey: Buffer.alloc(32),
    };

    on(_event: string, _handler: (...args: any[]) => void): void {}

    join(_topic: Uint8Array, _options?: { client?: boolean; server?: boolean }): { flushed(): Promise<void> } {
        return {
            async flushed(): Promise<void> {},
        };
    }

    destroy(): void {}
}
