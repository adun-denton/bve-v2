// Reusable role-side helpers over existing narrow HTTP contracts. Host session
// creation/messaging remains the host driver's responsibility, not Conductor's.
import { randomUUID } from 'node:crypto';
import { sessionCall,resumeSession } from '../scripts/session.mjs';
const call=(access,op,input,key=randomUUID())=>sessionCall(access,{op,key,input});
export async function runButler(access,delegationId){
  const resumed=await resumeSession(access),d=resumed.delegations.find(d=>d.id===delegationId);
  if(!d||!['reconcile','readiness'].includes(d.kind)||d.toRole!=='butler')throw Error('No matching Butler delegation');
  if(d.state==='completed')return d;
  await call(access,'host.receipt',{delegationId,status:'acknowledged',detail:'Butler session received durable delegation'},`ack:${delegationId}`);
  return call(access,'host.receipt',{delegationId,status:'completed',detail:'Independent deterministic service reconciled; no AI validation or image invocation'},`complete:${delegationId}`);
}
export async function runGenerator(access,adapter,delegationId){
  let resumed=await resumeSession(access),d=resumed.delegations.find(d=>d.id===delegationId);
  if(!d||d.toRole!=='generator'||!['dispatch','readiness'].includes(d.kind))throw Error('No matching Generator delegation');
  if(d.state==='completed')return d;
  await call(access,'host.receipt',{delegationId,status:'acknowledged',detail:'Generator session received durable delegation'},`ack:${delegationId}`);
  if(d.kind==='readiness')return call(access,'host.receipt',{delegationId,status:'completed',detail:'Generator route usable; no image call authorized'},`complete:${delegationId}`);
  if(!adapter||!['demonstrated','simulated'].includes(adapter.capability?.status))throw Error('No tested compatible executor; no invocation made');
  for(const job of resumed.context.job.filter(j=>j.iterationId===d.iterationId)){
    if(!['queued','assigned'].includes(job.state))continue;
    if(job.state==='assigned'&&resumed.context.assignment.find(a=>a.id===job.assignmentId)?.executor!==adapter.id)continue;
    const a=await call(access,'job.allocate',{jobId:job.id,executor:adapter.id,capability:adapter.capability},`allocate:${job.id}`);
    // A lost response or rejected replay stops here. It cannot reach execute.
    await call(access,'attempt.start',{assignmentId:a.id},`start:${a.id}`);
    let delivery;
    try{delivery=await adapter.execute({...a,token:a.token});}
    catch(e){delivery={outcome:'uncertain',evidence:{kind:adapter.capability.status==='simulated'?'simulated':'host',error:String(e.message),model:null,cost:null,usage:null}};}
    // Delivery response loss does not re-enter execute. Reconcile the original
    // attempt/result with its executor and replay the same delivery if needed.
    await call({...access,token:a.token},'result.deliver',{assignmentId:a.id,...delivery},`delivery:${a.id}`);
  }
  resumed=await resumeSession(access);
  const complete=resumed.context.job.filter(j=>j.iterationId===d.iterationId).every(j=>['succeeded','failed'].includes(j.state));
  return call(access,'host.receipt',{delegationId,status:complete?'completed':'blocked',detail:complete?'All delegated jobs resolved by independent intake':'Partial, missing, blocked or uncertain work retained; no automatic retry'},`${complete?'complete':'blocked'}:${delegationId}`);
}
