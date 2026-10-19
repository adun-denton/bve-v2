import test from 'node:test';import assert from 'node:assert/strict';import * as fs from 'node:fs';import * as path from 'node:path';import {randomUUID} from 'node:crypto';import {request} from 'node:http';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';import {DatabaseSync} from 'node:sqlite';
import {Kernel} from '../src/kernel.mjs';import {serve} from '../src/server.mjs';import {hash} from '../src/png.mjs';import {backupRoot} from '../scripts/backup.mjs';import {recoverOperationalLock} from '../src/workspace.mjs';import {importSetup,importPacket,commitPacket,png,chunk,PRODUCT} from './fixtures/3djat/import-fixture.mjs';import {setup,create,packet,proposal,decision,review} from './fixtures/3djat/products-fixture.mjs';
const success=r=>{assert.equal(r.schemaVersion,'3djat.result.v1',JSON.stringify(r));return r;};
const post=(app,token,bytes,cuts=[],headers={},route='/api/asset-import')=>new Promise((ok,no)=>{
  const req=request(app.origin+route,{method:'POST',headers:{authorization:'Bearer '+token,'content-length':bytes.length,...headers}},res=>{const chunks=[];res.on('data',b=>chunks.push(b));res.on('end',()=>{try{ok({status:res.statusCode,body:JSON.parse(Buffer.concat(chunks).toString('utf8'))});}catch(e){no(e);}});});req.on('error',no);
  (async()=>{let n=0;for(const end of cuts){req.write(bytes.subarray(n,end));n=end;await new Promise(ok=>setTimeout(ok,30));}req.end(bytes.subarray(n));})().catch(no);
});
test('actual HTTP stage/commit original and portable endpoints preserve Unicode and exact original bytes',async t=>{
  const w=importSetup(t),p=importPacket(w),raw=Buffer.from(JSON.stringify(p)),first=raw.indexOf(Buffer.from('آ')),plant=raw.indexOf(Buffer.from('🪴'));w.k.close();const app=await serve({root:w.runtime,port:0,imports:w.importOptions});w.k=app.kernel;
  try{
    const staged=await post(app,w.c.human,raw,[first+1,plant+1,plant+2,plant+3]);assert.equal(staged.status,200);success(staged.body);assert.deepEqual(await post(app,w.c.human,raw),staged);
    const c=commitPacket(w,staged.body,p),committed=await post(app,w.c.human,Buffer.from(JSON.stringify(c)));assert.equal(committed.status,200);success(committed.body);
    const a=committed.body.reference.id,headers={authorization:'Bearer '+w.c.human},original=await fetch(app.origin+'/api/original?id='+a,{headers});assert.equal(original.status,200);assert.equal(original.headers.get('content-type'),'image/png');assert.deepEqual(Buffer.from(await original.arrayBuffer()),png());
    const portable=await (await fetch(app.origin+'/api/import-portable?id='+a,{headers})).json();assert.deepEqual(Buffer.from(portable.original.bytes,'base64'),png());assert.equal(portable.declaration.filename,p.input.filename);assert.equal(portable.origin.provenance.origin,'import');assert.equal(portable.freshAcceptance,false);
    const view=await (await fetch(app.origin+'/api/import?id='+p.input.importId,{headers})).json();assert.deepEqual(view.declaration.payload,p.input);assert.equal(view.commitReceipt.reference.sha256,committed.body.receipt.sha256);assert.equal(view.artifactReference.reference.sha256,committed.body.reference.sha256);assert.equal(hash(Buffer.from(JSON.stringify(Object.fromEntries(Object.entries(view.artifactReference.payload).sort()))+'\n')),committed.body.reference.sha256);
    const before=w.store.read().reference,bad=Buffer.concat([raw.subarray(0,first),Buffer.from([0xff]),raw.subarray(first+2)]);assert.deepEqual(await post(app,w.c.human,bad),{status:400,body:{error:'Invalid UTF-8 request body'}});assert.deepEqual(w.store.read().reference,before);
    assert.equal((await post(app,w.c.human,Buffer.concat([raw.subarray(0,first),Buffer.from([0xf0,0x9f])]))).status,400);
    assert.equal((await post(app,w.c.human,Buffer.alloc(128*1024+1,0x20))).status,413);assert.equal((await post(app,w.c.human,raw,[],{origin:'https://foreign.invalid'})).status,403);assert.equal((await post(app,w.c.human,raw,[],{host:'foreign.invalid'})).status,403);assert.equal((await post(app,'invalid',raw)).status,409);
  }finally{await app.stop();}
});
for(const at of ['before-import-inbox','after-import-stage','after-import-verify','after-import-commit','before-import-response'])test(`safe IO/full-disk seam at ${at} keeps truthful publication and receipt replay`,t=>{
  let armed=false;const w=importSetup(t,{hook(stage){if(armed&&stage===at)throw Object.assign(new Error('Authored safe IO/full-disk fault'),{code:'ENOSPC'});}}),p=importPacket(w);let s,c,failed;
  if(['after-import-verify','after-import-commit'].includes(at)){s=success(w.k.assetCommand(w.c.human,p));c=commitPacket(w,s,p);armed=true;failed=w.k.assetCommand(w.c.human,c);}else{armed=true;failed=w.k.assetCommand(w.c.human,p);}
  assert.equal(failed.schemaVersion,'3djat.failure.v1');if(['after-import-stage','after-import-commit','before-import-response'].includes(at)){assert.equal(failed.error.code,'EXPORT_PENDING');assert(failed.error.evidence);}else assert.equal(failed.error.code,'CAPABILITY_UNAVAILABLE');
  armed=false;w.k.close();w.k=new Kernel(w.runtime,{imports:w.importOptions});s=success(w.k.assetCommand(w.c.human,p));c??=commitPacket(w,s,p);const r=success(w.k.assetCommand(w.c.human,c));assert.deepEqual(w.k.assetCommand(w.c.human,c),r);if(failed.error.evidence)assert.deepEqual(failed.error.evidence,at==='after-import-commit'?r.receipt:s.receipt);assert.equal(w.k.read(w.c.human,'artifact').length,1);assert.deepEqual(w.k.original(w.c.human,r.reference.id),png());assert.equal(w.k.read(w.c.human,'job').length,0);
});
for(const at of ['before-import-inbox','after-import-stage','after-import-verify','after-import-commit'])test(`real child-process kill at ${at} recovers original import ID without invented attempts`,t=>{
  const w=importSetup(t),p=importPacket(w);let s,c;if(['after-import-verify','after-import-commit'].includes(at)){s=success(w.k.assetCommand(w.c.human,p));c=commitPacket(w,s,p);}
  const file=path.join(w.dir,'authored-command.json');fs.writeFileSync(file,JSON.stringify(c??p));w.k.close();const run=spawnSync(process.execPath,[fileURLToPath(new URL('./fixtures/3djat/import-process.mjs',import.meta.url)),w.runtime,w.sourceRoot,file,at],{encoding:'utf8',timeout:15000});assert(run.signal||run.status!==0,'child must actually terminate at seam');
  assert.equal(fs.readFileSync(file+'.reached','utf8'),at); // Establish the actual crash boundary, not merely a nonzero child exit.
  // Explicit nonce/hash-checked owner recovery, only after confirming this disposable child exited.
  const domainLock=path.join(w.root,'domain-write.lock');if(fs.existsSync(domainLock))w.store.recoverLock({expectedLockHash:hash(fs.readFileSync(domainLock)),confirmedQuiescent:true});
  const operationalLock=path.join(w.runtime,'operational-write.lock');if(fs.existsSync(operationalLock))recoverOperationalLock(w.runtime,{expectedLockHash:hash(fs.readFileSync(operationalLock)),confirmedQuiescent:true});
  w.k=new Kernel(w.runtime,{imports:w.importOptions});s=success(w.k.assetCommand(w.c.human,p));c??=commitPacket(w,s,p);const result=success(w.k.assetCommand(w.c.human,c));assert.deepEqual(w.k.assetCommand(w.c.human,c),result);assert.equal(w.k.read(w.c.human,'artifact').length,1);assert.equal(w.k.read(w.c.human,'job').length,0);assert.deepEqual(w.k.original(w.c.human,result.reference.id),png());
});
test('import export interruption reports no completed portable output and preserves original identity',t=>{
  let armed=false;const w=importSetup(t,{hook(stage){if(armed&&stage==='before-import-export')throw Object.assign(new Error('Authored export fault'),{code:'EIO'});}}),p=importPacket(w),s=success(w.k.assetCommand(w.c.human,p)),r=success(w.k.assetCommand(w.c.human,commitPacket(w,s,p)));
  armed=true;assert.throws(()=>w.k.importPortable(w.c.human,r.reference.id));assert.deepEqual(w.k.original(w.c.human,r.reference.id),png());armed=false;assert.equal(w.k.importPortable(w.c.human,r.reference.id).original.sha256,p.input.sha256);
});
test('existing root opt-in refuses missing or stale backup, accepts verified exact backup and preserves old records',async t=>{
  const w=setup(t,{kernel:true});success(w.k.productCommand(w.c.human,create(w)));w.k.close();
  assert.throws(()=>new Kernel(w.runtime,{imports:{}}),e=>e.code==='MIGRATION_REQUIRES_BACKUP');assert.equal(JSON.parse(fs.readFileSync(path.join(w.runtime,'bve-v2-root.json'))).version,1);
  const stale=path.join(w.dir,'stale-backup');await backupRoot(w.runtime,stale);w.k=new Kernel(w.runtime,{products:{accessFile:w.accessFile}});success(w.k.productCommand(w.c.human,packet(w,'product.note.add',{productId:PRODUCT,text:'Authored change after backup'})));w.k.close();
  assert.throws(()=>new Kernel(w.runtime,{imports:{migrationBackup:stale,confirmedQuiescent:true}}),e=>e.code==='BACKUP_MISMATCH');
  const backup=path.join(w.dir,'before-imports');await backupRoot(w.runtime,backup);w.k=new Kernel(w.runtime,{imports:{migrationBackup:backup,confirmedQuiescent:true}});assert.equal(JSON.parse(fs.readFileSync(path.join(w.runtime,'bve-v2-root.json'))).version,2);assert.equal(w.k.read(w.c.human,'project')[0].id,PRODUCT);assert.equal(w.k.read(w.c.human,'artifact').length,0);
});
test('identical bytes in two products share storage but never product artifact or receipt authority',t=>{
  const w=importSetup(t),other=randomUUID();success(w.k.productCommand(w.c.human,create(w,{productId:other,productCode:'0008'})));
  const p=importPacket(w),s=success(w.k.assetCommand(w.c.human,p)),r=success(w.k.assetCommand(w.c.human,commitPacket(w,s,p))),q=importPacket(w,png(),{productId:other}),tStage=success(w.k.assetCommand(w.c.human,q)),u=success(w.k.assetCommand(w.c.human,commitPacket(w,tStage,q)));
  assert.notEqual(r.reference.id,u.reference.id);const db=new DatabaseSync(path.join(w.runtime,'workspace.sqlite'),{readOnly:true});try{assert.equal(db.prepare('SELECT count(*) AS n FROM bytes WHERE hash=?').get(p.input.sha256).n,1);}finally{db.close();}
  const c=commitPacket(w,tStage,q);c.input.stageReceipt=s.receipt;assert.equal(w.k.assetCommand(w.c.human,c).schemaVersion,'3djat.failure.v1');
});
test('exact encoded 24MiB succeeds with ancillary bytes intact; encoded bound plus one refuses',t=>{
  const w=importSetup(t),base=png({metadata:false}),padding=Buffer.alloc(24*1024**2-base.length-12,0x61);padding.write('Padding\0');const raw=Buffer.concat([base.subarray(0,-12),chunk('tEXt',padding),base.subarray(-12)]);assert.equal(raw.length,24*1024**2);
  const p=importPacket(w,raw),s=success(w.k.assetCommand(w.c.human,p)),r=success(w.k.assetCommand(w.c.human,commitPacket(w,s,p)));assert.deepEqual(w.k.original(w.c.human,r.reference.id),raw);
  const q=importPacket(w,Buffer.concat([raw,Buffer.from([0])]),{encodedBytes:raw.length});assert.equal(w.k.assetCommand(w.c.human,q).error.code,'UNSUPPORTED_IMAGE');
});
test('legacy JSON route shares strict Unicode decoding while retaining its envelope and cap',async t=>{
  const w=importSetup(t);w.k.close();const app=await serve({root:w.runtime,port:0});w.k=app.kernel;
  try{const name='گلدان 🪴 �',body=Buffer.from(JSON.stringify({op:'project.create',key:'authored-unicode-legacy',input:{name,brief:'Authored compatibility fixture'}})),split=body.indexOf(Buffer.from('گ'))+1;
    const result=await post(app,w.c.human,body,[split],{},'/api/op');assert.equal(result.status,200);assert.equal(result.body.name,name);assert.deepEqual(await post(app,w.c.human,body,[],{},'/api/op'),result);
    const count=w.k.read(w.c.human,'project').length;assert.equal((await post(app,w.c.human,Buffer.concat([body.subarray(0,split-1),Buffer.from([0xff]),body.subarray(split+1)]),[],{},'/api/op')).status,400);assert.equal(w.k.read(w.c.human,'project').length,count);
  }finally{await app.stop();}
});
test('bound Conductor import scope and principal receipts cannot cross product or caller',t=>{
  const w=importSetup(t),other=randomUUID();success(w.k.productCommand(w.c.human,create(w,{productId:other,productCode:'0008'})));
  const session=w.k.bindSession(w.c,{role:'conductor',tier:'SOL',sessionId:'authored-import-conductor',projectId:PRODUCT,nonce:'authored-import',hostReceipt:'Authored fixture only; not native readiness'}),p=importPacket(w),s=success(w.k.assetCommand(session.token,p)),c=commitPacket(w,s,p);
  assert.equal(w.k.assetCommand(w.c.human,c).error.code,'INVALID_SCOPE');const r=success(w.k.assetCommand(session.token,c));assert.deepEqual(w.k.original(session.token,r.reference.id),png());
  const q=importPacket(w,png(),{productId:other});assert.equal(w.k.assetCommand(session.token,q).error.code,'INVALID_SCOPE');assert.equal(w.k.assetCommand(w.source.token,p).error.code,'INVALID_SCOPE');
});
test('Windows local filesystem stage/commit/reopen and separate backup restore preserves exact import', {skip:process.platform!=='win32'},async t=>{
  const w=importSetup(t),p=importPacket(w),s=success(w.k.assetCommand(w.c.human,p)),r=success(w.k.assetCommand(w.c.human,commitPacket(w,s,p)));w.k.close();w.k=new Kernel(w.runtime);assert.deepEqual(w.k.original(w.c.human,r.reference.id),png());
  const backup=path.join(w.dir,'windows-backup');await backupRoot(w.runtime,backup);const {restoreCombined}=await import('../src/workspace-backup.mjs'),businessRoot=path.join(w.dir,'windows-restored-business'),runtimeRoot=path.join(w.dir,'windows-restored-runtime'),paths=Object.fromEntries(Object.entries(w.store.workspace.paths).map(([k,v])=>[k,path.join(businessRoot,v)]));restoreCombined(backup,{businessRoot,runtimeRoot,paths});const k=new Kernel(runtimeRoot);try{assert.deepEqual(k.original(w.c.human,r.reference.id),png());assert.equal(k.importReview(w.c.human,p.input.importId).stage.state,'committed');}finally{k.close();}
});
