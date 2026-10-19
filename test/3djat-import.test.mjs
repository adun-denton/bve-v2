import test from 'node:test';import assert from 'node:assert/strict';import * as fs from 'node:fs';import * as path from 'node:path';import {DatabaseSync} from 'node:sqlite';import {randomUUID} from 'node:crypto';
import {Kernel} from '../src/kernel.mjs';import {validate,LIMITS} from '../src/contracts/3djat.mjs';import {hash} from '../src/png.mjs';import {backupRoot} from '../scripts/backup.mjs';import {restoreCombined,verifyCombined} from '../src/workspace-backup.mjs';import {inspectRuntime} from '../src/workspace.mjs';import {fixtureSpecifications} from '../src/adapters.mjs';
import {importSetup,importPacket,commitPacket,png,chunk,PRODUCT} from './fixtures/3djat/import-fixture.mjs';
import {proposal,decision,review} from './fixtures/3djat/products-fixture.mjs';import {DomainProducts} from '../src/domain-products.mjs';
const success=r=>{assert.equal(r.schemaVersion,'3djat.result.v1',JSON.stringify(r));assert.equal(validate('result',r).ok,true);return r;};
const failure=(r,code)=>{assert.equal(r.schemaVersion,'3djat.failure.v1',JSON.stringify(r));assert.equal(validate('failure',r).ok,true);if(code)assert.equal(r.error.code,code);return r;};
const state=w=>Object.fromEntries(['job','assignment','iteration','request','sessionBinding','acceptance'].map(k=>[k,w.k.read(w.c[k==='assignment'?'generator':'human'],k).length]));
function importOne(w,bytes=png(),extra={}){const p=importPacket(w,bytes,extra),s=success(w.k.assetCommand(w.c.human,p)),c=commitPacket(w,s,p),r=success(w.k.assetCommand(w.c.human,c));return {p,s,c,r,a:w.k.importReview(w.c.human,p.input.importId).artifact};}
for(const color of [0,2,4,6])test(`historical channel ${color} import preserves originals/profile bytes, identity and receipts without generation`,t=>{
  const w=importSetup(t),before=state(w),raw=png({color}),{p,s,c,r,a}=importOne(w,raw);
  assert.equal(a.origin,'import');for(const k of ['jobId','iterationId','assignmentId','attemptId'])assert.equal(Object.hasOwn(a,k),false);
  assert.deepEqual(w.k.original(w.c.human,a.id),raw);assert.equal(a.sha256,hash(raw));assert.deepEqual(w.k.assetCommand(w.c.human,p),s);assert.deepEqual(w.k.assetCommand(w.c.human,c),r);assert.deepEqual(state(w),before);
  const portable=w.k.importPortable(w.c.human,a.id);assert.deepEqual(Buffer.from(portable.original.bytes,'base64'),raw);assert.equal(portable.origin.provenance.origin,'import');assert.equal(portable.freshAcceptance,false);
  const view=w.k.importReview(w.c.human,p.input.importId);assert.deepEqual(view.declaration.payload,p.input);assert.equal(view.stage.revision,2);assert.equal(w.k.read(w.c.human,'project')[0].domain.record.productCode,'0007');
  w.k.close();w.k=new Kernel(w.runtime);assert.deepEqual(w.k.original(w.c.human,a.id),raw);assert.deepEqual(w.k.assetCommand(w.c.human,c),r);
});
test('historical approval and same-product parent stay provenance; later human acceptance is separate',t=>{
  const w=importSetup(t),base=importOne(w),parent=w.k.importPortable(w.c.human,base.a.id).artifact;
  const extra={kind:'historical-creative',historicalParent:parent,historicalApproval:{origin:'historical',claimedApprover:null,claimedAt:null,evidence:[base.p.input.source]}};
  const child=importOne(w,png({color:6}),extra),view=w.k.importReview(w.c.human,child.p.input.importId);assert.deepEqual(view.declaration.payload.historicalParent,parent);assert.equal(view.freshAcceptance,false);assert.equal(w.k.read(w.c.human,'acceptance').length,0);
  assert.throws(()=>w.k.call(w.c.conductor,'design.accept','forged',{artifactId:child.a.id,judgment:'accept'}),/cannot call/);
  w.k.call(w.c.human,'design.accept','authored-separate-acceptance',{artifactId:child.a.id,judgment:'accept'});assert.equal(w.k.read(w.c.human,'acceptance').length,1);assert.equal(w.k.importReview(w.c.human,child.p.input.importId).freshAcceptance,false);
});
test('import stage/commit bind metadata bytes ID product principal and exact stage receipt',t=>{
  const w=importSetup(t),raw=png(),p=importPacket(w,raw),s=success(w.k.assetCommand(w.c.human,p));
  const changed=structuredClone(p);changed.input.filename='different.png';failure(w.k.assetCommand(w.c.human,changed),'IDEMPOTENCY_CONFLICT');
  const changedBytes=structuredClone(p);changedBytes.input.sha256=hash(png({color:6}));changedBytes.input.source.sha256=changedBytes.input.sha256;failure(w.k.assetCommand(w.c.human,changedBytes),'IDEMPOTENCY_CONFLICT');
  const c=commitPacket(w,s,p);failure(w.k.assetCommand(w.c.conductor,c),'INVALID_SCOPE');
  failure(w.k.assetCommand(w.source.token,c),'INVALID_SCOPE');failure(w.k.assetCommand(w.c.human,{...c,input:{...c.input,importId:randomUUID()}}),'MISSING_SOURCE');
  failure(w.k.assetCommand(w.c.human,{...c,input:{...c.input,stageReceipt:{...c.input.stageReceipt,sha256:'0'.repeat(64)}}}),'EVIDENCE_MISMATCH');
  failure(w.k.assetCommand(w.c.human,{...c,input:{...c.input,sha256:'0'.repeat(64)}}),'HASH_MISMATCH');
  const result=success(w.k.assetCommand(w.c.human,c));failure(w.k.assetCommand(w.c.human,{...c,input:{...c.input,sha256:'0'.repeat(64)}}),'IDEMPOTENCY_CONFLICT');
  fs.unlinkSync(path.join(w.sourceRoot,p.input.filename));assert.deepEqual(w.k.assetCommand(w.c.human,p),s);assert.deepEqual(w.k.assetCommand(w.c.human,c),result);assert.equal(w.k.read(w.c.human,'artifact').length,1);
});
test('stage current-head/import CAS and declaration validation refuse before publication',t=>{
  const w=importSetup(t),p=importPacket(w);
  for(const mutate of [x=>x.expected.entityRevision=1,x=>x.expected.domainHead.sha256='0'.repeat(64),x=>x.input.productId=randomUUID(),x=>x.input.schemaVersion='3djat.historical-import.v99',x=>x.input.role='human',x=>x.input.source.sha256='0'.repeat(64),x=>x.input.source.location='../credentials.json',x=>x.input.historicalParent={productId:PRODUCT,artifactId:randomUUID(),version:1,sha256:'0'.repeat(64),width:8,height:6}]){
    const x=structuredClone(p);x.key=randomUUID();mutate(x);failure(w.k.assetCommand(w.c.human,x));
  }assert.equal(w.k.read(w.c.human,'artifact').length,0);assert.throws(()=>w.k.importReview(w.c.human,p.input.importId));
});
for(const defect of ['crc','truncated','inflated','dimensions'])test(`${defect} actual PNG failure retains failed inbox and no artifact; replay is exact`,t=>{
  const w=importSetup(t);let raw=png();if(defect==='crc'){raw=Buffer.from(raw);raw[raw.length-1]^=1;}if(defect==='truncated')raw=raw.subarray(0,-2);if(defect==='inflated')raw=png({rawExtra:100});
  const p=importPacket(w,raw,defect==='dimensions'?{width:9}:{}),s=success(w.k.assetCommand(w.c.human,p)),c=commitPacket(w,s,p),result=failure(w.k.assetCommand(w.c.human,c),defect==='dimensions'?'HASH_MISMATCH':'UNSUPPORTED_IMAGE');
  assert.equal(w.k.importReview(w.c.human,p.input.importId).stage.state,'failed');assert.equal(w.k.read(w.c.human,'artifact').length,0);assert.deepEqual(w.k.assetCommand(w.c.human,c),result);
});
test('trusted local source map rejects absent unmapped Drive and symlink paths before staging',t=>{
  const w=importSetup(t),p=importPacket(w);for(const mutate of [x=>x.input.source.location='missing.png',x=>x.input.source.sourceId='foreign-source']){const x=structuredClone(p);mutate(x);failure(w.k.assetCommand(w.c.human,x),'MISSING_SOURCE');}
  const drive=structuredClone(p);drive.input.source={kind:'drive',sourceId:'authored-png',revision:'r1',sha256:p.input.sha256,fileId:'authored-drive',modifiedAt:'2026-01-01T00:00:00.000Z',locator:p.input.source.locator,observedAt:'2026-01-01T00:00:00.000Z'};failure(w.k.assetCommand(w.c.human,drive),'MISSING_SOURCE');
  const outside=path.join(w.dir,'outside.png');fs.writeFileSync(outside,png());const link=path.join(w.sourceRoot,'escape');fs.symlinkSync(w.dir,link,process.platform==='win32'?'junction':'dir');p.input.source.location='escape/outside.png';failure(w.k.assetCommand(w.c.human,p),'UNSAFE_PATH');
});
test('16MP and 24MiB effective ceilings stay frozen; actual larger bytes cannot hide behind safe metadata',t=>{
  const w=importSetup(t);assert.equal(LIMITS.pngPixels,20_000_000);assert.equal(LIMITS.proposedPngPixels,20_000_000);
  const boundary=png({width:4000,height:4000,color:0,metadata:false});importOne(w,boundary,{width:4000,height:4000});
  const plus=importPacket(w,png(),{width:16_000_001,height:1});failure(w.k.assetCommand(w.c.human,plus),'UNSUPPORTED_IMAGE');
  const over=importPacket(w,png(),{width:4946,height:3278});failure(w.k.assetCommand(w.c.human,over),'UNSUPPORTED_IMAGE');
  const raw=png({width:4001,height:4000,color:0,metadata:false}),p=importPacket(w,raw),s=success(w.k.assetCommand(w.c.human,p));failure(w.k.assetCommand(w.c.human,commitPacket(w,s,p)),'UNSUPPORTED_IMAGE');
  const oversized=importPacket(w,png(),{encodedBytes:24*1024**2+1});failure(w.k.assetCommand(w.c.human,oversized),'OUT_OF_BOUNDS');
});
test('committed and pending imports survive complete separate combined restore with exact dossiers and original hashes',async t=>{
  const w=importSetup(t),one=importOne(w,png(),{historicalApproval:{origin:'historical',claimedApprover:null,claimedAt:null,evidence:[w.ref]}});
  success(w.writer.command(w.source.token,proposal(w)));success(w.k.productCommand(w.c.human,decision(w,review(w).proposals[0],'accepted',{principalId:'bve-human'})));const originalReview=review(w);
  const broken=png();broken[broken.length-1]^=1;const failed=importPacket(w,broken,{filename:'failed.png'}),failedStage=success(w.k.assetCommand(w.c.human,failed));failure(w.k.assetCommand(w.c.human,commitPacket(w,failedStage,failed)),'UNSUPPORTED_IMAGE');
  const pending=importPacket(w,png({color:6}),{filename:'pending.png'}),s=success(w.k.assetCommand(w.c.human,pending)),backup=path.join(w.dir,'combined');await backupRoot(w.runtime,backup);assert.equal(verifyCombined(backup).complete,true);
  const businessRoot=path.join(w.dir,'restored-business'),runtimeRoot=path.join(w.dir,'restored-runtime'),paths=Object.fromEntries(Object.entries(w.store.workspace.paths).map(([k,v])=>[k,path.join(businessRoot,v)]));restoreCombined(backup,{businessRoot,runtimeRoot,paths});
  const k=new Kernel(runtimeRoot);try{assert.deepEqual(k.original(w.c.human,one.a.id),png());assert.equal(k.importReview(w.c.human,pending.input.importId).stage.state,'staged');assert.deepEqual(k.importReview(w.c.human,one.p.input.importId).declaration.payload.historicalApproval,one.p.input.historicalApproval);assert.equal(k.read(w.c.human,'project')[0].domain.record.productCode,'0007');assert.deepEqual(k.assetCommand(w.c.human,pending),s);success(k.assetCommand(w.c.human,commitPacket(w,s,pending)));assert.equal(k.read(w.c.human,'artifact').length,2);assert.equal(k.read(w.c.human,'job').length,0);
    assert.equal(k.importReview(w.c.human,failed.input.importId).stage.state,'failed');const domain=new DomainProducts(businessRoot,{accessFile:w.accessFile}),restored=domain.readReview(w.human.token,{productId:PRODUCT,atHead:originalReview.head});assert.deepEqual(restored.decisions,originalReview.decisions);assert.deepEqual(restored.product,originalReview.product);
  }finally{k.close();}
});
test('missing or corrupt committed originals block complete backup and preserve import provenance',async t=>{
  const w=importSetup(t),one=importOne(w);const db=new DatabaseSync(path.join(w.runtime,'workspace.sqlite'));db.prepare('UPDATE bytes SET data=? WHERE hash=?').run(Buffer.from('Authored corruption'),one.a.sha256);await assert.rejects(()=>backupRoot(w.runtime,path.join(w.dir,'corrupt')));db.prepare('DELETE FROM bytes WHERE hash=?').run(one.a.sha256);db.close();await assert.rejects(()=>backupRoot(w.runtime,path.join(w.dir,'missing')));assert.equal(w.k.importReview(w.c.human,one.p.input.importId).stage.state,'committed');assert.throws(()=>w.k.original(w.c.human,one.a.id));
});
test('imported sources enter existing source selection and produced jobs retain original associations',t=>{
  const w=importSetup(t),one=importOne(w),request=w.k.call(w.c.human,'request.create','authored-follow',{projectId:PRODUCT,intent:'Authored explicit source selection',count:1,direction:'Follow'});
  const specs=fixtureSpecifications({brief:'Authored import source use',count:1,sources:[{artifactId:one.a.id,projectId:PRODUCT,version:1,sha256:one.a.sha256,width:one.a.width,height:one.a.height,role:'Authored reference',regions:[]}]});
  const iteration=w.k.call(w.c.conductor,'iteration.commission','authored-commission',{requestId:request.id,specifications:specs});const job=w.k.read(w.c.human,'job').find(j=>j.id===iteration.jobIds[0]);assert.equal(job.specification.sources[0].origin,'import');assert.equal(job.specification.sources[0].importId,one.p.input.importId);
});
test('root format promotion requires verified exact backup for existing history; newer versions refuse',async t=>{
  const w=importSetup(t);assert.equal(JSON.parse(fs.readFileSync(path.join(w.runtime,'bve-v2-root.json'))).version,2);w.k.close();
  const file=path.join(w.runtime,'bve-v2-root.json'),m=JSON.parse(fs.readFileSync(file));fs.writeFileSync(file,JSON.stringify({...m,version:3}));assert.throws(()=>inspectRuntime(w.runtime),e=>e.code==='UNSUPPORTED_SCHEMA');fs.writeFileSync(file,JSON.stringify(m));
  const db=new DatabaseSync(path.join(w.runtime,'workspace.sqlite'));db.prepare("UPDATE records SET doc=? WHERE kind='assetImportFormat'").run(JSON.stringify({id:'active',schemaVersion:'bve.asset-import-format.v99',version:99}));db.close();assert.throws(()=>new Kernel(w.runtime),e=>e.code==='UNSUPPORTED_SCHEMA');
});
