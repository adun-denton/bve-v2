// SQLite-owned import inbox/provenance. No generation, domain mutation or conversion.
import * as fs from 'node:fs';
import * as path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {hash,verifyPNG} from './png.mjs';
import {validate,validateCommand,ERROR_CODES} from './contracts/3djat.mjs';
import {RootGuard,contains,databaseFingerprint,check,fail} from './workspace.mjs';
import {verifyCombined} from './workspace-backup.mjs';
const OPS=new Set(['asset.import.stage','asset.import.commit']);
export const IMPORT_LIMITS=Object.freeze({count:256,stagedBytes:256*1024**2,encodedBytes:24*1024**2});
const stable=x=>JSON.stringify(x,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const bytes=x=>Buffer.from(stable(x)+'\n');
const clone=x=>JSON.parse(JSON.stringify(x));
const uid=x=>{const h=hash(Buffer.from(x));return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`;};
const same=(a,b)=>stable(a)===stable(b);
export function importFailure(packet,error,evidence=null){
  let code=error.code;if(!ERROR_CODES.includes(code))code=['UNSAFE_PATH','ROOT_CHANGED','PATH_CASE_MISMATCH'].includes(code)?'UNSAFE_PATH':evidence?'EXPORT_PENDING':'CAPABILITY_UNAVAILABLE';
  if(error.code==='ERR_SQLITE_ERROR')code='EXPORT_PENDING'; // SQLite publication acknowledgement can be uncertain; retry the original key.
  const result={schemaVersion:'3djat.failure.v1',operation:packet?.operation,key:packet?.key,error:{code,path:'$',recoverability:code==='REVISION_CONFLICT'?'refresh':'manual-review',message:code,evidence}};
  check(OPS.has(packet?.operation)&&validate('failure',result).ok,'INVALID_VALUE');return result;
}
const shape=(kind,value,context={})=>{const v=validate(kind,value,context);if(!v.ok)fail(v.errors[0].code);};
const get=(db,kind,id)=>{const r=db.prepare('SELECT doc FROM records WHERE kind=? AND id=?').get(kind,id);return r?JSON.parse(r.doc):null;};
const list=(db,kind)=>db.prepare('SELECT doc FROM records WHERE kind=? ORDER BY id').all(kind).map(r=>JSON.parse(r.doc));
const put=(db,kind,row)=>{db.prepare('INSERT INTO records VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET doc=excluded.doc').run(kind,row.id,JSON.stringify(row));return row;};
function immutable(db,kind,id,productId,payload,revision=1){
  const reference={id,revision,path:`Operational/${kind}/${id}/${revision}.json`,sha256:hash(bytes(payload))};
  const row={schemaVersion:'bve.import-value.v1',id,projectId:productId,revision,reference,payload};
  const old=get(db,kind,id);check(!old||same(old,row),'IMPORT_CONFLICT');if(!old)put(db,kind,row);return reference;
}
function value(db,kind,id){const row=get(db,kind,id);check(row?.schemaVersion==='bve.import-value.v1','UNSUPPORTED_SCHEMA');
  check(row.reference.id===id&&row.reference.revision===row.revision&&row.reference.path===`Operational/${kind}/${id}/${row.revision}.json`&&hash(bytes(row.payload))===row.reference.sha256,'HASH_MISMATCH');return row;}
const artifactRef=a=>({productId:a.projectId,artifactId:a.id,version:a.version,sha256:a.sha256,width:a.width,height:a.height});
export function checkImportFormat(db,root){
  const m=get(db,'assetImportFormat','active'),marker=JSON.parse(new RootGuard(root).read('bve-v2-root.json'));
  check(marker.format==='bve-v2'&&(marker.version===1||marker.version===2&&same(marker.features,['historical-import.v1'])),'UNSUPPORTED_SCHEMA');
  if(m)check(m.schemaVersion==='bve.asset-import-format.v1'&&m.version===1,'UNSUPPORTED_SCHEMA');
  if(marker.version===2)check(m,'UNSUPPORTED_SCHEMA');
  if(!m)check(!db.prepare("SELECT 1 FROM records WHERE kind='assetImport' LIMIT 1").get(),'UNSUPPORTED_SCHEMA');
  if(marker.version===1)check(!db.prepare("SELECT 1 FROM records WHERE kind='assetImport' LIMIT 1").get(),'UNSUPPORTED_SCHEMA');
  return m;
}
export function installImportFormat(db,root,{fresh,backup=null,confirmedQuiescent=false,tx}){
  const guard=new RootGuard(root),prior=checkImportFormat(db,root);let backupHash=null;
  if(!prior){
    if(!fresh){check(confirmedQuiescent===true&&typeof backup==='string','MIGRATION_REQUIRES_BACKUP');verifyCombined(backup);
      const copy=new DatabaseSync(path.join(backup,'runtime/workspace.sqlite'),{readOnly:true});try{check(databaseFingerprint(copy)===databaseFingerprint(db),'BACKUP_MISMATCH');}finally{copy.close();}
      backupHash=hash(new RootGuard(backup).read('combined-backup.json'));
    }
    tx(()=>put(db,'assetImportFormat',{id:'active',schemaVersion:'bve.asset-import-format.v1',version:1,previousBackupSha256:backupHash}));
  }
  const marker=JSON.parse(guard.read('bve-v2-root.json'));
  if(marker.version===1){
    // Feature marker is published only after the opt-in receipt. No import can precede it.
    const temp='import-format-promotion.json';guard.write(temp,bytes({...marker,version:2,features:['historical-import.v1']}));fs.renameSync(guard.locate(temp),guard.locate('bve-v2-root.json'));guard.sync();
  }
}
export function verifyImportedArtifact(db,a){
  check(a.origin==='import'&&a.jobId===undefined&&a.iterationId===undefined&&a.assignmentId===undefined&&a.attemptId===undefined,'EVIDENCE_MISMATCH');
  const s=get(db,'assetImport',a.importId);check(s?.schemaVersion==='bve.asset-import.v1'&&s.state==='committed'&&s.artifactId===a.id&&s.projectId===a.projectId,'EVIDENCE_MISMATCH');
  const declaration=value(db,'importDeclaration',s.id),ref=value(db,'importArtifact',a.id),origin=value(db,'importOrigin',a.id);
  shape('historical-import',declaration.payload);shape('artifact-ref',ref.payload);shape('artifact-origin',origin.payload);
  check(same(artifactRef(a),ref.payload)&&same(a.importRecord,declaration.reference)&&same(origin.payload.artifact,ref.payload)&&same(origin.payload.provenance,{origin:'import',importRecord:declaration.reference}),'EVIDENCE_MISMATCH');
  check(declaration.payload.productId===a.projectId&&declaration.payload.sha256===a.sha256&&declaration.payload.width===a.width&&declaration.payload.height===a.height,'EVIDENCE_MISMATCH');
  return {declaration:declaration.payload,origin:origin.payload,reference:ref.reference};
}
export function verifyImports(db){
  const stages=list(db,'assetImport');check(stages.length<=IMPORT_LIMITS.count,'CAPACITY');
  const format=get(db,'assetImportFormat','active');if(format)check(format.schemaVersion==='bve.asset-import-format.v1'&&format.version===1,'UNSUPPORTED_SCHEMA');if(stages.length)check(format,'UNSUPPORTED_SCHEMA');
  let total=0;for(const s of stages){
    check(s.schemaVersion==='bve.asset-import.v1'&&['staged','failed','committed'].includes(s.state)&&[1,2].includes(s.revision),'UNSUPPORTED_SCHEMA');
    const d=value(db,'importDeclaration',s.id);shape('historical-import',d.payload);check(d.payload.productId===s.projectId&&d.payload.importId===s.id&&same(d.reference,s.declaration),'EVIDENCE_MISMATCH');
    const raw=db.prepare('SELECT data FROM bytes WHERE hash=?').get(d.payload.sha256)?.data;check(raw&&raw.length===d.payload.encodedBytes&&hash(raw)===d.payload.sha256,'MISSING_ORIGINAL');total+=raw.length;check(total<=IMPORT_LIMITS.stagedBytes,'CAPACITY');
    if(s.state==='committed'){const a=get(db,'artifact',s.artifactId);check(a,'MISSING_ORIGINAL');verifyImportedArtifact(db,a);const v=verifyPNG(raw);check(v.width===a.width&&v.height===a.height,'HASH_MISMATCH');}
    else check(!s.artifactId,'EVIDENCE_MISMATCH');
    const receipt=value(db,'importReceipt',s.stageReceipt.id);check(same(receipt.reference,s.stageReceipt)&&receipt.payload.operation==='asset.import.stage'&&receipt.payload.importId===s.id&&receipt.payload.principalId===s.principalId&&receipt.payload.productId===s.projectId&&same(receipt.payload.reference,s.declaration),'EVIDENCE_MISMATCH');
    if(s.state==='committed'){check(s.commitReceipt,'EVIDENCE_MISMATCH');const c=value(db,'importReceipt',s.commitReceipt.id),a=value(db,'importArtifact',s.artifactId);check(same(c.reference,s.commitReceipt)&&c.payload.operation==='asset.import.commit'&&c.payload.importId===s.id&&c.payload.principalId===s.principalId&&same(c.payload.reference,a.reference),'EVIDENCE_MISMATCH');}
  }
  for(const a of list(db,'artifact')){check(a.origin===undefined||['import','produced'].includes(a.origin),'UNSUPPORTED_SCHEMA');if(a.origin==='import')verifyImportedArtifact(db,a);}
  return stages.map(s=>({importId:s.id,productId:s.projectId,state:s.state,revision:s.revision,artifactId:s.artifactId??null}));
}
export class AssetImports {
  #db;#root;#tx;#authenticate;#current;#hook;#sources=new Map();
  constructor(db,root,{tx,authenticate,current,sources={},hook=()=>{}}){
    this.#db=db;this.#root=new RootGuard(root);this.#tx=tx;this.#authenticate=authenticate;this.#current=current;this.#hook=hook;
    check(Object.keys(sources).length<=16,'INVALID_VALUE');for(const [id,directory] of Object.entries(sources)){shape('revision-ref',{id,revision:1,path:'source.json',sha256:'0'.repeat(64)});check(typeof directory==='string'&&path.isAbsolute(directory),'UNSAFE_PATH');check(!contains(root,directory)&&!contains(directory,root),'PATH_OVERLAP');this.#sources.set(id,directory);}
  }
  #principal(token,productId){const p=this.#authenticate(token);check(p&&['human','conductor'].includes(p.role)&&(p.products==='*'||p.products.includes(productId)),'INVALID_SCOPE');return p;}
  #receipt(packet,p,productId,outputType,reference){
    return immutable(this.#db,'importReceipt',uid(stable([p.id,packet.operation,packet.key,productId,packet.input.importId])),productId,
      {schemaVersion:'bve.import-receipt.v1',principalId:p.id,operation:packet.operation,key:packet.key,importId:packet.input.importId,productId,packetHash:hash(bytes(packet)),outputType,reference});
  }
  #result(packet,receipt,outputType,reference,revision){return {schemaVersion:'3djat.result.v1',operation:packet.operation,key:packet.key,receipt,owner:'operational',committedRevision:revision,outputType,reference};}
  #failure(packet,error,evidence=null){return importFailure(packet,error,evidence);}
  command(token,packet){
    check(packet&&OPS.has(packet.operation)&&typeof packet.key==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(packet.key),'INVALID_VALUE');let known=null;
    try{
      this.#root.assert();checkImportFormat(this.#db,this.#root.root);check(JSON.parse(this.#root.read('bve-v2-root.json')).version===2,'CAPABILITY_UNAVAILABLE');
      const checked=validateCommand(packet);if(!checked.ok)fail(checked.errors[0].code);
      const stage=get(this.#db,'assetImport',packet.input.importId),productId=packet.operation==='asset.import.stage'?packet.input.productId:stage?.projectId;check(productId,'MISSING_SOURCE');const p=this.#principal(token,productId);
      const scope=stable(['asset-import.v1',p.id,packet.operation,productId,packet.input.importId]),fp=hash(bytes(packet));const replay=()=>{const old=this.#db.prepare('SELECT fingerprint,doc FROM receipts WHERE scope=? AND key=?').get(scope,packet.key);if(!old)return null;check(old.fingerprint===fp,'IDEMPOTENCY_CONFLICT');return JSON.parse(old.doc);};
      const old=replay();if(old)return old;
      const result=this.#current(productId,packet.expected.domainHead,view=>{
        const v=validateCommand(packet,{authenticatedCaller:p.role,projectId:productId,currentHead:view.reference,currentRevision:stage?.revision??0});if(!v.ok)fail(v.errors[0].code);
        if(packet.operation==='asset.import.stage')return this.#tx(()=>{
          const again=replay();if(again)return again;check(!get(this.#db,'assetImport',packet.input.importId),'IMPORT_CONFLICT');this.#principal(token,productId);
          const d=packet.input,configured=this.#sources.get(d.source.sourceId);check(d.source.kind==='file'&&configured,'MISSING_SOURCE');
          let raw;try{const source=typeof configured==='string'?new RootGuard(configured):configured;this.#sources.set(d.source.sourceId,source);raw=source.read(d.source.location,IMPORT_LIMITS.encodedBytes);}catch(e){if(['ENOENT','MISSING_ROOT'].includes(e.code))fail('MISSING_SOURCE');if(e.code==='OVERSIZE')fail('UNSUPPORTED_IMAGE');throw e;}
          check(raw.length===d.encodedBytes&&hash(raw)===d.sha256,'HASH_MISMATCH');
          const stages=list(this.#db,'assetImport');check(stages.length<IMPORT_LIMITS.count&&stages.reduce((n,s)=>n+value(this.#db,'importDeclaration',s.id).payload.encodedBytes,0)+raw.length<=IMPORT_LIMITS.stagedBytes,'OUT_OF_BOUNDS');
          this.#parent(d);this.#hook('before-import-inbox',{importId:d.importId});
          const prior=this.#db.prepare('SELECT data FROM bytes WHERE hash=?').get(d.sha256);check(!prior||Buffer.from(prior.data).equals(raw),'HASH_MISMATCH');this.#db.prepare('INSERT OR IGNORE INTO bytes VALUES(?,?)').run(d.sha256,raw);
          const reference=immutable(this.#db,'importDeclaration',d.importId,productId,d),receipt=this.#receipt(packet,p,productId,'historical-import',reference);
          put(this.#db,'assetImport',{id:d.importId,schemaVersion:'bve.asset-import.v1',workspaceId:view.head.workspaceId,projectId:productId,principalId:p.id,state:'staged',revision:1,declaration:reference,stageReceipt:receipt,artifactId:null,error:null});
          const out=this.#result(packet,receipt,'historical-import',reference,1);this.#db.prepare('INSERT INTO receipts VALUES(?,?,?,?)').run(scope,packet.key,fp,JSON.stringify(out));return out;
        });
        check(stage?.principalId===p.id,'INVALID_SCOPE');check(stage.state==='staged','IMPORT_CONFLICT');check(same(stage.stageReceipt,packet.input.stageReceipt),'EVIDENCE_MISMATCH');
        const d=value(this.#db,'importDeclaration',stage.id).payload;check(d.sha256===packet.input.sha256,'HASH_MISMATCH');const raw=this.#db.prepare('SELECT data FROM bytes WHERE hash=?').get(d.sha256)?.data;check(raw&&raw.length===d.encodedBytes&&hash(raw)===d.sha256,'MISSING_SOURCE');
        let measured;try{measured=verifyPNG(raw);check(measured.width===d.width&&measured.height===d.height,'HASH_MISMATCH');}catch(e){
          const error=this.#failure(packet,{code:ERROR_CODES.includes(e.code)?e.code:'UNSUPPORTED_IMAGE'},stage.stageReceipt);return this.#tx(()=>{stage.state='failed';stage.revision=2;stage.error=error.error.code;put(this.#db,'assetImport',stage);this.#db.prepare('INSERT INTO receipts VALUES(?,?,?,?)').run(scope,packet.key,fp,JSON.stringify(error));return error;});
        }
        this.#hook('after-import-verify',{importId:stage.id});
        return this.#tx(()=>{
          const again=replay();if(again)return again;this.#principal(token,productId);const actual=get(this.#db,'assetImport',stage.id);check(same(actual,stage),'REVISION_CONFLICT');this.#parent(d);
          check(hash(this.#db.prepare('SELECT data FROM bytes WHERE hash=?').get(d.sha256).data)===d.sha256,'HASH_MISMATCH');
          const artifactId=uid(stable(['import-artifact',stage.workspaceId,stage.id]));check(!get(this.#db,'artifact',artifactId),'IMPORT_CONFLICT');
          const a={id:artifactId,origin:'import',version:1,projectId:productId,importId:stage.id,importRecord:stage.declaration,...measured,verifiedAt:new Date().toISOString(),sources:[]};
          const reference=immutable(this.#db,'importArtifact',artifactId,productId,artifactRef(a));immutable(this.#db,'importOrigin',artifactId,productId,{schemaVersion:'3djat.artifact-origin.v1',artifact:artifactRef(a),provenance:{origin:'import',importRecord:stage.declaration}});
          put(this.#db,'artifact',a);stage.state='committed';stage.revision=2;stage.artifactId=artifactId;put(this.#db,'assetImport',stage);
          const receipt=this.#receipt(packet,p,productId,'artifact-ref',reference);stage.commitReceipt=receipt;put(this.#db,'assetImport',stage);const out=this.#result(packet,receipt,'artifact-ref',reference,2);this.#db.prepare('INSERT INTO receipts VALUES(?,?,?,?)').run(scope,packet.key,fp,JSON.stringify(out));return out;
        });
      });
      known=result.schemaVersion==='3djat.result.v1'?result.receipt:null;
      this.#hook(packet.operation==='asset.import.stage'?'after-import-stage':'after-import-commit',{importId:packet.input.importId,result});this.#hook('before-import-response',{});return clone(result);
    }catch(e){return this.#failure(packet,e,known);}
  }
  #parent(d){if(!d.historicalParent)return;const a=get(this.#db,'artifact',d.historicalParent.artifactId);check(a&&same(artifactRef(a),d.historicalParent)&&a.projectId===d.productId,'EVIDENCE_MISMATCH');if(a.origin==='import')verifyImportedArtifact(this.#db,a);const raw=this.#db.prepare('SELECT data FROM bytes WHERE hash=?').get(a.sha256)?.data;check(raw,'MISSING_SOURCE');const m=verifyPNG(raw);check(m.sha256===a.sha256&&m.width===a.width&&m.height===a.height,'HASH_MISMATCH');}
  review(token,importId){this.#root.assert();const s=get(this.#db,'assetImport',importId);check(s,'MISSING_SOURCE');this.#principal(token,s.projectId);const d=value(this.#db,'importDeclaration',s.id),receipt=value(this.#db,'importReceipt',s.stageReceipt.id);
    return {format:'bve.import-review.v1',stage:clone(s),declaration:clone(d),stageReceipt:clone(receipt),commitReceipt:s.commitReceipt?clone(value(this.#db,'importReceipt',s.commitReceipt.id)):null,artifact:s.artifactId?clone(get(this.#db,'artifact',s.artifactId)):null,artifactReference:s.artifactId?clone(value(this.#db,'importArtifact',s.artifactId)):null,origin:s.artifactId?clone(value(this.#db,'importOrigin',s.artifactId)):null,sourceEvidence:{status:'captured-bytes-hash-matched',historicalClaims:'unverified'},freshAcceptance:false};}
  portable(token,artifactId){this.#root.assert();const a=get(this.#db,'artifact',artifactId);check(a?.origin==='import','INVALID_SCOPE');this.#principal(token,a.projectId);const provenance=verifyImportedArtifact(this.#db,a),raw=this.#db.prepare('SELECT data FROM bytes WHERE hash=?').get(a.sha256)?.data;check(raw,'MISSING_SOURCE');const m=verifyPNG(raw);check(m.sha256===a.sha256&&m.width===a.width&&m.height===a.height,'HASH_MISMATCH');this.#hook('before-import-export',{});
    return {format:'bve.import-portable.v1',artifact:artifactRef(a),origin:provenance.origin,declaration:provenance.declaration,original:{sha256:a.sha256,mediaType:'image/png',bytes:Buffer.from(raw).toString('base64')},historicalClaims:'unverified',freshAcceptance:false};}
}
