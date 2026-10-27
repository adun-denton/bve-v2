import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';

const script=fs.readFileSync(new URL('../public/products.js',import.meta.url),'utf8')
  .replace(/start\(\)\.catch\(e=>say\('Products unavailable: '\+e\.message\)\);\s*$/,
    '/* Bootstrap is exercised separately by the authored browser journey. */');
assert.ok(!script.includes('start().catch('),'Only bootstrap may be suppressed in this client harness');

class Element{
  constructor(tag='div'){this.tagName=tag.toLowerCase();this.children=[];this.text='';this.value='';this.hidden=false;this.disabled=false;this.className='';this.attributes={};}
  set textContent(value){this.text=String(value);this.children=[];}
  get textContent(){return this.text+this.children.map(x=>x.textContent??'').join('');}
  get childElementCount(){return this.children.length;}
  append(...children){this.children.push(...children);}
  replaceChildren(...children){this.text='';this.children=children;}
  remove(){this.parent?.children.splice(this.parent.children.indexOf(this),1);}
  setAttribute(k,v){this.attributes[k]=v;}
  removeAttribute(k){delete this.attributes[k];delete this[k];}
  focus(){}
  querySelectorAll(selector){const selectors=selector.split(',').map(x=>x.trim()),found=[];
    const walk=parent=>{for(const child of parent.children){if(!(child instanceof Element))continue;
      if(selectors.some(s=>s.startsWith('.')?child.className.split(' ').includes(s.slice(1)):child.tagName===s))found.push(child);
      child.parent=parent;walk(child);}};walk(this);return found;}
  querySelector(s){return this.querySelectorAll(s)[0]??null;}
}
function harness(respond=async()=>({ok:true,json:async()=>({})})){
  const els=new Map(),storage=new Map(),calls=[];
  const get=id=>{if(!els.has(id))els.set(id,new Element());return els.get(id);};
  const localStorage={getItem:k=>storage.get(k)??null,setItem(k,v){storage.set(k,String(v));this[k]=String(v);},
    removeItem(k){storage.delete(k);delete this[k];},key:i=>[...storage.keys()][i],get length(){return storage.size}};
  const context=vm.createContext({document:{getElementById:get,createElement:tag=>new Element(tag),querySelectorAll:()=>[]},
    window:{addEventListener(){}},localStorage,location:{hash:'#product=A&tab=information'},crypto:webcrypto,
    URL,URLSearchParams,Option:class extends Element{constructor(text,value){super('option');this.textContent=text;this.value=value;}},
    Blob,atob,structuredClone,console,fetch:async(url,options)=>{calls.push({url:String(url),options});return respond(String(url),options);}});
  vm.runInContext(script,context,{filename:'public/products.js'});
  return {context,get,storage,calls,run:source=>vm.runInContext(source,context)};
}
const ok=value=>({ok:true,json:async()=>value});
const fail=value=>({ok:false,json:async()=>value});
const ref={id:'ref',revision:1,path:'refs/ref.json',sha256:'a'.repeat(64)};
const unknown=()=>({state:'unknown',value:null,sourceRefs:[],decision:null});
const review={head:ref,product:{record:{revision:1,workingName:'Current A',productCode:null,
  facts:{material:unknown(),dimensions:unknown(),sellingPrice:unknown()},notes:[]}},
  proposals:[],decisions:[],attachments:[],dossierExtension:{fields:{description:unknown(),modelingSoftware:unknown(),productionCost:unknown()},proposals:[],decisions:[],records:[]}};
const index={head:ref,products:[{productId:'A',workingName:'Current A'},{productId:'B',workingName:'B'}]};

test('J06 failed switch isolates A and disables stale board and decisions',async()=>{
  const h=harness(url=>url==='/api/products'?ok(index):fail({error:'CAPABILITY_UNAVAILABLE'}));
  h.run('state.productId="A";state.review={product:{record:{workingName:"A"}}}');
  h.get('facts').textContent='A private material';h.get('board-link').href='/#project=A&page=board';
  await h.run('openProduct("B","information")');
  assert.equal(h.run('state.review'),null);assert.equal(h.get('facts').textContent,'');
  assert.equal(h.get('information').hidden,true);assert.equal(h.get('board-link').hidden,true);
  assert.equal(h.get('board-link').href,undefined);
  assert.match(h.get('notice').textContent,/unavailable/);
});

