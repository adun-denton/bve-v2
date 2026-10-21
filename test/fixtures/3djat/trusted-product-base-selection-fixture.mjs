// Disposable authored file authority only. Roots are retained with every outcome.
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {randomUUID,createHmac} from 'node:crypto';
import {DomainStore,prepareRecord} from '../../../src/domain-store.mjs';
import {DomainProducts,provisionProductPrincipal,decisionActionReference} from '../../../src/domain-products.mjs';
import {stable,digest,uuid} from '../../../src/domain-authority.mjs';
export const WORKSPACE='bbbbbbbb-bbbb-4bbb-9bbb-bbbbbbbbbbbb';
export const PRODUCT='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const roots=[];
export function world({authenticate=true,hook=()=>{}}={}){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pd1-authored-')),root=path.join(dir,'domain'),accessFile=path.join(dir,'access.json');
  roots.push(dir);const store=DomainStore.initialize(root,{workspaceId:WORKSPACE,sourceCommit:'fce2473202da3509ccc9f044863da9d90d6fde5d'});
  for(const p of Object.values(store.workspace.paths))fs.mkdirSync(path.join(root,p));
  const human=provisionProductPrincipal(accessFile,{workspaceId:WORKSPACE,id:'authored-human',role:'human',sourceIds:['authored-source']});
  const source=provisionProductPrincipal(accessFile,{workspaceId:WORKSPACE,id:'authored-source',role:'source-proposer',sourceIds:['authored-source']});
  const sourceBytes=Buffer.from('Author-created inert metadata source\n');fs.mkdirSync(path.join(root,'Sources'));fs.writeFileSync(path.join(root,'Sources/source.txt'),sourceBytes);
  const ref={kind:'file',sourceId:'authored-source',revision:'r1',sha256:digest(sourceBytes),location:'Sources/source.txt',locator:{kind:'page',page:1,section:'Authored'},observedAt:'2026-01-01T00:00:00.000Z'};
  const auth=token=>token===human.token?{id:human.principalId,role:'human',products:[PRODUCT],sourceIds:['authored-source']}:token===source.token?{id:source.principalId,role:'source-proposer',products:[PRODUCT],sourceIds:['authored-source']}:null;
  const w={dir,root,accessFile,store,human,source,ref,auth,writer:null};
  w.writer=new DomainProducts(root,{accessFile,authenticate:authenticate?token=>{hook();return w.auth(token);}:null});return w;
}
export function packet(w,operation,input,{key=randomUUID(),head=w.store.read().reference,revision}={}){
  revision??=w.store.read().head.products.find(x=>x.productId===input.productId)?.dossier.revision??0;
  return {schemaVersion:'3djat.command.v1',operation,key,expected:{domainHead:head,entityRevision:revision},input};
}
export const create=(w,extra={})=>packet(w,'product.create',{productId:PRODUCT,productCode:null,workingName:'Original authored name',...extra});
export const note=(w,text='Later note')=>packet(w,'product.note.add',{productId:PRODUCT,text});
export function proposal(w,field='material',fact={state:'accepted',value:'Installed material',sourceRefs:[w.ref]},corrects=null){
  return packet(w,'product.proposal.submit',{schemaVersion:'3djat.proposal.v1',proposalId:randomUUID(),productId:PRODUCT,expectedRevision:w.store.read().head.products.find(x=>x.productId===PRODUCT).dossier.revision,changes:[{field,fact}],reason:'Authored claim',corrects});
}
export function decision(w,ref,outcome='accepted',{correctedProposal=null,supersedesDecision=null}={}){
  const input={schemaVersion:'3djat.proposal-decision.v1',decisionId:randomUUID(),productId:PRODUCT,proposal:ref,expectedRevision:w.store.read().head.products.find(x=>x.productId===PRODUCT).dossier.revision,outcome,reason:'Authored disposition',decidedAt:'2026-01-01T00:00:00.000Z',humanActionReceipt:{id:'placeholder',revision:1,path:'placeholder.json',sha256:'0'.repeat(64)},supersedesDecision,correctedProposal};
  const p=packet(w,'product.proposal.decide',input);input.humanActionReceipt=decisionActionReference({workspaceId:WORKSPACE,principalId:w.human.principalId,packet:p});return p;
}
export function send(w,p,actor=w.human){const r=w.writer.command(actor.token,p);if(r.schemaVersion!=='3djat.result.v1')throw Error('Authored writer failure: '+r.error.code);return r;}
export function read(w,mode='new',atHead=w.store.read().reference,token=w.human.token){return w.writer.resolveBaseProductForOperation(token,{mode,atHead,productId:PRODUCT});}
export function editPolicy(w,edit){const a=JSON.parse(fs.readFileSync(w.accessFile));edit(a);fs.writeFileSync(w.accessFile,stable(a)+'\n');}
export function forgedNote(w,{role='human',eventEdit=()=>{},macEdit=x=>x,recordsExtra=[],noteEdit=x=>x}={}){
  const before=w.store.read(),p=note(w,'Forged fixture note'),time='2026-01-01T00:00:00.000Z',principalId=w.human.principalId;
  const event={id:uuid(stable([WORKSPACE,principalId,p.operation,p.key])),version:1,type:'product-action',workspaceId:WORKSPACE,principalId,operation:p.operation,key:p.key,productId:PRODUCT,commandHash:digest(stable(p)),recordedAt:time};eventEdit(event);
  const policy=JSON.parse(fs.readFileSync(w.accessFile)),mac=macEdit(createHmac('sha256',policy.key).update(stable({role,event})).digest('hex'));
  const audit={schemaVersion:'3djat.evidence.v1',id:event.id,revision:1,description:stable({format:'3djat.product-action.v1',role,event,mac})};
  const ar=prepareRecord('evidence',audit).reference,old=before.records.get(before.head.products.find(x=>x.productId===PRODUCT).dossier.path).value;
  const next=structuredClone(old);next.revision++;next.sourceReceipt=ar;next.notes.push(noteEdit({id:uuid(event.id+'note'),text:p.input.text,createdAt:time,receipt:ar}));
  w.store.commit({principal:principalId,operation:p.operation,key:p.key,expectedHead:before.reference,changes:[{kind:'product',id:PRODUCT,expectedRevision:old.revision,record:next}],records:[{kind:'evidence',record:audit},...recordsExtra]});
  return before.reference;
}
