// Authored-only retention controls. Private roots intentionally survive failed runs.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as readline from 'node:readline';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {png} from './fixtures/3djat/import-fixture.mjs';
import {acquireOperational} from '../src/workspace.mjs';
import {digest,runChild} from '../scripts/img20-evidence.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const json=p=>JSON.parse(fs.readFileSync(p));
const root=path.resolve('.');
const retained=[];
function area(){const d=fs.mkdtempSync(path.join(os.tmpdir(),'img20-r1a-authored-'));fs.chmodSync(d,0o700);retained.push(d);return d;}
async function until(fn){const deadline=Date.now()+30000;while(!fn()){if(Date.now()>deadline)throw Error('Authored control deadline');await sleep(20);}}
function child(args){const p=spawn(process.execPath,args,{cwd:root,stdio:['pipe','pipe','pipe']});let stderr='';p.stderr.on('data',b=>stderr+=b);const done=once(p,'close').then(([code,signal])=>({code,signal,stderr}));return {p,done};}
async function worker(control){const d=area();fs.writeFileSync(d+'/input.json',JSON.stringify({disposableExperiment:true,files:[]}));const c=child(['scripts/img20-worker.mjs',d+'/input.json',d+'/worker',...(control?[control]:[])]);const lines=readline.createInterface({input:c.p.stdout})[Symbol.asyncIterator]();const ready=JSON.parse((await lines.next()).value);assert.ok(ready.credential);return {...c,d,ready,lines};}
async function closed(origin){await assert.rejects(fetch(origin+'/api/state'));}
function screen(raw,credential){assert.ok(!raw.includes(credential));assert.doesNotMatch(raw,/Bearer\s+\S+|"credentials"\s*:|"bytes"\s*:\s*"[A-Za-z0-9+/]{80}/);}
async function controller(mode,{large=false,twenty=false}={}){
 const d=area(),bytes=png(twenty?{width:5000,height:4000}:large?{width:4946,height:3278}:{}),source=d+'/authored.png';fs.writeFileSync(source,bytes);fs.writeFileSync(d+'/outside-sentinel','outside unchanged');
 const input={path:source,sha256:digest(bytes),width:twenty?5000:large?4946:8,height:twenty?4000:large?3278:6};fs.writeFileSync(d+'/inputs.json',JSON.stringify(Array.from({length:large?13:1},()=>input)));
 const p=spawn('python',['test/fixtures/3djat/img20-controller.py',d,mode],{cwd:root,stdio:['ignore','pipe','pipe']});let output='';p.stdout.on('data',b=>output+=b);p.stderr.on('data',b=>output+=b);const done=once(p,'close').then(([code,signal])=>({code,signal,output}));return {d,p,done,source,hash:digest(bytes)};
}
function retainedState(d){const v=json(d+'/controller/result.json'),w=json(d+'/controller/worker/lifecycle.json');assert.equal(v.IMG20,'OPEN');assert.equal(v.worker.exit,'CONFIRMED');assert.ok(fs.existsSync(w.roots.runtime));assert.ok(fs.existsSync(w.roots.business));assert.match(w.cleanup,/RETAINED/);assert.ok(v.lastCheckpoint.sha256);assert.ok(w.lastCheckpoint.sha256);return {v,w};}
test('successful worker removes its allocated roots and closes its listener',async()=>{
 const c=await worker();c.p.stdin.end('{"op":"stop"}\n');assert.equal((await c.done).code,0);const w=json(c.d+'/worker/lifecycle.json');assert.equal(w.status,'SUCCEEDED');assert.equal(w.cleanup,'SUCCESS ROOTS REMOVED');assert.equal(fs.existsSync(w.roots.allocation),false);await closed(c.ready.origin);screen(JSON.stringify(w),c.ready.credential);
});
test('setup parse failure leaves a retrievable lifecycle and no invented roots',async()=>{
 const d=area();fs.writeFileSync(d+'/input.json','{');const c=child(['scripts/img20-worker.mjs',d+'/input.json',d+'/worker']);c.p.stdout.resume();assert.equal((await c.done).code,1);const w=json(d+'/worker/lifecycle.json');assert.equal(w.status,'FAILED');assert.equal(w.roots.runtime,null);assert.equal(w.firstError.code,'SyntaxError');
});
test('protocol failure preserves first error when checkpoint publication also fails',async()=>{
 const c=await worker();fs.mkdirSync(c.d+'/worker/lifecycle.json.next');c.p.stdin.end('{\n');assert.equal((await c.done).code,1);const w=json(c.d+'/worker/failure.json');assert.equal(w.firstError.code,'SyntaxError');assert.ok(w.secondaryErrors.some(e=>e.code==='EISDIR'));assert.ok(fs.existsSync(w.roots.runtime));await closed(c.ready.origin);screen(JSON.stringify(w),c.ready.credential);
});
test('owned child timeout reports exit confirmation without claiming a reached boundary',async()=>{
 let started;const c=await runChild(['test/fixtures/3djat/img20-negative-child.mjs','--authored-timeout'],{timeoutMs:100,onStart:row=>{started=structuredClone(row);}});assert.equal(started.exit,'UNKNOWN');assert.ok(started.pid);assert.equal(c.timedOut,true);assert.equal(c.exit,'CONFIRMED');assert.equal(c.signal,'SIGTERM');assert.equal(c.stdout,'');
});
test('held active owner lock survives thirteen HTTP identities and separate backup/restore', {skip:process.platform!=='linux'},async()=>{
 const c=await controller('held-lock',{large:true});await until(()=>fs.existsSync(c.d+'/backup-ready.json'));const ready=json(c.d+'/backup-ready.json'),release=acquireOperational(ready.runtime);const file=path.join(ready.runtime,'operational-write.lock'),lock=fs.readFileSync(file);fs.writeFileSync(c.d+'/continue','');assert.equal((await c.done).code,1);
 const {v,w}=retainedState(c.d);assert.equal(v.status,'BLOCKED');assert.equal(w.firstError.code,'OPERATIONAL_LOCKED');assert.equal(v.firstError.code,'OPERATIONAL_LOCKED');assert.equal(v.records.length,13);assert.equal(new Set(v.records.map(r=>r.importId)).size,13);assert.equal(new Set(v.records.map(r=>r.sha256)).size,1);assert.equal(v.backup.restored.length,13);assert.equal(v.beforeBackup.counts.artifact,13);assert.equal(v.beforeBackup.counts.importReceipt,26);assert.equal(v.beforeBackup.counts.job,0);for(let i=1;i<=13;i++)assert.equal(digest(fs.readFileSync(path.join(w.roots.source,`image-${i}.png`))),c.hash);assert.ok(v.completed.some(x=>x.phase==='backup-restore'));assert.equal(w.children[0].marker.status,'ABSENT');assert.equal(w.children[0].reached,false);assert.match(w.children[0].stderr,/OPERATIONAL_LOCKED/);assert.notEqual(w.children[0].status,0);assert.deepEqual(fs.readFileSync(file),lock);assert.equal(digest(fs.readFileSync(c.source)),c.hash);assert.equal(fs.readFileSync(c.d+'/outside-sentinel','utf8'),'outside unchanged');
 for(const row of w.locks.filter(r=>r.file===file)){assert.equal(row.sha256,digest(lock));assert.deepEqual(fs.readFileSync(row.copy),lock);}
 assert.ok(fs.existsSync(w.roots.backup));assert.ok(fs.existsSync(w.roots.restoredRuntime));await closed(ready.origin);screen(JSON.stringify({v,w}),json(path.join(w.roots.runtime,'credentials.json')).human);
 // Keep active owner evidence; release is intentionally not called. Parent owns the lock until this test process exits.
 assert.equal(typeof release,'function');
});
for(const mode of ['missing-marker','timeout','secondary'])test('controller retains completed transport and backup after '+mode,{skip:process.platform!=='linux'},async()=>{
 const c=await controller(mode);const exit=await c.done;assert.equal(exit.code,1);const {v,w}=retainedState(c.d);assert.equal(v.records.length,1);assert.equal(v.backup.restored.length,1);assert.ok(v.completed.some(x=>x.phase==='backup-restore'));assert.equal(w.children[0].marker.status,'ABSENT');assert.equal(w.children[0].reached,false);assert.equal(w.children[0].exit,'CONFIRMED');assert.equal(fs.existsSync(c.d+'/controller/worker/recovery-results.json'),false);
 if(mode==='timeout'){assert.equal(w.firstError.code,'CHILD_TIMEOUT');assert.equal(w.children[0].timedOut,true);}else {assert.equal(w.firstError.code,'BOUNDARY_NOT_REACHED');assert.equal(w.children[0].status,23);assert.match(w.children[0].stderr,/AUTHORED_PRE_BOUNDARY_FAILURE/);}
 if(mode==='secondary')assert.ok(w.secondaryErrors.some(e=>e.code==='EBADF'));
 const token=json(path.join(w.roots.runtime,'credentials.json')).human;screen(exit.output,token);screen(JSON.stringify({v,w}),token);await closed(w.origin);
});
test('interrupted controller preserves its completed backup and closes the owned worker',{skip:process.platform!=='linux'},async()=>{
 const c=await controller('interrupt');await until(()=>fs.existsSync(c.d+'/backup-ready.json'));c.p.kill('SIGTERM');assert.equal((await c.done).code,1);const {v,w}=retainedState(c.d);assert.equal(v.status,'INTERRUPTED');assert.equal(w.status,'INTERRUPTED');assert.ok(v.completed.some(x=>x.phase==='backup-restore'));await closed(w.origin);
});
test('controller protocol timeout retains its checkpoint and records confirmed shutdown',{skip:process.platform!=='linux'},async()=>{
 const c=await controller('protocol-timeout');assert.equal((await c.done).code,1);const v=json(c.d+'/controller/result.json');assert.equal(v.status,'FAILED');assert.equal(v.firstError.code,'TimeoutError');assert.equal(v.worker.exit,'CONFIRMED');assert.ok(v.lastCheckpoint.sha256);assert.equal(v.verdict,undefined);
});
test('successful 20MP worker verifies all four actual kill/replays without leaving a listener',{skip:process.platform!=='linux'},async()=>{
 const c=await controller('positive',{twenty:true});assert.equal((await c.done).code,0);const v=json(c.d+'/controller/result.json'),w=json(c.d+'/controller/worker/lifecycle.json');assert.equal(v.status,'SUCCEEDED');assert.equal(w.status,'SUCCEEDED');assert.equal(v.recovery.length,4);assert.equal(v.statusResult.counts.artifact,5);assert.equal(v.statusResult.counts.importReceipt,10);assert.equal(v.statusResult.counts.job,0);assert.ok(v.recovery.every(r=>r.reached&&r.sha256===c.hash));assert.equal(w.cleanup,'SUCCESS ROOTS RETAINED BY CONTROLLER');await closed(w.origin);
});
test('unsupported controller host is explicit before collector or worker launch',{skip:process.platform!=='linux'},async()=>{
 const c=await controller('unsupported-host');assert.equal((await c.done).code,1);const v=json(c.d+'/controller/result.json');assert.equal(v.status,'FAILED');assert.match(v.firstError.message,/UNSUPPORTED_HOST/);assert.equal(v.worker.pid,null);assert.equal(v.worker.exit,'UNKNOWN');assert.equal(fs.existsSync(c.d+'/controller/os-memory.ndjson'),false);
});
test('checkpoint error immediately after spawn still stops and confirms its owned child',async()=>{
 const c=await runChild(['test/fixtures/3djat/img20-negative-child.mjs','--authored-timeout'],{onStart:()=>{throw Object.assign(Error('Authored checkpoint write error'),{code:'EIO'});}});assert.equal(c.error.code,'EIO');assert.equal(c.exit,'CONFIRMED');assert.equal(c.signal,'SIGTERM');
});
test('controller result construction failure retains successful imports and backup',{skip:process.platform!=='linux'},async()=>{
 const c=await controller('bad-budgets');assert.equal((await c.done).code,1);const v=json(c.d+'/controller/result.json'),w=json(c.d+'/controller/worker/lifecycle.json');assert.equal(v.status,'FAILED');assert.equal(v.firstError.code,'KeyError');assert.equal(v.worker.exit,'CONFIRMED');assert.equal(v.records.length,1);assert.equal(v.backup.restored.length,1);assert.equal(v.verdict,undefined);assert.ok(fs.existsSync(w.roots.runtime));assert.equal(w.cleanup,'SUCCESS ROOTS RETAINED BY CONTROLLER');await closed(w.origin);
});
test.after(()=>{
 // The opt-in index contains private locators only; no DB or credentials in TAP.
 if(process.env.IMG20_AUTHORED_LOCATORS)fs.writeFileSync(process.env.IMG20_AUTHORED_LOCATORS,JSON.stringify({authoredOnly:true,retained},null,2),{mode:0o600});
});
