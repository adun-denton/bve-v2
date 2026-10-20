// Four focused R1 scenario groups; real inert Kernel/HTTP/standalone paths, no cleanup.
import test from 'node:test';import assert from 'node:assert/strict';import * as fs from 'node:fs';import * as path from 'node:path';import{request}from'node:http';
import{serve}from'../src/server.mjs';
import{setup,packet,proposal,decision,entry,field,send,ok,fail,read,policy,changePolicy,PRODUCT}from'./fixtures/3djat/dossier-fixture.mjs';
import{UNICODE_TEXT,UNICODE_POINTS,UNICODE_UTF8,assertUnicode}from'./fixtures/3djat/dossier-unicode.mjs';
const OTHER='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const observations=[];
function note(w,data){observations.push({root:w.dir,...data});if(process.env.DOSSIER_R1_OBSERVATIONS){const file=process.env.DOSSIER_R1_OBSERVATIONS;fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(observations,null,2)+'\n');}}
function sourceFree(w,kind='field'){const p=kind==='field'?field(w):entry(w);if(kind==='field')p.fact.sourceRefs=[];else p.sourceRefs=[];return proposal(w,p,{origin:'human-authored'});}
async function start(w){w.k?.close();const app=await serve({root:w.runtime,port:0,products:{accessFile:w.accessFile}});w.k=app.kernel;return app;}
async function post(app,token,p,{raw=Buffer.from(JSON.stringify(p)),cuts=[],route='/api/product'}={}){return new Promise((yes,no)=>{const req=request(app.origin+route,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json','content-length':raw.length}},res=>{const parts=[];res.on('data',b=>parts.push(b));res.on('end',()=>{try{yes({status:res.statusCode,body:JSON.parse(Buffer.concat(parts))});}catch(e){no(e);}});});req.on('error',no);(async()=>{let at=0;for(const end of cuts){req.write(raw.subarray(at,end));at=end;await new Promise(r=>setTimeout(r,20));}req.end(raw.subarray(at));})().catch(no);});}
const head=w=>w.store.read().reference;
function refused(w,before,result){assert.equal(result.schemaVersion,'3djat.failure.v1');assert.equal(result.error.code,'INVALID_SCOPE',JSON.stringify(result));assert.deepEqual(head(w),before);}

test('R1-01 source-free actual human fields/entries retain authority under absent empty foreign extraction policy and replay',async t=>{
 const outcomes=[];
 for(const variant of ['absent','empty','foreign']){const w=setup(t,{kernel:true});w.k.close();if(variant!=='absent')policy(w,'bve-human','human',variant==='empty'?[]:[OTHER],[]);const app=await start(w);try{
  for(const kind of ['field','entry']){const p=sourceFree(w,kind),before=head(w),r=await post(app,w.c.human,p);note(w,{group:'R1-01',variant,kind,packet:p,result:r,before,after:head(w)});outcomes.push({variant,kind,result:r.body.schemaVersion});
   if(r.body.error?.code==='EXPORT_PENDING')assert.fail('Unexpected routine publication; stop dependent run: '+JSON.stringify(r));
   if(r.body.schemaVersion==='3djat.result.v1'){ok(r.body);assert.notDeepEqual(head(w),before);assert.deepEqual(await post(app,w.c.human,p),r);const audit=w.writer.operationalEvidence().find(e=>e.key===p.key);assert.equal(audit.principalId,'bve-human');assert.equal(audit.operation,p.operation);}
   else refused(w,before,r.body);
  }
 }finally{await app.stop();}}
 assert(outcomes.every(x=>x.result==='3djat.result.v1'),JSON.stringify(outcomes));
 // A legitimate source-free receipt remains replayable after unrelated extraction revocation.
 const w=setup(t,{kernel:true}),p=sourceFree(w);const first=ok(w.k.productCommand(w.c.human,p));w.k.close();policy(w,'bve-human','human',[OTHER],[]);const app=await start(w);try{const before=head(w),r=await post(app,w.c.human,p);assert.deepEqual(r.body,first);assert.deepEqual(head(w),before);note(w,{group:'R1-01',variant:'source-free-replay-after-extraction-policy-change',result:r});}finally{await app.stop();}
});
test('R1-02 source-bearing extraction and sourced human authoring require absent foreign revoked policies on new requests and replay',async t=>{
 for(const variant of ['absent','foreign','revoked']){const w=setup(t,{kernel:true});w.k.close();if(variant==='foreign')policy(w,'bve-human','human',[OTHER],['inert-source']);if(variant==='revoked')policy(w,'bve-human','human',[PRODUCT],[]);const app=await start(w);try{for(const origin of ['source-extract','human-authored']){const p=proposal(w,field(w),{origin}),before=head(w),r=await post(app,w.c.human,p);refused(w,before,r.body);note(w,{group:'R1-02',variant,origin,result:r,before,after:head(w)});}}finally{await app.stop();}}
 const w=setup(t,{kernel:true});w.k.close();policy(w);let app=await start(w);const packets=[];try{for(const origin of ['source-extract','human-authored']){const p=proposal(w,field(w),{origin}),r=await post(app,w.c.human,p);ok(r.body);packets.push(p);}}finally{await app.stop();}
 changePolicy(w,'bve-human',p=>p.sourceIds=[]);app=await start(w);try{for(const p of packets){const before=head(w),r=await post(app,w.c.human,p);refused(w,before,r.body);note(w,{group:'R1-02',variant:'committed-replay-source-policy-revoked',origin:p.input.origin,result:r});}}finally{await app.stop();}
});
test('R1-03 standalone native scope/revocation and real bound caller scope/roles remain authoritative',async t=>{
 const w=setup(t);changePolicy(w,w.human.principalId,p=>{p.products=[OTHER];p.sourceIds=[];});let p=sourceFree(w),before=head(w);refused(w,before,w.writer.command(w.human.token,p));
 changePolicy(w,w.human.principalId,p=>p.products=[PRODUCT]);p=sourceFree(w);const r=send(w,p);assert.deepEqual(w.writer.command(w.human.token,p),r);
 changePolicy(w,w.human.principalId,p=>p.products=[]);before=head(w);refused(w,before,w.writer.command(w.human.token,p));refused(w,before,w.writer.command(w.human.token,sourceFree(w)));
 changePolicy(w,w.human.principalId,p=>p.products=[PRODUCT]);for(const origin of ['source-extract','human-authored'])refused(w,head(w),w.writer.command(w.human.token,proposal(w,field(w),{origin})));
 for(const who of [w.source,w.conductor]){before=head(w);refused(w,before,w.writer.command(who.token,sourceFree(w,'entry')));refused(w,before,w.writer.command(who.token,decision(w,r.reference)));}
 note(w,{group:'R1-03',variant:'standalone-native-policy-controls',after:head(w)});
 const z=setup(t,{kernel:true});ok(z.k.productCommand(z.c.human,packet(z,'product.create',{productId:OTHER,productCode:null,workingName:'Inert other product'})));const actor=z.k.bindSession(z.c,{role:'conductor',tier:'SOL',projectId:OTHER,sessionId:'inert-r1-other',nonce:'inert',hostReceipt:'Authored only; not native'});z.k.close();policy(z,'bve-session-'+actor.id,'conductor',[PRODUCT],['inert-source']);const app=await start(z);try{for(const p of [proposal(z),sourceFree(z)]){const before=head(z),r=await post(app,actor.token,p);refused(z,before,r.body);note(z,{group:'R1-03',variant:'real-session-native-other-product',result:r});}}finally{await app.stop();}
});
test('R1-04 independently intended Unicode code points/UTF8 bytes survive observed HTTP multibyte splits and exact files/readback',async t=>{
 assertUnicode(UNICODE_TEXT);const w=setup(t,{kernel:true}),app=await start(w),incoming=[];app.server.prependListener('request',req=>{const chunks=[];incoming.push(chunks);req.on('data',b=>chunks.push(Buffer.from(b)));});
 try{for(const kind of ['field','entry']){const p=sourceFree(w,kind);if(kind==='field')p.input.payload.fact.value=UNICODE_TEXT;else p.input.payload.text=UNICODE_TEXT;const raw=Buffer.from(JSON.stringify(p)),start=raw.indexOf(UNICODE_UTF8);assert(start>=0);const spans=[{bytes:[0xc2,0xa2],inner:[1]},{bytes:[0xe2,0x82,0xac],inner:[1,2]},{bytes:[0xf0,0x9f,0xa7,0xaa],inner:[1,2,3]}],cuts=spans.flatMap(s=>{const at=raw.indexOf(Buffer.from(s.bytes),start);assert(at>=start);return s.inner.map(n=>at+n);}).sort((a,b)=>a-b),index=incoming.length;
  const r=await post(app,w.c.human,p,{raw,cuts});ok(r.body);const chunks=incoming[index],observed=[];let end=0;for(const b of chunks){end+=b.length;observed.push(end);}assert.deepEqual(Buffer.concat(chunks),raw);for(const cut of cuts)assert(observed.includes(cut),'Actual server req data boundary was not observed at '+cut);
  const bytes=fs.readFileSync(path.join(w.root,r.body.reference.path)),stored=JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(bytes)),value=kind==='field'?stored.payload.fact.value:stored.payload.text;assertUnicode(value);assert(bytes.includes(UNICODE_UTF8));const query={productId:PRODUCT,atHead:head(w)},review=await post(app,w.c.human,query,{route:'/api/product-review'});assert.equal(review.status,200);const item=review.body.dossierExtension.proposals.find(x=>x.reference.id===r.body.reference.id);assertUnicode(kind==='field'?item.record.payload.fact.value:item.record.payload.text);
  note(w,{group:'R1-04',kind,expectedCodePoints:UNICODE_POINTS,expectedUTF8Hex:UNICODE_UTF8.toString('hex'),fileCodePoints:Array.from(value,c=>c.codePointAt(0)),fileUTF8Hex:Buffer.from(value).toString('hex'),fileReference:r.body.reference,plannedClientCuts:cuts,actualServerChunkEndOffsets:observed,allPlannedCutsActuallyObserved:true,receivedBodyEqualsSentBytes:true});
 }}finally{await app.stop();}
});
