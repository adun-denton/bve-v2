import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as path from 'node:path';
import {syncBuiltinESMExports} from 'node:module';
import {randomUUID} from 'node:crypto';
import {DomainBusiness,configureBusinessGrant,businessDecisionActionReference} from '../src/domain-business.mjs';
import {DomainStore} from '../src/domain-store.mjs';
import {validate} from '../src/contracts/3djat.mjs';
import {digest,stable} from '../src/domain-authority.mjs';
import {world,packet,send,read,policy,signedFault,countedSource,rewriteTerminal,unrelatedCommit,governedBetween,roots,boundaryRoots,WORKSPACE} from './fixtures/3djat/business-authority-fixture.mjs';

let assertions=0;const A={eq:(x,y)=>{assertions++;assert.equal(x,y);},deep:(x,y)=>{assertions++;assert.deepEqual(x,y);},
 throws:(fn,code)=>{assertions++;assert.throws(fn,e=>e?.code===code,code);}};
const refused=(label,code,fn)=>{console.log('BA1_SUBCASE_START='+label);A.throws(fn,code);console.log('BA1_SUBCASE_REFUSAL='+label+':'+code);};
const failed=(label,code,fn)=>{console.log('BA1_SUBCASE_START='+label);const v=fn();A.eq(v.schemaVersion,'3djat.failure.v1');A.eq(v.error.code,code);console.log('BA1_SUBCASE_REFUSAL='+label+':'+code);};
process.on('exit',()=>{console.log('BA1_AUTHORED_ASSERTIONS='+assertions+' ROOTS='+JSON.stringify(roots)+' BOUNDARY_ROOTS='+JSON.stringify(boundaryRoots));if(assertions>260)process.exitCode=1;});

test('01 genuine human publish and exact public result',()=>{const w=world(),p=packet(w),v=send(w,p),r=read(w);
 A.eq(v.reference.revision,1);A.eq(r.business.reference.path,v.reference.path);A.eq(r.business.decision.decisionId,r.business.audit.id);
 A.eq(r.business.decision.humanActionReceipt.id,r.business.audit.id);A.eq(r.business.publication.path,r.head.path);
 A.eq(r.sourceStatus.length,1);A.eq(r.sourceStatus[0].status,'verified');A.eq(JSON.stringify(r).includes('mac'),false);
 A.eq(JSON.stringify(r).includes(JSON.parse(fs.readFileSync(w.accessFile)).key),false);});

test('02 revision two and reachable historical first, inactive predecessor sources unopened',()=>{const w=world();send(w,packet(w));const first=w.store.read().reference;
 const second=packet(w,{instructions:'Second approved instructions'});send(w,second);A.eq(read(w).business.record.revision,2);
 A.eq(read(w,'historical',first).business.record.revision,1);A.eq(read(w).business.decision.expectedRevision,1);
 const b=w.store.read().head.business;A.eq(b.revision,2);});

test('03 null business, stale new and unreachable historical head close',()=>{const w=world(),genesis=w.store.read().reference;
 refused('null-new','MISSING_SOURCE',()=>read(w));refused('null-historical','MISSING_SOURCE',()=>read(w,'historical',genesis));
 send(w,packet(w));refused('stale-new','REVISION_CONFLICT',()=>read(w,'new',genesis));
 refused('unreachable-historical','MISSING_SOURCE',()=>read(w,'historical',{...genesis,sha256:'f'.repeat(64)}));});

test('04 native optional sourceIds ignored, product list and invalid callback refuse',()=>{const w=world();send(w,packet(w));w.setNative({...w.human,sourceIds:['invented']});A.eq(read(w).sourceStatus[0].status,'verified');
 w.setNative({...w.human,products:[randomUUID()]});refused('native-product-list','INVALID_SCOPE',()=>read(w));
 w.setNative(null);refused('null-native','INVALID_SCOPE',()=>read(w));
 w.setNative({...w.human,extra:true});refused('unknown-native-field','INVALID_SCOPE',()=>read(w));
 const x={...w.human};Object.defineProperty(x,'id',{get(){throw Error('getter executed');},enumerable:true});w.setNative(x);
 refused('native-getter','INVALID_SCOPE',()=>read(w));});

