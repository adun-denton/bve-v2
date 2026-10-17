// Local owner/adapter entry point. Reads only its function credential; never prints credentials.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
const root=process.env.BVE_ROOT||join(homedir(),'.bve-v2','workspace-v1');
const token=JSON.parse(readFileSync(join(root,'credentials.json'))).conductor;
const origin=process.env.BVE_URL||'http://127.0.0.1:4317';
const [command,arg]=process.argv.slice(2);
const request=async(path,init={})=>{const r=await fetch(origin+path,{...init,headers:{Authorization:`Bearer ${token}`,...init.headers}});const x=await r.json();if(!r.ok)throw Error(x.error);return x;};
if(command==='resume'){
  const [requests,events,continuations,creativeContext]=await Promise.all(['request','event','continuation','creativeContext'].map(k=>request('/api/read?kind='+k)));
  console.log(JSON.stringify({requests:requests.filter(r=>r.state==='waiting-for-conductor'),unreadEvents:events.filter(e=>!e.consumedAt),continuations,creativeContext},null,2));
}else if(command==='commission'||command==='context'){
  const packet=JSON.parse(readFileSync(arg));
  if(!packet.key||!packet.input)throw Error('Commission packet needs stable key and input fields');
  console.log(JSON.stringify(await request('/api/op',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...packet,op:command==='context'?'creativeContext.supply':'iteration.commission'})}),null,2));
}else if(command==='consume'){
  console.log(JSON.stringify(await request('/api/op',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op:'event.consume',key:`consume:${arg}`,input:{eventId:arg}})}),null,2));
}else throw Error('Usage: node scripts/conductor.mjs resume | commission /private/specifications.json | context /private/creative-context.json | consume EVENT_ID');
