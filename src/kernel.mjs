import { DatabaseSync } from 'node:sqlite';
import { randomUUID, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync, existsSync, readFileSync, writeFileSync, chmodSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { hash, verifyPNG } from './png.mjs';
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
  generator:['job.allocate','attempt.start'],
  butler:['event.delivery'],
};
export class Kernel {
  #db; #credentials; #closed=false;
  constructor(root,{recover=true}={}) {
    this.root=resolve(root);
    if(existsSync(this.root)&&!existsSync(join(this.root,'bve-v2-root.json')))requireThat(readdirSync(this.root).length===0,'Refusing to initialize a nonempty unrecognized root; choose a new BVE V2 root');
    mkdirSync(this.root,{recursive:true,mode:0o700});
    const marker=join(this.root,'bve-v2-root.json');
    const dbPath=join(this.root,'workspace.sqlite');
    // Never adopt an unknown existing DB as a V2 root.
    requireThat(!existsSync(dbPath)||existsSync(marker),'Existing database is not a BVE V2 root');
    if(!existsSync(marker)) writeFileSync(marker,JSON.stringify({format:'bve-v2',version:1,createdAt:now()}),{mode:0o600,flag:'wx'});
    requireThat(JSON.parse(readFileSync(marker)).format==='bve-v2','Root marker mismatch');
    const authPath=join(this.root,'credentials.json');
    if(!existsSync(authPath)) writeFileSync(authPath,JSON.stringify(Object.fromEntries(Object.keys(permissions).map(r=>[r,secret()]))),{mode:0o600,flag:'wx'});
    this.#credentials=JSON.parse(readFileSync(authPath));
    this.#db=new DatabaseSync(dbPath);
    this.#db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS records(kind TEXT NOT NULL,id TEXT NOT NULL,doc TEXT NOT NULL,PRIMARY KEY(kind,id));
      CREATE TABLE IF NOT EXISTS bytes(hash TEXT PRIMARY KEY, data BLOB NOT NULL);
      CREATE TABLE IF NOT EXISTS receipts(scope TEXT NOT NULL,key TEXT NOT NULL,fingerprint TEXT NOT NULL,doc TEXT NOT NULL,PRIMARY KEY(scope,key));`);
    chmodSync(dbPath,0o600);
    if(recover) this.#tx(()=> { for(const j of this.#list('job')) if(j.state==='running') {j.state='uncertain';j.uncertainAt=now();j.reason='Owner stopped after durable invocation start; reconcile original assignment; no retry';this.#put('job',j);}});
    this.reconcile(this.#credentials.butler);
  }
  close(){if(!this.#closed){this.#db.close();this.#closed=true;}}
  #tx(fn){this.#db.exec('BEGIN IMMEDIATE');try{const v=fn();this.#db.exec('COMMIT');return v;}catch(e){this.#db.exec('ROLLBACK');throw e;}}
  #list(kind){return this.#db.prepare('SELECT doc FROM records WHERE kind=? ORDER BY rowid').all(kind).map(x=>JSON.parse(x.doc));}
  #get(kind,key){const row=this.#db.prepare('SELECT doc FROM records WHERE kind=? AND id=?').get(kind,key);requireThat(row,`Missing ${kind}: ${key}`,404);return JSON.parse(row.doc);}
  #put(kind,v){this.#db.prepare('INSERT INTO records VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET doc=excluded.doc').run(kind,v.id,JSON.stringify(v));return v;}
  #session(token){return this.#list('sessionBinding').find(s=>!s.revokedAt&&equal(hash(token??''),s.tokenHash));}
  #role(token){const session=this.#session(token);if(session)return session.role;const role=Object.keys(this.#credentials).find(r=>equal(token,this.#credentials[r]));requireThat(role,'Invalid function credential',403);return role;}

  // Installation is a trusted local-owner API, deliberately absent from HTTP.
  // Session bearers expose only the three existing functional roles in one project.
  #owner(owner){requireThat(['conductor','generator','butler'].every(r=>equal(owner?.[r],this.#credentials[r])),'Local installation credentials required',403);}
  hostState(owner,state){
    this.#owner(owner);
    if(state!==undefined)return this.#tx(()=>clone(this.#put('hostInstallation',{...clone(state),id:'active'})));
    return clone(this.#list('hostInstallation')[0]??null);
  }
  bindSession(owner,{role,sessionId,sessionUrl=null,projectId,nonce,replace=false}){
    this.#owner(owner);requireThat(['conductor','generator','butler'].includes(role),'Invalid installed role');
    text(sessionId,'actual session identity',300);text(nonce,'verification challenge',200);
    if(projectId!==null)this.#get('project',projectId);
    if(sessionUrl!==null){const u=new URL(sessionUrl);requireThat(u.protocol==='https:','Session link must use https');}
    return this.#tx(()=>{
      const active=this.#list('sessionBinding').filter(s=>!s.revokedAt),prior=active.find(s=>s.role===role);
      requireThat(!active.some(s=>s.role!==role&&s.sessionId===sessionId),'Roles need distinct actual sessions',409);
      if(prior&&prior.sessionId===sessionId&&prior.projectId===projectId)return clone(prior);
      requireThat(!prior||replace,'Explicit replacement required; reuse the existing session',409);
      if(prior){prior.revokedAt=now();this.#put('sessionBinding',prior);}
      const installation=this.#list('hostInstallation')[0];if(installation){installation.status='incomplete';installation.gaps=['Role binding changed; verify connections and Conductor handoff'];delete installation.handoffReceipt;this.#put('hostInstallation',installation);}
      const token=secret(),binding=this.#put('sessionBinding',{id:id(),role,sessionId,sessionUrl,projectId,nonce,token,tokenHash:hash(token),boundAt:now(),hello:null,revokedAt:null});
      for(const d of this.#list('delegation').filter(d=>d.toRole===role&&d.projectId===projectId&&d.state!=='completed')){d.sessionId=sessionId;d.reboundAt=now();this.#put('delegation',d);}
      return clone(binding);
    });
  }
  hostBindings(owner){this.#owner(owner);return clone(this.#list('sessionBinding').filter(s=>!s.revokedAt));}
  hostRoutes(owner){this.#owner(owner);return clone(this.#list('delegation'));}
  #belongs(v,kind,projectId){
    if(projectId===null)return false; // No project exists yet: no ambient access.
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
    else if(op==='attempt.start')projectId=this.#get('job',this.#get('assignment',x.assignmentId).jobId).projectId;
    else if(op==='job.allocate')projectId=this.#get('job',x.jobId).projectId;
    else if(op.startsWith('event.'))projectId=this.#get('event',x.eventId).projectId;
    requireThat(s.projectId!==null&&projectId===s.projectId,'Session project boundary rejected',403);
    if(s.role==='generator'&&['job.allocate','attempt.start'].includes(op)){
      const job=op==='job.allocate'?this.#get('job',x.jobId):this.#get('job',this.#get('assignment',x.assignmentId).jobId);
      requireThat(this.#list('delegation').some(d=>d.kind==='dispatch'&&d.iterationId===job.iterationId&&d.sessionId===s.sessionId&&d.state!=='completed'),'No dispatch delegation for this session/iteration',403);
    }
  }
  #hostCall(token,op,key,x){
    const s=this.#session(token);requireThat(s,'Installed session credential required',403);text(key,'host receipt key',200);
    if(op==='host.resume'){
      requireThat(x.nonce===s.nonce,'Session challenge mismatch',403);
      const kinds={conductor:['project','request','iteration','submission','continuation','creativeContext','event'],generator:['job','assignment'],butler:['job','delivery','event','observation','conflict']}[s.role];
      const context=Object.fromEntries(kinds.map(k=>[k,this.read(token,k)]));
      const receipt=this.#tx(()=>{
        const value=this.#once('session:'+s.id+':'+op,key,x,()=>({id:id(),sessionId:s.sessionId,role:s.role,projectId:s.projectId,readAt:now(),latestIterationId:context.iteration?.at(-1)?.id??null,submissionIds:context.submission?.map(v=>v.id)??[]}));
        s.hello=value;this.#put('sessionBinding',s);return value;
      });
      return {receipt,context,delegations:this.#list('delegation').filter(d=>d.projectId===s.projectId&&(s.role==='conductor'||d.sessionId===s.sessionId))};
    }
    if(op==='host.delegate'){
      requireThat(s.role==='conductor','Only Conductor delegates',403);
      requireThat(['dispatch','reconcile','readiness'].includes(x.kind),'Invalid bounded delegation');
      if(x.kind==='readiness')requireThat(s.projectId===x.projectId&&['generator','butler'].includes(x.toRole),'Invalid readiness scope',403);else this.#sessionScope(token,op,x);
      const toRole=x.kind==='readiness'?x.toRole:x.kind==='dispatch'?'generator':'butler',target=this.#list('sessionBinding').find(b=>!b.revokedAt&&b.role===toRole&&b.projectId===s.projectId);
      requireThat(target?.hello,'Destination session has not verified its scoped connection',409);
      if(x.kind==='dispatch')requireThat(this.#get('iteration',x.iterationId).projectId===s.projectId,'Foreign delegated iteration',403);
      return this.#tx(()=>this.#once('session:'+s.id+':'+op,key,x,()=>this.#put('delegation',{id:id(),projectId:s.projectId,kind:x.kind,iterationId:x.iterationId??null,fromSessionId:s.sessionId,toRole,sessionId:target.sessionId,state:'pending',createdAt:now(),receipts:[]})));
    }
    if(op==='host.receipt'){
      const d=this.#get('delegation',x.delegationId);requireThat(d.toRole===s.role&&d.sessionId===s.sessionId&&d.projectId===s.projectId,'Delegation recipient boundary rejected',403);
      requireThat(['acknowledged','completed','blocked'].includes(x.status),'Invalid delegation receipt');text(x.detail,'delegation outcome',2000);
      if(x.status==='completed'&&d.kind==='dispatch')requireThat(this.#get('iteration',d.iterationId).jobIds.every(j=>['succeeded','failed'].includes(this.#get('job',j).state)),'Dispatch is not completed; preserve uncertainty or partial work',409);
      this.reconcile(this.#credentials.butler);
      return this.#tx(()=>this.#once('session:'+s.id+':'+op,key,x,()=>{requireThat(d.state!=='completed','Delegation already completed',409);d.receipts.push({id:id(),sessionId:s.sessionId,status:x.status,detail:x.detail,at:now()});d.state=x.status;return this.#put('delegation',d);}));
    }
    throw new Fault('Unknown host session operation',404);
  }
  #event(iteration,type,extra={}){const eid=`${iteration.id}:${type}`;if(this.#list('event').some(e=>e.id===eid))return;this.#put('event',{id:eid,projectId:iteration.projectId,iterationId:iteration.id,type,createdAt:now(),deliveryAttempts:[],acknowledgedAt:null,consumedAt:null,...extra});}
  call(token,op,key,input={}) {
    // No role property is interpreted; only the locally provisioned function credential selects operations.
    if(op==='result.deliver') return this.#deliver(token,key,input);
    const role=this.#role(token);
    if(op.startsWith('host.'))return this.#hostCall(token,op,key,input);
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
    switch(op){
      case 'project.create': {
        const p={id:id(),name:text(x.name,'project name',200),brief:text(x.brief,'brief'),page:'board',createdAt:now(),fixture:x.fixture===true,
          defaults:{count:integer(x.count??1,1,6,'candidate count'),direction:x.direction??'Fresh',brand:x.brand??null},standingRemaining:integer(x.standingIterations??0,0,20,'standing iterations')};
        requireThat(['Fresh','Follow'].includes(p.defaults.direction),'Invalid direction'); if(p.defaults.brand!==null)text(p.defaults.brand,'brand context');this.#put('project',p);
        for(const b of this.#list('sessionBinding').filter(b=>!b.revokedAt&&b.projectId===null)){b.projectId=p.id;this.#put('sessionBinding',b);}
        const installation=this.#list('hostInstallation')[0];if(installation&&installation.projectId===null){installation.projectId=p.id;this.#put('hostInstallation',installation);}
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
    const p=this.#get('project',x.projectId),count=integer(x.count??p.defaults.count,1,6,'candidate count'),direction=x.direction??p.defaults.direction,brand=x.brand===undefined?p.defaults.brand:x.brand;
    requireThat(['Fresh','Follow'].includes(direction),'Invalid direction');if(brand!==null)text(brand,'brand context');
    if(x.parentReviewId)requireThat(this.#get('submission',x.parentReviewId).projectId===p.id,'Review belongs to another project');
    const r={id:id(),projectId:p.id,parentReviewId:x.parentReviewId??null,intent:text(x.intent,'user intent'),count,direction,brand,createdAt:now(),state:'waiting-for-conductor',allowance:{primaryAttempts:count,maxRetries:0},gap:'Native Conductor adapter unavailable; resume via bounded Conductor interface'};
    p.defaults={count,direction,brand};this.#put('project',p);this.#put('request',r);return r;
  }
  #sourceSnapshot(a){
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
      return {ok:true};
    });
  }
  read(token,kind){
    const role=this.#role(token);
    const allowed={human:['project','request','iteration','job','artifact','draft','submission','continuation','acceptance','creativeContext','event','delivery','conflict','observation'],conductor:['project','request','iteration','job','artifact','submission','continuation','creativeContext','event'],generator:['job','assignment'],butler:['job','assignment','delivery','event','conflict','observation']};
    requireThat(allowed[role].includes(kind),'Read boundary rejected',403);
    const binding=this.#session(token);
    return clone(this.#list(kind).filter(v=>!binding||this.#belongs(v,kind,binding.projectId)).map(v=>{const {token,tokenHash,...rest}=v;return rest;}));
  }
  assignment(token){const a=this.#assignment(token),j=this.#get('job',a.jobId);const {token:t,tokenHash,...safe}=a;return {...safe,specification:j.specification,state:j.state};}
  original(token,artifactId){
    try{this.#role(token);}catch{const assigned=this.#assignment(token),job=this.#get('job',assigned.jobId);requireThat(job.specification.sources.some(ref=>ref.artifactId===artifactId),'Executor can only read assigned source originals',403);}
    const a=this.#get('artifact',artifactId),binding=this.#session(token);if(binding)requireThat(binding.role==='conductor'&&a.projectId===binding.projectId,'Session original boundary rejected',403);this.#verifyArtifact(a);return Buffer.from(this.#db.prepare('SELECT data FROM bytes WHERE hash=?').get(a.sha256).data);}
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
