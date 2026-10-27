// Authored Example 2 browser journey. Creative pixels/session callbacks remain fixtures.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
import {serve} from '../src/server.mjs';import {inspectPillow} from '../src/executors/pillow.mjs';
import {setup,creative,deterministic,ui,P} from './fixtures/3djat/j09-fixture.mjs';
test('J09 authored Example 2 in a real browser: source through three treatments to corrected story',{timeout:1200000},async t=>{
 const require=createRequire(import.meta.url),chromium=(()=>{try{return require('playwright').chromium;}catch{return createRequire(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'package.json'))('playwright').chromium;}})();
 const executablePath=process.env.BVE_BROWSER_EXECUTABLE??chromium.executablePath();assert.ok(fs.existsSync(executablePath),'BROWSER_UNAVAILABLE: missing permitted browser');
 const browser=await chromium.launch({headless:true,executablePath,timeout:20000,args:['--no-sandbox','--disable-dev-shm-usage']});let app,page;
 try{
  const w=setup(t,await inspectPillow(process.env.BVE_PYTHON));w.k.close();app=await serve({root:w.runtime,port:0,...w.options});w.k=app.kernel;
  page=await browser.newPage({viewport:{width:1280,height:900}});page.setDefaultTimeout(90000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  // No alternate transport, navigation retry or network-policy bypass on failure.
  await page.goto(app.origin+'/products.html#'+new URLSearchParams({product:P,tab:'photos'}),{timeout:15000});
  const seenRequests=new Set();
  const pendingPacket=async()=>{
   await page.waitForFunction(seen=>Object.keys(localStorage).filter(k=>k.startsWith('3djat:j09:')).map(k=>JSON.parse(localStorage.getItem(k))).some(x=>x.status==='confirmed'&&x.packet.operation==='operation.request'&&!seen.includes(x.packet.key)),[...seenRequests]);
   const records=await page.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('3djat:j09:')).map(k=>JSON.parse(localStorage.getItem(k))).filter(x=>x.status==='confirmed'&&x.packet.operation==='operation.request'));
   const fresh=records.filter(x=>!seenRequests.has(x.packet.key));assert.equal(fresh.length,1,'One newly confirmed UI request, never a previously commissioned packet');const packet=fresh[0].packet;seenRequests.add(packet.key);return packet;
  };
  const launch=async(title)=>{
   const card=page.locator('#operation-list .content-card').filter({has:page.getByRole('heading',{name:title,exact:true})});
   await card.getByRole('button',{name:'Prepare this operation',exact:true}).click();await card.locator('.operation-form').waitFor();return card.locator('.operation-form');
  };
  const content=async(id)=>{await page.goto(app.origin+'/products.html#'+new URLSearchParams({product:P,tab:'photos'}));const card=page.locator('#candidate-list [data-artifact="'+id+'"]');await card.waitFor();return card;};
  const choose=async(id,correction=false)=>{const card=await content(id);await card.getByRole('button',{name:correction?'Correct this output only':'Use as a new source',exact:true}).click();};
  const review=async(id,button)=>{const card=await content(id);await card.getByRole('button',{name:button,exact:true}).click();await page.getByText('Decision saved.',{exact:true}).waitFor();};
  await page.locator('#photo-list .content-card').filter({has:page.getByRole('heading',{name:'scene.png',exact:true})}).getByRole('button',{name:'Use this photo in preparation'}).click();
  let form=await launch('Creative Composition');await form.getByLabel('Exploration preset').selectOption('balanced');await form.getByLabel('candidate count',{exact:true}).fill('3');
  await form.getByLabel('Additional instructions').fill('Put pistachios inside the bowl, naturally lit. Authored developer scenario.');
  await form.getByRole('button',{name:'Save operation request'}).click();await page.getByText(/Request saved. Execution has not started/).waitFor();
  const creativePacket=await pendingPacket(),c=creative(w,creativePacket),[a,b,other]=c.artifacts;
  await review(a.id,'Reject');await review(b.id,'Approve for further editing');await review(other.id,'Keep in history');
  await choose(b.id);form=await launch('Logo Placement');await form.getByLabel('logo input',{exact:true}).selectOption(w.originals[1].artifact.artifactId);
  await form.getByLabel('treatment count',{exact:true}).fill('3');
  for(const [label,value] of [['Output 1 logoopacity','0.3'],['Output 2 logoopacity','1'],['Output 3 logowidth','1']])await form.getByLabel(label,{exact:true}).fill(value);
  await form.getByLabel('Output 3 logoanchor',{exact:true}).selectOption('bottom-left');
  await form.getByRole('button',{name:'Save operation request'}).click();await page.getByText(/Request saved. Execution has not started/).waitFor();
  const logos=await deterministic(w,await pendingPacket()),chosen=logos.artifacts[0];await review(chosen.id,'Approve for further editing');
  await choose(chosen.id);form=await launch('Instagram Post / Story Output');
  await form.getByLabel('feed count',{exact:true}).fill('1');await form.getByLabel('story count',{exact:true}).fill('1');
  await form.getByLabel('Output 2 height',{exact:true}).fill('8');
  await form.getByRole('button',{name:'Save operation request'}).click();await page.getByText(/Request saved. Execution has not started/).waitFor();
  const channels=await deterministic(w,await pendingPacket()),[feed,story]=channels.artifacts;
  await review(feed.id,'Approve output');await review(story.id,'Reject');
  const onlyFeed=ui(w,'/api/content-review',{productId:P});assert.deepEqual(onlyFeed.approved.map(x=>x.channel),['instagram-feed']);
  await choose(story.id,true);form=await launch('Instagram Post / Story Output');
  assert.equal(await form.getByLabel('feed count',{exact:true}).inputValue(),'0');
  assert.equal(await form.getByLabel('story count',{exact:true}).inputValue(),'1');
  await form.getByLabel('cropx',{exact:true}).fill('0');await form.getByLabel('cropy',{exact:true}).fill('0');
  await form.getByLabel('cropwidth',{exact:true}).fill(String(b.width));await form.getByLabel('cropheight',{exact:true}).fill(String(b.height));
  await form.getByLabel('Additional instructions').fill('Leave more space around the product. Correct story only.');
  await form.getByRole('button',{name:'Save operation request'}).click();await page.getByText(/Request saved. Execution has not started/).waitFor();
  const correction=await deterministic(w,await pendingPacket());assert.equal(correction.artifacts.length,1);await review(correction.artifacts[0].id,'Approve output');
  await page.getByRole('button',{name:'Approved Content',exact:true}).click();await page.locator('#approved-list').getByRole('heading',{name:'instagram-story',exact:true}).waitFor();
  const dir=process.env.J09_BROWSER_EVIDENCE;assert.ok(dir);fs.mkdirSync(dir,{recursive:true});
  await page.screenshot({path:path.join(dir,'example2-approved-normal.png'),fullPage:true});await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(dir,'example2-approved-narrow.png'),fullPage:true});
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(dir,'browser-journey.json'),JSON.stringify({authoredOnly:true,browser:browser.version(),checks:['typed adopted operation','A reject B editing C retained','three logo treatments','feed-only approval','story-only conventional correction','Approved Content by channel'],approved:ui(w,'/api/content-review',{productId:P}).approved},null,2));
 }catch(e){if(page&&process.env.J09_BROWSER_EVIDENCE){const d=process.env.J09_BROWSER_EVIDENCE;fs.mkdirSync(d,{recursive:true});fs.writeFileSync(path.join(d,'failure-dom.html'),await page.content());fs.writeFileSync(path.join(d,'failure.json'),JSON.stringify({message:e.message,notice:await page.locator('#notice').textContent(),operations:await page.locator('#operation-list').textContent()},null,2));await page.screenshot({path:path.join(d,'failure.png'),fullPage:true}).catch(()=>{});}throw e;}finally{await browser.close();if(app)await app.stop();}
});
