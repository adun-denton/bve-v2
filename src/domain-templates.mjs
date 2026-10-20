// File-owned template registry. Instructions are data, never execution authority.
import * as fs from 'node:fs';
import {createHash} from 'node:crypto';
import {DomainStore,prepareRecord} from './domain-store.mjs';
import {validate,validateCommand} from './contracts/3djat.mjs';
import {DomainProducts} from './domain-products.mjs';
import {stable,digest,uuid,equal,same,check,fail,shape,exact,identifier,within,safePrivate,access,findBearer,reserveIntent,signAction,verifyAction} from './domain-authority.mjs';
export {configureTemplateGrant} from './domain-authority.mjs';
export const TEMPLATE_LIMITS=Object.freeze({templates:64,revisions:64,decisions:128,scopes:24,responseBytes:1024**2,sourceBytes:1024**2,sourceTotalBytes:16*1024**2});
const INGEST='template.ingest',ADOPT='template.adopt';
const OPS=new Set([INGEST,ADOPT]);
const eventRef=e=>({id:e.id,revision:1,path:`Operational/event/${e.id}.json`,sha256:digest(stable(e))});
function eventFor(workspaceId,principalId,packet,time){
 const input=structuredClone(packet.input);if(packet.operation===ADOPT)delete input.humanActionReceipt;
 return {id:uuid(stable([workspaceId,principalId,packet.operation,packet.key])),version:1,type:'template-action',workspaceId,principalId,operation:packet.operation,key:packet.key,templateId:packet.operation===INGEST?input.templateId:input.template.id,commandHash:digest(stable({...packet,input})),recordedAt:packet.operation===ADOPT?input.decidedAt:time};
}
export function templateDecisionActionReference({workspaceId,principalId,packet}){
 check(packet?.operation===ADOPT,'INVALID_SCOPE');shape('command',packet);identifier(principalId);
 shape('revision-ref',{id:workspaceId,revision:1,path:'workspace.json',sha256:'0'.repeat(64)});
 return eventRef(eventFor(workspaceId,principalId,packet,packet.input.decidedAt));
}
function packetOf(row){return {schemaVersion:'3djat.command.v1',operation:row.storeReceipt.operation,key:row.storeReceipt.key,expected:{domainHead:row.storeReceipt.previousHead,entityRevision:row.kind==='template'?row.value.revision-1:row.value.expectedRevision},input:row.value};}
function auditOf(row,view,a){
 const evidence=row.storeReceipt.records.map(r=>view.records.get(r.path)).filter(x=>x?.kind==='evidence');
 check(evidence.length===1,'EVIDENCE_MISMATCH');const e=evidence[0];let signed;try{signed=JSON.parse(e.value.description);}catch{fail('CAPABILITY_UNAVAILABLE');}
 check(signed?.format==='3djat.template-action.v1','CAPABILITY_UNAVAILABLE');exact(signed,['format','role','event','mac']);
 const packet=packetOf(row),event=eventFor(view.head.workspaceId,row.storeReceipt.principal,packet,signed.event?.recordedAt);
 shape('source-ref',{kind:'file',sourceId:'time-check',revision:'1',sha256:'0'.repeat(64),location:'source.txt',locator:{kind:'page',page:1},observedAt:event.recordedAt});
 check(equal(event,signed.event)&&['human','conductor','source-proposer'].includes(signed.role),'EVIDENCE_MISMATCH');
 check(e.reference.id===event.id&&e.reference.revision===1&&row.storeReceipt.records.length===2,'EVIDENCE_MISMATCH');
 const subject=row.reference,audit=e.reference,ingest=row.kind==='template';
 const transitions=ingest?[{kind:'template',id:subject.id,from:subject.revision-1,to:subject.revision}]:[];
 const plan={expectedHead:row.storeReceipt.previousHead,changes:ingest?[{kind:'template',id:subject.id,expectedRevision:subject.revision-1,reference:subject}]:[],records:[{kind:'evidence',reference:audit},...(!ingest?[{kind:'template-decision',reference:subject}]:[])]};
 check(equal(row.storeReceipt.records,[audit,subject])&&equal(row.storeReceipt.transitions,transitions)&&row.storeReceipt.payloadHash===digest(stable(plan)+'\n'),'EVIDENCE_MISMATCH');
 if(a)verifyAction(a,signed.role,event,signed.mac);else check(typeof signed.mac==='string'&&/^[0-9a-f]{64}$/.test(signed.mac),'EVIDENCE_MISMATCH');
 if(row.kind==='template-decision')check(same(row.value.humanActionReceipt,eventRef(event))&&signed.role==='human','EVIDENCE_MISMATCH');
 const v=validateCommand(packet,{authenticatedCaller:signed.role});check(v.ok,'EVIDENCE_MISMATCH');
 return {...signed,reference:e.reference};
}
function fresh(id){return {id,latest:null,revisions:[],decisions:[],active:new Map(),tail:null,sequence:0};}
const scopes=h=>[...new Set([...(h.latest?.value.appliesTo??[]),...h.active.keys()])].sort();
// Reconstruct the complete published history; neither a cache nor loose files count.
function history(view,a){
 const map=new Map(),events=[],seen=new Set(),decisionIds=new Set();let decisions=0,subjects=0;
 const heads=[...view.records.values()].filter(x=>x.kind==='domain-head').sort((x,y)=>x.value.revision-y.value.revision);
 for(const head of heads){
  for(const rr of head.value.receipts){const receipt=view.records.get(rr.path),sr=receipt.value,rows=sr.records.map(r=>view.records.get(r.path)).filter(x=>['template','template-decision'].includes(x.kind));
   if(!rows.length)continue;check(rows.length===1,'EVIDENCE_MISMATCH');
   const row={...rows[0],storeReceipt:sr,receipt:rr,publication:head.reference};check(!seen.has(row.reference.path),'EVIDENCE_MISMATCH');seen.add(row.reference.path);subjects++;
   check(OPS.has(sr.operation),'CAPABILITY_UNAVAILABLE');const audit=auditOf(row,view,a);row.audit=audit;events.push(audit.event);
   const id=row.kind==='template'?row.value.templateId:row.value.template.id;const h=map.get(id)??fresh(id);map.set(id,h);check(map.size<=TEMPLATE_LIMITS.templates,'VALIDATION_LIMIT');
   if(row.kind==='template'){
    check(sr.operation===INGEST,'EVIDENCE_MISMATCH');const previous=h.latest;
    check(row.value.revision===(previous?.value.revision??0)+1&&(previous?same(row.value.supersedes,previous.reference):row.value.supersedes===null),'EVIDENCE_MISMATCH');
    check(!previous||row.value.kind===previous.value.kind,'EVIDENCE_MISMATCH');
    check(equal(sr.transitions,[{kind:'template',id,from:row.value.revision-1,to:row.value.revision}]),'EVIDENCE_MISMATCH');
    const before=view.records.get(sr.previousHead.path).value.templates.find(x=>x.id===id)??null;
    check(previous?same(before,previous.reference):before===null,'EVIDENCE_MISMATCH');
    h.latest=row;h.revisions.push(row);check(h.revisions.length<=TEMPLATE_LIMITS.revisions,'VALIDATION_LIMIT');
   }else{
    const x=row.value;check(sr.operation===ADOPT&&x.action==='adopt'&&x.experiment===null&&x.outputs.length===0&&x.evidenceReceipt===null,'EVIDENCE_MISMATCH');
    check(!decisionIds.has(x.decisionId),'EVIDENCE_MISMATCH');decisionIds.add(x.decisionId);
    const selected=h.revisions.find(r=>same(r.reference,x.template));check(selected,'EVIDENCE_MISMATCH');
    check(x.expectedRevision===h.sequence&&(h.tail?same(x.supersedesDecision,h.tail):x.supersedesDecision===null)&&sr.transitions.length===0,'EVIDENCE_MISMATCH');
    check(new Set(x.appliesTo).size===x.appliesTo.length&&x.appliesTo.every(k=>selected.value.appliesTo.includes(k)),'EVIDENCE_MISMATCH');
    h.sequence++;h.tail=row.reference;h.decisions.push(row);for(const k of x.appliesTo)h.active.set(k,row);
    check(++decisions<=TEMPLATE_LIMITS.decisions,'VALIDATION_LIMIT');
   }
   check(scopes(h).length<=TEMPLATE_LIMITS.scopes,'VALIDATION_LIMIT');
  }
  check(head.value.templates.length===map.size&&head.value.templates.every(r=>same(map.get(r.id)?.latest?.reference,r)),'EVIDENCE_MISMATCH');
 }
 check(subjects===[...view.records.values()].filter(x=>['template','template-decision'].includes(x.kind)).length,'CAPABILITY_UNAVAILABLE');
 return {map,events,decisions};
}
function sourceReader(store,allowed=null){let total=0;return s=>{
 const unresolved=cause=>({source:s,status:'unresolved',cause});
 if(allowed&&!allowed.includes(s.sourceId))return unresolved('INVALID_SCOPE');
 if(s.kind!=='file')return unresolved('CAPABILITY_UNAVAILABLE');
 let fd;try{
  const location=store.safe(s.location);fd=fs.openSync(location,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW??0));const before=fs.fstatSync(fd);
  check(before.isFile()&&before.nlink===1,'UNSAFE_PATH');check(before.size<=TEMPLATE_LIMITS.sourceBytes&&total+before.size<=TEMPLATE_LIMITS.sourceTotalBytes,'VALIDATION_LIMIT');
  total+=before.size;const hash=createHash('sha256'),chunk=Buffer.alloc(64*1024);let n=0,k;
  while((k=fs.readSync(fd,chunk,0,Math.min(chunk.length,before.size+1-n),null))>0){n+=k;check(n<=before.size,'HASH_MISMATCH');hash.update(chunk.subarray(0,k));}
  const after=fs.fstatSync(fd),now=fs.lstatSync(store.safe(s.location));
  check(n===before.size&&after.size===before.size&&after.mtimeMs===before.mtimeMs&&now.ino===before.ino&&now.dev===before.dev&&now.size===before.size&&now.mtimeMs===before.mtimeMs,'HASH_MISMATCH');
  return hash.digest('hex')===s.sha256?{source:s,status:'verified',cause:null}:unresolved('HASH_MISMATCH');
 }catch(e){if(['UNSAFE_PATH','ROOT_CHANGED','PATH_CASE_MISMATCH','VALIDATION_LIMIT'].includes(e.code))throw e;return unresolved(e.code==='HASH_MISMATCH'?'HASH_MISMATCH':'MISSING_SOURCE');}
 finally{if(fd!==undefined)fs.closeSync(fd);}
 };}
