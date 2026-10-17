import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync,readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Kernel } from '../src/kernel.mjs';
import { workspace,feedback } from './helpers.mjs';
import { installHost,unavailableHost } from '../src/host-installation.mjs';
import { fixtureAdapter,fixtureSpecifications,capabilities } from '../src/adapters.mjs';
import { ensureStaff,runWorker,returnRound } from '../src/host-runtime.mjs';
import { resumeSession,sessionOriginal } from '../scripts/session.mjs';
import { conductor,fixtureHost,activate,prepare,generation,retire,runCanonicalExamples,call,ref } from './project-fixture.mjs';

test('Example A: exploration activates Iman Website only on production; B1 ready precedes exactly Gen1–Gen3',async()=>{
 const w=workspace();try{
  const C1=conductor(w);assert.equal(w.k.read(w.c.human,'project').length,0);assert.equal(w.k.hostBindings(w.c).length,1);assert.equal(w.k.read(w.c.human,'round').length,0);
  // The same existing C1 is used by the canonical activation helper.
  const ctx=await activate(w);assert.equal(ctx.C1.sessionId,C1.sessionId);assert.equal(ctx.project.name,'Iman Website');assert.equal(ctx.project.code,'P001');assert.equal(ctx.project.folder,join(w.root,'Projects',ctx.project.id));
  assert.equal(ctx.host.created.length,1);assert.equal(ctx.host.created[0].id,'B1');assert.equal(existsSync(ctx.project.folder),false);
  const A=await generation(ctx);assert.ok(existsSync(ctx.project.folder));assert.equal(A.round.code,'R001');assert.equal(A.round.expectedResults,3);
  assert.deepEqual(ctx.host.created.map(s=>s.id),['B1','Gen1','Gen2','Gen3']);assert.deepEqual(ctx.host.received.map(r=>r.receivedBy),['B1','Gen1','Gen2','Gen3']);assert.equal(w.k.hostBindings(w.c).length,5);
  assert.ok(w.k.hostBindings(w.c).every(b=>['conductor','butler','worker'].includes(b.role)));
  for(const st of A.statements){assert.equal(st.projectId,ctx.project.id);assert.equal(st.butler.sessionId,'B1');assert.equal(st.butlerInstructions,A.round.butlerInstructions);assert.equal(st.prompt,w.k.read(w.c.generator,'job').find(j=>j.id===st.jobId).specification.prompt);}
  const checkpoints=w.k.read(w.c.human,'checkpoint');assert.equal(checkpoints.length,1);assert.equal(checkpoints[0].state,'completed');assert.equal(checkpoints[0].artifacts.length,3);
  assert.equal(ctx.host.notifications.length,1);assert.equal(ctx.host.notifications[0].sessionId,'C1');assert.equal(w.k.read(w.c.human,'event').find(e=>e.roundId===A.round.id).consumedAt,null);
  assert.ok(w.k.read(w.c.human,'statementEvent').some(e=>e.kind==='disposition'&&e.actor.sessionId==='C1'));
 }finally{w.k.close();}
});

