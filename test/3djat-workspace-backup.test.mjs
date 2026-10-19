import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { backupRoot } from '../scripts/backup.mjs';
import { verifyCombined,restoreCombined } from '../src/workspace-backup.mjs';
import { RootGuard,recoverOperationalLock } from '../src/workspace.mjs';
import { Kernel } from '../src/kernel.mjs';
import { prepareRecord } from '../src/domain-store.mjs';
import { fixtureSpecifications } from '../src/adapters.mjs';
import { allocate,start,deliver } from './helpers.mjs';
import { prepared,adoption,PRODUCT,noop } from './fixtures/3djat/workspace-fixture.mjs';
const rejects=(fn,code)=>assert.throws(fn,e=>e.code===code,code),sha=b=>createHash('sha256').update(b).digest('hex');
const script=fileURLToPath(new URL('./fixtures/3djat/workspace-process.mjs',import.meta.url));
function child(mode,root,destination='',stage='',control='') {
  const c=spawn(process.execPath,[script,mode,root,destination,stage,control],{stdio:['ignore','pipe','pipe']});let buffer='',stderr='';const queue=[],waiting=[];
  c.stderr.on('data',x=>{stderr+=x;});c.stdout.on('data',b=>{buffer+=b;while(buffer.includes('\n')){const n=buffer.indexOf('\n'),m=JSON.parse(buffer.slice(0,n));buffer=buffer.slice(n+1);if(waiting.length)waiting.shift()(m);else queue.push(m);}});
  c.closed=once(c,'close');c.next=()=>queue.length?Promise.resolve(queue.shift()):new Promise((resolve,reject)=>{const timer=setTimeout(()=>{c.kill('SIGKILL');reject(new Error('Authored child timeout: '+stderr));},20000);waiting.push(m=>{clearTimeout(timer);resolve(m);});});return c;
}
function mapping(w,suffix='') {const businessRoot=path.join(w.dir,'restored-business'+suffix),runtimeRoot=path.join(w.dir,'restored-runtime'+suffix);return {businessRoot,runtimeRoot,paths:Object.fromEntries(Object.entries(w.store.workspace.paths).map(([k,v])=>[k,path.join(businessRoot,v)])),storage:'local-unsynced'};}
async function backed(t,attachment=true) {const w=prepared(t,{attachment});w.k.adoptWorkspace(w.c,adoption(w));w.backup=path.join(w.dir,'backup');await backupRoot(w.runtimeRoot,w.backup);return w;}

test('real backup child excludes competing domain and operational writer children, then completes coherently',async t=>{
  const w=prepared(t,{attachment:true});w.k.adoptWorkspace(w.c,adoption(w));const destination=path.join(w.dir,'backup'),control=path.join(w.dir,'continue');
  const owner=child('backup',w.runtimeRoot,destination,'backup-locked',control);
  try {
    assert.equal((await owner.next()).stage,'backup-locked');const domain=child('domain-write',w.domainRoot),operational=child('operational-write',w.runtimeRoot);
    assert.equal((await domain.next()).error,'LOCKED');assert.equal((await operational.next()).error,'OPERATIONAL_LOCKED');await domain.closed;await operational.closed;
    fs.writeFileSync(control,'continue');assert.equal((await owner.next()).complete,true);await owner.closed;assert.equal(verifyCombined(destination).head.sha256,w.store.read().reference.sha256);
  }finally{if(owner.exitCode===null){owner.kill('SIGKILL');await owner.closed;}}
});

