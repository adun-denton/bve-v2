// Disposable authored imports only; no provider calls or private customer data.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {Kernel} from '../src/kernel.mjs';
import {serve} from '../src/server.mjs';
import {fixture,P,hash} from './fixtures/3djat/deterministic-fixture.mjs';
import {importPacket,commitPacket,png} from './fixtures/3djat/import-fixture.mjs';
import {imagePoint,imageRegion} from '../public/photo-geometry.js';
const region=(meaning='Repair this area')=>({space:'normalized-original',x:.1,y:.2,w:.3,h:.25,meaning});
const call=(w,action,input,key=randomUUID(),token=w.c.human)=>w.k.photoBrief(token,{action,key,input});
import {threePhotos} from './fixtures/photo-brief-fixture.mjs';

test('three imported originals keep independent briefs, revisions and immutable requests across restart',t=>{
 const w=threePhotos(t),initial=w.photos.map(a=>hash(w.k.original(w.c.human,a.artifactId))),submitted=[];
 for(const [i,artifact] of w.photos.entries()){
  assert.equal(call(w,'read',{artifact}).draft,null);
  const input={artifact,expectedVersion:0,note:'Preserve texture '+i,regions:[region('Repair part '+i),{...region('Keep edge '+i),x:.5,w:.2}]},key=randomUUID();
  const draft=call(w,'save',input,key);assert.equal(draft.version,1);assert.deepEqual(call(w,'save',input,key),draft);
  assert.throws(()=>call(w,'save',{...input,note:'Changed'},key),/payload conflict/);
  const corrected={...input,expectedVersion:1,regions:[{...region('Corrected '+i),x:.2}]};
  const second=call(w,'save',corrected);assert.equal(second.version,2);
  const s=call(w,'submit',{artifact,draftVersion:2});submitted.push(s);
  assert.deepEqual(call(w,'submit',{artifact,draftVersion:2}),s); // different click key, same draft
  assert.deepEqual(s.artifact,artifact);assert.deepEqual(s.source,{artifact,role:'scene',regions:corrected.regions});
  assert.equal(s.note,corrected.note);assert.ok(!Object.hasOwn(s.regions[0],'reviewRegion'));
 }
 assert.equal(new Set(submitted.map(s=>s.id)).size,3);
 const marker=readFileSync(join(w.runtime,'bve-v2-root.json'));
 w.k.close();w.k=new Kernel(w.runtime,w.options);
 assert.deepEqual(readFileSync(join(w.runtime,'bve-v2-root.json')),marker);
 for(const [i,artifact] of w.photos.entries()){
  const view=call(w,'read',{artifact});assert.equal(view.draft.note,'Preserve texture '+i);assert.deepEqual(view.requests,[submitted[i]]);
  assert.equal(hash(w.k.original(w.c.human,artifact.artifactId)),initial[i]);
 }
 for(const kind of ['job','iteration','request','acceptance'])assert.equal(w.k.read(w.c.human,kind).length,0,kind);
});
test('brief writes reject foreign identity, stale version, fake review links and non-human writers',t=>{
 const w=threePhotos(t),artifact=w.photos[0],input={artifact,expectedVersion:0,note:'Keep texture',regions:[region()]};
 call(w,'save',input);
 assert.throws(()=>call(w,'save',input),e=>e.code==='REVISION_CONFLICT');
 assert.throws(()=>call(w,'submit',{artifact,draftVersion:2}),e=>e.code==='REVISION_CONFLICT');
 for(const key of ['productId','artifactId','version','sha256','width','height']){
  const value=key==='productId'?'cccccccc-cccc-4ccc-8ccc-cccccccccccc':key==='artifactId'?w.photos[1].artifactId:key==='sha256'?'0'.repeat(64):artifact[key]+1;
  assert.throws(()=>call(w,'read',{artifact:{...artifact,[key]:value}}));
 }
 assert.throws(()=>call(w,'save',{...input,expectedVersion:1,regions:[{...region(),reviewRegion:{reviewId:randomUUID(),index:0}}]}),e=>e.code==='INVALID_VALUE');
 assert.throws(()=>call(w,'save',{...input,expectedVersion:1,regions:[{...region(),x:.9,w:.2}]}),e=>e.code==='INVALID_VALUE');
 assert.throws(()=>call(w,'save',{...input,expectedVersion:1,unknown:true}));
 assert.throws(()=>call(w,'save',{...input,expectedVersion:1},randomUUID(),w.conductor.token),e=>e.code==='INVALID_SCOPE');
 assert.throws(()=>call(w,'read',{artifact},randomUUID(),w.c.butler),e=>e.code==='INVALID_SCOPE');
 assert.equal(call(w,'read',{artifact},randomUUID(),w.conductor.token).draft.version,1);
});
test('normalized coordinates retain the same original region under zoom, resizing and scroll offsets',()=>{
 for(const rect of [{left:10,top:30,width:800,height:600},{left:-450,top:-120,width:1600,height:1200},{left:12,top:80,width:320,height:240}]){
  const a=imagePoint(rect.left+rect.width*.1,rect.top+rect.height*.2,rect),b=imagePoint(rect.left+rect.width*.4,rect.top+rect.height*.45,rect);
  const r=imageRegion(a,b);for(const key of ['x','y','w','h'])assert.ok(Math.abs(r[key]-region()[key])<1e-12);
  assert.deepEqual(imageRegion(b,a),r);
 }
});
test('authenticated HTTP records recoverable drafts and submissions for originals without a job',async t=>{
 const w=threePhotos(t);w.k.close();const app=await serve({root:w.runtime,port:0,...w.options});w.k=app.kernel;
 try{
  const artifact=w.photos[0],post=async(packet,token=w.c.human)=>fetch(app.origin+'/api/photo-brief',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(packet)});
  const d=await post({action:'save',key:'http-save',input:{artifact,expectedVersion:0,note:'HTTP whole-image instruction',regions:[region(),{...region('Second region'),x:.6,w:.2}]}});
  assert.equal(d.status,200);assert.equal((await d.json()).version,1);
  const command={action:'submit',key:'http-submit',input:{artifact,draftVersion:1}};
  const first=await (await post(command)).json(),again=await (await post(command)).json();assert.deepEqual(first,again);
  const view=await (await post({action:'read',key:'read-only',input:{artifact}})).json();assert.deepEqual(view.requests,[first]);assert.equal(view.requests[0].regions.length,2);
  assert.equal((await post({action:'read',key:'read-only',input:{artifact}},'wrong')).status,403);
  for(const file of ['/photo-brief-ui.js','/photo-geometry.js'])assert.equal((await fetch(app.origin+file)).status,200);
 }finally{await app.stop();}
});
