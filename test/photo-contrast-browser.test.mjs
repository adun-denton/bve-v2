import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import {chromium} from 'playwright';
import {serve} from '../src/server.mjs';
import {threePhotos} from './fixtures/photo-brief-fixture.mjs';

const luminance=color=>{
 const rgb=color.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);
 return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;
};
const contrast=(a,b)=>{const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
const colors=locator=>locator.evaluate(el=>{
 const s=getComputedStyle(el);return {color:s.color,background:s.backgroundColor,opacity:s.opacity,outline:s.outlineStyle,outlineWidth:s.outlineWidth,outlineColor:s.outlineColor};
});
async function readable(locator,background){
 const c=await colors(locator);assert.equal(c.opacity,'1');
 assert.ok(contrast(c.color,background??c.background)>=4.5,JSON.stringify(c));return c;
}

test('photo editor controls remain readable in normal, hover, keyboard-focus and disabled states',{timeout:90000},async t=>{
 const w=threePhotos(t);w.k.close();const app=await serve({root:w.runtime,port:0,...w.options});w.k=app.kernel;
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try{
  const page=await browser.newPage({viewport:{width:1280,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(app.origin+'/products.html#product='+w.photos[0].productId+'&tab=photos');
  // Scope the fix: ordinary product buttons keep the shared stylesheet colors.
  const launch=page.getByRole('button',{name:'Edit instructions',exact:true}).first(),outside=await colors(launch);
  await launch.click();const dialog=page.locator('.photo-brief-dialog');
  await page.waitForFunction(()=>document.querySelector('.photo-brief-stage>img')?.naturalWidth>0);
  const draw=dialog.getByRole('button',{name:'Draw a repair region',exact:true});
  const submit=dialog.getByRole('button',{name:'Submit edit instructions',exact:true});
  const whole=dialog.getByLabel('Instructions for this photo',{exact:true});
  await page.mouse.move(0,0);const normal=await readable(draw);await readable(whole);
  assert.equal(await submit.isDisabled(),true);await readable(submit);
  await draw.hover();await page.waitForTimeout(180);const hover=await readable(draw);assert.notEqual(hover.background,normal.background);
  await page.mouse.move(0,0);await dialog.getByLabel('Photo zoom').focus();await page.keyboard.press('Tab');
  assert.equal(await draw.evaluate(el=>el===document.activeElement&&el.matches(':focus-visible')),true);
  const focus=await colors(draw);assert.notEqual(focus.outline,'none');assert.ok(parseFloat(focus.outlineWidth)>=2);
  assert.ok(contrast(focus.outlineColor,(await colors(dialog)).background)>=3);
  await readable(dialog.locator('.fine'),(await colors(dialog)).background);
  await draw.click();const box=await dialog.locator('img').boundingBox();
  await page.mouse.move(box.x+box.width*.1,box.y+box.height*.1);await page.mouse.down();
  await page.mouse.move(box.x+box.width*.4,box.y+box.height*.4,{steps:4});await page.mouse.up();
  const region=dialog.getByLabel('Instruction for the selected region',{exact:true});await region.fill('Authored contrast check');await readable(region);
  await dialog.getByRole('button',{name:'Keep region',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.photo-brief-dialog [role=status]')?.textContent==='Draft saved');
  await readable(dialog.getByLabel('Region 1 instructions'));assert.equal(await submit.isEnabled(),true);await readable(submit);
  for(const width of [1280,390]){
   await page.setViewportSize({width,height:1000});await whole.scrollIntoViewIfNeeded();
   const bounds=await whole.boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=width);
   await readable(whole);await readable(dialog.getByLabel('Region 1 instructions'));
   if(process.env.BVE_SCREENSHOT_DIR){
    fs.mkdirSync(process.env.BVE_SCREENSHOT_DIR,{recursive:true});
    await page.screenshot({path:path.join(process.env.BVE_SCREENSHOT_DIR,`photo-editor-contrast-${width}.png`),fullPage:true});
   }
  }
  await dialog.getByRole('button',{name:'Close',exact:true}).click();assert.deepEqual(await colors(launch),outside);
  assert.deepEqual(errors,[]);
  for(const kind of ['job','iteration','request','acceptance'])assert.equal(app.kernel.read(app.credentials.human,kind).length,0,kind);
 }finally{await browser.close();await app.stop();}
});
