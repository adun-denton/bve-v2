import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {verifiedPNGData} from '../src/png.mjs';
import {Kernel} from '../src/kernel.mjs';
import {inspectPillow,dispatchPNGServices,reconcilePNGService} from '../src/executors/pillow.mjs';
import {recipesForRun} from '../src/executors/png-recipes.mjs';
import {backupCombined,verifyCombined,restoreCombined} from '../src/workspace-backup.mjs';
import {fixture,commission,output,run,hash,P} from './fixtures/3djat/deterministic-fixture.mjs';
const python=process.env.BVE_PYTHON;
assert.ok(python,'BVE_PYTHON must name the permitted pinned conventional Python executable; no simulated tool pass.');
const tool=await inspectPillow(python);
function pixels(bytes){
 const {header:h,raw}=verifiedPNGData(bytes),n=4,stride=h.width*n,out=Buffer.alloc(stride*h.height);
 const paeth=(a,b,c)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;};
 assert.equal(h.color,6);
 for(let y=0;y<h.height;y++){const filter=raw[y*(stride+1)];for(let x=0;x<stride;x++){const a=x>=n?out[y*stride+x-n]:0,b=y?out[(y-1)*stride+x]:0,c=y&&x>=n?out[(y-1)*stride+x-n]:0,v=filter===0?0:filter===1?a:filter===2?b:filter===3?Math.floor((a+b)/2):paeth(a,b,c);out[y*stride+x]=(raw[y*(stride+1)+x+1]+v)&255;}}return {data:out,width:h.width,height:h.height};
}
test('J08 actual crop then logo, frozen provenance, serial jobs, whole-batch checkpoint and exact repeated output',async t=>{
 const w=fixture(t,tool),batch=commission(w,[output('feed'),output('story')]),before=w.k.read(w.c.human,'sessionBinding').length;
 const result=await dispatchPNGServices(w.k,w.c,batch.iteration.jobIds);assert.deepEqual(result.outcomes.map(x=>x.outcome),['success','success'],JSON.stringify(result));
 const jobs=w.k.read(w.c.human,'job'),artifacts=w.k.read(w.c.human,'artifact').filter(x=>x.jobId);
 assert.equal(artifacts.length,2);assert.equal(artifacts[0].sha256,artifacts[1].sha256,'Same decoded inputs and params have repeatable bytes even across roles');
 const image=pixels(w.k.original(w.c.human,artifacts[0].id));assert.deepEqual([...image.data.subarray(0,4)],[40,30,10,255]);assert.deepEqual([...image.data.subarray((3*4+3)*4,(3*4+3)*4+4)],[255,0,0,255]);
 for(const a of artifacts){assert.equal(a.uncompositedParent.sha256,w.originals[0].artifact.sha256);assert.equal(a.logoLayer.sha256,w.originals[1].artifact.sha256);}
 for(const source of w.originals)assert.equal(hash(w.k.original(w.c.human,source.artifact.artifactId)),source.artifact.sha256);
 assert.equal(w.k.read(w.c.human,'sessionBinding').length,before);assert.equal(before,2);assert.ok(jobs.every(j=>j.invocationsStarted===1));
 assert.throws(()=>w.k.call(w.conductor.token,'staff.reserve','fake-worker',{projectId:P,role:'worker',jobId:jobs[0].id}),/Service jobs/);
 const refs=artifacts.map(a=>({productId:P,artifactId:a.id,version:a.version,sha256:a.sha256,width:a.width,height:a.height,role:'result'}));
 w.k.call(w.butler.token,'round.present','present',{roundId:batch.round.id,title:'Authored conventional outputs',references:refs});
 w.k.call(w.butler.token,'statement.report','complete',{statementId:batch.round.statementId,status:'completed',text:'Whole service batch accounted for.'});
 assert.equal(w.k.round(w.c.human,batch.round.id).checkpoint.state,'completed');
 const replay=await dispatchPNGServices(w.k,w.c,batch.iteration.jobIds);assert.ok(replay.outcomes.every(x=>x.skipped));assert.equal(w.k.read(w.c.human,'artifact').length,4);
 const context=w.k.serviceAssignment(w.c,jobs[0].id);assert.throws(()=>w.k.serviceCall(context.token,'service.start','start:'+context.assignmentId,{}),/already started/);
 const dir=process.env.J08_OUTPUT_EVIDENCE;if(dir){fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'authored-feed.png'),w.k.original(w.c.human,artifacts[0].id));fs.writeFileSync(path.join(dir,'tool-and-output.json'),JSON.stringify({tool,outputs:artifacts.map(a=>({id:a.id,sha256:a.sha256,recipeHash:a.recipeHash}))},null,2));}
});
test('J08 lost acknowledgement after actual output stays uncertain; original output reconciles after restart without invocation',async t=>{
 const w=fixture(t,tool),batch=commission(w),jobId=batch.iteration.jobIds[0];
 const first=await dispatchPNGServices(w.k,w.c,[jobId],{hook(stage){if(stage==='after-process')throw Object.assign(Error('Authored timeout/lost acknowledgement after actual child output'),{code:'ETIMEDOUT'});}});
 assert.equal(first.outcomes[0].outcome,'uncertain');assert.equal(w.k.read(w.c.human,'job')[0].state,'uncertain');
 w.k.close();w.k=new Kernel(w.runtime,{...w.options});
 assert.equal((await dispatchPNGServices(w.k,w.c,[jobId])).outcomes[0].skipped,true);
 const replay=reconcilePNGService(w.k,w.c,jobId);assert.ok(replay.deliveryId);assert.equal(w.k.read(w.c.human,'job')[0].state,'succeeded');
 assert.equal(reconcilePNGService(w.k,w.c,jobId).replayed,true);assert.equal(w.k.read(w.c.human,'job')[0].invocationsStarted,1);
 assert.equal(w.k.read(w.c.human,'artifact').filter(x=>x.jobId).length,1);
});
test('J08 actual process timeout before output is uncertain, never a no-effect rejection or automatic retry',async t=>{
 const w=fixture(t,{...tool,timeoutMs:1}),batch=commission(w),jobId=batch.iteration.jobIds[0];
 const result=await dispatchPNGServices(w.k,w.c,[jobId]);assert.equal(result.outcomes[0].outcome,'uncertain',JSON.stringify(result));
 assert.equal(result.outcomes[0].evidence.error,'TOOL_TIMEOUT');assert.equal(w.k.read(w.c.human,'job')[0].invocationsStarted,1);
 assert.equal((await dispatchPNGServices(w.k,w.c,[jobId])).outcomes[0].skipped,true);
 assert.throws(()=>reconcilePNGService(w.k,w.c,jobId));assert.equal(w.k.read(w.c.human,'artifact').filter(x=>x.jobId).length,0);
});
test('J08 blocked story preserves successful feed and cannot counterfeit whole batch completion',async t=>{
 const w=fixture(t,tool),batch=commission(w,[output('feed'),output('story',4,8)]);
 const first=await dispatchPNGServices(w.k,w.c,[batch.iteration.jobIds[0]]);assert.equal(first.outcomes[0].outcome,'success');
 const blocked=await dispatchPNGServices(w.k,w.c,[batch.iteration.jobIds[1]],{hook(stage){if(stage==='before-start')throw Object.assign(Error('Authored tool loss before invocation'),{code:'CAPABILITY_UNAVAILABLE'});}});
 assert.equal(blocked.outcomes[0].outcome,'blocked');const jobs=w.k.read(w.c.human,'job');assert.equal(jobs.find(x=>x.id===batch.iteration.jobIds[1]).invocationsStarted,0);
 const a=w.k.read(w.c.human,'artifact').find(x=>x.jobId===batch.iteration.jobIds[0]);
 w.k.call(w.butler.token,'round.present','partial',{roundId:batch.round.id,title:'Usable feed, blocked story',references:[{productId:P,artifactId:a.id,version:a.version,sha256:a.sha256,width:a.width,height:a.height,role:'result'}]});
 assert.throws(()=>w.k.call(w.butler.token,'statement.report','not-complete',{statementId:batch.round.statementId,status:'completed',text:'Cannot call blocked batch complete.'}),/not accounted/);
 w.k.call(w.butler.token,'statement.report','incomplete',{statementId:batch.round.statementId,status:'incomplete',text:'Feed is usable; story blocked before invocation.'});
 assert.equal(w.k.round(w.c.human,batch.round.id).checkpoint.state,'incomplete');assert.ok(w.k.original(w.c.human,a.id));
});
test('J08 missing/mismatched tool and malicious frozen selection/specification are refused without invocation',async t=>{
 const w=fixture(t,{...tool,pythonSha256:'0'.repeat(64)}),batch=commission(w),jobId=batch.iteration.jobIds[0];
 const blocked=await dispatchPNGServices(w.k,w.c,[jobId]);assert.equal(blocked.outcomes[0].outcome,'blocked');assert.equal(w.k.read(w.c.human,'job')[0].invocationsStarted,0);
 assert.throws(()=>recipesForRun(run(w,[output()],{selection:{...run(w).selection,path:'../../outside'}})),/UNSAFE_RECIPE/);
 const missing=run(w,[output()],{sources:[w.originals[0]]});assert.throws(()=>recipesForRun(missing),/UNSAFE_RECIPE/);
 assert.equal(w.k.read(w.c.human,'sessionBinding').filter(x=>x.role==='worker').length,0);
 assert.throws(()=>commission(w,[output()],{},{executable:'cmd.exe',args:['/c','forbidden']}),/Unsafe deterministic specification/i);
});
test('J08 fresh v5 refusal fence, backup/restore and retained conventional receipt closure',async t=>{
 const w=fixture(t,tool),batch=commission(w);await dispatchPNGServices(w.k,w.c,batch.iteration.jobIds);
 assert.equal(JSON.parse(fs.readFileSync(path.join(w.runtime,'bve-v2-root.json'))).version,5);
 assert.throws(()=>new Kernel(w.runtime,{products:w.options.products,templates:w.options.templates,imports:w.options.imports,operations:true}),/CAPABILITY_UNAVAILABLE/);
 const backup=path.join(w.dir,'backup');await backupCombined(w.runtime,backup);assert.equal(verifyCombined(backup).workspaceId,w.store.workspace.workspaceId);
 const businessRoot=path.join(w.dir,'restored-domain'),runtimeRoot=path.join(w.dir,'restored-runtime'),paths=Object.fromEntries(Object.entries(w.store.workspace.paths).map(([k,v])=>[k,path.join(businessRoot,v)]));
 restoreCombined(backup,{businessRoot,runtimeRoot,paths});const restored=new Kernel(runtimeRoot,{...w.options});
 try{assert.equal(restored.read(w.c.human,'artifact').filter(x=>x.jobId).length,1);assert.equal(restored.read(w.c.human,'job')[0].invocationsStarted,1);assert.equal((await dispatchPNGServices(restored,w.c,batch.iteration.jobIds)).outcomes[0].skipped,true);}finally{restored.close();}
});

