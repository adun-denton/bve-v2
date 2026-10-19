// Private combined recovery only. Never a public domain export or command router.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { DatabaseSync, backup } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { DomainStore, verifySnapshot, restoreSnapshot, STORE_LIMITS } from './domain-store.mjs';
import { RootGuard, WorkspaceConnection, canonicalRoot, contains, inspectRuntime, integrationRow, acquireOperational,
  check, fail, sha, jsonBytes, sameRef, putProjection, verifySelection, verifyCredentials } from './workspace.mjs';
import { verifyPNG } from './png.mjs';
import {verifyImports,checkImportFormat} from './asset-import.mjs';
export const BACKUP_LIMITS=Object.freeze({files:4096,sqliteBytes:1024**3,attachmentBytes:1024**3,totalBytes:2*1024**3});
const MANIFEST='combined-backup.json';
function fresh(root) {canonicalRoot(root,{missing:true});check(!fs.existsSync(root),'DESTINATION_EXISTS');fs.mkdirSync(root,{mode:0o700});return new RootGuard(root);}
export function digestFile(guard,relative,max) {
  let fd;try{fd=fs.openSync(guard.locate(relative),fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW??0));const s=fs.fstatSync(fd);check(s.size<=max,'CAPACITY');
    const h=createHash('sha256'),buffer=Buffer.alloc(1024**2);let n=0,k;while((k=fs.readSync(fd,buffer,0,buffer.length,null))>0){n+=k;check(n<=max,'CAPACITY');h.update(buffer.subarray(0,k));}
    const after=fs.fstatSync(fd);guard.locate(relative);check(n===s.size&&after.size===s.size&&after.mtimeMs===s.mtimeMs,'FILE_CHANGED');return {bytes:n,sha256:h.digest('hex')};
  }finally{if(fd!==undefined)fs.closeSync(fd);}
}
function copyFile(source,relative,target,output,max,expected,hook=()=>{}) {
  const before=digestFile(source,relative,max);if(expected)check(before.sha256===expected,'HASH_MISMATCH');
  let input,fd;try{input=fs.openSync(source.locate(relative),fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW??0));fd=fs.openSync(target.locate(output,{create:true}),fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|(fs.constants.O_NOFOLLOW??0),0o600);
    const buffer=Buffer.alloc(1024**2);let total=0,k;while((k=fs.readSync(input,buffer,0,buffer.length,null))>0){total+=k;check(total<=max,'CAPACITY');fs.writeFileSync(fd,buffer.subarray(0,k));hook('copy-chunk',{path:output,bytes:total});}fs.fsyncSync(fd);
  }finally{if(input!==undefined)fs.closeSync(input);if(fd!==undefined)fs.closeSync(fd);}
  target.sync(path.dirname(target.locate(output)));const after=digestFile(target,output,max),sourceAfter=digestFile(source,relative,max);
  check(after.sha256===before.sha256&&sourceAfter.sha256===before.sha256&&after.bytes===before.bytes,'FILE_CHANGED');return after;
}
function getRecord(db,kind,id) {const r=db.prepare('SELECT doc FROM records WHERE kind=? AND id=?').get(kind,id);check(r,'MISSING_OPERATIONAL_REFERENCE',{kind,id});return JSON.parse(r.doc);}
export function verifyOperational(db,workspaceId) {
  check(db.prepare('PRAGMA page_count').get().page_count*db.prepare('PRAGMA page_size').get().page_size<=BACKUP_LIMITS.sqliteBytes,'CAPACITY');
  check(db.prepare('PRAGMA integrity_check').get().integrity_check==='ok','CORRUPT_DATABASE');check(db.prepare('PRAGMA user_version').get().user_version===1,'UNSUPPORTED_SCHEMA');
  const meta=integrationRow(db);check(meta?.config.workspaceId===workspaceId,'WORKSPACE_MISMATCH');let n=0;
  for(const row of db.prepare('SELECT kind,id,doc FROM records').iterate()) {
    check(++n<=100000&&Buffer.byteLength(row.doc)<=48*1024**2,'CAPACITY');const v=JSON.parse(row.doc);check(v.id===row.id,'REFERENCE_IDENTITY');
    for(const [field,kind] of Object.entries({projectId:'project',iterationId:'iteration',jobId:'job',assignmentId:'assignment',roundId:'round',statementId:'statement'}))if(v[field])getRecord(db,kind,v[field]);
    if(row.kind==='domainSelection')verifySelection(v);
    if(row.kind==='project'&&v.domainWorkspaceId)check(v.domainWorkspaceId===workspaceId,'WORKSPACE_MISMATCH');
    if(row.kind==='artifact') {const raw=db.prepare('SELECT length(data) AS size FROM bytes WHERE hash=?').get(v.sha256);check(raw&&raw.size<=24*1024**2,'MISSING_ORIGINAL');
      const bytes=db.prepare('SELECT data FROM bytes WHERE hash=?').get(v.sha256).data,measured=verifyPNG(bytes);check(measured.sha256===v.sha256&&measured.width===v.width&&measured.height===v.height,'HASH_MISMATCH');}
  }
  n=0;for(const row of db.prepare('SELECT scope,key,fingerprint,doc FROM receipts').iterate()){check(++n<=100000&&row.scope.length<=1000&&row.key.length<=200&&/^[0-9a-f]{64}$/.test(row.fingerprint)&&Buffer.byteLength(row.doc)<=48*1024**2,'CAPACITY');JSON.parse(row.doc);}
  n=0;for(const row of db.prepare('SELECT hash,length(data) AS size FROM bytes').iterate()){check(++n<=100000&&row.size<=24*1024**2,'CAPACITY');check(sha(db.prepare('SELECT data FROM bytes WHERE hash=?').get(row.hash).data)===row.hash,'HASH_MISMATCH');}
  verifyImports(db);
  return meta;
}
const evidenceKinds=new Set(['round','statement','statementEvent','checkpoint','event','submission','acceptance','workspaceAcknowledgement']);
function operationalEvidence(db,ref) {
  const match=/^Operational\/([A-Za-z]+)\/([^/]+)\.json$/.exec(ref.path);check(match&&evidenceKinds.has(match[1])&&match[2]===ref.id,'INCOMPLETE_BACKUP',{reason:'unresolved-operational-evidence',reference:ref});
  const row=db.prepare('SELECT doc FROM records WHERE kind=? AND id=?').get(match[1],ref.id);check(row,'INCOMPLETE_BACKUP',{reason:'missing-operational-evidence',reference:ref});
  const b=Buffer.from(row.doc),v=JSON.parse(row.doc);check(b.length<=STORE_LIMITS.fileBytes&&sha(b)===ref.sha256&&(v.revision??v.version??1)===ref.revision,'HASH_MISMATCH');return b;
}
function verifyArtifactReference(db,ref) {
  const a=getRecord(db,'artifact',ref.artifactId);check(a.projectId===ref.productId&&a.sha256===ref.sha256&&a.version===ref.version&&a.width===ref.width&&a.height===ref.height,'HASH_MISMATCH');
}
function attachmentClosure(view) {return [...view.records.values()].filter(x=>x.kind==='attachment').map(x=>({reference:x.reference,record:x.value}));}
function collectFiles(root) {
  const guard=new RootGuard(root),out=[],stack=[''];let visited=0,total=0;
  while(stack.length){const dir=stack.pop(),fd=fs.opendirSync(dir?guard.locate(dir,{directory:true}):root);try{let entry;while((entry=fd.readSync())){
    check(++visited<=BACKUP_LIMITS.files*2,'CAPACITY');const rel=dir?dir+'/'+entry.name:entry.name;
    check(!entry.isSymbolicLink(),'UNSAFE_PATH');if(entry.isDirectory())stack.push(rel);else{
      if(rel===MANIFEST)continue;const f=digestFile(guard,rel,BACKUP_LIMITS.sqliteBytes);total+=f.bytes;check(out.length<BACKUP_LIMITS.files&&total<=BACKUP_LIMITS.totalBytes,'CAPACITY');out.push({path:rel,...f});
    }
  }}finally{fd.closeSync();}}
  return out.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
}
export async function backupCombined(source,destination,{hook=()=>{}}={}) {
  const info=inspectRuntime(source);check(info.integration,'NO_WORKSPACE_CONNECTION');const connection=new WorkspaceConnection(source,info.integration.config),releaseDomain=connection.lockDomain();let releaseOperations;
  try {
    releaseOperations=acquireOperational(source);hook('backup-locked',{});const view=connection.read(),meta=info.integration;
    const destPath=canonicalRoot(destination,{missing:true});check(!contains(connection.store.root,destPath)&&!contains(connection.root,destPath)&&!contains(destPath,connection.store.root)&&!contains(destPath,connection.root),'PATH_OVERLAP');
    const target=fresh(destPath),runtime=new RootGuard(source);fs.mkdirSync(path.join(destPath,'runtime'),{mode:0o700});
    connection.store.exportTo(path.join(destPath,'domain'));hook('domain-copied',{head:view.reference});
    const db=new DatabaseSync(runtime.locate('workspace.sqlite'),{readOnly:true});let evidence=[];
    try {
      checkImportFormat(db,source);verifyOperational(db,meta.config.workspaceId);check(digestFile(runtime,'workspace.sqlite',BACKUP_LIMITS.sqliteBytes).bytes<=BACKUP_LIMITS.sqliteBytes,'CAPACITY');
      await backup(db,path.join(destPath,'runtime','workspace.sqlite'));
      // The immutable backup must not create mutable WAL/SHM files on read-back.
      const snapshotDb=new DatabaseSync(path.join(destPath,'runtime','workspace.sqlite'));try{snapshotDb.exec('PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE;');}finally{snapshotDb.close();}
      fs.chmodSync(path.join(destPath,'runtime','workspace.sqlite'),0o600);
      const fd=fs.openSync(target.locate('runtime/workspace.sqlite'),'r+');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}target.sync(path.join(destPath,'runtime'));hook('sqlite-copied',{});
      for(const file of ['bve-v2-root.json','credentials.json'])copyFile(runtime,file,target,'runtime/'+file,STORE_LIMITS.fileBytes,null,hook);
      let total=0;const locations=new Map();for(const {record:a,reference} of attachmentClosure(view)) {
        check(!/^(Domain|Heads|Receipts|Staging|Recovery)(\/|$)/i.test(a.location),'UNSAFE_PATH');total+=a.bytes;check(total<=BACKUP_LIMITS.attachmentBytes,'CAPACITY');
        if(locations.has(a.location)){check(locations.get(a.location)===a.sha256,'REFERENCE_CONFLICT');continue;}locations.set(a.location,a.sha256);
        try{const copied=copyFile(connection.domainGuard,a.location,target,'attachments/'+a.location,a.bytes,a.sha256,hook);check(copied.bytes===a.bytes,'HASH_MISMATCH');}
        catch(e){if(e.code==='ENOENT')fail('INCOMPLETE_BACKUP',{reason:'missing-attachment',reference});throw e;}
      }
      for(const x of view.external)if(x.kind==='operational-evidence') {
        const b=operationalEvidence(db,x.reference),relative='evidence/'+x.reference.path;
        if(!evidence.some(e=>e.path===relative)){target.write(relative,b);evidence.push({reference:x.reference,path:relative});}
      }else if(x.kind==='operational-artifact') {
        verifyArtifactReference(db,x.artifact);
      }
    }finally{db.close();}
    check(sameRef(connection.read().reference,view.reference),'HEAD_CHANGED');
    const manifest={schemaVersion:'3djat.combined-backup.v1',scope:'domain+operational+attachments',complete:true,workspaceId:meta.config.workspaceId,head:view.reference,
      files:collectFiles(destPath),attachments:attachmentClosure(view).map(x=>({reference:x.reference,location:x.record.location,sha256:x.record.sha256,bytes:x.record.bytes})),
      evidence,externalSources:view.external.filter(x=>x.kind==='source')};
    hook('before-backup-manifest',{});target.write(MANIFEST,jsonBytes(manifest));verifyCombined(destPath);return destPath;
  }finally{try{releaseOperations?.();}finally{releaseDomain();}}
}
export function verifyCombined(root) {
  const guard=new RootGuard(root);let m;try{m=JSON.parse(guard.read(MANIFEST));}catch(e){if(e.code==='ENOENT'||e instanceof SyntaxError)fail('INCOMPLETE_BACKUP',{reason:'missing-or-invalid-manifest'});throw e;}
  check(m&&typeof m==='object'&&Object.keys(m).length===9&&['schemaVersion','scope','complete','workspaceId','head','files','attachments','evidence','externalSources'].every(k=>Object.hasOwn(m,k)),'INVALID_METADATA');
  check(m.schemaVersion==='3djat.combined-backup.v1'&&m.scope==='domain+operational+attachments'&&m.complete===true,'UNSUPPORTED_SCHEMA');
  check(Array.isArray(m.files)&&m.files.length<=BACKUP_LIMITS.files&&Array.isArray(m.attachments)&&m.attachments.length<=512&&Array.isArray(m.evidence)&&m.evidence.length<=512,'CAPACITY');
  const actual=collectFiles(root);check(JSON.stringify(actual)===JSON.stringify(m.files),'HASH_MISMATCH');
  const domain=verifySnapshot(path.join(root,'domain'));check(domain.workspaceId===m.workspaceId&&sameRef(domain.head,m.head),'WORKSPACE_MISMATCH');
  const view=new DomainStore(path.join(root,'domain')).read(),attachments=attachmentClosure(view).map(x=>({reference:x.reference,location:x.record.location,sha256:x.record.sha256,bytes:x.record.bytes}));
  check(JSON.stringify(attachments)===JSON.stringify(m.attachments)&&JSON.stringify(view.external.filter(x=>x.kind==='source'))===JSON.stringify(m.externalSources),'INCOMPLETE_BACKUP');
  let total=0;for(const a of attachments){total+=a.bytes;check(total<=BACKUP_LIMITS.attachmentBytes,'CAPACITY');const f=digestFile(guard,'attachments/'+a.location,a.bytes);check(f.bytes===a.bytes&&f.sha256===a.sha256,'HASH_MISMATCH');}
  verifyCredentials(guard.read('runtime/credentials.json'));const rootMarker=JSON.parse(guard.read('runtime/bve-v2-root.json'));check(rootMarker.format==='bve-v2'&&(rootMarker.version===1||rootMarker.version===2&&JSON.stringify(rootMarker.features)==='["historical-import.v1"]'),'UNSUPPORTED_SCHEMA');
  const db=new DatabaseSync(guard.locate('runtime/workspace.sqlite'),{readOnly:true});try{
    checkImportFormat(db,path.join(root,'runtime'));const meta=verifyOperational(db,m.workspaceId);check(meta.config.workspaceId===m.workspaceId,'WORKSPACE_MISMATCH');
    for(const x of view.external)if(x.kind==='operational-artifact')verifyArtifactReference(db,x.artifact);
    const refs=[...new Map(view.external.filter(x=>x.kind==='operational-evidence').map(x=>[JSON.stringify(x.reference),x])).values()];check(refs.length===m.evidence.length,'INCOMPLETE_BACKUP');
    for(const x of refs){const record=m.evidence.find(e=>sameRef(e.reference,x.reference));check(record&&record.path==='evidence/'+x.reference.path,'INCOMPLETE_BACKUP');check(guard.read(record.path).equals(operationalEvidence(db,x.reference)),'HASH_MISMATCH');}
  }finally{db.close();}return m;
}
export function restoreCombined(source,{businessRoot,runtimeRoot,paths,storage='local-unsynced'},{hook=()=>{}}={}) {
  const m=verifyCombined(source),business=canonicalRoot(businessRoot,{missing:true}),runtime=canonicalRoot(runtimeRoot,{missing:true});
  check(!fs.existsSync(business)&&!fs.existsSync(runtime),'DESTINATION_EXISTS');check(!contains(business,runtime)&&!contains(runtime,business)&&!contains(source,business)&&!contains(source,runtime),'PATH_OVERLAP');
  const workspace=new DomainStore(path.join(source,'domain')).workspace;
  check(storage==='local-unsynced'&&paths&&Object.keys(paths).length===4,'LOCAL_STORAGE_REQUIRED');for(const [k,v] of Object.entries(workspace.paths)){check(!/^(Domain|Heads|Receipts|Staging|Recovery)(\/|$)/i.test(v),'PATH_CONFLICT');check(paths[k]===path.join(business,...v.split('/')),'PATH_CONFLICT');}
  const planned=Object.values(paths);check(planned.every((x,i)=>planned.every((y,j)=>i===j||!contains(x,y))),'PATH_OVERLAP');
  const restored=restoreSnapshot(path.join(source,'domain'),business);for(const relative of Object.values(workspace.paths))new RootGuard(business).locate(relative,{directory:true,create:true});hook('domain-restored',{});
  const target=fresh(runtime);target.write('restore-in-progress.json',jsonBytes({schemaVersion:'3djat.restore-in-progress.v1',workspaceId:m.workspaceId,head:m.head}));const input=new RootGuard(source),businessTarget=new RootGuard(business);
  for(const file of ['workspace.sqlite','bve-v2-root.json','credentials.json'])copyFile(input,'runtime/'+file,target,file,file==='workspace.sqlite'?BACKUP_LIMITS.sqliteBytes:STORE_LIMITS.fileBytes,m.files.find(x=>x.path==='runtime/'+file).sha256,hook);
  for(const a of m.attachments)if(!fs.existsSync(businessTarget.locate(a.location)))copyFile(input,'attachments/'+a.location,businessTarget,a.location,a.bytes,a.sha256,hook);
  hook('operational-restored',{});const config={schemaVersion:'3djat.connection.v1',workspaceId:m.workspaceId,domainRoot:business,runtimeRoot:runtime,paths,storage};
  const connection=new WorkspaceConnection(runtime,config),releaseDomain=connection.lockDomain();let releaseOperations,db;
  try {releaseOperations=acquireOperational(runtime);db=new DatabaseSync(target.locate('workspace.sqlite'));
    verifyOperational(db,m.workspaceId);db.exec('BEGIN IMMEDIATE');try{const meta=integrationRow(db);meta.config=config;
      db.prepare("UPDATE records SET doc=? WHERE kind='domainIntegration' AND id='active'").run(JSON.stringify(meta));putProjection(db,connection.read());hook('before-restore-commit',{});db.exec('COMMIT');
    }catch(e){try{db.exec('ROLLBACK');}catch{}throw e;}
    verifyOperational(db,m.workspaceId);
  }finally{try{db?.close();}finally{try{releaseOperations?.();}finally{releaseDomain();}}}
  for(const a of m.attachments){const f=digestFile(businessTarget,a.location,a.bytes);check(f.sha256===a.sha256&&f.bytes===a.bytes,'HASH_MISMATCH');}
  check(sameRef(new DomainStore(business).read().reference,m.head),'HASH_MISMATCH');hook('before-restore-marker',{});
  target.write('combined-restore.json',jsonBytes({schemaVersion:'3djat.combined-restore.v1',workspaceId:m.workspaceId,head:restored.reference,complete:true}));
  fs.unlinkSync(target.locate('restore-in-progress.json'));target.sync();
  return {businessRoot:business,runtimeRoot:runtime,head:m.head};
}
