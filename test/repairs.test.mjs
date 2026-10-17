import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { Kernel } from '../src/kernel.mjs';
import { workspace,first,finish,submit,allocate,start,deliver } from './helpers.mjs';
import { fixtureSpecifications,dispatch,fixtureAdapter } from '../src/adapters.mjs';
import { fixturePNG,hash } from '../src/png.mjs';

const ref=(a,role='Chosen content',regions=[])=>({artifactId:a.id??a.artifactId,version:a.version,sha256:a.sha256,width:a.width,height:a.height,role,regions});
function reviewed(t,count=6){
  const w=workspace();t.after(()=>w.k.close());const {p,i}=first(w,count),images=finish(w,i),{s}=submit(w,i,images);
  return {w,p,i,images,s};
}
function child(w,p,s,{direction='Follow',brand=undefined,sets=[[]],interpretation='Authored Conductor interpretation: choose only the explicitly named inputs.'}={}){
  const r=w.call('human','request.create',{projectId:p.id,parentReviewId:s.id,intent:'Create this bounded child iteration',count:sets.length,direction,...(brand===undefined?{}:{brand})});
  const input={requestId:r.id,interpretation,specifications:fixtureSpecifications({brief:'Explore the submitted judgment',count:sets.length,sourceSets:sets,iteration:2})};
  return {r,input,i:w.call('conductor','iteration.commission',input)};
}
function damage(w,a,kind='corrupt'){
  const db=new DatabaseSync(join(w.root,'workspace.sqlite'));
  if(kind==='corrupt')db.prepare('UPDATE bytes SET data=? WHERE hash=?').run(Buffer.from('damaged authored fixture'),a.sha256);
  if(kind==='missing-bytes')db.prepare('DELETE FROM bytes WHERE hash=?').run(a.sha256);
  if(kind==='missing-artifact')db.prepare("DELETE FROM records WHERE kind='artifact' AND id=?").run(a.id);
  db.close();w.k.reconcile(w.c.butler);
}
const snapshot=(w,s)=>JSON.stringify(w.k.read(w.c.human,'submission').find(x=>x.id===s.id));
function boundRegion(s,index=0){const r=s.feedback.images[0].regions[index];return {space:r.space,x:r.x,y:r.y,w:r.w,h:r.h,meaning:'Open this area as an authored creative preference',reviewRegion:{reviewId:s.id,index}};}

test('R01: six-image review remains immutable while children use one/two chosen roles and only selected regions',t=>{
  const {w,p,i,images,s}=reviewed(t),before=snapshot(w,s);
  assert.equal(s.sourceArtifacts.length,6);assert.ok(s.sourceArtifacts.every(r=>r.sha256&&r.version&&r.width));
  const a=ref(images[0],'Composition to develop',[boundRegion(s)]),b=ref(images[1],'Palette reference only'),c=ref(images[2],'Content reference only');
  const follow=child(w,p,s,{sets:[[a],[b,c]]});
  assert.equal(follow.i.parentIterationId,i.id);assert.equal(follow.i.parentReviewId,s.id);
  const jobs=w.k.read(w.c.human,'job').filter(j=>j.iterationId===follow.i.id);
  assert.equal(jobs[0].specification.sources.length,1);assert.equal(jobs[1].specification.sources.length,2);
  assert.equal(jobs[0].specification.sources[0].regions[0].meaning,a.regions[0].meaning);
  assert.equal(jobs[1].specification.sources.every(s=>s.regions.length===0),true);
  assert.equal(jobs[0].specification.regions,undefined);
  assert.equal(snapshot(w,s),before);assert.deepEqual(w.k.read(w.c.human,'continuation')[0].feedback,s.feedback);
});

