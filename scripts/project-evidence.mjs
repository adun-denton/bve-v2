// Authored Examples A–C through actual scoped BVE operations; no native calls.
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {workspace} from '../test/helpers.mjs';
import {runCanonicalExamples} from '../test/project-fixture.mjs';
const sourceCommit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),w=workspace();
try{
 const {ctx,A,R2,R3,B,C,resumed}=await runCanonicalExamples(w);
 const read=kind=>w.k.read(w.c.human,kind);
 assert.equal(ctx.project.name,'Iman Website');assert.equal(A.workers.length,3);assert.equal(A.round.expectedResults,3);
 assert.equal(B.code,'R004');assert.equal(C.code,'R005');assert.equal(C.parentRoundId,R2.round.id);assert.equal(resumed.context.checkpoint.length,5);
 assert.equal(read('artifact').length,5);assert.equal(w.k.read(w.c.generator,'assignment').length,5);
 const report={format:'bve-project-examples-v1',sourceCommit,generatedAt:new Date().toISOString(),kind:'authored-fixture-sessions-and-images-not-native-integration',
  exampleA:{project:ctx.project.name,projectCode:ctx.project.code,round:A.round.code,conductor:'C1',butler:'B1',workers:A.workers.map(b=>b.sessionId),expectedResults:A.round.expectedResults,verifiedArtifacts:A.artifacts.map(a=>a.id),initialStaffCount:5,supervisors:0},
  exampleB:{round:B.code,operation:B.operation,expectedResults:B.expectedResults,selectedArtifactIds:w.k.read(w.c.human,'checkpoint').find(c=>c.roundId===B.id).artifacts.map(a=>a.artifactId),newWorkers:0,newGenerationInvocations:0},
  exampleC:{round:C.code,parentRound:R2.round.code,preservedLaterRounds:[R3.round.code,B.code],replacementConductor:resumed.receipt.sessionId,butlerRecreated:false,recoveredInstructions:resumed.context.projectInstruction,retainedWorkerIdentities:resumed.context.sessionBinding.filter(b=>b.role==='worker').map(b=>b.sessionId)},
  roundIds:{R001:A.round.id,R002:R2.round.id,R003:R3.round.id,R004:B.id,R005:C.id},
  statements:read('statement'),statementEvents:read('statementEvent'),checkpoints:read('checkpoint'),presentations:read('presentation'),roster:read('sessionBinding'),
  statementReceipts:ctx.host.received,completion:{mechanism:'authored fixture callback resumes exact Conductor and acknowledges durable round event',receipts:ctx.host.notifications,actualHostAutomaticReturn:'unverified'},
  limits:['Session identities/model tiers are authored fixtures, not actual SOL/LUNA host provisioning','Images are authored PNGs, not native production','Native original return, browser opening by Butler and automatic originating-chat notification require separate supported-host verification','No operator private runtime accessed; no image-model calls or design acceptance']};
 const encoded=JSON.stringify(report,null,2);for(const secret of Object.values(w.c))assert.ok(!encoded.includes(secret));for(const b of w.k.hostBindings(w.c))assert.ok(!encoded.includes(b.token));
 writeFileSync('evidence/project-report.json',encoded+'\n');console.log(JSON.stringify({sourceCommit,examples:['A','B','C'],checkpoints:report.checkpoints.length,images:read('artifact').length,nativeCalls:0}));
}finally{w.k.close();}
