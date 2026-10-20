// Internal file authority primitives shared by narrow domain writers. No command router.
import * as fs from 'node:fs';
import * as path from 'node:path';
import {createHash,createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import {StoreError} from './domain-store.mjs';
import {validate} from './contracts/3djat.mjs';
export const stable=x=>JSON.stringify(x,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
export const digest=x=>createHash('sha256').update(x).digest('hex');
export const uuid=x=>{const h=digest(x);return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`;};
export const bytes=x=>Buffer.from(stable(x)+'\n');
export const equal=(a,b)=>stable(a)===stable(b);
export const same=(a,b)=>a?.id===b?.id&&a?.revision===b?.revision&&a?.sha256===b?.sha256&&a?.path===b?.path;
export const fail=(code,detail={})=>{throw new StoreError(code,detail);};
export const check=(ok,code,detail)=>{if(!ok)fail(code,detail);};
export const shape=(kind,v)=>{const r=validate(kind,v);if(!r.ok)fail(r.errors[0].code,{errors:r.errors});};
export const exact=(v,keys)=>check(v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k)),'INVALID_VALUE');
export const within=(a,b)=>{const r=path.relative(a,b);return r===''||r!=='..'&&!r.startsWith('..'+path.sep)&&!path.isAbsolute(r);};
export function safePrivate(file,{missing=false}={}){
  check(typeof file==='string'&&path.isAbsolute(file)&&!file.startsWith('\\\\')&&!file.startsWith('//'),'UNSAFE_PATH');
  const full=path.resolve(file),parts=full.slice(path.parse(full).root.length).split(path.sep);let current=path.parse(full).root;
  for(let i=0;i<parts.length;i++){
    current=path.join(current,parts[i]);let s;try{s=fs.lstatSync(current);}catch(e){if(e.code==='ENOENT'&&missing&&i===parts.length-1)return full;throw e;}
    check(!s.isSymbolicLink()&&fs.readdirSync(path.dirname(current)).includes(parts[i]),'UNSAFE_PATH');
    check(i===parts.length-1?s.isFile()&&s.nlink===1:s.isDirectory(),'UNSAFE_PATH');
  }return full;
}
export function syncDir(dir){let fd;try{fd=fs.openSync(dir,'r');fs.fsyncSync(fd);}catch(e){if(!(process.platform==='win32'&&['EPERM','EACCES','EINVAL','EISDIR','ENOTSUP'].includes(e.code)))throw e;}finally{if(fd!==undefined)fs.closeSync(fd);}}
export function privateRead(file){safePrivate(file);check(fs.statSync(file).size<=65536,'VALIDATION_LIMIT');const b=fs.readFileSync(file);check(b.length<=65536,'VALIDATION_LIMIT');try{return JSON.parse(b);}catch{fail('INVALID_VALUE');}}
export function exclusive(file,value){const b=bytes(value);check(b.length<=65536,'VALIDATION_LIMIT');const fd=fs.openSync(safePrivate(file,{missing:true}),'wx',0o600);try{fs.writeFileSync(fd,b);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}syncDir(path.dirname(file));}
export function access(file){const a=privateRead(file);exact(a,['schemaVersion','workspaceId','key','principals']);check(['3djat.product-access.v1','3djat.product-access.v2'].includes(a.schemaVersion)&&/^[0-9a-f]{64}$/.test(a.key)&&Array.isArray(a.principals)&&a.principals.length<=32,'INVALID_VALUE');
  for(const p of a.principals){exact(p,['id','role','tokenHash','products','sourceIds',...(a.schemaVersion==='3djat.product-access.v2'?['templateGrant']:[])]);check(['human','source-proposer','conductor'].includes(p.role)&&/^[0-9a-f]{64}$/.test(p.tokenHash),'INVALID_SCOPE');shape('revision-ref',{id:p.id,revision:1,path:'principal.json',sha256:p.tokenHash});check((p.products==='*'||Array.isArray(p.products)&&p.products.length<=256)&&Array.isArray(p.sourceIds)&&p.sourceIds.length<=32,'INVALID_VALUE');if(a.schemaVersion==='3djat.product-access.v2')templateGrant(p.templateGrant);}
  check(new Set(a.principals.map(p=>p.id)).size===a.principals.length,'INVALID_VALUE');return a;
}
export function identifier(value){shape('revision-ref',{id:value,revision:1,path:'scope.json',sha256:'0'.repeat(64)});}
function ids(values,max){check(Array.isArray(values)&&values.length<=max&&new Set(values).size===values.length,'INVALID_VALUE');for(const x of values)identifier(x);}
export function templateGrant(g){if(g===null)return;exact(g,['templateIds','appliesTo','operations','sourceIds']);ids(g.templateIds,24);ids(g.appliesTo,24);ids(g.sourceIds,32);check(Array.isArray(g.operations)&&g.operations.length<=3&&new Set(g.operations).size===g.operations.length&&g.operations.every(x=>['read','ingest','adopt'].includes(x)),'INVALID_VALUE');}
export function findBearer(a,token){check(typeof token==='string'&&/^[0-9a-f]{64}$/.test(token),'INVALID_SCOPE');const h=Buffer.from(digest(token));return a.principals.find(x=>timingSafeEqual(Buffer.from(x.tokenHash),h));}
export function signAction(a,role,event){return createHmac('sha256',a.key).update(stable({role,event})).digest('hex');}
export function verifyAction(a,role,event,mac){check(typeof mac==='string'&&/^[0-9a-f]{64}$/.test(mac)&&timingSafeEqual(Buffer.from(mac),Buffer.from(signAction(a,role,event))),'EVIDENCE_MISMATCH');}
export function reserveIntent(file,p,packet,{inclusive=true}={}){
 const dir=file+'.intents';if(!fs.existsSync(dir)){fs.mkdirSync(dir,{mode:0o700});syncDir(path.dirname(dir));}
 const stat=fs.lstatSync(dir);check(stat.isDirectory()&&!stat.isSymbolicLink(),'UNSAFE_PATH');
 // Product legacy precheck deliberately unchanged. New template intents replay first.
 if(!inclusive)check(fs.readdirSync(dir).length<=512,'VALIDATION_LIMIT');
 const filename=path.join(dir,digest(stable([p.id,packet.operation,packet.key]))+'.json'),payloadHash=digest(stable(packet));
 if(inclusive&&!fs.existsSync(filename))check(fs.readdirSync(dir).length<512,'VALIDATION_LIMIT');
 try{exclusive(filename,{payloadHash,createdAt:new Date().toISOString()});}catch(e){if(e.code!=='EEXIST')throw e;}
 if(inclusive)check(fs.statSync(safePrivate(filename)).size<=4096,'VALIDATION_LIMIT');
 const i=privateRead(filename);exact(i,['payloadHash','createdAt']);check(i.payloadHash===payloadHash,'IDEMPOTENCY_CONFLICT');return i;
}
// Trusted quiescent filesystem owner only. Never callable through an AI/HTTP route.
export function configureTemplateGrant(file,{workspaceId,principalId,role,grant,expectedSha256,confirmedQuiescent}){
 check(confirmedQuiescent===true,'INVALID_SCOPE');templateGrant(grant);safePrivate(file);const before=fs.readFileSync(file);check(digest(before)===expectedSha256,'REVISION_CONFLICT');
 const a=access(file);check(a.workspaceId===workspaceId,'INVALID_SCOPE');const p=a.principals.find(x=>x.id===principalId&&x.role===role);check(p,'INVALID_SCOPE');
 const backupFile=file+'.before-template-'+digest(before)+'.json';
 if(fs.existsSync(backupFile))check(fs.readFileSync(safePrivate(backupFile)).equals(before),'EVIDENCE_MISMATCH');
 else{const fd=fs.openSync(safePrivate(backupFile,{missing:true}),'wx',0o600);try{fs.writeFileSync(fd,before);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}syncDir(path.dirname(file));}
 check(fs.readFileSync(safePrivate(backupFile)).equals(before),'HASH_MISMATCH');
 if(a.schemaVersion==='3djat.product-access.v1'){a.schemaVersion='3djat.product-access.v2';for(const x of a.principals)x.templateGrant=null;}
 p.templateGrant=structuredClone(grant);const temp=file+'.'+randomBytes(8).toString('hex');exclusive(temp,a);access(temp);
 check(digest(fs.readFileSync(safePrivate(file)))===expectedSha256,'REVISION_CONFLICT');fs.renameSync(temp,file);syncDir(path.dirname(file));
 check(equal(access(file),a),'HASH_MISMATCH');return {backupFile,sha256:digest(fs.readFileSync(file))};
}