test('Examples B/C: R004 comparison and R005 branch preserve history and recover C2 without duplicate workforce',async()=>{
 const w=workspace();try{
  const {ctx,A,R2,R3,B,C,C2,resumed}=await runCanonicalExamples(w);
  assert.equal(B.code,'R004');assert.equal(B.expectedResults,0);assert.equal(C.code,'R005');assert.equal(C.parentRoundId,R2.round.id);
  assert.equal(ctx.host.created.length,6); // one Butler plus 3+1+1 past workers; none for B/C
  assert.equal(w.k.read(w.c.human,'artifact').length,5);assert.equal(w.k.read(w.c.generator,'assignment').length,5);
  const comparison=w.k.read(w.c.human,'checkpoint').find(c=>c.roundId===B.id);assert.deepEqual(comparison.artifacts.map(r=>r.artifactId),[...A.artifacts.map(a=>a.id),R3.artifacts[0].id]);
  const roundIds=resumed.context.round.map(r=>r.id);assert.ok([R2.round.id,R3.round.id,B.id,C.id].every(id=>roundIds.includes(id)));
  assert.equal(resumed.context.sessionBinding.filter(b=>!b.revokedAt&&b.role==='butler').length,1);assert.equal(resumed.context.sessionBinding.filter(b=>b.role==='worker').length,5);
  await assert.rejects(()=>resumeSession(ctx.C1),/Invalid function credential/);assert.equal(resumed.context.projectInstruction[0].text,'Develop Iman Website from the recorded brief; preserve original references and human judgments.');
  await ensureStaff(C2,ctx.host,{role:'butler'});assert.equal(ctx.host.created.length,6);
  assert.equal(resumed.context.checkpoint.length,5);assert.equal(w.k.read(w.c.human,'acceptance').length,0);
  assert.deepEqual(await sessionOriginal(C2,A.artifacts[0].id),w.k.original(w.c.human,A.artifacts[0].id));
 }finally{w.k.close();}
});

test('identity, readiness, tier, project and exact worker assignment boundaries are enforced',async()=>{
 const w=workspace();try{
  const ctx=await activate(w),round=await call(ctx.C1,'round.create',{projectId:ctx.project.id,operation:'generate',requestId:ctx.request.id,intent:ctx.request.intent,butlerInstructions:'Expect exactly three original results and preserve these instructions.'});
  await assert.rejects(()=>call(ctx.C1,'iteration.commission',{requestId:ctx.request.id,specifications:fixtureSpecifications({brief:'x',count:3})}),/round.commission/);
  await assert.rejects(()=>call(ctx.C1,'round.commission',{roundId:round.id,specifications:fixtureSpecifications({brief:'x',count:3})}),/Butler must be ready/);
  await assert.rejects(()=>call(ctx.C1,'staff.bind',{projectId:ctx.project.id,role:'generator',tier:'LUNA'}),/only Butler or workers/);
  await assert.rejects(()=>call(ctx.C1,'staff.bind',{projectId:ctx.project.id,role:'butler',tier:'SOL',sessionId:'wrong',nonce:'n',hostReceipt:'test'}),/model tier/);
  await call(ctx.host.access.B1,'statement.report',{statementId:round.statementId,status:'ready',text:'Verified expected three'});
  const i=await call(ctx.C1,'round.commission',{roundId:round.id,specifications:fixtureSpecifications({brief:ctx.project.brief,count:3})});
  const b=await ensureStaff(ctx.C1,ctx.host,{role:'worker',jobId:i.jobIds[0]});await call(ctx.C1,'worker.assign',{projectId:ctx.project.id,bindingId:b.id,capability:capabilities.fixtureWorker});
  const worker=ctx.host.access[b.sessionId],own=(await resumeSession(worker)).context;
  assert.equal(own.job.length,1);assert.equal(own.job[0].id,i.jobIds[0]);assert.equal(own.statement.length,1);
  await assert.rejects(()=>call(worker,'statement.report',{statementId:round.statementId,status:'produced',text:'Cross assignment'}),/mismatch/);
  await assert.rejects(()=>call(worker,'statement.report',{statementId:own.statement[0].id,status:'produced',text:'Report',butlerInstructions:'rewritten'}),/cannot rewrite/);
  await assert.rejects(()=>call(worker,'round.commission',{roundId:round.id}),/cannot call/);
  const other=w.call('human','project.create',{name:'Other',brief:'Another scope'});
  assert.throws(()=>w.k.bindSession(w.c,{role:'conductor',tier:'SOL',sessionId:'C1',projectId:other.id,nonce:'n',hostReceipt:'test'}),/another assignment\/project/);
  await assert.rejects(()=>call(ctx.C1,'round.create',{projectId:other.id,operation:'compare'}),/Cross-project/);
  await assert.rejects(()=>call(ctx.host.access.B1,'statement.report',{statementId:round.statementId,status:'completed',text:'Only one arrived'}),/presentation first/);
 }finally{w.k.close();}
});

