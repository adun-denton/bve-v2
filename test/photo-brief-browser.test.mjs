import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {randomUUID} from 'node:crypto';
import {Kernel} from '../src/kernel.mjs';
import {serve} from '../src/server.mjs';
import {threePhotos} from './fixtures/photo-brief-fixture.mjs';
const view=(app,a)=>app.kernel.photoBrief(app.credentials.human,{action:'read',key:'read-only',input:{artifact:a}});
test('imported-photo editor: three images, region correction, zoom, cold recovery and lost submission response',{timeout:120000},async t=>{
 const w=threePhotos(t);w.k.close();let app=await serve({root:w.runtime,port:0,...w.options});w.k=app.kernel;
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});const context=await browser.newContext({viewport:{width:1280,height:900}});let page=await context.newPage();
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const dialog=()=>page.locator('.photo-brief-dialog'),whole=()=>dialog().getByLabel('Instructions for this photo',{exact:true});
 async function open(){await page.goto(app.origin+'/products.html#product='+w.photos[0].productId+'&tab=photos');await page.getByRole('button',{name:'Edit instructions',exact:true}).first().click();await dialog().locator('img').waitFor();await page.waitForFunction(()=>document.querySelector('.photo-brief-stage>img')?.naturalWidth>0);}
 async function drawRegion(text){
  await dialog().getByRole('button',{name:'Draw a repair region',exact:true}).click();
  const b=await dialog().locator('img').boundingBox();assert.ok(b?.width>0);
  await page.mouse.move(b.x+b.width*.1,b.y+b.height*.2);await page.mouse.down();await page.mouse.move(b.x+b.width*.4,b.y+b.height*.45,{steps:4});await page.mouse.up();
  await dialog().getByLabel('Instruction for the selected region',{exact:true}).fill(text);await dialog().getByRole('button',{name:'Keep region',exact:true}).click();
 }
 async function saved(artifact){await page.waitForFunction(()=>document.querySelector('.photo-brief-dialog [role=status]')?.textContent==='Draft saved');return view(app,artifact);}
 try{
  await open();assert.equal(await dialog().getByRole('button',{name:'Submit edit instructions',exact:true}).isDisabled(),true);
  await whole().fill('Preserve the print-layer texture');await drawRegion('Repair the broken leg');await drawRegion('Keep this edge');
  let v=await saved(w.photos[0]);assert.equal(v.draft.regions.length,2);assert.equal(v.draft.note,'Preserve the print-layer texture');
  await dialog().getByLabel('Region 1 instructions').fill('Repair the lower leg only');
  await dialog().getByRole('button',{name:'Remove region',exact:true}).nth(1).click();
  v=await saved(w.photos[0]);assert.equal(v.draft.regions.length,1);assert.equal(v.draft.regions[0].meaning,'Repair the lower leg only');
  for(const [i,words] of [[1,'Second photo only'],[2,'Third photo only']]){
   await dialog().getByRole('button',{name:'Next photo',exact:true}).click();await page.waitForFunction(n=>document.querySelector('.photo-brief-dialog h2')?.textContent.includes('('+n+' / 3)'),i+1);await whole().fill(words);await drawRegion('Region for photo '+i);await saved(w.photos[i]);
  }
  await dialog().getByRole('button',{name:'Next photo',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.photo-brief-dialog h2')?.textContent.includes('(1 / 3)'));
  assert.equal(await whole().inputValue(),'Preserve the print-layer texture');
  const originalDraft=view(app,w.photos[0]).draft;
  app.kernel.photoBrief(app.credentials.human,{action:'save',key:randomUUID(),input:{artifact:w.photos[0],
   expectedVersion:originalDraft.version,note:'Saved in another window',regions:originalDraft.regions}});
  const submit=dialog().getByRole('button',{name:'Submit edit instructions',exact:true});
  await submit.click();
  await dialog().getByRole('alert').filter({hasText:'The saved draft changed.'}).waitFor();
  assert.equal(await whole().inputValue(),'Saved in another window');
  assert.equal(await dialog().getByRole('button',{name:'Reconcile pending action',exact:true}).count(),0);
  assert.equal(view(app,w.photos[0]).requests.length,0);
  await whole().fill(originalDraft.note);
  await saved(w.photos[0]);
  // Simulate an effect committed on the server but its response lost in transport.
  let lost=true;await page.route('**/api/photo-brief',async route=>{
   const packet=route.request().postDataJSON();
   if(packet.action==='submit'&&lost){lost=false;const response=await route.fetch();assert.equal(response.status(),200);await route.abort('failed');}else await route.continue();
  });
  await dialog().getByRole('button',{name:'Submit edit instructions',exact:true}).click();
  await dialog().getByRole('button',{name:'Reconcile pending action',exact:true}).waitFor();
  assert.equal(view(app,w.photos[0]).requests.length,1);
  await dialog().getByRole('button',{name:'Reconcile pending action',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.photo-brief-dialog [role=status]')?.textContent.startsWith('Instructions submitted'));
  assert.equal(view(app,w.photos[0]).requests.length,1);
  await page.unroute('**/api/photo-brief');
  await dialog().getByRole('button',{name:'Close',exact:true}).click();await page.reload();await page.getByRole('button',{name:'Edit instructions',exact:true}).first().click();
  assert.equal(await whole().inputValue(),'Preserve the print-layer texture');
  assert.equal(await dialog().getByLabel('Region 1 instructions').inputValue(),'Repair the lower leg only');
  // Compare screen-selected geometry at two browser widths and a zoomed image.
  await dialog().getByRole('button',{name:'Close',exact:true}).click();
  for(const width of [1280,390]){
   await page.setViewportSize({width,height:900});await page.getByRole('button',{name:'Edit instructions',exact:true}).first().click();
   await dialog().locator('img').waitFor();await page.waitForFunction(()=>document.querySelector('.photo-brief-stage>img')?.naturalWidth>0);
   await dialog().getByLabel('Photo zoom').evaluate(el=>{el.value='125';el.dispatchEvent(new Event('input',{bubbles:true}));});
   await drawRegion('Zoom test '+width);v=await saved(w.photos[0]);const r=v.draft.regions.at(-1);
   for(const [key,expected] of Object.entries({x:.1,y:.2,w:.3,h:.25}))assert.ok(Math.abs(r[key]-expected)<.015,key+' at '+width+': '+r[key]);
   await dialog().getByRole('button',{name:'Close',exact:true}).click();
  }
  await context.close();await app.stop();
  app=await serve({root:w.runtime,port:0,...w.options});w.k=app.kernel;
  const cold=await browser.newContext(),coldPage=await cold.newPage();page=coldPage;
  await open();assert.equal(await whole().inputValue(),'Preserve the print-layer texture');
  assert.equal(view(app,w.photos[1]).draft.note,'Second photo only');assert.equal(view(app,w.photos[2]).draft.note,'Third photo only');
  for(const kind of ['job','iteration','request','acceptance'])assert.equal(app.kernel.read(app.credentials.human,kind).length,0,kind);
  assert.deepEqual(errors,[]);
  const expectedBrief=view(app,w.photos[0]).requests.at(-1);
  await dialog().getByRole('button',{name:'Close',exact:true}).click();
  await page.getByRole('button',{name:'Use this photo in preparation',exact:true}).first().click();
  await page.getByRole('button',{name:'Prepare this operation',exact:true}).first().click();
  const form=page.locator('.operation-form');
  await form.getByLabel('Branded',{exact:true}).uncheck();
  await form.getByRole('button',{name:'Save operation request',exact:true}).click();
  await page.locator('#notice').filter({hasText:'Request saved.'}).waitFor();
  const selected=app.kernel.read(app.credentials.human,'request').filter(r=>r.selectionId);
  assert.equal(selected.length,1);
  const frozen=app.kernel.operationSelection(app.credentials.human,selected[0].id).body.run;
  assert.match(frozen.intent,/Preserve the print-layer texture/);
  assert.deepEqual(frozen.sources.find(s=>s.artifact.artifactId===w.photos[0].artifactId).regions,expectedBrief.regions);
  for(const kind of ['job','iteration','acceptance'])assert.equal(app.kernel.read(app.credentials.human,kind).length,0,kind);
  await cold.close();
 }finally{await browser.close();await app.stop();}
});
