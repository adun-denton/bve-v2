import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {randomUUID} from 'node:crypto';
import {serve} from '../src/server.mjs';
import {provisionProductPrincipal,readProductDossier} from '../src/domain-products.mjs';
import {setup,packet,proposal,field,PRODUCT,WORKSPACE} from './fixtures/3djat/dossier-fixture.mjs';

async function request(app,token,route,body){
  const response=await fetch(app.origin+route,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  return {status:response.status,body:await response.json()};
}
test('J06 authored Products API: file-owned list, code-less creation, correction and decision, lost source, no generation',async t=>{
  const w=setup(t,{kernel:true,reserve:2*1024**2});
  provisionProductPrincipal(w.accessFile,{workspaceId:WORKSPACE,id:'bve-human',role:'human',products:'*',sourceIds:['inert-source']});
  w.k.close();const app=await serve({root:w.runtime,port:0,products:{accessFile:w.accessFile}});w.k=app.kernel;
  try{
    for(const route of ['/products.html','/products.js','/products.css']){
      const response=await fetch(app.origin+route);assert.equal(response.status,200);
      assert.equal(response.headers.get('content-security-policy')?.includes("script-src 'self'"),true);
    }
    const before={requests:w.k.read(w.c.human,'request').length,rounds:w.k.read(w.c.human,'round').length,
      jobs:w.k.read(w.c.human,'job').length,artifacts:w.k.read(w.c.human,'artifact').length};
    const list=await request(app,w.c.human,'/api/products');
    assert.equal(list.status,200);assert.equal(list.body.products.length,1);
    assert.deepEqual([list.body.products[0].importedCount,list.body.products[0].attachmentCount,list.body.products[0].contentCount],[0,0,0]);
    assert.equal(list.body.products[0].unknownCount,6);
    assert.equal((await request(app,w.c.butler,'/api/products')).status,403);
    const createdId=randomUUID(),create=packet(w,'product.create',{productId:createdId,productCode:null,workingName:'گلدان 🪴',note:'یادداشت آغاز'});
    assert.equal((await request(app,w.c.human,'/api/product',create)).status,200);
    assert.equal((await request(app,w.c.human,'/api/products')).body.products.find(p=>p.productId===createdId).productCode,null);
    const creationRead=await request(app,w.c.human,'/api/product-review',{productId:createdId,atHead:w.store.read().reference});
    assert.equal(creationRead.body.product.record.workingName,'گلدان 🪴');
    assert.equal(creationRead.body.product.record.notes[0].text,'یادداشت آغاز');
    assert.deepEqual({requests:w.k.read(w.c.human,'request').length,rounds:w.k.read(w.c.human,'round').length,
      jobs:w.k.read(w.c.human,'job').length,artifacts:w.k.read(w.c.human,'artifact').length},before);
    const proposed=proposal(w,field(w,'description','پیشنهاد منبع'));
    const submitted=w.writer.command(w.source.token,proposed);
    assert.equal(submitted.schemaVersion,'3djat.result.v1',JSON.stringify(submitted));
    const latest=await request(app,w.c.human,'/api/products');
    assert.equal(latest.body.products.find(p=>p.productId===PRODUCT).pendingCount,1);
    const review=await request(app,w.c.human,'/api/product-review',{productId:PRODUCT,atHead:latest.body.head});
    assert.equal(review.body.dossierExtension.proposals[0].status,'pending');
    const original=review.body.dossierExtension.proposals[0];
    const correction=packet(w,'product.dossier.proposal.submit',{...structuredClone(original.record),
      proposalId:randomUUID(),expectedRevision:review.body.product.record.revision,
      payload:{...structuredClone(original.record.payload),fact:{...original.record.payload.fact,value:'ویرایش انسان'}},
      reason:'Human corrected the proposed wording',corrects:original.reference});
    const changed=await request(app,w.c.human,'/api/product',correction);
    assert.equal(changed.status,200,JSON.stringify(changed.body));
    const supersede=packet(w,'product.dossier.proposal.decide',{schemaVersion:'3djat.dossier-decision.v1',
      decisionId:randomUUID(),productId:PRODUCT,proposal:original.reference,expectedRevision:review.body.product.record.revision,
      outcome:'superseded',reason:'Human correction',decidedAt:new Date().toISOString(),
      humanActionReceipt:{id:randomUUID(),revision:1,path:'placeholder.json',sha256:'0'.repeat(64)},
      supersedesDecision:null,correctedProposal:changed.body.reference});
    const ref=await request(app,w.c.human,'/api/product-action-reference',supersede);
    assert.equal(ref.status,200,JSON.stringify(ref.body));supersede.input.humanActionReceipt=ref.body;
    assert.equal((await request(app,w.c.butler,'/api/product-action-reference',supersede)).status,403);
    const result=await request(app,w.c.human,'/api/product',supersede);
    assert.equal(result.status,200,JSON.stringify(result.body));
    assert.deepEqual((await request(app,w.c.human,'/api/product',supersede)).body,result.body);
    const stale=packet(w,'product.dossier.proposal.decide',{...supersede.input,decisionId:randomUUID(),outcome:'accepted',correctedProposal:null});
    stale.input.humanActionReceipt=(await request(app,w.c.human,'/api/product-action-reference',stale)).body;
    assert.equal((await request(app,w.c.human,'/api/product',stale)).body.error.code,'EVIDENCE_MISMATCH');
    const r2=(await request(app,w.c.human,'/api/product-review',{productId:PRODUCT,atHead:w.store.read().reference})).body;
    assert.equal(r2.dossierExtension.proposals.find(p=>p.reference.id===original.reference.id).status,'superseded');
    const corrected=r2.dossierExtension.proposals.find(p=>p.reference.id===changed.body.reference.id);
    assert.equal(corrected.status,'pending');
    const accept=packet(w,'product.dossier.proposal.decide',{...supersede.input,
      decisionId:randomUUID(),proposal:corrected.reference,outcome:'accepted',correctedProposal:null,decidedAt:new Date().toISOString()});
    accept.input.humanActionReceipt=(await request(app,w.c.human,'/api/product-action-reference',accept)).body;
    assert.equal((await request(app,w.c.human,'/api/product',accept)).status,200);
    assert.equal(readProductDossier(w.root,{productId:PRODUCT,accessFile:w.accessFile}).dossierExtension.fields.description.value,'ویرایش انسان');
    const proposal3=proposal(w,field(w,'description','Reject me'),{replaces:readProductDossier(w.root,{productId:PRODUCT}).dossierExtension.records[0].reference});
    const last=w.writer.command(w.source.token,proposal3);assert.equal(last.schemaVersion,'3djat.result.v1');
    const reject=packet(w,'product.dossier.proposal.decide',{...supersede.input,
      decisionId:randomUUID(),proposal:last.reference,outcome:'rejected',correctedProposal:null,expectedRevision:w.store.read().head.products[0].dossier.revision,decidedAt:new Date().toISOString()});
    reject.input.humanActionReceipt=(await request(app,w.c.human,'/api/product-action-reference',reject)).body;
    assert.equal((await request(app,w.c.human,'/api/product',reject)).status,200);
    fs.renameSync(path.join(w.root,'Sources/inert.txt'),path.join(w.root,'Sources/inert.txt.retained'));
    const lost=(await request(app,w.c.human,'/api/product-review',{productId:PRODUCT,atHead:w.store.read().reference})).body;
    assert.equal(lost.dossierExtension.proposals[0].sources[0].status,'unresolved');
    assert.equal((await request(app,w.c.human,'/api/products')).body.products.find(p=>p.productId===PRODUCT).contentCount,1);
  }finally{await app.stop();}
});
test('J06 typed dimensions, price and cost corrections retain sources and need separate acceptance',async t=>{
  const w=setup(t,{kernel:true,reserve:3*1024**2});
  provisionProductPrincipal(w.accessFile,{workspaceId:WORKSPACE,id:'bve-human',role:'human',products:'*',sourceIds:['inert-source']});
  w.k.close();const app=await serve({root:w.runtime,port:0,products:{accessFile:w.accessFile}});w.k=app.kernel;
  const money=(amount,currency='USD')=>({amount,currency,unit:currency==='IRR'?'rial':currency==='IRT'?'toman':'major',per:'item',effectiveDate:'2026-01-01'});
  async function decide(kind,proposalRef,outcome,correctedProposal=null){
    const op=kind==='base'?'product.proposal.decide':'product.dossier.proposal.decide';
    const input={schemaVersion:kind==='base'?'3djat.proposal-decision.v1':'3djat.dossier-decision.v1',
      decisionId:randomUUID(),productId:PRODUCT,proposal:proposalRef,
      expectedRevision:w.store.read().head.products[0].dossier.revision,outcome,
      reason:'Authored test decision',decidedAt:new Date().toISOString(),
      humanActionReceipt:{id:randomUUID(),revision:1,path:'placeholder.json',sha256:'0'.repeat(64)},
      supersedesDecision:null,correctedProposal};
    const command=packet(w,op,input);
    const r=await request(app,w.c.human,'/api/product-action-reference',command);assert.equal(r.status,200,JSON.stringify(r.body));
    input.humanActionReceipt=r.body;const result=await request(app,w.c.human,'/api/product',command);
    assert.equal(result.status,200,JSON.stringify(result.body));return result.body;
  }
  try{
    const base=packet(w,'product.proposal.submit',{schemaVersion:'3djat.proposal.v1',proposalId:randomUUID(),productId:PRODUCT,
      expectedRevision:1,changes:[
        {field:'dimensions',fact:{state:'accepted',value:{length:10,width:20,height:30,unit:'cm'},sourceRefs:[w.ref]}},
        {field:'sellingPrice',fact:{state:'accepted',value:money('25.50'),sourceRefs:[w.ref]}}],
      reason:'Authored source claim',corrects:null});
    const original=w.writer.command(w.source.token,base);assert.equal(original.schemaVersion,'3djat.result.v1',JSON.stringify(original));
    const corrected=packet(w,'product.proposal.submit',{...structuredClone(base.input),proposalId:randomUUID(),
      changes:[{...base.input.changes[0],fact:{...base.input.changes[0].fact,value:{length:15,width:20,height:30,unit:'cm'}}},
        {...base.input.changes[1],fact:{...base.input.changes[1].fact,value:money('30.125')}}],
      reason:'Measured and priced correction',corrects:original.reference});
    const saved=await request(app,w.c.human,'/api/product',corrected);assert.equal(saved.status,200,JSON.stringify(saved.body));
    await decide('base',original.reference,'superseded',saved.body.reference);
    let read=readProductDossier(w.root,{productId:PRODUCT,accessFile:w.accessFile});
    assert.equal(read.product.record.facts.dimensions.state,'unknown','Correction alone does not accept facts');
    const pending=(await request(app,w.c.human,'/api/product-review',{productId:PRODUCT,atHead:w.store.read().reference})).body;
    assert.equal(pending.proposals.find(p=>p.reference.id===saved.body.reference.id).status,'pending');
    await decide('base',saved.body.reference,'accepted');
    read=readProductDossier(w.root,{productId:PRODUCT,accessFile:w.accessFile});
    assert.deepEqual(read.product.record.facts.dimensions.value,{length:15,width:20,height:30,unit:'cm'});
    assert.equal(read.product.record.facts.sellingPrice.value.amount,'30.125');
    assert.deepEqual(read.product.record.facts.dimensions.sourceRefs,[w.ref]);
    const cost=proposal(w,field(w,'productionCost',money('5'))),costOriginal=w.writer.command(w.source.token,cost);
    assert.equal(costOriginal.schemaVersion,'3djat.result.v1',JSON.stringify(costOriginal));
    const changed=packet(w,'product.dossier.proposal.submit',{...structuredClone(cost.input),proposalId:randomUUID(),
      expectedRevision:w.store.read().head.products[0].dossier.revision,
      payload:{...cost.input.payload,fact:{...cost.input.payload.fact,value:money('7.25')}},
      corrects:costOriginal.reference,reason:'Corrected production cost'});
    const costSaved=await request(app,w.c.human,'/api/product',changed);assert.equal(costSaved.status,200,JSON.stringify(costSaved.body));
    await decide('dossier',costOriginal.reference,'superseded',costSaved.body.reference);
    assert.equal(readProductDossier(w.root,{productId:PRODUCT}).dossierExtension.fields.productionCost.state,'unknown');
    await decide('dossier',costSaved.body.reference,'accepted');
    read=readProductDossier(w.root,{productId:PRODUCT,accessFile:w.accessFile});
    assert.equal(read.dossierExtension.fields.productionCost.value.amount,'7.25');
    assert.deepEqual(read.dossierExtension.proposals.find(p=>p.reference.id===costSaved.body.reference.id).record.payload.fact.sourceRefs,[w.ref]);
    for(const kind of ['request','round','job'])assert.equal(w.k.read(w.c.human,kind).length,0);
  }finally{await app.stop();}
});

test('J06 owner restart retains file-only dossier read and current product list without operational work',async t=>{
  const w=setup(t,{kernel:true,reserve:1024*1024});
  provisionProductPrincipal(w.accessFile,{workspaceId:WORKSPACE,id:'bve-human',role:'human',products:'*',sourceIds:[]});
  w.k.close();
  let app=await serve({root:w.runtime,port:0,products:{accessFile:w.accessFile}});w.k=app.kernel;
  const first=(await request(app,w.c.human,'/api/products')).body;
  assert.equal(first.products[0].workingName,'Authored concept only');
  await app.stop();
  const isolated=readProductDossier(w.root,{productId:PRODUCT,atHead:first.head,accessFile:w.accessFile});
  assert.equal(isolated.product.record.notes[0].text,'Inert initial note');
  app=await serve({root:w.runtime,port:0,products:{accessFile:w.accessFile}});w.k=app.kernel;
  try{
    const reopened=(await request(app,w.c.human,'/api/products')).body;
    assert.deepEqual(reopened,first);
    assert.deepEqual(w.k.read(w.c.human,'request'),[]);
    assert.deepEqual(w.k.read(w.c.human,'job'),[]);
  }finally{await app.stop();}
});
test('J06 current product picker excludes IDs outside the native human product grant',async t=>{
  const w=setup(t,{kernel:true,reserve:1024*1024}),other=randomUUID();
  assert.equal(w.writer.command(w.human.token,packet(w,'product.create',{productId:other,productCode:'SKU-OTHER',workingName:'Private other'})).schemaVersion,'3djat.result.v1');
  provisionProductPrincipal(w.accessFile,{workspaceId:WORKSPACE,id:'bve-human',role:'human',products:[PRODUCT],sourceIds:[]});
  w.k.close();const app=await serve({root:w.runtime,port:0,products:{accessFile:w.accessFile}});w.k=app.kernel;
  try{
    const list=(await request(app,w.c.human,'/api/products')).body;
    assert.deepEqual(list.products.map(x=>x.productId),[PRODUCT]);
    assert.equal(JSON.stringify(list).includes(other),false);
  }finally{await app.stop();}
});
