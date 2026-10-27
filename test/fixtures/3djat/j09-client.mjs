import fs from 'node:fs';import vm from 'node:vm';import {webcrypto} from 'node:crypto';
import {operationUIHandler,operationUIFailure} from '../../../src/operation-ui-http.mjs';
export class Element{
 constructor(tag='div'){this.tagName=tag;this.children=[];this.text='';this.value='';this.className='';this.dataset={};this.attributes={};this.hidden=false;this.disabled=false;this.checked=false;}
 set textContent(v){this.text=String(v);this.children=[];}get textContent(){return this.text+this.children.map(x=>x.textContent??'').join('');}
 get childElementCount(){return this.children.length;}get options(){return this.children;}
 append(...xs){for(const x of xs){if(x&&typeof x==='object')x.parent=this;this.children.push(x);}}
 prepend(...xs){for(const x of xs)x.parent=this;this.children.unshift(...xs);}
 replaceChildren(...xs){this.text='';this.children=[];this.append(...xs);}
 setAttribute(k,v){this.attributes[k]=v;}removeAttribute(k){delete this.attributes[k];delete this[k];}focus(){}
 remove(){if(this.parent)this.parent.children.splice(this.parent.children.indexOf(this),1);}
 querySelectorAll(selector){const out=[],choices=selector.split(',');const walk=n=>{for(const c of n.children){if(!(c instanceof Element))continue;if(choices.some(s=>s.startsWith('.')?c.className.split(' ').includes(s.slice(1)):c.tagName===s))out.push(c);walk(c);}};walk(this);return out;}
 querySelector(s){return this.querySelectorAll(s)[0]??null;}
}
export function client(w,{respond}={}){
 const els=new Map(),storage=new Map(),calls=[];const get=id=>{if(!els.has(id))els.set(id,new Element());return els.get(id);};
 const localStorage={getItem:k=>storage.get(k)??null,setItem(k,v){storage.set(k,v);this[k]=v;},removeItem(k){storage.delete(k);delete this[k];}};
 const req=async(url,options={})=>{
  calls.push({path:String(url),method:options.method??'GET'});if(respond){const value=await respond(url,options);if(value)return value;}
  const u=new URL(url,'http://127.0.0.1'),input=options.body?JSON.parse(options.body):undefined;let data;
  try{
   if(u.pathname==='/api/template')data=w.k.templateCommand(w.c.human,input);
   else if(u.pathname==='/api/read')data=w.k.read(w.c.human,u.searchParams.get('kind'));
   else if(u.pathname==='/api/operation-discovery')data=w.k.operationDiscovery(w.c.human,{productId:u.searchParams.get('productId'),applicability:u.searchParams.get('applicability'),branded:u.searchParams.get('branded')==='true',brandTemplateId:u.searchParams.get('brandTemplateId')});
   else if(u.pathname==='/api/import')data=w.k.importReview(w.c.human,u.searchParams.get('id'));
   else if(u.pathname==='/api/original')data=w.k.artifactMedia(w.c.human,{productId:u.searchParams.get('productId'),artifactId:u.searchParams.get('id'),version:Number(u.searchParams.get('version')),sha256:u.searchParams.get('sha256'),width:Number(u.searchParams.get('width')),height:Number(u.searchParams.get('height'))});
   else if(u.pathname==='/api/products')data=w.k.productIndex(w.c.human);
   else if(u.pathname==='/api/product-review')data=w.k.productReview(w.c.human,input);
   else data=operationUIHandler(w.k,w.c.human,{method:options.method??'GET',path:u.pathname,query:Object.fromEntries(u.searchParams),input});
   return {ok:true,json:async()=>data};
  }catch(e){return {ok:false,json:async()=>operationUIFailure(e,u.pathname)};}
 };
 const context=vm.createContext({document:{getElementById:get,createElement:t=>new Element(t),querySelectorAll:()=>[]},window:{addEventListener(){}},localStorage,location:{hash:''},URL,URLSearchParams,Option:class extends Element{constructor(t,v){super('option');this.textContent=t;this.value=v;}},Blob,atob,structuredClone,console,crypto:webcrypto,fetch:req});
 const code=fs.readFileSync(new URL('../../../public/products.js',import.meta.url),'utf8').replace(/start\(\)\.catch\(e=>say\('Products unavailable: '\+e\.message\)\);/,'');
 vm.runInContext(code,context);const run=s=>vm.runInContext(s,context);
 context.token=w.c.human;context.productId=w.k.read(w.c.human,'project')[0].id;context.review=w.k.productReview(w.c.human,{productId:context.productId,atHead:w.store.read().reference});
 run('state.token=token;state.productId=productId;state.review=review;');get('applicability').value='artistic';
 return {context,run,get,storage,calls,element:tag=>new Element(tag)};
}