test('R01: Fresh permits zero old inputs or an explicit content reference without losing lineage',t=>{
  const {w,p,i,images,s}=reviewed(t,2);
  const fresh=child(w,p,s,{direction:'Fresh',sets:[[],[ref(images[1],'Subject matter only, not historical style')]]});
  const jobs=w.k.read(w.c.human,'job').filter(j=>j.iterationId===fresh.i.id);
  assert.equal(jobs[0].specification.sources.length,0);assert.equal(jobs[1].specification.sources[0].role,'Subject matter only, not historical style');
  assert.equal(jobs[0].specification.lineage.parentIterationId,i.id);assert.equal(fresh.i.parentReviewId,s.id);
});

for(const kind of ['corrupt','missing-bytes','missing-artifact'])test('R01: '+kind+' historical evidence is disclosed without blocking independent jobs',async t=>{
  const {w,p,images,s}=reviewed(t,3),before=snapshot(w,s);
  damage(w,images[2],kind);
  const follow=child(w,p,s,{sets:[[ref(images[0],'Composition')],[ref(images[2],'Required missing subject')],[]]});
  let jobs=w.k.read(w.c.human,'job').filter(j=>j.iterationId===follow.i.id);
  assert.deepEqual(jobs.map(j=>j.state),['queued','blocked','queued']);assert.equal(jobs[1].dependencyIssues[0].artifactId,images[2].id);
  assert.throws(()=>allocate(w,jobs[1].id),/already allocated or resolved/);
  await dispatch(w.k,w.c,fixtureAdapter(2),follow.i.jobIds);
  jobs=w.k.read(w.c.human,'job').filter(j=>j.iterationId===follow.i.id);
  assert.deepEqual(jobs.map(j=>j.state),['succeeded','blocked','succeeded']);
  assert.equal(jobs[1].allowanceReserved,0);assert.equal(jobs[1].invocationsStarted,0);
  const c=w.k.read(w.c.human,'continuation').find(c=>c.id===s.id);
  assert.equal(c.status,'ready');assert.equal(c.historicalCoverage.status,'limited');assert.equal(c.historicalCoverage.issues[0].artifactId,images[2].id);
  assert.equal(c.reviewEvidence.length,3);assert.equal(snapshot(w,s),before);
  const history=w.k.portable(w.c.human,s.id);assert.equal(history.coverage.status,'limited');assert.equal(history.originals.length,2);
  const independent=w.k.portable(w.c.human,s.id,{jobId:jobs[2].id});assert.equal(independent.coverage.status,'complete');assert.equal(independent.originals.length,0);assert.equal(independent.coverage.historical,'limited');
  const dependent=w.k.portable(w.c.human,s.id,{jobId:jobs[1].id});assert.equal(dependent.coverage.status,'blocked');assert.equal(dependent.coverage.missing[0].artifactId,images[2].id);
});

test('R01: production export includes exact chosen dependencies even outside the reviewed board',t=>{
  const {w,p,images,s}=reviewed(t,2);
  const other=child(w,p,s,{direction:'Fresh'}).i,libraryImage=finish(w,other)[0];
  const follow=child(w,p,s,{sets:[[ref(images[0],'Palette'),ref(libraryImage,'New project-library content')]]});
  const packet=w.k.portable(w.c.conductor,s.id,{jobId:follow.i.jobIds[0]});
  assert.equal(packet.purpose.kind,'production-job');assert.equal(packet.coverage.status,'complete');assert.equal(packet.originals.length,2);
  assert.deepEqual(packet.originals.map(r=>r.role),['Palette','New project-library content']);
  packet.originals.forEach(r=>assert.equal(hash(Buffer.from(r.bytes,'base64')),r.sha256));

});

