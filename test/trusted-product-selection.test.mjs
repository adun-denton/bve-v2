import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import * as path from 'node:path';
import {randomUUID} from 'node:crypto';
import {digest} from '../src/domain-authority.mjs';
import {DomainProducts,readProductDossier} from '../src/domain-products.mjs';
import {DomainStore} from '../src/domain-store.mjs';
import {world,read,send,create,proposal,decision,packet,field,entry,dossierProposal,dossierDecision,accept,attach,attachmentInput,sourceFile,editPolicy,forgedNote,tamperTerminalReceipt,tamperTerminalHead,signedDossierFault,signedDossierPublication,signedAcceptedDecisionFault,signedAttachment,roots,boundaryRoots,PRODUCT,WORKSPACE} from './fixtures/3djat/trusted-product-selection-fixture.mjs';
let assertions=0;const A={equal:(x,y)=>{assertions++;assert.equal(x,y);},deep:(x,y)=>{assertions++;assert.deepEqual(x,y);},
  throws:(fn,code)=>{assertions++;assert.throws(fn,e=>e?.code===code,code);}};
process.on('exit',()=>{console.log('PD2_AUTHORED_ASSERTIONS='+assertions+' ROOTS='+JSON.stringify(roots)+' BOUNDARY_ROOTS='+JSON.stringify(boundaryRoots));if(assertions>360)process.exitCode=1;});
const ready=w=>{send(w,create(w));const r=read(w);A.equal(r.product.record.productId,PRODUCT);return r;};
const refuses=(label,code,fn)=>{console.log('PD2_SUBCASE_START='+label);A.throws(fn,code);console.log('PD2_SUBCASE_REFUSAL='+label+':'+code);};

test('01 authentic create, note and closed clone',()=>{const w=world();ready(w);send(w,packet(w,'product.note.add',{productId:PRODUCT,text:'A free note'}));const r=read(w);
  A.equal(r.product.record.notes.length,1);A.equal(r.dossier.length,0);A.equal(r.attachments.length,0);A.deep(r.sourceStatus,{base:[],dossier:[],attachments:[]});r.product.record.workingName='mutated';A.equal(read(w).product.record.workingName,'Original authored name');});
test('02 authentic base accepted and pending claim remain distinct',()=>{const w=world();ready(w);const p=send(w,proposal(w),w.source);A.equal(read(w).product.record.facts.material.state,'unknown');
  send(w,decision(w,p.reference));A.equal(read(w).product.record.facts.material.state,'accepted');A.equal(read(w).sourceStatus.base.length,1);});
test('03 authentic source-free description and model software',()=>{const w=world();ready(w);accept(w,field('description','Authored description'));
  accept(w,field('modelingSoftware','Inert CAD'));const r=read(w);A.equal(r.dossier.length,2);A.equal(r.dossier[0].active,true);A.equal(r.dossier[1].record.payload.fact.value,'Inert CAD');A.equal(r.product.record.facts.material.state,'unknown');A.deep(r.sourceStatus.dossier,[]);});
test('04 authentic production cost preserves typed amount and unknown null',()=>{const w=world();ready(w);const first=accept(w,field('productionCost',{amount:'12.50',currency:'USD',unit:'major',per:'item',effectiveDate:'2026-01-01'}));
  accept(w,field('productionCost',null,[],'unknown'),{replaces:first.record.reference});const r=read(w);A.equal(r.dossier.length,2);A.equal(r.dossier[0].active,false);A.equal(r.dossier[1].record.payload.fact.value,null);A.equal(r.dossier[1].active,true);});
test('05 authentic design file attached membership and captured bytes after original directory disappears',()=>{const w=world();ready(w);const a=attach(w);const accepted=accept(w,entry('design','design-file',[a.reference]));const captured=path.join(w.root,a.input.location);
  A.equal(fs.existsSync(captured),true);fs.rmSync(w.sourceRoot,{recursive:true});const r=read(w);A.equal(r.attachments[0].current.status,'available');A.equal(r.dossier[0].record.id,accepted.record.value.id);A.deep(r.product.record.designRevisions[0].references,[accepted.record.reference,a.reference]);A.equal(r.sourceStatus.attachments[0].status,'verified');});
