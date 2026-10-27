import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {randomUUID,createHmac} from 'node:crypto';
import {DomainStore,prepareRecord} from '../../../src/domain-store.mjs';
import {DomainBusiness,configureBusinessGrant,businessDecisionActionReference} from '../../../src/domain-business.mjs';
import {DomainProducts,provisionProductPrincipal} from '../../../src/domain-products.mjs';
import {DomainTemplates,configureTemplateGrant,templateDecisionActionReference} from '../../../src/domain-templates.mjs';
import {stable,digest,uuid,bytes} from '../../../src/domain-authority.mjs';

export const WORKSPACE=randomUUID(),roots=[],boundaryRoots=[];
export function world({hook=()=>{},boundary=false}={}){
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'3djat-ba1-'));
 (boundary?boundaryRoots:roots).push(home);const root=path.join(home,'domain'),accessFile=path.join(home,'business-private.json');
 const store=DomainStore.initialize(root,{workspaceId:WORKSPACE,sourceCommit:'678272d269ef720fd41e63c2f60905c1b318095b'});
 const human={id:'bve-human',role:'human',products:'*'},conductor={id:'bve-conductor',role:'conductor',products:'*'};
 configureBusinessGrant(accessFile,{workspaceId:WORKSPACE,principalId:human.id,role:'human',grant:{operations:['read','publish'],sourceIds:['authored-source']},expectedSha256:null,confirmedQuiescent:true});
 let identity=human;const w={home,root,store,accessFile,human,conductor,auth:()=>identity,setNative:x=>{identity=x;},hook};
 w.writer=new DomainBusiness(root,{accessFile,authenticate:token=>w.auth(token),hook:(stage,detail)=>w.hook(stage,detail)});
 const data=Buffer.from('Authored inert source\n'),location='Sources/business-source.txt';fs.mkdirSync(path.join(root,'Sources'));fs.writeFileSync(path.join(root,location),data);
 w.source={kind:'file',sourceId:'authored-source',revision:'1',sha256:digest(data),location,locator:{kind:'page',page:1},observedAt:'2026-01-01T00:00:00.000Z'};
 return w;
}
export function policy(w,change){const a=JSON.parse(fs.readFileSync(w.accessFile));change(a);fs.writeFileSync(w.accessFile,stable(a)+'\n');}
export function packet(w,{sources=[w.source],instructions='Authored approved instructions',key=randomUUID(),head=w.store.read().reference,revision=w.store.read().head.business?.revision??0,decidedAt='2026-01-01T00:00:00.000Z'}={}){
 const p={schemaVersion:'3djat.command.v1',operation:'business.context.publish',key,expected:{domainHead:head,entityRevision:revision},
  input:{workspaceId:WORKSPACE,expectedRevision:revision,revision:revision+1,instructions,sourceRefs:sources,decidedAt,
   humanActionReceipt:{id:'placeholder',revision:1,path:'placeholder.json',sha256:'0'.repeat(64)}}};
 p.input.humanActionReceipt=businessDecisionActionReference({workspaceId:WORKSPACE,principalId:w.human.id,packet:p});return p;
}
export function send(w,p){const r=w.writer.command('native-human',p);if(r.schemaVersion!=='3djat.result.v1')throw Object.assign(new Error('Unexpected writer failure '+r.error.code),{code:r.error.code,result:r});return r;}
export const read=(w,mode='new',head=w.store.read().reference)=>w.writer.resolveBusinessForOperation('native-human',{mode,atHead:head,workspaceId:WORKSPACE});
export function signedFault(w,{sources=[w.source],eventEdit=()=>{},role='human',signedEdit=()=>{},auditEdit=()=>{},decisionEdit=()=>{},contextEdit=()=>{},recordsEdit=()=>{},changesEdit=()=>{},operation='business.context.publish'}={}){
 const p=packet(w,{sources}),prior=w.store.read(),actor=w.human.id,input=structuredClone(p.input);delete input.humanActionReceipt;
 const event={id:uuid(stable([WORKSPACE,actor,p.operation,p.key])),version:1,type:'business-action',workspaceId:WORKSPACE,principalId:actor,
  operation:p.operation,key:p.key,commandHash:digest(stable({...p,input})),recordedAt:p.input.decidedAt};eventEdit(event);
 const privateKey=JSON.parse(fs.readFileSync(w.accessFile)).key;
 const signed={format:'3djat.business-action.v1',role,event,
  mac:createHmac('sha256',privateKey).update(stable({role,event})).digest('hex')};signedEdit(signed);
 const audit={schemaVersion:'3djat.evidence.v1',id:event.id,revision:1,description:stable(signed)};auditEdit(audit);
 const er=prepareRecord('evidence',audit).reference;
 const d={schemaVersion:'3djat.business-decision.v1',decisionId:event.id,revision:1,workspaceId:WORKSPACE,expectedRevision:p.expected.entityRevision,
  action:'approve',instructionsSha256:digest(bytes({instructions:p.input.instructions,sourceRefs:p.input.sourceRefs})),sourceRefs:p.input.sourceRefs,
  decidedAt:p.input.decidedAt,humanActionReceipt:p.input.humanActionReceipt};decisionEdit(d);
 const dr=prepareRecord('business-decision',d).reference;
 const c={schemaVersion:'3djat.business-context.v1',workspaceId:WORKSPACE,revision:p.input.revision,instructions:p.input.instructions,sourceRefs:p.input.sourceRefs,
  decision:dr,sourceReceipt:er};contextEdit(c);
 const records=[{kind:'evidence',record:audit},{kind:'business-decision',record:d}];recordsEdit(records);
 const changes=[{kind:'business-context',id:WORKSPACE,expectedRevision:p.expected.entityRevision,record:c}];changesEdit(changes);
 return w.store.commit({principal:actor,operation,key:p.key,expectedHead:prior.reference,records,changes});
}
export function countedSource(w,bytesLength){const location='Sources/boundary.bin',data=Buffer.alloc(bytesLength,65);fs.writeFileSync(path.join(w.root,location),data);return {...w.source,location,sha256:digest(data)};}
// An isolated terminal fixture remains Store hash-consistent while one receipt
// or head semantic is changed. Earlier heads are left byte-for-byte intact.
export function rewriteTerminal(w,change){const view=w.store.read(),head=structuredClone(view.head),ref=head.receipts[0];
 const receipt=structuredClone(view.records.get(ref.path).value);change(receipt,head);
 const rb=bytes(receipt);head.receipts[0]={...ref,sha256:digest(rb)};const hb=bytes(head);
 fs.writeFileSync(path.join(w.root,ref.path),rb);fs.writeFileSync(path.join(w.root,view.reference.path),hb);
 fs.writeFileSync(path.join(w.root,'domain-head.json'),hb);
}
export function unrelatedCommit(w){return w.store.commit({principal:'inert-other',operation:'inert.unrelated',key:randomUUID(),expectedHead:w.store.read().reference,
 changes:[],records:[{kind:'evidence',record:{schemaVersion:'3djat.evidence.v1',id:randomUUID(),revision:1,description:'Inert unrelated receipt'}}]});}
