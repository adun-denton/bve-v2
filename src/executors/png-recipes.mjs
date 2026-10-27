import {isDeepStrictEqual} from 'node:util';
import {createHash} from 'node:crypto';
import {validate} from '../contracts/3djat.mjs';
export const PNG_SERVICE='pillow-png-v1';
export const RECIPE_SCHEMA='bve.png-recipe.v1';
export const stable=x=>JSON.stringify(x,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
export const recipeHash=x=>createHash('sha256').update(stable(x)+'\n').digest('hex');
const check=(v,code='INVALID_RECIPE')=>{if(!v)throw Object.assign(Error(code),{code});};
const integer=(v,min,max)=>{check(Number.isSafeInteger(v)&&v>=min&&v<=max);return v;};
export function recipesForRun(run){
 check(run?.executionKind==='deterministic'&&run.executorId===PNG_SERVICE,'CAPABILITY_UNAVAILABLE');
 check(Array.isArray(run.sources)&&run.sources.length>=1&&run.sources.length<=2&&run.attachments.length===0);
 const scene=run.sources.filter(x=>x.role==='scene'),logos=run.sources.filter(x=>x.role==='logo');
 check(scene.length===1&&logos.length<=1&&run.sources.length===scene.length+logos.length);
 for(const x of run.sources)check(validate('artifact-ref',x.artifact).ok&&x.regions.length===0);
 const source=scene[0].artifact,logo=logos[0]?.artifact??null,s=run.selection;
 check(s&&s.recipeversion===1&&Object.keys(s).length<=24&&source.width*source.height<=16_000_000);
 const roles=run.requestedOutputs.flatMap(x=>Array(x.count).fill(x.role));check(roles.length>=1&&roles.length<=6);
 const allowed=new Set(['recipeversion','cropx','cropy','cropwidth','cropheight']);
 if(logo)for(const k of ['logowidth','logoopacity','logomarginx','logomarginy','logoanchor'])allowed.add(k);
 const recipes=roles.map((role,i)=>{
  const get=(name,fallback)=>{const key='out'+i+name;allowed.add(key);return s[key]??fallback;};
  const width=integer(get('width'),1,16000000),height=integer(get('height'),1,16000000);check(width*height<=16_000_000);
  const crop={x:integer(get('cropx',s.cropx),0,source.width-1),y:integer(get('cropy',s.cropy),0,source.height-1),width:integer(get('cropwidth',s.cropwidth),1,source.width),height:integer(get('cropheight',s.cropheight),1,source.height)};
  check(crop.x+crop.width<=source.width&&crop.y+crop.height<=source.height);
  let placement=null;
  if(logo){
   check(logo.width*logo.height<=16_000_000);
   const logoWidth=integer(get('logowidth',s.logowidth),1,width),logoHeight=Math.max(1,Math.round(logo.height*logoWidth/logo.width));
   const anchor=get('logoanchor',s.logoanchor);check(['top-left','top-right','bottom-left','bottom-right'].includes(anchor));
   const marginX=integer(get('logomarginx',s.logomarginx),0,width-1),marginY=integer(get('logomarginy',s.logomarginy),0,height-1);
   const x=integer(get('logox',anchor.endsWith('right')?width-logoWidth-marginX:marginX),0,width-1),y=integer(get('logoy',anchor.startsWith('bottom')?height-logoHeight-marginY:marginY),0,height-1),opacity=get('logoopacity',s.logoopacity);
   check(typeof opacity==='number'&&Number.isFinite(opacity)&&opacity>=0&&opacity<=1&&x+logoWidth<=width&&y+logoHeight<=height);
   placement={x,y,width:logoWidth,height:logoHeight,opacity,spacing:{left:x,top:y,right:width-x-logoWidth,bottom:height-y-logoHeight}};
  }
  return {schemaVersion:RECIPE_SCHEMA,executorId:PNG_SERVICE,scene:structuredClone(source),logo:logo?structuredClone(logo):null,crop,
   output:{role,width,height,fit:'contain',background:[255,255,255,255],format:'image/png',mode:'RGBA',compression:9,optimize:false,resampling:'LANCZOS',metadata:'strip'},placement};
 });
 check(Object.keys(s).every(k=>allowed.has(k)),'UNSAFE_RECIPE_PARAMETER');return recipes;
}
export function checkFrozenRecipe(run,recipe,index){const expected=recipesForRun(run)[index];check(expected&&isDeepStrictEqual(expected,recipe),'RECIPE_MISMATCH');return expected;}
