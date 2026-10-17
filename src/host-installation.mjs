// Narrow local installation adapter: host session control is supplied by the actual
// host, never emulated by named records. No image calls are made by this module.
import { readFileSync, mkdirSync, writeFileSync, openSync, closeSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { backupRoot } from '../scripts/backup.mjs';
const roles=['conductor','generator','butler'];
const instructions=role=>readFileSync(new URL(`../docs/roles/${role.toUpperCase()}.md`,import.meta.url),'utf8');
const required=['sessions','delegation','resume','image','originalBytes','userHandoff'];
export const unavailableHost={
  id:'unconfigured-host',kind:'unavailable',
  async discover(){return Object.fromEntries(required.map(k=>[k,{status:'unavailable',evidence:'No actual host driver installed'}]));}
};
export function installationStatus(kernel,owner){
  const state=kernel.hostState(owner),bindings=kernel.hostBindings(owner);
  return {status:state?.status??'incomplete',host:state?.host??null,kind:state?.kind??null,gaps:state?.gaps??['No host installation'],
    sessions:bindings.map(({role,sessionId,sessionUrl,projectId,hello})=>({role,sessionId,sessionUrl,projectId,readReceipt:hello?.id??null})),
    conductor:state?.status==='operational'?bindings.find(b=>b.role==='conductor')?.sessionUrl??null:null};
}
export async function installHost(options){
  const {kernel,owner}=options;kernel.hostState(owner); // Validate owner before filesystem mutation.
  const lock=join(kernel.root,'host-install-owner.json');
  if(existsSync(lock)){
    const previous=JSON.parse(readFileSync(lock));let alive=false;
    try{process.kill(previous.pid,0);alive=true;}catch(e){if(e.code!=='ESRCH')throw e;}
    if(alive)throw Error('Host installation already running; preserve its session provisioning keys');
    unlinkSync(lock);
  }
  const fd=openSync(lock,'wx',0o600);writeFileSync(fd,JSON.stringify({pid:process.pid,at:new Date().toISOString()}));closeSync(fd);
  try{return await installUnlocked(options);}finally{unlinkSync(lock);}
}
async function installUnlocked({kernel,owner,origin,host=unavailableHost,projectId=null,backupDestination}){
  const u=new URL(origin);if(u.protocol!=='http:'||u.hostname!=='127.0.0.1'||u.pathname!=='/')throw Error('Host installation requires the exact loopback BVE origin');
  if(projectId!==null&&!kernel.read(owner.conductor,'project').some(p=>p.id===projectId))throw Error('Installation project does not exist; never recreate it');
  if(projectId===null&&kernel.read(owner.conductor,'project').length)throw Error('Select the existing project explicitly; unbound setup is only for an empty workspace');
  const previous=kernel.hostState(owner);
  if(previous&&previous.host!==host.id)throw Error('A different host requires explicit installation review; existing bindings preserved');
  // Backup includes session records and tokens in SQLite; private access files are
  // derived envelopes and are regenerated on safe resume. Never overwrite a root.
  const backup=await backupRoot(kernel.root,backupDestination??`${kernel.root}-pre-host-${randomUUID()}`);
  const state={...previous,id:'active',host:host.id,kind:host.kind,status:'incomplete',projectId,backup,steps:previous?.steps??{},gaps:[],updatedAt:new Date().toISOString()};
  const save=()=>kernel.hostState(owner,state);
  save();
  try{
    state.capabilities=await host.discover();
    const controls=['sessions','delegation','resume'];
    const absent=controls.filter(k=>state.capabilities[k]?.status!=='tested'||!state.capabilities[k]?.evidence);
    if(absent.length){state.gaps=absent.map(k=>`Actual ${k} control not tested in this host`);save();return installationStatus(kernel,owner);}
    for(const role of roles){
      const step=state.steps[role]??={key:`${host.id}:${role}:${randomUUID()}`};save();
      const previousBinding=kernel.hostBindings(owner).find(b=>b.role===role);
      // ensureSession must be idempotent at this key even after a lost response.
      const session=await host.ensureSession({role,key:step.key,previous:previousBinding?{id:previousBinding.sessionId,url:previousBinding.sessionUrl}:null,instructions:instructions(role)});
      if(!session?.id||!session.receipt)throw Error(`${role}: host did not return actual session identity/receipt`);
      const binding=kernel.bindSession(owner,{role,sessionId:session.id,sessionUrl:session.url??null,projectId,nonce:step.nonce??=randomUUID(),replace:Boolean(previousBinding)});
      step.sessionId=binding.sessionId;step.creationReceipt=session.receipt;step.bindingId=binding.id;save();
      const dir=join(kernel.root,'host-sessions');mkdirSync(dir,{recursive:true,mode:0o700});
      const accessFile=join(dir,`${role}.json`);
      if(host.transport!==undefined&&!['http','kernel'].includes(host.transport))throw Error('Unsupported session transport');
      writeFileSync(accessFile,JSON.stringify({transport:host.transport??'http',...(host.transport==='kernel'?{root:kernel.root}:{}),format:'bve-session-access-v1',origin:u.origin,role,sessionId:binding.sessionId,projectId,token:binding.token,nonce:binding.nonce}),{mode:0o600});
      // The actual session must call host.resume. A driver boolean is insufficient.
      const beforeRead=kernel.hostBindings(owner).find(b=>b.id===binding.id)?.hello?.id;
      await host.verifySession({role,sessionId:binding.sessionId,accessFile,instructions:instructions(role)});
      const verified=kernel.hostBindings(owner).find(b=>b.id===binding.id);
      if(!verified?.hello||verified.hello.id===beforeRead)throw Error(`${role}: no session-originated scoped read receipt`);
      step.readReceipt=verified.hello.id;save();
    }
    const previousRoutes=new Set(kernel.hostRoutes(owner).map(d=>d.id));
    await host.verifyDelegation({sessions:installationStatus(kernel,owner).sessions,projectId});
    // Conductor must actually send and both recipients must actually receipt a
    // no-image readiness delegation. No installer-side execution of these calls.
    const conductor=kernel.hostBindings(owner).find(b=>b.role==='conductor');
    const routes=kernel.hostRoutes(owner);
    for(const role of ['generator','butler'])if(!routes.some(d=>!previousRoutes.has(d.id)&&d.kind==='readiness'&&d.fromSessionId===conductor.sessionId&&d.toRole===role&&d.state==='completed'))throw Error(`${role}: delegated readiness receipt missing`);
    state.gaps=required.filter(k=>state.capabilities[k]?.status!=='tested'||!state.capabilities[k]?.evidence).map(k=>`${k}: actual host capability not tested`);
    if(host.kind!=='native')state.gaps.push('Only fixture/probe installation demonstrated; no native operational handoff');
    if(!conductor.sessionUrl)state.gaps.push('No user-openable Conductor session link');
    if(state.gaps.length){state.status=host.kind==='fixture'?'fixture-verified':'incomplete';save();return installationStatus(kernel,owner);}
    const before=kernel.hostBindings(owner).find(b=>b.role==='conductor').hello.id;
    await host.startConductor({sessionId:conductor.sessionId,projectId,message:projectId===null?'Ready to receive the first brief; no work is authorized by setup.':'Resume the preserved project, explain readiness for the next human direction; do not recreate or regenerate completed work.'});
    const after=kernel.hostBindings(owner).find(b=>b.role==='conductor').hello;
    if(!after||after.id===before)throw Error('Initial Conductor work session did not perform a fresh durable context read');
    state.status='operational';state.handoffReceipt=after.id;save();
  }catch(e){state.status='incomplete';state.gaps=[String(e.message)];save();}
  return installationStatus(kernel,owner);
}
