import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import {verifyPNG,hash} from '../src/png.mjs';
import {Kernel} from '../src/kernel.mjs';
import {serve} from '../src/server.mjs';
import {backupRoot} from '../scripts/backup.mjs';
import {restoreCombined,verifyCombined} from '../src/workspace-backup.mjs';
import {recoverOperationalLock} from '../src/workspace.mjs';
import {fixtureSpecifications,capabilities} from '../src/adapters.mjs';
import {importSetup,importPacket,commitPacket,png,chunk,PRODUCT} from './fixtures/3djat/import-fixture.mjs';
const candidate={maxPixels:20_000_000};
const success=r=>{assert.equal(r.schemaVersion,'3djat.result.v1',JSON.stringify(r));return r;};
const imported=(w,raw,extra={})=>{const p=importPacket(w,raw,extra),s=success(w.k.assetCommand(w.c.human,p)),c=commitPacket(w,s,p),r=success(w.k.assetCommand(w.c.human,c));return {p,s,c,r};};
for(const color of [0,2,4,6])test(`authored channel ${color}: full resolution and exact candidate ceiling`,()=>{
  for(const [width,height] of [[4946,3278],[5000,4000]]){
    const b=png({width,height,color,metadata:false});assert.equal(verifyPNG(b,candidate).width,width);
    assert.throws(()=>verifyPNG(b),/16000000 pixels/);
  }
});
test('narrow and tall boundaries include row-filter allocation; over-cap IHDR rejects before inflate',()=>{
  for(const [width,height] of [[20_000_000,1],[1,20_000_000],[3,6_666_666]]){
    const b=png({width,height,color:6,metadata:false});assert.equal(verifyPNG(b,candidate).height,height);
  }
  const h=Buffer.alloc(13);h.writeUInt32BE(3);h.writeUInt32BE(6_666_667,4);h[8]=8;h[9]=6;
  const b=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',h),chunk('IDAT',Buffer.from('not deflate')),chunk('IEND',Buffer.alloc(0))]);
  assert.throws(()=>verifyPNG(b,candidate),/20000000 pixels/);
  assert.throws(()=>verifyPNG(png({width:3,height:6_666_667,color:6,metadata:false}),candidate),/20000000 pixels/);
  assert.throws(()=>verifyPNG(png(),{maxPixels:20_000_001}),/Invalid PNG pixel limit/);
});
test('noisy below/at/above encoded boundary and malformed payloads remain bounded',()=>{
  // Fixed xorshift pixels, authored independently; no private/model data.
  const w=2800,h=2800,raw=Buffer.alloc((w*3+1)*h);let seed=0x53110;
  for(let y=0;y<h;y++)for(let x=1;x<=w*3;x++){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;raw[y*(w*3+1)+x]=seed&255;}
  const ih=Buffer.alloc(13);ih.writeUInt32BE(w);ih.writeUInt32BE(h,4);ih[8]=8;ih[9]=2;
  const b=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ih),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
  assert(b.length<24*1024**2);assert.equal(verifyPNG(b,candidate).width,w);
  const pad=Buffer.alloc(24*1024**2-b.length-12,97);pad.write('Padding\0');
  const at=Buffer.concat([b.subarray(0,-12),chunk('tEXt',pad),b.subarray(-12)]);assert.equal(at.length,24*1024**2);verifyPNG(at,candidate);
  assert.throws(()=>verifyPNG(Buffer.concat([at,Buffer.from([0])]),candidate),/oversized/);
  const broken=Buffer.from(b);broken[broken.length-1]^=1;assert.throws(()=>verifyPNG(broken,candidate),/CRC/);
  assert.throws(()=>verifyPNG(b.subarray(0,-1),candidate),/Truncated|Invalid/);
  assert.throws(()=>verifyPNG(png({rawExtra:1}),candidate),/length|larger/);
  const invalidFilter=Buffer.alloc(5);invalidFilter[0]=5;const ih1=Buffer.from(ih);ih1.writeUInt32BE(1);ih1.writeUInt32BE(1,4);ih1[9]=6;
  assert.throws(()=>verifyPNG(Buffer.concat([b.subarray(0,8),chunk('IHDR',ih1),chunk('IDAT',deflateSync(invalidFilter)),chunk('IEND',Buffer.alloc(0))]),candidate),/filter/);
});
test('candidate opt-in round trips actual HTTP/portable/complete separate restore; ordinary roots stay 16MP',async t=>{
  const ordinary=importSetup(t),b=png({width:4946,height:3278,color:6});
  assert.equal(ordinary.k.assetCommand(ordinary.c.human,importPacket(ordinary,b,{width:4946,height:3278})).error.code,'UNSUPPORTED_IMAGE');
  const w=importSetup(t,{experimentalPng20:true}),one=imported(w,b,{width:4946,height:3278});assert.equal(JSON.parse(fs.readFileSync(path.join(w.runtime,'bve-v2-root.json'))).version,3);
  w.k.close();const app=await serve({root:w.runtime,port:0});w.k=app.kernel;
  try{const headers={authorization:'Bearer '+w.c.human};assert.deepEqual(Buffer.from(await(await fetch(app.origin+'/api/original?id='+one.r.reference.id,{headers})).arrayBuffer()),b);
    const portable=await(await fetch(app.origin+'/api/import-portable?id='+one.r.reference.id,{headers})).json();assert.deepEqual(Buffer.from(portable.original.bytes,'base64'),b);
  }finally{await app.stop();}
  const backup=path.join(w.dir,'combined');await backupRoot(w.runtime,backup);assert.equal(verifyCombined(backup).complete,true);
  const businessRoot=path.join(w.dir,'restored-business'),runtimeRoot=path.join(w.dir,'restored-runtime'),paths=Object.fromEntries(Object.entries(w.store.workspace.paths).map(([k,v])=>[k,path.join(businessRoot,v)]));
  restoreCombined(backup,{businessRoot,runtimeRoot,paths});const k=new Kernel(runtimeRoot);try{assert.deepEqual(k.original(w.c.human,one.r.reference.id),b);assert.deepEqual(k.assetCommand(w.c.human,one.c),one.r);assert.equal(k.read(w.c.human,'job').length,0);}finally{k.close();}
});
test('existing marker-2 candidate opt-in binds exact backup and rollback remains separate',async t=>{
  const w=importSetup(t);w.k.close();assert.throws(()=>new Kernel(w.runtime,{imports:{experimentalPng20:true}}),e=>e.code==='MIGRATION_REQUIRES_BACKUP');
  const backup=path.join(w.dir,'compatible-before');await backupRoot(w.runtime,backup);
  w.k=new Kernel(w.runtime,{imports:{experimentalPng20:true,migrationBackup:backup,confirmedQuiescent:true}});
  assert.equal(JSON.parse(fs.readFileSync(path.join(w.runtime,'bve-v2-root.json'))).version,3);
  assert.equal(JSON.parse(fs.readFileSync(path.join(backup,'runtime/bve-v2-root.json'))).version,2);
  const db=new DatabaseSync(path.join(w.runtime,'workspace.sqlite'));const v=JSON.parse(db.prepare("SELECT doc FROM records WHERE kind='pngExperimentFormat'").get().doc);assert.equal(v.previousBackupSha256,hash(fs.readFileSync(path.join(backup,'combined-backup.json'))));
  w.k.close();v.version=99;db.prepare("UPDATE records SET doc=? WHERE kind='pngExperimentFormat'").run(JSON.stringify(v));db.close();assert.throws(()=>new Kernel(w.runtime),e=>e.code==='UNSUPPORTED_SCHEMA');
});
test('stricter frozen job allowance remains effective on candidate roots',t=>{
  const w=importSetup(t,{experimentalPng20:true}),b=png({width:4946,height:3278,metadata:false}),request=w.k.call(w.c.human,'request.create','img20-request',{projectId:PRODUCT,intent:'Authored boundary test',count:1,direction:'Fresh'});
  const specs=fixtureSpecifications({brief:'Authored fixed allowance',count:1,maxPixels:16_000_000});
  const iteration=w.k.call(w.c.conductor,'iteration.commission','img20-commission',{requestId:request.id,specifications:specs}),job=w.k.read(w.c.human,'job').find(x=>x.id===iteration.jobIds[0]);
  const assignment=w.k.call(w.c.generator,'job.allocate','img20-allocate',{jobId:job.id,executor:'fixture',capability:capabilities.fixtureWorker});w.k.call(w.c.generator,'attempt.start','img20-start',{assignmentId:assignment.id});
  w.k.call(assignment.token,'result.deliver','img20-deliver',{assignmentId:assignment.id,bytes:b.toString('base64'),outcome:'success',evidence:{kind:'simulated'}});
  w.k.reconcile(w.c.butler);assert.equal(w.k.read(w.c.human,'artifact').length,0);assert.equal(w.k.read(w.c.human,'job').find(x=>x.id===job.id).state,'failed');
  const r2=w.k.call(w.c.human,'request.create','candidate-request',{projectId:PRODUCT,intent:'Authored candidate allowance',count:1,direction:'Fresh'}),i2=w.k.call(w.c.conductor,'iteration.commission','candidate-commission',{requestId:r2.id,specifications:fixtureSpecifications({brief:'Authored candidate',count:1,maxPixels:20_000_000})}),a2=w.k.call(w.c.generator,'job.allocate','candidate-allocate',{jobId:i2.jobIds[0],executor:'fixture',capability:capabilities.fixtureWorker});
  w.k.call(w.c.generator,'attempt.start','candidate-start',{assignmentId:a2.id});w.k.call(a2.token,'result.deliver','candidate-deliver',{assignmentId:a2.id,bytes:b.toString('base64'),outcome:'success',evidence:{kind:'simulated'}});w.k.reconcile(w.c.butler);const artifact=w.k.read(w.c.human,'artifact')[0];assert.equal(artifact.width,4946);assert.deepEqual(w.k.original(w.c.human,artifact.id),b);
});
for(const at of ['after-import-stage','after-import-verify','after-import-commit','during-import-export'])test(`20MP actual terminated child recovers at ${at}`,t=>{
  const w=importSetup(t,{experimentalPng20:true}),b=png({width:5000,height:4000,color:0,metadata:false}),p=importPacket(w,b,{width:5000,height:4000});let s,c,r;
  if(at!=='after-import-stage'){s=success(w.k.assetCommand(w.c.human,p));c=commitPacket(w,s,p);}
  if(at==='during-import-export')r=success(w.k.assetCommand(w.c.human,c));
  const commandFile=path.join(w.dir,'packet.json');fs.writeFileSync(commandFile,JSON.stringify(c??p));w.k.close();
  const child=spawnSync(process.execPath,['test/fixtures/3djat/img20-process.mjs',w.runtime,w.sourceRoot,commandFile,at,r?.reference.id??''],{encoding:'utf8',timeout:30000});
  assert(child.signal||child.status!==0);assert.equal(fs.readFileSync(commandFile+'.reached','utf8'),at);assert.equal(child.stdout,'');
  const domainLock=path.join(w.root,'domain-write.lock');if(fs.existsSync(domainLock))w.store.recoverLock({expectedLockHash:hash(fs.readFileSync(domainLock)),confirmedQuiescent:true});
  const lock=path.join(w.runtime,'operational-write.lock');if(fs.existsSync(lock))recoverOperationalLock(w.runtime,{expectedLockHash:hash(fs.readFileSync(lock)),confirmedQuiescent:true});
  w.k=new Kernel(w.runtime,{imports:w.importOptions});s=success(w.k.assetCommand(w.c.human,p));c??=commitPacket(w,s,p);r??=success(w.k.assetCommand(w.c.human,c));assert.deepEqual(w.k.assetCommand(w.c.human,c),r);
  assert.equal(w.k.read(w.c.human,'artifact').length,1);assert.equal(w.k.read(w.c.human,'job').length,0);assert.deepEqual(w.k.original(w.c.human,r.reference.id),b);assert.equal(w.k.importPortable(w.c.human,r.reference.id).original.sha256,hash(b));
});
test('Windows candidate full-resolution filesystem and separate backup gate',{skip:process.platform!=='win32'},async t=>{
  const w=importSetup(t,{experimentalPng20:true}),b=png({width:4946,height:3278,metadata:false}),one=imported(w,b,{width:4946,height:3278});w.k.close();w.k=new Kernel(w.runtime);assert.deepEqual(w.k.original(w.c.human,one.r.reference.id),b);
  const dest=path.join(w.dir,'windows-backup');await backupRoot(w.runtime,dest);assert.equal(verifyCombined(dest).complete,true);
  const businessRoot=path.join(w.dir,'windows-business'),runtimeRoot=path.join(w.dir,'windows-runtime'),paths=Object.fromEntries(Object.entries(w.store.workspace.paths).map(([k,v])=>[k,path.join(businessRoot,v)]));restoreCombined(dest,{businessRoot,runtimeRoot,paths});const k=new Kernel(runtimeRoot);try{assert.deepEqual(k.original(w.c.human,one.r.reference.id),b);}finally{k.close();}
});