export function validateTemplateQuery(q){
 check(q&&q.schemaVersion==='3djat.template-query.v1','UNSUPPORTED_SCHEMA');
 const base=['schemaVersion','kind','atHead'];
 if(q.kind==='list'){exact(q,[...base,'applicability']);if(q.applicability!==null)identifier(q.applicability);}
 else if(q.kind==='template'){exact(q,[...base,'templateId']);identifier(q.templateId);}
 else if(q.kind==='discovery'){
  exact(q,[...base,'productId','applicability','branded','brandTemplateId']);identifier(q.applicability);
  shape('command',{schemaVersion:'3djat.command.v1',operation:'product.create',key:'query',expected:{domainHead:q.atHead,entityRevision:0},input:{productId:q.productId,workingName:'Query',productCode:null}});
  check(typeof q.branded==='boolean'&&(q.branded?q.brandTemplateId!==null:q.brandTemplateId===null),'INVALID_VALUE');if(q.brandTemplateId!==null)identifier(q.brandTemplateId);
 }else fail('INVALID_VALUE');shape('revision-ref',q.atHead);return q;
}
function status(h,row,app){const decisions=h.decisions.filter(d=>same(d.value.template,row.reference)&&d.value.appliesTo.includes(app)),last=decisions.at(-1),active=h.active.get(app);
 return {contract:{state:'valid',errors:[]},operational:{state:'not-assessed',assessment:null},visual:{state:'untested',assessment:null},human:{state:last?(same(last.reference,active?.reference)?'adopted':'superseded'):'unreviewed',decision:last?.reference??null}};
}
function chosen(d,app){return d?{template:d.value.template,decision:d.reference,purpose:d.value.purpose,applicability:app}:null;}
function boundedView(value){check(Buffer.byteLength(JSON.stringify(value),'utf8')<=TEMPLATE_LIMITS.responseBytes,'VALIDATION_LIMIT');return value;}
function render(store,view,hist,q,a,principal=null){
 const grant=principal?.templateGrant,source=sourceReader(store,grant?.sourceIds??null),cache=new Map();
 const sources=row=>{if(!cache.has(row.reference.path))cache.set(row.reference.path,row.value.sourceRefs.map(source));return cache.get(row.reference.path);};
 const permitted=(id,app)=>!principal||grant.templateIds.includes(id)&&grant.appliesTo.includes(app);
 const scope=(h,app)=>{const d=h.active.get(app),row=d?h.revisions.find(r=>same(r.reference,d.value.template)):h.latest;
  const blockers=[];if(!d||!a)blockers.push('CAPABILITY_UNAVAILABLE');for(const s of sources(row))if(s.cause&&!blockers.includes(s.cause))blockers.push(s.cause);
  return {applicability:app,chosen:chosen(d,app),selectable:blockers.length===0,blockers,status:status(h,row,app)};
 };
 let data;
 if(q.kind==='list'){
  const templates=[];for(const h of [...hist.map.values()].sort((x,y)=>x.id.localeCompare(y.id))){const apps=scopes(h).filter(k=>permitted(h.id,k)&&(q.applicability===null||q.applicability===k));if(!apps.length)continue;
   templates.push({templateId:h.id,kind:h.latest.value.kind,latest:h.latest.reference,decisionSequence:h.sequence,streamTail:h.tail,applicability:apps.map(k=>scope(h,k))});}
  data={templates};
 }else if(q.kind==='template'){
  if(principal)check(grant.templateIds.includes(q.templateId),'INVALID_SCOPE');const h=hist.map.get(q.templateId);check(h,'MISSING_SOURCE');
  if(principal)check(h.revisions.every(r=>r.value.appliesTo.every(k=>grant.appliesTo.includes(k))),'INVALID_SCOPE');
  data={latest:h.latest.reference,decisionSequence:h.sequence,streamTail:h.tail,revisions:h.revisions.map(r=>({reference:r.reference,record:r.value,sources:sources(r),statuses:r.value.appliesTo.map(app=>({applicability:app,status:status(h,r,app)}))})),decisions:h.decisions.map(d=>({reference:d.reference,record:d.value,activeAppliesTo:[...h.active].filter(([,v])=>same(v.reference,d.reference)).map(([k])=>k).sort(),audit:d.audit.reference,publication:d.publication,receipt:d.receipt}))};
 }else{
  const product=view.head.products.find(p=>p.productId===q.productId);check(product,'MISSING_SOURCE');
  if(principal)check((principal.products==='*'||principal.products.includes(q.productId))&&grant.appliesTo.includes(q.applicability),'INVALID_SCOPE');
  let brand=null,brandBlockers=[];
  if(q.branded){if(principal)check(grant.templateIds.includes(q.brandTemplateId),'INVALID_SCOPE');const h=hist.map.get(q.brandTemplateId);
   if(h?.latest.value.kind==='brand'&&permitted(h.id,q.applicability)){const s=scope(h,q.applicability);brand=s.chosen;if(!s.selectable)brandBlockers.push('BRAND_SETUP_NEEDED',...s.blockers);}
   else brandBlockers.push('BRAND_SETUP_NEEDED');
  }
  const operations=[];for(const h of [...hist.map.values()].sort((x,y)=>x.id.localeCompare(y.id))){if(h.latest.value.kind!=='operation'||!scopes(h).includes(q.applicability)||!permitted(h.id,q.applicability))continue;
   const s=scope(h,q.applicability),blockers=[...new Set([...s.blockers,...brandBlockers])];check(blockers.length<=8,'VALIDATION_LIMIT');operations.push({templateId:h.id,latest:h.latest.reference,chosen:s.chosen,selectable:s.selectable&&brandBlockers.length===0,blockers,status:s.status});}
  data={product:product.dossier,applicability:q.applicability,branded:q.branded,brandTemplateId:q.brandTemplateId,brand,operations};
 }
 return boundedView({schemaVersion:'3djat.template-view.v1',kind:q.kind,head:view.reference,authority:'domain-files',evidenceVerification:a?'mac-verified':'hash-only',data});
}
function privateContext(store,file){file=safePrivate(file);check(!within(store.root,file)&&!within(file+'.intents',store.root),'UNSAFE_PATH');const a=access(file);check(a.workspaceId===store.marker.workspaceId,'INVALID_SCOPE');return a;}
export function readTemplateRegistry(root,{query,accessFile=null}){
 validateTemplateQuery(query);const store=new DomainStore(root),a=accessFile===null?null:privateContext(store,accessFile),view=store.read();check(same(view.reference,query.atHead),'REVISION_CONFLICT');const result=render(store,view,history(view,a),query,a);check(same(store.read().reference,view.reference),'REVISION_CONFLICT');return result;
}
export class DomainTemplates {
 #store;#file;#auth;#hook;
 constructor(root,{accessFile,authenticate=null,hook=()=>{}}){this.#store=new DomainStore(root);this.#file=safePrivate(accessFile);this.#auth=authenticate;this.#hook=hook;this.#registry();}
 #registry(){return privateContext(this.#store,this.#file);}
 #principal(token,op,id=null,apps=[],sourceRefs=[],productId=null){
  const a=this.#registry();let p;
  if(this.#auth){const native=this.#auth(token);check(native,'INVALID_SCOPE');const policy=a.principals.find(x=>x.id===native.id&&x.role===native.role);check(policy,'INVALID_SCOPE');
   p={...policy,role:native.role,products:native.products==='*'?policy.products:policy.products==='*'?native.products:native.products.filter(id=>policy.products.includes(id))};
  }else p=findBearer(a,token);
  const g=p?.templateGrant;check(p&&g&&g.operations.includes(op)&&(!id||g.templateIds.includes(id))&&apps.every(k=>g.appliesTo.includes(k))&&sourceRefs.every(s=>g.sourceIds.includes(s.sourceId)),'INVALID_SCOPE');
  check(op!=='adopt'||p.role==='human'&&g.operations.includes('read'),'INVALID_SCOPE');check(op!=='ingest'||p.role!=='source-proposer'||sourceRefs.length>0,'INVALID_SCOPE');
  if(productId)check(p.products==='*'||p.products.includes(productId),'INVALID_SCOPE');return p;
 }
 #authorize(token,packet,h){const x=packet.input,ingest=packet.operation===INGEST,id=ingest?x.templateId:x.template.id,selected=ingest?null:h.map.get(id)?.revisions.find(r=>same(r.reference,x.template));
  if(!ingest)check(selected,'EVIDENCE_MISMATCH');const sources=ingest?x.sourceRefs:selected.value.sourceRefs;
  const old=ingest?(x.supersedes?h.map.get(id)?.revisions.find(r=>same(r.reference,x.supersedes)):null):null;
  return this.#principal(token,ingest?'ingest':'adopt',id,[...new Set([...x.appliesTo,...(old?.value.appliesTo??[])])],sources);
 }
 #input(packet,h){const x=packet.input,id=packet.operation===INGEST?x.templateId:x.template.id,current=h.map.get(id);
  const context={currentRevision:packet.operation===INGEST?(current?.latest.value.revision??0):(current?.sequence??0)};
  if(packet.operation===INGEST){
   if(current){context.template={reference:current.latest.reference,record:current.latest.value};check(current.latest.value.kind===x.kind,'INVALID_VALUE');}
   check((current?.revisions.length??0)<TEMPLATE_LIMITS.revisions&&(current||h.map.size<TEMPLATE_LIMITS.templates),'VALIDATION_LIMIT');
   check(new Set([...x.appliesTo,...(current?.active.keys()??[])]).size<=24,'VALIDATION_LIMIT');
  }else{
   check(current,'EVIDENCE_MISMATCH');const selected=current.revisions.find(r=>same(r.reference,x.template));check(selected,'EVIDENCE_MISMATCH');context.template={reference:selected.reference,record:selected.value};
   check(x.action==='adopt'&&x.experiment===null&&x.outputs.length===0&&x.evidenceReceipt===null,'INVALID_SCOPE');
   check(current.tail?same(current.tail,x.supersedesDecision):x.supersedesDecision===null,'EVIDENCE_MISMATCH');
   check(![...h.map.values()].some(v=>v.decisions.some(d=>d.value.decisionId===x.decisionId)),'IDEMPOTENCY_CONFLICT');
   check(h.decisions<TEMPLATE_LIMITS.decisions&&new Set([...scopes(current),...x.appliesTo]).size<=24,'VALIDATION_LIMIT');
  }
  check(new Set(x.appliesTo).size===x.appliesTo.length,'INVALID_VALUE');const checked=validateCommand(packet,context);check(checked.ok,checked.errors[0]?.code);
 }
 readRegistry(token,query){validateTemplateQuery(query);const p=this.#principal(token,'read',query.kind==='template'?query.templateId:query.kind==='discovery'&&query.branded?query.brandTemplateId:null,query.applicability?[query.applicability]:[],[],query.kind==='discovery'?query.productId:null),view=this.#store.read(),a=this.#registry();check(same(view.reference,query.atHead),'REVISION_CONFLICT');const result=render(this.#store,view,history(view,a),query,a,p);check(same(this.#store.read().reference,view.reference),'REVISION_CONFLICT');return result;}
 operationalEvidence(){const a=this.#registry(),view=this.#store.read();return history(view,a).events;}
 static failure(...args){return DomainProducts.failure(...args);}
 failure(...args){return DomainTemplates.failure(...args);}
 command(token,packet){
  const valid=validate('command',packet);if(!valid.ok){if(['template.ingest','template.adopt','template.promote'].includes(packet?.operation)&&validate('revision-ref',{id:packet.key,revision:1,path:'key.json',sha256:'0'.repeat(64)}).ok)return this.failure(packet,{code:valid.errors[0].code});fail(valid.errors[0].code);}
  check(OPS.has(packet.operation)||packet.operation==='template.promote','INVALID_SCOPE');let receipt=null;
  try{
   if(packet.operation==='template.promote')fail('CAPABILITY_UNAVAILABLE');
   // Authenticate before opening business history. Policy is re-resolved at every boundary.
   const preliminary=this.#principal(token,packet.operation===INGEST?'ingest':'adopt',packet.operation===INGEST?packet.input.templateId:packet.input.template.id,packet.input.appliesTo,packet.operation===INGEST?packet.input.sourceRefs:[]);
   const view=this.#store.read(),h=history(view,this.#registry()),p=this.#authorize(token,packet,h);check(p.id===preliminary.id&&p.role===preliminary.role,'INVALID_SCOPE');
   const existing=[...view.records.values()].find(r=>r.kind==='store-receipt'&&r.value.principal===p.id&&r.value.operation===packet.operation&&r.value.key===packet.key);
   if(existing){const row=[...h.map.values()].flatMap(h=>[...h.revisions,...h.decisions]).find(r=>same(r.receipt,existing.reference));check(row,'EVIDENCE_MISMATCH');check(equal(packetOf(row),packet),'IDEMPOTENCY_CONFLICT');receipt=existing.reference;
    const result=this.#result(packet,receipt,row.reference);this.#hook('before-response',{result});return result;
   }
   check(same(view.reference,packet.expected.domainHead),'REVISION_CONFLICT');this.#input(packet,h);
   const sources=()=>{if(packet.operation===ADOPT){const row=h.map.get(packet.input.template.id).revisions.find(r=>same(r.reference,packet.input.template)),read=sourceReader(this.#store,p.templateGrant.sourceIds);for(const s of row.value.sourceRefs){const status=read(s);check(status.status==='verified',status.cause==='HASH_MISMATCH'?'HASH_MISMATCH':'MISSING_SOURCE');}}};sources();
   if(packet.operation===ADOPT)check(same(packet.input.humanActionReceipt,templateDecisionActionReference({workspaceId:this.#store.marker.workspaceId,principalId:p.id,packet})),'EVIDENCE_MISMATCH');
   const intent=reserveIntent(this.#file,p,packet),event=eventFor(this.#store.marker.workspaceId,p.id,packet,intent.createdAt),a=this.#registry();
   const audit={schemaVersion:'3djat.evidence.v1',id:event.id,revision:1,description:stable({format:'3djat.template-action.v1',role:p.role,event,mac:signAction(a,p.role,event)})};
   const type=packet.operation===INGEST?'template':'template-decision',subject=prepareRecord(type,packet.input);prepareRecord('evidence',audit);
   const plan={principal:p.id,operation:packet.operation,key:packet.key,expectedHead:packet.expected.domainHead,changes:packet.operation===INGEST?[{kind:'template',id:packet.input.templateId,expectedRevision:packet.expected.entityRevision,record:packet.input}]:[],records:[{kind:'evidence',record:audit},...(packet.operation===ADOPT?[{kind:type,record:packet.input}]:[])]};
   this.#hook('before-publication',{});this.#store.hook=(stage,detail)=>{
    this.#hook(stage,detail);
    if(stage==='locked'||stage==='before-replace'){
     const current=this.#store.read();check(same(current.reference,view.reference),'REVISION_CONFLICT');const caller=this.#authorize(token,packet,h);check(caller.id===p.id&&caller.role===p.role,'INVALID_SCOPE');sources();
    }
   };
   const commit=this.#store.commit(plan);receipt=commit.receipt;const committed=this.#store.read();history(committed,this.#registry());const result=this.#result(packet,receipt,subject.reference);this.#hook('after-domain-commit',{result});this.#hook('before-response',{result});return result;
  }catch(e){
   // Private diagnostic hook; failures still use the bounded public error contract.
   try{this.#hook('command-error',{code:e.code??'IO_FAILURE',detail:e.detail??{},receipt});}catch{}
   if(!receipt&&e.code==='COMMIT_UNCERTAIN')try{const view=this.#store.read(),h=history(view,this.#registry()),p=this.#authorize(token,packet,h);receipt=[...view.records.values()].find(r=>r.kind==='store-receipt'&&r.value.principal===p.id&&r.value.operation===packet.operation&&r.value.key===packet.key)?.reference??null;}catch{}
   return this.failure(packet,e,receipt);
  }finally{this.#store.hook=()=>{};}
 }
 #result(packet,receipt,reference){const result={schemaVersion:'3djat.result.v1',operation:packet.operation,key:packet.key,receipt,owner:'domain',committedRevision:reference.revision,outputType:packet.operation===INGEST?'template':'template-decision',reference};shape('result',result);return result;}
}
