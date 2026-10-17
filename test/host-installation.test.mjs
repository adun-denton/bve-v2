import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,readFileSync,existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { serve } from '../src/server.mjs';
import { installHost,installationStatus,unavailableHost } from '../src/host-installation.mjs';
import { sessionCall,resumeSession } from '../scripts/session.mjs';
import { fixtureSpecifications,capabilities } from '../src/adapters.mjs';
import { fixturePNG } from '../src/png.mjs';
const disposable=()=>join(mkdtempSync(join(tmpdir(),'bve-host-')),'private');
const invoke=(a,op,input,key=randomUUID())=>sessionCall(a,{op,input,key});
export function fixtureHost(){
  const access={},ids={},keys={},created=[];
  return {id:'authored-fixture-host',kind:'fixture',access,ids,keys,created,
    async discover(){return Object.fromEntries(['sessions','delegation','resume','image','originalBytes','userHandoff'].map(k=>[k,{status:'tested',evidence:'Authored simulated host; no native image/session integration'}]));},
    async ensureSession({role,key,previous}){keys[role]=key;ids[role]??=previous?.id??`fixture-${role}-${randomUUID()}`;if(!created.includes(ids[role]))created.push(ids[role]);return {id:ids[role],url:`https://example.invalid/fixture/${ids[role]}`,receipt:`simulated:${key}`};},
    async verifySession({role,accessFile}){access[role]=JSON.parse(readFileSync(accessFile));await resumeSession(access[role]);},
    async verifyDelegation({projectId}){
      for(const role of ['generator','butler']){
        const d=await invoke(access.conductor,'host.delegate',{kind:'readiness',toRole:role,projectId});
        await resumeSession(access[role]);
        await invoke(access[role],'host.receipt',{delegationId:d.id,status:'completed',detail:'Simulated role received readiness; no image call'});
      }
    },
    async startConductor(){await resumeSession(access.conductor);}
  };
}
const create=(app,name='Authored operational fixture')=>app.kernel.call(app.credentials.human,'project.create',randomUUID(),{name,brief:'A disposable installation contract test',count:1});
const setup=async()=>{const app=await serve({root:disposable(),port:0}),project=create(app),host=fixtureHost();const result=await installHost({kernel:app.kernel,owner:app.credentials,origin:app.origin,host,projectId:project.id});return {app,project,host,result};};

test('installation verifies scoped reads/routes, backs up, and safely reuses three fixture sessions',async()=>{
  const {app,project,host,result}=await setup();try{
    assert.equal(result.status,'fixture-verified');assert.equal(result.conductor,null);assert.equal(host.created.length,3);
    assert.ok(result.sessions.every(s=>s.readReceipt));assert.ok(existsSync(app.kernel.hostState(app.credentials).backup+'/workspace.sqlite'));
    const before=result.sessions.map(s=>s.sessionId);const second=await installHost({kernel:app.kernel,owner:app.credentials,origin:app.origin,host,projectId:project.id});
    assert.deepEqual(second.sessions.map(s=>s.sessionId),before);assert.equal(host.created.length,3);
    assert.equal(app.kernel.read(app.credentials.human,'request').length,0);assert.equal(app.kernel.read(app.credentials.generator,'assignment').length,0);
  }finally{await app.stop();}
});

test('missing controls, documented-only support, fake probes and fake routes cannot complete installation',async()=>{
  const app=await serve({root:disposable(),port:0});try{
    let r=await installHost({kernel:app.kernel,owner:app.credentials,origin:app.origin,host:unavailableHost});
    assert.equal(r.status,'incomplete');assert.equal(r.sessions.length,0);
    assert.ok(r.gaps.some(g=>g.includes('sessions')));
  }finally{await app.stop();}
  for(const failure of ['documented','probe','routes']){
    const app=await serve({root:disposable(),port:0}),host=fixtureHost();
    if(failure==='documented')host.discover=async()=>({sessions:{status:'documented',evidence:'Vendor page'}});
    if(failure==='probe')host.verifySession=async()=>true;
    if(failure==='routes')host.verifyDelegation=async()=>true;
    try{const r=await installHost({kernel:app.kernel,owner:app.credentials,origin:app.origin,host});assert.equal(r.status,'incomplete');assert.ok(r.gaps.length);}finally{await app.stop();}
  }
});

