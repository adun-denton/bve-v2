// Trusted local setup/integration. Business authority remains in DomainStore.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { DomainStore, STORE_LIMITS, StoreError } from './domain-store.mjs';
import { validate, validateCommand } from './contracts/3djat.mjs';
export const sha = b => createHash('sha256').update(b).digest('hex');
export const sameRef = (a,b) => a?.id===b?.id && a?.revision===b?.revision && a?.path===b?.path && a?.sha256===b?.sha256;
export const fail = (code,detail={}) => { throw new StoreError(code,detail); };
export const check = (ok,code,detail) => { if(!ok)fail(code,detail); };
export const jsonBytes = x => Buffer.from(JSON.stringify(x)+'\n');
export function valid(kind,value) { const r=validate(kind,value);check(r.ok,'INVALID_RECORD',{kind,errors:r.errors}); }
const exact = (v,names) => check(v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===names.length&&names.every(k=>Object.hasOwn(v,k)),'INVALID_METADATA');
export function canonicalRoot(value,{missing=false}={}) {
  check(typeof value==='string'&&path.isAbsolute(value)&&!value.startsWith('\\\\')&&!value.startsWith('//'),'EXPLICIT_ROOT_REQUIRED');
  const resolved=path.resolve(value), parsed=path.parse(resolved);let current=parsed.root;
  for(const part of resolved.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current=path.join(current,part);
    if(!fs.existsSync(current)) { try{check(!fs.lstatSync(current).isSymbolicLink(),'UNSAFE_PATH');}catch(e){if(e.code!=='ENOENT')throw e;}
      check(missing&&current===resolved&&fs.existsSync(path.dirname(current)),'MISSING_ROOT');valid('revision-ref',{id:'new-root',revision:1,path:path.basename(resolved),sha256:'0'.repeat(64)});return resolved; }
    check(!fs.lstatSync(current).isSymbolicLink(),'UNSAFE_PATH');
    check(fs.readdirSync(path.dirname(current)).includes(part),'PATH_CASE_MISMATCH');
  }
  check(fs.statSync(resolved).isDirectory(),'UNSAFE_PATH');return fs.realpathSync.native(resolved);
}
export function contains(parent,child) { const r=path.relative(parent,child);return r===''||r!=='..'&&!r.startsWith('..'+path.sep)&&!path.isAbsolute(r); }
export class RootGuard {
  constructor(root) { this.root=canonicalRoot(root);this.identity=fs.statSync(this.root); }
  assert() { const s=fs.statSync(this.root);check(s.dev===this.identity.dev&&s.ino===this.identity.ino&&fs.realpathSync.native(this.root)===this.root,'ROOT_CHANGED'); }
  locate(relative,{directory=false,create=false}={}) {
    valid('revision-ref',{id:'path-check',revision:1,path:relative,sha256:'0'.repeat(64)});this.assert();let current=this.root;
    const parts=relative.split('/');for(let i=0;i<parts.length;i++) {
      current=path.join(current,parts[i]);const dir=i<parts.length-1||directory;
      let s;try{s=fs.lstatSync(current);}catch(e){if(e.code!=='ENOENT')throw e;if(create&&dir){fs.mkdirSync(current,{mode:0o700});this.sync(path.dirname(current));s=fs.lstatSync(current);}else continue;}
      check(!s.isSymbolicLink()&&s.dev===this.identity.dev&&(dir?s.isDirectory():s.isFile()&&s.nlink===1),'UNSAFE_PATH');
      check(contains(this.root,fs.realpathSync.native(current)),'UNSAFE_PATH');check(fs.readdirSync(path.dirname(current)).includes(parts[i]),'PATH_CASE_MISMATCH');
    }return current;
  }
  sync(directory=this.root) {let fd;try{fd=fs.openSync(directory,'r');fs.fsyncSync(fd);}catch(e){if(!(process.platform==='win32'&&['EPERM','EACCES','EINVAL','EISDIR','ENOTSUP'].includes(e.code)))throw e;}finally{if(fd!==undefined)fs.closeSync(fd);}}
  read(relative,max=STORE_LIMITS.fileBytes) {
    let fd;try{fd=fs.openSync(this.locate(relative),fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW??0));const s=fs.fstatSync(fd);check(s.isFile()&&s.nlink===1&&s.size<=max,'OVERSIZE');
      const b=Buffer.alloc(s.size+1);let n=0,k;while(n<b.length&&(k=fs.readSync(fd,b,n,b.length-n,n))>0)n+=k;
      const after=fs.fstatSync(fd);check(n===s.size&&after.size===s.size&&after.mtimeMs===s.mtimeMs,'FILE_CHANGED');this.locate(relative);return b.subarray(0,n);
    }finally{if(fd!==undefined)fs.closeSync(fd);}
  }
  write(relative,b) {check(b.length<=STORE_LIMITS.fileBytes,'OVERSIZE');const file=this.locate(relative,{create:true});const fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|(fs.constants.O_NOFOLLOW??0),0o600);
    try{fs.writeFileSync(fd,b);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}this.locate(relative);this.sync(path.dirname(file)); }
}
export function acquireOperational(root) {
  const guard=new RootGuard(root), b=jsonBytes({schemaVersion:'3djat.operational-lock.v1',nonce:randomUUID(),pid:process.pid});
  try{guard.write('operational-write.lock',b);}catch(e){if(e.code==='EEXIST')fail('OPERATIONAL_LOCKED');throw e;}
  return ()=>{check(guard.read('operational-write.lock').equals(b),'LOCK_CHANGED');fs.unlinkSync(guard.locate('operational-write.lock'));guard.sync();};
}
export function recoverOperationalLock(root,{expectedLockHash,confirmedQuiescent}) {
  check(confirmedQuiescent===true,'QUIESCENCE_REQUIRED');const g=new RootGuard(root),b=g.read('operational-write.lock');check(sha(b)===expectedLockHash,'LOCK_CHANGED');
  g.write(`Recovery/${randomUUID()}/operational-lock.json`,b);check(sha(g.read('operational-write.lock'))===expectedLockHash,'LOCK_CHANGED');fs.unlinkSync(g.locate('operational-write.lock'));g.sync();
}
export function integrationRow(db) {
  const r=db.prepare("SELECT doc FROM records WHERE kind='domainIntegration' AND id='active'").get();if(!r)return null;
  const v=JSON.parse(r.doc);exact(v,['id','schemaVersion','config','adoptionRevision']);check(v.schemaVersion==='3djat.integration.v1','UNSUPPORTED_SCHEMA');
  check(v.id==='active','REFERENCE_IDENTITY');check(Number.isSafeInteger(v.adoptionRevision)&&v.adoptionRevision>=0&&v.adoptionRevision<=2147483647,'INVALID_METADATA');return v;
}
export function verifyCredentials(bytes) {
  let value;try{value=JSON.parse(bytes);}catch{fail('CORRUPT_CREDENTIALS');}
  check(value&&Object.keys(value).length===4&&['human','conductor','generator','butler'].every(k=>typeof value[k]==='string'&&/^[0-9a-f]{64}$/.test(value[k]))&&new Set(Object.values(value)).size===4,'CORRUPT_CREDENTIALS');
}
export function inspectRuntime(root) {
  if(!fs.existsSync(root))return {version:0,integration:null,hasRecords:false};const g=new RootGuard(root);check(!fs.existsSync(g.locate('restore-in-progress.json')),'RESTORE_INCOMPLETE');const marker=path.join(root,'bve-v2-root.json');
  if(!fs.existsSync(marker))return {version:0,integration:null,hasRecords:false};
  const m=JSON.parse(g.read('bve-v2-root.json'));check(m.format==='bve-v2'&&m.version===1,'UNSUPPORTED_SCHEMA');
  check(fs.existsSync(g.locate('workspace.sqlite')),'MISSING_OPERATIONAL_DATABASE');
  const db=new DatabaseSync(g.locate('workspace.sqlite'),{readOnly:true});try {
    const version=db.prepare('PRAGMA user_version').get().user_version;check(version===0||version===1,'UNSUPPORTED_SCHEMA');
    const integration=integrationRow(db);check(version===0?!integration:!!integration,'INCOMPLETE_CONNECTION');if(integration){check(fs.existsSync(g.locate('credentials.json')),'MISSING_CREDENTIALS');verifyCredentials(g.read('credentials.json'));}
    return {version,integration,hasRecords:!!db.prepare('SELECT 1 FROM records LIMIT 1').get()};
  }finally{db.close();}
}
export function databaseFingerprint(db) {
  const h=createHash('sha256');let count=0;
  for(const query of ['SELECT kind,id,doc FROM records ORDER BY kind,id','SELECT scope,key,fingerprint,doc FROM receipts ORDER BY scope,key','SELECT hash,data FROM bytes ORDER BY hash']) {
    h.update(query);for(const row of db.prepare(query).iterate()) {check(++count<=100000,'CAPACITY');for(const v of Object.values(row)){const b=typeof v==='string'?Buffer.from(v):Buffer.from(v);check(b.length<=48*1024**2,'OVERSIZE');h.update(String(b.length)+':');h.update(b);}}
  }return h.digest('hex');
}
export function verifyLegacyMigration(root,backupRoot,confirmedQuiescent) {
  check(confirmedQuiescent===true&&typeof backupRoot==='string','MIGRATION_REQUIRES_BACKUP');const a=new RootGuard(root),b=new RootGuard(backupRoot);
  check(!contains(a.root,b.root)&&!contains(b.root,a.root),'PATH_OVERLAP');check(a.read('credentials.json').equals(b.read('credentials.json'))&&a.read('bve-v2-root.json').equals(b.read('bve-v2-root.json')),'BACKUP_MISMATCH');
  const source=new DatabaseSync(a.locate('workspace.sqlite'),{readOnly:true}),copy=new DatabaseSync(b.locate('workspace.sqlite'),{readOnly:true});
  try{check(source.prepare('PRAGMA user_version').get().user_version===0&&copy.prepare('PRAGMA user_version').get().user_version===0,'BACKUP_MISMATCH');check(source.prepare('PRAGMA page_count').get().page_count*source.prepare('PRAGMA page_size').get().page_size<=1024**3,'CAPACITY');check(copy.prepare('PRAGMA integrity_check').get().integrity_check==='ok'&&databaseFingerprint(source)===databaseFingerprint(copy),'BACKUP_MISMATCH');}finally{source.close();copy.close();}
}
export class WorkspaceConnection {
  constructor(runtimeRoot,config,{existing=false}={}) {
    exact(config,['schemaVersion','workspaceId','domainRoot','runtimeRoot','paths','storage']);check(config.schemaVersion==='3djat.connection.v1','UNSUPPORTED_SCHEMA');
    check(config.storage==='local-unsynced','LOCAL_STORAGE_REQUIRED');check(canonicalRoot(runtimeRoot,{missing:true})===canonicalRoot(config.runtimeRoot,{missing:true}),'ROOT_CONFLICT');
    this.config=structuredClone(config);this.root=canonicalRoot(runtimeRoot,{missing:true});this.runtimeGuard=null;this.store=null;this.failure=null;
    try {this.store=new DomainStore(canonicalRoot(config.domainRoot),{workspaceId:config.workspaceId});
      check(!contains(this.store.root,this.root)&&!contains(this.root,this.store.root),'PATH_OVERLAP');
      exact(config.paths,['business','products','templates','operations']);const folders=[];
      for(const [key,relative] of Object.entries(this.store.workspace.paths)) {
        check(!/^(Domain|Heads|Receipts|Staging|Recovery)(\/|$)/i.test(relative),'PATH_CONFLICT');
        const folder=canonicalRoot(config.paths[key]);check(folder===path.join(this.store.root,...relative.split('/')),'PATH_CONFLICT');folders.push(folder);
      }
      check(folders.every((x,i)=>folders.every((y,j)=>i===j||!contains(x,y))),'PATH_OVERLAP');this.domainGuard=new RootGuard(this.store.root);
      this.store.read();
    }catch(e){if(!existing||!['ENOENT','MISSING_ROOT','MISSING_REFERENCE','HASH_MISMATCH','INVALID_JSON','REFERENCE_IDENTITY','STORE_CHANGED','OVERSIZE'].includes(e.code))throw e;this.failure=e.code;}
  }
  assertRuntime() {this.runtimeGuard??=new RootGuard(this.root);this.runtimeGuard.assert();}
  read() {this.assertRuntime();if(this.failure)fail('DOMAIN_UNAVAILABLE',{cause:this.failure});return this.store.read();}
  lockDomain() {if(this.failure)fail('DOMAIN_UNAVAILABLE',{cause:this.failure});const b=this.store.lock(this.config.workspaceId);return ()=>this.store.unlock(b);}
  folder(project,{create=false}={}) {
    this.assertRuntime();if(project.domainWorkspaceId) {
      check(project.domainWorkspaceId===this.config.workspaceId,'WORKSPACE_MISMATCH');if(this.failure)fail('DOMAIN_UNAVAILABLE',{cause:this.failure});
      return this.domainGuard.locate(`${this.store.workspace.paths.products}/${project.id}`,{directory:true,create});
    }
    return this.runtimeGuard.locate(`Projects/${project.id}`,{directory:true,create});
  }
}
export function projection(view) {
  return {id:view.head.workspaceId,schemaVersion:'3djat.projection.v1',head:view.reference,
    products:view.head.products.map(x=>({reference:x.dossier,record:view.records.get(x.dossier.path).value})),
    templates:view.head.templates.map(r=>({reference:r,record:view.records.get(r.path).value})),
    business:view.head.business?{reference:view.head.business,record:view.records.get(view.head.business.path).value}:null};
}
export function putProjection(db,view) {const p=projection(view);db.prepare("INSERT INTO records VALUES('domainProjection',?,?) ON CONFLICT(kind,id) DO UPDATE SET doc=excluded.doc").run(p.id,JSON.stringify(p));return p;}
export function validateAdoption(packet,view,revision) {
  const r=validateCommand(packet,{authenticatedCaller:'human',currentHead:view.reference,currentRevision:revision});check(r.ok,'INVALID_COMMAND',{errors:r.errors});
  check(packet.operation==='workspace.adopt'&&packet.input.workspaceId===view.head.workspaceId&&sameRef(packet.input.domainHead,view.reference),'WORKSPACE_MISMATCH');
}
export function makeSelection(view,{projectId,product,templates=[],business=null}) {
  valid('revision-ref',product);check(view.head.products.some(x=>x.productId===projectId&&sameRef(x.dossier,product)),'REVISION_CONFLICT');
  check(Array.isArray(templates)&&templates.length<=16,'CAPACITY');for(const t of templates){valid('revision-ref',t);check(view.head.templates.some(x=>sameRef(x,t)),'REVISION_CONFLICT');}
  if(business){valid('revision-ref',business);check(sameRef(view.head.business,business),'REVISION_CONFLICT');}
  return {schemaVersion:'3djat.selection.v1',head:view.reference,projectId,product,templates,business,
    files:[...view.files].map(([location,b])=>({path:location,sha256:sha(b),bytes:b.toString('base64')}))};
}
export function verifySelection(s) {
  check(s.schemaVersion==='3djat.selection.v1'&&Array.isArray(s.files)&&s.files.length<=STORE_LIMITS.files,'UNSUPPORTED_SCHEMA');let total=0;const seen=new Map();
  for(const f of s.files){valid('revision-ref',{id:'file',revision:1,path:f.path,sha256:f.sha256});check(typeof f.bytes==='string'&&f.bytes.length<=Math.ceil(STORE_LIMITS.fileBytes/3)*4,'OVERSIZE');const b=Buffer.from(f.bytes,'base64');total+=b.length;
    check(!seen.has(f.path)&&b.length<=STORE_LIMITS.fileBytes&&total<=STORE_LIMITS.totalBytes&&sha(b)===f.sha256,'HASH_MISMATCH');seen.set(f.path,b);}
  for(const r of [s.head,s.product,...s.templates,s.business].filter(Boolean)){valid('revision-ref',r);check(seen.has(r.path)&&sha(seen.get(r.path))===r.sha256,'HASH_MISMATCH');}
  const markerBytes=seen.get('domain-store.json');check(markerBytes,'MISSING_REFERENCE');const marker=JSON.parse(markerBytes);
  exact(marker,['schemaVersion','workspaceId','workspace','genesis']);check(marker.schemaVersion==='3djat.domain-store.v1','UNSUPPORTED_SCHEMA');
  const reader=Object.create(DomainStore.prototype);reader.marker=marker;reader.markerBytes=markerBytes;
  reader.readFile=relative=>{check(seen.has(relative),'MISSING_REFERENCE',{path:relative});return seen.get(relative);};
  const closure=reader.closure(s.head);check(closure.files.size===seen.size,'INCOMPLETE_SNAPSHOT');
  const head=JSON.parse(seen.get(s.head.path));check(head.products.some(x=>x.productId===s.projectId&&sameRef(x.dossier,s.product)),'REFERENCE_IDENTITY');
  for(const t of s.templates)check(head.templates.some(x=>sameRef(x,t)),'REFERENCE_IDENTITY');if(s.business)check(sameRef(head.business,s.business),'REFERENCE_IDENTITY');return s;
}
