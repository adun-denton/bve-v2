import test,{after} from 'node:test';
import rawAssert from 'node:assert/strict';
import {operationSelectionBytes,validateOperationSelection,validateOperationSelectionLinks,validateOperationSelectionFormat} from '../src/operation-selection-format.mjs';
import {fixture,rehash,pendingLinks,commissionedLinks} from './fixtures/operation-selection-fixtures.mjs';

let assertions=0;
const assert=new Proxy(rawAssert,{get(target,key){const f=target[key];return typeof f==='function'?(...args)=>{assertions++;return f(...args);}:f;}});
after(()=>{rawAssert.ok(assertions<=200,`Authored assertion cap: ${assertions}`);process.stdout.write(`AUTHORED_ASSERTIONS=${assertions}\n`);});

function good(x){assert.deepEqual(validateOperationSelection(x.row),{ok:true,authority:'not-established',errors:[]});}
function bad(x,code,path){const r=validateOperationSelection(x.row);assert.equal(r.ok,false,JSON.stringify(r));assert.equal(r.errors[0].code,code,JSON.stringify(r));if(path)assert.equal(r.errors[0].path,path,JSON.stringify(r));}
function mutate(fn,{rehashBody=true,branded=true,withAttachment=false}={}){const x=fixture({branded,withAttachment});fn(x);if(rehashBody)rehash(x.row,x.request);return x;}
function links(x,c,ok,code){const r=validateOperationSelectionLinks(x.row,c);assert.equal(r.ok,ok,JSON.stringify(r));if(code)assert.equal(r.errors[0].code,code,JSON.stringify(r));}

