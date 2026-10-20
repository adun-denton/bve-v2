import test from 'node:test';import assert from 'node:assert/strict';import * as fs from 'node:fs';import * as path from 'node:path';import{randomUUID}from'node:crypto';import{pathToFileURL}from'node:url';import{DatabaseSync}from'node:sqlite';
import{DomainProducts,readProductDossier}from'../src/domain-products.mjs';import{prepareRecord,restoreSnapshot,verifySnapshot}from'../src/domain-store.mjs';import{backupCombined,verifyCombined,restoreCombined}from'../src/workspace-backup.mjs';
import{setup,packet,proposal,decision,entry,field,send,ok,fail,read,policy,changePolicy,tinyAttachment,PRODUCT,WORKSPACE,SUBMIT,DECIDE}from'./fixtures/3djat/dossier-fixture.mjs';
const submit=(w,p=proposal(w),who=w.source)=>({packet:p,result:send(w,p,who)});
const accept=(w,r,extra={})=>send(w,decision(w,r.reference??r,'accepted',extra));
const fields=w=>read(w).dossierExtension.fields;

test('group04 minimal create, missing fields and BVE-absent authenticated source/read authoring',t=>{
 const w=setup(t);assert(!fs.existsSync(w.runtime));const before=read(w);assert.equal(before.product.record.notes.length,1);for(const f of Object.values(before.dossierExtension.fields))assert.equal(f.state,'unknown');
 const p=proposal(w),r=send(w,p,w.source);assert.equal(fields(w).description.value,null);assert.equal(read(w).dossierExtension.proposals[0].status,'pending');accept(w,r);assert.equal(fields(w).description.value,'INERT description');
 assert.equal(read(w).dossierExtension.evidenceVerification,'mac-verified');assert.equal(readProductDossier(w.root,{productId:PRODUCT}).dossierExtension.evidenceVerification,'hash-only');assert(!fs.existsSync(w.runtime));
});
test('group05 all scalar fields, explicit unknown/not-applicable and independent payload bytes',t=>{
 const w=setup(t);for(const [name,value]of [['description','متن آزمایشی 🪴'],['modelingSoftware','INERT software'],['productionCost',{amount:'1',currency:'IRT',unit:'toman',per:'item',effectiveDate:'2026-01-01'}]]){const r=submit(w,proposal(w,field(w,name,value))).result;accept(w,r);assert.deepEqual(fields(w)[name].value,value);}
 for(const state of ['unknown','not-applicable']){const prior=fields(w).description.record,p=proposal(w,field(w,'description',null,state),{replaces:prior});accept(w,submit(w,p).result);const f=fields(w).description;assert.equal(f.state,state);assert(f.record&&f.decision);assert.equal(JSON.parse(fs.readFileSync(path.join(w.root,f.record.path))).payload.fact.state,state);}
 assert.deepEqual(Object.keys(read(w).product.record.facts),['dimensions','material','sellingPrice']);
});
test('group06 production-note corrected then human superseded/accepted, pending and rejected preserved',t=>{
 const w=setup(t),o=submit(w,proposal(w,entry(w))),c=proposal(w,{...o.packet.input.payload,text:'INERT corrected'}, {corrects:o.result.reference});const cr=send(w,c);fail(w.writer.command(w.source.token,decision(w,cr.reference)),'INVALID_SCOPE');
 fail(w.writer.command(w.human.token,decision(w,cr.reference)),'EVIDENCE_MISMATCH');send(w,decision(w,o.result.reference,'superseded',{correctedProposal:cr.reference}));accept(w,cr);
 const pending=submit(w,proposal(w,field(w,'modelingSoftware','INERT pending'))).result,rejected=submit(w,proposal(w,field(w,'productionCost',null,'unknown'))).result;send(w,decision(w,rejected.reference,'rejected'));
 const view=read(w).dossierExtension;assert.deepEqual(view.proposals.map(p=>p.status),['superseded','accepted','pending','rejected']);assert.equal(view.records[0].record.payload.text,'INERT corrected');assert.equal(view.records[0].record.proposal.id,c.input.proposalId);assert.equal(view.records[0].record.decision.id,view.decisions[1].record.decisionId);assert(pending.reference);
});
test('group07 five typed content variants with real file/source/attachment references and exact envelopes',t=>{
 const w=setup(t),a=tinyAttachment(w);for(const [kind,type]of [['design','design-file'],['design','design-revision'],['production','print-test'],['production','production-note'],['finishing','finishing-process']]){const p=proposal(w,entry(w,kind,type,[a.reference])),r=send(w,p,w.source);accept(w,r);}
 const d=read(w);assert.equal(d.dossierExtension.records.length,5);for(const r of d.dossierExtension.records){const b=fs.readFileSync(path.join(w.root,r.reference.path));assert.equal(JSON.parse(b).payload.text,r.record.payload.text);assert.deepEqual(r.record.payload.attachmentRefs,[a.reference]);}assert.equal(d.product.record.designRevisions.length,2);assert.equal(d.product.record.productionRecords.length,2);assert.equal(d.product.record.finishingRecords.length,1);
});
test('group08 correcting previously accepted content keeps current materialization until corrected acceptance',t=>{
 const w=setup(t),o=submit(w),od=decision(w,o.result.reference),accepted=send(w,od),old=fields(w).description.record;
 const c=proposal(w,field(w,'description','INERT replacement'),{corrects:o.result.reference,replaces:old}),cr=send(w,c);send(w,decision(w,o.result.reference,'superseded',{supersedesDecision:prepareRecord('dossier-decision',od.input).reference,correctedProposal:cr.reference}));assert.equal(fields(w).description.value,'INERT description');assert.equal(read(w).product.reference.revision,accepted.committedRevision);
 accept(w,cr);assert.equal(fields(w).description.value,'INERT replacement');assert.deepEqual(read(w).dossierExtension.records.map(r=>r.active),[false,true]);
});
test('group09 stale original may be rejected or explicitly corrected at current revision; future claim refuses',t=>{
 const w=setup(t),o=submit(w);send(w,packet(w,'product.note.add',{productId:PRODUCT,text:'Inert revision advance'}));fail(w.writer.command(w.human.token,decision(w,o.result.reference)),'REVISION_CONFLICT');
 const c=proposal(w,field(w,'description','INERT current correction'),{corrects:o.result.reference}),r=send(w,c);send(w,decision(w,o.result.reference,'superseded',{correctedProposal:r.reference}));accept(w,r);
 const p=proposal(w,field(w,'modelingSoftware','INERT'));p.input.expectedRevision++;p.expected.entityRevision++;fail(w.writer.command(w.source.token,p),'REVISION_CONFLICT');
});
test('group10 no-source human authoring versus scoped Conductor extracts and source-only privilege refusals',t=>{
 const w=setup(t),payload=entry(w);payload.sourceRefs=[];const p=proposal(w,payload,{origin:'human-authored'});fail(w.writer.command(w.conductor.token,p),'INVALID_SCOPE');const r=send(w,p);accept(w,r);
 send(w,proposal(w,field(w,'modelingSoftware','INERT')),w.conductor);fail(w.writer.command(w.source.token,packet(w,'product.note.add',{productId:PRODUCT,text:'Inert'})),'INVALID_SCOPE');
 changePolicy(w,w.conductor.principalId,p=>p.sourceIds=[]);fail(w.writer.command(w.conductor.token,proposal(w,field(w,'productionCost',null,'unknown'))),'INVALID_SCOPE');
});
test('group11 source-byte loss blocks new acceptance but not pending/rejection/replay, revoked policy refuses replay',t=>{
 const w=setup(t),a=submit(w),b=submit(w,proposal(w,field(w,'modelingSoftware','INERT')));fs.renameSync(path.join(w.root,w.ref.location),path.join(w.root,'Sources/retained-source.txt'));
 fail(w.writer.command(w.human.token,decision(w,a.result.reference)),'MISSING_SOURCE');assert.deepEqual(w.writer.command(w.source.token,a.packet),a.result);send(w,decision(w,b.result.reference,'rejected'));assert.equal(read(w).dossierExtension.proposals[0].sources[0].status,'unresolved');
 changePolicy(w,w.source.principalId,p=>p.sourceIds=[]);fail(w.writer.command(w.source.token,a.packet),'INVALID_SCOPE');
});
test('group12 stale CAS, duplicates, changed payload and exact committed replay',t=>{
 const w=setup(t),a=submit(w);assert.deepEqual(w.writer.command(w.source.token,a.packet),a.result);const changed=structuredClone(a.packet);changed.input.reason+=' changed';fail(w.writer.command(w.source.token,changed),'IDEMPOTENCY_CONFLICT');
 const duplicate=proposal(w);duplicate.input.proposalId=a.packet.input.proposalId;fail(w.writer.command(w.source.token,duplicate),'IDEMPOTENCY_CONFLICT');const p=proposal(w);p.expected.domainHead.sha256='0'.repeat(64);fail(w.writer.command(w.source.token,p),'HASH_MISMATCH');
 const d=decision(w,a.result.reference),r=send(w,d);assert.deepEqual(w.writer.command(w.human.token,d),r);fail(w.writer.command(w.human.token,decision(w,a.result.reference)),'EVIDENCE_MISMATCH');
});
test('group13 wrong corrected subject/source/replaces/attachments and foreign reference refused',t=>{
 const w=setup(t),a=submit(w);for(const fn of [p=>p.payload.field='modelingSoftware',p=>p.payload.fact.sourceRefs[0].revision='changed',p=>p.replaces=a.result.reference,p=>p.origin='human-authored']){const p=proposal(w,field(w),{corrects:a.result.reference});fn(p.input);fail(w.writer.command(w.human.token,p),'EVIDENCE_MISMATCH');}
 const a1=tinyAttachment(w),o=submit(w,proposal(w,entry(w,'production','production-note',[a1.reference]))),a2=tinyAttachment(w),bad=proposal(w,{...o.packet.input.payload,attachmentRefs:[a2.reference]},{corrects:o.result.reference});fail(w.writer.command(w.human.token,bad),'EVIDENCE_MISMATCH');
 const p=proposal(w,entry(w,'production','print-test',[a.result.reference]));fail(w.writer.command(w.source.token,p),'EVIDENCE_MISMATCH');
});
test('group14 action forgery, foreign principal/subject and MAC tamper never become accepted',t=>{
 const w=setup(t),a=submit(w),p=decision(w,a.result.reference);p.input.humanActionReceipt.sha256='0'.repeat(64);fail(w.writer.command(w.human.token,p),'EVIDENCE_MISMATCH');
 const foreign=decision(w,a.result.reference,'accepted',{},w.source.principalId);fail(w.writer.command(w.human.token,foreign),'EVIDENCE_MISMATCH');
 accept(w,a.result);const wrongKey=path.join(w.dir,'wrong-access.json'),registry=JSON.parse(fs.readFileSync(w.accessFile));registry.key='0'.repeat(64);fs.writeFileSync(wrongKey,JSON.stringify(registry));assert.throws(()=>readProductDossier(w.root,{productId:PRODUCT,accessFile:wrongKey}),e=>e.code==='EVIDENCE_MISMATCH');assert.throws(()=>readProductDossier(w.root,{productId:PRODUCT,accessFile:path.join(w.dir,'absent.json')}));
 assert.equal(readProductDossier(w.root,{productId:PRODUCT}).dossierExtension.evidenceVerification,'hash-only');
});
test('group15 deterministic pre/post publication faults retain roots, truthful uncertainty/real receipt and replay',t=>{
 const w=setup(t),a=submit(w);let stage='before-replace';w.writer=new DomainProducts(w.root,{accessFile:w.accessFile,hook(s){if(s===stage)throw Object.assign(Error('Inert hook'),{code:'EIO'});}});const p=decision(w,a.result.reference),before=w.store.read().reference;fail(w.writer.command(w.human.token,p),'CAPABILITY_UNAVAILABLE');assert.deepEqual(w.store.read().reference,before);stage='after-replace';const result=fail(w.writer.command(w.human.token,p),'EXPORT_PENDING');assert(result.error.evidence);assert.equal(fields(w).description.value,'INERT description');stage=null;ok(w.writer.command(w.human.token,p));assert.equal(read(w).dossierExtension.records.length,1);
});
test('group16 source/policy/attachment recheck immediately before publication prevents late revocation',t=>{
 const w=setup(t),a=tinyAttachment(w),p=submit(w,proposal(w,entry(w,'production','print-test',[a.reference])));let armed=true;w.writer=new DomainProducts(w.root,{accessFile:w.accessFile,hook(stage){if(armed&&stage==='before-replace')fs.renameSync(path.join(w.root,a.record.location),path.join(w.root,a.record.location+'.retained'));}});const before=w.store.read().reference;fail(w.writer.command(w.human.token,decision(w,p.result.reference)),'MISSING_SOURCE');assert.deepEqual(w.store.read().reference,before);armed=false;
 const z=setup(t),q=proposal(z,field(z));z.writer=new DomainProducts(z.root,{accessFile:z.accessFile,hook(stage){if(stage==='before-replace')changePolicy(z,z.source.principalId,p=>p.sourceIds=[]);}});fail(z.writer.command(z.source.token,q),'INVALID_SCOPE');
});
test('group17 preserved pre-extension snapshot, actual old-reader refusal and separate file-only restoration',async t=>{
 const w=setup(t),pre=path.join(w.dir,'pre-extension');w.store.exportTo(pre);verifySnapshot(pre);const a=submit(w);accept(w,a.result);const snapshot=path.join(w.dir,'new-snapshot');w.store.exportTo(snapshot);verifySnapshot(snapshot);const destination=path.join(w.dir,'separate-restored');restoreSnapshot(snapshot,destination);assert.equal(readProductDossier(destination,{productId:PRODUCT}).dossierExtension.fields.description.value,'INERT description');
 const oldSource=process.env.DOSSIER_BASE_SOURCE;assert(oldSource,'Exact pre-extension source required by review run');const {DomainStore:Old}=await import(pathToFileURL(path.join(oldSource,'src/domain-store.mjs')));new Old(pre).read();assert.throws(()=>new Old(snapshot).read(),e=>e.code==='UNSUPPORTED_SCHEMA');assert.equal(new Old(pre).read().reference.revision,2);
});
test('group18 real combined backup/separate restore, event synchronization and incomplete event/attachment refusal',async t=>{
 const w=setup(t,{kernel:true,reserve:2*1024**2}),a=tinyAttachment(w),o=submit(w,proposal(w,entry(w,'design','design-file',[a.reference])));accept(w,o.result);const readPacket=packet(w,'product.read',{productId:PRODUCT,atHead:w.store.read().reference});ok(w.k.productCommand(w.c.human,readPacket));const backup=path.join(w.dir,'combined');await backupCombined(w.runtime,backup);verifyCombined(backup);
 const businessRoot=path.join(w.dir,'restored-business'),runtimeRoot=path.join(w.dir,'restored-runtime');restoreCombined(backup,{businessRoot,runtimeRoot,paths:Object.fromEntries(Object.entries(w.store.workspace.paths).map(([k,v])=>[k,path.join(businessRoot,v)]))});assert.equal(readProductDossier(businessRoot,{productId:PRODUCT}).dossierExtension.records.length,1);
 fs.renameSync(path.join(w.root,a.record.location),path.join(w.root,a.record.location+'.retained'));await assert.rejects(backupCombined(w.runtime,path.join(w.dir,'missing-attachment')),e=>e.code==='INCOMPLETE_BACKUP');fs.renameSync(path.join(w.root,a.record.location+'.retained'),path.join(w.root,a.record.location));
 w.k.close();const db=new DatabaseSync(path.join(w.runtime,'workspace.sqlite'));db.prepare("DELETE FROM records WHERE kind='event' AND id=?").run(read(w).dossierExtension.decisions[0].record.humanActionReceipt.id);db.close();await assert.rejects(backupCombined(w.runtime,path.join(w.dir,'missing-event')),e=>e.code==='INCOMPLETE_BACKUP');
});
