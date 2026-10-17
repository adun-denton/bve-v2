// Authored executable Examples A–C. Session/tool/notification callbacks are fixtures.
import { randomUUID } from 'node:crypto';
import { ensureStaff,runWorker,returnRound,sendStatement } from '../src/host-runtime.mjs';
import { fixtureSpecifications,fixtureAdapter,capabilities } from '../src/adapters.mjs';
import { sessionCall,resumeSession } from '../scripts/session.mjs';
export const call=(a,op,input,key=randomUUID())=>sessionCall(a,{op,input,key});
export const ref=a=>({artifactId:a.id,projectId:a.projectId,iterationId:a.iterationId,jobId:a.jobId,version:a.version,sha256:a.sha256,width:a.width,height:a.height,role:'Recorded comparison reference'});
export function conductor(w,id='C1',projectId=null,replace=false){const b=w.k.bindSession(w.c,{role:'conductor',sessionId:id,projectId,nonce:id+'-nonce',tier:'SOL',hostReceipt:'Authored fixture chat '+id,replace});return {root:w.root,transport:'kernel',origin:'http://127.0.0.1:1',role:'conductor',sessionId:id,token:b.token,nonce:b.nonce};}
export function fixtureHost(){
 const access={},keys=new Map(),created=[],notifications=[],received=[];let n=0;
 return {id:'canonical-example-fixture',kind:'fixture',access,keys,created,notifications,received,
  async discover(){return Object.fromEntries(['sessions','delegation','resume','userHandoff'].map(k=>[k,{status:'tested',evidence:'Authored fixture callback, not native support'}]));},
  async ensureSession({role,key,tier}){if(!keys.has(key)){keys.set(key,role==='butler'?'B1':'Gen'+(++n));created.push({id:keys.get(key),role,tier});}return {id:keys.get(key),url:null,receipt:'Authored fixture provisioning '+key};},
  async configureSession({binding,access:a}){access[binding.sessionId]=a;await resumeSession(a);},
  async sendStatement(packet){const own=await resumeSession(access[packet.sessionId]);if(!own.context.statement.some(st=>st.id===packet.statementId))throw Error('Recipient cannot read assigned statement');const receipt={kind:'simulated',receivedBy:packet.sessionId,statementId:packet.statementId};received.push(receipt);return receipt;},
  async notifyConductor(packet){const c=access[packet.sessionId];const resumed=await resumeSession(c);if(!resumed.context.event.some(e=>e.id===packet.eventId))throw Error('No durable completion event');notifications.push(packet);await call(c,'event.ack',{eventId:packet.eventId,receipt:'Authored fixture callback delivered to originating interaction'});return {sent:true,mechanism:'authored fixture callback',evidence:'Conductor resumed and acknowledged exact round event; no human prompt'};}
 };
}
export async function activate(w){
 const C1=conductor(w),host=fixtureHost();host.access.C1=C1;
 const activation=await call(C1,'project.activate',{name:'Iman Website',brief:"Iman's current website, brand texts, images, references and relevant links discussed over several turns.",instructions:'Develop Iman Website from the recorded brief; preserve original references and human judgments.',count:3,intent:"Generate three different homepage design concepts based on what we've discussed.",fixture:true});
 const project=activation.project;C1.projectId=project.id;
 const B1=await ensureStaff(C1,host,{role:'butler'});
 return {w,C1,host,project,B1,request:activation.request};
}
export async function prepare(ctx,{operation='generate',requestId=ctx.request?.id,parentRoundId=null,references=[],intent="Generate three different homepage design concepts based on what we've discussed."}={}){
 const {C1,project,host}=ctx;const expected=ctx.w.k.read(ctx.w.c.human,'request').find(r=>r.id===requestId)?.count??0;
 const round=await call(C1,'round.create',{projectId:project.id,operation,requestId,parentRoundId,references,intent,butlerInstructions:operation==='generate'?`Prepare the project folder and context; expect exactly ${expected} production jobs; receive original images and completed statements, coordinate independent verification, present BVE review, and return the completed round to C1.`:intent});
 await sendStatement(C1,host,round.statementId);
 await call(host.access.B1,'statement.report',{statementId:round.statementId,status:'ready',text:'B1 verified project and round identity, prepared folder/context and knows expected results: '+round.expectedResults});return round;
}
export async function generation(ctx,{request=ctx.request,parentRoundId=null}={}){
 const round=await prepare(ctx,{requestId:request.id,parentRoundId});
 const iteration=await call(ctx.C1,'round.commission',{roundId:round.id,specifications:fixtureSpecifications({brief:ctx.project.brief,count:request.count}),...(request.parentReviewId?{interpretation:'Follow the immutable human feedback as a creative preference.'}:{})});
 const workers=[];
 for(const jobId of iteration.jobIds){const worker=await ensureStaff(ctx.C1,ctx.host,{role:'worker',jobId});workers.push(worker);const assigned=await call(ctx.C1,'worker.assign',{projectId:ctx.project.id,bindingId:worker.id,capability:capabilities.fixtureWorker});await sendStatement(ctx.C1,ctx.host,assigned.statement.id);}
 const statements=(await resumeSession(ctx.C1)).context.statement.filter(st=>st.roundId===round.id&&st.jobId);
 for(const st of [...statements].reverse())await runWorker(ctx.host.access[st.worker.sessionId],fixtureAdapter(),st.id);
 const artifacts=ctx.w.k.read(ctx.w.c.human,'artifact').filter(a=>a.iterationId===iteration.id);
 await call(ctx.host.access.B1,'round.present',{roundId:round.id,title:round.code+' · Iman Website concepts',references:artifacts.map(ref)});
 await call(ctx.host.access.B1,'statement.report',{statementId:round.statementId,status:'completed',text:`All ${artifacts.length} expected originals accounted for by independent intake; concepts arranged for review.`});
 await returnRound(ctx.host.access.B1,ctx.host,round.id);
 await call(ctx.C1,'round.disposition',{roundId:round.id,text:request.count===3?'Your three homepage concepts are ready in BVE. Open Iman Website to review them and submit your feedback.':'The recorded follow-up direction is ready in BVE.'});
 return {round,iteration,artifacts,workers,statements};
}
export async function retire(ctx,workers){for(const b of workers)await call(ctx.C1,'staff.retire',{projectId:ctx.project.id,bindingId:b.id});}
export async function runCanonicalExamples(w){
 const ctx=await activate(w),A=await generation(ctx);
 // Already-reviewed intermediate rounds retain this same named project/staff.
 await retire(ctx,A.workers);
 const request2=w.k.call(w.c.human,'request.create','example-round-two',{projectId:ctx.project.id,intent:'Develop the selected direction in the second design round',count:1});
 const R2=await generation(ctx,{request:request2,parentRoundId:A.round.id});await retire(ctx,R2.workers);
 const request3=w.k.call(w.c.human,'request.create','example-round-three',{projectId:ctx.project.id,intent:'Develop the latest selected direction in the third design round',count:1});
 const R3=await generation(ctx,{request:request3,parentRoundId:R2.round.id});await retire(ctx,R3.workers);
 const references=[...A.artifacts.map(ref),ref(R3.artifacts[0])];
 const B=await prepare(ctx,{operation:'compare',parentRoundId:R3.round.id,references,intent:'Show me the original three designs next to the latest selected direction. Arrange them so I can compare how the design has evolved.'});
 await call(ctx.host.access.B1,'round.present',{roundId:B.id,title:'Original three designs and latest selected direction',references});
 await call(ctx.host.access.B1,'statement.report',{statementId:B.statementId,status:'completed',text:'Existing recorded originals arranged without regeneration.'});await returnRound(ctx.host.access.B1,ctx.host,B.id);
 await call(ctx.C1,'round.disposition',{roundId:B.id,text:'The comparison of the original three designs and latest selected direction is ready.'});
 const C=await prepare(ctx,{operation:'branch',parentRoundId:R2.round.id,references:R2.artifacts.map(ref),intent:"Let's return to the second design round and develop a different direction from there."});
 await call(ctx.host.access.B1,'round.present',{roundId:C.id,title:'Branch from the second design round',references:R2.artifacts.map(ref)});
 await call(ctx.host.access.B1,'statement.report',{statementId:C.statementId,status:'completed',text:'Branch recorded; later rounds preserved; no generation authorized by this operation.'});
 await returnRound(ctx.host.access.B1,ctx.host,C.id);
 await call(ctx.C1,'round.disposition',{roundId:C.id,text:'The branch from R002 is recorded; later history remains available.'});
 const C2=conductor(w,'C2',ctx.project.id,true);ctx.host.access.C2=C2;
 const resumed=await resumeSession(C2);
 return {ctx,A,R2,R3,B,C,C2,resumed};
}
