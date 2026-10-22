// Authored disposable file histories. Reuse the accepted PD1 fixture/writer,
// and add only dossier/attachment composition controls for this focused slice.
import * as fs from 'node:fs';
import * as path from 'node:path';
import {randomUUID,createHmac} from 'node:crypto';
import {decisionActionReference} from '../../../src/domain-products.mjs';
import {prepareRecord} from '../../../src/domain-store.mjs';
import {stable,digest,uuid} from '../../../src/domain-authority.mjs';
import {world as baseWorld,editPolicy,packet,send,create,proposal,decision,attachmentInput,forgedNote,tamperTerminalReceipt,WORKSPACE,PRODUCT,roots,boundaryRoots} from './trusted-product-base-selection-fixture.mjs';
export {editPolicy,packet,send,create,proposal,decision,attachmentInput,forgedNote,tamperTerminalReceipt,WORKSPACE,PRODUCT,roots,boundaryRoots};
export function world(options={}){
  const w=baseWorld({attachment:true,...options});
  editPolicy(w,a=>{for(const p of a.principals)if(!p.sourceIds.includes('authored-files'))p.sourceIds.push('authored-files');});
  return w;
}
export const read=(w,mode='new',atHead=w.store.read().reference,token=w.human.token)=>w.writer.resolveProductForOperation(token,{mode,atHead,productId:PRODUCT});
export const field=(name,value,sourceRefs=[],state='accepted')=>({kind:'field',field:name,fact:{state,value,sourceRefs}});
export const entry=(kind,type,attachmentRefs=[],sourceRefs=[])=>({kind:'entry',entryId:randomUUID(),entryKind:kind,entryType:type,
  date:'2026-01-01',title:`Authored ${type}`,text:'Inert typed body',attachmentRefs,sourceRefs});
export function dossierProposal(w,payload,{replaces=null,corrects=null,origin='human-authored'}={}){
  return packet(w,'product.dossier.proposal.submit',{schemaVersion:'3djat.dossier-proposal.v1',proposalId:randomUUID(),productId:PRODUCT,
    expectedRevision:w.store.read().head.products.find(x=>x.productId===PRODUCT).dossier.revision,origin,payload,replaces,reason:'Authored proposal',corrects});
}
export function dossierDecision(w,proposalRef,{outcome='accepted',supersedesDecision=null,correctedProposal=null}={}){
  const input={schemaVersion:'3djat.dossier-decision.v1',decisionId:randomUUID(),productId:PRODUCT,proposal:proposalRef,
    expectedRevision:w.store.read().head.products.find(x=>x.productId===PRODUCT).dossier.revision,
    outcome,reason:'Authored decision',decidedAt:'2026-01-01T00:00:00.000Z',
    humanActionReceipt:{id:'placeholder',revision:1,path:'placeholder.json',sha256:'0'.repeat(64)},supersedesDecision,correctedProposal};
  const p=packet(w,'product.dossier.proposal.decide',input);
  input.humanActionReceipt=decisionActionReference({workspaceId:WORKSPACE,principalId:w.human.principalId,packet:p});return p;
}
export function accept(w,payload,options={}){
  const proposed=send(w,dossierProposal(w,payload,options));
  const decided=send(w,dossierDecision(w,proposed.reference));
  return {proposal:proposed.reference,decision:decided,record:w.store.read().records.get(w.store.read().records.get(decided.receipt.path).value.records[1].path)};
}
export function attach(w){const input=attachmentInput(w),result=send(w,packet(w,'attachment.register',input,{revision:0}));return {input,reference:result.reference};}
export function sourceFile(w,content='Inert authored dossier source\n'){
  const location=`Sources/typed-${randomUUID()}.txt`,data=Buffer.from(content);fs.writeFileSync(path.join(w.root,location),data);
  const ref={...w.ref,location,sha256:digest(data)};return {ref,path:path.join(w.root,location)};
}
// A complete valid-MAC/Store-plan historical publication, deliberately faulting
// only the selected dossier receipt membership. Not an ordinary writer success.
export function signedDossierFault(w,{extra=false,omit=false,reorder=false,repeat=false}={}){
  const p=dossierProposal(w,field('description','Inert proposed text'));
  const actor=w.human,principal=actor.principalId,at='2026-01-01T00:00:00.000Z';
  const event={id:uuid(stable([WORKSPACE,principal,p.operation,p.key])),version:1,type:'product-action',workspaceId:WORKSPACE,
    principalId:principal,operation:p.operation,key:p.key,productId:PRODUCT,commandHash:digest(stable(p)),recordedAt:at};
  const key=JSON.parse(fs.readFileSync(w.accessFile)).key;
  const audit={schemaVersion:'3djat.evidence.v1',id:event.id,revision:1,
    description:stable({format:'3djat.product-action.v1',role:'human',event,
      mac:createHmac('sha256',key).update(stable({role:'human',event})).digest('hex')})};
  const records=[{kind:'evidence',record:audit},...(!omit?[{kind:'dossier-proposal',record:p.input}]:[])];
  if(extra)records.push({kind:'evidence',record:{schemaVersion:'3djat.evidence.v1',id:randomUUID(),revision:1,description:'Extra inert evidence'}});
  if(repeat)records.push({kind:'dossier-proposal',record:p.input});
  if(reorder)records.reverse();
  return w.store.commit({principal,operation:p.operation,key:p.key,expectedHead:w.store.read().reference,changes:[],records});
}

