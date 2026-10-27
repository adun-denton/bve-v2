// Authored disposable files and PNGs; no native provider or human acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {randomUUID,createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {Kernel} from '../src/kernel.mjs';
import {serve} from '../src/server.mjs';
import {DomainStore} from '../src/domain-store.mjs';
import {provisionProductPrincipal,decisionActionReference} from '../src/domain-products.mjs';
import {DomainTemplates,configureTemplateGrant,templateDecisionActionReference} from '../src/domain-templates.mjs';
import {configureBusinessGrant,businessDecisionActionReference} from '../src/domain-business.mjs';
import {png} from './fixtures/3djat/import-fixture.mjs';
import {backupCombined,verifyCombined,restoreCombined} from '../src/workspace-backup.mjs';

const W='bbbbbbbb-bbbb-4bbb-9bbb-bbbbbbbbbbbb',P='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const H=b=>createHash('sha256').update(b).digest('hex');
const grant=()=>({templateIds:['operation-a','brand-a'],appliesTo:['artistic'],operations:['read','ingest','adopt'],sourceIds:[]});
function fixture({source=false,brand=false,business=false,attachment=false,importFormat=true,operations=true,experimental=false,hook=()=>{}}={}){
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
  ...(importFormat?{imports:{sources:{'authored-png':sourceRoot},experimentalPng20:experimental}}:{}),...(business?{business:{accessFile:businessAccess}}:{}),operations,workspaceHook:hook};
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
test('S01 historical selection read must enforce current template read grant',()=>{
 const w=fixture();try{
 const input=run(w),packet={schemaVersion:'3djat.command.v1',operation:'operation.request',key:randomUUID(),expected:{domainHead:w.store.read().reference,entityRevision:0},input};
 const request=w.kernel.operationRequest(w.credentials.human,packet);
 assert.equal(w.kernel.operationSelection(w.conductor.token,request.requestId).id,input.runId);
 configureTemplateGrant(w.accessFile,{workspaceId:W,principalId:'bve-session-'+w.conductor.id,role:'conductor',
   grant:{...grant(),operations:[]},expectedSha256:H(fs.readFileSync(w.accessFile)),confirmedQuiescent:true});
 let error=null,result=null;try{result=w.kernel.operationSelection(w.conductor.token,request.requestId);}catch(e){error=e;}
 console.log('S01_OBSERVED='+JSON.stringify({code:error?.code??null,returnedSelection:result?.id??null,returnedClosureFiles:result?.body?.closure?.files?.length??null}));
 assert.equal(error?.code,'INVALID_SCOPE','A revoked current read grant must block historical selection disclosure');
 }finally{w.kernel.close();}
});
test('S02 reopening experimental operation root must preserve v4 marker',()=>{
 const w=fixture({experimental:true});let reopened=null;try{
 const markerPath=path.join(w.runtime,'bve-v2-root.json'),before=JSON.parse(fs.readFileSync(markerPath));
 assert.equal(before.version,4);assert(before.features.includes('png20-experiment.v1'));assert(before.features.includes('operation-selection.v1'));
 w.kernel.close();let error=null;try{reopened=new Kernel(w.runtime,{...w.options,recover:false});}catch(e){error=e;}
 const after=JSON.parse(fs.readFileSync(markerPath));
 const db=new DatabaseSync(path.join(w.runtime,'workspace.sqlite'),{readOnly:true});let version;try{version=db.prepare('PRAGMA user_version').get().user_version;}finally{db.close();}
 console.log('S02_OBSERVED='+JSON.stringify({code:error?.code??null,beforeMarker:before,afterMarker:after,userVersion:version}));
 assert.equal(error,null,'Reopening an already matching experimental root must require no second migration');
 assert.deepEqual(after,before,'A reopen must not downgrade root marker or discard operation feature');
 }finally{reopened?.close();w.kernel.close();}
});

test('S03 scoped historical read must not disclose another product through full closure',()=>{
 const w=fixture();try{
 const other='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
 const created=w.kernel.productCommand(w.credentials.human,{schemaVersion:'3djat.command.v1',operation:'product.create',key:randomUUID(),
 expected:{domainHead:w.store.read().reference,entityRevision:0},input:{productId:other,productCode:null,workingName:'AUTHORED_OTHER_PRODUCT_PRIVATE_NAME'}});
 assert.equal(created.schemaVersion,'3djat.result.v1',JSON.stringify(created));
 const input=run(w),request=w.kernel.operationRequest(w.credentials.human,{schemaVersion:'3djat.command.v1',operation:'operation.request',key:randomUUID(),
 expected:{domainHead:w.store.read().reference,entityRevision:0},input});
 const row=w.kernel.operationSelection(w.conductor.token,request.requestId);
 assert.equal(row.schemaVersion,'3djat.operation-selection-view.v1');
 assert.equal(row.body.projectId,P);
 assert.equal(row.body.closure,undefined);
 assert.match(row.retainedBodySha256,/^[a-f0-9]{64}$/);
 assert.equal(JSON.stringify(row).includes('AUTHORED_OTHER_PRODUCT_PRIVATE_NAME'),false,
   'Project-bound read must not disclose another product through a retained closure');
 }finally{w.kernel.close();}
});