test('maximum staff, stable provisioning reuse and current project instruction revisions survive restart',async()=>{
 const w=workspace();try{
  const ctx=await activate(w);await ensureStaff(ctx.C1,ctx.host,{role:'butler'});assert.equal(ctx.host.created.length,1);
  const r=w.call('human','request.create',{projectId:ctx.project.id,intent:'Six bounded concepts',count:6});const round=await prepare(ctx,{requestId:r.id});
  const i=await call(ctx.C1,'round.commission',{roundId:round.id,specifications:fixtureSpecifications({brief:'six',count:6})});
  for(const jobId of i.jobIds)await ensureStaff(ctx.C1,ctx.host,{role:'worker',jobId});
  assert.equal(w.k.hostBindings(w.c).filter(b=>b.projectId===ctx.project.id).length,8);
  const next=w.call('human','request.create',{projectId:ctx.project.id,intent:'A further bounded request',count:1});const nr=await prepare(ctx,{requestId:next.id});const ni=await call(ctx.C1,'round.commission',{roundId:nr.id,specifications:fixtureSpecifications({brief:'next',count:1})});
  await assert.rejects(()=>ensureStaff(ctx.C1,ctx.host,{role:'worker',jobId:ni.jobIds[0]}),/Maximum six/);assert.equal(ctx.host.created.length,7);
  await call(ctx.C1,'project.instructions',{projectId:ctx.project.id,expectedVersion:1,text:'Current concise project instructions.'});
  await assert.rejects(()=>call(ctx.C1,'project.instructions',{projectId:ctx.project.id,expectedVersion:1,text:'Stale overwrite'}),/instructions changed/);
  w.k.close();w.k=new Kernel(w.root);assert.equal((await resumeSession(ctx.C1)).context.projectInstruction.at(-1).text,'Current concise project instructions.');assert.equal(w.k.hostBindings(w.c).length,8);
 }finally{w.k.close();}
});

test('worker success report alone cannot complete delivery; replay and uncertainty retain original attempt',async()=>{
 const w=workspace();try{
  const ctx=await activate(w),round=await prepare(ctx);const i=await call(ctx.C1,'round.commission',{roundId:round.id,specifications:fixtureSpecifications({brief:'three',count:3})});
  const b=await ensureStaff(ctx.C1,ctx.host,{role:'worker',jobId:i.jobIds[0]});await call(ctx.C1,'worker.assign',{projectId:ctx.project.id,bindingId:b.id,capability:capabilities.fixtureWorker});
  const a=ctx.host.access[b.sessionId],st=(await resumeSession(a)).context.statement[0];
  await call(a,'statement.report',{statementId:st.id,status:'produced',text:'Claimed success without bytes'});
  assert.equal(w.k.read(w.c.human,'artifact').length,0);assert.equal(w.k.read(w.c.human,'checkpoint').length,0);
  let calls=0;await runWorker(a,{capability:capabilities.fixtureWorker,async execute(){calls++;throw Error('Unknown external return');}},st.id);
  await runWorker(a,fixtureAdapter(),st.id);assert.equal(calls,1);assert.equal(w.k.read(w.c.generator,'job')[0].state,'uncertain');
  await assert.rejects(()=>call(a,'worker.start',{roundId:round.id}),/already started|uncertain/);
  const assignment=(await resumeSession(a)).assignmentAccess,bytes=(await fixtureAdapter().execute({...assignment,specification:w.k.read(w.c.generator,'job')[0].specification})).bytes;
  const input={assignmentId:assignment.id,outcome:'success',bytes,evidence:{kind:'simulated'}};
  const delivered=w.k.call(assignment.token,'result.deliver','late-exact-delivery',input);w.k.reconcile(w.c.butler);
  assert.equal(w.k.call(assignment.token,'result.deliver','late-exact-delivery',input).replayed,true);assert.ok(delivered.deliveryId);
  assert.equal(w.k.read(w.c.generator,'job')[0].invocationsStarted,1);assert.equal(w.k.read(w.c.human,'artifact').length,1);
 }finally{w.k.close();}
});

