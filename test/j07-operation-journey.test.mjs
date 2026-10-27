// Authored disposable files and PNGs; no native provider or human acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {randomUUID,createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {Kernel} from '../src/kernel.mjs';
import {DomainStore} from '../src/domain-store.mjs';
import {provisionProductPrincipal,decisionActionReference} from '../src/domain-products.mjs';
import {DomainTemplates,configureTemplateGrant,templateDecisionActionReference} from '../src/domain-templates.mjs';
import {configureBusinessGrant,businessDecisionActionReference} from '../src/domain-business.mjs';
import {png} from './fixtures/3djat/import-fixture.mjs';
import {backupCombined,verifyCombined,restoreCombined} from '../src/workspace-backup.mjs';

const W='bbbbbbbb-bbbb-4bbb-9bbb-bbbbbbbbbbbb',P='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const H=b=>createHash('sha256').update(b).digest('hex');
const grant=()=>({templateIds:['operation-a','brand-a'],appliesTo:['artistic'],operations:['read','ingest','adopt'],sourceIds:[]});
function fixture({source=false,brand=false,business=false,attachment=false,importFormat=true,operations=true,hook=()=>{}}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'j07-completion-')),domain=path.join(dir,'domain'),runtime=path.join(dir,'runtime'),accessFile=path.join(dir,'access.json'),businessAccess=path.join(dir,'business-access.json'),sourceRoot=path.join(dir,'source');
 const store=DomainStore.initialize(domain,{workspaceId:W,sourceCommit:'678272d269ef720fd41e63c2f60905c1b318095b'});
 for(const v of Object.values(store.workspace.paths))fs.mkdirSync(path.join(domain,v));fs.mkdirSync(sourceRoot);
 const businessBytes=Buffer.from('Authored business source only\n');
 if(business){fs.mkdirSync(path.join(domain,'Sources'));fs.writeFileSync(path.join(domain,'Sources/business.txt'),businessBytes);}
 const businessSource={kind:'file',sourceId:'business-inert',revision:'r1',sha256:H(businessBytes),location:'Sources/business.txt',locator:{kind:'section',section:'Authored'},observedAt:'2026-01-01T00:00:00.000Z'};
 const human=provisionProductPrincipal(accessFile,{workspaceId:W,id:'authored-human',role:'human'});
 const policy=(id,role)=>{
  provisionProductPrincipal(accessFile,{workspaceId:W,id,role,products:'*',sourceIds:attachment?['authored-files']:[]});
  configureTemplateGrant(accessFile,{workspaceId:W,principalId:id,role,grant:grant(),expectedSha256:H(fs.readFileSync(accessFile)),confirmedQuiescent:true});
 };
 configureTemplateGrant(accessFile,{workspaceId:W,principalId:human.principalId,role:'human',grant:grant(),expectedSha256:H(fs.readFileSync(accessFile)),confirmedQuiescent:true});
 policy('bve-human','human');
 if(business)configureBusinessGrant(businessAccess,{workspaceId:W,principalId:'bve-human',role:'human',grant:{operations:['read','publish'],sourceIds:['business-inert']},expectedSha256:null,confirmedQuiescent:true});
 const config={schemaVersion:'3djat.connection.v1',workspaceId:W,domainRoot:domain,runtimeRoot:runtime,paths:Object.fromEntries(Object.entries(store.workspace.paths).map(([k,v])=>[k,path.join(domain,v)])),storage:'local-unsynced'};
 const options={workspace:config,expectedHead:store.read().reference,products:{accessFile,...(attachment?{attachmentSources:{'authored-files':{root:sourceRoot,products:[P]}}}:{})},templates:{accessFile},
  ...(importFormat?{imports:{sources:{'authored-png':sourceRoot}}}:{}),...(business?{business:{accessFile:businessAccess}}:{}),operations,workspaceHook:hook};
 const kernel=new Kernel(runtime,options),credentials=JSON.parse(fs.readFileSync(path.join(runtime,'credentials.json')));
 assert.equal(kernel.productCommand(credentials.human,{schemaVersion:'3djat.command.v1',operation:'product.create',key:randomUUID(),expected:{domainHead:store.read().reference,entityRevision:0},input:{productId:P,productCode:null,workingName:'Authored J07 product'}}).schemaVersion,'3djat.result.v1');
 let attachmentRef=null;
 if(attachment){const data=Buffer.from('Authored opaque attachment\n'),sha256=H(data),attachmentId=randomUUID();fs.writeFileSync(path.join(sourceRoot,'attachment.raw'),data);
  const input={schemaVersion:'3djat.attachment.v1',attachmentId,productId:P,sha256,bytes:data.length,location:`${store.workspace.paths.products}/${P}/Sources/${sha256}.bin`,filename:'authored.bin',mime:'application/octet-stream',availability:'available',
    source:{kind:'file',sourceId:'authored-files',revision:'r1',sha256,location:'attachment.raw',locator:{kind:'section',section:'Authored'},observedAt:'2026-01-01T00:00:00.000Z'}};
  const result=kernel.productCommand(credentials.human,{schemaVersion:'3djat.command.v1',operation:'attachment.register',key:randomUUID(),expected:{domainHead:store.read().reference,entityRevision:0},input});
  assert.equal(result.schemaVersion,'3djat.result.v1',JSON.stringify(result));attachmentRef=result.reference;
 }
 const writer=new DomainTemplates(domain,{accessFile});
 const template={schemaVersion:'3djat.template.v1',templateId:'operation-a',revision:1,title:'Authored operation',kind:'operation',appliesTo:['artistic'],instructions:'Create an authored candidate.',inputs:[...(source?[{role:'base',kind:'verified-image',required:true}]:[]),...(attachment?[{role:'document',kind:'attachment',required:true}]:[])],allowedChanges:['background'],outputs:[{role:'candidate',format:'image/png'}],sourceRefs:[],supersedes:null};
 const ingest={schemaVersion:'3djat.command.v1',operation:'template.ingest',key:randomUUID(),expected:{domainHead:store.read().reference,entityRevision:0},input:template};
 const ref=kernel.templateCommand(credentials.human,ingest).reference;assert(ref);
 const decision={schemaVersion:'3djat.template-decision.v1',decisionId:randomUUID(),template:ref,action:'adopt',purpose:'Authored test adoption',appliesTo:['artistic'],expectedRevision:0,experiment:null,outputs:[],evidenceReceipt:null,humanActionReceipt:{id:'placeholder',revision:1,path:'placeholder.json',sha256:'0'.repeat(64)},decidedAt:'2026-01-01T00:00:00.000Z',supersedesDecision:null,reason:'Authored only'};
 const adoption={schemaVersion:'3djat.command.v1',operation:'template.adopt',key:randomUUID(),expected:{domainHead:store.read().reference,entityRevision:0},input:decision};
 decision.humanActionReceipt=templateDecisionActionReference({workspaceId:W,principalId:'bve-human',packet:adoption});
 assert.equal(kernel.templateCommand(credentials.human,adoption).schemaVersion,'3djat.result.v1');
 if(brand){
  const brandRecord={...template,templateId:'brand-a',title:'Authored Brand',kind:'brand',instructions:'Independent Brand instructions.',inputs:[],outputs:[]};
  const brandIngest={...ingest,key:randomUUID(),expected:{domainHead:store.read().reference,entityRevision:0},input:brandRecord};
  const brandRef=kernel.templateCommand(credentials.human,brandIngest).reference;assert(brandRef);
  const brandDecision={...decision,decisionId:randomUUID(),template:brandRef,humanActionReceipt:{id:'placeholder',revision:1,path:'placeholder.json',sha256:'0'.repeat(64)}};
  const brandAdopt={...adoption,key:randomUUID(),expected:{domainHead:store.read().reference,entityRevision:0},input:brandDecision};
  brandDecision.humanActionReceipt=templateDecisionActionReference({workspaceId:W,principalId:'bve-human',packet:brandAdopt});
  assert.equal(kernel.templateCommand(credentials.human,brandAdopt).schemaVersion,'3djat.result.v1');
 }
 const conductor=kernel.bindSession(credentials,{role:'conductor',tier:'SOL',sessionId:'authored-conductor-'+randomUUID(),projectId:P,nonce:'authored',hostReceipt:'Fixture only'});
 policy('bve-session-'+conductor.id,'conductor');
 if(business)configureBusinessGrant(businessAccess,{workspaceId:W,principalId:'bve-session-'+conductor.id,role:'conductor',grant:{operations:['read'],sourceIds:['business-inert']},expectedSha256:H(fs.readFileSync(businessAccess)),confirmedQuiescent:true});
 return {dir,domain,runtime,store,kernel,credentials,conductor,options,accessFile,businessAccess,businessSource,sourceRoot,human,writer,attachmentRef};
}
function imported(w){const raw=png(),importId=randomUUID(),filename='authored-'+importId+'.png';fs.writeFileSync(path.join(w.sourceRoot,filename),raw);
 const stage={schemaVersion:'3djat.command.v1',operation:'asset.import.stage',key:randomUUID(),expected:{domainHead:w.store.read().reference,entityRevision:0},input:{schemaVersion:'3djat.historical-import.v1',importId,productId:P,origin:'import',kind:'historical-base',filename,
  source:{kind:'file',sourceId:'authored-png',revision:'r1',sha256:H(raw),location:filename,locator:{kind:'section',section:'Authored'},observedAt:'2026-01-01T00:00:00.000Z'},
  sha256:H(raw),encodedBytes:raw.length,format:'image/png',width:8,height:6,bitDepth:8,interlaced:false,historicalParent:null,historicalApproval:null,importedAt:'2026-01-01T00:00:00.000Z'}};
 const s=w.kernel.assetCommand(w.credentials.human,stage);assert.equal(s.schemaVersion,'3djat.result.v1',JSON.stringify(s));
 const commit={schemaVersion:'3djat.command.v1',operation:'asset.import.commit',key:randomUUID(),expected:{domainHead:w.store.read().reference,entityRevision:1},input:{importId,stageReceipt:s.receipt,sha256:H(raw)}};
 const c=w.kernel.assetCommand(w.credentials.human,commit);assert.equal(c.schemaVersion,'3djat.result.v1',JSON.stringify(c));
 const a=w.kernel.importReview(w.credentials.human,importId).artifact;return {artifact:{productId:P,artifactId:a.id,version:a.version,sha256:a.sha256,width:a.width,height:a.height},raw};
}
function run(w,artifact=null,branded=false){const view=w.store.read(),product=view.head.products.find(x=>x.productId===P).dossier;
 const found=w.kernel.templateReview(w.credentials.human,{schemaVersion:'3djat.template-query.v1',kind:'discovery',atHead:view.reference,productId:P,applicability:'artistic',branded,brandTemplateId:branded?'brand-a':null}).data;
 const selected=found.operations[0].chosen,brandRef=found.brand?.template??null;
 const facts=view.records.get(product.path).value.facts;
 const brandInstructions=brandRef?view.records.get(brandRef.path).value.instructions:null;
 return {schemaVersion:'3djat.operation-run.v1',runId:randomUUID(),productId:P,domainHead:view.reference,product,template:selected.template,brand:brandRef,branded,brandInstructions,applicability:'artistic',intent:'One authored candidate',direction:'Fresh',selection:{},preset:null,acceptedFacts:facts,sources:artifact?[{artifact,role:'base',regions:[]}]:[],attachments:w.attachmentRef?[{reference:w.attachmentRef,role:'document'}]:[],requestedOutputs:[{role:'candidate',count:1}],executionKind:'generative',executorId:'explicit-adapter',parentRoundId:null,parentArtifacts:[],allowance:{primaryAttempts:1,maxRetries:0},canonical:{direction:'Fresh',brand:brandInstructions,count:1}};
}
test('adopted template becomes immutable request and survives restart',()=>{
 const w=fixture();try{const input=run(w),packet={schemaVersion:'3djat.command.v1',operation:'operation.request',key:randomUUID(),expected:{domainHead:w.store.read().reference,entityRevision:0},input};
 const discovery=w.kernel.operationDiscovery(w.credentials.human,{productId:P,applicability:'artistic'});
 assert.equal(discovery.operations[0].chosen.template.id,'operation-a');assert.equal(discovery.execution.state,'not-assessed');
 assert.deepEqual(discovery.brands,[]);
 const result=w.kernel.operationRequest(w.credentials.human,packet);assert.equal(result.state,'waiting-for-conductor');
 assert.deepEqual(w.kernel.operationRequest(w.credentials.human,packet),result);
 const row=w.kernel.operationSelection(w.credentials.human,result.requestId);assert.equal(row.body.run.runId,input.runId);
 w.kernel.close();w.kernel=new Kernel(w.runtime,{recover:false,products:{accessFile:w.accessFile},templates:{accessFile:w.accessFile},imports:{sources:{'authored-png':path.join(w.dir,'source')}},operations:true});
 assert.deepEqual(w.kernel.operationSelection(w.credentials.human,result.requestId),row);
 assert.throws(()=>w.kernel.operationRequest(w.credentials.human,{...packet,input:{...input,intent:'Changed'}}),e=>e.code==='IDEMPOTENCY_CONFLICT');
 }finally{w.kernel.close();}
});
test('separate adopted Brand is frozen; a contradictory Brand is rejected',()=>{
 const w=fixture({brand:true});try{const input=run(w,null,true),packet={schemaVersion:'3djat.command.v1',operation:'operation.request',key:randomUUID(),expected:{domainHead:w.store.read().reference,entityRevision:0},input};
  const discovery=w.kernel.operationDiscovery(w.credentials.human,{productId:P,applicability:'artistic',branded:true,brandTemplateId:'brand-a'});
  assert.equal(discovery.brand.template.id,'brand-a');assert.equal(discovery.brands[0].chosen.template.id,'brand-a');
  assert.equal(discovery.operations[0].chosen.template.id,'operation-a');
  const result=w.kernel.operationRequest(w.credentials.human,packet),row=w.kernel.operationSelection(w.credentials.human,result.requestId);
  assert.equal(row.body.brand.reference.id,'brand-a');assert.equal(row.body.run.brandInstructions,'Independent Brand instructions.');
  const changed={...input,runId:randomUUID(),brandInstructions:'Contradiction'};
  assert.throws(()=>w.kernel.operationRequest(w.credentials.human,{...packet,key:randomUUID(),input:changed}),e=>e.code==='INVALID_SCOPE');
 }finally{w.kernel.close();}
});
test('fresh operation-only v4 root has no implicit import format',()=>{
 const w=fixture({importFormat:false});try{const marker=JSON.parse(fs.readFileSync(path.join(w.runtime,'bve-v2-root.json')));
  assert.deepEqual(marker.features,['operation-selection.v1']);
  const input=run(w),result=w.kernel.operationRequest(w.credentials.human,{schemaVersion:'3djat.command.v1',operation:'operation.request',key:randomUUID(),expected:{domainHead:w.store.read().reference,entityRevision:0},input});
  assert.equal(w.kernel.operationSelection(w.credentials.human,result.requestId).id,input.runId);
 }finally{w.kernel.close();}
});
test('governed business context is resolved and frozen separately from the product',async()=>{
 const w=fixture({business:true});try{
  const input={workspaceId:W,expectedRevision:0,revision:1,instructions:'Authored business instruction',sourceRefs:[w.businessSource],decidedAt:'2026-01-01T00:00:00.000Z',humanActionReceipt:{id:'placeholder',revision:1,path:'placeholder.json',sha256:'0'.repeat(64)}};
  const publication={schemaVersion:'3djat.command.v1',operation:'business.context.publish',key:randomUUID(),expected:{domainHead:w.store.read().reference,entityRevision:0},input};
  input.humanActionReceipt=businessDecisionActionReference({workspaceId:W,principalId:'bve-human',packet:publication});
  const published=w.kernel.businessCommand(w.credentials.human,publication);assert.equal(published.schemaVersion,'3djat.result.v1',JSON.stringify(published));
  const selected=run(w),request=w.kernel.operationRequest(w.credentials.human,{schemaVersion:'3djat.command.v1',operation:'operation.request',key:randomUUID(),expected:{domainHead:w.store.read().reference,entityRevision:0},input:selected});
  const row=w.kernel.operationSelection(w.credentials.human,request.requestId);
  assert.equal(row.body.business.record.instructions,'Authored business instruction');assert.equal(row.body.product.reference.id,P);
  const backup=path.join(w.dir,'business-combined');await backupCombined(w.runtime,backup);assert.equal(verifyCombined(backup).workspaceId,W);
 }finally{w.kernel.close();}
});
test('accepted dossier extension composes as a separate frozen record',()=>{
 const w=fixture();try{
  const proposal={schemaVersion:'3djat.dossier-proposal.v1',proposalId:randomUUID(),productId:P,expectedRevision:1,origin:'human-authored',payload:{kind:'field',field:'description',fact:{state:'accepted',value:'Authored dossier fact',sourceRefs:[]}},replaces:null,reason:'Authored proposal',corrects:null};
  const packet={schemaVersion:'3djat.command.v1',operation:'product.dossier.proposal.submit',key:randomUUID(),expected:{domainHead:w.store.read().reference,entityRevision:1},input:proposal};
  const submitted=w.kernel.productCommand(w.credentials.human,packet);assert.equal(submitted.schemaVersion,'3djat.result.v1',JSON.stringify(submitted));
  const decision={schemaVersion:'3djat.dossier-decision.v1',decisionId:randomUUID(),productId:P,proposal:submitted.reference,expectedRevision:1,outcome:'accepted',reason:'Authored fixture only',decidedAt:'2026-01-01T00:00:00.000Z',humanActionReceipt:{id:'placeholder',revision:1,path:'placeholder.json',sha256:'0'.repeat(64)},supersedesDecision:null,correctedProposal:null};
  const approval={schemaVersion:'3djat.command.v1',operation:'product.dossier.proposal.decide',key:randomUUID(),expected:{domainHead:w.store.read().reference,entityRevision:1},input:decision};
  decision.humanActionReceipt=decisionActionReference({workspaceId:W,principalId:'bve-human',packet:approval});
  const accepted=w.kernel.productCommand(w.credentials.human,approval);assert.equal(accepted.schemaVersion,'3djat.result.v1',JSON.stringify(accepted));
  const input=run(w),request=w.kernel.operationRequest(w.credentials.human,{schemaVersion:'3djat.command.v1',operation:'operation.request',key:randomUUID(),expected:{domainHead:w.store.read().reference,entityRevision:0},input});
  const row=w.kernel.operationSelection(w.credentials.human,request.requestId);
  assert(row.body.dossier.some(x=>x.record.payload.fact.value==='Authored dossier fact'));
  assert.deepEqual(row.body.product.acceptedFacts,row.body.product.record.facts);
 }finally{w.kernel.close();}
});
test('registered opaque attachment binds exact product membership and current bytes',()=>{
 const w=fixture({attachment:true});try{const input=run(w),request=w.kernel.operationRequest(w.credentials.human,{schemaVersion:'3djat.command.v1',operation:'operation.request',key:randomUUID(),expected:{domainHead:w.store.read().reference,entityRevision:0},input});
  const row=w.kernel.operationSelection(w.credentials.human,request.requestId);
  assert.deepEqual(row.body.run.attachments,[{reference:w.attachmentRef,role:'document'}]);
  assert(row.body.product.record.attachments.some(x=>x.id===w.attachmentRef.id));
  const attachment=w.store.read().records.get(w.attachmentRef.path).value;
  fs.renameSync(path.join(w.domain,attachment.location),path.join(w.domain,attachment.location+'.retained'));
  const butler=w.kernel.bindSession(w.credentials,{role:'butler',tier:'LUNA',sessionId:'authored-butler-'+randomUUID(),projectId:P,nonce:'authored-butler',hostReceipt:'Fixture only'});
  w.kernel.call(butler.token,'host.resume','butler-hello',{nonce:'authored-butler'});
  assert.throws(()=>w.kernel.call(w.conductor.token,'round.create','attachment-missing',{projectId:P,operation:'generate',intent:input.intent,butlerInstructions:'Authored',requestId:request.requestId,references:[],feedbackIds:[],parentRoundId:null}),e=>e.code==='MISSING_SOURCE');
 }finally{w.kernel.close();}
});
test('existing connected root requires an exact private backup for explicit conversion',async()=>{
 const w=fixture({operations:false});try{const backup=path.join(w.dir,'pre-operation-backup');await backupCombined(w.runtime,backup);w.kernel.close();
  assert.throws(()=>new Kernel(w.runtime,{recover:false,products:{accessFile:w.accessFile},templates:{accessFile:w.accessFile},imports:{sources:{'authored-png':w.sourceRoot}},operations:true}),e=>e.code==='MIGRATION_REQUIRES_BACKUP');
  assert.equal(JSON.parse(fs.readFileSync(path.join(w.runtime,'bve-v2-root.json'))).version,2);
  w.kernel=new Kernel(w.runtime,{recover:false,products:{accessFile:w.accessFile},templates:{accessFile:w.accessFile},imports:{sources:{'authored-png':w.sourceRoot}},operations:true,operationBackup:backup,confirmedQuiescent:true});
  const input=run(w),result=w.kernel.operationRequest(w.credentials.human,{schemaVersion:'3djat.command.v1',operation:'operation.request',key:randomUUID(),expected:{domainHead:w.store.read().reference,entityRevision:0},input});
  assert.equal(w.kernel.operationSelection(w.credentials.human,result.requestId).id,input.runId);
 }finally{w.kernel.close();}
});
test('imported original is frozen, commissioned, and the worker start is once only',()=>{
 const w=fixture({source:true});try{
  const original=imported(w),input=run(w,original.artifact),packet={schemaVersion:'3djat.command.v1',operation:'operation.request',key:randomUUID(),expected:{domainHead:w.store.read().reference,entityRevision:0},input};
  const request=w.kernel.operationRequest(w.credentials.human,packet);
  const newer={schemaVersion:'3djat.template.v1',templateId:'operation-a',revision:2,title:'Later unadopted draft',kind:'operation',appliesTo:['artistic'],instructions:'Later draft, not adopted.',inputs:[{role:'base',kind:'verified-image',required:true}],allowedChanges:['background'],outputs:[{role:'candidate',format:'image/png'}],sourceRefs:[],supersedes:input.template};
  const draft=w.writer.command(w.human.token,{schemaVersion:'3djat.command.v1',operation:'template.ingest',key:randomUUID(),expected:{domainHead:w.store.read().reference,entityRevision:1},input:newer});
  assert.equal(draft.schemaVersion,'3djat.result.v1',JSON.stringify(draft));
  const butler=w.kernel.bindSession(w.credentials,{role:'butler',tier:'LUNA',sessionId:'authored-butler-'+randomUUID(),projectId:P,nonce:'authored-butler',hostReceipt:'Fixture only'});
  w.kernel.call(butler.token,'host.resume','butler-hello',{nonce:'authored-butler'});
  const round=w.kernel.call(w.conductor.token,'round.create','round-one',{projectId:P,operation:'generate',intent:input.intent,
    butlerInstructions:'Authored assignment',requestId:request.requestId,references:[],feedbackIds:[],parentRoundId:null});
  w.kernel.call(butler.token,'statement.report','butler-ready',{statementId:round.statementId,status:'ready',text:'Authored ready'});
  const specification={directionId:'candidate-a',difference:'Authored first direction',prompt:'Authored prompt',brief:'Authored brief',output:{role:'candidate',format:'image/png'},sources:input.sources,attachments:[],parentArtifacts:[],parentRoundId:null,canonical:input.canonical};
  const commission={schemaVersion:'3djat.command.v1',operation:'operation.commission',key:'commission-one',expected:{domainHead:input.domainHead,entityRevision:1},input};
  const iteration=w.kernel.operationCommission(w.conductor.token,commission,{roundId:round.id,specifications:[specification]});
  assert.deepEqual(w.kernel.operationCommission(w.conductor.token,commission,{roundId:round.id,specifications:[specification]}),iteration);
  assert.equal(iteration.jobIds.length,1);
  const row=w.kernel.operationSelection(w.credentials.human,request.requestId);assert.equal(row.body.run.runId,input.runId);
  assert.equal(row.body.operation.reference.revision,1);
  const job=w.kernel.read(w.credentials.human,'job').find(x=>x.id===iteration.jobIds[0]);
  assert.deepEqual(job.specification.sources,input.sources);
  w.kernel.call(w.conductor.token,'staff.reserve','reserve-one',{projectId:P,role:'worker',jobId:job.id});
  const worker=w.kernel.bindSession(w.credentials,{role:'worker',tier:'LUNA',sessionId:'authored-worker-'+randomUUID(),projectId:P,jobId:job.id,nonce:'authored-worker',hostReceipt:'Fixture only'});
  w.kernel.call(worker.token,'host.resume','worker-hello',{nonce:'authored-worker'});
  const assigned=w.kernel.call(w.conductor.token,'worker.assign','assign-one',{projectId:P,bindingId:worker.id,capability:{status:'simulated',originalBytes:true,formats:['image/png'],paid:false}});
  assert.equal(typeof assigned.assignmentId,'string');
  const started=w.kernel.call(worker.token,'worker.start','start-one',{roundId:round.id});
  assert.equal(typeof started.attemptId,'string');
  assert.throws(()=>w.kernel.call(worker.token,'worker.start','start-one',{roundId:round.id}),/already started|uncertain/i);
  const access=w.kernel.call(worker.token,'host.resume','worker-assignment',{nonce:'authored-worker'}).assignmentAccess;
  const producedBytes=png({color:6});
  w.kernel.call(access.token,'result.deliver','delivery-one',{assignmentId:assigned.assignmentId,outcome:'success',bytes:producedBytes.toString('base64'),evidence:{kind:'simulated',note:'Authored only'}});
  w.kernel.reconcile(w.credentials.butler);
  const produced=w.kernel.read(w.credentials.human,'artifact').find(a=>a.jobId===job.id);
  assert.equal(produced.sha256,H(producedBytes));
  const producedRef={productId:P,artifactId:produced.id,version:produced.version,sha256:produced.sha256,width:produced.width,height:produced.height};
  const follow=run(w,producedRef);follow.direction='Follow';follow.canonical.direction='Follow';follow.parentArtifacts=[producedRef];
  const next=w.kernel.operationRequest(w.credentials.human,{schemaVersion:'3djat.command.v1',operation:'operation.request',key:randomUUID(),expected:{domainHead:w.store.read().reference,entityRevision:0},input:follow});
  assert.equal(w.kernel.operationSelection(w.credentials.human,next.requestId).body.run.sources[0].artifact.artifactId,produced.id);
  // Observe the real produced BLOB path, then make only the retained byte
  // length inconsistent. Refusal must occur before that path materializes it.
  let lengthReads=0,dataReads=0;
  const prepare=DatabaseSync.prototype.prepare;
  DatabaseSync.prototype.prepare=function(sql){const statement=prepare.call(this,sql);
    if(sql==='SELECT length(data) AS n FROM bytes WHERE hash=?'){
      const get=statement.get;statement.get=function(...args){lengthReads++;return get.apply(this,args);};
    }
    if(sql==='SELECT data FROM bytes WHERE hash=? AND length(data)<=?'){
      const get=statement.get;statement.get=function(...args){dataReads++;return get.apply(this,args);};
    }return statement;
  };
  try{
    const valid=run(w,producedRef);valid.direction='Follow';valid.canonical.direction='Follow';valid.parentArtifacts=[producedRef];
    w.kernel.operationRequest(w.credentials.human,{schemaVersion:'3djat.command.v1',operation:'operation.request',key:randomUUID(),expected:{domainHead:w.store.read().reference,entityRevision:0},input:valid});
    assert(lengthReads>=2&&dataReads>=2,'A produced source and parent read actual bounded BLOBs');
    lengthReads=0;dataReads=0;
    const db=new DatabaseSync(path.join(w.runtime,'workspace.sqlite'));
    try{const artifact=JSON.parse(db.prepare("SELECT doc FROM records WHERE kind='artifact' AND id=?").get(produced.id).doc);
      artifact.size+=1;
      db.prepare("UPDATE records SET doc=? WHERE kind='artifact' AND id=?").run(JSON.stringify(artifact),produced.id);
    }finally{db.close();}
    const invalid=run(w,producedRef);invalid.direction='Follow';invalid.canonical.direction='Follow';invalid.parentArtifacts=[producedRef];
    assert.throws(()=>w.kernel.operationRequest(w.credentials.human,{schemaVersion:'3djat.command.v1',operation:'operation.request',key:randomUUID(),expected:{domainHead:w.store.read().reference,entityRevision:0},input:invalid}),e=>e.code==='HASH_MISMATCH');
    assert(lengthReads>0);assert.equal(dataReads,0,'Retained length mismatch must not fetch the BLOB');
  }finally{DatabaseSync.prototype.prepare=prepare;}
  }finally{w.kernel.close();}
});
test('revoked template grant and missing exact original block a pending request',()=>{
 for(const kind of ['grant','original']){
  const w=fixture({source:true});try{
   const original=imported(w),input=run(w,original.artifact);
   const request=w.kernel.operationRequest(w.credentials.human,{schemaVersion:'3djat.command.v1',operation:'operation.request',key:randomUUID(),expected:{domainHead:w.store.read().reference,entityRevision:0},input});
   if(kind==='grant')configureTemplateGrant(w.accessFile,{workspaceId:W,principalId:'bve-human',role:'human',grant:{...grant(),operations:[]},expectedSha256:H(fs.readFileSync(w.accessFile)),confirmedQuiescent:true});
   else{const db=new DatabaseSync(path.join(w.runtime,'workspace.sqlite'));try{db.prepare('DELETE FROM bytes WHERE hash=?').run(original.artifact.sha256);}finally{db.close();}}
   if(kind==='grant')assert.throws(()=>w.kernel.operationSelection(w.credentials.human,request.requestId),e=>e.code==='INVALID_SCOPE');
   else assert.equal(w.kernel.operationSelection(w.credentials.human,request.requestId).id,input.runId);
   const butler=w.kernel.bindSession(w.credentials,{role:'butler',tier:'LUNA',sessionId:'authored-butler-'+randomUUID(),projectId:P,nonce:'authored-butler',hostReceipt:'Fixture only'});
   w.kernel.call(butler.token,'host.resume','butler-hello',{nonce:'authored-butler'});
   assert.throws(()=>w.kernel.call(w.conductor.token,'round.create','round-'+kind,{projectId:P,operation:'generate',intent:input.intent,butlerInstructions:'Authored',requestId:request.requestId,references:[],feedbackIds:[],parentRoundId:null}),e=>e.code===(kind==='grant'?'INVALID_SCOPE':'MISSING_SOURCE'));
   assert.equal(w.kernel.read(w.credentials.human,'round').length,0);
  }finally{w.kernel.close();}
 }
});
test('a grant revoked at the final preparation fence blocks the round',()=>{
 let w,armed=false,changed=false;
 w=fixture({hook:stage=>{if(armed&&!changed&&stage==='before-operation-selection-fence'){
  changed=true;configureTemplateGrant(w.accessFile,{workspaceId:W,principalId:'bve-human',role:'human',grant:{...grant(),operations:[]},expectedSha256:H(fs.readFileSync(w.accessFile)),confirmedQuiescent:true});
 }}});
 try{const input=run(w),request=w.kernel.operationRequest(w.credentials.human,{schemaVersion:'3djat.command.v1',operation:'operation.request',key:randomUUID(),expected:{domainHead:w.store.read().reference,entityRevision:0},input});
  const butler=w.kernel.bindSession(w.credentials,{role:'butler',tier:'LUNA',sessionId:'authored-butler-'+randomUUID(),projectId:P,nonce:'authored-butler',hostReceipt:'Fixture only'});
  w.kernel.call(butler.token,'host.resume','butler-hello',{nonce:'authored-butler'});armed=true;
  assert.throws(()=>w.kernel.call(w.conductor.token,'round.create','round-final-fence',{projectId:P,operation:'generate',intent:input.intent,butlerInstructions:'Authored',requestId:request.requestId,references:[],feedbackIds:[],parentRoundId:null}),e=>e.code==='INVALID_SCOPE');
  assert.equal(changed,true);assert.equal(w.kernel.read(w.credentials.human,'round').length,0);
 }finally{w.kernel.close();}
});
test('tampered retained selection refuses readback and existing roots are not promoted',()=>{
 const w=fixture();try{const input=run(w),request=w.kernel.operationRequest(w.credentials.human,{schemaVersion:'3djat.command.v1',operation:'operation.request',key:randomUUID(),expected:{domainHead:w.store.read().reference,entityRevision:0},input});
  assert.throws(()=>new Kernel(w.runtime,{recover:false}),e=>e.code==='UNSUPPORTED_SCHEMA');
  const db=new DatabaseSync(path.join(w.runtime,'workspace.sqlite'));try{const raw=db.prepare("SELECT doc FROM records WHERE kind='operationSelection' AND id=?").get(input.runId).doc,row=JSON.parse(raw);
    row.body.run.intent='Tampered retained intent';db.prepare("UPDATE records SET doc=? WHERE kind='operationSelection' AND id=?").run(JSON.stringify(row),input.runId);
  }finally{db.close();}
  assert.throws(()=>w.kernel.operationSelection(w.credentials.human,request.requestId),e=>['EVIDENCE_MISMATCH','DIGEST'].includes(e.code));
 }finally{w.kernel.close();}
});
test('private combined backup and disposable restore retain selection and links',async()=>{
 const w=fixture();try{const input=run(w),result=w.kernel.operationRequest(w.credentials.human,{schemaVersion:'3djat.command.v1',operation:'operation.request',key:randomUUID(),expected:{domainHead:w.store.read().reference,entityRevision:0},input});
  const backup=path.join(w.dir,'combined'),restoredDomain=path.join(w.dir,'restored-domain'),restoredRuntime=path.join(w.dir,'restored-runtime');
  await backupCombined(w.runtime,backup);assert.equal(verifyCombined(backup).workspaceId,W);
  restoreCombined(backup,{businessRoot:restoredDomain,runtimeRoot:restoredRuntime,paths:Object.fromEntries(Object.entries(w.store.workspace.paths).map(([k,v])=>[k,path.join(restoredDomain,v)]))});
  const copy=new Kernel(restoredRuntime,{recover:false,products:{accessFile:w.accessFile},templates:{accessFile:w.accessFile},imports:{sources:{'authored-png':w.sourceRoot}},operations:true});
  try{assert.equal(copy.operationSelection(w.credentials.human,result.requestId).retainedBodySha256,result.bodySha256);}finally{copy.close();}
 }finally{w.kernel.close();}
});