test('J06 definite rejection retains key and words; acknowledgement rereads, then a fresh decision is possible',async()=>{
  let reject=true;const h=harness((url,options)=>url==='/api/product'&&reject?
    fail({schemaVersion:'3djat.failure.v1',operation:'product.dossier.proposal.decide',key:'old-key',error:{code:'REVISION_CONFLICT',evidence:null}}):
    url==='/api/products'?ok(index):url==='/api/product-review'?ok(review):ok({}));
  h.run('state.productId="A";state.review='+JSON.stringify(review));
  h.context.command={operation:'product.dossier.proposal.decide',key:'old-key',input:{productId:'A',proposal:{id:'proposal'},outcome:'accepted',reason:'my words'}};
  await assert.rejects(h.run('submitCommand(command,"Original decision")'));
  assert.equal(h.run('pendingFor(x=>x.key==="old-key")'),false);
  const [key,raw]=[...h.storage][0];assert.equal(JSON.parse(raw).status,'rejected');
  assert.equal(JSON.parse(raw).command.input.reason,'my words');
  h.context.item={kind:'dossier',reference:{id:'proposal'}};h.context.button=new Element('button');
  await h.run('decide(item,"accepted",button)');
  assert.equal(h.calls.filter(c=>c.url==='/api/product').length,1,'Fresh decision requires explicit reread and acknowledgement');
  const acknowledge=h.get('pending-actions').querySelectorAll('button').find(b=>b.textContent.includes('acknowledge'));
  assert.ok(acknowledge);reject=false;await acknowledge.onclick();
  assert.equal(JSON.parse(h.storage.get(key)).status,'acknowledged');assert.equal(h.run('state.review.product.record.workingName'),'Current A');
  assert.equal(h.run('pendingFor(x=>x.key==="old-key")'),false);
  assert.equal(h.calls.filter(c=>c.url==='/api/product').length,1,'Reread and acknowledgement must not resend the rejected mutation');
  await h.run('decide(item,"accepted",button)');
  const productCalls=h.calls.filter(c=>c.url==='/api/product');
  assert.equal(productCalls.length,2,'Fresh decision is a separate explicit action');
  assert.notEqual(JSON.parse(productCalls[1].options.body).key,'old-key');
});

test('J06 uncertain transport keeps the exact command and blocks a replacement',async()=>{
  const h=harness(()=>{throw Error('connection closed');});
  h.run('state.productId="A";state.review='+JSON.stringify(review));
  h.context.command={operation:'product.dossier.proposal.decide',key:'uncertain-key',input:{productId:'A',proposal:{id:'proposal'},outcome:'accepted'}};
  await assert.rejects(h.run('submitCommand(command,"Uncertain decision")'));
  assert.equal(h.run('pendingFor(x=>x.key==="uncertain-key")'),true);
  assert.equal(JSON.parse([...h.storage.values()][0]).command.key,'uncertain-key');
  assert.ok(h.get('pending-actions').querySelectorAll('button').some(b=>b.textContent.includes('exact action')));
  h.context.item={kind:'dossier',reference:{id:'proposal'}};h.context.button=new Element('button');
  await h.run('decide(item,"rejected",button)');
  assert.equal(h.calls.length,1,'An uncertain acceptance blocks even a different replacement outcome');
});

