// Authored, in-memory complete file closure. No filesystem, DB, or store construction.
import {createHash} from 'node:crypto';
const hash=b=>createHash('sha256').update(b).digest('hex');
const stable=x=>JSON.stringify(x,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const bytes=x=>Buffer.from(stable(x)+'\n');
const W='11111111-1111-4111-8111-111111111111';
const P='22222222-2222-4222-8222-222222222222';
const Q='33333333-3333-4333-8333-333333333333';
const I='44444444-4444-4444-8444-444444444444';
const O='55555555-5555-4555-8555-555555555555';
const B='66666666-6666-4666-8666-666666666666';
const T='2026-01-01T00:00:00.000Z';
const H='0'.repeat(64);
const facts=()=>Object.fromEntries(['material','dimensions','sellingPrice'].map(k=>[k,{state:'unknown',value:null,sourceRefs:[],decision:null}]));
const emptyHead=()=>({schemaVersion:'3djat.domain-head.v1',workspaceId:W,revision:1,previousHead:null,products:[],skus:[],business:null,templates:[],receipts:[]});
const receiptId=(op,key)=>hash(Buffer.from(stable([W,'human-1',op,key])));
export function fixture({branded=true,laterDrafts=true,withAttachment=false,attachmentProductId=P,attachmentMember=true}={}){
 const file=new Map();
 const put=(id,revision,path,value)=>{const data=bytes(value),r={id,revision,path,sha256:hash(data)};file.set(path,data);return r;};
 const record=(kind,id,revision,value)=>put(id,revision,`Domain/${kind}/${id}/${revision}.json`,value);
 const artifact={productId:P,artifactId:Q,version:1,sha256:H,width:400,height:300};
 let h=emptyHead();let head=put(W,1,`Heads/${W}/1.json`,h);
 const genesis=head;
 const workspace={schemaVersion:'3djat.workspace.v1',workspaceId:W,revision:1,domainHead:genesis,
  paths:{business:'Business',products:'Products',templates:'Templates',operations:'Operations'},contractVersion:'3djat.v1',sourceCommit:'a'.repeat(40)};
 const wr=put(W,1,'Domain/workspace/1.json',workspace);
 file.set('workspace.json',bytes(workspace));
 file.set('domain-store.json',bytes({schemaVersion:'3djat.domain-store.v1',workspaceId:W,workspace:wr,genesis}));
 function advance(op,key,records,transitions=[],change=()=>{}){
  const before=head,next=structuredClone(h);next.revision++;next.previousHead=before;next.receipts=[];change(next);
  const id=receiptId(op,key),rec={schemaVersion:'3djat.store-receipt.v1',id,revision:1,workspaceId:W,principal:'human-1',operation:op,key,payloadHash:H,
   previousHead:before,records,transitions};
  const rr=put(id,1,`Receipts/${id}.json`,rec);next.receipts=[rr];
  h=next;head=put(W,next.revision,`Heads/${W}/${next.revision}.json`,next);return {publication:head,receipt:rr};
 }
 let product={schemaVersion:'3djat.product.v1',productId:P,revision:1,productCode:null,workingName:'Authored product',facts:facts(),
  designRevisions:[],productionRecords:[],finishingRecords:[],attachments:[],notes:[],sourceReceipt:genesis};
 let pr=record('product',P,1,product);
 advance('product.create','p1',[pr],[{kind:'product',id:P,from:0,to:1}],v=>{v.products=[{productId:P,dossier:pr}];});
 const makeTemplate=(id,kind,rev,prior=null)=>({schemaVersion:'3djat.template.v1',templateId:id,revision:rev,title:`${kind} ${rev}`,kind,appliesTo:['catalogue','editorial'],
  instructions:`Instructions ${kind} ${rev}`,inputs:kind==='operation'?[{role:'base',kind:'verified-image',required:true},...(withAttachment?[{role:'document',kind:'attachment',required:false}]:[])]:[],allowedChanges:[],outputs:kind==='operation'?[{role:'candidate',format:'image/png'}]:[],
  sourceRefs:[],supersedes:prior});
 function ingest(id,kind,rev,prior=null){
  const value=makeTemplate(id,kind,rev,prior),reference=record('template',id,rev,value);
  advance('template.ingest',`${id}-${rev}`,[reference],[{kind:'template',id,from:rev-1,to:rev}],v=>{
   const at=v.templates.findIndex(x=>x.id===id);if(at<0)v.templates.push(reference);else v.templates[at]=reference;
  });return {reference,record:value};
 }
 function adopt(chosen,decisionId){
  const decision={schemaVersion:'3djat.template-decision.v1',decisionId,template:chosen.reference,action:'adopt',purpose:'Product content',
   appliesTo:['catalogue'],expectedRevision:0,experiment:null,outputs:[],evidenceReceipt:null,
   humanActionReceipt:{id:'external',revision:1,path:'Operational/event/decision.json',sha256:H},decidedAt:T,supersedesDecision:null,reason:'Reviewed'};
  const decisionReference=record('template-decision',decisionId,1,decision);
  const {publication,receipt}=advance('template.adopt',decisionId,[decisionReference]);
  return {...chosen,decisionReference,decision,publication,receipt};
 }
 const operation=adopt(ingest('op','operation',1),O);
 const brand=adopt(ingest('brand-a','brand',1),B);
 if(laterDrafts){ingest('op','operation',2,operation.reference);ingest('brand-a','brand',2,brand.reference);}
 let attachmentReference=null;
 if(withAttachment){
  const A='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const value={schemaVersion:'3djat.attachment.v1',attachmentId:A,productId:attachmentProductId,sha256:H,location:'Sources/authored.txt',filename:'authored.txt',mime:'text/plain',bytes:1,
   availability:'unverified',source:{kind:'file',sourceId:'s1',revision:'1',sha256:H,location:'Sources/authored.txt',locator:{kind:'page',page:1},observedAt:T}};
  attachmentReference=record('attachment',A,1,value);advance('attachment.register','a1',[attachmentReference]);
  product={...structuredClone(product),revision:2,attachments:attachmentMember?[attachmentReference]:[]};
  pr=record('product',P,2,product);
  advance('product.revise','p2',[pr],[{kind:'product',id:P,from:1,to:2}],v=>{v.products[0].dossier=pr;});
 }
 const run={schemaVersion:'3djat.operation-run.v1',runId:I,productId:P,domainHead:structuredClone(head),product:structuredClone(pr),template:structuredClone(operation.reference),
  brand:branded?structuredClone(brand.reference):null,branded,brandInstructions:branded?brand.record.instructions:null,applicability:'catalogue',intent:'Create one candidate',
  direction:'Fresh',selection:{},preset:null,acceptedFacts:structuredClone(product.facts),sources:[{artifact:structuredClone(artifact),role:'base',regions:[]}],attachments:withAttachment?[{reference:structuredClone(attachmentReference),role:'document'}]:[],
  requestedOutputs:[{role:'candidate',count:1}],executionKind:'generative',executorId:'explicit-adapter',parentRoundId:null,parentArtifacts:[],
  allowance:{primaryAttempts:1,maxRetries:0},canonical:{direction:'Fresh',brand:branded?brand.record.instructions:null,count:1}};
 const closure={workspaceId:W,head:structuredClone(head),files:[...file].map(([path,data])=>({path,sha256:hash(data),bytes:data.toString('base64')})).sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0)};
 const body={workspaceId:W,projectId:P,requestId:Q,principalId:'human-1',sessionId:null,createdAt:T,domainHead:structuredClone(head),
  product:{reference:structuredClone(pr),record:structuredClone(product),acceptedFacts:structuredClone(product.facts)},dossier:[],business:null,operation:structuredClone(operation),brand:branded?structuredClone(brand):null,
  closure,run,permissionEvidence:{principalId:'human-1',sessionId:null,role:'human',grantFingerprint:H,sourceIds:[],
   templateIds:branded?['brand-a','op']:['op'],applicability:'catalogue',productId:P,observedAt:T}};
 const row={id:I,schemaVersion:'3djat.operation-selection.v1',body,bodySha256:hash(bytes(body))};
 const request={id:Q,workspaceId:W,projectId:P,selectionId:I,selectionBodySha256:row.bodySha256,state:'waiting-for-conductor',
  count:1,direction:'Fresh',brand:run.canonical.brand,intent:run.intent,allowance:structuredClone(run.allowance)};
 return {row,request,head:structuredClone(head),operation:structuredClone(operation),brand:structuredClone(brand),product:structuredClone(product),attachmentReference:structuredClone(attachmentReference)};
}
export function rehash(row,request){row.bodySha256=hash(bytes(row.body));if(request)request.selectionBodySha256=row.bodySha256;}
export function pendingLinks(x){const request=structuredClone(x.request);return {request,round:null,iteration:null,jobs:[],requests:[structuredClone(request)],rounds:[],iterations:[],allJobs:[]};}
export function commissionedLinks(x){
 const c=pendingLinks(x);c.request.state='commissioned';
 c.round={id:'77777777-7777-4777-8777-777777777777',projectId:P,requestId:Q,operation:'generate',parentRoundId:null,expectedResults:1};
 c.iteration={id:'88888888-8888-4888-8888-888888888888',projectId:P,requestId:Q,roundId:c.round.id,count:1,direction:'Fresh',brand:x.row.body.run.canonical.brand,jobIds:['99999999-9999-4999-8999-999999999999']};
 c.jobs=[{id:c.iteration.jobIds[0],projectId:P,roundId:c.round.id,iterationId:c.iteration.id,specification:{
  direction:'Fresh',brand:x.row.body.run.canonical.brand,sources:structuredClone(x.row.body.run.sources),attachments:structuredClone(x.row.body.run.attachments),parentArtifacts:[],parentRoundId:null,
  canonical:structuredClone(x.row.body.run.canonical),output:{role:'candidate',format:'image/png'},allowance:{primaryAttempts:1,maxRetries:0},
  destination:{projectId:P,iterationId:c.iteration.id},hardLimits:{maxBytes:24*1024**2,maxPixels:16_000_000}}}];
 c.request.iterationId=c.iteration.id;c.round.iterationId=c.iteration.id;
 c.requests=[structuredClone(c.request)];c.rounds=[structuredClone(c.round)];c.iterations=[structuredClone(c.iteration)];c.allJobs=structuredClone(c.jobs);return c;
}
