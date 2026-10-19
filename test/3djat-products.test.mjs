import test from 'node:test';import assert from 'node:assert/strict';import * as fs from 'node:fs';import * as path from 'node:path';
import {randomUUID} from 'node:crypto';import {spawnSync,spawn} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {DomainProducts,readProductDossier,decisionActionReference,provisionProductPrincipal} from '../src/domain-products.mjs';
import {DomainStore,verifySnapshot,restoreSnapshot} from '../src/domain-store.mjs';
import {validate} from '../src/contracts/3djat.mjs';
import {setup,packet,create,proposal,decision,review,PRODUCT,WORKSPACE} from './fixtures/3djat/products-fixture.mjs';
const success=r=>{assert.equal(r.schemaVersion,'3djat.result.v1',JSON.stringify(r));assert.equal(validate('result',r).ok,true);return r;};
const failure=(r,code)=>{assert.equal(r.schemaVersion,'3djat.failure.v1',JSON.stringify(r));assert.equal(validate('failure',r).ok,true);if(code)assert.equal(r.error.code,code);return r;};
const send=(w,p,principal=w.human)=>success(w.writer.command(principal.token,p));

test('name-only creation is file-owned, has unknown facts and no operational prerequisite; exact replay precedes stale head',t=>{
  const w=setup(t),p=create(w),r=send(w,p),d=readProductDossier(w.root,{productId:PRODUCT});
  assert.equal(d.product.record.workingName,p.input.workingName);assert.equal(d.product.record.productCode,null);assert.equal(d.product.reference.revision,1);
  for(const f of Object.values(d.product.record.facts))assert.deepEqual(f,{state:'unknown',value:null,sourceRefs:[],decision:null});
  assert.deepEqual(d.product.record.notes,[]);assert.equal(fs.existsSync(w.runtime),false);assert.deepEqual(w.writer.command(w.human.token,p),r);
  const changed=structuredClone(p);changed.input.workingName='Changed replay';failure(w.writer.command(w.human.token,changed),'IDEMPOTENCY_CONFLICT');
  w.writer=new DomainProducts(w.root,{accessFile:w.accessFile});assert.deepEqual(w.writer.command(w.human.token,p),r);
  assert.equal(w.store.read().records.get(r.receipt.path).kind,'store-receipt');
});
test('initial note and leading-zero SKU survive standalone read, reopen and domain-only restore without SQLite',t=>{
  const w=setup(t);send(w,create(w,{productCode:'0007',note:'Authored initial note'}));
  const snapshot=path.join(w.dir,'snapshot');w.store.exportTo(snapshot);verifySnapshot(snapshot);const restored=path.join(w.dir,'restored');restoreSnapshot(snapshot,restored);
  const a=readProductDossier(w.root,{productId:PRODUCT}),b=readProductDossier(restored,{productId:PRODUCT});assert.deepEqual(a,b);
  assert.equal(b.product.record.productCode,'0007');assert.equal(b.product.record.notes[0].text,'Authored initial note');assert.equal(fs.existsSync(path.join(restored,'workspace.sqlite')),false);
});
for(const branch of ['reject','correct'])test(`C1 end-to-end ${branch}: pending original survives note, current human disposition and restart`,t=>{
  const w=setup(t);send(w,create(w));const submitted=proposal(w),aResult=send(w,submitted,w.source),a=review(w).proposals[0],originalBytes=fs.readFileSync(path.join(w.root,a.reference.path));
  assert.equal(a.status,'pending');assert.equal(a.record.expectedRevision,1);
  send(w,packet(w,'product.note.add',{productId:PRODUCT,text:'Authored independent note'}));assert.equal(review(w).product.reference.revision,2);
  const stale=decision(w,a,'accepted');failure(w.writer.command(w.human.token,stale),'REVISION_CONFLICT');
  if(branch==='reject'){
    const d=send(w,decision(w,a,'rejected'));assert.equal(d.reference.revision,2);assert.equal(review(w).proposals[0].status,'rejected');assert.equal(review(w).product.record.facts.material.state,'unknown');
  }else{
    const correction=proposal(w,{corrects:a.reference});correction.input.changes[0].fact.value='Corrected authored material';send(w,correction);
    const b=review(w).proposals.find(x=>x.record.proposalId===correction.input.proposalId);
    failure(w.writer.command(w.human.token,decision(w,b,'accepted')),'EVIDENCE_MISMATCH');
    const supersession=decision(w,a,'superseded',{correctedProposal:b.reference});send(w,supersession);assert.equal(review(w).product.reference.revision,2);
    const accepted=decision(w,b,'accepted');const acceptedResult=send(w,accepted);assert.equal(acceptedResult.reference.revision,3);
    const r=review(w),fact=r.product.record.facts.material;assert.equal(fact.value,'Corrected authored material');assert.deepEqual(fact.sourceRefs,[w.ref]);assert.equal(r.proposals.find(x=>x.record.proposalId===a.record.proposalId).status,'superseded');
    assert.equal(r.decisions.length,2);assert.equal(w.store.read().records.get(fact.decision.path).value.decisionId,accepted.input.decisionId);
    assert.deepEqual(w.writer.command(w.human.token,accepted),acceptedResult);failure(w.writer.command(w.human.token,decision(w,b,'accepted')),'EVIDENCE_MISMATCH');
  }
  assert.deepEqual(fs.readFileSync(path.join(w.root,a.reference.path)),originalBytes);assert.equal(w.store.read().records.get(aResult.reference.path).value.proposalId,a.record.proposalId);
  const before=review(w);w.writer=new DomainProducts(w.root,{accessFile:w.accessFile});assert.deepEqual(review(w),before);
});
for(const [field,fact]of [
  ['sellingPrice',{state:'accepted',value:{amount:'0.125000',currency:'IRT',unit:'toman',per:'item',effectiveDate:'2026-01-01'}}],
  ['dimensions',{state:'accepted',value:{length:1,width:2,height:3,unit:'cm'}}],
  ['material',{state:'not-applicable',value:null}],['productCode',{state:'unknown',value:null}],['workingName',{state:'accepted',value:'New authored working name'}]
])test(`typed ${field}/${fact.state} is installed only by human decision with exact provenance`,t=>{
  const w=setup(t);send(w,create(w,{productCode:'0007'}));const p=proposal(w,{field,fact:{...fact,sourceRefs:fact.state==='accepted'?[w.ref]:[]}});send(w,p,w.source);
  const a=review(w).proposals[0];assert.equal(review(w).product.record.workingName,'Authored working name');send(w,decision(w,a,'accepted'));
  const d=review(w).product.record;if(['workingName','productCode'].includes(field))assert.equal(d[field],fact.state==='accepted'?fact.value:null);else{assert.equal(d.facts[field].state,fact.state);assert.deepEqual(d.facts[field].value,fact.value);assert.equal(d.facts[field].decision.id,review(w).decisions[0].record.decisionId);}
});
test('unresolved/changed source remains pending and cannot install facts; restored exact bytes recover',t=>{
  const w=setup(t);send(w,create(w));const p=proposal(w);send(w,p,w.source);const original=fs.readFileSync(path.join(w.root,w.ref.location));fs.writeFileSync(path.join(w.root,w.ref.location),'Different bytes');
  assert.equal(review(w).proposals[0].sources[0].status,'unresolved');failure(w.writer.command(w.human.token,decision(w,review(w).proposals[0],'accepted')),'MISSING_SOURCE');
  fs.writeFileSync(path.join(w.root,w.ref.location),original);send(w,decision(w,review(w).proposals[0],'accepted'));assert.equal(review(w).product.record.facts.material.value,p.input.changes[0].fact.value);
});
test('source principal reads only scoped dossiers and submits allowed sources; role/receipt forgery cannot decide',t=>{
  const w=setup(t);send(w,create(w));const p=proposal(w);send(w,p,w.source);const a=review(w).proposals[0],d=decision(w,a,'accepted');
  failure(w.writer.command(w.source.token,d),'INVALID_SCOPE');failure(w.writer.command('0'.repeat(64),d),'INVALID_SCOPE');
  d.input.humanActionReceipt.sha256='0'.repeat(64);failure(w.writer.command(w.human.token,d),'EVIDENCE_MISMATCH');
  const bad=proposal(w);bad.input.changes[0].fact.sourceRefs[0]={...w.ref,sourceId:'foreign-source'};failure(w.writer.command(w.source.token,bad),'INVALID_SCOPE');
  const limited=provisionProductPrincipal(w.accessFile,{workspaceId:WORKSPACE,id:'limited-source',role:'source-proposer',products:[randomUUID()],sourceIds:['authored-source']});
  assert.throws(()=>w.writer.readReview(limited.token,{productId:PRODUCT,atHead:w.store.read().reference}),e=>e.code==='INVALID_SCOPE');
  assert.equal(w.writer.readReview(w.source.token,{productId:PRODUCT,atHead:w.store.read().reference}).proposals.length,1);
});
test('stale head/entity, duplicate SKU and cross-product/corrected-source links refuse without head publication',t=>{
  const w=setup(t);send(w,create(w,{productCode:'0007'}));const second=create(w,{productId:randomUUID(),productCode:'0007'}),head=w.store.read().reference;failure(w.writer.command(w.human.token,second),'SKU_CONFLICT');assert.deepEqual(w.store.read().reference,head);
  const stale=proposal(w);send(w,packet(w,'product.note.add',{productId:PRODUCT,text:'Advance'}));failure(w.writer.command(w.source.token,stale),'REVISION_CONFLICT');
  const aPacket=proposal(w);send(w,aPacket,w.source);const a=review(w).proposals[0];
  const correction=proposal(w,{corrects:a.reference});correction.input.changes[0].fact.sourceRefs[0]={...w.ref,revision:'forged-r2'};const before=w.store.read().reference;failure(w.writer.command(w.human.token,correction),'EVIDENCE_MISMATCH');assert.deepEqual(w.store.read().reference,before);
  const d=decision(w,a,'accepted');d.expected.entityRevision++;failure(w.writer.command(w.human.token,d),'REVISION_CONFLICT');
});
for(const mutate of [p=>{p.input.role='human';},p=>{p.input.changes[0].field='arbitrary.path';},p=>{p.input.changes[0].fact={state:'accepted',value:{amount:'1',currency:'IRR',unit:'toman',per:'kg',effectiveDate:'2026-01-01'},sourceRefs:[p.input.changes[0].fact.sourceRefs[0]]};p.input.changes[0].field='sellingPrice';},p=>{p.input.changes[0]={field:'workingName',fact:{state:'unknown',value:null,sourceRefs:[]}};}])test('malformed typed proposal refuses before publication',t=>{
  const w=setup(t);send(w,create(w));const p=proposal(w);mutate(p);const head=w.store.read().reference;failure(w.writer.command(w.source.token,p));assert.deepEqual(w.store.read().reference,head);
});
for(const at of ['before-publication','after-stage','before-replace','after-replace','after-domain-commit','before-response'])test(`standalone interruption ${at} retains honest authority and exact receipt replay`,t=>{
  let armed=true;const w=setup(t,{hook(stage){if(armed&&stage===at)throw Object.assign(new Error('Authored fault'),{code:'EIO'});}}),p=create(w,{note:'Authored note'});
  failure(w.writer.command(w.human.token,p));armed=false;w.writer=new DomainProducts(w.root,{accessFile:w.accessFile});const r=send(w,p);assert.deepEqual(w.writer.command(w.human.token,p),r);assert.equal(w.store.read().head.products.length,1);assert.equal(review(w).product.record.notes.length,1);
});
test('external file-only process reads accepted knowledge with no BVE/SQLite root',t=>{
  const w=setup(t);send(w,create(w));const result=spawnSync(process.execPath,['--input-type=module','-e',"import {readProductDossier} from './src/domain-products.mjs';console.log(JSON.stringify(readProductDossier(process.argv[1],{productId:process.argv[2]})))",w.root,PRODUCT],{cwd:path.resolve('.'),encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).product.record.productId,PRODUCT);assert.equal(fs.existsSync(w.runtime),false);
});
test('two real product writers contend for duplicate SKU: one coherent head/index wins, no orphan becomes authority',async t=>{
  const w=setup(t),first=create(w,{productCode:'0007'}),second=create(w,{productId:randomUUID(),productCode:'0007'}),script=fileURLToPath(new URL('./fixtures/3djat/products-process.mjs',import.meta.url));
  const child=spawn(process.execPath,[script,w.root,w.accessFile,'hold'],{stdio:['pipe','pipe','pipe']});let stdout='',stderr='';child.stdout.on('data',b=>{stdout+=b;});child.stderr.on('data',b=>{stderr+=b;});const ended=new Promise(ok=>child.on('close',ok));t.after(()=>{if(child.exitCode===null)child.kill();});
  const locked=new Promise((ok,no)=>{const timer=setTimeout(()=>no(new Error('Authored child did not lock')),5000);child.stdout.on('data',()=>{if(stdout.includes('"locked"')){clearTimeout(timer);ok();}});child.on('error',no);});
  child.stdin.end(JSON.stringify({token:w.human.token,packet:first}));await locked;
  const contender=spawnSync(process.execPath,[script,w.root,w.accessFile],{input:JSON.stringify({token:w.human.token,packet:second}),encoding:'utf8'});assert.equal(contender.status,0,contender.stderr);failure(JSON.parse(contender.stdout),'CAPABILITY_UNAVAILABLE');
  assert.equal(await ended,0,stderr);success(JSON.parse(stdout.trim().split('\n').at(-1)));assert.equal(w.store.read().head.products.length,1);assert.deepEqual(w.store.read().head.skus,[{productCode:'0007',productId:PRODUCT}]);
  failure(w.writer.command(w.human.token,second),'REVISION_CONFLICT');const reviewed=packet(w,'product.create',second.input);failure(w.writer.command(w.human.token,reviewed),'SKU_CONFLICT');
});
test('standalone semantic child writes and later source submits while BVE is stopped; no operational database required',t=>{
  const w=setup(t),script=fileURLToPath(new URL('./fixtures/3djat/products-process.mjs',import.meta.url)),p=create(w);
  const a=spawnSync(process.execPath,[script,w.root,w.accessFile],{input:JSON.stringify({token:w.human.token,packet:p}),encoding:'utf8'});assert.equal(a.status,0,a.stderr);success(JSON.parse(a.stdout));
  const b=spawnSync(process.execPath,[script,w.root,w.accessFile],{input:JSON.stringify({token:w.source.token,packet:proposal(w)}),encoding:'utf8'});assert.equal(b.status,0,b.stderr);success(JSON.parse(b.stdout));assert.equal(review(w).proposals[0].status,'pending');assert.equal(fs.existsSync(w.runtime),false);
});
test('accepted/rejected decisions have explicit active links; correction preserves every prior decision',t=>{
  const w=setup(t);send(w,create(w));send(w,proposal(w),w.source);const a=review(w).proposals[0];send(w,decision(w,a,'accepted'));const first=review(w).decisions[0];
  const bPacket=proposal(w,{corrects:a.reference});bPacket.input.changes[0].fact.value='New reviewed value';send(w,bPacket);const b=review(w).proposals.find(x=>x.record.proposalId===bPacket.input.proposalId);
  failure(w.writer.command(w.human.token,decision(w,a,'superseded',{correctedProposal:b.reference})),'EVIDENCE_MISMATCH');
  send(w,decision(w,a,'superseded',{correctedProposal:b.reference,supersedesDecision:first.reference}));send(w,decision(w,b,'accepted'));assert.equal(review(w).decisions.length,3);assert.equal(review(w).product.record.facts.material.value,'New reviewed value');assert.equal(w.store.read().records.get(first.reference.path).value.outcome,'accepted');
});
for(const outcome of ['proposal','accepted','rejected'])for(const at of ['after-replace','before-response'])test(`${outcome} interruption ${at} retains one immutable record and original receipts`,t=>{
  let armed=false;const w=setup(t,{hook(stage){if(armed&&stage===at)throw Object.assign(new Error('Authored interruption'),{code:'EIO'});}});send(w,create(w));
  let p=proposal(w),principal=w.source;if(outcome!=='proposal'){send(w,p,w.source);p=decision(w,review(w).proposals[0],outcome);principal=w.human;}
  armed=true;failure(w.writer.command(principal.token,p));armed=false;w.writer=new DomainProducts(w.root,{accessFile:w.accessFile});const r=send(w,p,principal);assert.deepEqual(w.writer.command(principal.token,p),r);
  assert.equal(review(w).proposals.length,1);assert.equal(review(w).decisions.length,outcome==='proposal'?0:1);assert.equal(review(w).proposals[0].status,outcome==='proposal'?'pending':outcome);
  const changed=structuredClone(p);changed.input.reason+=' Changed';failure(w.writer.command(principal.token,changed),'IDEMPOTENCY_CONFLICT');
});
test('stale/future/foreign corrections and forged original references refuse before publication',t=>{
  const w=setup(t);send(w,create(w));send(w,proposal(w),w.source);const a=review(w).proposals[0];const correction=proposal(w,{corrects:a.reference});send(w,correction);const b=review(w).proposals.find(x=>x.record.proposalId===correction.input.proposalId);
  send(w,packet(w,'product.note.add',{productId:PRODUCT,text:'Advance beyond both claims'}));let head=w.store.read().reference;
  failure(w.writer.command(w.human.token,decision(w,a,'superseded',{correctedProposal:b.reference})),'REVISION_CONFLICT');assert.deepEqual(w.store.read().reference,head);
  const future=proposal(w,{corrects:a.reference});future.input.expectedRevision++;future.expected.entityRevision++;failure(w.writer.command(w.human.token,future),'REVISION_CONFLICT');assert.deepEqual(w.store.read().reference,head);
  const other=randomUUID();send(w,create(w,{productId:other}));const foreign=proposal(w,{productId:other});send(w,foreign,w.source);head=w.store.read().reference;
  const ref={id:foreign.input.proposalId,revision:1,path:`Domain/proposal/${foreign.input.proposalId}/1.json`,sha256:w.store.read().records.get(`Domain/proposal/${foreign.input.proposalId}/1.json`).reference.sha256};
  failure(w.writer.command(w.human.token,decision(w,a,'superseded',{correctedProposal:ref})),'EVIDENCE_MISMATCH');assert.deepEqual(w.store.read().reference,head);
  const forged=decision(w,a,'rejected');forged.input.proposal.sha256='0'.repeat(64);failure(w.writer.command(w.human.token,forged),'EVIDENCE_MISMATCH');assert.deepEqual(w.store.read().reference,head);
});
test('typed dated histories are preserved through notes and accepted facts; there is no history editor command',t=>{
  const w=setup(t);send(w,create(w));const v=w.store.read(),p=structuredClone(review(w).product.record),ref=p.sourceReceipt;p.revision++;
  p.designRevisions.push({id:randomUUID(),date:'2026-01-01',kind:'design',title:'Authored retained design entry',references:[ref],sourceRefs:[w.ref]});
  w.store.commit({principal:'authored-fixture-owner',operation:'authored-history-seed',key:'seed',expectedHead:v.reference,changes:[{kind:'product',id:PRODUCT,expectedRevision:1,record:p}],records:[]});
  send(w,packet(w,'product.note.add',{productId:PRODUCT,text:'Keep existing typed history'}));send(w,proposal(w),w.source);send(w,decision(w,review(w).proposals[0],'accepted'));assert.deepEqual(review(w).product.record.designRevisions,p.designRevisions);
  assert.throws(()=>w.writer.command(w.human.token,{schemaVersion:'3djat.command.v1',operation:'product.history.add',key:'unsupported',expected:{domainHead:w.store.read().reference,entityRevision:4},input:{productId:PRODUCT}}));
});
test('secret principal material stays outside domain exports and readable outputs; unsafe roots and links still refuse',t=>{
  const w=setup(t);send(w,create(w));send(w,proposal(w),w.source);send(w,decision(w,review(w).proposals[0],'accepted'));
  const snapshot=path.join(w.dir,'public-domain-snapshot');w.store.exportTo(snapshot);const all=[JSON.stringify(review(w)),...fs.readdirSync(snapshot,{recursive:true}).filter(n=>fs.statSync(path.join(snapshot,n)).isFile()).map(n=>fs.readFileSync(path.join(snapshot,n),'utf8'))].join('\n');
  const key=JSON.parse(fs.readFileSync(w.accessFile)).key;for(const secret of [w.human.token,w.source.token,key])assert.equal(all.includes(secret),false);
  assert.equal(w.writer.registry,undefined);assert.equal(w.writer.store,undefined);
  fs.renameSync(w.root,w.root+'-old');fs.mkdirSync(w.root);assert.equal(w.writer.command(w.human.token,create({...w,store:new DomainStore(w.root+'-old')},{productId:randomUUID()})).error.code,'UNSAFE_PATH');assert.deepEqual(fs.readdirSync(w.root),[]);
});
test('acceptance rechecks exact source bytes inside the writer lock before head publication',t=>{
  let armed=false;const w=setup(t,{hook(stage){if(armed&&stage==='before-publication')fs.writeFileSync(path.join(w.root,w.ref.location),'Authored source changed before lock');}});send(w,create(w));send(w,proposal(w),w.source);const a=review(w).proposals[0],p=decision(w,a,'accepted'),head=w.store.read().reference;
  armed=true;failure(w.writer.command(w.human.token,p),'MISSING_SOURCE');assert.deepEqual(w.store.read().reference,head);assert.equal(review(w).proposals[0].status,'pending');
});
test('a source directory junction/symlink is refused as an unsafe path even when external bytes match',t=>{
  const w=setup(t);send(w,create(w));send(w,proposal(w),w.source);const a=review(w).proposals[0],p=decision(w,a,'accepted'),head=w.store.read().reference;
  const outside=path.join(w.dir,'outside-source');fs.mkdirSync(outside);fs.copyFileSync(path.join(w.root,w.ref.location),path.join(outside,'authored.txt'));fs.renameSync(path.join(w.root,'Sources'),path.join(w.root,'Sources-preserved'));
  fs.symlinkSync(outside,path.join(w.root,'Sources'),process.platform==='win32'?'junction':'dir');failure(w.writer.command(w.human.token,p),'UNSAFE_PATH');assert.deepEqual(w.store.read().reference,head);
});
