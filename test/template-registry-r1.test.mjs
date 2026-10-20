// Eight fixed receipt-integrity groups. Same file runs on baseline and repaired source.
// All bearers/decisions/files are authored fixtures; preserve every first outcome.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {createHash} from 'node:crypto';
import {request} from 'node:http';
import {DomainStore} from '../src/domain-store.mjs';
import {DomainTemplates,readTemplateRegistry} from '../src/domain-templates.mjs';
import {serve} from '../src/server.mjs';
import {setup,template,packet,ingest,adopt,adoption,query,read,policy,ok,denied} from './fixtures/3djat/template-registry-fixture.mjs';

// Independent test encoding of the FROZEN store plan, including its trailing LF.
const canonical=v=>JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
const digest=b=>createHash('sha256').update(b).digest('hex');
const encoded=v=>Buffer.from(canonical(v)+'\n','utf8');
const json=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const rootLimit=12,byteLimit=12*1024**2;
let fatal=null;
const rootSet=new Set();
function unplanned(stage,detail){if(stage.endsWith('command-error')&&['LOCKED','LOCK_CHANGED','COMMIT_UNCERTAIN','COMMIT_ABORTED','REPLY_UNCERTAIN'].includes(detail?.code))fatal={stage,...detail};}
function record(w,data){const p=path.join(w.dir,'R1-INTEGRITY-OBSERVATIONS.json');const rows=fs.existsSync(p)?json(p):[];rows.push(data);fs.writeFileSync(p,JSON.stringify(rows,null,2)+'\n','utf8');}
function files(root){const out=[];for(const d of fs.readdirSync(root,{withFileTypes:true})){assert(!d.isSymbolicLink());const p=path.join(root,d.name);if(d.isDirectory())for(const x of files(p))out.push({path:d.name+'/'+x.path,bytes:x.bytes,sha256:x.sha256});else{const b=fs.readFileSync(p);out.push({path:d.name,bytes:b.length,sha256:digest(b)});}}return out.sort((a,b)=>a.path.localeCompare(b.path));}
function register(name,fn){test(name,async t=>{
 if(fatal){t.skip('Stopped after first unplanned publication symptom');return;}
 await fn(t);
});}
function fixture(t,options={}){
 assert(rootSet.size<rootLimit,'New R1 run parent cap');
 const allocation=process.env.R1_ALLOCATION_ROOT;if(allocation&&fs.existsSync(allocation)){const rows=files(allocation);assert(rows.reduce((n,x)=>n+x.bytes,0)+(options.reserve??512*1024)<=byteLimit,'Additional R1 aggregate reservation');}
 let w;try{w=setup(t,{...options,hook:unplanned,workspaceHook:unplanned});}catch(e){fatal={stage:'fixture-setup',message:e.message};throw e;}
 rootSet.add(w.dir);t.after(()=>{
  const parent=path.dirname(w.dir);const parents=fs.readdirSync(parent).filter(n=>n.startsWith('template-'));assert(parents.length<=rootLimit);
  let bytes=0;for(const name of parents)for(const f of files(path.join(parent,name)))bytes+=f.bytes;assert(bytes<=byteLimit,'Additional R1 byte cap');
  if(fatal)fs.writeFileSync(path.join(w.dir,'R1-FIRST-UNPLANNED-STOP.json'),JSON.stringify(fatal,null,2)+'\n','utf8');
 });return w;
}
function good(result){if(result?.schemaVersion!=='3djat.result.v1')fatal??={stage:'unexpected-command-failure',result};return ok(result);}
function firstIngest(w,value=template()){
 try{return ingest(w,value);}catch(e){fatal??={stage:'unexpected-ingest',message:e.message};throw e;}
}
function firstAdopt(w,ref,options={}){
 try{return adopt(w,ref,options);}catch(e){fatal??={stage:'unexpected-adopt',message:e.message};throw e;}
}
function pristineCopy(w,name,source=w.root){
 assert(!fatal,'Stop before further fixture work');const original=files(source),root=path.join(w.dir,name);assert(!fs.existsSync(root));fs.cpSync(source,root,{recursive:true,errorOnExist:true});assert.deepEqual(files(root),original);record(w,{kind:'preserved-successful-original',source,copy:root,files:original});return root;
}
function receiptAt(root,ref){const receipt=json(path.join(root,ref.path));return receipt;}
function planControl(root,result){
 const receipt=receiptAt(root,result.receipt),subject=result.reference,audit=receipt.records.find(r=>json(path.join(root,r.path)).schemaVersion==='3djat.evidence.v1'),ingest=receipt.operation==='template.ingest';
 const plan={expectedHead:receipt.previousHead,changes:ingest?[{kind:'template',id:subject.id,expectedRevision:subject.revision-1,reference:subject}]:[],records:[{kind:'evidence',reference:audit},...(!ingest?[{kind:'template-decision',reference:subject}]:[])]};
 const event=JSON.parse(json(path.join(root,audit.path)).description).event;
 return {operation:receipt.operation,receipt:result.receipt,subject,audit,plan,expectedPayloadHash:digest(encoded(plan)),recordedPayloadHash:receipt.payloadHash,storeHashWithoutLF:digest(Buffer.from(canonical(plan))),commandHash:event.commandHash,canonicalTrailingLF:true};
}
function changedCopy(w,name,result,mutate,source=w.root){
 const root=pristineCopy(w,name,source),before=new DomainStore(root).read(),old=receiptAt(root,result.receipt),receipt=structuredClone(old);mutate(receipt,root);
 const bytes=encoded(receipt);fs.writeFileSync(path.join(root,result.receipt.path),bytes);
 const head=json(path.join(root,'domain-head.json'));assert.equal(head.receipts[0].path,result.receipt.path,'Tamper only a current publication');head.receipts[0].sha256=digest(bytes);
 const hb=encoded(head);fs.writeFileSync(path.join(root,`Heads/${head.workspaceId}/${head.revision}.json`),hb);fs.writeFileSync(path.join(root,'domain-head.json'),hb);
 // Frozen generic closure MUST verify, or this vector never reaches the repair.
 const after=new DomainStore(root).read();assert.equal(after.reference.revision,before.reference.revision);assert.deepEqual(json(path.join(root,result.reference.path)),json(path.join(source,result.reference.path)));
 record(w,{kind:'outer-closure-rebound',root,originalReceipt:result.receipt,alteredReceipt:head.receipts[0],changedFields:Object.keys(receipt).filter(k=>canonical(receipt[k])!==canonical(old[k])),genericClosureVerified:true,head:after.reference,subjectUnchanged:true});
 return {root,head:after.reference,receipt:head.receipts[0]};
}
const zero=r=>{r.payloadHash=r.payloadHash==='0'.repeat(64)?'1'.repeat(64):'0'.repeat(64);};
function observe(fn){try{return {value:fn(),error:null};}catch(e){if(['LOCKED','LOCK_CHANGED','COMMIT_UNCERTAIN','COMMIT_ABORTED'].includes(e.code))fatal={stage:'unexpected-read-error',code:e.code};return {value:null,error:{code:e.code??null,message:e.message}};}}
function semantic(w,c,{mac=true,kind='list',extra={}}={}){return observe(()=>readTemplateRegistry(c.root,{query:{...query(w,kind,extra),atHead:c.head},accessFile:mac?w.accessFile:null}));}
const refusal=o=>assert.equal(o.error?.code,'EVIDENCE_MISMATCH','C1-F01: semantic history must reject altered store plan');
function intentFiles(w){const p=w.accessFile+'.intents';return fs.existsSync(p)?files(p):[];}
function post(app,token,route,value){return new Promise((resolve,reject)=>{
 const b=Buffer.from(JSON.stringify(value),'utf8'),req=request(app.origin+route,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json','content-length':b.length}},res=>{const chunks=[];res.on('data',b=>chunks.push(b));res.on('end',()=>{try{resolve({status:res.statusCode,body:JSON.parse(Buffer.concat(chunks).toString('utf8'))});}catch(e){reject(e);}});});req.on('error',reject);req.end(b);
});}

register('C1-R1 group01 untouched initial/revised ingest plan hashes and exact replay',t=>{
 const w=fixture(t),one=firstIngest(w),two=firstIngest(w,template('creative',{instructions:'Second inert revision'}));const controls=[planControl(w.root,one.result),planControl(w.root,two.result)];record(w,{kind:'untouched-ingest-controls',controls});
 for(const c of controls){assert.equal(c.expectedPayloadHash,c.recordedPayloadHash);assert.notEqual(c.commandHash,c.recordedPayloadHash);assert.notEqual(c.storeHashWithoutLF,c.recordedPayloadHash);}
 const before=files(w.root);assert.deepEqual(good(w.writer.command(w.human.token,one.packet)),one.result);assert.deepEqual(good(w.writer.command(w.human.token,two.packet)),two.result);assert.deepEqual(files(w.root),before);
});
register('C1-R1 group02 older scoped adoptions preserve original store hashes and replay',t=>{
 const w=fixture(t),one=firstIngest(w),d1=firstAdopt(w,one.result.reference),two=firstIngest(w,template('creative',{appliesTo:['artistic']})),d2=firstAdopt(w,two.result.reference,{apps:['artistic']});
 const controls=[planControl(w.root,d1.result),planControl(w.root,d2.result)];record(w,{kind:'untouched-adopt-controls',controls});for(const c of controls)assert.equal(c.expectedPayloadHash,c.recordedPayloadHash);
 const before=files(w.root);for(const d of [d1,d2])assert.deepEqual(good(w.writer.command(w.human.token,d.packet)),d.result);assert.deepEqual(files(w.root),before);
 const scopes=read(w).data.templates[0].applicability;assert.equal(scopes.find(s=>s.applicability==='catalogue').chosen.template.revision,1);assert.equal(scopes.find(s=>s.applicability==='artistic').chosen.template.revision,2);
});
register('C1-R1 group03 ingest payloadHash-only tamper passes frozen closure but semantic read refuses',t=>{
 const w=fixture(t),r=firstIngest(w),original=files(w.root),copy=changedCopy(w,'ingest-payload-copy',r.result,zero),outcome=semantic(w,copy);record(w,{kind:'ingest-payload-refusal',outcome});assert.deepEqual(files(w.root),original);refusal(outcome);
});
register('C1-R1 group04 adoption payloadHash-only tamper with genuine retained MAC refuses discovery',t=>{
 const w=fixture(t),r=firstIngest(w),d=firstAdopt(w,r.result.reference),original=files(w.root),copy=changedCopy(w,'adopt-payload-copy',d.result,zero),outcome=semantic(w,copy,{kind:'discovery'});record(w,{kind:'adopt-payload-refusal',outcome});assert.deepEqual(files(w.root),original);refusal(outcome);assert.equal(outcome.value,null);
});
register('C1-R1 group05 exact record order/transitions and command-versus-store hash are distinct',t=>{
 const w=fixture(t),r=firstIngest(w),initial=pristineCopy(w,'valid-ingest-snapshot'),d=firstAdopt(w,r.result.reference),original=files(w.root);
 const variants=[
  {name:'ingest-record-order',result:r.result,source:initial,mutate:s=>s.records.reverse()},
  {name:'adopt-record-order',result:d.result,source:w.root,mutate:s=>s.records.reverse()},
  {name:'ingest-transition',result:r.result,source:initial,mutate:s=>s.transitions[0].id='other'},
  {name:'command-is-not-plan',result:r.result,source:initial,mutate:(s,root)=>s.payloadHash=planControl(root,r.result).commandHash}
 ];const outcomes=[];for(const v of variants){const c=changedCopy(w,v.name,v.result,v.mutate,v.source),outcome=semantic(w,c);outcomes.push(outcome);record(w,{kind:'ordered-plan-variant',variant:v.name,outcome});}
 assert.deepEqual(files(w.root),original);for(const o of outcomes)refusal(o);
});
register('C1-R1 group06 tampered ingest/adopt replay refuses with no new head/intents; originals replay exactly',t=>{
 const w=fixture(t),r=firstIngest(w),initial=pristineCopy(w,'valid-before-adopt'),d=firstAdopt(w,r.result.reference),original=files(w.root),outcomes=[];
 for(const [name,x,source] of [['ingest',r,initial],['adopt',d,w.root]]){
  const c=changedCopy(w,name+'-replay-copy',x.result,zero,source),before=files(c.root),intents=intentFiles(w),writer=new DomainTemplates(c.root,{accessFile:w.accessFile,hook:unplanned}),result=writer.command(w.human.token,x.packet);outcomes.push(result);record(w,{kind:'tampered-replay',variant:name,result,alteredReceipt:c.receipt,originalSuccess:x.result});assert.deepEqual(files(c.root),before);assert.deepEqual(intentFiles(w),intents);
 }
 assert.deepEqual(good(w.writer.command(w.human.token,r.packet)),r.result);assert.deepEqual(good(w.writer.command(w.human.token,d.packet)),d.result);assert.deepEqual(files(w.root),original);
 for(const r of outcomes){denied(r,'EVIDENCE_MISMATCH');assert.equal(r.error.evidence,null);}
});
register('C1-R1 group07 actual native HTTP query/replay and operationalEvidence refuse before acknowledgement',async t=>{
 const w=fixture(t,{kernel:true,reserve:768*1024});policy(w,'bve-human');const p=packet(w,'template.ingest',template()),r=good(w.k.templateCommand(w.c.human,p)),ap=adoption(w,r.reference,{principalId:'bve-human'}),ar=good(w.k.templateCommand(w.c.human,ap));w.k.close();
 const original=files(w.root),copy=changedCopy(w,'native-invalid-business',ar,zero),intents=intentFiles(w),domainBefore=files(copy.root),runtime=path.join(w.dir,'invalid-copy-runtime'),config={...w.config,domainRoot:copy.root,runtimeRoot:runtime,paths:Object.fromEntries(Object.entries(w.store.workspace.paths).map(([k,v])=>[k,path.join(copy.root,v)]))};
 const app=await serve({root:runtime,port:0,workspace:config,expectedHead:copy.head,products:{accessFile:w.accessFile},templates:{accessFile:w.accessFile}});w.k=app.kernel;const credentials=json(path.join(runtime,'credentials.json'));
 let q,replay,evidence;try{
  q=await post(app,credentials.human,'/api/template-review',{...query(w),atHead:copy.head});replay=await post(app,credentials.human,'/api/template',ap);evidence=observe(()=>new DomainTemplates(copy.root,{accessFile:w.accessFile,hook:unplanned}).operationalEvidence());
  const events=app.kernel.read(credentials.human,'event').filter(e=>e.type==='template-action');record(w,{kind:'real-native-http-refusal',query:q,replay,operationalEvidence:evidence,copiedTemplateEvents:events.length});
  assert.deepEqual(files(copy.root),domainBefore);assert.deepEqual(intentFiles(w),intents);assert.deepEqual(files(w.root),original);
  assert.equal(q.status,409,'C1-F01: real authenticated query accepted altered store plan');assert.equal(q.body.error,'EVIDENCE_MISMATCH');assert.equal(replay.status,409);denied(replay.body,'EVIDENCE_MISMATCH');assert.equal(replay.body.error.evidence,null);refusal(evidence);assert.equal(events.length,0);
 }finally{await app.stop();}
});
register('C1-R1 group08 hash-only structural refusal, wrong MAC and four clarifications/current grant remain',t=>{
 const w=fixture(t),r=firstIngest(w),d=firstAdopt(w,r.result.reference),copy=changedCopy(w,'hash-only-invalid-copy',d.result,zero),hashOnly=semantic(w,copy,{mac:false});record(w,{kind:'hash-only-integrity-refusal',outcome:hashOnly});
 const wrong=path.join(w.dir,'wrong-retained-context.json'),a=json(w.accessFile);a.key=(a.key[0]==='0'?'1':'0')+a.key.slice(1);fs.writeFileSync(wrong,JSON.stringify(a),{encoding:'utf8',mode:0o600});const wrongMAC=observe(()=>readTemplateRegistry(w.root,{query:query(w),accessFile:wrong}));record(w,{kind:'supplied-wrong-MAC',outcome:wrongMAC});
 // Fixed valid control bundle preserves the four previously binding semantics.
 firstIngest(w,template('creative',{appliesTo:['artistic']}));for(const id of ['brand-a','brand-b']){const b=firstIngest(w,template(id));firstAdopt(w,b.result.reference);}
 const scopes=read(w).data.templates.find(x=>x.templateId==='creative').applicability;assert.deepEqual(scopes.map(x=>x.applicability),['artistic','catalogue']);assert(scopes.every(x=>x.chosen.template.revision===1));
 const b=read(w,'discovery',{branded:true,brandTemplateId:'brand-b'});assert.equal(b.data.brand.template.id,'brand-b');assert.throws(()=>read(w,'discovery',{branded:true,brandTemplateId:'ungranted'}),e=>e.code==='INVALID_SCOPE');
 const latest=w.store.read().head.templates.find(x=>x.id==='creative'),before=files(w.root),kind=packet(w,'template.ingest',template('creative',{kind:'brand',outputs:[],revision:3,supersedes:latest}),2);denied(w.writer.command(w.human.token,kind),'INVALID_VALUE');assert.deepEqual(files(w.root),before);
 const validHashOnly=readTemplateRegistry(w.root,{query:query(w),accessFile:null});assert(validHashOnly.data.templates.every(h=>h.applicability.every(s=>!s.selectable&&s.blockers.includes('CAPABILITY_UNAVAILABLE'))));
 const currentGrant=json(w.accessFile).principals.find(p=>p.id===w.human.principalId).templateGrant;record(w,{kind:'clarifications-preserved',brandTemplateId:b.data.brandTemplateId,scopes:scopes.map(s=>s.applicability),hashOnlySelectable:false,currentGrant});
 refusal(hashOnly);refusal(wrongMAC);
});
