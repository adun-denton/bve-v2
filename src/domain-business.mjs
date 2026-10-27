// Offline file-owned business authority. No Kernel, SQLite or provider bridge.
import * as fs from 'node:fs';
import * as path from 'node:path';
import {randomBytes} from 'node:crypto';
import {DomainStore,prepareRecord,StoreError} from './domain-store.mjs';
import {validate,validateCommand,ERROR_CODES} from './contracts/3djat.mjs';
import {stable,digest,uuid,bytes,equal,same,check,fail,shape,exact,identifier,within,
  safePrivate,privateRead,exclusive,syncDir,reserveIntent,signAction,verifyAction} from './domain-authority.mjs';

const OP='business.context.publish',FORMAT='3djat.business-access.v1';
const date=x=>{shape('business-decision',{schemaVersion:'3djat.business-decision.v1',decisionId:'00000000-0000-4000-8000-000000000000',revision:1,
  workspaceId:'00000000-0000-4000-8000-000000000000',expectedRevision:0,action:'approve',instructionsSha256:'0'.repeat(64),sourceRefs:[{kind:'file',sourceId:'date-check',revision:'1',sha256:'0'.repeat(64),location:'date.txt',locator:{kind:'page',page:1},observedAt:x}],decidedAt:x,
  humanActionReceipt:{id:'date-check',revision:1,path:'Operational/event/date-check.json',sha256:'0'.repeat(64)}});};
const sameMaybe=(a,b)=>a===null?b===null:b!==null&&same(a,b);
const instructionHash=input=>digest(bytes({instructions:input.instructions,sourceRefs:input.sourceRefs}));
const eventRef=e=>({id:e.id,revision:1,path:`Operational/event/${e.id}.json`,sha256:digest(stable(e))});
function eventFor(workspaceId,principalId,packet){
 const input=structuredClone(packet.input);delete input.humanActionReceipt;
 return {id:uuid(stable([workspaceId,principalId,packet.operation,packet.key])),version:1,type:'business-action',workspaceId,principalId,
   operation:packet.operation,key:packet.key,commandHash:digest(stable({...packet,input})),recordedAt:packet.input.decidedAt};
}
export function businessDecisionActionReference({workspaceId,principalId,packet}){
 check(packet?.operation===OP,'INVALID_SCOPE');shape('command',packet);identifier(principalId);
 shape('revision-ref',{id:workspaceId,revision:1,path:'workspace.json',sha256:'0'.repeat(64)});
 return eventRef(eventFor(workspaceId,principalId,packet));
}
function ids(xs,max){check(Array.isArray(xs)&&xs.length<=max&&new Set(xs).size===xs.length,'INVALID_VALUE');for(const x of xs)identifier(x);}
function portable(value,depth=0){check(depth<=8&&value&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value)),'INVALID_VALUE');
 const descriptors=Object.getOwnPropertyDescriptors(value);check(Reflect.ownKeys(descriptors).every(k=>typeof k==='string'&&Object.hasOwn(descriptors[k],'value')&&descriptors[k].enumerable),'INVALID_VALUE');
 return descriptors;}
