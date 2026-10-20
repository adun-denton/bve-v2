import test from 'node:test';import assert from 'node:assert/strict';
import {validate,validateCommand} from '../src/contracts/3djat.mjs';import {validateTemplateQuery} from '../src/domain-templates.mjs';
import {template,W,P} from './fixtures/3djat/template-registry-fixture.mjs';
test('C1 group01 frozen scalars and closed query shapes retain exact compatibility',()=>{
 const ref={id:W,revision:1,path:'head.json',sha256:'0'.repeat(64)};
 for(const version of [1,6,7,8]){const id=`aaaaaaaa-aaaa-${version}aaa-8aaa-aaaaaaaaaaaa`;assert(validateCommand({schemaVersion:'3djat.command.v1',operation:'product.create',key:'scalar',expected:{domainHead:ref,entityRevision:0},input:{productId:id,workingName:'Inert',productCode:null}}).ok);}
 assert(!validateCommand({schemaVersion:'3djat.command.v1',operation:'product.create',key:'scalar',expected:{domainHead:ref,entityRevision:0},input:{productId:P.toUpperCase(),workingName:'Inert',productCode:null}}).ok);
 for(const extra of [{tool:'shell'},{approved:true}])assert(!validate('template',{...template(),...extra}).ok);
 const q={schemaVersion:'3djat.template-query.v1',kind:'discovery',atHead:ref,productId:P,applicability:'artistic',branded:true,brandTemplateId:'brand-a'};assert.deepEqual(validateTemplateQuery(q),q);
 for(const extra of [{brandTemplateId:null},{branded:false},{role:'human'}])assert.throws(()=>validateTemplateQuery({...q,...extra}));
 assert.throws(()=>validateTemplateQuery({...q,productId:P.toUpperCase()}));
});
