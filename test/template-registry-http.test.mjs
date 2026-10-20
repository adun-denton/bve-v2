import test from 'node:test';import assert from 'node:assert/strict';import * as fs from 'node:fs';import {request} from 'node:http';
import {serve} from '../src/server.mjs';
import {setup,packet,template,query,policy,read,ok} from './fixtures/3djat/template-registry-fixture.mjs';
async function post(app,token,route,raw,cuts=[]){return new Promise((resolve,reject)=>{const r=request(app.origin+route,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json','content-length':raw.length}},res=>{const chunks=[];res.on('data',b=>chunks.push(b));res.on('end',()=>{try{resolve({status:res.statusCode,body:JSON.parse(Buffer.concat(chunks).toString('utf8'))});}catch(e){reject(e);}});});r.on('error',reject);(async()=>{let start=0;for(const end of cuts){r.write(raw.subarray(start,end));start=end;await new Promise(r=>setTimeout(r,15));}r.end(raw.subarray(start));})().catch(reject);});}
test('C1 group24 actual HTTP bearer, UTF8 truths/observed cuts, malformed and exact byte limits',async t=>{
 const w=setup(t,{kernel:true});policy(w,'bve-human');w.k.close();const app=await serve({root:w.runtime,port:0,products:{accessFile:w.accessFile},templates:{accessFile:w.accessFile}});w.k=app.kernel;
 const text='\u0645 \u20ac \u{1f9ea}',points=[0x645,32,0x20ac,32,0x1f9ea],truth=[217,133,32,226,130,172,32,240,159,167,170];assert.deepEqual([...text].map(c=>c.codePointAt(0)),points);assert.deepEqual([...Buffer.from(text)],truth);
 const p=packet(w,'template.ingest',template('creative',{title:text})),raw=Buffer.from(JSON.stringify(p)),offset=raw.indexOf(Buffer.from(text)),cuts=[offset+1,offset+4,offset+5,offset+8,offset+9,offset+10],observed=[];
 app.server.prependListener('request',req=>{const chunks=[];observed.push(chunks);req.on('data',b=>chunks.push(Buffer.from(b)));});
 try{
  const r=await post(app,w.c.human,'/api/template',raw,cuts);assert.equal(r.status,200);ok(r.body);assert.deepEqual(Buffer.concat(observed[0]),raw);let n=0;const boundaries=new Set(observed[0].map(b=>(n+=b.length)));for(const c of cuts)assert(boundaries.has(c),'Actual data cut not observed '+c);
  const stored=read(w,'template').data.revisions[0].record.title;assert.deepEqual([...stored].map(c=>c.codePointAt(0)),points);assert.deepEqual([...Buffer.from(stored)],truth);
  assert.equal((await post(app,w.human.token,'/api/template',raw)).status,403);assert.equal((await post(app,w.c.human,'/api/template',raw)).status,200);
  const q=Buffer.from(JSON.stringify(query(w)));assert.equal((await post(app,w.c.human,'/api/template-review',q)).status,200);
  for(const bytes of [[255],[128],[192,175],[237,160,128],[240,159,170]]){const bad=Buffer.from(bytes);assert.equal((await post(app,w.c.human,'/api/template-review',bad)).status,400);}
  for(const bytes of [128*1024-1,128*1024,128*1024+1]){const padded=Buffer.concat([q,Buffer.alloc(bytes-q.length,32)]);assert.equal((await post(app,w.c.human,'/api/template-review',padded)).status,bytes<=128*1024?200:413);}
  // Transport response ceiling only: the earlier calls above exercised real auth/history.
  const original=app.kernel.templateReview.bind(app.kernel);for(const bytes of [1024**2-1,1024**2,1024**2+1]){app.kernel.templateReview=()=>({padding:'x'.repeat(bytes-14)});const response=await post(app,w.c.human,'/api/template-review',q);assert.equal(response.status,bytes<=1024**2?200:409);}app.kernel.templateReview=original;
 }finally{await app.stop();}
});