test('comparison preserves unsent/saved notes and rejects omitted or foreign presentation material',async()=>{
 const w=workspace();try{
  const ctx=await activate(w),A=await generation(ctx);
  const draft=w.call('human','draft.save',{iterationId:A.iteration.id,expectedVersion:0,feedback:feedback(A.artifacts)});
  const B=await prepare(ctx,{operation:'compare',parentRoundId:A.round.id,references:A.artifacts.map(ref),intent:'Compare these recorded designs'});
  await call(ctx.host.access.B1,'round.present',{roundId:B.id,title:'Partial comparison',references:A.artifacts.slice(0,1).map(ref)});
  await assert.rejects(()=>call(ctx.host.access.B1,'statement.report',{statementId:B.statementId,status:'completed',text:'Incorrect complete claim'}),/omits assigned material/);
  await call(ctx.host.access.B1,'round.present',{roundId:B.id,title:'Complete comparison',references:A.artifacts.map(ref)});
  await call(ctx.host.access.B1,'statement.report',{statementId:B.statementId,status:'completed',text:'Same originals arranged'});
  assert.deepEqual(w.k.read(w.c.human,'draft')[0],draft);assert.equal(w.k.read(w.c.human,'artifact').length,3);assert.equal(w.k.read(w.c.generator,'assignment').length,3);
  assert.equal(w.k.read(w.c.human,'checkpoint').find(c=>c.roundId===B.id).state,'completed');
 }finally{w.k.close();}
});

test('installation provisions no project staff and reports unavailable native integration accurately',async()=>{
 const w=workspace();try{
  const r=await installHost({kernel:w.k,owner:w.c,host:unavailableHost});assert.equal(r.status,'incomplete');assert.equal(w.k.hostBindings(w.c).length,0);assert.equal(w.k.read(w.c.human,'project').length,0);
 }finally{w.k.close();}
 const x=workspace();try{const host=fixtureHost();const first=await installHost({kernel:x.k,owner:x.c,host});const second=await installHost({kernel:x.k,owner:x.c,host});assert.equal(first.status,'fixture-verified');assert.equal(second.staffProvisionedByInstaller,0);assert.equal(host.created.length,0);assert.ok(existsSync(join(x.k.hostState(x.c).backup,'workspace.sqlite')));}finally{x.k.close();}
});

test('concurrent installation and failed session creation do not create duplicate staff',async()=>{
 const w=workspace();let release,entered;const waiting=new Promise(ok=>release=ok),start=new Promise(ok=>entered=ok);
 try{const host=fixtureHost();const discover=host.discover;host.discover=async()=>{entered();await waiting;return discover();};const first=installHost({kernel:w.k,owner:w.c,host});await start;await assert.rejects(()=>installHost({kernel:w.k,owner:w.c,host}),/already running/);release();await first;
 const ctx=await activate(w),ensure=ctx.host.ensureSession;let lost=true;ctx.host.ensureSession=async args=>{const r=await ensure(args);if(lost){lost=false;throw Error('Lost creation response');}return r;};
 const req=w.call('human','request.create',{projectId:ctx.project.id,intent:'One extra fixture',count:1}),round=await prepare(ctx,{requestId:req.id});const i=await call(ctx.C1,'round.commission',{roundId:round.id,specifications:fixtureSpecifications({brief:'one',count:1})});
 await assert.rejects(()=>ensureStaff(ctx.C1,ctx.host,{role:'worker',jobId:i.jobIds[0]}),/Lost creation response/);const resumed=await ensureStaff(ctx.C1,ctx.host,{role:'worker',jobId:i.jobIds[0]});assert.equal(resumed.sessionId,'Gen1');assert.equal(ctx.host.created.length,2);
 }finally{release();w.k.close();}
});

