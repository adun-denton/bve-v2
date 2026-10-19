import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {randomUUID} from 'node:crypto';
import {request} from 'node:http';
import {serve} from '../src/server.mjs';
import {Kernel} from '../src/kernel.mjs';
import {DomainProducts} from '../src/domain-products.mjs';
import {backupRoot} from '../scripts/backup.mjs';
import {restoreCombined,verifyCombined} from '../src/workspace-backup.mjs';
import {setup,attachment,packet,hash,ok,PRODUCT} from './fixtures/3djat/attachments-fixture.mjs';

async function server(w){w.k.close();const app=await serve({root:w.runtime,port:0,products:w.productOptions});w.k=app.kernel;return app;}
async function post(app,token,route,raw,headers={},cuts=[]){
  return new Promise((resolve,reject)=>{
    const req=request(app.origin+route,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json','content-length':raw.length,...headers}},res=>{
      const chunks=[];res.on('data',b=>chunks.push(b));res.on('end',()=>{try{resolve({status:res.statusCode,body:JSON.parse(Buffer.concat(chunks).toString('utf8'))});}catch(e){reject(e);}});res.on('error',reject);
    });req.on('error',reject);
    (async()=>{let at=0;for(const end of cuts){req.write(raw.subarray(at,end));at=end;await new Promise(r=>setTimeout(r,20));}req.end(raw.subarray(at));})().catch(reject);
  });
}
const encoded=x=>Buffer.from(JSON.stringify(x));
const query=w=>({productId:PRODUCT,atHead:w.store.read().reference});
test('existing HTTP product delegation preserves opaque/Persian bytes, separate source path and repeated request',async t=>{
  const w=setup(t,{kernel:true,products:'Goods/Current'}),app=await server(w),a=attachment(w,{filename:'طرح تولید '+ 'ف'.repeat(100)+'.stl',sourceLocation:'capture/ورودی.raw'}),p=packet(w,a),raw=encoded(p),start=raw.indexOf(Buffer.from('طرح'));
  try{
    const first=await post(app,w.c.human,'/api/product',raw,{},[start+1,start+3]);assert.equal(first.status,200,JSON.stringify(first));ok(first.body);
    assert.deepEqual(await post(app,w.c.human,'/api/product',raw),first);assert.equal(hash(fs.readFileSync(path.join(w.root,a.location))),a.sha256);
    fs.rmSync(w.sourceRoot,{recursive:true});const result=await post(app,w.c.human,'/api/product-review',encoded(query(w)));assert.equal(result.status,200);assert.deepEqual(result.body.attachments[0].record,a);assert.equal(result.body.attachments[0].current.status,'available');assert.deepEqual(await post(app,w.c.human,'/api/product',raw),first);
    for(const kind of ['job','request','iteration','round','sessionBinding','acceptance'])assert.equal(w.k.read(w.c.human,kind).length,0);
    assert.equal(w.k.read(w.c.human,'project')[0].domain.record.attachments.length,1);
  }finally{await app.stop();}
});
test('HTTP strict parser retains body bound and Host/Origin/auth refusal before attachment work',async t=>{
  const w=setup(t,{kernel:true}),app=await server(w),p=packet(w,attachment(w)),raw=encoded(p),head=w.store.read().reference;
  try{
    assert.equal((await post(app,w.c.human,'/api/product',raw,{host:'foreign.invalid'})).status,403);
    assert.equal((await post(app,w.c.human,'/api/product',raw,{origin:'https://foreign.invalid'})).status,403);
    assert.equal((await post(app,'invalid','/api/product',raw)).status,409);
    assert.equal((await post(app,w.c.butler,'/api/product',raw)).body.error.code,'INVALID_SCOPE');
    const malformed=Buffer.concat([raw.subarray(0,raw.length-1),Buffer.from([0xff])]);assert.equal((await post(app,w.c.human,'/api/product',malformed)).status,400);
    const oversized=Buffer.concat([raw,Buffer.alloc(128*1024,0x20)]);assert.equal((await post(app,w.c.human,'/api/product',oversized)).status,413);
    const unknown=structuredClone(p);unknown.input.revision=1;assert.equal((await post(app,w.c.human,'/api/product',encoded(unknown))).status,409);
    assert.deepEqual(w.store.read().reference,head);assert.equal(fs.existsSync(path.join(w.root,p.input.location)),false);
    const exact=Buffer.concat([raw,Buffer.alloc(128*1024-raw.length,0x20)]);assert.equal((await post(app,w.c.human,'/api/product',exact)).status,200);
  }finally{await app.stop();}
});
test('scoped bound Conductor can register only its actual product; worker and Butler cannot',t=>{
  const w=setup(t,{kernel:true}),a=attachment(w),p=packet(w,a),c=w.k.bindSession(w.c,{role:'conductor',tier:'SOL',sessionId:'authored-attachment-conductor',projectId:PRODUCT,nonce:'authored-c',hostReceipt:'AUTHORED only'});
  w.k.call(c.token,'host.resume','resume-c',{nonce:'authored-c'});ok(w.k.productCommand(c.token,p));
  assert.equal(w.k.productCommand(w.c.butler,packet(w,attachment(w,{sourceLocation:'butler.raw'}))).error.code,'INVALID_SCOPE');
  const foreign=structuredClone(p);foreign.input.productId=randomUUID();assert.equal(w.k.productCommand(c.token,foreign).error.code,'INVALID_SCOPE');
  const revoked=w.k.bindSession(w.c,{role:'conductor',tier:'SOL',sessionId:'authored-new-conductor',projectId:PRODUCT,nonce:'authored-new',hostReceipt:'AUTHORED only',replace:true});assert(revoked);
  assert.equal(w.k.productCommand(c.token,p).error.code,'INVALID_SCOPE');
});
for(const at of ['before-product-projection','before-product-response'])test(`committed attachment survives ${at} and exact replay without source`,t=>{
  let armed=false;const w=setup(t,{kernel:true,workspaceHook(stage){if(armed&&stage===at){armed=false;throw Object.assign(Error('AUTHORED cache/response failure'),{code:'EIO'});}}}),a=attachment(w),p=packet(w,a);armed=true;
  const failed=w.k.productCommand(w.c.human,p);assert.equal(failed.error.code,'EXPORT_PENDING');assert(failed.error.evidence);fs.unlinkSync(path.join(w.sourceRoot,a.source.location));
  const head=w.store.read().reference,r=ok(w.k.productCommand(w.c.human,p));assert.equal(r.outputType,'attachment');assert.deepEqual(w.store.read().reference,head);assert.equal(w.k.productReview(w.c.human,query(w)).attachments[0].current.status,'available');
  w.k.close();w.k=new Kernel(w.runtime,{products:w.productOptions});assert.deepEqual(w.k.productCommand(w.c.human,p),r);assert.equal(w.k.read(w.c.human,'event').length,0);
});
test('existing combined backup restores exact canonical attachment plus dossier and audit; source need not exist',async t=>{
  const w=setup(t,{kernel:true,products:'Dossiers/Items'}),a=attachment(w,{data:Buffer.alloc(3*1024**2+7,0x45)}),p=packet(w,a),r=ok(w.k.productCommand(w.c.human,p));
  fs.unlinkSync(path.join(w.sourceRoot,a.source.location));const destination=path.join(w.dir,'backup');await backupRoot(w.runtime,destination);const manifest=verifyCombined(destination);assert.equal(manifest.attachments.length,1);assert.equal(manifest.attachments[0].sha256,a.sha256);
  const businessRoot=path.join(w.dir,'restored-business'),runtimeRoot=path.join(w.dir,'restored-runtime');restoreCombined(destination,{businessRoot,runtimeRoot,paths:Object.fromEntries(Object.entries(w.store.workspace.paths).map(([k,p])=>[k,path.join(businessRoot,p)]))});
  assert.equal(hash(fs.readFileSync(path.join(businessRoot,a.location))),a.sha256);
  const writer=new DomainProducts(businessRoot,{accessFile:w.accessFile,attachmentSources:w.attachmentSources});assert.equal(writer.readReview(w.human.token,query(w)).attachments[0].current.status,'available');
  const restored=new Kernel(runtimeRoot,{products:w.productOptions});try{
    const view=restored.productReview(w.c.human,query(w));assert.equal(view.attachments[0].current.status,'available');assert.deepEqual(view.attachments[0].reference,r.reference);assert.deepEqual(restored.productCommand(w.c.human,p),r);
    for(const kind of ['job','request','round','acceptance'])assert.equal(restored.read(w.c.human,kind).length,0);
  }finally{restored.close();}
});
for(const mode of ['missing','corrupt'])test(`incomplete ${mode} attachment refuses complete backup but preserves independent dossier read`,async t=>{
  const w=setup(t,{kernel:true}),a=attachment(w);ok(w.k.productCommand(w.c.human,packet(w,a)));const file=path.join(w.root,a.location),head=w.store.read().reference;
  if(mode==='missing')fs.unlinkSync(file);else fs.writeFileSync(file,'CORRUPT');
  assert.equal(w.k.productReview(w.c.human,query(w)).attachments[0].current.status,mode);
  await assert.rejects(()=>backupRoot(w.runtime,path.join(w.dir,'incomplete-backup')));assert.deepEqual(w.store.read().reference,head);
});
test('trusted source-map mutation cannot expose the BVE private runtime',t=>{
  const w=setup(t,{kernel:true}),a=attachment(w),head=w.store.read().reference;w.attachmentSources['authored-files'].root=w.runtime;
  const r=w.k.productCommand(w.c.human,packet(w,a));assert.equal(r.error.code,'UNSAFE_PATH');assert.deepEqual(w.store.read().reference,head);
});
