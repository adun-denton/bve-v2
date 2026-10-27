// Disposable, authored file history. Generated credentials remain only in private test roots.
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {randomUUID,createHash} from 'node:crypto';
import {DomainStore} from '../../../src/domain-store.mjs';
import {DomainProducts,provisionProductPrincipal} from '../../../src/domain-products.mjs';
import {DomainTemplates,configureTemplateGrant,templateDecisionActionReference} from '../../../src/domain-templates.mjs';
import {stable,digest,uuid,signAction,access} from '../../../src/domain-authority.mjs';

export const W='bbbbbbbb-bbbb-4bbb-9bbb-bbbbbbbbbbbb',P='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',OTHER='cccccccc-cccc-4ccc-8ccc-cccccccccccc',TIME='2026-01-01T00:00:00.000Z';
const hash=b=>createHash('sha256').update(b).digest('hex');
export const defaultGrant=()=>({templateIds:['operation-a','brand-a','brand-b','other'],appliesTo:['artistic','catalogue'],operations:['read','ingest','adopt'],sourceIds:['inert']});
export const template=(id='operation-a',extra={})=>({schemaVersion:'3djat.template.v1',templateId:id,revision:1,title:'Authored template',kind:id.startsWith('brand-')?'brand':'operation',appliesTo:['artistic','catalogue'],instructions:'Inert authored instructions',inputs:[],allowedChanges:['background'],outputs:id.startsWith('brand-')?[]:[{role:'candidate',format:'image/png'}],sourceRefs:[],supersedes:null,...extra});
function usage(root){let n=0;for(const item of fs.readdirSync(root,{withFileTypes:true})){const p=path.join(root,item.name);n+=item.isDirectory()?usage(p):fs.statSync(p).size;}return n;}
export function setup(t,{grant=defaultGrant(),authenticate=true}={}){
 const parent=process.env.T1_EVIDENCE_ROOT??fs.mkdtempSync(path.join(os.tmpdir(),'t1-selection-'));
 fs.mkdirSync(parent,{recursive:true,mode:0o700});
 const dir=fs.mkdtempSync(path.join(parent,'fixture-')),root=path.join(dir,'domain'),accessFile=path.join(dir,'private-access.json');
 const store=DomainStore.initialize(root,{workspaceId:W,sourceCommit:'a67f73ee928851db2ed43ed67649faafe5c14897'});
 for(const p of Object.values(store.workspace.paths))fs.mkdirSync(path.join(root,p));fs.mkdirSync(path.join(root,'Sources'));
 const human=provisionProductPrincipal(accessFile,{workspaceId:W,id:'authored-human',role:'human',products:'*',sourceIds:[]});
 const products=new DomainProducts(root,{accessFile});
 const creation={schemaVersion:'3djat.command.v1',operation:'product.create',key:randomUUID(),expected:{domainHead:store.read().reference,entityRevision:0},input:{productId:P,productCode:null,workingName:'Authored product'}};
 const productResult=products.command(human.token,creation);if(productResult.schemaVersion!=='3djat.result.v1')throw Error('Authored product setup refused: '+productResult.error.code);
 const source=Buffer.from('INERT selected template source.\n');fs.writeFileSync(path.join(root,'Sources/inert.txt'),source);
 const sourceRef={kind:'file',sourceId:'inert',revision:'r1',sha256:hash(source),location:'Sources/inert.txt',locator:{kind:'section',section:'Inert authored source'},observedAt:TIME};
 const w={parent,dir,root,accessFile,store,human,sourceRef,native:{id:human.principalId,role:'human',products:[P]},nativeCalls:0,onNative:null};
 w.setGrant=g=>configureTemplateGrant(accessFile,{workspaceId:W,principalId:human.principalId,role:'human',grant:g,expectedSha256:hash(fs.readFileSync(accessFile)),confirmedQuiescent:true});
 w.changeAccess=fn=>{const a=JSON.parse(fs.readFileSync(accessFile,'utf8'));fn(a);fs.writeFileSync(accessFile,stable(a)+'\n',{mode:0o600});};
 w.setGrant(grant);
 w.writer=new DomainTemplates(root,{accessFile});
 w.resolver=new DomainTemplates(root,{accessFile,authenticate:authenticate?token=>{w.nativeCalls++;w.onNative?.(w.nativeCalls);return token===human.token?w.native:null;}:null});
 w.query=(extra={})=>({mode:'new',atHead:store.read().reference,projectId:P,applicability:'artistic',operationTemplateId:'operation-a',branded:false,brandTemplateId:null,...extra});
 w.resolve=(extra={},token=human.token)=>w.resolver.resolveAdoptedForOperation(token,w.query(extra));
 t.after(()=>{const bytes=usage(dir);fs.writeFileSync(path.join(dir,'screened-summary.json'),JSON.stringify({authoredOnly:true,bytes,retained:true})+'\n');if(bytes>2*1024**2)throw Error('Authored fixture root exceeds 2MiB');});
 return w;
}
export function ingest(w,value=template()){
 const old=w.store.read().head.templates.find(r=>r.id===value.templateId),input={...value,revision:(old?.revision??0)+1,supersedes:old??null};
 const packet={schemaVersion:'3djat.command.v1',operation:'template.ingest',key:randomUUID(),expected:{domainHead:w.store.read().reference,entityRevision:old?.revision??0},input};
 const result=w.writer.command(w.human.token,packet);if(result.schemaVersion!=='3djat.result.v1')throw Error('Authored ingest refused: '+result.error.code);
 return result.reference;
}
export function adopt(w,ref,apps=['artistic','catalogue']){
 const decisions=[...w.store.read().records.values()].filter(x=>x.kind==='template-decision'&&x.value.template.id===ref.id).sort((a,b)=>a.value.expectedRevision-b.value.expectedRevision);
 const input={schemaVersion:'3djat.template-decision.v1',decisionId:randomUUID(),template:ref,action:'adopt',purpose:'Authored scope',appliesTo:apps,expectedRevision:decisions.length,experiment:null,outputs:[],evidenceReceipt:null,humanActionReceipt:{id:'placeholder',revision:1,path:'placeholder.json',sha256:'0'.repeat(64)},decidedAt:TIME,supersedesDecision:decisions.at(-1)?.reference??null,reason:'Authored only'};
 const packet={schemaVersion:'3djat.command.v1',operation:'template.adopt',key:randomUUID(),expected:{domainHead:w.store.read().reference,entityRevision:decisions.length},input};
 input.humanActionReceipt=templateDecisionActionReference({workspaceId:W,principalId:w.human.principalId,packet});
 const result=w.writer.command(w.human.token,packet);if(result.schemaVersion!=='3djat.result.v1')throw Error('Authored adoption refused: '+result.error.code);
 return result.reference;
}
export function ready(t,options={}){const w=setup(t,options),r=ingest(w);adopt(w,r);return w;}

