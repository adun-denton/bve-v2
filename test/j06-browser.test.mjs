// Disposable browser journey. A missing local browser is a capability failure,
// not a green skip and not a claim about the intended machine.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {createRequire} from 'node:module';
import {serve} from '../src/server.mjs';
import {provisionProductPrincipal,readProductDossier} from '../src/domain-products.mjs';
import {setup,proposal,field,PRODUCT,WORKSPACE} from './fixtures/3djat/dossier-fixture.mjs';

const require=createRequire(import.meta.url);
function browserDriver(){
  try{return require('playwright').chromium;}catch{
    const root=process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES;
    if(!root)throw Error('BROWSER_UNAVAILABLE: locked Playwright dependency is unavailable');
    return createRequire(path.join(root,'package.json'))('playwright').chromium;
  }
}
test('J06 Example1 authored browser: product, correction, decision, cold reopen and board link',{timeout:90000},async t=>{
  const chromium=browserDriver(),executable=process.env.BVE_BROWSER_EXECUTABLE??chromium.executablePath();
  assert.ok(fs.existsSync(executable),'BROWSER_UNAVAILABLE: no supported local browser executable at '+executable);
  const w=setup(t,{kernel:true,reserve:3*1024**2});
  provisionProductPrincipal(w.accessFile,{workspaceId:WORKSPACE,id:'bve-human',role:'human',products:'*',sourceIds:['inert-source']});
  w.k.close();let app=await serve({root:w.runtime,port:0,products:{accessFile:w.accessFile}});w.k=app.kernel;
  let browser,context,page;
  try{
  browser=await chromium.launch({headless:true,executablePath:executable,timeout:20000,args:['--no-sandbox','--disable-dev-shm-usage']});
  const shots=process.env.J06_BROWSER_EVIDENCE??path.join(w.dir,'browser-evidence');fs.mkdirSync(shots,{recursive:true});
  context=await browser.newContext({viewport:{width:1280,height:900}});page=await context.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(app.origin+'/products.html');
    await page.getByRole('button',{name:/Authored concept only/}).waitFor();
    assert.match(await page.locator('#product-list').textContent(),/0 imported photo/);
    await page.getByRole('button',{name:'New product'}).click();
    await page.getByLabel('Working name').fill('گلدان بدون کد 🪴');
    await page.getByLabel('Notes (optional)').fill('یادداشت فارسی');
    await page.getByRole('button',{name:'Create product'}).click();
    await page.getByRole('heading',{name:'گلدان بدون کد 🪴'}).waitFor();
    assert.match(await page.locator('#product-code').textContent(),/no code/);
    assert.match(await page.locator('#facts').textContent(),/Unknown/);
    await page.screenshot({path:path.join(shots,'01-code-less-information.png'),fullPage:true});
    assert.equal(w.k.read(w.c.human,'request').length,0);assert.equal(w.k.read(w.c.human,'round').length,0);
    assert.equal(w.k.read(w.c.human,'job').length,0);assert.equal(w.k.read(w.c.human,'artifact').length,0);
    await page.getByRole('button',{name:'← Products'}).click();
    await page.getByRole('button',{name:/Authored concept only/}).click();
    const proposed=w.writer.command(w.source.token,proposal(w,field(w,'description','پیشنهاد اولیه')));
    assert.equal(proposed.schemaVersion,'3djat.result.v1',JSON.stringify(proposed));
    await page.reload();await page.getByText('پیشنهاد اولیه').waitFor();
    await page.getByRole('button',{name:'Edit proposal'}).click();
    await page.getByLabel('Corrected value').fill('شرح اصلاح شده');
    await page.getByLabel('Reason for correction').fill('Corrected from the original source wording');
    await page.getByRole('button',{name:'Save correction'}).click();
    await page.getByRole('status').filter({hasText:'Decision recorded.'}).waitFor();
    await page.getByText('شرح اصلاح شده').waitFor();
    assert.match(await page.locator('#proposals').textContent(),/superseded/);
    await page.getByRole('button',{name:'Accept',exact:true}).click();
    await page.getByRole('status').filter({hasText:'Decision recorded.'}).waitFor();
    await page.getByText('شرح اصلاح شده').first().waitFor();
    assert.match(await page.locator('#facts').textContent(),/شرح اصلاح شده/);
    const accepted=readProductDossier(w.root,{productId:PRODUCT}).dossierExtension.records[0].reference;
    const later=w.writer.command(w.source.token,proposal(w,field(w,'description','Proposal to reject'),{replaces:accepted}));
    assert.equal(later.schemaVersion,'3djat.result.v1',JSON.stringify(later));
    await page.reload();await page.getByText('Proposal to reject').waitFor();
    await page.getByRole('button',{name:'Reject',exact:true}).click();
    await page.getByRole('status').filter({hasText:'Decision recorded.'}).waitFor();
    await page.getByText('rejected').first().waitFor();
    assert.match(await page.locator('#facts').textContent(),/شرح اصلاح شده/);
    await page.getByRole('button',{name:'Development History'}).click();
    assert.match(await page.locator('#history-list').textContent(),/Product decision|Dossier decision/);
    await page.screenshot({path:path.join(shots,'02-history.png'),fullPage:true});
    await page.getByRole('button',{name:'Photos & Content'}).click();
    await page.getByText('No retained imported photos.',{exact:true}).waitFor();
    assert.match(await page.locator('#photo-list').textContent(),/No retained imported photos/);
    fs.renameSync(path.join(w.root,'Sources/inert.txt'),path.join(w.root,'Sources/inert.txt.retained'));
    await page.reload();await page.getByRole('button',{name:'Product Information'}).click();
    assert.match(await page.locator('#proposals').textContent(),/unresolved/);
    await page.getByRole('button',{name:'Prepare operation'}).click();
    await page.locator('#operation-list').getByText(/Operation discovery unavailable/).waitFor();
    assert.match(await page.locator('#operation-list').textContent(),/unavailable/i);
    assert.equal(w.k.read(w.c.human,'request').length,0);
    const direct=page.url();
    await page.setViewportSize({width:390,height:780});await page.screenshot({path:path.join(shots,'03-narrow-preparation.png'),fullPage:true});
    await context.close();await app.stop();
    const fileOnly=readProductDossier(w.root,{productId:PRODUCT,accessFile:w.accessFile});
    assert.equal(fileOnly.dossierExtension.fields.description.value,'شرح اصلاح شده');
    app=await serve({root:w.runtime,port:0,products:{accessFile:w.accessFile}});w.k=app.kernel;
    context=await browser.newContext({viewport:{width:390,height:780}});page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
    await page.goto(app.origin+new URL(direct).pathname+new URL(direct).hash);
    await page.getByRole('heading',{name:'Authored concept only'}).waitFor();
    await page.getByRole('button',{name:'Product Information'}).focus();await page.keyboard.press('Enter');
    assert.match(await page.locator('#facts').textContent(),/شرح اصلاح شده/);
    await page.getByRole('link',{name:'Open visual board'}).click();
    await page.waitForURL(/#project=/);assert.match(page.url(),/page=board/);
    assert.deepEqual(errors,[]);
    fs.writeFileSync(path.join(shots,'result.json'),JSON.stringify({authoredOnly:true,coldFileRead:true,requests:0,rounds:0,jobs:0,artifacts:0,shots:3},null,2));
  }finally{await context?.close().catch(()=>{});await browser?.close();await app.stop();}
});


test('J06 browser: structured edits, stale/uncertain recovery, retained input and adopted Brand preparation',{timeout:120000},async t=>{
  const {Kernel}=await import('../src/kernel.mjs');
  const {randomUUID,createHash}=await import('node:crypto');
  const {DomainTemplates,configureTemplateGrant,templateDecisionActionReference}=await import('../src/domain-templates.mjs');
  const {packet}=await import('./fixtures/3djat/dossier-fixture.mjs');
  const {png}=await import('./fixtures/3djat/import-fixture.mjs');
  const w=setup(t,{reserve:6*1024**2});
  const sourceRoot=path.join(w.dir,'authored-photos');fs.mkdirSync(sourceRoot);
  const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
  provisionProductPrincipal(w.accessFile,{workspaceId:WORKSPACE,id:'bve-human',role:'human',products:'*',sourceIds:['inert-source']});
  const grant={templateIds:['operation-photo','brand-photo'],appliesTo:['artistic'],operations:['read','ingest','adopt'],sourceIds:[]};
  configureTemplateGrant(w.accessFile,{workspaceId:WORKSPACE,principalId:'bve-human',role:'human',grant,expectedSha256:hash(fs.readFileSync(w.accessFile)),confirmedQuiescent:true});
  const options={products:{accessFile:w.accessFile},templates:{accessFile:w.accessFile},imports:{sources:{'authored-png':sourceRoot}},operations:true};
  w.k=new Kernel(w.runtime,{workspace:w.config,expectedHead:w.store.read().reference,...options});
  w.c=JSON.parse(fs.readFileSync(path.join(w.runtime,'credentials.json')));
  const result=r=>{assert.equal(r.schemaVersion,'3djat.result.v1',JSON.stringify(r));return r;};
  result(w.k.productCommand(w.c.human,packet(w,'product.read',{productId:PRODUCT,atHead:w.store.read().reference})));
  for(const kind of ['operation','brand']){
    const template={schemaVersion:'3djat.template.v1',templateId:kind+'-photo',revision:1,title:'Authored '+kind,kind,appliesTo:['artistic'],instructions:'Authored instructions only.',inputs:kind==='operation'?[{role:'base',kind:'verified-image',required:true}]:[],allowedChanges:['background'],outputs:kind==='operation'?[{role:'candidate',format:'image/png'}]:[],sourceRefs:[],supersedes:null};
    const ref=result(w.k.templateCommand(w.c.human,{schemaVersion:'3djat.command.v1',operation:'template.ingest',key:randomUUID(),expected:{domainHead:w.store.read().reference,entityRevision:0},input:template})).reference;
    const input={schemaVersion:'3djat.template-decision.v1',decisionId:randomUUID(),template:ref,action:'adopt',purpose:'Authored test only',appliesTo:['artistic'],expectedRevision:0,experiment:null,outputs:[],evidenceReceipt:null,humanActionReceipt:{id:'placeholder',revision:1,path:'placeholder.json',sha256:'0'.repeat(64)},decidedAt:'2026-01-01T00:00:00.000Z',supersedesDecision:null,reason:'Fixture adoption, not real human approval'};
    const adopt={schemaVersion:'3djat.command.v1',operation:'template.adopt',key:randomUUID(),expected:{domainHead:w.store.read().reference,entityRevision:0},input};
    input.humanActionReceipt=templateDecisionActionReference({workspaceId:WORKSPACE,principalId:'bve-human',packet:adopt});result(w.k.templateCommand(w.c.human,adopt));
  }
  const originals=[];
  for(let i=0;i<4;i++){
    const bytes=png({width:8+i,metadata:false}),filename=i===0?'original-'+('نام-طولانی-'.repeat(9))+'.png':'authored-frame-'+i+'.png';
    fs.writeFileSync(path.join(sourceRoot,filename),bytes);originals.push({filename,sha256:hash(bytes)});
    const input={schemaVersion:'3djat.historical-import.v1',importId:randomUUID(),productId:PRODUCT,origin:'import',kind:i===3?'historical-creative':'historical-base',filename,
      source:{kind:'file',sourceId:'authored-png',revision:'r1',sha256:hash(bytes),location:filename,locator:{kind:'section',section:'Authored'},observedAt:'2026-01-01T00:00:00.000Z'},sha256:hash(bytes),encodedBytes:bytes.length,format:'image/png',width:8+i,height:6,bitDepth:8,interlaced:false,historicalParent:null,historicalApproval:null,importedAt:'2026-01-01T00:00:00.000Z'};
    const staged=result(w.k.assetCommand(w.c.human,{schemaVersion:'3djat.command.v1',operation:'asset.import.stage',key:randomUUID(),expected:{domainHead:w.store.read().reference,entityRevision:0},input}));
    result(w.k.assetCommand(w.c.human,{schemaVersion:'3djat.command.v1',operation:'asset.import.commit',key:randomUUID(),expected:{domainHead:w.store.read().reference,entityRevision:1},input:{importId:input.importId,stageReceipt:staged.receipt,sha256:input.sha256}}));
  }
  const money=(amount,currency='IRT')=>({amount,currency,unit:currency==='IRT'?'toman':'major',per:'item',effectiveDate:'2026-01-01'});
  const base=packet(w,'product.proposal.submit',{schemaVersion:'3djat.proposal.v1',proposalId:randomUUID(),productId:PRODUCT,expectedRevision:1,changes:[{field:'dimensions',fact:{state:'accepted',value:{length:10,width:20,height:30,unit:'cm'},sourceRefs:[w.ref]}},{field:'sellingPrice',fact:{state:'accepted',value:money('25000.50'),sourceRefs:[w.ref]}}],reason:'Authored dimensions and price',corrects:null});
  result(w.writer.command(w.source.token,base));
  w.k.close();let app=await serve({root:w.runtime,port:0,...options});w.k=app.kernel;
  const chromium=browserDriver();let browser,context,page;const errors=[],mutations=[];
  const shots=path.join(process.env.J06_BROWSER_EVIDENCE??path.join(w.dir,'browser-evidence'),'structured');fs.mkdirSync(shots,{recursive:true});
  try{
    browser=await chromium.launch({headless:true,executablePath:process.env.BVE_BROWSER_EXECUTABLE??chromium.executablePath(),timeout:20000,args:['--no-sandbox','--disable-dev-shm-usage']});
    context=await browser.newContext({viewport:{width:1280,height:900}});page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));
    page.on('request',r=>{if(r.method()==='POST')mutations.push({url:new URL(r.url()).pathname,body:r.postDataJSON()});});
    const open=async()=>{const target=app.origin+'/products.html#product='+PRODUCT+'&tab=information';if(page.url()===target)await page.reload();else await page.goto(target);await page.getByRole('heading',{name:'Authored concept only'}).waitFor();};
    const recorded=()=>page.getByRole('status').filter({hasText:'Decision recorded.'}).waitFor();
    await open();await page.getByRole('button',{name:'Edit proposal'}).click();
    const dimensions=page.locator('fieldset').nth(0),price=page.locator('fieldset').nth(1);
    await dimensions.getByLabel('Length',{exact:true}).fill('15.25');
    await price.getByLabel('Amount (decimal)',{exact:true}).fill('30000.125');
    assert.equal(await price.getByLabel('Currency',{exact:true}).inputValue(),'IRT');
    assert.equal(await price.getByLabel('Monetary unit',{exact:true}).inputValue(),'toman');
    await page.getByLabel('Reason for correction').fill('اصلاح اندازه و قیمت');
    // Authored receipt-free rejection before dispatch, after the correction was saved.
    let rejectLink=true;await page.route('**/api/product',async route=>{
      const command=route.request().postDataJSON();
      if(rejectLink&&command.input.outcome==='superseded'){
        rejectLink=false;await route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({schemaVersion:'3djat.failure.v1',operation:command.operation,key:command.key,error:{code:'REVISION_CONFLICT',evidence:null}})});
      }else await route.continue();
    });
    await page.getByRole('button',{name:'Save correction'}).click();
    await page.getByRole('button',{name:'Reread and acknowledge rejection'}).click();
    await page.getByRole('status').filter({hasText:'Rejected action retained'}).waitFor();
    await page.unroute('**/api/product');
    await page.getByRole('button',{name:'Link saved correction to original'}).click();await recorded();
    let read=readProductDossier(w.root,{productId:PRODUCT,accessFile:w.accessFile});
    assert.equal(read.product.record.facts.dimensions.state,'unknown');
    const reviewed=w.writer.readReview(w.human.token,{productId:PRODUCT,atHead:w.store.read().reference});
    assert.equal(reviewed.proposals.length,2);assert.equal(reviewed.proposals[0].status,'superseded');
    assert.equal(reviewed.proposals[1].status,'pending');assert.deepEqual(reviewed.proposals[1].record.changes[0].fact.sourceRefs,[w.ref]);
    await page.screenshot({path:path.join(shots,'01-structured-pending.png'),fullPage:true});
    await page.getByRole('button',{name:'Accept',exact:true}).click();await recorded();
    read=readProductDossier(w.root,{productId:PRODUCT,accessFile:w.accessFile});
    assert.equal(read.product.record.facts.dimensions.value.length,15.25);assert.equal(read.product.record.facts.dimensions.value.unit,'cm');
    assert.equal(read.product.record.facts.sellingPrice.value.amount,'30000.125');assert.equal(read.product.record.facts.sellingPrice.value.currency,'IRT');
    result(w.writer.command(w.source.token,proposal(w,field(w,'productionCost',money('0.00')))));
    await open();await page.getByRole('button',{name:'Edit proposal'}).click();
    await page.getByLabel('Amount (decimal)').fill('1200.75');await page.getByLabel('Reason for correction').fill('Corrected production cost');
    await page.getByRole('button',{name:'Save correction'}).click();await recorded();
    assert.equal(readProductDossier(w.root,{productId:PRODUCT}).dossierExtension.fields.productionCost.state,'unknown');
    await page.getByRole('button',{name:'Accept',exact:true}).click();await recorded();
    assert.equal(readProductDossier(w.root,{productId:PRODUCT}).dossierExtension.fields.productionCost.value.amount,'1200.75');
    // A real current-head conflict occurs after the browser's decision reference is prepared.
    result(w.writer.command(w.source.token,proposal(w,field(w,'modelingSoftware','Authored pending tool'))));
    await open();let staleOnce=true;
    await page.route('**/api/product',async route=>{
      if(staleOnce&&route.request().postDataJSON().operation==='product.dossier.proposal.decide'){
        staleOnce=false;result(w.writer.command(w.human.token,packet(w,'product.note.add',{productId:PRODUCT,text:'Concurrent authored note'})));
      }
      await route.continue();
    });
    await page.getByRole('button',{name:'Accept',exact:true}).click();
    await page.getByRole('button',{name:'Reread and acknowledge rejection'}).waitFor();
    const stalePacket=mutations.filter(x=>x.url==='/api/product').at(-1).body;
    assert.match(await page.locator('#pending-actions').textContent(),/definite no-effect rejection/);
    await page.getByRole('button',{name:'Reread and acknowledge rejection'}).click();
    await page.getByRole('status').filter({hasText:'Rejected action retained'}).waitFor();
    await page.unroute('**/api/product');
    await page.getByRole('button',{name:'Reject',exact:true}).click();await recorded();
    const freshPacket=mutations.filter(x=>x.url==='/api/product').at(-1).body;assert.notEqual(freshPacket.key,stalePacket.key);
    // Drop only the reply after a real committed decision. Reconciliation must replay the exact packet.
    result(w.writer.command(w.source.token,proposal(w,field(w,'description','Uncertain reply authored description'))));
    await open();let dropped=false;
    await page.route('**/api/product',async route=>{
      if(!dropped&&route.request().postDataJSON().operation==='product.dossier.proposal.decide'){
        dropped=true;const response=await route.fetch();assert.equal(response.status(),200);await route.abort('failed');
      }else await route.continue();
    });
    await page.getByRole('button',{name:'Accept',exact:true}).click();
    await page.getByRole('button',{name:'Reconcile this exact action'}).waitFor();
    const uncertainPacket=mutations.filter(x=>x.url==='/api/product').at(-1).body;
    const uncertainKeys=await page.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('3djat:action:')).map(k=>JSON.parse(localStorage[k])).filter(x=>x.status==='requires-review').map(x=>x.command.key));
    assert.deepEqual(uncertainKeys,[uncertainPacket.key]);
    const decisionsBefore=readProductDossier(w.root,{productId:PRODUCT}).dossierExtension.decisions.length;
    await page.getByRole('button',{name:'Reject',exact:true}).click();
    assert.equal(readProductDossier(w.root,{productId:PRODUCT}).dossierExtension.decisions.length,decisionsBefore);
    await page.getByRole('button',{name:'Reconcile this exact action'}).click();
    await page.getByRole('status').filter({hasText:'original action key was reconciled'}).waitFor();
    assert.deepEqual(mutations.filter(x=>x.url==='/api/product').at(-1).body,uncertainPacket);
    assert.equal(readProductDossier(w.root,{productId:PRODUCT}).dossierExtension.decisions.length,decisionsBefore);
    await page.unroute('**/api/product');
    // Failed product switching clears every old panel and board destination.
    const other=randomUUID();result(w.writer.command(w.human.token,packet(w,'product.create',{productId:other,productCode:null,workingName:'Unavailable second product'})));
    await page.route('**/api/product-review',async route=>route.request().postDataJSON().productId===other?route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({error:'CAPABILITY_UNAVAILABLE'})}):route.continue());
    await page.getByRole('button',{name:'← Products'}).click();
    await page.reload();await page.getByRole('button',{name:/Unavailable second product/}).click();
    await page.getByRole('status').filter({hasText:'Current product information is unavailable'}).waitFor();
    assert.equal(await page.locator('#facts').textContent(),'');assert.equal(await page.locator('#board-link').getAttribute('href'),null);
    assert.equal(await page.locator('[data-tab]:enabled').count(),0);await page.unroute('**/api/product-review');
    await open();
    // Actual retained media, current signed operation and separate Brand, with no operational mutation.
    const beforeMutation=mutations.length;
    await page.getByRole('button',{name:'Photos & Content'}).click();
    await page.getByRole('button',{name:'Use this photo in preparation'}).nth(3).waitFor();
    assert.equal(await page.locator('#photo-list img').count(),4);
    await page.getByRole('button',{name:'Use this photo in preparation'}).first().click();
    await page.locator('#preparation-input img').waitFor();
    await page.getByLabel('Include Brand').check();await page.getByLabel('Adopted Brand').selectOption('brand-photo');
    await page.getByRole('button',{name:'Inspect preparation with selected input'}).click();
    await page.getByRole('heading',{name:/Read-only preparation.*operation-photo/}).waitFor();
    assert.match(await page.locator('.preparation-details').textContent(),/brand-photo.*revision 1/);
    assert.match(await page.locator('#preparation-input').textContent(),/نام-طولانی/);
    assert.match(await page.locator('.preparation-details').textContent(),/generator not assessed/);
    assert.equal((await page.locator('#operation-list').textContent()).includes('[object Object]'),false);
    for(const status of ['Contract: valid','Operational compatibility: not-assessed','Visual testing: untested','Human adoption: adopted'])assert.ok((await page.locator('#operation-list').textContent()).includes(status));
    await page.setViewportSize({width:390,height:780});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'Narrow preparation must not overflow horizontally');
    await page.screenshot({path:path.join(shots,'02-retained-input-brand-narrow.png'),fullPage:true});
    assert.equal(mutations.slice(beforeMutation).filter(x=>!['/api/product-review'].includes(x.url)).length,0);
    for(const kind of ['request','round','job'])assert.equal(w.k.read(w.c.human,kind).length,0);
    assert.equal(w.k.read(w.c.human,'artifact').length,4);
    const direct=page.url();await context.close();await app.stop();
    const fileOnly=readProductDossier(w.root,{productId:PRODUCT,accessFile:w.accessFile});assert.equal(fileOnly.product.record.facts.dimensions.value.length,15.25);
    for(const x of originals)assert.equal(hash(fs.readFileSync(path.join(sourceRoot,x.filename))),x.sha256);
    app=await serve({root:w.runtime,port:0,...options});w.k=app.kernel;
    context=await browser.newContext({viewport:{width:390,height:780}});page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
    await page.goto(app.origin+new URL(direct).pathname+new URL(direct).hash);
    await page.getByRole('heading',{name:'Authored concept only'}).waitFor();
    await page.getByRole('button',{name:'Photos & Content'}).focus();await page.keyboard.press('Enter');
    await page.getByRole('button',{name:'Use this photo in preparation'}).nth(3).waitFor();
    for(const kind of ['request','round','job'])assert.equal(w.k.read(w.c.human,kind).length,0);
    assert.equal(w.k.read(w.c.human,'artifact').length,4);assert.deepEqual(errors,[]);
    fs.writeFileSync(path.join(shots,'result.json'),JSON.stringify({authoredOnly:true,structuredFields:['dimensions','sellingPrice','productionCost'],separateAcceptance:true,staleFreshKey:true,uncertainExactReplay:true,failedSwitchCleared:true,preparationReadOnly:true,coldReopen:true,originalHashes:originals,requests:0,rounds:0,jobs:0,artifacts:4},null,2));
  }catch(error){await page?.screenshot({path:path.join(shots,'failure.png'),fullPage:true}).catch(()=>{});throw error;}finally{await context?.close().catch(()=>{});await browser?.close();await app.stop();}
});