test('R01: foreign identities, hash/version drift and invalid region bindings reject',t=>{
  const {w,p,images,s}=reviewed(t,2),foreignProject=w.call('human','project.create',{name:'Separate fixture',brief:'Independent project'});
  const r=w.call('human','request.create',{projectId:foreignProject.id,intent:'One authored result'}),foreign=w.call('conductor','iteration.commission',{requestId:r.id,specifications:fixtureSpecifications({brief:'Foreign',count:1})});
  const foreignImage=finish(w,foreign)[0];
  for(const source of [ref(foreignImage),{...ref(images[0]),sha256:'wrong'},{...ref(images[0]),version:2},{...ref(images[0]),width:99}]){
    assert.throws(()=>child(w,p,s,{sets:[[source]]}),/Foreign source|identity|width/);
  }
  for(const region of [{...boundRegion(s),x:.95},{...boundRegion(s),x:.11},{...boundRegion(s),reviewRegion:{reviewId:s.id,index:99}}]){
    assert.throws(()=>child(w,p,s,{sets:[[ref(images[0],'Selected region',[region])]]}),/outside|geometry|index/);
  }
  assert.throws(()=>child(w,p,s,{sets:[[ref(images[1],'Wrong review image',[boundRegion(s)])]]}),/index|binding/);
  assert.throws(()=>w.k.portable(w.c.human,s.id,{jobId:foreign.jobIds[0]}),/job\/review mismatch/);
});

test('R01: source loss after allocation blocks only the dependent start and recovery preserves its reservation',t=>{
  const {w,p,images,s}=reviewed(t,2),follow=child(w,p,s,{sets:[[ref(images[0])],[]]}),a=allocate(w,follow.i.jobIds[0]);
  const original=w.k.original(w.c.human,images[0].id);damage(w,images[0],'missing-bytes');assert.throws(()=>start(w,a),/already started or is uncertain/);
  let job=w.k.read(w.c.human,'job').find(j=>j.id===a.jobId);assert.equal(job.state,'blocked');assert.equal(job.allowanceReserved,1);assert.equal(job.invocationsStarted,0);
  // Restore only the exact original bytes from the authored fixture; no substitute image.
  const db=new DatabaseSync(join(w.root,'workspace.sqlite'));
  assert.equal(hash(original),images[0].sha256);db.prepare('INSERT INTO bytes VALUES(?,?)').run(images[0].sha256,original);db.close();
  w.k.reconcile(w.c.butler);job=w.k.read(w.c.human,'job').find(j=>j.id===a.jobId);assert.equal(job.state,'assigned');start(w,a);assert.equal(w.k.assignment(a.token).attemptId,a.attemptId);
});

for(const direction of ['Fresh','Follow'])for(const brand of [null,'Warm and restrained'])test('R02: real assignment and dispatch freeze '+direction+' / Brand '+(brand??'off'),async t=>{
  const w=workspace();t.after(()=>w.k.close());
  const p=w.call('human','project.create',{name:'Settings fixture',brief:'One authored composition',direction,brand}),r=w.call('human','request.create',{projectId:p.id,intent:'Generate using inherited settings'});
  const input={requestId:r.id,specifications:fixtureSpecifications({brief:p.brief,count:1})},i=w.call('conductor','iteration.commission',input,'settings-commission');
  // Later project defaults must not rebind the existing job.
  w.call('human','request.create',{projectId:p.id,intent:'Future distinct settings',direction:direction==='Fresh'?'Follow':'Fresh',brand:brand===null?'Later brand':null});
  assert.deepEqual(w.call('conductor','iteration.commission',input,'settings-commission'),i);
  let observed;
  await dispatch(w.k,w.c,{...fixtureAdapter(),async execute(a){observed=a;const scoped=w.k.assignment(a.token);assert.equal(scoped.specification.direction,direction);assert.equal(scoped.specification.brand,brand);return fixtureAdapter().execute(a);}},i.jobIds);
  assert.equal(observed.specification.direction,direction);assert.equal(observed.specification.brand,brand);assert.equal(observed.specification.allowance.primaryAttempts,1);assert.equal(observed.specification.allowance.maxRetries,0);
  assert.equal(observed.tokenHash,undefined);assert.throws(()=>w.k.read(observed.token,'project'),/credential/);
  assert.equal(w.k.read(w.c.human,'job').find(j=>j.id===i.jobIds[0]).invocationsStarted,1);
});

