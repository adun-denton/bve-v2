import test from 'node:test';import assert from 'node:assert/strict';import * as fs from 'node:fs';import * as path from 'node:path';import {randomUUID} from 'node:crypto';import {request} from 'node:http';
import {Kernel} from '../src/kernel.mjs';import {DomainProducts,readProductDossier} from '../src/domain-products.mjs';import {backupRoot} from '../scripts/backup.mjs';import {restoreCombined,verifyCombined} from '../src/workspace-backup.mjs';import {serve} from '../src/server.mjs';
import {readyRound} from './fixtures/3djat/workspace-fixture.mjs';
import {setup,create,proposal,decision,packet,review,PRODUCT} from './fixtures/3djat/products-fixture.mjs';
const success=r=>{assert.equal(r.schemaVersion,'3djat.result.v1',JSON.stringify(r));return r;};
test('internal product action copies stay immutable and outside legacy notification reads',t=>{
  const w=setup(t,{kernel:true});success(w.k.productCommand(w.c.human,create(w)));const event=w.writer.operationalEvidence()[0];
  assert.equal(event.type,'product-action');for(const role of ['human','conductor','butler'])assert.equal(w.k.read(w.c[role],'event').length,0);
  for(const [role,op,input] of [['conductor','event.consume',{}],['conductor','event.ack',{receipt:'Authored acknowledgement'}],['butler','event.delivery',{mechanism:'Authored transport',status:'sent'}]])assert.throws(()=>w.k.call(w.c[role],op,randomUUID(),{eventId:event.id,...input}),/Product action evidence is immutable/);
  // Reconciliation byte-compares the stored copy, so this succeeds only if all attempted mutations left it intact.
  success(w.k.productCommand(w.c.human,packet(w,'product.read',{productId:PRODUCT,atHead:w.store.read().reference})));assert.deepEqual(w.writer.operationalEvidence()[0],event);
});
test('BVE delegates exact file UUID without workflow prerequisites, refreshes disposable projection and replays adoption',t=>{
  const w=setup(t,{kernel:true}),p=create(w,{productCode:'0007'}),r=success(w.k.productCommand(w.c.human,p));assert.deepEqual(w.k.productCommand(w.c.human,p),r);
  const product=w.k.read(w.c.human,'project')[0];assert.equal(product.id,PRODUCT);assert.equal(product.productCode,'0007');assert.equal(product.name,p.input.workingName);
  for(const kind of ['request','round','job','sessionBinding'])assert.equal(w.k.read(w.c.human,kind).length,0);
  w.k.close();w.k=new Kernel(w.runtime,{products:{accessFile:w.accessFile}});assert.deepEqual(w.k.productCommand(w.c.human,p),r);assert.equal(w.k.read(w.c.human,'project').length,1);
});
for(const at of ['before-product-adoption','before-product-projection','before-product-response'])test(`BVE ${at} interruption preserves durable dossier and exact reconciliation`,t=>{
  let armed=true;const w=setup(t,{kernel:true,workspaceHook(stage){if(armed&&stage===at)throw Object.assign(new Error('Authored acknowledgement fault'),{code:'EIO'});}}),p=create(w,{note:'Authored note'});
  const failed=w.k.productCommand(w.c.human,p);assert.equal(failed.error.code,'EXPORT_PENDING');assert.equal(w.store.read().records.get(failed.error.evidence.path).kind,'store-receipt');assert.equal(readProductDossier(w.root,{productId:PRODUCT}).product.record.notes.length,1);
  const changed=structuredClone(p);changed.input.workingName='Conflicting retry';assert.equal(w.k.productCommand(w.c.human,changed).error.code,'IDEMPOTENCY_CONFLICT');
  armed=false;const r=success(w.k.productCommand(w.c.human,p));assert.deepEqual(w.k.productCommand(w.c.human,p),r);assert.equal(w.k.read(w.c.human,'project').length,1);
});
test('standalone human/source C1 history is reconciled as exact operational evidence and survives combined restore',async t=>{
  const w=setup(t,{kernel:true});success(w.k.productCommand(w.c.human,create(w)));const p=proposal(w);success(w.writer.command(w.source.token,p));const a=review(w).proposals[0];
  success(w.writer.command(w.human.token,packet(w,'product.note.add',{productId:PRODUCT,text:'Standalone authored note while BVE unused'})));
  const bPacket=proposal(w,{corrects:a.reference});bPacket.input.changes[0].fact.value='Authored corrected';success(w.writer.command(w.human.token,bPacket));const b=review(w).proposals.find(x=>x.record.proposalId===bPacket.input.proposalId);
  success(w.writer.command(w.human.token,decision(w,a,'superseded',{correctedProposal:b.reference})));const acceptedPacket=decision(w,b,'accepted'),acceptedResult=success(w.writer.command(w.human.token,acceptedPacket));
  const current=w.store.read();const read=packet(w,'product.read',{productId:PRODUCT,atHead:current.reference});success(w.k.productCommand(w.c.human,read));
  const before=review(w),snapshot=path.join(w.dir,'combined');await backupRoot(w.runtime,snapshot);const manifest=verifyCombined(snapshot);assert.equal(manifest.complete,true);assert.equal(manifest.evidence.length,2);
  const businessRoot=path.join(w.dir,'restored-business'),runtimeRoot=path.join(w.dir,'restored-runtime'),paths=Object.fromEntries(Object.entries(w.store.workspace.paths).map(([k,v])=>[k,path.join(businessRoot,v)]));restoreCombined(snapshot,{businessRoot,runtimeRoot,paths});
  assert.deepEqual(readProductDossier(businessRoot,{productId:PRODUCT}),{head:before.head,product:before.product});
  const restored=new DomainProducts(businessRoot,{accessFile:w.accessFile});const after=restored.readReview(w.human.token,{productId:PRODUCT,atHead:before.head});assert.deepEqual(after.product,before.product);assert.deepEqual(after.decisions,before.decisions);assert.deepEqual(after.proposals.map(x=>[x.reference,x.status]),before.proposals.map(x=>[x.reference,x.status]));
  assert.equal(after.product.record.facts.material.value,'Authored corrected');
  // Domain records remain readable with restored operational SQL physically absent.
  fs.renameSync(path.join(runtimeRoot,'workspace.sqlite'),path.join(runtimeRoot,'preserved.sqlite'));assert.deepEqual(readProductDossier(businessRoot,{productId:PRODUCT}).product,before.product);
  assert.deepEqual(restored.command(w.human.token,acceptedPacket),acceptedResult);
  success(restored.command(w.human.token,{schemaVersion:'3djat.command.v1',operation:'product.note.add',key:randomUUID(),expected:{domainHead:before.head,entityRevision:before.product.reference.revision},input:{productId:PRODUCT,text:'Authored standalone note after SQL loss'}}));assert.equal(readProductDossier(businessRoot,{productId:PRODUCT}).product.record.notes.length,2);
});
test('missing actual operational action evidence makes combined backup incomplete rather than invented',async t=>{
  const w=setup(t,{kernel:true});success(w.k.productCommand(w.c.human,create(w)));success(w.writer.command(w.source.token,proposal(w)));const a=review(w).proposals[0];success(w.writer.command(w.human.token,decision(w,a,'accepted')));
  await assert.rejects(()=>backupRoot(w.runtime,path.join(w.dir,'incomplete')),e=>e.code==='INCOMPLETE_BACKUP');
  success(w.k.productCommand(w.c.human,packet(w,'product.read',{productId:PRODUCT,atHead:w.store.read().reference})));await backupRoot(w.runtime,path.join(w.dir,'complete'));assert.equal(verifyCombined(path.join(w.dir,'complete')).complete,true);
});
test('same active kernel loses domain with a ready round: stale history/frozen bytes survive and original-root recovery works',t=>{
  const w=setup(t,{kernel:true});success(w.k.productCommand(w.c.human,create(w)));const alias={k:w.k,c:w.c};const {round}=readyRound(alias);
  const v=w.store.read(),saved=w.k.freezeDomainSelection(w.c,{key:'j04-frozen',projectId:PRODUCT,expectedHead:v.reference,product:v.head.products[0].dossier}),frozen=w.k.frozenDomainSelection(w.c,saved.id);
  fs.renameSync(w.root,w.root+'-preserved');const p=w.k.read(w.c.human,'project')[0];assert.equal(p.domain.status,'stale');assert.equal(p.folder,null);assert.equal(w.k.round(w.c.human,round.id).statements[0].project.folder,null);assert.deepEqual(w.k.reconcile(w.c.butler),{ok:true});assert.deepEqual(w.k.frozenDomainSelection(w.c,saved.id),frozen);
  assert.throws(()=>w.k.call(w.c.human,'request.create','unavailable',{projectId:PRODUCT,intent:'Authored blocked new work'}),e=>e.code==='DOMAIN_UNAVAILABLE');assert.equal(fs.existsSync(w.root),false);
  fs.renameSync(w.root+'-preserved',w.root);assert.equal(w.k.read(w.c.human,'project')[0].domain.status,'current');
});
test('new product HTTP endpoints retain Host/Origin/auth, body bounds and typed result boundaries',async t=>{
  const w=setup(t,{kernel:true});w.k.close();const app=await serve({root:w.runtime,port:0,products:{accessFile:w.accessFile}});w.k=app.kernel;
  try{
    const p=create(w),post=(body,headers={})=>fetch(app.origin+'/api/product',{method:'POST',headers:{authorization:'Bearer '+w.c.human,'content-type':'application/json',...headers},body:JSON.stringify(body)});
    assert.equal((await post(p,{origin:'https://foreign.invalid'})).status,403);
    const hostStatus=await new Promise((ok,no)=>{const req=request(app.origin+'/api/product',{method:'POST',headers:{host:'foreign.invalid',authorization:'Bearer '+w.c.human}},res=>{res.resume();res.on('end',()=>ok(res.statusCode));});req.on('error',no);req.end(JSON.stringify(p));});assert.equal(hostStatus,403);
    const invalid=await post(p,{authorization:'Bearer invalid'});assert.equal(invalid.status,409);assert.equal((await invalid.json()).error.code,'INVALID_SCOPE');
    const good=await post(p);assert.equal(good.status,200);success(await good.json());
    const query=await fetch(app.origin+'/api/product-review',{method:'POST',headers:{authorization:'Bearer '+w.source.token},body:JSON.stringify({productId:PRODUCT,atHead:w.store.read().reference})});assert.equal(query.status,200);assert.equal((await query.json()).product.record.productId,PRODUCT);
    assert.equal((await fetch(app.origin+'/api/product',{method:'POST',headers:{authorization:'Bearer '+w.c.human},body:' '.repeat(128*1024+1)})).status,413);
  }finally{await app.stop();}
});
for(const outcome of ['accepted','rejected'])test(`durable ${outcome} decision survives cache acknowledgement failure and kernel replacement`,t=>{
  let armed=false;const w=setup(t,{kernel:true,workspaceHook(stage){if(armed&&stage==='before-product-projection')throw Object.assign(new Error('Authored cache fault'),{code:'EIO'});}});success(w.k.productCommand(w.c.human,create(w)));success(w.writer.command(w.source.token,proposal(w)));const a=review(w).proposals[0],p=decision(w,a,outcome,{principalId:'bve-human'});
  armed=true;const r=w.k.productCommand(w.c.human,p);assert.equal(r.error.code,'EXPORT_PENDING');assert.equal(review(w).proposals[0].status,outcome);
  w.k.close();w.k=new Kernel(w.runtime,{products:{accessFile:w.accessFile}});const final=success(w.k.productCommand(w.c.human,p));assert.deepEqual(w.k.productCommand(w.c.human,p),final);assert.equal(review(w).decisions.length,1);assert.equal(w.k.read(w.c.human,'project')[0].domain.status,'current');
});
test('Windows product create/propose/decide/reopen/replay uses the local filesystem', {skip:process.platform!=='win32'}, t=>{
  const w=setup(t,{kernel:true}),p=create(w,{productCode:'0007'});const first=success(w.k.productCommand(w.c.human,p));success(w.writer.command(w.source.token,proposal(w)));const a=review(w).proposals[0],d=decision(w,a,'accepted',{principalId:'bve-human'});const accepted=success(w.k.productCommand(w.c.human,d));
  w.k.close();w.k=new Kernel(w.runtime,{products:{accessFile:w.accessFile}});assert.deepEqual(w.k.productCommand(w.c.human,p),first);assert.deepEqual(w.k.productCommand(w.c.human,d),accepted);assert.equal(w.k.read(w.c.human,'project')[0].domain.record.productCode,'0007');
});
test('lazy product configuration cannot rebind a copied replacement domain before its first command',t=>{
  const w=setup(t,{kernel:true}),p=create(w);fs.renameSync(w.root,w.root+'-preserved');fs.cpSync(w.root+'-preserved',w.root,{recursive:true});
  const result=w.k.productCommand(w.c.human,p);assert.equal(result.error.code,'UNSAFE_PATH');assert.equal(fs.existsSync(path.join(w.root,'Domain/product',PRODUCT)),false);assert.equal(w.k.read(w.c.human,'request').length,0);
});
