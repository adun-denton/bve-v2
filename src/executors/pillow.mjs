import * as fs from 'node:fs';
import * as path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {RootGuard} from '../workspace.mjs';
import {verifyPNG} from '../png.mjs';
import {PNG_SERVICE,recipeHash,stable} from './png-recipes.mjs';
const worker=fileURLToPath(new URL('./pillow-worker.py',import.meta.url));
const sha=b=>createHash('sha256').update(b).digest('hex');
const fail=(code)=>{throw Object.assign(Error(code),{code});};
const check=(v,code)=>{if(!v)fail(code);};
const keys=['adapterId','pythonExecutable','pythonSha256','pythonVersion','pillowVersion','pillowCoreSha256','imageModuleSha256','zlibVersion','workerSha256','timeoutMs','logLimitBytes'];
export function serviceTool(config){
 check(config&&Object.keys(config).length===keys.length&&keys.every(k=>Object.hasOwn(config,k)),'INVALID_TOOL_CONFIGURATION');
 check(config.adapterId===PNG_SERVICE&&path.isAbsolute(config.pythonExecutable)&&!config.pythonExecutable.startsWith('\\\\'),'INVALID_TOOL_CONFIGURATION');
 for(const k of ['pythonSha256','pillowCoreSha256','imageModuleSha256','workerSha256'])check(/^[0-9a-f]{64}$/.test(config[k]),'INVALID_TOOL_PIN');
 for(const k of ['pythonVersion','pillowVersion','zlibVersion'])check(typeof config[k]==='string'&&/^[0-9][0-9a-z.+-]{0,49}$/i.test(config[k]),'INVALID_TOOL_PIN');
 check(Number.isInteger(config.timeoutMs)&&config.timeoutMs>=1&&config.timeoutMs<=120000&&Number.isInteger(config.logLimitBytes)&&config.logLimitBytes>=1024&&config.logLimitBytes<=131072,'INVALID_TOOL_LIMIT');
 return structuredClone(config);
}
const probeCode="import sys,json,hashlib,zlib;from pathlib import Path;from PIL import Image,_imaging,__version__;print(json.dumps({'pythonVersion':sys.version.split()[0],'pillowVersion':__version__,'pillowCoreSha256':hashlib.sha256(Path(_imaging.__file__).read_bytes()).hexdigest(),'imageModuleSha256':hashlib.sha256(Path(Image.__file__).read_bytes()).hexdigest(),'zlibVersion':zlib.ZLIB_VERSION}))";
function run(executable,args,{cwd,timeoutMs,logLimitBytes}){
 return new Promise(resolve=>{
  const startedAt=new Date().toISOString(),startedMonotonic=process.hrtime.bigint();let stdout=Buffer.alloc(0),stderr=Buffer.alloc(0),timedOut=false,overflow=false,spawnError=null;
  const child=spawn(executable,args,{cwd,windowsHide:true,shell:false,env:{SystemRoot:process.env.SystemRoot??'',WINDIR:process.env.WINDIR??'',PATH:path.dirname(executable),LANG:'C.UTF-8'}});
  const timer=setTimeout(()=>{timedOut=true;child.kill('SIGKILL');},timeoutMs);
  const collect=(name,b)=>{const previous=name==='stdout'?stdout:stderr;if(previous.length+b.length>logLimitBytes){overflow=true;child.kill('SIGKILL');}const next=Buffer.concat([previous,b]).subarray(0,logLimitBytes);if(name==='stdout')stdout=next;else stderr=next;};
  child.stdout.on('data',b=>collect('stdout',b));child.stderr.on('data',b=>collect('stderr',b));child.on('error',e=>{spawnError=e.code??'SPAWN_ERROR';});
  // A delayed event loop can dispatch close before the timeout callback. Keep the deadline conservative.
  child.on('close',(exitCode,signal)=>{clearTimeout(timer);timedOut=timedOut||Number(process.hrtime.bigint()-startedMonotonic)/1e6>timeoutMs;resolve({pid:child.pid??null,startedAt,finishedAt:new Date().toISOString(),exitCode,signal,timedOut,overflow,spawnError,closed:true,stdout:stdout.toString('utf8'),stderr:stderr.toString('utf8')});});
 });
}
export async function inspectPillow(pythonExecutable,{timeoutMs=30000,logLimitBytes=65536}={}){
 check(path.isAbsolute(pythonExecutable)&&!fs.lstatSync(pythonExecutable).isSymbolicLink(),'INVALID_TOOL_CONFIGURATION');
 const measured=await run(pythonExecutable,['-I','-B','-c',probeCode],{timeoutMs,logLimitBytes});
 check(measured.exitCode===0&&!measured.timedOut&&!measured.overflow&&!measured.spawnError,'CAPABILITY_UNAVAILABLE');
 const versions=JSON.parse(measured.stdout);
 return serviceTool({adapterId:PNG_SERVICE,pythonExecutable,pythonSha256:sha(fs.readFileSync(pythonExecutable)),...versions,workerSha256:sha(fs.readFileSync(worker)),timeoutMs,logLimitBytes});
}
export async function verifyTool(config){
 config=serviceTool(config);
 check(fs.existsSync(config.pythonExecutable)&&!fs.lstatSync(config.pythonExecutable).isSymbolicLink()&&sha(fs.readFileSync(config.pythonExecutable))===config.pythonSha256&&sha(fs.readFileSync(worker))===config.workerSha256,'TOOL_PIN_MISMATCH');
 const measured=await inspectPillow(config.pythonExecutable,{timeoutMs:Math.max(config.timeoutMs,5000),logLimitBytes:config.logLimitBytes});
 for(const key of keys.filter(k=>!['timeoutMs','logLimitBytes'].includes(k)))check(measured[key]===config[key],'TOOL_PIN_MISMATCH');
 return config;
}
function write(guard,name,bytes,max=24*1024**2){
 check(bytes.length<=max,'STAGING_LIMIT');const file=guard.locate(name);
 if(fs.existsSync(file)&&['scene.png','logo.png','command.json'].includes(name)){check(guard.read(name,max).equals(bytes),'STAGING_MISMATCH');return;}
 const fd=fs.openSync(file,fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_WRONLY|(fs.constants.O_NOFOLLOW??0),0o600);
 try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}guard.locate(name);guard.sync();
}
function stageGuard(context,{create=false}={}){
 const root=new RootGuard(context.root),relative='ServiceExecutions/'+context.assignmentId;
 const target=root.locate(relative,{directory:true,create});return new RootGuard(target);
}
function commandFor(context){return {assignmentId:context.assignmentId,attemptId:context.attemptId,recipeHash:recipeHash(context.specification.recipe),recipe:context.specification.recipe};}

