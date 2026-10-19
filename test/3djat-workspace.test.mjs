import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Kernel } from '../src/kernel.mjs';
import { DomainStore } from '../src/domain-store.mjs';
import { backupRoot } from '../scripts/backup.mjs';
import { verifyCombined,restoreCombined } from '../src/workspace-backup.mjs';
import { databaseFingerprint } from '../src/workspace.mjs';
import { serve } from '../src/server.mjs';
import { prepared,adoption,readyRound,PRODUCT,WORKSPACE,noop,product } from './fixtures/3djat/workspace-fixture.mjs';
const rejects=(fn,code)=>assert.throws(fn,e=>e.code===code,code);
const operationalFingerprint=w=>{const db=new DatabaseSync(path.join(w.runtimeRoot,'workspace.sqlite'),{readOnly:true});try{return databaseFingerprint(db);}finally{db.close();}};

test('prepared domain explicitly connects and adopts exact UUID without requests/staff/rounds; receipt replay',t=>{
  const w=prepared(t),packet=adoption(w),first=w.k.adoptWorkspace(w.c,packet);
  assert.deepEqual(w.k.adoptWorkspace(w.c,packet),first);assert.deepEqual(first.projectIds,[PRODUCT]);
  const p=w.k.read(w.c.human,'project')[0];assert.equal(p.id,PRODUCT);assert.equal(p.name,'Authored fixture: unnamed planter');assert.equal(p.productCode,'0007');assert.equal(p.code,'P001');
  assert.equal(p.domain.record.facts.material.state,'unknown');assert.equal(p.folder,path.join(w.config.paths.products,PRODUCT));
  for(const kind of ['request','round','sessionBinding','job'])assert.equal(w.k.read(w.c.human,kind).length,0);
  assert.throws(()=>w.k.adoptWorkspace(w.c,{...packet,input:{...packet.input,revision:2}}),/payload conflict/);
  assert.throws(()=>w.k.adoptWorkspace({...w.c,conductor:'spoof'},packet),/credentials/);
  assert.throws(()=>w.k.call(w.c.human,'workspace.adopt',packet.key,packet.input),/cannot call/);
  w.k.close();w.k=new Kernel(w.runtimeRoot);assert.equal(w.k.read(w.c.human,'project')[0].folder,p.folder);
});

test('rejected identity/head/path/unknown-root connection cannot initialize operational state',t=>{
  const w=prepared(t,{connect:false}),head=w.store.read().reference;
  rejects(()=>new Kernel(w.runtimeRoot,{workspace:{...w.config,workspaceId:PRODUCT},expectedHead:head}),'WORKSPACE_MISMATCH');
  rejects(()=>new Kernel(w.runtimeRoot,{workspace:w.config,expectedHead:{...head,revision:1}}),'REVISION_CONFLICT');
  rejects(()=>new Kernel(w.runtimeRoot,{workspace:{...w.config,storage:'cloud-sync'},expectedHead:head}),'LOCAL_STORAGE_REQUIRED');
  assert.equal(fs.existsSync(w.runtimeRoot),false);
  const unknown=path.join(w.dir,'unknown');fs.mkdirSync(unknown);fs.writeFileSync(path.join(unknown,'keep.txt'),'Authored preserve');
  assert.throws(()=>new Kernel(unknown,{workspace:{...w.config,runtimeRoot:unknown},expectedHead:head}),/nonempty unrecognized/);
  assert.deepEqual(fs.readdirSync(unknown),['keep.txt']);
  rejects(()=>new Kernel(w.runtimeRoot,{workspace:{...w.config,paths:{...w.config.paths,products:w.config.paths.templates}},expectedHead:head}),'PATH_CONFLICT');
  rejects(()=>new Kernel(w.domainRoot,{workspace:{...w.config,runtimeRoot:w.domainRoot},expectedHead:head}),'PATH_OVERLAP');
});

