const $=id=>document.getElementById(id);
const state={token:null,data:{},project:null,iteration:null,feedback:{overall:'',images:[]},version:0,dirty:false,focusId:null,region:null,drawing:false,urls:new Map(),lastSignature:null};
let saveTimer,saveQueue=Promise.resolve(),polling=false;
const uid=()=>crypto.randomUUID();
const el=(tag,content,cls)=>{const e=document.createElement(tag);if(content!==undefined)e.textContent=content;if(cls)e.className=cls;return e;};
function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('toast').hidden=true,6000);}
async function api(path,options={}){const r=await fetch(path,{...options,headers:{'Authorization':`Bearer ${state.token}`,...options.headers}});if(!r.ok){let v=await r.json();throw Error(v.error||'Request failed');}return r.json();}
const op=(op,input,key=uid())=>api('/api/op',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({op,key,input})});
const kinds=['project','iteration','job','artifact','draft','submission','continuation','request','event','acceptance'];
async function readAll(){const values=await Promise.all(kinds.map(kind=>api('/api/read?kind='+kind)));state.data=Object.fromEntries(kinds.map((k,n)=>[k,values[n]]));}
function route(p,i){location.hash=new URLSearchParams({project:p.id,page:'board',...(i?{iteration:i.id}:{})});localStorage.setItem('bve:last',location.hash);}
function sourceFeedback(a){let f=state.feedback.images.find(f=>f.artifactId===a.id);if(!f){f={artifactId:a.id,version:a.version,sha256:a.sha256,width:a.width,height:a.height,note:'',favorite:false,regions:[]};state.feedback.images.push(f);}return f;}
function draftKey(){return `bve:draft:${state.iteration?.id}`;}
function changed(){if(!state.iteration)return;state.dirty=true;localStorage.setItem(draftKey(),JSON.stringify({feedback:state.feedback,expectedVersion:state.version}));$('save-status').textContent='Saving…';clearTimeout(saveTimer);saveTimer=setTimeout(()=>saveDraft().catch(()=>{}),350);}
async function saveDraft(){
  clearTimeout(saveTimer);
  const iter=state.iteration;if(!iter)return;
  saveQueue=saveQueue.catch(()=>{}).then(async()=>{
    if(state.iteration?.id!==iter.id)return;
    const pendingKey=`bve:pending:${iter.id}`;
    let pending=JSON.parse(localStorage.getItem(pendingKey)||'null');
    if(pending){const recovered=await op('draft.save',pending.input,pending.key);state.version=recovered.version;localStorage.removeItem(pendingKey);}
    if(!state.dirty)return;
    const feedback=JSON.parse(JSON.stringify(state.feedback));pending={key:uid(),input:{iterationId:iter.id,expectedVersion:state.version,feedback}};
    localStorage.setItem(pendingKey,JSON.stringify(pending));
    try{
      const result=await op('draft.save',pending.input,pending.key);state.version=result.version;localStorage.removeItem(pendingKey);
      if(JSON.stringify(state.feedback)===JSON.stringify(feedback)){state.dirty=false;localStorage.removeItem(draftKey());$('save-status').textContent='Draft saved locally';}
      else{localStorage.setItem(draftKey(),JSON.stringify({feedback:state.feedback,expectedVersion:state.version}));setTimeout(()=>saveDraft().catch(()=>{}),0);}
    }catch(e){$('save-status').textContent='Save pending · recovery copy kept in this browser';toast(e.message);throw e;}
  });
  return saveQueue;
}
async function restoreDraft(){
  const d=state.data.draft.find(d=>d.id===state.iteration?.id);state.version=d?.version??0;state.feedback=structuredClone(d?.feedback??{overall:'',images:[]});state.dirty=false;
  if(!state.iteration)return;
  const pendingKey=`bve:pending:${state.iteration.id}`,pending=JSON.parse(localStorage.getItem(pendingKey)||'null');
  if(pending){try{const r=await op('draft.save',pending.input,pending.key);state.version=r.version;state.feedback=r.feedback;localStorage.removeItem(pendingKey);}catch(e){toast(e.message);}}
  const buffered=JSON.parse(localStorage.getItem(draftKey())||'null');
  if(buffered){
    if(buffered.expectedVersion===state.version){state.feedback=buffered.feedback;state.dirty=true;}
    else{
      const banner=$('request-gap');banner.hidden=false;banner.replaceChildren(el('p','A pending draft differs from a newer saved version. Both are preserved.'));
      const recover=el('button','Use recovered words'),keep=el('button','Keep saved version');
      recover.onclick=()=>{localStorage.removeItem(pendingKey);state.feedback=buffered.feedback;changed();renderFeedback();banner.hidden=true;};keep.onclick=()=>{localStorage.removeItem(pendingKey);localStorage.removeItem(draftKey());banner.hidden=true;};banner.append(recover,keep);
    }
  }
  $('save-status').textContent=state.dirty?'Recovered pending draft':'Draft saved locally';
  if(state.dirty)setTimeout(()=>saveDraft().catch(()=>{}),100);
}
async function imageURL(a){if(!state.urls.has(a.id)){const r=await fetch('/api/original?id='+encodeURIComponent(a.id),{headers:{Authorization:`Bearer ${state.token}`}});if(!r.ok)throw Error(`Original unavailable: ${a.id}`);state.urls.set(a.id,URL.createObjectURL(await r.blob()));}return state.urls.get(a.id);}
const artifacts=()=>state.data.artifact.filter(a=>a.iterationId===state.iteration?.id);
const jobOf=a=>state.data.job.find(j=>j.id===a.jobId);
async function renderCards(target,images,{library=false}={}){
  target.replaceChildren();
  const jobs=library?images.map(a=>jobOf(a)):state.data.job.filter(j=>j.iterationId===state.iteration?.id);
  for(const [n,j] of jobs.entries()){
    const a=images.find(a=>a.jobId===j.id),card=el('article',undefined,'card');card.dataset.jobId=j.id;
    if(a){
      const button=el('button',undefined,'art-button');button.setAttribute('aria-label',`Focus ${j.specification.label||j.specification.directionId}`);
      const img=el('img');img.alt=j.specification.label||j.specification.directionId;
      try{img.src=await imageURL(a);}catch(e){img.alt=e.message;card.append(el('p',e.message,'notice'));}
      button.append(img);button.onclick=async()=>{if(library&&a.iterationId!==state.iteration?.id){await saveDraft();route(state.project,state.data.iteration.find(i=>i.id===a.iterationId));await refresh(true);}await focus(a.id);};card.append(button);
      const caption=el('div',undefined,'card-caption'),name=el('p');name.append(el('small',String(n+1).padStart(2,'0')+' / '),document.createTextNode(j.specification.label||j.specification.directionId));caption.append(name);
      if(!library){const f=sourceFeedback(a),star=el('button',f.favorite?'★':'☆','star');star.setAttribute('aria-label',`Favorite ${j.specification.label||j.specification.directionId}`);star.setAttribute('aria-pressed',String(f.favorite));star.onclick=()=>{f.favorite=!f.favorite;star.textContent=f.favorite?'★':'☆';star.setAttribute('aria-pressed',String(f.favorite));changed();};caption.append(star);}
      else caption.append(el('small',`Iteration ${state.data.iteration.filter(i=>i.projectId===state.project.id).findIndex(i=>i.id===a.iterationId)+1}`));
      card.append(caption);
    }else{
      const box=el('div',undefined,'unresolved');box.append(el('strong',j.specification.label||j.specification.directionId),el('span',j.state==='queued'?'Waiting for compatible image executor':j.state),el('small',j.reason||'Available images can be reviewed while this direction waits.'));card.append(box);
    }
    target.append(card);
  }
}
function renderFeedback(){ $('overall').value=state.feedback.overall;if(state.focusId&&$('focus').open)renderFocusNotes(); }
function renderHistory(){
  $('submissions').replaceChildren();
  for(const s of state.data.submission.filter(s=>s.projectId===state.project?.id).reverse()){
    const c=state.data.continuation.find(c=>c.id===s.id),box=el('details',undefined,'submission'),summary=el('summary',`${new Date(s.submittedAt).toLocaleString()} · ${s.intent==='iterate'?'Next iteration requested':'Feedback submitted'} · ${c?.status??'Preparing continuation'}`);
    box.append(summary,el('p',s.feedback.overall||'Image-level feedback submitted.'));
    for(const f of s.feedback.images.filter(f=>f.note||f.regions.length||f.favorite)){const a=state.data.artifact.find(a=>a.id===f.artifactId),j=a&&jobOf(a);box.append(el('p',`${j?.specification.label||f.artifactId}${f.favorite?' · Favorite':''}\n${f.note}`));for(const r of f.regions)box.append(el('p',`Region (${r.x.toFixed(3)}, ${r.y.toFixed(3)}, ${r.w.toFixed(3)}, ${r.h.toFixed(3)}): ${r.text}`));}
    const download=el('button','Download portable review & originals');download.onclick=async()=>{try{const packet=await api('/api/portable?id='+s.id),url=URL.createObjectURL(new Blob([JSON.stringify(packet,null,2)],{type:'application/json'})),a=el('a');a.href=url;a.download=`bve-review-${s.id}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),3000);}catch(e){toast(e.message);}};box.append(download,el('pre',JSON.stringify({submission:s,continuation:c},null,2)));$('submissions').append(box);
  }
}
function inspect(){const p=state.project;return {capabilities:state.capabilities,project:p,iteration:state.iteration,jobs:state.data.job.filter(j=>j.projectId===p?.id),requests:state.data.request.filter(r=>r.projectId===p?.id),events:state.data.event.filter(e=>e.projectId===p?.id),continuations:state.data.continuation.filter(c=>c.projectId===p?.id),acceptances:state.data.acceptance.filter(a=>a.projectId===p?.id)};}
async function refresh(force=false){
  if(polling)return;polling=true;
  try{
    await readAll();const q=new URLSearchParams(location.hash.slice(1)),projects=state.data.project;
    const p=projects.find(p=>p.id===q.get('project'))||projects.at(-1);
    if(!p){$('empty').hidden=false;$('workspace').hidden=true;$('projects').hidden=true;return;}
    $('projects').hidden=false;const previous=state.iteration;
    const iterations=state.data.iteration.filter(i=>i.projectId===p.id);
    let i=iterations.find(i=>i.id===q.get('iteration'))||iterations.at(-1)||null;
    // After Submit and iterate, open a new completed/partial board as soon as it exists.
    const waiting=localStorage.getItem(`bve:waiting:${p.id}`),next=state.data.request.find(r=>r.id===waiting);
    if(next?.iterationId&&next.iterationId!==i?.id){i=iterations.find(i=>i.id===next.iterationId);route(p,i);localStorage.removeItem(`bve:waiting:${p.id}`);}
    state.project=p;state.iteration=i;
    $('runtime').textContent=p.fixture?'Authored fixtures · simulation':'Private · local workspace';
    const signature=JSON.stringify({p,iterations,jobs:state.data.job.filter(j=>j.projectId===p.id),submissions:state.data.submission.filter(s=>s.projectId===p.id),requests:state.data.request.filter(r=>r.projectId===p.id),acceptance:state.data.acceptance});
    if(!force&&signature===state.lastSignature){if(!$('inspector').hidden)$('inspection').textContent=JSON.stringify(inspect(),null,2);return;}
    state.lastSignature=signature;
    $('empty').hidden=true;$('workspace').hidden=false;
    if(!q.get('project')||!q.get('iteration')&&i)route(p,i);
    $('projects').replaceChildren(...projects.map(pj=>{const o=el('option',pj.name);o.value=pj.id;return o;}));$('projects').value=p.id;
    $('iterations').replaceChildren(...iterations.map((it,n)=>{const o=el('option',`Iteration ${String(n+1).padStart(2,'0')}${it.parentReviewId?' · Follow-up':''}`);o.value=it.id;return o;}));$('iterations').value=i?.id||'';
    $('project-title').textContent=p.name;$('project-context').textContent='Visual exploration / '+(p.fixture?'Authored fixture workspace':'Private local workspace');
    const jobs=state.data.job.filter(j=>j.iterationId===i?.id),good=jobs.filter(j=>j.state==='succeeded').length;
    $('board-status').textContent=i?`${good} of ${i.count} images available · ${jobs.every(j=>['succeeded','failed'].includes(j.state))?'Ready for your review':'Partial board · work remains unresolved'}`:'Your exploration request is saved.';
    $('iteration-context').replaceChildren(el('span',i?.direction||p.defaults.direction),el('span',`Brand context: ${(i?i.brand:p.defaults.brand)||'None'}`));
    if(i?.parentReviewId)$('iteration-context').append(el('span','Based on submitted review · exact originals linked'));
    const pending=state.data.request.filter(r=>r.projectId===p.id&&r.state==='waiting-for-conductor');
    $('request-gap').hidden=!pending.length;
    if(pending.length)$('request-gap').textContent='Next creative step saved. '+pending.at(-1).gap+'. Review and saved feedback remain available.';
    if(previous?.id!==i?.id||force)await restoreDraft();
    renderFeedback();renderHistory();$('review').hidden=!i;await renderCards($('cards'),artifacts());
    if(!$('library').hidden)await renderCards($('library-cards'),state.data.artifact.filter(a=>a.projectId===p.id),{library:true});
    $('inspection').textContent=JSON.stringify(inspect(),null,2);
  }catch(e){toast(e.message);}finally{polling=false;}
}
async function focus(artifactId){
  const a=state.data.artifact.find(a=>a.id===artifactId);if(!a)return;
  state.focusId=a.id;state.region=null;state.drawing=false;$('region-mode').classList.remove('active');$('region-editor').hidden=true;$('region-preview').hidden=true;
  $('focus-title').textContent=jobOf(a).specification.label||jobOf(a).specification.directionId;$('focus-image').src=await imageURL(a);$('zoom').value=100;$('image-stage').style.width='100%';
  $('focus-meta').textContent=`Original · ${a.width} × ${a.height} · PNG`;renderFocusNotes();if(!$('focus').open)$('focus').showModal();
}
function renderFocusNotes(){
  const a=state.data.artifact.find(a=>a.id===state.focusId),f=sourceFeedback(a);$('image-note').value=f.note;$('favorite').textContent=f.favorite?'★ Favorited':'☆ Favorite';$('favorite').setAttribute('aria-pressed',String(f.favorite));
  $('regions').replaceChildren();$('region-list').replaceChildren();
  f.regions.forEach((r,n)=>{const box=el('div',undefined,'region-box');Object.assign(box.style,{left:r.x*100+'%',top:r.y*100+'%',width:r.w*100+'%',height:r.h*100+'%'});box.append(el('span',String(n+1)));$('regions').append(box);const note=el('div',`${n+1}. ${r.text}`,'region-comment'),remove=el('button','Remove region');remove.onclick=()=>{f.regions.splice(n,1);changed();renderFocusNotes();};note.append(remove);$('region-list').append(note);});
  $('accepted').textContent=state.data.acceptance.some(x=>x.artifactId===a.id)?'Explicitly accepted by human action.':'No design acceptance recorded.';
}
async function submit(intent){
  const button=intent==='iterate'?$('submit-iterate'):$('submit-review');button.disabled=true;
  try{
    // Make any image-level defaults part of this same durable draft.
    if(!state.version&&!state.dirty){state.dirty=true;}
    await saveDraft();
    const pendingKey=`bve:submission:${state.iteration.id}:${intent}`;
    let pending=JSON.parse(localStorage.getItem(pendingKey)||'null');
    if(!pending){pending={key:uid(),input:{iterationId:state.iteration.id,draftVersion:state.version,intent}};localStorage.setItem(pendingKey,JSON.stringify(pending));}
    const s=await op('review.submit',pending.input,pending.key);localStorage.removeItem(pendingKey);
    if(s.requestId)localStorage.setItem(`bve:waiting:${state.project.id}`,s.requestId);
    toast(intent==='iterate'?'Review submitted. Next iteration requested.':'Review submitted.');await refresh();
  }catch(e){toast(e.message);}finally{button.disabled=false;}
}
$('overall').oninput=()=>{state.feedback.overall=$('overall').value;changed();};
$('image-note').oninput=()=>{sourceFeedback(state.data.artifact.find(a=>a.id===state.focusId)).note=$('image-note').value;changed();};
$('save-draft').onclick=()=>saveDraft().catch(()=>{});$('submit-review').onclick=()=>submit('feedback');$('submit-iterate').onclick=()=>submit('iterate');
$('favorite').onclick=()=>{const f=sourceFeedback(state.data.artifact.find(a=>a.id===state.focusId));f.favorite=!f.favorite;changed();renderFocusNotes();renderCards($('cards'),artifacts());};
$('focus-close').onclick=()=>{$('focus').close();saveDraft().catch(()=>{});renderCards($('cards'),artifacts());};
$('focus').addEventListener('cancel',()=>{saveDraft().catch(()=>{});renderCards($('cards'),artifacts());});
for(const [button,step] of [['previous',-1],['next',1]])$(button).onclick=()=>{const all=artifacts(),n=all.findIndex(a=>a.id===state.focusId);focus(all[(n+step+all.length)%all.length].id);};
$('zoom').oninput=()=>{$('image-stage').style.width=$('zoom').value+'%';};
$('region-mode').onclick=()=>{state.drawing=!state.drawing;$('region-mode').classList.toggle('active',state.drawing);};
let start;
function point(e){const r=$('image-stage').getBoundingClientRect();return {x:Math.min(1,Math.max(0,(e.clientX-r.left)/r.width)),y:Math.min(1,Math.max(0,(e.clientY-r.top)/r.height))};}
$('image-stage').onpointerdown=e=>{if(!state.drawing)return;e.preventDefault();start=point(e);$('image-stage').setPointerCapture(e.pointerId);};
$('image-stage').onpointermove=e=>{if(!start)return;const p=point(e);state.region={space:'normalized-original',x:Math.min(start.x,p.x),y:Math.min(start.y,p.y),w:Math.abs(p.x-start.x),h:Math.abs(p.y-start.y)};const r=state.region;Object.assign($('region-preview').style,{left:r.x*100+'%',top:r.y*100+'%',width:r.w*100+'%',height:r.h*100+'%'});$('region-preview').hidden=false;};
$('image-stage').onpointerup=()=>{if(!start)return;start=null;if(state.region?.w>.005&&state.region?.h>.005){$('region-editor').hidden=false;$('region-text').value='';$('region-text').focus();}state.drawing=false;$('region-mode').classList.remove('active');};
$('image-stage').onpointercancel=()=>{start=null;state.region=null;$('region-preview').hidden=true;};
$('add-region').onclick=()=>{if(!state.region||!$('region-text').value.trim())return;const f=sourceFeedback(state.data.artifact.find(a=>a.id===state.focusId));f.regions.push({...state.region,text:$('region-text').value});state.region=null;$('region-editor').hidden=true;$('region-preview').hidden=true;changed();renderFocusNotes();};
$('accept-design').onclick=async()=>{try{await op('design.accept',{artifactId:state.focusId,judgment:'accept'});await readAll();renderFocusNotes();toast('Explicit design acceptance recorded.');}catch(e){toast(e.message);}};
$('projects').onchange=async()=>{await saveDraft();route(state.data.project.find(p=>p.id===$('projects').value),null);await refresh(true);};
$('iterations').onchange=async()=>{await saveDraft();route(state.project,state.data.iteration.find(i=>i.id===$('iterations').value));await refresh(true);};
$('new-project').onclick=async()=>{await saveDraft();$('workspace').hidden=true;$('empty').hidden=false;$('library').hidden=true;};
$('project-form').onsubmit=async e=>{e.preventDefault();const b=e.submitter;b.disabled=true;try{
  const input={name:$('project-name').value,brief:$('project-brief').value,count:Number($('project-count').value),direction:$('project-direction').value,brand:$('project-brand').value||null};
  // Persist keys through lost responses; changed form content gets its own bounded request.
  const signature=JSON.stringify(input);let pending=JSON.parse(localStorage.getItem('bve:new-project')||'null');if(!pending||pending.signature!==signature){pending={signature,projectKey:uid(),requestKey:uid()};localStorage.setItem('bve:new-project',JSON.stringify(pending));}
  const p=await op('project.create',input,pending.projectKey);await op('request.create',{projectId:p.id,intent:input.brief},pending.requestKey);localStorage.removeItem('bve:new-project');route(p,null);await refresh(true);
}catch(e){toast(e.message);}finally{b.disabled=false;}};
$('inspector-toggle').onclick=()=>{$('inspector').hidden=!$('inspector').hidden;$('inspection').textContent=JSON.stringify(inspect(),null,2);};$('inspector-close').onclick=()=>$('inspector').hidden=true;
$('library-toggle').onclick=async()=>{await saveDraft();$('workspace').hidden=true;$('library').hidden=false;await renderCards($('library-cards'),state.data.artifact.filter(a=>a.projectId===state.project.id),{library:true});};$('library-close').onclick=()=>{$('library').hidden=true;$('workspace').hidden=false;};
window.addEventListener('hashchange',()=>refresh());window.addEventListener('beforeunload',e=>{if(state.dirty){e.preventDefault();e.returnValue='';}});
const bootstrap=await (await fetch('/api/bootstrap')).json();state.token=bootstrap.token;state.capabilities=bootstrap.capabilities;state.simulation=bootstrap.simulation;$('runtime').textContent=bootstrap.simulation?'Authored fixtures · simulation':'Private · local workspace';
if(!location.hash&&localStorage.getItem('bve:last'))location.hash=localStorage.getItem('bve:last');await refresh(true);setInterval(()=>refresh(),1500);