test('06 authentic design revision without opaque file',()=>{const w=world();ready(w);const a=accept(w,entry('design','design-revision'));const r=read(w);A.equal(r.product.record.designRevisions[0].id,a.record.value.id);A.equal(r.dossier[0].active,true);});
test('07 authentic print test production entry',()=>{const w=world();ready(w);accept(w,entry('production','print-test'));const r=read(w);A.equal(r.product.record.productionRecords.length,1);A.equal(r.product.record.productionRecords[0].kind,'production');});
test('08 authentic production note entry',()=>{const w=world();ready(w);accept(w,entry('production','production-note'));A.equal(read(w).product.record.productionRecords[0].references.length,1);});
test('09 authentic finishing process entry',()=>{const w=world();ready(w);accept(w,entry('finishing','finishing-process'));A.equal(read(w).product.record.finishingRecords[0].kind,'finishing');});
test('10 sourced accepted dossier records keep multiplicity and shared status',()=>{const w=world();ready(w);const s=sourceFile(w);accept(w,field('description','Sourced text',[s.ref,s.ref]));const r=read(w);
  A.equal(r.sourceStatus.dossier.length,2);A.deep(r.sourceStatus.dossier[0].source,s.ref);A.equal(r.sourceStatus.dossier[1].status,'verified');});
test('11 pending and rejected proposal never install dossier content',()=>{const w=world();ready(w);const p=send(w,dossierProposal(w,field('description','Pending')));A.equal(read(w).dossier.length,0);
  send(w,dossierDecision(w,p.reference,{outcome:'rejected'}));A.equal(read(w).dossier.length,0);A.equal(read(w).product.record.revision,1);});
test('12 accepted record replacement retains inactive body and current tail',()=>{const w=world();ready(w);const a=accept(w,field('description','Old body'));
  const b=accept(w,field('description','New body'),{replaces:a.record.reference});const r=read(w);A.equal(r.dossier.length,2);A.equal(r.dossier[0].active,false);A.equal(r.dossier[1].active,true);A.deep(r.dossier[1].record.previous,a.record.reference);A.equal(r.dossier[1].record.payload.fact.value,'New body');A.equal(b.record.value.productId,PRODUCT);});
test('13 C01 inactive missing source is a blocker, not a new-read refusal',()=>{const w=world();ready(w);const s=sourceFile(w);const old=accept(w,field('description','Old sourced',[s.ref]));accept(w,field('description','New source-free'),{replaces:old.record.reference});fs.unlinkSync(s.path);
  const r=read(w);A.equal(r.dossier[0].active,false);A.equal(r.dossier[1].active,true);A.equal(r.sourceStatus.dossier[0].status,'unresolved');A.equal(r.sourceStatus.dossier[0].cause,'MISSING_SOURCE');});
test('14 C01 inactive revoked source is preserved without forbidden open',()=>{const w=world();ready(w);const s=sourceFile(w);const old=accept(w,field('description','Old sourced',[s.ref]));accept(w,field('description','New'),{replaces:old.record.reference});
  const original=fs.openSync;let opens=0;fs.openSync=function(file,...args){if(file===s.path)opens++;return original.call(this,file,...args);};syncBuiltinESMExports();
  try{A.equal(read(w).sourceStatus.dossier[0].status,'verified');A.equal(opens>0,true);opens=0;
    editPolicy(w,a=>{a.principals[0].sourceIds=a.principals[0].sourceIds.filter(id=>id!==s.ref.sourceId);});const r=read(w);
    A.equal(r.sourceStatus.dossier[0].cause,'INVALID_SCOPE');A.equal(r.dossier[1].active,true);A.equal(read(w,'historical').sourceStatus.dossier[0].cause,'INVALID_SCOPE');A.equal(opens,0);
  }finally{fs.openSync=original;syncBuiltinESMExports();}});
test('15 active dossier missing source refuses new and blocks historical',()=>{const w=world();ready(w);const s=sourceFile(w);accept(w,field('description','Active sourced',[s.ref]));const head=w.store.read().reference;fs.unlinkSync(s.path);
  A.throws(()=>read(w),'MISSING_SOURCE');A.equal(read(w,'historical',head).sourceStatus.dossier[0].cause,'MISSING_SOURCE');});
