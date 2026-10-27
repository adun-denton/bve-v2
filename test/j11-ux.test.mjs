import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import {webcrypto} from 'node:crypto';import {Element} from './fixtures/3djat/j09-client.mjs';
function harness({kind='generative',count=3,scope='artistic',blocker=null}={}){
 const els=new Map(),get=id=>{if(!els.has(id))els.set(id,new Element());return els.get(id)},calls=[];
 const operation={title:'Creative',inputs:[{role:'scene'}],outputs:[{role:'candidate'}],launch:{executionKind:kind},exploration:{parameters:{contrast:{type:'number',min:0,max:1}}}};
 const variants=Array.from({length:count},(_,n)=>({record:{...operation,title:'Treatment '+n,appliesTo:['instagram-artistic'],instructions:'Contrast '+n},reference:{id:'creative',revision:n+1,sha256:String(n).repeat(64)},sources:[{status:'verified'}]}));
 const preparation={operation:{record:operation}},ctx=vm.createContext({document:{getElementById:get,createElement:t=>new Element(t),querySelectorAll:()=>[]},window:{addEventListener(){}},localStorage:{},URLSearchParams,structuredClone,crypto:webcrypto,Option:class extends Element{constructor(t,v){super('option');this.textContent=t;this.value=v}},fetch:async(url,options={})=>{calls.push({url,body:options.body&&JSON.parse(options.body)});return {ok:true,json:async()=>url.startsWith('/api/operation-discovery')?{brands:[],operations:[{templateId:'creative',chosen:{template:{id:'creative',revision:1}},blockers:[],status:{}}],productBlockers:[]}:url.startsWith('/api/operation-preparation')?preparation:{preparation,variants}}}});
 vm.runInContext(fs.readFileSync(new URL('../public/products.js',import.meta.url),'utf8').replace(/start\(\)\.catch\(e=>say\('Products unavailable: '\+e\.message\)\);/,''),ctx);
 vm.runInContext("state.productId='p';state.preparation={productId:'p',artifact:{artifactId:'photo'}}",ctx);ctx.blocker=blocker;vm.runInContext('state.preparation.sourceBlocker=blocker',ctx);get('applicability').value=scope;
 return {get,calls,run:s=>vm.runInContext(s,ctx),ctx,variants,preparation};
}
const button=(root,name)=>root.querySelectorAll('button').find(b=>b.textContent===name);
test('J11 UX visible treatment labels and optional seed; eligible action uses read-only preparation',async()=>{
 const h=harness();await h.run('discover()');const card=h.get('operation-list').querySelector('article');assert.ok(button(card,'Prepare this operation'));await button(card,'Test template').onclick();
 const controls=card.querySelectorAll('select,input,textarea');for(const name of ['Variant A','Variant B','Variant C','Common instructions','Common seed']){const c=controls.find(c=>c.attributes['aria-label']===name);assert.ok(c);assert.equal(c.parent.tagName,'label');assert.equal(c.parent.text,name);}
 assert.equal(controls.find(c=>c.attributes['aria-label']==='Common seed').parent.parent.tagName,'details');
 assert.doesNotMatch(card.textContent,/unproved|Authored protocol|configured Conductor/);assert.ok(controls[0].options.every(o=>o.textContent.includes('/ revision ')));
 assert.ok(h.calls.filter(c=>c.body).every(c=>c.body.action==='prepare'));
});
test('J11 UX conventional and wrong-scope operations retain normal preparation without a comparison action',async()=>{
 for(const options of [{kind:'deterministic'},{scope:'website'}]){const h=harness(options);await h.run('discover()');assert.ok(button(h.get('operation-list'),'Prepare this operation'));assert.equal(button(h.get('operation-list'),'Test template'),undefined);assert.equal(h.calls.filter(c=>c.body).length,0);}
});
test('J11 UX missing treatments or photo give useful explanations without a comparison action',async()=>{
 for(const options of [{count:2},{blocker:'SOURCE_UNAVAILABLE'}]){const h=harness(options);await h.run('discover()');assert.equal(button(h.get('operation-list'),'Test template'),undefined);assert.match(h.get('operation-list').textContent,/needs (three compatible Instagram artistic treatments|an available photo)/);assert.ok(button(h.get('operation-list'),'Prepare this operation'));}
});
test('J11 UX comparison status separates next action from optional stored evidence',()=>{
 const h=harness();h.ctx.e={statuses:{human:'not requested'},reviews:[],result:null};assert.match(h.run('comparisonStatus(e)'),/Waiting for comparison/);
 h.ctx.e.result={record:{variants:[{outcome:'completed'},{outcome:'completed'},{outcome:'completed'}]}};assert.match(h.run('comparisonStatus(e)'),/Ready to compare/);h.ctx.e.reviews=[{}];assert.match(h.run('comparisonStatus(e)'),/Reviewed/);h.ctx.e.statuses.human='adopted for Instagram artistic';assert.equal(h.run('comparisonStatus(e)'),'Selected for Instagram artistic');
 h.ctx.e.statuses.human='awaiting approval';h.ctx.e.result.record.variants=[{outcome:'failed'}];assert.match(h.run('comparisonStatus(e)'),/unavailable/);
});