test('mapping/project/receipt CAS rejects conflicts atomically; replay precedes later head/revision',t=>{
  const w=prepared(t),packet=adoption(w),first=w.k.adoptWorkspace(w.c,packet);
  const edit=noop(w.store.read().reference,'advance-head');w.store.commit(edit);
  assert.deepEqual(w.k.adoptWorkspace(w.c,packet),first);
  rejects(()=>w.k.adoptWorkspace(w.c,{...packet,key:'new-stale-key'}),'INVALID_COMMAND');
  const foreign=adoption(w,'foreign',1);foreign.input.workspaceId=PRODUCT;
  rejects(()=>w.k.adoptWorkspace(w.c,foreign),'INVALID_COMMAND');
  const actor=adoption(w,'actor',1);actor.actor='human';rejects(()=>w.k.adoptWorkspace(w.c,actor),'INVALID_COMMAND');
  rejects(()=>new Kernel(w.runtimeRoot,{workspace:{...w.config,paths:{...w.config.paths,products:w.dir}}}),'ROOT_CONFLICT');
  assert.equal(w.k.read(w.c.human,'project').length,1);assert.equal(w.k.read(w.c.human,'request').length,0);
});

test('later conflicting product identity rolls back every earlier bulk-adoption link and receipt',t=>{
  const w=prepared(t),id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',p=product(id);p.productCode=null;
  const edit=noop(w.store.read().reference,'second-product');edit.changes=[{kind:'product',id,expectedRevision:0,record:p}];w.store.commit(edit);
  const db=new DatabaseSync(path.join(w.runtimeRoot,'workspace.sqlite'));try{
    db.prepare("INSERT INTO records VALUES('project',?,?)").run(id,JSON.stringify({id,name:'Authored conflicting binding',domainWorkspaceId:PRODUCT}));
    const before=databaseFingerprint(db);rejects(()=>w.k.adoptWorkspace(w.c,adoption(w)),'WORKSPACE_MISMATCH');
    assert.equal(databaseFingerprint(db),before);assert.equal(db.prepare("SELECT count(*) AS n FROM records WHERE kind='project'").get().n,1);
    assert.equal(db.prepare("SELECT count(*) AS n FROM records WHERE kind='workspaceAcknowledgement'").get().n,0);
  }finally{db.close();}
});

test('explicit legacy migration requires a current verified private backup; exact-ID adoption preserves unrelated projects',async t=>{
  const w=prepared(t,{connect:false});w.k=new Kernel(w.runtimeRoot);w.c=JSON.parse(fs.readFileSync(path.join(w.runtimeRoot,'credentials.json')));
  const linked=w.k.call(w.c.human,'project.create','legacy-linked',{name:'Legacy operational name',brief:'Preserve this operational brief'});
  const unrelated=w.k.call(w.c.human,'project.create','legacy-unrelated',{name:'Authored fixture: unnamed planter',brief:'Unrelated even with same name'});
  fs.mkdirSync(path.join(w.runtimeRoot,'Projects',linked.id),{recursive:true});fs.writeFileSync(path.join(w.runtimeRoot,'Projects',linked.id,'keep.txt'),'Preserved old folder');
  const next=product(linked.id);next.productCode='0099';const edit=noop(w.store.read().reference,'add-exact-id');edit.changes=[{kind:'product',id:linked.id,expectedRevision:0,record:next}];w.store.commit(edit);
  w.k.close();rejects(()=>new Kernel(w.runtimeRoot,{workspace:w.config,expectedHead:w.store.read().reference}),'MIGRATION_REQUIRES_BACKUP');
  const backup=path.join(w.dir,'legacy-backup');await backupRoot(w.runtimeRoot,backup);
  assert.equal(JSON.parse(fs.readFileSync(path.join(backup,'backup-scope.json'))).scope,'sqlite-only');
  w.k=new Kernel(w.runtimeRoot,{workspace:w.config,expectedHead:w.store.read().reference,migrate:true,migrationBackup:backup,confirmedQuiescent:true});
  w.k.adoptWorkspace(w.c,adoption(w));const projects=w.k.read(w.c.human,'project');
  assert.equal(projects.find(p=>p.id===linked.id).folder,path.join(w.config.paths.products,linked.id));assert.equal(projects.find(p=>p.id===linked.id).brief,linked.brief);
  assert.equal(projects.find(p=>p.id===unrelated.id).folder,path.join(w.runtimeRoot,'Projects',unrelated.id));
  assert.equal(projects.find(p=>p.id===unrelated.id).name,unrelated.name);assert.equal(fs.readFileSync(path.join(w.runtimeRoot,'Projects',linked.id,'keep.txt'),'utf8'),'Preserved old folder');
});