test('05 private scope, business read/publish and writer role',()=>{const w=world();policy(w,a=>{a.principals[0].operations=['publish'];});failed('publish-needs-read','INVALID_SCOPE',()=>w.writer.command('native-human',packet(w)));
 policy(w,a=>{a.principals[0].operations=['read','publish'];});send(w,packet(w));
 policy(w,a=>{a.principals[0].operations=['read'];});failed('write-grant-loss','INVALID_SCOPE',()=>w.writer.command('native-human',packet(w)));
 w.setNative(w.conductor);refused('unregistered-conductor','INVALID_SCOPE',()=>read(w));
 policy(w,a=>{a.workspaceId=randomUUID();});refused('wrong-private-workspace','INVALID_SCOPE',()=>read(w));});

test('06 trusted private creation and hash-CAS update retain key and exact backup',()=>{const w=world(),original=fs.readFileSync(w.accessFile),before=digest(original);
 A.throws(()=>configureBusinessGrant(w.accessFile,{workspaceId:WORKSPACE,principalId:w.conductor.id,role:'conductor',grant:{operations:['read'],sourceIds:[]},expectedSha256:null,confirmedQuiescent:true}),'REVISION_CONFLICT');
 const updated=configureBusinessGrant(w.accessFile,{workspaceId:WORKSPACE,principalId:w.conductor.id,role:'conductor',grant:{operations:['read'],sourceIds:[]},expectedSha256:before,confirmedQuiescent:true});
 A.eq(fs.readFileSync(updated.backupFile).equals(original),true);A.eq(JSON.parse(fs.readFileSync(w.accessFile)).key,JSON.parse(original).key);
 A.eq(JSON.parse(fs.readFileSync(w.accessFile)).principals.length,2);
 w.setNative(w.conductor);refused('conductor-new-needs-human','INVALID_SCOPE',()=>read(w));
 refused('conductor-historical-null','MISSING_SOURCE',()=>read(w,'historical',w.store.read().reference));});

test('07 same packet replay without source bytes; changed packet conflicts',()=>{const w=world(),p=packet(w),original=send(w,p),sourcePath=path.join(w.root,w.source.location);
 fs.unlinkSync(sourcePath);A.eq(w.writer.command('native-human',p).receipt.path,original.receipt.path);
 const changed=structuredClone(p);changed.input.instructions='Changed';failed('replay-conflict','IDEMPOTENCY_CONFLICT',()=>w.writer.command('native-human',changed));
 policy(w,a=>{a.principals[0].sourceIds=[];});failed('replay-source-grant','INVALID_SCOPE',()=>w.writer.command('native-human',p));});

test('08 positive byte opens then zero forbidden opens for revoked source',()=>{const w=world();send(w,packet(w));const selected=w.store.read().reference,sourcePath=path.join(w.root,w.source.location);
 const original=fs.openSync;let opens=0;fs.openSync=function(file,...args){if(file===sourcePath)opens++;return original.call(this,file,...args);};syncBuiltinESMExports();
 try{A.eq(read(w).sourceStatus[0].status,'verified');A.eq(opens>0,true);opens=0;
  policy(w,a=>{a.principals[0].sourceIds=[];});refused('new-revoked','INVALID_SCOPE',()=>read(w));
  A.eq(read(w,'historical',selected).sourceStatus[0].cause,'INVALID_SCOPE');A.eq(opens,0);
 }finally{fs.openSync=original;syncBuiltinESMExports();}});

test('09 ordered repeated refs count all sixteen reads, statuses and same ID',()=>{const w=world({boundary:true}),s=countedSource(w,1024**2),refs=Array.from({length:16},()=>structuredClone(s));
 const sourcePath=path.join(w.root,s.location),original=fs.openSync;send(w,packet(w,{sources:refs}));let opens=0;
 fs.openSync=function(file,...args){if(file===sourcePath)opens++;return original.call(this,file,...args);};syncBuiltinESMExports();
 try{const r=read(w);A.eq(r.sourceStatus.length,16);A.eq(opens,16);A.eq(r.sourceStatus.every(x=>x.status==='verified'),true);
  A.deep(r.business.record.sourceRefs,refs);}finally{fs.openSync=original;syncBuiltinESMExports();}});