test('R02: changed subsequent settings reach the worker; contradictory supplied fields reject transactionally',t=>{
  const {w,p,s}=reviewed(t,1),follow=child(w,p,s,{direction:'Follow',brand:null});
  const a=allocate(w,follow.i.jobIds[0]);assert.equal(w.k.assignment(a.token).specification.brand,null);assert.equal(w.k.assignment(a.token).specification.direction,'Follow');
  const r=w.call('human','request.create',{projectId:p.id,intent:'Explicit new brand',direction:'Fresh',brand:'Cobalt'});
  for(const extra of [{direction:'Follow'},{brand:null}]){
    const spec={...fixtureSpecifications({brief:'Mismatch',count:1})[0],...extra};
    assert.throws(()=>w.call('conductor','iteration.commission',{requestId:r.id,specifications:[spec]}),/contradicts/);
  }
  assert.equal(w.k.read(w.c.human,'request').find(q=>q.id===r.id).state,'waiting-for-conductor');
});

function contextInput(p,i,s,images){return {projectId:p.id,iterationId:i.id,reviewId:s.id,kind:'rationale',text:'Favor a quieter center while retaining the original human words separately.',sources:[ref(images[0],'Reasoning reference')],constraints:['Advisory; does not override the request'],provenance:{author:null,executor:'authored-Conductor-fixture',tool:null}};}

test('R03: optional creative context survives owner/Conductor replacement before and after a child commission',t=>{
  const {w,p,i,images,s}=reviewed(t,2),before=snapshot(w,s),input=contextInput(p,i,s,images);
  const n=w.call('conductor','creativeContext.supply',input,'note-one');assert.equal(n.version,1);assert.equal(n.provenance.author,null);
  assert.deepEqual(w.call('conductor','creativeContext.supply',input,'note-one'),n);
  assert.throws(()=>w.call('conductor','creativeContext.supply',{...input,text:'Conflicting replay'},'note-one'),/payload conflict/);
  w.k.close();w.k=new Kernel(w.root);
  let c=w.k.read(w.c.conductor,'continuation').find(c=>c.id===s.id);assert.equal(c.optional.conductorNotes.status,'available');assert.equal(c.creativeContext[0].id,n.id);assert.equal(snapshot(w,s),before);
  // Context recovers before a child exists; supplying it never commissions work.
  assert.equal(w.k.read(w.c.human,'iteration').length,1);
  const r=w.k.call(w.c.human,'request.create','new-child',{projectId:p.id,parentReviewId:s.id,intent:'Fresh after session replacement',count:1,direction:'Fresh'});
  w.k.call(w.c.conductor,'iteration.commission','child-after-restart',{requestId:r.id,interpretation:'A distinct child interpretation',specifications:fixtureSpecifications({brief:p.brief,count:1})});
  const revised=w.k.call(w.c.conductor,'creativeContext.supply','note-two',{...input,text:'Revised advisory rationale after child commission.',supersedes:n.id});
  assert.equal(revised.contextId,n.contextId);assert.equal(revised.version,2);assert.equal(revised.supersedes,n.id);
  assert.equal(w.k.read(w.c.conductor,'creativeContext').find(x=>x.id===n.id).text,input.text);
  w.k.close();w.k=new Kernel(w.root);c=w.k.read(w.c.conductor,'continuation').find(c=>c.id===s.id);
  assert.equal(c.creativeContext.length,1);assert.equal(c.creativeContext[0].id,revised.id);assert.equal(snapshot(w,s),before);
  assert.deepEqual(c.feedback,s.feedback);assert.equal(c.optional.screenshots.required,false);
});