test('all statement/project folder projections and Butler-ready/reconcile writes share the resolver',t=>{
  const w=prepared(t);w.k.adoptWorkspace(w.c,adoption(w));const {round,b}=readyRound(w),folder=path.join(w.config.paths.products,PRODUCT);
  assert.equal(fs.statSync(folder).isDirectory(),true);assert.equal(fs.existsSync(path.join(w.runtimeRoot,'Projects',PRODUCT)),false);
  assert.equal(w.k.projectFolder(PRODUCT),folder);assert.equal(w.k.read(w.c.human,'project')[0].folder,folder);
  assert.equal(w.k.read(b.token,'statement').find(s=>s.id===round.statementId).project.folder,folder);
  fs.rmdirSync(folder);w.k.reconcile(w.c.butler);assert.equal(fs.existsSync(folder),true);
  w.k.close();w.k=new Kernel(w.runtimeRoot,{recover:false});assert.equal(w.k.round(w.c.human,round.id).statements[0].project.folder,folder);
});

for(const at of ['before-adoption-commit','after-adoption-commit'])test(`adoption interruption ${at}: rollback or same-receipt reconciliation`,t=>{
  let failNow=false;const w=prepared(t,{hook(stage){if(failNow&&stage===at)throw Object.assign(new Error('Authored I/O failure'),{code:'EIO'});}}),packet=adoption(w);
  failNow=true;rejects(()=>w.k.adoptWorkspace(w.c,packet),at==='before-adoption-commit'?'EIO':'ADOPTION_UNCERTAIN');failNow=false;
  assert.equal(w.k.read(w.c.human,'project').length,at==='before-adoption-commit'?0:1);
  const ack=w.k.adoptWorkspace(w.c,packet);assert.deepEqual(w.k.adoptWorkspace(w.c,packet),ack);assert.equal(w.k.read(w.c.human,'project').length,1);
});

for(const at of ['before-cache-commit','after-cache-commit'])test(`cache interruption ${at} preserves committed domain and blocks stale work`,t=>{
  let failNow=false;const w=prepared(t,{hook(stage){if(failNow&&stage===at)throw Object.assign(new Error('Authored I/O failure'),{code:'EIO'});}});w.k.adoptWorkspace(w.c,adoption(w));
  const edit=noop(w.store.read().reference,'cache-edit'),p=product();p.revision=2;p.workingName='Authored revised';edit.changes=[{kind:'product',id:PRODUCT,expectedRevision:1,record:p}];const committed=w.store.commit(edit);
  failNow=true;const result=w.k.refreshDomain(w.c);assert.equal(result.status,'stale');assert.equal(result.cacheCommitPossible,at==='after-cache-commit');
  assert.deepEqual(w.store.read().reference,committed.head);rejects(()=>w.call('human','request.create',{projectId:PRODUCT,intent:'Must not use stale facts'}),'DOMAIN_UNAVAILABLE');
  failNow=false;assert.equal(w.k.refreshDomain(w.c).status,'current');assert.equal(w.k.read(w.c.human,'project')[0].name,p.workingName);
});

for(const at of ['before-connection-commit','schema-committed'])test(`connection/schema interruption ${at} is distinguishable and retryable`,t=>{
  const w=prepared(t,{connect:false});rejects(()=>new Kernel(w.runtimeRoot,{workspace:w.config,expectedHead:w.store.read().reference,workspaceHook(stage){if(stage===at)throw Object.assign(new Error('Authored denial'),{code:'EACCES'});}}),at==='schema-committed'?'CONNECTION_UNCERTAIN':'EACCES');
  w.k=new Kernel(w.runtimeRoot,{workspace:w.config,expectedHead:w.store.read().reference});w.c=JSON.parse(fs.readFileSync(path.join(w.runtimeRoot,'credentials.json')));
  assert.equal(w.k.adoptWorkspace(w.c,adoption(w)).projectIds[0],PRODUCT);
});

test('unsupported SQLite/integration versions refuse; missing DB cannot fabricate operational history',t=>{
  const w=prepared(t);w.k.close();const db=new DatabaseSync(path.join(w.runtimeRoot,'workspace.sqlite'));db.exec('PRAGMA user_version=2');db.close();
  rejects(()=>new Kernel(w.runtimeRoot),'UNSUPPORTED_SCHEMA');const undo=new DatabaseSync(path.join(w.runtimeRoot,'workspace.sqlite'));undo.exec('PRAGMA user_version=1');
  const row=JSON.parse(undo.prepare("SELECT doc FROM records WHERE kind='domainIntegration'").get().doc);row.schemaVersion='3djat.integration.v2';undo.prepare("UPDATE records SET doc=? WHERE kind='domainIntegration'").run(JSON.stringify(row));undo.close();
  rejects(()=>new Kernel(w.runtimeRoot),'UNSUPPORTED_SCHEMA');
});