test('16 accepted correction requires linked human supersession; no dossier copy',()=>{const w=world();ready(w);const first=accept(w,field('description','Original'));const corrected=send(w,dossierProposal(w,field('description','Corrected'),{corrects:first.proposal,replaces:first.record.reference}));
  const priorDecision=w.store.read().records.get(first.decision.receipt.path).value.records[2];const sup=send(w,dossierDecision(w,first.proposal,{outcome:'superseded',correctedProposal:corrected.reference,supersedesDecision:priorDecision}));
  A.equal(w.store.read().records.get(sup.receipt.path).value.records.length,2);A.equal(read(w).dossier[0].active,true);
  send(w,dossierDecision(w,corrected.reference));const r=read(w);A.equal(r.dossier.length,2);A.equal(r.dossier[0].active,false);A.equal(r.dossier[1].record.payload.fact.value,'Corrected');});
test('17 C02 missing captured bytes is distinct from disappeared original input',()=>{const w=world();ready(w);const a=attach(w),head=w.store.read().reference;fs.rmSync(w.sourceRoot,{recursive:true});A.equal(read(w).attachments[0].current.status,'available');
  fs.unlinkSync(path.join(w.root,a.input.location));A.throws(()=>read(w),'MISSING_SOURCE');A.equal(read(w,'historical',head).attachments[0].current.status,'missing');});
test('18 corrupt captured bytes refuse new and block historical',()=>{const w=world();ready(w);const a=attach(w),head=w.store.read().reference;fs.writeFileSync(path.join(w.root,a.input.location),'different bytes');
  A.throws(()=>read(w),'HASH_MISMATCH');A.equal(read(w,'historical',head).sourceStatus.attachments[0].cause,'HASH_MISMATCH');});
test('19 positive captured byte-open control then revoked source grant causes zero opens',()=>{const w=world();ready(w);const a=attach(w),captured=path.join(w.root,a.input.location),head=w.store.read().reference;
  const original=fs.openSync;let opens=0;fs.openSync=function(file,...args){if(file===captured)opens++;return original.call(this,file,...args);};syncBuiltinESMExports();
  try{A.equal(read(w).attachments[0].current.status,'available');A.equal(opens>0,true);opens=0;editPolicy(w,p=>{p.principals[0].sourceIds=p.principals[0].sourceIds.filter(id=>id!=='authored-files');});
    A.throws(()=>read(w),'INVALID_SCOPE');A.equal(read(w,'historical',head).sourceStatus.attachments[0].cause,'INVALID_SCOPE');A.equal(opens,0);
  }finally{fs.openSync=original;syncBuiltinESMExports();}});
test('20 null native and product scope loss refuse whole lookup',()=>{const w=world();ready(w);w.auth=()=>null;refuses('null-native-reader','INVALID_SCOPE',()=>read(w));
  const x=world();ready(x);editPolicy(x,p=>{p.principals[0].products=[];});refuses('product-policy-loss-historical','INVALID_SCOPE',()=>read(x,'historical',x.store.read().reference));});
test('21 head and key changes at return refuse',()=>{const w=world();ready(w);const current=w.store.read().reference;send(w,packet(w,'product.note.add',{productId:PRODUCT,text:'later'}));refuses('initial-stale-head','REVISION_CONFLICT',()=>read(w,'new',current));
  let armed=false,calls=0;const x=world({hook:()=>{if(armed&&++calls===2)editPolicy(x,p=>{p.key='a'.repeat(64);});}});ready(x);armed=true;refuses('in-call-private-key-rotation','EVIDENCE_MISMATCH',()=>read(x));});
test('22 exact signed dossier receipt refuses extra, omitted, repeated and reordered members',()=>{for(const fault of ['extra','omit','repeat','reorder']){
  const w=world();ready(w);signedDossierFault(w,{[fault]:true});refuses('submit-'+fault,'EVIDENCE_MISMATCH',()=>read(w));}});
