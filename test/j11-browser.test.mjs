// Authored Example 3 through the actual Products controls and HTTP handlers.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
import {serve} from '../src/server.mjs';import {setup11,generate11,action,P} from './fixtures/3djat/j11-fixture.mjs';
test('J11 authored Example3 browser: compare, comment, revise, compare again, scope promotion and propose',{timeout:1200000},async t=>{
 const require=createRequire(import.meta.url),chromium=createRequire(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'package.json'))('playwright').chromium;
 const executablePath=process.env.BVE_BROWSER_EXECUTABLE??chromium.executablePath();assert.ok(fs.existsSync(executablePath),'BROWSER_UNAVAILABLE');
 const dir=process.env.J11_BROWSER_EVIDENCE;fs.mkdirSync(dir,{recursive:true});let browser,app,page;
 try{
  browser=await chromium.launch({headless:true,executablePath,timeout:20000,args:['--no-sandbox','--disable-dev-shm-usage']});
  const w=setup11(t);w.k.close();app=await serve({root:w.runtime,port:0,...w.options});w.k=app.kernel;
  page=await browser.newPage({viewport:{width:1360,height:950}});page.setDefaultTimeout(90000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(app.origin+'/products.html#'+new URLSearchParams({product:P,tab:'photos'}),{timeout:15000});
  await page.locator('#photo-list .content-card').filter({has:page.getByRole('heading',{name:'scene.png',exact:true})}).getByRole('button',{name:'Use this photo in preparation'}).click();
  const card=page.locator('#operation-list .content-card').filter({has:page.getByRole('heading',{name:'Creative Composition',exact:true})});await card.getByRole('button',{name:'Test template',exact:true}).click();
  const form=card.locator('.calibration-form');await form.getByLabel('Variant A').selectOption('0');await form.getByLabel('Variant B').selectOption('1');await form.getByLabel('Variant C').selectOption('2');
  await form.getByLabel('Common instructions').fill('Authored Example3 contrast comparison; preserve photographed product.');await form.getByLabel('Common contrast',{exact:true}).fill('0.5');
  await form.getByRole('button',{name:'Save comparison request',exact:true}).click();await page.getByText(/Comparison request saved/).waitFor();
  let views=action(w,'view',{productId:P}).experiments;assert.equal(views.length,1);const first=views[0];generate11(w,{experimentId:first.plan.id,requestId:first.plan.requestId});
  const refresh=async()=>{await page.goto(app.origin+'/products.html#'+new URLSearchParams({product:P,tab:'prepare'}));await page.locator('.calibration-experiment').first().waitFor();};await refresh();
  let compare=page.locator('.calibration-experiment').filter({has:page.getByRole('heading',{name:'Initial comparison',exact:true})});
  await compare.getByLabel('Comparison comments').fill('Authored review: B has good definition; reduce deep shadows. Not a real visual judgment.');await compare.getByLabel('Selected treatment').selectOption('1');await compare.getByRole('button',{name:'Save comparison review',exact:true}).click();
  await compare.getByLabel('Revised treatment instructions').fill('Revised authored B contrast: retain definition while making shadows shallower.');
  await compare.getByRole('button',{name:'Revise selected treatment and compare again',exact:true}).click();await page.getByText(/Revision comparison saved/).waitFor();
  views=action(w,'view',{productId:P}).experiments;assert.equal(views.length,2);const second=views.find(e=>e.plan.previousExperiment);generate11(w,{experimentId:second.plan.id,requestId:second.plan.requestId});await refresh();
  compare=page.locator('.calibration-experiment').filter({has:page.getByRole('heading',{name:'Revised comparison',exact:true})});
  await compare.getByLabel('Comparison comments').fill('Authored revised B selection for Instagram artistic only; real acceptance unproved.');await compare.getByLabel('Selected treatment').selectOption('1');await compare.getByRole('button',{name:'Save comparison review',exact:true}).click();
  await compare.getByRole('button',{name:'Promote selected revision for Instagram artistic only',exact:true}).click();await page.getByText(/Scoped promotion recorded/).waitFor();await compare.getByText('Selected for Instagram artistic',{exact:true}).waitFor();
  await compare.getByLabel('Revised treatment instructions').fill('Light-product contrast adjustment: proposed only.');await compare.getByRole('button',{name:'Save light-product adjustment as proposal',exact:true}).click();await compare.getByText(/Unadopted proposal: Light-product/).waitFor();
  await page.screenshot({path:path.join(dir,'example3-comparison-normal.png'),fullPage:true});await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(dir,'example3-comparison-narrow.png'),fullPage:true});
  assert.deepEqual(errors,[]);const final=action(w,'view',{productId:P});assert.equal(final.experiments[1].statuses.visual,'untested');assert.equal(final.experiments[1].proposals.at(-1).kind,'proposal');
  fs.writeFileSync(path.join(dir,'browser-example3.json'),JSON.stringify({authoredOnly:true,browser:browser.version(),checks:['existing Test entry','three common-input variants','review comments','explicit B revision','second comparison','scoped domain-writer promotion','light-product proposal only'],experiments:final},null,2));
 }catch(e){if(page){fs.writeFileSync(path.join(dir,'failure-dom.html'),await page.content().catch(()=>''));await page.screenshot({path:path.join(dir,'failure.png'),fullPage:true}).catch(()=>{});}throw e;}finally{if(browser)await browser.close();if(app)await app.stop();}
});
