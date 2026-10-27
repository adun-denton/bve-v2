import {recipesForRun} from './executors/png-recipes.mjs';
// Pure inspection of an adopted operation snapshot. This is never an authority grant.
import {createHash} from 'node:crypto';
import {validate} from './contracts/3djat.mjs';
import {DomainStore, STORE_LIMITS} from './domain-store.mjs';

const ROW_KEYS=['id','schemaVersion','body','bodySha256'];
const BODY_KEYS=['workspaceId','projectId','requestId','principalId','sessionId','createdAt','domainHead','product','dossier','business','operation','brand','closure','run','permissionEvidence'];
const CHOICE_KEYS=['reference','record','decisionReference','decision','publication','receipt'];
const HASH=/^[a-f0-9]{64}$/;
const ID=/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const TIME=/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
const SHA=b=>createHash('sha256').update(b).digest('hex');
const same=(a,b)=>!!a&&!!b&&a.id===b.id&&a.revision===b.revision&&a.path===b.path&&a.sha256===b.sha256;
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const isId=x=>typeof x==='string'&&ID.test(x);
const isUuid=x=>typeof x==='string'&&UUID.test(x);
const isHash=x=>typeof x==='string'&&HASH.test(x);
const exact=(x,keys)=>object(x)&&Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
const equal=(a,b)=>stable(a)===stable(b);
const sortedUnique=a=>a.every((v,i)=>i===0||a[i-1]<v);
const utc=x=>typeof x==='string'&&TIME.test(x)&&!Number.isNaN(Date.parse(x))&&new Date(x).toISOString()===x;
const ref=x=>validate('revision-ref',x).ok;
const shape=(kind,x)=>validate(kind,x).ok;