// Signed historical publications with Store-built receipts. Edits are isolated
// semantic faults, not claims that the ordinary writer emitted these records.
export function signedDossierPublication(w,p,{actor=w.human,role=actor.role,eventEdit=()=>{},auditEdit=()=>{},
  recordsEdit=()=>{},productEdit=()=>{},includeProduct=false}={}){
  const before=w.store.read(),principal=actor.principalId,at=p.input.decidedAt??'2026-01-01T00:00:00.000Z';
  const signedInput=structuredClone(p.input);if(p.operation==='product.dossier.proposal.decide')delete signedInput.humanActionReceipt;
  const event={id:uuid(stable([WORKSPACE,principal,p.operation,p.key])),version:1,type:'product-action',workspaceId:WORKSPACE,
    principalId:principal,operation:p.operation,key:p.key,productId:PRODUCT,commandHash:digest(stable({...p,input:signedInput})),recordedAt:at};
  eventEdit(event);
  const key=JSON.parse(fs.readFileSync(w.accessFile)).key;
  const audit={schemaVersion:'3djat.evidence.v1',id:event.id,revision:1,
    description:stable({format:'3djat.product-action.v1',role,event,mac:createHmac('sha256',key).update(stable({role,event})).digest('hex')})};
  auditEdit(audit);
  const subjectKind=p.operation==='product.dossier.proposal.submit'?'dossier-proposal':'dossier-decision';
  const records=[{kind:'evidence',record:audit},{kind:subjectKind,record:p.input}];
  let changes=[];
  if(includeProduct){const prior=before.records.get(before.head.products.find(x=>x.productId===PRODUCT).dossier.path).value,
    next=structuredClone(prior);next.revision++;next.sourceReceipt=prepareRecord('evidence',audit).reference;
    productEdit(next);changes=[{kind:'product',id:PRODUCT,expectedRevision:prior.revision,record:next}];}
  recordsEdit(records);
  return w.store.commit({principal,operation:p.operation,key:p.key,expectedHead:before.reference,changes,records});
}

