// All images/session callbacks here are disposable authored protocol fixtures, not native creative evidence.
import {setup,P} from './j09-fixture.mjs';
import {configureTemplateGrant} from '../../../src/domain-templates.mjs';
import {hash} from './deterministic-fixture.mjs';
import {operationUIHandler} from '../../../src/operation-ui-http.mjs';
import {authoredPNG,W} from './deterministic-fixture.mjs';
import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {randomUUID} from 'node:crypto';
export {P};
export const action=(w,action,input,token=w.c.human,key=randomUUID())=>operationUIHandler(w.k,token,{method:'POST',path:'/api/calibration',input:{action,key,input}});
export function setup11(t){
 const w=setup(t,null),policy=JSON.parse(fs.readFileSync(w.accessFile));
 fs.writeFileSync(path.join(w.domain,'calibration-guide.md'),'Authored contrast guidance; no native image or visual acceptance.\n');
 const source={kind:'file',sourceId:'calibration-guide',revision:'r1',sha256:hash(fs.readFileSync(path.join(w.domain,'calibration-guide.md'))),location:'calibration-guide.md',locator:{kind:'section',section:'Authored contrast variants'},observedAt:'2026-01-01T00:00:00.000Z'};
 for(const p of policy.principals.filter(p=>p.templateGrant))configureTemplateGrant(w.accessFile,{workspaceId:W,principalId:p.id,role:p.role,grant:{...p.templateGrant,appliesTo:['artistic','instagram-artistic'],sourceIds:['calibration-guide']},expectedSha256:hash(fs.readFileSync(w.accessFile)),confirmedQuiescent:true});
 let registry=w.k.templateReview(w.c.human,{schemaVersion:'3djat.template-query.v1',kind:'template',atHead:w.store.read().reference,templateId:'creative-composition'}),latest=registry.data.revisions.at(-1);
 w.variants=[];
 for(const [i,title] of ['A Balanced','B Defined','C Dramatic'].entries()){
  const template={...latest.record,revision:latest.record.revision+1,supersedes:latest.reference,appliesTo:['artistic','instagram-artistic'],title,instructions:'Authored '+title+' contrast guidance; preserve product. This is protocol data only.',sourceRefs:[source]};
  const result=w.success(w.k.templateCommand(w.c.human,{schemaVersion:'3djat.command.v1',operation:'template.ingest',key:randomUUID(),expected:{domainHead:w.store.read().reference,entityRevision:latest.record.revision},input:template}));
  latest={reference:result.reference,record:template};w.variants.push(result.reference);
 }
 return w;
}
export function input11(w,{variants=w.variants,previousExperiment=null,revisionLink=null}={}){
 const prep=action(w,'prepare',{productId:P,applicability:'artistic',operationTemplateId:'creative-composition',branded:true,brandTemplateId:'brand-a'});
 return {preparation:{applicability:'artistic',operationTemplateId:'creative-composition',branded:true,brandTemplateId:'brand-a',atHead:prep.preparation.head},
  record:{schemaVersion:'3djat.calibration.v1',experimentId:randomUUID(),productId:P,revision:1,lifecycle:'draft',
   commonSources:[w.originals[0].artifact],commonIntent:'Authored Example3: compare three contrast treatments for photographed product1122.',
   commonSettings:{preserveproduct:true,exploration:'balanced',contrast:0.5},seed:73,executorId:'authored-unavailable-generator',executorVersion:'authored-v1',
   changedDimension:'Creative Composition contrast instructions',uncontrolledVariables:['Authored pixels do not establish native variability or visual quality.'],
   variants:variants.map(template=>({template,roundId:null,outcome:'draft',outputs:[],failureCode:null})),receipt:null},
  previousExperiment,revisionLink};
}
export function generate11(w,created,{failure=null}={}){
 const trace=(...x)=>{if(process.env.J11_TRACE)console.log(new Date().toISOString(),...x)};trace('generate',created.experimentId,failure);
 const view=action(w,'view',{productId:P}).experiments.find(e=>e.plan.id===created.experimentId);
 const round=w.k.call(w.conductor.token,'round.create',randomUUID(),{projectId:P,operation:'generate',intent:view.plan.record.commonIntent,butlerInstructions:'Authored Example3: account for all three exact variants and preserve every outcome.',requestId:created.requestId,references:[],feedbackIds:[],parentRoundId:null});
 w.k.call(w.butler.token,'statement.report',randomUUID(),{statementId:round.statementId,status:'ready',text:'Authored Butler ready.'});
 const crossed=structuredClone(view.specifications);crossed[0].calibration.variant=structuredClone(view.specifications[1].calibration.variant);
 assert.throws(()=>w.k.call(w.conductor.token,'round.commission',randomUUID(),{roundId:round.id,specifications:crossed}),e=>e.code==='EVIDENCE_MISMATCH');
 const iteration=w.k.call(w.conductor.token,'round.commission',randomUUID(),{roundId:round.id,specifications:view.specifications});
 const workers=[];
 for(const [i,jobId] of iteration.jobIds.entries()){
  w.k.call(w.conductor.token,'staff.reserve',randomUUID(),{projectId:P,role:'worker',jobId});
  trace('bind',i);const worker=w.k.bindSession(w.c,{role:'worker',tier:'LUNA',sessionId:'authored-j11-'+randomUUID(),projectId:P,jobId,nonce:'authored',hostReceipt:'Authored callback only; no native session or generator call'});
  w.k.call(worker.token,'host.resume',randomUUID(),{nonce:'authored'});
  const assigned=w.k.call(w.conductor.token,'worker.assign',randomUUID(),{projectId:P,bindingId:worker.id,capability:{status:'simulated',originalBytes:true,formats:['image/png'],paid:false}});
  if(failure==='unavailable'){
   const st=w.k.read(worker.token,'statement').find(s=>s.jobId===jobId);
   w.k.call(worker.token,'statement.report',randomUUID(),{statementId:st.id,status:'blocked',text:'No generator available; no invocation authorized.'});
  }else{
   trace('start',i);w.k.call(worker.token,'worker.start','start:'+jobId,{roundId:round.id});
   const access=w.k.call(worker.token,'host.resume',randomUUID(),{nonce:'authored'}).assignmentAccess,failed=failure==='failed';
   w.k.call(access.token,'result.deliver','delivery:'+jobId,{assignmentId:assigned.assignmentId,outcome:failed?'failure':'success',bytes:failed?'':authoredPNG(8+i,6).toString('base64'),evidence:{kind:'simulated',note:'Authored swatches, not real creative comparison.'}});
   const st=w.k.read(worker.token,'statement').find(s=>s.jobId===jobId);
   w.k.call(worker.token,'statement.report',randomUUID(),{statementId:st.id,status:failed?'failed':'produced',text:failed?'Authored failed generation.':'Authored original bytes delivered.'});
  }workers.push(worker);
 }
 const artifacts=w.k.read(w.c.human,'artifact').filter(a=>iteration.jobIds.includes(a.jobId));
 w.k.call(w.butler.token,'round.present',randomUUID(),{roundId:round.id,title:'Authored Example3 '+(failure??'comparison'),references:artifacts.map(a=>({artifactId:a.id,version:a.version,sha256:a.sha256,width:a.width,height:a.height,role:'result'}))});
 w.k.call(w.butler.token,'statement.report',randomUUID(),{statementId:round.statementId,status:failure==='unavailable'?'incomplete':'completed',text:'Actual authored batch outcome recorded.'});
 trace('commit');const result=action(w,'commit',{experimentId:created.experimentId},w.butler.token);
 for(const worker of workers)if(failure!=='unavailable')w.k.call(w.conductor.token,'staff.retire',randomUUID(),{projectId:P,bindingId:worker.id});
 return {result,round,iteration,artifacts,workers};
}