test('session scope rejects wrong roles, foreign jobs/events/originals and labels granting authority',async()=>{
  const {app,project,host}=await setup();try{
    const other=create(app,'Foreign fixture'),r=app.kernel.call(app.credentials.human,'request.create','foreign-request',{projectId:other.id,intent:'One authored candidate'});
    const i=app.kernel.call(app.credentials.conductor,'iteration.commission','foreign-commission',{requestId:r.id,specifications:fixtureSpecifications({brief:other.brief,count:1})});
    await assert.rejects(()=>invoke(host.access.conductor,'job.allocate',{role:'generator',jobId:i.jobIds[0]}),/boundary|cannot call/);
    await assert.rejects(()=>invoke(host.access.generator,'job.allocate',{jobId:i.jobIds[0]}),/boundary/);
    await assert.rejects(()=>invoke(host.access.butler,'iteration.commission',{requestId:r.id}),/boundary|cannot call/);
    assert.equal((await resumeSession(host.access.conductor)).context.project.length,1);
    assert.equal((await resumeSession(host.access.conductor)).context.project[0].id,project.id);
    assert.throws(()=>app.kernel.bindSession(app.credentials,{role:'generator',sessionId:host.ids.conductor,projectId:project.id,nonce:'valid-nonce',replace:true}),/distinct actual sessions/);
    assert.throws(()=>app.kernel.hostBindings({conductor:app.credentials.conductor}),/Local installation/);
    assert.throws(()=>app.kernel.reconcile(host.access.butler.token),/deterministic Butler/);
  }finally{await app.stop();}
});

test('delegated fixture cycle preserves original intake, feedback, event distinctions and replacement context',async()=>{
  const {app,project,host}=await setup();try{
    const request=app.kernel.call(app.credentials.human,'request.create','native-request-fixture',{projectId:project.id,intent:'One authored fixture candidate'});
    const iteration=await invoke(host.access.conductor,'iteration.commission',{requestId:request.id,specifications:fixtureSpecifications({brief:project.brief,count:1})});
    const delegation=await invoke(host.access.conductor,'host.delegate',{projectId:project.id,kind:'dispatch',iterationId:iteration.id});
    await assert.rejects(()=>invoke(host.access.butler,'host.receipt',{delegationId:delegation.id,status:'acknowledged',detail:'Wrong recipient'}),/recipient boundary/);
    const inbox=await resumeSession(host.access.generator);assert.ok(inbox.delegations.some(d=>d.id===delegation.id));
    await invoke(host.access.generator,'host.receipt',{delegationId:delegation.id,status:'acknowledged',detail:'Received via simulated durable polling'});
    const a=await invoke(host.access.generator,'job.allocate',{jobId:iteration.jobIds[0],executor:'fixture-only',capability:capabilities.fixtureWorker},'host-allocate');
    await invoke(host.access.generator,'attempt.start',{assignmentId:a.id},'host-start');
    await assert.rejects(()=>invoke(host.access.generator,'attempt.start',{assignmentId:a.id},'host-start'),/already started/);
    await assert.rejects(()=>invoke(host.access.generator,'host.receipt',{delegationId:delegation.id,status:'completed',detail:'Premature'}),/not completed/);
    const bytes=fixturePNG(0);const receipt=app.kernel.call(a.token,'result.deliver','host-delivery',{assignmentId:a.id,outcome:'success',bytes:bytes.toString('base64'),evidence:{kind:'simulated',model:null,usage:null,cost:null}});
    const b=await invoke(host.access.conductor,'host.delegate',{kind:'reconcile',projectId:project.id});
    await invoke(host.access.butler,'host.receipt',{delegationId:b.id,status:'completed',detail:'Independent service reconciled fixture original'});
    await invoke(host.access.generator,'host.receipt',{delegationId:delegation.id,status:'completed',detail:'Kernel reports all assigned jobs resolved'});
    const artifact=app.kernel.read(app.credentials.human,'artifact')[0];assert.equal(artifact.deliveryId,receipt.deliveryId);assert.deepEqual(app.kernel.original(app.credentials.human,artifact.id),bytes);
    assert.throws(()=>app.kernel.original(host.access.generator.token,artifact.id),/original boundary/);
    const feedback={overall:'Preserve this submitted human wording',images:[{artifactId:artifact.id,sha256:artifact.sha256,version:1,width:artifact.width,height:artifact.height,note:'Quiet shape',favorite:true,regions:[]}]};
    const draft=app.kernel.call(app.credentials.human,'draft.save','draft-host',{iterationId:iteration.id,expectedVersion:0,feedback});
    const submission=app.kernel.call(app.credentials.human,'review.submit','submit-host',{iterationId:iteration.id,draftVersion:draft.version,intent:'iterate'});
    const old=host.access.conductor,bind=app.kernel.bindSession(app.credentials,{role:'conductor',sessionId:'replacement-conductor',sessionUrl:'https://example.invalid/replacement',projectId:project.id,nonce:'replacement-nonce',replace:true});
    const replacement={...old,token:bind.token,nonce:bind.nonce};
    await assert.rejects(()=>resumeSession(old),/Invalid function credential/);
    const resume=await resumeSession(replacement);assert.deepEqual(resume.context.continuation.find(c=>c.submissionId===submission.id).feedback,feedback);
    const event=resume.context.event.find(e=>e.submissionId===submission.id);assert.equal(event.acknowledgedAt,null);assert.equal(event.consumedAt,null);
    await invoke(replacement,'event.ack',{eventId:event.id,receipt:'actual simulated polling read'});
    assert.equal(app.kernel.read(app.credentials.conductor,'event').find(e=>e.id===event.id).consumedAt,null);
    await invoke(replacement,'event.consume',{eventId:event.id});
    assert.equal(app.kernel.read(app.credentials.generator,'assignment').length,1);assert.equal(app.kernel.read(app.credentials.human,'acceptance').length,0);
  }finally{await app.stop();}
});

