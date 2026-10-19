import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {DomainProducts,readProductDossier,provisionProductPrincipal} from '../src/domain-products.mjs';
import {prepareRecord} from '../src/domain-store.mjs';
import {ATTACHMENT_IO_LIMITS} from '../src/attachment-files.mjs';
import {setup,attachment,packet,review,large,hash,ok,PRODUCT,WORKSPACE,create} from './fixtures/3djat/attachments-fixture.mjs';

const failure=(r,code)=>{assert.equal(r.schemaVersion,'3djat.failure.v1',JSON.stringify(r));if(code)assert.equal(r.error.code,code,JSON.stringify(r));return r;};
const send=(w,p,who=w.human)=>ok(w.writer.command(who.token,p));
const stages=w=>{const dir=path.join(w.root,w.store.workspace.paths.products,PRODUCT,'Sources/Attachment-Staging');return fs.existsSync(dir)?fs.readdirSync(dir):[];};
function unchanged(w,head){assert.deepEqual(w.store.read().reference,head);assert.equal(fs.readFileSync(path.join(w.dir,'unrelated-sentinel'),'utf8'),'AUTHORED_SENTINEL_UNCHANGED\n');}

for(const products of ['Products','Dossiers/Catalogue'])test(`opaque capture, entity CAS and file-only history use configured ${products}`,t=>{
  const w=setup(t,{products}),record=attachment(w),source=fs.readFileSync(path.join(w.sourceRoot,record.source.location));
  const p=packet(w,record),r=send(w,p);assert.equal(r.outputType,'attachment');assert.equal(r.committedRevision,1);
  const v=w.store.read(),d=readProductDossier(w.root,{productId:PRODUCT});assert.equal(d.product.record.revision,2);assert.deepEqual(d.product.record.attachments,[r.reference]);
  assert.deepEqual(v.records.get(r.reference.path).value,record);assert.equal(v.records.get(r.receipt.path).kind,'store-receipt');assert.equal(v.head.receipts.length,1);
  assert.deepEqual(fs.readFileSync(path.join(w.root,record.location)),source);assert.equal(fs.existsSync(path.join(w.root,'workspace.sqlite')),false);
  fs.unlinkSync(path.join(w.sourceRoot,record.source.location));const head=v.reference;assert.deepEqual(send(w,p),r);unchanged(w,head);
  w.writer=new DomainProducts(w.root,{accessFile:w.accessFile,attachmentSources:w.attachmentSources});assert.deepEqual(send(w,p),r);
  const current=review(w);assert.equal(current.attachments[0].current.status,'available');assert.deepEqual(current.attachments[0].record,record);assert.equal(w.writer.operationalEvidence().filter(x=>x.operation==='attachment.register').length,1);
  assert.equal(fs.existsSync(path.join(w.root,'Products',PRODUCT)),products==='Products');
});
test('attachment revision remains zero while dossier advances; replay precedes stale CAS',t=>{
  const w=setup(t);send(w,{schemaVersion:'3djat.command.v1',operation:'product.note.add',key:randomUUID(),expected:{domainHead:w.store.read().reference,entityRevision:1},input:{productId:PRODUCT,text:'Authored later dossier revision'}});
  const p=packet(w,attachment(w)),r=send(w,p);assert.equal(readProductDossier(w.root,{productId:PRODUCT}).product.record.revision,3);assert.equal(r.reference.revision,1);
  assert.deepEqual(send(w,p),r);const changed=structuredClone(p);changed.input.filename='changed.raw';failure(w.writer.command(w.human.token,changed),'IDEMPOTENCY_CONFLICT');
  const duplicate=packet(w,p.input);failure(w.writer.command(w.human.token,duplicate),'IDEMPOTENCY_CONFLICT');
  const wrong=packet(w,attachment(w,{sourceLocation:'second.raw'}),{revision:3});const head=w.store.read().reference;failure(w.writer.command(w.human.token,wrong),'REVISION_CONFLICT');unchanged(w,head);
});
test('stale current head refuses before attachment allocation or overwrite',t=>{
  const w=setup(t),p=packet(w,attachment(w));send(w,{schemaVersion:'3djat.command.v1',operation:'product.note.add',key:randomUUID(),expected:{domainHead:w.store.read().reference,entityRevision:1},input:{productId:PRODUCT,text:'Advance'}});
  const head=w.store.read().reference;failure(w.writer.command(w.human.token,p),'REVISION_CONFLICT');unchanged(w,head);assert.equal(fs.existsSync(path.join(w.root,p.input.location)),false);
});
test('authorized Conductor registers, other identities and role labels cannot',t=>{
  const w=setup(t),p=packet(w,attachment(w));failure(w.writer.command(w.source.token,p),'INVALID_SCOPE');failure(w.writer.command('0'.repeat(64),p),'INVALID_SCOPE');
  const spoof=structuredClone(p);spoof.input.role='human';failure(w.writer.command(w.source.token,spoof));send(w,p,w.conductor);
  const limited=provisionProductPrincipal(w.accessFile,{workspaceId:WORKSPACE,id:'foreign-human',role:'human',products:[randomUUID()]});failure(w.writer.command(limited.token,p),'INVALID_SCOPE');
  const registry=JSON.parse(fs.readFileSync(w.accessFile));registry.principals=registry.principals.filter(x=>x.id!==w.conductor.principalId);fs.writeFileSync(w.accessFile,JSON.stringify(registry));failure(w.writer.command(w.conductor.token,p),'INVALID_SCOPE');
});
test('trusted map is product scoped; unknown/revoked source policy also rejects replay',t=>{
  const w=setup(t),p=packet(w,attachment(w)),entry=w.attachmentSources['authored-files'];delete w.attachmentSources['authored-files'];failure(w.writer.command(w.human.token,p),'INVALID_SCOPE');
  w.attachmentSources['authored-files']={...entry,products:[randomUUID()]};failure(w.writer.command(w.human.token,p),'INVALID_SCOPE');
  w.attachmentSources['authored-files']=entry;send(w,p);delete w.attachmentSources['authored-files'];failure(w.writer.command(w.human.token,p),'INVALID_SCOPE');assert.equal(review(w).attachments[0].current.status,'available');
});
test('same hash across products retains separate authorization and references',t=>{
  const w=setup(t),a=attachment(w),first=send(w,packet(w,a)),other=randomUUID();send(w,create(w,other));
  const b=attachment(w,{productId:other});failure(w.writer.command(w.human.token,packet(w,b)),'INVALID_SCOPE');w.attachmentSources['authored-files'].products.push(other);
  const second=send(w,packet(w,b));assert.notDeepEqual(first.reference,second.reference);assert.notEqual(a.location,b.location);assert.equal(hash(fs.readFileSync(path.join(w.root,b.location))),a.sha256);
  failure(w.writer.command(w.conductor.token,packet(w,attachment(w,{productId:other,sourceLocation:'foreign.raw'}))),'INVALID_SCOPE');
});
for(const mode of ['drive','missing-source','hash','size','destination','unverified','missing'])test(`invalid ${mode} attachment cannot publish metadata`,t=>{
  const w=setup(t),a=attachment(w),head=w.store.read().reference;
  if(mode==='drive'){const s=a.source; a.source={kind:'drive',sourceId:s.sourceId,revision:s.revision,sha256:s.sha256,fileId:'AUTHORED-FILE',modifiedAt:s.observedAt,locator:s.locator,observedAt:s.observedAt};}
  if(mode==='missing-source')fs.unlinkSync(path.join(w.sourceRoot,a.source.location));
  if(mode==='hash')fs.writeFileSync(path.join(w.sourceRoot,a.source.location),Buffer.alloc(a.bytes,0x52));
  if(mode==='size')a.bytes++;
  if(mode==='destination')a.location='Other/wrong.bin';
  if(['unverified','missing'].includes(mode))a.availability=mode;
  failure(w.writer.command(w.human.token,packet(w,a)));unchanged(w,head);assert.equal(review(w).attachments.length,0);
});
for(const mode of ['absolute','traversal','symlink','hardlink'])test(`source ${mode} refuses without authority expansion`,t=>{
  const w=setup(t),a=attachment(w),file=path.join(w.sourceRoot,a.source.location),head=w.store.read().reference;
  if(mode==='absolute')a.source.location=file;
  if(mode==='traversal')a.source.location='../access.json';
  if(mode==='symlink'||mode==='hardlink'){
    const original=file+'.original';fs.renameSync(file,original);
    try{mode==='symlink'?fs.symlinkSync(original,file):fs.linkSync(original,file);}catch(e){if(process.platform==='win32'&&e.code==='EPERM'){t.skip('Windows link privilege unavailable');return;}throw e;}
  }
  failure(w.writer.command(w.human.token,packet(w,a)));unchanged(w,head);
});
test('destination symlink/conflicting bytes refuse without overwrite',t=>{
  for(const mode of ['bytes','link']){
    const w=setup(t),a=attachment(w),target=path.join(w.root,a.location);fs.mkdirSync(path.dirname(target),{recursive:true});
    if(mode==='bytes')fs.writeFileSync(target,'AUTHORED conflicting destination');else{try{fs.symlinkSync(path.join(w.dir,'unrelated-sentinel'),target);}catch(e){if(process.platform==='win32'&&e.code==='EPERM')continue;throw e;}}
    const head=w.store.read().reference;failure(w.writer.command(w.human.token,packet(w,a)));unchanged(w,head);
    if(mode==='bytes')assert.equal(fs.readFileSync(target,'utf8'),'AUTHORED conflicting destination');
  }
});
for(const at of ['attachment-chunk','attachment-staged','before-replace'])test(`source race at ${at} refuses and retains diagnostics`,t=>{
  let armed=false,w,a;w=setup(t,{hook(stage){if(armed&&stage===at){armed=false;fs.writeFileSync(path.join(w.sourceRoot,a.source.location),Buffer.alloc(a.bytes,0x63));}}});a=attachment(w,{data:Buffer.alloc(1024**2+7,0x51)});armed=true;
  const head=w.store.read().reference;failure(w.writer.command(w.human.token,packet(w,a)));unchanged(w,head);assert.equal(review(w).attachments.length,0);
  assert(stages(w).length>0||fs.existsSync(path.join(w.root,a.location)),'failure retains partial or installed orphan');
});
for(const at of ['attachment-staged','attachment-linked','attachment-installed','after-stage','before-replace','before-reply','after-domain-commit','before-response'])test(`fault ${at} preserves first outcome, orphan or exact published replay`,t=>{
  let armed=false;const w=setup(t,{hook(stage){if(armed&&stage===at){armed=false;throw Object.assign(Error('AUTHORED fault '+at),{code:'EIO'});}}}),a=attachment(w),p=packet(w,a),head=w.store.read().reference;armed=true;
  const first=failure(w.writer.command(w.human.token,p));assert.equal(fs.readFileSync(path.join(w.dir,'unrelated-sentinel'),'utf8'),'AUTHORED_SENTINEL_UNCHANGED\n');
  const changed=w.store.read().reference.sha256!==head.sha256;
  if(changed)assert(['EXPORT_PENDING','CAPABILITY_UNAVAILABLE'].includes(first.error.code));else assert.equal(review(w).attachments.length,0);
  const result=send(w,p);assert.equal(readProductDossier(w.root,{productId:PRODUCT}).product.record.revision,2);assert.deepEqual(send(w,p),result);assert.equal(review(w).attachments.length,1);
});
test('missing/corrupt/unsafe bytes yield derived availability without mutating history',t=>{
  const w=setup(t),a=attachment(w);send(w,packet(w,a));const original=fs.readFileSync(path.join(w.root,a.location)),head=w.store.read().reference,metadata=JSON.stringify(review(w).attachments[0].record);
  fs.unlinkSync(path.join(w.root,a.location));assert.equal(review(w).attachments[0].current.status,'missing');unchanged(w,head);
  fs.writeFileSync(path.join(w.root,a.location),Buffer.alloc(a.bytes,0x33));assert.equal(review(w).attachments[0].current.status,'corrupt');assert.equal(JSON.stringify(review(w).attachments[0].record),metadata);unchanged(w,head);
  fs.unlinkSync(path.join(w.root,a.location));try{fs.symlinkSync(path.join(w.dir,'unrelated-sentinel'),path.join(w.root,a.location));assert.equal(review(w).attachments[0].current.status,'unavailable');}catch(e){if(!(process.platform==='win32'&&e.code==='EPERM'))throw e;}
  if(fs.existsSync(path.join(w.root,a.location))||fs.lstatSync(path.dirname(path.join(w.root,a.location))).isDirectory()){try{fs.unlinkSync(path.join(w.root,a.location));}catch(e){if(e.code!=='ENOENT')throw e;}}
  fs.writeFileSync(path.join(w.root,a.location),original);assert.equal(review(w).attachments[0].current.status,'available');
});
test('multichunk exact256MiB uses bounded streaming for capture and availability; +1 refuses before allocation',t=>{
  let maxBuffer=0,chunks=0;const w=setup(t,{hook(stage,d){if(stage==='attachment-chunk'){chunks++;maxBuffer=Math.max(maxBuffer,d.bufferBytes);}}}),a=large(w,256*1024**2),r=send(w,packet(w,a));
  assert.equal(r.outputType,'attachment');assert(chunks>=256);assert.equal(maxBuffer,ATTACHMENT_IO_LIMITS.bufferBytes);assert.equal(review(w).attachments[0].current.status,'available');
  const over={...a,attachmentId:randomUUID(),bytes:a.bytes+1};const head=w.store.read().reference;failure(w.writer.command(w.human.token,packet(w,over)),'OUT_OF_BOUNDS');unchanged(w,head);assert.equal(review(w).attachments.length,1);
  fs.truncateSync(path.join(w.sourceRoot,a.source.location),a.bytes+1);
  failure(w.writer.command(w.human.token,packet(w,{...a,attachmentId:randomUUID()})),'HASH_MISMATCH');unchanged(w,head);assert.equal(review(w).attachments[0].current.status,'available');
});

