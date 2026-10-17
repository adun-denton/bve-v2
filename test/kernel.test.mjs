import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Kernel } from '../src/kernel.mjs';
import { fixtureSpecifications, capabilities, dispatch, fixtureAdapter, simulateCommission } from '../src/adapters.mjs';
import { fixturePNG,verifyPNG,hash } from '../src/png.mjs';
import { workspace,first,allocate,start,deliver,finish,feedback,submit } from './helpers.mjs';

test('two complete iterations use distinct jobs and source-bound review through real function interfaces',async t=>{
  const w=workspace();t.after(()=>w.k.close());const {p,r,i,input}=first(w);
  assert.equal(i.jobIds.length,6);assert.equal(new Set(i.jobIds).size,6);
  const jobs=w.k.read(w.c.conductor,'job');assert.equal(new Set(jobs.map(j=>j.specification.prompt)).size,6);
  assert.equal(new Set(jobs.map(j=>j.specification.difference)).size,6);
  assert.deepEqual(w.call('conductor','iteration.commission',input,'first-commission'),i);
  const images=finish(w,i);assert.equal(images.length,6);
  for(const a of images){assert.equal(a.iterationId,i.id);assert.equal(a.projectId,p.id);assert.equal(hash(w.k.original(w.c.human,a.id)),a.sha256);assert.equal(w.k.read(w.c.human,'job').find(j=>j.id===a.jobId).artifactId,a.id);}
  const {draft,s}=submit(w,i,images,'iterate');const c=w.k.read(w.c.conductor,'continuation')[0];
  assert.equal(c.status,'ready');assert.equal(c.optional.screenshots.required,false);assert.equal(c.optional.conductorNotes.status,'unavailable');
  assert.deepEqual(c.feedback.images[0].regions,draft.feedback.images[0].regions);
  const second=await simulateCommission(w.k,w.c,s.requestId);
  assert.equal(second.parentReviewId,s.id);assert.equal(second.parentIterationId,i.id);assert.equal(second.count,6);
  const followJobs=w.k.read(w.c.conductor,'job').filter(j=>j.iterationId===second.id);
  for(const j of followJobs){assert.equal(j.specification.sources.length,6);assert.equal(j.specification.regions[0].text,'Give this area more breathing room');}
  const secondImages=w.k.read(w.c.human,'artifact').filter(a=>a.iterationId===second.id);submit(w,second,secondImages);
  assert.equal(w.k.read(w.c.human,'submission').length,2);assert.equal(w.k.read(w.c.human,'acceptance').length,0);
  const packet=w.k.portable(w.c.human,s.id);assert.equal(packet.originals.length,6);assert.equal(hash(Buffer.from(packet.originals[0].bytes,'base64')),packet.originals[0].sha256);
  assert.equal(w.k.read(w.c.human,'request').length,2);assert.equal(r.allowance.maxRetries,0);
});

test('functional boundaries reject persona labels, registration, cross-job delivery and nonhuman acceptance',t=>{
  const w=workspace();t.after(()=>w.k.close());const {i}=first(w,2),a=allocate(w,i.jobIds[0]),b=allocate(w,i.jobIds[1]);start(w,a);
  for(const role of ['human','conductor','generator'])assert.throws(()=>w.k.reconcile(w.c[role]),/Butler/);
  assert.throws(()=>w.call('conductor','attempt.start',{assignmentId:a.id,role:'generator'}),/cannot call/);
  assert.throws(()=>w.call('human','iteration.commission',{role:'conductor'}),/cannot call/);
  assert.throws(()=>w.call('generator','result.register',{role:'butler'}),/cannot call/);
  assert.throws(()=>w.k.call(a.token,'design.accept','fake',{role:'human'}),/Invalid function credential/);
  assert.throws(()=>w.k.call(a.token,'result.deliver','cross',{assignmentId:b.id,outcome:'success',evidence:{kind:'simulated'}}),/another assignment/);
  assert.throws(()=>w.k.read(w.c.conductor,'assignment'),/boundary/);
  assert.throws(()=>w.call('conductor','design.accept',{judgment:'accept'}),/cannot call/);
  deliver(w,a);w.k.reconcile(w.c.butler);const image=w.k.read(w.c.human,'artifact')[0];
  assert.throws(()=>w.k.original(a.token,image.id),/only read assigned source/);
  assert.equal(w.k.read(w.c.human,'acceptance').length,0);
});