test('owner restart recovers committed inbox and unread events; uncertain attempts are not restarted',async()=>{
  let {app,project,host}=await setup();const root=app.kernel.root;
  const r=app.kernel.call(app.credentials.human,'request.create','recovery-request',{projectId:project.id,intent:'Two authored fixture candidates',count:2});
  const i=await invoke(host.access.conductor,'iteration.commission',{requestId:r.id,specifications:fixtureSpecifications({brief:project.brief,count:2})});
  await invoke(host.access.conductor,'host.delegate',{projectId:project.id,kind:'dispatch',iterationId:i.id});
  const assignments=[];
  for(const jobId of i.jobIds){const a=await invoke(host.access.generator,'job.allocate',{jobId,executor:'fixture',capability:capabilities.fixtureWorker});await invoke(host.access.generator,'attempt.start',{assignmentId:a.id});assignments.push(a);}
  const payload={assignmentId:assignments[0].id,outcome:'success',bytes:fixturePNG(1).toString('base64'),evidence:{kind:'simulated'}};
  app.kernel.call(assignments[0].token,'result.deliver','interrupted-delivery',payload);await app.stop();
  app=await serve({root,port:0});try{
    const jobs=app.kernel.read(app.credentials.generator,'job');assert.equal(jobs[0].state,'succeeded');assert.equal(jobs[1].state,'uncertain');
    const receipt=app.kernel.call(assignments[0].token,'result.deliver','interrupted-delivery',payload);assert.equal(receipt.replayed,true);
    assert.throws(()=>app.kernel.call(assignments[0].token,'result.deliver','cross-assignment',{...payload,assignmentId:assignments[1].id}),/another assignment/);
    host.access.generator.origin=app.origin;
    await assert.rejects(()=>invoke(host.access.generator,'attempt.start',{assignmentId:assignments[1].id}),/uncertain/);
    const context=await resumeSession({...host.access.conductor,origin:app.origin});assert.ok(context.context.event.some(e=>!e.consumedAt));
    assert.equal(installationStatus(app.kernel,app.credentials).sessions.length,3);
  }finally{await app.stop();}
});

test('lost session creation response reuses stable provisioning key without duplicate sessions',async()=>{
  const app=await serve({root:disposable(),port:0}),host=fixtureHost(),ensure=host.ensureSession;let once=true;
  host.ensureSession=async args=>{const r=await ensure(args);if(once){once=false;throw Error('Lost host response');}return r;};
  try{
    const first=await installHost({kernel:app.kernel,owner:app.credentials,origin:app.origin,host});assert.equal(first.status,'incomplete');
    const key=host.keys.conductor;
    const second=await installHost({kernel:app.kernel,owner:app.credentials,origin:app.origin,host});assert.equal(second.status,'fixture-verified');assert.equal(host.keys.conductor,key);assert.equal(host.created.length,3);
    const p=create(app);const read=await resumeSession(host.access.conductor);assert.equal(read.context.project[0].id,p.id);
    assert.equal(app.kernel.hostBindings(app.credentials).find(b=>b.role==='conductor').projectId,p.id);
  }finally{await app.stop();}
});

