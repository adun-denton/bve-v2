// Authored J08 browser journey; no native AI or real product media.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {serve} from '../src/server.mjs';
import {inspectPillow,dispatchPNGServices} from '../src/executors/pillow.mjs';
import {fixture,commission,output,P} from './fixtures/3djat/deterministic-fixture.mjs';
test('J08 conventional feed/story board and truthful service trail in an actual browser',{timeout:90000},async t=>{
 const require=createRequire(import.meta.url),driver=(()=>{try{return require('playwright').chromium;}catch{return createRequire(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'package.json'))('playwright').chromium;}})();
 const executablePath=process.env.BVE_BROWSER_EXECUTABLE??driver.executablePath();
 assert.ok(fs.existsSync(executablePath),'BROWSER_UNAVAILABLE: missing permitted browser');
 const browser=await driver.launch({headless:true,executablePath,timeout:20000,args:['--no-sandbox','--disable-dev-shm-usage']});
 let app;
 try{
  const tool=await inspectPillow(process.env.BVE_PYTHON),w=fixture(t,tool),batch=commission(w,[output('feed'),output('story',4,8)]);
  const actual=await dispatchPNGServices(w.k,w.c,batch.iteration.jobIds);assert.ok(actual.outcomes.every(x=>x.outcome==='success'),JSON.stringify(actual));
  w.k.close();app=await serve({root:w.runtime,port:0,...w.options});w.k=app.kernel;
  const context=await browser.newContext({viewport:{width:1280,height:900}}),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(app.origin+'/#'+new URLSearchParams({project:P,page:'board',iteration:batch.iteration.id}));
  await page.waitForFunction(()=>document.querySelectorAll('#cards .card').length===2&&[...document.querySelectorAll('#cards img')].every(x=>x.complete&&x.naturalWidth>0));
  assert.match(await page.locator('#project-work').textContent(),/service: pillow-png-v1/);
  assert.match(await page.locator('#project-work').textContent(),/pillow-png-v1 \/ produced/);
  assert.equal(app.kernel.read(w.c.human,'sessionBinding').filter(x=>x.role==='worker').length,0);
  assert.equal(app.kernel.read(w.c.human,'acceptance').length,0);
  const evidence=process.env.J08_BROWSER_EVIDENCE;assert.ok(evidence);fs.mkdirSync(evidence,{recursive:true});
  await page.locator('#project-work details').first().evaluate(x=>x.open=true);
  await page.screenshot({path:path.join(evidence,'j08-board-normal.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(evidence,'j08-board-narrow.png'),fullPage:true});
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(evidence,'j08-browser-checks.json'),JSON.stringify({authoredOnly:true,checks:['actual feed/story originals visible','truthful zero-slot service attribution','no human acceptance','no browser errors'],browserVersion:browser.version()},null,2)+'\n');
 }finally{await browser.close();if(app)await app.stop();}
});