export function readServiceClosure(context){
 const guard=stageGuard(context);
 let raw;try{raw=guard.read('process.json',1024**2);}catch(e){if(e.code==='ENOENT')return null;throw e;}
 const p=JSON.parse(raw);if(p.closed!==true)return null;
 const base=['pid','startedAt','finishedAt','exitCode','signal','timedOut','overflow','spawnError','closed','stdout','stderr'];
 const bound=Object.hasOwn(p,'assignmentId')||Object.hasOwn(p,'attemptId');
 check(Object.keys(p).length===base.length+(bound?2:0)&&base.every(k=>Object.hasOwn(p,k)),'INVALID_PROCESS_CLOSURE');
 check(!bound||p.assignmentId===context.assignmentId&&p.attemptId===context.attemptId,'PROCESS_ATTEMPT_MISMATCH');
 const time=x=>typeof x==='string'&&Number.isFinite(Date.parse(x))&&new Date(x).toISOString()===x;
 check(Number.isSafeInteger(p.pid)&&p.pid>0&&time(context.startedAt)&&time(p.startedAt)&&time(p.finishedAt)&&p.startedAt>=context.startedAt&&p.finishedAt>=p.startedAt,'INVALID_PROCESS_CLOSURE');
 check((Number.isInteger(p.exitCode)||p.exitCode===null)&&(p.signal===null||typeof p.signal==='string'&&/^[A-Z0-9]{1,32}$/.test(p.signal))&&(p.exitCode!==null||p.signal!==null),'INVALID_PROCESS_CLOSURE');
 check(typeof p.timedOut==='boolean'&&typeof p.overflow==='boolean'&&(p.spawnError===null||typeof p.spawnError==='string'&&p.spawnError.length<=100),'INVALID_PROCESS_CLOSURE');
 for(const k of ['stdout','stderr'])check(typeof p[k]==='string'&&Buffer.byteLength(p[k])<=3*context.tool.logLimitBytes,'INVALID_PROCESS_CLOSURE');
 // Legacy host receipts are bound by the private assigned path and the exact
 // frozen command beside them. New receipts additionally carry both attempt IDs.
 check(stable(JSON.parse(guard.read('command.json')))===stable(commandFor(context)),'STAGING_MISMATCH');
 return {source:{path:'ServiceExecutions/'+context.assignmentId+'/process.json',sha256:sha(raw),bytes:raw.length},
  process:{assignmentId:context.assignmentId,attemptId:context.attemptId,pid:p.pid,startedAt:p.startedAt,finishedAt:p.finishedAt,exitCode:p.exitCode,signal:p.signal,closed:true,binding:bound?'process-record':'assigned-staging'}};
}