test('role runtime helpers perform serial delegated work and skip already completed/uncertain attempts',async()=>{
  const {runGenerator,runButler}=await import('../src/host-runtime.mjs');
  const {app,project,host}=await setup();try{
    const r=app.kernel.call(app.credentials.human,'request.create','runtime-request',{projectId:project.id,intent:'Two authored fixtures',count:2});
    const i=await invoke(host.access.conductor,'iteration.commission',{requestId:r.id,specifications:fixtureSpecifications({brief:project.brief,count:2})});
    await assert.rejects(()=>invoke(host.access.generator,'job.allocate',{jobId:i.jobIds[0],executor:'fake',capability:capabilities.fixtureWorker}),/No dispatch delegation/);
    const d=await invoke(host.access.conductor,'host.delegate',{projectId:project.id,kind:'dispatch',iterationId:i.id});
    let calls=0;
    const adapter={id:'fixture-runtime',capability:capabilities.fixtureWorker,async execute(){calls++;if(calls===2)throw Error('Uncertain external return');return {outcome:'success',bytes:fixturePNG(0).toString('base64'),evidence:{kind:'simulated'}};}};
    const outcome=await runGenerator(host.access.generator,adapter,d.id);assert.equal(outcome.state,'blocked');assert.equal(calls,2);
    await runGenerator(host.access.generator,adapter,d.id);assert.equal(calls,2);
    const b=await invoke(host.access.conductor,'host.delegate',{projectId:project.id,kind:'reconcile'});
    assert.equal((await runButler(host.access.butler,b.id)).state,'completed');
    const jobs=app.kernel.read(app.credentials.generator,'job');assert.deepEqual(jobs.map(j=>j.state),['succeeded','uncertain']);
    assert.equal(app.kernel.read(app.credentials.generator,'assignment').length,2);
  }finally{await app.stop();}
});

test('replacement revokes old scope, rebinds unfinished routes and requires fresh installation probes',async()=>{
  const {app,project,host}=await setup();try{
    const d=await invoke(host.access.conductor,'host.delegate',{projectId:project.id,kind:'readiness',toRole:'generator'});
    const old=host.access.generator;
    const replacement=app.kernel.bindSession(app.credentials,{role:'generator',sessionId:'new-generator',projectId:project.id,nonce:'new-generator-nonce',replace:true});
    assert.equal(installationStatus(app.kernel,app.credentials).status,'incomplete');
    await assert.rejects(()=>resumeSession(old),/Invalid function credential/);
    const next={...old,token:replacement.token,nonce:replacement.nonce};assert.ok((await resumeSession(next)).delegations.some(v=>v.id===d.id));
    host.ids.generator='new-generator';
    host.verifySession=async()=>true;
    const result=await installHost({kernel:app.kernel,owner:app.credentials,origin:app.origin,host,projectId:project.id});
    assert.equal(result.status,'incomplete');assert.match(result.gaps[0],/session-originated scoped read/);
  }finally{await app.stop();}
});

test('scoped Kernel command transport preserves roles without taking owner status or marking running attempts uncertain',async()=>{
  const {app,project,host}=await setup();try{
    const access={...host.access.conductor,transport:'kernel',root:app.kernel.root,origin:'http://127.0.0.1:1'};
    const resume=await resumeSession(access);assert.equal(resume.context.project[0].id,project.id);
    const r=app.kernel.call(app.credentials.human,'request.create','kernel-transport-request',{projectId:project.id,intent:'One fixture'});
    const i=await invoke(access,'iteration.commission',{requestId:r.id,specifications:fixtureSpecifications({brief:project.brief,count:1})});
    await invoke(access,'host.delegate',{projectId:project.id,kind:'dispatch',iterationId:i.id});
    const gen={...host.access.generator,transport:'kernel',root:app.kernel.root};
    const a=await invoke(gen,'job.allocate',{jobId:i.jobIds[0],executor:'fixture',capability:capabilities.fixtureWorker});await invoke(gen,'attempt.start',{assignmentId:a.id});
    await resumeSession(access);assert.equal(app.kernel.read(app.credentials.generator,'job')[0].state,'running');
    await assert.rejects(()=>invoke(access,'attempt.start',{assignmentId:a.id}),/cannot call/);
    await assert.rejects(()=>serve({root:app.kernel.root,port:0}),/running owner/);
  }finally{await app.stop();}
});

test('concurrent installers cannot duplicate provisioning; native claim without a fresh handoff read stays incomplete',async()=>{
  const app=await serve({root:disposable(),port:0}),host=fixtureHost();
  let release,entered;const wait=new Promise(ok=>release=ok),start=new Promise(ok=>entered=ok);const discover=host.discover;
  host.discover=async()=>{entered();await wait;return discover();};
  try{
    const first=installHost({kernel:app.kernel,owner:app.credentials,origin:app.origin,host});await start;
    await assert.rejects(()=>installHost({kernel:app.kernel,owner:app.credentials,origin:app.origin,host}),/already running/);
    release();assert.equal((await first).status,'fixture-verified');assert.equal(host.created.length,3);
    host.kind='native';host.startConductor=async()=>true;
    const noRead=await installHost({kernel:app.kernel,owner:app.credentials,origin:app.origin,host});
    assert.equal(noRead.status,'incomplete');assert.match(noRead.gaps[0],/fresh durable context read/);
  }finally{release();await app.stop();}
});
