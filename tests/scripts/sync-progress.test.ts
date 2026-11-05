import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../../scripts/sync-progress.mjs', import.meta.url));

function render(input: string) {
    const result = spawnSync(process.execPath, [script], { input, encoding: 'utf8', timeout: 5_000 });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    return result.stdout;
}

describe('sync progress log filter', () => {
    it('combines chains and retains height and date when only progress is updated', () => {
        const output = render([
            'gatekeeper-1 | unrelated service output',
            "btc-node-1 | UpdateTip height=100 date='2026-01-02T03:04:05Z' progress=0.25",
            "tbtc-node-1| UpdateTip height=200 date='2026-01-03T03:04:05Z' progress=0.75",
            'btc-node-1 | UpdateTip progress=0.50',
        ].join('\n') + '\n');

        expect(output).toMatch(/OVERALL\s+\[[█░]+\]\s+62\.50%/);
        expect(output).toMatch(/btc-node\s+\[[█░]+\]\s+50\.00%\s+h=100\s+2026-01-02/);
        expect(output).toMatch(/tbtc-node\s+\[[█░]+\]\s+75\.00%\s+h=200\s+2026-01-03/);
        expect(output).not.toContain('unrelated');
    });

    it('marks a completed chain as synced', () => {
        expect(render('btc-node-1 | UpdateTip progress=1.000000\n'))
            .toMatch(/btc-node\s+\[[█░]+\]\s+100\.00%\s+✓ synced/);
    });

    it('ignores long malformed pipe-separated lines without excessive backtracking', () => {
        expect(render(`btc-node-1${'|'.repeat(300_000)} no sync information\n`)).toBe('');
    });
});