test('R03: validation rejects foreign/invalid origins, excessive bounds and attempts to cross functional ownership',t=>{
  const {w,p,i,images,s}=reviewed(t,1),input=contextInput(p,i,s,images),foreign=w.call('human','project.create',{name:'Another fixture',brief:'Unrelated'});
  for(const patch of [{projectId:foreign.id},{iterationId:'missing'},{reviewId:'missing'},{text:'x'.repeat(4001)},{sources:[{...ref(images[0]),sha256:'wrong'}]},{constraints:Array(13).fill('x')},{provenance:{accountCredential:'not-allowed'}},{feedback:{overall:'replace human judgment'}},{artifact:{bytes:'not image registration'}}]){
    assert.throws(()=>w.call('conductor','creativeContext.supply',{...input,...patch}),/mismatch|Missing|Invalid|Unsupported/);
  }
  for(const role of ['human','generator','butler'])assert.throws(()=>w.call(role,'creativeContext.supply',input),/cannot call/);
  assert.throws(()=>w.call('conductor','result.register',input),/cannot call/);
  const note=w.call('conductor','creativeContext.supply',input);
  w.call('conductor','creativeContext.supply',{...input,supersedes:note.id,text:'Revision'});
  assert.throws(()=>w.call('conductor','creativeContext.supply',{...input,supersedes:note.id,text:'Branching revision'}),/superseded/);
});

test('R03: portable context is bounded/relevant, notes stay optional when their references are unavailable',t=>{
  const {w,p,i,images,s}=reviewed(t,2),input=contextInput(p,i,s,images);
  for(let n=0;n<8;n++)w.call('conductor','creativeContext.supply',{...input,text:'Authored bounded note '+n});
  assert.throws(()=>w.call('conductor','creativeContext.supply',{...input,text:'Ninth note'}),/eight/);
  const another=child(w,p,s,{direction:'Fresh'}).i;
  w.call('conductor','creativeContext.supply',{...input,iterationId:another.id,reviewId:null,text:'Unrelated child reasoning excluded from parent export'});
  damage(w,images[0]);const packet=w.k.portable(w.c.conductor,s.id);
  assert.equal(packet.continuation.creativeContext.length,8);assert.equal(packet.continuation.status,'ready');assert.equal(packet.continuation.optional.conductorNotes.sourceIssues[0].artifactId,images[0].id);
  assert.ok(!JSON.stringify(packet).includes('Unrelated child reasoning'));
  Object.values(w.c).forEach(secret=>assert.ok(!JSON.stringify(packet).includes(secret)));
  const after=child(w,p,s,{direction:'Fresh'});assert.ok(after.i.id);
});

test('A01: reservation and durable start counters stay distinct through unsent recovery, uncertainty, late delivery and duplicate start',t=>{
  const {w,i}=firstFixture(t),a=allocate(w,i.jobIds[0]);
  let job=w.k.read(w.c.human,'job')[0];assert.equal(job.allowanceReserved,1);assert.equal(job.invocationsStarted,0);assert.equal(job.attemptsUsed,undefined);assert.equal(a.startedAt,null);
  w.k.close();w.k=new Kernel(w.root);assert.equal(w.k.assignment(a.token).state,'assigned');
  w.k.call(w.c.generator,'attempt.start','first-start',{assignmentId:a.id});
  job=w.k.read(w.c.human,'job')[0];assert.equal(job.invocationsStarted,1);assert.equal(job.allowanceReserved,1);
  w.k.close();w.k=new Kernel(w.root);assert.equal(w.k.assignment(a.token).state,'uncertain');
  assert.throws(()=>w.k.call(w.c.generator,'attempt.start','first-start',{assignmentId:a.id}),/already started/);
  w.k.call(a.token,'result.deliver','late',{assignmentId:a.id,outcome:'success',bytes:fixturePNG().toString('base64'),evidence:{kind:'simulated',usage:null,cost:null}});
  w.k.reconcile(w.c.butler);job=w.k.read(w.c.human,'job')[0];assert.equal(job.invocationsStarted,1);assert.equal(job.state,'succeeded');
});
function firstFixture(t){const w=workspace();t.after(()=>w.k.close());return {w,...first(w,1)};}
