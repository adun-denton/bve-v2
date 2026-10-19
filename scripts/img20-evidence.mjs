// Private experiment diagnostics only; never a production receipt or recovery API.
import * as fs from 'node:fs';
import * as path from 'node:path';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
export const digest=b=>createHash('sha256').update(b).digest('hex');
export const errorRecord=e=>({code:e.code??e.name??'ERROR',message:e.message});
export function atomic(file,value){
  const temp=file+'.next';const fd=fs.openSync(temp,'w',0o600);
  try{fs.writeFileSync(fd,JSON.stringify(value,null,2)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  fs.renameSync(temp,file);
}
export function journal(output){
  const state={schemaVersion:'img20.private-lifecycle.v1',sourcePin:null,status:'RUNNING',phase:'allocation',pid:process.pid,roots:{allocation:null,runtime:null,business:null,source:null,backup:null},inputs:[],completed:[],children:[],locks:[],firstError:null,secondaryErrors:[],cleanup:'NOT STARTED',IMG20:'OPEN',limitations:['Private experiment; not production receipts','Internal samples may have blocking gaps','Child external sampling NOT MEASURED; OS/process namespace not inferred']};
  let index=0;
  function save(phase,detail){
    state.phase=phase;
    if(detail!==undefined)state.completed.push({phase,detail});
    const file=path.join(output,`checkpoint-${String(++index).padStart(4,'0')}.json`);
    atomic(file,state);state.lastCheckpoint={file,sha256:digest(fs.readFileSync(file))};atomic(path.join(output,'lifecycle.json'),state);
  }
  function fail(e){if(!state.firstError)state.firstError=errorRecord(e);else state.secondaryErrors.push(errorRecord(e));}
  function attempt(fn){try{fn();}catch(e){fail(e);}}
  function observe(when){
    for(const [root,name] of [[state.roots.runtime,'operational-write.lock'],[state.roots.business,'domain-write.lock']]){
      if(!root){state.locks.push({when,name,status:'ROOT UNKNOWN'});continue;}
      const file=path.join(root,name);let row={when,file};
      try{
        const bytes=fs.readFileSync(file);row={...row,status:'PRESENT',sha256:digest(bytes),bytes:bytes.length,copy:path.join(output,`lock-${state.locks.length}.bin`)};
        try{fs.writeFileSync(row.copy,bytes,{mode:0o600});}catch(e){row.copyError=errorRecord(e);fail(e);}
      }catch(e){row={...row,status:e.code==='ENOENT'?'ABSENT':'READ ERROR',error:errorRecord(e)};if(e.code!=='ENOENT')fail(e);}
      state.locks.push(row);
    }
  }
  return {state,save,fail,attempt,observe};
}
// Fixed Node fixture only. A timeout is failure even after a confirmed forced exit.
export async function runChild(args,{timeoutMs=30000,onStart=()=>{},signal}={}){
  const child=spawn(process.execPath,args,{env:{...process.env},stdio:['ignore','pipe','pipe']});
  const row={pid:child.pid??null,ownership:'spawned child handle',exit:'UNKNOWN',status:null,signal:null,stdout:'',stderr:'',timedOut:false,interrupted:false,error:null};
  let startError;try{onStart(row);}catch(e){startError=e;row.error=errorRecord(e);}
  child.stdout.on('data',b=>{row.stdout+=b;});child.stderr.on('data',b=>{row.stderr+=b;});
  let force,unknown,timer;
  let abort;
  await new Promise(resolve=>{
    const stop=()=>{
      child.kill('SIGTERM');force=setTimeout(()=>child.kill('SIGKILL'),250);
      unknown=setTimeout(resolve,3000);
    };
    abort=()=>{row.interrupted=true;stop();};
    child.once('error',e=>{row.error=errorRecord(e);if(!child.pid)resolve();});
    child.once('close',(status,sig)=>{row.exit='CONFIRMED';row.status=status;row.signal=sig;resolve();});
    timer=setTimeout(()=>{row.timedOut=true;stop();},timeoutMs);
    signal?.addEventListener('abort',abort,{once:true});
    if(signal?.aborted)abort();
    else if(startError)stop();
  });
  clearTimeout(timer);clearTimeout(force);clearTimeout(unknown);signal?.removeEventListener('abort',abort);
  // If the OS cannot confirm exit, do not pretend quiescence or keep this parent alive.
  if(row.exit==='UNKNOWN'){child.stdout.destroy();child.stderr.destroy();child.unref();}
  return row;
}