// Guard circular, accessor and oversized inputs before stable serialization or source validators.
function portable(root){
 const visiting=new Set();let nodes=0,byteEstimate=0;
 function visit(x,depth){
  if(++nodes>30000||depth>48)throw issue('CAPACITY','$');
  if(x===null||typeof x==='boolean'||typeof x==='number'&&Number.isFinite(x))return;
  if(typeof x==='string'){byteEstimate+=Buffer.byteLength(x);if(byteEstimate>48*1024**2)throw issue('OVERSIZE','$');return;}
  if(!object(x)&&!Array.isArray(x))throw issue('INVALID_VALUE','$');
  if(![Object.prototype,null,Array.prototype].includes(Object.getPrototypeOf(x))||Array.isArray(x)&&(x.length>4096||Object.keys(x).length!==x.length))throw issue('INVALID_VALUE','$');
  if(visiting.has(x))throw issue('CYCLE','$');
  visiting.add(x);
  if(Object.keys(x).length>4096)throw issue('CAPACITY','$');
  for(const k of Object.keys(x)){
   byteEstimate+=Buffer.byteLength(k);if(byteEstimate>48*1024**2)throw issue('OVERSIZE','$');
   const d=Object.getOwnPropertyDescriptor(x,k);
   if(!d||!Object.hasOwn(d,'value')||k==='__proto__'||k==='constructor'||k==='prototype')throw issue('INVALID_VALUE','$');
   visit(d.value,depth+1);
  }
  visiting.delete(x);
 }
 visit(root,0);
}
function stable(x){return JSON.stringify(x,(_,v)=>object(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);}
function issue(code,path,cause){return Object.assign(new Error(code),{code,path,cause});}
function need(ok,code,path){if(!ok)throw issue(code,path);}
function verdict(fn){try{fn();return {ok:true,authority:'not-established',errors:[]};}catch(e){return {ok:false,authority:'not-established',errors:[{code:e.code??'INVALID_VALUE',path:e.path??'$',...(e.cause?{cause:e.cause}:{})}]};}}
export function operationSelectionBytes(body){portable(body);need(exact(body,BODY_KEYS),'BODY_SHAPE','$/body');const b=Buffer.from(stable(body)+'\n');need(b.length<=48*1024**2,'OVERSIZE','$/body');return b;}
export function validateOperationSelectionFormat(marker,sqliteUserVersion){return verdict(()=>{
 portable(marker);need(exact(marker,['format','version','features'])&&marker.format==='bve-v2'&&([4,5].includes(marker.version))&&sqliteUserVersion===(marker.version===5?3:2),'UNSUPPORTED_SCHEMA','$');
 need(Array.isArray(marker.features)&&[
  ['operation-selection.v1'],['historical-import.v1','operation-selection.v1'],
  ['historical-import.v1','png20-experiment.v1','operation-selection.v1']
 ].some(x=>equal(marker.version===5?[...x,'deterministic-service.v1']:x,marker.features)),'UNSUPPORTED_SCHEMA','$/features');
});}

function snapshot(closure,head){
 need(exact(closure,['workspaceId','head','files'])&&ref(closure.head)&&same(closure.head,head)&&isUuid(closure.workspaceId),'CLOSURE_SHAPE','$/body/closure');
 need(Array.isArray(closure.files)&&closure.files.length>0&&closure.files.length<=STORE_LIMITS.files,'CAPACITY','$/body/closure/files');
 let total=0,previous='';const files=new Map();
 for(const [i,f] of closure.files.entries()){
  const p=`$/body/closure/files/${i}`;
  need(exact(f,['path','sha256','bytes'])&&ref({id:'file',revision:1,path:f.path,sha256:f.sha256})&&isHash(f.sha256),'CLOSURE_SHAPE',p);
  need(f.path>previous,'CLOSURE_ORDER',p+'/path');previous=f.path;
  need(typeof f.bytes==='string','CLOSURE_SHAPE',p+'/bytes');
  need(f.bytes.length<=Math.ceil(STORE_LIMITS.fileBytes/3)*4,'OVERSIZE',p+'/bytes');
  need(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(f.bytes),'INVALID_BASE64',p+'/bytes');
  const b=Buffer.from(f.bytes,'base64');total+=b.length;
  need(b.length<=STORE_LIMITS.fileBytes&&total<=STORE_LIMITS.totalBytes,'CAPACITY',p+'/bytes');
  need(b.toString('base64')===f.bytes,'INVALID_BASE64',p+'/bytes');
  need(SHA(b)===f.sha256,'HASH_MISMATCH',p);
  files.set(f.path,b);
 }
 const mb=files.get('domain-store.json');need(mb,'MISSING_REFERENCE','$/body/closure');
 let marker;try{marker=JSON.parse(mb);}catch{throw issue('INVALID_JSON','$/body/closure');}
 need(exact(marker,['schemaVersion','workspaceId','workspace','genesis'])&&marker.schemaVersion==='3djat.domain-store.v1'&&marker.workspaceId===closure.workspaceId,'CLOSURE_SHAPE','$/body/closure');
 const reader=Object.create(DomainStore.prototype);reader.marker=marker;reader.markerBytes=mb;
 reader.readFile=path=>{if(!files.has(path))throw issue('MISSING_REFERENCE','$/body/closure/'+path);return files.get(path);};
 let view;try{view=reader.closure(head);}catch(e){throw issue(e.code??'INVALID_CLOSURE','$/body/closure',e.code);}
 need(view.files.size===files.size,'INCOMPLETE_SNAPSHOT','$/body/closure/files');
 for(const [p,b] of view.files)need(files.get(p)?.equals(b),'INCOMPLETE_SNAPSHOT','$/body/closure/files');
 return view;
}

function bound(view,reference,record,kind,path){
 need(ref(reference)&&shape(kind,record),'INVALID_REFERENCE',path);
 const got=view.records.get(reference.path);
 need(got?.kind===kind&&same(got.reference,reference)&&equal(got.value,record),'HASH_MISMATCH',path);
}
function choose(view,x,kind,scope,path){
 need(exact(x,CHOICE_KEYS),'CHOICE_SHAPE',path);
 bound(view,x.reference,x.record,'template',path+'/record');
 bound(view,x.decisionReference,x.decision,'template-decision',path+'/decision');
 need(x.record.kind===kind&&x.record.templateId===x.reference.id&&x.record.revision===x.reference.revision&&
  same(x.decision.template,x.reference)&&x.decision.action==='adopt'&&x.record.appliesTo.includes(scope)&&x.decision.appliesTo.includes(scope),'DECISION_SCOPE',path);
 need(ref(x.publication)&&ref(x.receipt),'INVALID_REFERENCE',path);
 const h=view.records.get(x.publication.path),r=view.records.get(x.receipt.path);
 need(h?.kind==='domain-head'&&same(h.reference,x.publication)&&h.value.receipts.some(v=>same(v,x.receipt))&&
  r?.kind==='store-receipt'&&same(r.reference,x.receipt)&&same(r.value.previousHead,h.value.previousHead)&&
  r.value.records.some(v=>same(v,x.decisionReference)),'UNRESOLVED_PUBLICATION',path);
 // The complete signed history, active choice and MAC require the trusted resolver.
}
function relations(b,view){
 const run=b.run,h=view.records.get(b.domainHead.path);
 need(h?.kind==='domain-head'&&same(h.reference,b.domainHead)&&h.value.workspaceId===b.workspaceId&&
  h.value.products.some(x=>x.productId===b.projectId&&same(x.dossier,b.product.reference)),'HEAD_LINK','$/body/domainHead');
 need(exact(b.product,['reference','record','acceptedFacts']),'PRODUCT_SHAPE','$/body/product');
 bound(view,b.product.reference,b.product.record,'product','$/body/product');
 need(b.product.record.productId===b.projectId&&equal(b.product.acceptedFacts,b.product.record.facts)&&equal(run.acceptedFacts,b.product.record.facts)&&
  same(run.product,b.product.reference),'PRODUCT_LINK','$/body/product');
 need(Array.isArray(b.dossier)&&b.dossier.length<=24,'DOSSIER_SHAPE','$/body/dossier');
 let prev='';for(const [i,d] of b.dossier.entries()){
  need(exact(d,['reference','record'])&&d.reference.path>prev,'DOSSIER_ORDER',`$/body/dossier/${i}`);prev=d.reference.path;
  bound(view,d.reference,d.record,'dossier-record',`$/body/dossier/${i}`);
  need(d.record.productId===b.projectId,'DOSSIER_LINK',`$/body/dossier/${i}`);
 }
 if(b.business!==null){need(exact(b.business,['reference','record']),'BUSINESS_SHAPE','$/body/business');bound(view,b.business.reference,b.business.record,'business-context','$/body/business');need(b.business.record.workspaceId===b.workspaceId&&same(h.value.business,b.business.reference),'BUSINESS_LINK','$/body/business');}
 choose(view,b.operation,'operation',run.applicability,'$/body/operation');
 if(b.brand!==null)choose(view,b.brand,'brand',run.applicability,'$/body/brand');
 need(same(run.domainHead,b.domainHead)&&same(run.template,b.operation.reference)&&run.productId===b.projectId&&
  run.branded===(b.brand!==null)&&((b.brand===null&&run.brand===null&&run.brandInstructions===null&&run.canonical.brand===null)||
  (b.brand!==null&&same(run.brand,b.brand.reference)&&run.brandInstructions===b.brand.record.instructions&&run.canonical.brand===run.brandInstructions)),'RUN_LINK','$/body/run');
 // Mirrors validateResolvedOperation's non-index checks. Historical chosen templates may not be in head.templates.
 const t=b.operation.record;
 need(run.canonical.direction===run.direction&&run.requestedOutputs.reduce((n,x)=>n+x.count,0)===run.canonical.count&&
  run.allowance.primaryAttempts===run.canonical.count&&run.allowance.maxRetries===0,'CANONICAL','$/body/run/canonical');
 const params=t.exploration?.parameters??{};
 for(const [k,v] of Object.entries(run.selection)){
  const p=params[k];need(p&&(p.type==='boolean'?typeof v==='boolean':p.type==='number'?typeof v==='number'&&v>=p.min&&v<=p.max:p.type==='enum'&&p.values.includes(v)),'INVALID_SELECTION','$/body/run/selection/'+k);
 }
 if(run.preset!==null){const p=t.exploration?.presets?.[run.preset];need(p&&Object.entries(p).every(([k,v])=>run.selection[k]===v),'INVALID_SELECTION','$/body/run/preset');}
 for(const x of run.requestedOutputs)need(t.outputs.some(y=>y.role===x.role),'INVALID_SCOPE','$/body/run/requestedOutputs');
 for(const x of run.sources)need(t.inputs.some(y=>y.role===x.role&&y.kind==='verified-image')&&x.artifact.productId===b.projectId,'INVALID_SCOPE','$/body/run/sources');
 for(const [i,x] of run.attachments.entries()){
  const p=`$/body/run/attachments/${i}`,a=view.records.get(x.reference.path);
  need(t.inputs.some(y=>y.role===x.role&&y.kind==='attachment'),'INVALID_SCOPE',p+'/role');
  need(a?.kind==='attachment'&&same(a.reference,x.reference)&&a.value.attachmentId===x.reference.id&&
    a.value.productId===b.projectId&&b.product.record.attachments.some(y=>same(y,x.reference)),'ATTACHMENT_LINK',p+'/reference');
 }
 for(const x of t.inputs.filter(y=>y.required))need((x.kind==='verified-image'?run.sources:run.attachments).some(y=>y.role===x.role),'MISSING_SOURCE','$/body/run/inputs/'+x.role);
 for(const x of run.parentArtifacts)need(x.productId===b.projectId,'LINEAGE','$/body/run/parentArtifacts');
 need(run.sources.every(x=>x.regions.every(r=>r.space==='normalized-original')),'INVALID_SCOPE','$/body/run/sources');
}
export function validateOperationSelection(row){return verdict(()=>{
 portable(row);need(exact(row,ROW_KEYS)&&row.schemaVersion==='3djat.operation-selection.v1'&&isUuid(row.id)&&isHash(row.bodySha256),'ROW_SHAPE','$');
 const bodyBytes=operationSelectionBytes(row.body),b=row.body;
 need(SHA(bodyBytes)===row.bodySha256,'DIGEST','$/bodySha256');
 need(shape('operation-run',b.run)&&ref(b.domainHead)&&isUuid(b.workspaceId)&&isUuid(b.projectId)&&isUuid(b.requestId)&&
  isId(b.principalId)&&(b.sessionId===null||isId(b.sessionId))&&utc(b.createdAt),'BODY_SHAPE','$/body');
 need(row.id===b.run.runId&&b.workspaceId===b.domainHead.id&&b.workspaceId===b.closure?.workspaceId&&same(b.domainHead,b.closure?.head),'ROW_LINK','$/body');
 const p=b.permissionEvidence;
 need(exact(p,['principalId','sessionId','role','grantFingerprint','sourceIds','templateIds','applicability','productId','observedAt'])&&
  p.principalId===b.principalId&&p.sessionId===b.sessionId&&p.role==='human'&&isHash(p.grantFingerprint)&&
  p.applicability===b.run.applicability&&p.productId===b.projectId&&utc(p.observedAt)&&
  Array.isArray(p.sourceIds)&&p.sourceIds.length<=32&&p.sourceIds.every(isId)&&sortedUnique(p.sourceIds)&&
  Array.isArray(p.templateIds)&&p.templateIds.length<=24&&p.templateIds.every(isId)&&sortedUnique(p.templateIds),'PERMISSION_SHAPE','$/body/permissionEvidence');
 need(p.templateIds.includes(b.operation?.reference?.id)&&(b.brand===null||p.templateIds.includes(b.brand?.reference?.id)),'PERMISSION_LINK','$/body/permissionEvidence/templateIds');
 // The existing SQLite document ceiling differs from the smaller file closure limits.
 need(Buffer.byteLength(stable(row)+'\n')<=48*1024**2,'OVERSIZE','$');
 relations(b,snapshot(b.closure,b.domainHead));
});}

export function validateOperationSelectionLinks(row,context){return verdict(()=>{
 const checked=validateOperationSelection(row);need(checked.ok,checked.errors[0]?.code??'INVALID_VALUE',checked.errors[0]?.path??'$');
 portable(context);need(exact(context,['request','round','iteration','jobs','requests','rounds','iterations','allJobs']),'LINK_SHAPE','$/context');
 const b=row.body,r=context.request;
  need(object(r)&&r.id===b.requestId&&r.projectId===b.projectId&&r.workspaceId===b.workspaceId&&r.selectionId===row.id&&r.selectionBodySha256===row.bodySha256&&
  r.count===b.run.canonical.count&&r.direction===b.run.canonical.direction&&r.brand===b.run.canonical.brand&&r.intent===b.run.intent&&
  equal(r.allowance,b.run.allowance)&&['waiting-for-conductor','commissioned'].includes(r.state),'REQUEST_LINK','$/context/request');
 need(Array.isArray(context.requests)&&context.requests.filter(x=>x?.selectionId===row.id).length===1&&context.requests.filter(x=>x?.id===r.id).length===1&&
  equal(context.requests.find(x=>x?.id===r.id),r),'REVERSE_LINK','$/context/requests');
 const {round,iteration,jobs,rounds,iterations,allJobs}=context;
 need([jobs,rounds,iterations,allJobs].every(Array.isArray)&&jobs.length<=6&&rounds.length<=128&&iterations.length<=128&&allJobs.length<=768,'CAPACITY','$/context');
 if(round===null){need(iteration===null&&jobs.length===0&&r.state==='waiting-for-conductor'&&rounds.every(x=>x?.requestId!==r.id)&&iterations.every(x=>x?.requestId!==r.id),'REQUEST_PHASE','$/context');return;}
 need(r.state==='commissioned'&&isUuid(round.id)&&round.projectId===b.projectId&&round.requestId===r.id&&round.operation==='generate'&&
  round.parentRoundId===b.run.parentRoundId&&round.expectedResults===b.run.canonical.count&&round.iterationId===iteration?.id&&
  rounds.filter(x=>x?.requestId===r.id).length===1&&rounds.filter(x=>x?.id===round.id).length===1&&
  equal(rounds.find(x=>x?.id===round.id),round),'ROUND_LINK','$/context/round');
 need(iteration&&isUuid(iteration.id)&&iteration.requestId===r.id&&iteration.roundId===round.id&&iteration.projectId===b.projectId&&
  iteration.count===b.run.canonical.count&&iteration.direction===b.run.canonical.direction&&iteration.brand===b.run.canonical.brand&&r.iterationId===iteration.id&&
  Array.isArray(iteration.jobIds)&&iteration.jobIds.length===jobs.length&&new Set(iteration.jobIds).size===jobs.length&&
  iterations.filter(x=>x?.requestId===r.id).length===1&&iterations.filter(x=>x?.id===iteration.id).length===1&&
  equal(iterations.find(x=>x?.id===iteration.id),iteration),'ITERATION_LINK','$/context/iteration');
 need(jobs.length===b.run.canonical.count&&allJobs.filter(x=>x?.iterationId===iteration.id).length===jobs.length&&new Set(jobs.map(x=>x.id)).size===jobs.length,'JOB_LINK','$/context/jobs');
 for(const j of jobs){
  if(b.run.executionKind==='deterministic'){
   const index=iteration.jobIds.indexOf(j.id);need(j.specification?.executorKind==='service'&&j.specification.executorId===b.run.executorId&&equal(j.specification.recipe,recipesForRun(b.run)[index]),'SERVICE_RECIPE_LINK','$/context/jobs');
  }
  const s=j.specification;
  need(j.projectId===b.projectId&&j.roundId===round.id&&j.iterationId===iteration.id&&iteration.jobIds.includes(j.id)&&
   allJobs.filter(x=>x?.id===j.id).length===1&&equal(allJobs.find(x=>x?.id===j.id),j)&&object(s)&&s.direction===b.run.canonical.direction&&s.brand===b.run.canonical.brand&&
   equal(s.sources,b.run.sources)&&equal(s.attachments,b.run.attachments)&&equal(s.parentArtifacts,b.run.parentArtifacts)&&
   s.parentRoundId===b.run.parentRoundId&&equal(s.canonical,b.run.canonical)&&
   b.run.requestedOutputs.some(x=>x.role===s.output?.role)&&s.output?.format==='image/png'&&
   equal(s.allowance,{primaryAttempts:1,maxRetries:0})&&s.destination?.projectId===b.projectId&&s.destination?.iterationId===iteration.id&&
   s.hardLimits?.maxBytes<=24*1024**2&&s.hardLimits?.maxBytes>0&&s.hardLimits?.maxPixels<=16_000_000&&s.hardLimits?.maxPixels>0,'JOB_LINK','$/context/jobs');
 }
});}
