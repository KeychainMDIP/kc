/// <reference path="../../services/mediators/hyperswarm/src/stubs.d.ts" />

import { AsyncLocalStorage } from 'node:async_hooks';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import type { ProcessEventMap } from 'node:process';
import { jest } from '@jest/globals';
import type { Mock } from 'jest-mock';

import Gatekeeper from '@mdip/gatekeeper';
import type GatekeeperClient from '@mdip/gatekeeper/client';
import type KeymasterClient from '@mdip/keymaster/client';
import type KuboClient from '@mdip/ipfs/kubo';
import DbJsonMemory from '../../packages/gatekeeper/src/db/json-memory.ts';
import type { OperationSyncStore } from '../../services/mediators/hyperswarm/src/db/types.ts';
import type NegentropyAdapter from '../../services/mediators/hyperswarm/src/negentropy/adapter.ts';

type MediatorModule = typeof import('../../services/mediators/hyperswarm/src/hyperswarm-mediator.ts');
type MockMethod<T> = T extends (...args: infer Args) => infer Result
    ? Mock<(...args: Args) => Result>
    : never;
type MockMethods<T, Keys extends keyof T> = {
    [Key in Keys]: MockMethod<T[Key]>;
};

export type GatekeeperClientDelegates = MockMethods<GatekeeperClient,
    | 'connect'
    | 'isReady'
    | 'exportIndex'
    | 'getDIDs'
    | 'exportBatch'
    | 'importBatch'
    | 'processEvents'
    | 'getQueue'
    | 'clearQueue'
>;

export type KeymasterClientDelegates = MockMethods<KeymasterClient,
    'connect' | 'resolveDID' | 'updateAsset'
>;

export type KuboClientDelegates = MockMethods<KuboClient,
    | 'connect'
    | 'resetPeeringPeers'
    | 'getPeerID'
    | 'getAddresses'
    | 'addPeeringPeer'
    | 'getPeeringPeers'
>;

type HyperswarmJoin = (
    topic: Buffer,
    options: { client: boolean; server: boolean },
) => { flushed: Mock<() => Promise<void>> };

export interface TrackedHyperswarm extends EventEmitter {
    readonly keyPair: {
        publicKey: Buffer;
        secretKey?: Buffer;
    };
    readonly destroyed: boolean;
    readonly join: Mock<HyperswarmJoin>;
    readonly destroy: Mock<() => void>;
}

export interface MediatorNodeListeners {
    uncaughtException: Array<(...args: ProcessEventMap['uncaughtException']) => void>;
    unhandledRejection: Array<(...args: ProcessEventMap['unhandledRejection']) => void>;
    stdinData: Array<(data: Buffer) => void>;
}

export interface MediatorNodeContext {
    readonly name: string;
    readonly publicKey: Buffer;
    readonly gatekeeper: Gatekeeper;
    readonly gatekeeperDb: DbJsonMemory;
    gatekeeperClient: GatekeeperClientDelegates | null;
    keymasterClient: KeymasterClientDelegates | null;
    kuboClient: KuboClientDelegates | null;
    readonly swarms: TrackedHyperswarm[];
    shutdownHook: (() => void | Promise<void>) | null;
    readonly listeners: MediatorNodeListeners;
    mediator: MediatorModule | null;
    syncStore: OperationSyncStore | null;
    negentropyAdapter: NegentropyAdapter | null;
}

const nodeContextStorage = new AsyncLocalStorage<MediatorNodeContext>();
const mediatorRequire = createRequire(new URL(
    '../../services/mediators/hyperswarm/package.json',
    import.meta.url,
));
const hyperswarmModulePath = mediatorRequire.resolve('hyperswarm');
const gracefulGoodbyeModulePath = mediatorRequire.resolve('graceful-goodbye');
let mocksInstalled = false;
let isolatedImportActive = false;

export class MockHyperswarm extends EventEmitter implements TrackedHyperswarm {
    readonly keyPair: { publicKey: Buffer; secretKey: Buffer };
    private isDestroyed = false;
    readonly join = jest.fn<HyperswarmJoin>(() => ({
        flushed: jest.fn(async () => undefined),
    }));
    readonly destroy = jest.fn(() => {
        this.isDestroyed = true;
        this.removeAllListeners();
    });

