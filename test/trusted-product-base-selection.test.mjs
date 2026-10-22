import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {randomUUID} from 'node:crypto';
import {DomainProducts,readProductDossier} from '../src/domain-products.mjs';
import {world,roots,WORKSPACE,PRODUCT,packet,create,note,proposal,decision,send,read,editPolicy,forgedNote,forgedCreate,forgedProposal,tamperTerminalReceipt,attachmentInput,dossierProposal,dossierDecision} from './fixtures/3djat/trusted-product-base-selection-fixture.mjs';
let assertions=0;const A={equal:(a,b)=>{assertions++;assert.equal(a,b);},deep:(a,b)=>{assertions++;assert.deepEqual(a,b);},
  throws:(fn,code)=>{assertions++;assert.throws(fn,e=>e?.code===code,code);}};
process.on('exit',()=>{console.log('PD1_AUTHORED_ASSERTIONS='+assertions+' ROOTS='+JSON.stringify(roots));if(assertions>220)process.exitCode=1;});
const control=w=>{const r=read(w);A.equal(r.product.record.productId,PRODUCT);return r;};

test('01 signed create without note and strict ordinary result',()=>{const w=world();send(w,create(w));const r=control(w);A.equal(r.product.record.notes.length,0);A.equal(r.product.record.facts.material.state,'unknown');A.deep(r.product.acceptedFacts,r.product.record.facts);A.deep(r.sourceStatus.base,[]);});
test('02 signed create with note, later note and cloned output',()=>{const w=world();send(w,create(w,{productCode:'0007',note:'Original note'}));send(w,note(w));const r=control(w);A.equal(r.product.record.notes.length,2);A.equal(r.product.record.productCode,'0007');r.product.record.workingName='external mutation';A.equal(read(w).product.record.workingName,'Original authored name');});
test('03 signed accepted fact and metadata provenance; pending claim adds nothing',()=>{
  const w=world();send(w,create(w));const p=proposal(w,'workingName',{state:'accepted',value:'Installed name',sourceRefs:[w.ref]});const submitted=send(w,p,w.source);
  A.deep(control(w).sourceStatus.base,[]);send(w,decision(w,submitted.reference));const r=control(w);A.equal(r.product.record.workingName,'Installed name');A.equal(r.sourceStatus.base.length,1);A.deep(r.sourceStatus.base[0].source,w.ref);
  const f=proposal(w);send(w,f,w.source);A.equal(read(w).sourceStatus.base.length,1);send(w,decision(w,send(w,proposal(w,'material'),w.source).reference));A.equal(read(w).product.record.facts.material.state,'accepted');
});
test('04 signed rejection, supersession and correction leave prior installed fact until corrected acceptance',()=>{
  const w=world();send(w,create(w));const a=send(w,proposal(w),w.source);send(w,decision(w,a.reference));const first=control(w).product.record.facts.material.value;
  const b=proposal(w,'material',{state:'accepted',value:'Corrected material',sourceRefs:[w.ref]},a.reference);const br=send(w,b,w.human);
  const d=send(w,decision(w,a.reference,'superseded',{correctedProposal:br.reference,supersedesDecision:w.store.read().records.get(control(w).product.record.facts.material.decision.path).reference}));
  A.equal(control(w).product.record.facts.material.value,first);send(w,decision(w,br.reference));A.equal(control(w).product.record.facts.material.value,'Corrected material');A.equal(d.outputType,'product');
});
test('05 signed rejected claim leaves base and source list unchanged',()=>{const w=world();send(w,create(w));const p=send(w,proposal(w),w.source);send(w,decision(w,p.reference,'rejected'));const r=control(w);A.equal(r.product.record.facts.material.state,'unknown');A.deep(r.sourceStatus.base,[]);});
test('06 native callback mandatory; private bearer cannot replace null native',()=>{const w=world();send(w,create(w));control(w);const bare=new DomainProducts(w.root,{accessFile:w.accessFile});A.throws(()=>bare.resolveBaseProductForOperation(w.human.token,{mode:'new',atHead:w.store.read().reference,productId:PRODUCT}),'INVALID_SCOPE');w.auth=()=>null;A.throws(()=>read(w),'INVALID_SCOPE');});
test('07 native identity, role and product scope intersect current private principal',()=>{const w=world();send(w,create(w));control(w);w.auth=()=>({id:w.human.principalId,role:'conductor',products:[PRODUCT]});A.throws(()=>read(w),'INVALID_SCOPE');w.auth=()=>({id:w.human.principalId,role:'human',products:[]});A.throws(()=>read(w),'INVALID_SCOPE');});
test('08 private role/product mutation after native callback denies',()=>{let armed=false;const w=world({hook:()=>{if(armed){armed=false;editPolicy(w,a=>{a.principals[0].products=[];});}}});send(w,create(w));control(w);armed=true;A.throws(()=>read(w),'INVALID_SCOPE');});
test('09 current head and reachable historical boundary',()=>{const w=world();send(w,create(w));const old=w.store.read().reference;send(w,note(w));control(w);A.equal(read(w,'historical',old).product.record.notes.length,0);A.throws(()=>read(w,'new',old),'REVISION_CONFLICT');A.throws(()=>read(w,'historical',{...old,sha256:'0'.repeat(64)}),'MISSING_SOURCE');});
test('10 private key and caller recheck at return',()=>{let n=0,change=()=>{};const w=world({hook:()=>{if(++n===2)change();}});send(w,create(w));control(w);n=0;change=()=>editPolicy(w,a=>{a.key='a'.repeat(64);});A.throws(()=>read(w),'EVIDENCE_MISMATCH');});
test('11 currently installed local source missing and changed bytes refuse new, remain historical blockers',()=>{
  const w=world();send(w,create(w));const p=send(w,proposal(w),w.source);send(w,decision(w,p.reference));control(w);const head=w.store.read().reference,location=path.join(w.root,w.ref.location),original=fs.readFileSync(location);
  fs.writeFileSync(location,'changed');A.throws(()=>read(w),'HASH_MISMATCH');A.equal(read(w,'historical',head).sourceStatus.base[0].cause,'HASH_MISMATCH');fs.unlinkSync(location);
  A.throws(()=>read(w),'MISSING_SOURCE');A.equal(read(w,'historical',head).sourceStatus.base[0].cause,'MISSING_SOURCE');fs.writeFileSync(location,original);
});
test('12 current source-use revocation refuses new, preserves scoped historical provenance',()=>{
  const w=world();send(w,create(w));const p=send(w,proposal(w),w.source);send(w,decision(w,p.reference));control(w);const head=w.store.read().reference;
  editPolicy(w,a=>{a.principals[0].sourceIds=[];});A.throws(()=>read(w),'INVALID_SCOPE');const s=read(w,'historical',head).sourceStatus.base[0];A.equal(s.status,'unresolved');A.equal(s.cause,'INVALID_SCOPE');
  editPolicy(w,a=>{a.principals[0].products=[];});A.throws(()=>read(w,'historical',head),'INVALID_SCOPE');
});
test('13 extra valid receipt member is refused after signed valid control',()=>{
  const w=world();send(w,create(w));control(w);
  const extra={kind:'evidence',record:{schemaVersion:'3djat.evidence.v1',id:randomUUID(),revision:1,description:'Unrelated extra evidence'}};
  forgedNote(w,{recordsExtra:[extra]});A.throws(()=>read(w),'EVIDENCE_MISMATCH');
});
test('14 invalid action MAC and valid-MAC wrong role are refused',()=>{
  const a=world();send(a,create(a));control(a);forgedNote(a,{macEdit:()=> '0'.repeat(64)});A.throws(()=>read(a),'EVIDENCE_MISMATCH');
  const b=world();send(b,create(b));control(b);forgedNote(b,{role:'source-proposer'});A.throws(()=>read(b),'INVALID_SCOPE');
  const missing=world();send(missing,create(missing));control(missing);forgedNote(missing,{macEdit:()=>undefined});A.throws(()=>read(missing),'INVALID_VALUE');
});
test('15 valid-MAC wrong event and wrong note identity refuse',()=>{
  const a=world();send(a,create(a));control(a);forgedNote(a,{eventEdit:e=>{e.commandHash='0'.repeat(64);}});A.throws(()=>read(a),'EVIDENCE_MISMATCH');
  const b=world();send(b,create(b));control(b);forgedNote(b,{noteEdit:n=>({...n,id:randomUUID()})});A.throws(()=>read(b),'EVIDENCE_MISMATCH');
  const c=world();send(c,create(c));control(c);forgedNote(c,{eventEdit:e=>{e.key=randomUUID();}});A.throws(()=>read(c),'EVIDENCE_MISMATCH');
});
test('16 selected head pending dossier refuses; earlier head remains readable',()=>{
  const w=world();send(w,create(w));const old=w.store.read().reference;control(w);
  const dossier={schemaVersion:'3djat.dossier-proposal.v1',proposalId:randomUUID(),productId:PRODUCT,expectedRevision:1,origin:'human-authored',payload:{kind:'field',field:'description',fact:{state:'accepted',value:'Pending typed text',sourceRefs:[]}},replaces:null,reason:'Authored pending',corrects:null};
  w.store.commit({principal:w.human.principalId,operation:'product.dossier.proposal.submit',key:randomUUID(),expectedHead:old,changes:[],records:[{kind:'dossier-proposal',record:dossier}]});
  A.throws(()=>read(w),'CAPABILITY_UNAVAILABLE');A.equal(read(w,'historical',old).product.record.revision,1);
});
test('17 selected head attachment publication refuses; older base remains readable',()=>{
  const w=world();send(w,create(w));const old=w.store.read().reference;control(w);
  const a={schemaVersion:'3djat.attachment.v1',attachmentId:randomUUID(),productId:PRODUCT,sha256:w.ref.sha256,location:'Attachments/inert.txt',filename:'inert.txt',mime:'text/plain',bytes:1,availability:'unverified',source:w.ref};
  w.store.commit({principal:w.human.principalId,operation:'attachment.register',key:randomUUID(),expectedHead:old,changes:[],records:[{kind:'attachment',record:a}]});
  A.throws(()=>read(w),'CAPABILITY_UNAVAILABLE');A.equal(read(w,'historical',old).product.record.revision,1);
});
test('18 legacy command, review and standalone dossier read remain callable',()=>{const w=world();send(w,create(w));control(w);A.equal(w.writer.readReview(w.human.token,{productId:PRODUCT,atHead:w.store.read().reference}).product.record.productId,PRODUCT);A.equal(w.writer.command(w.human.token,packet(w,'product.read',{productId:PRODUCT,atHead:w.store.read().reference})).outputType,'product');A.equal(readProductDossier(w.root,{productId:PRODUCT,atHead:w.store.read().reference,accessFile:w.accessFile}).product.record.productId,PRODUCT);});
test('19 signed canonical clock control and valid-MAC malformed create without a note',()=>{
  const good=world();send(good,create(good));control(good);
  const bad=world();forgedCreate(bad);A.throws(()=>read(bad),'OUT_OF_BOUNDS');
  const offset=world();forgedCreate(offset,{time:'2026-01-01T01:00:00.000+01:00'});A.throws(()=>read(offset),'OUT_OF_BOUNDS');
  const invalidDate=world();forgedCreate(invalidDate,{time:'2026-02-30T00:00:00.000Z'});A.throws(()=>read(invalidDate),'INVALID_REFERENCE');
});
test('20 malformed product and nested head preflight never call native authentication',()=>{
  let calls=0;const w=world({hook:()=>{calls++;}});send(w,create(w));calls=0;const head=w.store.read().reference;
  for(const [productId,code] of [['not-a-product-uuid','OUT_OF_BOUNDS'],[42,'INVALID_TYPE']]){A.throws(()=>w.writer.resolveBaseProductForOperation(w.human.token,{mode:'new',atHead:head,productId}),code);A.equal(calls,0);}
  const accessor={mode:'new',atHead:head};Object.defineProperty(accessor,'productId',{enumerable:true,get(){throw Error('must not call getter');}});
  A.throws(()=>w.writer.resolveBaseProductForOperation(w.human.token,accessor),'INVALID_VALUE');A.equal(calls,0);
  A.throws(()=>w.writer.resolveBaseProductForOperation(w.human.token,{mode:'new',atHead:{...head,extra:'x'},productId:PRODUCT}),'INVALID_VALUE');A.equal(calls,0);
  const nested={...head};Object.defineProperty(nested,'sha256',{enumerable:true,get(){throw Error('must not call nested getter');}});
  A.throws(()=>w.writer.resolveBaseProductForOperation(w.human.token,{mode:'new',atHead:nested,productId:PRODUCT}),'INVALID_VALUE');A.equal(calls,0);
  w.auth=()=>({id:w.human.principalId,role:'human',products:'*'});
  A.throws(()=>w.writer.resolveBaseProductForOperation(w.human.token,{mode:'new',atHead:head,productId:randomUUID()}),'MISSING_SOURCE');A.equal(calls,1);
});
test('21 hash-consistent receipt payload, order, transition and repetition defects',()=>{
  for(const mutate of [
    r=>{r.payloadHash='0'.repeat(64);},
    r=>{r.records.reverse();},
    r=>{r.transitions=[];},
    r=>{r.records.push(r.records[0]);}
  ]){const w=world();send(w,create(w));control(w);tamperTerminalReceipt(w,mutate);A.throws(()=>read(w),'EVIDENCE_MISMATCH');}
});
test('22 omitted indexed subject differs from unsupported selected publication',()=>{
  const w=world();send(w,create(w));control(w);tamperTerminalReceipt(w,r=>{r.records=r.records.slice(0,1);});A.throws(()=>read(w),'EVIDENCE_MISMATCH');
  const other=world();send(other,create(other));const prior=other.store.read().reference;const dossier=dossierProposal(other,{kind:'field',field:'description',fact:{state:'accepted',value:'Pending',sourceRefs:[]}});send(other,dossier);A.throws(()=>read(other),'CAPABILITY_UNAVAILABLE');A.equal(read(other,'historical',prior).product.record.revision,1);
});
test('23 signed note receipt link, time and installed product link refuse mismatch',()=>{
  for(const fault of ['source','time']){
    const w=world();send(w,create(w));const original=control(w).product.record.sourceReceipt;
    forgedNote(w,{productEdit:p=>{if(fault==='source')p.sourceReceipt=original;else p.notes.at(-1).createdAt='2026-01-02T00:00:00.000Z';}});
    A.throws(()=>read(w),'EVIDENCE_MISMATCH');
  }
  const wrongRevision=world();send(wrongRevision,create(wrongRevision));control(wrongRevision);
  forgedNote(wrongRevision,{evidenceRevision:2});A.throws(()=>read(wrongRevision),'EVIDENCE_MISMATCH');
});
test('24 malformed native results and identity policy changes refuse',()=>{
  const w=world();send(w,create(w));control(w);
  for(const value of [null,[],{id:'x',role:'human',products:'*'},{id:w.human.principalId,role:8,products:'*'}]){w.auth=()=>value;A.throws(()=>read(w),'INVALID_SCOPE');}
  w.auth=()=>({id:w.human.principalId,role:'human',products:[PRODUCT]});control(w);
  let n=0,armed=false;const change=world({hook:()=>{if(armed&&++n===2)editPolicy(change,a=>{a.principals[0].sourceIds=[];});}});
  send(change,create(change));const p=send(change,proposal(change),change.source);send(change,decision(change,p.reference));control(change);
  n=0;armed=true;A.throws(()=>read(change),'INVALID_SCOPE');
});
test('25 productCode and workingName metadata provenance remains installed only by acceptance',()=>{
  const w=world();send(w,create(w));const original=control(w).product.record;
  const pending=send(w,proposal(w,'productCode',{state:'accepted',value:'CODE-3',sourceRefs:[w.ref]}),w.source);
  A.equal(read(w).product.record.productCode,original.productCode);send(w,decision(w,pending.reference,'rejected'));A.equal(read(w).product.record.productCode,null);
  const accepted=send(w,proposal(w,'productCode',{state:'accepted',value:'CODE-4',sourceRefs:[w.ref]}),w.source);send(w,decision(w,accepted.reference));
  const r=control(w);A.equal(r.product.record.productCode,'CODE-4');A.equal(r.sourceStatus.base.length,1);A.equal(r.sourceStatus.base[0].status,'verified');
  const name=send(w,proposal(w,'workingName',{state:'accepted',value:'Name from file',sourceRefs:[w.ref]}),w.source);send(w,decision(w,name.reference));
  A.equal(read(w).sourceStatus.base.length,2);A.equal(read(w).product.record.workingName,'Name from file');
});
test('26 valid pending Drive claim does not install remote source rights',()=>{
  const w=world();send(w,create(w));const {location,...rest}=w.ref;const drive={...rest,kind:'drive',fileId:'authored-drive-file',modifiedAt:'2026-01-01T00:00:00.000Z'};
  const p=proposal(w,'material',{state:'accepted',value:'Remote',sourceRefs:[drive]});
  const submitted=send(w,p,w.source);A.equal(read(w).sourceStatus.base.length,0);
  const result=w.writer.command(w.human.token,decision(w,submitted.reference));A.equal(result.error?.code,'MISSING_SOURCE');
  A.equal(read(w).product.record.facts.material.state,'unknown');
});
test('27 revoked source is rejected before its bytes are opened',()=>{
  const w=world();send(w,create(w));const p=send(w,proposal(w),w.source);send(w,decision(w,p.reference));control(w);
  const head=w.store.read().reference;editPolicy(w,a=>{a.principals[0].sourceIds=[];});const oldRead=w.store.readFile.bind(w.store);let sourceOpens=0;
  w.store.readFile=location=>{if(location===w.ref.location)sourceOpens++;return oldRead(location);};
  A.throws(()=>read(w),'INVALID_SCOPE');A.equal(read(w,'historical',head).sourceStatus.base[0].cause,'INVALID_SCOPE');A.equal(sourceOpens,0);
});
test('28 authentic accepted typed dossier entry refuses current base and leaves old head',()=>{
  const w=world();send(w,create(w));const old=w.store.read().reference;control(w);
  const p=dossierProposal(w,{kind:'entry',entryId:randomUUID(),entryKind:'production',entryType:'production-note',date:'2026-01-01',title:'Inert authored entry',text:'Authored typed entry',attachmentRefs:[],sourceRefs:[]});
  const submitted=send(w,p),pending=w.store.read().reference;A.throws(()=>read(w),'CAPABILITY_UNAVAILABLE');
  send(w,dossierDecision(w,submitted.reference));A.equal(w.store.read().head.products[0].dossier.revision,2);
  A.equal(w.store.read().records.get(w.store.read().head.products[0].dossier.path).value.productionRecords.length,1);
  A.throws(()=>read(w),'CAPABILITY_UNAVAILABLE');A.equal(read(w,'historical',old).product.record.revision,1);
  A.throws(()=>read(w,'historical',pending),'CAPABILITY_UNAVAILABLE');
});
test('29 authentic attachment publication refuses current base and preserves earlier base',()=>{
  const w=world({attachment:true});send(w,create(w));const old=w.store.read().reference;control(w);
  send(w,packet(w,'attachment.register',attachmentInput(w),{revision:0}));
  A.throws(()=>read(w),'CAPABILITY_UNAVAILABLE');A.equal(read(w,'historical',old).product.record.revision,1);
});
test('30 signed proposal time and decision time relationships stay covered',()=>{
  const w=world();send(w,create(w));const p=send(w,proposal(w),w.source);control(w);
  const d=send(w,decision(w,p.reference));const r=control(w);
  const receipt=w.store.read().records.get(d.receipt.path).value;
  A.equal(r.product.record.facts.material.decision.path,receipt.records.find(ref=>ref.path.includes('/proposal-decision/')).path);
  A.equal(w.store.read().records.get(w.store.read().head.products[0].dossier.path).value.sourceReceipt.path.startsWith('Domain/evidence/'),true);
  const malformed=world();send(malformed,create(malformed));control(malformed);forgedProposal(malformed);A.throws(()=>read(malformed),'INVALID_REFERENCE');
});
