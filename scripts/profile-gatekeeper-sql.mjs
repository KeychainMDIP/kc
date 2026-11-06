// Diagnostic adapter benchmark. Build packages before running.
// PROFILE_POSTGRES_URL=<disposable-cluster> node scripts/profile-gatekeeper-sql.mjs
// PostgreSQL requires pg_stat_statements with track_planning, track_io_timing and
// track_wal_io_timing enabled. fsync and synchronous_commit must remain on.
// Prepared statements, removed secondary indexes, fillfactor and commit groups are
// fixture-only experiments. Batch mode bypasses Gatekeeper validation and is not
// a production implementation. All results are written to PROFILE_OUTPUT_DIR.
// Rows are synthetic adapter records, not cryptographically verified operations.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import pg from 'pg';
import Current from '../packages/gatekeeper/dist/esm/db/postgres.js';

// Run only against a dedicated fixture started with cluster_name=kc_event_profile.
// This resets fixture statistics and creates/drops only its own random schemas.
const appRoot = fileURLToPath(new URL('../', import.meta.url));
const root = pathToFileURL(path.resolve(process.env.PROFILE_OUTPUT_DIR || '.agents/plans/artifacts/event-processing-20261106') + '/');
fs.mkdirSync(root, { recursive: true });
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'kc-event-profile-'));
fs.writeFileSync(path.join(temporary, 'package.json'), JSON.stringify({ type: 'module' }));
fs.symlinkSync(path.join(appRoot, 'node_modules'), path.join(temporary, 'node_modules'), 'dir');
for (const file of ['index-export.js', 'health.js']) fs.copyFileSync(path.join(appRoot, 'packages/gatekeeper/dist/esm/db', file), path.join(temporary, file));
const baseline = process.env.PROFILE_BASELINE_REVISION || 'e2aec5a4';
// Baseline source is local repository code, never data received from a peer.
// eslint-disable-next-line sonarjs/no-os-command-from-path
const source = process.env.PROFILE_BASELINE_FILE ? fs.readFileSync(process.env.PROFILE_BASELINE_FILE, 'utf8') : execFileSync('git', ['show', `${baseline}:packages/gatekeeper/src/db/postgres.ts`], { cwd: appRoot, encoding: 'utf8' });
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
fs.writeFileSync(path.join(temporary, 'legacy.js'), compiled);
const Legacy = (await import(pathToFileURL(path.join(temporary, 'legacy.js')))).default;
const url = process.env.PROFILE_POSTGRES_URL;
assert(url, 'PROFILE_POSTGRES_URL must point to the disposable profile server');
const admin = new pg.Pool({connectionString:url});
const modes = (process.env.PROFILE_MODES || 'main,indexed,main-prepared,indexed-prepared,indexed-no-secondary,indexed-no-secondary-prepared,indexed-fill80,indexed-batch100').split(',');
assert(modes.every(mode => ['main','indexed','main-prepared','indexed-prepared','indexed-no-secondary','indexed-no-secondary-prepared','indexed-fill80','indexed-batch100'].includes(mode)), 'Unknown profile mode');
const samples = Number(process.env.PROFILE_ROWS || 500);
const rounds = Number(process.env.PROFILE_ROUNDS || 3);
assert(Number.isSafeInteger(samples) && samples > 0 && Number.isSafeInteger(rounds) && rounds > 0, 'Positive integer sample counts required');
const results=[]; const plans=[];
let serial=0;
function event(id, kind, options={}) {
    const type=kind.includes('asset')?'asset':'agent';
    const mdip={version:1,type,registry:'hyperswarm',...(options.expiring&&{validUntil:'2099-01-01T00:00:00.000Z'})};
    const operation=kind.includes('update')?{type:'update',did:`did:test:${id}`,doc:{mdip,didDocument:{id:`did:test:${id}`,controller:options.controller||'did:test:zController'},didDocumentData:{value:'x'.repeat(1024),n:serial++}}}:{type:'create',created:'2026-01-01T00:00:00.000Z',mdip,...(type==='asset'?{controller:'did:test:zController',data:{value:'x'.repeat(1024)}}:{publicJwk:{kty:'EC',crv:'secp256k1',x:'x'.repeat(43),y:'y'.repeat(43)}})};
    operation.signature={signed:'2026-01-01T00:00:00.000Z',hash:String(serial++).padStart(64,'0'),value:'a'.repeat(128)};
    return {did:`did:test:${id}`,opid:`zOperation${serial}`,registry:'hyperswarm',time:'2026-01-01T00:00:00.000Z',operation};
}
function tableStats(schema){return admin.query(`SELECT relname,n_tup_ins,n_tup_upd,n_tup_hot_upd,n_tup_del FROM pg_stat_user_tables WHERE schemaname=$1`,[schema]).then(r=>Object.fromEntries(r.rows.map(v=>[v.relname,v])));}
async function resetStats(db){
    await db.pool.query('SELECT pg_stat_force_next_flush()');
    await admin.query('CHECKPOINT');
    await admin.query('SELECT pg_stat_statements_reset()');
    await admin.query("SELECT pg_stat_reset_shared('wal')");
}
try {
    const settings = (await admin.query("SELECT current_setting('cluster_name') cluster, current_setting('fsync') fsync, current_setting('synchronous_commit') synchronous_commit, current_setting('pg_stat_statements.track_planning') planning")).rows[0];
    assert.equal(settings.cluster, 'kc_event_profile', 'Refusing to profile a non-fixture cluster');
    assert.equal(settings.fsync, 'on'); assert.equal(settings.synchronous_commit, 'on'); assert.equal(settings.planning, 'on');
    fs.writeFileSync(new URL('sql-metadata.json', root), JSON.stringify({ baseline, modes, samples, rounds, node: process.version, settings, startedAt: new Date().toISOString() }, null, 2));
    for(let round=0;round<rounds;round++) {
        const order=round%2?[...modes].reverse():modes;
        for(const mode of order){
            const schema='profile_'+randomUUID().replaceAll('-','');
            // Schema names below contain only a fixed prefix and UUID hex digits.
            // eslint-disable-next-line sonarjs/sql-queries
            await admin.query(`CREATE SCHEMA "${schema}"`);
            const local=new URL(url);local.searchParams.set('options',`-c search_path=${schema},public`);
            process.env.KC_POSTGRES_URL=local.toString();process.env.KC_POSTGRES_POOL_MAX='1';
            const db=new (mode.startsWith('main')?Legacy:Current)('bench');
            await db.start();
            if(mode.startsWith('indexed-no-secondary'))for(const name of ['gatekeeper_lifecycle_due','gatekeeper_lifecycle_controller','gatekeeper_lifecycle_unresolved'])await db.pool.query(`DROP INDEX ${name}`);
            if(mode==='indexed-fill80')await db.pool.query('ALTER TABLE gatekeeper_lifecycle SET(fillfactor=80)');
            const query=db.pool.query.bind(db.pool);let explain=false;let captured;
            db.pool.query=async function(text,values,...rest){
                if(typeof text==='string'&&text.trimStart().startsWith('WITH inserted_event AS')){
                    if(explain){
                        const response=await query(`EXPLAIN(ANALYZE,BUFFERS,WAL,SETTINGS,FORMAT JSON) ${text}`,values);
                        captured=response.rows[0]['QUERY PLAN'][0];return {rows:[{length:1}],rowCount:1};
                    }
                    if(mode.endsWith('prepared'))return query({name:'profile_append',text,values});
                }
                return query(text,values,...rest);
            };
            try{
                for(let n=0;n<50;n++){const e=event('zWarm'+n,'asset');await db.addEvent(e.did,e);}
                for(const phase of ['agent-create','expiring-agent-create','asset-create','asset-update-data','asset-update-metadata']){
                    const batch=[];
                    for(let n=0;n<samples;n++){
                        const suffix=phase.includes('update')?'zAsset'+n:'z'+phase.replaceAll('-','')+n;
                        batch.push(event(suffix,phase,{expiring:phase.startsWith('expiring')||phase.endsWith('metadata'),...(phase.endsWith('metadata')&&{controller:'did:test:zOtherController'})}));
                    }
                    // Updates use the exact assets inserted by the preceding create phase.
                    if(phase==='asset-create')for(let n=0;n<samples;n++)batch[n]=event('zAsset'+n,'asset-create');
                    await db.pool.query('SELECT pg_stat_force_next_flush()');
                    await admin.query('SELECT pg_stat_clear_snapshot()');
                    const before=await tableStats(schema);
                    await resetStats(db);
                    const began=performance.now();
                    if (mode === 'indexed-batch100') {
                        const client = await db.pool.connect();
                        try {
                            for (let offset = 0; offset < batch.length; offset += 100) {
                                await client.query('BEGIN');
                                try {
                                    for (const e of batch.slice(offset, offset + 100)) assert.equal(await db.addEventStrict(client, e.did, e.did.split(':').pop(), e), 1);
                                    await client.query('COMMIT');
                                } catch (error) { await client.query('ROLLBACK'); throw error; }
                            }
                        } finally { client.release(); }
                    } else {
                        for(const e of batch)assert.equal(await db.addEvent(e.did,e),1);
                    }
                    const wallMs=performance.now()-began;
                    await db.pool.query('SELECT pg_stat_force_next_flush()');
                    await admin.query('SELECT pg_stat_clear_snapshot()');
                    const stats=await admin.query(`SELECT sum(calls)::integer calls,sum(plans)::integer plans,sum(total_plan_time) plan_ms,sum(total_exec_time) execute_ms,sum(wal_records)::bigint wal_records,sum(wal_fpi)::bigint wal_fpi,sum(wal_bytes)::bigint wal_bytes,sum(shared_blks_dirtied)::bigint dirtied,sum(shared_blks_written)::bigint written FROM public.pg_stat_statements WHERE ltrim(query) LIKE 'WITH inserted_event AS (%'`);
                    assert.equal(stats.rows[0].calls,samples);
                    const wal=(await admin.query('SELECT wal_write,wal_sync,wal_write_time,wal_sync_time FROM pg_stat_wal')).rows[0];
                    const after=await tableStats(schema);
                    const lifecycle=after.gatekeeper_lifecycle; const prev=before.gatekeeper_lifecycle;
                    const row={round:round+1,mode,phase,rows:samples,wallMs,...stats.rows[0],wal, lifecycle:lifecycle?{inserts:Number(lifecycle.n_tup_ins)-Number(prev?.n_tup_ins||0),updates:Number(lifecycle.n_tup_upd)-Number(prev?.n_tup_upd||0),hotUpdates:Number(lifecycle.n_tup_hot_upd)-Number(prev?.n_tup_hot_upd||0),deletes:Number(lifecycle.n_tup_del)-Number(prev?.n_tup_del||0)}:null};
                    results.push(row);console.log(JSON.stringify(row));
                    const id='zExplain'+phase.replaceAll('-','')+round;
                    if(phase.includes('update')){const e=event(id,'asset-create');await db.addEvent(e.did,e);}
                    explain=true;
                    const e=event(id,phase,{expiring:phase.startsWith('expiring')||phase.endsWith('metadata'),...(phase.endsWith('metadata')&&{controller:'did:test:zOtherController'})});
                    assert.equal(await db.addEvent(e.did,e),1);explain=false;
                    plans.push({round:round+1,mode,phase,plan:captured});
                }
                const count=(await db.pool.query('SELECT count(*)::integer n FROM gatekeeper_events')).rows[0].n;
                assert.equal(count,50+5*samples+7);
            } finally {
                await db.stop();
                // eslint-disable-next-line sonarjs/sql-queries
                await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
            }
        }
    }
}finally{
    await admin.end();fs.rmSync(temporary, { recursive: true, force: true });fs.writeFileSync(new URL('sql-results.json',root),JSON.stringify(results,null,2));fs.writeFileSync(new URL('sql-explain.json',root),JSON.stringify(plans,null,2));
}
