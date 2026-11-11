import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

import CipherNode from '@mdip/cipher/node';
import Gatekeeper from '@mdip/gatekeeper';
import DbJsonMemory from '@mdip/gatekeeper/db/json-memory';
import type { GatekeeperEvent, Operation } from '@mdip/gatekeeper/types';
import type { DiscoveredItem } from '../../services/mediators/satoshi/src/types.ts';
import type { DiscoveredInscribedItem } from '../../services/mediators/satoshi-inscription/src/types.ts';
import { importEventBatch as importSatoshiBatch } from '../../services/mediators/satoshi/src/import-batch.ts';
import { importEventBatch as importInscriptionBatch } from '../../services/mediators/satoshi-inscription/src/import-batch.ts';
import TestHelper from '../gatekeeper/helper.ts';

const implementations = [
    ['satoshi', 'satoshi-mediator.ts', 'TBTC', importSatoshiBatch],
    ['satoshi-inscription', 'inscription-mediator.ts', 'BTC-Inscription', importInscriptionBatch],
] as const;

// Execute the private production import functions without starting RPC clients or process handlers.
function loadImportFunctions(sourcePath: URL, dependencies: Record<string, unknown>): () => Promise<boolean> {
    const sourceText = readFileSync(sourcePath, 'utf8');
    const source = ts.createSourceFile(sourcePath.pathname, sourceText, ts.ScriptTarget.ES2022, true);
    const names = new Set(['importBatch', 'importBatches', 'sameItem', 'keyFromItem']);
    const declarations = source.statements
        .filter(ts.isFunctionDeclaration)
        .filter(declaration => declaration.name && names.has(declaration.name.text));
    expect(declarations.some(declaration => declaration.name?.text === 'importBatches')).toBe(true);
    const compiled = ts.transpileModule(
        declarations.map(declaration => declaration.getFullText(source)).join('\n'),
        { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } },
    ).outputText;

    // eslint-disable-next-line sonarjs/code-eval -- Only trusted repository declarations run in this isolated test context.
    return vm.runInNewContext(`${compiled}\nimportBatches`, {
        ...dependencies,
        shuttingDown: false,
        log: { debug() {}, error() {} },
    }) as () => Promise<boolean>;
}

describe.each(implementations)('%s discovered batch import', (directory, filename, registry, importEventBatch) => {
    it('reaches a later controller batch when an earlier immutable batch exceeds pending capacity', async () => {
        const cipher = new CipherNode();
        const db = new DbJsonMemory(`native-batch-capacity-${directory}`);
        const gatekeeper = new Gatekeeper({ db, ipfsEnabled: false, registries: [registry] });
        (gatekeeper as unknown as { maxPendingEventCount: number }).maxPendingEventCount = 1;
        const helper = new TestHelper(gatekeeper, cipher);
        const key = cipher.generateRandomJwk();
        const agent = await helper.createAgentOp(key, { registry });
        const controller = await gatekeeper.generateDID(agent);
        const asset = (data: string): Operation => {
            const unsigned = {
                type: 'create' as const,
                created: agent.created!,
                mdip: { version: 1, type: 'asset' as const, registry },
                controller,
                data,
            };
            const hash = cipher.hashJSON(unsigned);
            return {
                ...unsigned,
                signature: {
                    signer: controller,
                    signed: agent.signature!.signed,
                    hash,
                    value: cipher.signHash(hash, key.privateJwk),
                },
            };
        };
        const event = (operation: Operation, index: number): GatekeeperEvent => ({
            registry,
            time: agent.signature!.signed,
            ordinal: [1, index, 0],
            blockchain: { height: 1, index, txid: `transaction-${index}`, opidx: 0 },
            operation,
        });
        await gatekeeper.importBatch([event(asset('pending blocker'), 0)]);
        await expect(gatekeeper.processEvents()).resolves.toMatchObject({ pending: 1 });

        const batches = [[event(asset('deferred batch'), 1)], [event(agent, 2)]];
        type Item = DiscoveredItem | DiscoveredInscribedItem;
        const state: { discovered: Item[] } = {
            discovered: batches.map((events, index) => directory === 'satoshi'
                ? { height: 1, index: index + 1, time: events[0].time, txid: `transaction-${index + 1}`, did: `batch-${index}` }
                : { events }),
        };
        const client = {
            importBatch: gatekeeper.importBatch.bind(gatekeeper),
            processEvents: gatekeeper.processEvents.bind(gatekeeper),
        };
        const run = loadImportFunctions(
            new URL(`../../services/mediators/${directory}/src/${filename}`, import.meta.url),
            {
                REGISTRY: registry,
                gatekeeper: client,
                keymaster: {},
                resolveAnchoredBatchAsset: async (_client: unknown, did: string) => (
                    batches[Number(did.slice('batch-'.length))].map(item => item.operation)
                ),
                importEventBatch,
                loadDb: async () => structuredClone(state),
                jsonPersister: {
                    updateDb: async (mutate: (current: typeof state) => void) => mutate(state),
                },
            },
        );

        await expect(run()).resolves.toBe(true);
        expect(state.discovered[0].imported?.queued).toBe(1);
        expect(state.discovered[0].processed).toBeUndefined();
        expect(state.discovered[1].processed?.acceptedHashes).toContain(agent.signature!.hash);
        expect(await db.getAllKeys()).toHaveLength(2);

        await expect(run()).resolves.toBe(true);
        expect(state.discovered[0].processed?.acceptedHashes).toContain(batches[0][0].operation.signature!.hash);
        expect(await db.getAllKeys()).toHaveLength(3);
        expect(gatekeeper.getQueueStatus().total).toBe(0);
    });
});
