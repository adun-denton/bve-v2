import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {inspectPillow} from '../src/executors/pillow.mjs';
import {setup,makePacket,ui,P} from './fixtures/3djat/j09-fixture.mjs';
import {client} from './fixtures/3djat/j09-client.mjs';
const tool=await inspectPillow(process.env.BVE_PYTHON);
const packetFor=(w,kind)=>{
 if(kind==='request')return makePacket(w,'creative-composition',{outputs:[{role:'candidate',count:1}],selection:{preserveproduct:true,exploration:'balanced',contrast:0.5},intent:'Keep my exact pistachio direction.'});
 const a=w.originals[0].artifact,input={schemaVersion:'3djat.candidate-decision.v1',decisionId:randomUUID(),productId:P,artifact:a,action:'retain',purpose:'Candidate review',channel:null,reason:'Keep my exact review wording.',decidedAt:new Date().toISOString(),humanActionReceipt:{id:'placeholder',revision:1,path:'placeholder.json',sha256:'0'.repeat(64)},supersedesDecision:null};
 const packet={schemaVersion:'3djat.command.v1',operation:'candidate.decide',key:randomUUID(),expected:{domainHead:w.store.read().reference,entityRevision:0},input};input.humanActionReceipt=ui(w,'/api/candidate-action-reference',packet);return packet;
};
const pathFor=kind=>kind==='request'?'/api/operation-request':'/api/candidate-decision';
const record=(h,packet)=>JSON.parse(h.storage.get('3djat:j09:'+packet.key));
const button=(h,text)=>h.get('operation-pending').querySelectorAll('button').find(b=>b.textContent===text);
const changeHead=w=>w.success(w.k.productCommand(w.c.human,{schemaVersion:'3djat.command.v1',operation:'product.create',key:randomUUID(),expected:{domainHead:w.store.read().reference,entityRevision:0},input:{productId:randomUUID(),productCode:null,workingName:'Authored intervening product'}}));
for(const kind of ['request','decision'])test('J09-F01 '+kind+' exact stale rejection preserves intent, requires current review/acknowledgment and allows a fresh action',async t=>{
 const w=setup(t,tool),packet=packetFor(w,kind),original=JSON.stringify(packet),path=pathFor(kind);let lost=true;
 const h=client(w,{respond:async url=>{if(url===path&&lost){lost=false;throw Error('Authored transport loss before server delivery');}}});h.context.packet=packet;h.context.path=path;
 await assert.rejects(h.run('sendJ09(path,packet,"Original action")'));
 assert.equal(record(h,packet).status,'uncertain');changeHead(w);
 await button(h,'Reconcile this exact action').onclick();
 assert.equal(record(h,packet).status,'rejected');assert.equal(h.run('j09Pending(x=>true)'),false);
 assert.equal(JSON.stringify(record(h,packet).packet),original);
 assert.deepEqual(record(h,packet).rejection,{error:'REVISION_CONFLICT',noEffect:true});
 assert.equal(h.run('j09Blocked(x=>true)'),true,'Fresh action requires review and acknowledgment');
 assert.equal(w.k.read(w.c.human,'request').length,0);
 await button(h,'Read current state').onclick();
 assert.equal(h.run('j09Blocked(x=>true)'),true);
 await button(h,'Acknowledge reviewed rejection').onclick();
 assert.equal(record(h,packet).status,'acknowledged');assert.equal(h.run('j09Blocked(x=>true)'),false);
 assert.equal(JSON.stringify(record(h,packet).packet),original);
 const fresh=packetFor(w,kind);if(kind==='request')fresh.input.intent=packet.input.intent;else {fresh.input.reason=packet.input.reason;fresh.input.humanActionReceipt=ui(w,'/api/candidate-action-reference',fresh);}
 h.context.fresh=fresh;await h.run('sendJ09(path,fresh,"Fresh explicit action")');
 assert.notEqual(fresh.key,packet.key);assert.equal(record(h,fresh).status,'confirmed');assert.equal(record(h,packet).status,'acknowledged');
 assert.equal(w.k.read(w.c.human,'request').length,kind==='request'?1:0);assert.equal(w.k.read(w.c.human,'job').length,0);
 if(kind==='decision')assert.equal(ui(w,'/api/content-review',{productId:P}).entries.find(e=>e.artifact.id===packet.input.artifact.artifactId).history.length,1);
});
for(const kind of ['request','decision'])test('J09 '+kind+' lost acknowledgment after commit replays the exact receipt once',async t=>{
 const w=setup(t,tool),packet=packetFor(w,kind),path=pathFor(kind);let lost=true;
 const h=client(w,{respond:async(url,options)=>{if(url===path&&lost){lost=false;ui(w,path,JSON.parse(options.body));throw Error('Authored lost response after actual commit');}}});h.context.packet=packet;h.context.path=path;
 await assert.rejects(h.run('sendJ09(path,packet,"Committed action")'));assert.equal(record(h,packet).status,'uncertain');
 const expected=ui(w,path,packet);await button(h,'Reconcile this exact action').onclick();
 assert.equal(record(h,packet).status,'confirmed');assert.deepEqual(record(h,packet).result,expected);
 assert.deepEqual(ui(w,path,packet),expected);assert.equal(w.k.read(w.c.human,'request').length,kind==='request'?1:0);
 if(kind==='decision')assert.equal(ui(w,'/api/content-review',{productId:P}).entries.find(e=>e.artifact.id===packet.input.artifact.artifactId).history.length,1);
});
test('J09 unknown failure, unproved no-effect and genuine transport uncertainty retain the exact command',async t=>{
 const w=setup(t,tool);
 for(const response of [{error:'REVISION_CONFLICT'},{error:'INTERNAL_UNKNOWN',noEffect:true},{error:'COMMIT_UNCERTAIN',noEffect:true},null]){
  const packet=packetFor(w,'request'),h=client(w,{respond:async url=>{if(url==='/api/operation-request'){if(!response)throw Error('Authored connection failure');return {ok:false,json:async()=>response};}}});h.context.packet=packet;
  await assert.rejects(h.run('sendJ09("/api/operation-request",packet,"Uncertain action")'));
  await button(h,'Reconcile this exact action').onclick();
  assert.equal(record(h,packet).status,'uncertain');assert.equal(JSON.stringify(record(h,packet).packet),JSON.stringify(packet));assert.equal(h.run('j09Pending(x=>true)'),true);
  assert.equal(button(h,'Read current state'),undefined);assert.equal(w.k.read(w.c.human,'request').length,0);
 }
});
test('J09 rejected review becomes stale before acknowledgment; original rejection and settings remain intact',async t=>{
 const w=setup(t,tool),packet=packetFor(w,'request');changeHead(w);const h=client(w);h.context.packet=packet;
 await assert.rejects(h.run('sendJ09("/api/operation-request",packet,"Original request")'));
 assert.equal(record(h,packet).status,'rejected');await button(h,'Read current state').onclick();const proof=record(h,packet).rejection;
 changeHead(w);await button(h,'Acknowledge reviewed rejection').onclick();
 assert.equal(record(h,packet).status,'rejected');assert.equal(record(h,packet).reviewStale,true);assert.deepEqual(record(h,packet).rejection,proof);assert.equal(h.run('j09Blocked(x=>true)'),true);
 await button(h,'Read current state').onclick();await button(h,'Acknowledge reviewed rejection').onclick();assert.equal(record(h,packet).status,'acknowledged');
 const changed={...packet,input:{...packet.input,intent:'Different words with old key'}};h.context.changed=changed;
 await assert.rejects(h.run('sendJ09("/api/operation-request",changed,"Changed packet")'),/different packet/);
 assert.deepEqual(record(h,packet).packet,packet);assert.equal(w.k.read(w.c.human,'request').length,0);
});
for(const kind of ['request','decision'])test('J09 '+kind+' committed receipt plus later revoked read authority never claims original no effect',async t=>{
 const w=setup(t,tool),packet=packetFor(w,kind),path=pathFor(kind);let once=true;
 const h=client(w,{respond:async(url,options)=>{if(url===path&&once){once=false;ui(w,path,JSON.parse(options.body));throw Error('Authored lost committed receipt');}}});h.context.packet=packet;h.context.path=path;
 await assert.rejects(h.run('sendJ09(path,packet,"Committed action")'));
 const fs=await import('node:fs'),original=fs.readFileSync(w.accessFile),registry=JSON.parse(original);registry.principals.find(p=>p.id==='bve-human').products=[];fs.writeFileSync(w.accessFile,JSON.stringify(registry));
 await button(h,'Reconcile this exact action').onclick();assert.equal(record(h,packet).status,'uncertain');assert.equal(h.run('j09Pending(x=>true)'),true);assert.equal(record(h,packet).rejection,undefined);
 fs.writeFileSync(w.accessFile,original);await button(h,'Reconcile this exact action').onclick();assert.equal(record(h,packet).status,'confirmed');assert.equal(w.k.read(w.c.human,'request').length,kind==='request'?1:0);
});