export function signedAttachment(w,input){
  const before=w.store.read(),p=packet(w,'attachment.register',input,{revision:0}),principal=w.human.principalId;
  const event={id:uuid(stable([WORKSPACE,principal,p.operation,p.key])),version:1,type:'product-action',workspaceId:WORKSPACE,
    principalId:principal,operation:p.operation,key:p.key,productId:PRODUCT,commandHash:digest(stable(p)),recordedAt:'2026-01-01T00:00:00.000Z'};
  const key=JSON.parse(fs.readFileSync(w.accessFile)).key,audit={schemaVersion:'3djat.evidence.v1',id:event.id,revision:1,
    description:stable({format:'3djat.product-action.v1',role:'human',event,mac:createHmac('sha256',key).update(stable({role:'human',event})).digest('hex')})};
  const previous=before.records.get(before.head.products.find(x=>x.productId===PRODUCT).dossier.path).value,next=structuredClone(previous);
  next.revision++;next.sourceReceipt=prepareRecord('evidence',audit).reference;next.attachments.push(prepareRecord('attachment',input).reference);
  return w.store.commit({principal,operation:p.operation,key:p.key,expectedHead:before.reference,
    changes:[{kind:'product',id:PRODUCT,expectedRevision:previous.revision,record:next}],
    records:[{kind:'evidence',record:audit},{kind:'attachment',record:input}]});
}

export function signedAcceptedDecisionFault(w,{payload=field('description','Signed accepted'),proposalEdit=()=>{},decisionEdit=()=>{},
  actionRefEdit=()=>{},materialEdit=()=>{},productEdit=()=>{},recordsEdit=()=>{},eventEdit=()=>{},role='human'}={}){
  const proposed=dossierProposal(w,payload);proposalEdit(proposed.input);
  const proposalResult=send(w,proposed);
  const p=dossierDecision(w,proposalResult.reference);decisionEdit(p.input);
  // The action reference is derived from the final signed decision input.
  p.input.humanActionReceipt=decisionActionReference({workspaceId:WORKSPACE,principalId:w.human.principalId,packet:p});
  actionRefEdit(p.input.humanActionReceipt);
  const before=w.store.read(),principal=w.human.principalId;
  const signedInput=structuredClone(p.input);delete signedInput.humanActionReceipt;
  const event={id:uuid(stable([WORKSPACE,principal,p.operation,p.key])),version:1,type:'product-action',workspaceId:WORKSPACE,
    principalId:principal,operation:p.operation,key:p.key,productId:PRODUCT,commandHash:digest(stable({...p,input:signedInput})),recordedAt:p.input.decidedAt};
  eventEdit(event);
  const key=JSON.parse(fs.readFileSync(w.accessFile)).key,audit={schemaVersion:'3djat.evidence.v1',id:event.id,revision:1,
    description:stable({format:'3djat.product-action.v1',role,event,mac:createHmac('sha256',key).update(stable({role,event})).digest('hex')})};
  const material={schemaVersion:'3djat.dossier-record.v1',id:p.input.decisionId,productId:PRODUCT,revision:1,
    proposal:proposalResult.reference,decision:prepareRecord('dossier-decision',p.input).reference,
    origin:proposed.input.origin,payload:structuredClone(proposed.input.payload),previous:proposed.input.replaces};
  materialEdit(material);
  const records=[{kind:'evidence',record:audit},{kind:'dossier-record',record:material},{kind:'dossier-decision',record:p.input}];recordsEdit(records);
  const prior=before.records.get(before.head.products.find(x=>x.productId===PRODUCT).dossier.path).value,next=structuredClone(prior);
  next.revision++;next.sourceReceipt=prepareRecord('evidence',audit).reference;
  if(material.payload.kind==='entry')next[{design:'designRevisions',production:'productionRecords',finishing:'finishingRecords'}[material.payload.entryKind]].push({
    id:material.id,date:material.payload.date,kind:material.payload.entryKind,title:material.payload.title,
    references:[prepareRecord('dossier-record',material).reference,...material.payload.attachmentRefs],sourceRefs:material.payload.sourceRefs});
  productEdit(next);
  w.store.commit({principal,operation:p.operation,key:p.key,expectedHead:before.reference,
    changes:[{kind:'product',id:PRODUCT,expectedRevision:prior.revision,record:next}],records});
  return {proposal:proposalResult.reference,packet:p,material};
}
