import {client} from './fixtures/3djat/j09-client.mjs';
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {randomUUID} from 'node:crypto';import {DatabaseSync} from 'node:sqlite';
import {Kernel} from '../src/kernel.mjs';import {inspectPillow} from '../src/executors/pillow.mjs';import {backupCombined,verifyCombined} from '../src/workspace-backup.mjs';
import {setup,ui,makePacket,creative,decide,deterministic,selection,P,hash} from './fixtures/3djat/j09-fixture.mjs';
const tool=await inspectPillow(process.env.BVE_PYTHON),ref=a=>({productId:P,artifactId:a.id,version:a.version,sha256:a.sha256,width:a.width,height:a.height});
test('J09 complete authored Example 2: A/B/C, logo treatments, scoped channel approval, story-only correction and restart from child',{timeout:600000},async t=>{
 const w=setup(t,tool),baseBytes=w.k.original(w.c.human,w.originals[0].artifact.artifactId),c=creative(w),[a,b,other]=c.artifacts;
 decide(w,a,'reject',null,'Product shape changed (authored scenario).');const bDecision=decide(w,b,'accept-for-editing');decide(w,other,'retain');
 assert.deepEqual(ui(w,'/api/candidate-decision',bDecision.packet),bDecision.result);
 assert.throws(()=>ui(w,'/api/candidate-decision',{...bDecision.packet,input:{...bDecision.packet.input,reason:'changed payload'}}),/conflict/i);
 assert.equal(ui(w,'/api/content-review',{productId:P}).approved.length,0);
 w.k.call(w.c.human,'design.accept','legacy',{artifactId:b.id,judgment:'accept'});
 assert.equal(ui(w,'/api/content-review',{productId:P}).approved.length,0,'Legacy design acceptance does not approve channel output');
 const logoSources=[{artifact:ref(b),role:'scene',regions:[]},w.originals[1]];
 const logoPacket=makePacket(w,'logo-placement',{sources:logoSources,selection:{...selection(b,3),out0logoopacity:0.3,out1logoopacity:1,out2logoanchor:'bottom-left',out2logowidth:1},outputs:[{role:'treatment',count:3}],parents:[ref(b)],parentRoundId:c.batch.round.id});
 const logo=await deterministic(w,logoPacket);assert.equal(new Set(logo.artifacts.map(x=>x.sha256)).size,3);
 const chosen=logo.artifacts[0];decide(w,chosen,'accept-for-editing');decide(w,logo.artifacts[1],'retain');decide(w,logo.artifacts[2],'retain');
 const channelPacket=makePacket(w,'instagram-output',{sources:logoSources,selection:{...selection(b,2),logoopacity:0.3,out1height:8,out1cropx:2,out1cropy:1,out1cropwidth:4,out1cropheight:4},outputs:[{role:'feed',count:1},{role:'story',count:1}],parents:[ref(chosen)],parentRoundId:logo.round.id});
 const channels=await deterministic(w,channelPacket),[feed,story]=channels.artifacts;
 assert.equal(feed.uncompositedParent.artifactId,b.id);assert.deepEqual(feed.logoLayer,w.originals[1].artifact);
 const approvedFeed=decide(w,feed,'approve-output','instagram-feed'),rejectedStory=decide(w,story,'reject','instagram-story','Leave more space around product.');
 const before=ui(w,'/api/content-review',{productId:P});
 assert.deepEqual(before.approved.map(x=>[x.artifact.artifactId,x.channel]),[[feed.id,'instagram-feed']]);
 const snapshots={feed:hash(w.k.original(w.c.human,feed.id)),story:hash(w.k.original(w.c.human,story.id)),base:hash(baseBytes),chosen:chosen.recipeHash,feedDecision:approvedFeed,storyDecision:rejectedStory};
 w.k.close();w.k=new Kernel(w.runtime,w.options);
 const restored=ui(w,'/api/content-review',{productId:P}),child=restored.entries.find(x=>x.artifact.id===story.id);
 assert.ok(child.history.some(x=>x.record.action==='reject'));assert.equal(child.branchRoundId,channels.round.id);
 const h=client(w);h.context.selected=story.id;h.run('state.preparation={productId:state.productId,artifactId:selected,correction:true}');
 h.context.card=h.element('article');h.context.discovery=w.k.operationDiscovery(w.c.human,{productId:P,applicability:'artistic'});h.context.op=h.context.discovery.operations.find(x=>x.templateId==='instagram-output');
 await h.run('operationLauncher(card,op,discovery)');
 const form=h.context.card.querySelector('form'),control=label=>form.querySelectorAll('input,select,textarea').find(x=>x.attributes['aria-label']===label);
 assert.equal(control('scene input').value,b.id);assert.equal(control('logo input').value,chosen.logoLayer.artifactId);
 assert.equal(Number(control('feed count').value),0);assert.equal(Number(control('story count').value),1);
 for(const [key,value] of [['cropx',0],['cropy',0],['cropwidth',b.width],['cropheight',b.height]])control(key).value=String(value);
 control('Additional instructions').value='Leave more space around the product. Correct story only.';
 await form.onsubmit({preventDefault(){}});
 const saved=[...h.storage.values()].map(x=>JSON.parse(x)).find(x=>x.status==='confirmed'&&x.packet.operation==='operation.request');
 assert.ok(saved,h.get('notice').textContent);const correctedPacket=saved.packet;
 assert.deepEqual(correctedPacket.input.requestedOutputs,[{role:'story',count:1}]);assert.equal(correctedPacket.input.parentRoundId,channels.round.id);

 const corrected=await deterministic(w,correctedPacket),finalStory=corrected.artifacts[0];decide(w,finalStory,'approve-output','instagram-story');
 const final=ui(w,'/api/content-review',{productId:P});
 assert.deepEqual(final.approved.map(x=>x.channel).sort(),['instagram-feed','instagram-story']);
 assert.equal(final.entries.find(x=>x.artifact.id===story.id).channels[0].action,'reject');
 assert.equal(final.entries.find(x=>x.artifact.id===a.id).editing.action,'reject');
 assert.equal(final.entries.find(x=>x.artifact.id===other.id).editing.action,'retain');
 assert.ok(final.entries.find(x=>x.artifact.id===finalStory.id).parents.includes(story.id));
 assert.equal(finalStory.uncompositedParent.artifactId,b.id);assert.equal(finalStory.logoLayer.artifactId,chosen.logoLayer.artifactId);
 assert.deepEqual(w.k.original(w.c.human,w.originals[0].artifact.artifactId),baseBytes);
 assert.equal(hash(w.k.original(w.c.human,feed.id)),snapshots.feed);assert.equal(hash(w.k.original(w.c.human,story.id)),snapshots.story);
 assert.equal(w.k.read(w.c.human,'job').length,9);assert.ok(w.k.read(w.c.human,'job').every(x=>x.invocationsStarted===1));
 assert.deepEqual(ui(w,'/api/candidate-decision',approvedFeed.packet),approvedFeed.result);
 const backup=path.join(w.dir,'j09-backup');await backupCombined(w.runtime,backup);assert.ok(verifyCombined(backup));
 fs.writeFileSync(path.join(w.dir,'EXAMPLE2-EVIDENCE.json'),JSON.stringify({authoredOnly:true,creative:'Three authored fixture PNGs via scoped simulated worker delivery; no generator call',base:w.originals[0].artifact,candidates:c.artifacts.map(ref),logoTreatments:logo.artifacts.map(ref),chosen:ref(chosen),feed:ref(feed),rejectedStory:ref(story),correctedStory:ref(finalStory),currentApprovals:final.approved,snapshots,tool,jobStarts:final.jobs.map(j=>({id:j.id,kind:j.specification.executorKind,state:j.state,starts:j.invocationsStarted})),requests:final.requests.map(r=>({id:r.id,state:r.state})),root:w.dir},null,2));
});
test('J09 exact scope, version/hash, revoked grants and stale stream reject; editing/favorite/import claims confer no output approval',()=>{
 const t={name:'J09 decisions security',after:()=>{}},w=setup(t,tool);
 try{
  const c=creative(w),a=c.artifacts[0],first=decide(w,a,'accept-for-editing'),view=ui(w,'/api/content-review',{productId:P});
  assert.throws(()=>ui(w,'/api/candidate-decision',first.packet,w.conductor.token),e=>e.code==='INVALID_SCOPE');
  const foreign={...first.packet,key:randomUUID(),input:{...first.packet.input,decisionId:randomUUID(),artifact:{...first.packet.input.artifact,sha256:'0'.repeat(64)}}};
  assert.throws(()=>ui(w,'/api/candidate-decision',foreign));
  const stale={...first.packet,key:randomUUID(),input:{...first.packet.input,decisionId:randomUUID()}};stale.input.humanActionReceipt=ui(w,'/api/candidate-action-reference',stale);
  assert.throws(()=>ui(w,'/api/candidate-decision',stale),e=>e.code==='REVISION_CONFLICT');
  assert.equal(view.approved.length,0);assert.throws(()=>decide(w,w.k.read(w.c.human,'artifact').find(x=>x.origin==='import'),'approve-output','instagram-feed'),e=>e.code==='INVALID_SCOPE');
  const original=JSON.parse(fs.readFileSync(w.accessFile)),p=original.principals.find(x=>x.id==='bve-human');p.products=[];
  fs.writeFileSync(w.accessFile,JSON.stringify(original));assert.throws(()=>ui(w,'/api/candidate-decision',first.packet),e=>e.code==='INVALID_SCOPE');
 }finally{w.k.close();}
});
test('J09 preparation is read-only; missing Brand and changed adopted authority block; original 1–6 bound persists',t=>{
 const w=setup(t,tool),before=w.k.read(w.c.human,'request').length;
 const d=w.k.operationDiscovery(w.c.human,{productId:P,applicability:'artistic'});
 assert.ok(d.operations.some(x=>x.templateId==='creative-composition'));assert.equal(d.execution.generator,'not-verified');
 assert.throws(()=>ui(w,'/api/operation-preparation',{productId:P,applicability:'artistic',operationTemplateId:'creative-composition',branded:true,brandTemplateId:'missing'}));
 for(const count of [0,7]){
  const packet=makePacket(w,'creative-composition',{outputs:[{role:'candidate',count}],selection:{preserveproduct:true,exploration:'balanced',contrast:0.5}});
  assert.throws(()=>ui(w,'/api/operation-request',packet));}
 for(const count of [1,6]){
  const packet=makePacket(w,'creative-composition',{outputs:[{role:'candidate',count}],selection:{preserveproduct:true,exploration:'balanced',contrast:0.5}});
  const saved=ui(w,'/api/operation-request',packet);assert.equal(saved.state,'waiting-for-conductor');assert.deepEqual(ui(w,'/api/operation-request',packet),saved);}
 assert.equal(w.k.read(w.c.human,'request').length,before+2);assert.equal(w.k.read(w.c.human,'job').length,0);
 assert.equal(w.k.read(w.c.human,'sessionBinding').filter(x=>x.role==='worker').length,0);
});
