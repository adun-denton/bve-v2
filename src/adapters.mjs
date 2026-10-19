import { fixturePNG } from './png.mjs';
import { randomUUID } from 'node:crypto';
const key=()=>randomUUID();
export const capabilities=Object.freeze({
  nativeWorker:{status:'unavailable',originalBytes:false,formats:[],paid:false,concurrency:1,reason:'No native host adapter has been installed or exercised'},
  fixtureWorker:{status:'simulated',originalBytes:true,formats:['image/png'],paid:false,concurrency:1,evidence:'Authored PNG fixtures; no image model invocation; model, cost and usage unknown'},
  notification:{status:'unavailable',reason:'Durable unread events and Conductor polling are available; no live push integration'},
  concurrency:{status:'unverified',enabled:1,reason:'Serial fallback; actual concurrent native execution has not been tested'}
});
// Internal allocation and durable start are deterministic. Only queued/unsent assignments are ever entered.
// A running/uncertain attempt must be reconciled with its original executor, never invoked again.
export async function dispatch(kernel, credentials, adapter, jobIds) {
  if(!adapter || !['simulated','demonstrated'].includes(adapter.capability.status))return {gap:capabilities.nativeWorker.reason};
  const outcomes=[];
  for(const jobId of jobIds){
    kernel.reconcile(credentials.butler);
    let job=kernel.read(credentials.generator,'job').find(j=>j.id===jobId);
    if(!job||!['queued','assigned'].includes(job.state)){outcomes.push({jobId,skipped:true,dependencyIssues:job?.dependencyIssues??[]});continue;}
    let assignment;
    if(job.state==='queued')assignment=kernel.call(credentials.generator,'job.allocate',`allocate:${jobId}`,{jobId,executor:adapter.id,capability:adapter.capability});
    else {
      const a=kernel.read(credentials.generator,'assignment').find(a=>a.id===job.assignmentId);
      // Allocation receipt recovers the existing scoped token for an unsent assignment.
      if(a.executor!==adapter.id){outcomes.push({jobId,gap:'Allocated executor unavailable'});continue;}
      assignment=kernel.call(credentials.generator,'job.allocate',`allocate:${jobId}`,{jobId,executor:adapter.id,capability:adapter.capability});
    }
    kernel.call(credentials.generator,'attempt.start',`start:${assignment.id}`,{assignmentId:assignment.id});
    try{
      const delivery=await adapter.execute({...kernel.assignment(assignment.token),token:assignment.token});
      outcomes.push(kernel.call(assignment.token,'result.deliver',`delivery:${assignment.id}`,{assignmentId:assignment.id,...delivery}));
    }catch(e){
      // Never assume a thrown adapter error means no external image call occurred.
      outcomes.push(kernel.call(assignment.token,'result.deliver',`delivery:${assignment.id}`,{assignmentId:assignment.id,outcome:'uncertain',evidence:{kind:adapter.capability.status==='simulated'?'simulated':'host',error:String(e.message),model:null,cost:null,usage:null}}));
    }
    kernel.reconcile(credentials.butler);
  }
  return {outcomes};
}
export function fixtureAdapter(iteration=1){return {
  id:'authored-fixture-executor',capability:capabilities.fixtureWorker,
  async execute(assignment){
    const n=Number(assignment.specification.directionId.match(/\d+/)?.[0]??1)-1;
    return {outcome:'success',bytes:fixturePNG(n,iteration).toString('base64'),evidence:{kind:'simulated',executor:'authored-fixture-executor',model:null,cost:null,usage:null,iteration}};
  }
};}
const directions=[
  ['Soft orbit','A large circular focal form and generous quiet edges','Use one off-center circle in a muted botanical palette, spacious and calm.'],
  ['Editorial block','A vertical half-width mass with strong asymmetry','Use a tall rectangular focal block on the right, balanced by open left space and warm clay.'],
  ['Centered signal','A centered diamond with a cool palette','Use a single centered diamond, cool pale blue field, precise and geometric.'],
  ['Rhythmic field','Multiple curved ribbons with a lilac palette','Use repeated diagonal organic wave ribbons over lilac, energetic and layered.'],
  ['Garden columns','Three separated columns with an olive palette','Use three separated upright columns, pale olive ground, measured rhythm.'],
  ['Open ring','An open central ring with a mint palette','Use a single wide mint ring with an empty center, airy and restrained.']
];
export function fixtureSpecifications({brief,count=6,sources=[],sourceSets=null,iteration=1,maxPixels=16_000_000}){
  return directions.slice(0,count).map(([label,difference,prompt],n)=>({directionId:`direction-${n+1}`,label:iteration===1?label:`${label} · refinement`,difference:iteration===1?difference:`${difference}; a small quiet accent in the upper left`,brief,
    prompt:iteration===1?prompt:`${prompt} Interpret the submitted preference as a quieter upper-left accent; preserve the named composition as a creative preference, not an exact pixel guarantee.`,
    sources:(sourceSets?.[n]??sources).map(s=>({...s,role:s.role??'Chosen composition reference'})),output:{format:'image/png'},hardLimits:{maxBytes:24*1024*1024,maxPixels},preferences:['Calm visual exploration; authored test composition only']}));
}
export async function simulateCommission(kernel,credentials,requestId){
  const request=kernel.read(credentials.conductor,'request').find(r=>r.id===requestId);
  const continuation=request.parentReviewId?kernel.read(credentials.conductor,'continuation').find(c=>c.id===request.parentReviewId):null;
  const p=kernel.read(credentials.conductor,'project').find(p=>p.id===request.projectId);
  // Authored Conductor choice: Fresh starts with no old image input. Follow chooses
  // only the first available reference, and only its explicitly selected region.
  const chosen=continuation?.historicalCoverage.availableSources.slice(0,1)??[];
  const sources=request.direction==='Follow'?chosen.map(ref=>{
    const image=continuation.feedback.images.find(f=>f.artifactId===ref.artifactId);
    return {...ref,role:'Chosen composition; creative preference, no exact-pixel promise',regions:(image?.regions??[]).slice(0,1).map((region,index)=>({space:region.space,x:region.x,y:region.y,w:region.w,h:region.h,meaning:region.text,reviewRegion:{reviewId:continuation.submissionId,index}}))};
  }):[];
  const iteration=kernel.call(credentials.conductor,'iteration.commission',`commission:${request.id}`,{requestId:request.id,
    specifications:fixtureSpecifications({brief:p.brief,count:request.count,sources,iteration:continuation?2:1}),
    ...(continuation?{interpretation:'Simulated Conductor interpretation: use the original review words and regions as guidance; keep geometry and original feedback separately inspectable.'}:{})});
  await dispatch(kernel,credentials,fixtureAdapter(continuation?2:1),iteration.jobIds);return iteration;
}
export async function seedDemo(kernel,credentials){
  const existing=kernel.read(credentials.human,'project');if(existing.length)return existing[0];
  const project=kernel.call(credentials.human,'project.create','fixture-project',{name:'Quiet Forms · authored study',fixture:true,brief:'Explore six distinct graphic compositions for a fictional botanical studio. Authored raster fixtures demonstrate workflow, not AI image quality.',count:6,direction:'Fresh',brand:'Muted botanical color, generous space; exploratory context'});
  const r=kernel.call(credentials.human,'request.create','fixture-first-request',{projectId:project.id,intent:'Create six distinct candidates for this authored offline workflow demonstration.'});
  await simulateCommission(kernel,credentials,r.id);return project;
}
