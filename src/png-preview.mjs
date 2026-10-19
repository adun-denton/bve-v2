// Closed derived read model. No files, SQLite, transport, decoder process or AI.
import {createHash} from 'node:crypto';
import {verifiedPNGData,crc32,hash} from './png.mjs';
import {validate} from './contracts/3djat.mjs';
export const PREVIEW_PROFILE=Object.freeze({method:'bve-png-nearest-stored.v1',maxEdge:384,sampling:'nearest-center-integer',orientation:'stored-raster',color:'unmanaged-samples',alpha:'straight',encoder:'rgba8-filter0-zlib-stored.v1'});
export const PREVIEW_LIMITS=Object.freeze({pixels:16_000_000,encoded:24*1024**2,chunks:4096,metadata:16*1024,png:600000,response:1024**2,cacheEntries:16,cacheBytes:8*1024**2});
const META_WARN=['COLOR_DECLARATIONS_UNINTERPRETED','ANCILLARY_FIELD_INVALID','COLOR_UNMANAGED','EXIF_UNINTERPRETED','TEXT_OMITTED'];
const CODES=['ORIGINAL_MISSING','ORIGINAL_CORRUPT','PREVIEW_UNSUPPORTED','PREVIEW_LIMIT','PIXEL_POLICY','PREVIEW_FAILED'];
const PRIVATE=['iCCP','eXIf','tEXt','zTXt','iTXt'];
const NUMERIC=['gAMA','sRGB','cHRM','pHYs'];
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const check=(ok,code='PREVIEW_FAILED')=>{if(!ok)throw Object.assign(Error(code),{code});};
const integer=(v,min,max)=>Number.isInteger(v)&&v>=min&&v<=max;
const digest=v=>typeof v==='string'&&/^[0-9a-f]{64}$/.test(v);
export const canonical=v=>JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x)+'\n';
export const mediaKey=binding=>hash(Buffer.from(canonical({schemaVersion:'bve.preview-key.v1',sourceBinding:binding,profile:PREVIEW_PROFILE})));
export function checkMediaQuery(q){check(validate('artifact-ref',q).ok,'INVALID_VALUE');return q;}
function bindingOK(b){
 if(!exact(b,['artifact','origin'])||!validate('artifact-ref',b.artifact).ok)return false;
 const o=b.origin;
 return o?.kind==='import'?exact(o,['kind','importId','importRecord'])&&validate('revision-ref',o.importRecord).ok&&validate('artifact-ref',{...b.artifact,artifactId:o.importId}).ok:
  o?.kind==='produced'&&exact(o,['kind','jobId','iterationId','deliveryId'])&&['jobId','iterationId','deliveryId'].every(k=>o[k]===null||validate('artifact-ref',{...b.artifact,artifactId:o[k]}).ok);
}
export function unavailableMedia(sourceBinding,errorCode){check(bindingOK(sourceBinding)&&CODES.includes(errorCode));return {schemaVersion:'bve.png-media.v1',sourceBinding:structuredClone(sourceBinding),profile:{...PREVIEW_PROFILE},state:'unavailable',errorCode,metadata:null,metadataSHA256:null,preview:null,warnings:[]};}
function declarations(chunks){
 const first=type=>chunks.find(c=>c.type===type)?.index??Infinity,edge=Math.min(first('PLTE'),first('IDAT'));
 const fields={};let invalid=false;
 for(const type of NUMERIC){const rows=chunks.filter(c=>c.type===type);let value=null,state='absent';
  if(rows.length){const d=rows[0].data,order=rows[0].index<(type==='pHYs'?first('IDAT'):edge);let valid=rows.length===1&&order;
   if(type==='gAMA'){valid&&=d.length===4&&d.readUInt32BE(0)>0;if(valid)value=d.readUInt32BE(0);}
   if(type==='sRGB'){valid&&=d.length===1&&d[0]<=3;if(valid)value=d[0];}
   if(type==='cHRM'){valid&&=d.length===32;if(valid)value=Array.from({length:8},(_,i)=>d.readUInt32BE(i*4));}
   if(type==='pHYs'){valid&&=d.length===9&&d.readUInt32BE(0)>0&&d.readUInt32BE(4)>0&&d[8]<=1;if(valid)value={x:d.readUInt32BE(0),y:d.readUInt32BE(4),unit:d[8]};}
   state=valid?'valid':'invalid';invalid||=!valid;
  }fields[type]={state,chunk:type,value};
 }return {fields,invalid,first};
}
function transparency(chunks,color,first){
 const rows=chunks.filter(c=>c.type==='tRNS');if(!rows.length)return null;
 check(rows.length===1&&[0,2].includes(color),'PREVIEW_UNSUPPORTED');const row=rows[0],plte=first('PLTE');
 check(row.data.length===(color===0?2:6)&&row.index<first('IDAT')&&(plte===Infinity||row.index>plte),'PREVIEW_UNSUPPORTED');
 return Array.from({length:row.data.length/2},(_,i)=>row.data.readUInt16BE(i*2)&255);
}
function metadata(data,trns,dec){
 const {header:h,chunks,result}=data,privateAncillary=PRIVATE.map(type=>{
  const rows=chunks.filter(c=>c.type===type),digest=createHash('sha256');let encodedBytes=0;
  for(const c of rows){const n=Buffer.alloc(4);n.writeUInt32BE(c.data.length);digest.update(n).update(c.data);encodedBytes+=c.data.length;}
  return {chunk:type,count:rows.length,encodedBytes,framedPayloadSHA256:rows.length?digest.digest('hex'):null,state:rows.length?'uninterpreted':'absent'};
 });
 const other=chunks.filter(c=>c.type[0]===c.type[0].toLowerCase()&&!PRIVATE.includes(c.type)&&!NUMERIC.includes(c.type)&&c.type!=='tRNS');
 const present=type=>privateAncillary.find(c=>c.chunk===type).count>0,warnings=['COLOR_UNMANAGED'];
 if(chunks.some(c=>['iCCP','sRGB','gAMA','cHRM','cICP','mDCV','cLLI'].includes(c.type)))warnings.push('COLOR_DECLARATIONS_UNINTERPRETED');
 if(dec.invalid)warnings.push('ANCILLARY_FIELD_INVALID');if(present('eXIf'))warnings.push('EXIF_UNINTERPRETED');if(['tEXt','zTXt','iTXt'].some(present))warnings.push('TEXT_OMITTED');
 return {schemaVersion:'bve.png-metadata.v1',originalSHA256:result.sha256,readerVersion:'bve-png-metadata.v1',validation:'bve-subset-checked',ihdr:{width:h.width,height:h.height,bitDepth:h.depth,colorType:h.color,channels:({0:1,2:3,4:2,6:4})[h.color],interlace:0},transparency:{mode:[4,6].includes(h.color)?'alpha':trns?'tRNS':'none',trnsChecked:trns!==null},orientation:{policy:'stored-raster',exifPresent:present('eXIf'),value:null,state:present('eXIf')?'uninterpreted':'absent'},color:{policy:'unmanaged-samples',fidelity:'unverified',gamma:dec.fields.gAMA,srgbIntent:dec.fields.sRGB,chromaticity:dec.fields.cHRM,physicalPixels:dec.fields.pHYs},privateAncillary,chunks:{total:chunks.length,otherAncillaryCount:other.length,otherAncillaryEncodedBytes:other.reduce((n,c)=>n+c.data.length,0)},warnings:warnings.sort()};
}
function unfilter(raw,width,height,channels){const stride=width*channels+1;
 for(let y=0;y<height;y++){const f=raw[y*stride];for(let j=0;j<width*channels;j++){
  const at=y*stride+1+j,a=j>=channels?raw[at-channels]:0,b=y?raw[at-stride]:0,c=y&&j>=channels?raw[at-stride-channels]:0,p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);
  raw[at]=(raw[at]+(f===0?0:f===1?a:f===2?b:f===3?Math.floor((a+b)/2):pa<=pb&&pa<=pc?a:pb<=pc?b:c))&255;
 }}
}
function chunk(type,d){const b=Buffer.alloc(d.length+12);b.writeUInt32BE(d.length);b.write(type,4);d.copy(b,8);b.writeUInt32BE(crc32(b.subarray(4,-4)),b.length-4);return b;}
function encode(rgba,w,h,key){
 const raw=Buffer.alloc((w*4+1)*h);for(let y=0;y<h;y++)rgba.copy(raw,y*(w*4+1)+1,y*w*4,(y+1)*w*4);
 const blocks=[Buffer.from([0x78,0x01])];let a=1,b=0;
 for(const v of raw){a=(a+v)%65521;b=(b+a)%65521;}
 for(let at=0;at<raw.length;){const n=Math.min(65535,raw.length-at),header=Buffer.alloc(5);header[0]=at+n===raw.length?1:0;header.writeUInt16LE(n,1);header.writeUInt16LE(n^65535,3);blocks.push(header,raw.subarray(at,at+n));at+=n;}
 const sum=Buffer.alloc(4);sum.writeUInt32BE(((b<<16)|a)>>>0);blocks.push(sum);
 const ih=Buffer.alloc(13);ih.writeUInt32BE(w);ih.writeUInt32BE(h,4);ih[8]=8;ih[9]=6;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ih),chunk('tEXt',Buffer.from('BVE-Derivative\0'+key)),chunk('IDAT',Buffer.concat(blocks)),chunk('IEND',Buffer.alloc(0))]);
}
export function buildMedia(sourceBinding,input,{onInflate=()=>{}}={}){
 check(bindingOK(sourceBinding));const a=sourceBinding.artifact;
 if(a.width*a.height>PREVIEW_LIMITS.pixels)return unavailableMedia(sourceBinding,'PIXEL_POLICY');
 if(input.length>PREVIEW_LIMITS.encoded)return unavailableMedia(sourceBinding,'PREVIEW_LIMIT');
 check(hash(input)===a.sha256,'ORIGINAL_CORRUPT');let d,callbackFailure;
 try{d=verifiedPNGData(input,{maxPixels:PREVIEW_LIMITS.pixels,onInflate:()=>{try{onInflate();}catch(e){callbackFailure=e;throw e;}}});}
 catch(e){if(callbackFailure)throw callbackFailure;const code=e.code==='PREVIEW_LIMIT'?'PREVIEW_LIMIT':/^Unsupported PNG:/.test(e.message)?'PREVIEW_UNSUPPORTED':'ORIGINAL_CORRUPT';return unavailableMedia(sourceBinding,code);}
 check(d.result.width===a.width&&d.result.height===a.height,'ORIGINAL_CORRUPT');
 if(d.chunks.some(c=>['acTL','fcTL','fdAT'].includes(c.type)))return unavailableMedia(sourceBinding,'PREVIEW_UNSUPPORTED');
 const palettes=d.chunks.filter(c=>c.type==='PLTE');
 if(palettes.length&&(palettes.length!==1||[0,4].includes(d.header.color)||palettes[0].index>d.chunks.find(c=>c.type==='IDAT').index))return unavailableMedia(sourceBinding,'PREVIEW_UNSUPPORTED');
 const dec=declarations(d.chunks);let trns;try{trns=transparency(d.chunks,d.header.color,dec.first);}catch{return unavailableMedia(sourceBinding,'PREVIEW_UNSUPPORTED');}
 const meta=metadata(d,trns,dec),metaBytes=Buffer.from(canonical(meta));check(metaBytes.length<=PREVIEW_LIMITS.metadata,'PREVIEW_LIMIT');
 const c=meta.ihdr.channels,stride=a.width*c+1,D=Math.max(a.width,a.height,384),w=Math.max(1,Math.floor(a.width*384/D)),h=Math.max(1,Math.floor(a.height*384/D));
 unfilter(d.raw,a.width,a.height,c);const rgba=Buffer.alloc(w*h*4);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const sy=Math.floor((2*y+1)*a.height/(2*h)),sx=Math.floor((2*x+1)*a.width/(2*w)),at=sy*stride+1+sx*c,to=(y*w+x)*4,gray=[0,4].includes(d.header.color);
  rgba[to]=d.raw[at];rgba[to+1]=gray?d.raw[at]:d.raw[at+1];rgba[to+2]=gray?d.raw[at]:d.raw[at+2];
  rgba[to+3]=[4,6].includes(d.header.color)?d.raw[at+c-1]:trns&&trns.every((v,i)=>v===d.raw[at+i])?0:255;
 }
 const key=mediaKey(sourceBinding),png=encode(rgba,w,h,key),sha256=hash(png);check(png.length<=PREVIEW_LIMITS.png&&sha256!==a.sha256);
 const result={schemaVersion:'bve.png-media.v1',sourceBinding:structuredClone(sourceBinding),profile:{...PREVIEW_PROFILE},state:'ready',errorCode:null,metadata:meta,metadataSHA256:hash(metaBytes),preview:{derivativeId:key,sha256,pixelSHA256:hash(rgba),width:w,height:h,encodedBytes:png.length,mediaType:'image/png',encoding:'base64',bytes:png.toString('base64'),role:'preview',isOriginal:false},warnings:[]};
 check(Buffer.byteLength(JSON.stringify(result))<=PREVIEW_LIMITS.response,'PREVIEW_LIMIT');return result;
}
function warningsOK(a,outer=false){return Array.isArray(a)&&a.length<=16&&new Set(a).size===a.length&&a.every(x=>(outer?[...META_WARN,'CACHE_REBUILT']:META_WARN).includes(x));}
function metadataOK(m,binding){
 if(!exact(m,['schemaVersion','originalSHA256','readerVersion','validation','ihdr','transparency','orientation','color','privateAncillary','chunks','warnings'])||m.schemaVersion!=='bve.png-metadata.v1'||m.readerVersion!=='bve-png-metadata.v1'||m.validation!=='bve-subset-checked'||m.originalSHA256!==binding.artifact.sha256||!warningsOK(m.warnings)||canonical(m.warnings)!==canonical([...m.warnings].sort()))return false;
 const h=m.ihdr,t=m.transparency,o=m.orientation,c=m.color;
 if(!exact(h,['width','height','bitDepth','colorType','channels','interlace'])||h.width!==binding.artifact.width||h.height!==binding.artifact.height||h.width*h.height>PREVIEW_LIMITS.pixels||h.bitDepth!==8||h.interlace!==0||h.channels!==({0:1,2:3,4:2,6:4})[h.colorType]||!h.channels)return false;
 if(!exact(t,['mode','trnsChecked'])||typeof t.trnsChecked!=='boolean'||[4,6].includes(h.colorType)&&t.trnsChecked||t.mode!==([4,6].includes(h.colorType)?'alpha':t.trnsChecked?'tRNS':'none'))return false;
 if(!exact(o,['policy','exifPresent','value','state'])||o.policy!=='stored-raster'||typeof o.exifPresent!=='boolean'||o.value!==null||o.state!==(o.exifPresent?'uninterpreted':'absent'))return false;
 if(!exact(c,['policy','fidelity','gamma','srgbIntent','chromaticity','physicalPixels'])||c.policy!=='unmanaged-samples'||c.fidelity!=='unverified')return false;
 for(const [name,type] of [['gamma','gAMA'],['srgbIntent','sRGB'],['chromaticity','cHRM'],['physicalPixels','pHYs']]){
  const f=c[name];if(!exact(f,['state','chunk','value'])||f.chunk!==type||!['absent','valid','invalid'].includes(f.state))return false;
  if(f.state!=='valid'){if(f.value!==null)return false;continue;}
  if(name==='gamma'&&!integer(f.value,1,4294967295)||name==='srgbIntent'&&!integer(f.value,0,3))return false;
  if(name==='chromaticity'&&(!Array.isArray(f.value)||f.value.length!==8||!f.value.every(x=>integer(x,0,4294967295))))return false;
  if(name==='physicalPixels'&&(!exact(f.value,['x','y','unit'])||!integer(f.value.x,1,4294967295)||!integer(f.value.y,1,4294967295)||![0,1].includes(f.value.unit)))return false;
 }
 if(!Array.isArray(m.privateAncillary)||m.privateAncillary.length!==5)return false;
 for(const [i,r] of m.privateAncillary.entries())if(!exact(r,['chunk','count','encodedBytes','framedPayloadSHA256','state'])||r.chunk!==PRIVATE[i]||!integer(r.count,0,4096)||!integer(r.encodedBytes,0,PREVIEW_LIMITS.encoded)||(r.count===0?(r.state!=='absent'||r.encodedBytes!==0||r.framedPayloadSHA256!==null):(r.state!=='uninterpreted'||!digest(r.framedPayloadSHA256))))return false;
 const e=m.privateAncillary[1];if(o.exifPresent!==(e.count>0))return false;
 const k=m.chunks;return exact(k,['total','otherAncillaryCount','otherAncillaryEncodedBytes'])&&integer(k.total,3,4096)&&integer(k.otherAncillaryCount,0,4096)&&integer(k.otherAncillaryEncodedBytes,0,PREVIEW_LIMITS.encoded)&&Buffer.byteLength(canonical(m))<=PREVIEW_LIMITS.metadata;
}
// Validate an untrusted/deserialized cache return, including its actual PNG and
// pixel hashes. It never re-inflates the original; output is <=384 square.
export function checkMediaView(v,binding=v?.sourceBinding){
 check(exact(v,['schemaVersion','sourceBinding','profile','state','errorCode','metadata','metadataSHA256','preview','warnings'])&&v.schemaVersion==='bve.png-media.v1'&&bindingOK(v.sourceBinding)&&canonical(v.sourceBinding)===canonical(binding)&&canonical(v.profile)===canonical(PREVIEW_PROFILE)&&warningsOK(v.warnings,true));
 if(v.state==='unavailable'){check(CODES.includes(v.errorCode)&&v.metadata===null&&v.metadataSHA256===null&&v.preview===null);return true;}
 check(v.state==='ready'&&v.errorCode===null&&metadataOK(v.metadata,binding)&&v.metadataSHA256===hash(Buffer.from(canonical(v.metadata))));
 const p=v.preview,a=binding.artifact,D=Math.max(a.width,a.height,384);check(exact(p,['derivativeId','sha256','pixelSHA256','width','height','encodedBytes','mediaType','encoding','bytes','role','isOriginal'])&&p.derivativeId===mediaKey(binding)&&digest(p.sha256)&&digest(p.pixelSHA256)&&p.sha256!==a.sha256&&p.width===Math.max(1,Math.floor(a.width*384/D))&&p.height===Math.max(1,Math.floor(a.height*384/D))&&integer(p.encodedBytes,1,600000)&&p.mediaType==='image/png'&&p.encoding==='base64'&&typeof p.bytes==='string'&&p.bytes.length<=800000&&p.role==='preview'&&p.isOriginal===false);
 const png=Buffer.from(p.bytes,'base64');check(png.length===p.encodedBytes&&png.toString('base64')===p.bytes&&hash(png)===p.sha256);
 const d=verifiedPNGData(png,{maxPixels:384**2,maxChunks:4});check(d.header.color===6&&d.result.width===p.width&&d.result.height===p.height&&d.chunks.map(c=>c.type).join(',')==='IHDR,tEXt,IDAT,IEND'&&d.chunks[1].data.equals(Buffer.from('BVE-Derivative\0'+p.derivativeId)));
 const pixels=createHash('sha256'),stride=p.width*4+1;for(let y=0;y<p.height;y++){check(d.raw[y*stride]===0);pixels.update(d.raw.subarray(y*stride+1,(y+1)*stride));}check(pixels.digest('hex')===p.pixelSHA256&&Buffer.byteLength(JSON.stringify(v))<=PREVIEW_LIMITS.response);return true;
}