    constructor() {
        super();
        const context = getMediatorNodeContext();
        this.keyPair = {
            publicKey: Buffer.from(context.publicKey),
            secretKey: Buffer.alloc(64, context.publicKey[0]),
        };
        context.swarms.push(this);
    }

    get destroyed(): boolean {
        return this.isDestroyed;
    }
}

function requireDelegates<Delegates>(delegates: Delegates | null, clientName: string): Delegates {
    if (!delegates) {
        throw new Error(`${clientName} delegates are unavailable`);
    }
    return delegates;
}

function createGatekeeperClientDelegates(context: MediatorNodeContext): GatekeeperClientDelegates {
    return {
        connect: jest.fn<GatekeeperClient['connect']>(async () => undefined),
        isReady: jest.fn<GatekeeperClient['isReady']>(async () => true),
        exportIndex: jest.fn<GatekeeperClient['exportIndex']>(request => request.mode === 'snapshot'
            ? context.gatekeeperDb.exportIndexSnapshot(request)
            : context.gatekeeperDb.exportIndexChanges(request)),
        getDIDs: jest.fn<GatekeeperClient['getDIDs']>(options => context.gatekeeper.getDIDs(options)),
        exportBatch: jest.fn<GatekeeperClient['exportBatch']>(dids => context.gatekeeper.exportBatch(dids)),
        importBatch: jest.fn<GatekeeperClient['importBatch']>(batch => context.gatekeeper.importBatch(batch)),
        processEvents: jest.fn<GatekeeperClient['processEvents']>(() => context.gatekeeper.processEvents()),
        getQueue: jest.fn<GatekeeperClient['getQueue']>(registry => context.gatekeeper.getQueue(registry)),
        clearQueue: jest.fn<GatekeeperClient['clearQueue']>(
            (registry, events) => context.gatekeeper.clearQueue(registry, events),
        ),
    };
}

function createKeymasterClientDelegates(): KeymasterClientDelegates {
    return {
        connect: jest.fn<KeymasterClient['connect']>(async () => undefined),
        resolveDID: jest.fn<KeymasterClient['resolveDID']>(async () => ({})),
        updateAsset: jest.fn<KeymasterClient['updateAsset']>(async () => true),
    };
}

function createKuboClientDelegates(): KuboClientDelegates {
    return {
        connect: jest.fn<KuboClient['connect']>(async () => undefined),
        resetPeeringPeers: jest.fn<KuboClient['resetPeeringPeers']>(async () => undefined),
        getPeerID: jest.fn<KuboClient['getPeerID']>(async () => ''),
        getAddresses: jest.fn<KuboClient['getAddresses']>(async () => []),
        addPeeringPeer: jest.fn<KuboClient['addPeeringPeer']>(async () => undefined),
        getPeeringPeers: jest.fn<KuboClient['getPeeringPeers']>(async () => []),
    };
}

export function installMediatorMocks(): void {
    if (mocksInstalled) {
        return;
    }

    const hyperswarmFactory = () => ({
        default: MockHyperswarm,
    });
    const gracefulGoodbyeFactory = () => ({
        default: (handler: () => void | Promise<void>) => {
            getMediatorNodeContext().shutdownHook = handler;
        },
    });

    jest.unstable_mockModule('hyperswarm', hyperswarmFactory, { virtual: true });
    // These dependencies may resolve below the mediator, outside the root test resolver.
    jest.unstable_mockModule(hyperswarmModulePath, hyperswarmFactory);
    jest.unstable_mockModule('@mdip/gatekeeper/client', () => ({
        default: class GatekeeperClientMock {
            constructor() {
                Object.assign(this, requireDelegates(
                    getMediatorNodeContext().gatekeeperClient,
                    'GatekeeperClient',
                ));
            }
        },
    }));
    jest.unstable_mockModule('@mdip/keymaster/client', () => ({
        default: class KeymasterClientMock {
            constructor() {
                Object.assign(this, requireDelegates(
                    getMediatorNodeContext().keymasterClient,
                    'KeymasterClient',
                ));
            }
        },
    }));
    jest.unstable_mockModule('@mdip/ipfs/kubo', () => ({
        default: class KuboClientMock {
            constructor() {
                Object.assign(this, requireDelegates(
                    getMediatorNodeContext().kuboClient,
                    'KuboClient',
                ));
            }
        },
    }));
    jest.unstable_mockModule('graceful-goodbye', gracefulGoodbyeFactory, { virtual: true });
    jest.unstable_mockModule(gracefulGoodbyeModulePath, gracefulGoodbyeFactory);

    mocksInstalled = true;
}