test('23 base signed semantic fault and unrelated-product event pollution refuse in full selector',()=>{const w=world();ready(w);forgedNote(w,{recordsExtra:[{kind:'evidence',record:{schemaVersion:'3djat.evidence.v1',id:randomUUID(),revision:1,description:'Inert extra'}}]});refuses('selected-note-extra-evidence','EVIDENCE_MISMATCH',()=>read(w));
  const x=world();ready(x);forgedNote(x,{eventEdit:e=>{e.productId=randomUUID();}});refuses('selected-note-event-claims-other-product','EVIDENCE_MISMATCH',()=>read(x));});
test('24 existing legacy readers and PD1 selector remain callable',()=>{const w=world();ready(w);A.equal(w.writer.readReview(w.human.token,{productId:PRODUCT,atHead:w.store.read().reference}).product.record.productId,PRODUCT);
  A.equal(readProductDossier(w.root,{productId:PRODUCT,atHead:w.store.read().reference,accessFile:w.accessFile}).product.record.productId,PRODUCT);
  A.equal(w.writer.resolveBaseProductForOperation(w.human.token,{mode:'new',atHead:w.store.read().reference,productId:PRODUCT}).productId,PRODUCT);});
test('25 result boundary is a refusal after valid published dossier history',()=>{const w=world({boundary:true});ready(w);const text='\u0001'.repeat(20_000);
  for(let i=0;i<10;i++){const p=field('description',text);const x=accept(w,p,{replaces:w.last??null});w.last=x.record.reference;
    if(i===0)A.equal(x.record.value.payload.fact.value.length,20_000);
    if(i===5)A.equal(read(w).dossier.length,6);}
  A.throws(()=>read(w),'OVERSIZE');});
test('26 current attachment mapping removal blocks historical without opening bytes',()=>{const w=world();ready(w);const a=attach(w),head=w.store.read().reference,captured=path.join(w.root,a.input.location);
  const original=fs.openSync;let opens=0;fs.openSync=function(file,...args){if(file===captured)opens++;return original.call(this,file,...args);};syncBuiltinESMExports();
  try{A.equal(read(w).attachments[0].current.status,'available');A.equal(opens>0,true);opens=0;
  const mapped={};w.writer=new DomainProducts(w.root,{accessFile:w.accessFile,authenticate:t=>w.auth(t),attachmentSources:mapped});
  A.throws(()=>read(w),'INVALID_SCOPE');const r=read(w,'historical',head);A.equal(r.sourceStatus.attachments[0].cause,'INVALID_SCOPE');A.equal(r.attachments[0].current.status,'unavailable');A.equal(opens,0);
  }finally{fs.openSync=original;syncBuiltinESMExports();}});
test('27 configured attachment root remap during one call invalidates measured bytes',()=>{const w=world();ready(w);attach(w);const mapped={'authored-files':{root:w.sourceRoot,products:[PRODUCT]}};let calls=0,armed=false;
  w.writer=new DomainProducts(w.root,{accessFile:w.accessFile,attachmentSources:mapped,authenticate:t=>{if(armed&&++calls===2)mapped['authored-files'].root=path.join(w.dir,'different-inputs');return w.auth(t);}});
  A.equal(read(w).attachments[0].current.status,'available');armed=true;A.throws(()=>read(w),'ROOT_CHANGED');});
test('28 shared local metadata byte budget counts base plus dossier occurrences',()=>{const w=world();ready(w);const s=sourceFile(w,'x'.repeat(960*1024));
  const base=send(w,proposal(w,'material',{state:'accepted',value:'Material',sourceRefs:[s.ref]}),w.source);send(w,decision(w,base.reference));
  accept(w,field('description','Long provenance',Array.from({length:16},()=>s.ref)));accept(w,field('modelingSoftware','Inert CAD',[s.ref]));
  A.throws(()=>read(w),'CAPACITY');});
test('29 malformed descriptor and product UUID refuse before native callback',()=>{const w=world();ready(w);let calls=0;w.auth=()=>{calls++;return {id:w.human.principalId,role:'human',products:[PRODUCT]};};
  const q={mode:'new',atHead:w.store.read().reference,productId:PRODUCT};Object.defineProperty(q,'productId',{get:()=>PRODUCT,enumerable:true});
  refuses('query-accessor-preflight','INVALID_VALUE',()=>w.writer.resolveProductForOperation(w.human.token,q));A.equal(calls,0);
  refuses('query-uuid-preflight','OUT_OF_BOUNDS',()=>w.writer.resolveProductForOperation(w.human.token,{mode:'new',atHead:w.store.read().reference,productId:'not-uuid'}));A.equal(calls,0);});

