// Authored disposable PNGs and roots only. No real source/approval/native session.
import * as fs from 'node:fs';import * as path from 'node:path';import {randomUUID} from 'node:crypto';import {deflateSync} from 'node:zlib';
import {Kernel} from '../../../src/kernel.mjs';import {hash,crc32} from '../../../src/png.mjs';import {setup,create,PRODUCT} from './products-fixture.mjs';
export {PRODUCT};
export function chunk(type,data){const tag=Buffer.from(type),b=Buffer.alloc(data.length+12);b.writeUInt32BE(data.length);tag.copy(b,4);data.copy(b,8);b.writeUInt32BE(crc32(Buffer.concat([tag,data])),b.length-4);return b;}
export function png({width=8,height=6,color=2,rawExtra=0,metadata=true}={}){
  const channels={0:1,2:3,4:2,6:4}[color],raw=Buffer.alloc((width*channels+1)*height+rawExtra,0);for(let y=0;y<height;y++)raw.fill(127,y*(width*channels+1)+1,(y+1)*(width*channels+1));
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width);ihdr.writeUInt32BE(height,4);ihdr[8]=8;ihdr[9]=color;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),...(metadata?[chunk('tEXt',Buffer.from('Description\0Authored unverified source 🪴')),chunk('iCCP',Buffer.concat([Buffer.from('Authored profile\0\0'),deflateSync(Buffer.from('Authored profile bytes; not a genuine color profile'))]))]:[]),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
export function importSetup(t,{hook=()=>{},experimentalPng20=false}={}){
  const w=setup(t),sourceRoot=path.join(w.dir,'private-import-source');fs.mkdirSync(sourceRoot);
  w.importOptions={experimentalPng20,sources:{'authored-png':sourceRoot}};w.sourceRoot=sourceRoot;w.k=new Kernel(w.runtime,{workspace:w.config,expectedHead:w.store.read().reference,products:{accessFile:w.accessFile},imports:w.importOptions,workspaceHook:hook});w.c=JSON.parse(fs.readFileSync(path.join(w.runtime,'credentials.json')));w.k.productCommand(w.c.human,create(w,{productCode:'0007'}));return w;
}
export function importPacket(w,bytes=png(),extra={}){
  const filename=extra.filename??'آزمایشی-🪴.png';fs.writeFileSync(path.join(w.sourceRoot,filename),bytes);
  const input={schemaVersion:'3djat.historical-import.v1',importId:randomUUID(),productId:PRODUCT,origin:'import',kind:'historical-base',filename,
    source:{kind:'file',sourceId:'authored-png',revision:'authored-r1',sha256:hash(bytes),location:filename,locator:{kind:'section',section:'Authored source fixture only'},observedAt:'2026-01-01T00:00:00.000Z'},sha256:hash(bytes),encodedBytes:bytes.length,format:'image/png',width:8,height:6,bitDepth:8,interlaced:false,historicalParent:null,historicalApproval:null,importedAt:'2026-01-01T00:00:00.000Z',...extra};
  return {schemaVersion:'3djat.command.v1',operation:'asset.import.stage',key:randomUUID(),expected:{domainHead:w.store.read().reference,entityRevision:0},input};
}
export function commitPacket(w,staged,stagePacket,extra={}){return {schemaVersion:'3djat.command.v1',operation:'asset.import.commit',key:randomUUID(),expected:{domainHead:w.store.read().reference,entityRevision:1},input:{importId:stagePacket.input.importId,stageReceipt:staged.receipt,sha256:stagePacket.input.sha256,...extra}};}