function createMediatorNodeContext(name: string, publicKey: Buffer): MediatorNodeContext {
    if (!name.trim()) {
        throw new Error('mediator node name is required');
    }
    if (publicKey.length !== 32) {
        throw new Error('mediator node public key must be 32 bytes');
    }

    const gatekeeperDb = new DbJsonMemory(`hyperswarm-test-${name}`);
    const gatekeeper = new Gatekeeper({
        db: gatekeeperDb,
        didPrefix: 'did:test',
        ipfsEnabled: false,
        registries: ['hyperswarm'],
    });
    const context: MediatorNodeContext = {
        name,
        publicKey: Buffer.from(publicKey),
        gatekeeper,
        gatekeeperDb,
        gatekeeperClient: null,
        keymasterClient: null,
        kuboClient: null,
        swarms: [],
        shutdownHook: null,
        listeners: {
            uncaughtException: [],
            unhandledRejection: [],
            stdinData: [],
        },
        mediator: null,
        syncStore: null,
        negentropyAdapter: null,
    };
    context.gatekeeperClient = createGatekeeperClientDelegates(context);
    context.keymasterClient = createKeymasterClientDelegates();
    context.kuboClient = createKuboClientDelegates();
    return context;
}

export function getMediatorNodeContext(): MediatorNodeContext {
    const context = nodeContextStorage.getStore();
    if (!context) {
        throw new Error('mediator node context is unavailable');
    }
    return context;
}

export function runWithMediatorNodeContext<Result>(
    context: MediatorNodeContext,
    callback: () => Result,
): Result {
    return nodeContextStorage.run(context, callback);
}

interface ListenerSnapshot {
    uncaughtException: Set<unknown>;
    unhandledRejection: Set<unknown>;
    stdinData: Set<unknown>;
}

function snapshotListeners(): ListenerSnapshot {
    return {
        uncaughtException: new Set(process.listeners('uncaughtException')),
        unhandledRejection: new Set(process.listeners('unhandledRejection')),
        stdinData: new Set(process.stdin.listeners('data')),
    };
}

function recordAddedListeners(context: MediatorNodeContext, before: ListenerSnapshot): void {
    context.listeners.uncaughtException.length = 0;
    context.listeners.unhandledRejection.length = 0;
    context.listeners.stdinData.length = 0;
    context.listeners.uncaughtException.push(
        ...process.listeners('uncaughtException')
            .filter(listener => !before.uncaughtException.has(listener)),
    );
    context.listeners.unhandledRejection.push(
        ...process.listeners('unhandledRejection')
            .filter(listener => !before.unhandledRejection.has(listener)),
    );
    context.listeners.stdinData.push(
        ...process.stdin.listeners('data')
            .filter(listener => !before.stdinData.has(listener)) as Array<(data: Buffer) => void>,
    );
}

function removeNodeListeners(context: MediatorNodeContext): void {
    for (const listener of context.listeners.uncaughtException) {
        process.removeListener('uncaughtException', listener);
    }
    for (const listener of context.listeners.unhandledRejection) {
        process.removeListener('unhandledRejection', listener);
    }
    for (const listener of context.listeners.stdinData) {
        process.stdin.removeListener('data', listener);
    }
    process.stdin.pause();
}

const BASELINE_ENV = {
    KC_HYPR_DB: 'sqlite',
    KC_IPFS_ENABLE: 'false',
    KC_HYPR_EXPORT_INTERVAL: '2',
    KC_HYPR_NEGENTROPY_ENABLE: 'true',
    KC_HYPR_NEGENTROPY_FRAME_SIZE_LIMIT: '0',
    KC_HYPR_NEGENTROPY_MAX_RECORDS_PER_WINDOW: '25000',
    KC_HYPR_NEGENTROPY_MAX_ROUNDS_PER_SESSION: '64',
    KC_HYPR_NEGENTROPY_INTERVAL: '300',
    KC_HYPR_ORDERED_CATCHUP_ENABLE: 'true',
    KC_HYPR_LEGACY_SYNC_ENABLE: 'true',
    KC_MDIP_PROTOCOL: '/MDIP/v1.0-public',
} as const;

