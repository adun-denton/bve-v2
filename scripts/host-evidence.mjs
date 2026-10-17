// Publish only disposable fixture/probe metadata. Never export operator records.
import {DatabaseSync} from 'node:sqlite';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
const sourceCommit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const [logPath,probeRoot]=process.argv.slice(2);if(!logPath)throw Error('Usage: node scripts/host-evidence.mjs VERIFICATION_LOG [DISPOSABLE_PROBE_ROOT]');
const log=readFileSync(logPath,'utf8');const count=name=>Number(log.match(new RegExp('^ℹ '+name+' (\\d+)','m'))?.[1]);
if(!count('tests')||count('tests')!==count('pass')||count('fail')!==0)throw Error('Successful full contract log required');
let probe={status:'not-run',sessions:[],routes:[]};
if(probeRoot){
 const db=new DatabaseSync(join(probeRoot,'workspace.sqlite'),{readOnly:true});
 try{
  const list=kind=>db.prepare('SELECT doc FROM records WHERE kind=? ORDER BY rowid').all(kind).map(r=>JSON.parse(r.doc));
  const projects=list('project');if(!projects.length||projects.some(p=>p.fixture!==true))throw Error('Refusing to publish metadata from a non-fixture workspace');
  const state=list('hostInstallation')[0];
  if(state?.kind!=='probe')throw Error('Explicit disposable probe installation required');
  probe={status:state.status,host:state.host,kind:state.kind,capabilities:state.capabilities,gaps:state.gaps,
   sessions:list('sessionBinding').filter(b=>!b.revokedAt).map(b=>({role:b.role,sessionId:b.sessionId,sessionUrl:b.sessionUrl,readReceipt:b.hello?.id??null,readAt:b.hello?.readAt??null})),
   routes:list('delegation').map(d=>({id:d.id,kind:d.kind,fromSessionId:d.fromSessionId,toRole:d.toRole,sessionId:d.sessionId,state:d.state,receipts:d.receipts.map(r=>({id:r.id,sessionId:r.sessionId,status:r.status,at:r.at}))})),
   observedLimits:['Cross-tool-execution loopback HTTP failed with ECONNREFUSED; scoped local Kernel transport used instead','Canonical child task identifiers are transient in this coding thread; no durable user-facing Conductor link','No access to preserved Windows root, local bridge, user originals or native delivery evidence','Child image-tool metadata visible; no image calls made by setup or this probe','Active-task message/followup delivery is not unattended event wake or live feedback push']};
 }finally{db.close();}
}
const report={format:'bve-host-installation-evidence-v1',sourceCommit,generatedAt:new Date().toISOString(),
 contractResults:{total:count('tests'),passed:count('pass'),failed:count('fail')},
 deterministicCoverage:['idempotent installation/resume and lost creation response','fresh scoped role reads and delegation receipts; false proofs rejected','concurrent installer exclusion','wrong-role, project, assignment and delegation boundaries','original-byte independent intake, interrupted delivery, uncertainty without retry','Conductor replacement and immutable feedback recovery; event read/ack/consume distinct','scoped Kernel transport preserves running attempts and single owner','fixture/native claims and first work-session completion checked separately'],
 actualCloudProbe:probe,
 operationalInstallation:{status:'incomplete',preservedWindowsRootModified:false,readyConductorSessionUrl:null,reason:'Actual Windows host connection, applicable native executor/byte-return verification and durable user chat handoff unavailable here'},
 limits:['Authored deterministic checks are not live image production proof','Prior operator-reported local native intake not inspected or reproduced here','Windows/macOS OS installation/recovery, native concurrency, unattended push, human usefulness and acceptance remain unverified']};
writeFileSync('evidence/host-installation-report.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({sourceCommit,contracts:report.contractResults.passed,probeStatus:probe.status,operational:'incomplete'}));