test('10 per-file 1MiB+1 and seventeen refs refuse at their first guards',()=>{const w=world({boundary:true}),large=countedSource(w,1024**2+1);
 failed('oversized-publish','VALIDATION_LIMIT',()=>w.writer.command('native-human',packet(w,{sources:[large]})));
 const p=packet(w,{sources:Array.from({length:16},()=>w.source)});p.input.sourceRefs.push(w.source);
 failed('seventeen-schema','OUT_OF_BOUNDS',()=>w.writer.command('native-human',p));});

test('11 missing, changed and unsupported Drive selected sources block history',()=>{const w=world();send(w,packet(w));const h=w.store.read().reference,sourcePath=path.join(w.root,w.source.location);
 fs.unlinkSync(sourcePath);refused('missing-new','MISSING_SOURCE',()=>read(w));A.eq(read(w,'historical',h).sourceStatus[0].cause,'MISSING_SOURCE');
 fs.writeFileSync(sourcePath,'Changed');refused('hash-new','HASH_MISMATCH',()=>read(w));A.eq(read(w,'historical',h).sourceStatus[0].cause,'HASH_MISMATCH');
 const x=world(),drive={kind:'drive',sourceId:'authored-source',revision:'1',sha256:'0'.repeat(64),fileId:'inert',modifiedAt:'2026-01-01T00:00:00.000Z',locator:{kind:'page',page:1},observedAt:'2026-01-01T00:00:00.000Z'};
 signedFault(x,{sources:[drive]});
 const old=x.store.read().reference;refused('drive-new','CAPABILITY_UNAVAILABLE',()=>read(x));A.eq(read(x,'historical',old).sourceStatus[0].cause,'CAPABILITY_UNAVAILABLE');});

test('12 unsafe local source type is whole refusal even historically',()=>{const w=world();send(w,packet(w));const h=w.store.read().reference,where=path.join(w.root,w.source.location);fs.unlinkSync(where);fs.mkdirSync(where);
 refused('directory-new','UNSAFE_PATH',()=>read(w));refused('directory-history','UNSAFE_PATH',()=>read(w,'historical',h));});

test('13 signed history rejects context/decision semantic drift',()=>{const a=world();signedFault(a,{decisionEdit:d=>{d.instructionsSha256='f'.repeat(64);}});refused('wrong-instruction-digest','EVIDENCE_MISMATCH',()=>read(a));
 const b=world();signedFault(b,{decisionEdit:d=>{d.humanActionReceipt={...d.humanActionReceipt,sha256:'f'.repeat(64)};}});refused('wrong-action-ref','EVIDENCE_MISMATCH',()=>read(b));
 const c=world();signedFault(c,{eventEdit:e=>{e.commandHash='f'.repeat(64);}});refused('wrong-command-hash','EVIDENCE_MISMATCH',()=>read(c));});

test('14 signed history rejects extra receipt member and wrong business pointer transition',()=>{const a=world();signedFault(a,{recordsEdit:rs=>rs.push({kind:'evidence',record:{schemaVersion:'3djat.evidence.v1',id:randomUUID(),revision:1,description:'Extra'}})});
 refused('extra-receipt-member','EVIDENCE_MISMATCH',()=>read(a));
 const b=world();signedFault(b,{operation:'unapproved.business.write'});refused('wrong-business-operation','EVIDENCE_MISMATCH',()=>read(b));});

test('15 native/key/head return refresh refuses stale authority',()=>{const w=world();send(w,packet(w));let n=0;w.auth=()=>{n++;if(n===3)policy(w,a=>{a.key='f'.repeat(64);});return w.human;};
 refused('key-changed-inside-read','EVIDENCE_MISMATCH',()=>read(w));
 const x=world();send(x,packet(x));x.auth=()=>null;refused('reader-loss','INVALID_SCOPE',()=>read(x));});

test('16 uncertain publication retains first failure and guarded replay',()=>{const w=world(),p=packet(w);let injected=false;w.hook=stage=>{if(stage==='after-replace'&&!injected){injected=true;throw Object.assign(new Error('inert interruption'),{code:'INERT_INTERRUPTION'});}};
 failed('uncertain-first','EXPORT_PENDING',()=>w.writer.command('native-human',p));A.eq(injected,true);w.hook=()=>{};
 A.eq(w.writer.command('native-human',p).schemaVersion,'3djat.result.v1');});

