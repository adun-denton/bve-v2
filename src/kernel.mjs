import { isDeepStrictEqual } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync, existsSync, readFileSync, writeFileSync, chmodSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { hash, verifyPNG } from './png.mjs';
import { DomainProducts } from './domain-products.mjs';
import {AssetImports,checkImportFormat,installImportFormat,verifyImportedArtifact,importFailure} from './asset-import.mjs';
import { WorkspaceConnection, RootGuard, inspectRuntime, acquireOperational, verifyLegacyMigration, projection, putProjection, validateAdoption, makeSelection, verifySelection, sameRef, check as domainCheck, fail as domainFail } from './workspace.mjs';
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
  #db; #credentials; #closed=false; #workspace=null; #workspaceHook=()=>{}; #inTransaction=false; #operationalHeld=false; #products=null; #productOptions=null; #imports=null; #importOptions=null;
  constructor(root,{recover=true,workspace=null,expectedHead=null,migrate=false,migrationBackup=null,confirmedQuiescent=false,workspaceHook=()=>{},products=null,imports=null}={}) {
    this.root=resolve(root);this.#workspaceHook=workspaceHook;
    this.#productOptions=products;
    this.#importOptions=imports;
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
      checkImportFormat(this.#db,this.root);
      if(imports){requireThat(this.#workspace,'Imports require an explicit connected workspace',409);installImportFormat(this.#db,this.root,{fresh:!info.hasRecords,backup:imports.migrationBackup,confirmedQuiescent:imports.confirmedQuiescent,tx:fn=>this.#tx(fn)});}
      if(recover)this.#tx(()=>{for(const j of this.#list('job'))if(j.state==='running'){j.state='uncertain';j.uncertainAt=now();j.reason='Owner stopped after durable invocation start; reconcile original assignment; no retry';this.#put('job',j);}});
      this.reconcile(this.#credentials.butler);
    }catch(e){this.close();throw e;}
  }
  close(){if(!this.#closed){this.#db.close();this.#closed=true;}}
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
    if(!this.#products){this.#workspace.read();domainCheck(Object.keys(this.#productOptions).length===1&&typeof this.#productOptions.accessFile==='string','INVALID_VALUE');
      const rel=resolve(this.#productOptions.accessFile);domainCheck(rel!==this.root&&!rel.startsWith(this.root+'/')&&!rel.startsWith(this.root+'\\'),'UNSAFE_PATH');
      const writer=new DomainProducts(this.#workspace.config.domainRoot,{accessFile:rel,authenticate:token=>{
        let role;try{role=this.#role(token);}catch{return null;}const session=this.#session(token);
        if(!['human','conductor','butler'].includes(role))return null;
        return {id:session?'bve-session-'+session.id:'bve-'+role,role,products:session?[session.projectId]:'*',sourceIds:[]};
      },beforePublish:event=>this.#copyProductAction(event),hook:(stage,detail)=>this.#workspaceHook('products:'+stage,detail)});this.#workspace.read();this.#products=writer;
    }return this.#products;
  }
  productReview(token,query){try{return clone(this.#productWriter().readReview(token,query));}catch(e){throw new Fault(e.code??'Product review unavailable',e.code==='INVALID_SCOPE'?403:409);}}
  productCommand(token,packet){
    let writer;try{writer=this.#productWriter();}catch(e){return DomainProducts.failure(packet,e);}
    const result=writer.command(token,packet);if(result.schemaVersion==='3djat.failure.v1')return clone(result);
    try{
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
      const job=this.#get('job',jobId);requireThat(job.projectId===projectId&&job.roundId,'Worker job/project mismatch',403);
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
    return {receipt,context,...(assignment?{assignmentAccess:clone({...assignment,specification:this.#get('job',s.jobId).specification})}:{})};
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
    requireThat(allowed[s.role].includes(op),`${s.role} cannot call ${op}`,403);
    if(op!=='project.activate'){
      const projectId=x.roundId?this.#get('round',x.roundId).projectId:x.statementId?this.#get('statement',x.statementId).projectId:x.projectId;
      requireThat(projectId===s.projectId&&projectId!==null,'Cross-project operation rejected',403);
    }
    this.reconcile(this.#credentials.butler);
    if(op==='worker.start'){const j=this.#get('job',s.jobId),a=this.#get('assignment',j.assignmentId);requireThat(j.state==='assigned'&&!a.startedAt,'Attempt already started or uncertain; no automatic re-invocation',409);}
    const result=this.#tx(()=>this.#once('project-session:'+s.id+':'+op,key,x,()=>this.#projectOperate(s,op,x)));
    this.reconcile(this.#credentials.butler);return clone(result);
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
        const j=this.#get('job',x.jobId);requireThat(j.projectId===s.projectId&&j.roundId,'Worker job/project mismatch',403);
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
      let request=null;if(x.operation==='generate'){request=this.#get('request',x.requestId);requireThat(request.projectId===s.projectId&&request.state==='waiting-for-conductor','No pending project generation request',409);requireThat(!this.#list('round').some(r=>r.requestId===request.id),'Request already belongs to a round',409);}
      const r=this.#put('round',{id:id(),code:'R'+String(this.#list('round').filter(r=>r.projectId===s.projectId).length+1).padStart(3,'0'),projectId:s.projectId,parentRoundId:x.parentRoundId??null,operation:x.operation,intent:x.intent,requestId:request?.id??null,expectedResults:request?.count??0,conductor:this.#actor(s),butler:this.#actor(butler),butlerInstructions:x.butlerInstructions,references,feedbackIds,createdAt:now()});
      const st=this.#newStatement(r,{instructions:x.butlerInstructions});r.statementId=st.id;this.#put('round',r);return r;
    }
    if(op==='round.commission'){
      const r=this.#get('round',x.roundId);requireThat(r.operation==='generate'&&!r.iterationId,'Round is not awaiting generation commission',409);requireThat(this.#butlerReady(r),'Butler must be ready before production',409);
      const i=this.#commission({requestId:r.requestId,specifications:x.specifications,interpretation:x.interpretation});i.roundId=r.id;this.#put('iteration',i);
      for(const jobId of i.jobIds){const j=this.#get('job',jobId);j.roundId=r.id;j.code='J'+String(this.#list('job').filter(j=>j.projectId===r.projectId&&j.roundId).length+1).padStart(3,'0');this.#put('job',j);}
      r.iterationId=i.id;this.#put('round',r);return i;
    }
    if(op==='worker.assign'){
      const b=this.#get('sessionBinding',x.bindingId);requireThat(!b.revokedAt&&b.role==='worker'&&b.projectId===s.projectId&&b.hello,'Invalid or unverified worker binding',403);
      const j=this.#get('job',b.jobId),r=this.#get('round',j.roundId);requireThat(this.#butlerReady(r),'Butler not ready');
      if(j.assignmentId){const a=this.#get('assignment',j.assignmentId);requireThat(a.executor===b.sessionId,'Assignment worker changed',403);return {statement:this.#list('statement').find(st=>st.jobId===j.id),assignmentId:a.id};}
      const a=this.#operate('generator','job.allocate',{jobId:j.id,executor:b.sessionId,capability:x.capability});
      const st=this.#newStatement(r,{jobId:j.id,worker:this.#actor(b),instructions:j.specification.prompt,prompt:j.specification.prompt});
      return {statement:st,assignmentId:a.id};
    }
    if(op==='worker.start'){
      const j=this.#get('job',s.jobId);requireThat(this.#get('round',j.roundId).id===x.roundId,'Wrong worker round',403);
      const a=this.#get('assignment',j.assignmentId);requireThat(a.executor===s.sessionId&&this.#list('statement').some(st=>st.jobId===j.id&&st.worker?.bindingId===s.id),'Worker does not own this exact assignment/statement',403);
      return this.#operate('generator','attempt.start',{assignmentId:j.assignmentId});
    }
    if(op==='statement.report'){
      const st=this.#get('statement',x.statementId),r=this.#get('round',st.roundId);text(x.text,'attributable statement report',8000);
      requireThat(Object.keys(x).every(k=>['statementId','status','text'].includes(k)),'Reports cannot rewrite originating instructions');
      if(s.role==='worker')requireThat(st.worker?.bindingId===s.id&&st.jobId===s.jobId&&['produced','failed','uncertain'].includes(x.status),'Worker statement assignment mismatch',403);
      else requireThat(st.id===r.statementId&&r.butler.bindingId===s.id&&['ready','completed','incomplete','blocked'].includes(x.status),'Butler statement assignment mismatch',403);
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
          for(const j of jobs)requireThat(this.#list('statementEvent').some(e=>e.statementId===this.#list('statement').find(st=>st.jobId===j.id)?.id&&['produced','failed'].includes(e.kind)),'Worker report is missing',409);
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
    if(['project.activate','project.instructions','staff.reserve','staff.bind','staff.retire','round.create','round.commission','worker.assign','worker.start','statement.report','round.present','round.disposition'].includes(op))return this.#projectCall(token,op,key,input);
    if(op.startsWith('host.'))return this.#hostCall(token,op,key,input);
    if(op==='iteration.commission'&&this.#session(token))throw new Fault('Use round.commission after Butler readiness',403);
    this.#sessionScope(token,op,input);
    requireThat(permissions[role].includes(op),`${role} cannot call ${op}`,403);
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
        const c=x.capability;requireThat(c&&['simulated','demonstrated'].includes(c.status)&&c.originalBytes===true&&Array.isArray(c.formats)&&c.formats.includes('image/png')&&c.paid===false,'No compatible uncharged executor with original-byte delivery');
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
        const a=this.#get('artifact',ref.artifactId);
        requireThat(a.projectId===ref.projectId&&a.version===ref.version&&a.sha256===ref.sha256&&a.width===ref.width&&a.height===ref.height,'Required source canonical identity changed: '+ref.artifactId,409);
        this.#verifyArtifact(a);
      }catch(e){issues.push({artifactId:ref.artifactId,reason:e.message});}
    }
    return issues;
  }
  #commission(x){
    this.#requireDomain(this.#get('request',x.requestId).projectId);
    const r=this.#get('request',x.requestId);requireThat(r.state==='waiting-for-conductor','Request already commissioned',409);
    requireThat(Array.isArray(x.specifications)&&x.specifications.length===r.count,'One distinct specification per requested candidate');
    let parent=null;
    if(r.parentReviewId){parent=this.#get('submission',r.parentReviewId);text(x.interpretation,'creative interpretation');}
    const dirs=new Set(),prompts=new Set(),differences=new Set();
    const i={id:id(),projectId:r.projectId,page:'board',requestId:r.id,parentReviewId:r.parentReviewId,parentIterationId:parent?.iterationId??null,createdAt:now(),count:r.count,direction:r.direction,brand:r.brand,jobIds:[],interpretation:r.parentReviewId?{reviewId:r.parentReviewId,text:x.interpretation,createdAt:now()}:null};
    for(const supplied of x.specifications){
      const s=clone(supplied);text(s.directionId,'direction identifier',200);text(s.difference,'intended difference');text(s.prompt,'prompt');text(s.brief,'exact brief');
      requireThat(!dirs.has(s.directionId)&&!prompts.has(s.prompt)&&!differences.has(s.difference),'Sibling directions, prompts and differences must be distinct');dirs.add(s.directionId);prompts.add(s.prompt);differences.add(s.difference);
      requireThat(s.output?.format==='image/png','PNG output required');
      // Canonical request settings are frozen once. Contradictory supplied settings reject.
      requireThat(s.direction===undefined||s.direction===r.direction,'Specification direction contradicts canonical request');
      requireThat(s.brand===undefined||s.brand===r.brand,'Specification Brand contradicts canonical request');
      s.direction=r.direction;s.brand=r.brand;
      requireThat(s.regions===undefined,'Production regions must be explicitly bound to sources[].regions');
      s.sources=this.#sourceReferences(s.sources,i.projectId);
      s.lineage={parentReviewId:r.parentReviewId,parentIterationId:i.parentIterationId};
      s.allowance={primaryAttempts:1,maxRetries:0};s.destination={projectId:i.projectId,iterationId:i.id};s.completion='Deliver original PNG bytes plus actual outcome evidence; no implicit acceptance';
      s.preferences=s.preferences??[];s.hardLimits={maxBytes:24*1024*1024,maxPixels:16_000_000,...s.hardLimits};
      integer(s.hardLimits.maxBytes,1,24*1024*1024,'byte limit');integer(s.hardLimits.maxPixels,1,16_000_000,'pixel limit');
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
  #verifyArtifact(a){
    requireThat(a.origin===undefined||['import','produced'].includes(a.origin),'Unsupported artifact origin',409);
    if(a.origin==='import')verifyImportedArtifact(this.#db,a);
    const b=this.#db.prepare('SELECT data FROM bytes WHERE hash=?').get(a.sha256)?.data;
    requireThat(b,`Missing original: ${a.id}`,409);let v;
    try{v=verifyPNG(b);}catch(e){throw new Fault(`Corrupt original ${a.id}: ${e.message}`,409);}
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
            const bytes=this.#db.prepare('SELECT data FROM bytes WHERE hash=?').get(d.sha256)?.data,v=verifyPNG(bytes);
            requireThat(v.sha256===d.sha256,'Intake hash mismatch');const spec=j.specification;
            requireThat(v.size<=spec.hardLimits.maxBytes&&v.width*v.height<=spec.hardLimits.maxPixels,'Output exceeds frozen hard limit');
            if(spec.output.width)requireThat(v.width===spec.output.width,'Output width violates hard expectation');
            if(spec.output.height)requireThat(v.height===spec.output.height,'Output height violates hard expectation');
            const artifact={id:id(),version:1,jobId:j.id,iterationId:j.iterationId,projectId:j.projectId,deliveryId:d.id,assignmentId:a.id,attemptId:a.attemptId,...v,verifiedAt:now(),sources:spec.sources};
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
  assignment(token){const a=this.#assignment(token),j=this.#get('job',a.jobId);const {token:t,tokenHash,...safe}=a;return {...safe,specification:j.specification,state:j.state};}
  original(token,artifactId){
    try{this.#role(token);}catch{const assigned=this.#assignment(token),job=this.#get('job',assigned.jobId);requireThat(job.specification.sources.some(ref=>ref.artifactId===artifactId),'Executor can only read assigned source originals',403);}
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