test('J06 structured multi-field and cost correction preserves provenance and separate acceptance',async()=>{
  const h=harness(url=>url==='/api/product'?ok({reference:{id:'new',revision:1}}):
    url==='/api/product-review'?ok({...review,proposals:[{reference:ref}]}):ok(index));
  h.run('state.productId="A";state.review='+JSON.stringify(review));
  const source={kind:'file',sourceId:'source',revision:'1',sha256:'b'.repeat(64),location:'Sources/a.txt',locator:{kind:'section',section:'dimensions'},observedAt:'2026-01-01T00:00:00.000Z'};
  const base={kind:'base',reference:ref,record:{schemaVersion:'3djat.proposal.v1',productId:'A',proposalId:'old',expectedRevision:1,
    changes:[{field:'dimensions',fact:{state:'accepted',value:{length:10,width:20,height:30,unit:'cm'},sourceRefs:[source]}},
      {field:'sellingPrice',fact:{state:'accepted',value:{amount:'25.50',currency:'USD',unit:'major',per:'item',effectiveDate:'2026-01-01'},sourceRefs:[source]}}],reason:'Original',corrects:null}};
  h.context.item=base;h.context.card=new Element('article');
  h.context.decisions=[];h.run('decide=async(item,outcome)=>{globalThis.decisions.push({kind:item.kind,outcome})};editProposal(item,card)');
  const form=h.context.card.querySelector('form');assert.ok(form);assert.equal(form.querySelectorAll('fieldset').length,2);
  const fieldsets=form.querySelectorAll('fieldset');fieldsets[0].querySelectorAll('input')[0].value='15';
  fieldsets[1].querySelectorAll('input')[0].value='30.125';
  form.querySelectorAll('textarea').at(-1).value='Corrected measurements and price';
  await form.onsubmit({preventDefault(){}});
  const captured=h.calls.filter(c=>c.url==='/api/product').map(c=>JSON.parse(c.options.body));
  assert.equal(captured.length,1);assert.equal(captured[0].input.changes[0].fact.value.length,15);
  assert.equal(captured[0].input.changes[1].fact.value.amount,'30.125');
  assert.deepEqual(captured[0].input.changes.map(c=>c.fact.sourceRefs[0].sourceId),['source','source']);
  assert.equal(captured[0].input.corrects.id,'ref');assert.deepEqual(JSON.parse(JSON.stringify(h.context.decisions)),[{kind:'base',outcome:'superseded'}]);
  assert.ok(!h.context.decisions.some(x=>x.outcome==='accepted'),'Corrected proposal requires a separate human acceptance');
  const dossier={kind:'dossier',reference:ref,record:{...base.record,origin:'source-extract',replaces:null,
    payload:{kind:'field',field:'productionCost',fact:{state:'accepted',value:{amount:'5',currency:'USD',unit:'major',per:'item',effectiveDate:'2026-01-01'},sourceRefs:[source]}}}};
  h.context.item=dossier;h.context.card=new Element('article');h.run('editProposal(item,card)');
  assert.equal(h.context.card.querySelectorAll('fieldset').length,1);
  assert.ok(h.context.card.textContent.includes('Production cost'));
});

test('J06 retained photo opens read-only preparation with current adopted choice and no operation effects',async()=>{
  const a={projectId:'A',origin:'import',id:'photo',importId:'import',version:1,sha256:'c'.repeat(64),width:1,height:1};
  const h=harness(url=>{
    if(url==='/api/read?kind=artifact')return ok([a]);
    if(url==='/api/read?kind=request')return ok([]);
    if(url.startsWith('/api/content-review?'))return ok({entries:[],approved:[],jobs:[],rounds:[],requests:[]});
    if(url==='/api/import?id=import')return ok({artifact:{id:'photo',sha256:a.sha256},declaration:{payload:{filename:'Original photo.png'}}});
    if(url.startsWith('/api/original?'))return ok({state:'ready',preview:{bytes:'iVBORw0KGgo='}});
    if(url.startsWith('/api/operation-discovery?'))return ok({operations:[{templateId:'make-image',status:'available',chosen:{template:{id:'make-image',revision:3}},blockers:['SOURCE_CHECK']}],
      brands:[],branded:false,productBlockers:['SOURCE_CHECK'],execution:{state:'not-assessed'}});
    throw Error('Unexpected endpoint '+url);
  });
  h.run('state.productId="A";state.review='+JSON.stringify(review));
  h.get('applicability').value='artistic';h.get('branded').checked=false;
  await h.run('renderPhotos()');
  const choose=h.get('photo-list').querySelectorAll('button').find(b=>b.textContent.includes('Use this photo'));
  assert.ok(choose);choose.onclick();await h.run('renderPreparation()');
  assert.match(h.get('preparation-input').textContent,/Original photo.png/);
  assert.match(h.get('preparation-input').querySelector('img').src,/^blob:/,'Preview must obey the server CSP');
  const inspect=h.get('operation-list').querySelectorAll('button').find(b=>b.textContent.includes('Inspect preparation'));
  assert.ok(inspect);inspect.onclick();
  assert.match(h.get('operation-list').textContent,/make-image.*revision 3/);
  assert.match(h.get('operation-list').textContent,/SOURCE_CHECK/);
  assert.ok(h.calls.every(c=>!c.options||c.options.method===undefined||c.options.method==='GET'));
  assert.equal(h.calls.filter(c=>/\/api\/(operation-request|operation-commission|product)/.test(c.url)).length,0);
});


