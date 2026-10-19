import { inflateSync, deflateSync } from 'node:zlib';
import {PNG_PIXELS,IMG20_PIXELS} from './image-policy.mjs';
import { createHash } from 'node:crypto';
export const hash = b => createHash('sha256').update(b).digest('hex');
export function crc32(bytes) {
  let c = 0xffffffff;
  for (const byte of bytes) { c ^= byte; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); }
  return (c ^ 0xffffffff) >>> 0;
}
const signature = Buffer.from([137,80,78,71,13,10,26,10]);
export function verifyPNG(input,{maxPixels=PNG_PIXELS}={}) {
  if(!Number.isInteger(maxPixels)||maxPixels<1||maxPixels>IMG20_PIXELS)throw Error('Invalid PNG pixel limit');
  const b = Buffer.from(input);
  if (b.length > 24 * 1024 * 1024 || !b.subarray(0,8).equals(signature)) throw Error('Unsupported or oversized image: PNG required');
  let p = 8, header, ended = false, idatEnded = false, idats = [];
  while (p < b.length) {
    if (p + 12 > b.length) throw Error('Truncated PNG');
    const n = b.readUInt32BE(p), type = b.toString('ascii', p+4, p+8), end = p+12+n;
    if (end > b.length || !/^[A-Za-z]{4}$/.test(type)) throw Error('Invalid PNG chunk');
    const d = b.subarray(p+8, p+8+n);
    if (crc32(b.subarray(p+4,p+8+n)) !== b.readUInt32BE(p+8+n)) throw Error('PNG CRC mismatch');
    if (!header && type !== 'IHDR') throw Error('PNG header must be first');
    if (type === 'IHDR') {
      if (header || n !== 13) throw Error('Invalid PNG header');
      header = {width:d.readUInt32BE(0),height:d.readUInt32BE(4),depth:d[8],color:d[9]};
      if (!header.width || !header.height || header.width*header.height > maxPixels || d[8] !== 8 || ![0,2,4,6].includes(d[9]) || d[10] || d[11] || d[12]) throw Error(`Unsupported PNG: 8-bit non-interlaced grayscale/RGB/RGBA, at most ${maxPixels} pixels`);
    } else if (type === 'IDAT') {
      if (idatEnded) throw Error('Noncontiguous PNG data');
      idats.push(d);
    } else {
      if (idats.length) idatEnded = true;
      if (type === 'IEND') { if (n || !idats.length || end !== b.length) throw Error('Invalid PNG end'); ended = true; }
      else if (type === 'PLTE') { if (!n || n % 3 || n > 768) throw Error('Invalid PNG palette'); }
      else if (type[0] === type[0].toUpperCase()) throw Error('Unknown critical PNG chunk');
    }
    p = end;
  }
  if (!ended) throw Error('Missing PNG end');
  const channels = ({0:1,2:3,4:2,6:4})[header.color], stride = header.width * channels + 1;
  // For all supported channels, decoded bytes <= 4*pixels + height <= 5*maxPixels.
  // This includes one filter byte for every narrow/tall row; no side cap is needed.
  const decodedBytes=stride*header.height;
  if(!Number.isSafeInteger(decodedBytes)||decodedBytes>5*maxPixels)throw Error('Unsafe PNG allocation');
  const raw = inflateSync(Buffer.concat(idats), {maxOutputLength: decodedBytes});
  if (raw.length !== decodedBytes) throw Error('Invalid PNG pixel length');
  for (let y = 0; y < header.height; y++) if (raw[y*stride] > 4) throw Error('Invalid PNG filter');
  return {sha256:hash(b),width:header.width,height:header.height,mediaType:'image/png',size:b.length};
}
function chunk(type, bytes) {
  const t = Buffer.from(type), b = Buffer.alloc(bytes.length+12);
  b.writeUInt32BE(bytes.length,0); t.copy(b,4); bytes.copy(b,8); b.writeUInt32BE(crc32(Buffer.concat([t,bytes])),bytes.length+8); return b;
}
// Authored raster fixtures, not model output. Six deliberately different compositions.
export function fixturePNG(direction = 0, iteration = 1, width = 900, height = 650) {
  const palettes = [[222,232,216],[236,210,186],[211,224,237],[232,215,229],[222,224,180],[203,226,222]];
  const bg=palettes[direction%6], raw=Buffer.alloc((width*3+1)*height);
  for(let y=0;y<height;y++) for(let x=0;x<width;x++) {
    let c = bg;
    const xx=x/width, yy=y/height, k=direction%6;
    const shapes = [Math.pow((xx-.58)*1.4,2)+Math.pow((yy-.55),2)<.13, xx>.5&&yy>.16&&yy<.85,
      Math.abs(xx-.5)+Math.abs(yy-.5)<.38, Math.sin(xx*16+yy*7)>0.4&&yy>.25,
      (xx>.16&&xx<.36||xx>.44&&xx<.64||xx>.72&&xx<.82)&&yy>.25&&yy<.82,
      Math.pow(xx-.5,2)+Math.pow(yy-.5,2)<.16&&Math.pow(xx-.5,2)+Math.pow(yy-.5,2)>.06];
    if(shapes[k]) c=[bg[0]-80,bg[1]-90,bg[2]-65];
    if(iteration>1 && xx>.12&&xx<.34&&yy>.14&&yy<.21) c=[247,245,236];
    if(yy>.91) c=[39,51,45]; // visible authored fixture footer bar
    const i=y*(width*3+1)+1+x*3; raw[i]=c[0];raw[i+1]=c[1];raw[i+2]=c[2];
  }
  const h=Buffer.alloc(13); h.writeUInt32BE(width,0); h.writeUInt32BE(height,4);h[8]=8;h[9]=2;
  return Buffer.concat([signature,chunk('IHDR',h),chunk('tEXt',Buffer.from(`Description\0Authored BVE fixture ${direction+1}; iteration ${iteration}; simulated executor`)),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
