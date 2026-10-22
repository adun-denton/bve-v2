// Narrow semantic product writer. No BVE, server or SQLite dependency.
import * as fs from 'node:fs';
import * as path from 'node:path';
import {createHash,createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import {DomainStore,prepareRecord,StoreError,STORE_LIMITS} from './domain-store.mjs';
import {validate,validateCommand,COMMANDS,ERROR_CODES} from './contracts/3djat.mjs';
import {AttachmentFiles} from './attachment-files.mjs';
const OPS=new Set(['product.create','product.read','product.proposal.submit','product.proposal.decide','product.note.add','attachment.register','product.dossier.proposal.submit','product.dossier.proposal.decide']);
import {stable,digest,uuid,bytes,equal,same,fail,check,shape,exact,within,safePrivate,syncDir,privateRead,exclusive,access,reserveIntent,findBearer,signAction} from './domain-authority.mjs';
// Trusted local provisioning only; never exposed by an HTTP endpoint.
export function provisionProductPrincipal(file,{workspaceId,id,role,products='*',sourceIds=[]}){
  shape('revision-ref',{id,revision:1,path:'principal.json',sha256:'0'.repeat(64)});check(['human','source-proposer','conductor'].includes(role),'INVALID_SCOPE');
  shape('command',{schemaVersion:'3djat.command.v1',operation:'product.create',key:'scope-check',expected:{domainHead:{id:workspaceId,revision:1,path:'head.json',sha256:'0'.repeat(64)},entityRevision:0},input:{productId:workspaceId,workingName:'Scope check',productCode:null}});
  check((products==='*'||Array.isArray(products)&&products.length<=256)&&Array.isArray(sourceIds)&&sourceIds.length<=32,'INVALID_VALUE');
  if(products!=='*')for(const productId of products)shape('command',{schemaVersion:'3djat.command.v1',operation:'product.create',key:'scope',expected:{domainHead:{id:workspaceId,revision:1,path:'head.json',sha256:'0'.repeat(64)},entityRevision:0},input:{productId,workingName:'Scope',productCode:null}});
  for(const sourceId of sourceIds)shape('revision-ref',{id:sourceId,revision:1,path:'source.json',sha256:'0'.repeat(64)});
  const token=randomBytes(32).toString('hex'),p={id,role,products,sourceIds,tokenHash:digest(token)};
  if(!fs.existsSync(file)){exclusive(file,{schemaVersion:'3djat.product-access.v1',workspaceId,key:randomBytes(32).toString('hex'),principals:[p]});}
  else{const a=access(file);check(a.workspaceId===workspaceId&&!a.principals.some(x=>x.id===id)&&a.principals.length<32,'INVALID_SCOPE');if(a.schemaVersion==='3djat.product-access.v2')p.templateGrant=null;a.principals.push(p);
    const tmp=file+'.'+randomBytes(8).toString('hex');exclusive(tmp,a);safePrivate(file);fs.renameSync(tmp,file);syncDir(path.dirname(file));}
  return {principalId:id,role,token};
}
function actionEvent(workspaceId,principalId,packet,time){
  const input=structuredClone(packet.input);if(['product.proposal.decide','product.dossier.proposal.decide'].includes(packet.operation))delete input.humanActionReceipt;
  const commandHash=digest(stable({...packet,input}));
  return {id:uuid(stable([workspaceId,principalId,packet.operation,packet.key])),version:1,type:'product-action',workspaceId,principalId,operation:packet.operation,key:packet.key,productId:packet.input.productId,commandHash,recordedAt:packet.input.decidedAt??time};
}
const eventRef=event=>({id:event.id,revision:1,path:`Operational/event/${event.id}.json`,sha256:digest(stable(event))});
// Public bytes helper, NOT authorization. The actual bearer is checked by command().
export function decisionActionReference({workspaceId,principalId,packet}){
  check(['product.proposal.decide','product.dossier.proposal.decide'].includes(packet?.operation),'INVALID_SCOPE');return eventRef(actionEvent(workspaceId,principalId,packet,packet.input.decidedAt));
}
function published(view,kind){const found=new Map();const heads=[...view.records.values()].filter(x=>x.kind==='domain-head').sort((a,b)=>a.value.revision-b.value.revision);
  for(const h of heads)for(const ref of h.value.receipts){const receipt=view.records.get(ref.path);for(const r of receipt.value.records){const row=view.records.get(r.path);if(row.kind===kind&&!found.has(r.path))found.set(r.path,{...row,publication:h.reference,receipt:receipt.reference,storeReceipt:receipt.value});}}
  return [...found.values()];
}
function productAt(view,id){const ref=view.head.products.find(x=>x.productId===id)?.dossier;check(ref,'MISSING_SOURCE');return view.records.get(ref.path);}
function resolved(view,ref,kind){shape('revision-ref',ref);const row=view.records.get(ref.path);check(row&&row.kind===kind&&same(row.reference,ref),'EVIDENCE_MISMATCH');return row;}
const DOSSIER_SUBMIT='product.dossier.proposal.submit',DOSSIER_DECIDE='product.dossier.proposal.decide';
const sourcesOf=x=>x.kind==='field'?x.fact.sourceRefs:x.sourceRefs;
const subject=x=>x.kind==='field'?'field:'+x.field:'entry:'+x.entryId;
const subjectOfDossier=subject;
const sameSubject=(a,b)=>a.kind===b.kind&&(a.kind==='field'?a.field===b.field:a.entryId===b.entryId&&a.entryKind===b.entryKind&&a.entryType===b.entryType);
const sameNullable=(a,b)=>a===null?b===null:b!==null&&same(a,b);
const entryArray=kind=>({design:'designRevisions',production:'productionRecords',finishing:'finishingRecords'})[kind];
function dossierTarget(x,h){const current=h.current.get(subject(x.payload));check(sameNullable(x.replaces,current?.reference??null),'EVIDENCE_MISMATCH');if(current)check(sameSubject(current.value.payload,x.payload),'EVIDENCE_MISMATCH');}
function sourceStatus(store,s){try{if(s.kind!=='file')return {source:s,status:'unresolved',cause:'remote-source-unavailable'};
  const verified=digest(store.readFile(s.location))===s.sha256;return {source:s,status:verified?'verified':'unresolved',cause:verified?null:'HASH_MISMATCH'};
}catch(e){if(['ROOT_CHANGED','UNSAFE_PATH','PATH_CASE_MISMATCH'].includes(e.code))throw e;return {source:s,status:'unresolved',cause:e.code??'MISSING_SOURCE'};}}
function auditRow(row,view,registry=null){
  for(const x of row.storeReceipt.records.map(r=>view.records.get(r.path)).filter(r=>r.kind==='evidence')){
    let a;try{a=JSON.parse(x.value.description);}catch{continue;}if(a.format!=='3djat.product-action.v1')continue;
    check(a.event&&typeof a.event==='object'&&['human','conductor','source-proposer','butler'].includes(a.role),'EVIDENCE_MISMATCH');
    if(registry){const expected=createHmac('sha256',registry.key).update(stable({role:a.role,event:a.event})).digest('hex');
      check(typeof a.mac==='string'&&/^[0-9a-f]{64}$/.test(a.mac)&&timingSafeEqual(Buffer.from(a.mac),Buffer.from(expected)),'EVIDENCE_MISMATCH');}
    check(a.event.workspaceId===view.head.workspaceId&&a.event.principalId===row.storeReceipt.principal&&a.event.operation===row.storeReceipt.operation&&a.event.key===row.storeReceipt.key&&a.event.productId===row.value.productId,'EVIDENCE_MISMATCH');
    if(['proposal','proposal-decision','attachment','dossier-proposal','dossier-decision'].includes(row.kind)){
      const packet={schemaVersion:'3djat.command.v1',operation:row.storeReceipt.operation,key:row.storeReceipt.key,expected:{domainHead:row.storeReceipt.previousHead,entityRevision:row.kind==='attachment'?0:row.value.expectedRevision},input:row.value};
      check(actionEvent(view.head.workspaceId,a.event.principalId,packet,a.event.recordedAt).commandHash===a.event.commandHash,'EVIDENCE_MISMATCH');
      if(['proposal-decision','dossier-decision'].includes(row.kind))check(same(row.value.humanActionReceipt,eventRef(a.event)),'EVIDENCE_MISMATCH');
    }return {...a,reference:x.reference};
  }fail('EVIDENCE_MISMATCH');
}
// Opt-in exact product receipt audit. A Store closure proves the bytes and links;
// this reconstruction proves that the signed action produced this precise plan.
function baseReceipt(view,head,receipt,productId,registry,state,correctionSources,extended=false){
  const previous=view.records.get(head.previousHead.path).value;
  const before=previous.products.find(x=>x.productId===productId)?.dossier??null;
  const after=head.products.find(x=>x.productId===productId)?.dossier??null;
  const rows=receipt.records.map(r=>resolved(view,r,view.records.get(r.path)?.kind));
  const target=rows.some(r=>r.value?.productId===productId)||receipt.transitions.some(t=>t.kind==='product'&&t.id===productId);
  const evidence=rows.filter(r=>r.kind==='evidence');
  const claimed=evidence.some(r=>{try{return JSON.parse(r.value.description).event?.productId===productId;}catch{return false;}});
  if(!target&&!claimed){check(sameNullable(before,after),'EVIDENCE_MISMATCH');return;}
  if(!extended)check(!rows.some(r=>['attachment','dossier-proposal','dossier-decision','dossier-record'].includes(r.kind)&&r.value.productId===productId),'CAPABILITY_UNAVAILABLE');
  check(target&&evidence.length===1&&rows[0]===evidence[0]&&receipt.workspaceId===view.head.workspaceId,'EVIDENCE_MISMATCH');
  const operation=receipt.operation;
  check(['product.create','product.note.add','product.proposal.submit','product.proposal.decide',...(extended?['attachment.register',DOSSIER_SUBMIT,DOSSIER_DECIDE]:[])].includes(operation),'CAPABILITY_UNAVAILABLE');
  let a;try{a=JSON.parse(evidence[0].value.description);}catch{fail('EVIDENCE_MISMATCH');}
  exact(a,['format','role','event','mac']);check(a.format==='3djat.product-action.v1'&&a.event?.productId===productId,'EVIDENCE_MISMATCH');
  const roles={'product.create':['human'],'product.note.add':['human','conductor'],'product.proposal.submit':['human','conductor','source-proposer'],'product.proposal.decide':['human'],
    'attachment.register':['human','conductor'],[DOSSIER_SUBMIT]:['human','conductor','source-proposer'],[DOSSIER_DECIDE]:['human']};
  check(roles[operation].includes(a.role),'INVALID_SCOPE');
  check(typeof a.mac==='string'&&/^[0-9a-f]{64}$/.test(a.mac)&&a.mac===signAction(registry,a.role,a.event),'EVIDENCE_MISMATCH');
  // The signed event is historical authority. Validate its clock field before
  // using it to reconstruct a command or to compare an authored note.
  shape('note',{id:a.event.id,text:'event',createdAt:a.event.recordedAt,receipt:evidence[0].reference});
  check(receipt.principal===a.event.principalId&&evidence[0].value.revision===1&&evidence[0].reference.revision===1&&
    same(evidence[0].reference,prepareRecord('evidence',evidence[0].value).reference)&&evidence[0].value.id===a.event.id,'EVIDENCE_MISMATCH');
  const subject=rows.find(r=>({
    'product.create':'product','product.note.add':'product','product.proposal.submit':'proposal','product.proposal.decide':'proposal-decision',
    'attachment.register':'attachment',[DOSSIER_SUBMIT]:'dossier-proposal',[DOSSIER_DECIDE]:'dossier-decision'
  })[operation]===r.kind);
  check(subject&&subject.value.productId===productId,'EVIDENCE_MISMATCH');
  let input,revision=before?.revision??0,planned=[{kind:'evidence',reference:evidence[0].reference}],changed=null,next=null,dossierContext=null;
  const old=before?resolved(view,before,'product').value:null;
  if(operation==='product.create'){
    check(!before&&rows.length===2&&subject.value.revision===1,'REVISION_CONFLICT');
    const x=subject.value;check(x.notes.length<=1,'EVIDENCE_MISMATCH');
    input={productId,productCode:x.productCode,workingName:x.workingName,...(x.notes.length?{note:x.notes[0].text}:{})};
    const unknown=()=>({state:'unknown',value:null,sourceRefs:[],decision:null});
    next={schemaVersion:'3djat.product.v1',productId,revision:1,productCode:x.productCode,workingName:x.workingName,
      facts:{material:unknown(),dimensions:unknown(),sellingPrice:unknown()},designRevisions:[],productionRecords:[],finishingRecords:[],attachments:[],notes:x.notes,sourceReceipt:evidence[0].reference};
    changed=subject;
  }else{
    check(old&&state.product&&same(state.product.reference,before),'EVIDENCE_MISMATCH');
    if(operation==='product.note.add'){
      check(rows.length===2&&subject.value.notes.length===old.notes.length+1,'EVIDENCE_MISMATCH');
      const note=subject.value.notes.at(-1);input={productId,text:note.text};
      next=structuredClone(old);next.revision++;next.sourceReceipt=evidence[0].reference;next.notes.push(note);changed=subject;
    }else if(operation==='product.proposal.submit'){
      check(rows.length===2&&!state.proposals.has(subject.value.proposalId),'EVIDENCE_MISMATCH');
      input=subject.value;
      if(input.corrects){const prior=state.proposals.get(input.corrects.id);check(prior&&same(prior.reference,input.corrects),'EVIDENCE_MISMATCH');correctionSources(prior.value,input);}
      state.proposals.set(input.proposalId,subject);
    }else if(operation==='product.proposal.decide'){
      const x=subject.value;input=x;const original=state.proposals.get(x.proposal.id);
      check(original&&same(original.reference,x.proposal)&&original.value.productId===productId,'EVIDENCE_MISMATCH');
      const active=state.active.get(x.proposal.id),corrected=x.correctedProposal?state.proposals.get(x.correctedProposal.id):null;
      check(active?(x.outcome==='superseded'&&corrected&&active.value.outcome!=='superseded'&&same(active.reference,x.supersedesDecision)):x.supersedesDecision===null,'EVIDENCE_MISMATCH');
      if(corrected){check(same(corrected.reference,x.correctedProposal)&&!state.active.has(corrected.value.proposalId),'EVIDENCE_MISMATCH');correctionSources(original.value,corrected.value);
        planned.push({kind:'proposal',reference:corrected.reference});}
      if(x.outcome==='accepted'){
        if(original.value.corrects){const d=state.active.get(original.value.corrects.id);check(d?.value.outcome==='superseded'&&same(d.value.correctedProposal,original.reference)&&same(d.value.proposal,original.value.corrects),'EVIDENCE_MISMATCH');}
        next=structuredClone(old);next.revision++;next.sourceReceipt=evidence[0].reference;
        for(const c of original.value.changes){if(['workingName','productCode'].includes(c.field)){
          if(c.field==='workingName')check(c.fact.state==='accepted'&&c.fact.value.trim().length>0,'INVALID_VALUE');
          next[c.field]=c.fact.state==='accepted'?c.fact.value:null;state.metadata[c.field]=structuredClone(c.fact.sourceRefs);
        }else next.facts[c.field]={...structuredClone(c.fact),decision:c.fact.state==='unknown'?null:subject.reference};}
        changed=rows.find(r=>r.kind==='product'&&r.value.productId===productId);
        check(changed,'EVIDENCE_MISMATCH');
      }
      state.active.set(x.proposal.id,subject);
    }else if(operation==='attachment.register'){
      const x=subject.value;input=x;
      check(rows.length===3&&x.attachmentId===subject.reference.id&&!old.attachments.some(r=>same(r,subject.reference)),'EVIDENCE_MISMATCH');
      check(x.source.kind==='file'&&x.source.sha256===x.sha256&&x.availability==='available','EVIDENCE_MISMATCH');
      check(x.location===`${state.productsPath}/${productId}/Sources/${x.sha256}.bin`,'UNSAFE_PATH');
      next=structuredClone(old);next.revision++;next.sourceReceipt=evidence[0].reference;next.attachments.push(subject.reference);
      changed=rows.find(r=>r.kind==='product'&&r.value.productId===productId);check(changed,'EVIDENCE_MISMATCH');
      state.attachments.set(subject.reference.path,subject);
    }else if(operation===DOSSIER_SUBMIT){
      const x=subject.value,h=state.dossier;input=x;
      check(rows.length===2&&!h.proposals.some(r=>r.value.proposalId===x.proposalId),'EVIDENCE_MISMATCH');
      check((x.origin!=='human-authored'||a.role==='human')&&(!x.corrects||a.role==='human'),'INVALID_SCOPE');
      dossierTarget(x,h);
      if(x.corrects){const original=h.proposals.find(r=>same(r.reference,x.corrects));check(original,'EVIDENCE_MISMATCH');dossierCorrection(original,x,h);}
      if(x.payload.kind==='entry')for(const ref of x.payload.attachmentRefs){const attachment=resolved(view,ref,'attachment');
        check(attachment.value.productId===productId&&old.attachments.some(r=>same(r,ref))&&state.attachments.has(ref.path),'INVALID_SCOPE');}
      h.proposals.push(subject);
    }else if(operation===DOSSIER_DECIDE){
      const x=subject.value,h=state.dossier;input=x;
      check(!h.decisions.some(r=>r.value.decisionId===x.decisionId),'EVIDENCE_MISMATCH');
      const relation=dossierDecision(x,h,revision);dossierContext=relation.context;
      if(x.outcome==='accepted'){
        check(rows.length===4,'EVIDENCE_MISMATCH');
        const r=rows[1];check(r.kind==='dossier-record'&&equal(r.value,materialize(relation.original.value,x)),'EVIDENCE_MISMATCH');
        if(r.value.payload.kind==='entry')for(const ref of r.value.payload.attachmentRefs){const attachment=resolved(view,ref,'attachment');
          check(attachment.value.productId===productId&&old.attachments.some(v=>same(v,ref))&&state.attachments.has(ref.path),'INVALID_SCOPE');}
        next=withDossierRecord(old,{record:r.value,reference:r.reference},evidence[0].reference);
        changed=rows[3];check(changed.kind==='product'&&changed.value.productId===productId,'EVIDENCE_MISMATCH');
        planned.push({kind:'dossier-record',reference:r.reference});h.records.push(r);h.current.set(subjectOfDossier(r.value.payload),r);
      }else check(rows.length===2,'EVIDENCE_MISMATCH');
      h.decisions.push(subject);h.active.set(x.proposal.id,subject);
    }
  }
  const entityRevision=operation==='attachment.register'?0:revision;
  const packet={schemaVersion:'3djat.command.v1',operation,key:receipt.key,expected:{domainHead:receipt.previousHead,entityRevision},input};
  const context={authenticatedCaller:a.role==='source-proposer'?'source-proposer':a.role,currentHead:receipt.previousHead,currentRevision:entityRevision,projectId:productId,skus:previous.skus};
  if(operation==='product.proposal.decide'){
    const o=state.proposals.get(input.proposal.id);context.proposal={reference:o.reference,record:o.value};
    if(input.correctedProposal){const c=state.proposals.get(input.correctedProposal.id);context.correctedProposal={reference:c.reference,record:c.value};}
  }
  if(operation===DOSSIER_DECIDE)Object.assign(context,dossierContext);
  const valid=validateCommand(packet,context);check(valid.ok,valid.errors[0]?.code??'EVIDENCE_MISMATCH');
  const expectedEvent=actionEvent(view.head.workspaceId,receipt.principal,packet,a.event.recordedAt);
  check(equal(a.event,expectedEvent)&&same(eventRef(a.event),input.humanActionReceipt??eventRef(a.event)),'EVIDENCE_MISMATCH');
  if(operation==='product.create'&&input.note)check(equal(next.notes,[{id:uuid(a.event.id+'note'),text:input.note,createdAt:a.event.recordedAt,receipt:evidence[0].reference}]),'EVIDENCE_MISMATCH');
  if(operation==='product.note.add')check(equal(next.notes.at(-1),{id:uuid(a.event.id+'note'),text:input.text,createdAt:a.event.recordedAt,receipt:evidence[0].reference}),'EVIDENCE_MISMATCH');
  if(changed){check(equal(changed.value,next)&&same(changed.reference,after),'EVIDENCE_MISMATCH');state.product=changed;}
  else check(sameNullable(before,after),'EVIDENCE_MISMATCH');
  if(operation==='product.create'||operation==='product.note.add')check(same(subject.reference,changed.reference),'EVIDENCE_MISMATCH');
  else planned.push({kind:subject.kind,reference:subject.reference});
  const changes=changed?[{kind:'product',id:productId,expectedRevision:revision,reference:changed.reference}]:[];
  const records=[...planned,...(changed?[{kind:'product',reference:changed.reference}]:[])];
  check(equal(receipt.records,records.map(r=>r.reference))&&equal(receipt.transitions,changed?[{kind:'product',id:productId,from:revision,to:revision+1}]:[]),'EVIDENCE_MISMATCH');
  check(receipt.payloadHash===digest(bytes({expectedHead:receipt.previousHead,changes,records:planned})),'EVIDENCE_MISMATCH');
}
function dossierCorrection(original,corrected,h){
  const a=original.value,b=corrected;check(a.productId===b.productId&&same(b.corrects,original.reference)&&a.proposalId!==b.proposalId&&a.origin===b.origin&&sameSubject(a.payload,b.payload),'EVIDENCE_MISMATCH');
  for(const s of sourcesOf(b.payload))check(sourcesOf(a.payload).some(old=>equal(old,s)),'EVIDENCE_MISMATCH');
  if(b.payload.kind==='entry')for(const r of b.payload.attachmentRefs)check(a.payload.attachmentRefs.some(old=>same(old,r)),'EVIDENCE_MISMATCH');
  if(!sameNullable(a.replaces,b.replaces)){
    const accepted=h.records.find(r=>same(r.value.proposal,original.reference));
    check(accepted&&same(b.replaces,accepted.reference)&&same(h.current.get(subject(b.payload))?.reference,accepted.reference),'EVIDENCE_MISMATCH');
  }
}
function dossierDecision(x,h,revision){
  const original=h.proposals.find(r=>same(r.reference,x.proposal));check(original&&original.value.productId===x.productId,'EVIDENCE_MISMATCH');
  const active=h.active.get(original.value.proposalId),ctx={dossierProposal:{reference:original.reference,record:original.value}};
  check(active?(x.outcome==='superseded'&&x.correctedProposal&&active.value.outcome!=='superseded'&&same(active.reference,x.supersedesDecision)):x.supersedesDecision===null,'EVIDENCE_MISMATCH');
  if(x.correctedProposal){const corrected=h.proposals.find(r=>same(r.reference,x.correctedProposal));check(corrected&&!h.active.has(corrected.value.proposalId),'EVIDENCE_MISMATCH');dossierCorrection(original,corrected.value,h);ctx.dossierCorrectedProposal={reference:corrected.reference,record:corrected.value};}
  const checked=validate('dossier-decision',x,{...ctx,currentRevision:revision});check(checked.ok,checked.errors[0]?.code??'EVIDENCE_MISMATCH');
  if(x.outcome==='accepted'){
    if(original.value.corrects){const d=h.active.get(original.value.corrects.id);check(d?.value.outcome==='superseded'&&same(d.value.correctedProposal,original.reference)&&same(d.value.proposal,original.value.corrects),'EVIDENCE_MISMATCH');}
    const current=h.current.get(subject(original.value.payload));check(sameNullable(original.value.replaces,current?.reference??null),'EVIDENCE_MISMATCH');
    if(current)check(sameSubject(current.value.payload,original.value.payload),'EVIDENCE_MISMATCH');
    check(!h.records.some(r=>same(r.value.proposal,original.reference)),'EVIDENCE_MISMATCH');
  }return {original,context:ctx};
}
function materialize(proposal,decision){return {schemaVersion:'3djat.dossier-record.v1',id:decision.decisionId,productId:decision.productId,revision:1,proposal:decision.proposal,
  decision:prepareRecord('dossier-decision',decision).reference,origin:proposal.origin,payload:structuredClone(proposal.payload),previous:proposal.replaces};}
function withDossierRecord(previous,record,audit){const next=structuredClone(previous);next.revision++;next.sourceReceipt=audit;
  const x=record.record.payload;if(x.kind==='entry')next[entryArray(x.entryKind)].push({id:record.record.id,date:x.date,kind:x.entryKind,title:x.title,references:[record.reference,...x.attachmentRefs],sourceRefs:x.sourceRefs});return next;}
// One bounded join for standalone and authenticated reads. Only reachable receipt publications count.
function dossierHistory(view,productId,registry=null){
  const h={proposals:[],decisions:[],records:[],active:new Map(),current:new Map()};
  const proposals=published(view,'dossier-proposal').filter(x=>x.value.productId===productId),decisions=published(view,'dossier-decision').filter(x=>x.value.productId===productId),records=published(view,'dossier-record').filter(x=>x.value.productId===productId);
  check(proposals.length<=128&&decisions.length<=256&&records.length<=256,'VALIDATION_LIMIT');
  const rows=[...proposals,...decisions].sort((a,b)=>a.publication.revision-b.publication.revision);
  for(const row of rows){const x=row.value,audit=auditRow(row,view,registry),previousHead=view.records.get(row.storeReceipt.previousHead.path).value;
    const previousRef=previousHead.products.find(p=>p.productId===productId)?.dossier;check(previousRef&&previousRef.revision===x.expectedRevision,'REVISION_CONFLICT');
    const transitions=row.storeReceipt.transitions;
    if(row.kind==='dossier-proposal'){
      check(audit.event.operation===DOSSIER_SUBMIT&&['human','conductor','source-proposer'].includes(audit.role)&&(!x.corrects||audit.role==='human')&&(x.origin!=='human-authored'||audit.role==='human'),'INVALID_SCOPE');
      check(transitions.length===0,'EVIDENCE_MISMATCH');dossierTarget(x,h);if(x.corrects){const old=h.proposals.find(p=>same(p.reference,x.corrects));check(old,'EVIDENCE_MISMATCH');dossierCorrection(old,x,h);}h.proposals.push(row);
    }else{
      check(audit.event.operation===DOSSIER_DECIDE&&audit.role==='human','INVALID_SCOPE');const {original}=dossierDecision(x,h,x.expectedRevision);
      const materialized=records.filter(r=>same(r.receipt,row.receipt));
      if(x.outcome==='accepted'){
        check(materialized.length===1,'EVIDENCE_MISMATCH');const r=materialized[0];check(equal(r.value,materialize(original.value,x)),'EVIDENCE_MISMATCH');
        check(transitions.length===1&&equal(transitions[0],{kind:'product',id:productId,from:x.expectedRevision,to:x.expectedRevision+1}),'EVIDENCE_MISMATCH');
        const nextHead=view.records.get(row.publication.path).value,nextRef=nextHead.products.find(p=>p.productId===productId)?.dossier;
        check(nextRef&&equal(view.records.get(nextRef.path).value,withDossierRecord(view.records.get(previousRef.path).value,{record:r.value,reference:r.reference},audit.reference)),'EVIDENCE_MISMATCH');
        const p=r.value.payload;if(p.kind==='entry')for(const ref of p.attachmentRefs){const a=resolved(view,ref,'attachment');check(a.value.productId===productId,'INVALID_SCOPE');check(view.records.get(previousRef.path).value.attachments.some(v=>same(v,ref)),'EVIDENCE_MISMATCH');}
        h.records.push(r);h.current.set(subject(r.value.payload),r);
      }else check(materialized.length===0&&transitions.length===0,'EVIDENCE_MISMATCH');
      h.decisions.push(row);h.active.set(x.proposal.id,row);
    }
  }
  check(h.records.length===records.length,'EVIDENCE_MISMATCH');
  // Later old commands cannot silently detach or rewrite any accepted typed envelope.
  const product=productAt(view,productId).value;
  for(const r of h.records)if(r.value.payload.kind==='entry'){
    const p=r.value.payload,entries=product[entryArray(p.entryKind)].filter(x=>x.id===r.value.id);
    check(entries.length===1&&equal(entries[0],{id:r.value.id,date:p.date,kind:p.entryKind,title:p.title,references:[r.reference,...p.attachmentRefs],sourceRefs:p.sourceRefs}),'EVIDENCE_MISMATCH');
  }
  for(const key of ['designRevisions','productionRecords','finishingRecords'])for(const entry of product[key])for(const ref of entry.references)
    if(view.records.get(ref.path)?.kind==='dossier-record')check(h.records.some(r=>same(r.reference,ref)&&entry.id===r.value.id),'EVIDENCE_MISMATCH');
  return h;
}
function dossierView(store,view,productId,registry=null){const h=dossierHistory(view,productId,registry),fields={};
  for(const field of ['description','modelingSoftware','productionCost']){const r=h.current.get('field:'+field);fields[field]=r?{state:r.value.payload.fact.state,value:r.value.payload.fact.value,record:r.reference,decision:r.value.decision}:{state:'unknown',value:null,record:null,decision:null};}
  return {schemaVersion:'3djat.dossier-view.v1',evidenceVerification:registry?'mac-verified':'hash-only',fields,
    records:h.records.map(r=>({reference:r.reference,record:r.value,active:same(h.current.get(subject(r.value.payload))?.reference,r.reference)})),
    proposals:h.proposals.map(r=>({reference:r.reference,record:r.value,status:h.active.get(r.value.proposalId)?.value.outcome??'pending',sources:sourcesOf(r.value.payload).map(s=>sourceStatus(store,s))})),
    decisions:h.decisions.map(r=>({reference:r.reference,record:r.value}))};
}
export function readProductDossier(root,{productId,atHead=null,accessFile=null}){const store=new DomainStore(root),view=store.read({atHead}),p=productAt(view,productId);let registry=null;
  if(accessFile!==null){safePrivate(accessFile);check(!within(store.root,accessFile)&&!within(accessFile+'.intents',store.root),'UNSAFE_PATH');registry=access(accessFile);check(registry.workspaceId===view.head.workspaceId,'INVALID_SCOPE');}
  return {head:view.reference,product:{reference:p.reference,record:p.value},dossierExtension:dossierView(store,view,productId,registry)};}
export class DomainProducts {
  #store; #file; #auth; #beforePublish; #hook; #attachments;
  constructor(root,{accessFile,authenticate=null,beforePublish=()=>{},hook=()=>{},attachmentSources={}}){
    this.#store=new DomainStore(root);this.#file=safePrivate(accessFile);check(!within(this.#store.root,this.#file)&&!within(this.#file+'.intents',this.#store.root),'UNSAFE_PATH');
    this.#auth=authenticate;this.#beforePublish=beforePublish;this.#hook=hook;this.#registry();
    this.#attachments=new AttachmentFiles(this.#store,{sources:attachmentSources,hook,privatePaths:[this.#file,this.#file+'.intents']});
  }
  #registry(){const a=access(this.#file);check(a.workspaceId===this.#store.marker.workspaceId,'INVALID_SCOPE');return a;}
  #principal(token,operation,productId,sourceBearing=false){
    const a=this.#registry();let p=this.#auth?.(token)??null;
    // The callback proves BVE identity. Registry text supplies policy, never authentication.
    if(p&&operation===DOSSIER_SUBMIT&&sourceBearing){const policy=a.principals.find(x=>x.id===p.id&&x.role===p.role);
      p={...p,sourceIds:policy?.sourceIds??[],products:policy?(p.products==='*'?policy.products:policy.products==='*'?p.products:p.products.filter(id=>policy.products.includes(id))):p.products};}
    if(!p){check(typeof token==='string'&&/^[0-9a-f]{64}$/.test(token),'INVALID_SCOPE');p=findBearer(a,token);}
    check(p&&(!productId||p.products==='*'||p.products.includes(productId)),'INVALID_SCOPE');
    const caller=p.role==='source-proposer'&&operation==='product.read'?'source-reader':p.role;
    check(COMMANDS[operation]?.callers.includes(caller),'INVALID_SCOPE');return {...p,caller};
  }
  #dossierPolicy(p,x){
    check(x.origin!=='human-authored'||p.role==='human','INVALID_SCOPE');check(!x.corrects||p.role==='human','INVALID_SCOPE');
    for(const source of sourcesOf(x.payload))check(p.sourceIds.includes(source.sourceId),'INVALID_SCOPE');
  }
  #dossierInputs(view,product,x){
    for(const source of sourcesOf(x.payload))check(this.#sourceStatus(source).status==='verified','MISSING_SOURCE');
    const attachments=[];if(x.payload.kind==='entry')for(const ref of x.payload.attachmentRefs){const a=resolved(view,ref,'attachment');
      check(a.value.productId===product.productId&&product.attachments.some(r=>same(r,ref)),'INVALID_SCOPE');
      attachments.push({reference:a.reference,record:a.value});
    }
    for(const row of this.#attachments.availability(attachments))check(row.current.status==='available','MISSING_SOURCE');
  }
  #intent(p,packet){return reserveIntent(this.#file,p,packet,{inclusive:false});}
  #audit(p,packet,intent){const event=actionEvent(this.#store.marker.workspaceId,p.id,packet,intent.createdAt),a=this.#registry();
    const value={format:'3djat.product-action.v1',role:p.role,event,mac:signAction(a,p.role,event)};
    return {event,ref:eventRef(event),record:{schemaVersion:'3djat.evidence.v1',id:event.id,revision:1,description:stable(value)}};
  }
  #auditFor(row,view){return auditRow(row,view,this.#registry());}
  operationalEvidence(){const view=this.#store.read(),events=new Map();for(const kind of ['proposal','proposal-decision','product','attachment','dossier-proposal','dossier-decision'])for(const row of published(view,kind)){
    if(!OPS.has(row.storeReceipt.operation))continue;const a=this.#auditFor(row,view);events.set(a.event.id,a.event);
  }return [...events.values()];}
  #sourceStatus(s){return sourceStatus(this.#store,s);}
  #baseCaller(token,productId){
    check(typeof this.#auth==='function','INVALID_SCOPE');
    const native=this.#auth(token); // The native callback may itself change private policy.
    check(native&&typeof native==='object'&&!Array.isArray(native)&&typeof native.id==='string'&&typeof native.role==='string'&&
      (native.products==='*'||Array.isArray(native.products)&&native.products.every(x=>typeof x==='string')),'INVALID_SCOPE');
    const a=this.#registry(),p=a.principals.find(x=>x.id===native.id&&x.role===native.role);
    check(p&&(native.products==='*'||native.products.includes(productId))&&(p.products==='*'||p.products.includes(productId)),'INVALID_SCOPE');
    const caller=native.role==='source-proposer'?'source-reader':native.role;
    check(COMMANDS['product.read'].callers.includes(caller),'INVALID_SCOPE');
    return {id:native.id,role:native.role,policy:p,key:a.key,registry:a};
  }
  resolveBaseProductForOperation(token,query){
    check(query&&typeof query==='object'&&!Array.isArray(query)&&[Object.prototype,null].includes(Object.getPrototypeOf(query)),'INVALID_VALUE');
    exact(query,['mode','atHead','productId']);
    for(const k of ['mode','atHead','productId'])check(Object.getOwnPropertyDescriptor(query,k)?.get===undefined&&Object.getOwnPropertyDescriptor(query,k)?.set===undefined,'INVALID_VALUE');
    check(['new','historical'].includes(query.mode),'INVALID_VALUE');
    check(query.atHead&&typeof query.atHead==='object'&&!Array.isArray(query.atHead)&&[Object.prototype,null].includes(Object.getPrototypeOf(query.atHead)),'INVALID_VALUE');
    exact(query.atHead,['id','revision','path','sha256']);
    for(const k of ['id','revision','path','sha256']){
      const descriptor=Object.getOwnPropertyDescriptor(query.atHead,k);
      check(descriptor&&Object.hasOwn(descriptor,'value'),'INVALID_VALUE');
    }
    shape('revision-ref',query.atHead);
    // Use the existing command contract for the product UUID and the selected
    // head. This runs before the native caller can observe a malformed query.
    shape('command',{schemaVersion:'3djat.command.v1',operation:'product.read',key:'selector-preflight',
      expected:{domainHead:query.atHead,entityRevision:1},input:{productId:query.productId,atHead:query.atHead}});
    const {mode,atHead,productId}=structuredClone(query),start=this.#baseCaller(token,productId);
    if(mode==='new')check(start.role==='human','INVALID_SCOPE');
    const current=this.#store.read();
    if(mode==='new')check(same(current.reference,atHead),'REVISION_CONFLICT');
    else check([...current.records.values()].some(r=>r.kind==='domain-head'&&same(r.reference,atHead)),'MISSING_SOURCE');
    const view=mode==='new'?current:this.#store.read({atHead});
    const heads=[...view.records.values()].filter(r=>r.kind==='domain-head').sort((a,b)=>a.value.revision-b.value.revision);
    const state={product:null,proposals:new Map(),active:new Map(),metadata:{workingName:[],productCode:[]}};
    for(const h of heads)for(const ref of h.value.receipts){const receipt=resolved(view,ref,'store-receipt').value;
      baseReceipt(view,h.value,receipt,productId,start.registry,state,(a,b)=>this.#correctionSources(a,b));}
    const selected=productAt(view,productId);check(state.product&&same(state.product.reference,selected.reference),'EVIDENCE_MISMATCH');
    check(!['attachments','designRevisions','productionRecords','finishingRecords'].some(k=>selected.value[k].length),'CAPABILITY_UNAVAILABLE');
    const sources=['material','dimensions','sellingPrice'].flatMap(k=>selected.value.facts[k].sourceRefs).concat(state.metadata.workingName,state.metadata.productCode);
    let total=0;const statuses=[];
    for(const source of sources){
      const policy=this.#registry().principals.find(p=>p.id===start.id&&p.role===start.role);
      check(policy&&(policy.products==='*'||policy.products.includes(productId)),'INVALID_SCOPE');
      let cause=null;
      if(!policy.sourceIds.includes(source.sourceId))cause='INVALID_SCOPE';
      else if(source.kind!=='file')cause='CAPABILITY_UNAVAILABLE';
      else try{const b=this.#store.readFile(source.location);total+=b.length;check(total<=16*1024**2,'CAPACITY');if(digest(b)!==source.sha256)cause='HASH_MISMATCH';}
        catch(e){if(['ROOT_CHANGED','UNSAFE_PATH','PATH_CASE_MISMATCH','CAPACITY'].includes(e.code))throw e;cause=e.code==='MISSING_REFERENCE'?'MISSING_SOURCE':e.code??'MISSING_SOURCE';}
      if(mode==='new'&&cause)fail(cause);
      statuses.push({source,status:cause?'unresolved':'verified',cause});
    }
    const finish=this.#baseCaller(token,productId),latest=this.#store.read();
    check(finish.id===start.id&&finish.role===start.role,'INVALID_SCOPE');
    check(finish.key===start.key,'EVIDENCE_MISMATCH');
    check(same(latest.reference,current.reference),'HEAD_CHANGED');
    if(mode==='new')check(finish.role==='human'&&same(latest.reference,atHead),'REVISION_CONFLICT');
    for(const status of statuses)if(!finish.policy.sourceIds.includes(status.source.sourceId)){
      if(mode==='new')fail('INVALID_SCOPE');status.status='unresolved';status.cause='INVALID_SCOPE';
    }
    const value={head:view.reference,productId,principalId:start.id,product:{reference:selected.reference,record:selected.value,acceptedFacts:selected.value.facts},sourceStatus:{base:statuses}};
    check(bytes(value).length<=1024**2,'OVERSIZE');return structuredClone(value);
  }
  resolveProductForOperation(token,query){
    check(query&&typeof query==='object'&&!Array.isArray(query)&&[Object.prototype,null].includes(Object.getPrototypeOf(query)),'INVALID_VALUE');
    exact(query,['mode','atHead','productId']);
    for(const k of ['mode','atHead','productId'])check(Object.getOwnPropertyDescriptor(query,k)?.get===undefined&&Object.getOwnPropertyDescriptor(query,k)?.set===undefined,'INVALID_VALUE');
    check(['new','historical'].includes(query.mode),'INVALID_VALUE');
    check(query.atHead&&typeof query.atHead==='object'&&!Array.isArray(query.atHead)&&[Object.prototype,null].includes(Object.getPrototypeOf(query.atHead)),'INVALID_VALUE');
    exact(query.atHead,['id','revision','path','sha256']);
    for(const k of ['id','revision','path','sha256']){
      const descriptor=Object.getOwnPropertyDescriptor(query.atHead,k);check(descriptor&&Object.hasOwn(descriptor,'value'),'INVALID_VALUE');
    }
    shape('revision-ref',query.atHead);
    shape('command',{schemaVersion:'3djat.command.v1',operation:'product.read',key:'selector-preflight',
      expected:{domainHead:query.atHead,entityRevision:1},input:{productId:query.productId,atHead:query.atHead}});
    const {mode,atHead,productId}=structuredClone(query),start=this.#baseCaller(token,productId);
    if(mode==='new')check(start.role==='human','INVALID_SCOPE');
    const current=this.#store.read();
    if(mode==='new')check(same(current.reference,atHead),'REVISION_CONFLICT');
    else check([...current.records.values()].some(r=>r.kind==='domain-head'&&same(r.reference,atHead)),'MISSING_SOURCE');
    const view=mode==='new'?current:this.#store.read({atHead});
    const heads=[...view.records.values()].filter(r=>r.kind==='domain-head').sort((a,b)=>a.value.revision-b.value.revision);
    const state={product:null,proposals:new Map(),active:new Map(),metadata:{workingName:[],productCode:[]},attachments:new Map(),productsPath:this.#store.workspace.paths.products,
      dossier:{proposals:[],decisions:[],records:[],active:new Map(),current:new Map()}};
    for(const h of heads)for(const ref of h.value.receipts){const receipt=resolved(view,ref,'store-receipt').value;
      baseReceipt(view,h.value,receipt,productId,start.registry,state,(a,b)=>this.#correctionSources(a,b),true);}
    const selected=productAt(view,productId);check(state.product&&same(state.product.reference,selected.reference),'EVIDENCE_MISMATCH');
    const statuses={base:[],dossier:[],attachments:[]};let metadataBytes=0;
    const inspect=(source,group,active,record=null)=>{
      const policy=this.#registry().principals.find(p=>p.id===start.id&&p.role===start.role);
      check(policy&&(policy.products==='*'||policy.products.includes(productId)),'INVALID_SCOPE');
      let cause=null;
      if(!policy.sourceIds.includes(source.sourceId))cause='INVALID_SCOPE';
      else if(source.kind!=='file')cause='CAPABILITY_UNAVAILABLE';
      else try{const data=this.#store.readFile(source.location);metadataBytes+=data.length;check(metadataBytes<=16*1024**2,'CAPACITY');
        if(digest(data)!==source.sha256)cause='HASH_MISMATCH';}
        catch(e){if(['ROOT_CHANGED','UNSAFE_PATH','PATH_CASE_MISMATCH','CAPACITY'].includes(e.code))throw e;
          cause=e.code==='MISSING_REFERENCE'?'MISSING_SOURCE':e.code??'MISSING_SOURCE';}
      if(mode==='new'&&active&&cause)fail(cause);
      const status={...(record?{record}:{}),source,status:cause?'unresolved':'verified',cause};statuses[group].push(status);
    };
    for(const source of ['material','dimensions','sellingPrice'].flatMap(k=>selected.value.facts[k].sourceRefs)
      .concat(state.metadata.workingName,state.metadata.productCode))inspect(source,'base',true);
    for(const row of state.dossier.records){const active=same(state.dossier.current.get(subjectOfDossier(row.value.payload))?.reference,row.reference);
      for(const source of sourcesOf(row.value.payload))inspect(source,'dossier',active,row.reference);}
    const mapping=new Map(),attachments=[];
    for(const ref of selected.value.attachments){const row=resolved(view,ref,'attachment');
      check(row.value.productId===productId&&state.attachments.has(ref.path)&&same(state.attachments.get(ref.path).reference,ref),'EVIDENCE_MISMATCH');
      const source=row.value.source,policy=this.#registry().principals.find(p=>p.id===start.id&&p.role===start.role);
      check(policy&&(policy.products==='*'||policy.products.includes(productId)),'INVALID_SCOPE');
      let cause=null,configuration=null;
      if(!policy.sourceIds.includes(source.sourceId))cause='INVALID_SCOPE';
      else if(source.kind!=='file')cause='CAPABILITY_UNAVAILABLE';
      else try{const entry=this.#attachments.authorize(row.value);
        configuration={root:path.resolve(entry.root),products:[...entry.products].sort()};
        this.#attachments.verify(row.value);
      }catch(e){if(['ROOT_CHANGED','UNSAFE_PATH','PATH_CASE_MISMATCH'].includes(e.code))throw e;
        cause=['ENOENT','MISSING_REFERENCE'].includes(e.code)?'MISSING_SOURCE':e.code==='FILE_CHANGED'?'HASH_MISMATCH':e.code??'CAPABILITY_UNAVAILABLE';}
      if(configuration)mapping.set(ref.path,configuration);
      if(mode==='new'&&cause)fail(cause);
      statuses.attachments.push({reference:ref,source,status:cause?'unresolved':'verified',cause});
      attachments.push({reference:ref,record:row.value,current:{status:!cause?'available':cause==='MISSING_SOURCE'?'missing':cause==='HASH_MISMATCH'?'corrupt':'unavailable',cause}});
    }
    const finish=this.#baseCaller(token,productId),latest=this.#store.read();
    check(finish.id===start.id&&finish.role===start.role,'INVALID_SCOPE');
    check(finish.key===start.key,'EVIDENCE_MISMATCH');check(same(latest.reference,current.reference),'HEAD_CHANGED');
    if(mode==='new')check(finish.role==='human'&&same(latest.reference,atHead),'REVISION_CONFLICT');
    for(const group of ['base','dossier'])for(const status of statuses[group])if(!finish.policy.sourceIds.includes(status.source.sourceId)){
      if(mode==='new'&&(group==='base'||same(state.dossier.current.get(subjectOfDossier(view.records.get(status.record.path).value.payload))?.reference,status.record)))fail('INVALID_SCOPE');
      status.status='unresolved';status.cause='INVALID_SCOPE';
    }
    for(let i=0;i<attachments.length;i++){
      const row=attachments[i],status=statuses.attachments[i],source=row.record.source;
      if(!finish.policy.sourceIds.includes(source.sourceId)){
        if(mode==='new')fail('INVALID_SCOPE');status.status='unresolved';status.cause='INVALID_SCOPE';
        row.current={status:'unavailable',cause:'INVALID_SCOPE'};continue;
      }
      if(source.kind!=='file')continue;
      let entry;
      try{entry=this.#attachments.authorize(row.record);}catch(e){
        if(['ROOT_CHANGED','UNSAFE_PATH','PATH_CASE_MISMATCH'].includes(e.code))throw e;
        if(mode==='new')fail(e.code??'INVALID_SCOPE');status.status='unresolved';status.cause=e.code??'INVALID_SCOPE';
        row.current={status:'unavailable',cause:status.cause};continue;
      }
      const was=mapping.get(row.reference.path),now={root:path.resolve(entry.root),products:[...entry.products].sort()};
      if(was&&!equal(was,now))fail('ROOT_CHANGED');
    }
    const dossier=state.dossier.records.map(row=>({reference:row.reference,record:row.value,
      active:same(state.dossier.current.get(subjectOfDossier(row.value.payload))?.reference,row.reference)}));
    const value={head:view.reference,productId,principalId:start.id,
      product:{reference:selected.reference,record:selected.value,acceptedFacts:selected.value.facts},dossier,attachments,sourceStatus:statuses};
    check(bytes(value).length<=1024**2,'OVERSIZE');return structuredClone(value);
  }
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
    return {head:view.reference,product:{reference:product.reference,record:product.value},proposals:h.proposals.map(x=>({reference:x.reference,record:x.value,status:h.active.get(x.value.proposalId)?.value.outcome??'pending',sources:x.value.changes.flatMap(c=>c.fact.sourceRefs.map(s=>this.#sourceStatus(s)))})),decisions:h.decisions.map(x=>({reference:x.reference,record:x.value})),attachments,authority:'domain-files',dossierExtension:dossierView(this.#store,view,query.productId,this.#registry())};
  }
  #result(packet,commit,view){const type=COMMANDS[packet.operation].output,ref=type==='attachment'?commit.records.find(r=>r.id===packet.input.attachmentId&&view.records.get(r.path)?.kind==='attachment'):['proposal','dossier-proposal'].includes(type)?commit.records.find(r=>r.id===packet.input.proposalId&&view.records.get(r.path)?.kind===type):view.head.products.find(x=>x.productId===packet.input.productId)?.dossier;
    check(ref,'EVIDENCE_MISMATCH');const value={schemaVersion:'3djat.result.v1',operation:packet.operation,key:packet.key,receipt:commit.reference,owner:'domain',committedRevision:ref.revision,outputType:type,reference:ref};shape('result',value);return value;}
  static failure(packet,e,receipt=null){let code=ERROR_CODES.includes(e.code)?e.code:['ROOT_CHANGED','STORE_CHANGED','PATH_CASE_MISMATCH'].includes(e.code)?'UNSAFE_PATH':['ENOENT','MISSING_ROOT','MISSING_REFERENCE'].includes(e.code)?'MISSING_SOURCE':['COMMIT_UNCERTAIN','ACK_PENDING','REPLY_UNCERTAIN'].includes(e.code)?'EXPORT_PENDING':'CAPABILITY_UNAVAILABLE';
    if(receipt&&!ERROR_CODES.includes(e.code)&&!['ROOT_CHANGED','STORE_CHANGED','PATH_CASE_MISMATCH'].includes(e.code))code='EXPORT_PENDING';
    const value={schemaVersion:'3djat.failure.v1',operation:packet.operation,key:packet.key,error:{code,path:'$',recoverability:code==='REVISION_CONFLICT'?'refresh':code==='MISSING_SOURCE'?'supply-source':code==='EXPORT_PENDING'?'manual-review':'correct-input',message:code==='EXPORT_PENDING'?'Domain publication or acknowledgement pending; reconcile the original key.':code,evidence:receipt}};shape('failure',value);return value;}
  failure(...args){return DomainProducts.failure(...args);}
  command(token,packet){
    const checked=validate('command',packet);if(!checked.ok){const operation=Object.getOwnPropertyDescriptor(packet??{},'operation')?.value,key=Object.getOwnPropertyDescriptor(packet??{},'key')?.value;
      const error=new StoreError(checked.errors[0].code,{errors:checked.errors});if(OPS.has(operation)&&validate('revision-ref',{id:key,revision:1,path:'key.json',sha256:'0'.repeat(64)}).ok)return this.failure({operation,key},error);throw error;}
    check(OPS.has(packet.operation),'INVALID_SCOPE');let receipt=null;
    const sourceBearing=packet.operation===DOSSIER_SUBMIT&&sourcesOf(packet.input.payload).length>0;
    try{const p=this.#principal(token,packet.operation,packet.input.productId,sourceBearing),a=validateCommand(packet,{authenticatedCaller:p.caller,projectId:packet.input.productId});check(a.ok,a.errors[0]?.code);
      const current=this.#store.read();
      const attaching=packet.operation==='attachment.register';
      if(packet.operation===DOSSIER_SUBMIT)this.#dossierPolicy(p,packet.input);
      if(attaching)this.#attachments.authorize(packet.input); // Current source policy also gates committed replay; no source-byte reread.
      const existing=[...current.records.values()].find(x=>x.kind==='store-receipt'&&x.value.principal===p.id&&x.value.operation===packet.operation&&x.value.key===packet.key);
      if(packet.operation==='product.read'){
        const view=this.#store.read({atHead:packet.input.atHead}),product=productAt(view,packet.input.productId);const v=validateCommand(packet,{authenticatedCaller:p.caller,currentHead:view.reference,currentRevision:product.value.revision,projectId:packet.input.productId});check(v.ok,v.errors[0]?.code);
        const publication=published(view,'product').find(x=>same(x.reference,product.reference));check(publication,'EVIDENCE_MISMATCH');return this.#result(packet,{reference:publication.receipt,records:[]},view);
      }
      const intent=this.#intent(p,packet);
      if(existing){receipt=existing.reference;const owner=[...current.records.values()].find(x=>x.kind==='domain-head'&&x.value.receipts.some(r=>same(r,receipt)));const view=this.#store.read({atHead:owner.reference});
        const audit=view.records.get(existing.value.records.find(r=>view.records.get(r.path)?.kind==='evidence'&&r.id===uuid(stable([this.#store.marker.workspaceId,p.id,packet.operation,packet.key])))?.path);check(audit&&JSON.parse(audit.value.description).event.commandHash===actionEvent(this.#store.marker.workspaceId,p.id,packet,intent.createdAt).commandHash,'IDEMPOTENCY_CONFLICT');
        const kind=attaching?'attachment':packet.operation===DOSSIER_DECIDE?'dossier-decision':packet.operation===DOSSIER_SUBMIT?'dossier-proposal':packet.operation==='product.proposal.decide'?'proposal-decision':packet.operation==='product.proposal.submit'?'proposal':'product',row=published(view,kind).find(r=>same(r.receipt,receipt));check(row,'EVIDENCE_MISMATCH');this.#auditFor(row,view);
        if([DOSSIER_SUBMIT,DOSSIER_DECIDE].includes(packet.operation))dossierHistory(view,packet.input.productId,this.#registry());
        const result=this.#result(packet,{...existing.value,reference:receipt},view);this.#hook('before-response',{result});return result;
      }
      const view=this.#store.read({atHead:packet.expected.domainHead}),product=packet.operation==='product.create'?null:productAt(view,packet.input.productId),context={authenticatedCaller:p.caller,currentHead:view.reference,currentRevision:product?.value.revision??0,projectId:packet.input.productId,skus:view.head.skus};
      if(attaching){context.currentRevision=published(view,'attachment').some(r=>r.value.attachmentId===packet.input.attachmentId)?1:0;check(context.currentRevision===0,'IDEMPOTENCY_CONFLICT');}
      if(packet.operation==='product.create')check(!view.head.products.some(x=>x.productId===packet.input.productId),'REVISION_CONFLICT');
      const audit=this.#audit(p,packet,intent),auditRecord=prepareRecord('evidence',audit.record),records=[{kind:'evidence',record:audit.record}],changes=[];
      const update=value=>{shape('product',value);changes.push({kind:'product',id:value.productId,expectedRevision:product?.value.revision??0,record:value});};
      const x=packet.input,h=product?this.#history(view,x.productId):null;
      let acceptedDossier=null;
      if(packet.operation===DOSSIER_SUBMIT){
        const history=dossierHistory(view,x.productId,this.#registry());check(history.proposals.length<128,'VALIDATION_LIMIT');
        check(!published(view,'dossier-proposal').some(r=>r.value.proposalId===x.proposalId),'IDEMPOTENCY_CONFLICT');
        dossierTarget(x,history);
        if(x.corrects){const original=history.proposals.find(r=>same(r.reference,x.corrects));check(original,'EVIDENCE_MISMATCH');dossierCorrection(original,x,history);}
        // Scope/identity of references is checked even on pending extracts; bytes are required at acceptance.
        if(x.payload.kind==='entry')for(const ref of x.payload.attachmentRefs){const row=resolved(view,ref,'attachment');check(row.value.productId===x.productId&&product.value.attachments.some(r=>same(r,ref)),'INVALID_SCOPE');}
        records.push({kind:'dossier-proposal',record:x});
      }else if(packet.operation===DOSSIER_DECIDE){
        const history=dossierHistory(view,x.productId,this.#registry());check(history.decisions.length<256,'VALIDATION_LIMIT');
        check(!published(view,'dossier-decision').some(r=>r.value.decisionId===x.decisionId),'IDEMPOTENCY_CONFLICT');
        const {original,context:ctx}=dossierDecision(x,history,product.value.revision);Object.assign(context,ctx);
        check(same(x.humanActionReceipt,audit.ref),'EVIDENCE_MISMATCH');
        if(x.outcome==='accepted'){
          check(history.records.length<256,'VALIDATION_LIMIT');acceptedDossier=original.value;this.#dossierInputs(view,product.value,acceptedDossier);
          const value=materialize(acceptedDossier,x),record=prepareRecord('dossier-record',value);update(withDossierRecord(product.value,record,auditRecord.reference));records.push({kind:'dossier-record',record:value});
        }records.push({kind:'dossier-decision',record:x});
      }else if(attaching){
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
        const locked=this.#store.read();check(same(locked.reference,view.reference),'REVISION_CONFLICT');const caller=this.#principal(token,packet.operation,x.productId,sourceBearing);check(caller.id===p.id&&caller.role===p.role,'INVALID_SCOPE');
        const v=validateCommand(packet,context);check(v.ok,v.errors[0]?.code);
        if(packet.operation==='product.proposal.decide'&&x.outcome==='accepted')for(const c of context.proposal.record.changes)for(const s of c.fact.sourceRefs)check(this.#sourceStatus(s).status==='verified','MISSING_SOURCE');
        // New dossier actions are copied to operations only after file publication.
        if(![DOSSIER_SUBMIT,DOSSIER_DECIDE].includes(packet.operation))this.#beforePublish(audit.event);
      }this.#hook(stage,detail);
        if([DOSSIER_SUBMIT,DOSSIER_DECIDE].includes(packet.operation)&&(stage==='locked'||stage==='before-replace')){
          const caller=this.#principal(token,packet.operation,x.productId,sourceBearing);check(caller.id===p.id&&caller.role===p.role,'INVALID_SCOPE');
          if(packet.operation===DOSSIER_SUBMIT)this.#dossierPolicy(caller,x);
          if(acceptedDossier)this.#dossierInputs(view,product.value,acceptedDossier);
        }
        if(attaching&&(stage==='locked'||stage==='before-replace')){
          const caller=this.#principal(token,packet.operation,x.productId);check(caller.id===p.id&&caller.role===p.role,'INVALID_SCOPE');this.#attachments.authorize(x);
          if(stage==='locked')attachmentProof=this.#attachments.capture(x,view);else attachmentProof();
        }
      };
      const commit=this.#store.commit({principal:p.id,operation:packet.operation,key:packet.key,expectedHead:packet.expected.domainHead,changes,records});receipt=commit.receipt;
      const committed=this.#store.read({atHead:commit.head}),result=this.#result(packet,{reference:receipt,records:committed.records.get(receipt.path).value.records},committed);
      this.#hook('after-domain-commit',{result});this.#hook('before-response',{result});return result;
    }catch(e){
      if(!receipt&&[DOSSIER_SUBMIT,DOSSIER_DECIDE].includes(packet.operation)&&e.code==='COMMIT_UNCERTAIN'){
        try{const view=this.#store.read();receipt=[...view.records.values()].find(r=>r.kind==='store-receipt'&&r.value.operation===packet.operation&&r.value.key===packet.key&&r.value.principal===this.#principal(token,packet.operation,packet.input.productId,sourceBearing).id)?.reference??null;}catch{}
      }
      return this.failure(packet,e,receipt);
    }finally{this.#store.hook=()=>{};}
  }
  #correctionSources(original,corrected){check(original.productId===corrected.productId&&same(corrected.corrects,prepareRecord('proposal',original).reference),'EVIDENCE_MISMATCH');
    check(equal(original.changes.map(c=>c.field).sort(),corrected.changes.map(c=>c.field).sort()),'EVIDENCE_MISMATCH');for(const c of corrected.changes){const old=original.changes.find(x=>x.field===c.field);for(const s of c.fact.sourceRefs)check(old.fact.sourceRefs.some(x=>equal(x,s)),'EVIDENCE_MISMATCH');}}
}