test('projection tampering is disposable; legacy APIs cannot override domain fields',t=>{
  const w=prepared(t);w.k.adoptWorkspace(w.c,adoption(w));const db=new DatabaseSync(path.join(w.runtimeRoot,'workspace.sqlite'));
  const p=JSON.parse(db.prepare("SELECT doc FROM records WHERE kind='domainProjection'").get().doc);p.products[0].record.workingName='Not authoritative';db.prepare("UPDATE records SET doc=? WHERE kind='domainProjection'").run(JSON.stringify(p));db.close();
  assert.equal(w.k.read(w.c.human,'project')[0].name,'Authored fixture: unnamed planter');
  const broken=new DatabaseSync(path.join(w.runtimeRoot,'workspace.sqlite'));broken.exec("UPDATE records SET doc='{' WHERE kind='domainProjection'");broken.close();
  assert.equal(w.k.refreshDomain(w.c).status,'current');
  const another=w.call('human','project.create',{id:PRODUCT,name:'Another ordinary project',brief:'Authored operational',productCode:'override',facts:{material:'override'}});
  assert.notEqual(another.id,PRODUCT);assert.equal(w.k.read(w.c.human,'project').find(p=>p.id===PRODUCT).productCode,'0007');
});

test('frozen selection replay precedes stale head; mismatched current references cannot create another snapshot',t=>{
  const w=prepared(t);w.k.adoptWorkspace(w.c,adoption(w));const view=w.store.read(),input={key:'freeze-once',projectId:PRODUCT,expectedHead:view.reference,product:view.head.products[0].dossier,templates:view.head.templates};
  const first=w.k.freezeDomainSelection(w.c,input);w.store.commit(noop(view.reference,'later-head'));assert.deepEqual(w.k.freezeDomainSelection(w.c,input),first);
  rejects(()=>w.k.freezeDomainSelection(w.c,{...input,key:'stale-head'}),'REVISION_CONFLICT');
  rejects(()=>w.k.freezeDomainSelection(w.c,{...input,key:'wrong-product',expectedHead:w.store.read().reference,product:{...input.product,revision:77}}),'REVISION_CONFLICT');
  assert.throws(()=>w.k.freezeDomainSelection({...w.c,generator:'spoof'},input),/credentials/);
});

test('server accepts only explicit mapped root options and preserves prepared identity on reopen',async t=>{
  const w=prepared(t);w.k.adoptWorkspace(w.c,adoption(w));w.k.close();
  await assert.rejects(()=>serve({workspace:w.config,port:0}),e=>e.code==='EXPLICIT_ROOT_REQUIRED');
  const app=await serve({root:w.runtimeRoot,workspace:w.config,port:0});try{assert.equal(app.kernel.read(w.c.human,'project')[0].id,PRODUCT);}finally{await app.stop();}
});

test('pre-schema interruption preserves an explicitly incomplete runtime; no implicit repair/migration',t=>{
  const w=prepared(t,{connect:false});rejects(()=>new Kernel(w.runtimeRoot,{workspace:w.config,expectedHead:w.store.read().reference,workspaceHook(stage){if(stage==='before-schema')throw Object.assign(new Error('Authored interruption'),{code:'EIO'});}}),'EIO');
  assert.equal(fs.existsSync(path.join(w.runtimeRoot,'bve-v2-root.json')),true);assert.equal(fs.existsSync(path.join(w.runtimeRoot,'workspace.sqlite')),false);
  rejects(()=>new Kernel(w.runtimeRoot,{workspace:w.config,expectedHead:w.store.read().reference}),'MISSING_OPERATIONAL_DATABASE');
});

