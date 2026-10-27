import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {setup11,input11,action,P} from './fixtures/3djat/j11-fixture.mjs';import {client} from './fixtures/3djat/j09-client.mjs';
test('J11 UI retains exact uncertain create, prevents a fresh duplicate, and reconciles one receipt',{timeout:180000},async t=>{
 const w=setup11(t),input=input11(w);let lose=true;
 const h=client(w,{respond:async(url,options)=>{if(url==='/api/calibration'&&JSON.parse(options.body).action==='create'&&lose){lose=false;const p=JSON.parse(options.body);action(w,p.action,p.input,w.c.human,p.key);throw Error('Authored lost acknowledgement after SQLite commit');}}});h.context.input=input;
 await assert.rejects(h.run('calSend("create",input)'));
 const row=JSON.parse([...h.storage.values()].find(x=>JSON.parse(x).packet?.action==='create'));assert.equal(row.status,'unconfirmed');
 await assert.rejects(h.run('calSend("create",input)'),/original comparison action/);assert.equal(action(w,'view',{productId:P}).experiments.length,1);
 h.context.key=row.packet.key;await h.run('calSend("create",input,key)');assert.equal(action(w,'view',{productId:P}).experiments.length,1);assert.equal(JSON.parse(h.storage.get('3djat:calibration:'+row.packet.key)).status,'confirmed');
});
test('J11 UI definite CAS rejection requires a current reread and explicit acknowledgement',{timeout:180000},async t=>{
 const w=setup11(t),h=client(w),input=input11(w);input.preparation.atHead={...input.preparation.atHead,sha256:'0'.repeat(64)};h.context.input=input;
 await assert.rejects(h.run('calSend("create",input)'));const row=JSON.parse([...h.storage.values()].find(x=>JSON.parse(x).packet?.action==='create'));assert.equal(row.status,'rejected');
 await assert.rejects(h.run('calSend("create",input)'),/original comparison action/);await h.run('renderCalibration()');const ack=h.get('calibration-list').querySelectorAll('button').find(b=>b.textContent==='Reread and acknowledge comparison rejection');assert.ok(ack);await ack.onclick();assert.equal(JSON.parse(h.storage.get('3djat:calibration:'+row.packet.key)).status,'acknowledged');assert.equal(action(w,'view',{productId:P}).experiments.length,0);
});
test('J11 comparison reads ignore a late old-product response',{timeout:180000},async t=>{
 const w=setup11(t);let finish;const h=client(w,{respond:async(url,options)=>url.startsWith('/api/calibration?')?new Promise(r=>finish=r):undefined});
 const pending=h.run('renderCalibration()');h.run('clearProductContext();state.viewEpoch++;state.productId="other";');finish({ok:true,json:async()=>({experiments:[]})});await pending;assert.equal(h.get('calibration-list').textContent,'');
});
