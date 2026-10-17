// Role-session entry point. Access envelope is private; never print or publish it.
import { readFileSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { Kernel } from '../src/kernel.mjs';
export async function sessionCall(access,{op,key=randomUUID(),input={}}){
  if(access.transport==='kernel'){
    if(typeof access.root!=='string'||!existsSync(join(access.root,'bve-v2-root.json')))throw Error('Scoped transport requires an existing recognized private root');
    const kernel=new Kernel(access.root,{recover:false});
    try{return kernel.call(access.token,op,key,input);}finally{kernel.close();}
  }
  const r=await fetch(access.origin+'/api/op',{method:'POST',headers:{Authorization:`Bearer ${access.token}`,'Content-Type':'application/json'},body:JSON.stringify({op,key,input})});
  const value=await r.json();if(!r.ok)throw Error(value.error);return value;
}
export async function resumeSession(access){return sessionCall(access,{op:'host.resume',input:{nonce:access.nonce}});}
if(process.argv[1]?.endsWith('/session.mjs')||process.argv[1]?.endsWith('\\session.mjs')){
  const [path,command='resume']=process.argv.slice(2);if(!path)throw Error('Usage: node scripts/session.mjs PRIVATE_ACCESS_FILE resume|call (call reads JSON packet on stdin)');
  const access=JSON.parse(readFileSync(path));
  console.log(JSON.stringify(command==='resume'?await resumeSession(access):command==='call'?await sessionCall(access,JSON.parse(readFileSync(0,'utf8'))):(()=>{throw Error('Unknown session command');})(),null,2));
}