test('missing domain permits stale history/frozen selection after reopen; new commissioning is blocked',t=>{
  const w=prepared(t);w.k.adoptWorkspace(w.c,adoption(w));const v=w.store.read();const saved=w.k.freezeDomainSelection(w.c,{key:'saved',projectId:PRODUCT,expectedHead:v.reference,product:v.head.products[0].dossier});const {round}=readyRound(w);
  w.k.close();fs.renameSync(w.domainRoot,w.domainRoot+'-preserved');w.k=new Kernel(w.runtimeRoot,{recover:false});
  assert.equal(w.k.read(w.c.human,'project')[0].domain.status,'stale');assert.equal(w.k.round(w.c.human,round.id).statements[0].project.folder,null);
  assert.equal(w.k.frozenDomainSelection(w.c,saved.id).product.sha256,saved.product.sha256);
  rejects(()=>w.call('human','request.create',{projectId:PRODUCT,intent:'Unavailable domain'}),'DOMAIN_UNAVAILABLE');
});

for(const withReadyRound of [false,true])test(`live domain disappearance preserves history and recovers the same root; ready round=${withReadyRound}`,t=>{
  const w=prepared(t),packet=adoption(w),ack=w.k.adoptWorkspace(w.c,packet),view=w.store.read();
  const saved=w.k.freezeDomainSelection(w.c,{key:'live-availability',projectId:PRODUCT,expectedHead:view.reference,product:view.head.products[0].dossier,templates:view.head.templates});
  const frozen=w.k.frozenDomainSelection(w.c,saved.id),ready=withReadyRound?readyRound(w):null;
  const request=w.call('human','request.create',{projectId:PRODUCT,intent:'Authored request before domain loss'});
  const before=w.k.read(w.c.human,'project')[0],statements=w.k.read(w.c.human,'statement');
  const fingerprint=operationalFingerprint(w);
  const preserved=w.domainRoot+'-preserved';fs.renameSync(w.domainRoot,preserved);
  // Read directly first: no refresh, reopen or reconstruction may be needed.
  const stale=w.k.read(w.c.human,'project')[0];
  assert.deepEqual(stale,{...before,folder:null,domain:{...before.domain,status:'stale',cause:'MISSING_REFERENCE'}});
  assert.equal(w.k.refreshDomain(w.c).status,'stale');
  const projected=w.k.read(w.c.human,'statement');assert.equal(projected.length,statements.length);
  for(const [i,st] of projected.entries())assert.deepEqual(st,{...statements[i],project:{...statements[i].project,folder:null,domain:{...statements[i].project.domain,status:'stale'}}});
  if(ready)assert.deepEqual(w.k.round(w.c.human,ready.round.id).statements,projected);
  assert.deepEqual(w.k.frozenDomainSelection(w.c,saved.id),frozen);
  for(let n=0;n<2;n++)assert.deepEqual(w.k.reconcile(w.c.butler),{ok:true});
  rejects(()=>w.call('human','request.create',{projectId:PRODUCT,intent:'Blocked while unavailable'}),'DOMAIN_UNAVAILABLE');
  rejects(()=>w.call('conductor','iteration.commission',{requestId:request.id,specifications:[]}),'DOMAIN_UNAVAILABLE');
  assert.equal(fs.existsSync(w.domainRoot),false);assert.equal(fs.existsSync(path.join(w.runtimeRoot,'Projects',PRODUCT)),false);
  assert.equal(fs.existsSync(path.join(preserved,'Products',PRODUCT)),withReadyRound);
  assert.equal(operationalFingerprint(w),fingerprint);
  fs.renameSync(preserved,w.domainRoot);
  assert.deepEqual(w.k.read(w.c.human,'project')[0],before);assert.equal(w.k.refreshDomain(w.c).status,'current');
  assert.deepEqual(w.k.read(w.c.human,'statement'),statements);assert.deepEqual(w.k.reconcile(w.c.butler),{ok:true});
  assert.deepEqual(w.k.frozenDomainSelection(w.c,saved.id),frozen);assert.deepEqual(w.k.adoptWorkspace(w.c,packet),ack);
  assert.equal(operationalFingerprint(w),fingerprint);
});

