// Inert authored PNG truth, retained developer roots. No cleanup/real approvals.
import * as fs from 'node:fs';import * as path from 'node:path';import * as os from 'node:os';
import {randomUUID} from 'node:crypto';import {deflateSync,inflateSync} from 'node:zlib';
import {Kernel} from '../../../src/kernel.mjs';import {DomainStore} from '../../../src/domain-store.mjs';import {provisionProductPrincipal} from '../../../src/domain-products.mjs';import {crc32,hash} from '../../../src/png.mjs';
export const PRODUCT='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',WORKSPACE='bbbbbbbb-bbbb-4bbb-9bbb-bbbbbbbbbbbb';
export const rootFor=prefix=>{const base=process.env.J05C_P1_EVIDENCE_ROOT??os.tmpdir();fs.mkdirSync(base,{recursive:true});return fs.mkdtempSync(path.join(base,prefix));};
export function chunk(type,data){const b=Buffer.alloc(data.length+12);b.writeUInt32BE(data.length);b.write(type,4);data.copy(b,8);b.writeUInt32BE(crc32(b.subarray(4,-4)),b.length-4);return b;}
export function png({width=7,height=5,color=6,filter=0,trns=null,before=[],after=[],literal=null,constant=null,depth=8,interlace=0,extra=0}={}){
 const c=({0:1,2:3,4:2,6:4})[color],pixels=Buffer.alloc(width*height*c),rgba=width*height<=400000?Buffer.alloc(width*height*4):null;
 for(let y=0;y<height;y++){
  if(constant!==null){pixels.fill(constant,y*width*c,(y+1)*width*c);continue;}
  for(let x=0;x<width;x++){const g=(17+x*37+y*13)%256,rgb=[(17+x*31+y*11)%256,(43+x*7+y*47)%256,(89+x*53+y*3)%256],a=[0,1,127,128,254,255][(x+2*y)%6],samples=literal?Array.from(literal.subarray((y*width+x)*c,(y*width+x+1)*c)):({0:[g],2:rgb,4:[g,a],6:[...rgb,a]})[color];pixels.set(samples,(y*width+x)*c);}
 }
 if(rgba)for(let n=0;n<width*height;n++){const s=Array.from(pixels.subarray(n*c,(n+1)*c)),rgb=[0,4].includes(color)?[s[0],s[0],s[0]]:s.slice(0,3),a=[4,6].includes(color)?s.at(-1):trns&&trns.every((v,i)=>(v&255)===s[i])?0:255;rgba.set([...rgb,a],n*4);}
 const raw=Buffer.alloc((width*c+1)*height+extra);for(let y=0;y<height;y++){raw[y*(width*c+1)]=filter;for(let i=0;i<width*c;i++){
  const at=y*width*c+i,l=i>=c?pixels[at-c]:0,u=y?pixels[at-width*c]:0,ul=y&&i>=c?pixels[at-width*c-c]:0;
  let predicted=0;if(filter===1)predicted=l;if(filter===2)predicted=u;if(filter===3)predicted=(l+u)>>1;if(filter===4){const p=l+u-ul,dist=[Math.abs(p-l),Math.abs(p-u),Math.abs(p-ul)],min=Math.min(...dist);predicted=[l,u,ul][dist.indexOf(min)];}raw[y*(width*c+1)+1+i]=(pixels[at]-predicted+256)%256;
 }}
 const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=depth;header[9]=color;header[12]=interlace;
 const t=trns?chunk('tRNS',Buffer.from(trns.flatMap(v=>[v>>8,v&255]))):null;
 return {bytes:Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),...before,...(t?[t]:[]),chunk('IDAT',deflateSync(raw)),...after,chunk('IEND',Buffer.alloc(0))]),rgba,width,height,color,constant};
}
export function expected(f){const den=Math.max(f.width,f.height,384),w=Math.max(1,Math.floor(f.width*384/den)),h=Math.max(1,Math.floor(f.height*384/den)),pixels=Buffer.alloc(w*h*4);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){const sy=((2*y+1)*f.height/(2*h))|0,sx=((2*x+1)*f.width/(2*w))|0;if(f.rgba)f.rgba.copy(pixels,4*(y*w+x),4*(sy*f.width+sx),4*(sy*f.width+sx)+4);else pixels.set([f.constant,f.constant,f.constant,255],4*(y*w+x));}return {width:w,height:h,pixels};
}
export function outputPixels(bytes){let at=8;const parts=[];let width,height;while(at<bytes.length){const n=bytes.readUInt32BE(at),type=bytes.toString('ascii',at+4,at+8),data=bytes.subarray(at+8,at+8+n);if(type==='IHDR'){width=data.readUInt32BE(0);height=data.readUInt32BE(4);}if(type==='IDAT')parts.push(data);at+=n+12;}const raw=inflateSync(Buffer.concat(parts)),out=Buffer.alloc(width*height*4);for(let y=0;y<height;y++){if(raw[y*(width*4+1)]!==0)throw Error('Output filter must be0');raw.copy(out,y*width*4,y*(width*4+1)+1,(y+1)*(width*4+1));}return out;}
export function binding(f,extra={}){return {artifact:{productId:PRODUCT,artifactId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',version:1,sha256:hash(f.bytes),width:f.width,height:f.height,...extra},origin:{kind:'produced',jobId:null,iterationId:null,deliveryId:null}};}
export function setup(t,{hook=()=>{}}={}){
 const dir=rootFor('p1-authored-'),root=path.join(dir,'business'),runtime=path.join(dir,'runtime'),sourceRoot=path.join(dir,'source'),accessFile=path.join(dir,'access.json');fs.mkdirSync(sourceRoot);
 const store=DomainStore.initialize(root,{workspaceId:WORKSPACE,sourceCommit:'74d0f70a696394e078de91eeb0194a419592675a'});for(const p of Object.values(store.workspace.paths))fs.mkdirSync(path.join(root,p),{recursive:true});
 provisionProductPrincipal(accessFile,{workspaceId:WORKSPACE,id:'authored-human',role:'human'});
 const config={schemaVersion:'3djat.connection.v1',workspaceId:WORKSPACE,domainRoot:root,runtimeRoot:runtime,paths:Object.fromEntries(Object.entries(store.workspace.paths).map(([k,v])=>[k,path.join(root,v)])),storage:'local-unsynced'},imports={sources:{'authored-png':sourceRoot}};
 const w={dir,root,runtime,sourceRoot,store,config,imports,k:new Kernel(runtime,{workspace:config,expectedHead:store.read().reference,products:{accessFile},imports,workspaceHook:hook})};w.c=JSON.parse(fs.readFileSync(path.join(runtime,'credentials.json')));
 const r=w.k.productCommand(w.c.human,{schemaVersion:'3djat.command.v1',operation:'product.create',key:randomUUID(),expected:{domainHead:store.read().reference,entityRevision:0},input:{productId:PRODUCT,productCode:null,workingName:'Authored preview product'}});if(r.schemaVersion!=='3djat.result.v1')throw Error(JSON.stringify(r));
 fs.writeFileSync(path.join(dir,'unrelated-sentinel'),'P1_AUTHORED_SENTINEL\n');t.after(()=>{w.k?.close();fs.writeFileSync(path.join(dir,'FIXTURE-RETAINED.json'),JSON.stringify({job:'J05C-P1',test:t.name,noCleanup:true})+'\n');});return w;
}
export function staged(w,f=png()){
 const importId=randomUUID(),filename=importId+'.png';fs.writeFileSync(path.join(w.sourceRoot,filename),f.bytes);const source={kind:'file',sourceId:'authored-png',revision:'r1',sha256:hash(f.bytes),location:filename,locator:{kind:'page',page:1},observedAt:'2026-01-01T00:00:00.000Z'};
 const packet={schemaVersion:'3djat.command.v1',operation:'asset.import.stage',key:randomUUID(),expected:{domainHead:w.store.read().reference,entityRevision:0},input:{schemaVersion:'3djat.historical-import.v1',importId,productId:PRODUCT,origin:'import',kind:'historical-base',filename,source,sha256:source.sha256,encodedBytes:f.bytes.length,format:'image/png',width:f.width,height:f.height,bitDepth:8,interlaced:false,historicalParent:null,historicalApproval:null,importedAt:source.observedAt}};
 const stage=w.k.assetCommand(w.c.human,packet);if(stage.schemaVersion!=='3djat.result.v1')throw Error(JSON.stringify(stage));return {importId,source,stage,packet};
}
export function imported(w,f=png()){
 const {importId,source,stage}=staged(w,f);const result=w.k.assetCommand(w.c.human,{schemaVersion:'3djat.command.v1',operation:'asset.import.commit',key:randomUUID(),expected:{domainHead:w.store.read().reference,entityRevision:1},input:{importId,stageReceipt:stage.receipt,sha256:source.sha256}});if(result.schemaVersion!=='3djat.result.v1')throw Error(JSON.stringify(result));return w.k.importPortable(w.c.human,result.reference.id).artifact;
}
