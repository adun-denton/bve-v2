import {deflateSync} from 'node:zlib';
import {chunk} from './3djat/import-fixture.mjs';
export function png16(width,height,color,pixel,{filters=false,extras=[]}={}){
 const n={0:1,2:3,4:2,6:4}[color], row=width*n*2, filtered=Buffer.alloc((row+1)*height);
 let prev=Buffer.alloc(row);
 for(let y=0;y<height;y++){
  const current=Buffer.allocUnsafe(row),f=filters?y%5:0;
  for(let x=0;x<width;x++){const samples=pixel(x,y);for(let i=0;i<n;i++)current.writeUInt16BE(samples[i],(x*n+i)*2);}
  filtered[y*(row+1)]=f;
  if(!f){current.copy(filtered,y*(row+1)+1);prev=current;continue;}
  for(let j=0;j<row;j++){
   const a=j>=n*2?current[j-n*2]:0,b=prev[j],c=j>=n*2?prev[j-n*2]:0;
   const pa=Math.abs(b-c),pb=Math.abs(a-c),pc=Math.abs(a+b-2*c);
   const pred=[0,a,b,(a+b)>>1,pa<=pb&&pa<=pc?a:pb<=pc?b:c][f];
   filtered[y*(row+1)+1+j]=(current[j]-pred)&255;
  }
  prev=current;
 }
 const hdr=Buffer.alloc(13);hdr.writeUInt32BE(width);hdr.writeUInt32BE(height,4);hdr[8]=16;hdr[9]=color;
 const z=deflateSync(filtered),split=Math.ceil(z.length/2);
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',hdr),...extras,chunk('IDAT',z.subarray(0,split)),chunk('IDAT',z.subarray(split)),chunk('IEND',Buffer.alloc(0))]);
}