test('30 signed small-body attachment histories enforce one declared aggregate before fifth captured open',()=>{
  const w=world();ready(w);const data=Buffer.from('Inert captured budget body\n'),sha256=digest(data),input={schemaVersion:'3djat.attachment.v1',attachmentId:randomUUID(),productId:PRODUCT,
    sha256,location:`Products/${PRODUCT}/Sources/${sha256}.bin`,filename:'budget.raw',mime:'application/octet-stream',bytes:data.length,availability:'available',
    source:{kind:'file',sourceId:'authored-files',revision:'r1',sha256,location:'budget.raw',locator:{kind:'section',section:'Inert'},observedAt:'2026-01-01T00:00:00.000Z'}};
  const captured=path.join(w.root,input.location);fs.mkdirSync(path.dirname(captured),{recursive:true});fs.writeFileSync(captured,data);
  signedAttachment(w,input);A.equal(read(w).attachments[0].current.status,'available');
  for(let i=0;i<4;i++)signedAttachment(w,{...structuredClone(input),attachmentId:randomUUID(),bytes:256*1024**2});
  const original=fs.openSync;let opens=0;fs.openSync=function(file,...args){if(file===captured)opens++;return original.call(this,file,...args);};syncBuiltinESMExports();
  try{A.throws(()=>read(w,'historical'),'OUT_OF_BOUNDS');A.equal(opens,4);A.equal(fs.statSync(captured).size,data.length);
    A.equal(data.length+4*256*1024**2>1024**3,true);
  }finally{fs.openSync=original;syncBuiltinESMExports();}
});
test('31 in-call head advance refuses after a valid prior read',()=>{let armed=false,calls=0;const w=world({hook:()=>{if(armed&&++calls===2){armed=false;send(w,packet(w,'product.note.add',{productId:PRODUCT,text:'Return boundary advance'}));}}});ready(w);
  A.equal(read(w).productId,PRODUCT);armed=true;A.throws(()=>read(w),'HEAD_CHANGED');});
test('32 in-call native identity and role changes refuse at return',()=>{for(const [name,change] of [['identity',p=>({...p,id:'other-human'})],['role',p=>({...p,role:'conductor'})]]){
  let armed=false,calls=0;const w=world({hook:()=>{if(armed&&++calls===2){armed=false;w.auth=t=>change(t===w.human.token?{id:w.human.principalId,role:'human',products:[PRODUCT],sourceIds:['authored-source']}:null);}}});ready(w);
  A.equal(read(w).productId,PRODUCT);armed=true;refuses('in-call-native-'+name,'INVALID_SCOPE',()=>read(w));}});
test('33 in-call native product denial and registry refresh refuse',()=>{let armed=false,calls=0;const w=world({hook:()=>{if(armed&&++calls===2){armed=false;w.auth=t=>t===w.human.token?{id:w.human.principalId,role:'human',products:[],sourceIds:['authored-source']}:null;}}});ready(w);
  A.equal(read(w).productId,PRODUCT);armed=true;refuses('in-call-native-product-denial','INVALID_SCOPE',()=>read(w));
  const x=world();ready(x);A.equal(read(x).productId,PRODUCT);editPolicy(x,p=>{p.principals[0].products=[];});refuses('pre-call-private-product-loss','INVALID_SCOPE',()=>read(x));});
test('34 earlier selected head survives later dossier and attachment publications',()=>{const w=world();ready(w);const earlier=w.store.read().reference;accept(w,field('description','Later'));attach(w);
  const old=read(w,'historical',earlier);A.equal(old.dossier.length,0);A.equal(old.attachments.length,0);A.deep(old.head,earlier);});