export function governedBetween(w){const accessFile=path.join(w.home,'product-template-private.json'),id='authored-governed',productId=randomUUID();
 const human=provisionProductPrincipal(accessFile,{workspaceId:WORKSPACE,id,role:'human',products:'*',sourceIds:[]});
 const product=new DomainProducts(w.root,{accessFile});const command=(operation,input,entityRevision=0)=>({schemaVersion:'3djat.command.v1',operation,key:randomUUID(),
  expected:{domainHead:w.store.read().reference,entityRevision},input});
 const created=product.command(human.token,command('product.create',{productId,productCode:'BA1-PROBE',workingName:'Authored governed product'}));
 if(created.schemaVersion!=='3djat.result.v1')throw Error('Governed product '+created.error?.code);
 configureTemplateGrant(accessFile,{workspaceId:WORKSPACE,principalId:id,role:'human',grant:{templateIds:['business-probe'],appliesTo:['artistic'],operations:['read','ingest','adopt'],sourceIds:[]},
  expectedSha256:digest(fs.readFileSync(accessFile)),confirmedQuiescent:true});
 const templates=new DomainTemplates(w.root,{accessFile}),value={schemaVersion:'3djat.template.v1',templateId:'business-probe',revision:1,
  title:'Authored probe',kind:'operation',appliesTo:['artistic'],instructions:'Inert authored template',inputs:[],allowedChanges:['background'],outputs:[{role:'candidate',format:'image/png'}],sourceRefs:[],supersedes:null};
 const ingested=templates.command(human.token,command('template.ingest',value));if(ingested.schemaVersion!=='3djat.result.v1')throw Error('Governed template '+ingested.error?.code);
 const ref=w.store.read().head.templates.find(t=>t.id===value.templateId),input={schemaVersion:'3djat.template-decision.v1',decisionId:randomUUID(),template:ref,
  action:'adopt',purpose:'Authored scope',appliesTo:['artistic'],expectedRevision:0,experiment:null,outputs:[],evidenceReceipt:null,
  humanActionReceipt:{id:'placeholder',revision:1,path:'placeholder.json',sha256:'0'.repeat(64)},decidedAt:'2026-01-01T00:00:00.000Z',supersedesDecision:null,reason:'Inert authored decision'};
 const adopt=command('template.adopt',input);input.humanActionReceipt=templateDecisionActionReference({workspaceId:WORKSPACE,principalId:id,packet:adopt});
 const adopted=templates.command(human.token,adopt);if(adopted.schemaVersion!=='3djat.result.v1')throw Error('Governed adoption '+adopted.error?.code);
 return {productId,templateId:value.templateId,created,ingested,adopted};}
