import {imagePoint,imageRegion} from './photo-geometry.js';
const make=(tag,text='',className='')=>{const n=document.createElement(tag);n.textContent=text;if(className)n.className=className;return n;};
const ref=a=>({productId:a.projectId,artifactId:a.id,version:a.version,sha256:a.sha256,width:a.width,height:a.height});
const copy=x=>structuredClone(x),same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export function createPhotoBriefEditor({api}){
 const dialog=make('dialog','','photo-brief-dialog'),heading=make('h2'),status=make('p'),message=make('p'),recovery=make('div');
 status.setAttribute('role','status');message.setAttribute('role','alert');
 const previous=make('button','Previous photo'),next=make('button','Next photo'),close=make('button','Close'),nav=make('div','','actions');
 const zoom=make('input');zoom.type='range';zoom.min=25;zoom.max=300;zoom.value=100;zoom.setAttribute('aria-label','Photo zoom');
 const zoomLabel=make('label','Zoom');zoomLabel.append(zoom);
 const draw=make('button','Draw a repair region'),viewport=make('div','','photo-brief-viewport'),stage=make('div','','photo-brief-stage'),img=make('img'),overlays=make('div','','photo-brief-overlays');
 img.draggable=false;img.style.imageOrientation='none';stage.append(img,overlays);viewport.append(stage);
 const wholeLabel=make('label','Instructions for this photo'),whole=make('textarea');whole.maxLength=20000;whole.dir='auto';wholeLabel.append(whole);
 const regionLabel=make('label','Instruction for the selected region'),regionText=make('textarea');regionText.maxLength=2000;regionText.dir='auto';regionLabel.append(regionText);
 const add=make('button','Keep region'),cancelRegion=make('button','Cancel region'),regionForm=make('div','','photo-brief-region-form');regionForm.hidden=true;regionForm.append(regionLabel,add,cancelRegion);
 const regions=make('div'),save=make('button','Save draft'),submit=make('button','Submit edit instructions'),retry=make('button','Reconcile pending action'),actions=make('div','','actions');
 retry.hidden=true;actions.append(save,submit,retry);
 nav.append(previous,next,zoomLabel,draw,close);
 dialog.append(heading,nav,status,message,recovery,viewport,wholeLabel,regionForm,regions,actions,
  make('p','These instructions describe a later edit. Submission does not start generation, change image bytes, or approve an output.','fine'));
 document.body.append(dialog);
 let photos=[],index=0,current=null,epoch=0,url=null,start=null,box=null,drawing=false,editing=null,timer,imageRequest;
 const entries=new Map();
 const storageKey=(e,kind)=>'bve:photo-brief:'+e.artifact.productId+':'+e.artifact.artifactId+':'+e.artifact.sha256+':'+kind;
 const stored=(e,kind)=>{try{return JSON.parse(localStorage.getItem(storageKey(e,kind)))}catch{throw Error('A browser recovery record is unreadable; preserve it before continuing.');}};
 const put=(e,kind,x)=>localStorage.setItem(storageKey(e,kind),JSON.stringify(x));
 const remove=(e,kind)=>localStorage.removeItem(storageKey(e,kind));
 const request=(action,key,input)=>api('/api/photo-brief',{method:'POST',body:{action,key,input}});
 const read=e=>request('read','read-only',{artifact:e.artifact});
 const payload=e=>({note:e.note,regions:e.regions});
 const hasInstructions=e=>Boolean(e.note.trim()||e.regions.length);
 function buffered(e){put(e,'buffer',{...copy(payload(e)),baseVersion:e.version});}
 function renderStatus(){
  const e=current;if(!e)return;
  retry.hidden=!stored(e,'save')&&!stored(e,'submit');save.disabled=e.busy||e.conflict;submit.disabled=e.busy||e.conflict||!hasInstructions(e)||Boolean(stored(e,'submit'));
  status.textContent=e.conflict?'Recovery needs your choice':e.dirty?'Draft changes pending':e.latest?.draftVersion===e.version?'Instructions submitted; editing has not started':e.version?'Draft saved':'No saved instructions yet';
 }
 function changed(){
  const e=current;if(!e)return;e.note=whole.value;e.dirty=true;buffered(e);renderStatus();clearTimeout(timer);
  if(!e.conflict&&!stored(e,'submit'))timer=setTimeout(()=>flush(e).catch(showError),500);
 }
 function showError(error){message.textContent=error.message;renderStatus();}
 function applyDraft(e,d){e.version=d?.version??0;e.note=d?.note??'';e.regions=copy(d?.regions??[]);e.dirty=false;}
 function conflictChoice(e,view){
  e.conflict=true;recovery.replaceChildren(make('p','This browser has words that differ from the saved draft. Both copies are preserved.'));
  const use=make('button','Use recovered draft'),keep=make('button','Use saved draft');
  use.onclick=()=>{e.version=view.draft?.version??0;e.conflict=false;remove(e,'save');recovery.replaceChildren();changed();render();};
  keep.onclick=()=>{applyDraft(e,view.draft);e.conflict=false;remove(e,'save');remove(e,'buffer');recovery.replaceChildren();render();};
  recovery.append(use,keep);
 }
 async function flush(e){
  if(e.saving)return e.saving;
  e.saving=(async()=>{
   if(e.conflict)throw Error('Choose a recovered or saved draft first.');
   if(e.regions.some(r=>!r.meaning.trim()))throw Error('Enter an instruction for every region, or remove the empty region.');
   if(stored(e,'submit'))throw Error('Reconcile the pending submission before changing its draft.');
   e.busy=true;if(e===current)renderStatus();
   let pending=stored(e,'save');
   if(pending){
    const saved=await request(pending.action,pending.key,pending.input);e.version=saved.version;remove(e,'save');
    const view=await read(e);
    if(view.draft?.version!==saved.version){if(e===current)conflictChoice(e,view);else e.conflict=true;throw Error('A newer draft exists; your browser copy is preserved.');}
    if(same(payload(e),{note:saved.note,regions:saved.regions})){e.dirty=false;remove(e,'buffer');}
   }
   if(!e.dirty)return;
   const snapshot=copy(payload(e));
   pending={action:'save',key:crypto.randomUUID(),input:{artifact:e.artifact,expectedVersion:e.version,...snapshot}};put(e,'save',pending);
   const saved=await request(pending.action,pending.key,pending.input);e.version=saved.version;remove(e,'save');
   if(same(payload(e),snapshot)){e.dirty=false;remove(e,'buffer');}else{buffered(e);setTimeout(()=>flush(e).catch(showError),0);}
  })().catch(async error=>{
   if(error.code==='REVISION_CONFLICT'){const view=await read(e);if(e===current)conflictChoice(e,view);else e.conflict=true;}
   throw error;
  }).finally(()=>{e.busy=false;e.saving=null;if(e===current)renderStatus();});
  return e.saving;
 }
 async function submitEntry(e){
  if(e.busy||e.conflict)return;
  clearTimeout(timer);
  const pending=stored(e,'submit');
  if(!pending){
   if(!hasInstructions(e))return;
   await flush(e);if(e.dirty)throw Error('Save the latest draft before submission.');
  }
  e.busy=true;if(e===current)renderStatus();
  try{
   const packet=pending??{action:'submit',key:crypto.randomUUID(),input:{artifact:e.artifact,draftVersion:e.version}};
   put(e,'submit',packet);
   e.latest=await request(packet.action,packet.key,packet.input);remove(e,'submit');
   if(e===current)message.textContent='Edit instructions recorded. Image editing has not started.';
  }catch(error){
   if(error.code==='PHOTO_BRIEF_EMPTY'){
    remove(e,'submit');
    throw Error('Add an instruction before submitting.');
   }
   if(error.code!=='PHOTO_BRIEF_DRAFT_CHANGED')throw error;
   const view=await read(e);
   remove(e,'submit');e.latest=view.requests.at(-1)??null;
   if(e.dirty){
    if(e===current)conflictChoice(e,view);else e.conflict=true;
   }else{
    applyDraft(e,view.draft);
    if(e===current)render();
   }
   throw Error('The saved draft changed. Review it before submitting again.');
  }finally{e.busy=false;if(e===current)renderStatus();}
 }
 function renderOverlays(){
  overlays.replaceChildren();
  const all=[...current.regions,...(box?[box]:[])];
  all.forEach((r,i)=>{const n=make('div',i<current.regions.length?String(i+1):'New','photo-brief-box');
   Object.assign(n.style,{left:r.x*100+'%',top:r.y*100+'%',width:r.w*100+'%',height:r.h*100+'%'});overlays.append(n);});
 }
 function render(){
  if(!current)return;whole.value=current.note;regions.replaceChildren();
  current.regions.forEach((r,n)=>{
   const card=make('div','','region-comment'),label=make('label','Region '+(n+1)),text=make('textarea');
   text.maxLength=2000;text.value=r.meaning;text.dir='auto';text.setAttribute('aria-label','Region '+(n+1)+' instructions');
   text.oninput=()=>{r.meaning=text.value;changed();};label.append(text);
   const redraw=make('button','Redraw region'),removeRegion=make('button','Remove region');
   redraw.onclick=()=>{editing=n;drawing=true;draw.textContent='Draw replacement region';};
   removeRegion.onclick=()=>{current.regions.splice(n,1);changed();render();};
   card.append(label,redraw,removeRegion);regions.append(card);
  });renderOverlays();renderStatus();
 }
 function resetRegion(){start=null;box=null;drawing=false;editing=null;regionForm.hidden=true;regionText.value='';draw.textContent='Draw a repair region';if(current)renderOverlays();}
 async function openAt(n){
  const ticket=++epoch;clearTimeout(timer);imageRequest?.abort();
  if(current?.dirty&&!current.conflict&&!stored(current,'submit'))flush(current).catch(showError);
  resetRegion();recovery.replaceChildren();message.textContent='';save.disabled=true;submit.disabled=true;previous.disabled=true;next.disabled=true;
  const photo=photos[n],artifact=ref(photo);let e=entries.get(photo.id);
  if(e?.saving)await e.saving.catch(()=>{});
  const view=await read({artifact});if(ticket!==epoch)return;
  if(!e){e={artifact,version:0,note:'',regions:[],dirty:false,busy:false,conflict:false,saving:null};entries.set(photo.id,e);}
  applyDraft(e,view.draft);e.conflict=false;e.latest=view.requests.at(-1)??null;const buffer=stored(e,'buffer');
  if(buffer){e.note=buffer.note;e.regions=buffer.regions;e.dirty=true;e.conflict=buffer.baseVersion!==e.version;}
  current=e;index=n;heading.textContent=(photo.briefLabel??'Imported photo')+' ('+(n+1)+' / '+photos.length+')';
  whole.value=e.note;img.alt=photo.briefLabel??'Imported photo';zoom.value=100;stage.style.width='100%';
  if(url){URL.revokeObjectURL(url);url=null;}img.removeAttribute('src');
  if(!dialog.open)dialog.showModal();
  render();if(e.conflict)conflictChoice(e,view);
  previous.disabled=photos.length<2;next.disabled=photos.length<2;
  try{
   const request=new AbortController();imageRequest=request;
   const q=new URLSearchParams({view:'full',productId:artifact.productId,id:artifact.artifactId,version:artifact.version,sha256:artifact.sha256,width:artifact.width,height:artifact.height});
   const setImage=async blob=>{
    if(ticket!==epoch)return;
    if(url)URL.revokeObjectURL(url);
    url=URL.createObjectURL(blob);img.src=url;await img.decode();
    if(ticket===epoch&&(img.naturalWidth!==artifact.width||img.naturalHeight!==artifact.height))throw Error('Photo dimensions differ from the original');
   };
   const original=await api('/api/original?'+q,{image:true,signal:request.signal});
   try{await setImage(original);}catch(error){
    if(ticket!==epoch)return;
    q.set('view','working8');await setImage(await api('/api/original?'+q,{image:true,signal:request.signal}));
   }


  }catch(error){if(ticket===epoch){img.removeAttribute('src');showError(error);}}
  if(stored(e,'save')&&!e.conflict)flush(e).catch(showError);
 }
 whole.oninput=changed;zoom.oninput=()=>{stage.style.width=zoom.value+'%';};
 draw.onclick=()=>{resetRegion();drawing=true;draw.textContent='Draw on the photo';};
 const point=event=>imagePoint(event.clientX,event.clientY,img.getBoundingClientRect());
 stage.onpointerdown=event=>{if(!drawing||!img.complete||!img.naturalWidth)return;event.preventDefault();start=point(event);stage.setPointerCapture(event.pointerId);};
 stage.onpointermove=event=>{if(!start)return;box=imageRegion(start,point(event));renderOverlays();};
 stage.onpointerup=event=>{
  if(!start)return;box=imageRegion(start,point(event));start=null;drawing=false;
  if(box.w<=.001||box.h<=.001){resetRegion();return;}
  regionForm.hidden=false;regionText.value=editing===null?'':current.regions[editing].meaning;regionText.focus();renderOverlays();
 };
 stage.onpointercancel=resetRegion;
 add.onclick=()=>{
  if(!box||!regionText.value.trim())return;
  if(editing===null&&current.regions.length>=24){showError(Error('Up to 24 regions per photo.'));return;}
  const r={...box,meaning:regionText.value};
  if(editing===null)current.regions.push(r);else current.regions[editing]=r;
  resetRegion();changed();render();
 };
 cancelRegion.onclick=resetRegion;
 save.onclick=()=>flush(current).catch(showError);
 submit.onclick=()=>submitEntry(current).catch(showError);
 retry.onclick=()=>{const e=current;(stored(e,'submit')?submitEntry(e):flush(e)).catch(showError);};
 previous.onclick=()=>openAt((index-1+photos.length)%photos.length).catch(showError);
 next.onclick=()=>openAt((index+1)%photos.length).catch(showError);
 function leave(){clearTimeout(timer);++epoch;imageRequest?.abort();if(url){URL.revokeObjectURL(url);url=null;}img.removeAttribute('src');resetRegion();if(current?.dirty&&!current.conflict&&!stored(current,'submit'))flush(current).catch(showError);}
 close.onclick=()=>{leave();dialog.close();};dialog.addEventListener('cancel',leave);
 window.addEventListener('beforeunload',event=>{if([...entries.values()].some(e=>e.dirty||e.busy)){event.preventDefault();event.returnValue='';}});
 return {open:async(items,artifactId)=>{photos=items.slice();const n=photos.findIndex(a=>a.id===artifactId);if(n<0)throw Error('Photo unavailable');await openAt(n);}};
}
