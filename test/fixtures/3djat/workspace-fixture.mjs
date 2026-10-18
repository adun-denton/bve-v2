// Authored roots and metadata; never an operating installation or private business data.
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { DomainStore, prepareRecord } from '../../../src/domain-store.mjs';
import { Kernel } from '../../../src/kernel.mjs';
import { WORKSPACE, PRODUCT, plan, noop, product } from './domain-store-fixture.mjs';
export { WORKSPACE, PRODUCT, noop, product };
export function prepared(t,{connect=true,attachment=false,hook=()=>{}}={}) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'j03b-authored-')),domainRoot=path.join(dir,'business-root'),runtimeRoot=path.join(dir,'private-runtime');
  let w=null;t.after(()=>{w?.k?.close();fs.rmSync(dir,{recursive:true,force:true});});
  const store=DomainStore.initialize(domainRoot,{workspaceId:WORKSPACE,sourceCommit:'9c037aaaacfb84b663227c874ce6ce1de61b42e4'});
  for(const p of Object.values(store.workspace.paths))fs.mkdirSync(path.join(domainRoot,p));
  const input=plan(store.read().reference);let attachmentBytes=null,attachmentRecord=null;
  if(attachment){attachmentBytes=Buffer.from('Authored attachment original bytes only.\n');fs.mkdirSync(path.join(domainRoot,'Attachments'));
    fs.writeFileSync(path.join(domainRoot,'Attachments','authored.txt'),attachmentBytes);
    const source={kind:'file',sourceId:'authored-source-file',revision:'r1',sha256:hashBytes(attachmentBytes),location:'Sources/absent-source.txt',locator:{kind:'page',page:1},observedAt:'2026-01-01T00:00:00.000Z'};
    attachmentRecord={schemaVersion:'3djat.attachment.v1',attachmentId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',productId:PRODUCT,
      sha256:(hashBytes(attachmentBytes)),location:'Attachments/authored.txt',filename:'authored.txt',mime:'text/plain',bytes:attachmentBytes.length,availability:'available',source};
    input.records.push({kind:'attachment',record:attachmentRecord});input.changes[0].record.attachments=[prepareRecord('attachment',attachmentRecord).reference];
  }
  store.commit(input);
  const paths=Object.fromEntries(Object.entries(store.workspace.paths).map(([k,v])=>[k,path.join(domainRoot,v)]));
  const config={schemaVersion:'3djat.connection.v1',workspaceId:WORKSPACE,domainRoot,runtimeRoot,paths,storage:'local-unsynced'};
  w={dir,domainRoot,runtimeRoot,store,config,attachmentBytes,attachmentRecord,k:null,c:null};
  if(connect){w.k=new Kernel(runtimeRoot,{workspace:config,expectedHead:store.read().reference,workspaceHook:hook});w.c=JSON.parse(fs.readFileSync(path.join(runtimeRoot,'credentials.json')));}
  w.call=(role,op,input,key=randomUUID())=>w.k.call(w.c[role],op,key,input);return w;
}
import { createHash, randomUUID } from 'node:crypto';
const hashBytes=b=>createHash('sha256').update(b).digest('hex');
export function adoption(w,key='authored-adoption',revision=0) {
  const head=w.store.read().reference;return {schemaVersion:'3djat.command.v1',operation:'workspace.adopt',key,expected:{domainHead:head,entityRevision:revision},
    input:{...structuredClone(w.store.workspace),revision:revision+1,domainHead:head}};
}

export function readyRound(w,projectId=PRODUCT){
  const c=w.k.bindSession(w.c,{role:'conductor',tier:'SOL',sessionId:'authored-conductor-'+projectId,projectId,nonce:'authored-c',hostReceipt:'Authored only; no native session'});
  const b=w.k.bindSession(w.c,{role:'butler',tier:'LUNA',sessionId:'authored-butler-'+projectId,projectId,nonce:'authored-b',hostReceipt:'Authored only; no native session'});
  w.k.call(c.token,'host.resume','resume-c',{nonce:'authored-c'});w.k.call(b.token,'host.resume','resume-b',{nonce:'authored-b'});
  const round=w.k.call(c.token,'round.create','authored-round',{projectId,operation:'organize',intent:'Authored organize existing records',butlerInstructions:'Authored folder preparation only'});
  w.k.call(b.token,'statement.report','authored-ready',{statementId:round.statementId,status:'ready',text:'Authored fixture ready; not native readiness'});return {round,c,b};
}
