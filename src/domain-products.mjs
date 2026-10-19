// Narrow semantic product writer. No BVE, server or SQLite dependency.
import * as fs from 'node:fs';
import * as path from 'node:path';
import {createHash,createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import {DomainStore,prepareRecord,StoreError,STORE_LIMITS} from './domain-store.mjs';
import {validate,validateCommand,COMMANDS,ERROR_CODES} from './contracts/3djat.mjs';
import {AttachmentFiles} from './attachment-files.mjs';
const OPS=new Set(['product.create','product.read','product.proposal.submit','product.proposal.decide','product.note.add','attachment.register']);
const stable=x=>JSON.stringify(x,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const digest=x=>createHash('sha256').update(x).digest('hex');
const uuid=x=>{const h=digest(x);return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`;};
const bytes=x=>Buffer.from(stable(x)+'\n');
const equal=(a,b)=>stable(a)===stable(b);
const same=(a,b)=>a?.id===b?.id&&a?.revision===b?.revision&&a?.sha256===b?.sha256&&a?.path===b?.path;
const fail=(code,detail={})=>{throw new StoreError(code,detail);};
const check=(ok,code,detail)=>{if(!ok)fail(code,detail);};
const shape=(kind,v)=>{const r=validate(kind,v);if(!r.ok)fail(r.errors[0].code,{errors:r.errors});};
const exact=(v,keys)=>check(v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k)),'INVALID_VALUE');
const within=(a,b)=>{const r=path.relative(a,b);return r===''||r!=='..'&&!r.startsWith('..'+path.sep)&&!path.isAbsolute(r);};
function safePrivate(file,{missing=false}={}){
  check(typeof file==='string'&&path.isAbsolute(file)&&!file.startsWith('\\\\')&&!file.startsWith('//'),'UNSAFE_PATH');
  const full=path.resolve(file),parts=full.slice(path.parse(full).root.length).split(path.sep);let current=path.parse(full).root;
  for(let i=0;i<parts.length;i++){
    current=path.join(current,parts[i]);let s;try{s=fs.lstatSync(current);}catch(e){if(e.code==='ENOENT'&&missing&&i===parts.length-1)return full;throw e;}
    check(!s.isSymbolicLink()&&fs.readdirSync(path.dirname(current)).includes(parts[i]),'UNSAFE_PATH');
    check(i===parts.length-1?s.isFile()&&s.nlink===1:s.isDirectory(),'UNSAFE_PATH');
  }return full;
}
function syncDir(dir){let fd;try{fd=fs.openSync(dir,'r');fs.fsyncSync(fd);}catch(e){if(!(process.platform==='win32'&&['EPERM','EACCES','EINVAL','EISDIR','ENOTSUP'].includes(e.code)))throw e;}finally{if(fd!==undefined)fs.closeSync(fd);}}
function privateRead(file){safePrivate(file);check(fs.statSync(file).size<=65536,'VALIDATION_LIMIT');const b=fs.readFileSync(file);check(b.length<=65536,'VALIDATION_LIMIT');try{return JSON.parse(b);}catch{fail('INVALID_VALUE');}}
function exclusive(file,value){const b=bytes(value);check(b.length<=65536,'VALIDATION_LIMIT');const fd=fs.openSync(safePrivate(file,{missing:true}),'wx',0o600);try{fs.writeFileSync(fd,b);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}syncDir(path.dirname(file));}
function access(file){const a=privateRead(file);exact(a,['schemaVersion','workspaceId','key','principals']);check(a.schemaVersion==='3djat.product-access.v1'&&/^[0-9a-f]{64}$/.test(a.key)&&Array.isArray(a.principals)&&a.principals.length<=32,'INVALID_VALUE');
  for(const p of a.principals){exact(p,['id','role','tokenHash','products','sourceIds']);check(['human','source-proposer','conductor'].includes(p.role)&&/^[0-9a-f]{64}$/.test(p.tokenHash),'INVALID_SCOPE');shape('revision-ref',{id:p.id,revision:1,path:'principal.json',sha256:p.tokenHash});check((p.products==='*'||Array.isArray(p.products)&&p.products.length<=256)&&Array.isArray(p.sourceIds)&&p.sourceIds.length<=32,'INVALID_VALUE');}
  check(new Set(a.principals.map(p=>p.id)).size===a.principals.length,'INVALID_VALUE');return a;
}
// Trusted local provisioning only; never exposed by an HTTP endpoint.
export function provisionProductPrincipal(file,{workspaceId,id,role,products='*',sourceIds=[]}){
  shape('revision-ref',{id,revision:1,path:'principal.json',sha256:'0'.repeat(64)});check(['human','source-proposer','conductor'].includes(role),'INVALID_SCOPE');
  shape('command',{schemaVersion:'3djat.command.v1',operation:'product.create',key:'scope-check',expected:{domainHead:{id:workspaceId,revision:1,path:'head.json',sha256:'0'.repeat(64)},entityRevision:0},input:{productId:workspaceId,workingName:'Scope check',productCode:null}});
  check((products==='*'||Array.isArray(products)&&products.length<=256)&&Array.isArray(sourceIds)&&sourceIds.length<=32,'INVALID_VALUE');
  if(products!=='*')for(const productId of products)shape('command',{schemaVersion:'3djat.command.v1',operation:'product.create',key:'scope',expected:{domainHead:{id:workspaceId,revision:1,path:'head.json',sha256:'0'.repeat(64)},entityRevision:0},input:{productId,workingName:'Scope',productCode:null}});
  for(const sourceId of sourceIds)shape('revision-ref',{id:sourceId,revision:1,path:'source.json',sha256:'0'.repeat(64)});
  const token=randomBytes(32).toString('hex'),p={id,role,products,sourceIds,tokenHash:digest(token)};
  if(!fs.existsSync(file)){exclusive(file,{schemaVersion:'3djat.product-access.v1',workspaceId,key:randomBytes(32).toString('hex'),principals:[p]});}
  else{const a=access(file);check(a.workspaceId===workspaceId&&!a.principals.some(x=>x.id===id)&&a.principals.length<32,'INVALID_SCOPE');a.principals.push(p);
    const tmp=file+'.'+randomBytes(8).toString('hex');exclusive(tmp,a);safePrivate(file);fs.renameSync(tmp,file);syncDir(path.dirname(file));}
  return {principalId:id,role,token};
}
function actionEvent(workspaceId,principalId,packet,time){
  const input=structuredClone(packet.input);if(packet.operation==='product.proposal.decide')delete input.humanActionReceipt;
  const commandHash=digest(stable({...packet,input}));
  return {id:uuid(stable([workspaceId,principalId,packet.operation,packet.key])),version:1,type:'product-action',workspaceId,principalId,operation:packet.operation,key:packet.key,productId:packet.input.productId,commandHash,recordedAt:packet.input.decidedAt??time};
}
const eventRef=event=>({id:event.id,revision:1,path:`Operational/event/${event.id}.json`,sha256:digest(stable(event))});
// Public bytes helper, NOT authorization. The actual bearer is checked by command().
export function decisionActionReference({workspaceId,principalId,packet}){
  check(packet?.operation==='product.proposal.decide','INVALID_SCOPE');return eventRef(actionEvent(workspaceId,principalId,packet,packet.input.decidedAt));
}
function published(view,kind){const found=new Map();const heads=[...view.records.values()].filter(x=>x.kind==='domain-head').sort((a,b)=>a.value.revision-b.value.revision);
  for(const h of heads)for(const ref of h.value.receipts){const receipt=view.records.get(ref.path);for(const r of receipt.value.records){const row=view.records.get(r.path);if(row.kind===kind&&!found.has(r.path))found.set(r.path,{...row,publication:h.reference,receipt:receipt.reference,storeReceipt:receipt.value});}}
  return [...found.values()];
}
function productAt(view,id){const ref=view.head.products.find(x=>x.productId===id)?.dossier;check(ref,'MISSING_SOURCE');return view.records.get(ref.path);}
function resolved(view,ref,kind){shape('revision-ref',ref);const row=view.records.get(ref.path);check(row&&row.kind===kind&&same(row.reference,ref),'EVIDENCE_MISMATCH');return row;}
export function readProductDossier(root,{productId,atHead=null}){const view=new DomainStore(root).read({atHead});const p=productAt(view,productId);return {head:view.reference,product:{reference:p.reference,record:p.value}};}
export class DomainProducts {
  #store; #file; #auth; #beforePublish; #hook; #attachments;
  constructor(root,{accessFile,authenticate=null,beforePublish=()=>{},hook=()=>{},attachmentSources={}}){
    this.#store=new DomainStore(root);this.#file=safePrivate(accessFile);check(!within(this.#store.root,this.#file)&&!within(this.#file+'.intents',this.#store.root),'UNSAFE_PATH');
    this.#auth=authenticate;this.#beforePublish=beforePublish;this.#hook=hook;this.#registry();
    this.#attachments=new AttachmentFiles(this.#store,{sources:attachmentSources,hook,privatePaths:[this.#file,this.#file+'.intents']});
  }
  #registry(){const a=access(this.#file);check(a.workspaceId===this.#store.marker.workspaceId,'INVALID_SCOPE');return a;}
  #principal(token,operation,productId){
    const a=this.#registry();let p=this.#auth?.(token)??null;
    if(!p){check(typeof token==='string'&&/^[0-9a-f]{64}$/.test(token),'INVALID_SCOPE');const h=Buffer.from(digest(token));p=a.principals.find(x=>timingSafeEqual(Buffer.from(x.tokenHash),h));}
    check(p&&(!productId||p.products==='*'||p.products.includes(productId)),'INVALID_SCOPE');
    const caller=p.role==='source-proposer'&&operation==='product.read'?'source-reader':p.role;
    check(COMMANDS[operation]?.callers.includes(caller),'INVALID_SCOPE');return {...p,caller};
  }
  #intent(p,packet){const dir=this.#file+'.intents';if(!fs.existsSync(dir)){fs.mkdirSync(dir,{mode:0o700});syncDir(path.dirname(dir));}
    const stat=fs.lstatSync(dir);check(stat.isDirectory()&&!stat.isSymbolicLink(),'UNSAFE_PATH');check(fs.readdirSync(dir).length<=512,'VALIDATION_LIMIT');
    const filename=path.join(dir,digest(stable([p.id,packet.operation,packet.key]))+'.json'),payloadHash=digest(stable(packet));
    try{exclusive(filename,{payloadHash,createdAt:new Date().toISOString()});}catch(e){if(e.code!=='EEXIST')throw e;}
    const i=privateRead(filename);exact(i,['payloadHash','createdAt']);check(i.payloadHash===payloadHash,'IDEMPOTENCY_CONFLICT');return i;
  }
  #audit(p,packet,intent){const event=actionEvent(this.#store.marker.workspaceId,p.id,packet,intent.createdAt),a=this.#registry();
    const value={format:'3djat.product-action.v1',role:p.role,event,mac:createHmac('sha256',a.key).update(stable({role:p.role,event})).digest('hex')};
    return {event,ref:eventRef(event),record:{schemaVersion:'3djat.evidence.v1',id:event.id,revision:1,description:stable(value)}};
  }
  #auditFor(row,view){
    const candidates=row.storeReceipt.records.map(r=>view.records.get(r.path)).filter(r=>r.kind==='evidence');
    for(const x of candidates){let a;try{a=JSON.parse(x.value.description);}catch{continue;}if(a.format!=='3djat.product-action.v1')continue;
      const expected=createHmac('sha256',this.#registry().key).update(stable({role:a.role,event:a.event})).digest('hex');
      check(typeof a.mac==='string'&&/^[0-9a-f]{64}$/.test(a.mac)&&timingSafeEqual(Buffer.from(a.mac),Buffer.from(expected)),'EVIDENCE_MISMATCH');
      check(a.event.workspaceId===this.#store.marker.workspaceId&&a.event.principalId===row.storeReceipt.principal&&a.event.operation===row.storeReceipt.operation&&a.event.key===row.storeReceipt.key&&a.event.productId===row.value.productId,'EVIDENCE_MISMATCH');
      if(['proposal','proposal-decision','attachment'].includes(row.kind)){
        const packet={schemaVersion:'3djat.command.v1',operation:row.storeReceipt.operation,key:row.storeReceipt.key,expected:{domainHead:row.storeReceipt.previousHead,entityRevision:row.kind==='attachment'?0:row.value.expectedRevision},input:row.value};
        check(actionEvent(this.#store.marker.workspaceId,a.event.principalId,packet,a.event.recordedAt).commandHash===a.event.commandHash,'EVIDENCE_MISMATCH');
        if(row.kind==='proposal-decision')check(same(row.value.humanActionReceipt,eventRef(a.event)),'EVIDENCE_MISMATCH');
      }return a;
    }fail('EVIDENCE_MISMATCH');
  }
  operationalEvidence(){const view=this.#store.read(),events=new Map();for(const kind of ['proposal','proposal-decision','product','attachment'])for(const row of published(view,kind)){
    if(!OPS.has(row.storeReceipt.operation))continue;const a=this.#auditFor(row,view);events.set(a.event.id,a.event);
  }return [...events.values()];}
  #sourceStatus(s){try{if(s.kind!=='file')return {source:s,status:'unresolved',cause:'remote-source-unavailable'};
    const b=this.#store.readFile(s.location),verified=digest(b)===s.sha256;return {source:s,status:verified?'verified':'unresolved',cause:verified?null:'HASH_MISMATCH'};
  }catch(e){if(['ROOT_CHANGED','UNSAFE_PATH','PATH_CASE_MISMATCH'].includes(e.code))throw e;return {source:s,status:'unresolved',cause:e.code??'MISSING_SOURCE'};}}
  #history(view,productId){const proposals=published(view,'proposal').filter(x=>x.value.productId===productId),decisions=published(view,'proposal-decision').filter(x=>x.value.productId===productId);
    check(proposals.length<=128&&decisions.length<=256,'VALIDATION_LIMIT');const active=new Map();
    for(const d of decisions){check(this.#auditFor(d,view).role==='human','INVALID_SCOPE');const prior=active.get(d.value.proposal.id);check(prior?same(prior.reference,d.value.supersedesDecision):d.value.supersedesDecision===null,'EVIDENCE_MISMATCH');active.set(d.value.proposal.id,d);}
    return {proposals,decisions,active};
  }
  readReview(token,query){exact(query,['productId','atHead']);const p=this.#principal(token,'product.read',query.productId);shape('revision-ref',query.atHead);
    const view=this.#store.read({atHead:query.atHead}),product=productAt(view,query.productId),h=this.#history(view,query.productId);
    const packet={schemaVersion:'3djat.command.v1',operation:'product.read',key:'review',expected:{domainHead:query.atHead,entityRevision:product.value.revision},input:{productId:query.productId,atHead:query.atHead}};
    const v=validateCommand(packet,{authenticatedCaller:p.caller,currentHead:view.reference,currentRevision:product.value.revision,projectId:query.productId});check(v.ok,v.errors[0]?.code??'INVALID_SCOPE');
    const attachments=this.#attachments.availability(product.value.attachments.map(ref=>{
      const row=resolved(view,ref,'attachment');check(row.value.productId===query.productId,'INVALID_SCOPE');return {reference:row.reference,record:row.value};
    }));
    return {head:view.reference,product:{reference:product.reference,record:product.value},proposals:h.proposals.map(x=>({reference:x.reference,record:x.value,status:h.active.get(x.value.proposalId)?.value.outcome??'pending',sources:x.value.changes.flatMap(c=>c.fact.sourceRefs.map(s=>this.#sourceStatus(s)))})),decisions:h.decisions.map(x=>({reference:x.reference,record:x.value})),attachments,authority:'domain-files'};
  }
  #result(packet,commit,view){const type=COMMANDS[packet.operation].output,ref=type==='attachment'?commit.records.find(r=>r.id===packet.input.attachmentId&&view.records.get(r.path)?.kind==='attachment'):type==='proposal'?commit.records.find(r=>r.id===packet.input.proposalId):view.head.products.find(x=>x.productId===packet.input.productId)?.dossier;
    check(ref,'EVIDENCE_MISMATCH');const value={schemaVersion:'3djat.result.v1',operation:packet.operation,key:packet.key,receipt:commit.reference,owner:'domain',committedRevision:ref.revision,outputType:type,reference:ref};shape('result',value);return value;}
  static failure(packet,e,receipt=null){let code=ERROR_CODES.includes(e.code)?e.code:['ROOT_CHANGED','STORE_CHANGED','PATH_CASE_MISMATCH'].includes(e.code)?'UNSAFE_PATH':['ENOENT','MISSING_ROOT','MISSING_REFERENCE'].includes(e.code)?'MISSING_SOURCE':['COMMIT_UNCERTAIN','ACK_PENDING','REPLY_UNCERTAIN'].includes(e.code)?'EXPORT_PENDING':'CAPABILITY_UNAVAILABLE';
    if(receipt&&!ERROR_CODES.includes(e.code)&&!['ROOT_CHANGED','STORE_CHANGED','PATH_CASE_MISMATCH'].includes(e.code))code='EXPORT_PENDING';
    const value={schemaVersion:'3djat.failure.v1',operation:packet.operation,key:packet.key,error:{code,path:'$',recoverability:code==='REVISION_CONFLICT'?'refresh':code==='MISSING_SOURCE'?'supply-source':code==='EXPORT_PENDING'?'manual-review':'correct-input',message:code==='EXPORT_PENDING'?'Domain publication or acknowledgement pending; reconcile the original key.':code,evidence:receipt}};shape('failure',value);return value;}
  failure(...args){return DomainProducts.failure(...args);}
  command(token,packet){
    const checked=validate('command',packet);if(!checked.ok){const operation=Object.getOwnPropertyDescriptor(packet??{},'operation')?.value,key=Object.getOwnPropertyDescriptor(packet??{},'key')?.value;
      const error=new StoreError(checked.errors[0].code,{errors:checked.errors});if(OPS.has(operation)&&validate('revision-ref',{id:key,revision:1,path:'key.json',sha256:'0'.repeat(64)}).ok)return this.failure({operation,key},error);throw error;}
    check(OPS.has(packet.operation),'INVALID_SCOPE');let receipt=null;
    try{const p=this.#principal(token,packet.operation,packet.input.productId),a=validateCommand(packet,{authenticatedCaller:p.caller,projectId:packet.input.productId});check(a.ok,a.errors[0]?.code);
      const current=this.#store.read();
      const attaching=packet.operation==='attachment.register';
      if(attaching)this.#attachments.authorize(packet.input); // Current source policy also gates committed replay; no source-byte reread.
      const existing=[...current.records.values()].find(x=>x.kind==='store-receipt'&&x.value.principal===p.id&&x.value.operation===packet.operation&&x.value.key===packet.key);
      if(packet.operation==='product.read'){
        const view=this.#store.read({atHead:packet.input.atHead}),product=productAt(view,packet.input.productId);const v=validateCommand(packet,{authenticatedCaller:p.caller,currentHead:view.reference,currentRevision:product.value.revision,projectId:packet.input.productId});check(v.ok,v.errors[0]?.code);
        const publication=published(view,'product').find(x=>same(x.reference,product.reference));check(publication,'EVIDENCE_MISMATCH');return this.#result(packet,{reference:publication.receipt,records:[]},view);
      }
      const intent=this.#intent(p,packet);
      if(existing){receipt=existing.reference;const owner=[...current.records.values()].find(x=>x.kind==='domain-head'&&x.value.receipts.some(r=>same(r,receipt)));const view=this.#store.read({atHead:owner.reference});
        const audit=view.records.get(existing.value.records.find(r=>view.records.get(r.path)?.kind==='evidence'&&r.id===uuid(stable([this.#store.marker.workspaceId,p.id,packet.operation,packet.key])))?.path);check(audit&&JSON.parse(audit.value.description).event.commandHash===actionEvent(this.#store.marker.workspaceId,p.id,packet,intent.createdAt).commandHash,'IDEMPOTENCY_CONFLICT');
        const kind=attaching?'attachment':packet.operation==='product.proposal.decide'?'proposal-decision':packet.operation==='product.proposal.submit'?'proposal':'product',row=published(view,kind).find(r=>same(r.receipt,receipt));check(row,'EVIDENCE_MISMATCH');this.#auditFor(row,view);
        const result=this.#result(packet,{...existing.value,reference:receipt},view);this.#hook('before-response',{result});return result;
      }
      const view=this.#store.read({atHead:packet.expected.domainHead}),product=packet.operation==='product.create'?null:productAt(view,packet.input.productId),context={authenticatedCaller:p.caller,currentHead:view.reference,currentRevision:product?.value.revision??0,projectId:packet.input.productId,skus:view.head.skus};
      if(attaching){context.currentRevision=published(view,'attachment').some(r=>r.value.attachmentId===packet.input.attachmentId)?1:0;check(context.currentRevision===0,'IDEMPOTENCY_CONFLICT');}
      if(packet.operation==='product.create')check(!view.head.products.some(x=>x.productId===packet.input.productId),'REVISION_CONFLICT');
      const audit=this.#audit(p,packet,intent),auditRecord=prepareRecord('evidence',audit.record),records=[{kind:'evidence',record:audit.record}],changes=[];
      const update=value=>{shape('product',value);changes.push({kind:'product',id:value.productId,expectedRevision:product?.value.revision??0,record:value});};
      const x=packet.input,h=product?this.#history(view,x.productId):null;
      if(attaching){
        const attachment=prepareRecord('attachment',x),next=structuredClone(product.value);next.revision++;next.sourceReceipt=auditRecord.reference;next.attachments.push(attachment.reference);update(next);records.push({kind:'attachment',record:x});
      }else if(packet.operation==='product.create'){
        check(x.workingName.trim().length>0,'INVALID_VALUE');const unknown=()=>({state:'unknown',value:null,sourceRefs:[],decision:null});
        update({schemaVersion:'3djat.product.v1',productId:x.productId,revision:1,productCode:x.productCode,workingName:x.workingName,facts:{material:unknown(),dimensions:unknown(),sellingPrice:unknown()},designRevisions:[],productionRecords:[],finishingRecords:[],attachments:[],notes:x.note?[{id:uuid(audit.event.id+'note'),text:x.note,createdAt:intent.createdAt,receipt:auditRecord.reference}]:[],sourceReceipt:auditRecord.reference});
      }else if(packet.operation==='product.note.add'){const next=structuredClone(product.value);next.revision++;next.sourceReceipt=auditRecord.reference;next.notes.push({id:uuid(audit.event.id+'note'),text:x.text,createdAt:intent.createdAt,receipt:auditRecord.reference});update(next);
      }else if(packet.operation==='product.proposal.submit'){
        check(!published(view,'proposal').some(v=>v.value.proposalId===x.proposalId),'IDEMPOTENCY_CONFLICT');
        if(p.role==='source-proposer')for(const c of x.changes)for(const s of c.fact.sourceRefs)check(p.sourceIds.includes(s.sourceId),'INVALID_SCOPE');
        if(x.corrects){const original=resolved(view,x.corrects,'proposal');check(original.value.productId===x.productId,'EVIDENCE_MISMATCH');this.#correctionSources(original.value,x);}
        records.push({kind:'proposal',record:x});
      }else if(packet.operation==='product.proposal.decide'){
        check(!published(view,'proposal-decision').some(v=>v.value.decisionId===x.decisionId),'IDEMPOTENCY_CONFLICT');
        const original=resolved(view,x.proposal,'proposal'),origin=h.proposals.find(v=>same(v.reference,x.proposal));check(origin,'EVIDENCE_MISMATCH');this.#auditFor(origin,view);
        context.proposal={reference:original.reference,record:original.value};const active=h.active.get(original.value.proposalId);
        check(active?(x.outcome==='superseded'&&x.correctedProposal&&active.value.outcome!=='superseded'&&same(active.reference,x.supersedesDecision)):x.supersedesDecision===null,'EVIDENCE_MISMATCH');
        if(active){const authority=this.#auditFor(active,view);check(authority.role==='human','INVALID_SCOPE');}
        if(x.correctedProposal){const corrected=resolved(view,x.correctedProposal,'proposal'),origin=h.proposals.find(v=>same(v.reference,x.correctedProposal));check(origin&&!h.active.has(corrected.value.proposalId),'EVIDENCE_MISMATCH');this.#auditFor(origin,view);this.#correctionSources(original.value,corrected.value);context.correctedProposal={reference:corrected.reference,record:corrected.value};records.push({kind:'proposal',record:corrected.value});}
        check(same(x.humanActionReceipt,audit.ref),'EVIDENCE_MISMATCH');
        if(x.outcome==='accepted'){
          if(original.value.corrects){const d=h.active.get(original.value.corrects.id);check(d?.value.outcome==='superseded'&&same(d.value.correctedProposal,original.reference)&&same(d.value.proposal,original.value.corrects),'EVIDENCE_MISMATCH');check(this.#auditFor(d,view).role==='human','INVALID_SCOPE');}
          for(const c of original.value.changes)for(const s of c.fact.sourceRefs)check(this.#sourceStatus(s).status==='verified','MISSING_SOURCE');
          const ref=prepareRecord('proposal-decision',x).reference,next=structuredClone(product.value);next.revision++;next.sourceReceipt=auditRecord.reference;
          for(const c of original.value.changes){if(['workingName','productCode'].includes(c.field)){if(c.field==='workingName')check(c.fact.state==='accepted'&&c.fact.value.trim().length>0,'INVALID_VALUE');next[c.field]=c.fact.state==='accepted'?c.fact.value:null;}else next.facts[c.field]={...structuredClone(c.fact),decision:c.fact.state==='unknown'?null:ref};}update(next);
        }records.push({kind:'proposal-decision',record:x});
      }
      const valid=validateCommand(packet,context);check(valid.ok,valid.errors[0]?.code,{errors:valid.errors});
      let attachmentProof=null;
      this.#hook('before-publication',{});this.#store.hook=(stage,detail)=>{if(stage==='locked'){
        const locked=this.#store.read();check(same(locked.reference,view.reference),'REVISION_CONFLICT');const caller=this.#principal(token,packet.operation,x.productId);check(caller.id===p.id&&caller.role===p.role,'INVALID_SCOPE');
        const v=validateCommand(packet,context);check(v.ok,v.errors[0]?.code);
        if(packet.operation==='product.proposal.decide'&&x.outcome==='accepted')for(const c of context.proposal.record.changes)for(const s of c.fact.sourceRefs)check(this.#sourceStatus(s).status==='verified','MISSING_SOURCE');
        this.#beforePublish(audit.event);
      }this.#hook(stage,detail);
        if(attaching&&(stage==='locked'||stage==='before-replace')){
          const caller=this.#principal(token,packet.operation,x.productId);check(caller.id===p.id&&caller.role===p.role,'INVALID_SCOPE');this.#attachments.authorize(x);
          if(stage==='locked')attachmentProof=this.#attachments.capture(x,view);else attachmentProof();
        }
      };
      const commit=this.#store.commit({principal:p.id,operation:packet.operation,key:packet.key,expectedHead:packet.expected.domainHead,changes,records});receipt=commit.receipt;
      const committed=this.#store.read({atHead:commit.head}),result=this.#result(packet,{reference:receipt,records:committed.records.get(receipt.path).value.records},committed);
      this.#hook('after-domain-commit',{result});this.#hook('before-response',{result});return result;
    }catch(e){return this.failure(packet,e,receipt);}finally{this.#store.hook=()=>{};}
  }
  #correctionSources(original,corrected){check(original.productId===corrected.productId&&same(corrected.corrects,prepareRecord('proposal',original).reference),'EVIDENCE_MISMATCH');
    check(equal(original.changes.map(c=>c.field).sort(),corrected.changes.map(c=>c.field).sort()),'EVIDENCE_MISMATCH');for(const c of corrected.changes){const old=original.changes.find(x=>x.field===c.field);for(const s of c.fact.sourceRefs)check(old.fact.sourceRefs.some(x=>equal(x,s)),'EVIDENCE_MISMATCH');}}
}