// A structurally published row with an isolated signed-audit defect, not a modified file/hash.
export function injectIngestAudit(w,{mac='valid',role='human',eventChange=null}={}){
 const input=template('other'),key=randomUUID(),head=w.store.read().reference;
 const packet={schemaVersion:'3djat.command.v1',operation:'template.ingest',key,expected:{domainHead:head,entityRevision:0},input};
 const event={id:uuid(stable([W,w.human.principalId,packet.operation,key])),version:1,type:'template-action',workspaceId:W,principalId:w.human.principalId,operation:packet.operation,key,templateId:input.templateId,commandHash:digest(stable(packet)),recordedAt:TIME};
 eventChange?.(event);const registry=access(w.accessFile);
 const signed={format:'3djat.template-action.v1',role,event,mac:mac==='valid'?signAction(registry,role,event):mac};
 const evidence={schemaVersion:'3djat.evidence.v1',id:event.id,revision:1,description:stable(signed)};
 return w.store.commit({principal:w.human.principalId,operation:'template.ingest',key,expectedHead:head,changes:[{kind:'template',id:input.templateId,expectedRevision:0,record:input}],records:[{kind:'evidence',record:evidence}]});
}
export function injectDecisionSequence(w,ref,sequence=9,tail=null){
 const key=randomUUID(),head=w.store.read().reference,input={schemaVersion:'3djat.template-decision.v1',decisionId:randomUUID(),template:ref,action:'adopt',purpose:'Authored sequence',appliesTo:['artistic'],expectedRevision:sequence,experiment:null,outputs:[],evidenceReceipt:null,humanActionReceipt:{id:'placeholder',revision:1,path:'placeholder.json',sha256:'0'.repeat(64)},decidedAt:TIME,supersedesDecision:null,reason:'Authored only'};
 input.supersedesDecision=tail;
 const packet={schemaVersion:'3djat.command.v1',operation:'template.adopt',key,expected:{domainHead:head,entityRevision:sequence},input};
 input.humanActionReceipt=templateDecisionActionReference({workspaceId:W,principalId:w.human.principalId,packet});
 const normalized=structuredClone(input);delete normalized.humanActionReceipt;
 const event={id:uuid(stable([W,w.human.principalId,packet.operation,key])),version:1,type:'template-action',workspaceId:W,principalId:w.human.principalId,operation:packet.operation,key,templateId:ref.id,commandHash:digest(stable({...packet,input:normalized})),recordedAt:TIME};
 const evidence={schemaVersion:'3djat.evidence.v1',id:event.id,revision:1,description:stable({format:'3djat.template-action.v1',role:'human',event,mac:signAction(access(w.accessFile),'human',event)})};
 return w.store.commit({principal:w.human.principalId,operation:'template.adopt',key,expectedHead:head,changes:[],records:[{kind:'evidence',record:evidence},{kind:'template-decision',record:input}]});
}

// Rehash an isolated newest receipt and its owning head, retaining all earlier
// immutable records and the signed action. This is authored negative evidence.
export function rewriteLatestReceipt(w,change){
 const current=w.store.read(),h=structuredClone(current.head),rr=h.receipts[0];
 const receipt=structuredClone(current.records.get(rr.path).value);change(receipt,h);
 const rb=Buffer.from(stable(receipt)+'\n');rr.sha256=hash(rb);
 const hb=Buffer.from(stable(h)+'\n');
 fs.writeFileSync(path.join(w.root,rr.path),rb);
 fs.writeFileSync(path.join(w.root,current.reference.path),hb);
 fs.writeFileSync(path.join(w.root,'domain-head.json'),hb);
 return w.store.read();
}

export function largeValidTemplate(id){
 const glyph='\u0800',long=glyph.repeat(97);
 const parameters=Object.fromEntries(Array.from({length:24},(_,i)=>['p'+i,{type:'enum',values:Array.from({length:24},(_,j)=>long+String(j).padStart(3,'0'))}]));
 const presets=Object.fromEntries(Array.from({length:24},(_,i)=>['preset'+i,Object.fromEntries(Array.from({length:24},(_,j)=>['p'+j,long+'000']))]));
 const sourceRefs=Array.from({length:16},(_,i)=>({kind:'file',sourceId:'large-'+i,revision:glyph.repeat(200),sha256:'a'.repeat(64),location:'Sources/'+glyph.repeat(400),locator:{kind:'section',section:glyph.repeat(500)},observedAt:TIME}));
 return template(id,{instructions:glyph.repeat(20_000),allowedChanges:Array.from({length:24},()=>glyph.repeat(500)),exploration:{parameters,presets},sourceRefs});
}
