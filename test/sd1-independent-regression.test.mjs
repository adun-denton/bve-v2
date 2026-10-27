// Adapted from the v44 independent S01/S02 counterexamples with additional
// authored byte-fetch, decoder and coherent-receipt regressions. Retain roots.
import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';import * as path from 'node:path';import * as os from 'node:os';
import {randomUUID} from 'node:crypto';import {DatabaseSync} from 'node:sqlite';
import {Kernel} from '../src/kernel.mjs';import {DomainStore} from '../src/domain-store.mjs';
import {provisionProductPrincipal} from '../src/domain-products.mjs';import {hash} from '../src/png.mjs';
import {png} from './fixtures/3djat/import-fixture.mjs';
const WORKSPACE='bbbbbbbb-bbbb-4bbb-9bbb-bbbbbbbbbbbb',PRODUCT='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
let assertions=0,generated=0;const equal=(...args)=>{assertions++;assert.equal(...args);};
after(()=>{console.log('SD1_WRAPPED_EQUAL_CALLS='+assertions+'; fixture and direct assertions are additional');});
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
  const created=w.k.productCommand(w.c.human,p);equal(created.schemaVersion,'3djat.result.v1',JSON.stringify(created));
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
  const s=w.k.assetCommand(w.c.human,stage);equal(s.schemaVersion,'3djat.result.v1',JSON.stringify(s));
  const commit={schemaVersion:'3djat.command.v1',operation:'asset.import.commit',key:randomUUID(),
    expected:{domainHead:w.store.read().reference,entityRevision:1},input:{importId,stageReceipt:s.receipt,sha256:input.sha256}};
  const c=w.k.assetCommand(w.c.human,commit);equal(c.schemaVersion,'3djat.result.v1',JSON.stringify(c));
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
const stable=x=>JSON.stringify(x,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
function coherentValue(d,kind,id,mutate){const row=JSON.parse(d.prepare('SELECT doc FROM records WHERE kind=? AND id=?').get(kind,id).doc);
 mutate(row.payload);row.reference.sha256=hash(Buffer.from(stable(row.payload)+'\n'));
 d.prepare('UPDATE records SET doc=? WHERE kind=? AND id=?').run(JSON.stringify(row),kind,id);return row.reference;}
function coherentRow(d,kind,id,mutate){const row=JSON.parse(d.prepare('SELECT doc FROM records WHERE kind=? AND id=?').get(kind,id).doc);
 mutate(row);d.prepare('UPDATE records SET doc=? WHERE kind=? AND id=?').run(JSON.stringify(row),kind,id);}


test('S01 selected provenance metadata must be revalidated at final result fence',()=>{
 const originalPrepare=DatabaseSync.prototype.prepare;let connection=null,fetches=0,armed=false,changed=false,w,x;
 DatabaseSync.prototype.prepare=function(sql,...args){const stmt=originalPrepare.call(this,sql,...args);
  if(/^SELECT data FROM bytes WHERE hash=\?$/.test(sql)){const get=stmt.get,db=this;stmt.get=function(...values){connection=db;fetches++;return get.apply(this,values);};}return stmt;};
 try{w=fixture({hook:stage=>{if(armed&&!changed&&stage==='before-imported-original-return'){
  const doc=JSON.parse(connection.prepare('SELECT doc FROM records WHERE kind=? AND id=?').get('artifact',x.a.id).doc);
  doc.size++;connection.prepare('UPDATE records SET doc=? WHERE kind=? AND id=?').run(JSON.stringify(doc),'artifact',x.a.id);changed=true;
 }}});x=importOne(w);fetches=0;equal(inspected(w,x.a).sources[0].bytes.status,'verified');armed=true;
 let code=null,report=null;try{report=inspected(w,x.a);}catch(e){code=e.code;}
 console.log('S01_OBSERVED='+JSON.stringify({code,returnedByteStatus:report?.sources[0].bytes.status,changedSelectedArtifact:changed,actualBlobFetches:fetches}));
 equal(code,'EVIDENCE_MISMATCH');
 equal(fetches,2); // One genuine BLOB SELECT per successful/failed inspection.
 }finally{DatabaseSync.prototype.prepare=originalPrepare;w?.k.close();}
});
test('missing and short BLOBs never execute a data SELECT',()=>{
 const originalPrepare=DatabaseSync.prototype.prepare;let fetches=0,w;
 DatabaseSync.prototype.prepare=function(sql,...args){const stmt=originalPrepare.call(this,sql);
  if(/^SELECT data FROM bytes WHERE hash=\?$/.test(sql)){const get=stmt.get;stmt.get=function(...values){fetches++;return get.apply(this,values);};}
  return stmt;};
 try{w=fixture();const x=importOne(w);fetches=0;
  db(w,d=>d.prepare('DELETE FROM bytes WHERE hash=?').run(x.a.sha256));
  equal(inspected(w,x.a).sources[0].bytes.status,'missing');equal(fetches,0);
  db(w,d=>d.prepare('INSERT INTO bytes VALUES(?,?)').run(x.a.sha256,Buffer.from('short')));
  assert.throws(()=>inspected(w,x.a),e=>e.code==='HASH_MISMATCH');equal(fetches,0);
 }finally{DatabaseSync.prototype.prepare=originalPrepare;w?.k.close();}
});
test('S02 query with Array.prototype but no Array identity must refuse preflight',()=>{
 const w=fixture();try{const x=importOne(w);equal(inspected(w,x.a).sources[0].bytes.status,'verified');
 const q=query(w,[source(x.a)]);Object.setPrototypeOf(q,Array.prototype);let code=null,report=null;
 try{report=w.k.inspectImportedOriginalSources(w.binding.token,q);}catch(e){code=e.code;}
 console.log('S02_OBSERVED='+JSON.stringify({code,isArray:Array.isArray(q),hasArrayPrototype:Object.getPrototypeOf(q)===Array.prototype,returnedByteStatus:report?.sources[0].bytes.status}));
 equal(code,'INVALID_VALUE');
 }finally{w.k.close();}
});
test('coherently hashed corrupt PNG reaches decoder and refuses unsupported image',()=>{
 const w=fixture();try{const x=importOne(w),broken=Buffer.from(x.raw);broken[broken.length-1]^=1;const digest=hash(broken);
  db(w,d=>{d.exec('BEGIN IMMEDIATE');try{
   const declaration=coherentValue(d,'importDeclaration',x.a.importId,p=>{p.sha256=digest;p.source.sha256=digest;});
   coherentRow(d,'artifact',x.a.id,a=>{a.sha256=digest;a.importRecord=declaration;});
   const art=coherentValue(d,'importArtifact',x.a.id,p=>p.sha256=digest);
   coherentValue(d,'importOrigin',x.a.id,p=>{p.artifact.sha256=digest;p.provenance.importRecord=declaration;});
   const stage=coherentValue(d,'importReceipt',x.s.receipt.id,p=>p.reference=declaration);
   const commit=coherentValue(d,'importReceipt',x.c.receipt.id,p=>p.reference=art);
   coherentRow(d,'assetImport',x.a.importId,s=>{s.declaration=declaration;s.stageReceipt=stage;s.commitReceipt=commit;});
   for(const [key,receipt,reference] of [[x.stage.key,stage,declaration],[x.commit.key,commit,art]]){
    const row=d.prepare('SELECT scope,doc FROM receipts WHERE key=?').get(key),value=JSON.parse(row.doc);
    value.receipt=receipt;value.reference=reference;d.prepare('UPDATE receipts SET doc=? WHERE scope=? AND key=?').run(JSON.stringify(value),row.scope,key);
   }
   d.prepare('DELETE FROM bytes WHERE hash=?').run(x.a.sha256);d.prepare('INSERT INTO bytes VALUES(?,?)').run(digest,broken);d.exec('COMMIT');
  }catch(e){d.exec('ROLLBACK');throw e;}});
  assert.throws(()=>inspected(w,{...x.a,sha256:digest}),e=>e.code==='UNSUPPORTED_IMAGE');
 }finally{w.k.close();}
});
test('coherently rehashed receipt semantic contradiction reaches its operation check',()=>{
 const w=fixture();try{const x=importOne(w);db(w,d=>{d.exec('BEGIN IMMEDIATE');try{
  const ref=coherentValue(d,'importReceipt',x.s.receipt.id,p=>p.operation='asset.import.commit');
  coherentRow(d,'assetImport',x.a.importId,s=>s.stageReceipt=ref);
  const row=d.prepare('SELECT scope,doc FROM receipts WHERE key=?').get(x.stage.key),value=JSON.parse(row.doc);
  value.receipt=ref;d.prepare('UPDATE receipts SET doc=? WHERE scope=? AND key=?').run(JSON.stringify(value),row.scope,x.stage.key);d.exec('COMMIT');
 }catch(e){d.exec('ROLLBACK');throw e;}});
  assert.throws(()=>inspected(w,x.a),e=>e.code==='EVIDENCE_MISMATCH');
 }finally{w.k.close();}
});
