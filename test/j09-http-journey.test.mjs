// Actual loopback HTTP/Kernel/SQLite/Pillow behind explicit authored DOM/session doubles; not a real browser.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {DatabaseSync} from 'node:sqlite';
import {serve} from '../src/server.mjs';import {inspectPillow,dispatchPNGServices} from '../src/executors/pillow.mjs';
import {backupCombined,verifyCombined,restoreCombined} from '../src/workspace-backup.mjs';
import {setup,ui,creative,deterministic,commissionPacket,present,makePacket,selection,P,hash} from './fixtures/3djat/j09-fixture.mjs';import {client} from './fixtures/3djat/j09-client.mjs';
const tool=await inspectPillow(process.env.BVE_PYTHON);
const control=(form,label)=>form.querySelectorAll('input,select,textarea').find(x=>x.attributes['aria-label']===label);
function snapshot(w){const db=new DatabaseSync(path.join(w.runtime,'workspace.sqlite'),{readOnly:true});try{return db.prepare("SELECT scope,key,fingerprint,doc FROM receipts WHERE scope LIKE 'service:%' OR scope='candidate.decide:bve-human' ORDER BY scope,key").all().map(x=>({...x}));}finally{db.close();}}
function unchanged(before,w){const after=snapshot(w);for(const r of before)assert.deepEqual(after.find(x=>x.scope===r.scope&&x.key===r.key),r);}
test('J09 integrated Example2 through actual HTTP and public DOM controls, real conventional tools, child restart and scoped approvals',{timeout:1200000},async t=>{
 const clean=[],w=setup({name:t.name,after:fn=>clean.push(fn)},tool);w.k.close();let app=await serve({root:w.runtime,port:0,...w.options});w.k=app.kernel;
 t.after(async()=>{await app.stop();for(const fn of clean)await fn();});
 let h=client(w,{respond:(url,options)=>fetch(app.origin+url,options)}),pending=[];
 const content=async()=>{await h.run('renderContent(false)');return h.get('candidate-list');};
 const card=async a=>{const found=(await content()).querySelectorAll('article').find(c=>c.dataset.artifact===a.id);assert.ok(found,'Actual produced content card exists: '+h.get('candidate-list').textContent);return found;};
 const decision=async(a,label,note)=>{const c=await card(a);const text=c.querySelectorAll('input')[0];if(note)text.value=note;const b=c.querySelectorAll('button').find(x=>x.textContent===label);assert.ok(b);await b.onclick();assert.equal(h.get('notice').textContent,'Decision saved.');};
 const prepare=async(a,templateId,correct=false)=>{
  if(a.origin==='import'){h.run('state.preparation={productId:state.productId,artifactId:'+JSON.stringify(a.id)+'}');}
  else{const c=await card(a),choose=c.querySelectorAll('button').find(x=>x.textContent===(correct?'Correct this output only':'Use as a new source'));await choose.onclick();}
  await h.run('discover()');const c=h.get('operation-list').querySelectorAll('article').find(x=>x.textContent.includes(templateId)||x.querySelector('h3')?.textContent===({'creative-composition':'Creative Composition','logo-placement':'Logo Placement','instagram-output':'Instagram Post / Story Output'})[templateId]);assert.ok(c,'Discovered adopted operation');
  await c.querySelectorAll('button').find(x=>x.textContent==='Prepare this operation').onclick();const form=c.querySelector('form');assert.ok(form);return form;
 };
 const submit=async form=>{await form.onsubmit({preventDefault(){}});assert.match(h.get('notice').textContent,/Request saved. Execution has not started/);const saved=[...h.storage.values()].map(x=>JSON.parse(x)).filter(x=>x.status==='confirmed'&&x.packet.operation==='operation.request').at(-1);assert.ok(saved);pending.push(saved);return saved.packet;};
 const imported=w.k.read(w.c.human,'artifact').find(x=>x.id===w.originals[0].artifact.artifactId),base=Buffer.from(w.k.original(w.c.human,imported.id));
 let form=await prepare(imported,'creative-composition');control(form,'Exploration preset').value='balanced';control(form,'Exploration preset').onchange();control(form,'candidate count').value='3';control(form,'Additional instructions').value='Put pistachios inside the bowl; natural soft window light. Authored developer scenario.';
 const creativePacket=await submit(form);assert.equal(w.k.read(w.c.human,'job').length,0,'Submission creates no staff or invocation');
 const c=creative(w,creativePacket),[a,b,other]=c.artifacts;await decision(a,'Reject','Product shape changed.');await decision(b,'Approve for further editing');await decision(other,'Keep in history');
 assert.equal(ui(w,'/api/content-review',{productId:P}).approved.length,0);w.k.call(w.c.human,'design.accept','legacy-design',{artifactId:b.id,judgment:'accept'});assert.equal(ui(w,'/api/content-review',{productId:P}).approved.length,0);
 form=await prepare(b,'logo-placement');control(form,'logo input').value=w.originals[1].artifact.artifactId;control(form,'treatment count').value='3';control(form,'Output 1 logoopacity').value='0.3';control(form,'Output 2 logoopacity').value='1';control(form,'Output 3 logoanchor').value='bottom-left';control(form,'Output 3 logowidth').value='1';
 const logos=await deterministic(w,await submit(form));assert.equal(new Set(logos.artifacts.map(x=>x.sha256)).size,3);const chosen=logos.artifacts[0];await decision(chosen,'Approve for further editing');await decision(logos.artifacts[1],'Keep in history');await decision(logos.artifacts[2],'Keep in history');
 form=await prepare(chosen,'instagram-output');control(form,'feed count').value='1';control(form,'story count').value='1';control(form,'Output 2 height').value='8';control(form,'Output 2 cropx').value='2';control(form,'Output 2 cropy').value='1';control(form,'Output 2 cropwidth').value='4';control(form,'Output 2 cropheight').value='4';
 const channels=commissionPacket(w,await submit(form));for(const jobId of channels.iteration.jobIds)w.k.call(w.conductor.token,'service.assign','assign:'+jobId,{projectId:P,roundId:channels.round.id,jobId});
 const [feedId,storyId]=channels.iteration.jobIds;assert.equal((await dispatchPNGServices(w.k,w.c,[feedId])).outcomes[0].outcome,'success');
 await content();assert.match(h.get('operation-status').textContent,/1 of 2 results available/);
 const blocked=await dispatchPNGServices(w.k,w.c,[storyId],{hook(stage){if(stage==='before-start')throw Object.assign(Error('Authored pre-start capability loss'),{code:'CAPABILITY_UNAVAILABLE'});}});assert.equal(blocked.outcomes[0].outcome,'blocked');await content();assert.match(h.get('operation-status').textContent,/blocked/i);
 assert.equal(w.k.read(w.c.human,'job').find(x=>x.id===storyId).invocationsStarted,0);
 assert.equal((await dispatchPNGServices(w.k,w.c,[storyId])).outcomes[0].outcome,'success','Explicit dispatch after definite pre-start block uses its one original allowance');
 const [feed,story]=present(w,channels);await decision(feed,'Approve output');await decision(story,'Reject','Leave more space around the product.');
 assert.deepEqual(ui(w,'/api/content-review',{productId:P}).approved.map(x=>x.channel),['instagram-feed']);
 const bytes={feed:Buffer.from(w.k.original(w.c.human,feed.id)),story:Buffer.from(w.k.original(w.c.human,story.id)),chosen:Buffer.from(w.k.original(w.c.human,chosen.id))},receipts=snapshot(w);
 await app.stop();app=await serve({root:w.runtime,port:0,...w.options});w.k=app.kernel;
 h=client(w,{respond:(url,options)=>fetch(app.origin+url,options)});h.context.location.hash='#'+new URLSearchParams({product:P,tab:'prepare',source:story.id,correct:'1'});await h.run('openProduct('+JSON.stringify(P)+',"prepare")');
 form=await prepare(story,'instagram-output',true);assert.equal(Number(control(form,'feed count').value),0);assert.equal(Number(control(form,'story count').value),1);assert.equal(control(form,'scene input').value,b.id);assert.equal(control(form,'logo input').value,chosen.logoLayer.artifactId);
 for(const [key,v]of [['cropx',0],['cropy',0],['cropwidth',b.width],['cropheight',b.height]])control(form,key).value=String(v);control(form,'Additional instructions').value='Leave more space around the product. Correct story only.';
 const correction=await deterministic(w,await submit(form));assert.equal(correction.artifacts.length,1);const finalStory=correction.artifacts[0];await decision(finalStory,'Approve output');
 const final=ui(w,'/api/content-review',{productId:P});assert.deepEqual(final.approved.map(x=>x.channel).sort(),['instagram-feed','instagram-story']);
 await h.run('renderContent(true)');assert.match(h.get('approved-list').textContent,/instagram-feed/);assert.match(h.get('approved-list').textContent,/instagram-story/);
 const rejected=await card(story);assert.match(rejected.textContent,/Rejected/);assert.match((await card(a)).textContent,/Rejected/);assert.match((await card(other)).textContent,/Retained in history/);
 assert.equal(finalStory.uncompositedParent.artifactId,b.id);assert.deepEqual(finalStory.logoLayer,chosen.logoLayer);assert.ok(final.entries.find(x=>x.artifact.id===finalStory.id).parents.includes(story.id));
 assert.deepEqual(w.k.original(w.c.human,feed.id),bytes.feed);assert.deepEqual(w.k.original(w.c.human,story.id),bytes.story);assert.deepEqual(w.k.original(w.c.human,chosen.id),bytes.chosen);assert.deepEqual(w.k.original(w.c.human,imported.id),base);unchanged(receipts,w);
 const stored=[...h.storage.values()].map(x=>JSON.parse(x)).find(x=>x.packet.operation==='candidate.decide'&&x.packet.input.artifact.artifactId===finalStory.id);assert.ok(stored);h.context.replay=stored.packet;await h.run('sendJ09("/api/candidate-decision",replay,"Exact duplicate decision")');assert.equal(ui(w,'/api/content-review',{productId:P}).entries.find(x=>x.artifact.id===finalStory.id).history.length,1);
 assert.equal(final.jobs.length,9);assert.ok(final.jobs.every(x=>x.invocationsStarted===1));
 const backup=path.join(w.dir,'integrated-backup');await backupCombined(w.runtime,backup);assert.ok(verifyCombined(backup));
 fs.writeFileSync(path.join(w.dir,'HTTP-EXAMPLE2-EVIDENCE.json'),JSON.stringify({authoredOnly:true,evidenceClass:'Actual public JS with authored DOM doubles and actual loopback HTTP/Kernel/SQLite/Pillow; creative images are authored scoped simulated deliveries, not native AI',base:imported.id,candidates:c.artifacts.map(x=>({id:x.id,sha256:x.sha256})),treatments:logos.artifacts.map(x=>({id:x.id,sha256:x.sha256})),feed:{id:feed.id,sha256:feed.sha256},rejectedStory:{id:story.id,sha256:story.sha256},correctedStory:{id:finalStory.id,sha256:finalStory.sha256},currentApproved:final.approved,requests:pending.map(x=>x.packet.key),jobs:final.jobs.map(j=>({id:j.id,state:j.state,starts:j.invocationsStarted})),priorSafeReceiptsUnchanged:true,originalBytesUnchanged:true,httpCalls:h.calls},null,2));
});
test('J09 actual failed and uncertain conventional jobs stay explicit in the public HTTP view and never approve content',async t=>{
 for(const outcome of ['failed','uncertain']){
  const clean=[],w=setup({name:t.name+' '+outcome,after:fn=>clean.push(fn)},outcome==='uncertain'?{...tool,timeoutMs:1}:tool);w.k.close();const app=await serve({root:w.runtime,port:0,...w.options});w.k=app.kernel;
  try{
   const input=makePacket(w,'instagram-output',{sources:w.originals,selection:selection(w.originals[0].artifact),outputs:[{role:'story',count:1}]}),batch=commissionPacket(w,input),jobId=batch.iteration.jobIds[0];
   w.k.call(w.conductor.token,'service.assign','assign:'+jobId,{projectId:P,roundId:batch.round.id,jobId});
   const options=outcome==='failed'?{hook(stage,{context}){if(stage==='before-process')fs.writeFileSync(path.join(context.root,'ServiceExecutions',context.assignmentId,'logo.png'),Buffer.from('Authored staged corruption for failure evidence'));}}:{};
   const result=await dispatchPNGServices(w.k,w.c,[jobId],options);assert.equal(result.outcomes[0].outcome,outcome==='failed'?'failure':'uncertain');
   const h=client(w,{respond:(url,options)=>fetch(app.origin+url,options)});await h.run('renderContent(false)');
   assert.match(h.get('operation-status').textContent,outcome==='failed'?/Failed; no verified output/:/Outcome uncertain; no automatic retry/);
   assert.equal(ui(w,'/api/content-review',{productId:P}).approved.length,0);assert.equal(w.k.read(w.c.human,'job').find(x=>x.id===jobId).invocationsStarted,1);
   assert.equal((await dispatchPNGServices(w.k,w.c,[jobId])).outcomes[0].skipped,true,'No second invocation after failure or genuine uncertainty');
  }finally{await app.stop();for(const fn of clean)await fn();}
 }
});