test('35 local active metadata missing and hash faults differ from historical blockers',()=>{for(const mode of ['missing','hash']){const w=world();ready(w);const s=sourceFile(w),head=accept(w,field('description','Sourced',[s.ref]));
  const selected=w.store.read().reference;if(mode==='missing')fs.unlinkSync(s.path);else fs.writeFileSync(s.path,'Modified inert source');
  const code=mode==='missing'?'MISSING_SOURCE':'HASH_MISMATCH';refuses('active-source-'+mode+'-new',code,()=>read(w));A.equal(read(w,'historical',selected).sourceStatus.dossier[0].cause,code);}});
test('36 dossier accepted materialization and exact decision plans reject isolated faults',()=>{for(const [name,edit] of [
  ['wrong-body',{materialEdit:m=>{m.payload.fact.value='Detached';}}],['detached-product',{productEdit:p=>{p.workingName='Detached';}}],
  ['copied-correction',{recordsEdit:r=>{r.splice(1,0,{kind:'dossier-proposal',record:structuredClone(r[2].record)});}}],
  ['missing-record',{recordsEdit:r=>{r.splice(1,1);}}],['missing-decision-and-record',{recordsEdit:r=>{r.splice(1,2);}}],
  ['reordered',{recordsEdit:r=>{[r[1],r[2]]=[r[2],r[1]];}}],['reordered-evidence',{recordsEdit:r=>{r.push(r.shift());}}],
  ['extra-member',{recordsEdit:r=>{r.push({kind:'evidence',record:{schemaVersion:'3djat.evidence.v1',id:randomUUID(),revision:1,description:'Extra inert evidence'}});}}],
  ['repeated-member',{recordsEdit:r=>{r.splice(2,0,r[1]);}}]]){
  const w=world();ready(w);if(name==='copied-correction')edit.recordsEdit=r=>{r.splice(1,0,{kind:'dossier-proposal',record:w.store.read().records.get(r[2].record.proposal.path).value});};
  signedAcceptedDecisionFault(w,edit);refuses('accepted-'+name,'EVIDENCE_MISMATCH',()=>read(w));}});
test('37 signed dossier proposal timestamp, evidence revision, role and MAC faults refuse',()=>{for(const [name,edit,code] of [
  ['time',{eventEdit:e=>{e.recordedAt='2026-02-30T00:00:00.000Z';}},'INVALID_REFERENCE'],
  ['revision',{auditEdit:a=>{a.revision=2;}},'EVIDENCE_MISMATCH'],
  ['role',{role:'source-proposer'},'INVALID_SCOPE'],
  ['mac',{auditEdit:a=>{const x=JSON.parse(a.description);x.mac='0'.repeat(64);a.description=JSON.stringify(x);}},'EVIDENCE_MISMATCH'],
  ['event',{eventEdit:e=>{e.commandHash='0'.repeat(64);}},'EVIDENCE_MISMATCH'],
  ['event-key',{eventEdit:e=>{e.key='wrong-key';}},'EVIDENCE_MISMATCH'],
  ['event-product',{eventEdit:e=>{e.productId=randomUUID();}},'EVIDENCE_MISMATCH']]){
  const w=world();ready(w);signedDossierPublication(w,dossierProposal(w,field('description','Inert')),{...edit});refuses('submit-'+name,code,()=>read(w));}});
test('38 signed dossier proposal packet CAS and extra receipt member refuse',()=>{for(const [name,edit,code] of [
  ['cas',{p:p=>{p.input.expectedRevision++; }},'REVISION_CONFLICT'],
  ['extra-member',{recordsEdit:r=>{r.push({kind:'evidence',record:{schemaVersion:'3djat.evidence.v1',id:randomUUID(),revision:1,description:'Extra'}});}},'EVIDENCE_MISMATCH']]){
  const w=world();ready(w);const p=dossierProposal(w,field('description','Inert'));edit.p?.(p);signedDossierPublication(w,p,edit);refuses('submit-'+name,code,()=>read(w));}});
