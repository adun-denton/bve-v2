// Disposable authored source and retained roots. No fixture cleanup callbacks.
import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {Kernel} from '../src/kernel.mjs';
import {DomainStore} from '../src/domain-store.mjs';
import {provisionProductPrincipal} from '../src/domain-products.mjs';
import {hash} from '../src/png.mjs';
import {png} from './fixtures/3djat/import-fixture.mjs';

const WORKSPACE='bbbbbbbb-bbbb-4bbb-9bbb-bbbbbbbbbbbb',PRODUCT='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
let named=0,subcases=0,assertions=0,generated=0;
const A=(actual,expected)=>{assertions++;assert.deepEqual(actual,expected);};
const ok=value=>{assertions++;assert.ok(value);};
const fault=(fn,code)=>{assertions++;assert.throws(fn,e=>e.code===code,code);};
const caseOf=(name,fn)=>test(name,()=>{named++;return fn();});
const sub=(label,fn)=>{subcases++;process.stdout.write(`SD1_SUBCASE ${subcases} ${label}\n`);return fn();};
after(()=>{process.stdout.write(`SD1_COUNTS named=${named} subcases=${subcases} assertions=${assertions} generated=${generated}\n`);
  assert.ok(named<=32&&subcases<=96&&assertions<=260&&generated<=64*1024**2);});

function fixture({hook=()=>{}}={}){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sd1-authored-'));
  const domain=path.join(dir,'business'),runtime=path.join(dir,'runtime'),accessFile=path.join(dir,'access.json'),sourceRoot=path.join(dir,'intake');
  const store=DomainStore.initialize(domain,{workspaceId:WORKSPACE,sourceCommit:'2d356f13f888ef1e13c164dc0360c215b9e557c6'});
  for(const p of Object.values(store.workspace.paths))fs.mkdirSync(path.join(domain,p));
  provisionProductPrincipal(accessFile,{workspaceId:WORKSPACE,id:'authored-human',role:'human'});
  fs.mkdirSync(sourceRoot);
  const config={schemaVersion:'3djat.connection.v1',workspaceId:WORKSPACE,domainRoot:domain,runtimeRoot:runtime,
    paths:Object.fromEntries(Object.entries(store.workspace.paths).map(([k,v])=>[k,path.join(domain,v)])),storage:'local-unsynced'};
  const w={dir,domain,runtime,accessFile,sourceRoot,store,config,k:null,c:null};
  w.k=new Kernel(runtime,{workspace:config,expectedHead:store.read().reference,products:{accessFile},
    imports:{sources:{'authored-png':sourceRoot}},workspaceHook:hook});
  w.c=JSON.parse(fs.readFileSync(path.join(runtime,'credentials.json')));
  const p={schemaVersion:'3djat.command.v1',operation:'product.create',key:randomUUID(),
    expected:{domainHead:store.read().reference,entityRevision:0},input:{productId:PRODUCT,productCode:null,workingName:'Authored product'}};
  const created=w.k.productCommand(w.c.human,p);assert.equal(created.schemaVersion,'3djat.result.v1',JSON.stringify(created));
  const binding=w.k.bindSession(w.c,{role:'conductor',tier:'SOL',sessionId:'authored-conductor-'+randomUUID(),projectId:PRODUCT,
    nonce:'authored-challenge',hostReceipt:'Authored only; no native binding'});
  w.binding=binding;
  return w;
}
function importOne(w,raw=png(),extra={}){
  const importId=randomUUID(),filename=`authored-${importId}.png`;fs.writeFileSync(path.join(w.sourceRoot,filename),raw);generated+=raw.length;
  const input={schemaVersion:'3djat.historical-import.v1',importId,productId:PRODUCT,origin:'import',kind:'historical-base',filename,
    source:{kind:'file',sourceId:'authored-png',revision:'r1',sha256:hash(raw),location:filename,
      locator:{kind:'section',section:'Authored'},observedAt:'2026-01-01T00:00:00.000Z'},
    sha256:hash(raw),encodedBytes:raw.length,format:'image/png',width:8,height:6,bitDepth:8,interlaced:false,
    historicalParent:null,historicalApproval:null,importedAt:'2026-01-01T00:00:00.000Z',...extra};
  if(input.historicalApproval?.evidence.length===0)input.historicalApproval.evidence=[input.source];
  const stage={schemaVersion:'3djat.command.v1',operation:'asset.import.stage',key:randomUUID(),
    expected:{domainHead:w.store.read().reference,entityRevision:0},input};
  const s=w.k.assetCommand(w.c.human,stage);assert.equal(s.schemaVersion,'3djat.result.v1',JSON.stringify(s));
  const commit={schemaVersion:'3djat.command.v1',operation:'asset.import.commit',key:randomUUID(),
    expected:{domainHead:w.store.read().reference,entityRevision:1},input:{importId,stageReceipt:s.receipt,sha256:input.sha256}};
  const c=w.k.assetCommand(w.c.human,commit);assert.equal(c.schemaVersion,'3djat.result.v1',JSON.stringify(c));
  const a=w.k.importReview(w.c.human,importId).artifact;
  return {a,raw,filename,stage,commit,s,c};
}
const source=a=>({artifact:{productId:a.projectId,artifactId:a.id,version:a.version,sha256:a.sha256,width:a.width,height:a.height},role:'reference',regions:[]});
const query=(w,items)=>({mode:'historical',atHead:w.store.read().reference,projectId:PRODUCT,sources:items,
  parentRoundId:null,parentArtifacts:[]});
