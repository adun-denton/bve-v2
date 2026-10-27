import * as fs from 'node:fs';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {validate} from '../contracts/3djat.mjs';
import {PNG_SERVICE,recipesForRun,recipeHash} from './png-recipes.mjs';
import {serviceTool,readServiceClosure} from './pillow.mjs';
import {RootGuard} from '../workspace.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const check=(v)=>{if(!v)throw Object.assign(Error('SERVICE_RECORD_MISMATCH'),{code:'SERVICE_RECORD_MISMATCH'});};
export function verifyServiceRecords(db){
 const list=kind=>db.prepare('SELECT doc FROM records WHERE kind=?').all(kind).map(x=>JSON.parse(x.doc)),get=(kind,id)=>list(kind).find(x=>x.id===id);
 check(isDeepStrictEqual(get('serviceExecutionFormat','active'),{id:'active',schemaVersion:'bve.deterministic-services.v1',version:1}));
 const assignments=list('assignment').filter(a=>a.executorKind==='service');check(assignments.length<=768);
 for(const a of assignments){
  const j=get('job',a.jobId),i=get('iteration',j?.iterationId),request=get('request',i?.requestId),row=get('operationSelection',request?.selectionId),st=list('statement').filter(s=>s.jobId===j?.id);
  check(j?.assignmentId===a.id&&j.specification.executorKind==='service'&&a.executor===PNG_SERVICE&&a.serviceTool.adapterId===PNG_SERVICE&&typeof a.processQuiescent==='boolean'&&st.length===1&&st[0].service?.assignmentId===a.id&&st[0].worker===null);
  serviceTool(a.serviceTool);
  check(row&&row.body.run.executionKind==='deterministic'&&isDeepStrictEqual(j.specification.recipe,recipesForRun(row.body.run)[i.jobIds.indexOf(j.id)]));
  check(!a.startedAt||j.invocationsStarted===1);
  const result=get('executionResult',a.id);
  if(result){
   const r=result.record,d=get('delivery',r.receipt.id),artifact=r.artifact?get('artifact',r.artifact.artifactId):null;
   check(validate('execution-result',r).ok&&r.executorKind==='service'&&r.executorId===a.executor&&r.assignmentId===a.id&&r.jobId===j.id&&r.runId===row.id&&r.productId===j.projectId&&r.roundId===j.roundId&&r.recipeHash===recipeHash(j.specification.recipe));
   check(d&&r.receipt.path==='Operational/delivery/'+d.id+'.json'&&r.receipt.sha256===sha(JSON.stringify(d)+'\n')&&d.assignmentId===a.id&&d.jobId===j.id&&['processed','rejected'].includes(d.state));
   check(artifact?j.state==='succeeded'&&j.artifactId===artifact.id&&artifact.sha256===r.artifact.sha256&&artifact.uncompositedParent.sha256===j.specification.recipe.scene.sha256:j.state==='failed');
   check(list('statementEvent').some(e=>e.statementId===st[0].id&&e.actor.role==='service'&&e.actor.bindingId===a.id&&e.kind===(artifact?'produced':'failed')));
  }
 }
 const closures=list('serviceClosure');check(closures.length<=assignments.length);
 for(const c of closures){
  const a=assignments.find(x=>x.id===c.assignmentId),j=get('job',a?.jobId),event=get('statementEvent',c.eventId);
  check(Object.keys(c).length===10&&a&&c.id===a.id&&c.schemaVersion==='bve.service-closure.v1'&&c.projectId===j.projectId&&c.jobId===j.id&&c.attemptId===a.attemptId&&a.startedAt&&a.processQuiescent===true);
  check(c.source&&Object.keys(c.source).length===3&&c.source.path==='ServiceExecutions/'+a.id+'/process.json'&&/^[0-9a-f]{64}$/.test(c.source.sha256)&&Number.isSafeInteger(c.source.bytes)&&c.source.bytes>0&&c.source.bytes<=1024**2);
  check(c.process&&Object.keys(c.process).length===9&&['process-record','assigned-staging'].includes(c.process.binding)&&c.process.assignmentId===a.id&&c.process.attemptId===a.attemptId&&c.process.closed===true&&Number.isSafeInteger(c.process.pid)&&c.process.pid>0&&c.process.startedAt>=a.startedAt&&c.process.finishedAt>=c.process.startedAt);
  check(event?.statementId===list('statement').find(s=>s.jobId===j.id)?.id&&event.projectId===j.projectId&&event.roundId===j.roundId&&event.kind==='quiescent'&&event.actor.role==='service'&&event.actor.bindingId===a.id&&event.report.processSha256===c.source.sha256);
  const receipt=db.prepare('SELECT * FROM receipts WHERE scope=? AND key=?').get('service:'+a.id+':quiescence','quiescence:'+a.id);
  check(receipt&&isDeepStrictEqual(JSON.parse(receipt.doc),c)&&receipt.fingerprint===sha(JSON.stringify({processSha256:c.source.sha256})));
 }
 for(const result of list('executionResult'))check(assignments.some(a=>a.id===result.id));
 return {assignments:assignments.length};
}
const names=new Set(['scene.png','logo.png','command.json','output.png','output.partial.png','receipt.json','receipt.partial.json','process.json']);
export function serviceStagingFiles(db,root){
 const guard=new RootGuard(root),assignments=db.prepare("SELECT doc FROM records WHERE kind='assignment'").all().map(x=>JSON.parse(x.doc)).filter(x=>x.executorKind==='service');
 for(const a of assignments){check(!a.startedAt||a.processQuiescent===true);if(a.startedAt)check(fs.existsSync(guard.locate('ServiceExecutions/'+a.id+'/command.json')));}
 if(!fs.existsSync(guard.locate('ServiceExecutions',{directory:true})))return [];
 for(const row of db.prepare("SELECT doc FROM records WHERE kind='serviceClosure'").all()){
  const c=JSON.parse(row.doc),a=assignments.find(a=>a.id===c.assignmentId),job=JSON.parse(db.prepare("SELECT doc FROM records WHERE kind='job' AND id=?").get(a.jobId).doc);
  const proof=readServiceClosure({root,assignmentId:a.id,attemptId:a.attemptId,startedAt:a.startedAt,tool:a.serviceTool,specification:job.specification});
  check(proof&&isDeepStrictEqual(proof.source,c.source)&&isDeepStrictEqual(proof.process,c.process));
 }
 const folders=fs.readdirSync(guard.locate('ServiceExecutions',{directory:true})),files=[];let total=0;
 for(const id of folders){const a=assignments.find(x=>x.id===id);check(a);
  const directory=guard.locate('ServiceExecutions/'+id,{directory:true});
  for(const name of fs.readdirSync(directory)){check(names.has(name));const relative='ServiceExecutions/'+id+'/'+name,raw=guard.read(relative,24*1024**2);total+=raw.length;check(total<=1024**3);files.push({path:relative,bytes:raw.length,sha256:sha(raw)});}
 }
 return files.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
}