import {runDeterministicServices,reconcileDeterministicService,sendStatement} from '../src/host-runtime.mjs';
import {serviceStagingFiles} from '../src/executors/service-records.mjs';
test('J08 six serial service jobs, failed story diagnostic and crop correction reuse original parent without AI regeneration',async t=>{
 const w=fixture(t,tool),batch=commission(w,[output('feed'),output('story',4,8),...Array.from({length:4},()=>output('treatment'))]);
 const ids=batch.iteration.jobIds;
 await assert.rejects(()=>runDeterministicServices(w.k,w.c,{projectId:'foreign',jobIds:ids}),/Foreign/);
 const r=await dispatchPNGServices(w.k,w.c,ids,{hook(stage,{jobId,context}){
  if(stage==='before-process'&&jobId===ids[1])fs.writeFileSync(path.join(context.root,'ServiceExecutions',context.assignmentId,'logo.png'),Buffer.from('authored staged corruption'));
 }});
 assert.deepEqual(r.outcomes.map(x=>x.outcome),['success','failure','success','success','success','success']);
 assert.equal(r.outcomes[1].evidence.process.exitCode,1);
 assert.match(r.outcomes[1].evidence.process.stderr,/INPUT_HASH_MISMATCH/);
 const old=w.k.read(w.c.human,'artifact').find(a=>a.jobId===ids[0]),oldBytes=w.k.original(w.c.human,old.id);
 const next=commission(w,[{...output('story',4,8),cropx:1,cropy:0,cropwidth:4,cropheight:6}]);
 const result=await runDeterministicServices(w.k,w.c,{projectId:P,jobIds:next.iteration.jobIds});
 assert.equal(result.outcomes[0].outcome,'success');
 const corrected=w.k.read(w.c.human,'artifact').find(a=>a.jobId===next.iteration.jobIds[0]);
 assert.equal(corrected.uncompositedParent.sha256,w.originals[0].artifact.sha256);
 assert.deepEqual(w.k.original(w.c.human,old.id),oldBytes);
 assert.equal(w.k.read(w.c.human,'job').length,7);
 assert.equal(w.k.read(w.c.human,'sessionBinding').filter(a=>a.role==='worker').length,0);
 const db=new DatabaseSync(path.join(w.runtime,'workspace.sqlite'),{readOnly:true});
 try{const results=db.prepare("SELECT doc FROM records WHERE kind='executionResult'").all().map(x=>JSON.parse(x.doc));assert.equal(results.length,7);assert.equal(results.filter(x=>x.record.outcome==='failed').length,1);assert.ok(results.every(x=>x.record.executorKind==='service'&&x.record.cost===null&&x.record.usage===null));}finally{db.close();}
});
test('J08 concurrent explicit dispatch and definite pre-start block never create another invocation',async t=>{
 const w=fixture(t,tool),batch=commission(w),ids=batch.iteration.jobIds;
 const blocked=await dispatchPNGServices(w.k,w.c,ids,{hook(stage){if(stage==='before-start')throw Object.assign(Error('Authored explicit block'),{code:'PRE_START_BLOCK'});}});
 assert.equal(blocked.outcomes[0].outcome,'blocked');
 const calls=await Promise.all([dispatchPNGServices(w.k,w.c,ids),dispatchPNGServices(w.k,w.c,ids)]);
 assert.equal(calls.flatMap(x=>x.outcomes).filter(x=>x.outcome==='success').length,1);
 assert.equal(w.k.read(w.c.human,'job')[0].invocationsStarted,1);
 assert.equal(w.k.read(w.c.human,'artifact').filter(a=>a.jobId).length,1);
});
test('J08 missing executable and changed source original block before start; service credentials cannot escape their scope',async t=>{
 const w=fixture(t,{...tool,pythonExecutable:path.join(process.env.J08_EVIDENCE_ROOT,'absent-python.exe')}),batch=commission(w),id=batch.iteration.jobIds[0];
 const result=await dispatchPNGServices(w.k,w.c,[id]);assert.equal(result.outcomes[0].outcome,'blocked');
 const context=w.k.serviceAssignment(w.c,id);
 assert.throws(()=>w.k.serviceCall(w.conductor.token,'service.start','foreign',{}));
 assert.throws(()=>w.k.call(context.token,'design.accept','escape',{artifactId:w.originals[0].artifact.artifactId,judgment:'accept'}));
 assert.throws(()=>w.k.call(w.conductor.token,'result.deliver','escape',{assignmentId:context.assignmentId,outcome:'success',bytes:'',evidence:{kind:'host'}}));
 assert.equal(w.k.read(w.c.human,'job')[0].invocationsStarted,0);
 const x=fixture(t,tool),other=commission(x),source=x.originals[1].artifact;
 const db=new DatabaseSync(path.join(x.runtime,'workspace.sqlite'));db.prepare('UPDATE bytes SET data=? WHERE hash=?').run(Buffer.from('authored lost original'),source.sha256);db.close();
 const blocked=await dispatchPNGServices(x.k,x.c,other.iteration.jobIds);assert.equal(blocked.outcomes[0].outcome,'blocked');
 assert.equal(x.k.read(x.c.human,'job')[0].invocationsStarted,0);
});
test('J08 migration requires matching quiescent backup; service records and unresolved process staging cannot be hidden by backup',async t=>{
 const w=fixture(t,tool,{services:false});w.k.close();
 assert.throws(()=>new Kernel(w.runtime,{...w.options,services:tool}),/MIGRATION_REQUIRES_BACKUP/);
 const saved=path.join(w.dir,'before-services');await backupCombined(w.runtime,saved);
 w.k=new Kernel(w.runtime,{...w.options,services:tool,serviceBackup:saved,confirmedQuiescent:true});w.options={...w.options,services:tool};
 const batch=commission(w),id=batch.iteration.jobIds[0],context=w.k.serviceAssignment(w.c,id);
 w.k.serviceCall(context.token,'service.start','explicit-start',{});
 fs.mkdirSync(path.join(w.runtime,'ServiceExecutions',context.assignmentId),{recursive:true});
 await assert.rejects(()=>backupCombined(w.runtime,path.join(w.dir,'unresolved-backup')),/SERVICE_RECORD_MISMATCH/);
 w.k.close();const db=new DatabaseSync(path.join(w.runtime,'workspace.sqlite'));
 const a=JSON.parse(db.prepare("SELECT doc FROM records WHERE kind='assignment' AND id=?").get(context.assignmentId).doc);a.serviceTool.adapterId='arbitrary-shell';db.prepare("UPDATE records SET doc=? WHERE kind='assignment' AND id=?").run(JSON.stringify(a),a.id);db.close();
 assert.throws(()=>new Kernel(w.runtime,{...w.options}),/SERVICE_RECORD_MISMATCH|INVALID_TOOL/);
});

test('J08 successful tool output that violates stricter frozen byte limit is failed by independent intake',async t=>{
 const w=fixture(t,tool),batch=commission(w,[output()],{},{hardLimits:{maxBytes:1,maxPixels:16000000}});
 const r=await dispatchPNGServices(w.k,w.c,batch.iteration.jobIds);assert.equal(r.outcomes[0].outcome,'failure');
 const jobs=w.k.read(w.c.human,'job');assert.equal(jobs[0].state,'failed');assert.match(jobs[0].reason,/Independent intake rejected/);
 assert.equal(w.k.read(w.c.human,'artifact').filter(x=>x.jobId).length,0);
 assert.ok(w.k.read(w.c.human,'statementEvent').some(x=>x.actor.role==='service'&&x.kind==='failed'));
 const db=new DatabaseSync(path.join(w.runtime,'workspace.sqlite'),{readOnly:true});try{assert.equal(JSON.parse(db.prepare("SELECT doc FROM records WHERE kind='executionResult'").get().doc).record.failureCode,'INTAKE_REJECTED');}finally{db.close();}
});
