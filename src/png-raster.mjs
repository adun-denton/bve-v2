// Explicit compatibility conversion; never an original replacement or color transform.
import {deflateSync} from 'node:zlib';
import {verifiedPNGData,crc32,hash} from './png.mjs';
const channels=color=>({0:1,2:3,4:2,6:4})[color];
const decoded=new WeakSet();
const fail=message=>{throw Object.assign(Error(message),{code:'PNG_CONVERSION_UNSUPPORTED'});};
const quantize=(v,depth)=>depth===16?Math.round(v/257):v;
export function unfilterPNG(data){
 if(decoded.has(data))return data;
 const {raw,header:h}=data,bpp=channels(h.color)*(h.depth/8),stride=h.width*bpp+1;
 for(let y=0;y<h.height;y++){
  const f=raw[y*stride];if(f===0)continue;if(f>4)fail('Invalid PNG filter');
  for(let j=0;j<h.width*bpp;j++){
   const at=y*stride+1+j,a=j>=bpp?raw[at-bpp]:0,b=y?raw[at-stride]:0,c=y&&j>=bpp?raw[at-stride-bpp]:0;
   const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);
   raw[at]=(raw[at]+(f===0?0:f===1?a:f===2?b:f===3?Math.floor((a+b)/2):pa<=pb&&pa<=pc?a:pb<=pc?b:c))&255;
  }
 }
 decoded.add(data);return data;
}
// Samples remain at their source precision. Caller first invokes unfilterPNG.
export function samplePNG(data,x,y){
 const {header:h,raw}=data,c=channels(h.color),size=h.depth/8,at=y*(h.width*c*size+1)+1+x*c*size;
 return Array.from({length:c},(_,i)=>size===2?raw.readUInt16BE(at+i*2):raw[at+i]);
}
export function toRGBA8(samples,header,transparent=null){
 const gray=[0,4].includes(header.color),alpha=[4,6].includes(header.color),q=v=>quantize(v,header.depth);
 return [q(samples[0]),q(samples[gray?0:1]),q(samples[gray?0:2]),alpha?q(samples.at(-1)):transparent&&transparent.every((v,i)=>v===samples[i])?0:255];
}
function chunk(type,data){
 const b=Buffer.alloc(data.length+12);b.writeUInt32BE(data.length);b.write(type,4);data.copy(b,8);b.writeUInt32BE(crc32(b.subarray(4,-4)),b.length-4);return b;
}
function declarations(d){
 const {chunks,header:h}=d,first=type=>chunks.find(c=>c.type===type)?.index??Infinity;
 if(chunks.some(c=>['cICP','mDCV','cLLI'].includes(c.type)))fail('HDR color declarations are unsupported in the 8-bit working copy');
 if(chunks.some(c=>['acTL','fcTL','fdAT'].includes(c.type)))fail('Animated PNG compatibility conversion is unsupported');
 const colors=['iCCP','sRGB','gAMA','cHRM','sBIT','bKGD','tRNS','pHYs'];
 for(const type of colors){
  const rows=chunks.filter(c=>c.type===type);if(rows.length>1)fail('Duplicate '+type);
  if(!rows.length)continue;
  const {data:b,index}=rows[0];if(index>=first('IDAT'))fail('Late '+type);
  if(['iCCP','sRGB','gAMA','cHRM','sBIT'].includes(type)&&index>=first('PLTE'))fail('Misordered '+type);
  if(type==='gAMA'&&(b.length!==4||!b.readUInt32BE(0)))fail('Invalid gAMA');
  if(type==='cHRM'&&b.length!==32)fail('Invalid cHRM');
  if(type==='sRGB'&&(b.length!==1||b[0]>3||first('iCCP')!==Infinity))fail('Invalid or conflicting sRGB');
  if(type==='iCCP'){
   const end=b.indexOf(0);if(end<1||end>79||b.length<end+4||b[end+1]!==0)fail('Invalid iCCP framing');
   // Profile payload is retained, never decompressed or reinterpreted here.
   if((b[end+2]&15)!==8||((b[end+2]<<8)|b[end+3])%31)fail('Invalid iCCP compression header');
  }
  if(type==='sBIT'&&(b.length!==channels(h.color)||[...b].some(v=>v<1||v>h.depth)))fail('Invalid sBIT');
  if(type==='bKGD'&&b.length!==([0,4].includes(h.color)?2:6))fail('Invalid bKGD');
  if(type==='pHYs'&&(b.length!==9||b[8]>1))fail('Invalid pHYs');
 }
 const trns=chunks.find(c=>c.type==='tRNS');
 if(trns&&(![0,2].includes(h.color)||trns.data.length!==(h.color===0?2:6)||first('PLTE')!==Infinity&&trns.index<first('PLTE')))fail('Invalid tRNS');
 return trns?Array.from({length:trns.data.length/2},(_,i)=>trns.data.readUInt16BE(i*2)):null;
}
export function fullResolutionPNG8(input){
 const d=verifiedPNGData(input,{maxChunks:32768}),h=d.header,sourceSHA256=d.result.sha256;
 if(h.depth===8){const bytes=Buffer.from(input);return {bytes,sourceSHA256,sha256:sourceSHA256,width:h.width,height:h.height,bitDepth:8,isOriginal:true,conversion:'none'};}
 const transparent=declarations(d);unfilterPNG(d);
 const gray=[0,4].includes(h.color),outColor=transparent?(gray?4:6):h.color,c=channels(outColor),stride=h.width*c+1;
 const raw=Buffer.alloc(stride*h.height),sourceChannels=channels(h.color),sourceStride=h.width*sourceChannels*2+1;
 for(let y=0;y<h.height;y++)for(let x=0;x<h.width;x++){
  const at=y*sourceStride+1+x*sourceChannels*2,to=y*stride+1+x*c;
  let clear=Boolean(transparent);
  for(let i=0;i<sourceChannels;i++){
   const v=d.raw.readUInt16BE(at+i*2);raw[to+i]=quantize(v,16);
   if(clear&&v!==transparent[i])clear=false;
  }
  if(transparent)raw[to+c-1]=clear?0:255;
 }
 const ih=Buffer.alloc(13);ih.writeUInt32BE(h.width);ih.writeUInt32BE(h.height,4);ih[8]=8;ih[9]=outColor;
 const retained=[];
 for(const item of d.chunks){
  const {type}=item;let b=item.data;
  // Preserve declared color space exactly. Other metadata is deliberately omitted:
  // it may describe old sample values, contain private text, or be unsafe to copy.
  if(!['iCCP','sRGB','gAMA','cHRM','pHYs','bKGD'].includes(type))continue;
  if(type==='bKGD'){b=Buffer.from(b);for(let i=0;i<b.length;i+=2)b.writeUInt16BE(Math.round(b.readUInt16BE(i)/257),i);}
  retained.push(chunk(type,b));
 }
 const bytes=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ih),...retained,chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
 return {bytes,sourceSHA256,sha256:hash(bytes),width:h.width,height:h.height,bitDepth:8,isOriginal:false,conversion:'nearest-16-to-8-same-color-space.v1'};
}
