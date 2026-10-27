import * as fs from 'node:fs';
import { Kernel } from '../../../src/kernel.mjs';
import { DomainStore } from '../../../src/domain-store.mjs';
import { backupCombined } from '../../../src/workspace-backup.mjs';
import { acquireOperational } from '../../../src/workspace.mjs';
import { noop } from './domain-store-fixture.mjs';
const [mode,root,destination,stage,control]=process.argv.slice(2),send=x=>fs.writeSync(1,JSON.stringify(x)+'\n');
try {
  if(mode==='domain-write'){const s=new DomainStore(root);s.commit(noop(s.read().reference,'authored-child'));send({written:true});}
  else if(mode==='operational-write'){const k=new Kernel(root,{recover:false});try{const c=JSON.parse(fs.readFileSync(root+'/credentials.json'));k.call(c.human,'project.create','authored-child',{name:'Authored child',brief:'Authored only'});send({written:true});}finally{k.close();}}
  else if(mode==='hold-operational'){const release=acquireOperational(root);send({locked:true});while(!fs.existsSync(control))Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,50);release();}
  else {const result=await backupCombined(root,destination,{hook(at){if(at===stage){send({stage:at});while(!fs.existsSync(control))Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,50);}}});send({complete:true,path:result});}
}catch(e){send({error:e.code??'IO_FAILURE'});process.exitCode=2;}