function db(w,fn){const d=new DatabaseSync(path.join(w.runtime,'workspace.sqlite'));try{return fn(d);}finally{d.close();}}
function change(w,kind,id,mutate){db(w,d=>{const row=d.prepare('SELECT doc FROM records WHERE kind=? AND id=?').get(kind,id);
  const x=JSON.parse(row.doc);mutate(x);d.prepare('UPDATE records SET doc=? WHERE kind=? AND id=?').run(JSON.stringify(x),kind,id);});}
function receiptChange(w,scope,key,mutate){db(w,d=>{const row=d.prepare('SELECT fingerprint,doc FROM receipts WHERE scope=? AND key=?').get(scope,key),x=JSON.parse(row.doc);
  mutate(x,row);d.prepare('UPDATE receipts SET doc=?,fingerprint=? WHERE scope=? AND key=?').run(JSON.stringify(x),row.fingerprint,scope,key);});}
function inspected(w,a){return w.k.inspectImportedOriginalSources(w.binding.token,query(w,[source(a)]));}

caseOf('authentic stage and commit prove exact captured original, no permission or approval',()=>{
  const w=fixture();try{const x=importOne(w),r=inspected(w,x.a);sub('authentic',()=>{
    A(r.authority,'not-established');A(r.freshAcceptance,false);A(r.historicalClaims,'unverified');
    A(r.sources[0].bytes.measured.encodedBytes,x.raw.length);A(r.sources[0].bytes.measured.sha256,hash(x.raw));
    ok(!JSON.stringify(r).includes(x.raw.toString('base64')));ok(!Object.hasOwn(r,'ready'));
    fs.unlinkSync(path.join(w.sourceRoot,x.filename));A(inspected(w,x.a).sources[0].bytes.status,'verified');
  });}finally{w.k.close();}
});
caseOf('preflight rejects nonportable and unknown input without DB access',()=>{
  const w=fixture();const x=importOne(w),q=query(w,[source(x.a)]);w.k.close();
  sub('unknown',()=>fault(()=>w.k.inspectImportedOriginalSources(x.raw,{...q,db:'/tmp'}),'INVALID_VALUE'));
  sub('getter',()=>fault(()=>w.k.inspectImportedOriginalSources(x.raw,{...q,get evil(){throw Error('read');}}),'INVALID_VALUE'));
  sub('proxy',()=>fault(()=>w.k.inspectImportedOriginalSources(x.raw,new Proxy(q,{get(){throw Error('trap');}})),'INVALID_VALUE'));
  sub('malformed uuid',()=>fault(()=>w.k.inspectImportedOriginalSources(x.raw,{...q,projectId:'not-a-uuid'}),'OUT_OF_BOUNDS'));
});
caseOf('session scope rejects global, unbound, revoked and wrong project bindings',()=>{
  const w=fixture();try{const x=importOne(w),q=query(w,[source(x.a)]);
    sub('global',()=>fault(()=>w.k.inspectImportedOriginalSources(w.c.human,q),'INVALID_SCOPE'));
    sub('unbound',()=>fault(()=>w.k.inspectImportedOriginalSources('0'.repeat(64),q),'INVALID_SCOPE'));
    sub('bad length',()=>fault(()=>w.k.inspectImportedOriginalSources('bad',q),'INVALID_SCOPE'));
    change(w,'sessionBinding',w.binding.id,v=>v.revokedAt='2026-01-01T00:00:00.000Z');
    sub('revoked',()=>fault(()=>inspected(w,x.a),'INVALID_SCOPE'));
  }finally{w.k.close();}
});
caseOf('region geometry is strict; unsupported review and parents refuse',()=>{
  const w=fixture();try{const x=importOne(w),q=query(w,[source(x.a)]);
    q.sources[0].regions=[{space:'normalized-original',x:0.1,y:0.2,w:0.4,h:0.3,meaning:'Authored attribution'}];
    sub('valid region',()=>A(w.k.inspectImportedOriginalSources(w.binding.token,q).sources[0].source.regions,q.sources[0].regions));
    const edge=structuredClone(q);edge.sources[0].regions[0].w=0.9000001;
    sub('strict edge',()=>fault(()=>w.k.inspectImportedOriginalSources(w.binding.token,edge),'OUT_OF_BOUNDS'));
    const zero=structuredClone(q);zero.sources[0].regions[0].w=0;
    sub('zero width',()=>fault(()=>w.k.inspectImportedOriginalSources(w.binding.token,zero),'OUT_OF_BOUNDS'));
    const review=structuredClone(q);review.sources[0].regions[0].reviewRegion={reviewId:randomUUID(),index:0};
    sub('review',()=>fault(()=>w.k.inspectImportedOriginalSources(w.binding.token,review),'CAPABILITY_UNAVAILABLE'));
    sub('query parent',()=>fault(()=>w.k.inspectImportedOriginalSources(w.binding.token,{...q,parentRoundId:randomUUID()}),'CAPABILITY_UNAVAILABLE'));
  }finally{w.k.close();}
});
caseOf('missing selected BLOB is a blocker; changed length and hash refuse whole lookup',()=>{
  const w=fixture();try{const x=importOne(w),q=query(w,[source(x.a)]);
    db(w,d=>d.prepare('DELETE FROM bytes WHERE hash=?').run(x.a.sha256));
    sub('missing',()=>A(w.k.inspectImportedOriginalSources(w.binding.token,q).sources[0].bytes,
      {status:'missing',cause:'MISSING_SOURCE',measured:null}));
    db(w,d=>d.prepare('INSERT INTO bytes VALUES(?,?)').run(x.a.sha256,Buffer.from('short')));
    sub('length before fetch',()=>fault(()=>inspected(w,x.a),'HASH_MISMATCH'));
    db(w,d=>d.prepare('UPDATE bytes SET data=? WHERE hash=?').run(Buffer.alloc(x.raw.length,0),x.a.sha256));
    sub('actual digest',()=>fault(()=>inspected(w,x.a),'HASH_MISMATCH'));
  }finally{w.k.close();}
});
caseOf('PNG corruption after correct stored hash refuses without availability downgrade',()=>{
  const w=fixture();try{const x=importOne(w),broken=Buffer.from(x.raw);broken[broken.length-1]^=1;
    // The selected hash remains fixed; a corrupt BLOB must refuse, not become missing.
    db(w,d=>d.prepare('UPDATE bytes SET data=? WHERE hash=?').run(broken,x.a.sha256));
    sub('corrupt bytes',()=>fault(()=>inspected(w,x.a),'HASH_MISMATCH'));
  }finally{w.k.close();}
});
caseOf('stage identity and immutable wrapper contradictions refuse',()=>{
  for(const [label,kind,mutate] of [
    ['stage workspace','assetImport',v=>v.workspaceId=randomUUID()],
    ['stage state','assetImport',v=>v.state='staged'],
    ['artifact size','artifact',v=>v.size++],
    ['declaration payload','importDeclaration',v=>v.payload.width++],
    ['origin payload','importOrigin',v=>v.payload.provenance.origin='produced']]){
    const w=fixture();try{const x=importOne(w);change(w,kind,kind==='assetImport'||kind==='importDeclaration'?x.a.importId:x.a.id,mutate);
      sub(label,()=>fault(()=>inspected(w,x.a),kind==='importDeclaration'||kind==='importOrigin'?'EVIDENCE_MISMATCH':'EVIDENCE_MISMATCH'));
    }finally{w.k.close();}
  }
});
caseOf('typed receipt, deterministic ID and idempotency fingerprint contradictions refuse',()=>{
  for(const [label,mutate] of [
    ['stage operation',v=>v.payload.operation='asset.import.commit'],
    ['receipt key',v=>v.payload.key='different-key'],
    ['receipt ID',v=>v.id=randomUUID()]]){
    const w=fixture();try{const x=importOne(w);change(w,'importReceipt',x.s.receipt.id,mutate);
      sub(label,()=>fault(()=>inspected(w,x.a),'EVIDENCE_MISMATCH'));
    }finally{w.k.close();}
  }
  const w=fixture();try{const x=importOne(w),stage=w.k.importReview(w.c.human,x.a.importId).stage;
    db(w,d=>d.prepare('UPDATE receipts SET fingerprint=? WHERE key=?').run('0'.repeat(64),x.stage.key));
    sub('fingerprint',()=>fault(()=>inspected(w,x.a),'EVIDENCE_MISMATCH'));
  }finally{w.k.close();}
});
caseOf('six unique artifacts count all occurrences and seventh or duplicate refuses',()=>{
  const w=fixture();try{const xs=Array.from({length:6},(_,i)=>importOne(w,png({color:[0,2,4,6,0,2][i]})));
    const q=query(w,xs.map(x=>source(x.a)));
    sub('six',()=>A(w.k.inspectImportedOriginalSources(w.binding.token,q).sources.length,6));
    sub('seven',()=>fault(()=>w.k.inspectImportedOriginalSources(w.binding.token,{...q,sources:[...q.sources,q.sources[0]]}),'OUT_OF_BOUNDS'));
    sub('duplicate',()=>fault(()=>w.k.inspectImportedOriginalSources(w.binding.token,{...q,sources:[q.sources[0],q.sources[0]]}),'INVALID_VALUE'));
  }finally{w.k.close();}
});
caseOf('unsupported imported historical parent and produced origin refuse',()=>{
  const w=fixture();try{const base=importOne(w),child=importOne(w,png({color:6}),
    {historicalParent:source(base.a).artifact,kind:'historical-creative'});
    sub('declared parent',()=>fault(()=>inspected(w,child.a),'CAPABILITY_UNAVAILABLE'));
    change(w,'artifact',base.a.id,v=>v.origin='produced');
    sub('produced',()=>fault(()=>inspected(w,base.a),'CAPABILITY_UNAVAILABLE'));
  }finally{w.k.close();}
});
caseOf('historical approval remains an unverified claim',()=>{
  const w=fixture();try{const x=importOne(w,png(),{historicalApproval:{origin:'historical',claimedApprover:null,
    claimedAt:null,evidence:[]}});
    sub('claim',()=>{const r=inspected(w,x.a);A(r.historicalClaims,'unverified');A(r.freshAcceptance,false);});
  }finally{w.k.close();}
});
caseOf('format and selected head failures preserve first codes',()=>{
  const w=fixture();try{const x=importOne(w),q=query(w,[source(x.a)]);
    const stale=structuredClone(q);stale.atHead={...stale.atHead,sha256:'0'.repeat(64)};
    sub('unreachable head',()=>fault(()=>w.k.inspectImportedOriginalSources(w.binding.token,stale),'MISSING_SOURCE'));
    change(w,'assetImportFormat','active',v=>v.version=99);
    sub('format',()=>fault(()=>inspected(w,x.a),'UNSUPPORTED_SCHEMA'));
  }finally{w.k.close();}
});
caseOf('role tier and project identity mutations independently refuse',()=>{
  for(const [label,mutate] of [
    ['role',v=>v.role='butler'],['tier',v=>v.tier='LUNA'],['project',v=>v.projectId=randomUUID()]]){
    const w=fixture();try{const x=importOne(w);change(w,'sessionBinding',w.binding.id,mutate);
      sub(label,()=>fault(()=>inspected(w,x.a),'INVALID_SCOPE'));
    }finally{w.k.close();}
  }
});
caseOf('a reachable older selected head remains historical after a current product note',()=>{
  const w=fixture();try{const x=importOne(w),q=query(w,[source(x.a)]),old=q.atHead;
    const p={schemaVersion:'3djat.command.v1',operation:'product.note.add',key:randomUUID(),
      expected:{domainHead:old,entityRevision:1},input:{productId:PRODUCT,text:'Authored later note'}};
    const result=w.k.productCommand(w.c.human,p);A(result.schemaVersion,'3djat.result.v1');
    sub('reachable old head',()=>{const r=w.k.inspectImportedOriginalSources(w.binding.token,q);
      A(r.head,old);A(r.sources[0].bytes.status,'verified');});
  }finally{w.k.close();}
});
caseOf('selected receipt result contradiction refuses and a pure read retains logical rows',()=>{
  const w=fixture();try{const x=importOne(w),before=db(w,d=>['records','receipts','bytes'].map(t=>
    d.prepare(`SELECT * FROM ${t} ORDER BY 1,2`).all().map(row=>Object.values(row).map(v=>
      Buffer.isBuffer(v)?hash(v):v))));
    sub('logical read equality',()=>{const r=inspected(w,x.a);A(r.sources[0].bytes.status,'verified');
      const after=db(w,d=>['records','receipts','bytes'].map(t=>d.prepare(`SELECT * FROM ${t} ORDER BY 1,2`).all().map(row=>
        Object.values(row).map(v=>Buffer.isBuffer(v)?hash(v):v))));A(after,before);
      r.sources[0].bytes.status='changed by caller';A(inspected(w,x.a).sources[0].bytes.status,'verified');});
    const receipt=db(w,d=>d.prepare('SELECT scope,key FROM receipts WHERE key=?').get(x.commit.key));
    receiptChange(w,receipt.scope,receipt.key,v=>v.owner='elsewhere');
    sub('result doc',()=>fault(()=>inspected(w,x.a),'EVIDENCE_MISMATCH'));
  }finally{w.k.close();}
});
caseOf('same bytes in distinct imported IDs are each inspected',()=>{
  let opens=0;const w=fixture({hook:stage=>{if(stage==='after-imported-original-bytes')opens++;}});
  try{const raw=png(),a=importOne(w,raw),b=importOne(w,raw);
    sub('same hash different IDs',()=>{const r=w.k.inspectImportedOriginalSources(w.binding.token,
      query(w,[source(a.a),source(b.a)]));A(r.sources.length,2);A(opens,2);
      A(r.sources[0].bytes.measured.sha256,r.sources[1].bytes.measured.sha256);
      ok(r.sources[0].import.importId!==r.sources[1].import.importId);});
  }finally{w.k.close();}
});
caseOf('trusted callback revocation before BLOB fetch refuses and retains no inspection write',()=>{
  let w=null,changed=false;
  w=fixture({hook:stage=>{if(stage==='before-imported-original-bytes'&&!changed){changed=true;
    w.k.bindSession(w.c,{role:'conductor',tier:'SOL',sessionId:'replacement-'+randomUUID(),projectId:PRODUCT,
      nonce:'authored-replacement',hostReceipt:'Authored callback only',replace:true});}}});
  try{const x=importOne(w);
    sub('revoked before fetch',()=>fault(()=>inspected(w,x.a),'INVALID_SCOPE'));
    A(changed,true);
  }finally{w.k.close();}
});
caseOf('integration and project workspace are checked independently of imported stage scope',()=>{
  for(const [label,kind,mutate] of [
    ['project workspace','project',v=>v.domainWorkspaceId=randomUUID()],
    ['integration config','domainIntegration',v=>v.config.workspaceId=randomUUID()]]){
    const w=fixture();try{const x=importOne(w);change(w,kind,kind==='project'?PRODUCT:'active',mutate);
      sub(label,()=>fault(()=>inspected(w,x.a),'INVALID_SCOPE'));
    }finally{w.k.close();}
  }
});
caseOf('immutable wrapper path and revision and commit receipt faults are distinct',()=>{
  for(const [label,kind,idFrom,mutate] of [
    ['declaration path','importDeclaration',x=>x.a.importId,v=>v.reference.path='Operational/elsewhere.json'],
    ['origin revision','importOrigin',x=>x.a.id,v=>v.revision=2],
    ['commit receipt operation','importReceipt',x=>x.c.receipt.id,v=>v.payload.operation='asset.import.stage']]){
    const w=fixture();try{const x=importOne(w);change(w,kind,idFrom(x),mutate);
      sub(label,()=>fault(()=>inspected(w,x.a),'EVIDENCE_MISMATCH'));
    }finally{w.k.close();}
  }
});
caseOf('missing immutable provenance, changed receipt scope, and stage actor do not become byte blockers',()=>{
  for(const label of ['missing artifact ref','receipt scope','stage principal']){
    const w=fixture();try{const x=importOne(w);
      if(label==='missing artifact ref')db(w,d=>d.prepare("DELETE FROM records WHERE kind='importArtifact' AND id=?").run(x.a.id));
      else if(label==='receipt scope')db(w,d=>d.prepare('UPDATE receipts SET scope=? WHERE key=?').run('foreign-scope',x.stage.key));
      else change(w,'assetImport',x.a.importId,v=>v.principalId='other-principal');
      sub(label,()=>fault(()=>inspected(w,x.a),label==='stage principal'?'EVIDENCE_MISMATCH':'MISSING_SOURCE'));
    }finally{w.k.close();}
  }
});
caseOf('installed image policy mismatch refuses before a source report',()=>{
  const w=fixture();try{const x=importOne(w),marker=path.join(w.runtime,'bve-v2-root.json');
    const m=JSON.parse(fs.readFileSync(marker));fs.writeFileSync(marker,JSON.stringify({...m,version:3,
      features:['historical-import.v1','png20-experiment.v1']}));
    sub('marker without matching DB opt-in',()=>fault(()=>inspected(w,x.a),'UNSUPPORTED_SCHEMA'));
  }finally{w.k.close();}
});
caseOf('actual short BLOB refuses before a verified byte completion callback',()=>{
  let afterBytes=0;const w=fixture({hook:stage=>{if(stage==='after-imported-original-bytes')afterBytes++;}});
  try{const x=importOne(w);db(w,d=>d.prepare('UPDATE bytes SET data=? WHERE hash=?').run(Buffer.from('short'),x.a.sha256));
    sub('preallocation length',()=>{fault(()=>inspected(w,x.a),'HASH_MISMATCH');A(afterBytes,0);});
  }finally{w.k.close();}
});
