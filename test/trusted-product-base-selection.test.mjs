import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {randomUUID} from 'node:crypto';
import {DomainProducts} from '../src/domain-products.mjs';
import {world,roots,WORKSPACE,PRODUCT,packet,create,note,proposal,decision,send,read,editPolicy,forgedNote} from './fixtures/3djat/trusted-product-base-selection-fixture.mjs';
let assertions=0;const A={equal:(a,b)=>{assertions++;assert.equal(a,b);},deep:(a,b)=>{assertions++;assert.deepEqual(a,b);},
  throws:(fn,code)=>{assertions++;assert.throws(fn,e=>e?.code===code,code);}};
process.on('exit',()=>console.log('PD1_AUTHORED_ASSERTIONS='+assertions+' ROOTS='+JSON.stringify(roots)));
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
});
test('15 valid-MAC wrong event and wrong note identity refuse',()=>{
  const a=world();send(a,create(a));control(a);forgedNote(a,{eventEdit:e=>{e.commandHash='0'.repeat(64);}});A.throws(()=>read(a),'EVIDENCE_MISMATCH');
  const b=world();send(b,create(b));control(b);forgedNote(b,{noteEdit:n=>({...n,id:randomUUID()})});A.throws(()=>read(b),'EVIDENCE_MISMATCH');
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
test('18 legacy command, review and dossier read remain callable',()=>{const w=world();send(w,create(w));control(w);A.equal(w.writer.readReview(w.human.token,{productId:PRODUCT,atHead:w.store.read().reference}).product.record.productId,PRODUCT);A.equal(w.writer.command(w.human.token,packet(w,'product.read',{productId:PRODUCT,atHead:w.store.read().reference})).outputType,'product');});
