import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync}from'node:fs';import{createHash}from'node:crypto';
import {validate,validateCommand,CONTRACT_SHAPES,COMMANDS}from'../src/contracts/3djat.mjs';import{decisionActionReference}from'../src/domain-products.mjs';
const U='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',R={id:U,revision:1,path:'Domain/inert.json',sha256:'0'.repeat(64)};
const source={kind:'file',sourceId:'inert',revision:'r1',sha256:'1'.repeat(64),location:'Sources/inert.txt',locator:{kind:'page',page:1},observedAt:'2026-01-01T00:00:00.000Z'};
const prop=()=>({schemaVersion:'3djat.dossier-proposal.v1',proposalId:U,productId:U,expectedRevision:1,origin:'source-extract',payload:{kind:'field',field:'description',fact:{state:'accepted',value:'INERT',sourceRefs:[source]}},replaces:null,reason:'Inert',corrects:null});
const command=(operation,input)=>({schemaVersion:'3djat.command.v1',operation,key:'inert',expected:{domainHead:R,entityRevision:1},input});
test('group01 frozen product/five-field schemas, old command metadata and C1 remain byte compatible',()=>{
 const frozen=JSON.parse(readFileSync(new URL('./fixtures/3djat/dossier-frozen-contracts.json',import.meta.url)));
 const digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');for(const[k,v]of Object.entries(frozen.shapes))assert.equal(digest(CONTRACT_SHAPES[k]),v,k);
 for(const[k,v]of Object.entries(frozen.commands))assert.equal(digest(COMMANDS[k]),v,k);
});
test('group02 C01 exact UUID versions6/7/8 lowercase, closed scalar/price/source/entry bounds',()=>{
 for(const n of ['6','7','8']){const p=prop();p.proposalId=`aaaaaaaa-aaaa-${n}aaa-8aaa-aaaaaaaaaaaa`;assert(validate('dossier-proposal',p).ok);}
 for(const fn of[p=>p.proposalId=U.toUpperCase(),p=>p.payload.extra=true,p=>p.payload.fact.sourceRefs=[],p=>p.payload.fact.value='x'.repeat(20001),p=>p.payload={kind:'entry',entryId:U,entryKind:'design',entryType:'print-test',date:'2026-01-01',title:'Inert',text:'Inert',attachmentRefs:[],sourceRefs:[source]}]){const p=prop();fn(p);assert(!validate('dossier-proposal',p).ok);}
 const p=prop();p.payload={kind:'field',field:'productionCost',fact:{state:'accepted',value:{amount:'1',currency:'IRT',unit:'toman',per:'item',effectiveDate:'2026-01-01'},sourceRefs:[source]}};assert(validate('dossier-proposal',p).ok);p.payload.fact.value.unit='rial';assert(!validate('dossier-proposal',p).ok);
 assert(!validateCommand(command('product.dossier.proposal.submit',prop()),{authenticatedCaller:'worker'}).ok);
});
test('group03 C02 canonical action excludes only new humanActionReceipt and preserves old helper hash',()=>{
 const x={schemaVersion:'3djat.dossier-decision.v1',decisionId:U,productId:U,proposal:R,expectedRevision:1,outcome:'accepted',reason:'Inert',decidedAt:'2026-01-01T00:00:00.000Z',humanActionReceipt:R,supersedesDecision:null,correctedProposal:null},p=command('product.dossier.proposal.decide',x),get=packet=>decisionActionReference({workspaceId:U,principalId:'inert',packet});const a=get(p),q=structuredClone(p);q.input.humanActionReceipt={...R,sha256:'1'.repeat(64)};assert.deepEqual(get(q),a);q.input.reason+='changed';assert.notDeepEqual(get(q),a);
 for(const mutate of[q=>q.input.productId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',q=>q.expected.entityRevision++,q=>q.key+='x',q=>q.input.proposal.sha256='2'.repeat(64)]){const q=structuredClone(p);mutate(q);assert.notDeepEqual(get(q),a);}
 const old=structuredClone(p);old.operation='product.proposal.decide';old.input.schemaVersion='3djat.proposal-decision.v1';assert.deepEqual(get(old),JSON.parse(readFileSync(new URL('./fixtures/3djat/dossier-old-helper.json',import.meta.url))));
});