test('partial, failed and out-of-order delivery preserves usable board and durable events',t=>{
  const w=workspace();t.after(()=>w.k.close());const {i}=first(w);const jobs=i.jobIds.map(j=>allocate(w,j));jobs.forEach(a=>start(w,a));
  deliver(w,jobs[4],4);w.k.reconcile(w.c.butler);
  let events=w.k.read(w.c.conductor,'event');assert.equal(events[0].type,'partial-review');assert.equal(events[0].available,1);
  for(const n of [1,5,0,2])deliver(w,jobs[n],n);deliver(w,jobs[3],3,'failure','');w.k.reconcile(w.c.butler);
  const j=w.k.read(w.c.human,'job');assert.equal(j.filter(j=>j.state==='succeeded').length,5);assert.equal(j.filter(j=>j.state==='failed').length,1);
  events=w.k.read(w.c.conductor,'event');assert.equal(events.find(e=>e.type==='review-ready').failed,1);assert.equal(events.length,2);
});

test('delivery replay, conflict and lost response never overwrite the original or duplicate outcome',t=>{
  const w=workspace();t.after(()=>w.k.close());const {i}=first(w,1),a=allocate(w,i.jobIds[0]);start(w,a);
  const receipt=deliver(w,a);w.k.reconcile(w.c.butler);const original=w.k.read(w.c.human,'artifact')[0];
  assert.equal(deliver(w,a).deliveryId,receipt.deliveryId);assert.equal(deliver(w,a,1).conflict,true);assert.equal(deliver(w,a,1).replayed,true);
  w.k.reconcile(w.c.butler);assert.equal(w.k.read(w.c.human,'artifact').length,1);assert.equal(w.k.read(w.c.human,'conflict').length,1);
  assert.equal(hash(w.k.original(w.c.human,original.id)),original.sha256);
  assert.throws(()=>w.call('generator','attempt.start',{assignmentId:a.id},'different-start'),/already started/);
});

test('recovery before invocation, in uncertain execution, and during intake preserves attempt identity',async t=>{
  const w=workspace();let k=w.k;const {i}=first(w,3);const unsent=allocate(w,i.jobIds[0]);const running=allocate(w,i.jobIds[1]);start(w,running);
  const inbox=allocate(w,i.jobIds[2]);start(w,inbox);deliver(w,inbox,2);
  k.close();k=new Kernel(w.root);t.after(()=>k.close());
  let jobs=k.read(w.c.human,'job');assert.equal(jobs.find(j=>j.id===unsent.jobId).state,'assigned');assert.equal(jobs.find(j=>j.id===running.jobId).state,'uncertain');assert.equal(jobs.find(j=>j.id===inbox.jobId).state,'succeeded');
  let invocations=0;const adapter={...fixtureAdapter(),id:'fixture-worker',execute:async a=>{invocations++;return fixtureAdapter().execute(a);}};
  // Helper allocations and dispatcher share the same idempotency key and input for recovery.
  await dispatch(k,w.c,adapter,[running.jobId,inbox.jobId]);assert.equal(invocations,0);
  assert.equal(k.assignment(running.token).attemptId,running.attemptId);
  assert.throws(()=>k.call(w.c.generator,'attempt.start','expired-lease',{assignmentId:running.id}),/uncertain/);
  // A late original from the original uncertain invocation remains admissible.
  k.call(running.token,'result.deliver','late-original',{assignmentId:running.id,outcome:'success',bytes:fixturePNG(1).toString('base64'),evidence:{kind:'simulated'}});k.reconcile(w.c.butler);
  assert.equal(k.read(w.c.human,'job').find(j=>j.id===running.jobId).state,'succeeded');
  const started=k.call(w.c.generator,'attempt.start',`start:${unsent.id}`,{assignmentId:unsent.id});assert.equal(started.attemptId,unsent.attemptId);
});

test('Generator serial fallback recovers unsent allocations and skips completed attempts',async t=>{
  const w=workspace();t.after(()=>w.k.close());const {i}=first(w,2);let calls=0;
  const adapter={...fixtureAdapter(),execute:async a=>{calls++;return fixtureAdapter().execute(a);}};
  // Dispatcher always allocates under its stable per-job key, recoverable across a lost response.
  w.call('generator','job.allocate',{jobId:i.jobIds[0],executor:adapter.id,capability:adapter.capability},`allocate:${i.jobIds[0]}`);
  await dispatch(w.k,w.c,adapter,i.jobIds);await dispatch(w.k,w.c,adapter,i.jobIds);assert.equal(calls,2);
  assert.equal(w.k.read(w.c.human,'artifact').length,2);assert.equal(capabilities.concurrency.enabled,1);
});