export interface CreateMediatorNodeOptions {
    name: string;
    publicKey: Buffer;
    env?: Record<string, string | undefined>;
}

export interface MediatorNode {
    readonly name: string;
    readonly publicKey: Buffer;
    readonly mediator: MediatorModule;
    readonly gatekeeper: Gatekeeper;
    readonly gatekeeperDb: DbJsonMemory;
    readonly gatekeeperClient: GatekeeperClientDelegates;
    readonly keymasterClient: KeymasterClientDelegates;
    readonly kuboClient: KuboClientDelegates;
    readonly swarms: TrackedHyperswarm[];
    run<Result>(callback: () => Result): Result;
    dispose(): Promise<void>;
}

export async function createMediatorNode(options: CreateMediatorNodeOptions): Promise<MediatorNode> {
    if (!mocksInstalled) {
        throw new Error('installMediatorMocks() must be called before createMediatorNode()');
    }
    if (isolatedImportActive) {
        throw new Error('mediator node imports must run sequentially');
    }

    isolatedImportActive = true;
    const context = createMediatorNodeContext(options.name, options.publicKey);
    const envValues: Record<string, string | undefined> = {
        ...BASELINE_ENV,
        ...options.env,
        KC_HYPR_DB: 'sqlite',
        KC_IPFS_ENABLE: 'false',
        KC_NODE_NAME: options.name,
    };
    const previousEnv = new Map<string, string | undefined>();
    for (const [key, value] of Object.entries(envValues)) {
        previousEnv.set(key, process.env[key]);
        if (value === undefined) {
            delete process.env[key];
        }
        else {
            process.env[key] = value;
        }
    }

    const listenersBefore = snapshotListeners();
    try {
        let mediator: MediatorModule | null = null;
        // Jest otherwise retains native ESM dependency entries across sequential isolates.
        jest.resetModules();
        await runWithMediatorNodeContext(context, () => jest.isolateModulesAsync(async () => {
            mediator = await import('../../services/mediators/hyperswarm/src/hyperswarm-mediator.ts');
        }));
        if (!mediator) {
            throw new Error('isolated hyperswarm mediator import failed');
        }

        context.mediator = mediator;
        recordAddedListeners(context, listenersBefore);
        runWithMediatorNodeContext(context, () => {
            mediator!.__test.setNodeKey(context.publicKey.toString('hex'));
        });

        let disposed = false;
        const node: MediatorNode = {
            name: context.name,
            publicKey: context.publicKey,
            get mediator() {
                if (!context.mediator) {
                    throw new Error('mediator node has been disposed');
                }
                return context.mediator;
            },
            gatekeeper: context.gatekeeper,
            gatekeeperDb: context.gatekeeperDb,
            gatekeeperClient: requireDelegates(context.gatekeeperClient, 'GatekeeperClient'),
            keymasterClient: requireDelegates(context.keymasterClient, 'KeymasterClient'),
            kuboClient: requireDelegates(context.kuboClient, 'KuboClient'),
            swarms: context.swarms,
            run<Result>(callback: () => Result): Result {
                if (disposed) {
                    throw new Error('mediator node has been disposed');
                }
                return runWithMediatorNodeContext(context, callback);
            },
            async dispose(): Promise<void> {
                if (disposed) {
                    return;
                }
                disposed = true;

                let shutdownError: unknown;
                try {
                    if (context.shutdownHook) {
                        await runWithMediatorNodeContext(context, () => context.shutdownHook!());
                    }
                }
                catch (error) {
                    shutdownError = error;
                }
                finally {
                    removeNodeListeners(context);
                    context.shutdownHook = null;
                    context.mediator = null;
                    context.syncStore = null;
                    context.negentropyAdapter = null;
                }

                const activeSwarms = context.swarms.filter(swarm => !swarm.destroyed);
                if (activeSwarms.length > 0) {
                    throw new Error(`${activeSwarms.length} mock Hyperswarm instance(s) were not destroyed`);
                }
                if (shutdownError) {
                    throw shutdownError;
                }
            },
        };
        return node;
    }
    catch (error) {
        recordAddedListeners(context, listenersBefore);
        removeNodeListeners(context);
        throw error;
    }
    finally {
        for (const [key, value] of previousEnv) {
            if (value === undefined) {
                delete process.env[key];
            }
            else {
                process.env[key] = value;
            }
        }
        isolatedImportActive = false;
    }
}
