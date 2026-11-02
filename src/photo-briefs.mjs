import {validate} from './contracts/3djat.mjs';
export const briefCheck=(ok,code='INVALID_VALUE')=>{if(!ok)throw Object.assign(Error(code),{code,status:code==='INVALID_SCOPE'?403:409});};
export function briefInput(action,input){
 const fields=action==='read'?['artifact']:action==='save'?['artifact','expectedVersion','note','regions']:action==='submit'?['artifact','draftVersion']:null;
 briefCheck(fields&&input&&typeof input==='object'&&!Array.isArray(input)&&Object.keys(input).length===fields.length&&fields.every(k=>Object.hasOwn(input,k)));
 briefCheck(validate('artifact-ref',input.artifact).ok);
 if(action==='save'){
  briefCheck(Number.isSafeInteger(input.expectedVersion)&&input.expectedVersion>=0);
  briefCheck(typeof input.note==='string'&&input.note.length<=20000);
  briefCheck(Array.isArray(input.regions)&&input.regions.length<=24);
  briefCheck(validate('source-artifact',{artifact:input.artifact,role:'scene',regions:input.regions}).ok);
  for(const r of input.regions)briefCheck(!Object.hasOwn(r,'reviewRegion')&&r.meaning.trim().length>0&&r.x+r.w<=1.000001&&r.y+r.h<=1.000001);
 }
 if(action==='submit')briefCheck(Number.isSafeInteger(input.draftVersion)&&input.draftVersion>=1);
 return structuredClone(input);
}