test('real operational lock holder makes backup refuse before output allocation; recovery preserves its bytes',async t=>{
  const w=prepared(t);w.k.adoptWorkspace(w.c,adoption(w));const c=child('hold-operational',w.runtimeRoot,'','',path.join(w.dir,'never-continue'));
  try{assert.equal((await c.next()).locked,true);await assert.rejects(()=>backupRoot(w.runtimeRoot,path.join(w.dir,'refused')),e=>e.code==='OPERATIONAL_LOCKED');assert.equal(fs.existsSync(path.join(w.dir,'refused')),false);}
  finally{c.kill('SIGKILL');await c.closed;}
  const hash=sha(fs.readFileSync(path.join(w.runtimeRoot,'operational-write.lock')));
  rejects(()=>recoverOperationalLock(w.runtimeRoot,{expectedLockHash:hash,confirmedQuiescent:false}),'QUIESCENCE_REQUIRED');
  recoverOperationalLock(w.runtimeRoot,{expectedLockHash:hash,confirmedQuiescent:true});assert.ok(fs.readdirSync(path.join(w.runtimeRoot,'Recovery')).length);
  assert.equal(w.k.refreshDomain(w.c).status,'current');
});

test('combined restore preserves actual authored PNG originals, running attempt identity and existing acceptance',async t=>{
  const w=prepared(t,{attachment:true});w.k.adoptWorkspace(w.c,adoption(w));let original,acceptance,running;
  for(const [n,finish] of [[1,true],[2,false]]){
    const request=w.call('human','request.create',{projectId:PRODUCT,intent:'Authored offline fixture '+n,count:1});
    const i=w.call('conductor','iteration.commission',{requestId:request.id,specifications:fixtureSpecifications({brief:'Authored only',count:1})});const a=allocate(w,i.jobIds[0]);start(w,a);
    if(finish){deliver(w,a);w.k.reconcile(w.c.butler);original=w.k.read(w.c.human,'artifact').find(x=>x.iterationId===i.id);acceptance=w.call('human','design.accept',{artifactId:original.id,judgment:'accept'});}else running=w.k.read(w.c.human,'job').find(x=>x.id===i.jobIds[0]);
  }
  const before=sha(w.k.original(w.c.human,original.id)),destination=path.join(w.dir,'backup');await backupRoot(w.runtimeRoot,destination);
  const target=mapping(w);restoreCombined(destination,target);
  const db=new DatabaseSync(path.join(target.runtimeRoot,'workspace.sqlite'),{readOnly:true});try{const v=JSON.parse(db.prepare("SELECT doc FROM records WHERE kind='job' AND id=?").get(running.id).doc);assert.equal(v.state,'running');assert.equal(v.invocationsStarted,1);assert.equal(v.assignmentId,running.assignmentId);}finally{db.close();}
  const k=new Kernel(target.runtimeRoot,{recover:false});try{
    assert.equal(sha(k.original(w.c.human,original.id)),before);assert.deepEqual(k.read(w.c.human,'acceptance'),[acceptance]);assert.equal(k.read(w.c.human,'job').find(x=>x.id===running.id).state,'running');
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(target.runtimeRoot,'credentials.json'))),w.c);
  }finally{k.close();}
});

