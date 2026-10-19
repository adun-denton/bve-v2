// Inert authored bytes only. Retain every new root/failure; close handles only.
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {randomUUID,createHash} from 'node:crypto';
import {DomainStore} from '../../../src/domain-store.mjs';
import {DomainProducts,provisionProductPrincipal} from '../../../src/domain-products.mjs';
import {Kernel} from '../../../src/kernel.mjs';
export const PRODUCT='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',WORKSPACE='bbbbbbbb-bbbb-4bbb-9bbb-bbbbbbbbbbbb';
export const hash=b=>createHash('sha256').update(b).digest('hex');
export const ok=r=>{if(r.schemaVersion!=='3djat.result.v1')throw Error(JSON.stringify(r));return r;};
export function create(w,productId=PRODUCT){return {schemaVersion:'3djat.command.v1',operation:'product.create',key:randomUUID(),expected:{domainHead:w.store.read().reference,entityRevision:0},input:{productId,productCode:null,workingName:'محصول آزمایشی',note:'Authored only; no actual business approval'}};}
export function setup(t,{kernel=false,products='Products',hook=()=>{},workspaceHook=()=>{},Writer=DomainProducts}={}){
  const parent=process.env.J05C_EVIDENCE_ROOT??os.tmpdir();fs.mkdirSync(parent,{recursive:true});
  const dir=fs.mkdtempSync(path.join(parent,'j05c-authored-')),root=path.join(dir,'business'),sourceRoot=path.join(dir,'source'),runtime=path.join(dir,'runtime'),accessFile=path.join(dir,'access.json');
  const store=DomainStore.initialize(root,{workspaceId:WORKSPACE,sourceCommit:'d268a2d57c2463481e4920d1dd81dc080f33157e',paths:{business:'Business',products,templates:'Templates',operations:'Operations'}});
  for(const p of Object.values(store.workspace.paths))fs.mkdirSync(path.join(root,p),{recursive:true});fs.mkdirSync(sourceRoot);
  const human=provisionProductPrincipal(accessFile,{workspaceId:WORKSPACE,id:'authored-human',role:'human'}),source=provisionProductPrincipal(accessFile,{workspaceId:WORKSPACE,id:'authored-proposer',role:'source-proposer'}),conductor=provisionProductPrincipal(accessFile,{workspaceId:WORKSPACE,id:'authored-conductor',role:'conductor',products:[PRODUCT]});
  const attachmentSources={'authored-files':{root:sourceRoot,products:[PRODUCT]}};
  const w={dir,root,sourceRoot,runtime,accessFile,store,human,source,conductor,attachmentSources,k:null,c:null};
  w.writer=new Writer(root,{accessFile,attachmentSources,hook});
  w.config={schemaVersion:'3djat.connection.v1',workspaceId:WORKSPACE,domainRoot:root,runtimeRoot:runtime,paths:Object.fromEntries(Object.entries(store.workspace.paths).map(([k,p])=>[k,path.join(root,p)])),storage:'local-unsynced'};
  w.productOptions={accessFile,attachmentSources};
  if(kernel){w.k=new Kernel(runtime,{workspace:w.config,expectedHead:store.read().reference,products:w.productOptions,workspaceHook});w.c=JSON.parse(fs.readFileSync(path.join(runtime,'credentials.json')));}
  t.after(()=>{w.k?.close();fs.writeFileSync(path.join(dir,'FIXTURE-RETAINED.json'),JSON.stringify({scope:'AUTHORED_INERT_ATTACHMENT_ONLY',test:t.name,outcome:t.passed===false?'FAILED_OR_NOT_PASSED':'RETAINED',noAutomaticCleanup:true})+'\n');});
  fs.writeFileSync(path.join(dir,'unrelated-sentinel'),'AUTHORED_SENTINEL_UNCHANGED\n');
  ok(kernel?w.k.productCommand(w.c.human,create(w)):w.writer.command(human.token,create(w)));return w;
}
export function attachment(w,{data=Buffer.from('AUTHORED opaque bytes\0\xff\n'),filename='طرح آزمایشی.3mf',sourceLocation='input.raw',productId=PRODUCT,...extra}={}){
  const sourceFile=path.join(w.sourceRoot,sourceLocation);fs.mkdirSync(path.dirname(sourceFile),{recursive:true});fs.writeFileSync(sourceFile,data);
  const sha256=hash(data);return {schemaVersion:'3djat.attachment.v1',attachmentId:randomUUID(),productId,sha256,
    location:`${w.store.workspace.paths.products}/${productId}/Sources/${sha256}.bin`,filename,mime:'application/octet-stream',bytes:data.length,availability:'available',
    source:{kind:'file',sourceId:'authored-files',revision:'authored-r1',sha256,location:sourceLocation,locator:{kind:'section',section:'Authored inert file'},observedAt:'2026-01-01T00:00:00.000Z'},...extra};
}
export function packet(w,input,{head=w.store.read().reference,key=randomUUID(),revision=0}={}){return {schemaVersion:'3djat.command.v1',operation:'attachment.register',key,expected:{domainHead:head,entityRevision:revision},input};}
export const review=w=>w.writer.readReview(w.human.token,{productId:PRODUCT,atHead:w.store.read().reference});
export function large(w,bytes){
  const file=path.join(w.sourceRoot,'large.raw'),fd=fs.openSync(file,'wx'),buffer=Buffer.alloc(1024**2,0x51),h=createHash('sha256');let remaining=bytes;
  try{while(remaining){const n=Math.min(remaining,buffer.length);fs.writeSync(fd,buffer,0,n);h.update(buffer.subarray(0,n));remaining-=n;}}finally{fs.closeSync(fd);}
  const sha256=h.digest('hex');return {schemaVersion:'3djat.attachment.v1',attachmentId:randomUUID(),productId:PRODUCT,sha256,location:`${w.store.workspace.paths.products}/${PRODUCT}/Sources/${sha256}.bin`,filename:'authored-large.raw',mime:'application/octet-stream',bytes,availability:'available',source:{kind:'file',sourceId:'authored-files',revision:'r1',sha256,location:'large.raw',locator:{kind:'page',page:1},observedAt:'2026-01-01T00:00:00.000Z'}};
}