test('J06 exact reconciliation establishes no effect before acknowledgement and a fresh decision',async()=>{
  let unknownOutcome=true;
  const h=harness(url=>{
    if(url==='/api/product'){
      if(unknownOutcome)throw Error('transport interrupted before an outcome');
      return fail({schemaVersion:'3djat.failure.v1',operation:'product.dossier.proposal.decide',key:'unknown-key',error:{code:'REVISION_CONFLICT',evidence:null}});
    }
    return url==='/api/products'?ok(index):ok(review);
  });
  h.context.command={operation:'product.dossier.proposal.decide',key:'unknown-key',input:{productId:'A',proposal:{id:'p'},reason:'Retain these words'}};
  await assert.rejects(h.run('submitCommand(command,"Interrupted decision")'));
  unknownOutcome=false;
  await h.get('pending-actions').querySelectorAll('button').find(b=>b.textContent.includes('exact action')).onclick();
  const retained=JSON.parse([...h.storage.values()][0]);
  assert.equal(retained.status,'rejected','Same-key typed no-effect result must leave the uncertainty queue');
  assert.equal(retained.command.key,'unknown-key');
  assert.equal(retained.command.input.reason,'Retain these words');
  assert.equal(h.run('rejectedFor(x=>x.key==="unknown-key")'),true,'Current reread and acknowledgement still required');
  assert.deepEqual(h.calls.filter(c=>c.url==='/api/product').map(c=>JSON.parse(c.options.body).key),['unknown-key','unknown-key']);
});


test('J06 preparation discovery ignores a late response from an older Brand choice',async()=>{
  const pending=[];const h=harness(url=>new Promise(resolve=>pending.push({url,resolve})));
  h.run('state.productId="A"');h.get('applicability').value='artistic';h.get('branded').checked=false;
  const old=h.run('discover()');h.get('branded').checked=true;h.get('brand-id').value='new-brand';
  const current=h.run('discover()');
  const result=(branded)=>({operations:[],brands:[{templateId:'new-brand',chosen:{template:{revision:1}}}],branded,brand:branded?{template:{id:'new-brand',revision:1}}:null,productBlockers:[]});
  pending[1].resolve(ok(result(true)));await current;
  assert.match(h.get('operation-list').textContent,/Brand: new-brand/);
  pending[0].resolve(ok(result(false)));await old;
  assert.match(h.get('operation-list').textContent,/Brand: new-brand/,'An older discovery must not replace the current selected Brand');
  assert.equal(h.get('operation-list').textContent.includes('Brand: not selected for this preparation'),false,'A late result must not append contradictory old context');
});


test('J06 saved correction can be explicitly linked after a definite rejected supersession',async()=>{
  const h=harness();const fact={state:'accepted',value:'material',sourceRefs:[]};
  const original={kind:'base',reference:{...ref,id:'original'},record:{productId:'A',changes:[{field:'material',fact}],reason:'Original'},status:'pending'};
  const corrected={kind:'base',reference:{...ref,id:'corrected'},record:{productId:'A',changes:[{field:'material',fact}],reason:'Saved words',corrects:original.reference},status:'pending'};
  h.run('state.productId="A";state.review='+JSON.stringify({...review,proposals:[original,corrected]}));
  h.run('decide=async(item,outcome,button,options)=>{globalThis.linked={id:item.reference.id,kind:item.kind,outcome,corrected:options.correctedProposal.id}};renderInformation()');
  const card=h.get('proposals').querySelectorAll('.review-card')[1];
  assert.equal(card.querySelectorAll('button').some(b=>b.textContent==='Accept'),false,'Acceptance waits for the original-to-correction link');
  const link=card.querySelectorAll('button').find(b=>b.textContent==='Link saved correction to original');assert.ok(link);await link.onclick();
  assert.deepEqual(JSON.parse(JSON.stringify(h.context.linked)),{id:'original',kind:'base',outcome:'superseded',corrected:'corrected'});
});
