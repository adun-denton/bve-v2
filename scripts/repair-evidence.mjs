import { execFileSync } from 'node:child_process';
// Authored fixture evidence only. No operator roots, native image calls or live notifications.
import { mkdirSync,writeFileSync } from 'node:fs';
import { join,resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { workspace,first,finish,submit } from '../test/helpers.mjs';
import { fixtureSpecifications,fixtureAdapter,dispatch } from '../src/adapters.mjs';
import { Kernel } from '../src/kernel.mjs';
const w=workspace(),call=(role,operation,input,key=randomUUID())=>w.k.call(w.c[role],operation,key,input);
const reference=(image,role,regions=[])=>({artifactId:image.id,version:image.version,sha256:image.sha256,width:image.width,height:image.height,role,regions});
const envelopes=[];
const recording={...fixtureAdapter(2),async execute(a){const {token,...safe}=a;envelopes.push(safe);return fixtureAdapter(2).execute(a);}};
try{
  const {p,i}=first(w,6),images=finish(w,i),{s}=submit(w,i,images);
  const originalHuman=JSON.stringify(s),zeroNotes=w.k.read(w.c.conductor,'continuation')[0].optional.conductorNotes;
  const noteInput={projectId:p.id,iterationId:i.id,reviewId:s.id,kind:'rationale',text:'Authored optional rationale: choose a quiet composition and keep the human region comment separate from this interpretation.',sources:[reference(images[0],'Rationale evidence')],constraints:['Advisory, subordinate to the human request'],provenance:{author:null,executor:'authored-Conductor-fixture',tool:null}};
  const note=call('conductor','creativeContext.supply',noteInput,'evidence-note-1');
  const revision=call('conductor','creativeContext.supply',{...noteInput,text:'Authored revision: only explicitly selected inputs are required; Fresh may start from words alone.',supersedes:note.id},'evidence-note-2');
  const selected=s.feedback.images[0].regions[0],region={space:selected.space,x:selected.x,y:selected.y,w:selected.w,h:selected.h,meaning:'Give the marked area breathing room',reviewRegion:{reviewId:s.id,index:0}};
  // Historical loss is disclosed, but must not block independent production.
  const db=new DatabaseSync(join(w.root,'workspace.sqlite'));db.prepare('UPDATE bytes SET data=? WHERE hash=?').run(Buffer.from('deliberately damaged historical fixture'),images[5].sha256);db.close();w.k.reconcile(w.c.butler);
  const commissioned=[];
  async function commission(direction,brand,sets,label){
    const request=call('human','request.create',{projectId:p.id,parentReviewId:s.id,intent:label,count:sets.length,direction,brand});
    const child=call('conductor','iteration.commission',{requestId:request.id,interpretation:'Authored independent interpretation for '+label,specifications:fixtureSpecifications({brief:p.brief,count:sets.length,sourceSets:sets,iteration:2})});
    commissioned.push(child);await dispatch(w.k,w.c,recording,child.jobIds);return child;
  }
  const follow=await commission('Follow','Muted green',[[reference(images[0],'Chosen composition',[region])],[reference(images[1],'Palette only'),reference(images[2],'Content only')]],'Follow chosen one/two references');
  const fresh=await commission('Fresh',null,[[],[reference(images[1],'Subject matter only, no historical style obligation')]],'Fresh independent and explicit-content variants');
  const mixed=await commission('Follow',null,[[reference(images[5],'Required unavailable subject')],[]],'Mixed dependency work; preserve independent job');
  const jobs=w.k.read(w.c.human,'job'),blocked=jobs.find(j=>j.id===mixed.jobIds[0]);
  assert.equal(blocked.state,'blocked');assert.equal(blocked.dependencyIssues[0].artifactId,images[5].id);assert.equal(jobs.find(j=>j.id===mixed.jobIds[1]).state,'succeeded');
  const continuation=w.k.read(w.c.conductor,'continuation').find(c=>c.id===s.id);
  assert.equal(continuation.historicalCoverage.status,'limited');assert.equal(continuation.status,'ready');
  assert.equal(JSON.stringify(w.k.read(w.c.human,'submission').find(r=>r.id===s.id)),originalHuman);
  const portableIndependent=w.k.portable(w.c.conductor,s.id,{jobId:fresh.jobIds[0]}),portableDependent=w.k.portable(w.c.conductor,s.id,{jobId:mixed.jobIds[0]}),portableSelected=w.k.portable(w.c.conductor,s.id,{jobId:follow.jobIds[0]});
  assert.equal(portableIndependent.coverage.status,'complete');assert.equal(portableIndependent.originals.length,0);
  assert.equal(portableDependent.coverage.status,'blocked');assert.equal(portableSelected.originals.length,1);
  w.k.close();w.k=new Kernel(w.root);
  const recovered=w.k.read(w.c.conductor,'continuation').find(c=>c.id===s.id);
  assert.equal(recovered.creativeContext[0].id,revision.id);
  const report={format:'bve-v2-repairs-evidence-v1',sourceCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),generatedAt:new Date().toISOString(),kind:'authored-fixtures-and-simulated-executors',baseline:'115a07a34bd35d84ac00e45253671db4bb254888',
    dispositions:{R01:'fixed; historical coverage separated from actual job dependencies',R02:'fixed; canonical direction/Brand frozen into actual worker packets',R03:'fixed; bounded immutable context with recovered revisions',R04:'see shipped browser report and source hash manifest',A01:'clarified; reservation versus durable invocation marker; provider usage unknown',D01:'deferred product controls',D02:'deferred synchronized detail comparison',I01:'native workers/concurrency unverified',I02:'live push unavailable',I03:'restricted PNG preserved',I04:'independent Windows code/browser evidence acknowledged; full platform installation/recovery unverified',I05:'human usefulness and acceptance unverified'},
    humanEvidence:{submission:s,recoveredSubmission:w.k.read(w.c.human,'submission').find(r=>r.id===s.id),unchanged:true,lateDeliveryProtection:'Covered by regression suite'},
    creativeContext:{zeroNotes,original:note,revision,recovered:recovered.creativeContext,optional:recovered.optional},
    continuation:recovered,childIterations:commissioned,workerEnvelopes:envelopes,
    dependencyOutcomes:jobs.filter(j=>commissioned.some(i=>i.id===j.iterationId)).map(j=>({jobId:j.id,state:j.state,sources:j.specification.sources,dependencyIssues:j.dependencyIssues,allowanceReserved:j.allowanceReserved,invocationsStarted:j.invocationsStarted})),
    portableCoverage:{independent:portableIndependent.coverage,dependent:portableDependent.coverage,selected:portableSelected.coverage,selectedOriginalIdentities:portableSelected.originals.map(({bytes,...identity})=>identity)},
    limits:{nativeWorker:'unverified',concurrency:'unverified; serial fixtures',notification:'durable polling only',humanAcceptance:'unverified; none recorded'}};
  const serialized=JSON.stringify(report,null,2);
  Object.values(w.c).forEach(secret=>assert.ok(!serialized.includes(secret)));assert.ok(envelopes.every(a=>a.token===undefined&&a.tokenHash===undefined));
  const out=resolve('evidence');mkdirSync(out,{recursive:true});writeFileSync(join(out,'repair-report.json'),serialized+'\n');
  console.log(JSON.stringify({workerEnvelopes:envelopes.length,reviewedImages:s.sourceArtifacts.length,humanEvidenceUnchanged:true,contextRecovered:revision.id,report:'evidence/repair-report.json'}));
}finally{w.k.close();}