test('live missing domain head keeps history readable and prevents adopted-folder repair until verified recovery',t=>{
  const w=prepared(t);w.k.adoptWorkspace(w.c,adoption(w));const {round}=readyRound(w),before=w.k.read(w.c.human,'project')[0];
  const head=path.join(w.domainRoot,'domain-head.json'),bytes=fs.readFileSync(head),folder=w.k.projectFolder(PRODUCT);
  fs.unlinkSync(head);fs.rmdirSync(folder);
  const stale=w.k.read(w.c.human,'project')[0];assert.deepEqual(stale.domain.record,before.domain.record);assert.equal(stale.domain.status,'stale');assert.equal(stale.folder,null);
  assert.equal(w.k.round(w.c.human,round.id).statements[0].project.folder,null);assert.deepEqual(w.k.reconcile(w.c.butler),{ok:true});assert.equal(fs.existsSync(folder),false);
  rejects(()=>w.call('human','request.create',{projectId:PRODUCT,intent:'Blocked with missing head'}),'DOMAIN_UNAVAILABLE');assert.equal(fs.existsSync(folder),false);
  fs.writeFileSync(head,bytes);assert.equal(w.k.refreshDomain(w.c).status,'current');w.k.reconcile(w.c.butler);assert.equal(fs.statSync(folder).isDirectory(),true);
  assert.deepEqual(w.k.read(w.c.human,'project')[0],before);
});

for(const unsafe of ['copied-root','dangling-root','stale-product-link'])test(`live unavailable history still refuses ${unsafe} with a ready round`,t=>{
  const w=prepared(t);w.k.adoptWorkspace(w.c,adoption(w));const {round}=readyRound(w),view=w.store.read();
  const selected=w.k.freezeDomainSelection(w.c,{key:'unsafe-history',projectId:PRODUCT,expectedHead:view.reference,product:view.head.products[0].dossier});
  const frozen=w.k.frozenDomainSelection(w.c,selected.id),fingerprint=operationalFingerprint(w);
  const preserved=w.domainRoot+'-preserved',outside=path.join(w.dir,'absent-target');let code;
  if(unsafe==='stale-product-link'){
    fs.unlinkSync(path.join(w.domainRoot,'domain-head.json'));fs.rmdirSync(w.k.projectFolder(PRODUCT));
    fs.mkdirSync(outside);fs.symlinkSync(outside,path.join(w.config.paths.products,PRODUCT),process.platform==='win32'?'junction':'dir');code='UNSAFE_PATH';
  }else{
    fs.renameSync(w.domainRoot,preserved);
    if(unsafe==='copied-root'){fs.cpSync(preserved,w.domainRoot,{recursive:true});code='ROOT_CHANGED';}
    else{fs.symlinkSync(outside,w.domainRoot,process.platform==='win32'?'junction':'dir');code='UNSAFE_PATH';}
  }
  assert.equal(w.k.refreshDomain(w.c).status,'stale');
  rejects(()=>w.k.read(w.c.human,'project'),code);rejects(()=>w.k.read(w.c.human,'statement'),code);
  rejects(()=>w.k.round(w.c.human,round.id),code);rejects(()=>w.k.reconcile(w.c.butler),code);
  rejects(()=>w.call('human','request.create',{projectId:PRODUCT,intent:'Must refuse unsafe replacement'}),code);
  assert.deepEqual(w.k.frozenDomainSelection(w.c,selected.id),frozen);assert.equal(operationalFingerprint(w),fingerprint);
  assert.equal(fs.existsSync(path.join(w.runtimeRoot,'Projects',PRODUCT)),false);
  if(unsafe==='dangling-root')assert.equal(fs.existsSync(outside),false);
  if(unsafe==='stale-product-link')assert.deepEqual(fs.readdirSync(outside),[]);
});

test('junction/symlink product escape refuses both reads and folder creation',t=>{
  const w=prepared(t);w.k.adoptWorkspace(w.c,adoption(w));const outside=path.join(w.dir,'outside');fs.mkdirSync(outside);
  fs.symlinkSync(outside,path.join(w.config.paths.products,PRODUCT),process.platform==='win32'?'junction':'dir');
  rejects(()=>w.k.read(w.c.human,'project'),'UNSAFE_PATH');rejects(()=>readyRound(w),'UNSAFE_PATH');assert.deepEqual(fs.readdirSync(outside),[]);
});

test('active runtime root replacement refuses reads and writes',t=>{
  const w=prepared(t);w.k.adoptWorkspace(w.c,adoption(w));
  try{fs.renameSync(w.runtimeRoot,w.runtimeRoot+'-preserved');}catch(e){if(process.platform==='win32'&&['EPERM','EBUSY','EACCES'].includes(e.code)){t.skip('Windows refused moving the open SQLite root; replacement scenario unsupported here');return;}throw e;}
  fs.mkdirSync(w.runtimeRoot);rejects(()=>w.k.read(w.c.human,'project'),'ROOT_CHANGED');rejects(()=>w.call('human','project.create',{name:'Authored',brief:'Authored'}),'ROOT_CHANGED');
});

