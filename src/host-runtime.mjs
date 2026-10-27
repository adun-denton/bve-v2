import { randomUUID,createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { dispatchPNGServices,reconcilePNGService } from './executors/pillow.mjs';
import { sessionCall,resumeSession,sessionOriginal } from '../scripts/session.mjs';
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
  if(st.service)throw Error('Service statements use the local deterministic dispatcher, not an AI session');
  return host.sendStatement({sessionId:st.worker?.sessionId??st.butler.sessionId,statementId,projectId:st.projectId,roundId:st.roundId});
}
export async function runWorker(access,adapter,statementId){
  const resumed=await resumeSession(access),st=resumed.context.statement.find(s=>s.id===statementId),a=resumed.assignmentAccess;
  if(!st||resumed.receipt.role!=='worker'||resumed.receipt.sessionId!==access.sessionId||st.worker?.sessionId!==access.sessionId||!a||a.jobId!==st.jobId||a.executor!==access.sessionId)throw Error('No exact worker statement/assignment');
  if(!['assigned'].includes(resumed.context.job.find(j=>j.id===st.jobId)?.state))return {skipped:true,reason:'Existing attempt must not be reinvoked'};
  const block=async message=>{
    await call(access,'statement.report',{statementId:st.id,status:'blocked',text:message+'; no invocation started. Resume this same assignment when its exact route is available.'},'blocked:'+a.id+':'+createHash('sha256').update(message).digest('hex').slice(0,16));
    throw Error(message);
  };
  const capability=structuredClone(adapter?.capability);
  if(!adapter||typeof adapter.execute!=='function'||!['demonstrated','simulated'].includes(capability?.status)||capability.originalBytes!==true||!capability.formats?.includes('image/png')||capability.paid!==false||!isDeepStrictEqual(capability,a.capability))return block('No matching assigned compatible uncharged executor capability');
  if(a.operationSelection&&adapter.id!==a.operationSelection.body.run.executorId)return block('Executor differs from the frozen selected route');
  const sources=new Map(a.specification.sources.map(source=>{const ref=source.artifact??source;return [ref.artifactId,ref.sha256];}));
  const readOriginal=async id=>{
    if(!sources.has(id))throw Error('Source is outside the assigned inputs');
    const bytes=await sessionOriginal({...access,token:a.token},id);
    if(createHash('sha256').update(bytes).digest('hex')!==sources.get(id))throw Error('Assigned source bytes changed');
    return bytes;
  };
  for(const id of sources.keys())await readOriginal(id);
  await call(access,'worker.start',{roundId:st.roundId},`start:${a.id}`);
  let result;try{
    result=await adapter.execute({...a,statement:st,readOriginal});
    if(!result||!['success','failure','uncertain'].includes(result.outcome)||result.evidence?.kind!==(capability.status==='simulated'?'simulated':'host')||result.assignmentId!==undefined&&result.assignmentId!==a.id)throw Error('Unproved executor return');
  }catch{
    result={outcome:'uncertain',evidence:{kind:capability.status==='simulated'?'simulated':'host',error:'EXECUTOR_RETURN_UNCERTAIN',model:null,cost:null,usage:null}};
  }
  await call({...access,token:a.token},'result.deliver',{assignmentId:a.id,...result},`delivery:${a.id}`);
  await call(access,'statement.report',{statementId:st.id,status:result.outcome==='success'?'produced':result.outcome==='failure'?'failed':'uncertain',text:'Assigned executor returned '+result.outcome+'; independent intake determines artifact validity'},`report:${a.id}`);
  return {assignmentId:a.id,outcome:result.outcome};
}
export async function returnRound(access,host,roundId){
  const resumed=await resumeSession(access),round=resumed.context.round.find(r=>r.id===roundId),checkpoint=resumed.context.checkpoint.find(c=>c.roundId===roundId);
  if(!round||!checkpoint||round.butler.sessionId!==access.sessionId)throw Error('No completed Butler cycle to return');
  const event=resumed.context.event.find(e=>e.roundId===roundId);
  const recipient=resumed.context.sessionBinding.find(b=>b.role==='conductor'&&!b.revokedAt)?.sessionId;
  let attempt;
  try{
    const receipt=await host.notifyConductor({sessionId:recipient,eventId:event.id,roundId,checkpointId:checkpoint.id});
    if(typeof receipt?.sent!=='boolean'||typeof receipt.mechanism!=='string'||!receipt.mechanism.trim()||receipt.mechanism.length>200)throw Error('Unproved notification');
    attempt={eventId:event.id,mechanism:receipt.mechanism,status:receipt.sent?'sent':'failed',evidence:receipt.evidence??null};
  }catch{attempt={eventId:event.id,mechanism:'host-return',status:'failed',evidence:'Host notification unavailable; durable event retained for scoped Conductor resume.'};}
  const delivery=await call(access,'event.delivery',attempt);
  const current=(await resumeSession(access)).context.event.find(e=>e.id===event.id);
  return {...delivery,eventId:event.id,roundId,checkpointId:checkpoint.id,recipientSessionId:recipient,
    acknowledgedAt:current.acknowledgedAt,consumedAt:current.consumedAt,
    manualResume:current.consumedAt?null:"Reopen the product's Conductor and ask it to resume the project and read unread durable events."};
}

// Trusted local host owner only. Selection, commission and service.assign precede this call.
// These closed dispatchers accept no executable, tool arguments, recipe or result bytes.
export async function runDeterministicServices(kernel,owner,input){
  if(!input||Object.keys(input).length!==2||!Object.hasOwn(input,'projectId')||!Array.isArray(input.jobIds)||input.jobIds.length<1||input.jobIds.length>6)throw Error('Invalid service dispatch scope');
  for(const id of input.jobIds)if(kernel.serviceAssignment(owner,id).projectId!==input.projectId)throw Error('Foreign service job');
  return dispatchPNGServices(kernel,owner,input.jobIds);
}
export function reconcileDeterministicService(kernel,owner,{projectId,jobId}){
  if(kernel.serviceAssignment(owner,jobId).projectId!==projectId)throw Error('Foreign service job');
  return reconcilePNGService(kernel,owner,jobId);
}
