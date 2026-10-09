#!/usr/bin/env node
/**
 * mdip-sync-progress.mjs
 * --------------------------------------------------------------------------
 * Collapses the firehose of Bitcoin Core "UpdateTip ... progress=" log lines
 * emitted by `docker compose up` into ONE tidy multi-bar progress display
 * (plus a single combined bar across all chains).
 *
 * Bitcoin Core prints one UpdateTip line PER BLOCK during initial block
 * download. Each line already contains `progress=<0..1>`, so we just keep the
 * latest value per container and redraw in place.
 *
 * Zero config, zero dependencies. Just pipe the compose output into it.
 *
 *   USAGE
 *   -----
 *   # against a running stack:
 *   docker compose logs -f | node mdip-sync-progress.mjs
 *
 *   # or wrap start-node directly:
 *   ./start-node | node mdip-sync-progress.mjs
 *
 * Only lines containing `progress=` are consumed; everything else is ignored,
 * so Gatekeeper/Keymaster/IPFS logs won't pollute the view.
 * --------------------------------------------------------------------------
 */

import readline from 'node:readline';

const PROGRESS_RE = /^(\S+?)\s*\|.*?\bprogress=([0-9.]+)/;
const HEIGHT_RE   = /\bheight=(\d+)/;
const DATE_RE     = /\bdate='([^']+)'/;
const BAR_WIDTH   = 28;

const chains = new Map();      // name -> { progress, height, date }
let lastLines = 0;
let dirty = false;

const rl = readline.createInterface({ input: process.stdin, terminal: false });

rl.on('line', (line) => {
  const m = PROGRESS_RE.exec(line);
  if (!m) return;                                  // not a sync line, skip
  const name = m[1].replace(/-1$/, '');            // btc-node-1 -> btc-node
  const progress = parseFloat(m[2]);
  const h = HEIGHT_RE.exec(line);
  const d = DATE_RE.exec(line);
  const prev = chains.get(name) || {};
  chains.set(name, {
    progress,
    height: h ? h[1] : prev.height,
    date:   d ? d[1].slice(0, 10) : prev.date,
  });
  dirty = true;
});

function bar(p, width = BAR_WIDTH) {
  const filled = Math.max(0, Math.min(width, Math.round(p * width)));
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

function render() {
  if (!dirty) return;
  dirty = false;

  const names = [...chains.keys()].sort();
  const overall = names.length
    ? names.reduce((s, n) => s + chains.get(n).progress, 0) / names.length
    : 0;

  const lines = [];
  lines.push('Syncing MDIP backing chains…');
  lines.push('');
  lines.push(`OVERALL      [${bar(overall)}] ${(overall * 100).toFixed(2).padStart(6)}%`);
  lines.push('');
  for (const name of names) {
    const c = chains.get(name);
    const done = c.progress >= 0.99995;
    const pct = (c.progress * 100).toFixed(c.progress < 0.01 ? 4 : 2);
    const tail = done ? '✓ synced' : `h=${c.height ?? '?'}  ${c.date ?? ''}`;
    lines.push(`${name.padEnd(12)} [${bar(c.progress)}] ${pct.padStart(7)}%  ${tail}`);
  }

  // Redraw in place: jump cursor up over the previous block, clear each line.
  if (lastLines > 0) process.stdout.write(`\x1b[${lastLines}A`);
  process.stdout.write(lines.map((l) => l + '\x1b[K').join('\n') + '\n');
  lastLines = lines.length;
}

setInterval(render, 200).unref();
rl.on('close', () => { render(); process.exit(0); });
