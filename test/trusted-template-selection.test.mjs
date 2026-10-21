import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {DomainTemplates} from '../src/domain-templates.mjs';
import {template,setup,ready,ingest,adopt,injectIngestAudit,injectDecisionSequence,defaultGrant,W,P,OTHER,TIME} from './fixtures/3djat/trusted-template-selection-fixture.mjs';

let assertions=0;
const equal=(a,b)=>{assertions++;assert.deepEqual(a,b);};
const truth=x=>{assertions++;assert.ok(x);};
const refusal=(fn,code)=>{assertions++;assert.throws(fn,e=>e?.code===code,code);};
after(()=>{assert.ok(assertions<=180,`Authored assertion count ${assertions} exceeds 180`);});

test('01 signed active operation returns closed bounded provenance, not a capability',t=>{
 const w=ready(t),r=w.resolve();equal(Object.keys(r).sort(),['applicability','brand','head','operation','principalId','productId','sourceStatus'].sort());
 equal(r.operation.reference.revision,1);equal(r.brand,null);equal(r.sourceStatus,{operation:[],brand:null});truth(!Object.hasOwn(r,'authority'));
 truth(Buffer.byteLength(JSON.stringify(r))<=1024**2);
});
test('02 earlier adopted revision persists after a later unadopted draft',t=>{
 const w=ready(t);ingest(w,template('operation-a',{appliesTo:['artistic'],instructions:'Later draft'}));
 equal(w.resolve().operation.reference.revision,1);equal(w.resolver.readRegistry(w.human.token,{schemaVersion:'3djat.template-query.v1',kind:'discovery',atHead:w.store.read().reference,productId:P,applicability:'artistic',branded:false,brandTemplateId:null}).data.operations[0].chosen.template.revision,1);
});
test('03 partial supersession and signed re-adoption obey applicability',t=>{
 const w=ready(t),first=w.resolve().operation.reference,second=ingest(w,template('operation-a'));
 adopt(w,second,['artistic']);equal(w.resolve().operation.reference.revision,2);equal(w.resolve({applicability:'catalogue'}).operation.reference.revision,1);
 adopt(w,first,['artistic']);equal(w.resolve().operation.reference.revision,1);
});
test('04 explicit two-Brand choices remain distinct',t=>{
 const w=ready(t);for(const id of ['brand-a','brand-b'])adopt(w,ingest(w,template(id)));
 const a=w.resolve({branded:true,brandTemplateId:'brand-a'}),b=w.resolve({branded:true,brandTemplateId:'brand-b'});
 equal(a.brand.reference.id,'brand-a');equal(b.brand.reference.id,'brand-b');truth(a.brand.decisionReference.path!==b.brand.decisionReference.path);
});
test('05 missing, unadopted and wrong-kind selections refuse',t=>{
 const w=ready(t);ingest(w,template('other'));refusal(()=>w.resolve({operationTemplateId:'other'}),'CAPABILITY_UNAVAILABLE');
 refusal(()=>w.resolve({operationTemplateId:'brand-a'}),'MISSING_SOURCE');
 adopt(w,ingest(w,template('brand-a')));refusal(()=>w.resolve({operationTemplateId:'brand-a'}),'INVALID_SCOPE');
 refusal(()=>w.resolve({branded:true,brandTemplateId:'operation-a'}),'INVALID_VALUE');
 refusal(()=>w.resolve({branded:true,brandTemplateId:'other'}),'INVALID_SCOPE'); // Wrong Brand kind.
});
test('06 closed query rejects extra fields, getters and ill-typed values before reads',t=>{
 const w=ready(t),calls=w.nativeCalls;
 refusal(()=>w.resolve({role:'human'}),'INVALID_VALUE');
 const q=w.query();Object.defineProperty(q,'mode',{get(){throw Error('Getter must not execute');}});
 refusal(()=>w.resolver.resolveAdoptedForOperation(w.human.token,q),'INVALID_VALUE');
 refusal(()=>w.resolve({projectId:1}),'INVALID_TYPE');
 refusal(()=>w.resolve({branded:false,brandTemplateId:'brand-a'}),'INVALID_VALUE');equal(w.nativeCalls,calls);
});
test('07 native callback is mandatory even if the standalone bearer is valid',t=>{
 const w=ready(t),standalone=new DomainTemplates(w.root,{accessFile:w.accessFile});
 refusal(()=>standalone.resolveAdoptedForOperation(w.human.token,w.query()),'CAPABILITY_UNAVAILABLE');
});
test('08 null callback and unknown token refuse without bearer fallback',t=>{
 const w=ready(t);refusal(()=>w.resolve({},'f'.repeat(64)),'INVALID_SCOPE');w.native=null;
 refusal(()=>w.resolve(),'INVALID_SCOPE');
});
test('09 native identity, role and product scope intersect current private policy',t=>{
 const w=ready(t);w.native={id:'other',role:'human',products:'*'};refusal(()=>w.resolve(),'INVALID_SCOPE');
 w.native={id:w.human.principalId,role:'conductor',products:'*'};refusal(()=>w.resolve(),'INVALID_SCOPE');
 w.native={id:w.human.principalId,role:'human',products:[OTHER]};refusal(()=>w.resolve(),'INVALID_SCOPE');
});
test('10 current read, template, applicability and product grants each refuse',t=>{
 const w=ready(t);for(const [i,g] of [defaultGrant(),defaultGrant(),defaultGrant()].entries()){
  if(i===0)g.operations=['ingest','adopt'];if(i===1)g.templateIds=['other'];if(i===2)g.appliesTo=['catalogue'];
  w.setGrant(g);refusal(()=>w.resolve(),'INVALID_SCOPE');
 }
 w.setGrant(defaultGrant());w.changeAccess(a=>a.principals[0].products=[OTHER]);refusal(()=>w.resolve(),'INVALID_SCOPE');
});
test('11 selected local source is hash-verified with explicit provenance',t=>{
 const w=setup(t),ref=ingest(w,template('operation-a',{sourceRefs:[w.sourceRef]}));adopt(w,ref);
 const r=w.resolve();equal(r.sourceStatus.operation.length,1);equal(r.sourceStatus.operation[0].status,'verified');equal(r.sourceStatus.operation[0].source,w.sourceRef);
});
test('12 missing selected source blocks new but remains a historical blocker',t=>{
 const w=setup(t),ref=ingest(w,template('operation-a',{sourceRefs:[w.sourceRef]}));adopt(w,ref);
 fs.renameSync(path.join(w.root,w.sourceRef.location),path.join(w.root,'Sources/retained.txt'));
 refusal(()=>w.resolve(),'MISSING_SOURCE');equal(w.resolve({mode:'historical'}).sourceStatus.operation[0].cause,'MISSING_SOURCE');
});
test('13 changed selected source preserves precise HASH_MISMATCH',t=>{
 const w=setup(t),ref=ingest(w,template('operation-a',{sourceRefs:[w.sourceRef]}));adopt(w,ref);
 fs.writeFileSync(path.join(w.root,w.sourceRef.location),'Changed inert text with a different digest.\n');
 refusal(()=>w.resolve(),'HASH_MISMATCH');equal(w.resolve({mode:'historical'}).sourceStatus.operation[0].cause,'HASH_MISMATCH');
});
test('14 unsupported Drive source remains unavailable without fallback',t=>{
 const w=setup(t),drive={kind:'drive',sourceId:'inert',revision:'r1',sha256:w.sourceRef.sha256,fileId:'authored-id',modifiedAt:TIME,locator:{kind:'section',section:'Inert'},observedAt:TIME};
 const ref=ingest(w,template('operation-a',{sourceRefs:[drive]}));injectDecisionSequence(w,ref,0); // Authored signed file publication; existing writer would refuse unavailable adoption.
 refusal(()=>w.resolve(),'CAPABILITY_UNAVAILABLE');equal(w.resolve({mode:'historical'}).sourceStatus.operation[0].cause,'CAPABILITY_UNAVAILABLE');
});
test('15 revoked source use denies new while signed history stays readable',t=>{
 const w=setup(t),ref=ingest(w,template('operation-a',{sourceRefs:[w.sourceRef]}));adopt(w,ref);
 w.setGrant({...defaultGrant(),sourceIds:[]});refusal(()=>w.resolve(),'INVALID_SCOPE');
 const r=w.resolve({mode:'historical'});equal(r.sourceStatus.operation[0].cause,'INVALID_SCOPE');equal(r.operation.reference,ref);
 fs.renameSync(path.join(w.root,w.sourceRef.location),path.join(w.root,'Sources/retained.txt'));
 equal(w.resolve({mode:'historical'}).sourceStatus.operation[0].cause,'INVALID_SCOPE');
});
test('16 new stale head refuses; reachable historical head remains inspectable',t=>{
 const w=ready(t),old=w.store.read().reference;ingest(w,template('operation-a'));
 refusal(()=>w.resolve({atHead:old}),'REVISION_CONFLICT');
 const r=w.resolve({mode:'historical',atHead:old});equal(r.head,old);equal(r.operation.reference.revision,1);
});
test('17 detached and foreign heads cannot be inspected',t=>{
 const w=ready(t),v=ready(t);refusal(()=>w.resolve({mode:'historical',atHead:v.store.read().reference}),'REVISION_CONFLICT');
 const bad={...w.store.read().reference,sha256:'f'.repeat(64)};refusal(()=>w.resolve({mode:'historical',atHead:bad}),'REVISION_CONFLICT');
});
test('18 wildcard grant does not create a nonexistent product',t=>{
 const w=ready(t);w.native.products='*';refusal(()=>w.resolve({projectId:OTHER}),'MISSING_SOURCE');
});
test('19 bad MAC, role and event refuse in a structurally published fold',t=>{
 for(const fault of [{mac:'f'.repeat(64)},{mac:null},{role:'butler'},{eventChange:e=>e.commandHash='f'.repeat(64)}]){
  const w=ready(t);equal(w.resolve().operation.reference.id,'operation-a');injectIngestAudit(w,fault);
  refusal(()=>w.resolve(),'EVIDENCE_MISMATCH');
 }
});
test('20 unsupported unsigned subject and invalid signed decision sequence refuse',t=>{
 const a=ready(t),head=a.store.read().reference;
 a.store.commit({principal:'authored',operation:'unsigned-fixture',key:randomUUID(),expectedHead:head,changes:[{kind:'template',id:'other',expectedRevision:0,record:template('other')}],records:[]});
 refusal(()=>a.resolve(),'CAPABILITY_UNAVAILABLE');
 const b=ready(t),ref=b.resolve().operation.reference;injectDecisionSequence(b,ref);refusal(()=>b.resolve(),'EVIDENCE_MISMATCH');
});
test('21 changed native identity, grant, key or head at return refuses',t=>{
 for(const mode of ['identity','grant','key','head']){
  const w=ready(t);w.onNative=n=>{if(n!==2)return;
   if(mode==='identity')w.native={...w.native,id:'other'};
   if(mode==='grant')w.setGrant({...defaultGrant(),templateIds:['other']});
   if(mode==='key')w.changeAccess(a=>{a.key='f'.repeat(64);});
   if(mode==='head')w.store.commit({principal:'authored',operation:'noop',key:randomUUID(),expectedHead:w.store.read().reference,changes:[],records:[]});
  };
  refusal(()=>w.resolve(),mode==='key'?'EVIDENCE_MISMATCH':mode==='head'?'REVISION_CONFLICT':'INVALID_SCOPE');
 }
});
test('22 shared operation and Brand source budget refuses aggregate overflow',t=>{
 const w=setup(t),ids=Array.from({length:17},(_,i)=>'s'+i),bytes=Buffer.alloc(1024**2,65),file=path.join(w.root,'Sources/large.txt');
 fs.writeFileSync(file,bytes);const digest=createHash('sha256').update(bytes).digest('hex');
 w.setGrant({...defaultGrant(),sourceIds:ids});const refs=ids.map(sourceId=>({...w.sourceRef,sourceId,location:'Sources/large.txt',sha256:digest}));
 const operation=ingest(w,template('operation-a',{sourceRefs:refs.slice(0,16)}));adopt(w,operation);
 const brand=ingest(w,template('brand-a',{sourceRefs:[refs[16]]}));adopt(w,brand);
 refusal(()=>w.resolve({branded:true,brandTemplateId:'brand-a'}),'VALIDATION_LIMIT');
 equal(w.resolve().sourceStatus.operation.length,16);
});
test('23 source file limit and old read route retain their own semantics',t=>{
 const w=setup(t),ref=ingest(w,template('operation-a',{sourceRefs:[w.sourceRef]}));adopt(w,ref);
 truth(w.resolver.readRegistry(w.human.token,{schemaVersion:'3djat.template-query.v1',kind:'list',atHead:w.store.read().reference,applicability:null}).schemaVersion==='3djat.template-view.v1');
 fs.writeFileSync(path.join(w.root,w.sourceRef.location),Buffer.alloc(1024**2+1,65));
 refusal(()=>w.resolve(),'VALIDATION_LIMIT');
});
test('24 actual immutable byte corruption keeps HASH_MISMATCH, not a semantic-audit substitute',t=>{
 const w=ready(t),ref=w.resolve().operation.reference;truth(ref.path.startsWith('Domain/template/'));
 fs.writeFileSync(path.join(w.root,ref.path),'Changed authored bytes\n');refusal(()=>w.resolve(),'HASH_MISMATCH');
});
