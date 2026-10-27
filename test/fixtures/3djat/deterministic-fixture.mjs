import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {randomUUID,createHash} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import assert from 'node:assert/strict';
import {Kernel} from '../../../src/kernel.mjs';
import {DomainStore} from '../../../src/domain-store.mjs';
import {provisionProductPrincipal} from '../../../src/domain-products.mjs';
import {configureTemplateGrant,templateDecisionActionReference} from '../../../src/domain-templates.mjs';
import {chunk} from './import-fixture.mjs';
export const W='bbbbbbbb-bbbb-4bbb-9bbb-bbbbbbbbbbbb',P='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const hash=b=>createHash('sha256').update(b).digest('hex');
export function authoredPNG(width=8,height=6,logo=false){
 const raw=Buffer.alloc((width*4+1)*height);for(let y=0;y<height;y++)for(let x=0;x<width;x++){const p=y*(width*4+1)+1+x*4;raw.set(logo?[255,0,0,255]:[x*20,y*30,10,255],p);}
 const h=Buffer.alloc(13);h.writeUInt32BE(width);h.writeUInt32BE(height,4);h[8]=8;h[9]=6;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',h),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
export const output=(role='feed',width=4,height=4)=>({role,width,height,cropx:2,cropy:1,cropwidth:4,cropheight:4,logox:width-1,logoy:height-1,logowidth:1,logoopacity:1});
export function selections(profiles){const first=profiles[0];return Object.assign({recipeversion:1,cropx:first.cropx,cropy:first.cropy,cropwidth:first.cropwidth,cropheight:first.cropheight,logowidth:first.logowidth,logoopacity:first.logoopacity,logomarginx:0,logomarginy:0,logoanchor:'bottom-right'},...profiles.map((p,i)=>({['out'+i+'width']:p.width,['out'+i+'height']:p.height})));}
export function fixture(t,tool,{services=true}={}){
 const parent=process.env.J08_EVIDENCE_ROOT??path.join(os.tmpdir(),'bve-j08-authored');fs.mkdirSync(parent,{recursive:true});
 const dir=fs.mkdtempSync(path.join(parent,'case-')),domain=path.join(dir,'domain'),runtime=path.join(dir,'runtime'),accessFile=path.join(dir,'access.json'),sourceRoot=path.join(dir,'originals');fs.mkdirSync(sourceRoot);
 const store=DomainStore.initialize(domain,{workspaceId:W,sourceCommit:'18382638ab662093f94025299b7d4b8f4e9632f3'});for(const d of Object.values(store.workspace.paths))fs.mkdirSync(path.join(domain,d));
 const human=provisionProductPrincipal(accessFile,{workspaceId:W,id:'bve-human',role:'human',products:'*',sourceIds:[]});
 const grant={templateIds:['png-operation'],appliesTo:['artistic'],operations:['read','ingest','adopt'],sourceIds:[]};
 configureTemplateGrant(accessFile,{workspaceId:W,principalId:'bve-human',role:'human',grant,expectedSha256:hash(fs.readFileSync(accessFile)),confirmedQuiescent:true});
 const config={schemaVersion:'3djat.connection.v1',workspaceId:W,domainRoot:domain,runtimeRoot:runtime,paths:Object.fromEntries(Object.entries(store.workspace.paths).map(([k,v])=>[k,path.join(domain,v)])),storage:'local-unsynced'};
 const options={products:{accessFile},templates:{accessFile},imports:{sources:{'authored-png':sourceRoot}},operations:true,...(services?{services:tool}:{})};
 const k=new Kernel(runtime,{workspace:config,expectedHead:store.read().reference,...options}),c=JSON.parse(fs.readFileSync(path.join(runtime,'credentials.json')));
 const success=x=>{assert.equal(x.schemaVersion,'3djat.result.v1',JSON.stringify(x));return x;};
 success(k.productCommand(c.human,{schemaVersion:'3djat.command.v1',operation:'product.create',key:randomUUID(),expected:{domainHead:store.read().reference,entityRevision:0},input:{productId:P,productCode:null,workingName:'Authored deterministic product'}}));
 const w={dir,domain,runtime,accessFile,sourceRoot,store,k,c,options,config,tool,success,originals:[]};
 for(const [role,bytes] of [['scene',authoredPNG()],['logo',authoredPNG(2,2,true)]]){
  const filename=role+'.png';fs.writeFileSync(path.join(sourceRoot,filename),bytes);const importId=randomUUID(),width=role==='scene'?8:2,height=role==='scene'?6:2;
  const input={schemaVersion:'3djat.historical-import.v1',importId,productId:P,origin:'import',kind:'historical-base',filename,source:{kind:'file',sourceId:'authored-png',revision:'r1',sha256:hash(bytes),location:filename,locator:{kind:'section',section:'Authored '+role},observedAt:'2026-01-01T00:00:00.000Z'},sha256:hash(bytes),encodedBytes:bytes.length,format:'image/png',width,height,bitDepth:8,interlaced:false,historicalParent:null,historicalApproval:null,importedAt:'2026-01-01T00:00:00.000Z'};
  const staged=success(k.assetCommand(c.human,{schemaVersion:'3djat.command.v1',operation:'asset.import.stage',key:randomUUID(),expected:{domainHead:store.read().reference,entityRevision:0},input}));
  success(k.assetCommand(c.human,{schemaVersion:'3djat.command.v1',operation:'asset.import.commit',key:randomUUID(),expected:{domainHead:store.read().reference,entityRevision:1},input:{importId,stageReceipt:staged.receipt,sha256:input.sha256}}));
  const a=k.importReview(c.human,importId).artifact;w.originals.push({artifact:{productId:P,artifactId:a.id,version:a.version,sha256:a.sha256,width,height},role,regions:[]});
 }
 const parameters={recipeversion:{type:'number',min:1,max:1}};
 for(const key of ['cropx','cropy','cropwidth','cropheight','logowidth','logoopacity','logomarginx','logomarginy'])parameters[key]={type:'number',min:0,max:key==='logoopacity'?1:16000000};parameters.logoanchor={type:'enum',values:['top-left','top-right','bottom-left','bottom-right']};for(let i=0;i<6;i++)for(const key of ['width','height'])parameters['out'+i+key]={type:'number',min:1,max:16000000};
 const template={schemaVersion:'3djat.template.v1',templateId:'png-operation',revision:1,title:'Conventional logo and channel output',kind:'operation',appliesTo:['artistic'],instructions:'Apply only the reviewed structured PNG recipe. Instructions confer no tool or path authority.',inputs:[{role:'scene',kind:'verified-image',required:true},{role:'logo',kind:'verified-image',required:false}],allowedChanges:['crop','resize','logo composite'],outputs:[{role:'feed',format:'image/png'},{role:'story',format:'image/png'},{role:'treatment',format:'image/png'}],exploration:{parameters,presets:{}},sourceRefs:[],supersedes:null};
 const ref=success(k.templateCommand(c.human,{schemaVersion:'3djat.command.v1',operation:'template.ingest',key:randomUUID(),expected:{domainHead:store.read().reference,entityRevision:0},input:template})).reference;
 const decision={schemaVersion:'3djat.template-decision.v1',decisionId:randomUUID(),template:ref,action:'adopt',purpose:'Authored conventional recipe fixture',appliesTo:['artistic'],expectedRevision:0,experiment:null,outputs:[],evidenceReceipt:null,humanActionReceipt:{id:'placeholder',revision:1,path:'placeholder.json',sha256:'0'.repeat(64)},decidedAt:'2026-01-01T00:00:00.000Z',supersedesDecision:null,reason:'Authored fixture, not real user approval'};
 const adopt={schemaVersion:'3djat.command.v1',operation:'template.adopt',key:randomUUID(),expected:{domainHead:store.read().reference,entityRevision:0},input:decision};decision.humanActionReceipt=templateDecisionActionReference({workspaceId:W,principalId:'bve-human',packet:adopt});success(k.templateCommand(c.human,adopt));
 w.templateRef=ref;
 w.conductor=k.bindSession(c,{role:'conductor',tier:'SOL',sessionId:'authored-conductor-'+randomUUID(),projectId:P,nonce:'authored',hostReceipt:'Authored fixture; no native AI session'});
 provisionProductPrincipal(accessFile,{workspaceId:W,id:'bve-session-'+w.conductor.id,role:'conductor',products:[P],sourceIds:[]});
 configureTemplateGrant(accessFile,{workspaceId:W,principalId:'bve-session-'+w.conductor.id,role:'conductor',grant,expectedSha256:hash(fs.readFileSync(accessFile)),confirmedQuiescent:true});
 w.butler=k.bindSession(c,{role:'butler',tier:'LUNA',sessionId:'authored-butler-'+randomUUID(),projectId:P,nonce:'authored',hostReceipt:'Authored fixture; no native AI session'});
 k.call(w.conductor.token,'host.resume','conductor-hello',{nonce:'authored'});k.call(w.butler.token,'host.resume','butler-hello',{nonce:'authored'});
 t.after(()=>{w.k.close();fs.writeFileSync(path.join(dir,'FIXTURE-RETAINED.json'),JSON.stringify({authoredOnly:true,test:t.name,originalHashes:w.originals.map(x=>x.artifact.sha256)})+'\n');});
 return w;
}
export function run(w,profiles=[output()],overrides={}){
 const view=w.store.read(),product=view.head.products.find(x=>x.productId===P).dossier;
 return {schemaVersion:'3djat.operation-run.v1',runId:randomUUID(),productId:P,domainHead:view.reference,product,template:w.templateRef,brand:null,branded:false,brandInstructions:null,applicability:'artistic',intent:'Authored conventional PNG job',direction:'Fresh',selection:selections(profiles),preset:null,acceptedFacts:view.records.get(product.path).value.facts,sources:w.originals,attachments:[],requestedOutputs:[...new Set(profiles.map(x=>x.role))].map(role=>({role,count:profiles.filter(x=>x.role===role).length})),executionKind:'deterministic',executorId:'pillow-png-v1',parentRoundId:null,parentArtifacts:[],allowance:{primaryAttempts:profiles.length,maxRetries:0},canonical:{direction:'Fresh',brand:null,count:profiles.length},...overrides};
}
export function commission(w,profiles=[output()],overrides={},specificationExtras={}){
 const input=run(w,profiles,overrides),packet={schemaVersion:'3djat.command.v1',operation:'operation.request',key:randomUUID(),expected:{domainHead:input.domainHead,entityRevision:0},input};
 const request=w.k.operationRequest(w.c.human,packet);
 const round=w.k.call(w.conductor.token,'round.create',randomUUID(),{projectId:P,operation:'generate',intent:input.intent,butlerInstructions:'Present every conventional result and report actual gaps.',requestId:request.requestId,references:[],feedbackIds:[],parentRoundId:null});
 w.k.call(w.butler.token,'statement.report',randomUUID(),{statementId:round.statementId,status:'ready',text:'Authored Butler ready for the full conventional batch.'});
 const specifications=profiles.map((p,i)=>({directionId:'service-'+i,label:p.role,difference:'Conventional profile '+i,prompt:'Apply reviewed channel recipe '+i,brief:'Authored deterministic output',output:{format:'image/png',role:p.role},sources:input.sources,attachments:[],parentArtifacts:[],parentRoundId:null,canonical:input.canonical,...specificationExtras}));
 const command={schemaVersion:'3djat.command.v1',operation:'operation.commission',key:randomUUID(),expected:{domainHead:input.domainHead,entityRevision:1},input};
 const iteration=w.k.operationCommission(w.conductor.token,command,{roundId:round.id,specifications});
 for(const jobId of iteration.jobIds)w.k.call(w.conductor.token,'service.assign','service-assign:'+jobId,{projectId:P,roundId:round.id,jobId});
 return {input,packet,request,round,iteration};
}