test('17 old contracts and Store meaning remain and new kind is separate',()=>{const w=world(),p=packet(w);A.eq(validate('business-context',{schemaVersion:'3djat.business-context.v1',workspaceId:WORKSPACE,revision:1,
 instructions:'Legacy structural',sourceRefs:[w.source],decision:{id:'old',revision:1,path:'Domain/evidence/old/1.json',sha256:'0'.repeat(64)},
 sourceReceipt:{id:'old',revision:1,path:'Domain/evidence/old/1.json',sha256:'0'.repeat(64)}}).ok,true);
 A.eq(validate('command',p).ok,true);A.eq(new DomainStore(w.root).read().head.business,null);
 A.eq(businessDecisionActionReference({workspaceId:WORKSPACE,principalId:w.human.id,packet:p}).id,p.input.humanActionReceipt.id);});

test('18 writer source grant refusal precedes all source byte opens',()=>{const w=world(),sourcePath=path.join(w.root,w.source.location),original=fs.openSync;let opens=0;
 fs.openSync=function(file,...args){if(file===sourcePath)opens++;return original.call(this,file,...args);};syncBuiltinESMExports();
 try{send(w,packet(w));A.eq(opens>0,true);opens=0;
  policy(w,a=>{a.principals[0].sourceIds=[];});failed('publish-source-revoked','INVALID_SCOPE',()=>w.writer.command('native-human',packet(w)));
  A.eq(opens,0);
 }finally{fs.openSync=original;syncBuiltinESMExports();}});

test('19 registered conductor historical read, never new or publish',()=>{const w=world();send(w,packet(w));const h=w.store.read().reference;
 const before=digest(fs.readFileSync(w.accessFile));configureBusinessGrant(w.accessFile,{workspaceId:WORKSPACE,principalId:w.conductor.id,role:'conductor',
  grant:{operations:['read'],sourceIds:['authored-source']},expectedSha256:before,confirmedQuiescent:true});
 w.setNative(w.conductor);A.eq(read(w,'historical',h).sourceStatus[0].status,'verified');
 refused('conductor-new','INVALID_SCOPE',()=>read(w));failed('conductor-publish','INVALID_SCOPE',()=>w.writer.command('native-conductor',packet(w)));});

test('20 repeated logical source ID with distinct locator retains order',()=>{const w=world(),second={...w.source,locator:{kind:'page',page:2}};
 send(w,packet(w,{sources:[w.source,second,w.source]}));const r=read(w);
 A.eq(r.sourceStatus.length,3);A.deep(r.sourceStatus.map(x=>x.source.locator.page),[1,2,1]);
 A.eq(r.sourceStatus.every(x=>x.status==='verified'),true);});

test('21 optional native source array accessors refuse without evaluation',()=>{const w=world();send(w,packet(w));let evaluated=0;
 const sourceIds=[];Object.defineProperty(sourceIds,'0',{get(){evaluated++;throw Error('getter ran');},enumerable:true});sourceIds.length=1;
 w.setNative({...w.human,sourceIds});refused('nested-native-getter','INVALID_SCOPE',()=>read(w));A.eq(evaluated,0);});

test('22 return-head change refuses even after valid publication',()=>{const w=world();let mutated=false;w.hook=stage=>{
  if(stage==='before-response'&&!mutated){mutated=true;const head=w.store.read().reference;w.store.commit({principal:'inert-reviewer',operation:'inert.unrelated',key:randomUUID(),expectedHead:head,
    changes:[],records:[{kind:'evidence',record:{schemaVersion:'3djat.evidence.v1',id:randomUUID(),revision:1,description:'Inert unrelated receipt'}}]});}
 };
 failed('late-head-change','REVISION_CONFLICT',()=>w.writer.command('native-human',packet(w)));
 A.eq(mutated,true);A.eq(read(w).business.record.revision,1);});

test('23 invalid timestamp and action ref reject without native action',()=>{const w=world(),p=packet(w);let callbacks=0;w.auth=()=>{callbacks++;return w.human;};
 p.input.decidedAt='2026-99-99T00:00:00.000Z';failed('bad-date-preflight','INVALID_REFERENCE',()=>w.writer.command('native-human',p));A.eq(callbacks,0);
 const valid=packet(w);valid.input.humanActionReceipt.sha256='f'.repeat(64);
 failed('wrong-derived-action','EVIDENCE_MISMATCH',()=>w.writer.command('native-human',valid));});

