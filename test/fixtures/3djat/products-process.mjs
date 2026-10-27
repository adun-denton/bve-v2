// Authored child-process writer. Credentials arrive on stdin and never enter output.
import fs from 'node:fs';import {DomainProducts} from '../../../src/domain-products.mjs';
const [root,accessFile,hold]=process.argv.slice(2),input=JSON.parse(fs.readFileSync(0,'utf8'));
const writer=new DomainProducts(root,{accessFile,hook(stage){if(hold==='hold'&&stage==='locked'){fs.writeSync(1,JSON.stringify({stage:'locked'})+'\n');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,2000);}}});
fs.writeSync(1,JSON.stringify(writer.command(input.token,input.packet))+'\n');