test('submission and drafts recover immutably, draft conflicts reject and feedback alone does not generate',t=>{
  const w=workspace();const {i}=first(w,1),images=finish(w,i),f=feedback(images);
  const d=w.call('human','draft.save',{iterationId:i.id,expectedVersion:0,feedback:f},'draft-one');
  assert.throws(()=>w.call('human','draft.save',{iterationId:i.id,expectedVersion:0,feedback:f},'concurrent'),/another window/);
  const s=w.call('human','review.submit',{iterationId:i.id,draftVersion:d.version,intent:'feedback'},'submission-one');
  f.overall='Later edited words';w.call('human','draft.save',{iterationId:i.id,expectedVersion:d.version,feedback:f});
  assert.notEqual(w.k.read(w.c.human,'submission')[0].feedback.overall,f.overall);
  assert.deepEqual(w.call('human','review.submit',{iterationId:i.id,draftVersion:d.version,intent:'feedback'},'submission-one'),s);
  w.k.close();const k=new Kernel(w.root);t.after(()=>k.close());
  assert.equal(k.read(w.c.human,'submission').length,1);assert.equal(k.read(w.c.human,'request').length,1);assert.equal(k.read(w.c.human,'draft')[0].version,2);assert.equal(k.read(w.c.human,'acceptance').length,0);
});

test('notification failure, acknowledgement, consumption and event replay are distinct and cannot dispatch',t=>{
  const w=workspace();t.after(()=>w.k.close());const {i}=first(w,1);finish(w,i);const e=w.k.read(w.c.conductor,'event')[0];
  w.call('butler','event.delivery',{eventId:e.id,mechanism:'simulated transport unavailable',status:'failed',evidence:'No live channel'},'send-one');
  let updated=w.k.read(w.c.conductor,'event')[0];assert.equal(updated.acknowledgedAt,null);assert.equal(updated.consumedAt,null);
  w.call('conductor','event.ack',{eventId:e.id,receipt:'Simulated recipient acknowledgement'},'ack-one');updated=w.k.read(w.c.conductor,'event')[0];assert.ok(updated.acknowledgedAt);assert.equal(updated.consumedAt,null);
  w.call('conductor','event.consume',{eventId:e.id},'consume-one');w.call('conductor','event.consume',{eventId:e.id},'consume-one');w.k.reconcile(w.c.butler);
  assert.equal(w.k.read(w.c.human,'job').length,1);assert.equal(w.k.read(w.c.conductor,'event').length,1);assert.ok(w.k.read(w.c.conductor,'event')[0].consumedAt);
});

for(const problem of ['corrupt','missing-bytes','missing-artifact'])test(`required ${problem} precisely blocks continuation; optional screenshots and absent AI never do`,t=>{
  const w=workspace();t.after(()=>w.k.close());const {i}=first(w,2),images=finish(w,i),{s}=submit(w,i,images,'iterate');
  assert.equal(w.k.read(w.c.conductor,'continuation')[0].status,'ready');
  const db=new DatabaseSync(join(w.root,'workspace.sqlite'));
  if(problem==='corrupt')db.prepare('UPDATE bytes SET data=? WHERE hash=?').run(Buffer.from('corrupt'),images[0].sha256);
  else if(problem==='missing-bytes')db.prepare('DELETE FROM bytes WHERE hash=?').run(images[0].sha256);
  else db.prepare("DELETE FROM records WHERE kind='artifact' AND id=?").run(images[0].id);
  db.close();w.k.reconcile(w.c.butler);const c=w.k.read(w.c.conductor,'continuation')[0];assert.equal(c.status,'blocked');assert.equal(c.issues[0].artifactId,images[0].id);assert.equal(c.sources.length,1);
  assert.throws(()=>w.call('conductor','iteration.commission',{requestId:s.requestId,interpretation:'Use comments',specifications:fixtureSpecifications({brief:'Follow review',count:2,sources:c.sources})}),/Required sources/);
  assert.equal(w.k.read(w.c.human,'submission')[0].id,s.id);
});

test('bounded defaults, inherited Fresh/Follow and independent Brand, standing iteration policy stop correctly',t=>{
  const w=workspace();t.after(()=>w.k.close());const p=w.call('human','project.create',{name:'Default study',brief:'One composition',direction:'Follow',brand:'Warm',standingIterations:1});
  const r=w.call('human','request.create',{projectId:p.id,intent:'Generate'});assert.equal(r.count,1);assert.equal(r.direction,'Follow');assert.equal(r.brand,'Warm');assert.equal(r.allowance.primaryAttempts,1);assert.equal(r.allowance.maxRetries,0);
  const i=w.call('conductor','iteration.commission',{requestId:r.id,specifications:fixtureSpecifications({brief:p.brief,count:1})}),images=finish(w,i);const {draft}=submit(w,i,images);
  assert.equal(w.k.read(w.c.human,'request').length,2);assert.equal(w.k.read(w.c.human,'project')[0].standingRemaining,0);
  w.call('human','review.submit',{iterationId:i.id,draftVersion:draft.version,intent:'feedback'});assert.equal(w.k.read(w.c.human,'request').length,2);
  assert.throws(()=>w.call('human','request.create',{projectId:p.id,intent:'More',count:7}),/count/);
  assert.equal(w.k.read(w.c.human,'acceptance').length,0);
});

