import test from 'node:test';
import assert from 'node:assert/strict';
import {deflateSync} from 'node:zlib';
import {hash,verifyPNG,verifiedPNGData} from '../src/png.mjs';
import {fullResolutionPNG8} from '../src/png-raster.mjs';
import {chunk} from './fixtures/3djat/import-fixture.mjs';

import {png16} from './fixtures/png16.mjs';

test('RGBA16 all 65536 sample values, all filters, split data, and exact straight alpha',()=>{
 const pixel=(x,y)=>[y*256+x,65535-y*256-x,Math.min(x*257+128,65535),x*257];
 const original=png16(256,256,6,pixel,{filters:true}),sourceHash=hash(original);
 const converted=fullResolutionPNG8(original),out=verifiedPNGData(converted.bytes);
 assert.deepEqual(out.header,{width:256,height:256,depth:8,color:6});
 assert.equal(converted.sourceSHA256,sourceHash);assert.equal(hash(original),sourceHash);
 assert.equal(converted.sha256,hash(converted.bytes));assert.notEqual(converted.sha256,sourceHash);
 let maximum=0;
 for(let y=0;y<256;y++)for(let x=0;x<256;x++){
  const expected=pixel(x,y),at=y*1025+1+x*4;
  for(let c=0;c<4;c++){
   const actual=out.raw[at+c],v=expected[c];
   assert.equal(actual,Math.floor((v*255)/65535+0.5));
   maximum=Math.max(maximum,Math.abs(actual*257-v));
  }
 }
 assert.equal(maximum,128);
 assert.deepEqual(fullResolutionPNG8(converted.bytes).bytes,converted.bytes);
});

test('RGB tRNS compares all source bits before scaling; compatible color declarations survive',()=>{
 const gamma=Buffer.alloc(4);gamma.writeUInt32BE(45455);
 const srgb=Buffer.from([0]);
 const trns=Buffer.from([0x12,0x34,0x56,0x78,0x9a,0xbc]);
 const original=png16(2,1,2,x=>[0x1234+x,0x5678,0x9abc],
  {extras:[chunk('gAMA',gamma),chunk('sRGB',srgb),chunk('tRNS',trns)]});
 const out=verifiedPNGData(fullResolutionPNG8(original).bytes);
 assert.equal(out.header.color,6);
 assert.deepEqual(out.raw,Buffer.from([0,18,86,154,0,18,86,154,255]));
 assert.deepEqual(out.chunks.find(c=>c.type==='gAMA').data,gamma);
 assert.deepEqual(out.chunks.find(c=>c.type==='sRGB').data,srgb);
 assert.equal(out.chunks.some(c=>c.type==='tRNS'),false);
});

test('ICC framing and retained profile payload; contradictory color declarations fail conversion only',()=>{
 const icc=Buffer.concat([Buffer.from('Authored\0\0'),deflateSync(Buffer.from('opaque profile test payload'))]);
 const original=png16(2,1,4,()=>[0x1234,0x8765],{extras:[chunk('iCCP',icc)]});
 const out=verifiedPNGData(fullResolutionPNG8(original).bytes);
 assert.deepEqual(out.chunks.find(c=>c.type==='iCCP').data,icc);
 assert.equal(out.header.color,4);
 const conflicting=png16(1,1,4,()=>[0,65535],{extras:[chunk('iCCP',icc),chunk('sRGB',Buffer.from([0]))]});
 assert.equal(verifyPNG(conflicting).sha256,hash(conflicting));
 assert.throws(()=>fullResolutionPNG8(conflicting),/conflicting sRGB/);
});