test('01 full closure, old operation and Brand with later unadopted drafts',()=>{
 const x=fixture();good(x);assert.equal(x.row.body.operation.record.revision,1);assert.equal(x.row.body.brand.record.revision,1);
 assert.equal(x.head.revision,8);assert.equal(x.row.body.closure.files.some(f=>f.path==='domain-store.json'),true);
});
test('02 unbranded historical choice and independent later Brand',()=>{good(fixture({branded:false}));good(fixture({laterDrafts:false}));});
test('03 canonical object order, body-only digest and changed payload',()=>{
 const x=fixture(),a=operationSelectionBytes(x.row.body);x.row.body={...Object.fromEntries(Object.entries(x.row.body).reverse())};
 assert.deepEqual(operationSelectionBytes(x.row.body),a);good(x);
 x.row.body.run.intent='different';bad(x,'DIGEST');
});
test('04 mutated embedded operation text with unchanged reference and closure',()=>{good(fixture());bad(mutate(x=>{x.row.body.operation.record.instructions='Altered'}),'HASH_MISMATCH','$/body/operation/record');});
test('05 permission extra key and wrong applicability',()=>{
 good(fixture());
 bad(mutate(x=>{x.row.body.permissionEvidence.extra=true}),'PERMISSION_SHAPE');
 bad(mutate(x=>{x.row.body.permissionEvidence.applicability='editorial'}),'PERMISSION_SHAPE');
});
test('06 invalid server UTC timestamp',()=>{good(fixture());bad(mutate(x=>{x.row.body.createdAt='tomorrow'}),'BODY_SHAPE','$/body');});
test('07 unresolved publication and receipt references',()=>{
 good(fixture());
 bad(mutate(x=>{x.row.body.operation.publication=x.row.body.domainHead}),'UNRESOLVED_PUBLICATION');
 bad(mutate(x=>{x.row.body.operation.receipt=x.row.body.domainHead}),'UNRESOLVED_PUBLICATION');
});
test('08 full run head reference mismatch with equal hash',()=>{
 good(fixture());const x=mutate(x=>{x.row.body.run.domainHead={...x.row.body.run.domainHead,id:'other'};});
 assert.equal(x.row.body.domainHead.id,x.row.body.workspaceId);assert.equal(x.row.body.closure.head.id,x.row.body.workspaceId);bad(x,'RUN_LINK','$/body/run');
});
test('09 unknown closure field',()=>{good(fixture());bad(mutate(x=>{x.row.body.closure.extra=true}),'CLOSURE_SHAPE');});
test('10 referenced head and decision identity and closure hashes',()=>{
 good(fixture());
 bad(mutate(x=>{x.row.body.operation.decision.decisionId=x.row.id}),'HASH_MISMATCH');
 bad(mutate(x=>{x.row.body.closure.files[0].sha256='0'.repeat(64)}),'HASH_MISMATCH');
 bad(mutate(x=>{x.row.body.operation.reference.id='wrong'}),'PERMISSION_LINK','$/body/permissionEvidence/templateIds');
});
test('11 missing and duplicate closure bytes',()=>{
 good(fixture());
 bad(mutate(x=>{x.row.body.closure.files.splice(0,1)}),'MISSING_REFERENCE');
 bad(mutate(x=>{x.row.body.closure.files.push(structuredClone(x.row.body.closure.files.at(-1)))}),'CLOSURE_ORDER');
});
test('12 base facts separate from dossier, no merged extension',()=>{
 const x=fixture();good(x);
 bad(mutate(x=>{x.row.body.product.acceptedFacts.material.value='later'}),'PRODUCT_LINK');
 bad(mutate(x=>{x.row.body.dossier=[{reference:x.row.body.product.reference,record:x.product}]}),'INVALID_REFERENCE');
});
test('13 explicit Brand identity cannot disappear or silently turn off',()=>{
 good(fixture());
 bad(mutate(x=>{x.row.body.brand=null}),'RUN_LINK');
 bad(mutate(x=>{x.row.body.run.brandInstructions='different'}),'BODY_SHAPE','$/body');
 bad(mutate(x=>{x.row.body.brand.reference.id='brand-b'}),'PERMISSION_LINK');
});
test('14 selection, preset and canonical boundaries',()=>{
 good(fixture());
 bad(mutate(x=>{x.row.body.run.selection.unknown=true}),'INVALID_SELECTION');
 bad(mutate(x=>{x.row.body.run.preset='unknown'}),'INVALID_SELECTION');
 bad(mutate(x=>{x.row.body.run.canonical.direction='Follow'}),'BODY_SHAPE','$/body');
});
test('15 one and six candidate bounds; seven refused',()=>{
 good(fixture());
 const six=mutate(x=>{x.row.body.run.canonical.count=6;x.row.body.run.requestedOutputs[0].count=6;x.row.body.run.allowance.primaryAttempts=6;});good(six);
 bad(mutate(x=>{x.row.body.run.canonical.count=7;x.row.body.run.requestedOutputs[0].count=7;x.row.body.run.allowance.primaryAttempts=7;}),'BODY_SHAPE');
});
test('16 source, region, output and parent relations',()=>{
 good(fixture());
 bad(mutate(x=>{x.row.body.run.sources[0].artifact.productId=x.row.id}),'BODY_SHAPE');
 bad(mutate(x=>{x.row.body.run.sources[0].regions=[{space:'normalized-original',x:.9,y:0,w:.2,h:.2,meaning:'out'}]}),'BODY_SHAPE');
 bad(mutate(x=>{x.row.body.run.requestedOutputs[0].role='unknown'}),'INVALID_SCOPE','$/body/run/requestedOutputs');
 bad(mutate(x=>{x.row.body.run.parentArtifacts=[{...x.row.body.run.sources[0].artifact,productId:x.row.id}]}),'BODY_SHAPE');
});
test('17 permission history is data and malformed identifiers are refused',()=>{
 good(fixture());const x=fixture();x.row.body.permissionEvidence.grantFingerprint='1'.repeat(64);rehash(x.row);good(x);
 bad(mutate(x=>{x.row.body.principalId='bad principal'}),'BODY_SHAPE');
 bad(mutate(x=>{x.row.body.permissionEvidence.sourceIds=['z','a']}),'PERMISSION_SHAPE');
});
test('18 request and commissioned reverse-link graph',()=>{
 const x=fixture();links(x,pendingLinks(x),true);links(x,commissionedLinks(x),true);
 const c=commissionedLinks(fixture());c.requests.push({...c.request});links(fixture(),c,false,'REVERSE_LINK');
 const y=fixture(),d=commissionedLinks(y);d.jobs[0].roundId=y.row.id;links(y,d,false,'JOB_LINK');
});
test('19 request digest, phase, missing and duplicate iteration',()=>{
 const x=fixture(),c=pendingLinks(x);c.request.selectionBodySha256='0'.repeat(64);links(x,c,false,'REQUEST_LINK');
 const y=fixture(),d=commissionedLinks(y);d.iterations.push({...d.iteration});links(y,d,false,'ITERATION_LINK');
 const z=fixture(),e=pendingLinks(z);e.rounds.push({requestId:z.request.id});links(z,e,false,'REQUEST_PHASE');
});
test('20 exact format predicate and source-produced conditional kinds stay outside it',()=>{
 for(const features of [['operation-selection.v1'],['historical-import.v1','operation-selection.v1'],['historical-import.v1','png20-experiment.v1','operation-selection.v1']])
  assert.equal(validateOperationSelectionFormat({format:'bve-v2',version:4,features},2).ok,true);
 for(const features of [[],['future'],['operation-selection.v1','historical-import.v1']])
  assert.equal(validateOperationSelectionFormat({format:'bve-v2',version:4,features},2).ok,false);
 assert.equal(validateOperationSelectionFormat({format:'bve-v2',version:4,features:['operation-selection.v1']},1).ok,false);
});
test('21 hostile cyclic and accessor inputs fail closed',()=>{
 const x=fixture();x.row.body.loop=x.row.body;assert.equal(validateOperationSelection(x.row).errors[0].code,'CYCLE');
 const y=fixture();Object.defineProperty(y.row.body,'createdAt',{get(){throw Error('getter called')},enumerable:true});assert.equal(validateOperationSelection(y.row).errors[0].code,'INVALID_VALUE');
});
test('22 canonical base64 and actual file limit checked before decoding',()=>{
 good(fixture());bad(mutate(x=>{x.row.body.closure.files[0].bytes+='='}),'INVALID_BASE64');
 bad(mutate(x=>{x.row.body.closure.files[0].bytes='A'.repeat(Math.ceil(1048576/3)*4+4)}),'OVERSIZE');
});
test('23 independent fixtures and context builders never change origin or siblings',()=>{
 const a=fixture(),b=fixture(),old=structuredClone(a.row.body.run.sources[0].artifact);
 b.row.body.run.sources[0].artifact.productId=b.row.id;assert.deepEqual(a.row.body.run.sources[0].artifact,old);good(a);
 const first=commissionedLinks(a),second=commissionedLinks(a),pending=pendingLinks(a);
 first.request.projectId=a.row.id;first.jobs[0].specification.sources[0].role='changed';
 assert.equal(a.request.state,'waiting-for-conductor');assert.equal(second.request.projectId,a.row.body.projectId);
 assert.equal(pending.request.state,'waiting-for-conductor');links(a,second,true);links(a,pending,true);
});
test('24 numeric principal and session IDs cannot pass through regex coercion',()=>{
 good(fixture());bad(mutate(x=>{x.row.body.principalId=123;x.row.body.permissionEvidence.principalId=123}),'BODY_SHAPE','$/body');
 bad(mutate(x=>{x.row.body.sessionId=123;x.row.body.permissionEvidence.sessionId=123}),'BODY_SHAPE','$/body');
 bad(mutate(x=>{x.row.body.permissionEvidence.grantFingerprint=123}),'PERMISSION_SHAPE');
 assert.equal(validateOperationSelection(mutate(x=>{x.row.body.principalId=123;x.row.body.permissionEvidence.principalId=123}).row).authority,'not-established');
});
test('25 reverse inventories reject full-record disagreement despite matching IDs',()=>{
 const entries=[['requests','request','REVERSE_LINK'],['rounds','round','ROUND_LINK'],['iterations','iteration','ITERATION_LINK'],['allJobs','jobs','JOB_LINK']];
 for(const [array,primary,code] of entries){const x=fixture(),control=commissionedLinks(x);links(x,control,true);
  const c=commissionedLinks(x);c[array][0].projectId=x.row.id;links(x,c,false,code);
 }
});
test('26 complete attachment positive and exact immutable ref mutations',()=>{
 const control=fixture({withAttachment:true});good(control);links(control,pendingLinks(control),true);links(control,commissionedLinks(control),true);
 for(const field of ['id','revision','sha256']){
  const x=mutate(x=>{const r=x.row.body.run.attachments[0].reference;x.row.body.run.attachments[0].reference={...r,[field]:field==='revision'?99:field==='id'?'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb':'1'.repeat(64)};},{withAttachment:true});
  bad(x,'ATTACHMENT_LINK','$/body/run/attachments/0/reference');
 }
});
test('27 attachment missing, foreign product and unlisted product membership',()=>{
 good(fixture({withAttachment:true}));
 const missing=fixture({withAttachment:true});missing.row.body.run.attachments[0].reference.path='Domain/attachment/missing/1.json';rehash(missing.row);bad(missing,'ATTACHMENT_LINK');
 const foreign=fixture({withAttachment:true,attachmentProductId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'});bad(foreign,'ATTACHMENT_LINK');
 const unlisted=fixture({withAttachment:true,attachmentMember:false});bad(unlisted,'ATTACHMENT_LINK');
});
