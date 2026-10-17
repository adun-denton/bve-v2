// Installer provisions the reusable host connection. Project staff are on-demand.
import { readFileSync,writeFileSync,openSync,closeSync,existsSync,unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { backupRoot } from '../scripts/backup.mjs';
export const unavailableHost={id:'unconfigured-host',kind:'unavailable',async discover(){return {sessions:{status:'unavailable',evidence:'No actual host driver installed'}};}};
export function installationStatus(kernel,owner){
  const s=kernel.hostState(owner);return {status:s?.protocol==='project-statements-v1'?s.status:'incomplete',host:s?.host??null,kind:s?.kind??null,gaps:s?.protocol==='project-statements-v1'?s.gaps:['Current project-session host contract not verified'],capabilities:s?.capabilities??{},staffProvisionedByInstaller:0};
}
export async function installHost({kernel,owner,host=unavailableHost,backupDestination}){
  const previous=kernel.hostState(owner),lock=join(kernel.root,'host-install-owner.json');
  if(previous&&previous.host!==host.id)throw Error('Different host would replace installed integration; existing state preserved');
  if(existsSync(lock)){
    const old=JSON.parse(readFileSync(lock));let alive=false;try{process.kill(old.pid,0);alive=true;}catch(e){if(e.code!=='ESRCH')throw e;}
    if(alive)throw Error('Host installation already running');unlinkSync(lock);
  }
  const fd=openSync(lock,'wx',0o600);writeFileSync(fd,JSON.stringify({pid:process.pid}));closeSync(fd);
  try{
    const backup=await backupRoot(kernel.root,backupDestination??`${kernel.root}-pre-host-${randomUUID()}`);
    const capabilities=await host.discover();
    const gaps=['sessions','delegation','resume','userHandoff'].filter(k=>capabilities[k]?.status!=='tested'||!capabilities[k]?.evidence).map(k=>`${k}: actual host capability not tested`);
    const status=gaps.length?'incomplete':host.kind==='native'?'runtime-ready':'fixture-verified';
    kernel.hostState(owner,{id:'active',protocol:'project-statements-v1',host:host.id,kind:host.kind,status,capabilities,gaps,backup,updatedAt:new Date().toISOString()});
    return installationStatus(kernel,owner);
  }finally{unlinkSync(lock);}
}