test('project backup restores statements/checkpoints and reconstructs local folder without changing original bytes',async()=>{
 const {backupRoot}=await import('../scripts/backup.mjs');
 const {mkdtempSync}=await import('node:fs');const {tmpdir}=await import('node:os');
 const w=workspace();let restored;try{
  const ctx=await activate(w),A=await generation(ctx),dest=join(mkdtempSync(join(tmpdir(),'bve-project-backup-')),'restored');
  const bytes=w.k.original(w.c.human,A.artifacts[0].id);await backupRoot(w.root,dest);restored=new Kernel(dest);
  const owner=JSON.parse(readFileSync(join(dest,'credentials.json'))),p=restored.read(owner.human,'project')[0];
  assert.equal(p.folder,join(dest,'Projects',p.id));assert.ok(existsSync(p.folder));assert.equal(restored.read(owner.human,'checkpoint').length,1);assert.deepEqual(restored.original(owner.human,A.artifacts[0].id),bytes);
  assert.equal(restored.hostBindings(owner).length,5);assert.equal(restored.read(owner.human,'statement').filter(st=>st.jobId).length,3);
 }finally{restored?.close();w.k.close();}
});

test('round retrieval is scoped over HTTP and incomplete operations cannot be relabeled complete',async()=>{
 const {serve}=await import('../src/server.mjs');const {mkdtempSync}=await import('node:fs');const {tmpdir}=await import('node:os');
 const app=await serve({root:join(mkdtempSync(join(tmpdir(),'bve-project-http-')),'root'),port:0});
 try{
  const w={k:app.kernel,c:app.credentials,root:app.kernel.root},ctx=await activate(w),A=await generation(ctx);
  const get=async token=>fetch(app.origin+'/api/round?id='+A.round.id,{headers:{Authorization:'Bearer '+token}});
  const view=await get(app.credentials.human);assert.equal(view.status,200);assert.equal((await view.json()).presentation.references.length,3);
  assert.equal((await get('unbound-label-C1')).status,403);
  const other=app.kernel.call(app.credentials.human,'project.create','another-project',{name:'Cross-project negative control',brief:'Never a replacement scenario'});
  const b=app.kernel.bindSession(app.credentials,{role:'conductor',tier:'SOL',sessionId:'foreign-C',projectId:other.id,nonce:'foreign-nonce',hostReceipt:'Authored negative control'});
  assert.equal((await get(b.token)).status,403);
  const foreign={...ctx.C1,token:b.token,nonce:b.nonce,sessionId:b.sessionId},fb=app.kernel.bindSession(app.credentials,{role:'butler',tier:'LUNA',sessionId:'foreign-B',projectId:other.id,nonce:'foreign-b-nonce',hostReceipt:'Authored negative control'});
  await resumeSession({...foreign,token:fb.token,nonce:fb.nonce,sessionId:fb.sessionId});
  const foreignRound=await call(foreign,'round.create',{projectId:other.id,operation:'branch',intent:'Negative boundary control',butlerInstructions:'Belongs only to the foreign project'});
  await assert.rejects(()=>call(ctx.host.access.B1,'statement.report',{statementId:foreignRound.statementId,status:'ready',text:'Cross-project statement claim'}),/Cross-project/);
  const comparison=await prepare(ctx,{operation:'compare',references:A.artifacts.map(ref),intent:'Record an incomplete comparison operation'});
  await call(ctx.host.access.B1,'round.present',{roundId:comparison.id,title:'Partial selected material',references:A.artifacts.slice(0,1).map(ref)});
  await call(ctx.host.access.B1,'statement.report',{statementId:comparison.statementId,status:'incomplete',text:'Only one selected reference presented; the operation remains incomplete.'});
  assert.equal(app.kernel.read(app.credentials.human,'checkpoint').find(c=>c.roundId===comparison.id).state,'incomplete');
  await assert.rejects(()=>call(ctx.host.access.B1,'statement.report',{statementId:comparison.statementId,status:'completed',text:'Change historical outcome'}),/checkpointed/);
 }finally{await app.stop();}
});
