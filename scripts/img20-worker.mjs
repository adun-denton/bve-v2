// Disposable verification only. No live-root discovery, native staff or provider calls.
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline';
import {execFileSync} from 'node:child_process';
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
  }else if(message.op==='pause'){await app.stop();reply({ok:true});}
  else if(message.op==='resume'){
    // Parent confirms killed child exit before requesting explicit lock recovery.
    if(message.confirmedChildExited!==true)throw Error('Child exit confirmation required');
    const lock=path.join(w.root,'domain-write.lock');if(fs.existsSync(lock))w.store.recoverLock({expectedLockHash:hash(fs.readFileSync(lock)),confirmedQuiescent:true});
    const op=path.join(w.runtime,'operational-write.lock');if(fs.existsSync(op))recoverOperationalLock(w.runtime,{expectedLockHash:hash(fs.readFileSync(op)),confirmedQuiescent:true});
    app=await serve({root:w.runtime,port:0,imports:w.importOptions});w.k=app.kernel;reply({origin:app.origin});
  }else if(message.op==='stop'){reply({ok:true});break;}
  else throw Error('Unknown experiment control');
}}
finally{clearInterval(timer);sample();await app.stop();stream.end();await new Promise(ok=>stream.on('finish',ok));for(const fn of cleanup)fn();}
