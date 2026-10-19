// Disposable verification only. No live-root discovery, native staff or provider calls.
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {importSetup,PRODUCT} from '../test/fixtures/3djat/import-fixture.mjs';
import {serve} from '../src/server.mjs';
import {backupRoot} from './backup.mjs';
import {restoreCombined,verifyCombined} from '../src/workspace-backup.mjs';
import {hash} from '../src/png.mjs';
import {journal,runChild,digest} from './img20-evidence.mjs';
import {recoverOperationalLock} from '../src/workspace.mjs';
const [configFile,output,control]=process.argv.slice(2);
const controls=['--authored-missing-marker','--authored-timeout','--authored-secondary'];
if(!path.isAbsolute(output??'')||fs.existsSync(output))throw Error('New absolute private output required');
fs.mkdirSync(output,{mode:0o700});
const log=journal(output),cleanup=[],abort=new AbortController();
let w,app,stream,timer,rl,phase='startup',last=performance.now(),maxGap=0,success=false,retainSuccess=false,interrupted=false;
const reply=x=>process.stdout.write(JSON.stringify(x)+'\n');
const sample=()=>{if(!stream||stream.destroyed)return;const n=performance.now();maxGap=Math.max(maxGap,n-last);last=n;stream.write(JSON.stringify({time:Date.now(),phase,...process.memoryUsage(),maxRssKiB:process.resourceUsage().maxRSS,gapMs:maxGap})+'\n');};
const interrupt=()=>{interrupted=true;abort.abort();rl?.close();process.stdin.destroy();};
process.on('SIGTERM',interrupt);process.on('SIGINT',interrupt);
process.stdout.on('error',e=>{log.fail(e);interrupt();log.attempt(()=>log.save('protocol-output-error'));process.exitCode=1;});
try{
  log.save('allocation');
  log.state.sourcePin=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
  if(control&&!controls.includes(control))throw Error('Unknown authored control');
  if(!path.isAbsolute(configFile??''))throw Error('Absolute config required');
  const config=JSON.parse(fs.readFileSync(configFile));
  if(config.disposableExperiment!==true||!Array.isArray(config.files)||config.files.length>13)throw Error('Disposable experiment declaration required');
  const allocation=path.join(output,'private-roots');fs.mkdirSync(allocation,{mode:0o700});
  log.state.roots.allocation=allocation;log.save('setup');
  // Fixture allocation is confined even if setup throws before it returns its roots.
  process.env.TMPDIR=allocation;process.env.TMP=allocation;process.env.TEMP=allocation;
  w=importSetup({after(fn){cleanup.push(fn);}},{experimentalPng20:true});
  Object.assign(log.state.roots,{runtime:w.runtime,business:w.root,source:w.sourceRoot});
  log.state.inputs=config.files.map(f=>({path:f.path,sha256:digest(fs.readFileSync(f.path)),declaredHash:f.sha256??null,width:f.width,height:f.height}));
  log.save('initialized');
for(const [i,f] of config.files.entries())fs.copyFileSync(f.path,path.join(w.sourceRoot,`image-${i+1}.png`));
const sourcePin=log.state.sourcePin;
stream=fs.createWriteStream(path.join(output,'internal-memory.ndjson'),{flags:'wx',mode:0o600});
stream.on('error',e=>{log.fail(e);interrupt();});
timer=setInterval(sample,20);sample();w.k.close();
app=await serve({root:w.runtime,port:0,imports:w.importOptions});w.k=app.kernel;
log.state.origin=app.origin;log.save('listening');
// This pipe is private and includes a bearer. The measurement controller excludes it from reports.
reply({sourcePin,pid:process.pid,origin:app.origin,credential:w.c.human,head:w.store.read().reference,productId:PRODUCT,runtime:w.runtime,sourceRoot:w.sourceRoot});
rl=readline.createInterface({input:process.stdin});
for await(const line of rl){
  if(interrupted)throw Object.assign(Error('Worker interrupted'),{code:'INTERRUPTED'});
  const message=JSON.parse(line);phase=message.op;sample();log.save(phase);
  if(message.op==='checkpoint'){log.save(message.phase,message.detail);reply({ok:true});continue;}
  if(message.op==='phase'){phase=message.name;reply({ok:true});}
  else if(message.op==='status'){
    const db=new DatabaseSync(path.join(w.runtime,'workspace.sqlite'),{readOnly:true});
    try{reply({sourcePin,counts:Object.fromEntries(['artifact','assetImport','importReceipt','job','assignment','iteration','request','round','sessionBinding','acceptance'].map(k=>[k,db.prepare('SELECT count(*) AS n FROM records WHERE kind=?').get(k).n])),originals:db.prepare('SELECT hash,length(data) AS bytes FROM bytes').all(),memory:process.memoryUsage(),maxRssKiB:process.resourceUsage().maxRSS,maxInternalGapMs:maxGap});}finally{db.close();}
  }else if(message.op==='backup-restore'){
    const start=performance.now(),backup=path.join(w.dir,'complete-backup');log.state.roots.backup=backup;log.save('backup-start');await backupRoot(w.runtime,backup);log.save('backup',{manifestSha256:digest(fs.readFileSync(path.join(backup,'combined-backup.json')))});const backed=performance.now();verifyCombined(backup);
    const businessRoot=path.join(w.dir,'separate-business'),runtimeRoot=path.join(w.dir,'separate-runtime'),paths=Object.fromEntries(Object.entries(w.store.workspace.paths).map(([k,v])=>[k,path.join(businessRoot,v)]));
    const restored=performance.now();log.state.roots.restoredBusiness=businessRoot;log.state.roots.restoredRuntime=runtimeRoot;log.save('restore-start');restoreCombined(backup,{businessRoot,runtimeRoot,paths});log.save('restore',{businessRoot,runtimeRoot});const finished=performance.now();
    const other=await serve({root:runtimeRoot,port:0});const rows=[];
    try{for(const a of other.kernel.read(w.c.human,'artifact')){
      const response=await fetch(other.origin+'/api/original?id='+a.id,{headers:{authorization:'Bearer '+w.c.human}});if(!response.ok)throw Error('Restored HTTP failure');const b=Buffer.from(await response.arrayBuffer());if(hash(b)!==a.sha256)throw Error('Restored hash mismatch');fs.writeFileSync(path.join(output,'restored-'+a.id+'.png'),b);rows.push({artifactId:a.id,sha256:hash(b),bytes:b.length});
    }}catch(e){log.fail(e);throw e;}finally{try{await other.stop();}catch(e){log.fail(e);if(!log.state.firstError)throw e;}}
    fs.copyFileSync(path.join(backup,'combined-backup.json'),path.join(output,'combined-backup-manifest.json'));
    log.save('restored-http',rows);reply({complete:true,backupMs:backed-start,verifyMs:restored-backed,restoreMs:finished-restored,restored:rows,domainHead:w.store.read().reference});
  }else if(message.op==='recovery'){
    const rows=[],ok=r=>{if(r.schemaVersion!=='3djat.result.v1')throw Error(JSON.stringify(r));return r;};
    for(const boundary of ['after-import-stage','after-import-verify','after-import-commit','during-import-export']){
      phase='recovery-'+boundary;sample();
      const stage=structuredClone(message.stagePacket);stage.key=randomUUID();stage.input.importId=randomUUID();let staged,commit,result;
      if(boundary!=='after-import-stage'){staged=ok(w.k.assetCommand(w.c.human,stage));commit=structuredClone(message.commitPacket);commit.key=randomUUID();commit.input.importId=stage.input.importId;commit.input.stageReceipt=staged.receipt;}
      if(boundary==='during-import-export')result=ok(w.k.assetCommand(w.c.human,commit));
      const packetFile=path.join(output,'recovery-'+boundary+'-packet.json');fs.writeFileSync(packetFile,JSON.stringify(commit??stage));await app.stop();
      log.state.expectedBoundary=boundary;log.save(phase+'-child-start');
      const childArgs=control?['test/fixtures/3djat/img20-negative-child.mjs',control]:['test/fixtures/3djat/img20-process.mjs',w.runtime,w.sourceRoot,packetFile,boundary,result?.reference.id??''];
      process.env.IMG20_SOURCE_PIN=sourcePin;
      const child=await runChild(childArgs,{timeoutMs:control==='--authored-timeout'?150:30000,signal:abort.signal,onStart:row=>{log.state.children.push(row);log.save(phase+'-child-owned');}});
      let marker;try{marker={status:'PRESENT',value:fs.readFileSync(packetFile+'.reached','utf8')};}catch(e){marker={status:e.code==='ENOENT'?'ABSENT':'READ ERROR',code:e.code};}
      child.marker=marker;child.boundary=boundary;child.reached=false;
      let childFailure;
      if(child.error||child.interrupted||child.timedOut||child.exit!=='CONFIRMED'||child.signal!=='SIGKILL'||marker.value!==boundary||child.stdout!==''){
        const code=child.error?.code??(child.interrupted?'INTERRUPTED':child.timedOut?'CHILD_TIMEOUT':child.stderr.includes('OPERATIONAL_LOCKED')?'OPERATIONAL_LOCKED':'BOUNDARY_NOT_REACHED');
        childFailure=Object.assign(Error('Recovery boundary NOT REACHED; inspect private child stderr/status'),{code});log.fail(childFailure);
      }
      log.attempt(()=>fs.writeFileSync(packetFile+'.stderr',child.stderr,{mode:0o600}));
      log.attempt(()=>fs.writeFileSync(packetFile+'.stdout',child.stdout,{mode:0o600}));
      log.attempt(()=>log.save(phase+'-child-exit'));
      if(childFailure)throw childFailure;
      if(log.state.firstError)throw Object.assign(Error('Child diagnostics failed; state retained'),{code:'DIAGNOSTIC_ERROR'});
      child.reached=true;
      const childMemory=JSON.parse(fs.readFileSync(packetFile+'.memory.json'));
      log.save(phase+'-reached',{boundary,memoryFile:packetFile+'.memory.json',sha256:digest(fs.readFileSync(packetFile+'.memory.json'))});
      const lock=path.join(w.root,'domain-write.lock');if(fs.existsSync(lock))w.store.recoverLock({expectedLockHash:hash(fs.readFileSync(lock)),confirmedQuiescent:true});
      const op=path.join(w.runtime,'operational-write.lock');if(fs.existsSync(op))recoverOperationalLock(w.runtime,{expectedLockHash:hash(fs.readFileSync(op)),confirmedQuiescent:true});
      app=await serve({root:w.runtime,port:0,imports:w.importOptions});w.k=app.kernel;
      staged=ok(w.k.assetCommand(w.c.human,stage));
      if(!commit){commit=structuredClone(message.commitPacket);commit.key=randomUUID();commit.input.importId=stage.input.importId;commit.input.stageReceipt=staged.receipt;}
      result??=ok(w.k.assetCommand(w.c.human,commit));if(JSON.stringify(w.k.assetCommand(w.c.human,commit))!==JSON.stringify(result))throw Error('Recovery replay mismatch');
      const response=await fetch(app.origin+'/api/original?id='+result.reference.id,{headers:{authorization:'Bearer '+w.c.human}}),raw=Buffer.from(await response.arrayBuffer());if(!response.ok||hash(raw)!==stage.input.sha256)throw Error('Recovered original mismatch');
      rows.push({boundary,confirmedExit:{status:child.status,signal:child.signal},reached:true,artifactId:result.reference.id,commit:result,outputAbsent:child.stdout==='',sha256:hash(raw),childMemory,externalProcessSampling:'NOT MEASURED; mounted process namespace mismatch',peakLimitation:'Child reports OS high-water at boundary before SIGKILL; no post-kill external peak'});
      fs.writeFileSync(path.join(output,'recovery-results.json'),JSON.stringify(rows,null,2)+'\n');log.save(phase+'-verified',rows.at(-1));
    }
    reply({rows,origin:app.origin});
  }else if(message.op==='stop'){success=true;retainSuccess=message.retainSuccess===true;reply({ok:true});break;}
  else throw Error('Unknown experiment control');
}
if(!success)throw Object.assign(Error('Protocol ended before successful stop'),{code:'INTERRUPTED'});
if(interrupted||log.state.firstError)throw Object.assign(Error('Worker interrupted or diagnostic stream failed'),{code:'INTERRUPTED'});
}catch(e){log.fail(e);}
finally{
  clearInterval(timer);rl?.close();
  log.attempt(()=>log.observe('before shutdown'));log.attempt(()=>log.save('shutdown'));
  try{await app?.stop();w?.k?.close();}catch(e){log.fail(e);}
  try{if(stream&&!stream.destroyed){sample();await new Promise((resolve,reject)=>{stream.once('error',reject);stream.end(resolve);});}}catch(e){log.fail(e);}
  if(control==='--authored-secondary'){
    log.attempt(()=>{const fd=fs.openSync(path.join(output,'authored-close-control'),'w',0o600);fs.closeSync(fd);fs.closeSync(fd);});
  }
  log.attempt(()=>log.observe('after shutdown'));
  if(success&&!log.state.firstError&&!retainSuccess){
    try{for(const fn of cleanup)fn();fs.rmdirSync(log.state.roots.allocation);log.state.cleanup='SUCCESS ROOTS REMOVED';}catch(e){log.fail(e);}
  }else log.state.cleanup=success&&!log.state.firstError?'SUCCESS ROOTS RETAINED BY CONTROLLER':'FAILED ROOTS RETAINED; deliberate owner cleanup only';
  log.state.status=log.state.firstError?(log.state.firstError.code==='OPERATIONAL_LOCKED'?'BLOCKED':log.state.firstError.code==='INTERRUPTED'?'INTERRUPTED':'FAILED'):'SUCCEEDED';
  if(log.state.children.some(c=>c.exit==='UNKNOWN'))log.state.status='UNKNOWN';
  log.attempt(()=>log.save('final'));
  if(log.state.firstError){
    if(log.state.status==='SUCCEEDED')log.state.status='FAILED';
    // Independent final path remains usable if checkpoint publication fails.
    log.attempt(()=>fs.writeFileSync(path.join(output,'failure.json'),JSON.stringify(log.state,null,2)+'\n',{mode:0o600}));
    reply({type:'failure',status:log.state.status,code:log.state.firstError.code,evidence:path.join(output,'lifecycle.json')});process.exitCode=1;
  }
  process.off('SIGTERM',interrupt);process.off('SIGINT',interrupt);
}