test('24 receipt disclosure stays with original actor and current grants',()=>{
 for(const [label,change,expected] of [
  ['same-actor',()=>{},true],
  ['switched-human',w=>{const a=JSON.parse(fs.readFileSync(w.accessFile));a.principals.push({...a.principals[0],id:'second-human'});fs.writeFileSync(w.accessFile,stable(a)+'\n');w.setNative({...w.human,id:'second-human'});},false],
  ['revoked-publish',w=>policy(w,a=>{a.principals[0].operations=['read'];}),false],
  ['revoked-source',w=>policy(w,a=>{a.principals[0].sourceIds=[];}),false],
  ['retained-key-changed',w=>policy(w,a=>{a.key='f'.repeat(64);}),false]]){
  const w=world();w.hook=(stage)=>{if(stage==='after-domain-commit'){
   change(w);throw Object.assign(new Error('Authored response interruption'),{code:'INERT_INTERRUPTION'});}};
  const p=packet(w);console.log('BA1_SUBCASE_START=receipt-'+label);const r=w.writer.command('native-human',p);
  A.eq(r.schemaVersion,'3djat.failure.v1');A.eq(r.error.code,'CAPABILITY_UNAVAILABLE');A.eq(Boolean(r.error.evidence),expected);
  A.eq(w.store.read().head.business?.revision,1);console.log('BA1_SUBCASE_REFUSAL=receipt-'+label+':CAPABILITY_UNAVAILABLE');
 }
});

test('25 portable selector query preflight rejects without callback or source open',()=>{
 const w=world();send(w,packet(w));let callbacks=0,opens=0;w.auth=()=>{callbacks++;return w.human;};
 const sourcePath=path.join(w.root,w.source.location),original=fs.openSync;
 fs.openSync=function(file,...args){if(file===sourcePath)opens++;return original.call(this,file,...args);};syncBuiltinESMExports();
 try{for(const [label,edit] of [['non-uuid',q=>{q.workspaceId='z'.repeat(36);}],['unknown',q=>{q.extra=true;}],
  ['head-unknown',q=>{q.atHead.extra=true;}],['head-accessor',q=>{Object.defineProperty(q.atHead,'id',{get(){throw Error('getter');},enumerable:true});}],
  ['query-accessor',q=>{Object.defineProperty(q,'mode',{get(){throw Error('getter');},enumerable:true});}]]){
  const q={mode:'new',atHead:structuredClone(w.store.read().reference),workspaceId:WORKSPACE};edit(q);
  refused('preflight-'+label,label==='non-uuid'?'INVALID_REFERENCE':label==='head-unknown'?'UNKNOWN_FIELD':'INVALID_VALUE',()=>w.writer.resolveBusinessForOperation('native-human',q));
  A.eq(callbacks,0);A.eq(opens,0);
 }}finally{fs.openSync=original;syncBuiltinESMExports();}
});

test('26 native callback head drift guards first and later reader and writer source opens',()=>{
 for(const [operation,boundary] of [['reader',1],['reader',2],['writer',1],['writer',2]]){
  const w=world();if(operation==='reader')send(w,packet(w,{sources:[w.source,w.source]}));
  const sourcePath=path.join(w.root,w.source.location),original=fs.openSync;let opens=0,calls=0;
  fs.openSync=function(file,...args){if(file===sourcePath)opens++;return original.call(this,file,...args);};syncBuiltinESMExports();
  try{w.auth=()=>{calls++;if(calls===boundary+1)unrelatedCommit(w);return w.human;};
   console.log('BA1_SUBCASE_START=head-drift-'+operation+'-'+boundary);
   if(operation==='reader')A.throws(()=>read(w),'HEAD_CHANGED');
   else{const r=w.writer.command('native-human',packet(w,{sources:[w.source,w.source]}));A.eq(r.error.code,'REVISION_CONFLICT');}
   A.eq(opens,boundary-1);console.log('BA1_SUBCASE_REFUSAL=head-drift-'+operation+'-'+boundary+':HEAD_CHANGED');
  }finally{fs.openSync=original;syncBuiltinESMExports();}
 }
 const w=world();send(w,packet(w,{sources:[w.source,w.source]}));A.eq(read(w).sourceStatus.length,2);
});

