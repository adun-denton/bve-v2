import test from 'node:test';import assert from 'node:assert/strict';import {inspectPillow} from '../src/executors/pillow.mjs';import {setup,ui,P} from './fixtures/3djat/j09-fixture.mjs';import {client} from './fixtures/3djat/j09-client.mjs';
const tool=await inspectPillow(process.env.BVE_PYTHON);
const by=(form,label)=>form.querySelectorAll('input,select,textarea').find(x=>x.attributes['aria-label']===label);
test('J09 authored DOM with actual handlers: template title, typed controls, Brand/default/preset, saved request and lost-response exact replay',async t=>{
 const w=setup(t,tool),h=client(w),discovery=w.k.operationDiscovery(w.c.human,{productId:P,applicability:'artistic'}),op=discovery.operations.find(x=>x.templateId==='creative-composition');
 h.context.selected=w.originals[0].artifact.artifactId;h.run('state.preparation={productId:state.productId,artifactId:selected}');
 h.context.card=h.element('article');h.context.op=op;h.context.discovery=discovery;
 await h.run('operationLauncher(card,op,discovery)');const form=h.context.card.querySelector('form');
 assert.match(form.textContent,/Creative Composition/);assert.equal(form.querySelector('input').checked,true,'Branded follows adopted default');
 assert.ok(by(form,'preserveproduct').type==='checkbox');assert.equal(by(form,'contrast').type,'number');
 by(form,'Exploration preset').value='balanced';by(form,'Exploration preset').onchange();assert.equal(by(form,'preserveproduct').checked,true);
 by(form,'candidate count').value='3';by(form,'Additional instructions').value='Put pistachios inside the bowl, natural soft window light (authored test).';
 await form.onsubmit({preventDefault(){}});
 const requests=w.k.read(w.c.human,'request');assert.equal(requests.length,1,h.get('notice').textContent);
 const row=w.k.operationSelection(w.c.human,requests[0].id);assert.equal(row.body.run.branded,true);assert.equal(row.body.run.canonical.count,3);
 assert.equal(row.body.run.selection.preserveproduct,true);assert.equal(row.body.run.preset,'balanced');assert.equal(row.body.run.executorId,'native-unavailable');
 assert.equal(w.k.read(w.c.human,'job').length,0);assert.match(h.get('notice').textContent,/Execution has not started/);
 assert.equal(w.k.read(w.c.human,'sessionBinding').filter(x=>x.role==='worker').length,0);
 const retained=JSON.parse([...h.storage.values()].find(v=>JSON.parse(v).packet?.operation==='operation.request'));
 let once=true;const lost=client(w,{respond:async(url,options)=>{
  if(url==='/api/operation-request'&&once){once=false;ui(w,url,JSON.parse(options.body));throw Error('authored lost acknowledgement after commit');}
 }});lost.context.packet=retained.packet;
 await assert.rejects(lost.run('sendJ09("/api/operation-request",packet,"Saved operation")'));
 assert.equal(lost.run('j09Pending(x=>x.operation==="operation.request")'),true);
 assert.equal(w.k.read(w.c.human,'request').length,1,'same key must replay the existing request');
 const reconcile=lost.get('operation-pending').querySelectorAll('button')[0];assert.ok(reconcile);
 await reconcile.onclick();assert.equal(lost.run('j09Pending(x=>x.operation==="operation.request")'),false);
 assert.equal(w.k.read(w.c.human,'request').length,1);
});
test('J09 authored DOM clears content and launcher after failed product switch, and ignores late content responses',async t=>{
 const w=setup(t,tool);let resolve;
 const h=client(w,{respond:async(url)=>url.startsWith('/api/content-review')?new Promise(r=>resolve=r):undefined});
 h.get('candidate-list').textContent='Old content';h.get('approved-list').textContent='Old approval';h.get('operation-status').textContent='Old job';
 const pending=h.run('renderContent(false)');h.run('clearProductContext();state.viewEpoch++;state.productId="foreign";');
 resolve({ok:true,json:async()=>({entries:[],approved:[],jobs:[],rounds:[],requests:[]})});await pending;
 assert.equal(h.get('candidate-list').textContent,'');assert.equal(h.get('approved-list').textContent,'');assert.equal(h.get('operation-status').textContent,'');
 assert.equal(h.run('state.content'),null);assert.equal(h.run('state.preparation'),null);
});