test('39 correction stale replacement, source/attachment expansion and isolated missing supersession refuse',()=>{const a=world();ready(a);const first=accept(a,field('description','First'));const p=dossierProposal(a,field('description','Wrong replacement'),{replaces:null});
  signedDossierPublication(a,p);refuses('stale-replacement','EVIDENCE_MISMATCH',()=>read(a));
  const b=world();ready(b);const s=sourceFile(b),q=send(b,dossierProposal(b,field('description','Original',[s.ref])));const extra=sourceFile(b,'Additional source');
  signedDossierPublication(b,dossierProposal(b,field('description','Correction',[s.ref,extra.ref]),{corrects:q.reference}));refuses('correction-source-expansion','EVIDENCE_MISMATCH',()=>read(b));
  const c=world();ready(c);const accepted=accept(c,field('description','First'));const corrected=send(c,dossierProposal(c,field('description','Corrected'),{corrects:accepted.proposal,replaces:accepted.record.reference}));
  signedAcceptedDecisionFault(c,{existingProposal:corrected.reference});refuses('missing-human-supersession-only','EVIDENCE_MISMATCH',()=>read(c));
  const d=world();ready(d);const one=attach(d),two=attach(d),payload=entry('design','design-file',[one.reference]);const original=send(d,dossierProposal(d,payload));
  signedDossierPublication(d,dossierProposal(d,{...payload,attachmentRefs:[one.reference,two.reference]},{corrects:original.reference}));refuses('correction-attachment-expansion','EVIDENCE_MISMATCH',()=>read(d));});
test('40 signed accepted Drive metadata is a historical blocker and new refusal, not ordinary writer acceptance',()=>{const w=world();ready(w);const s=sourceFile(w),drive={kind:'drive',sourceId:s.ref.sourceId,revision:'r1',sha256:s.ref.sha256,
  fileId:'authored-drive-id',modifiedAt:'2026-01-01T00:00:00.000Z',locator:{kind:'section',section:'Inert'},observedAt:'2026-01-01T00:00:00.000Z'};
  signedAcceptedDecisionFault(w,{payload:field('description','Remote provenance',[drive])});const head=w.store.read().reference;
  A.throws(()=>read(w),'CAPABILITY_UNAVAILABLE');A.equal(read(w,'historical',head).sourceStatus.dossier[0].cause,'CAPABILITY_UNAVAILABLE');});
test('41 signed accepted decision eventRef, receipt payload hash and transition faults refuse',()=>{const w=world();ready(w);signedAcceptedDecisionFault(w,{actionRefEdit:r=>{r.sha256='0'.repeat(64);}});
  refuses('accepted-decision-event-reference','EVIDENCE_MISMATCH',()=>read(w));
  const x=world();ready(x);accept(x,field('description','Valid'));A.equal(read(x).dossier.length,1);
  tamperTerminalReceipt(x,r=>{r.payloadHash='0'.repeat(64);});refuses('accepted-decision-payload-hash','EVIDENCE_MISMATCH',()=>read(x));
  const y=world();ready(y);accept(y,field('description','Valid'));tamperTerminalReceipt(y,r=>{r.transitions=[];});refuses('accepted-decision-transition','EVIDENCE_MISMATCH',()=>read(y));});
test('42 active sourced entry and attachment linked positive remain scoped',()=>{const w=world();ready(w);const s=sourceFile(w),a=attach(w),r=accept(w,entry('design','design-file',[a.reference],[s.ref]));const v=read(w);
  A.equal(v.dossier[0].record.id,r.record.value.id);A.deep(v.product.record.designRevisions[0].references,[r.record.reference,a.reference]);A.equal(v.sourceStatus.dossier[0].status,'verified');A.equal(v.attachments[0].current.status,'available');});