test('HTTP historical GET returns only scoped view and denies revoked read grant',async()=>{
 const w=fixture();let app=null;try{
  const input=run(w),request=w.kernel.operationRequest(w.credentials.human,{schemaVersion:'3djat.command.v1',operation:'operation.request',key:randomUUID(),
   expected:{domainHead:w.store.read().reference,entityRevision:0},input});
  w.kernel.close();app=await serve({root:w.runtime,port:0,products:w.options.products,templates:w.options.templates,
    imports:w.options.imports,operations:true});
  const url=app.origin+'/api/operation-selection?requestId='+request.requestId,
    headers={authorization:'Bearer '+w.conductor.token};
  const first=await fetch(url,{headers}),view=await first.json();
  assert.equal(first.status,200);assert.equal(view.schemaVersion,'3djat.operation-selection-view.v1');
  assert.equal(view.body.closure,undefined);
  configureTemplateGrant(w.accessFile,{workspaceId:W,principalId:'bve-session-'+w.conductor.id,role:'conductor',
    grant:{...grant(),operations:[]},expectedSha256:H(fs.readFileSync(w.accessFile)),confirmedQuiescent:true});
  const denied=await fetch(url,{headers});assert.equal(denied.status,403);
  assert.equal((await denied.json()).error,'INVALID_SCOPE');
 }finally{await app?.stop();w.kernel.close();}
});

test('ordinary v4 reopen is idempotent and unsupported promotion leaves marker unchanged',()=>{
 const w=fixture();let reopened=null;try{
  const markerPath=path.join(w.runtime,'bve-v2-root.json'),before=fs.readFileSync(markerPath);
  w.kernel.close();reopened=new Kernel(w.runtime,{...w.options,recover:false});
  assert.deepEqual(fs.readFileSync(markerPath),before);reopened.close();reopened=null;
  const attempted={...w.options,imports:{...w.options.imports,experimentalPng20:true},recover:false};
  assert.throws(()=>new Kernel(w.runtime,attempted),e=>e.code==='MIGRATION_REQUIRES_BACKUP');
  assert.deepEqual(fs.readFileSync(markerPath),before);
 }finally{reopened?.close();w.kernel.close();}
});

test('experimental v4 cannot reopen under incompatible ordinary option',()=>{
 const w=fixture({experimental:true});try{
  const markerPath=path.join(w.runtime,'bve-v2-root.json'),before=fs.readFileSync(markerPath);
  w.kernel.close();const attempted={...w.options,imports:{...w.options.imports,experimentalPng20:false},recover:false};
  assert.throws(()=>new Kernel(w.runtime,attempted),e=>e.code==='UNSUPPORTED_SCHEMA');
  assert.deepEqual(fs.readFileSync(markerPath),before);
 }finally{w.kernel.close();}
});

test('verified disposable v4 promotion keeps operation feature and SQLite2',async()=>{
 const w=fixture();let promoted=null;try{
  const backup=path.join(w.dir,'before-experimental');await backupCombined(w.runtime,backup);
  w.kernel.close();promoted=new Kernel(w.runtime,{...w.options,recover:false,
    imports:{...w.options.imports,experimentalPng20:true,migrationBackup:backup,confirmedQuiescent:true}});
  const marker=JSON.parse(fs.readFileSync(path.join(w.runtime,'bve-v2-root.json')));
  assert.deepEqual(marker.features,['historical-import.v1','png20-experiment.v1','operation-selection.v1']);
  assert.equal(marker.version,4);
  const db=new DatabaseSync(path.join(w.runtime,'workspace.sqlite'),{readOnly:true});
  try{assert.equal(db.prepare('PRAGMA user_version').get().user_version,2);}finally{db.close();}
  promoted.close();promoted=new Kernel(w.runtime,{...w.options,recover:false,
    imports:{...w.options.imports,experimentalPng20:true}});
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(w.runtime,'bve-v2-root.json'))),marker);
 }finally{promoted?.close();w.kernel.close();}
});
