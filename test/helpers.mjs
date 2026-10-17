import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Kernel } from '../src/kernel.mjs';
import { fixtureSpecifications, capabilities } from '../src/adapters.mjs';
import { fixturePNG } from '../src/png.mjs';
export function workspace(){const root=join(mkdtempSync(join(tmpdir(),'bve-v2-test-')),'private');let k=new Kernel(root);const c=JSON.parse(readFileSync(join(root,'credentials.json')));return {root,k,c,call:(role,op,input,key=randomUUID())=>k.call(c[role],op,key,input)};}
export function first(w,count=6){const p=w.call('human','project.create',{name:'Authored botanical study',brief:'Explore calm abstract compositions',count});const r=w.call('human','request.create',{projectId:p.id,intent:`Create ${count} image candidates`});const input={requestId:r.id,specifications:fixtureSpecifications({brief:p.brief,count})};const i=w.call('conductor','iteration.commission',input,'first-commission');return {p,r,i,input};}
export function allocate(w,jid){return w.call('generator','job.allocate',{jobId:jid,executor:'fixture-worker',capability:capabilities.fixtureWorker},`allocate:${jid}`);}
export function start(w,a){return w.call('generator','attempt.start',{assignmentId:a.id},`start:${a.id}`);}
export function deliver(w,a,n=0,outcome='success',bytes=fixturePNG(n).toString('base64')){return w.k.call(a.token,'result.deliver',`delivery:${a.id}`,{assignmentId:a.id,outcome,bytes,evidence:{kind:'simulated',model:null,cost:null,usage:null}});}
export function finish(w,i){for(const [n,j] of [...i.jobIds].reverse().entries()){const a=allocate(w,j);start(w,a);deliver(w,a,n);w.k.reconcile(w.c.butler);}return w.k.read(w.c.human,'artifact').filter(a=>a.iterationId===i.id);}
export function feedback(artifacts){return {overall:'Prefer the quiet circle; add breathing room in the marked area.',images:artifacts.map((a,n)=>({artifactId:a.id,sha256:a.sha256,version:a.version,width:a.width,height:a.height,note:n===0?'Keep composition as a preference':'',favorite:n===0,regions:n===0?[{space:'normalized-original',x:.1,y:.2,w:.3,h:.25,text:'Give this area more breathing room'}]:[]}))};}
export function submit(w,i,artifacts,intent='feedback'){const draft=w.call('human','draft.save',{iterationId:i.id,expectedVersion:0,feedback:feedback(artifacts)});const s=w.call('human','review.submit',{iterationId:i.id,draftVersion:draft.version,intent});return {draft,s};}
