declare module 'graceful-goodbye' {
    export default function goodbye(handler: () => void): void;
}

declare module 'hyperswarm' {
    export interface HyperswarmConnection {
        remotePublicKey: Buffer;
        write(data: string | Buffer): void;
        once(event: string, callback: (...args: any[]) => void): void;
        on(event: string, callback: (...args: any[]) => void): void;
        end?(): void;
        destroy?(): void;
    }

    interface Discovery {
        flushed(): Promise<void>;
    }

    export default class Hyperswarm {
        public keyPair: { publicKey: Buffer; secretKey?: Buffer };

        constructor(opts?: HyperswarmOptions);

        join(topic: Buffer, opts: { client: boolean; server: boolean }): Discovery;
        on(event: 'connection', listener: (conn: HyperswarmConnection) => void): void;
        destroy(): void;
    }
}
