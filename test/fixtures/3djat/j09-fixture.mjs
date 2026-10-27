import {deflateSync} from 'node:zlib';
import {chunk} from './import-fixture.mjs';
// Disposable developer fixtures only. Creative PNGs are authored, never a native generator claim.
import * as fs from 'node:fs';import path from 'node:path';import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {fixture as base,hash,authoredPNG,P,W} from './deterministic-fixture.mjs';
import {configureTemplateGrant,templateDecisionActionReference} from '../../../src/domain-templates.mjs';
import {operationUIHandler} from '../../../src/operation-ui-http.mjs';
import {dispatchPNGServices} from '../../../src/executors/pillow.mjs';
export {P,hash};
export function ui(w,path,input,token=w.c.human){
 return operationUIHandler(w.k,token,{method:path==='/api/content-review'?'GET':'POST',path,query:path==='/api/content-review'?input:{},input});
}
export function setup(t,tool){
 const w=base(t,tool),ids=['png-operation','creative-composition','logo-placement','instagram-output','brand-a'];
 for(const [principalId,role] of [['bve-human','human'],['bve-session-'+w.conductor.id,'conductor']])
  configureTemplateGrant(w.accessFile,{workspaceId:W,principalId,role,grant:{templateIds:ids,appliesTo:['artistic'],operations:role==='human'?['read','ingest','adopt']:['read'],sourceIds:[]},expectedSha256:hash(fs.readFileSync(w.accessFile)),confirmedQuiescent:true});
 w.adopt=template=>{
  const reference=w.success(w.k.templateCommand(w.c.human,{schemaVersion:'3djat.command.v1',operation:'template.ingest',key:randomUUID(),expected:{domainHead:w.store.read().reference,entityRevision:template.revision-1},input:template})).reference;
  const d={schemaVersion:'3djat.template-decision.v1',decisionId:randomUUID(),template:reference,action:'adopt',purpose:'Authored J09 Example 2',appliesTo:['artistic'],expectedRevision:0,experiment:null,outputs:[],evidenceReceipt:null,humanActionReceipt:{id:'placeholder',revision:1,path:'placeholder.json',sha256:'0'.repeat(64)},decidedAt:new Date().toISOString(),supersedesDecision:null,reason:'Developer fixture only'};
  const packet={schemaVersion:'3djat.command.v1',operation:'template.adopt',key:randomUUID(),expected:{domainHead:w.store.read().reference,entityRevision:0},input:d};
  d.humanActionReceipt=templateDecisionActionReference({workspaceId:W,principalId:'bve-human',packet});w.success(w.k.templateCommand(w.c.human,packet));return reference;
 };
 const basic={schemaVersion:'3djat.template.v1',revision:1,kind:'operation',appliesTo:['artistic'],instructions:'Authored scenario; preserve the photographed bowl. Instructions are data, not invocation authority.',inputs:[{role:'scene',kind:'verified-image',required:true}],allowedChanges:['authored scene'],outputs:[{role:'candidate',format:'image/png'}],sourceRefs:[],supersedes:null};
 w.adopt({...basic,templateId:'creative-composition',title:'Creative Composition',launch:{brandedDefault:true,allowUnbranded:true,executionKind:'generative'},exploration:{parameters:{preserveproduct:{type:'boolean'},exploration:{type:'enum',values:['balanced','light']},contrast:{type:'number',min:0,max:1}},presets:{balanced:{preserveproduct:true,exploration:'balanced',contrast:0.5}}}});
 w.adopt({...basic,templateId:'brand-a',title:'Authored accepted Brand',kind:'brand',inputs:[],outputs:[],instructions:'Authored Brand: natural soft light. Not a real visual calibration.'});
 const parameters={recipeversion:{type:'number',min:1,max:1},cropx:{type:'number',min:0,max:8},cropy:{type:'number',min:0,max:6},cropwidth:{type:'number',min:1,max:8},cropheight:{type:'number',min:1,max:6},logowidth:{type:'number',min:1,max:8},logoopacity:{type:'number',min:0,max:1},logomarginx:{type:'number',min:0,max:8},logomarginy:{type:'number',min:0,max:8},logoanchor:{type:'enum',values:['bottom-right','bottom-left']}};
 for(let i=0;i<3;i++)for(const k of ['width','height'])parameters['out'+i+k]={type:'number',min:1,max:16};
 for(const k of ['out0logoopacity','out1logoopacity'])parameters[k]={type:'number',min:0,max:1};
 parameters.out2logoanchor={type:'enum',values:['bottom-left','bottom-right']};parameters.out2logowidth={type:'number',min:1,max:8};
 for(const k of ['x','y','width','height'])parameters['out1crop'+k]={type:'number',min:k==='width'||k==='height'?1:0,max:8};
 for(const [templateId,title,roles] of [['logo-placement','Logo Placement',['treatment']],['instagram-output','Instagram Post / Story Output',['feed','story']]]){
  w.adopt({...basic,templateId,title,launch:{brandedDefault:false,allowUnbranded:true,executionKind:'deterministic'},inputs:[...basic.inputs,{role:'logo',kind:'verified-image',required:true}],outputs:roles.map(role=>({role,format:'image/png'})),exploration:{parameters,presets:{}}});
 }
 return w;
}
export function makePacket(w,templateId,{sources=w.originals.slice(0,1),selection={},outputs=[{role:'candidate',count:3}],branded=false,parents=[],parentRoundId=null,intent='Authored developer Example 2'}={}){
 const prep=ui(w,'/api/operation-preparation',{productId:P,applicability:'artistic',operationTemplateId:templateId,branded,brandTemplateId:branded?'brand-a':null});
 const count=outputs.reduce((n,x)=>n+x.count,0),brandInstructions=prep.brand?.record.instructions??null;
 const input={schemaVersion:'3djat.operation-run.v1',runId:randomUUID(),productId:P,domainHead:prep.head,product:prep.product.reference,template:prep.operation.reference,brand:prep.brand?.reference??null,branded,brandInstructions,applicability:'artistic',intent,direction:parents.length?'Follow':'Fresh',selection,preset:null,acceptedFacts:prep.product.record.facts,sources,attachments:[],requestedOutputs:outputs,executionKind:prep.operation.record.launch.executionKind,executorId:prep.operation.record.launch.executionKind==='deterministic'?'pillow-png-v1':'authored-unavailable-generator',parentRoundId,parentArtifacts:parents,allowance:{primaryAttempts:count,maxRetries:0},canonical:{direction:parents.length?'Follow':'Fresh',brand:brandInstructions,count}};
 return {schemaVersion:'3djat.command.v1',operation:'operation.request',key:randomUUID(),expected:{domainHead:prep.head,entityRevision:0},input};
}
export function commissionPacket(w,packet){
 const input=packet.input,request=ui(w,'/api/operation-request',packet);
 const round=w.k.call(w.conductor.token,'round.create',randomUUID(),{projectId:P,operation:'generate',intent:input.intent,butlerInstructions:'Authored fixture: retain every alternative and report actual gaps.',requestId:request.requestId,references:[],feedbackIds:[],parentRoundId:input.parentRoundId});
 w.k.call(w.butler.token,'statement.report',randomUUID(),{statementId:round.statementId,status:'ready',text:'Authored Butler ready.'});
 const roles=input.requestedOutputs.flatMap(x=>Array(x.count).fill(x.role));
 const specifications=roles.map((role,i)=>({directionId:'authored-'+i,label:input.executionKind==='generative'?'Candidate '+String.fromCharCode(65+i):role+' '+String.fromCharCode(65+i),difference:'Authored alternative '+i,prompt:input.intent+' Authored alternative '+i,brief:'Authored Example 2',output:{format:'image/png',role},sources:input.sources,attachments:input.attachments,parentArtifacts:input.parentArtifacts,parentRoundId:input.parentRoundId,canonical:input.canonical}));
 const command={...packet,operation:'operation.commission',key:randomUUID(),expected:{...packet.expected,entityRevision:1}};
 const iteration=w.k.operationCommission(w.conductor.token,command,{roundId:round.id,specifications});
 return {input,request,round,iteration};
}
export function decide(w,a,action,channel=null,reason='Authored explicit human fixture decision'){
 const data=ui(w,'/api/content-review',{productId:P}),last=data.entries.find(e=>e.artifact.id===a.id).history.at(-1);
 const input={schemaVersion:'3djat.candidate-decision.v1',decisionId:randomUUID(),productId:P,artifact:{productId:P,artifactId:a.id,version:a.version,sha256:a.sha256,width:a.width,height:a.height},action,purpose:channel?'Channel output':'Candidate review',channel,reason,decidedAt:new Date().toISOString(),humanActionReceipt:{id:'placeholder',revision:1,path:'placeholder.json',sha256:'0'.repeat(64)},supersedesDecision:last?.reference??null};
 const packet={schemaVersion:'3djat.command.v1',operation:'candidate.decide',key:randomUUID(),expected:{domainHead:data.head,entityRevision:last?.sequence??0},input};
 input.humanActionReceipt=ui(w,'/api/candidate-action-reference',packet);return {packet,result:ui(w,'/api/candidate-decision',packet)};
}
export function present(w,batch){
 const artifacts=w.k.read(w.c.human,'artifact').filter(a=>batch.iteration.jobIds.includes(a.jobId)).sort((a,b)=>batch.iteration.jobIds.indexOf(a.jobId)-batch.iteration.jobIds.indexOf(b.jobId));
 w.k.call(w.butler.token,'round.present',randomUUID(),{roundId:batch.round.id,title:'Authored Example 2 results',references:artifacts.map(a=>({productId:P,artifactId:a.id,version:a.version,sha256:a.sha256,width:a.width,height:a.height,role:'result'}))});
 w.k.call(w.butler.token,'statement.report',randomUUID(),{statementId:batch.round.statementId,status:'completed',text:'Whole authored batch accounted for.'});return artifacts;
}
function candidateBytes(i){
 const width=8,height=6,raw=Buffer.alloc((width*4+1)*height);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++)raw.set([x*20+i*15,y*30,10+i*40,255],y*(width*4+1)+1+x*4);
 const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=6;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
