// J08-F01: real Kernel/SQLite/Pillow output with deliberately delayed real closure receipt.
// No prior candidate root or invocation is reused. Recovery never spawns the editor.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {Kernel} from '../src/kernel.mjs';
import {inspectPillow,dispatchPNGServices,reconcilePNGService} from '../src/executors/pillow.mjs';
import {stable,recipeHash} from '../src/executors/png-recipes.mjs';
import {backupCombined,verifyCombined,restoreCombined} from '../src/workspace-backup.mjs';
import {fixture,commission,output,hash} from './fixtures/3djat/deterministic-fixture.mjs';
const tool=await inspectPillow(process.env.BVE_PYTHON);
const worker=fileURLToPath(new URL('../src/executors/pillow-worker.py',import.meta.url));
function snapshot(w){
 const db=new DatabaseSync(path.join(w.runtime,'workspace.sqlite'),{readOnly:true});
 try{return {receipts:db.prepare('SELECT * FROM receipts ORDER BY scope,key').all(),artifacts:db.prepare("SELECT doc FROM records WHERE kind='artifact' ORDER BY id").all(),results:db.prepare("SELECT doc FROM records WHERE kind='executionResult' ORDER BY id").all(),closure:db.prepare("SELECT doc FROM records WHERE kind='serviceClosure' ORDER BY id").all()};}finally{db.close();}
}
async function initialInvocation(w,jobId){
 const c=w.k.serviceAssignment(w.c,jobId),stage=path.join(w.runtime,'ServiceExecutions',c.assignmentId);fs.mkdirSync(stage,{recursive:true});
 const r=c.specification.recipe,inputs=w.k.serviceInputs(c.token);
 for(const [name,ref] of [['scene.png',r.scene],['logo.png',r.logo]])if(ref)fs.writeFileSync(path.join(stage,name),inputs.find(x=>x.reference.artifactId===ref.artifactId).bytes,{flag:'wx'});
 fs.writeFileSync(path.join(stage,'command.json'),stable({assignmentId:c.assignmentId,attemptId:c.attemptId,recipeHash:recipeHash(r),recipe:r})+'\n',{flag:'wx'});
 w.k.serviceCall(c.token,'service.start','start:'+c.assignmentId,{});
 // Exactly one actual fixed-worker invocation for this assignment. Hold its genuine
 // OS close event outside staging to represent parent closure evidence not yet recovered.
 const startedAt=new Date().toISOString();
 const processReceipt=await new Promise((resolve,reject)=>{
  const child=spawn(tool.pythonExecutable,['-I','-B',worker],{cwd:stage,shell:false,windowsHide:true,env:{SystemRoot:process.env.SystemRoot,WINDIR:process.env.WINDIR,PATH:path.dirname(tool.pythonExecutable),LANG:'C.UTF-8'}});
  let stdout='',stderr='';const timer=setTimeout(()=>{child.kill();reject(Error('Authored fixture process timeout'));},30000);
  child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);child.on('error',reject);
  child.on('close',(exitCode,signal)=>{clearTimeout(timer);resolve({pid:child.pid,startedAt,finishedAt:new Date().toISOString(),exitCode,signal,timedOut:false,overflow:false,spawnError:null,closed:true,stdout,stderr});});
 });
 assert.equal(processReceipt.exitCode,0,processReceipt.stderr);assert.ok(fs.existsSync(path.join(stage,'receipt.json')));
 const held=Buffer.from(JSON.stringify(processReceipt)+'\n');fs.writeFileSync(path.join(w.dir,'HELD-ACTUAL-CLOSURE.json'),held);
 return {c,stage,held};
}
test('J08-F01 later real closure reconciles without changing old reports/results or reinvoking the editor',async t=>{
 const w=fixture(t,tool),batch=commission(w,[output('feed'),output('story')]),[jobId,siblingId]=batch.iteration.jobIds;
 const {c,stage,held}=await initialInvocation(w,jobId);
 assert.equal(fs.existsSync(path.join(stage,'process.json')),false);
 w.k.close();w.k=new Kernel(w.runtime,{...w.options});
 const early=reconcilePNGService(w.k,w.c,jobId);assert.ok(early.deliveryId);
 assert.equal(w.k.assignment(c.token).processQuiescent,false);
 const old=snapshot(w),outputReceipt=fs.readFileSync(path.join(stage,'receipt.json')),outputBytes=fs.readFileSync(path.join(stage,'output.png'));
 const oldReport=old.receipts.find(x=>x.key==='report:'+c.assignmentId);assert.equal(JSON.parse(oldReport.doc).report.quiescent,false);
 assert.equal(old.results.length,1);
 assert.equal((await dispatchPNGServices(w.k,w.c,[jobId])).outcomes[0].skipped,true);
 const blocked=await dispatchPNGServices(w.k,w.c,[siblingId]);assert.equal(blocked.outcomes[0].outcome,'blocked');
 assert.match(blocked.outcomes[0].evidence.error,/quiescent/);
 await assert.rejects(()=>backupCombined(w.runtime,path.join(w.dir,'backup-unknown')),/SERVICE_RECORD_MISMATCH/);
 assert.equal(w.k.read(w.c.human,'job').find(x=>x.id===siblingId).invocationsStarted,0);
 assert.throws(()=>w.k.serviceCall(c.token,'service.quiescence','quiescence:'+c.assignmentId,{processSha256:hash(held)}),/closure evidence mismatch/);
 assert.throws(()=>w.k.serviceCall(w.conductor.token,'service.quiescence','quiescence:'+c.assignmentId,{processSha256:hash(held)}),/assignment credential/);
 // Proposed foreign/incomplete closure records are not genuine closure authority.
 for(const [label,proposal,code] of [
  ['foreign-assignment',{...JSON.parse(held),assignmentId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',attemptId:c.attemptId},/PROCESS_ATTEMPT_MISMATCH/],
  ['foreign-attempt',{...JSON.parse(held),assignmentId:c.assignmentId,attemptId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc'},/PROCESS_ATTEMPT_MISMATCH/]
 ]){
  fs.writeFileSync(path.join(stage,'process.json'),JSON.stringify(proposal)+'\n',{flag:'wx'});
  assert.throws(()=>reconcilePNGService(w.k,w.c,jobId),code);
  assert.equal(w.k.assignment(c.token).processQuiescent,false);
  fs.renameSync(path.join(stage,'process.json'),path.join(w.dir,'REJECTED-'+label+'.json'));
 }
 fs.writeFileSync(path.join(stage,'process.json'),JSON.stringify({...JSON.parse(held),closed:false})+'\n',{flag:'wx'});
 assert.equal(reconcilePNGService(w.k,w.c,jobId).replayed,true);
 assert.equal(w.k.assignment(c.token).processQuiescent,false);
 fs.renameSync(path.join(stage,'process.json'),path.join(w.dir,'INCOMPLETE-CLOSURE-PROPOSAL.json'));
 // Supply the exact actual close-event bytes for the SAME single original process.
 fs.writeFileSync(path.join(stage,'process.json'),held,{flag:'wx'});
 assert.doesNotThrow(()=>reconcilePNGService(w.k,w.c,jobId));
 assert.equal(w.k.assignment(c.token).processQuiescent,true);
 assert.throws(()=>w.k.serviceCall(c.token,'service.quiescence','quiescence:'+c.assignmentId,{processSha256:'0'.repeat(64)}),/closure evidence mismatch/);
 const originalInput=JSON.parse(oldReport.doc);
 assert.throws(()=>w.k.serviceCall(c.token,'service.report','report:'+c.assignmentId,{status:originalInput.kind,text:originalInput.report.text,quiescent:true}),/Idempotency key payload conflict/);
 let after=snapshot(w);
 for(const receipt of old.receipts)assert.deepEqual(after.receipts.find(x=>x.scope===receipt.scope&&x.key===receipt.key),receipt,'Earlier receipt changed');
 assert.deepEqual(after.artifacts,old.artifacts);assert.deepEqual(after.results,old.results);
 assert.deepEqual(fs.readFileSync(path.join(stage,'receipt.json')),outputReceipt);assert.deepEqual(fs.readFileSync(path.join(stage,'output.png')),outputBytes);
 assert.deepEqual(fs.readFileSync(path.join(stage,'process.json')),held);
 const stableState=snapshot(w);
 assert.equal(reconcilePNGService(w.k,w.c,jobId).replayed,true);
 w.k.close();w.k=new Kernel(w.runtime,{...w.options});assert.equal(reconcilePNGService(w.k,w.c,jobId).replayed,true);
 assert.deepEqual(snapshot(w),stableState);
 const goodBackup=path.join(w.dir,'backup-closed');await backupCombined(w.runtime,goodBackup);assert.equal(verifyCombined(goodBackup).complete,true);
 const businessRoot=path.join(w.dir,'restored-domain'),runtimeRoot=path.join(w.dir,'restored-runtime'),paths=Object.fromEntries(Object.entries(w.store.workspace.paths).map(([k,v])=>[k,path.join(businessRoot,v)]));
 restoreCombined(goodBackup,{businessRoot,runtimeRoot,paths});const restored=new Kernel(runtimeRoot,{...w.options});
 try{assert.equal(restored.assignment(c.token).processQuiescent,true);assert.equal(reconcilePNGService(restored,w.c,jobId).replayed,true);assert.equal(restored.read(w.c.human,'job').find(j=>j.id===jobId).invocationsStarted,1);}finally{restored.close();}
 const sibling=await dispatchPNGServices(w.k,w.c,[siblingId]);assert.equal(sibling.outcomes[0].outcome,'success');
 assert.equal(w.k.read(w.c.human,'job').find(x=>x.id===jobId).invocationsStarted,1);
 assert.equal(w.k.read(w.c.human,'job').find(x=>x.id===siblingId).invocationsStarted,1);
 after=snapshot(w);for(const oldResult of old.results)assert.ok(after.results.some(x=>x.doc===oldResult.doc));
 fs.writeFileSync(path.join(w.dir,'F01-EVIDENCE.json'),JSON.stringify({authoredOnly:true,originalInvocationCount:1,newAuthorizedSiblingCount:1,actualProcess:JSON.parse(held),priorReportUnchanged:hash(Buffer.from(oldReport.doc)),immutableResultHashes:old.results.map(x=>hash(Buffer.from(x.doc))),outputSha256:hash(outputBytes),closureMissingBlockedDispatchAndBackup:true,laterClosureUnblockedBoth:true,repeatAndRestartIdempotent:true},null,2)+'\n');
});
