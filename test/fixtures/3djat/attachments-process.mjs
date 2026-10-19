// Owned authored interruption child. Private capabilities arrive on stdin only.
import * as fs from 'node:fs';
import {DomainProducts} from '../../../src/domain-products.mjs';
const [root,accessFile,stage]=process.argv.slice(2),input=JSON.parse(fs.readFileSync(0,'utf8'));
const writer=new DomainProducts(root,{accessFile,attachmentSources:input.sources,hook(at,detail){
  if(at===stage){fs.writeSync(1,JSON.stringify({stage:at,detail})+'\n');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,60000);}
}});
fs.writeSync(1,JSON.stringify(writer.command(input.token,input.packet))+'\n');
