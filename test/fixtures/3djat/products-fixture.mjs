// Disposable authored data only; no actual human/source approval or native session.
import * as fs from 'node:fs';import * as path from 'node:path';import * as os from 'node:os';
import {randomUUID,createHash} from 'node:crypto';
import {DomainStore} from '../../../src/domain-store.mjs';
import {DomainProducts,provisionProductPrincipal,decisionActionReference} from '../../../src/domain-products.mjs';
import {Kernel} from '../../../src/kernel.mjs';
export const WORKSPACE='bbbbbbbb-bbbb-4bbb-9bbb-bbbbbbbbbbbb',PRODUCT='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export function setup(t,{kernel=false,hook=()=>{},workspaceHook=()=>{}}={}){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'j04-authored-')),root=path.join(dir,'business'),runtime=path.join(dir,'runtime'),accessFile=path.join(dir,'access.json');
  const store=DomainStore.initialize(root,{workspaceId:WORKSPACE,sourceCommit:'2d356f13f888ef1e13c164dc0360c215b9e557c6'});
  for(const p of Object.values(store.workspace.paths))fs.mkdirSync(path.join(root,p));
  const human=provisionProductPrincipal(accessFile,{workspaceId:WORKSPACE,id:'authored-human',role:'human'}),source=provisionProductPrincipal(accessFile,{workspaceId:WORKSPACE,id:'authored-source',role:'source-proposer',sourceIds:['authored-source']});
  const sourceBytes=Buffer.from('Authored source: fixture material only, no real product fact.\n');fs.mkdirSync(path.join(root,'Sources'));fs.writeFileSync(path.join(root,'Sources/authored.txt'),sourceBytes);
  const ref={kind:'file',sourceId:'authored-source',revision:'r1',sha256:createHash('sha256').update(sourceBytes).digest('hex'),location:'Sources/authored.txt',locator:{kind:'page',page:1,section:'Authored fixture'},observedAt:'2026-01-01T00:00:00.000Z'};
  const config={schemaVersion:'3djat.connection.v1',workspaceId:WORKSPACE,domainRoot:root,runtimeRoot:runtime,paths:Object.fromEntries(Object.entries(store.workspace.paths).map(([k,v])=>[k,path.join(root,v)])),storage:'local-unsynced'};
  const w={dir,root,runtime,accessFile,store,human,source,ref,config,k:null,c:null,writer:new DomainProducts(root,{accessFile,hook})};
  if(kernel){w.k=new Kernel(runtime,{workspace:config,expectedHead:store.read().reference,products:{accessFile},workspaceHook});w.c=JSON.parse(fs.readFileSync(path.join(runtime,'credentials.json')));}
  t.after(()=>{w.k?.close();fs.rmSync(dir,{recursive:true,force:true});});return w;
}
export function packet(w,operation,input,{key=randomUUID(),head=w.store.read().reference,revision}={}){
  const view=w.store.read();revision??=view.head.products.find(x=>x.productId===input.productId)?.dossier.revision??0;
  return {schemaVersion:'3djat.command.v1',operation,key,expected:{domainHead:head,entityRevision:revision},input};
}
export const create=(w,extra={})=>packet(w,'product.create',{productId:PRODUCT,productCode:null,workingName:'Authored working name',...extra});
export function proposal(w,{productId=PRODUCT,field='material',fact={state:'accepted',value:'Authored fixture material',sourceRefs:[w.ref]},corrects=null}={}){
  const revision=w.store.read().head.products.find(x=>x.productId===productId).dossier.revision;
  return packet(w,'product.proposal.submit',{schemaVersion:'3djat.proposal.v1',proposalId:randomUUID(),productId,expectedRevision:revision,changes:[{field,fact}],reason:'Authored source proposal only',corrects});
}
export function decision(w,p,outcome,{principalId=w.human.principalId,supersedesDecision=null,correctedProposal=null,...options}={}){
  const productId=p.record?.productId??PRODUCT,revision=w.store.read().head.products.find(x=>x.productId===productId).dossier.revision;
  const input={schemaVersion:'3djat.proposal-decision.v1',decisionId:randomUUID(),productId,proposal:p.reference??p,expectedRevision:revision,outcome,reason:'Authored human-scoped fixture decision; not real approval',decidedAt:'2026-01-01T00:00:00.000Z',humanActionReceipt:{id:'placeholder',revision:1,path:'placeholder.json',sha256:'0'.repeat(64)},supersedesDecision,correctedProposal};
  const command=packet(w,'product.proposal.decide',input,options);input.humanActionReceipt=decisionActionReference({workspaceId:WORKSPACE,principalId,packet:command});return command;
}
export const review=w=>w.writer.readReview(w.human.token,{productId:PRODUCT,atHead:w.store.read().reference});
