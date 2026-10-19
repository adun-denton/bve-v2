// Disposable verification only. No live-root discovery, native staff or provider calls.
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline';
import {execFileSync,spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {importSetup,PRODUCT} from '../test/fixtures/3djat/import-fixture.mjs';
import {serve} from '../src/server.mjs';
import {backupRoot} from './backup.mjs';
import {restoreCombined,verifyCombined} from '../src/workspace-backup.mjs';
import {hash} from '../src/png.mjs';
import {recoverOperationalLock} from '../src/workspace.mjs';
const [configFile,output]=process.argv.slice(2);
if(!path.isAbsolute(configFile)||!path.isAbsolute(output)||fs.existsSync(output))throw Error('Explicit config and new output directory required');
const config=JSON.parse(fs.readFileSync(configFile));
if(config.disposableExperiment!==true||!Array.isArray(config.files)||config.files.length>13)throw Error('Disposable experiment declaration required');
fs.mkdirSync(output,{mode:0o700});const cleanup=[];
const w=importSetup({after(fn){cleanup.push(fn);}},{experimentalPng20:true});
for(const [i,f] of config.files.entries())fs.copyFileSync(f.path,path.join(w.sourceRoot,`image-${i+1}.png`));
const sourcePin=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const stream=fs.createWriteStream(path.join(output,'internal-memory.ndjson'),{flags:'wx',mode:0o600});
let phase='startup',last=performance.now(),maxGap=0;
const sample=()=>{const n=performance.now();maxGap=Math.max(maxGap,n-last);last=n;stream.write(JSON.stringify({time:Date.now(),phase,...process.memoryUsage(),maxRssKiB:process.resourceUsage().maxRSS,gapMs:maxGap})+'\n');};
const timer=setInterval(sample,20);sample();w.k.close();
let app=await serve({root:w.runtime,port:0,imports:w.importOptions});w.k=app.kernel;
const reply=x=>process.stdout.write(JSON.stringify(x)+'\n');
// This pipe is private and includes a bearer. The measurement controller excludes it from reports.
reply({sourcePin,pid:process.pid,origin:app.origin,credential:w.c.human,head:w.store.read().reference,productId:PRODUCT,runtime:w.runtime,sourceRoot:w.sourceRoot});
try{for await(const line of readline.createInterface({input:process.stdin})){
  const message=JSON.parse(line);phase=message.op;sample();
  if(message.op==='phase'){phase=message.name;reply({ok:true});}
  else if(message.op==='status'){
    const db=new DatabaseSync(path.join(w.runtime,'workspace.sqlite'),{readOnly:true});
    try{reply({sourcePin,counts:Object.fromEntries(['artifact','assetImport','importReceipt','job','assignment','iteration','request','round','sessionBinding','acceptance'].map(k=>[k,db.prepare('SELECT count(*) AS n FROM records WHERE kind=?').get(k).n])),originals:db.prepare('SELECT hash,length(data) AS bytes FROM bytes').all(),memory:process.memoryUsage(),maxRssKiB:process.resourceUsage().maxRSS,maxInternalGapMs:maxGap});}finally{db.close();}
  }else if(message.op==='backup-restore'){
    const start=performance.now(),backup=path.join(w.dir,'complete-backup');await backupRoot(w.runtime,backup);const backed=performance.now();verifyCombined(backup);
    const businessRoot=path.join(w.dir,'separate-business'),runtimeRoot=path.join(w.dir,'separate-runtime'),paths=Object.fromEntries(Object.entries(w.store.workspace.paths).map(([k,v])=>[k,path.join(businessRoot,v)]));
    const restored=performance.now();restoreCombined(backup,{businessRoot,runtimeRoot,paths});const finished=performance.now();
    const other=await serve({root:runtimeRoot,port:0});const rows=[];
    try{for(const a of other.kernel.read(w.c.human,'artifact')){
      const response=await fetch(other.origin+'/api/original?id='+a.id,{headers:{authorization:'Bearer '+w.c.human}});if(!response.ok)throw Error('Restored HTTP failure');const b=Buffer.from(await response.arrayBuffer());if(hash(b)!==a.sha256)throw Error('Restored hash mismatch');fs.writeFileSync(path.join(output,'restored-'+a.id+'.png'),b);rows.push({artifactId:a.id,sha256:hash(b),bytes:b.length});
    }}finally{await other.stop();}
    fs.copyFileSync(path.join(backup,'combined-backup.json'),path.join(output,'combined-backup-manifest.json'));
    reply({complete:true,backupMs:backed-start,verifyMs:restored-backed,restoreMs:finished-restored,restored:rows,domainHead:w.store.read().reference});
  }else if(message.op==='recovery'){
    const rows=[],ok=r=>{if(r.schemaVersion!=='3djat.result.v1')throw Error(JSON.stringify(r));return r;};
    for(const boundary of ['after-import-stage','after-import-verify','after-import-commit','during-import-export']){
      phase='recovery-'+boundary;sample();
      const stage=structuredClone(message.stagePacket);stage.key=randomUUID();stage.input.importId=randomUUID();let staged,commit,result;
      if(boundary!=='after-import-stage'){staged=ok(w.k.assetCommand(w.c.human,stage));commit=structuredClone(message.commitPacket);commit.key=randomUUID();commit.input.importId=stage.input.importId;commit.input.stageReceipt=staged.receipt;}
      if(boundary==='during-import-export')result=ok(w.k.assetCommand(w.c.human,commit));
      const packetFile=path.join(output,'recovery-'+boundary+'-packet.json');fs.writeFileSync(packetFile,JSON.stringify(commit??stage));await app.stop();
      // Same Node host/filesystem as the accepted subprocess regression, without
      // crossing a separate runtime bridge or guessing a host PID namespace.
      const child=spawnSync(process.execPath,['test/fixtures/3djat/img20-process.mjs',w.runtime,w.sourceRoot,packetFile,boundary,result?.reference.id??''],{encoding:'utf8',timeout:30000,env:{...process.env,IMG20_SOURCE_PIN:sourcePin}});
      fs.writeFileSync(packetFile+'.stderr',child.stderr??'');fs.writeFileSync(packetFile+'.stdout',child.stdout??'');
      if(!(child.signal||child.status!==0)||fs.readFileSync(packetFile+'.reached','utf8')!==boundary||child.stdout!=='')throw Error('Unconfirmed child termination');
      const lock=path.join(w.root,'domain-write.lock');if(fs.existsSync(lock))w.store.recoverLock({expectedLockHash:hash(fs.readFileSync(lock)),confirmedQuiescent:true});
      const op=path.join(w.runtime,'operational-write.lock');if(fs.existsSync(op))recoverOperationalLock(w.runtime,{expectedLockHash:hash(fs.readFileSync(op)),confirmedQuiescent:true});
      app=await serve({root:w.runtime,port:0,imports:w.importOptions});w.k=app.kernel;
      staged=ok(w.k.assetCommand(w.c.human,stage));
      if(!commit){commit=structuredClone(message.commitPacket);commit.key=randomUUID();commit.input.importId=stage.input.importId;commit.input.stageReceipt=staged.receipt;}
      result??=ok(w.k.assetCommand(w.c.human,commit));if(JSON.stringify(w.k.assetCommand(w.c.human,commit))!==JSON.stringify(result))throw Error('Recovery replay mismatch');
      const response=await fetch(app.origin+'/api/original?id='+result.reference.id,{headers:{authorization:'Bearer '+w.c.human}}),raw=Buffer.from(await response.arrayBuffer());if(!response.ok||hash(raw)!==stage.input.sha256)throw Error('Recovered original mismatch');
      rows.push({boundary,confirmedExit:{status:child.status,signal:child.signal},reached:true,artifactId:result.reference.id,commit:result,outputAbsent:child.stdout==='',sha256:hash(raw),childMemory:JSON.parse(fs.readFileSync(packetFile+'.memory.json')),externalProcessSampling:'NOT MEASURED; mounted process namespace mismatch',peakLimitation:'Child reports OS high-water at boundary before SIGKILL; no post-kill external peak'});
      fs.writeFileSync(path.join(output,'recovery-results.json'),JSON.stringify(rows,null,2)+'\n');
    }
    reply({rows,origin:app.origin});
  }else if(message.op==='stop'){reply({ok:true});break;}
  else throw Error('Unknown experiment control');
}}
finally{clearInterval(timer);sample();await app.stop();stream.end();await new Promise(ok=>stream.on('finish',ok));for(const fn of cleanup)fn();}