function grant(g){exact(g,['operations','sourceIds']);check(Array.isArray(g.operations)&&g.operations.length<=2&&new Set(g.operations).size===g.operations.length&&g.operations.every(x=>['read','publish'].includes(x)),'INVALID_SCOPE');ids(g.sourceIds,32);}
function registry(file){const a=privateRead(file);exact(a,['schemaVersion','workspaceId','key','principals']);check(a.schemaVersion===FORMAT&&/^[0-9a-f]{64}$/.test(a.key),'INVALID_VALUE');
 shape('revision-ref',{id:a.workspaceId,revision:1,path:'workspace.json',sha256:'0'.repeat(64)});
 check(Array.isArray(a.principals)&&a.principals.length<=32,'INVALID_VALUE');const seen=new Set();
 for(const p of a.principals){exact(p,['id','role','operations','sourceIds']);identifier(p.id);check(['human','conductor'].includes(p.role)&&!seen.has(p.id),'INVALID_SCOPE');seen.add(p.id);grant({operations:p.operations,sourceIds:p.sourceIds});}
 return a;
}
// Trusted quiescent filesystem-owner operation, never a command/query permission.
export function configureBusinessGrant(file,{workspaceId,principalId,role,grant:requested,expectedSha256,confirmedQuiescent}){
 check(confirmedQuiescent===true,'INVALID_SCOPE');identifier(principalId);shape('revision-ref',{id:workspaceId,revision:1,path:'workspace.json',sha256:'0'.repeat(64)});
 check(['human','conductor'].includes(role),'INVALID_SCOPE');grant(requested);
 const exists=fs.existsSync(file);check(exists?typeof expectedSha256==='string'&&/^[0-9a-f]{64}$/.test(expectedSha256):expectedSha256===null,'REVISION_CONFLICT');
 const full=safePrivate(file,{missing:!exists});let a,backupFile=null,before=null;
 if(exists){before=fs.readFileSync(full);check(digest(before)===expectedSha256,'REVISION_CONFLICT');a=registry(full);check(a.workspaceId===workspaceId,'INVALID_SCOPE');
  backupFile=full+'.before-business-'+digest(before)+'.json';
  if(fs.existsSync(backupFile))check(fs.readFileSync(safePrivate(backupFile)).equals(before),'EVIDENCE_MISMATCH');
  else {const fd=fs.openSync(safePrivate(backupFile,{missing:true}),'wx',0o600);try{fs.writeFileSync(fd,before);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}syncDir(path.dirname(full));}
  check(fs.readFileSync(safePrivate(backupFile)).equals(before),'HASH_MISMATCH');
 }else a={schemaVersion:FORMAT,workspaceId,key:randomBytes(32).toString('hex'),principals:[]};
 const p=a.principals.find(x=>x.id===principalId);check(!p||p.role===role,'INVALID_SCOPE');
 if(p){p.operations=[...requested.operations];p.sourceIds=[...requested.sourceIds];}
 else {check(a.principals.length<32,'VALIDATION_LIMIT');a.principals.push({id:principalId,role,operations:[...requested.operations],sourceIds:[...requested.sourceIds]});}
 if(!exists)exclusive(full,a);
 else {const tmp=full+'.'+randomBytes(8).toString('hex');exclusive(tmp,a);
  check(digest(fs.readFileSync(safePrivate(full)))===expectedSha256,'REVISION_CONFLICT');fs.renameSync(tmp,full);syncDir(path.dirname(full));}
 const after=registry(full);check(equal(a,after)&&(!before||a.key===JSON.parse(before).key),'EVIDENCE_MISMATCH');
 return {backupFile,sha256:digest(fs.readFileSync(full))};
}
function resolved(view,ref,kind){const row=view.records.get(ref?.path);check(row&&row.kind===kind&&same(row.reference,ref),'EVIDENCE_MISMATCH');return row;}
function heads(view){return [...view.records.values()].filter(x=>x.kind==='domain-head').sort((a,b)=>a.value.revision-b.value.revision);}
function result(packet,receipt,ref){const v={schemaVersion:'3djat.result.v1',operation:OP,key:packet.key,receipt,owner:'domain',committedRevision:ref.revision,outputType:'business-context',reference:ref};shape('result',v);return v;}
function failure(packet,e,receipt=null){let code=ERROR_CODES.includes(e.code)?e.code:e.code==='OVERSIZE'?'VALIDATION_LIMIT':e.code==='HEAD_CHANGED'?'REVISION_CONFLICT':['ROOT_CHANGED','STORE_CHANGED','PATH_CASE_MISMATCH'].includes(e.code)?'UNSAFE_PATH':
 ['MISSING_REFERENCE','ENOENT'].includes(e.code)?'MISSING_SOURCE':['COMMIT_UNCERTAIN','ACK_PENDING'].includes(e.code)?'EXPORT_PENDING':'CAPABILITY_UNAVAILABLE';
 const v={schemaVersion:'3djat.failure.v1',operation:OP,key:packet.key,error:{code,path:'$',recoverability:code==='REVISION_CONFLICT'?'refresh':code==='MISSING_SOURCE'?'supply-source':code==='EXPORT_PENDING'?'manual-review':'correct-input',message:code,evidence:receipt}};
 shape('failure',v);return v;}