for(const stage of ['attachment-chunk','attachment-linked','attachment-installed','after-stage','after-replace'])test(`owned interruption at ${stage} retains root then original-key recovery`,async t=>{
  const w=setup(t),a=attachment(w,{data:Buffer.alloc(1024**2+9,0x51)}),p=packet(w,a),head=w.store.read().reference;
  const script=new URL('./fixtures/3djat/attachments-process.mjs',import.meta.url),child=spawn(process.execPath,[fileURLToPath(script),w.root,w.accessFile,stage],{stdio:['pipe','pipe','pipe']});
  let stdout='',stderr='';child.stderr.on('data',b=>stderr+=b);const exit=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>resolve({code,signal}));});
  const reached=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Owned child did not reach '+stage+': '+stderr)),15000);child.stdout.on('data',b=>{stdout+=b;if(stdout.includes('"stage":"'+stage+'"')){clearTimeout(timer);resolve();}});child.once('exit',()=>{clearTimeout(timer);reject(Error('Child exited before marker '+stderr));});});
  child.stdin.end(JSON.stringify({token:w.human.token,packet:p,sources:w.attachmentSources}));try{await reached;child.kill('SIGKILL');const ended=await exit;assert(ended.signal==='SIGKILL'||process.platform==='win32');
    const lock=path.join(w.root,'domain-write.lock'),lockBytes=fs.readFileSync(lock);fs.writeFileSync(path.join(w.dir,'retained-lock.json'),lockBytes);w.store.recoverLock({expectedLockHash:hash(lockBytes),confirmedQuiescent:true});
    const result=send(w,p);assert.equal(result.outputType,'attachment');assert.equal(review(w).attachments.length,1);assert.equal(readProductDossier(w.root,{productId:PRODUCT}).product.record.revision,2);assert.deepEqual(send(w,p),result);
    assert.equal(fs.readFileSync(path.join(w.dir,'unrelated-sentinel'),'utf8'),'AUTHORED_SENTINEL_UNCHANGED\n');assert(fs.existsSync(w.dir));
    fs.writeFileSync(path.join(w.dir,'OWNED-INTERRUPTION.json'),JSON.stringify({scope:'AUTHORED_ONLY',stage,exit:ended,stdout,stderr,previousHead:head,receipt:result.receipt})+'\n');
  }finally{if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await exit;}}
});

