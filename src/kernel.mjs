import * as cal from './calibration.mjs';
import {candidateAction,candidateActionReference as contentActionReference,decisionReference,verifyContentDecisions,deriveContent} from './content-review.mjs';
import {PNG_SERVICE,recipesForRun,recipeHash,stable as recipeStable} from './executors/png-recipes.mjs';
import {serviceTool,readServiceClosure} from './executors/pillow.mjs';
import {verifyServiceRecords} from './executors/service-records.mjs';
import {databasePixelLimit} from './image-policy.mjs';
import { isDeepStrictEqual } from 'node:util';
import { isProxy } from 'node:util/types';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync, existsSync, readFileSync, writeFileSync, chmodSync, readdirSync, renameSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { hash, verifyPNG } from './png.mjs';
import {PREVIEW_LIMITS,checkMediaQuery,checkMediaView,buildMedia,mediaKey,canonical,unavailableMedia} from './png-preview.mjs';
import { DomainProducts, decisionActionReference } from './domain-products.mjs';
import { DomainTemplates, templateDecisionActionReference } from './domain-templates.mjs';
import {AssetImports,IMPORT_LIMITS,checkImportFormat,installImportFormat,verifyImportedArtifact,inspectCommittedImport,importFailure} from './asset-import.mjs';
import {validate,validateCommand} from './contracts/3djat.mjs';
import {DomainBusiness} from './domain-business.mjs';
import {access,stable as domainStable,digest as domainDigest} from './domain-authority.mjs';
import {operationSelectionBytes,validateOperationSelection,validateOperationSelectionLinks,validateOperationSelectionFormat} from './operation-selection-format.mjs';
import {OPERATION_FEATURES} from './image-policy.mjs';
import {verifyCombined} from './workspace-backup.mjs';
import { WorkspaceConnection, RootGuard, inspectRuntime, acquireOperational, verifyLegacyMigration, databaseFingerprint, projection, putProjection, validateAdoption, makeSelection, verifySelection, sameRef, check as domainCheck, fail as domainFail } from './workspace.mjs';
const id = () => randomUUID();
const now = () => new Date().toISOString();
const clone = x => JSON.parse(JSON.stringify(x));
const fingerprint = x => hash(JSON.stringify(x));
const secret = () => randomBytes(32).toString('hex');
const equal = (a,b) => typeof a==='string' && typeof b==='string' && a.length===b.length && timingSafeEqual(Buffer.from(a),Buffer.from(b));
export class Fault extends Error { constructor(message,status=400) { super(message);this.status=status; } }
const requireThat = (ok,message,status=400) => { if(!ok) throw new Fault(message,status); };
const text = (s,label,max=20000) => { requireThat(typeof s==='string'&&s.trim().length&&s.length<=max,`Invalid ${label}`);return s; };
const integer = (n,min,max,label) => {requireThat(Number.isInteger(n)&&n>=min&&n<=max,`Invalid ${label}`);return n;};
const permissions={
  human:['project.create','request.create','draft.save','review.submit','design.accept'],
  conductor:['iteration.commission','creativeContext.supply','event.consume','event.ack'],
  // Local-owner allocation compatibility only; never a project staff/session role.
  generator:['job.allocate','attempt.start'],
  butler:['event.delivery'],
};
export class Kernel {
  #db; #credentials; #closed=false; #workspace=null; #workspaceHook=()=>{}; #inTransaction=false; #operationalHeld=false; #products=null; #productOptions=null; #imports=null; #importOptions=null; #mediaCache=new Map(); #mediaBytes=0;
  #templates=null; #templateOptions=null; #business=null; #businessOptions=null; #operations=false; #serviceOptions=null;
  constructor(root,{recover=true,workspace=null,expectedHead=null,migrate=false,migrationBackup=null,confirmedQuiescent=false,workspaceHook=()=>{},products=null,imports=null,templates=null,business=null,operations=false,operationBackup=null,services=null,serviceBackup=null}={}) {
    this.root=resolve(root);this.#workspaceHook=workspaceHook;
    this.#productOptions=products;
    this.#importOptions=imports;
    this.#businessOptions=business;
    this.#operations=operations;this.#serviceOptions=services?serviceTool(services):null;
    domainCheck(!services||operations,'INVALID_SCOPE');
    if(templates){domainCheck(Object.keys(templates).length===1&&typeof templates.accessFile==='string','INVALID_VALUE');const file=resolve(templates.accessFile);domainCheck(file!==this.root&&!file.startsWith(this.root+'/')&&!file.startsWith(this.root+'\\'),'UNSAFE_PATH');domainCheck(!products||resolve(products.accessFile)===file,'INVALID_SCOPE');this.#templateOptions={accessFile:file};}
    const info=inspectRuntime(this.root), prior=info.integration;
    if(prior&&workspace)domainCheck(isDeepStrictEqual(prior.config,workspace),'ROOT_CONFLICT');
    const config=workspace??prior?.config;
    if(config){
      this.#workspace=new WorkspaceConnection(root,config,{existing:!!prior});
      if(!prior){domainCheck(expectedHead&&sameRef(this.#workspace.store.read().reference,expectedHead),'REVISION_CONFLICT');
        if(info.hasRecords){domainCheck(migrate===true,'MIGRATION_REQUIRES_BACKUP');verifyLegacyMigration(this.root,migrationBackup,confirmedQuiescent);}}
    }
    this.#workspaceHook('connection-validated',{});
    let releaseDomain=null,releaseOperations=null,connectionCommitted=false;
    try {
      if(config&&!prior){releaseDomain=this.#workspace.lockDomain();domainCheck(sameRef(this.#workspace.store.read().reference,expectedHead),'REVISION_CONFLICT');}
      if(existsSync(this.root)&&!existsSync(join(this.root,'bve-v2-root.json')))requireThat(readdirSync(this.root).length===0,'Refusing to initialize a nonempty unrecognized root; choose a new BVE V2 root');
      mkdirSync(this.root,{recursive:true,mode:0o700});
      if(config){releaseOperations=acquireOperational(this.root);this.#operationalHeld=true;}
      const marker=join(this.root,'bve-v2-root.json'),dbPath=join(this.root,'workspace.sqlite');
      requireThat(!existsSync(dbPath)||existsSync(marker),'Existing database is not a BVE V2 root');
      if(!existsSync(marker))writeFileSync(marker,JSON.stringify({format:'bve-v2',version:1,createdAt:now()}),{mode:0o600,flag:'wx'});
      const authPath=join(this.root,'credentials.json');
      if(!existsSync(authPath))writeFileSync(authPath,JSON.stringify(Object.fromEntries(Object.keys(permissions).map(r=>[r,secret()]))),{mode:0o600,flag:'wx'});
      this.#credentials=JSON.parse(readFileSync(authPath));this.#workspaceHook('before-schema',{});
      this.#db=new DatabaseSync(dbPath);
      this.#db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
        CREATE TABLE IF NOT EXISTS records(kind TEXT NOT NULL,id TEXT NOT NULL,doc TEXT NOT NULL,PRIMARY KEY(kind,id));
        CREATE TABLE IF NOT EXISTS bytes(hash TEXT PRIMARY KEY, data BLOB NOT NULL);
        CREATE TABLE IF NOT EXISTS receipts(scope TEXT NOT NULL,key TEXT NOT NULL,fingerprint TEXT NOT NULL,doc TEXT NOT NULL,PRIMARY KEY(scope,key));`);
      chmodSync(dbPath,0o600);
      if(config&&!prior)this.#tx(()=>{this.#workspaceHook('before-connection-commit',{});this.#put('domainIntegration',{id:'active',schemaVersion:'3djat.integration.v1',config:clone(config),adoptionRevision:0});this.#db.exec('PRAGMA user_version=1');});
      if(config&&!prior)connectionCommitted=true;
      this.#workspaceHook('schema-committed',{});
    }catch(e){this.#db?.close();this.#closed=true;if(connectionCommitted)domainFail('CONNECTION_UNCERTAIN',{cause:e.code??'IO_FAILURE'});throw e;}
    finally{this.#operationalHeld=false;try{releaseOperations?.();}finally{releaseDomain?.();}}
    try {
      checkImportFormat(this.#db,this.root,{allowPromotion:imports?.experimentalPng20===true});
      if(operations&&info.hasRecords&&imports&&!this.#db.prepare("SELECT 1 FROM records WHERE kind='assetImportFormat' AND id='active'").get())
        domainFail('MIGRATION_REQUIRES_BACKUP');
      if(imports){requireThat(this.#workspace,'Imports require an explicit connected workspace',409);const releaseDomain=this.#workspace.lockDomain();let releaseOperations;
        try{releaseOperations=acquireOperational(this.root);this.#operationalHeld=true;installImportFormat(this.#db,this.root,{fresh:!info.hasRecords,backup:imports.migrationBackup,confirmedQuiescent:imports.confirmedQuiescent,tx:fn=>this.#tx(fn),experimentalPng20:imports.experimentalPng20,currentHead:this.#workspace.read().reference});}
        finally{this.#operationalHeld=false;try{releaseOperations?.();}finally{releaseDomain();}}
      }
      if(operations){
        domainCheck(this.#workspace&&templates&&products,'INVALID_SCOPE');
        const marker=JSON.parse(readFileSync(join(this.root,'bve-v2-root.json')));
        if(![4,5].includes(marker.version)){
          // An existing operational root requires a separate reviewed backup and
          // conversion. Only newly initialized authored roots enter v4 here.
          domainCheck([1,2,3].includes(marker.version),'UNSUPPORTED_SCHEMA');
          const releaseDomain=this.#workspace.lockDomain(),releaseOperations=acquireOperational(this.root);
          try{this.#operationalHeld=true;
            if(info.hasRecords){
              domainCheck(confirmedQuiescent===true&&typeof operationBackup==='string','MIGRATION_REQUIRES_BACKUP');
              const backup=verifyCombined(operationBackup),guard=new RootGuard(operationBackup);
              domainCheck(sameRef(backup.head,this.#workspace.read().reference)&&
                guard.read('runtime/bve-v2-root.json').equals(readFileSync(join(this.root,'bve-v2-root.json'))),'BACKUP_MISMATCH');
              const copy=new DatabaseSync(join(operationBackup,'runtime','workspace.sqlite'),{readOnly:true});
              try{domainCheck(databaseFingerprint(copy)===databaseFingerprint(this.#db),'BACKUP_MISMATCH');}finally{copy.close();}
            }
            this.#tx(()=>{
            this.#put('operationSelectionFormat',{id:'active',schemaVersion:'bve.operation-selection-format.v1',version:1});
            this.#db.exec('PRAGMA user_version=2');
          });const guard=new RootGuard(this.root),next={format:'bve-v2',version:4,
            features:marker.version===1?['operation-selection.v1']:marker.version===3?
              ['historical-import.v1','png20-experiment.v1','operation-selection.v1']:OPERATION_FEATURES};
            guard.write('operation-format-promotion.json',Buffer.from(JSON.stringify(next)+'\n'));
            renameSync(guard.locate('operation-format-promotion.json'),guard.locate('bve-v2-root.json'));guard.sync();
          }finally{this.#operationalHeld=false;releaseOperations();releaseDomain();}
        }
        this.#checkOperationFormat();
      }else{
        const marker=JSON.parse(readFileSync(join(this.root,'bve-v2-root.json')));
        domainCheck(![4,5].includes(marker.version),'UNSUPPORTED_SCHEMA');
      }
      {
        const marker=JSON.parse(readFileSync(join(this.root,'bve-v2-root.json')));
        if(marker.version===5)domainCheck(this.#serviceOptions,'CAPABILITY_UNAVAILABLE');
        if(this.#serviceOptions&&marker.version!==5){
          domainCheck(marker.version===4,'UNSUPPORTED_SCHEMA');
          const releaseDomain=this.#workspace.lockDomain(),releaseOperations=acquireOperational(this.root);
          try{this.#operationalHeld=true;
            if(info.hasRecords){
              domainCheck(confirmedQuiescent===true&&typeof serviceBackup==='string','MIGRATION_REQUIRES_BACKUP');
              const saved=verifyCombined(serviceBackup),guard=new RootGuard(serviceBackup);
              domainCheck(sameRef(saved.head,this.#workspace.read().reference)&&guard.read('runtime/bve-v2-root.json').equals(readFileSync(join(this.root,'bve-v2-root.json'))),'BACKUP_MISMATCH');
              const copy=new DatabaseSync(join(serviceBackup,'runtime/workspace.sqlite'),{readOnly:true});
              try{domainCheck(databaseFingerprint(copy)===databaseFingerprint(this.#db),'BACKUP_MISMATCH');}finally{copy.close();}
            }
            this.#tx(()=>{this.#put('serviceExecutionFormat',{id:'active',schemaVersion:'bve.deterministic-services.v1',version:1});this.#db.exec('PRAGMA user_version=3');});
            const guard=new RootGuard(this.root),next={format:'bve-v2',version:5,features:[...marker.features,'deterministic-service.v1']};
            guard.write('service-format-promotion.json',Buffer.from(JSON.stringify(next)+'\n'));
            renameSync(guard.locate('service-format-promotion.json'),guard.locate('bve-v2-root.json'));guard.sync();
          }finally{this.#operationalHeld=false;releaseOperations();releaseDomain();}
          this.#checkOperationFormat();
        }
        if(marker.version===5||this.#serviceOptions)verifyServiceRecords(this.#db);
      }
      if(recover)this.#tx(()=>{for(const j of this.#list('job'))if(j.state==='running'){j.state='uncertain';j.uncertainAt=now();j.reason='Owner stopped after durable invocation start; reconcile original assignment; no retry';this.#put('job',j);}});
      this.reconcile(this.#credentials.butler);
    }catch(e){this.close();throw e;}
  }
  close(){if(!this.#closed){this.#db.close();this.#mediaCache.clear();this.#mediaBytes=0;this.#closed=true;}}
  #checkOperationFormat(){
    const marker=JSON.parse(readFileSync(join(this.root,'bve-v2-root.json'))),version=this.#db.prepare('PRAGMA user_version').get().user_version;
    const check=validateOperationSelectionFormat(marker,version);
    domainCheck(check.ok,check.errors[0]?.code??'UNSUPPORTED_SCHEMA');
    const row=this.#get('operationSelectionFormat','active');
    domainCheck(isDeepStrictEqual(row,{id:'active',schemaVersion:'bve.operation-selection-format.v1',version:1}),'UNSUPPORTED_SCHEMA');
  }
  #importer(){
    requireThat(this.#workspace,'Imports require a connected workspace',409);this.#workspace.assertRuntime();
    if(!this.#imports)this.#imports=new AssetImports(this.#db,this.root,{sources:this.#importOptions?.sources??{},tx:fn=>this.#tx(fn),hook:(stage,detail)=>this.#workspaceHook(stage,detail),authenticate:token=>{
      let role;try{role=this.#role(token);}catch{return null;}const session=this.#session(token);return {id:session?'bve-session-'+session.id:'bve-'+role,role,products:session?[session.projectId]:'*'};
    },current:(productId,head,fn)=>{const release=this.#workspace.lockDomain();try{const view=this.#workspace.read(),p=this.#get('project',productId);domainCheck(sameRef(view.reference,head),'REVISION_CONFLICT');domainCheck(p.domainWorkspaceId===view.head.workspaceId&&view.head.products.some(x=>x.productId===productId),'INVALID_SCOPE');return fn(view);}finally{release();}}});
    return this.#imports;
  }
  assetCommand(token,packet){try{return this.#importer().command(token,packet);}catch(e){return importFailure(packet,e);}}
  importReview(token,importId){try{return this.#importer().review(token,importId);}catch(e){throw new Fault(e.code??'CAPABILITY_UNAVAILABLE',e.code==='INVALID_SCOPE'?403:409);}}
  importPortable(token,artifactId){try{return this.#importer().portable(token,artifactId);}catch(e){throw new Fault(e.code??'CAPABILITY_UNAVAILABLE',e.code==='INVALID_SCOPE'?403:409);}}
  inspectImportedOriginalSources(token,query){
    // Check all caller-owned data before native authentication, roots or SQLite.
    let nodes=0;
    const portable=(v,depth=0)=>{
      domainCheck(++nodes<=30000&&depth<=48,'VALIDATION_LIMIT');
      if(v===null||typeof v==='boolean'||typeof v==='number'&&Number.isFinite(v))return;
      if(typeof v==='string'){domainCheck(v.length<=20000,'INVALID_VALUE');return;}
      domainCheck(v&&typeof v==='object'&&!isProxy(v),'INVALID_VALUE');
      const array=Array.isArray(v),prototype=Object.getPrototypeOf(v);
      domainCheck(array?prototype===Array.prototype:[Object.prototype,null].includes(prototype),'INVALID_VALUE');
      const keys=Reflect.ownKeys(v);domainCheck(keys.length<=1024&&(!Array.isArray(v)||v.length<=256),'VALIDATION_LIMIT');
      for(const k of keys){if(Array.isArray(v)&&k==='length')continue;
        const d=Object.getOwnPropertyDescriptor(v,k);
        domainCheck(typeof k==='string'&&d?.enumerable&&Object.hasOwn(d,'value')&&
          (!Array.isArray(v)||/^(0|[1-9][0-9]*)$/.test(k)),'INVALID_VALUE');portable(d.value,depth+1);
      }
      if(Array.isArray(v))domainCheck(Object.keys(v).length===v.length,'INVALID_VALUE');
    };
    portable(query);
    domainCheck(query&&!Array.isArray(query)&&
      isDeepStrictEqual(Object.keys(query).sort(),['mode','atHead','projectId','sources','parentRoundId','parentArtifacts'].sort()),'INVALID_VALUE');
    domainCheck(query.mode==='historical','CAPABILITY_UNAVAILABLE');
    const requireShape=(kind,value)=>{const result=validate(kind,value);domainCheck(result.ok,result.errors[0]?.code??'INVALID_VALUE');};
    requireShape('revision-ref',query.atHead);
    // The existing command contract owns product UUID syntax.
    requireShape('artifact-ref',{productId:query.projectId,artifactId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      version:1,sha256:'0'.repeat(64),width:1,height:1});
    domainCheck(Array.isArray(query.sources)&&query.sources.length>=1&&query.sources.length<=6,'OUT_OF_BOUNDS');
    const seen=new Set();
    for(const source of query.sources){requireShape('source-artifact',source);
      domainCheck(source.artifact.productId===query.projectId,'INVALID_SCOPE');
      domainCheck(!seen.has(source.artifact.artifactId),'INVALID_VALUE');seen.add(source.artifact.artifactId);
      for(const region of source.regions)domainCheck(!Object.hasOwn(region,'reviewRegion'),'CAPABILITY_UNAVAILABLE');
    }
    domainCheck(query.parentRoundId===null&&Array.isArray(query.parentArtifacts)&&query.parentArtifacts.length===0,'CAPABILITY_UNAVAILABLE');
    const q=structuredClone(query);
    domainCheck(typeof token==='string'&&/^[0-9a-f]{64}$/.test(token),'INVALID_SCOPE');
    domainCheck(!this.#inTransaction&&!this.#operationalHeld,'CAPABILITY_UNAVAILABLE');
    const budget={bytes:0,originalBytes:0};
    const bound=(kind,id)=>{
      const x=this.#db.prepare('SELECT length(CAST(doc AS BLOB)) AS n FROM records WHERE kind=? AND id=?').get(kind,id);
      domainCheck(x,'MISSING_SOURCE');domainCheck(x.n<=1024**2&&budget.bytes+x.n<=8*1024**2,'VALIDATION_LIMIT');
      budget.bytes+=x.n;return this.#get(kind,id);
    };
    const session=()=>{
      const x=this.#db.prepare("SELECT count(*) AS n,coalesce(sum(length(CAST(doc AS BLOB))),0) AS size,coalesce(max(length(CAST(doc AS BLOB))),0) AS largest FROM records WHERE kind='sessionBinding'").get();
      domainCheck(x.n<=100000&&x.size<=8*1024**2-budget.bytes&&x.largest<=1024**2,'VALIDATION_LIMIT');
      budget.bytes+=x.size;
      let s;try{s=this.#session(token);}catch(e){if(e instanceof SyntaxError)domainFail('EVIDENCE_MISMATCH');throw e;}
      domainCheck(s&&s.role==='conductor'&&s.tier==='SOL'&&s.projectId===q.projectId&&s.revokedAt===null,'INVALID_SCOPE');
      return s;
    };
    const initial=session();
    domainCheck(this.#workspace,'INVALID_SCOPE');this.#workspace.assertRuntime();
    const release=this.#workspace.lockDomain();
    try{return this.#tx(()=>{
      const initialChanges=this.#db.prepare('SELECT total_changes() AS n').get().n;
      const selectedRows=[];
      const selected=()=>{
        const current=this.#workspace.read();
        const head=current.records.get(q.atHead.path);
        domainCheck(head?.kind==='domain-head'&&sameRef(head.reference,q.atHead),'MISSING_SOURCE');
        const old=this.#workspace.store.read({atHead:q.atHead});
        domainCheck(sameRef(old.reference,q.atHead)&&old.head.workspaceId===this.#workspace.config.workspaceId&&
          old.head.products.some(p=>p.productId===q.projectId),'INVALID_SCOPE');
        return {current:current.reference,head:old.reference};
      };
      const pinned=selected(),workspaceId=this.#workspace.config.workspaceId;
      const connection=bound('domainIntegration','active'),project=bound('project',q.projectId);
      domainCheck(connection.schemaVersion==='3djat.integration.v1'&&
        isDeepStrictEqual(connection.config,this.#workspace.config)&&project.domainWorkspaceId===workspaceId&&
        initial.projectId===project.id,'INVALID_SCOPE');
      const format=()=>{
        for(const [kind,id] of [['assetImportFormat','active'],['pngExperimentFormat','active']]){
          const x=this.#db.prepare('SELECT length(CAST(doc AS BLOB)) AS n FROM records WHERE kind=? AND id=?').get(kind,id);
          if(x){domainCheck(x.n<=1024**2&&budget.bytes+x.n<=8*1024**2,'VALIDATION_LIMIT');budget.bytes+=x.n;}
        }
        domainCheck(this.#db.prepare('PRAGMA user_version').get().user_version===(this.#operations?2:1),'UNSUPPORTED_SCHEMA');
        checkImportFormat(this.#db,this.root);
      };
      format();
      const checkpoint=stage=>{
        this.#workspaceHook(stage,{projectId:q.projectId});
        const s=session();domainCheck(s.id===initial.id&&s.sessionId===initial.sessionId&&
          s.tokenHash===initial.tokenHash,'INVALID_SCOPE');
        this.#workspace.assertRuntime();
        const current=selected();domainCheck(sameRef(current.current,pinned.current)&&sameRef(current.head,pinned.head),'HEAD_CHANGED');
        domainCheck(isDeepStrictEqual(bound('domainIntegration','active'),connection)&&
          isDeepStrictEqual(bound('project',q.projectId),project),'EVIDENCE_MISMATCH');
        format();
      };
      const sources=[];
      for(const source of q.sources){checkpoint('before-imported-original-proof');
        const proof=inspectCommittedImport(this.#db,this.root,source.artifact,workspaceId,budget,checkpoint,selectedRows);
        sources.push({source,import:{importId:proof.importId,declaration:proof.declaration,stageReceipt:proof.stageReceipt,
          commitReceipt:proof.commitReceipt,artifactReference:proof.artifactReference,origin:proof.origin},bytes:proof.bytes});
      }
      checkpoint('before-imported-original-return');
      // Selected rows remain immutable for the entire inspection, including
      // owner hooks after the per-source byte check. No original BLOB is refetched.
      for(const row of selectedRows){
        const where=row.table==='records'?'kind=? AND id=?':'scope=? AND key=?';
        const current=this.#db.prepare(`SELECT ${row.table==='receipts'?'fingerprint,':''}doc FROM ${row.table} WHERE ${where}`).get(...row.keys);
        domainCheck(current?.doc===row.raw&&(row.table!=='receipts'||current.fingerprint===row.fingerprint),'EVIDENCE_MISMATCH');
      }
      domainCheck(this.#db.prepare('SELECT total_changes() AS n').get().n===initialChanges,'EVIDENCE_MISMATCH');
      const result={schemaVersion:'3djat.imported-original-inspection.v1',mode:'historical',head:pinned.head,
        workspaceId,projectId:q.projectId,principalId:'bve-session-'+initial.id,authority:'not-established',
        freshAcceptance:false,historicalClaims:'unverified',sources};
      const stable=JSON.stringify(result,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?
        Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v)+'\n';
      domainCheck(Buffer.byteLength(stable)<=1024**2,'VALIDATION_LIMIT');
      domainCheck(this.#db.prepare('SELECT total_changes() AS n').get().n===initialChanges,'EVIDENCE_MISMATCH');return clone(result);
    });}finally{release();}
  }
  #tx(fn){
    if(this.#inTransaction)return fn();
    this.#workspace?.assertRuntime();const release=this.#workspace&&!this.#operationalHeld?acquireOperational(this.root):null;
    try{this.#db.exec('BEGIN IMMEDIATE');this.#inTransaction=true;try{const v=fn();this.#db.exec('COMMIT');return v;}catch(e){try{this.#db.exec('ROLLBACK');}catch{}throw e;}finally{this.#inTransaction=false;}}
    finally{release?.();}
  }
  #list(kind){return this.#db.prepare('SELECT doc FROM records WHERE kind=? ORDER BY rowid').all(kind).map(x=>JSON.parse(x.doc));}
  #get(kind,key){const row=this.#db.prepare('SELECT doc FROM records WHERE kind=? AND id=?').get(kind,key);requireThat(row,`Missing ${kind}: ${key}`,404);return JSON.parse(row.doc);}
  #put(kind,v){this.#db.prepare('INSERT INTO records VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET doc=excluded.doc').run(kind,v.id,JSON.stringify(v));return v;}
  #session(token){return this.#list('sessionBinding').find(s=>!s.revokedAt&&['conductor','butler','worker'].includes(s.role)&&s.tier===(s.role==='conductor'?'SOL':'LUNA')&&equal(hash(token??''),s.tokenHash));}
  #role(token){const session=this.#session(token);if(session)return session.role;const role=Object.keys(this.#credentials).find(r=>equal(token,this.#credentials[r]));requireThat(role,'Invalid function credential',403);return role;}

  // Installation is a trusted local-owner API, deliberately absent from HTTP.
  // Session bearers expose only the three existing functional roles in one project.
  #owner(owner){requireThat(['conductor','generator','butler'].every(r=>equal(owner?.[r],this.#credentials[r])),'Local installation credentials required',403);}
  #folder(project,create=false,unavailable=false){
    if(this.#workspace)return this.#workspace.folder(project,{create,unavailable});
    const folder=join(this.root,'Projects',project.id);if(create)mkdirSync(folder,{recursive:true,mode:0o700});return folder;
  }
  projectFolder(projectId){return this.#folder(this.#get('project',projectId));}
  #currentDomain(){
    if(!this.#workspace)return null;let cacheCommitPossible=false,verifiedHead=null;const cachedRow=this.#db.prepare("SELECT doc FROM records WHERE kind='domainProjection' AND id=?").get(this.#workspace.config.workspaceId);let cached=null;try{cached=cachedRow?JSON.parse(cachedRow.doc):null;}catch{}if(cached?.id!==this.#workspace.config.workspaceId||cached?.schemaVersion!=='3djat.projection.v1')cached=null;
    try{const view=this.#workspace.read(),p=projection(view);verifiedHead=view.reference;
      if(JSON.stringify(cached)!==JSON.stringify(p))this.#tx(()=>{this.#workspaceHook('before-cache-commit',{head:view.reference});putProjection(this.#db,view);cacheCommitPossible=true;});
      this.#workspaceHook('after-cache-commit',{head:view.reference});return {status:'current',projection:p};
    }catch(e){return {status:'stale',cause:e.code??'IO_FAILURE',verifiedHead,cacheCommitPossible,projection:cached};}
  }
  #projectView(p){
    if(!p.domainWorkspaceId)return {...p,folder:this.#folder(p)};
    const current=this.#currentDomain(),entry=Array.isArray(current?.projection?.products)?current.projection.products.find(x=>x.record?.productId===p.id):null,record=entry?.record;
    return {...p,name:record?.workingName??p.id,productCode:record?.productCode??null,folder:this.#folder(p,false,current?.status!=='current'),
      domain:{status:current?.status??'stale',cause:current?.cause??null,head:current?.projection?.head??null,reference:entry?.reference??null,record:record??null}};
  }
  #requireDomain(projectId){const p=this.#get('project',projectId);if(p.domainWorkspaceId){const current=this.#currentDomain();domainCheck(current?.status==='current','DOMAIN_UNAVAILABLE',{cause:current?.cause});}}
  refreshDomain(owner){this.#owner(owner);requireThat(this.#workspace,'No explicit workspace connection',409);return clone(this.#currentDomain());}
  #copyProductAction(event){return this.#tx(()=>{
    const doc=JSON.stringify(event,Object.keys(event).sort()),prior=this.#db.prepare("SELECT doc FROM records WHERE kind='event' AND id=?").get(event.id);
    domainCheck(!prior||prior.doc===doc,'EVIDENCE_MISMATCH');if(!prior)this.#db.prepare("INSERT INTO records VALUES('event',?,?)").run(event.id,doc);
  });}
  #productWriter(){
    requireThat(this.#workspace&&this.#productOptions,'Product workflow is not explicitly configured',409);this.#workspace.assertRuntime();
    for(const entry of Object.values(this.#productOptions.attachmentSources??{})){
      domainCheck(typeof entry?.root==='string','INVALID_VALUE');const source=resolve(entry.root),runtime=resolve(this.root);
      domainCheck(source!==runtime&&!source.startsWith(runtime+'/')&&!source.startsWith(runtime+'\\')&&!runtime.startsWith(source+'/')&&!runtime.startsWith(source+'\\'),'UNSAFE_PATH');
    }
    if(!this.#products){this.#workspace.read();domainCheck(Object.keys(this.#productOptions).every(k=>['accessFile','attachmentSources'].includes(k))&&typeof this.#productOptions.accessFile==='string','INVALID_VALUE');
      const rel=resolve(this.#productOptions.accessFile);domainCheck(rel!==this.root&&!rel.startsWith(this.root+'/')&&!rel.startsWith(this.root+'\\'),'UNSAFE_PATH');
      const writer=new DomainProducts(this.#workspace.config.domainRoot,{accessFile:rel,authenticate:token=>{
        let role;try{role=this.#role(token);}catch{return null;}const session=this.#session(token);
        if(!['human','conductor','butler'].includes(role))return null;
        return {id:session?'bve-session-'+session.id:'bve-'+role,role,products:session?[session.projectId]:'*',sourceIds:[]};
      },attachmentSources:this.#productOptions.attachmentSources??{},beforePublish:event=>this.#copyProductAction(event),hook:(stage,detail)=>this.#workspaceHook('products:'+stage,detail)});this.#workspace.read();this.#products=writer;
    }return this.#products;
  }
  productReview(token,query){try{return clone(this.#productWriter().readReview(token,query));}catch(e){throw new Fault(e.code??'Product review unavailable',e.code==='INVALID_SCOPE'?403:409);}}
  productIndex(token){
    requireThat(this.#role(token)==='human'&&!this.#session(token),'Products require a human owner',403);
    const writer=this.#productWriter(),view=this.#workspace.read(),artifacts=this.read(token,'artifact');
    const grant=access(this.#productOptions.accessFile).principals.find(p=>p.id==='bve-human'&&p.role==='human');
    requireThat(grant,'Product access is unavailable',403);
    const products=view.head.products.filter(({productId})=>grant.products==='*'||grant.products.includes(productId)).map(({productId})=>{
      try{
        const review=writer.readReview(token,{productId,atHead:view.reference}),record=review.product.record;
        return {productId,workingName:record.workingName,productCode:record.productCode,revision:record.revision,
          importedCount:artifacts.filter(a=>a.projectId===productId&&a.origin==='import').length,
          attachmentCount:review.attachments.length,contentCount:review.dossierExtension.records.length,
          pendingCount:review.proposals.filter(p=>p.status==='pending').length+review.dossierExtension.proposals.filter(p=>p.status==='pending').length,
          unknownCount:Object.values(record.facts).filter(f=>f.state==='unknown').length+Object.values(review.dossierExtension.fields).filter(f=>f.state==='unknown').length,
          unavailableCount:review.attachments.filter(a=>a.current.status!=='available').length};
      }catch(e){return {productId,status:'unavailable',cause:e.code??'READ_UNAVAILABLE'};}
    });
    const currentGrant=access(this.#productOptions.accessFile).principals.find(p=>p.id==='bve-human'&&p.role==='human');
    requireThat(currentGrant&&isDeepStrictEqual(currentGrant,grant),'Product access changed during read',409);
    domainCheck(sameRef(this.#workspace.read().reference,view.reference),'HEAD_CHANGED');
    return clone({schemaVersion:'3djat.products-ui.v1',head:view.reference,workspaceId:view.head.workspaceId,products});
  }
  productActionReference(token,packet){
    requireThat(this.#role(token)==='human'&&!this.#session(token),'Only the human owner can prepare a decision',403);
    requireThat(['product.proposal.decide','product.dossier.proposal.decide'].includes(packet?.operation),'Invalid decision',400);
    const view=this.#workspace.read(),head=view.reference;
    this.#productWriter().readReview(token,{productId:packet.input.productId,atHead:head});
    domainCheck(sameRef(packet.expected?.domainHead,head),'REVISION_CONFLICT');
    return clone(decisionActionReference({workspaceId:view.head.workspaceId,principalId:'bve-human',packet}));
  }
  #templateWriter(){
    requireThat(this.#workspace&&this.#templateOptions,'Template registry is not explicitly configured',409);this.#workspace.assertRuntime();
    if(!this.#templates)this.#templates=new DomainTemplates(this.#workspace.config.domainRoot,{accessFile:this.#templateOptions.accessFile,authenticate:token=>{
      let role;try{role=this.#role(token);}catch{return null;}const session=this.#session(token);if(!['human','conductor'].includes(role))return null;
      return {id:session?'bve-session-'+session.id:'bve-'+role,role,products:session?[session.projectId]:'*'};
    },resolvePromotion:(token,packet)=>this.#calibrationPromotion(token,packet),hook:(stage,detail)=>this.#workspaceHook('templates:'+stage,detail)});return this.#templates;
  }

  #calibrationPlan(experimentId){const p=this.#get('calibrationPlan',experimentId);cal.check(p.sha256===cal.digest(p.body));return p.body;}
  #calibrationAuthorize(token,p){
    const head=this.#contentAuthority(token,p.record.productId);
    // Exact historical adoption remains attributable; current grants/source bytes are rechecked.
    const adopted=this.#templateWriter().resolveAdoptedForOperation(token,{mode:'historical',atHead:p.preparation.head,projectId:p.record.productId,
      applicability:p.scope,operationTemplateId:p.preparation.operation.reference.id,branded:!!p.preparation.brand,brandTemplateId:p.preparation.brand?.reference.id??null});
    cal.check([...adopted.sourceStatus.operation,...(adopted.sourceStatus.brand??[])].every(s=>s.status==='verified'),'MISSING_SOURCE');
    const registry=this.#templateWriter().readRegistry(token,{schemaVersion:'3djat.template-query.v1',kind:'template',atHead:head,templateId:p.templates[0].reference.id});
    for(const t of p.templates){const r=registry.data.revisions.find(r=>cal.same(r.reference,t.reference));cal.check(r&&cal.same(r.record,t.record)&&r.sources.every(s=>s.status==='verified'));}
    const budget={bytes:0,originalBytes:0};for(const a of p.record.commonSources)this.#selectionSource(a,p.record.productId,budget);
    return head;
  }
  #calibrationFence(requestId){
    const request=this.#get('request',requestId);if(!request.calibrationId)return;
    const p=this.#calibrationPlan(request.calibrationId);
    cal.check(request.projectId===p.record.productId&&request.count===3&&request.direction==='Fresh'&&request.brand===(p.preparation.brand?.record.instructions??null)&&request.intent===p.record.commonIntent);
    const binding=this.#list('sessionBinding').find(s=>!s.revokedAt&&s.role==='conductor'&&s.projectId===request.projectId);
    cal.check(binding,'INVALID_SCOPE');
    // The bound bearer is private and never synthesized from caller claims.
    this.#calibrationAuthorize(binding.token,p);
    if(request.iterationId){const iteration=this.#get('iteration',request.iterationId);cal.check(iteration.jobIds.length===3);
      iteration.jobIds.forEach((id,n)=>cal.frozenSpecification(p,this.#get('job',id),n));}
    return p;
  }
  calibrationActionAbsent(token,packet){
    cal.check(this.#role(token)==='human'&&!this.#session(token),'INVALID_SCOPE');
    cal.check(['create','review','propose','revise','promotion'].includes(packet?.action),'INVALID_SCOPE');cal.words(packet.key,200);
    return !this.#db.prepare('SELECT 1 FROM receipts WHERE scope=? AND key=?').get('calibration.'+packet.action+':bve-human',packet.key);
  }
  calibration(token,packet){
    cal.fields(packet,['action','key','input']);cal.words(packet.key,200);
    const {action,key,input:x}=packet,session=this.#session(token),role=this.#role(token);
    if(action==='commit'){
      cal.fields(x,['experimentId']);const p=this.#calibrationPlan(x.experimentId);
      cal.check(role==='butler'&&session&&session.projectId===p.record.productId,'INVALID_SCOPE');
      return this.#tx(()=>this.#once('calibration.commit:'+session.id,key,x,()=>this.#commitCalibration(p,session)));
    }
    cal.check(role==='human'&&!session,'INVALID_SCOPE');
    if(action==='view'){
      cal.fields(x,['productId']);this.#contentAuthority(token,x.productId);
      const plans=this.#list('calibrationPlan').filter(r=>r.body.record.productId===x.productId).map(r=>{
        const p=this.#calibrationPlan(r.id);this.#calibrationAuthorize(token,p);
        const result=this.#list('calibrationResult').some(r=>r.id===p.id)?this.#calibrationResult(p):null,request=this.#get('request',p.requestId),round=this.#list('round').find(r=>r.requestId===p.requestId);
        const registry=this.templateReview(token,{schemaVersion:'3djat.template-query.v1',kind:'template',atHead:this.#workspace.read().reference,templateId:p.templates[0].reference.id});
        const promoted=registry.data.decisions.filter(d=>d.record.action==='promote'&&cal.same(d.record.experiment,result?.reference));
        return {plan:p,result,request,promotions:promoted,round:round?this.#roundView(round):null,specifications:cal.specifications(p),
          reviews:this.#list('calibrationReview').filter(r=>r.experimentId===p.id),
          proposals:this.#list('calibrationProposal').filter(r=>r.experimentId===p.id),
          statuses:{contract:'valid',operational:result?.record.lifecycle??'pending',visual:'untested',human:promoted.length?(promoted.some(d=>d.activeAppliesTo.includes('instagram-artistic'))?'adopted for Instagram artistic':'superseded'):result?'awaiting approval':'not requested'},
          provenance:'Authored protocol evidence does not establish native creative quality or visual acceptance.'};});
      return clone({experiments:plans});
    }
    if(action==='prepare'){
      cal.fields(x,['productId','applicability','operationTemplateId','branded','brandTemplateId']);
      const preparation=this.operationPreparation(token,x);
      cal.check(preparation.operation.record.launch?.executionKind==='generative','INVALID_SCOPE');
      const registry=this.templateReview(token,{schemaVersion:'3djat.template-query.v1',kind:'template',atHead:preparation.head,templateId:x.operationTemplateId});
      return {preparation,variants:registry.data.revisions.filter(r=>r.record.kind==='operation'&&r.record.appliesTo.includes('instagram-artistic')&&r.sources.every(s=>s.status==='verified'))};
    }
    if(action==='create'){
      cal.fields(x,['preparation','record','previousExperiment','revisionLink']);
      cal.check(['artistic','instagram-artistic'].includes(x.preparation?.applicability),'INVALID_SCOPE');
      cal.shape('calibration',x.record);cal.check(x.record.revision===1&&x.record.lifecycle==='draft'&&x.record.receipt===null&&x.record.variants.length===3&&
        x.record.variants.every(v=>v.outcome==='draft'&&v.roundId===null&&v.outputs.length===0&&v.failureCode===null)&&
        new Set(x.record.variants.map(v=>cal.digest(v.template))).size===3,'INVALID_SCOPE');
      const productId=x.record.productId;this.#contentAuthority(token,productId);
      const release=this.#workspace.lockDomain();try{return this.#tx(()=>this.#once('calibration.create:bve-human',key,x,()=>{
        cal.check(!this.#list('calibrationPlan').some(p=>p.id===x.record.experimentId),'IDEMPOTENCY_CONFLICT');
        const prep=x.preparation,q={productId,applicability:prep.applicability,operationTemplateId:prep.operationTemplateId,branded:prep.branded,brandTemplateId:prep.brandTemplateId};
        cal.fields(prep,['applicability','operationTemplateId','branded','brandTemplateId','atHead']);
        const selected=this.operationPreparation(token,q);cal.check(cal.same(selected.head,prep.atHead),'REVISION_CONFLICT');
        const registry=this.templateReview(token,{schemaVersion:'3djat.template-query.v1',kind:'template',atHead:selected.head,templateId:prep.operationTemplateId});
        const templates=x.record.variants.map(v=>{const r=registry.data.revisions.find(r=>cal.same(r.reference,v.template));
          cal.check(r&&r.record.kind==='operation'&&r.record.appliesTo.includes('instagram-artistic')&&r.record.launch?.executionKind==='generative'&&r.sources.every(s=>s.status==='verified'),'EVIDENCE_MISMATCH');
          cal.check(cal.same(r.record.inputs,selected.operation.record.inputs)&&cal.same(r.record.outputs,selected.operation.record.outputs),'INVALID_SCOPE');
          cal.check(r.record.outputs.length===1&&r.record.outputs[0].role==='candidate','INVALID_SCOPE');
          // Common settings must be declared, typed, and within every variant's bounds.
          for(const [name,value] of Object.entries(x.record.commonSettings)){const def=r.record.exploration?.parameters?.[name];cal.check(def,'INVALID_VALUE');
            cal.check(def.type==='boolean'?typeof value==='boolean':def.type==='enum'?def.values.includes(value):typeof value==='number'&&Number.isFinite(value)&&value>=def.min&&value<=def.max,'INVALID_VALUE');}
          return {reference:r.reference,record:r.record};});
        cal.check(x.record.commonSources.length===1&&x.record.commonSources[0].productId===productId,'INVALID_SCOPE');
        this.#selectionSource(x.record.commonSources[0],productId,{bytes:0,originalBytes:0});
        const required=selected.operation.record.inputs.filter(i=>i.required);cal.check(required.length===1&&required[0].kind==='verified-image','INVALID_SCOPE');
        let previous=null;
        if(x.previousExperiment){previous=this.#calibrationPlan(x.previousExperiment);this.#calibrationAuthorize(token,previous);
          cal.check(this.#list('calibrationResult').some(r=>r.id===previous.id)&&this.#list('calibrationReview').some(r=>r.experimentId===previous.id),'EVIDENCE_MISMATCH');
          cal.check(cal.same(previous.record.commonSources,x.record.commonSources)&&cal.same(previous.record.commonSettings,x.record.commonSettings)&&previous.record.commonIntent===x.record.commonIntent&&
            previous.record.seed===x.record.seed&&previous.record.executorId===x.record.executorId&&previous.record.executorVersion===x.record.executorVersion&&cal.same(previous.preparation.brand,selected.brand),'EVIDENCE_MISMATCH');
          const link=this.#get('calibrationProposal',x.revisionLink);cal.check(link.experimentId===previous.id&&link.kind==='revision'&&link.reference&&
            templates.some(t=>cal.same(t.reference,link.reference))&&previous.templates.filter(t=>!cal.same(t.reference,link.original)).every(t=>templates.some(s=>cal.same(t.reference,s.reference))),'EVIDENCE_MISMATCH');
        }else cal.check(x.revisionLink===null,'INVALID_VALUE');
        const request=this.#request({projectId:productId,intent:x.record.commonIntent,count:3,direction:'Fresh',brand:selected.brand?.record.instructions??null});
        request.calibrationId=x.record.experimentId;this.#put('request',request);
        const body={id:x.record.experimentId,record:x.record,scope:prep.applicability,preparation:selected,templates,
          sources:[{artifact:x.record.commonSources[0],role:required[0].role,regions:[]}],requestId:request.id,previousExperiment:x.previousExperiment,revisionLink:x.revisionLink};
        this.#put('calibrationPlan',{id:body.id,body,sha256:cal.digest(body)});
        return {experimentId:body.id,requestId:request.id,plan:cal.ref('calibration-plan',body),state:'waiting-for-conductor'};
      }));}finally{release();}
    }
    cal.check(['review','propose','revise','promotion'].includes(action),'INVALID_SCOPE');
    const p=this.#calibrationPlan(x.experimentId);this.#calibrationAuthorize(token,p);
    if(action==='review'){
      cal.fields(x,['experimentId','comments','selectedVariant']);cal.words(x.comments);cal.check(p.templates.some(t=>cal.same(t.reference,x.selectedVariant)));
      const e=this.#calibrationResult(p),v=e.record.variants.find(v=>cal.same(v.template,x.selectedVariant));cal.check(v?.outcome==='completed','CAPABILITY_UNAVAILABLE');
      return this.#tx(()=>this.#once('calibration.review:bve-human',key,x,()=>{
        const row={id:id(),experimentId:p.id,experiment:e.reference,comments:x.comments,selectedVariant:x.selectedVariant,actor:'bve-human',reviewedAt:now()};
        row.reference=cal.ref('calibration-review',row);this.#put('calibrationReview',row);return row;
      }));
    }
    if(action==='propose'||action==='revise'){
      cal.fields(x,['experimentId','original','instructions','reason']);cal.words(x.instructions);cal.words(x.reason);
      cal.check(p.templates.some(t=>cal.same(t.reference,x.original))&&this.#list('calibrationReview').some(r=>r.experimentId===p.id),'EVIDENCE_MISMATCH');
      const row=this.#tx(()=>this.#once('calibration.'+action+':bve-human',key,x,()=>{
        const base=p.templates.find(t=>cal.same(t.reference,x.original)),head=this.#workspace.read().reference;
        const view=this.templateReview(token,{schemaVersion:'3djat.template-query.v1',kind:'template',atHead:head,templateId:x.original.id}),latest=view.data.revisions.at(-1);
        const template={...clone(base.record),revision:latest.record.revision+1,supersedes:latest.reference,instructions:x.instructions,title:base.record.title+' revised'};
        const proposal={id:id(),experimentId:p.id,kind:action==='revise'?'revision':'proposal',original:x.original,instructions:x.instructions,reason:x.reason,createdAt:now(),
          packet:{schemaVersion:'3djat.command.v1',operation:'template.ingest',key,expected:{domainHead:head,entityRevision:latest.record.revision},input:template}};
        this.#put('calibrationProposal',proposal);return proposal;
      }));
      if(action==='propose')return row; // A later adjustment is a proposal only.
      const result=this.templateCommand(token,row.packet);cal.check(result.schemaVersion==='3djat.result.v1',result.error?.code??'CAPABILITY_UNAVAILABLE');
      this.#tx(()=>this.#put('calibrationProposal',{...row,reference:result.reference,receipt:result.receipt}));return {...row,reference:result.reference,receipt:result.receipt};
    }
    cal.fields(x,['experimentId','reviewId','template','reason']);cal.words(x.reason);
    const e=this.#calibrationResult(p),review=this.#get('calibrationReview',x.reviewId);
    cal.check(review.experimentId===p.id&&cal.same(review.selectedVariant,x.template),'EVIDENCE_MISMATCH');
    const variant=e.record.variants.find(v=>cal.same(v.template,x.template));cal.check(variant?.outcome==='completed','CAPABILITY_UNAVAILABLE');
    const head=this.#workspace.read().reference,registry=this.templateReview(token,{schemaVersion:'3djat.template-query.v1',kind:'template',atHead:head,templateId:x.template.id});
    // Preserve exact packet/key on lost response. Preparing is itself a durable human intent.
    return this.#tx(()=>this.#once('calibration.promotion:bve-human',key,x,()=>{
      const input={schemaVersion:'3djat.template-decision.v1',decisionId:id(),template:x.template,action:'promote',purpose:'Instagram artistic calibration',appliesTo:['instagram-artistic'],
        expectedRevision:registry.data.decisionSequence,experiment:e.reference,outputs:variant.outputs.map(o=>o.artifact),evidenceReceipt:e.record.receipt,
        humanActionReceipt:{id:'placeholder',revision:1,path:'placeholder.json',sha256:'0'.repeat(64)},decidedAt:now(),supersedesDecision:registry.data.streamTail,reason:x.reason};
      const packet={schemaVersion:'3djat.command.v1',operation:'template.promote',key,expected:{domainHead:head,entityRevision:registry.data.decisionSequence},input};
      input.humanActionReceipt=templateDecisionActionReference({workspaceId:this.#workspace.config.workspaceId,principalId:'bve-human',packet});return packet;
    }));
  }
  #calibrationResult(p){
    const e=this.#get('calibrationResult',p.id);cal.check(cal.same(e.reference,cal.ref('calibration', {id:p.id,...e.record},2)));
    const receipt=this.#get('calibrationReceipt',e.record.receipt.id);cal.check(cal.same(e.record.receipt,cal.ref('calibration-receipt',receipt)));
    cal.check(receipt.planSha256===cal.digest(p)&&cal.same(receipt.variants,e.record.variants));
    const round=this.#get('round',receipt.roundId);cal.check(round.requestId===p.requestId);
    const iteration=this.#get('iteration',round.iterationId);cal.check(iteration.jobIds.length===p.templates.length);
    for(const [n,v] of e.record.variants.entries()){cal.check(cal.same(v.template,p.templates[n].reference));
      for(const o of v.outputs){const j=this.#get('job',o.jobId);cal.check(j.roundId===receipt.roundId&&v.roundId===receipt.roundId&&iteration.jobIds[n]===o.jobId);cal.frozenSpecification(p,j,n);cal.check(cal.same(o.variant,v.template)&&j.artifactId===o.artifact.artifactId);
        this.#selectionSource(o.artifact,p.record.productId,{bytes:0,originalBytes:0});
        const d=this.#get('delivery',this.#get('artifact',o.artifact.artifactId).deliveryId);cal.check(cal.same(o.receipt,cal.ref('calibration-delivery', {id:d.id,...d})));}}
    return e;
  }
  #commitCalibration(p,session){
    const existing=this.#list('calibrationResult').find(r=>r.id===p.id);if(existing)return this.#calibrationResult(p);
    const request=this.#get('request',p.requestId),r=this.#list('round').find(r=>r.requestId===request.id);
    cal.check(r&&r.butler.bindingId===session.id&&r.iterationId,'INVALID_SCOPE');
    this.#calibrationFence(p.requestId);
    const checkpoint=this.#list('checkpoint').find(c=>c.roundId===r.id),presentation=this.#list('presentation').filter(s=>s.roundId===r.id).at(-1);
    cal.check(checkpoint&&presentation,'CAPABILITY_UNAVAILABLE');
    const iteration=this.#get('iteration',r.iterationId);
    const variants=iteration.jobIds.map((jobId,n)=>{
      const j=this.#get('job',jobId);cal.frozenSpecification(p,j,n);const outputs=[];
      if(j.state==='succeeded'){
        const a=this.#get('artifact',j.artifactId),ar=cal.artifact(a);
        this.#selectionSource(ar,p.record.productId,{bytes:0,originalBytes:0});
        cal.check(presentation.references.some(r=>r.artifactId===a.id&&r.sha256===a.sha256&&r.version===a.version),'EVIDENCE_MISMATCH');
        const d=this.#get('delivery',a.deliveryId);
        outputs.push({variant:p.templates[n].reference,artifact:ar,jobId,receipt:cal.ref('calibration-delivery',{id:d.id,...d})});
      }
      return {template:p.templates[n].reference,roundId:r.id,outcome:outputs.length?'completed':j.state==='failed'?'failed':'blocked',outputs,failureCode:outputs.length?null:j.state==='failed'?'GENERATION_FAILED':'CAPABILITY_UNAVAILABLE'};
    });
    const lifecycle=variants.every(v=>v.outcome==='completed')?'completed':variants.some(v=>v.outcome==='completed')?'partial':variants.some(v=>v.outcome==='failed')?'failed':'blocked';
    const receipt={id:id(),experimentId:p.id,planSha256:cal.digest(p),roundId:r.id,checkpointId:checkpoint.id,variants,committedAt:now()};
    const record={...p.record,revision:2,lifecycle,variants,receipt:cal.ref('calibration-receipt',receipt)};cal.shape('calibration',record);
    const result={id:p.id,record,reference:cal.ref('calibration',{id:p.id,...record},2)};
    this.#put('calibrationReceipt',receipt);this.#put('calibrationResult',result);return result;
  }
  #calibrationPromotion(token,packet){
    const entry=this.#list('calibrationResult').find(e=>cal.same(e.reference,packet.input.experiment));cal.check(entry,'EVIDENCE_MISMATCH');
    const p=this.#calibrationPlan(entry.id);this.#calibrationAuthorize(token,p);const e=this.#calibrationResult(p);
    cal.check(packet.input.appliesTo.length===1&&packet.input.appliesTo[0]==='instagram-artistic'&&
      this.#list('calibrationReview').some(r=>r.experimentId===p.id&&cal.same(r.selectedVariant,packet.input.template)),'INVALID_SCOPE');
    const variant=e.record.variants.find(v=>cal.same(v.template,packet.input.template));
    cal.check(variant?.outcome==='completed'&&cal.same(packet.input.outputs,variant.outputs.map(o=>o.artifact))&&cal.same(packet.input.evidenceReceipt,e.record.receipt),'EVIDENCE_MISMATCH');
    return {reference:e.reference,record:e.record};
  }

  #businessReader(){
    requireThat(this.#workspace&&this.#businessOptions?.accessFile,'Business reader is not configured',409);
    if(!this.#business)this.#business=new DomainBusiness(this.#workspace.config.domainRoot,{
      accessFile:this.#businessOptions.accessFile,authenticate:token=>{
        let role;try{role=this.#role(token);}catch{return null;}
        const session=this.#session(token);
        return {id:session?'bve-session-'+session.id:'bve-'+role,role,products:session?'*':'*',sourceIds:[]};
      },hook:(stage,detail)=>this.#workspaceHook('business:'+stage,detail)});
    return this.#business;
  }
  businessCommand(token,packet){
    let writer;try{writer=this.#businessReader();}catch(e){return DomainProducts.failure(packet,e);}
    const result=writer.command(token,packet);if(result.schemaVersion==='3djat.failure.v1')return clone(result);
    try{for(const event of writer.operationalEvidence())this.#copyProductAction(event);
      domainCheck(this.#currentDomain().status==='current','ACK_PENDING');return clone(result);
    }catch(e){return DomainProducts.failure(packet,e,result.receipt);}
  }
  #selectionSource(ref,projectId,budget){
    const a=this.#get('artifact',ref.artifactId);
    domainCheck(a.id===ref.artifactId&&a.projectId===projectId&&a.version===ref.version&&
      a.sha256===ref.sha256&&a.width===ref.width&&a.height===ref.height,'EVIDENCE_MISMATCH');
    if(a.origin==='import'){
      verifyImportedArtifact(this.#db,a);
      const proof=inspectCommittedImport(this.#db,this.root,ref,this.#workspace.config.workspaceId,budget,()=>{});
      domainCheck(proof.bytes.status==='verified','MISSING_SOURCE');
    }
    else{
      domainCheck(a.origin===undefined||a.origin==='produced','UNSUPPORTED_SCHEMA');
      const j=this.#get('job',a.jobId),i=this.#get('iteration',a.iterationId),d=this.#get('delivery',a.deliveryId);
      const assignment=this.#get('assignment',a.assignmentId);
      domainCheck(j.projectId===projectId&&j.iterationId===i.id&&i.jobIds.includes(j.id)&&j.artifactId===a.id&&j.state==='succeeded'&&
        j.invocationsStarted===1&&a.jobId===j.id&&a.iterationId===i.id&&a.deliveryId===d.id&&
        isDeepStrictEqual(a.sources,j.specification.sources)&&d.jobId===j.id&&d.assignmentId===assignment.id&&
        d.outcome==='success'&&d.state==='processed'&&d.fingerprint===fingerprint({hash:d.sha256,outcome:d.outcome,evidence:d.evidence})&&
        assignment.jobId===j.id&&assignment.attemptId===a.attemptId&&assignment.startedAt&&d.sha256===a.sha256,'EVIDENCE_MISMATCH');
    }
    if(a.origin!=='import'){
      // Use the same original-byte budget as imported sources and parents.
      // A length probe precedes the BLOB fetch; the bounded SELECT also guards
      // against a change between those two statements.
      const length=this.#db.prepare('SELECT length(data) AS n FROM bytes WHERE hash=?').get(a.sha256);
      domainCheck(length,'MISSING_SOURCE');
      domainCheck(length.n===a.size&&length.n<=IMPORT_LIMITS.encodedBytes&&
        budget.originalBytes+length.n<=6*IMPORT_LIMITS.encodedBytes,'HASH_MISMATCH');
      const measured=this.#verifyArtifact(a,{maxBytes:length.n});
      domainCheck(measured.size===a.size&&measured.mediaType===a.mediaType,'EVIDENCE_MISMATCH');
      budget.originalBytes+=measured.size;
    }return a;
  }
  #selectionSources(run){
    const budget={bytes:0,originalBytes:0};
    for(const source of run.sources){const a=this.#selectionSource(source.artifact,run.productId,budget);
      for(const region of source.regions)if(region.reviewRegion){
        const review=this.#get('submission',region.reviewRegion.reviewId);
        const image=review.feedback.images.find(x=>x.artifactId===a.id);
        const original=image?.regions[region.reviewRegion.index];
        domainCheck(review.projectId===run.productId&&image.sha256===a.sha256&&image.version===a.version&&
          original&&['space','x','y','w','h'].every(k=>original[k]===region[k]),'EVIDENCE_MISMATCH');
      }
    }
    for(const ref of run.parentArtifacts)this.#selectionSource(ref,run.productId,budget);
    if(run.parentRoundId){const parent=this.#get('round',run.parentRoundId);
      domainCheck(parent.projectId===run.productId&&this.#list('checkpoint').some(c=>c.roundId===parent.id),'MISSING_SOURCE');}
  }
  #selectionAuthority(token,run,mode='new'){
    this.#checkOperationFormat();
    const currentHead=this.#workspace.read().reference,head=mode==='replay'?run.domainHead:currentHead;
    const query={mode:mode==='replay'?'historical':mode,atHead:head,projectId:run.productId};
    const template=this.#templateWriter().resolveAdoptedForOperation(token,{...query,applicability:run.applicability,
      operationTemplateId:run.template.id,branded:run.branded,brandTemplateId:run.brand?.id??null});
    const product=this.#productWriter().resolveProductForOperation(token,{mode:query.mode,atHead:head,productId:run.productId});
    domainCheck(sameRef(product.product.reference,run.product)&&sameRef(template.operation.reference,run.template)&&
      (run.brand===null?template.brand===null:sameRef(template.brand?.reference,run.brand)),'REVISION_CONFLICT');
    const view=this.#workspace.store.read({atHead:head});
    const businessRef=view.head.business;
    const business=businessRef?this.#businessReader().resolveBusinessForOperation(token,{mode:query.mode,atHead:head,workspaceId:view.head.workspaceId}):null;
    domainCheck(!businessRef||sameRef(business.business.reference,businessRef),'EVIDENCE_MISMATCH');
    if(mode!=='replay'){
      for(const a of product.attachments)domainCheck(a.current.status==='available',a.current.cause??'MISSING_SOURCE');
      this.#selectionSources(run);
    }
    const dossier=product.dossier.map(x=>({reference:x.reference,record:x.record})).sort((a,b)=>a.reference.path<b.reference.path?-1:a.reference.path>b.reference.path?1:0);
    const registry=access(this.#templateOptions.accessFile);
    const callerRole=this.#role(token);
    const policy=registry.principals.find(x=>x.id===template.principalId&&x.role===callerRole);
    domainCheck(policy?.templateGrant&&(policy.products==='*'||policy.products.includes(run.productId)),'INVALID_SCOPE');
    const statuses=[...template.sourceStatus.operation,...(template.sourceStatus.brand??[]),
      ...product.sourceStatus.base,...product.sourceStatus.dossier,...product.sourceStatus.attachments,
      ...(business?.sourceStatus??[])];
    // Historical source loss is reportable, but a current read revocation is
    // never converted into an available historical disclosure.
    for(const status of statuses)domainCheck(status.cause!=='INVALID_SCOPE','INVALID_SCOPE');
    const sources=[...new Set(statuses.map(x=>x.source.sourceId))].sort();
    domainCheck(sources.length<=32,'VALIDATION_LIMIT');
    for(const sourceId of sources)domainCheck(policy.sourceIds.includes(sourceId)||policy.templateGrant.sourceIds.includes(sourceId)||
      (business?.sourceStatus??[]).some(x=>x.source.sourceId===sourceId&&x.status==='verified'),'INVALID_SCOPE');
    const permissionEvidence={principalId:template.principalId,sessionId:callerRole==='conductor'?this.#session(token)?.id??null:null,role:callerRole,
      grantFingerprint:domainDigest(domainStable({registry:registry.schemaVersion,policy})),sourceIds:sources,
      templateIds:[run.template.id,...(run.brand?[run.brand.id]:[])].sort(),applicability:run.applicability,
      productId:run.productId,observedAt:now()};
    domainCheck(sameRef(this.#workspace.read().reference,currentHead),'HEAD_CHANGED');
    return {head,view,template,product,business,dossier,permissionEvidence};
  }
  #selectionRow(id){
    const size=this.#db.prepare("SELECT length(CAST(doc AS BLOB)) AS n FROM records WHERE kind='operationSelection' AND id=?").get(id);
    domainCheck(size&&size.n<=48*1024**2,'VALIDATION_LIMIT');
    const stored=this.#db.prepare("SELECT doc FROM records WHERE kind='operationSelection' AND id=?").get(id);
    domainCheck(stored&&Buffer.byteLength(stored.doc)===size.n,'EVIDENCE_MISMATCH');
    let row;try{row=JSON.parse(stored.doc);}catch{domainFail('EVIDENCE_MISMATCH');}
    domainCheck(stored.doc===domainStable(row)+'\n','EVIDENCE_MISMATCH');
    const verdict=validateOperationSelection(row);
    domainCheck(verdict.ok,verdict.errors[0]?.code??'EVIDENCE_MISMATCH');return row;
  }
  #selectionLinks(row){
    const bounds=this.#db.prepare("SELECT count(*) AS n,coalesce(sum(length(CAST(doc AS BLOB))),0) AS size,coalesce(max(length(CAST(doc AS BLOB))),0) AS largest FROM records WHERE kind IN ('request','round','iteration','job')").get();
    domainCheck(bounds.n<=1152&&bounds.size<=16*1024**2&&bounds.largest<=1024**2,'VALIDATION_LIMIT');
    const requests=this.#list('request'),rounds=this.#list('round'),iterations=this.#list('iteration'),allJobs=this.#list('job');
    const request=requests.find(x=>x.id===row.body.requestId),round=rounds.find(x=>x.requestId===request?.id)??null;
    const iteration=round?iterations.find(x=>x.id===round.iterationId)??null:null;
    const jobs=iteration?allJobs.filter(x=>x.iterationId===iteration.id):[];
    const checked=validateOperationSelectionLinks(row,{request,round,iteration,jobs,requests,rounds,iterations,allJobs});
    domainCheck(checked.ok,checked.errors[0]?.code??'EVIDENCE_MISMATCH');return {request,round,iteration,jobs};
  }
  #selectionInventory(){
    this.#checkOperationFormat();
    const rows=this.#db.prepare("SELECT id,length(CAST(doc AS BLOB)) AS n FROM records WHERE kind='operationSelection' ORDER BY id").all();
    domainCheck(rows.length<=128&&rows.every(x=>x.n<=48*1024**2)&&rows.reduce((n,x)=>n+x.n,0)<=64*1024**2,'VALIDATION_LIMIT');
    for(const {id} of rows)this.#selectionLinks(this.#selectionRow(id));
    const requests=this.#list('request').filter(r=>r.selectionId);
    domainCheck(requests.length===rows.length&&requests.every(r=>rows.some(x=>x.id===r.selectionId)),'EVIDENCE_MISMATCH');
  }
  #selectionFence(row){
    this.#selectionInventory();this.#selectionLinks(row);
    const run=row.body.run;
    const human=this.#selectionAuthority(this.#credentials.human,run,'new');
    domainCheck(sameRef(human.product.product.reference,row.body.product.reference)&&
      sameRef(human.template.operation.decisionReference,row.body.operation.decisionReference)&&
      (row.body.brand===null||sameRef(human.template.brand?.decisionReference,row.body.brand.decisionReference))&&
      (row.body.business===null?human.business===null:sameRef(human.business?.business.reference,row.body.business.reference)),
      'REVISION_CONFLICT');
    const conductor=this.#list('sessionBinding').find(s=>!s.revokedAt&&s.role==='conductor'&&s.tier==='SOL'&&s.projectId===run.productId);
    domainCheck(conductor,'INVALID_SCOPE');
    const current=this.#selectionAuthority(conductor.token,run,'historical');
    domainCheck(sameRef(current.template.operation.decisionReference,row.body.operation.decisionReference)&&
      (row.body.brand===null||sameRef(current.template.brand?.decisionReference,row.body.brand.decisionReference)),
      'REVISION_CONFLICT');
    this.#workspaceHook('before-operation-selection-fence',{selectionId:row.id});
    domainCheck(sameRef(this.#workspace.read().reference,current.head),'HEAD_CHANGED');
    const finalHuman=this.#selectionAuthority(this.#credentials.human,run,'new');
    domainCheck(sameRef(finalHuman.template.operation.decisionReference,row.body.operation.decisionReference),'REVISION_CONFLICT');
    const finalConductor=this.#selectionAuthority(conductor.token,run,'historical');
    domainCheck(sameRef(finalConductor.template.operation.decisionReference,row.body.operation.decisionReference),'REVISION_CONFLICT');
    this.#selectionSources(run);
  }
  operationRequest(token,packet){
    domainCheck(this.#operations&&this.#workspace,'CAPABILITY_UNAVAILABLE');
    const checked=validateCommand(packet,{authenticatedCaller:'human',currentRevision:0});
    domainCheck(checked.ok&&packet.operation==='operation.request',checked.errors[0]?.code??'INVALID_VALUE');
    const run=structuredClone(packet.input),role=this.#role(token),session=this.#session(token);
    if(this.#serviceOptions&&run.executionKind==='deterministic')recipesForRun(run);
    domainCheck(role==='human'&&!session,'INVALID_SCOPE');
    const release=this.#workspace.lockDomain();
    try{return this.#tx(()=>{
      this.#selectionInventory();
      const scope='operation.request:bve-human',prior=this.#db.prepare('SELECT fingerprint,doc FROM receipts WHERE scope=? AND key=?').get(scope,packet.key);
      if(prior){domainCheck(prior.fingerprint===fingerprint(packet),'IDEMPOTENCY_CONFLICT');
        const result=JSON.parse(prior.doc),row=this.#selectionRow(result.selectionId),links=this.#selectionLinks(row);
        this.#selectionAuthority(token,run,'replay');
        domainCheck(isDeepStrictEqual(row.body.run,run)&&links.request.id===result.requestId,'EVIDENCE_MISMATCH');return clone(result);}
      const authority=this.#selectionAuthority(token,run);
      domainCheck(sameRef(authority.head,packet.expected.domainHead)&&sameRef(run.domainHead,authority.head),'REVISION_CONFLICT');
      const requestId=id(),body={workspaceId:authority.view.head.workspaceId,projectId:run.productId,requestId,
        principalId:authority.permissionEvidence.principalId,sessionId:null,createdAt:now(),domainHead:authority.head,
        product:authority.product.product,dossier:authority.dossier,
        business:authority.business?{reference:authority.business.business.reference,record:authority.business.business.record}:null,
        operation:authority.template.operation,brand:authority.template.brand,
        closure:{workspaceId:authority.view.head.workspaceId,head:authority.head,
          files:[...authority.view.files].map(([path,bytes])=>({path,sha256:hash(bytes),bytes:bytes.toString('base64')})).sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0)},
        run,permissionEvidence:authority.permissionEvidence};
      const row={id:run.runId,schemaVersion:'3djat.operation-selection.v1',body,
        bodySha256:hash(operationSelectionBytes(body))};
      const verdict=validateOperationSelection(row);domainCheck(verdict.ok,verdict.errors[0]?.code??'EVIDENCE_MISMATCH');
      domainCheck(!this.#db.prepare("SELECT 1 FROM records WHERE kind='operationSelection' AND id=?").get(row.id),'IDEMPOTENCY_CONFLICT');
      const request={id:requestId,workspaceId:body.workspaceId,projectId:run.productId,selectionId:row.id,
        selectionBodySha256:row.bodySha256,parentReviewId:null,intent:run.intent,count:run.canonical.count,
        direction:run.direction,brand:run.canonical.brand,createdAt:body.createdAt,state:'waiting-for-conductor',
        allowance:run.allowance,gap:'Native Conductor adapter unavailable; resume via bounded Conductor interface'};
      this.#db.prepare("INSERT INTO records VALUES('operationSelection',?,?)").run(row.id,domainStable(row)+'\n');
      this.#put('request',request);this.#selectionLinks(row);
      const result={selectionId:row.id,requestId:request.id,bodySha256:row.bodySha256,state:request.state};
      this.#db.prepare('INSERT INTO receipts VALUES(?,?,?,?)').run(scope,packet.key,fingerprint(packet),JSON.stringify(result));
      this.#selectionInventory();return clone(result);
    });}finally{release();}
  }
  serviceAssignment(owner,jobId){
    this.#owner(owner);verifyServiceRecords(this.#db);const j=this.#get('job',jobId),a=this.#get('assignment',j.assignmentId);
    requireThat(this.#serviceOptions&&a.executorKind==='service'&&j.specification.executorKind==='service','No scoped service assignment',403);
    requireThat(isDeepStrictEqual(a.serviceTool,this.#serviceOptions),'Service tool configuration changed',409);
    return clone({root:this.root,projectId:j.projectId,jobId:j.id,assignmentId:a.id,attemptId:a.attemptId,token:a.token,state:j.state,startedAt:a.startedAt,tool:a.serviceTool,specification:j.specification});
  }
  serviceInputs(token){
    const a=this.#assignment(token),j=this.#get('job',a.jobId);requireThat(a.executorKind==='service','Service scope rejected',403);
    return j.specification.sources.map(x=>({reference:clone(x.artifact),bytes:this.original(token,x.artifact.artifactId)}));
  }
  serviceCall(token,op,key,input){
    verifyServiceRecords(this.#db);const a=this.#assignment(token),j=this.#get('job',a.jobId);
    requireThat(this.#serviceOptions&&a.executorKind==='service'&&j.specification.executorKind==='service','Service scope rejected',403);
    text(key,'service receipt key',200);requireThat(['service.start','service.report','service.quiescence'].includes(op),'Service operation rejected',403);
    const release=op==='service.start'?this.#workspace.lockDomain():null;
    try{return this.#tx(()=>{
      if(op==='service.start'){
        requireThat(Object.keys(input).length===0&&j.state==='assigned'&&!a.startedAt,'Attempt already started or unresolved; never reinvoke',409);
        requireThat(!this.#list('assignment').some(x=>x.executorKind==='service'&&x.startedAt&&x.processQuiescent!==true),'Prior service process has no quiescent evidence',409);
        const request=this.#get('request',this.#get('iteration',j.iterationId).requestId),row=this.#selectionRow(request.selectionId);this.#selectionFence(row);
        const scene=this.#get('artifact',j.specification.recipe.scene.artifactId);requireThat(!scene.logoLayer,'Select the retained uncomposited parent for a channel recipe',409);
        requireThat(isDeepStrictEqual(j.specification.recipe,recipesForRun(row.body.run)[this.#get('iteration',j.iterationId).jobIds.indexOf(j.id)]),'Frozen service recipe changed',409);
        const result=this.#operate('generator','attempt.start',{assignmentId:a.id});
        const current=this.#get('assignment',a.id);current.processQuiescent=false;this.#put('assignment',current);return result;
      }

      if(op==='service.quiescence'){
        requireThat(a.startedAt&&key==='quiescence:'+a.id&&Object.keys(input).length===1&&/^[0-9a-f]{64}$/.test(input.processSha256),'Invalid service closure');
        const proof=readServiceClosure({root:this.root,assignmentId:a.id,attemptId:a.attemptId,startedAt:a.startedAt,tool:a.serviceTool,specification:j.specification});
        requireThat(proof&&proof.source.sha256===input.processSha256,'Process closure evidence mismatch',409);
        return this.#once('service:'+a.id+':quiescence',key,input,()=>{
          requireThat(!this.#list('serviceClosure').some(c=>c.id===a.id),'Closure already recorded',409);
          const st=this.#list('statement').find(s=>s.jobId===j.id&&s.service?.assignmentId===a.id);requireThat(st,'Missing service statement',409);
          const event=this.#statementEvent(st,{id:a.id,sessionId:a.executor,role:'service',tier:null},'quiescent',{text:'Actual process closure verified for the original attempt.',processSha256:proof.source.sha256});
          a.processQuiescent=true;this.#put('assignment',a);
          return this.#put('serviceClosure',{id:a.id,schemaVersion:'bve.service-closure.v1',projectId:j.projectId,jobId:j.id,assignmentId:a.id,attemptId:a.attemptId,...proof,eventId:event.id,recordedAt:now()});
        });
      }
      requireThat(Object.keys(input).length===3&&['status','text','quiescent'].every(k=>Object.hasOwn(input,k))&&['produced','failed','uncertain','blocked'].includes(input.status)&&typeof input.quiescent==='boolean','Invalid service report');
      text(input.text,'service report',8000);
      if(input.status==='produced')requireThat(j.state==='succeeded','Independent intake has not verified this result',409);
      if(input.status==='failed')requireThat(j.state==='failed','No failed job outcome',409);
      if(input.status==='blocked')requireThat(!a.startedAt,'A started attempt cannot become a no-effect block',409);
      return this.#once('service:'+a.id+':report',key,input,()=>{
        const st=this.#list('statement').find(x=>x.jobId===j.id&&x.service?.assignmentId===a.id);requireThat(st,'Missing service statement',409);
        const actor={id:a.id,sessionId:a.executor,role:'service',tier:null};
        const event=this.#statementEvent(st,actor,input.status,{text:input.text,quiescent:input.quiescent});
        a.processQuiescent=a.processQuiescent||input.quiescent;this.#put('assignment',a);
        if(['produced','failed'].includes(input.status)&&!this.#list('executionResult').some(x=>x.id===a.id)){
          const request=this.#get('request',this.#get('iteration',j.iterationId).requestId),row=this.#selectionRow(request.selectionId),d=this.#get('delivery',this.#list('delivery').find(x=>x.assignmentId===a.id).id);
          const reference={id:d.id,revision:1,path:'Operational/delivery/'+d.id+'.json',sha256:hash(JSON.stringify(d)+'\n')};
          const artifact=j.artifactId?this.#get('artifact',j.artifactId):null;
          const record={schemaVersion:'3djat.execution-result.v1',runId:row.id,productId:j.projectId,roundId:j.roundId,jobId:j.id,assignmentId:a.id,outputRole:j.specification.output.role,outcome:artifact?'succeeded':'failed',executorKind:'service',executorId:a.executor,
            artifact:artifact?{productId:j.projectId,artifactId:artifact.id,version:artifact.version,sha256:artifact.sha256,width:artifact.width,height:artifact.height}:null,receipt:reference,recipeHash:recipeHash(j.specification.recipe),parameters:clone(row.body.run.selection),tool:'Pillow',model:null,version:a.serviceTool.pillowVersion,startedAt:a.startedAt,finishedAt:now(),cost:null,usage:null,exitCode:d.evidence.receipt?.exitCode??d.evidence.process?.exitCode??null,failureCode:artifact?null:d.state==='rejected'?'INTAKE_REJECTED':'TOOL_FAILED'};
          const checked=validate('execution-result',record);requireThat(checked.ok,'Invalid execution result',409);
          this.#put('executionResult',{id:a.id,projectId:j.projectId,jobId:j.id,assignmentId:a.id,record});
        }
        return event;
      });
    });}finally{release?.();}
  }

  operationCommission(token,packet,{roundId,specifications,interpretation=null}={}){
    domainCheck(this.#operations&&this.#workspace,'CAPABILITY_UNAVAILABLE');
    const checked=validateCommand(packet,{authenticatedCaller:'conductor',currentRevision:1});
    domainCheck(checked.ok&&packet.operation==='operation.commission',checked.errors[0]?.code??'INVALID_VALUE');
    const role=this.#role(token),session=this.#session(token);
    domainCheck(role==='conductor'&&session?.role==='conductor'&&session.projectId===packet.input.productId,'INVALID_SCOPE');
    const row=this.#selectionRow(packet.input.runId),links=this.#selectionLinks(row);
    domainCheck(isDeepStrictEqual(packet.input,row.body.run)&&sameRef(packet.expected.domainHead,row.body.domainHead)&&
      (links.round?.id===roundId||this.#get('round',roundId).selectionRequestId===links.request.id),'EVIDENCE_MISMATCH');
    return this.call(token,'round.commission',packet.key,{roundId,specifications,interpretation});
  }
  operationSelection(token,requestId){
    domainCheck(this.#operations&&this.#workspace,'CAPABILITY_UNAVAILABLE');
    const role=this.#role(token),session=this.#session(token);
    domainCheck(['human','conductor'].includes(role),'INVALID_SCOPE');
    const release=this.#workspace.lockDomain();
    try{
      this.#workspace.assertRuntime();
      const request=this.#get('request',requestId);
      domainCheck(request.selectionId&&(!session||session.projectId===request.projectId),'INVALID_SCOPE');
      this.#selectionInventory();
      const row=this.#selectionRow(request.selectionId);this.#selectionLinks(row);
      const prove=()=>{
        const resolved=this.#selectionAuthority(token,row.body.run,'replay');
        domainCheck(sameRef(resolved.product.product.reference,row.body.product.reference)&&
          isDeepStrictEqual(resolved.dossier,row.body.dossier)&&
          sameRef(resolved.template.operation.reference,row.body.operation.reference)&&
          sameRef(resolved.template.operation.decisionReference,row.body.operation.decisionReference)&&
          (row.body.brand===null?resolved.template.brand===null:
            sameRef(resolved.template.brand?.reference,row.body.brand.reference)&&
            sameRef(resolved.template.brand?.decisionReference,row.body.brand.decisionReference))&&
          (row.body.business===null?resolved.business===null:
            sameRef(resolved.business?.business.reference,row.body.business.reference)),'EVIDENCE_MISMATCH');
      };
      const currentHead=this.#workspace.read().reference;
      prove();this.#workspaceHook('before-operation-selection-read-fence',{selectionId:row.id});
      domainCheck(sameRef(this.#workspace.read().reference,currentHead),'HEAD_CHANGED');prove();
      // The private immutable row and its full closure remain intact in SQLite.
      // This is a separate public view, not a redacted row with a false digest.
      const {closure,permissionEvidence,principalId,sessionId,...body}=row.body;
      return clone({schemaVersion:'3djat.operation-selection-view.v1',id:row.id,
        retainedBodySha256:row.bodySha256,body});
    }finally{release();}
  }

  #contentAuthority(token,productId){
    domainCheck(this.#operations&&this.#workspace,'CAPABILITY_UNAVAILABLE');
    const role=this.#role(token),session=this.#session(token);
    domainCheck(['human','conductor'].includes(role)&&(!session||session.projectId===productId),'INVALID_SCOPE');
    const head=this.#workspace.read().reference;
    this.#productWriter().resolveProductForOperation(token,{mode:'historical',atHead:head,productId});
    return head;
  }
  operationPreparation(token,query){
    domainCheck(query&&Object.keys(query).length===5&&['productId','applicability','operationTemplateId','branded','brandTemplateId'].every(k=>Object.hasOwn(query,k)),'INVALID_VALUE');
    const head=this.#contentAuthority(token,query.productId);
    const template=this.#templateWriter().resolveAdoptedForOperation(token,{mode:'new',atHead:head,projectId:query.productId,
      applicability:query.applicability,operationTemplateId:query.operationTemplateId,branded:query.branded,brandTemplateId:query.brandTemplateId});
    const product=this.#productWriter().resolveProductForOperation(token,{mode:'new',atHead:head,productId:query.productId});
    domainCheck(sameRef(this.#workspace.read().reference,head),'HEAD_CHANGED');
    return clone({head,product:product.product,operation:template.operation,brand:template.brand});
  }
  operationActionAbsent(token,operation,key){
    requireThat(this.#role(token)==='human'&&!this.#session(token),'Only the human owner can inspect its action key',403);
    requireThat(['operation.request','candidate.decide'].includes(operation),'Invalid action scope',403);text(key,'action key',200);
    return !this.#db.prepare('SELECT 1 FROM receipts WHERE scope=? AND key=?').get(operation+':bve-human',key);
  }
  candidateActionReference(token,packet){
    domainCheck(this.#role(token)==='human'&&!this.#session(token),'INVALID_SCOPE');
    domainCheck(packet?.operation==='candidate.decide'&&validate('command',packet).ok,'INVALID_VALUE');
    const head=this.#contentAuthority(token,packet.input.productId);
    domainCheck(sameRef(head,packet.expected.domainHead),'REVISION_CONFLICT');
    return clone(contentActionReference(packet));
  }
  candidateDecide(token,packet){
    domainCheck(this.#role(token)==='human'&&!this.#session(token),'INVALID_SCOPE');
    domainCheck(packet?.operation==='candidate.decide'&&validate('command',packet).ok,'INVALID_VALUE');
    const release=this.#workspace.lockDomain();
    try{return this.#tx(()=>{
      const head=this.#contentAuthority(token,packet.input.productId),rows=verifyContentDecisions(this.#db);
      this.#selectionSource(packet.input.artifact,packet.input.productId,{bytes:0,originalBytes:0});
      return this.#once('candidate.decide:bve-human',packet.key,packet,()=>{
        domainCheck(sameRef(head,packet.expected.domainHead),'REVISION_CONFLICT');
        const tail=rows.filter(r=>r.record.artifact.artifactId===packet.input.artifact.artifactId).at(-1);
        const checked=validateCommand(packet,{authenticatedCaller:'human',currentRevision:tail?.sequence??0});
        domainCheck(checked.ok,checked.errors[0]?.code??'INVALID_VALUE');
        domainCheck(isDeepStrictEqual(packet.input.supersedesDecision,tail?.reference??null),'REVISION_CONFLICT');
        domainCheck(isDeepStrictEqual(packet.input.humanActionReceipt,contentActionReference(packet)),'EVIDENCE_MISMATCH');
        domainCheck(!this.#list('candidateDecision').some(r=>r.id===packet.input.decisionId),'IDEMPOTENCY_CONFLICT');
        if(packet.input.action==='accept-for-editing')domainCheck(packet.input.channel===null,'INVALID_SCOPE');
        if(packet.input.action==='approve-output')domainCheck(this.#get('artifact',packet.input.artifact.artifactId).origin!=='import','INVALID_SCOPE');
        const record=clone(packet.input),reference=decisionReference(record),sequence=(tail?.sequence??0)+1;
        this.#put('candidateAction',candidateAction(packet));
        this.#put('candidateDecision',{id:record.decisionId,projectId:record.productId,record,reference,sequence,order:rows.length+1,packet:clone(packet)});
        return {reference,sequence,order:rows.length+1};
      });
    });}finally{release();}
  }
  contentReview(token,query){
    domainCheck(query&&Object.keys(query).length===1&&typeof query.productId==='string','INVALID_VALUE');
    const head=this.#contentAuthority(token,query.productId),productId=query.productId,all=verifyContentDecisions(this.#db);
    const artifacts=this.read(token,'artifact').filter(a=>a.projectId===productId),jobs=this.read(token,'job').filter(j=>j.projectId===productId),rounds=this.read(token,'round').filter(r=>r.projectId===productId);
    const content=deriveContent(artifacts,all.filter(r=>r.projectId===productId),jobs,rounds);
    for(const entry of content.entries)entry.branchRoundId=this.#list('checkpoint').some(c=>c.roundId===entry.roundId)?entry.roundId:null;
    domainCheck(sameRef(this.#workspace.read().reference,head),'HEAD_CHANGED');
    return clone({schemaVersion:'3djat.content-review.v1',head,productId,...content,jobs,rounds,
      requests:this.read(token,'request').filter(r=>r.projectId===productId),
      statements:this.read(token,'statement').filter(st=>st.projectId===productId)});
  }

  operationDiscovery(token,{productId,applicability,branded=false,brandTemplateId=null}={}){
    domainCheck(this.#operations&&this.#workspace,'CAPABILITY_UNAVAILABLE');
    const role=this.#role(token),session=this.#session(token);
    domainCheck(['human','conductor'].includes(role)&&(!session||session.projectId===productId),'INVALID_SCOPE');
    const head=this.#workspace.read().reference;
    const template=this.#templateWriter().readRegistry(token,{schemaVersion:'3djat.template-query.v1',kind:'discovery',atHead:head,productId,applicability,branded,brandTemplateId});
    const listed=this.#templateWriter().readRegistry(token,{schemaVersion:'3djat.template-query.v1',kind:'list',atHead:head,applicability});
    const product=this.#productWriter().resolveProductForOperation(token,{mode:'historical',atHead:head,productId});
    const blockers=[...new Set([...product.sourceStatus.base,...product.sourceStatus.dossier,...product.sourceStatus.attachments]
      .filter(x=>x.status!=='verified').map(x=>x.cause??'MISSING_SOURCE'))];
    domainCheck(sameRef(this.#workspace.read().reference,head),'HEAD_CHANGED');
    return clone({schemaVersion:'3djat.operation-discovery.v1',head,productId,applicability,branded,brandTemplateId,
      operations:template.data.operations.map(x=>({templateId:x.templateId,chosen:x.chosen,status:x.status,
        blockers:[...new Set([...x.blockers,...blockers])],selection:'requires-run-and-source-proof'})),
      brands:listed.data.templates.filter(x=>x.kind==='brand').map(x=>({templateId:x.templateId,
        chosen:x.applicability.find(a=>a.applicability===applicability)?.chosen??null,
        status:x.applicability.find(a=>a.applicability===applicability)?.status??null,
        blockers:x.applicability.find(a=>a.applicability===applicability)?.blockers??[]})),
      brand:template.data.brand??null,productBlockers:blockers,execution:{state:'not-assessed',generator:'not-verified'}});
  }
  templateReview(token,query){try{return clone(this.#templateWriter().readRegistry(token,query));}catch(e){throw new Fault(e.code??'CAPABILITY_UNAVAILABLE',e.code==='INVALID_SCOPE'?403:409);}}
  templateCommand(token,packet){
    let writer;try{writer=this.#templateWriter();}catch(e){return DomainTemplates.failure(packet,e);}
    const result=writer.command(token,packet);if(result.schemaVersion==='3djat.failure.v1')return clone(result);
    try{this.#workspaceHook('before-template-evidence',{});for(const event of writer.operationalEvidence())this.#copyProductAction(event);
      this.#workspaceHook('before-template-projection',{});domainCheck(this.#currentDomain().status==='current','ACK_PENDING');
      this.#workspaceHook('before-template-response',{result});return clone(result);
    }catch(e){return writer.failure(packet,e,result.receipt);}
  }
  productCommand(token,packet){
    let writer;try{writer=this.#productWriter();}catch(e){return DomainProducts.failure(packet,e);}
    const result=writer.command(token,packet);if(result.schemaVersion==='3djat.failure.v1')return clone(result);
    try{
      if(['product.dossier.proposal.submit','product.dossier.proposal.decide'].includes(packet.operation))this.#workspaceHook('before-dossier-evidence',{});
      for(const event of writer.operationalEvidence())this.#copyProductAction(event);
      this.#workspaceHook('before-product-adoption',{});
      const view=this.#workspace.read(),project=this.#list('project').find(p=>p.id===packet.input.productId);
      if(!project?.domainWorkspaceId){const meta=this.#get('domainIntegration','active');this.adoptWorkspace(this.#credentials,{schemaVersion:'3djat.command.v1',operation:'workspace.adopt',key:'product-link-'+view.reference.sha256,expected:{domainHead:view.reference,entityRevision:meta.adoptionRevision},input:{...this.#workspace.store.workspace,revision:meta.adoptionRevision+1,domainHead:view.reference}});}
      this.#workspaceHook('before-product-projection',{});const projection=this.#currentDomain();domainCheck(projection.status==='current','ACK_PENDING');
      this.#workspaceHook('before-product-response',{result});return clone(result);
    }catch(e){return writer.failure(packet,e,result.receipt);}
  }
  adoptWorkspace(owner,packet){
    this.#owner(owner);requireThat(this.#workspace,'No explicit workspace connection',409);const release=this.#workspace.lockDomain();let attempted=false;
    try{const view=this.#workspace.read();const result=this.#tx(()=>this.#once('workspace:'+this.#workspace.config.workspaceId+':adopt:owner',packet.key,packet,()=>{
      const meta=this.#get('domainIntegration','active');validateAdoption(packet,view,meta.adoptionRevision);
      domainCheck(Object.entries(this.#workspace.store.workspace.paths).every(([k,v])=>packet.input.paths[k]===v),'ROOT_CONFLICT');
      const projectIds=[];for(const x of view.head.products){const row=this.#db.prepare("SELECT doc FROM records WHERE kind='project' AND id=?").get(x.productId);let p=row?JSON.parse(row.doc):null;
        domainCheck(!p?.domainWorkspaceId||p.domainWorkspaceId===meta.config.workspaceId,'WORKSPACE_MISMATCH');
        if(!p)p={id:x.productId,code:'P'+String(this.#db.prepare("SELECT count(*) AS n FROM records WHERE kind='project'").get().n+1).padStart(3,'0'),brief:'',page:'board',createdAt:now(),defaults:{count:1,direction:'Fresh',brand:null},standingRemaining:0};
        p.domainWorkspaceId=meta.config.workspaceId;delete p.folder;this.#put('project',p);projectIds.push(p.id);
      }
      putProjection(this.#db,view);meta.adoptionRevision=packet.input.revision;this.#put('domainIntegration',meta);
      const ack=this.#put('workspaceAcknowledgement',{schemaVersion:'3djat.adoption-ack.v1',id:id(),revision:meta.adoptionRevision,workspaceId:meta.config.workspaceId,head:view.reference,projectIds});
      this.#workspaceHook('before-adoption-commit',{});attempted=true;return ack;
    }));attempted=true;this.#workspaceHook('after-adoption-commit',{});return clone(result);
    }catch(e){if(attempted)domainFail('ADOPTION_UNCERTAIN',{cause:e.code??'IO_FAILURE'});throw e;}finally{try{release();}catch(e){if(attempted)domainFail('ADOPTION_UNCERTAIN',{cause:e.code??'LOCK_RELEASE_FAILURE'});throw e;}}
  }
  freezeDomainSelection(owner,{key,projectId,expectedHead,product,templates=[],business=null}){
    this.#owner(owner);requireThat(this.#workspace,'No explicit workspace connection',409);text(key,'selection key',80);this.#get('project',projectId);
    domainCheck(this.#get('project',projectId).domainWorkspaceId===this.#workspace.config.workspaceId,'WORKSPACE_MISMATCH');const release=this.#workspace.lockDomain();
    try{return this.#tx(()=>this.#once('selection:'+projectId,key,{projectId,expectedHead,product,templates,business},()=>{
      const view=this.#workspace.read();domainCheck(sameRef(view.reference,expectedHead),'REVISION_CONFLICT');domainCheck(this.#db.prepare("SELECT count(*) AS n FROM records WHERE kind='domainSelection'").get().n<128,'CAPACITY');
      const value={...makeSelection(view,{projectId,product,templates,business}),id:id()};verifySelection(value);this.#db.prepare("INSERT INTO records VALUES('domainSelection',?,?)").run(value.id,JSON.stringify(value));return {id:value.id,head:value.head,product:value.product,templates:value.templates,business:value.business};
    }));}finally{release();}
  }
  frozenDomainSelection(owner,selectionId){this.#owner(owner);return clone(verifySelection(this.#get('domainSelection',selectionId)));}
  hostState(owner,state){
    this.#owner(owner);
    if(state!==undefined)return this.#tx(()=>clone(this.#put('hostInstallation',{...clone(state),id:'active'})));
    return clone(this.#list('hostInstallation')[0]??null);
  }
  #safeBinding(b){const {token,tokenHash,nonce,...safe}=b;return safe;}
  #bind({role,sessionId,sessionUrl=null,projectId,nonce,replace=false,tier,jobId=null,hostReceipt}){
    requireThat(['conductor','butler','worker'].includes(role),'No such project staff role');
    requireThat(tier===(role==='conductor'?'SOL':'LUNA'),'Incorrect staff model tier');
    text(sessionId,'actual session identity',300);text(nonce,'verification challenge',200);text(hostReceipt,'actual host binding receipt',2000);
    if(projectId!==null)this.#get('project',projectId);
    requireThat(projectId!==null||role==='conductor','Only an exploring Conductor can be unbound');
    if(sessionUrl!==null)requireThat(new URL(sessionUrl).protocol==='https:','Session link must use https');
    const active=this.#list('sessionBinding').filter(b=>!b.revokedAt&&['conductor','butler','worker'].includes(b.role)&&b.tier===(b.role==='conductor'?'SOL':'LUNA'));
    const same=active.find(b=>b.sessionId===sessionId);
    requireThat(!same||same.projectId===projectId&&same.role===role&&same.jobId===jobId,'Session identity already belongs to another assignment/project',403);
    if(same)return same;
    const prior=role==='worker'||projectId===null?null:active.find(b=>b.role===role&&b.projectId===projectId);
    requireThat(!prior||replace,'Explicit replacement required; reuse existing project staff',409);
    if(role==='worker'){
      const job=this.#get('job',jobId);requireThat(job.specification.executorKind!=='service','A conventional service cannot consume an AI worker slot',403);
      requireThat(job.projectId===projectId&&job.roundId,'Worker job/project mismatch',403);
      requireThat(this.#butlerReady(this.#get('round',job.roundId)),'Butler must be ready before workers are bound',409);
      requireThat(!active.some(b=>b.role==='worker'&&b.jobId===jobId),'Job already has a worker',409);
      requireThat(active.filter(b=>b.projectId===projectId&&b.role==='worker').length<6,'Maximum six active workers per project',409);
      requireThat(job.staffProvisioning?.state==='pending','Reserve the worker slot before host creation',409);
      job.staffProvisioning.state='bound';this.#put('job',job);
    }
    if(prior){prior.revokedAt=now();this.#put('sessionBinding',prior);}
    const token=secret();return this.#put('sessionBinding',{id:id(),role,tier,sessionId,sessionUrl,projectId,jobId,nonce,token,tokenHash:hash(token),hostReceipt,boundAt:now(),hello:null,revokedAt:null});
  }
  bindSession(owner,x){this.#owner(owner);return this.#tx(()=>clone(this.#bind(x)));}
  hostBindings(owner){this.#owner(owner);return clone(this.#list('sessionBinding').filter(b=>!b.revokedAt&&['conductor','butler','worker'].includes(b.role)&&b.tier===(b.role==='conductor'?'SOL':'LUNA')));}
  hostRoutes(owner){this.#owner(owner);return clone(this.#list('delegation'));} // Historical receipts remain readable by the owner.
  #belongs(v,kind,projectId){
    if(projectId===null)return false;
    if(kind==='project')return v.id===projectId;
    if(v.projectId)return v.projectId===projectId;
    if(v.jobId)return this.#get('job',v.jobId).projectId===projectId;
    if(v.assignmentId)return this.#get('job',this.#get('assignment',v.assignmentId).jobId).projectId===projectId;
    return false;
  }
  #sessionScope(token,op,x){
    const s=this.#session(token);if(!s)return;
    let projectId=x.projectId;
    if(op==='iteration.commission')projectId=this.#get('request',x.requestId).projectId;
    else if(op.startsWith('event.'))projectId=this.#get('event',x.eventId).projectId;
    requireThat(s.projectId!==null&&projectId===s.projectId,'Session project boundary rejected',403);
  }
  #hostCall(token,op,key,x){
    const s=this.#session(token);requireThat(s,'Installed session credential required',403);text(key,'host receipt key',200);
    requireThat(op==='host.resume','Use project statements for operational delegation',404);
    requireThat(x.nonce===s.nonce,'Session challenge mismatch',403);
    const common=['project','round','statement','statementEvent','checkpoint','projectInstruction','sessionBinding'];
    const kinds=s.role==='worker'?[...common,'job','assignment']:s.role==='butler'?[...common,'iteration','job','artifact','submission','continuation','creativeContext','event','delivery','observation','conflict']:[...common,'request','iteration','job','artifact','submission','continuation','creativeContext','event'];
    const context=Object.fromEntries(kinds.map(k=>[k,this.read(token,k)]));
    const receipt=this.#tx(()=>{
      const value=this.#once('session:'+s.id+':'+op,key,x,()=>({id:id(),sessionId:s.sessionId,role:s.role,projectId:s.projectId,readAt:now()}));
      s.hello=value;this.#put('sessionBinding',s);return value;
    });
    const assignment=s.role==='worker'?this.#list('assignment').find(a=>a.jobId===s.jobId):null;
    return {receipt,context,...(assignment?{assignmentAccess:clone({...assignment,...this.assignment(assignment.token)})}:{})};
  }
  #actor(s){return {bindingId:s.id,sessionId:s.sessionId,role:s.role,tier:s.tier};}
  #statementEvent(statement,s,kind,report){return this.#put('statementEvent',{id:id(),statementId:statement.id,roundId:statement.roundId,projectId:statement.projectId,actor:this.#actor(s),kind,report:clone(report),createdAt:now()});}
  #butlerReady(round){return this.#list('statementEvent').some(e=>e.statementId===round.statementId&&e.kind==='ready'&&e.actor.bindingId===round.butler.bindingId);}
  #statementView(st){
    const events=this.#list('statementEvent').filter(e=>e.statementId===st.id),job=st.jobId?this.#get('job',st.jobId):null;
    const project=this.#get('project',st.projectId),round=this.#get('round',st.roundId),projectView=this.#projectView(project);
    return {...st,project:{id:project.id,name:projectView.name,folder:projectView.folder,...(projectView.domain?{domain:{status:projectView.domain.status,head:projectView.domain.head}}:{})},round:{id:round.id,code:round.code,parent:round.parentRoundId,expectedResults:round.expectedResults,operation:round.operation},inputs:job?.specification.sources??round.references,events,assignment:job?{jobId:job.id,assignmentId:job.assignmentId??null,status:job.state}:null,verifiedArtifactId:job?.state==='succeeded'?job.artifactId:null,status:job?.state??events.at(-1)?.kind??'assigned'};
  }
  #roundView(r){const c=this.#list('checkpoint').find(c=>c.roundId===r.id);return {...r,state:c?.state??(this.#butlerReady(r)?'ready':'assigned'),checkpointId:c?.id??null};}
  #newStatement(round,{jobId=null,worker=null,instructions,prompt=null}){
    const code='S'+String(this.#list('statement').filter(s=>s.projectId===round.projectId).length+1).padStart(3,'0');
    return this.#put('statement',{id:id(),code,projectId:round.projectId,roundId:round.id,conductor:round.conductor,butler:round.butler,worker,jobId,instructions,butlerInstructions:round.butlerInstructions,prompt,createdAt:now()});
  }
  #projectCall(token,op,key,x){
    const s=this.#session(token);requireThat(s,'Project session binding required',403);text(key,'project operation key',200);
    const allowed={conductor:['project.activate','project.instructions','staff.reserve','staff.bind','staff.retire','round.create','round.commission','worker.assign','round.disposition'],butler:['statement.report','round.present'],worker:['statement.report','worker.start']};
    allowed.conductor.push('service.assign');
    requireThat(allowed[s.role].includes(op),`${s.role} cannot call ${op}`,403);
    if(op!=='project.activate'){
      const projectId=x.roundId?this.#get('round',x.roundId).projectId:x.statementId?this.#get('statement',x.statementId).projectId:x.projectId;
      requireThat(projectId===s.projectId&&projectId!==null,'Cross-project operation rejected',403);
    }
    const selectedRequest=op==='round.create'?x.requestId:
      op==='round.commission'?(this.#get('round',x.roundId).selectionRequestId??this.#get('round',x.roundId).requestId):
      op==='service.assign'?this.#get('iteration',this.#get('job',x.jobId).iterationId).requestId:
      op==='worker.assign'?this.#get('iteration',this.#get('job',this.#get('sessionBinding',x.bindingId).jobId).iterationId).requestId:
      op==='worker.start'?this.#get('iteration',this.#get('job',s.jobId).iterationId).requestId:null;
    const selected=selectedRequest&&this.#get('request',selectedRequest).selectionId;
    const calibration=selectedRequest&&this.#get('request',selectedRequest).calibrationId;
    const release=(selected||calibration)?this.#workspace.lockDomain():null;
    try{
    this.reconcile(this.#credentials.butler);
    if(op==='worker.start'){const j=this.#get('job',s.jobId),a=this.#get('assignment',j.assignmentId);requireThat(j.state==='assigned'&&!a.startedAt,'Attempt already started or uncertain; no automatic re-invocation',409);}
    if(selectedRequest)this.#calibrationFence(selectedRequest);
    const result=this.#tx(()=>this.#once('project-session:'+s.id+':'+op,key,x,()=>this.#projectOperate(s,op,x)));
    this.reconcile(this.#credentials.butler);return clone(result);
    }finally{release?.();}
  }
  #projectOperate(s,op,x){
    if(op==='project.activate'){
      requireThat(s.projectId===null,'Conductor already belongs to a project',409);
      const p=this.#operate('human','project.create',x);p.code='P'+String(this.#list('project').length).padStart(3,'0');p.folder=this.#folder(p);this.#put('project',p);
      s.projectId=p.id;this.#put('sessionBinding',s);
      const instructions=x.instructions??p.brief;text(instructions,'current project instructions',8000);this.#put('projectInstruction',{id:id(),projectId:p.id,version:1,text:instructions,actor:this.#actor(s),createdAt:now()});
      const request=this.#request({projectId:p.id,intent:x.intent,count:x.count,direction:x.direction,brand:x.brand});return {project:p,request};
    }
    if(op==='project.instructions'){
      text(x.text,'current project instructions',8000);const revisions=this.#list('projectInstruction').filter(i=>i.projectId===s.projectId);
      requireThat(x.expectedVersion===(revisions.at(-1)?.version??0),'Project instructions changed',409);
      return this.#put('projectInstruction',{id:id(),projectId:s.projectId,version:revisions.length+1,text:x.text,actor:this.#actor(s),createdAt:now()});
    }
    if(op==='staff.reserve'){
      requireThat(['butler','worker'].includes(x.role),'Invalid requested project staff');
      const key=s.projectId+':'+x.role+':'+(x.jobId??'primary');
      if(x.role==='worker'){
        const j=this.#get('job',x.jobId);requireThat(j.specification.executorKind!=='service','Service jobs cannot reserve AI staff',403);requireThat(j.projectId===s.projectId&&j.roundId,'Worker job/project mismatch',403);
        requireThat(this.#butlerReady(this.#get('round',j.roundId)),'Butler must be ready before worker creation',409);
        if(!j.staffProvisioning){
          const active=this.#list('sessionBinding').filter(b=>!b.revokedAt&&b.projectId===s.projectId&&b.role==='worker').length;
          const pending=this.#list('job').filter(j=>j.projectId===s.projectId&&j.staffProvisioning?.state==='pending').length;
          requireThat(active+pending<6,'Maximum six active workers per project',409);
          j.staffProvisioning={key,state:'pending',createdAt:now()};this.#put('job',j);
        }
      }
      return {key};
    }
    if(op==='staff.bind'){
      requireThat(['butler','worker'].includes(x.role),'Conductor assigns only Butler or workers');
      return this.#bind({...x,projectId:s.projectId});
    }
    if(op==='staff.retire'){
      const b=this.#get('sessionBinding',x.bindingId);requireThat(b.projectId===s.projectId&&b.role==='worker','Only own workers may be retired');
      requireThat(['succeeded','failed'].includes(this.#get('job',b.jobId).state),'Unresolved worker must remain recorded; no advanced replacement scheduling',409);
      b.revokedAt??=now();this.#put('sessionBinding',b);return this.#safeBinding(b);
    }
    if(op==='round.create'){
      requireThat(['generate','compare','organize','branch'].includes(x.operation),'Unsupported operation; no workflow is invented');text(x.intent,'user operational intent');text(x.butlerInstructions,'original Butler instructions');
      const butler=this.#list('sessionBinding').find(b=>!b.revokedAt&&b.projectId===s.projectId&&b.role==='butler');requireThat(butler?.hello,'Butler must receive and verify project scope first',409);
      if(x.parentRoundId)requireThat(this.#get('round',x.parentRoundId).projectId===s.projectId,'Foreign parent round',403);
      const references=this.#sourceReferences(x.references??[],s.projectId);
      const feedbackIds=x.feedbackIds??[];requireThat(Array.isArray(feedbackIds)&&feedbackIds.length<=24,'Too many feedback references');for(const f of feedbackIds)requireThat(this.#get('submission',f).projectId===s.projectId,'Foreign feedback',403);
      let request=null;if(x.operation==='generate'){request=this.#get('request',x.requestId);requireThat(request.projectId===s.projectId&&request.state==='waiting-for-conductor','No pending project generation request',409);requireThat(!this.#list('round').some(r=>r.requestId===request.id||r.selectionRequestId===request.id),'Request already belongs to a round',409);}
      if(request?.selectionId)this.#selectionFence(this.#selectionRow(request.selectionId));
      const r=this.#put('round',{id:id(),code:'R'+String(this.#list('round').filter(r=>r.projectId===s.projectId).length+1).padStart(3,'0'),projectId:s.projectId,parentRoundId:x.parentRoundId??null,operation:x.operation,intent:x.intent,
        requestId:request?.selectionId?null:request?.id??null,...(request?.selectionId?{selectionRequestId:request.id}:{}),
        expectedResults:request?.count??0,conductor:this.#actor(s),butler:this.#actor(butler),butlerInstructions:x.butlerInstructions,references,feedbackIds,createdAt:now()});
      const st=this.#newStatement(r,{instructions:x.butlerInstructions});r.statementId=st.id;this.#put('round',r);return r;
    }
    if(op==='round.commission'){
      const r=this.#get('round',x.roundId);requireThat(r.operation==='generate'&&!r.iterationId,'Round is not awaiting generation commission',409);requireThat(this.#butlerReady(r),'Butler must be ready before production',409);
      const selected=this.#get('request',r.selectionRequestId??r.requestId).selectionId;
      if(selected)this.#selectionFence(this.#selectionRow(selected));
      if(selected){r.requestId=r.selectionRequestId;delete r.selectionRequestId;this.#put('round',r);}
      const i=this.#commission({requestId:r.requestId,specifications:x.specifications,interpretation:x.interpretation},{service:!!selected});i.roundId=r.id;this.#put('iteration',i);
      for(const jobId of i.jobIds){const j=this.#get('job',jobId);j.roundId=r.id;j.code='J'+String(this.#list('job').filter(j=>j.projectId===r.projectId&&j.roundId).length+1).padStart(3,'0');this.#put('job',j);}
      r.iterationId=i.id;this.#put('round',r);
      if(selected)this.#selectionInventory();return i;
    }
    if(op==='service.assign'){
      requireThat(Object.keys(x).every(k=>['projectId','roundId','jobId'].includes(k)),'Invalid service assignment');
      const j=this.#get('job',x.jobId),r=this.#get('round',x.roundId);
      requireThat(j.roundId===r.id&&j.projectId===s.projectId&&j.specification.executorKind==='service'&&this.#serviceOptions,'Service job scope rejected',403);
      requireThat(this.#butlerReady(r),'Butler must be ready',409);
      const request=this.#get('request',this.#get('iteration',j.iterationId).requestId),row=this.#selectionRow(request.selectionId);this.#selectionFence(row);
      if(j.assignmentId){const a=this.#get('assignment',j.assignmentId);requireThat(a.executorKind==='service','Assignment kind changed',409);return {assignmentId:a.id,statementId:this.#list('statement').find(st=>st.jobId===j.id).id};}
      const capability={status:'configured',originalBytes:true,formats:['image/png'],paid:false,concurrency:1,evidence:'Fixed conventional tool pins; actual compatibility assessed at dispatch.'};
      const a=this.#operate('generator','job.allocate',{jobId:j.id,executor:PNG_SERVICE,executorKind:'service',capability});
      a.executorKind='service';a.serviceTool=clone(this.#serviceOptions);a.processQuiescent=true;this.#put('assignment',a);
      const st=this.#newStatement(r,{jobId:j.id,instructions:j.specification.prompt});
      st.service={assignmentId:a.id,executorId:PNG_SERVICE,executorKind:'service'};this.#put('statement',st);
      return {assignmentId:a.id,statementId:st.id};
    }
    if(op==='worker.assign'){
      const b=this.#get('sessionBinding',x.bindingId);requireThat(!b.revokedAt&&b.role==='worker'&&b.projectId===s.projectId&&b.hello,'Invalid or unverified worker binding',403);
      const j=this.#get('job',b.jobId),r=this.#get('round',j.roundId);requireThat(this.#butlerReady(r),'Butler not ready');
      const request=this.#get('request',this.#get('iteration',j.iterationId).requestId);
      if(request.selectionId)this.#selectionFence(this.#selectionRow(request.selectionId));
      if(j.assignmentId){const a=this.#get('assignment',j.assignmentId);requireThat(a.executor===b.sessionId,'Assignment worker changed',403);return {statement:this.#list('statement').find(st=>st.jobId===j.id),assignmentId:a.id};}
      const a=this.#operate('generator','job.allocate',{jobId:j.id,executor:b.sessionId,capability:x.capability});
      const st=this.#newStatement(r,{jobId:j.id,worker:this.#actor(b),instructions:j.specification.prompt,prompt:j.specification.prompt});
      return {statement:st,assignmentId:a.id};
    }
    if(op==='worker.start'){
      const j=this.#get('job',s.jobId);requireThat(this.#get('round',j.roundId).id===x.roundId,'Wrong worker round',403);
      const a=this.#get('assignment',j.assignmentId);requireThat(a.executor===s.sessionId&&this.#list('statement').some(st=>st.jobId===j.id&&st.worker?.bindingId===s.id),'Worker does not own this exact assignment/statement',403);
      const request=this.#get('request',this.#get('iteration',j.iterationId).requestId);
      if(request.selectionId)this.#selectionFence(this.#selectionRow(request.selectionId));
      return this.#operate('generator','attempt.start',{assignmentId:j.assignmentId});
    }
    if(op==='statement.report'){
      const st=this.#get('statement',x.statementId),r=this.#get('round',st.roundId);text(x.text,'attributable statement report',8000);
      requireThat(Object.keys(x).every(k=>['statementId','status','text'].includes(k)),'Reports cannot rewrite originating instructions');
      if(s.role==='worker')requireThat(st.worker?.bindingId===s.id&&st.jobId===s.jobId&&['produced','failed','uncertain','blocked'].includes(x.status),'Worker statement assignment mismatch',403);
      else requireThat(st.id===r.statementId&&r.butler.bindingId===s.id&&['ready','completed','incomplete','blocked'].includes(x.status),'Butler statement assignment mismatch',403);
      if(s.role==='worker'&&x.status==='blocked'){const job=this.#get('job',s.jobId);requireThat(job.state==='assigned'&&job.invocationsStarted===0,'Blocked report requires an unstarted assigned attempt',409);}
      if(s.role==='butler')requireThat(!this.#list('checkpoint').some(c=>c.roundId===r.id),'Round already checkpointed',409);
      if(x.status==='ready'){
        const p=this.#get('project',r.projectId);this.#folder(p,true);
      }
      if(['completed','incomplete'].includes(x.status)&&s.role==='butler'){
        requireThat(this.#list('presentation').some(p=>p.roundId===r.id),'Butler must record the actual presentation first',409);
        if(x.status==='completed'){
          const shown=this.#list('presentation').filter(p=>p.roundId===r.id).at(-1).references;
          const expected=r.operation==='generate'?this.#list('job').filter(j=>j.roundId===r.id&&j.state==='succeeded').map(j=>j.artifactId):r.references.map(ref=>ref.artifactId);
          requireThat(shown.length===expected.length&&expected.every(id=>shown.some(ref=>ref.artifactId===id)),'Completed presentation omits assigned material',409);
        }
        if(x.status==='completed'&&r.operation==='generate'){
          const jobs=this.#list('job').filter(j=>j.roundId===r.id);requireThat(jobs.length===r.expectedResults&&jobs.every(j=>['succeeded','failed'].includes(j.state)),'Expected batch is not accounted for',409);
          for(const j of jobs)requireThat(this.#list('statementEvent').some(e=>e.statementId===this.#list('statement').find(st=>st.jobId===j.id)?.id&&['produced','failed'].includes(e.kind)),'Executor report is missing',409);
        }
      }
      return this.#statementEvent(st,s,x.status,{text:x.text});
    }
    if(op==='round.present'){
      const r=this.#get('round',x.roundId);requireThat(r.butler.bindingId===s.id&&this.#butlerReady(r),'Butler round mismatch/not ready',403);
      requireThat(!this.#list('checkpoint').some(c=>c.roundId===r.id),'Checkpoint is immutable',409);
      text(x.title,'presentation title',300);const refs=this.#sourceReferences(x.references??[],s.projectId);refs.forEach(ref=>this.#verifyArtifact(this.#get('artifact',ref.artifactId)));
      if(r.operation==='generate')requireThat(refs.every(ref=>ref.iterationId===r.iterationId),'Presentation references another generation round');
      else requireThat(refs.every(ref=>r.references.some(expected=>expected.artifactId===ref.artifactId)),'Unassigned comparison material');
      return this.#put('presentation',{id:id(),roundId:r.id,projectId:r.projectId,title:x.title,references:refs,actor:this.#actor(s),createdAt:now()});
    }
    if(op==='round.disposition'){
      const r=this.#get('round',x.roundId);requireThat(this.#list('checkpoint').some(c=>c.roundId===r.id),'Round has no checkpoint',409);text(x.text,'Conductor disposition',4000);
      return this.#statementEvent(this.#get('statement',r.statementId),s,'disposition',{text:x.text});
    }
    throw new Fault('Unknown project operation',404);
  }
  #event(iteration,type,extra={}){const eid=`${iteration.id}:${type}`;if(this.#list('event').some(e=>e.id===eid))return;this.#put('event',{id:eid,projectId:iteration.projectId,iterationId:iteration.id,type,createdAt:now(),deliveryAttempts:[],acknowledgedAt:null,consumedAt:null,...extra});}
  call(token,op,key,input={}) {
    // No role property is interpreted; only the locally provisioned function credential selects operations.
    if(op==='result.deliver') return this.#deliver(token,key,input);
    const role=this.#role(token);
    if(['project.activate','project.instructions','staff.reserve','staff.bind','staff.retire','round.create','round.commission','worker.assign','worker.start','service.assign','statement.report','round.present','round.disposition'].includes(op))return this.#projectCall(token,op,key,input);
    if(op.startsWith('host.'))return this.#hostCall(token,op,key,input);
    if(op==='iteration.commission'&&this.#session(token))throw new Fault('Use round.commission after Butler readiness',403);
    this.#sessionScope(token,op,input);
    requireThat(permissions[role].includes(op),`${role} cannot call ${op}`,403);
    if(['job.allocate','attempt.start'].includes(op)){
      const job=op==='job.allocate'?this.#get('job',input.jobId):this.#get('job',this.#get('assignment',input.assignmentId).jobId);
      const request=this.#get('request',this.#get('iteration',job.iterationId).requestId);
      requireThat(!request.selectionId,'Selected jobs require exact scoped worker assignment and start',403);
    }
    text(key,'idempotency key',200);
    this.reconcile(this.#credentials.butler);
    const result=this.#tx(()=>{
      if(op==='attempt.start'){const a=this.#get('assignment',input.assignmentId),j=this.#get('job',a.jobId);requireThat(j.state==='assigned'&&!a.startedAt,'Attempt was already started or is uncertain; a lost start acknowledgement cannot authorize invocation again',409);}
      return this.#once(role+':'+op,key,input,()=>this.#operate(role,op,input));
    });
    this.reconcile(this.#credentials.butler);return clone(result);
  }
  #once(scope,key,input,fn){
    const fp=fingerprint(input), prior=this.#db.prepare('SELECT * FROM receipts WHERE scope=? AND key=?').get(scope,key);
    if(prior){requireThat(prior.fingerprint===fp,'Idempotency key payload conflict',409);return JSON.parse(prior.doc);}
    const value=fn();this.#db.prepare('INSERT INTO receipts VALUES(?,?,?,?)').run(scope,key,fp,JSON.stringify(value));return value;
  }
  #operate(role,op,x){
    if(['event.delivery','event.ack','event.consume'].includes(op))requireThat(this.#get('event',x.eventId).type!=='product-action','Product action evidence is immutable',409);
    switch(op){
      case 'project.create': {
        const p={id:id(),name:text(x.name,'project name',200),brief:text(x.brief,'brief'),page:'board',createdAt:now(),fixture:x.fixture===true,
          defaults:{count:integer(x.count??1,1,6,'candidate count'),direction:x.direction??'Fresh',brand:x.brand??null},standingRemaining:integer(x.standingIterations??0,0,20,'standing iterations')};
        p.code='P'+String(this.#list('project').length+1).padStart(3,'0');p.folder=this.#folder(p);
        requireThat(['Fresh','Follow'].includes(p.defaults.direction),'Invalid direction'); if(p.defaults.brand!==null)text(p.defaults.brand,'brand context');this.#put('project',p);
        return p;
      }
      case 'request.create': return this.#request(x);
      case 'iteration.commission': return this.#commission(x);
      case 'creativeContext.supply': return this.#preserveCreativeContext(x);
      case 'job.allocate': {
        const j=this.#get('job',x.jobId);requireThat(j.state==='queued','Job already allocated or resolved',409);
        const c=x.capability;requireThat(c&&(['simulated','demonstrated'].includes(c.status)||c.status==='configured'&&x.executorKind==='service'&&j.specification.executorKind==='service'&&this.#serviceOptions&&x.executor===PNG_SERVICE)&&c.originalBytes===true&&Array.isArray(c.formats)&&c.formats.includes('image/png')&&c.paid===false,'No compatible uncharged executor with original-byte delivery');
        requireThat(!(c.status==='demonstrated'&& !c.evidence),'Demonstrated capability needs actual host evidence');
        const token=secret(),a={id:id(),jobId:j.id,attemptId:id(),executor:text(x.executor,'executor',200),capability:clone(c),tokenHash:hash(token),token,allocatedAt:now(),startedAt:null};
        this.#put('assignment',a);j.state='assigned';j.assignmentId=a.id;j.allowanceReserved=1;this.#put('job',j);
        return {...a,specification:j.specification};
      }
      case 'attempt.start': {
        const a=this.#get('assignment',x.assignmentId),j=this.#get('job',a.jobId);
        requireThat(j.state==='assigned'&&!a.startedAt,'Attempt was already started or is uncertain',409);
        j.state='running';j.invocationsStarted=1;a.startedAt=now();this.#put('assignment',a);this.#put('job',j);return {assignmentId:a.id,attemptId:a.attemptId,startedAt:a.startedAt};
      }
      case 'draft.save': {
        const i=this.#get('iteration',x.iterationId),prev=this.#list('draft').find(d=>d.id===i.id),version=prev?.version??0;
        requireThat(x.expectedVersion===version,'Draft changed in another window; recover your pending words before replacing',409);
        this.#validateFeedback(i,x.feedback);
        const d={id:i.id,projectId:i.projectId,version:version+1,feedback:clone(x.feedback),savedAt:now()};return this.#put('draft',d);
      }
      case 'review.submit': {
        const i=this.#get('iteration',x.iterationId),d=this.#get('draft',i.id);
        requireThat(x.draftVersion===d.version,'Draft version changed',409);
        requireThat(['feedback','iterate'].includes(x.intent),'Explicit review intent required');this.#validateFeedback(i,d.feedback);
        const p=this.#get('project',i.projectId),s={id:id(),iterationId:i.id,projectId:i.projectId,draftVersion:d.version,feedback:clone(d.feedback),sourceArtifacts:i.jobIds.map(jobId=>this.#get('job',jobId)).filter(j=>j.state==='succeeded').map(j=>this.#sourceSnapshot(this.#get('artifact',j.artifactId))),intent:x.intent,submittedAt:now()};
        this.#put('submission',s);
        if(x.intent==='iterate'||p.standingRemaining>0){
          if(x.intent!=='iterate'){p.standingRemaining--;this.#put('project',p);s.standingPolicy=true;}
          const request=this.#request({projectId:p.id,parentReviewId:s.id,intent:x.nextIntent||`Continue using submitted review ${s.id}`,count:x.count,direction:x.direction,brand:x.brand});
          s.requestId=request.id;this.#put('submission',s);
        }
        return s;
      }
      case 'design.accept': {
        const a=this.#get('artifact',x.artifactId);this.#verifyArtifact(a);
        requireThat(x.judgment==='accept','Explicit human accept judgment required');return this.#put('acceptance',{id:id(),artifactId:a.id,projectId:a.projectId,acceptedAt:now(),judgment:'accept'});
      }
      case 'event.delivery': {
        const e=this.#get('event',x.eventId);const attempt={id:id(),at:now(),mechanism:text(x.mechanism,'notification mechanism',200),status:x.status,evidence:x.evidence??null};
        requireThat(['failed','sent'].includes(attempt.status),'Invalid delivery outcome');e.deliveryAttempts.push(attempt);this.#put('event',e);return attempt;
      }
      case 'event.ack': {
        const e=this.#get('event',x.eventId);text(x.receipt,'delivery acknowledgement');e.acknowledgedAt??=now();e.acknowledgement=x.receipt;return this.#put('event',e);
      }
      case 'event.consume': {
        const e=this.#get('event',x.eventId);e.consumedAt??=now();return this.#put('event',e);
      }
    }
    throw new Fault('Unknown operation',404);
  }
  #request(x){
    this.#requireDomain(x.projectId);
    const p=this.#get('project',x.projectId),count=integer(x.count??p.defaults.count,1,6,'candidate count'),direction=x.direction??p.defaults.direction,brand=x.brand===undefined?p.defaults.brand:x.brand;
    requireThat(['Fresh','Follow'].includes(direction),'Invalid direction');if(brand!==null)text(brand,'brand context');
    if(x.parentReviewId)requireThat(this.#get('submission',x.parentReviewId).projectId===p.id,'Review belongs to another project');
    const r={id:id(),projectId:p.id,parentReviewId:x.parentReviewId??null,intent:text(x.intent,'user intent'),count,direction,brand,createdAt:now(),state:'waiting-for-conductor',allowance:{primaryAttempts:count,maxRetries:0},gap:'Native Conductor adapter unavailable; resume via bounded Conductor interface'};
    p.defaults={count,direction,brand};this.#put('project',p);this.#put('request',r);return r;
  }
  #sourceSnapshot(a){
    if(a.origin==='import')return {artifactId:a.id,projectId:a.projectId,version:a.version,sha256:a.sha256,width:a.width,height:a.height,origin:'import',importId:a.importId,importRecord:a.importRecord};
    return {artifactId:a.id,projectId:a.projectId,iterationId:a.iterationId,jobId:a.jobId,version:a.version,sha256:a.sha256,width:a.width,height:a.height};
  }
  #knownSource(artifactId,projectId){
    let a=this.#list('artifact').find(a=>a.id===artifactId);
    if(!a){
      const snapshot=this.#list('submission').filter(s=>s.projectId===projectId).flatMap(s=>s.sourceArtifacts).find(ref=>ref.artifactId===artifactId&&ref.sha256);
      if(snapshot)a={...snapshot,id:snapshot.artifactId};
    }
    requireThat(a,'Unknown required source: '+artifactId,404);
    requireThat(a.projectId===projectId,'Foreign source: '+artifactId);
    return a;
  }
  #validateRegion(region){
    requireThat(region&&region.space==='normalized-original','Invalid source-region coordinate system');
    requireThat(['x','y','w','h'].every(k=>Number.isFinite(region[k]))&&region.x>=0&&region.y>=0&&region.w>0&&region.h>0&&region.x+region.w<=1.000001&&region.y+region.h<=1.000001,'Region outside original image');
  }
  #sourceReferences(refs,projectId){
    requireThat(Array.isArray(refs)&&refs.length<=6,'At most six explicit production source references');
    const seen=new Set();
    return refs.map(ref=>{
      const a=this.#knownSource(ref.artifactId,projectId);
      requireThat(!seen.has(a.id),'Duplicate production source');seen.add(a.id);
      requireThat(ref.sha256===a.sha256&&ref.version===a.version,'Source identity/version/hash mismatch: '+a.id);
      if(ref.width!==undefined)requireThat(ref.width===a.width,'Source width mismatch: '+a.id);
      if(ref.height!==undefined)requireThat(ref.height===a.height,'Source height mismatch: '+a.id);
      text(ref.role,'source role',2000);
      requireThat(ref.regions===undefined||Array.isArray(ref.regions)&&ref.regions.length<=24,'Invalid production regions');
      const regions=(ref.regions??[]).map(region=>{
        requireThat(Object.keys(region).every(k=>['space','x','y','w','h','meaning','reviewRegion'].includes(k)),'Invalid source-region fields');
        this.#validateRegion(region);text(region.meaning,'production region meaning',2000);
        const result={space:region.space,x:region.x,y:region.y,w:region.w,h:region.h,meaning:region.meaning};
        if(region.reviewRegion){
          const binding=region.reviewRegion,review=this.#get('submission',binding.reviewId);
          requireThat(review.projectId===projectId,'Foreign source-region review');
          const image=review.feedback.images.find(f=>f.artifactId===a.id);
          requireThat(image&&image.sha256===a.sha256&&image.version===a.version,'Source-region review binding mismatch');
          integer(binding.index,0,(image.regions?.length??0)-1,'review region index');
          const original=image.regions[binding.index];
          requireThat(['space','x','y','w','h'].every(k=>original[k]===region[k]),'Source-region geometry differs from original annotation');
          result.reviewRegion={reviewId:review.id,index:binding.index};
        }
        return result;
      });
      return {...this.#sourceSnapshot(a),role:ref.role,regions};
    });
  }
  #dependencyIssues(refs){
    const issues=[];
    for(const ref of refs){
      try{
        const target=ref.artifact??ref,a=this.#get('artifact',target.artifactId);
        requireThat(a.projectId===target.productId||a.projectId===target.projectId,'Foreign required source',409);
        requireThat(a.version===target.version&&a.sha256===target.sha256&&a.width===target.width&&a.height===target.height,'Required source canonical identity changed: '+target.artifactId,409);
        this.#verifyArtifact(a);
      }catch(e){issues.push({artifactId:(ref.artifact??ref).artifactId,reason:e.message});}
    }
    return issues;
  }
  #commission(x,{service=false}={}){
    this.#requireDomain(this.#get('request',x.requestId).projectId);
    const r=this.#get('request',x.requestId);requireThat(r.state==='waiting-for-conductor','Request already commissioned',409);
    requireThat(Array.isArray(x.specifications)&&x.specifications.length===r.count,'One distinct specification per requested candidate');
    let parent=null;
    if(r.parentReviewId){parent=this.#get('submission',r.parentReviewId);text(x.interpretation,'creative interpretation');}
    const selected=r.selectionId?this.#selectionRow(r.selectionId):null,run=selected?.body.run;
    const calibration=this.#calibrationFence(r.id);if(calibration)cal.check(cal.same(x.specifications,cal.specifications(calibration)),'EVIDENCE_MISMATCH');
    const serviceRecipes=run?.executionKind==='deterministic'?recipesForRun(run):null;
    if(serviceRecipes)domainCheck(service&&this.#serviceOptions&&run.executorId===PNG_SERVICE,'CAPABILITY_UNAVAILABLE');
    const outputRoles=run?.requestedOutputs.flatMap(y=>Array(y.count).fill(y.role))??null;
    const dirs=new Set(),prompts=new Set(),differences=new Set();
    const i={id:id(),projectId:r.projectId,page:'board',requestId:r.id,parentReviewId:r.parentReviewId,parentIterationId:parent?.iterationId??null,createdAt:now(),count:r.count,direction:r.direction,brand:r.brand,jobIds:[],interpretation:r.parentReviewId?{reviewId:r.parentReviewId,text:x.interpretation,createdAt:now()}:null};
    for(const [index,supplied] of x.specifications.entries()){
      const s=clone(supplied);
      if(serviceRecipes)requireThat(Object.keys(s).every(k=>['directionId','label','difference','prompt','brief','output','sources','attachments','parentArtifacts','parentRoundId','canonical','hardLimits','preferences','direction','brand'].includes(k)),'Unsafe deterministic specification');
      if(serviceRecipes){
        requireThat(s.output&&Object.keys(s.output).every(k=>['format','role','width','height'].includes(k))&&
          ['width','height'].every(k=>s.output[k]===undefined||s.output[k]===serviceRecipes[index].output[k]),'Unsafe deterministic output profile');
        requireThat(s.hardLimits===undefined||s.hardLimits&&Object.keys(s.hardLimits).every(k=>['maxBytes','maxPixels'].includes(k)),'Unsafe deterministic limits');
      }
      text(s.directionId,'direction identifier',200);text(s.difference,'intended difference');text(s.prompt,'prompt');text(s.brief,'exact brief');
      requireThat(!dirs.has(s.directionId)&&!prompts.has(s.prompt)&&!differences.has(s.difference),'Sibling directions, prompts and differences must be distinct');dirs.add(s.directionId);prompts.add(s.prompt);differences.add(s.difference);
      requireThat(s.output?.format==='image/png'&&(!run||s.output.role===outputRoles[index]),'PNG output/role required');
      // Canonical request settings are frozen once. Contradictory supplied settings reject.
      requireThat(s.direction===undefined||s.direction===r.direction,'Specification direction contradicts canonical request');
      requireThat(s.brand===undefined||s.brand===r.brand,'Specification Brand contradicts canonical request');
      s.direction=r.direction;s.brand=r.brand;
      requireThat(s.regions===undefined,'Production regions must be explicitly bound to sources[].regions');
      if(run){
        requireThat(isDeepStrictEqual(s.sources,run.sources)&&isDeepStrictEqual(s.attachments,run.attachments)&&
          isDeepStrictEqual(s.parentArtifacts,run.parentArtifacts)&&s.parentRoundId===run.parentRoundId&&
          isDeepStrictEqual(s.canonical,run.canonical),'Selected inputs and lineage cannot be changed');
        this.#selectionSources(run);s.sources=clone(run.sources);
      }else s.sources=this.#sourceReferences(s.sources,i.projectId);
      s.lineage={parentReviewId:r.parentReviewId,parentIterationId:i.parentIterationId};
      s.allowance={primaryAttempts:1,maxRetries:0};s.destination={projectId:i.projectId,iterationId:i.id};s.completion='Deliver original PNG bytes plus actual outcome evidence; no implicit acceptance';
      s.preferences=s.preferences??[];s.hardLimits={maxBytes:24*1024*1024,maxPixels:16_000_000,...s.hardLimits};
      integer(s.hardLimits.maxBytes,1,24*1024*1024,'byte limit');integer(s.hardLimits.maxPixels,1,run?16_000_000:databasePixelLimit(this.#db),'pixel limit');
      if(serviceRecipes){s.executorKind='service';s.executorId=PNG_SERVICE;s.recipe=serviceRecipes[index];s.output.width=s.recipe.output.width;s.output.height=s.recipe.output.height;}
      const dependencyIssues=this.#dependencyIssues(s.sources);
      const j={id:id(),projectId:i.projectId,iterationId:i.id,state:dependencyIssues.length?'blocked':'queued',dependencyIssues,allowanceReserved:0,invocationsStarted:0,specification:s,createdAt:now()};i.jobIds.push(j.id);this.#put('job',j);
    }
    this.#put('iteration',i);r.state='commissioned';r.iterationId=i.id;this.#put('request',r);return i;
  }
  #preserveCreativeContext(x){
    const fields=['projectId','iterationId','reviewId','kind','text','sources','constraints','provenance','supersedes'];
    requireThat(Object.keys(x).every(k=>fields.includes(k)),'Unsupported creative context field');
    const iteration=this.#get('iteration',x.iterationId);
    requireThat(iteration.projectId===x.projectId,'Creative context project/iteration mismatch');
    if(x.reviewId){const review=this.#get('submission',x.reviewId);requireThat(review.projectId===x.projectId&&review.iterationId===iteration.id,'Creative context review/iteration mismatch');}
    requireThat(['interpretation','decision','rationale'].includes(x.kind),'Invalid creative context kind');text(x.text,'creative context',4000);
    const sources=this.#sourceReferences(x.sources??[],x.projectId),constraints=x.constraints??[];
    requireThat(Array.isArray(constraints)&&constraints.length<=12,'Invalid creative constraints');constraints.forEach(c=>text(c,'creative constraint',300));
    const provenance=x.provenance??{};
    requireThat(provenance&&typeof provenance==='object'&&!Array.isArray(provenance)&&Object.keys(provenance).every(k=>['author','executor','tool'].includes(k)),'Invalid creative provenance');
    for(const value of Object.values(provenance))if(value!==null)text(value,'creative provenance',200);
    const all=this.#list('creativeContext');
    let previous=null;
    if(x.supersedes){
      previous=this.#get('creativeContext',x.supersedes);
      requireThat(previous.projectId===x.projectId&&previous.iterationId===x.iterationId&&previous.reviewId===(x.reviewId??null)&&previous.kind===x.kind,'Creative revision origin mismatch');
      requireThat(!all.some(n=>n.supersedes===previous.id),'Creative context revision already superseded',409);
    }else{
      const heads=all.filter(n=>n.iterationId===x.iterationId&&n.reviewId===(x.reviewId??null)&&!all.some(next=>next.supersedes===n.id));
      requireThat(heads.length<8,'Creative context limit: eight current notes per origin');
    }
    const noteId=id();
    return this.#put('creativeContext',{id:noteId,contextId:previous?.contextId??noteId,version:(previous?.version??0)+1,supersedes:previous?.id??null,projectId:x.projectId,iterationId:x.iterationId,reviewId:x.reviewId??null,kind:x.kind,text:x.text,sources,constraints,provenance:{author:provenance.author??null,executor:provenance.executor??null,tool:provenance.tool??null},createdAt:now()});
  }
  #validateFeedback(i,f){
    requireThat(f&&typeof f.overall==='string'&&f.overall.length<=20000&&Array.isArray(f.images),'Invalid feedback');
    const seen=new Set();
    for(const image of f.images){const a=this.#get('artifact',image.artifactId);requireThat(a.iterationId===i.id&&!seen.has(a.id),'Feedback image not in this iteration or duplicated');seen.add(a.id);
      requireThat(image.sha256===a.sha256&&image.version===a.version&&image.width===a.width&&image.height===a.height,'Feedback source identity mismatch');
      requireThat(typeof image.note==='string'&&image.note.length<=20000&&typeof image.favorite==='boolean'&&Array.isArray(image.regions),'Invalid image feedback');
      for(const rect of image.regions){requireThat(rect.space==='normalized-original'&&typeof rect.text==='string'&&rect.text.trim()&&rect.text.length<=20000,'Invalid regional feedback');
        requireThat(['x','y','w','h'].every(k=>Number.isFinite(rect[k]))&&rect.x>=0&&rect.y>=0&&rect.w>0&&rect.h>0&&rect.x+rect.w<=1.000001&&rect.y+rect.h<=1.000001,'Region outside original image');}
    }
  }
  #assignment(token){const a=this.#list('assignment').find(a=>equal(hash(token??''),a.tokenHash));requireThat(a,'Invalid assignment credential',403);return a;}
  #deliver(token,key,x){
    const a=this.#assignment(token);text(key,'delivery key',200);
    requireThat(x.assignmentId===a.id,'Executor cannot deliver for another assignment',403);
    const j=this.#get('job',a.jobId);requireThat(['running','uncertain','delivered','succeeded','failed'].includes(j.state),'Attempt never started',409);
    requireThat(['success','failure','uncertain'].includes(x.outcome),'Invalid executor outcome');
    const bytes=Buffer.from(x.bytes??'','base64');requireThat(bytes.length<=24*1024*1024,'Delivery too large',413);
    requireThat(x.evidence&&['simulated','host'].includes(x.evidence.kind),'Actual execution evidence kind required');
    const evidence=clone(x.evidence),fp=fingerprint({hash:hash(bytes),outcome:x.outcome,evidence});
    const result=this.#tx(()=>{
      if(x.outcome==='uncertain'){
        const observation={id:`${a.id}:${fp}`,assignmentId:a.id,jobId:j.id,evidence,sha256:hash(bytes),outcome:'uncertain',observedAt:now()};
        this.#db.prepare('INSERT OR IGNORE INTO bytes VALUES(?,?)').run(hash(bytes),bytes);this.#put('observation',observation);
        if(['running','uncertain'].includes(j.state)){j.state='uncertain';j.reason='Executor outcome uncertain; reconcile this same attempt, never reinvoke';this.#put('job',j);}
        return {observationId:observation.id,uncertain:true};
      }
      const existing=this.#list('delivery').find(d=>d.assignmentId===a.id);
      if(existing){
        if(existing.fingerprint===fp)return {deliveryId:existing.id,replayed:true};
        const priorConflict=this.#list('conflict').find(c=>c.assignmentId===a.id&&c.fingerprint===fp);
        if(priorConflict)return {conflict:true,conflictId:priorConflict.id,deliveryId:existing.id,replayed:true};
        const conflict={id:id(),assignmentId:a.id,originalDeliveryId:existing.id,sha256:hash(bytes),fingerprint:fp,evidence,outcome:x.outcome,receivedAt:now()};
        this.#db.prepare('INSERT OR IGNORE INTO bytes VALUES(?,?)').run(hash(bytes),bytes);this.#put('conflict',conflict);return {conflict:true,conflictId:conflict.id,deliveryId:existing.id};
      }
      this.#db.prepare('INSERT OR IGNORE INTO bytes VALUES(?,?)').run(hash(bytes),bytes);
      const d={id:id(),assignmentId:a.id,jobId:j.id,sha256:hash(bytes),fingerprint:fp,evidence,outcome:x.outcome,state:'pending',receivedAt:now()};this.#put('delivery',d);j.state='delivered';this.#put('job',j);return {deliveryId:d.id};
    });
    // Intake receipt commits before independent validation. A process death here is recoverable.
    return result;
  }
  #verifyArtifact(a,{maxBytes=null}={}){
    requireThat(a.origin===undefined||['import','produced'].includes(a.origin),'Unsupported artifact origin',409);
    if(a.origin==='import')verifyImportedArtifact(this.#db,a);
    const b=maxBytes===null?this.#db.prepare('SELECT data FROM bytes WHERE hash=?').get(a.sha256)?.data:
      this.#db.prepare('SELECT data FROM bytes WHERE hash=? AND length(data)<=?').get(a.sha256,maxBytes)?.data;
    requireThat(b,`Missing original: ${a.id}`,409);let v;
    try{v=verifyPNG(b,{maxPixels:databasePixelLimit(this.#db)});}catch(e){throw new Fault(`Corrupt original ${a.id}: ${e.message}`,409);}
    requireThat(v.sha256===a.sha256&&v.width===a.width&&v.height===a.height,`Original hash or dimensions mismatch: ${a.id}`,409);return v;
  }
  reconcile(token){
    requireThat(this.#role(token)==='butler'&&!this.#session(token),'Only deterministic Butler service reconciles',403);
    return this.#tx(()=>{
      for(const d of this.#list('delivery').filter(d=>d.state==='pending')){
        const a=this.#get('assignment',d.assignmentId),j=this.#get('job',d.jobId);
        try{
          requireThat(a.jobId===j.id&&j.assignmentId===a.id,'Invalid assignment association');
          if(d.outcome==='uncertain'){j.state='uncertain';j.reason='Executor reports uncertain outcome; no additional attempt';}
          else if(d.outcome==='failure'){j.state='failed';j.reason='Executor reported failure';}
          else{
            const bytes=this.#db.prepare('SELECT data FROM bytes WHERE hash=?').get(d.sha256)?.data,v=verifyPNG(bytes,{maxPixels:databasePixelLimit(this.#db)});
            requireThat(v.sha256===d.sha256,'Intake hash mismatch');const spec=j.specification;
            requireThat(v.size<=spec.hardLimits.maxBytes&&v.width*v.height<=spec.hardLimits.maxPixels,'Output exceeds frozen hard limit');
            if(spec.output.width)requireThat(v.width===spec.output.width,'Output width violates hard expectation');
            if(spec.output.height)requireThat(v.height===spec.output.height,'Output height violates hard expectation');
            const artifact={id:id(),version:1,jobId:j.id,iterationId:j.iterationId,projectId:j.projectId,deliveryId:d.id,assignmentId:a.id,attemptId:a.attemptId,...v,verifiedAt:now(),sources:spec.sources};
            if(a.executorKind==='service'){artifact.origin='produced';artifact.recipeHash=recipeHash(spec.recipe);artifact.uncompositedParent=clone(spec.recipe.scene);artifact.logoLayer=clone(spec.recipe.logo);}
            this.#put('artifact',artifact);j.state='succeeded';j.artifactId=artifact.id;
          }
          d.state='processed';
        }catch(e){j.state='failed';j.reason=`Independent intake rejected: ${e.message}`;d.state='rejected';d.reason=j.reason;}
        d.processedAt=now();this.#put('delivery',d);this.#put('job',j);
      }
      for(const i of this.#list('iteration')){
        const jobs=i.jobIds.map(k=>this.#get('job',k)),available=jobs.filter(j=>j.state==='succeeded').length;
        const resolved=jobs.every(j=>['succeeded','failed'].includes(j.state));
        if(available&&!resolved)this.#event(i,'partial-review',{available,total:i.count});
        if(resolved)this.#event(i,'review-ready',{available,total:i.count,failed:jobs.filter(j=>j.state==='failed').length});
      }
      // Only actual production dependencies affect dispatch readiness, independently per job.
      for(const j of this.#list('job').filter(j=>['queued','assigned','blocked'].includes(j.state))){
        const dependencyIssues=this.#dependencyIssues(j.specification.sources),state=dependencyIssues.length?'blocked':j.assignmentId?'assigned':'queued';
        if(j.state!==state||JSON.stringify(j.dependencyIssues)!==JSON.stringify(dependencyIssues)){
          j.state=state;j.dependencyIssues=dependencyIssues;this.#put('job',j);
        }
      }
      for(const s of this.#list('submission')){
        const i=this.#get('iteration',s.iterationId),issues=[],availableSources=[];
        for(const source of s.sourceArtifacts){
          try{
            const a=this.#get('artifact',source.artifactId);
            if(source.sha256)requireThat(a.sha256===source.sha256&&a.version===source.version&&a.projectId===s.projectId,'Historical source identity changed: '+source.artifactId,409);
            this.#verifyArtifact(a);availableSources.push(this.#sourceSnapshot(a));
          }catch(e){issues.push({artifactId:source.artifactId,reason:e.message});}
        }
        const allNotes=this.#list('creativeContext'),notes=allNotes.filter(n=>n.projectId===s.projectId&&n.iterationId===i.id&&(n.reviewId===null||n.reviewId===s.id)&&!allNotes.some(next=>next.supersedes===n.id));
        this.#put('continuation',{id:s.id,submissionId:s.id,iterationId:i.id,projectId:s.projectId,status:'ready',reviewEvidence:s.sourceArtifacts,feedback:s.feedback,
          historicalCoverage:{status:issues.length?'limited':'complete',availableSources,issues},
          creativeContext:notes,optional:{screenshots:{status:'unavailable',required:false},conductorNotes:{status:notes.length?'available':'unavailable',required:false,references:notes.map(n=>({id:n.id,contextId:n.contextId,version:n.version})),sourceIssues:notes.flatMap(n=>this.#dependencyIssues(n.sources).map(issue=>({contextId:n.id,...issue}))) }},preparedAt:now()});
        if(s.requestId)this.#event(i,'continuation:'+s.id,{submissionId:s.id,requestId:s.requestId});
      }
      for(const r of this.#list('round')){
        if(this.#butlerReady(r)){
          const project=this.#get('project',r.projectId),unavailable=!!project.domainWorkspaceId&&this.#currentDomain()?.status!=='current';
          this.#folder(project,true,unavailable);
        }
        if(this.#list('checkpoint').some(c=>c.roundId===r.id))continue;
        const completion=this.#list('statementEvent').filter(e=>e.statementId===r.statementId&&['completed','incomplete'].includes(e.kind)).at(-1);
        if(!completion)continue;
        const presentation=this.#list('presentation').filter(p=>p.roundId===r.id).at(-1),jobs=this.#list('job').filter(j=>j.roundId===r.id);
        const state=completion.kind==='completed'&&jobs.every(j=>j.state==='succeeded')?'completed':'incomplete';
        const checkpoint=this.#put('checkpoint',{id:id(),projectId:r.projectId,roundId:r.id,parentRoundId:r.parentRoundId,state,operation:r.operation,expectedResults:r.expectedResults,artifacts:presentation.references,statementIds:this.#list('statement').filter(st=>st.roundId===r.id).map(st=>st.id),statementEventIds:this.#list('statementEvent').filter(e=>e.roundId===r.id).map(e=>e.id),presentationId:presentation.id,feedbackIds:r.feedbackIds,committedAt:now()});
        this.#event(r,'round-complete',{roundId:r.id,iterationId:r.iterationId??null,checkpointId:checkpoint.id,state});
      }
      return {ok:true};
    });
  }
  read(token,kind){
    this.#workspace?.assertRuntime();
    const role=this.#role(token);
    const common=['round','statement','statementEvent','checkpoint','presentation','projectInstruction','sessionBinding'];
    const allowed={human:['project','request','iteration','job','artifact','draft','submission','continuation','acceptance','creativeContext','event','delivery','conflict','observation'],conductor:['project','request','iteration','job','artifact','submission','continuation','creativeContext','event'],generator:['job','assignment'],butler:['project','iteration','artifact','submission','continuation','creativeContext','job','assignment','delivery','event','conflict','observation'],worker:['project','job','assignment']};
    requireThat([...allowed[role],...common].includes(kind),'Read boundary rejected',403);
    const binding=this.#session(token);
    const values=this.#list(kind).filter(v=>kind!=='event'||v.type!=='product-action').filter(v=>!binding||this.#belongs(v,kind,binding.projectId)).filter(v=>{
      if(binding?.role!=='worker')return true;
      if(kind==='job')return v.id===binding.jobId;
      if(kind==='assignment'||kind==='statement')return v.jobId===binding.jobId;
      if(kind==='statementEvent')return this.#get('statement',v.statementId).jobId===binding.jobId;
      if(kind==='sessionBinding')return v.id===binding.id||['conductor','butler'].includes(v.role);
      if(kind==='round')return v.id===this.#get('job',binding.jobId).roundId;
      return kind==='project';
    });
    return clone(values.map(v=>kind==='statement'?this.#statementView(v):kind==='round'?this.#roundView(v):kind==='project'?this.#projectView(v):kind==='sessionBinding'?{...this.#safeBinding(v),active:!v.revokedAt&&['conductor','butler','worker'].includes(v.role)&&v.tier===(v.role==='conductor'?'SOL':'LUNA')}:this.#safeBinding(v)));
  }
  round(token,roundId){
    const round=this.read(token,'round').find(r=>r.id===roundId);requireThat(round,'Round outside caller scope',403);
    return {round,statements:this.read(token,'statement').filter(s=>s.roundId===roundId),checkpoint:this.read(token,'checkpoint').find(c=>c.roundId===roundId)??null,presentation:this.read(token,'presentation').filter(p=>p.roundId===roundId).at(-1)??null};
  }
  assignment(token){
    const a=this.#assignment(token),j=this.#get('job',a.jobId),{token:t,tokenHash,...safe}=a;
    let resultReport;
    if(a.executorKind==='service'){
      const row=this.#db.prepare('SELECT doc FROM receipts WHERE scope=? AND key=?').get('service:'+a.id+':report','report:'+a.id);
      if(row){
        const e=JSON.parse(row.doc);requireThat(e.actor?.bindingId===a.id&&['produced','failed'].includes(e.kind)&&e.statementId===this.#list('statement').find(s=>s.jobId===j.id)?.id,'Invalid original service report',409);
        resultReport={status:e.kind,text:e.report.text,quiescent:e.report.quiescent};
      }else resultReport=null;
    }
    const request=this.#get('request',this.#get('iteration',j.iterationId).requestId);
    let operationSelection;
    if(request.selectionId){
      const row=this.#selectionRow(request.selectionId);this.#selectionLinks(row);
      const {workspaceId,projectId,requestId,domainHead,run,operation,brand}=row.body;
      // Only explicit assigned inputs/policy: no dossier notes/proposals, business
      // records, unrelated closure or permission evidence. This is not a grant.
      const choice=x=>x?{reference:x.reference,record:x.record}:null;
      operationSelection={schemaVersion:'3djat.assigned-operation.v1',id:row.id,retainedBodySha256:row.bodySha256,
        body:{workspaceId,projectId,requestId,domainHead,run,operation:choice(operation),brand:choice(brand)}};
    }
    return clone({...safe,specification:j.specification,state:j.state,...(operationSelection?{operationSelection}:{}),...(a.executorKind==='service'?{resultReport}:{} )});
  }
  // Read-only source resolution is distinct from raster decoding: experimental
  // refs decline before inflate/cache, and a cache hit still verifies the BLOB.
  #mediaSource(token,q){
    checkMediaQuery(q);const role=this.#role(token),session=this.#session(token);
    requireThat(['human','conductor'].includes(role)&&(!session||session.projectId===q.productId),'Media scope rejected',403);
    this.#workspace?.assertRuntime();const a=this.#get('artifact',q.artifactId);
    requireThat(a.origin===undefined||['import','produced'].includes(a.origin),'Unsupported artifact origin',409);
    requireThat(a.projectId===q.productId&&a.id===q.artifactId&&a.version===q.version&&a.sha256===q.sha256&&a.width===q.width&&a.height===q.height,'Media reference mismatch',409);
    if(a.origin==='import')try{verifyImportedArtifact(this.#db,a);}catch{throw new Fault('Media provenance mismatch',409);}
    const sourceBinding={artifact:clone(q),origin:a.origin==='import'?{kind:'import',importId:a.importId,importRecord:clone(a.importRecord)}:{kind:'produced',jobId:a.jobId??null,iterationId:a.iterationId??null,deliveryId:a.deliveryId??null}};
    const row=this.#db.prepare('SELECT data FROM bytes WHERE hash=? AND length(data)<=?').get(a.sha256,PREVIEW_LIMITS.encoded);
    if(!row)return {sourceBinding,errorCode:this.#db.prepare('SELECT 1 FROM bytes WHERE hash=?').get(a.sha256)?'ORIGINAL_CORRUPT':'ORIGINAL_MISSING'};
    const bytes=Buffer.from(row.data);return {sourceBinding,bytes,errorCode:hash(bytes)===a.sha256?null:'ORIGINAL_CORRUPT'};
  }
  artifactMedia(token,q){
    let source;try{source=this.#mediaSource(token,q);}catch(e){if(e instanceof Fault)throw e;throw new Fault(e.code==='INVALID_VALUE'?'Invalid media query':'Media unavailable',e.code==='INVALID_VALUE'?400:409);}
    const {sourceBinding,bytes,errorCode}=source;if(errorCode)return unavailableMedia(sourceBinding,errorCode);
    if(q.width*q.height>PREVIEW_LIMITS.pixels)return unavailableMedia(sourceBinding,'PIXEL_POLICY');
    const key=mediaKey(sourceBinding);this.#workspaceHook('media-before-cache',{});const entry=this.#mediaCache.get(key);let result,rebuild=false;
    if(entry){this.#workspaceHook('media-cache-read',{entry});try{
      domainCheck(typeof entry.json==='string'&&entry.json.length<=PREVIEW_LIMITS.response&&entry.sha256===hash(Buffer.from(entry.json)),'EVIDENCE_MISMATCH');
      result=JSON.parse(entry.json);checkMediaView(result,sourceBinding);domainCheck(result.state==='ready'&&result.warnings.length===0,'EVIDENCE_MISMATCH');
    }catch{rebuild=true;result=null;}}
    if(!result){
      this.#workspaceHook('media-before-compute',{});
      try{result=buildMedia(sourceBinding,bytes,{onInflate:()=>this.#workspaceHook('media-source-inflate',{})});checkMediaView(result,sourceBinding);}
      catch(e){result=unavailableMedia(sourceBinding,['ORIGINAL_CORRUPT','PREVIEW_LIMIT','PREVIEW_UNSUPPORTED'].includes(e.code)?e.code:'PREVIEW_FAILED');}
      this.#workspaceHook('media-after-compute',{});
      if(result.state==='ready'){
        const json=JSON.stringify(result),sha256=hash(Buffer.from(json)),cost=Buffer.byteLength(json)+Buffer.byteLength(key)+Buffer.byteLength(sha256),priorCost=entry?.cost??0;
        this.#workspaceHook('media-before-cache-publish',{});
        if(this.#mediaBytes-priorCost+cost<=PREVIEW_LIMITS.cacheBytes&&(entry||this.#mediaCache.size<PREVIEW_LIMITS.cacheEntries)){
          this.#mediaCache.set(key,{json,sha256,cost});this.#mediaBytes+=cost-priorCost;
        }
        this.#workspaceHook('media-after-cache-publish',{entries:this.#mediaCache.size,bytes:this.#mediaBytes});
      }
    }
    this.#workspaceHook('media-before-response',{});
    const current=this.#mediaSource(token,q);requireThat(canonical(current.sourceBinding)===canonical(sourceBinding),'Media provenance changed',409);
    if(current.errorCode)return unavailableMedia(sourceBinding,current.errorCode);
    if(rebuild&&result.state==='ready')result.warnings=['CACHE_REBUILT'];return clone(result);
  }
  original(token,artifactId){
    try{this.#role(token);}catch{const assigned=this.#assignment(token),job=this.#get('job',assigned.jobId);requireThat(job.specification.sources.some(ref=>(ref.artifact??ref).artifactId===artifactId),'Executor can only read assigned source originals',403);}
    const a=this.#get('artifact',artifactId),binding=this.#session(token);if(binding)requireThat(['conductor','butler'].includes(binding.role)&&a.projectId===binding.projectId,'Session original boundary rejected',403);this.#verifyArtifact(a);return Buffer.from(this.#db.prepare('SELECT data FROM bytes WHERE hash=?').get(a.sha256).data);}
  portable(token,submissionId,{jobId=null}={}){
    const role=this.#role(token);requireThat(['human','conductor'].includes(role),'Portable review boundary',403);
    this.reconcile(this.#credentials.butler);
    const submission=this.#get('submission',submissionId);this.#sessionScope(token,'portable',{projectId:submission.projectId});
    const continuation=this.#get('continuation',submissionId),iteration=this.#get('iteration',submission.iterationId);
    let requested=continuation.historicalCoverage.availableSources,production=null,missing=continuation.historicalCoverage.issues;
    if(jobId){
      const job=this.#get('job',jobId),child=this.#get('iteration',job.iterationId);
      requireThat(job.projectId===submission.projectId&&child.parentReviewId===submission.id,'Portable job/review mismatch');
      requested=job.specification.sources;missing=this.#dependencyIssues(requested);
      production={jobId:job.id,iterationId:child.id,specification:job.specification,dependencyStatus:missing.length?'blocked':'ready'};
    }
    const included=requested.filter(ref=>!missing.some(issue=>issue.artifactId===ref.artifactId));
    return {format:'bve-v2-review-v2',purpose:production?{kind:'production-job',jobId}:{kind:'review-evidence'},exportedAt:now(),submission,continuation,iteration,production,
      coverage:{status:missing.length?(production?'blocked':'limited'):'complete',historical:continuation.historicalCoverage.status,missing,expectedArtifactIds:production?requested.map(ref=>ref.artifactId):submission.sourceArtifacts.map(ref=>ref.artifactId),includedArtifactIds:included.map(ref=>ref.artifactId)},
      originals:included.map(ref=>({...ref,mediaType:'image/png',bytes:this.original(token,ref.artifactId).toString('base64')}))};
  }
}