test('27 canonical signed action isolates MAC role subject key time and decision identity',()=>{
 const good=world();signedFault(good,{});A.eq(read(good).business.record.revision,1);
 const faults=[
  ['wrong-mac',{signedEdit:s=>{s.mac='f'.repeat(64);}}],
  ['signed-role',{role:'conductor'}],
  ['event-subject',{eventEdit:e=>{e.principalId='other-human';}}],
  ['event-key',{eventEdit:e=>{e.key=randomUUID();}}],
  ['event-time',{eventEdit:e=>{e.recordedAt='2025-01-01T00:00:00.000Z';}}],
  ['decision-id',{decisionEdit:d=>{d.decisionId=randomUUID();}}]];
 for(const [label,options] of faults){const w=world();signedFault(w,options);refused('signed-'+label,'EVIDENCE_MISMATCH',()=>read(w));}
});

test('28 receipt plan and terminal head faults retain isolated Store closure',()=>{
 const good=world();send(good,packet(good));A.eq(read(good).business.record.revision,1);
 const faults=[
  ['omitted-member',(r)=>{r.records.splice(1,1);},'EVIDENCE_MISMATCH'],
  ['reordered-member',(r)=>{[r.records[0],r.records[1]]=[r.records[1],r.records[0]];},'EVIDENCE_MISMATCH'],
  ['payload-hash',(r)=>{r.payloadHash='f'.repeat(64);},'EVIDENCE_MISMATCH'],
  ['receipt-id',(r)=>{r.id='f'.repeat(64);},'INVALID_METADATA'],
  ['transition-from',(r)=>{r.transitions[0].from=3;r.transitions[0].to=4;},'EVIDENCE_MISMATCH'],
  ['transition-to',(r)=>{r.transitions[0].from=2;r.transitions[0].to=3;},'EVIDENCE_MISMATCH'],
  ['transition-identity',(r)=>{r.transitions[0].id=randomUUID();},'EVIDENCE_MISMATCH'],
  ['workspace-identity',(r)=>{r.workspaceId=randomUUID();},'INVALID_METADATA'],
  ['business-pointer',(r,h)=>{h.business=null;},'EVIDENCE_MISMATCH']];
 for(const [label,edit,code] of faults){const w=world();send(w,packet(w));rewriteTerminal(w,edit);refused('receipt-'+label,code,()=>read(w));}
});

test('29 actual governed product and template transitions preserve business pointer and indices',()=>{
 const w=world();send(w,packet(w));const first=w.store.read(),b=first.head.business;
 const governed=governedBetween(w),middle=w.store.read();A.deep(middle.head.business,b);
 A.eq(middle.head.products.some(x=>x.productId===governed.productId),true);
 A.eq(middle.head.templates.some(x=>x.id===governed.templateId),true);
 A.eq(middle.head.skus.some(x=>x.productCode==='BA1-PROBE'),true);
 send(w,packet(w,{instructions:'After governed product and template'}));const last=w.store.read();
 A.eq(last.head.business.revision,2);A.deep(last.head.products,middle.head.products);
 A.deep(last.head.templates,middle.head.templates);A.deep(last.head.skus,middle.head.skus);
 A.eq(read(w).business.record.revision,2);A.eq(read(w,'historical',first.reference).business.record.revision,1);
 for(const [label,change,code] of [['product-pointer',h=>{h.products=[];h.skus=[];},'EVIDENCE_MISMATCH'],
  ['template-pointer',h=>{h.templates=[];},'EVIDENCE_MISMATCH'],['sku-pointer',h=>{h.skus=[];},'INVALID_SKU_INDEX']]){
  const x=world();send(x,packet(x));governedBetween(x);send(x,packet(x,{instructions:'Second'}));
  rewriteTerminal(x,(r,h)=>change(h));refused('head-'+label,code,()=>read(x));
 }
});