test('operational evidence is resolved by exact original SQLite record bytes, materialized and verified',async t=>{
  const w=prepared(t);w.k.adoptWorkspace(w.c,adoption(w));const ack=w.k.adoptWorkspace(w.c,adoption(w));
  const db=new DatabaseSync(path.join(w.runtimeRoot,'workspace.sqlite'),{readOnly:true});let raw;try{raw=Buffer.from(db.prepare("SELECT doc FROM records WHERE kind='workspaceAcknowledgement' AND id=?").get(ack.id).doc);}finally{db.close();}
  const ref={id:ack.id,revision:1,sha256:sha(raw),path:`Operational/workspaceAcknowledgement/${ack.id}.json`};
  const decision={schemaVersion:'3djat.template-decision.v1',decisionId:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',template:w.store.read().head.templates[0],action:'adopt',purpose:'Authored unresolved semantics; storage only',appliesTo:['authored-channel'],expectedRevision:1,experiment:null,outputs:[],evidenceReceipt:null,humanActionReceipt:ref,decidedAt:'2026-01-01T00:00:00.000Z',supersedesDecision:null,reason:'Authored cross-store byte reference, not actual approval'};
  const edit=noop(w.store.read().reference,'cross-evidence');edit.records=[{kind:'template-decision',record:decision}];w.store.commit(edit);
  const destination=path.join(w.dir,'backup');await backupRoot(w.runtimeRoot,destination);const m=verifyCombined(destination);assert.equal(m.evidence.length,1);assert.deepEqual(fs.readFileSync(path.join(destination,m.evidence[0].path)),raw);
  const target=mapping(w);restoreCombined(destination,target);assert.equal(verifyCombined(destination).complete,true);
});

for(const stage of ['copy-chunk','before-backup-manifest'])test(`safe ENOSPC at ${stage} leaves an explicitly incomplete preserved backup`,async t=>{
  const w=prepared(t,{attachment:true});w.k.adoptWorkspace(w.c,adoption(w));const before=w.store.read().reference,destination=path.join(w.dir,'interrupted');
  await assert.rejects(()=>backupRoot(w.runtimeRoot,destination,{hook(at){if(at===stage)throw Object.assign(new Error('Authored disk-full seam'),{code:'ENOSPC'});}}),e=>e.code==='ENOSPC');
  rejects(()=>verifyCombined(destination),'INCOMPLETE_BACKUP');assert.deepEqual(w.store.read().reference,before);assert.equal(w.k.refreshDomain(w.c).status,'current');
  await assert.rejects(()=>backupRoot(w.runtimeRoot,destination),e=>e.code==='DESTINATION_EXISTS');
});

test('missing required attachment is incomplete; external source absence is reported independently',async t=>{
  const w=prepared(t,{attachment:true});w.k.adoptWorkspace(w.c,adoption(w));fs.unlinkSync(path.join(w.domainRoot,w.attachmentRecord.location));
  const destination=path.join(w.dir,'incomplete');await assert.rejects(()=>backupRoot(w.runtimeRoot,destination),e=>e.code==='INCOMPLETE_BACKUP'&&e.detail.reason==='missing-attachment');
  rejects(()=>verifyCombined(destination),'INCOMPLETE_BACKUP');
});

test('multi-chunk attachment streaming preserves exact bytes without treating them as images',async t=>{
  const w=prepared(t,{attachment:true});w.k.adoptWorkspace(w.c,adoption(w));
  const bytes=Buffer.alloc(3*1024**2+7,0x51),a={...w.attachmentRecord,attachmentId:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',location:'Attachments/authored-large.bin',filename:'authored-large.bin',mime:'application/octet-stream',bytes:bytes.length,sha256:sha(bytes)};
  a.source={...a.source,sha256:a.sha256};fs.writeFileSync(path.join(w.domainRoot,a.location),bytes);
  const current=w.store.read(),p=structuredClone(current.records.get(current.head.products[0].dossier.path).value);p.revision++;p.attachments.push(prepareRecord('attachment',a).reference);
  const edit=noop(current.reference,'large-attachment');edit.changes=[{kind:'product',id:PRODUCT,expectedRevision:p.revision-1,record:p}];edit.records=[{kind:'attachment',record:a}];w.store.commit(edit);
  const destination=path.join(w.dir,'backup');await backupRoot(w.runtimeRoot,destination);const target=mapping(w);restoreCombined(destination,target);
  assert.equal(sha(fs.readFileSync(path.join(target.businessRoot,a.location))),a.sha256);assert.equal(verifyCombined(destination).attachments.length,2);
});

test('unresolved operational evidence prevents a complete-backup claim',async t=>{
  const w=prepared(t);w.k.adoptWorkspace(w.c,adoption(w));const edit=noop(w.store.read().reference,'missing-evidence');
  edit.records=[{kind:'template-decision',record:{schemaVersion:'3djat.template-decision.v1',decisionId:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',template:w.store.read().head.templates[0],action:'adopt',purpose:'Authored missing evidence',appliesTo:['authored-channel'],expectedRevision:1,experiment:null,outputs:[],evidenceReceipt:null,humanActionReceipt:{id:'absent-action',revision:1,path:'Operational/statement/absent-action.json',sha256:'a'.repeat(64)},decidedAt:'2026-01-01T00:00:00.000Z',supersedesDecision:null,reason:'Authored unverified data'}}];w.store.commit(edit);
  await assert.rejects(()=>backupRoot(w.runtimeRoot,path.join(w.dir,'incomplete')),e=>e.code==='INCOMPLETE_BACKUP');
});

test('corrupt payload/unsupported manifest and unknown existing restore destinations refuse',async t=>{
  const w=await backed(t),target=mapping(w),manifest=path.join(w.backup,'combined-backup.json'),saved=fs.readFileSync(manifest),m=JSON.parse(saved);
  fs.mkdirSync(target.runtimeRoot);fs.writeFileSync(path.join(target.runtimeRoot,'keep.txt'),'Authored preserve');rejects(()=>restoreCombined(w.backup,target),'DESTINATION_EXISTS');assert.equal(fs.existsSync(target.businessRoot),false);
  m.schemaVersion='3djat.combined-backup.v2';fs.writeFileSync(manifest,JSON.stringify(m));rejects(()=>verifyCombined(w.backup),'UNSUPPORTED_SCHEMA');fs.writeFileSync(manifest,saved);
  fs.appendFileSync(path.join(w.backup,'attachments',w.attachmentRecord.location),'changed');rejects(()=>verifyCombined(w.backup),'HASH_MISMATCH');
});

test('truncated completion manifest remains incomplete and cannot allocate restore roots',async t=>{
  const w=await backed(t),target=mapping(w);fs.writeFileSync(path.join(w.backup,'combined-backup.json'),'{');
  rejects(()=>verifyCombined(w.backup),'INCOMPLETE_BACKUP');rejects(()=>restoreCombined(w.backup,target),'INCOMPLETE_BACKUP');
  assert.equal(fs.existsSync(target.businessRoot),false);assert.equal(fs.existsSync(target.runtimeRoot),false);
});

for(const stage of ['domain-restored','operational-restored','before-restore-commit','before-restore-marker'])test(`restore interruption ${stage} preserves new partial roots and never overlays`,async t=>{
  const w=await backed(t),target=mapping(w);rejects(()=>restoreCombined(w.backup,target,{hook(at){if(at===stage)throw Object.assign(new Error('Authored denial'),{code:'EACCES'});}}),'EACCES');
  assert.equal(fs.existsSync(path.join(target.runtimeRoot,'combined-restore.json')),false);assert.deepEqual(w.store.read().reference,verifyCombined(w.backup).head);
  if(fs.existsSync(path.join(target.runtimeRoot,'restore-in-progress.json')))rejects(()=>new Kernel(target.runtimeRoot),'RESTORE_INCOMPLETE');
  rejects(()=>restoreCombined(w.backup,target),'DESTINATION_EXISTS');
});

test('Windows local paths, junction containment and combined restart/restore gate', {skip:process.platform!=='win32'},async t=>{
  const w=await backed(t),target=mapping(w);t.diagnostic(JSON.stringify({node:process.version,platform:process.platform,filesystemType:fs.statfsSync(w.dir).type,method:'local explicit roots; fsync/SQLite backup/readback; junction refusal'}));
  restoreCombined(w.backup,target);const k=new Kernel(target.runtimeRoot,{recover:false});try{assert.equal(k.read(w.c.human,'project')[0].folder,path.join(target.paths.products,PRODUCT));}finally{k.close();}
  assert.throws(()=>new RootGuard(w.domainRoot).locate('products',{directory:true}),e=>e.code==='PATH_CASE_MISMATCH');
  assert.throws(()=>new RootGuard(w.runtimeRoot).locate('C:/escape'),e=>e.code==='INVALID_RECORD');
  const outside=path.join(w.dir,'junction');fs.mkdirSync(outside);fs.symlinkSync(outside,path.join(w.domainRoot,'Attachments','escape'),'junction');
  assert.throws(()=>new RootGuard(w.domainRoot).read('Attachments/escape/anything'),e=>e.code==='UNSAFE_PATH');
});
