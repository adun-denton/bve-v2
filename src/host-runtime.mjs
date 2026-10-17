import { randomUUID,createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { sessionCall,resumeSession } from '../scripts/session.mjs';
const call=(access,op,input,key=randomUUID())=>sessionCall(access,{op,key,input});
const instructions=role=>readFileSync(new URL(`../docs/roles/${role.toUpperCase()}.md`,import.meta.url),'utf8');
// Called by the project's existing Conductor, never by the installer on its behalf.
export async function ensureStaff(access,host,{role,jobId=null}){
  if(!['butler','worker'].includes(role))throw Error('Only Butler or bounded Gen staff can be requested');
  const resumed=await resumeSession(access),projectId=resumed.receipt.projectId;
  if(!projectId)throw Error('Activate the named project on production intent first');
  const prior=resumed.context.sessionBinding.find(b=>!b.revokedAt&&b.role===role&&(role!=='worker'||b.jobId===jobId));
  const reservation=await call(access,'staff.reserve',{projectId,role,jobId},`reserve:${projectId}:${role}:${jobId??'primary'}`);
  const stableKey=reservation.key;
  const session=await host.ensureSession({role,tier:'LUNA',key:stableKey,previous:prior?{id:prior.sessionId,url:prior.sessionUrl}:null,instructions:instructions(role)});
  if(!session?.id||!session.receipt)throw Error('Host did not return an actual staff session/receipt');
  const binding=await call(access,'staff.bind',{projectId,role,jobId,sessionId:session.id,sessionUrl:session.url??null,tier:'LUNA',nonce:createHash('sha256').update(stableKey).digest('hex'),hostReceipt:prior?.hostReceipt??session.receipt},`staff:${stableKey}`);
  await host.configureSession({binding,instructions:instructions(role),access:{...access,role,sessionId:binding.sessionId,projectId,token:binding.token,nonce:binding.nonce}});
  return binding;
}
export async function sendStatement(access,host,statementId){
  const resumed=await resumeSession(access),st=resumed.context.statement.find(s=>s.id===statementId);
  if(!st)throw Error('Statement not in project scope');
  return host.sendStatement({sessionId:st.worker?.sessionId??st.butler.sessionId,statementId,projectId:st.projectId,roundId:st.roundId});
}
export async function runWorker(access,adapter,statementId){
  const resumed=await resumeSession(access),st=resumed.context.statement.find(s=>s.id===statementId),a=resumed.assignmentAccess;
  if(!st||st.worker?.sessionId!==access.sessionId||!a||a.jobId!==st.jobId)throw Error('No exact worker statement/assignment');
  if(!['assigned'].includes(resumed.context.job.find(j=>j.id===st.jobId)?.state))return {skipped:true,reason:'Existing attempt must not be reinvoked'};
  if(!adapter||!['demonstrated','simulated'].includes(adapter.capability?.status))throw Error('No tested compatible executor');
  await call(access,'worker.start',{roundId:st.roundId},`start:${a.id}`);
  let result;try{result=await adapter.execute({...a,statement:st});}
  catch(e){result={outcome:'uncertain',evidence:{kind:adapter.capability.status==='simulated'?'simulated':'host',error:String(e.message),model:null,cost:null,usage:null}};}
  await call({...access,token:a.token},'result.deliver',{assignmentId:a.id,...result},`delivery:${a.id}`);
  await call(access,'statement.report',{statementId:st.id,status:result.outcome==='success'?'produced':result.outcome==='failure'?'failed':'uncertain',text:'Assigned executor returned '+result.outcome+'; independent intake determines artifact validity'},`report:${a.id}`);
  return {assignmentId:a.id,outcome:result.outcome};
}
export async function returnRound(access,host,roundId){
  const resumed=await resumeSession(access),round=resumed.context.round.find(r=>r.id===roundId),checkpoint=resumed.context.checkpoint.find(c=>c.roundId===roundId);
  if(!round||!checkpoint||round.butler.sessionId!==access.sessionId)throw Error('No completed Butler cycle to return');
  const event=resumed.context.event.find(e=>e.roundId===roundId);
  try{
    const receipt=await host.notifyConductor({sessionId:resumed.context.sessionBinding.find(b=>b.role==='conductor'&&!b.revokedAt)?.sessionId,eventId:event.id,roundId,checkpointId:checkpoint.id});
    return call(access,'event.delivery',{eventId:event.id,mechanism:receipt.mechanism,status:receipt.sent?'sent':'failed',evidence:receipt.evidence??null});
  }catch(e){return call(access,'event.delivery',{eventId:event.id,mechanism:'host-return',status:'failed',evidence:String(e.message)});}
}