test('43 signed nonaccepted dossier decision exact two-member plan refuses extra omitted repeated reordered',()=>{
  for(const [fault,edit] of [
    ['extra',r=>r.push({kind:'evidence',record:{schemaVersion:'3djat.evidence.v1',id:randomUUID(),revision:1,description:'Extra inert evidence'}})],
    ['omitted',r=>r.splice(1,1)],['repeated',r=>r.push(r[1])],['reordered',r=>r.reverse()]]){
    const w=world();ready(w);const control=send(w,dossierProposal(w,field('description','Rejected control')));
    send(w,dossierDecision(w,control.reference,{outcome:'rejected'}));A.equal(read(w).dossier.length,0);
    const proposed=send(w,dossierProposal(w,field('description','Signed nonaccepted'))),p=dossierDecision(w,proposed.reference,{outcome:'rejected'});
    signedDossierPublication(w,p,{recordsEdit:edit});refuses('nonaccepted-'+fault,'EVIDENCE_MISMATCH',()=>read(w));
  }
});
test('44 portable unsafe metadata source path refuses new and historical including inactive C01 material',()=>{
  for(const inactive of [false,true]){
    const w=world();ready(w);const s=sourceFile(w),prior=accept(w,field('description','Sourced',[s.ref]));
    if(inactive)accept(w,field('description','New source-free'),{replaces:prior.record.reference});
    const head=w.store.read().reference;A.equal(read(w).sourceStatus.dossier[0].status,'verified');
    fs.unlinkSync(s.path);fs.mkdirSync(s.path); // Portable wrong file type: Store.safe rejects it before opening.
    refuses('unsafe-'+(inactive?'inactive':'active')+'-new','UNSAFE_PATH',()=>read(w));
    refuses('unsafe-'+(inactive?'inactive':'active')+'-historical','UNSAFE_PATH',()=>read(w,'historical',head));
  }
});
test('45 valid unrelated product publication cannot silently alter selected product pointer',()=>{
  const w=world();ready(w);const earlier=w.store.read().head.products.find(x=>x.productId===PRODUCT).dossier;
  send(w,packet(w,'product.note.add',{productId:PRODUCT,text:'Later selected revision'}));
  const selected=w.store.read().head.products.find(x=>x.productId===PRODUCT).dossier,other=randomUUID();
  w.auth=t=>t===w.human.token?{id:w.human.principalId,role:'human',products:'*',sourceIds:['authored-source','authored-files']}:null;
  send(w,create(w,{productId:other}));A.deep(read(w).product.reference,selected);
  tamperTerminalHead(w,head=>{head.products.find(x=>x.productId===PRODUCT).dossier=earlier;});
  refuses('unrelated-valid-publication-selected-pointer-pollution','EVIDENCE_MISMATCH',()=>read(w));
});
test('46 attachment event MAC and entity CAS0 packet are authenticated independently of product revision',()=>{
  for(const [fault,edit] of [
    ['event',{eventEdit:e=>{e.commandHash='0'.repeat(64);}}],
    ['mac',{auditEdit:a=>{const x=JSON.parse(a.description);x.mac='0'.repeat(64);a.description=JSON.stringify(x);}}],
    ['entity-cas',{entityRevision:2}]]){
    const w=world();ready(w);const genuine=attach(w);A.equal(read(w).attachments[0].current.status,'available');
    A.equal(w.store.read().records.get(w.store.read().head.products.find(x=>x.productId===PRODUCT).dossier.path).value.revision,2);
    signedAttachment(w,attachmentInput(w),edit);
    refuses('attachment-'+fault,'EVIDENCE_MISMATCH',()=>read(w));
  }
});
test('47 source-reader historical scope and per-file local metadata bound in full selection',()=>{
  const w=world();ready(w);accept(w,field('description','Source reader',[w.ref]));const head=w.store.read().reference;
  A.equal(read(w,'historical',head,w.source.token).sourceStatus.dossier[0].status,'verified');
  refuses('source-reader-new-denial','INVALID_SCOPE',()=>read(w,'new',head,w.source.token));
  const x=world();ready(x);const s=sourceFile(x);accept(x,field('description','Bounded source',[s.ref]));const selected=x.store.read().reference;
  A.equal(read(x).sourceStatus.dossier[0].status,'verified');fs.writeFileSync(s.path,Buffer.alloc(1024**2+1,65));
  refuses('one-file-source-limit-new','OVERSIZE',()=>read(x));
  A.equal(read(x,'historical',selected).sourceStatus.dossier[0].cause,'OVERSIZE');
});
test('48 current private product policy refreshed inside native callback refuses at return',()=>{
  let armed=false,calls=0;const w=world({hook:()=>{if(armed&&++calls===2){armed=false;editPolicy(w,a=>{a.principals[0].products=[];});}}});
  ready(w);const s=sourceFile(w);accept(w,field('description','Allowed before callback refresh',[s.ref]));
  A.equal(read(w).sourceStatus.dossier[0].status,'verified');armed=true;
  refuses('in-call-private-product-policy-refresh','INVALID_SCOPE',()=>read(w));
});