test('retained staging count bound rejects further capture without deleting failed files',t=>{
  const w=setup(t),a=attachment(w),dir=path.join(w.root,w.store.workspace.paths.products,PRODUCT,'Sources/Attachment-Staging');fs.mkdirSync(dir,{recursive:true});
  for(let i=0;i<64;i++)fs.writeFileSync(path.join(dir,'authored-partial-'+i+'.part'),'AUTHORED retained failure');
  const head=w.store.read().reference;failure(w.writer.command(w.human.token,packet(w,a)),'OUT_OF_BOUNDS');unchanged(w,head);assert.equal(fs.readdirSync(dir).length,64);
});
function seedDeclarations(w,count,declaredBytes){
  // Explicitly unverified inert metadata exercises existing count/aggregate
  // policy, not successful capture or actual media/approval.
  for(let offset=0;offset<count;offset+=32){
    const view=w.store.read(),ref=view.head.products.find(x=>x.productId===PRODUCT).dossier,product=structuredClone(view.records.get(ref.path).value),records=[];
    for(let i=offset;i<Math.min(count,offset+32);i++){
      const a=attachment(w,{data:Buffer.from('x'),availability:'unverified',filename:'AUTHORED-UNVERIFIED-'+i+'.bin',bytes:declaredBytes});records.push({kind:'attachment',record:a});product.attachments.push(prepareRecord('attachment',a).reference);
    }
    product.revision++;w.store.commit({principal:'authored-fixture-owner',operation:'authored-unverified-declarations',key:randomUUID(),expectedHead:view.reference,changes:[{kind:'product',id:PRODUCT,expectedRevision:ref.revision,record:product}],records});
  }
}
test('registered aggregate limit refuses new attachment without publishing or allocating',t=>{
  const w=setup(t);seedDeclarations(w,4,256*1024**2);const a=attachment(w,{data:Buffer.from('y')}),head=w.store.read().reference;
  failure(w.writer.command(w.human.token,packet(w,a)),'OUT_OF_BOUNDS');unchanged(w,head);assert.equal(fs.existsSync(path.join(w.root,a.location)),false);
});
test('existing256-reference dossier limit remains enforced before byte capture',t=>{
  const w=setup(t);seedDeclarations(w,256,1);const a=attachment(w,{data:Buffer.from('y')}),head=w.store.read().reference;
  failure(w.writer.command(w.human.token,packet(w,a)),'VALIDATION_LIMIT');unchanged(w,head);assert.equal(fs.existsSync(path.join(w.root,a.location)),false);
});
test('source-root replacement during copy cannot supply a different identity',t=>{
  if(process.platform==='win32'){t.skip('open source-directory rename requires separate Windows filesystem case');return;}
  let armed=false,w;w=setup(t,{hook(stage){if(armed&&stage==='attachment-chunk'){armed=false;fs.renameSync(w.sourceRoot,w.sourceRoot+'-retained');fs.mkdirSync(w.sourceRoot);fs.writeFileSync(path.join(w.sourceRoot,'input.raw'),'OTHER');}}});
  const a=attachment(w,{data:Buffer.alloc(1024**2+1,0x51)}),head=w.store.read().reference;armed=true;failure(w.writer.command(w.human.token,packet(w,a)));unchanged(w,head);assert(fs.existsSync(w.sourceRoot+'-retained'));
});
test('source authorization revoked immediately before publication refuses the attachment',t=>{
  let armed=false,w;w=setup(t,{hook(stage){if(armed&&stage==='before-replace'){armed=false;delete w.attachmentSources['authored-files'];}}});const p=packet(w,attachment(w)),head=w.store.read().reference;armed=true;
  failure(w.writer.command(w.human.token,p));unchanged(w,head);assert.equal(review(w).attachments.length,0);
});
test('changing the trusted root in place before publication cannot rebind captured provenance',t=>{
  let armed=false,w;w=setup(t,{hook(stage){if(armed&&stage==='before-replace'){armed=false;w.attachmentSources['authored-files'].root=w.sourceRoot+'-other';}}});
  const a=attachment(w),head=w.store.read().reference;fs.mkdirSync(w.sourceRoot+'-other');fs.copyFileSync(path.join(w.sourceRoot,a.source.location),path.join(w.sourceRoot+'-other',a.source.location));armed=true;
  failure(w.writer.command(w.human.token,packet(w,a)));unchanged(w,head);
});
test('source filename case alias refuses instead of silently rebinding',t=>{
  const w=setup(t),a=attachment(w);a.source.location='INPUT.raw';const head=w.store.read().reference;failure(w.writer.command(w.human.token,packet(w,a)));unchanged(w,head);
});
test('destination ancestor link cannot redirect opaque capture outside product root',t=>{
  const w=setup(t),a=attachment(w),productDir=path.join(w.root,w.store.workspace.paths.products,PRODUCT),outside=path.join(w.dir,'outside');fs.mkdirSync(outside);
  fs.mkdirSync(productDir,{recursive:true});try{fs.symlinkSync(outside,path.join(productDir,'Sources'),process.platform==='win32'?'junction':'dir');}catch(e){if(process.platform==='win32'&&e.code==='EPERM'){t.skip('Windows junction privilege unavailable');return;}throw e;}
  const head=w.store.read().reference;failure(w.writer.command(w.human.token,packet(w,a)));unchanged(w,head);assert.deepEqual(fs.readdirSync(outside),[]);
});
test('Windows source junction refuses without source or dossier mutation',{skip:process.platform!=='win32'},t=>{
  const w=setup(t),a=attachment(w),outside=path.join(w.dir,'outside-source');fs.mkdirSync(outside);fs.writeFileSync(path.join(outside,'input.raw'),'AUTHORED');
  fs.symlinkSync(outside,path.join(w.sourceRoot,'junction'),'junction');a.source.location='junction/input.raw';const head=w.store.read().reference;failure(w.writer.command(w.human.token,packet(w,a)));unchanged(w,head);
});
test('atomic-link retry reconciles only its verified pair while retaining older partial files',t=>{
  let mode=null;const w=setup(t,{hook(stage){if(stage===mode){mode=null;throw Object.assign(Error('AUTHORED retained link edge'),{code:'EIO'});}}}),p=packet(w,attachment(w));
  mode='attachment-staged';failure(w.writer.command(w.human.token,p));const partial=stages(w)[0];mode='attachment-linked';failure(w.writer.command(w.human.token,p));
  assert.equal(fs.lstatSync(path.join(w.root,p.input.location)).nlink,2);send(w,p);assert.equal(fs.lstatSync(path.join(w.root,p.input.location)).nlink,1);assert(stages(w).includes(partial));assert.equal(review(w).attachments[0].current.status,'available');
});
test('explicit narrow business-file source is separate from configured captured destination',t=>{
  const w=setup(t),a=attachment(w),root=path.join(w.root,'Business/Attachment-Inputs');fs.mkdirSync(root);fs.renameSync(path.join(w.sourceRoot,a.source.location),path.join(root,a.source.location));w.attachmentSources['authored-files'].root=root;
  send(w,packet(w,a));assert.equal(review(w).attachments[0].current.status,'available');assert.notEqual(path.join(root,a.source.location),path.join(w.root,a.location));
});
test('a source cannot be its canonical captured destination or expose protected domain files',t=>{
  const w=setup(t),a=attachment(w),target=path.join(w.root,a.location);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(w.sourceRoot,a.source.location),target);
  w.attachmentSources['authored-files'].root=path.dirname(target);a.source.location=path.basename(target);const head=w.store.read().reference;
  failure(w.writer.command(w.human.token,packet(w,a)),'UNSAFE_PATH');unchanged(w,head);
  w.attachmentSources['authored-files'].root=path.join(w.root,'Domain');failure(w.writer.command(w.human.token,packet(w,a)),'UNSAFE_PATH');unchanged(w,head);
});
for(const collision of ['product','audit'])test(`attachment result resolves its exact kind despite ${collision} identifier collision`,t=>{
  const w=setup(t),a=attachment(w),p=packet(w,a);
  if(collision==='product')a.attachmentId=PRODUCT;
  else{const h=hash(Buffer.from(JSON.stringify([WORKSPACE,w.human.principalId,p.operation,p.key])));a.attachmentId=`${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`;}
  const r=send(w,p);assert.equal(w.store.read().records.get(r.reference.path).kind,'attachment');assert.deepEqual(w.store.read().records.get(r.reference.path).value,a);assert.deepEqual(send(w,p),r);
});