test('independent byte validation rejects malformed or nonconforming originals without trusting producer claims',t=>{
  const w=workspace();t.after(()=>w.k.close());const {i}=first(w,2),a=allocate(w,i.jobIds[0]);start(w,a);
  deliver(w,a,0,'success',Buffer.from('not an image; producer says success').toString('base64'));w.k.reconcile(w.c.butler);
  assert.equal(w.k.read(w.c.human,'artifact').length,0);assert.match(w.k.read(w.c.human,'job')[0].reason,/Independent intake rejected/);
  const png=fixturePNG();assert.equal(verifyPNG(png).width,900);const corrupt=Buffer.from(png);corrupt[60]^=1;assert.throws(()=>verifyPNG(corrupt),/CRC/);
  assert.throws(()=>w.call('generator','job.allocate',{jobId:i.jobIds[1],executor:'paid',capability:{...capabilities.fixtureWorker,paid:true}}),/compatible/);
  assert.throws(()=>w.call('generator','job.allocate',{jobId:i.jobIds[1],executor:'documented-only',capability:{...capabilities.fixtureWorker,status:'documented'}}),/compatible/);
});

test('wrong source identities/geometry and undifferentiated directions are rejected transactionally',t=>{
  const w=workspace();t.after(()=>w.k.close());const {p,i}=first(w,2),images=finish(w,i);
  const f=feedback(images);f.images[0].regions[0].x=.9;assert.throws(()=>w.call('human','draft.save',{iterationId:i.id,expectedVersion:0,feedback:f}),/outside/);
  f.images[0].regions[0].x=.1;f.images[0].sha256='wrong';assert.throws(()=>w.call('human','draft.save',{iterationId:i.id,expectedVersion:0,feedback:f}),/identity/);
  const r=w.call('human','request.create',{projectId:p.id,intent:'Distinct directions'}),specs=fixtureSpecifications({brief:'Another',count:2});specs[1].prompt=specs[0].prompt;
  assert.throws(()=>w.call('conductor','iteration.commission',{requestId:r.id,specifications:specs}),/distinct/);assert.equal(w.k.read(w.c.human,'iteration').length,1);assert.equal(w.k.read(w.c.human,'job').length,2);
});

test('new roots refuse unknown contents and never adopt a legacy root',t=>{
  const w=workspace();t.after(()=>w.k.close());const unknown=join(w.root,'unknown');mkdirSync(unknown);writeFileSync(join(unknown,'client-private.txt'),'keep me');assert.throws(()=>new Kernel(unknown),/nonempty unrecognized/);assert.equal(readFileSync(join(unknown,'client-private.txt'),'utf8'),'keep me');
});

test('a replayed start receipt cannot grant a second invocation, even under its original key',t=>{
  const w=workspace();t.after(()=>w.k.close());const {i}=first(w,1),a=allocate(w,i.jobIds[0]);start(w,a);
  assert.throws(()=>start(w,a),/already started/);assert.equal(w.k.assignment(a.token).attemptId,a.attemptId);
});

test('adapter uncertainty preserves an observation while permitting the original attempt to deliver late',t=>{
  const w=workspace();t.after(()=>w.k.close());const {i}=first(w,1),a=allocate(w,i.jobIds[0]);start(w,a);
  const receipt=deliver(w,a,0,'uncertain','');assert.ok(receipt.observationId);w.k.reconcile(w.c.butler);
  assert.equal(w.k.read(w.c.human,'observation').length,1);assert.equal(w.k.read(w.c.human,'delivery').length,0);
  deliver(w,a);w.k.reconcile(w.c.butler);assert.equal(w.k.read(w.c.human,'artifact').length,1);assert.equal(w.k.read(w.c.human,'job')[0].attemptsUsed,1);
});

test('late images never change the original sources of an already submitted partial review',t=>{
  const w=workspace();t.after(()=>w.k.close());const {i}=first(w,2);const a=allocate(w,i.jobIds[0]);start(w,a);deliver(w,a);w.k.reconcile(w.c.butler);
  const images=w.k.read(w.c.human,'artifact'),{s}=submit(w,i,images);assert.equal(s.sourceArtifacts.length,1);
  const late=allocate(w,i.jobIds[1]);start(w,late);deliver(w,late,1);w.k.reconcile(w.c.butler);
  assert.equal(w.k.read(w.c.human,'artifact').length,2);assert.equal(w.k.read(w.c.human,'continuation')[0].sources.length,1);assert.equal(w.k.portable(w.c.human,s.id).originals.length,1);
});
