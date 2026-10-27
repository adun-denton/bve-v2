// Disposable authored business, identities and receipts; never real approvals.
import * as fs from 'node:fs';import * as path from 'node:path';import * as os from 'node:os';
import assert from 'node:assert/strict';import {randomUUID,createHash} from 'node:crypto';
import {DomainStore} from '../../../src/domain-store.mjs';
import {DomainProducts,provisionProductPrincipal} from '../../../src/domain-products.mjs';
import {DomainTemplates,configureTemplateGrant,templateDecisionActionReference,readTemplateRegistry} from '../../../src/domain-templates.mjs';
import {Kernel} from '../../../src/kernel.mjs';
export const W='bbbbbbbb-bbbb-4bbb-9bbb-bbbbbbbbbbbb',P='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',OTHER='cccccccc-cccc-4ccc-8ccc-cccccccccccc',TIME='2026-01-01T00:00:00.000Z';
export const hash=b=>createHash('sha256').update(b).digest('hex');
export const stable=x=>JSON.stringify(x,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
export const ok=r=>{assert.equal(r.schemaVersion,'3djat.result.v1',JSON.stringify(r));return r;};
export const denied=(r,code)=>{assert.equal(r.schemaVersion,'3djat.failure.v1',JSON.stringify(r));assert.equal(r.error.code,code,JSON.stringify(r));return r;};
export function usage(root){if(!fs.existsSync(root))return 0;let n=0;for(const d of fs.readdirSync(root,{withFileTypes:true})){assert(!d.isSymbolicLink());const p=path.join(root,d.name);try{n+=d.isDirectory()?usage(p):fs.statSync(p).size;}catch(e){if(!(e.code==='ENOENT'&&d.name==='domain-write.lock'))throw e;}}return n;}
export function guard(parent,reserve=0){fs.mkdirSync(parent,{recursive:true});assert(usage(parent)+reserve<=32*1024**2,'C1 authored evidence exceeds fixed32MiB');assert(fs.readdirSync(parent).filter(n=>n.startsWith('template-')).length<96,'C1 root count exceeds96');assert(fs.statfsSync(parent).bavail*fs.statfsSync(parent).bsize>64*1024**2);}
export const grant=(extra={})=>({templateIds:['creative','brand-a','brand-b','other','source-only'],appliesTo:['artistic','catalogue'],operations:['read','ingest','adopt'],sourceIds:['inert'],...extra});
export function policy(w,id,g=grant(),role='human',products='*'){
 let a=JSON.parse(fs.readFileSync(w.accessFile));let p=a.principals.find(p=>p.id===id);let principal=null;
 if(!p){principal=provisionProductPrincipal(w.accessFile,{workspaceId:W,id,role,products,sourceIds:[]});a=JSON.parse(fs.readFileSync(w.accessFile));p=a.principals.find(p=>p.id===id);}
 configureTemplateGrant(w.accessFile,{workspaceId:W,principalId:id,role:p.role,grant:g,expectedSha256:hash(fs.readFileSync(w.accessFile)),confirmedQuiescent:true});return principal;
}
export function change(w,id,fn){const a=JSON.parse(fs.readFileSync(w.accessFile));fn(a.principals.find(p=>p.id===id),a);fs.writeFileSync(w.accessFile,JSON.stringify(a));}
export function setup(t,{kernel=false,hook=()=>{},workspaceHook=()=>{},reserve=512*1024,authorize=true}={}){
 const parent=process.env.TEMPLATE_EVIDENCE_ROOT??path.join(os.tmpdir(),'bve-template-authored');guard(parent,reserve);const dir=fs.mkdtempSync(path.join(parent,'template-')),root=path.join(dir,'business'),runtime=path.join(dir,'runtime'),accessFile=path.join(dir,'access.json');
 const store=DomainStore.initialize(root,{workspaceId:W,sourceCommit:'a355f29459a2ad5a7e0ad5f26b7d491926e6ff2b'});for(const p of Object.values(store.workspace.paths))fs.mkdirSync(path.join(root,p));fs.mkdirSync(path.join(root,'Sources'));
 const human=provisionProductPrincipal(accessFile,{workspaceId:W,id:'authored-human',role:'human',products:'*',sourceIds:[]});
 const config={schemaVersion:'3djat.connection.v1',workspaceId:W,domainRoot:root,runtimeRoot:runtime,paths:Object.fromEntries(Object.entries(store.workspace.paths).map(([k,v])=>[k,path.join(root,v)])),storage:'local-unsynced'};
 const observations=[];const w={parent,dir,root,runtime,accessFile,store,human,config,k:null,c:null,reserve,observations,writer:new DomainTemplates(root,{accessFile,hook:(stage,detail)=>{if(['command-error','after-domain-commit','before-response'].includes(stage))observations.push({stage,...detail});hook(stage,detail);}})};
 const products=new DomainProducts(root,{accessFile});ok(products.command(human.token,packet(w,'product.create',{productId:P,productCode:null,workingName:'Authored template product'},0)));
 const source=Buffer.from('INERT template source.\n');fs.writeFileSync(path.join(root,'Sources/inert.txt'),source);w.source={kind:'file',sourceId:'inert',revision:'r1',sha256:hash(source),location:'Sources/inert.txt',locator:{kind:'section',section:'Authored inert source'},observedAt:TIME};
 if(authorize)policy(w,human.principalId);
 if(kernel){w.k=new Kernel(runtime,{workspace:config,expectedHead:store.read().reference,products:{accessFile},templates:{accessFile},workspaceHook});w.c=JSON.parse(fs.readFileSync(path.join(runtime,'credentials.json')));ok(w.k.productCommand(w.c.human,packet(w,'product.read',{productId:P,atHead:store.read().reference},1)));}
 fs.writeFileSync(path.join(dir,'unrelated-sentinel'),'INERT C1 sentinel\n');t.after(()=>{w.k?.close();assert.equal(fs.readFileSync(path.join(dir,'unrelated-sentinel'),'utf8'),'INERT C1 sentinel\n');fs.writeFileSync(path.join(dir,'OBSERVATIONS.json'),JSON.stringify(observations)+'\n');fs.writeFileSync(path.join(dir,'FIXTURE-RETAINED.json'),JSON.stringify({test:t.name,authoredOnly:true,noCleanup:true,logicalBytes:usage(dir)})+'\n');guard(parent);assert(usage(dir)<=reserve,'C1 group exceeds declared reservation');});return w;
}
export function packet(w,operation,input,n=0,{key=randomUUID(),head=w.store.read().reference}={}){return {schemaVersion:'3djat.command.v1',operation,key,expected:{domainHead:head,entityRevision:n},input};}
export function template(id='creative',extra={}){return {schemaVersion:'3djat.template.v1',templateId:id,revision:1,title:'Authored template',kind:id.startsWith('brand-')?'brand':'operation',appliesTo:['artistic','catalogue'],instructions:'Preserve the product. Inert authored instructions.',inputs:[],allowedChanges:['background'],outputs:id.startsWith('brand-')?[]:[{role:'candidate',format:'image/png'}],sourceRefs:[],supersedes:null,...extra};}
export function ingest(w,value=template(),who=w.human){const current=w.store.read().head.templates.find(r=>r.id===value.templateId);const input={...value,revision:(current?.revision??0)+1,supersedes:current??null};const p=packet(w,'template.ingest',input,current?.revision??0);return {packet:p,result:ok(w.writer.command(who.token,p))};}
export function adoption(w,ref,{apps=['artistic','catalogue'],principalId=w.human.principalId,...extra}={}){
 const rows=[...w.store.read().records.values()].filter(x=>x.kind==='template-decision'&&x.value.template.id===ref.id).sort((a,b)=>a.value.expectedRevision-b.value.expectedRevision),last=rows.at(-1);
 const input={schemaVersion:'3djat.template-decision.v1',decisionId:randomUUID(),template:ref,action:'adopt',purpose:'Authored explicit untested scope',appliesTo:apps,expectedRevision:rows.length,experiment:null,outputs:[],evidenceReceipt:null,humanActionReceipt:{id:'placeholder',revision:1,path:'placeholder.json',sha256:'0'.repeat(64)},decidedAt:TIME,supersedesDecision:last?.reference??null,reason:'Authored human-bound action; no genuine approval',...extra};
 const p=packet(w,'template.adopt',input,rows.length);input.humanActionReceipt=templateDecisionActionReference({workspaceId:W,principalId,packet:p});return p;
}
export const adopt=(w,ref,options={})=>{const p=adoption(w,ref,options);return {packet:p,result:ok(w.writer.command(w.human.token,p))};};
export function query(w,kind='list',extra={}){return {schemaVersion:'3djat.template-query.v1',kind,atHead:w.store.read().reference,...(kind==='list'?{applicability:null}:kind==='template'?{templateId:'creative'}:{productId:P,applicability:'artistic',branded:false,brandTemplateId:null}),...extra};}
export const read=(w,kind='list',extra={})=>w.writer.readRegistry(w.human.token,query(w,kind,extra));
export const independent=(w,kind='list',extra={},accessFile=w.accessFile)=>readTemplateRegistry(w.root,{query:query(w,kind,extra),accessFile});