function readResult(context){
 const guard=stageGuard(context),command=commandFor(context),stored=JSON.parse(guard.read('command.json'));
 check(stable(stored)===stable(command),'STAGING_MISMATCH');
 const r=JSON.parse(guard.read('receipt.json')),recipe=command.recipe;
 check(r.assignmentId===context.assignmentId&&r.attemptId===context.attemptId&&r.recipeHash===command.recipeHash&&r.exitCode===0,'OUTPUT_RECEIPT_MISMATCH');
 check(r.python===context.tool.pythonVersion&&r.version===context.tool.pillowVersion&&r.zlib===context.tool.zlibVersion&&stable(r.profile)===stable(recipe.output),'OUTPUT_RECEIPT_MISMATCH');
 const refs=[['scene.png',recipe.scene],...(recipe.logo?[['logo.png',recipe.logo]]:[])];
 for(const [name,ref] of refs){const b=guard.read(name,24*1024**2);check(sha(b)===ref.sha256,'STAGED_INPUT_CHANGED');}
 check(stable(r.inputHashes)===stable(refs.map(([,ref])=>ref.sha256)),'OUTPUT_RECEIPT_MISMATCH');
 const bytes=guard.read('output.png',24*1024**2),v=verifyPNG(bytes);
 check(v.sha256===r.outputSha256&&v.width===recipe.output.width&&v.height===recipe.output.height&&r.width===v.width&&r.height===v.height,'OUTPUT_MISMATCH');
 const closure=readServiceClosure(context);
 return {outcome:'success',bytes:bytes.toString('base64'),evidence:{kind:'host',executorKind:'service',executor:PNG_SERVICE,tool:'Pillow',version:r.version,model:null,cost:null,usage:null,recipeHash:command.recipeHash,recipe,toolPins:context.tool,receipt:r},quiescent:!!closure};
}
function reportResult(kernel,context,producerOutcome,quiescent){
 const assignment=kernel.assignment(context.token),state=assignment.state;check(['succeeded','failed'].includes(state),'INTAKE_UNRESOLVED');
 const expected={status:state==='succeeded'?'produced':'failed',text:'Conventional service returned '+producerOutcome+'; independent intake determines artifact validity.',quiescent};
 const original=assignment.resultReport;
 check(!original||original.status===expected.status&&original.text===expected.text,'RESULT_REPORT_MISMATCH');
 // Replay the original payload byte-for-byte, including its original uncertainty.
 kernel.serviceCall(context.token,'service.report','report:'+context.assignmentId,original??expected);
 if(quiescent&&!kernel.assignment(context.token).processQuiescent){
  const closure=readServiceClosure(context);check(closure,'PROCESS_CLOSURE_UNKNOWN');
  kernel.serviceCall(context.token,'service.quiescence','quiescence:'+context.assignmentId,{processSha256:closure.source.sha256});
 }
 return state==='succeeded'?'success':'failure';
}
export async function dispatchPNGServices(kernel,owner,jobIds,{hook=()=>{}}={}){
 check(Array.isArray(jobIds)&&jobIds.length>=1&&jobIds.length<=6&&new Set(jobIds).size===jobIds.length,'INVALID_BATCH');
 const outcomes=[];
 for(const jobId of jobIds){
  const context=kernel.serviceAssignment(owner,jobId),token=context.token;
  if(context.state!=='assigned'){outcomes.push({jobId,state:context.state,skipped:true});continue;}
  let started=false,processReceipt=null;
  try{
   await verifyTool(context.tool);
   const guard=stageGuard(context,{create:true}),command=commandFor(context),inputs=kernel.serviceInputs(token);
   for(const [name,ref] of [['scene.png',command.recipe.scene],...(command.recipe.logo?[['logo.png',command.recipe.logo]]:[])]){
    const b=inputs.find(x=>x.reference.artifactId===ref.artifactId)?.bytes;check(b&&sha(b)===ref.sha256,'INPUT_HASH_MISMATCH');const v=verifyPNG(b);check(v.width===ref.width&&v.height===ref.height,'INPUT_MISMATCH');write(guard,name,b);
   }
   write(guard,'command.json',Buffer.from(stable(command)+'\n'),1024**2);
   hook('before-start',{jobId,context});
   kernel.serviceCall(token,'service.start','start:'+context.assignmentId,{});started=true;
   context.startedAt=kernel.assignment(token).startedAt;
   // Recheck fixed executable, worker and staged bytes immediately before dispatch.
   check(sha(fs.readFileSync(context.tool.pythonExecutable))===context.tool.pythonSha256&&sha(fs.readFileSync(worker))===context.tool.workerSha256,'TOOL_PIN_MISMATCH');
   for(const x of inputs)check(sha(x.bytes)===x.reference.sha256,'INPUT_HASH_MISMATCH');
   hook('before-process',{jobId,context});
   processReceipt=await run(context.tool.pythonExecutable,['-I','-B',worker],{cwd:guard.root,timeoutMs:context.tool.timeoutMs,logLimitBytes:context.tool.logLimitBytes});
   write(guard,'process.json',Buffer.from(JSON.stringify({...processReceipt,assignmentId:context.assignmentId,attemptId:context.attemptId})+'\n'),1024**2);
   hook('after-process',{jobId,context,processReceipt});
   if(processReceipt.timedOut||processReceipt.overflow||processReceipt.spawnError)fail(processReceipt.timedOut?'TOOL_TIMEOUT':'TOOL_PROCESS_UNCERTAIN');
   let delivery;
   if(processReceipt.exitCode!==0)delivery={outcome:'failure',evidence:{kind:'host',executorKind:'service',executor:PNG_SERVICE,model:null,cost:null,usage:null,recipeHash:command.recipeHash,recipe:command.recipe,toolPins:context.tool,process:processReceipt}};
   else delivery=readResult(context);
   kernel.call(token,'result.deliver','delivery:'+context.assignmentId,{assignmentId:context.assignmentId,...delivery});
   kernel.reconcile(owner.butler);
   const outcome=reportResult(kernel,context,delivery.outcome,true);
   outcomes.push({jobId,...delivery,outcome,bytes:undefined});
  }catch(e){
   // Another explicit dispatcher may have won the durable start while our probe awaited.
   if(!started&&kernel.serviceAssignment(owner,jobId).startedAt){outcomes.push({jobId,skipped:true,reason:'Existing attempt must not be reinvoked'});continue;}
   const evidence={kind:'host',executorKind:'service',executor:PNG_SERVICE,model:null,cost:null,usage:null,error:e.code??e.message,recipeHash:recipeHash(context.specification.recipe),process:processReceipt};
   if(started)kernel.call(token,'result.deliver','uncertain:'+context.assignmentId,{assignmentId:context.assignmentId,outcome:'uncertain',evidence});
   kernel.serviceCall(token,'service.report','diagnostic:'+context.assignmentId+':'+(e.code??'ERROR'),{status:started?'uncertain':'blocked',text:'Conventional service '+(started?'outcome uncertain: ':'blocked before invocation: ')+(e.code??e.message),quiescent:!started||processReceipt?.closed===true});
   outcomes.push({jobId,outcome:started?'uncertain':'blocked',evidence});
  }
 }
 return {outcomes};
}
export function reconcilePNGService(kernel,owner,jobId){
 const context=kernel.serviceAssignment(owner,jobId);check(context.startedAt,'ATTEMPT_NOT_STARTED');
 const result=readResult(context);
 const delivered=kernel.call(context.token,'result.deliver','delivery:'+context.assignmentId,{assignmentId:context.assignmentId,...result});
 kernel.reconcile(owner.butler);
 reportResult(kernel,context,'success',result.quiescent);
 return delivered;
}