function packetFrom(receipt,context,decision){return {schemaVersion:'3djat.command.v1',operation:OP,key:receipt.key,
 expected:{domainHead:receipt.previousHead,entityRevision:decision.expectedRevision},
 input:{workspaceId:context.workspaceId,expectedRevision:decision.expectedRevision,revision:context.revision,instructions:context.instructions,
  sourceRefs:context.sourceRefs,decidedAt:decision.decidedAt,humanActionReceipt:decision.humanActionReceipt}};}
function proof(view,a){let previous=null,selected=null;for(const head of heads(view)){
 const h=head.value,prior=h.previousHead?resolved(view,h.previousHead,'domain-head'):null,old=prior?.value.business??null;
 const rr=h.receipts[0];if(!rr){check(h.previousHead===null&&h.business===null,'EVIDENCE_MISMATCH');continue;}
 const receipt=resolved(view,rr,'store-receipt').value,rows=receipt.records.map(r=>resolved(view,r,view.records.get(r.path)?.kind));
 const businessRows=rows.filter(x=>['business-context','business-decision'].includes(x.kind));
 const businessEvidence=rows.some(x=>{if(x.kind!=='evidence')return false;try{return JSON.parse(x.value.description)?.format==='3djat.business-action.v1';}catch{return false;}});
 if(!businessRows.length&&!businessEvidence){check(sameMaybe(old,h.business)&&receipt.transitions.every(t=>t.kind!=='business-context'),'EVIDENCE_MISMATCH');continue;}
 check(receipt.operation===OP&&rows.length===3&&rows[0].kind==='evidence'&&rows[1].kind==='business-decision'&&rows[2].kind==='business-context','EVIDENCE_MISMATCH');
 const [audit,decision,context]=rows,rev=old?.revision??0,workspace=h.workspaceId;
 check(context.value.workspaceId===workspace&&context.value.revision===rev+1&&same(context.value.decision,decision.reference)&&same(context.value.sourceReceipt,audit.reference)&&
  decision.value.decisionId===audit.value.id&&decision.value.revision===1&&decision.value.workspaceId===workspace&&decision.value.expectedRevision===rev&&
  decision.value.action==='approve'&&decision.value.instructionsSha256===instructionHash(context.value)&&equal(decision.value.sourceRefs,context.value.sourceRefs),'EVIDENCE_MISMATCH');
 check(same(h.business,context.reference)&&sameMaybe(old,prior?.value.business??null)&&equal(h.products,prior.value.products)&&equal(h.templates,prior.value.templates)&&equal(h.skus,prior.value.skus),'EVIDENCE_MISMATCH');
 check(equal(receipt.transitions,[{kind:'business-context',id:workspace,from:rev,to:rev+1}])&&receipt.workspaceId===workspace&&receipt.principal&&same(receipt.previousHead,prior.reference),'EVIDENCE_MISMATCH');
 let signed;try{signed=JSON.parse(audit.value.description);}catch{fail('EVIDENCE_MISMATCH');}
 exact(signed,['format','role','event','mac']);check(signed.format==='3djat.business-action.v1'&&signed.role==='human','EVIDENCE_MISMATCH');
 const packet=packetFrom(receipt,context.value,decision.value),valid=validateCommand(packet,{authenticatedCaller:'human',currentHead:prior.reference,currentRevision:rev});check(valid.ok,valid.errors[0]?.code??'EVIDENCE_MISMATCH');
 const ev=eventFor(workspace,receipt.principal,packet);date(ev.recordedAt);check(equal(signed.event,ev)&&decision.value.decisionId===ev.id&&audit.reference.id===ev.id&&audit.reference.revision===1&&
  same(decision.value.humanActionReceipt,eventRef(ev))&&audit.value.revision===1,'EVIDENCE_MISMATCH');verifyAction(a,'human',ev,signed.mac);
 const expectedPayload={expectedHead:receipt.previousHead,
  changes:[{kind:'business-context',id:workspace,expectedRevision:rev,reference:context.reference}],
  records:[{kind:'evidence',reference:audit.reference},{kind:'business-decision',reference:decision.reference}]};
 check(receipt.id===digest(stable([workspace,receipt.principal,OP,receipt.key]))&&receipt.payloadHash===digest(bytes(expectedPayload))&&
  same(audit.reference,receipt.records[0])&&same(decision.reference,receipt.records[1])&&same(context.reference,receipt.records[2]),'EVIDENCE_MISMATCH');
 previous=context;selected={reference:context.reference,record:context.value,decisionReference:decision.reference,decision:decision.value,
  publication:head.reference,receipt:rr,audit:audit.reference,packet};
 }
 check(sameMaybe(view.head.business,previous?.reference??null),'EVIDENCE_MISMATCH');return selected;
}
export class DomainBusiness {
 #store;#file;#auth;#hook;
 constructor(root,{accessFile,authenticate,hook=()=>{}}){this.#store=new DomainStore(root);check(typeof authenticate==='function','INVALID_SCOPE');
  this.#file=safePrivate(accessFile);check(!within(this.#store.root,this.#file)&&!within(this.#file+'.intents',this.#store.root),'UNSAFE_PATH');
  this.#auth=authenticate;this.#hook=hook;this.#registry();}
 #registry(){const a=registry(this.#file);check(a.workspaceId===this.#store.marker.workspaceId,'INVALID_SCOPE');return a;}
 #caller(token,op,sourceIds=[],key=null){const native=this.#auth(token);check(native&&typeof native==='object'&&!Array.isArray(native)&&[Object.prototype,null].includes(Object.getPrototypeOf(native)),'INVALID_SCOPE');
  const ds=Object.getOwnPropertyDescriptors(native),names=Reflect.ownKeys(ds);check(names.length>=3&&names.length<=4&&names.every(k=>typeof k==='string'&&['id','role','products','sourceIds'].includes(k)&&Object.hasOwn(ds[k],'value')&&ds[k].enumerable),'INVALID_SCOPE');
  check(['id','role','products'].every(k=>Object.hasOwn(ds,k)),'INVALID_SCOPE');const {id,role,products}=native;
  identifier(id);check(['human','conductor'].includes(role)&&products==='*','INVALID_SCOPE');
  if(Object.hasOwn(ds,'sourceIds')){const x=ds.sourceIds.value;check(Array.isArray(x)&&Object.getPrototypeOf(x)===Array.prototype&&x.length<=32&&Object.keys(x).length===x.length,'INVALID_SCOPE');
   const elements=Object.getOwnPropertyDescriptors(x);check(Reflect.ownKeys(elements).length===x.length+1&&
    Array.from({length:x.length},(_,i)=>elements[i]&&Object.hasOwn(elements[i],'value')&&typeof elements[i].value==='string').every(Boolean),'INVALID_SCOPE');}
  const a=this.#registry(),p=a.principals.find(x=>x.id===id&&x.role===role);
  check(p&&p.operations.includes('read')&&(op==='read'||role==='human'&&p.operations.includes('publish')),'INVALID_SCOPE');
  if(key!==null)check(a.key===key,'EVIDENCE_MISMATCH');
  check(sourceIds.every(s=>p.sourceIds.includes(s)),'INVALID_SCOPE');return {id,role,policy:p,key:a.key,registry:a};
 }
 #sources(token,start,sourceRefs,mode,op='read',observedHead){let total=0;const statuses=[];
  for(const s of sourceRefs){const c=this.#current(token,op,start);check(same(this.#store.read().reference,observedHead),'HEAD_CHANGED');let cause=null;
   if(!c.policy.sourceIds.includes(s.sourceId))cause='INVALID_SCOPE';
   else if(s.kind!=='file')cause='CAPABILITY_UNAVAILABLE';
   else try{const data=this.#store.readFile(s.location);total+=data.length;check(total<=16*1024**2,'VALIDATION_LIMIT');if(digest(data)!==s.sha256)cause='HASH_MISMATCH';}
   catch(e){if(['UNSAFE_PATH','ROOT_CHANGED','PATH_CASE_MISMATCH','OVERSIZE','VALIDATION_LIMIT'].includes(e.code))throw e;
    cause=e.code==='MISSING_REFERENCE'?'MISSING_SOURCE':e.code==='FILE_CHANGED'?'HASH_MISMATCH':e.code??'MISSING_SOURCE';}
   if(mode==='new'&&cause)fail(cause);statuses.push({source:s,status:cause?'unresolved':'verified',cause});
  }return statuses;
 }
 #current(token,op,start,sourceIds=[]){const end=this.#caller(token,op,sourceIds,start.key);check(end.id===start.id&&end.role===start.role,'INVALID_SCOPE');return end;}
 resolveBusinessForOperation(token,query){const d=portable(query);
  exact(query,['mode','atHead','workspaceId']);portable(d.atHead.value,1);
  check(['new','historical'].includes(query.mode),'INVALID_VALUE');shape('revision-ref',query.atHead);
  shape('domain-head',{schemaVersion:'3djat.domain-head.v1',workspaceId:query.workspaceId,revision:1,previousHead:null,products:[],skus:[],business:null,templates:[],receipts:[]});
  const q=structuredClone(query),start=this.#caller(token,'read');check(q.workspaceId===this.#store.marker.workspaceId,'INVALID_SCOPE');
  if(q.mode==='new')check(start.role==='human','INVALID_SCOPE');const current=this.#store.read();
  if(q.mode==='new')check(same(current.reference,q.atHead),'REVISION_CONFLICT');
  else check(heads(current).some(h=>same(h.reference,q.atHead)),'MISSING_SOURCE');
  const view=q.mode==='new'?current:this.#store.read({atHead:q.atHead}),selected=proof(view,start.registry);
  check(selected&&same(selected.reference,view.head.business),'MISSING_SOURCE');
  const statuses=this.#sources(token,start,selected.record.sourceRefs,q.mode,'read',current.reference),finish=this.#current(token,'read',start);
  const latest=this.#store.read();check(same(latest.reference,current.reference),'HEAD_CHANGED');
  if(q.mode==='new')check(finish.role==='human'&&same(latest.reference,q.atHead),'REVISION_CONFLICT');
  for(const status of statuses)if(!finish.policy.sourceIds.includes(status.source.sourceId)){
   if(q.mode==='new')fail('INVALID_SCOPE');status.status='unresolved';status.cause='INVALID_SCOPE';}
  const {packet,...business}=selected,value={head:view.reference,workspaceId:q.workspaceId,principalId:start.id,business,sourceStatus:statuses};
  check(bytes(value).length<=1024**2,'OVERSIZE');return structuredClone(value);
 }
 operationalEvidence(){
  const a=this.#registry(),view=this.#store.read();proof(view,a);
  return [...view.records.values()].filter(x=>x.kind==='business-context').map(x=>{
    const evidence=view.records.get(x.value.sourceReceipt.path);
    check(evidence?.kind==='evidence'&&same(evidence.reference,x.value.sourceReceipt),'EVIDENCE_MISMATCH');
    const signed=JSON.parse(evidence.value.description);
    check(signed.format==='3djat.business-action.v1','EVIDENCE_MISMATCH');return structuredClone(signed.event);
  });
 }
 command(token,packet){const validation=validate('command',packet);if(!validation.ok){const op=Object.getOwnPropertyDescriptor(packet??{},'operation')?.value,key=Object.getOwnPropertyDescriptor(packet??{},'key')?.value;
   if(op===OP&&typeof key==='string')return failure({key},new StoreError(validation.errors[0].code));fail(validation.errors[0].code);}
  check(packet.operation===OP,'INVALID_SCOPE');let receipt=null,start=null;
  try{const x=packet.input;start=this.#caller(token,'publish',x.sourceRefs.map(s=>s.sourceId));const current=this.#store.read();
   const published=proof(current,start.registry),existing=[...current.records.values()].find(r=>r.kind==='store-receipt'&&r.value.principal===start.id&&r.value.operation===OP&&r.value.key===packet.key);
   if(existing){check(published,'EVIDENCE_MISMATCH');const owner=heads(current).find(h=>h.value.receipts.some(r=>same(r,existing.reference)));
    const oldView=this.#store.read({atHead:owner.reference}),prior=proof(oldView,start.registry);
    check(prior&&same(prior.receipt,existing.reference)&&equal(prior.packet,packet),'IDEMPOTENCY_CONFLICT');
    this.#current(token,'publish',start,x.sourceRefs.map(s=>s.sourceId));check(same(this.#store.read().reference,current.reference),'HEAD_CHANGED');
    return result(packet,prior.receipt,prior.reference);
   }
   check(same(current.reference,packet.expected.domainHead),'REVISION_CONFLICT');const rev=published?.record.revision??0;
   const valid=validateCommand(packet,{authenticatedCaller:'human',currentHead:current.reference,currentRevision:rev});check(valid.ok,valid.errors[0]?.code??'INVALID_VALUE');
   check(x.workspaceId===this.#store.marker.workspaceId,'INVALID_SCOPE');
   const sources=this.#sources(token,start,x.sourceRefs,'new','publish',current.reference);check(sources.length===x.sourceRefs.length,'EVIDENCE_MISMATCH');
   check(same(x.humanActionReceipt,businessDecisionActionReference({workspaceId:x.workspaceId,principalId:start.id,packet})),'EVIDENCE_MISMATCH');
   const intent=reserveIntent(this.#file,start.policy,packet),ev=eventFor(x.workspaceId,start.id,packet),a=this.#registry();
   const audit={schemaVersion:'3djat.evidence.v1',id:ev.id,revision:1,description:stable({format:'3djat.business-action.v1',role:'human',event:ev,mac:signAction(a,'human',ev)})};
   const evidence=prepareRecord('evidence',audit),decision={schemaVersion:'3djat.business-decision.v1',decisionId:ev.id,revision:1,workspaceId:x.workspaceId,
    expectedRevision:rev,action:'approve',instructionsSha256:instructionHash(x),sourceRefs:x.sourceRefs,decidedAt:x.decidedAt,humanActionReceipt:x.humanActionReceipt};
   const decisionRef=prepareRecord('business-decision',decision).reference,context={schemaVersion:'3djat.business-context.v1',workspaceId:x.workspaceId,revision:x.revision,
    instructions:x.instructions,sourceRefs:x.sourceRefs,decision:decisionRef,sourceReceipt:evidence.reference};
   const plan={principal:start.id,operation:OP,key:packet.key,expectedHead:current.reference,
    records:[{kind:'evidence',record:audit},{kind:'business-decision',record:decision}],
    changes:[{kind:'business-context',id:x.workspaceId,expectedRevision:rev,record:context}]};
   const fence=()=>{this.#current(token,'publish',start,x.sourceRefs.map(s=>s.sourceId));check(same(this.#store.read().reference,current.reference),'HEAD_CHANGED');this.#sources(token,start,x.sourceRefs,'new','publish',current.reference);};
   this.#hook('before-publication',{});fence();this.#store.hook=(stage,detail)=>{this.#hook(stage,detail);if(stage==='locked'||stage==='before-replace')fence();};
   const commit=this.#store.commit(plan);receipt=commit.receipt;const committed=this.#store.read();const proven=proof(committed,this.#registry());
   check(proven&&same(proven.receipt,receipt)&&equal(proven.packet,packet),'EVIDENCE_MISMATCH');
   this.#hook('after-domain-commit',{receipt});this.#current(token,'publish',start,x.sourceRefs.map(s=>s.sourceId));
   check(same(this.#store.read().reference,committed.reference),'HEAD_CHANGED');this.#hook('before-response',{receipt});
   this.#current(token,'publish',start,x.sourceRefs.map(s=>s.sourceId));check(same(this.#store.read().reference,committed.reference),'HEAD_CHANGED');
   return result(packet,receipt,proven.reference);
  }catch(e){let disclosed=null;
   if(receipt&&start)try{const current=this.#current(token,'publish',start,packet.input.sourceRefs.map(s=>s.sourceId));
    const now=this.#store.read(),owned=proof(now,current.registry),row=now.records.get(receipt.path);
    if(row?.kind==='store-receipt'&&same(row.reference,receipt)&&row.value.principal===start.id&&row.value.operation===OP&&
      row.value.key===packet.key&&owned&&same(owned.receipt,receipt)&&equal(owned.packet,packet))disclosed=receipt;}catch{}
   return failure(packet,e,disclosed);}
  finally{this.#store.hook=()=>{};}
 }
}
