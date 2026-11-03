import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {serve} from '../src/server.mjs';
import {fixture,P} from './fixtures/3djat/deterministic-fixture.mjs';
import {chunk,importPacket,commitPacket} from './fixtures/3djat/import-fixture.mjs';
import {png16} from './fixtures/png16.mjs';
import {hash,verifiedPNGData} from '../src/png.mjs';

test('full-size RGBA16 import, restart, full-resolution editor and on-demand compatibility copy',{timeout:90000},async t=>{
 const w=fixture(t,null,{services:false}),width=4946,height=3278;
 const pixel=(x,y)=>[x%256*257,y%256*257,(x^y)%256*257,(x%8===0?128:255)*257];
 const source=png16(width,height,6,pixel,{extras:[chunk('sRGB',Buffer.from([0]))]}),sha256=hash(source);
 const stage=importPacket(w,source,{filename:'authored-rgba16.png',productId:P,width,height,bitDepth:16});
 const staged=w.success(w.k.assetCommand(w.c.human,stage)),commit=commitPacket(w,staged,stage);
 const imported=w.success(w.k.assetCommand(w.c.human,commit)),a=w.k.importReview(w.c.human,stage.input.importId).artifact;
 const wrong=importPacket(w,source,{filename:'wrong-depth.png',productId:P,width,height,bitDepth:8});
 const mismatch=w.k.assetCommand(w.c.human,commitPacket(w,w.success(w.k.assetCommand(w.c.human,wrong)),wrong));
 assert.equal(mismatch.error.code,'HASH_MISMATCH');
 w.k.close();const app=await serve({root:w.runtime,port:0,...w.options});w.k=app.kernel;
 let browser;
 try{
  assert.deepEqual(w.k.assetCommand(w.c.human,commit),imported);
  assert.equal(hash(w.k.original(w.c.human,a.id)),sha256);
  assert.equal(hash(Buffer.from(w.k.importPortable(w.c.human,a.id).original.bytes,'base64')),sha256);
  const headers={Authorization:'Bearer '+w.c.human};
  const q=new URLSearchParams({view:'full',productId:P,id:a.id,version:a.version,sha256,width,height});
  const route=()=>app.origin+'/api/original?'+q;
  const raw=await fetch(route(),{headers});assert.equal(raw.status,200);
  assert.equal(raw.headers.get('x-bve-image-role'),'original');assert.equal(hash(Buffer.from(await raw.arrayBuffer())),sha256);
  assert.equal((await fetch(route(),{headers:{Authorization:'Bearer '+w.c.butler}})).status,403);
  q.set('width',width-1);assert.equal((await fetch(route(),{headers})).status,409);q.set('width',width);
  q.set('view','media');const media=await (await fetch(route(),{headers})).json();
  assert.equal(media.metadata.ihdr.bitDepth,16);assert.equal(media.preview.width,384);
  q.set('view','working8');const working=await fetch(route(),{headers});
  assert.equal(working.status,200);assert.equal(working.headers.get('x-bve-source-sha256'),sha256);
  const copy=Buffer.from(await working.arrayBuffer()),d=verifiedPNGData(copy);
  assert.equal(hash(copy),working.headers.get('x-bve-image-sha256'));assert.notEqual(hash(copy),sha256);
  assert.deepEqual(d.header,{width,height,depth:8,color:6});
  for(const [x,y] of [[0,0],[1,0],[8,8],[width-1,height-1]]){
   const at=y*(width*4+1)+1+x*4;
   assert.deepEqual([...d.raw.subarray(at,at+4)],pixel(x,y).map(v=>v/257));
  }
  browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  const page=await browser.newPage({viewport:{width:1280,height:900}}),reads=[];
  page.on('request',r=>{if(r.url().includes('/api/original?'))reads.push(r.url());});
  await page.goto(app.origin+'/products.html#product='+P+'&tab=photos');
  // Match the authored import's heading regardless of the order of the product cards.
  await page.locator('.content-card').filter({hasText:'authored-rgba16.png'}).getByRole('button',{name:'Edit instructions',exact:true}).click();
  const img=page.locator('.photo-brief-stage>img');
  await page.waitForFunction(w=>document.querySelector('.photo-brief-stage>img')?.naturalWidth===w,width);
  assert.equal(await img.evaluate(el=>el.naturalHeight),height);
  await page.getByLabel('Photo zoom').evaluate(el=>{el.value='125';el.dispatchEvent(new Event('input',{bubbles:true}));});
  assert.equal(await img.evaluate(el=>el.naturalWidth),width);
  assert.ok(reads.some(u=>u.includes('view=full')));assert.ok(!reads.some(u=>u.includes('view=working8')));
  const visual=await page.evaluate(async url=>{
   const token=(await (await fetch('/api/bootstrap')).json()).token;
   const working=await fetch(url,{headers:{Authorization:'Bearer '+token}});
   const derived=await createImageBitmap(await working.blob());
   const original=document.querySelector('.photo-brief-stage>img'),canvas=document.createElement('canvas');
   canvas.width=256;canvas.height=256;const ctx=canvas.getContext('2d',{willReadFrequently:true});
   const sample=image=>{ctx.clearRect(0,0,256,256);ctx.drawImage(image,0,0,256,256,0,0,256,256);return ctx.getImageData(0,0,256,256).data;};
   const a=sample(original),b=sample(derived);let max=0;
   for(let i=0;i<a.length;i++)max=Math.max(max,Math.abs(a[i]-b[i]));
   derived.close();return max;
  },route());
  assert.ok(visual<=2,'Canvas sample maximum difference: '+visual);
  assert.equal(hash(w.k.original(w.c.human,a.id)),sha256);
  assert.equal(w.k.read(w.c.human,'job').length,0);
 }finally{await browser?.close();await app.stop();}
});
