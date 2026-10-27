// A presentation client for the existing authenticated product and operation contracts.
const $=id=>document.getElementById(id),node=(tag,text='',className='')=>{const n=document.createElement(tag);n.textContent=text;if(className)n.className=className;return n;};
const state={token:null,index:null,review:null,productId:null,artifacts:[],previewUrls:[],viewEpoch:0,mediaEpoch:0,discoveryEpoch:0,preparationEpoch:0,calibrationEpoch:0,contentEpoch:{candidate:0,approved:0},preparation:null,content:null};
const notes={
  REVISION_CONFLICT:'The product changed. Your words remain here; review the latest information before another action.',
  HEAD_CHANGED:'The workspace changed. Review the latest information before another action.',
  EXPORT_PENDING:'The publication or acknowledgement is uncertain. Inspect the retained action before any manual reconciliation.',
  MISSING_SOURCE:'A retained source is missing or inaccessible.',
  INVALID_SCOPE:'Your current authority does not allow this action.',
  CAPABILITY_UNAVAILABLE:'This information is unavailable in this workspace.'
};
const say=s=>{$('notice').textContent=s};
function pendingFor(predicate){
  return Object.keys(localStorage).filter(k=>k.startsWith('3djat:action:')).some(k=>{
    try{const x=JSON.parse(localStorage.getItem(k));return ['submitted','requires-review'].includes(x?.status)&&predicate(x.command)}catch{return false}
  });
}
function rejectedFor(predicate){
  return Object.keys(localStorage).filter(k=>k.startsWith('3djat:action:')).some(k=>{
    try{const x=JSON.parse(localStorage.getItem(k));return x?.status==='rejected'&&predicate(x.command)}catch{return false}
  });
}
// Only a typed, receipt-free domain rejection establishes no effect. Transport,
// parse, publication and acknowledgement failures retain the exact command.
function definiteRejection(e,command){
  const x=e.result;
  return x?.schemaVersion==='3djat.failure.v1'&&x.operation===command.operation&&x.key===command.key&&
    x.error?.evidence===null&&['REVISION_CONFLICT','INVALID_VALUE','INVALID_TYPE','OUT_OF_BOUNDS','UNKNOWN_FIELD',
      'EVIDENCE_MISMATCH','INVALID_REFERENCE','MISSING_SOURCE','SKU_CONFLICT','INVALID_SCOPE'].includes(x.error.code);
}
function renderPending(){
  const box=$('pending-actions');box.replaceChildren();
  const pending=Object.keys(localStorage).filter(k=>k.startsWith('3djat:action:')).map(k=>{try{return [k,JSON.parse(localStorage.getItem(k))]}catch{return [k,null]}})
    .filter(([,x])=>['requires-review','submitted','rejected','acknowledged'].includes(x?.status));
  box.hidden=!pending.length;if(!pending.length)return;
  box.append(node('h2','Retained action history'),node('p','Review each original key and its outcome. No action is sent automatically.'));
  for(const [key,x] of pending){
    const card=node('article','','history-card'),details=node('details'),summary=node('summary','Action details');
    details.append(summary,node('code','Original action key: '+x.command.key));
    const input=x.command.input??{},words=input.reason??input.note??input.workingName??input.payload?.text;
    if(input.productId)details.append(node('p','Product: '+input.productId));
    if(words)details.append(node('p','Original entered words: '+words));
    if(input.changes?.length)details.append(node('p','Original proposed fields: '+input.changes.map(c=>c.field+': '+(c.fact?.state==='accepted'?val(c.fact.value):c.fact?.state)).join('; ')));
    if(input.payload?.kind==='field')details.append(node('p','Original proposed value: '+(input.payload.fact.state==='accepted'?val(input.payload.fact.value):input.payload.fact.state)));
    if(input.payload?.kind==='entry')details.append(node('p','Original entry: '+input.payload.title+' / '+input.payload.date+' / '+input.payload.text));
    if(x.receipt)details.append(node('p','Retained receipt: '+x.receipt.id+' · revision '+x.receipt.revision));
    card.append(node('h3',x.label),node('p','Outcome: '+(x.status==='rejected'?'definite no-effect rejection':x.status==='acknowledged'?'rejection acknowledged':x.code??'response unknown')),details);
    if(x.status==='acknowledged'){box.append(card);continue;}
    const check=node('button','Read current product');
    check.onclick=()=>x.command.input.productId?openProduct(x.command.input.productId,hash().get('tab')??'information'):loadIndex().then(drawLanding).catch(e=>say('Current products unavailable: '+e.message));
    if(x.status==='rejected'){
      const acknowledge=node('button','Reread and acknowledge rejection');
      acknowledge.onclick=async()=>{acknowledge.disabled=true;try{
        const productId=x.command.input.productId;
        if(productId){await openProduct(productId,hash().get('tab')??'information');if(!state.review||state.productId!==productId)throw Error('Current product information is unavailable.');}
        else {await loadIndex();drawLanding();}
        localStorage.setItem(key,JSON.stringify({...x,status:'acknowledged'}));renderPending();
        say('Rejected action retained in history. Review the current information and make a new explicit decision if needed.');
      }catch(e){say('Rejection remains to be acknowledged: '+e.message);}finally{acknowledge.disabled=false;}};
      card.append(check,acknowledge);box.append(card);continue;
    }
    const retry=node('button','Reconcile this exact action');
    retry.onclick=async()=>{retry.disabled=true;try{await submitCommand(x.command,x.label);localStorage.removeItem(key);await loadIndex();if(x.command.input.productId)await openProduct(x.command.input.productId);else if(state.productId)await openProduct(state.productId);
      say('The original action key was reconciled.');}catch(e){say('Still unconfirmed: '+e.message);}
      finally{retry.disabled=false;renderPending();}};
    card.append(check,retry);box.append(card);
  }
}
async function api(path,{method='GET',body}={}){
  const r=await fetch(path,{method,headers:{Authorization:'Bearer '+state.token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  const value=await r.json();if(!r.ok||value.schemaVersion==='3djat.failure.v1'){
    const code=value.error?.code??value.error??'READ_UNAVAILABLE';
    throw Object.assign(Error(notes[code]??String(code)),{code,result:value});
  }return value;
}
const post=(path,body)=>api(path,{method:'POST',body});
const formatted=x=>{
  if(typeof x!=='object')return String(x);
  if('length' in x&&'width' in x&&'height' in x)return [x.length,x.width,x.height].join(' × ')+' '+x.unit;
  if('amount' in x&&'currency' in x)return x.amount+' '+x.currency+' per '+x.per+' · '+x.effectiveDate;
  return Object.entries(x).map(([key,value])=>key+': '+String(value)).join(' · ');
};
const val=x=>x===null||x===undefined?'—':formatted(x);
const chip=(text,status='')=>node('span',text,'tag '+status);
const fields={material:'Material',dimensions:'Dimensions',sellingPrice:'Selling price',description:'Description',modelingSoftware:'Modeling software',productionCost:'Production cost'};
function showStatus(target,fact){
  const status=fact?.state??'unknown',p=node('p',status==='accepted'?val(fact.value):status==='not-applicable'?'Not applicable':status==='pending'?'Pending review':'Unknown');
  if(status==='accepted'&&typeof fact.value==='string')p.dir='auto';
  target.append(chip(status.replace('-',' '),status),p);
}
function sourceList(sources=[]){
  const box=node('div','','sources');
  if(!sources.length){box.textContent='No source locator supplied';return box;}
  for(const s of sources){
    const src=s.source??s,locator=src.locator??{},line=node('p',
      'Source: '+(src.location??src.sourceId??'retained source')+' · '+(locator.section??locator.page??locator.cell??locator.kind??'locator recorded')+
      (s.status?' · '+s.status+(s.cause?' ('+s.cause+')':''):''));
    line.dir='auto';box.append(line);
  }return box;
}
const hash=()=>new URLSearchParams(location.hash.slice(1));
function route(productId=null,tab='information'){
  const next=productId?new URLSearchParams({product:productId,tab}).toString():'';
  if(location.hash.slice(1)===next){if(!productId)drawLanding();else openProduct(productId,tab);}
  else location.hash=next;
}
async function loadIndex(){
  state.index=await api('/api/products');return state.index;
}
function drawLanding(){
  state.viewEpoch++;state.mediaEpoch++;state.productId=null;state.review=null;state.preparation=null;state.content=null;state.artifacts=[];$('landing').hidden=false;$('product-detail').hidden=true;const list=$('product-list');list.replaceChildren();
  for(const url of state.previewUrls)URL.revokeObjectURL(url);state.previewUrls=[];
  if(!state.index){list.append(node('p','Current product information is unavailable.'));return;}
  if(!state.index.products.length)list.append(node('p','No products yet. Create one with a working name.'));
  for(const p of state.index.products){
    const b=node('button','','product-tile'),h=node('h2',p.workingName??'Product information unavailable');
    h.dir='auto';b.append(h,node('p',p.productCode?'Code: '+p.productCode:'No product code'));
    if(p.status==='unavailable')b.append(chip('Current information unavailable','unavailable'),node('p',p.cause));
    else b.append(node('p',p.importedCount+' imported photo(s) · '+p.attachmentCount+' attachment(s) · '+p.contentCount+' accepted dossier record(s)'),
      chip(p.unknownCount+' unknown fields','unknown'),chip(p.pendingCount+' pending proposals',p.pendingCount?'pending':''),
      ...(p.unavailableCount?[chip(p.unavailableCount+' unavailable attachment(s)','unavailable')]:[]));
    b.onclick=()=>route(p.productId);list.append(b);
  }
}
function clearProductContext(){
  $('calibration-list')?.replaceChildren();
  state.mediaEpoch++;state.discoveryEpoch++;state.review=null;state.artifacts=[];state.preparation=null;state.content=null;
  for(const url of state.previewUrls)URL.revokeObjectURL(url);state.previewUrls=[];
  for(const id of ['facts','proposals','history-list','photo-list','attachment-list','entry-list','operation-list','selection-list','preparation-input','candidate-list','approved-list','operation-status','operation-pending'])$(id).replaceChildren();
  $('product-title').textContent='Current product information unavailable';$('product-code').textContent='';$('product-summary').textContent='';
  $('board-link').removeAttribute('href');$('board-link').hidden=true;
  for(const b of document.querySelectorAll('[data-tab]'))b.disabled=true;
  for(const id of ['information','photos','history','prepare','approved'])$(id).hidden=true;
}
async function openProduct(id,tab='information'){
  const epoch=++state.viewEpoch;
  clearProductContext();state.productId=id;$('landing').hidden=true;$('product-detail').hidden=false;say('Loading current product information…');
  try{
    const index=await api('/api/products');if(epoch!==state.viewEpoch)return;
    state.index=index;const listed=index.products.find(x=>x.productId===id);if(!listed)throw Error('Product is absent from the current workspace.');
    const review=await post('/api/product-review',{productId:id,atHead:index.head});if(epoch!==state.viewEpoch)return;
    state.review=review;
    for(const b of document.querySelectorAll('[data-tab]'))b.disabled=false;
    const a=state.review.product.record;$('product-title').textContent=a.workingName;$('product-title').dir='auto';
    $('product-code').textContent=a.productCode?'Product code · '+a.productCode:'Working product · no code';
    $('product-summary').textContent='Product information is retained in the workspace. Unknown fields remain open.';
    $('board-link').href='/#'+new URLSearchParams({project:id,page:'board'});$('board-link').hidden=false;say('');
    const selectedSource=hash().get('source');if(selectedSource)state.preparation={productId:id,artifactId:selectedSource,correction:hash().get('correct')==='1'};
    renderInformation();renderHistory();selectTab(tab);renderPending();renderJ09Pending();
  }catch(e){if(epoch!==state.viewEpoch)return;clearProductContext();say('Current product information is unavailable: '+e.message);}
}
function switchTab(tab){
  if(!['information','photos','history','prepare','approved'].includes(tab))tab='information';
  for(const button of document.querySelectorAll('[data-tab]')){
    const on=button.dataset.tab===tab;button.setAttribute('aria-current',on?'page':'false');$(button.dataset.tab).hidden=!on;
  }
}
function selectTab(tab){if(!state.review)return;switchTab(tab);if(tab==='photos')return renderPhotos();if(tab==='prepare')return renderPreparation();if(tab==='approved')return renderContent(true);}
function renderInformation(){
  const r=state.review,p=r.product.record,box=$('facts');box.replaceChildren();
  for(const [field,title] of Object.entries(fields)){
    const fact=field in p.facts?p.facts[field]:r.dossierExtension.fields[field],card=node('div','','fact');
    const pending=field in p.facts?r.proposals.some(x=>x.status==='pending'&&x.record.changes.some(c=>c.field===field)):
      r.dossierExtension.proposals.some(x=>x.status==='pending'&&x.record.payload.kind==='field'&&x.record.payload.field===field);
    card.append(node('h3',title));showStatus(card,pending&&fact.state==='unknown'?{state:'pending'}:fact);
    if(field in p.facts&&fact.sourceRefs?.length)card.append(sourceList(fact.sourceRefs));
    if(!(field in p.facts)){
      const current=r.dossierExtension.records.find(x=>x.active&&x.record.payload.kind==='field'&&x.record.payload.field===field);
      if(current){
        const origin=r.dossierExtension.proposals.find(x=>x.reference.id===current.record.proposal.id);
        card.append(sourceList(origin?.sources??current.record.payload.fact.sourceRefs));
      }
    }box.append(card);
  }
  const proposals=$('proposals');proposals.replaceChildren();
  const items=[...r.proposals.map(p=>({...p,kind:'base'})),...r.dossierExtension.proposals.map(p=>({...p,kind:'dossier'}))];
  if(!items.length)proposals.append(node('p','No proposals retained.'));
  for(const item of items){
    const p=item.record,card=node('article','','review-card');
    const title=item.kind==='base'?p.changes.map(c=>fields[c.field]??c.field).join(', '):
      p.payload.kind==='field'?(fields[p.payload.field]??p.payload.field):p.payload.title;
    card.append(node('h3',title),chip(item.status,item.status==='pending'?'pending':''));
    const value=item.kind==='base'?p.changes.map(c=>c.field+': '+(c.fact.state==='accepted'?val(c.fact.value):c.fact.state)).join('\n'):
      p.payload.kind==='field'?p.payload.fact.state==='accepted'?val(p.payload.fact.value):p.payload.fact.state:p.payload.text;
    const quote=node('blockquote',value);quote.dir='auto';card.append(quote,node('p',p.reason),sourceList(item.sources));
    if(p.corrects)card.append(node('p','Correction of an earlier proposal. The original remains in history.','fine'));
    if(item.status==='pending'){
      const actions=node('div','','actions');
      const original=p.corrects&&items.find(x=>x.kind===item.kind&&x.reference.id===p.corrects.id);
      const needsLink=original&&original.status!=='superseded';
      if(needsLink){
        const link=node('button','Link saved correction to original');
        link.onclick=()=>decide(original,'superseded',link,{correctedProposal:item.reference});
        actions.append(node('p','This saved correction needs its explicit link before acceptance.'),link);
      }
      for(const [label,outcome] of [['Accept','accepted'],['Reject','rejected']]){
        if(needsLink&&outcome==='accepted')continue;
        const b=node('button',label);b.onclick=()=>decide(item,outcome,b);actions.append(b);
      }
      const edit=node('button','Edit proposal');edit.onclick=()=>editProposal(item,card);actions.append(edit);card.append(actions);
    }proposals.append(card);
  }
}
function packet(operation,input,revision=state.review.product.record.revision){
  return {schemaVersion:'3djat.command.v1',operation,key:crypto.randomUUID(),
    expected:{domainHead:state.review.head,entityRevision:revision},input};
}
async function submitCommand(command,label){
  const pending='3djat:action:'+command.key;localStorage.setItem(pending,JSON.stringify({label,command,status:'submitted'}));
  try{const result=await post(command.operation.startsWith('template.')?'/api/template':'/api/product',command);localStorage.removeItem(pending);renderPending();return result;}
  catch(e){localStorage.setItem(pending,JSON.stringify({label,command,status:definiteRejection(e,command)?'rejected':'requires-review',code:e.code,receipt:e.result?.error?.evidence??null}));
    renderPending();
    throw e;
  }
}
async function decide(item,outcome,button,{correctedProposal=null}={}){
  if(!state.review)return;button.disabled=true;
  const productId=state.productId,epoch=state.viewEpoch;let command=null;
  try{
    if(rejectedFor(x=>x?.operation?.endsWith('proposal.decide')&&x.input?.productId===productId&&x.input?.proposal?.id===item.reference.id))
      throw Error('A rejected decision must be acknowledged after a current reread before a new decision.');
    if(pendingFor(x=>x?.operation?.endsWith('proposal.decide')&&x.input?.productId===state.productId&&x.input.proposal?.id===item.reference.id))
      throw Error('This proposal already has an unconfirmed action. Review its original key above.');
    const op=item.kind==='base'?'product.proposal.decide':'product.dossier.proposal.decide',kind=item.kind==='base'?'3djat.proposal-decision.v1':'3djat.dossier-decision.v1';
    const input={schemaVersion:kind,decisionId:crypto.randomUUID(),productId:state.productId,proposal:item.reference,
      expectedRevision:state.review.product.record.revision,outcome,reason:outcome==='superseded'?'Human correction retains the original proposal.':'Human review in Products.',
      decidedAt:new Date().toISOString(),humanActionReceipt:{id:crypto.randomUUID(),revision:1,path:'placeholder.json',sha256:'0'.repeat(64)},
      supersedesDecision:item.status&&item.status!=='pending'?(item.kind==='base'?state.review.decisions:state.review.dossierExtension.decisions).filter(x=>x.record.proposal.id===item.reference.id).at(-1)?.reference??null:null,correctedProposal};
    command=packet(op,input);input.humanActionReceipt=await post('/api/product-action-reference',command);
    await submitCommand(command,'Decision '+outcome);
    if(epoch===state.viewEpoch&&state.productId===productId){await openProduct(productId,hash().get('tab')??'information');
      if(state.review&&state.productId===productId)say('Decision recorded. The original proposal remains in history.');}
  }catch(e){if(epoch===state.viewEpoch&&state.productId===productId)say(command&&definiteRejection(e,command)?
    'Decision rejected without effect: '+e.message+' Reread and acknowledge the retained rejection before another explicit decision.':
    'Decision not confirmed: '+e.message+' Entered information and any submitted action key are retained for review.');}
  finally{button.disabled=false;}
}
function labeled(form,title,tag='input',value='',maxLength){
  const label=node('label',title),control=node(tag);control.value=value??'';
  control.setAttribute('aria-label',title);
  if(maxLength)control.maxLength=maxLength;control.required=true;label.append(control);form.append(label);return control;
}
function selectValue(form,title,values,value){
  const control=labeled(form,title,'select');control.replaceChildren(...values.map(x=>new Option(x,x)));control.value=value;return control;
}
function factEditor(form,field,fact,{base=false}={}){
  const section=node('fieldset','','correction-field'),legend=node('legend',fields[field]??field);section.append(legend);form.append(section);
  const states=field==='workingName'?['accepted']:['accepted','unknown','not-applicable'];
  const status=selectValue(section,'Field state',states,fact.state);
  const value=fact.value;
  let readValue;
  if(field==='dimensions'){
    const axes=['length','width','height'].map(x=>{const input=labeled(section,x[0].toUpperCase()+x.slice(1),'input',value?.[x]??'');input.type='number';input.min='0';input.max='1000000000';input.step='any';return input;});
    const unit=selectValue(section,'Unit',['mm','cm','m','in'],value?.unit??'mm');
    readValue=()=>{const numbers=axes.map(x=>Number(x.value));if(numbers.some(x=>!Number.isFinite(x)||x<=0||x>1e9))throw Error('Dimensions must be positive numbers at most 1 billion.');return {length:numbers[0],width:numbers[1],height:numbers[2],unit:unit.value};};
  }else if(field==='sellingPrice'||field==='productionCost'){
    const amount=labeled(section,'Amount (decimal)','input',value?.amount??'',24);amount.type='text';amount.inputMode='decimal';
    const currency=selectValue(section,'Currency',['IRR','IRT','USD','EUR','GBP','AED'],value?.currency??'USD');
    const unit=selectValue(section,'Monetary unit',['rial','toman','major'],value?.unit??'major');
    const per=selectValue(section,'Per',['item','set','kg'],value?.per??'item');
    const date=labeled(section,'Effective date','input',value?.effectiveDate??'');date.type='date';
    currency.onchange=()=>{unit.value=currency.value==='IRR'?'rial':currency.value==='IRT'?'toman':'major'};
    readValue=()=>{if(!/^(0|[1-9][0-9]{0,15})(\.[0-9]{1,6})?$/.test(amount.value)||
      unit.value!==(currency.value==='IRR'?'rial':currency.value==='IRT'?'toman':'major')||
      !/^\d{4}-\d{2}-\d{2}$/.test(date.value)||new Date(date.value).toISOString().slice(0,10)!==date.value)
      throw Error('Price requires a valid decimal, matching currency unit and calendar date.');
      return {amount:amount.value,currency:currency.value,unit:unit.value,per:per.value,effectiveDate:date.value};};
  }else{
    const input=labeled(section,'Corrected value',field==='description'?'textarea':'input',value??'',field==='description'?20000:field==='productCode'?80:500);
    readValue=()=>{if(!input.value.trim())throw Error((fields[field]??field)+' requires a value.');return input.value;};
  }
  const controls=section.querySelectorAll('input,textarea,select');
  status.onchange=()=>{for(const control of controls)if(control!==status){control.disabled=status.value!=='accepted';control.required=status.value==='accepted';}};
  status.onchange();
  return copy=>{
    copy.state=status.value;copy.value=status.value==='accepted'?readValue():null;
    if(base&&copy.state==='accepted'&&!copy.sourceRefs.length)throw Error('An accepted base value requires its retained source locator.');
  };
}
function editProposal(item,card){
  card.querySelector('.edit-form')?.remove();const p=item.record,payload=p.payload;
  const form=node('form','','edit-form'),readers=[];
  // Build all field controls together; corrections preserve the original field set
  // and every source locator. The original remains retained until a human decision.
  const factEditorRead=[];
  if(item.kind==='base'){
    for(const change of p.changes)factEditorRead.push(factEditor(form,change.field,change.fact,{base:true}));
    readers.push(copy=>copy.changes.forEach((change,i)=>factEditorRead[i](change.fact)));
  }
  else if(payload.kind==='field')factEditorRead.push(factEditor(form,payload.field,payload.fact));
  else {
    const title=labeled(form,'Corrected title','input',payload.title,500),date=labeled(form,'Date','input',payload.date);date.type='date';
    const body=labeled(form,'Corrected text','textarea',payload.text,20000);
    readers.push(copy=>{if(!title.value.trim()||!body.value.trim()||!/^\d{4}-\d{2}-\d{2}$/.test(date.value)||new Date(date.value).toISOString().slice(0,10)!==date.value)
      throw Error('Entry needs a title, text and valid date.');Object.assign(copy.payload,{title:title.value,date:date.value,text:body.value});});
  }
  if(item.kind==='dossier'&&payload.kind==='field')readers.push(copy=>factEditorRead[0](copy.payload.fact));
  const why=labeled(form,'Reason for correction','textarea','',20000);
  const submit=node('button','Save correction','primary');submit.type='submit';
  form.append(submit,node('p','The original stays in history. The corrected proposal awaits separate acceptance.','fine'));
  form.onsubmit=async e=>{
    e.preventDefault();submit.disabled=true;
    try{
      if(pendingFor(x=>x?.operation?.endsWith('proposal.submit')&&x.input?.corrects?.id===item.reference.id))
        throw Error('This correction has an unconfirmed action. Review its original key above.');
      if(rejectedFor(x=>x?.operation?.endsWith('proposal.submit')&&x.input?.corrects?.id===item.reference.id))
        throw Error('A rejected correction must be acknowledged after a current reread before editing again.');
      if(pendingFor(x=>x?.operation?.endsWith('proposal.decide')&&x.input?.productId===state.productId&&x.input?.proposal?.id===item.reference.id))
        throw Error('The original proposal has an unconfirmed decision. Reconcile its exact key before editing.');
      if(!state.review||state.productId!==p.productId)throw Error('Current product information is unavailable.');
      const productId=state.productId,epoch=state.viewEpoch,revision=state.review.product.record.revision,copy=structuredClone(p);
      copy.proposalId=crypto.randomUUID();copy.expectedRevision=revision;copy.corrects=item.reference;copy.reason=why.value;
      for(const read of readers)read(copy);
      const op=item.kind==='base'?'product.proposal.submit':'product.dossier.proposal.submit';
      const result=await submitCommand(packet(op,copy,revision),'Corrected proposal');
      if(epoch!==state.viewEpoch||state.productId!==productId)return;
      const index=await api('/api/products'),review=await post('/api/product-review',{productId,atHead:index.head});
      if(epoch!==state.viewEpoch||state.productId!==productId)return;
      state.index=index;state.review=review;
      const updated=(item.kind==='base'?state.review.proposals:state.review.dossierExtension.proposals).find(x=>x.reference.id===item.reference.id);
      if(!updated)throw Error('Original proposal is unavailable after correction. Review retained history.');
      await decide({...updated,kind:item.kind},'superseded',submit,{correctedProposal:result.reference});
    }catch(error){say('Correction needs review: '+error.message+' Your entered values remain here; no automatic retry.');}
    finally{submit.disabled=false;}
  };card.append(form);form.querySelector('input,textarea,select')?.focus();
}
function renderHistory(){
  const r=state.review,box=$('history-list');box.replaceChildren();
  for(const n of r.product.record.notes){const card=node('article','','history-card');card.append(node('h3','Note · '+n.createdAt),node('p',n.text));box.append(card);}
  for(const [label,items] of [['Product proposal',r.proposals],['Product decision',r.decisions],['Dossier proposal',r.dossierExtension.proposals],['Dossier decision',r.dossierExtension.decisions],['Accepted dossier record',r.dossierExtension.records]]){
    for(const item of items){
      const card=node('details','','history-card'),summary=node('summary',label+' · '+(item.status??item.record.outcome??(item.active?'current':'historical'))),body=item.record;
      card.append(summary,node('p',body.reason??body.payload?.text??body.payload?.fact?.value??body.changes?.map(c=>c.field+': '+val(c.fact.value)).join(', ')??'Retained record'));
      if(body.corrects)card.append(node('p','Corrects an earlier retained proposal.'));
      if(body.proposal)card.append(node('p','Decision links to its original proposal.'));
      if(item.sources)card.append(sourceList(item.sources));
      box.append(card);
    }
  }
}
async function renderPhotos(){
  renderContent(false);
  const epoch=++state.mediaEpoch,productId=state.productId;
  const r=state.review,list=$('photo-list');list.replaceChildren();$('attachment-list').replaceChildren();$('entry-list').replaceChildren();
  for(const url of state.previewUrls)URL.revokeObjectURL(url);state.previewUrls=[];
  try{const artifacts=(await api('/api/read?kind=artifact')).filter(a=>a.projectId===productId&&a.origin==='import');
    if(epoch!==state.mediaEpoch||productId!==state.productId)return;state.artifacts=artifacts;}
  catch(e){if(epoch!==state.mediaEpoch||productId!==state.productId)return;list.append(node('p','Imported photo list unavailable: '+e.message));state.artifacts=[];}
  if(!state.artifacts.length&&!list.childElementCount)list.append(node('p','No retained imported photos.'));
  for(const a of state.artifacts){
    const card=node('article','','content-card'),title=node('h3','Imported photo');card.append(title,chip('Historical import · no fresh approval','pending'));
    let importStatus='Import details unavailable',mediaStatus='Preview unavailable';
    try{
      const imp=await api('/api/import?id='+encodeURIComponent(a.importId));title.textContent=imp.declaration?.payload?.filename??'Imported photo';
      if(epoch!==state.mediaEpoch||productId!==state.productId)return;
      importStatus=imp.artifact?.id===a.id?'Retained import verified for this artifact':'Import identity mismatch';
      title.dir='auto';
      if(imp.declaration?.payload?.historicalApproval)card.append(node('p','Historical approval claim · unverified','fine'));
    }catch(e){card.append(node('p','Import details unavailable: '+e.message));}
    try{
      const q=new URLSearchParams({view:'media',productId:a.projectId,id:a.id,version:a.version,sha256:a.sha256,width:a.width,height:a.height});
      const media=await api('/api/original?'+q);
      if(epoch!==state.mediaEpoch||productId!==state.productId)return;
      if(media.state==='ready'){
        const img=node('img'),bytes=Uint8Array.from(atob(media.preview.bytes),c=>c.charCodeAt(0));
        img.src=URL.createObjectURL(new Blob([bytes],{type:'image/png'}));state.previewUrls.push(img.src);
        img.alt=title.textContent;card.append(img,node('p','Bounded preview · original retained separately','fine'));
        mediaStatus='Bounded preview available';
      }
      else {mediaStatus='Preview unavailable: '+media.errorCode;card.append(node('p',mediaStatus));}
    }catch(e){mediaStatus='Photo inaccessible: '+e.message;card.append(node('p',mediaStatus));}
    const choose=node('button','Use this photo in preparation');
    choose.onclick=()=>{
      if(state.preparation?.previewUrl){URL.revokeObjectURL(state.preparation.previewUrl);state.previewUrls=state.previewUrls.filter(url=>url!==state.preparation.previewUrl);}
      state.preparation={productId,artifactId:a.id};route(productId,'prepare');
    };
    card.append(node('p','Input: '+a.id+' · '+importStatus+' · '+mediaStatus,'fine'),choose);
    if(epoch!==state.mediaEpoch||productId!==state.productId)return;
    list.append(card);
  }
  if(!r.attachments.length)$('attachment-list').append(node('p','No retained attachments.'));
  for(const a of r.attachments){
    const card=node('article','','content-card'),title=node('h3',a.record.filename);title.dir='auto';card.append(title,chip(a.current.status,a.current.status==='available'?'':'unavailable'));
    if(a.current.cause)card.append(node('p','Current source: '+a.current.cause));card.append(sourceList([a.record.source]));$('attachment-list').append(card);
  }
  const entries=r.dossierExtension.records.filter(x=>x.record.payload.kind==='entry');
  if(!entries.length)$('entry-list').append(node('p','No accepted dossier entries.'));
  for(const x of entries){const v=x.record.payload,card=node('article','','content-card');card.append(node('h3',v.title),chip(v.entryKind),node('p',v.date+' · '+v.entryType),node('p',v.text),sourceList(v.sourceRefs));$('entry-list').append(card);}
}
function mediaQuery(a){return new URLSearchParams({view:'media',productId:a.projectId,id:a.id,version:a.version,sha256:a.sha256,width:a.width,height:a.height});}
async function preparationSource(){
  const selected=state.preparation,box=$('preparation-input');box.replaceChildren();
  if(!selected||selected.productId!==state.productId){box.append(node('p','Choose a retained imported photo in Photos & Content to inspect a new preparation.'));return;}
  if(selected.previewUrl){URL.revokeObjectURL(selected.previewUrl);state.previewUrls=state.previewUrls.filter(url=>url!==selected.previewUrl);selected.previewUrl=null;}
  const productId=state.productId,epoch=state.viewEpoch,card=node('article','','content-card');
  card.append(node('h3','Selected input · checking current source'));box.append(card);
  const current=()=>epoch===state.viewEpoch&&productId===state.productId&&state.preparation===selected;
  try{
    const artifacts=(await api('/api/read?kind=artifact')).filter(a=>a.projectId===productId);if(!current())return;
    const a=artifacts.find(a=>a.id===selected.artifactId);if(!a)throw Error('Retained imported artifact is absent from the current workspace.');
    selected.artifact={productId,artifactId:a.id,version:a.version,sha256:a.sha256,width:a.width,height:a.height};
    const imp=a.origin==='import'?await api('/api/import?id='+encodeURIComponent(a.importId)):{artifact:a,declaration:{payload:{filename:'Selected produced content'}}};if(!current())return;
    if(imp.artifact?.id!==a.id||imp.artifact.sha256!==a.sha256)throw Error('Import identity or bytes do not match the selected artifact.');
    selected.filename=imp.declaration?.payload?.filename??a.id;
    card.replaceChildren(node('h3','Selected input · '+selected.filename),node('p','Retained artifact: '+a.id+' · version '+a.version),
      node('p',a.origin==='import'?'Historical import claim: unverified. No fresh source approval.':'Verified produced content. Human decisions remain separate.','fine'));
    const media=await api('/api/original?'+mediaQuery(a));if(!current())return;
    if(media.state==='ready'){
      const img=node('img'),bytes=Uint8Array.from(atob(media.preview.bytes),c=>c.charCodeAt(0));
      img.src=URL.createObjectURL(new Blob([bytes],{type:'image/png'}));selected.previewUrl=img.src;state.previewUrls.push(img.src);
      img.alt=selected.filename;card.append(img);
      selected.sourceBlocker=null;
    }else{selected.sourceBlocker=media.errorCode??'PREVIEW_UNAVAILABLE';card.append(node('p','Input source blocker: '+selected.sourceBlocker));}
  }catch(e){if(!current())return;selected.sourceBlocker=e.code??e.message;selected.artifact=null;
    card.replaceChildren(node('h3','Selected input · unavailable'),node('p','Input source blocker: '+selected.sourceBlocker));}
}
async function renderPreparation(){
  const productId=state.productId,epoch=state.viewEpoch,preparation=++state.preparationEpoch;
  const current=()=>epoch===state.viewEpoch&&productId===state.productId&&preparation===state.preparationEpoch;
  state.discoveryEpoch++;
  renderJ09Pending();$('operation-list').replaceChildren();
  try{await contentData(current);}catch(e){if(current())say('Current content unavailable: '+e.message);return;}if(!current())return;
  await preparationSource();if(!current())return;
  const box=$('selection-list');box.replaceChildren();
  try{
    const requests=(await api('/api/read?kind=request')).filter(x=>x.projectId===productId&&x.selectionId);
    if(!current())return;
    if(!requests.length)box.append(node('p','No operation inputs selected yet.'));
    for(const request of requests){
      try{
        const v=await api('/api/operation-selection?requestId='+encodeURIComponent(request.id)),b=v.body,card=node('article','','content-card');
        if(!current())return;
        card.append(node('h3','Selected operation · '+(b.operation.record?.title??b.operation.reference.id)),
          node('p','Brand: '+(b.brand?.record?.title??'none selected')),
          node('p','Selected input identities: '+(b.run?.sources??[]).map(x=>x.artifact?.artifactId??x.artifactId??x.role).join(', ')),
          node('p','Selection retained. Starting work is a separate authorized step.'));
        const r=state.content?.rounds.find(x=>x.requestId===request.id||x.selectionRequestId===request.id),jobs=state.content?.jobs.filter(x=>x.roundId===r?.id)??[];
        card.append(node('p',r?j09BatchStatus(jobs,request.count,state.content):'Saved request · '+request.state));
        for(const j of jobs)card.append(node('p',j09JobStatus(j,state.content)));
        box.append(card);
      }catch(e){box.append(node('p','Selected input review unavailable: '+e.message));}
    }
  }catch(e){if(!current())return;box.append(node('p','Operation selection history unavailable: '+e.message));}
  if(current()){await discover();if(current())await renderCalibration();}
}
async function discover(){
  const box=$('operation-list'),epoch=state.viewEpoch,discovery=++state.discoveryEpoch;box.replaceChildren();
  if(!state.productId)return;
  try{
    const selectedBrand=$('brand-id').value,includeBrand=$('branded').checked&&Boolean(selectedBrand);
    const q=new URLSearchParams({productId:state.productId,applicability:$('applicability').value,branded:String(includeBrand)});
    if(includeBrand)q.set('brandTemplateId',selectedBrand);
    const result=await api('/api/operation-discovery?'+q);
    if(epoch!==state.viewEpoch||discovery!==state.discoveryEpoch)return;
    const brands=$('brand-id');brands.replaceChildren(new Option('Choose Brand',''),
      ...result.brands.filter(x=>x.chosen).map(x=>new Option(x.templateId+' · revision '+x.chosen.template.revision,x.templateId)));
    brands.value=result.brands.some(x=>x.chosen&&x.templateId===selectedBrand)?selectedBrand:'';
    if($('branded').checked&&!brands.value)box.append(node('p','Choose an adopted Brand to assess branded preparation.','notice'));
    box.append(node('p','Choose an operation for your photo. Preparing settings does not start work.','fine'));
    box.append(node('p',result.branded?'Brand: '+(result.brand?.template?.id??result.brandTemplateId??'unavailable')+
      (result.brand?.template?' · adopted revision '+result.brand.template.revision:' · no adopted choice'):'Brand: not selected for this preparation'));
    if(!result.operations.length)box.append(node('p','No adopted operations match this applicability.'));
    for(const op of result.operations){
      const card=node('article','','content-card');card.append(node('h3',op.templateId),node('p','Adopted choice: '+(op.chosen?.template?'revision '+op.chosen.template.revision:'unavailable')));
      if(op.blockers.length)card.append(node('p','Unavailable: '+op.blockers.join(', ')));
      const technical=node('details');technical.append(node('summary','Operation technical inspection'),...['contract','operational','visual','human'].map(key=>chip(key+': '+(op.status?.[key]?.state??'unavailable'))));card.append(technical);box.append(card);
      const selected=state.preparation;
      if(selected?.productId===state.productId&&op.chosen?.template){
        const inspect=node('button','Inspect preparation with selected input');
        inspect.onclick=()=>{
          const details=node('div','','preparation-details');details.append(node('h4','Read-only preparation · '+op.templateId),
            node('p','Input: '+(selected.filename??selected.artifactId)+' · artifact '+selected.artifactId),
            node('p','Current adopted operation: '+op.chosen.template.id+' · revision '+op.chosen.template.revision),
            node('p',result.branded?'Brand: '+(result.brand?.template?'adopted '+result.brand.template.id+' · revision '+result.brand.template.revision:'no adopted Brand choice'):'Brand: not selected'),
            node('p','Source blockers: '+([...new Set([...result.productBlockers,...op.blockers,...(selected.sourceBlocker?[selected.sourceBlocker]:[])])].join(', ')||'none reported; source proof still required')),
            node('p','Capability: generator not assessed. Selection has not created a request or started work.'));
          card.querySelector('.preparation-details')?.remove();card.append(details);
        };card.append(inspect);
        const launch=node('button','Prepare this operation');launch.onclick=()=>operationLauncher(card,op,result);card.append(launch);
        try{
          const query={productId:state.productId,applicability:$('applicability').value,operationTemplateId:op.templateId,branded:includeBrand,brandTemplateId:includeBrand?selectedBrand:null};
          const v=await api('/api/operation-preparation?'+new URLSearchParams({...query,branded:String(includeBrand),brandTemplateId:query.brandTemplateId??''}));
          if(epoch!==state.viewEpoch||discovery!==state.discoveryEpoch)return;
          card.querySelector('h3').textContent=v.operation.record.title;
          if(v.operation.record.launch?.executionKind==='generative'&&['artistic','instagram-artistic'].includes(query.applicability)){
            const prepared=await post('/api/calibration',{action:'prepare',key:crypto.randomUUID(),input:query});
            if(epoch!==state.viewEpoch||discovery!==state.discoveryEpoch)return;
            if(comparisonVariants(prepared).length>=3&&selected.artifact&&!selected.sourceBlocker){
              const test=node('button','Test template');test.onclick=()=>calibrationLauncher(card,op,result);card.append(test);
            }else card.append(node('p',selected.sourceBlocker?'Template comparison needs an available photo.':'Template comparison needs three compatible Instagram artistic treatments.'));
          }
        }catch{if(epoch===state.viewEpoch&&discovery===state.discoveryEpoch)card.append(node('p','Template comparison availability could not be checked. Refresh the operation list.'));}
      }
    }
    if(result.productBlockers.length)box.append(node('p','Product source gaps: '+result.productBlockers.join(', ')));
  }catch(e){if(epoch===state.viewEpoch&&discovery===state.discoveryEpoch)box.append(node('p','Operation discovery unavailable: '+e.message));}
}
async function start(){
  state.token=(await (await fetch('/api/bootstrap')).json()).token;
  try{await loadIndex();drawLanding();renderPending();const h=hash();if(h.get('product'))await openProduct(h.get('product'),h.get('tab')??'information');}
  catch(e){say('Products are unavailable: '+e.message);drawLanding();$('new-product').disabled=true;}
}
$('new-product').onclick=()=>{$('create-form').hidden=false;$('working-name').focus()};
$('cancel-create').onclick=()=>{$('create-form').hidden=true};
$('back-products').onclick=()=>route();
for(const tab of document.querySelectorAll('[data-tab]'))tab.onclick=()=>{location.hash=new URLSearchParams({product:state.productId,tab:tab.dataset.tab})};
$('discover').onclick=()=>discover();$('applicability').onchange=()=>discover();$('branded').onchange=()=>discover();
$('brand-id').onchange=()=>discover();
$('create-form').onsubmit=async e=>{
  e.preventDefault();const button=e.submitter;button.disabled=true;
  const input={productId:crypto.randomUUID(),workingName:$('working-name').value,productCode:null};
  if($('initial-note').value.trim())input.note=$('initial-note').value;
  try{
    if(rejectedFor(x=>x?.operation==='product.create'&&x.input?.workingName===input.workingName&&(x.input?.note??'')===(input.note??'')))
      throw Error('A rejected creation must be acknowledged after a current reread before another explicit attempt.');
    if(pendingFor(x=>x?.operation==='product.create'&&x.input?.workingName===input.workingName&&(x.input?.note??'')===(input.note??'')))
      throw Error('This product creation has an unconfirmed action. Review its original key above.');
    await submitCommand({schemaVersion:'3djat.command.v1',operation:'product.create',key:crypto.randomUUID(),
    expected:{domainHead:state.index.head,entityRevision:0},input},'New product');
    $('create-form').hidden=true;await loadIndex();route(input.productId);
  }catch(error){say('Product creation not confirmed: '+error.message+' Your name and notes remain here.');}
  finally{button.disabled=false;}
};
window.addEventListener('hashchange',()=>{const h=hash();if(h.get('product')&&h.get('product')!==state.productId)openProduct(h.get('product'),h.get('tab')??'information');else if(h.get('product'))selectTab(h.get('tab')??'information');else drawLanding()});

// J09 operation/review UI. The public handlers freeze authority; these controls grant no execution.
const artifactRef=a=>({productId:a.projectId,artifactId:a.id,version:a.version,sha256:a.sha256,width:a.width,height:a.height});
const actionNames={reject:'Rejected',retain:'Retained in history','accept-for-editing':'Approved for further editing','approve-output':'Output approved'};
const pretty=s=>s.replace(/^out(\d+)/,(_,n)=>'Output '+(Number(n)+1)+' ').replace(/([a-z])([A-Z])/g,'$1 $2').replaceAll('_',' ');
function chooseContent(a,correction=false){
  state.preparation={productId:state.productId,artifactId:a.id,correction};
  location.hash=new URLSearchParams({product:state.productId,tab:'prepare',source:a.id,...(correction?{correct:'1'}:{})});
  return selectTab('prepare');
}
async function contentData(isCurrent=()=>true){
  const productId=state.productId,epoch=state.viewEpoch,result=await api('/api/content-review?'+new URLSearchParams({productId}));
  if(epoch!==state.viewEpoch||productId!==state.productId||!isCurrent())return null;state.content=result;return result;
}
async function previewArtifact(a,card,current){
  try{const media=await api('/api/original?'+mediaQuery(a));if(!current())return;
    if(media.state!=='ready'){card.append(node('p','Preview unavailable: '+media.errorCode));return;}
    const img=node('img');img.alt='Retained content preview';img.src=URL.createObjectURL(new Blob([Uint8Array.from(atob(media.preview.bytes),c=>c.charCodeAt(0))],{type:'image/png'}));
    state.previewUrls.push(img.src);card.append(img);
  }catch(e){if(current())card.append(node('p','Content inaccessible: '+e.message));}
}
function j09JobStatus(job,content){
  const statement=content.statements?.find(st=>st.jobId===job.id),report=statement?.events.at(-1);
  return job.specification.label+': '+job.state+(job.reason?' · '+job.reason:'')+
    (report?.kind==='blocked'&&job.invocationsStarted===0&&['assigned','blocked'].includes(job.state)?' · Blocked before invocation: '+report.report.text:report?.actor.role==='service'?' · Service report: '+report.kind+' · '+report.report.text:'');
}
function j09BatchStatus(jobs,count,content){
  const good=jobs.filter(j=>j.state==='succeeded').length,prefix=good+' of '+count+' results available · ';
  if(jobs.some(j=>j.state==='uncertain'))return prefix+'Outcome uncertain; no automatic retry.';
  if(jobs.some(j=>j.invocationsStarted===0&&['assigned','blocked'].includes(j.state)&&content?.statements?.find(st=>st.jobId===j.id)?.events.at(-1)?.kind==='blocked'))return prefix+'Blocked before invocation; other results remain available.';
  if(good===count)return prefix+'All requested outputs available; human review remains separate.';
  if(jobs.length&&jobs.every(j=>j.state==='failed'))return prefix+'Failed; no verified output.';
  return prefix+(good?'Partial results; other work remains unresolved.':'Work remains unresolved.');
}
async function renderContent(approvedOnly=false){
  const productId=state.productId,epoch=state.viewEpoch,slot=approvedOnly?'approved':'candidate',render=++state.contentEpoch[slot],target=$(approvedOnly?'approved-list':'candidate-list');target.replaceChildren();
  const current=()=>epoch===state.viewEpoch&&productId===state.productId&&render===state.contentEpoch[slot];
  try{const data=await contentData(current);if(!data||!current())return;
    let entries=data.entries;if(approvedOnly)entries=entries.filter(e=>e.channels.some(c=>c.current));
    else entries=entries.filter(e=>!e.historicalImport);
    if(!entries.length)target.append(node('p',approvedOnly?'No current approved outputs.':'No produced candidates yet. Saved requests and retained inputs remain available.'));
    const grouped=new Map();
    for(const e of entries){
      const a=e.artifact,card=node('article','','content-card');card.dataset.artifact=a.id;
      const label=data.jobs.find(j=>j.id===a.jobId)?.specification.label??'Retained photo';
      card.append(node('h3',label),chip(e.historicalImport?'Historical import':e.editing?actionNames[e.editing.action]:'Awaiting explicit review'));
      for(const c of e.channels)card.append(chip(c.channel+' · '+(c.current?'Current approved output':c.supersededBy.length?'Historical · superseded output':actionNames[c.action])));
      await previewArtifact(a,card,current);if(!current())return;
      const branch=node('button','Use as a new source');branch.onclick=()=>chooseContent(a);card.append(branch);
      if(a.uncompositedParent){const correction=node('button','Correct this output only');correction.onclick=()=>chooseContent(a,true);
        card.append(correction,node('p','Corrections reuse the retained scene and selected logo treatment.','fine'));}
      const form=node('div','','decision-controls'),reason=node('input');reason.placeholder='Optional review note';reason.maxLength=20000;reason.setAttribute('aria-label','Review note');
      const channel=node('select');channel.setAttribute('aria-label','Decision scope');
      channel.append(new Option('Candidate / editing',''),new Option('Instagram feed','instagram-feed'),new Option('Instagram story','instagram-story'),new Option('Website','website'));
      if(e.outputRole==='feed')channel.value='instagram-feed';else if(e.outputRole==='story')channel.value='instagram-story';
      const latest=e.history.at(-1),technical=node('details');technical.append(node('summary','History and technical inspection'));
      for(const h of e.history)technical.append(node('p',actionNames[h.record.action]+' · '+(h.record.channel??'candidate / editing')+' · '+h.record.reason+' · '+h.record.decidedAt));
      technical.append(node('pre',JSON.stringify({artifact:artifactRef(a),parents:e.parents,recipe:a.recipeHash,decisions:e.history.map(x=>x.reference)},null,2)));
      for(const [action,title] of [['reject','Reject'],['retain','Keep in history'],['accept-for-editing','Approve for further editing'],['approve-output','Approve output']]){
        const b=node('button',title);b.onclick=async()=>{
          if(b.disabled)return;
          const scope=action==='accept-for-editing'?null:channel.value||null;
          if(action==='approve-output'&&!scope){say('Choose the output channel before approving.');return;}
          if(j09Blocked(x=>x.input?.artifact?.artifactId===a.id)){say('An earlier decision needs exact reconciliation or review and acknowledgment of its rejection before another decision.');return;}
          b.disabled=true;say('Saving this decision...');try{
            const input={schemaVersion:'3djat.candidate-decision.v1',decisionId:crypto.randomUUID(),productId,artifact:artifactRef(a),action,purpose:scope?'Channel output review':'Candidate review',
              channel:scope,reason:reason.value.trim()||title,decidedAt:new Date().toISOString(),humanActionReceipt:{id:'placeholder',revision:1,path:'placeholder.json',sha256:'0'.repeat(64)},supersedesDecision:latest?.reference??null};
            const packet={schemaVersion:'3djat.command.v1',operation:'candidate.decide',key:crypto.randomUUID(),expected:{domainHead:data.head,entityRevision:latest?.sequence??0},input};
            input.humanActionReceipt=await post('/api/candidate-action-reference',packet);
            if(!current())return;
            await sendJ09('/api/candidate-decision',packet,'Content decision');
            if(current()){say('Decision saved.');await renderContent(approvedOnly);}
          }catch(err){if(current())say('Decision not confirmed: '+err.message);}finally{b.disabled=false;}
        };form.append(b);
      }
      form.prepend?.(channel,reason);if(!form.prepend)form.append(channel,reason);card.append(form,technical);
      if(approvedOnly){
        for(const c of e.channels.filter(c=>c.current)){
          if(!grouped.has(c.channel)){const group=node('section');group.append(node('h3',c.channel));grouped.set(c.channel,group);target.append(group);}
          const approved=node('article','','content-card');approved.append(node('h4',label),chip('Current approved output'));
          const use=node('button','Review or branch from this output');use.onclick=()=>chooseContent(a);approved.append(use);
          await previewArtifact(a,approved,current);if(!current())return;grouped.get(c.channel).append(approved);
        }
      }else target.append(card);
    }
    if(!approvedOnly){
      const status=$('operation-status');status.replaceChildren();
      for(const r of data.requests){
        const round=data.rounds.find(x=>x.requestId===r.id),jobs=data.jobs.filter(x=>x.roundId===round?.id),good=jobs.filter(x=>x.state==='succeeded').length;
        const card=node('article','','history-card');
        card.append(node('h3',r.intent),node('p',round?j09BatchStatus(jobs,r.count,data):'Saved request · '+r.state),
          node('p',round?jobs.map(j=>j09JobStatus(j,data)).join('; '):r.gap));
        if(round){const board=node('a','Open original board');board.href='/#'+new URLSearchParams({project:productId,page:'board',round:round.id});card.append(board);}
        status.append(card);
      }
    }
  }catch(e){if(current())target.replaceChildren(node('p','Current content unavailable: '+e.message));}
}
function j09Records(predicate,statuses){return Object.keys(localStorage).some(k=>k.startsWith('3djat:j09:')&&(()=>{try{const x=JSON.parse(localStorage.getItem(k));return statuses.includes(x.status)&&predicate(x.packet)}catch{return false}})());}
function j09Pending(predicate){return j09Records(predicate,['uncertain']);}
function j09Blocked(predicate){return j09Records(predicate,['uncertain','rejected']);}
function definiteJ09Rejection(path,packet,e){
  return (path==='/api/operation-request'&&packet.operation==='operation.request'||path==='/api/candidate-decision'&&packet.operation==='candidate.decide')&&
    e.result?.noEffect===true&&e.result.error===e.code&&
    ['REVISION_CONFLICT','INVALID_SCOPE','INVALID_VALUE','INVALID_TYPE','OUT_OF_BOUNDS','UNKNOWN_FIELD','MISSING_SOURCE','INVALID_SELECTION','BRAND_SETUP_NEEDED','EVIDENCE_MISMATCH','IDEMPOTENCY_CONFLICT'].includes(e.code);
}
function retainJ09Rejection(key,item,e){
  if(!definiteJ09Rejection(item.path,item.packet,e))return false;
  localStorage.setItem(key,JSON.stringify({...item,status:'rejected',code:e.code,rejection:e.result,rejectedAt:new Date().toISOString()}));
  renderJ09Pending();return true;
}
async function readJ09Current(item){
  const productId=item.packet.input.productId,index=await api('/api/products');
  if(!index.products.some(p=>p.productId===productId))throw Error('The original product is unavailable in current authority.');
  const product=await post('/api/product-review',{productId,atHead:index.head}),content=await api('/api/content-review?'+new URLSearchParams({productId}));
  if(JSON.stringify(product.head)!==JSON.stringify(index.head)||JSON.stringify(content.head)!==JSON.stringify(index.head))throw Error('The workspace changed during review. Read current state again.');
  const artifactId=item.packet.input.artifact?.artifactId,entry=content.entries.find(e=>e.artifact.id===artifactId);
  const facts=Object.entries(product.product.record.facts).map(([key,f])=>pretty(key)+': '+(f.state==='accepted'?val(f.value):f.state));
  const summary=[product.product.record.workingName,...facts];
  if(artifactId){if(!entry)throw Error('The original content is unavailable.');summary.push('Candidate: '+(entry.editing?actionNames[entry.editing.action]:'Awaiting review'),...entry.channels.map(c=>c.channel+': '+actionNames[c.action]));}
  else summary.push(content.requests.length+' saved request(s); submission has not authorized extra work.');
  return {authority:{head:index.head,tail:entry?.history.at(-1)?.reference??null},summary,readAt:new Date().toISOString()};
}
function renderJ09Pending(){
  const target=$('operation-pending');target.replaceChildren();
  for(const key of Object.keys(localStorage).filter(k=>k.startsWith('3djat:j09:'))){
    let item;try{item=JSON.parse(localStorage.getItem(key));}catch{continue;}
    if(!['uncertain','rejected','confirmed','acknowledged'].includes(item.status))continue;
    const card=node('article','','history-card'),status={uncertain:'response unknown; original action retained',rejected:'definite no-effect rejection; review current state before a new action',confirmed:'confirmed; original receipt retained',acknowledged:'rejection reviewed and acknowledged; original action retained'}[item.status];
    card.append(node('p',item.label+' · '+status));
    const words=item.packet.input.intent??item.packet.input.reason;if(words)card.append(node('p','Original words: '+words));
    for(const [name,value] of Object.entries(item.packet.input.selection??{}))card.append(node('p',pretty(name)+': '+String(value),'fine'));
    if(item.code)card.append(node('p','Rejection: '+item.code));
    const inspect=node('details');inspect.append(node('summary','Action inspection'),node('pre',JSON.stringify(item,null,2)));card.append(inspect);
    if(item.status==='uncertain'){
      const b=node('button','Reconcile this exact action');b.onclick=async()=>{if(b.disabled)return;b.disabled=true;try{
        const result=await post(item.path,item.packet);localStorage.setItem(key,JSON.stringify({...item,status:'confirmed',result}));renderJ09Pending();
        if(state.review)await renderPreparation();say('Original action reconciled.');
      }catch(e){if(retainJ09Rejection(key,item,e))say('Original action was definitely rejected without effect. Read current state and acknowledge before a fresh action.');
        else say('Original action remains unresolved: '+e.message);}finally{b.disabled=false;}};
      card.append(b);
    }
    if(item.status==='rejected'){
      const read=node('button','Read current state');read.onclick=async()=>{if(read.disabled)return;read.disabled=true;try{
        const review=await readJ09Current(item);localStorage.setItem(key,JSON.stringify({...item,review,reviewStale:false}));renderJ09Pending();
        say('Current state is shown with the retained rejection. Review it before acknowledging.');
      }catch(e){say('Current review unavailable; the rejection remains to be acknowledged: '+e.message);}finally{read.disabled=false;}};card.append(read);
      if(item.review){
        card.append(node('h4','Current state read for review'),...item.review.summary.map(s=>node('p',s)));
        if(item.reviewStale)card.append(node('p','This review changed. Read current state again.'));
        else{
          const acknowledge=node('button','Acknowledge reviewed rejection');acknowledge.onclick=async()=>{if(acknowledge.disabled)return;acknowledge.disabled=true;try{
            const current=await readJ09Current(item);
            if(JSON.stringify(current.authority)!==JSON.stringify(item.review.authority)){
              localStorage.setItem(key,JSON.stringify({...item,reviewStale:true}));renderJ09Pending();throw Error('Current state changed; review it again before acknowledgment.');
            }
            localStorage.setItem(key,JSON.stringify({...item,status:'acknowledged',acknowledgedAt:new Date().toISOString()}));renderJ09Pending();
            say('Rejection acknowledged. Its original words and settings remain here. Make a fresh explicit action from the current product or content.');
          }catch(e){say('Rejection remains to be acknowledged: '+e.message);}finally{acknowledge.disabled=false;}};card.append(acknowledge);
        }
      }
    }
    target.append(card);
  }
}
async function sendJ09(path,packet,label){
  const key='3djat:j09:'+packet.key,old=JSON.parse(localStorage.getItem(key)||'null');
  if(old&&(old.path!==path||JSON.stringify(old.packet)!==JSON.stringify(packet)))throw Error('This action key already retains a different packet. The original was preserved.');
  if(old&&['rejected','acknowledged'].includes(old.status))throw Error('This rejected action remains in history. Make a fresh explicit action with current authority.');
  const item=old??{path,packet,label,status:'uncertain'};localStorage.setItem(key,JSON.stringify(item));renderJ09Pending();
  try{const result=await post(path,packet);localStorage.setItem(key,JSON.stringify({...item,status:'confirmed',result}));renderJ09Pending();return result;}
  catch(e){retainJ09Rejection(key,item,e);throw e;}
}
function buildOperationPacket(prepared,values){
  const t=prepared.operation.record,count=values.requestedOutputs.reduce((n,x)=>n+x.count,0);
  if(!Number.isInteger(count)||count<1||count>6)throw Error('Choose between one and six outputs.');
  const branded=Boolean(prepared.brand),brandInstructions=prepared.brand?.record.instructions??null;
  const input={schemaVersion:'3djat.operation-run.v1',runId:crypto.randomUUID(),productId:prepared.product.record.productId,domainHead:prepared.head,
    product:prepared.product.reference,template:prepared.operation.reference,brand:prepared.brand?.reference??null,branded,brandInstructions,
    applicability:values.applicability,intent:values.intent.trim()||'Prepare '+t.title+'.',direction:values.parentArtifacts.length?'Follow':'Fresh',
    selection:values.selection,preset:values.preset,acceptedFacts:prepared.product.record.facts,sources:values.sources,attachments:values.attachments,
    requestedOutputs:values.requestedOutputs,executionKind:t.launch?.executionKind??(values.selection.recipeversion===1?'deterministic':'generative'),
    executorId:(t.launch?.executionKind??(values.selection.recipeversion===1?'deterministic':'generative'))==='deterministic'?'pillow-png-v1':'native-unavailable',
    parentRoundId:values.parentRoundId,parentArtifacts:values.parentArtifacts,allowance:{primaryAttempts:count,maxRetries:0},
    canonical:{direction:values.parentArtifacts.length?'Follow':'Fresh',brand:brandInstructions,count}};
  return {schemaVersion:'3djat.command.v1',operation:'operation.request',key:crypto.randomUUID(),expected:{domainHead:prepared.head,entityRevision:0},input};
}
async function operationLauncher(card,op,result){
  const productId=state.productId,epoch=state.viewEpoch,selected=state.preparation;
  if(!selected||selected.productId!==productId){say('Choose a retained photo or content item first.');return;}
  const current=()=>epoch===state.viewEpoch&&productId===state.productId&&state.preparation===selected;
  card.querySelector('.operation-form')?.remove();const form=node('form','','operation-form');card.append(form);
  try{
    const query={productId,applicability:$('applicability').value,operationTemplateId:op.templateId,branded:false,brandTemplateId:null};
    const initial=await post('/api/operation-preparation',query),data=await contentData();if(!current()||!data)return;
    const t=initial.operation.record,entry=data.entries.find(e=>e.artifact.id===selected.artifactId);if(!entry)throw Error('Selected source is unavailable.');
    const a=entry.artifact,recipe=data.jobs.find(j=>j.id===a.jobId)?.specification.recipe;
    form.append(node('h3',t.title),node('p','Choose what to prepare. Submission saves a request for the Conductor; it does not start tools or create staff.','fine'));
    const branded=node('input');branded.type='checkbox';branded.checked=t.launch?.brandedDefault??true;
    const brandedLabel=node('label','Branded');brandedLabel.append(branded);form.append(brandedLabel);
    const brands=node('select');brands.setAttribute('aria-label','Accepted Brand');brands.append(new Option('Choose accepted Brand',''),...result.brands.filter(x=>x.chosen).map(x=>new Option(x.templateId,x.templateId)));
    brands.value=$('brand-id').value||result.brands.find(x=>x.chosen)?.templateId||'';form.append(brands);
    const explanation=node('p','','notice');form.append(explanation);
    const brandStatus=()=>{explanation.textContent=branded.checked&&!brands.value?'Choose an accepted Brand; branded preparation is blocked.':!branded.checked&&t.launch?.allowUnbranded===false?'This operation requires Brand.':'Brand is independent of the selected operation.';};brandStatus();branded.onchange=brandStatus;brands.onchange=brandStatus;
    const intent=node('textarea');intent.maxLength=20000;intent.setAttribute('aria-label','Additional instructions');intent.placeholder='Additional instructions (optional)';form.append(intent);
    const sources=[],attachments=[],sourceBox=node('fieldset');sourceBox.append(node('legend','Retained inputs'));
    for(const d of t.inputs){
      const label=node('label',pretty(d.role)+(d.required?' (required)':' (optional)')),select=node('select');select.setAttribute('aria-label',d.role+' input');select.append(new Option('Choose retained input',''));
      if(d.kind==='verified-image'){
        const candidates=data.entries.filter(e=>!(d.role==='scene'&&e.artifact.uncompositedParent));
        for(const e of candidates){const item=data.jobs.find(j=>j.id===e.artifact.jobId)?.specification.label??(e.artifact.id===a.id?'Selected photo':'Retained photo');select.append(new Option(item+' · '+(e.historicalImport?'historical input':e.editing?actionNames[e.editing.action]:'review pending'),e.artifact.id));}
        select.value=d.role==='logo'?(a.logoLayer?.artifactId??''):d.role==='scene'?(a.uncompositedParent?.artifactId??a.id):a.id;
        sources.push({declaration:d,select});
      }else{
        for(const x of state.review.attachments)if(x.current.status==='available')select.append(new Option(x.record.filename,x.reference.id));attachments.push({declaration:d,select});
      }
      label.append(select);sourceBox.append(label);
    }form.append(sourceBox);
    if(recipe)form.append(node('p','Selected treatment retained. Conventional output uses its uncomposited scene and logo layer; the composited image is kept in history.','fine'));
    const parameters=t.exploration?.parameters??{},controls={},params=node('fieldset');params.append(node('legend','Operation settings'));
    const defaultValue=(key,d)=>{
      const match=/^out(\d+)(width|height)$/.exec(key);if(match)return recipe?.output[match[2]]??(match[2]==='width'?a.width:a.height);
      const defaults={recipeversion:1,cropx:recipe?.crop.x??0,cropy:recipe?.crop.y??0,cropwidth:recipe?.crop.width??a.width,cropheight:recipe?.crop.height??a.height,
        logowidth:recipe?.placement?.width??Math.max(1,Math.round(a.width/8)),logoopacity:recipe?.placement?.opacity??1,
        logomarginx:recipe?.placement?.spacing.right??0,logomarginy:recipe?.placement?.spacing.bottom??0,logoanchor:'bottom-right'};
      const shared=key.replace(/^out\d+/,'');return Object.hasOwn(defaults,shared)?defaults[shared]:d.type==='enum'?d.values[0]:d.type==='boolean'?false:d.min;
    };
    for(const [key,d] of Object.entries(parameters)){
      const label=node('label',pretty(key)),input=d.type==='enum'?node('select'):node('input');input.setAttribute('aria-label',pretty(key));
      if(d.type==='enum')input.append(...d.values.map(v=>new Option(v,v)));else if(d.type==='number'){input.type='number';input.min=d.min;input.max=d.max;input.step='any';input.required=true;}else input.type='checkbox';
      const v=defaultValue(key,d);if(d.type==='boolean')input.checked=v;else input.value=v;
      controls[key]={input,definition:d};label.append(input);params.append(label);
    }form.append(params);
    const presets=node('select');presets.setAttribute('aria-label','Exploration preset');presets.append(new Option('Custom settings',''),...Object.keys(t.exploration?.presets??{}).map(p=>new Option(pretty(p),p)));
    presets.onchange=()=>{const p=t.exploration?.presets[presets.value];if(p)for(const [key,v] of Object.entries(p)){const c=controls[key];if(c.definition.type==='boolean')c.input.checked=v;else c.input.value=v;}};
    for(const c of Object.values(controls))c.input.oninput=()=>{presets.value='';};form.append(presets);
    const outputs=[],out=node('fieldset');out.append(node('legend','Outputs · one to six in total'));
    for(const d of t.outputs){const label=node('label',pretty(d.role)),input=node('input');input.type='number';input.min=0;input.max=6;input.step=1;input.required=true;input.setAttribute('aria-label',pretty(d.role)+' count');
      input.value=selected.correction?(d.role===entry.outputRole?1:0):(outputs.length?0:1);outputs.push({role:d.role,input});label.append(input);out.append(label);}form.append(out);
    if(selected.correction)form.append(node('p','Correction starts with only the selected output enabled. The successful sibling remains unchanged.','fine'));
    const submit=node('button','Save operation request');submit.type='submit';form.append(submit);
    const inspection=node('details');inspection.append(node('summary','Technical inspection'),node('pre',JSON.stringify({operation:initial.operation.reference,selected:artifactRef(a),recipe},null,2)));form.append(inspection);
    form.onsubmit=async event=>{
      event.preventDefault();if(!current()||submit.disabled)return;submit.disabled=true;say('Saving this operation request...');
      try{
        if(branded.checked&&!brands.value)throw Error('An accepted Brand is required. Choose Brand or explicitly switch Branded off if permitted.');
        if(!branded.checked&&t.launch?.allowUnbranded===false)throw Error('This adopted operation requires Brand.');
        if(j09Blocked(x=>x.operation==='operation.request'&&x.input?.productId===productId))throw Error('Reconcile the earlier request, or review and acknowledge its definite rejection before making another.');
        const refreshed=await post('/api/operation-preparation',{...query,branded:branded.checked,brandTemplateId:branded.checked?brands.value:null});if(!current())return;
        if(JSON.stringify(refreshed.operation.reference)!==JSON.stringify(initial.operation.reference))throw Error('The adopted operation changed. Refresh and review the settings again.');
        const selectedSources=sources.flatMap(({declaration:d,select})=>{
          if(!select.value){if(d.required)throw Error('Choose '+pretty(d.role)+' input.');return [];}
          const found=data.entries.find(e=>e.artifact.id===select.value);if(!found)throw Error('Selected input is unavailable.');
          return [{artifact:artifactRef(found.artifact),role:d.role,regions:[]}];
        });
        const selectedAttachments=attachments.flatMap(({declaration:d,select})=>{if(!select.value){if(d.required)throw Error('Choose '+d.role+' attachment.');return [];}return [{reference:state.review.attachments.find(x=>x.reference.id===select.value).reference,role:d.role}];});
        const selection=Object.fromEntries(Object.entries(controls).map(([key,c])=>[key,c.definition.type==='boolean'?c.input.checked:c.definition.type==='number'?Number(c.input.value):c.input.value]));
        // J08 accepts only parameters of enabled output indices; hidden unused slots are not new work.
        const declaredOutputs=outputs.map(x=>({role:x.role,count:Number(x.input.value)}));
        if(declaredOutputs.some(x=>!Number.isInteger(x.count)||x.count<0||x.count>6))throw Error('Each output count must be a whole number from zero to six.');
        const requestedOutputs=declaredOutputs.filter(x=>x.count);
        const count=requestedOutputs.reduce((n,x)=>n+x.count,0);
        for(const key of Object.keys(selection)){const m=/^out(\d+)/.exec(key);if(m&&Number(m[1])>=count)delete selection[key];}
        if(!selectedSources.some(x=>x.role==='logo'))for(const key of Object.keys(selection))if(key.startsWith('logo')||/^out\d+logo/.test(key))delete selection[key];
        const packet=buildOperationPacket(refreshed,{applicability:query.applicability,intent:intent.value,selection,preset:presets.value||null,sources:selectedSources,
          attachments:selectedAttachments,requestedOutputs,parentArtifacts:[artifactRef(a)],parentRoundId:entry.branchRoundId??null});
        await sendJ09('/api/operation-request',packet,'Operation request');
        if(current()){say('Request saved. Execution has not started; resume the configured Conductor to commission it.');await renderPreparation();}
      }catch(e){if(current())say('Request not confirmed: '+e.message+' Your settings remain available.');}finally{submit.disabled=false;}
    };
  }catch(e){if(current())form.replaceChildren(node('p','Operation preparation unavailable: '+e.message));}
}


// Calibration is a projection of the existing request/round and comparison records.
// Retain exact packets on ambiguity; never start or retry a generator here.
function comparisonVariants(data){
 const operation=data.preparation.operation.record;
 return data.variants.filter(v=>v.record.launch?.executionKind==='generative'&&v.record.appliesTo.includes('instagram-artistic')&&v.sources.every(s=>s.status==='verified')&&
  JSON.stringify(v.record.inputs)===JSON.stringify(operation.inputs)&&JSON.stringify(v.record.outputs)===JSON.stringify(operation.outputs)&&v.record.outputs.length===1&&v.record.outputs[0].role==='candidate');
}
function comparisonLabel(parent,text,control){
 control.setAttribute('aria-label',text);const label=node('label',text);label.append(control);parent.append(label);return control;
}
function comparisonStatus(e){
 if(e.statuses.human==='adopted for Instagram artistic')return 'Selected for Instagram artistic';
 if(!e.result)return 'Waiting for comparison — results will appear here when available.';
 const completed=e.result.record.variants.filter(v=>v.outcome==='completed').length;
 if(!completed)return 'Comparison unavailable — no treatments completed. Inspect the treatment reasons below.';
 return e.reviews.length?'Reviewed — revise a treatment or select it for Instagram artistic.':completed===3?'Ready to compare — review the treatments and choose your preference.':'Ready to compare available treatments — some treatments are unavailable.';
}
async function calSend(action,input,key=null){
 const scope=action==='create'?'create:'+state.productId:action+':'+input.experimentId;
 if(!key){
  const pending=Object.keys(localStorage).filter(k=>k.startsWith('3djat:calibration:')).map(k=>{try{return JSON.parse(localStorage.getItem(k))}catch{return null}}).find(x=>x?.scope===scope&&['submitted','unconfirmed','rejected'].includes(x.status));
  if(pending)throw Error('Review and reconcile or acknowledge the original comparison action first.');
 }
 key??=crypto.randomUUID();const packet={action,key,input},store='3djat:calibration:'+key;
 const previous=JSON.parse(localStorage.getItem(store)??'null');
 localStorage.setItem(store,JSON.stringify({packet,scope:previous?.scope??scope,productId:previous?.productId??state.productId,status:'submitted'}));
 try{const result=await post('/api/calibration',packet);localStorage.setItem(store,JSON.stringify({packet,scope:previous?.scope??scope,productId:previous?.productId??state.productId,status:'confirmed',result}));return result;}
 catch(e){localStorage.setItem(store,JSON.stringify({packet,scope:previous?.scope??scope,productId:previous?.productId??state.productId,status:e.result?.noEffect===true?'rejected':'unconfirmed',error:e.message}));throw e;}
}
async function calibrationLauncher(card,op,discovery){
 const productId=state.productId,epoch=state.viewEpoch,current=()=>epoch===state.viewEpoch&&productId===state.productId;
 card.querySelector('.calibration-form')?.remove();const form=node('form','','calibration-form');card.append(form);
 try{
  const applicability=$('applicability').value,branded=$('branded').checked&&Boolean($('brand-id').value),brandTemplateId=branded?$('brand-id').value:null;
  const data=await post('/api/calibration',{action:'prepare',key:crypto.randomUUID(),input:{productId,applicability:$('applicability').value,operationTemplateId:op.templateId,branded,brandTemplateId}});if(!current())return;
  data.variants=comparisonVariants(data);
  if(data.variants.length<3)throw Error('Three compatible Instagram artistic treatments are needed.');
  form.append(node('h4','Compare three treatments'),node('p','Use the same photo, instructions, settings and Brand for all three treatments. Saving a request does not start generation.'));
  const choices=[];
  for(const [i,label] of ['A','B','C'].entries()){
   const select=node('select');select.setAttribute('aria-label','Variant '+label);
   data.variants.forEach((v,n)=>select.append(new Option(v.record.title+' / revision '+v.reference.revision,String(n))));select.value=String(i);choices.push(select);comparisonLabel(form,'Variant '+label,select);
  }
  const label=(text,control)=>{control.setAttribute('aria-label',text);const l=node('label',text);l.append(control);form.append(l);return control;};
  const intent=label('Common instructions',node('textarea'));intent.required=true;intent.value='Compare contrast treatments while preserving this photographed product.';
  const advanced=node('details');advanced.append(node('summary','Advanced repeatability settings'));form.append(advanced);
  const seed=comparisonLabel(advanced,'Common seed',node('input'));seed.type='number';seed.value='73';seed.min='0';
  const readers=[];for(const [name,def] of Object.entries(data.preparation.operation.record.exploration?.parameters??{})){
   let control;if(def.type==='enum'){control=node('select');def.values.forEach(v=>control.append(new Option(v,v)));}else{control=node('input');control.type=def.type==='boolean'?'checkbox':'number';if(def.type==='number'){control.min=def.min;control.max=def.max;control.step='any';control.value=String(def.min);}}
   label('Common '+name,control);readers.push(()=>[name,def.type==='boolean'?control.checked:def.type==='enum'?control.value:Number(control.value)]);
  }
  const save=node('button','Save comparison request');save.type='submit';form.append(save);
  form.onsubmit=async e=>{e.preventDefault();save.disabled=true;say('Saving comparison...');try{
   if(!current()||!state.preparation?.artifact||state.preparation.sourceBlocker)throw Error('A currently verified input is required.');
   const variants=choices.map(c=>data.variants[Number(c.value)].reference);if(new Set(variants.map(v=>v.revision)).size!==3)throw Error('Choose three distinct revisions.');
   const record={schemaVersion:'3djat.calibration.v1',experimentId:crypto.randomUUID(),productId,revision:1,lifecycle:'draft',commonSources:[structuredClone(state.preparation.artifact)],commonIntent:intent.value,commonSettings:Object.fromEntries(readers.map(r=>r())),seed:Number(seed.value),executorId:'configured-creative-worker',executorVersion:'unassessed',changedDimension:'Selected template contrast instructions',uncontrolledVariables:['Native variation and real visual quality remain untested.'],variants:variants.map(template=>({template,roundId:null,outcome:'draft',outputs:[],failureCode:null})),receipt:null};
   await calSend('create',{preparation:{applicability,operationTemplateId:op.templateId,branded,brandTemplateId,atHead:data.preparation.head},record,previousExperiment:null,revisionLink:null});
   if(current()){await renderCalibration();say('Comparison request saved. Waiting for generation; results will appear here when available.');}
  }catch(e){say('Comparison not confirmed: '+e.message+' Retained action can be reconciled below.');if(current())await renderCalibration();}finally{save.disabled=false;}};
 }catch(e){if(current())form.replaceChildren(node('p','Template comparison unavailable: '+e.message));}
}
async function renderCalibration(){
 const productId=state.productId,epoch=state.viewEpoch,render=++state.calibrationEpoch,current=()=>epoch===state.viewEpoch&&productId===state.productId&&render===state.calibrationEpoch;
 let box=$('calibration-list');if(!box){box=node('section');box.id='calibration-list';$('prepare').append(box);}box.replaceChildren(node('h2','Template comparisons'));
 for(const key of Object.keys(localStorage).filter(k=>k.startsWith('3djat:calibration:'))){
  let x;try{x=JSON.parse(localStorage.getItem(key));}catch{continue;}if(['confirmed','acknowledged'].includes(x.status)||x.productId!==productId)continue;
  const card=node('article','','history-card'),retry=node('button',x.status==='rejected'?'Reread and acknowledge comparison rejection':'Reconcile exact comparison action');card.append(node('p','Unconfirmed '+x.packet.action+': '+(x.error??'response unknown')),retry);
  retry.onclick=async()=>{retry.disabled=true;try{if(x.status==='rejected'){await api('/api/calibration?'+new URLSearchParams({productId}));if(!current())return;localStorage.setItem(key,JSON.stringify({...x,status:'acknowledged'}));}else await calSend(x.packet.action,x.packet.input,x.packet.key);if(current())await renderCalibration();}catch(e){say('Action still requires review: '+e.message);}finally{retry.disabled=false;}};box.append(card);
 }
 try{
  const data=await api('/api/calibration?'+new URLSearchParams({productId}));if(!current())return;
  if(!data.experiments.length)box.append(node('p','No comparisons saved. Choose a photo and an eligible artistic operation to test three treatments.'));
  for(const e of data.experiments){
   const p=e.plan,card=node('article','','content-card calibration-experiment');card.dataset.experiment=p.id;
   card.append(node('h3',p.previousExperiment?'Revised comparison':'Initial comparison'),node('p',p.record.commonIntent),node('p',comparisonStatus(e)));
   const inspect=node('details'),summary=node('summary','Technical inspection: inputs, status and lineage');inspect.append(summary,...Object.entries(e.statuses).map(([k,v])=>chip(k+': '+v)),node('pre',JSON.stringify({plan:p,result:e.result},null,2)));card.append(inspect);
   const grid=node('div','','product-grid');
   for(const [n,v] of p.templates.entries()){
    const variant=node('article','','content-card');variant.append(node('h4',String.fromCharCode(65+n)+' - '+v.record.title),node('p','Revision '+v.reference.revision),node('p',v.record.instructions));
    const result=e.result?.record.variants[n];variant.append(node('p',result?.outcome==='completed'?'Ready to review':result&&['failed','blocked','unavailable'].includes(result.outcome)?'Treatment unavailable: '+(result.failureCode??'Generation did not complete.'):'Waiting for comparison'));
    for(const o of result?.outputs??[]){const a={...o.artifact,id:o.artifact.artifactId,projectId:o.artifact.productId};await previewArtifact(a,variant,current);if(!current())return;const board=node('a','Open comparison board');board.href='/#'+new URLSearchParams({project:productId,round:result.roundId});variant.append(board);}
    grid.append(variant);
   }card.append(grid);
   for(const review of e.reviews)card.append(node('p','Review: '+review.comments));
   for(const proposal of e.proposals)card.append(node('p',(proposal.kind==='revision'?'Explicit revision: ':'Unadopted proposal: ')+proposal.instructions));
   if(e.result){
    const form=node('form'),comments=node('textarea');comments.required=true;comparisonLabel(form,'Comparison comments',comments);
    const winner=node('select');winner.setAttribute('aria-label','Selected treatment');p.templates.forEach((v,n)=>{if(e.result.record.variants[n].outcome==='completed')winner.append(new Option(String.fromCharCode(65+n)+' - '+v.record.title+' / revision '+v.reference.revision,String(n)));});comparisonLabel(form,'Selected treatment',winner);
    const review=node('button','Save comparison review');review.type='submit';review.disabled=!winner.options.length;form.append(review);
    form.onsubmit=async ev=>{ev.preventDefault();review.disabled=true;try{if(!current())throw Error('Open the current comparison before reviewing.');await calSend('review',{experimentId:p.id,comments:comments.value,selectedVariant:p.templates[Number(winner.value)].reference});if(current())await renderCalibration();}catch(err){say('Review not confirmed: '+err.message);}finally{review.disabled=false;}};card.append(form);
    const last=e.reviews.at(-1);
    if(last){
     const revision=node('textarea');revision.setAttribute('aria-label','Revised treatment instructions');revision.value=p.templates.find(v=>v.reference.sha256===last.selectedVariant.sha256).record.instructions;comparisonLabel(card,'Revised treatment instructions',revision);
     const revise=node('button','Revise selected treatment and compare again');revise.onclick=async()=>{revise.disabled=true;try{
      if(!current())throw Error('Open the current comparison before revising.');
      const r=e.proposals.find(r=>r.kind==='revision'&&r.original.sha256===last.selectedVariant.sha256&&r.instructions===revision.value&&r.reference)??await calSend('revise',{experimentId:p.id,original:last.selectedVariant,instructions:revision.value,reason:last.comments});
      if(data.experiments.some(v=>v.plan.previousExperiment===p.id&&v.plan.revisionLink===r.id))throw Error('The revision comparison already exists below.');
      const prepared=await post('/api/calibration',{action:'prepare',key:crypto.randomUUID(),input:{productId,applicability:p.scope,operationTemplateId:p.preparation.operation.reference.id,branded:!!p.preparation.brand,brandTemplateId:p.preparation.brand?.reference.id??null}});
      await calSend('create',{preparation:{applicability:p.scope,operationTemplateId:p.preparation.operation.reference.id,branded:!!p.preparation.brand,brandTemplateId:p.preparation.brand?.reference.id??null,atHead:prepared.preparation.head},record:{...p.record,experimentId:crypto.randomUUID(),variants:p.record.variants.map(v=>({...v,template:v.template.sha256===last.selectedVariant.sha256?r.reference:v.template}))},previousExperiment:p.id,revisionLink:r.id});
      if(current()){await renderCalibration();say('Revision comparison saved. Execution remains a separate step.');}
     }catch(err){say('Revision requires review: '+err.message);}finally{revise.disabled=false;}};card.append(revise);
     const promote=node('button','Promote selected revision for Instagram artistic only');promote.disabled=e.promotions.some(d=>d.activeAppliesTo.includes('instagram-artistic')&&d.record.template.sha256===last.selectedVariant.sha256);promote.onclick=async()=>{promote.disabled=true;try{
      if(!current())throw Error('Open the current comparison before deciding.');
      if(pendingFor(x=>x.operation==='template.promote'&&x.input.experiment?.id===e.result.reference.id)||rejectedFor(x=>x.operation==='template.promote'&&x.input.experiment?.id===e.result.reference.id))throw Error('Reconcile or acknowledge the original scoped promotion above before another decision.');
      const packet=await calSend('promotion',{experimentId:p.id,reviewId:last.id,template:last.selectedVariant,reason:last.comments});
      await submitCommand(packet,'Scoped template promotion');if(current()){await loadIndex();await renderCalibration();say('Scoped promotion recorded. Selected for Instagram artistic only.');}
     }catch(err){say('Promotion not confirmed: '+err.message+' Experiment remains separate from file-owned adoption.');}finally{promote.disabled=false;}};card.append(promote);
     const propose=node('button','Save light-product adjustment as proposal');propose.onclick=async()=>{propose.disabled=true;try{if(!current())throw Error('Open the current comparison before proposing.');await calSend('propose',{experimentId:p.id,original:last.selectedVariant,instructions:revision.value,reason:'Later light-product adjustment; no automatic propagation.'});if(current())await renderCalibration();}catch(err){say('Proposal not confirmed: '+err.message);}finally{propose.disabled=false;}};card.append(propose);
    }
   }box.append(card);
  }
 }catch(e){if(current())box.append(node('p','Comparison review unavailable: '+e.message));}
}
start().catch(e=>say('Products unavailable: '+e.message));