export function creative(w,packet=null){
 packet??=makePacket(w,'creative-composition',{branded:true,selection:{preserveproduct:true,exploration:'balanced',contrast:0.5}});const batch=commissionPacket(w,packet);
 for(const [i,id] of batch.iteration.jobIds.entries()){
  w.k.call(w.conductor.token,'staff.reserve',randomUUID(),{projectId:P,role:'worker',jobId:id});
  const worker=w.k.bindSession(w.c,{role:'worker',tier:'LUNA',sessionId:'authored-only-'+randomUUID(),projectId:P,jobId:id,nonce:'authored',hostReceipt:'Authored developer delivery; no native session or generator'});
  w.k.call(worker.token,'host.resume',randomUUID(),{nonce:'authored'});
  const assigned=w.k.call(w.conductor.token,'worker.assign',randomUUID(),{projectId:P,bindingId:worker.id,capability:{status:'simulated',originalBytes:true,formats:['image/png'],paid:false}});
  w.k.call(worker.token,'worker.start','start:'+id,{roundId:batch.round.id});
  assert.throws(()=>w.k.call(worker.token,'worker.start','start:'+id,{roundId:batch.round.id}),/already started|uncertain/);
  const access=w.k.call(worker.token,'host.resume',randomUUID(),{nonce:'authored'}).assignmentAccess;
  const bytes=candidateBytes(i); // Distinct authored swatches, not product-image generation.
  w.k.call(access.token,'result.deliver','delivery:'+id,{assignmentId:assigned.assignmentId,outcome:'success',bytes:bytes.toString('base64'),evidence:{kind:'simulated',note:'Authored developer pixels; not a native generator'}});
  const statement=w.k.read(worker.token,'statement').find(s=>s.jobId===id);
  w.k.call(worker.token,'statement.report',randomUUID(),{statementId:statement.id,status:'produced',text:'Authored fixture PNG delivered.'});
 }
 return {packet,batch,artifacts:present(w,batch)};
}
export const selection=(a,count=1)=>Object.assign({recipeversion:1,cropx:0,cropy:0,cropwidth:a.width,cropheight:a.height,logowidth:1,logoopacity:0.5,logomarginx:0,logomarginy:0,logoanchor:'bottom-right'},...Array.from({length:count},(_,i)=>({['out'+i+'width']:4,['out'+i+'height']:4})));
export async function deterministic(w,packet){
 const batch=commissionPacket(w,packet);
 for(const jobId of batch.iteration.jobIds)w.k.call(w.conductor.token,'service.assign','assign:'+jobId,{projectId:P,roundId:batch.round.id,jobId});
 const result=await dispatchPNGServices(w.k,w.c,batch.iteration.jobIds);assert.ok(result.outcomes.every(x=>x.outcome==='success'),JSON.stringify(result));
 return {...batch,artifacts:present(w,batch)};
}
