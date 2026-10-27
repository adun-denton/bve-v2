import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {randomUUID} from 'node:crypto';
import {configureTemplateGrant,templateDecisionActionReference} from '../src/domain-templates.mjs';
import {W,hash} from './fixtures/3djat/deterministic-fixture.mjs';
import {operationUIFailure} from '../src/operation-ui-http.mjs';
import {Kernel} from '../src/kernel.mjs';import {setup11,input11,generate11,action,P} from './fixtures/3djat/j11-fixture.mjs';
test('J11 authored Example3: exact variants, comments, revision, second comparison, interrupted scoped promotion/replay',{timeout:900000},t=>{
 const w=setup11(t),beforeHead=w.store.read().reference,input=input11(w),key=randomUUID();
 for(const [name,change] of [
 ['wrong variant hash',x=>{x.record.variants[0].template.sha256='0'.repeat(64)}],
 ['crossed source product',x=>{x.record.commonSources[0].productId=randomUUID()}],
 ['wrong source version',x=>{x.record.commonSources[0].version++}],
 ['wrong source hash',x=>{x.record.commonSources[0].sha256='0'.repeat(64)}],
 ['duplicate variant',x=>{x.record.variants[2]=structuredClone(x.record.variants[0])}],
 ['out of bounds common setting',x=>{x.record.commonSettings.contrast=2}]
 ]){const invalid=structuredClone(input);invalid.record.experimentId=randomUUID();change(invalid);assert.throws(()=>action(w,'create',invalid),undefined,name);}
 const ownedLock=w.store.lock(W);try{assert.throws(()=>action(w,'create',input,w.c.human,key),e=>e.code==='LOCKED');}finally{w.store.unlock(ownedLock);}
 const first=action(w,'create',input,w.c.human,key);
 assert.deepEqual(action(w,'create',input,w.c.human,key),first);
 assert.throws(()=>action(w,'create',{...input,record:{...input.record,commonIntent:'Changed'}},w.c.human,key),/payload conflict/i);
 assert.equal(w.k.read(w.c.human,'job').length,0);
 assert.throws(()=>action(w,'commit',{experimentId:first.experimentId}),/INVALID_SCOPE/);
 const a=generate11(w,first);
 assert.equal(a.result.record.lifecycle,'completed');
 assert.equal(action(w,'view',{productId:P}).experiments[0].statuses.visual,'untested');
 const review=action(w,'review',{experimentId:first.experimentId,comments:'A balanced; B good definition but shadows too deep; C dramatic. Authored judgment only.',selectedVariant:w.variants[1]});
 const changed=action(w,'revise',{experimentId:first.experimentId,original:w.variants[1],instructions:'Authored B revised: defined contrast with shallower shadows; preserve the photographed product.',reason:'B shadows too deep in authored walkthrough.'});
 assert.equal(changed.reference.revision,5);
 const stale=structuredClone(input);stale.record.experimentId=randomUUID();assert.throws(()=>action(w,'create',stale),e=>e.code==='REVISION_CONFLICT');
 const secondInput=input11(w,{variants:[w.variants[0],changed.reference,w.variants[2]],previousExperiment:first.experimentId,revisionLink:changed.id});
 const second=action(w,'create',secondInput),b=generate11(w,second);
 const secondReview=action(w,'review',{experimentId:second.experimentId,comments:'Revised B selected for authored Instagram artistic protocol verification only.',selectedVariant:changed.reference});
 const reason='Explicit scoped authored human decision; not real visual acceptance.',promotionInput={experimentId:second.experimentId,reviewId:secondReview.id,template:changed.reference,reason},promotionKey=randomUUID(),promotion=action(w,'promotion',promotionInput,w.c.human,promotionKey);
 assert.equal(action(w,'view',{productId:P}).experiments[1].statuses.human,'awaiting approval');
 w.k.close();w.k=new Kernel(w.runtime,w.options);
 assert.deepEqual(action(w,'promotion',promotionInput,w.c.human,promotionKey),promotion);
 for(const [label,change] of [
 ['wrong output',p=>{p.input.outputs=a.result.record.variants[0].outputs.map(o=>o.artifact)}],
 ['wrong receipt',p=>{p.input.evidenceReceipt=a.result.record.receipt}],
 ['broad scope',p=>{p.input.appliesTo=['artistic']}]
 ]){const invalid=structuredClone(promotion);invalid.key=randomUUID();invalid.input.decisionId=randomUUID();change(invalid);invalid.input.humanActionReceipt=templateDecisionActionReference({workspaceId:W,principalId:'bve-human',packet:invalid});assert.equal(w.k.templateCommand(w.c.human,invalid).schemaVersion,'3djat.failure.v1',label);}
 const accepted=w.success(w.k.templateCommand(w.c.human,promotion));
 assert.deepEqual(w.k.templateCommand(w.c.human,promotion),accepted);
 assert.equal(w.k.templateCommand(w.c.human,{...promotion,input:{...promotion.input,reason:'Changed'}}).error.code,'IDEMPOTENCY_CONFLICT');
 const current=w.store.read().reference,registry=w.k.templateReview(w.c.human,{schemaVersion:'3djat.template-query.v1',kind:'template',atHead:current,templateId:'creative-composition'});
 assert.equal(registry.data.revisions.length,5);assert.equal(registry.data.decisions.length,2);
 assert.deepEqual(registry.data.decisions[0].activeAppliesTo,['artistic']);assert.deepEqual(registry.data.decisions[1].activeAppliesTo,['instagram-artistic']);
 assert.equal(action(w,'view',{productId:P}).experiments[1].statuses.human,'adopted for Instagram artistic');
 const headAfter=w.store.read().reference,proposal=action(w,'propose',{experimentId:second.experimentId,original:changed.reference,instructions:'Later light products need softer contrast; proposed only.',reason:'Later light-product adjustment.'});
 assert.equal(proposal.kind,'proposal');assert.deepEqual(w.store.read().reference,headAfter);
 assert.equal(w.k.read(w.c.human,'job').length,6);assert.ok(w.k.read(w.c.human,'job').every(j=>j.invocationsStarted===1));
 fs.writeFileSync(path.join(w.dir,'EXAMPLE3-EVIDENCE.json'),JSON.stringify({authoredOnly:true,beforeHead,afterHead:w.store.read().reference,first,firstResult:a.result,review,revision:changed,second,secondResult:b.result,secondReview,promotion,accepted,proposal,scope:'instagram-artistic',visual:'untested',human:'Authored protocol decision only; Mahsa acceptance not claimed',originals:w.originals},null,2));
});