test('active domain root replacement cannot rebind knowledge or product folders',t=>{
  const w=prepared(t);w.k.adoptWorkspace(w.c,adoption(w));fs.renameSync(w.domainRoot,w.domainRoot+'-preserved');fs.mkdirSync(w.domainRoot);
  rejects(()=>w.k.read(w.c.human,'project'),'ROOT_CHANGED');rejects(()=>w.call('human','request.create',{projectId:PRODUCT,intent:'Must not use a replacement root'}),'DOMAIN_UNAVAILABLE');
  assert.deepEqual(fs.readdirSync(w.domainRoot),[]);
});

test('files own current names/codes/facts; projection rebuild and historical selection survive edits/restart',t=>{
  const w=prepared(t);w.k.adoptWorkspace(w.c,adoption(w));const before=w.store.read(),p=before.head.products[0].dossier;
  const selection=w.k.freezeDomainSelection(w.c,{key:'selection',projectId:PRODUCT,expectedHead:before.reference,product:p,templates:before.head.templates});
  const frozen=w.k.frozenDomainSelection(w.c,selection.id);const edit=noop(before.reference,'domain-edit'),next=product();next.revision=2;next.workingName='New authored name';next.productCode='0008';
  edit.changes=[{kind:'product',id:PRODUCT,expectedRevision:1,record:next}];w.store.commit(edit);
  const current=w.k.read(w.c.human,'project')[0];assert.equal(current.name,next.workingName);assert.equal(current.productCode,'0008');assert.equal(current.domain.reference.revision,2);
  assert.deepEqual(w.k.frozenDomainSelection(w.c,selection.id),frozen);w.k.close();w.k=new Kernel(w.runtimeRoot);
  assert.deepEqual(w.k.frozenDomainSelection(w.c,selection.id),frozen);
  fs.appendFileSync(path.join(w.domainRoot,current.domain.reference.path),' ');
  assert.equal(w.k.read(w.c.human,'project')[0].domain.status,'stale');
  rejects(()=>w.k.call(w.c.human,'request.create','blocked-current',{projectId:PRODUCT,intent:'Authored new work'}),'DOMAIN_UNAVAILABLE');
  assert.deepEqual(w.k.frozenDomainSelection(w.c,selection.id),frozen);
});

test('combined domain/SQLite/attachment backup and separate restore preserve identities and original bytes',async t=>{
  const w=prepared(t,{attachment:true});w.k.adoptWorkspace(w.c,adoption(w));const view=w.store.read();
  const selected=w.k.freezeDomainSelection(w.c,{key:'selected',projectId:PRODUCT,expectedHead:view.reference,product:view.head.products[0].dossier,templates:view.head.templates});
  const destination=path.join(w.dir,'combined-backup');await backupRoot(w.runtimeRoot,destination);const m=verifyCombined(destination);
  assert.equal(m.complete,true);assert.equal(m.attachments.length,1);assert.equal(JSON.stringify(m).includes(w.c.human),false);
  const businessRoot=path.join(w.dir,'restored-business'),runtimeRoot=path.join(w.dir,'restored-private');
  const paths=Object.fromEntries(Object.entries(w.store.workspace.paths).map(([k,v])=>[k,path.join(businessRoot,v)]));
  const out=restoreCombined(destination,{businessRoot,runtimeRoot,paths});assert.deepEqual(out.head,view.reference);
  assert.deepEqual(fs.readFileSync(path.join(businessRoot,w.attachmentRecord.location)),w.attachmentBytes);
  let reopened=new Kernel(runtimeRoot,{recover:false});try{
    assert.equal(reopened.read(w.c.human,'project')[0].id,PRODUCT);assert.equal(reopened.read(w.c.human,'project')[0].folder,path.join(paths.products,PRODUCT));
    assert.deepEqual(reopened.frozenDomainSelection(w.c,selected.id),w.k.frozenDomainSelection(w.c,selected.id));
  }finally{reopened.close();}
  fs.renameSync(path.join(runtimeRoot,'workspace.sqlite'),path.join(runtimeRoot,'saved-sqlite'));
  assert.deepEqual(new DomainStore(businessRoot).read().reference,view.reference);rejects(()=>new Kernel(runtimeRoot),'MISSING_OPERATIONAL_DATABASE');
});