test('30 inactive predecessor parent removed; selected B alone opens and historical A blocks',()=>{
 const w=world(),a={...w.source,sourceId:'source-a',location:'Sources/A/a.txt'},b={...w.source,sourceId:'source-b',location:'Sources/B/b.txt'};
 fs.mkdirSync(path.join(w.root,'Sources/A'));fs.mkdirSync(path.join(w.root,'Sources/B'));
 fs.writeFileSync(path.join(w.root,a.location),'Authored inert source\n');fs.writeFileSync(path.join(w.root,b.location),'Authored inert source\n');
 policy(w,v=>{v.principals[0].sourceIds=['source-a','source-b'];});send(w,packet(w,{sources:[a]}));const old=w.store.read().reference;
 send(w,packet(w,{sources:[b]}));fs.unlinkSync(path.join(w.root,a.location));fs.rmdirSync(path.join(w.root,'Sources/A'));
 const original=fs.openSync;let aOpens=0,bOpens=0;fs.openSync=function(file,...args){if(file===path.join(w.root,a.location))aOpens++;
  if(file===path.join(w.root,b.location))bOpens++;return original.call(this,file,...args);};syncBuiltinESMExports();
 try{A.eq(read(w).sourceStatus[0].status,'verified');A.eq(aOpens,0);A.eq(bOpens>0,true);
  console.log('BA1_SUBCASE_START=historical-parent-missing');A.eq(read(w,'historical',old).sourceStatus[0].cause,'MISSING_SOURCE');
  console.log('BA1_SUBCASE_REFUSAL=historical-parent-missing:MISSING_SOURCE');}
 finally{fs.openSync=original;syncBuiltinESMExports();}
});

test('31 lock and replace authority loss, stale replay and current source grant',()=>{
 for(const stage of ['locked','before-replace'])for(const type of ['source','reader','key']){
  const w=world(),sourcePath=path.join(w.root,w.source.location),original=fs.openSync;let opens=0,atRevocation=null;
  fs.openSync=function(file,...args){if(file===sourcePath)opens++;return original.call(this,file,...args);};syncBuiltinESMExports();
  let triggered=false;w.hook=s=>{if(s===stage&&!triggered){triggered=true;atRevocation=opens;
   if(type==='source')policy(w,a=>{a.principals[0].sourceIds=[];});
   if(type==='reader')policy(w,a=>{a.principals[0].operations=['publish'];});
   if(type==='key')policy(w,a=>{a.key='f'.repeat(64);});}};
  try{const p=packet(w);console.log('BA1_SUBCASE_START='+stage+'-'+type);
   const r=w.writer.command('native-human',p);A.eq(triggered,true);A.eq(r.schemaVersion,'3djat.failure.v1');
   A.eq(r.error.evidence,null);A.eq(w.store.read().head.business,null);A.eq(opens,atRevocation);
   console.log('BA1_SUBCASE_REFUSAL='+stage+'-'+type+':'+r.error.code);
  }finally{fs.openSync=original;syncBuiltinESMExports();}
 }
 const w=world(),p=packet(w),first=send(w,p),stale=structuredClone(p);A.eq(w.writer.command('native-human',stale).receipt.path,first.receipt.path);
 const changed=structuredClone(p);changed.input.instructions='Changed';failed('same-key-changed-payload','IDEMPOTENCY_CONFLICT',()=>w.writer.command('native-human',changed));
 policy(w,a=>{a.principals[0].sourceIds=[];});failed('replay-lost-grant','INVALID_SCOPE',()=>w.writer.command('native-human',p));
});

test('32 uncertainty ownership and prior contract compatibility anchors',()=>{
 const w=world(),p=packet(w);let once=false;w.hook=stage=>{if(stage==='after-replace'&&!once){once=true;throw Object.assign(new Error('inert'),{code:'INERT_INTERRUPTION'});}};
 failed('post-replace-uncertainty','EXPORT_PENDING',()=>w.writer.command('native-human',p));A.eq(once,true);
 const receiptCount=w.store.read().records.size;w.hook=()=>{};fs.unlinkSync(path.join(w.root,w.source.location));
 A.eq(w.writer.command('native-human',p).schemaVersion,'3djat.result.v1');A.eq(w.store.read().records.size,receiptCount);
 A.eq([...w.store.read().records.values()].some(x=>x.kind==='business-decision'&&validate('business-decision',x.value).ok),true);
});