test('J11 failed and unavailable authored generators remain failed/blocked and cannot be promoted',{timeout:900000},t=>{
 const w=setup11(t);
 for(const failure of ['failed','unavailable']){
  const created=action(w,'create',input11(w)),result=generate11(w,created,{failure}).result;
  assert.equal(result.record.lifecycle,failure==='failed'?'failed':'blocked');assert.ok(result.record.variants.every(v=>v.outputs.length===0));
  assert.throws(()=>action(w,'review',{experimentId:created.experimentId,comments:'Cannot visually review missing results',selectedVariant:w.variants[1]}),e=>e.code==='CAPABILITY_UNAVAILABLE');
  const v=action(w,'view',{productId:P}).experiments.find(e=>e.plan.id===created.experimentId);assert.equal(v.statuses.visual,'untested');assert.equal(v.statuses.human,'awaiting approval');
 }
});

test('J11 changed guidance bytes and revoked source grants refuse calibration before dispatch',{timeout:900000},t=>{
 const w=setup11(t),input=input11(w);fs.appendFileSync(path.join(w.domain,'calibration-guide.md'),'Changed source guidance.');
 assert.throws(()=>action(w,'create',input),e=>['EVIDENCE_MISMATCH','MISSING_SOURCE','HASH_MISMATCH'].includes(e.code));assert.equal(w.k.read(w.c.human,'job').length,0);
 const other=setup11(t),policy=JSON.parse(fs.readFileSync(other.accessFile)),principal=policy.principals.find(p=>p.id==='bve-human');
 const draft=input11(other);configureTemplateGrant(other.accessFile,{workspaceId:W,principalId:'bve-human',role:'human',grant:{...principal.templateGrant,sourceIds:[]},expectedSha256:hash(fs.readFileSync(other.accessFile)),confirmedQuiescent:true});
 assert.throws(()=>action(other,'create',draft));assert.equal(other.k.read(other.c.human,'job').length,0);
});
