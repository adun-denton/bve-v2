import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync, unlinkSync, openSync, closeSync } from 'node:fs';
import { resolve, join, dirname, isAbsolute, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { WorkspaceConnection, inspectRuntime, RootGuard, sameRef, check } from './workspace.mjs';
import { isDeepStrictEqual } from 'node:util';
import { Kernel, Fault } from './kernel.mjs';
import { capabilities, seedDemo } from './adapters.mjs';
const here=dirname(fileURLToPath(import.meta.url)),publicRoot=resolve(here,'../public');
export const defaultRoot=()=>join(homedir(),'.bve-v2','workspace-v1');
export async function serve(options={}){
  const {root=process.env.BVE_ROOT||defaultRoot(),port=Number(process.env.PORT||4317),demo=false,workspace=null,expectedHead=null,migrate=false,migrationBackup=null,confirmedQuiescent=false}=options;
  if(workspace){check(Object.hasOwn(options,'root')&&isAbsolute(root),'EXPLICIT_ROOT_REQUIRED');const prior=inspectRuntime(root).integration;
    if(prior)check(isDeepStrictEqual(prior.config,workspace),'ROOT_CONFLICT');
    const connection=new WorkspaceConnection(root,workspace,{existing:!!prior});if(!prior)check(sameRef(connection.store.read().reference,expectedHead),'REVISION_CONFLICT');}

  // A single owner is important: a second server must not mark active attempts uncertain.
  const lockPath=join(root,'owner.json');
  if(existsSync(lockPath)){
    if(!existsSync(join(root,'bve-v2-root.json')))throw new Fault('Refusing an owner file in an unrecognized root',409);
    const owner=JSON.parse(readFileSync(lockPath));
    let alive=false;try{process.kill(owner.pid,0);alive=true;}catch(e){if(e.code!=='ESRCH')throw e;}
    if(alive)throw Error('This private root already has a running owner. Open its browser URL instead.');
    unlinkSync(lockPath);
  }
  const kernel=new Kernel(root,{workspace,expectedHead,migrate,migrationBackup,confirmedQuiescent}),credentials=JSON.parse(readFileSync(join(root,'credentials.json')));
  const fd=openSync(lockPath,'wx',0o600);writeFileSync(fd,JSON.stringify({pid:process.pid,startedAt:new Date().toISOString()}));closeSync(fd);
  if(demo)await seedDemo(kernel,credentials);
  let origin,timer;
  const server=createServer(async(req,res)=>{
    const json=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));};
    try{
      if(req.headers.host!==new URL(origin).host)throw new Fault('Unexpected Host',403);
      if(req.headers.origin&&req.headers.origin!==origin)throw new Fault('Cross-origin request rejected',403);
      const url=new URL(req.url,origin);
      const credential=req.headers.authorization?.replace(/^Bearer /,'');
      if(req.method==='GET'&&['/','/app.js','/style.css'].includes(url.pathname)){
        const path=url.pathname==='/'?'index.html':url.pathname.slice(1),ext=path.split('.').at(-1);
        res.writeHead(200,{'Content-Type':({html:'text/html; charset=utf-8',js:'text/javascript; charset=utf-8',css:'text/css; charset=utf-8'})[ext],
          'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"});
        res.end(readFileSync(join(publicRoot,path)));return;
      }
      // UI bootstrap is same-origin loopback only, exposes just the human interface token.
      if(req.method==='GET'&&url.pathname==='/api/bootstrap'){json(200,{token:credentials.human,capabilities,simulation:demo});return;}
      if(req.method==='GET'&&url.pathname==='/api/read'){
        json(200,kernel.read(credential,url.searchParams.get('kind')));return;
      }
      if(req.method==='GET'&&url.pathname==='/api/round'){json(200,kernel.round(credential,url.searchParams.get('id')));return;}
      if(req.method==='GET'&&url.pathname==='/api/assignment'){json(200,kernel.assignment(credential));return;}
      if(req.method==='GET'&&url.pathname==='/api/original'){
        const bytes=kernel.original(credential,url.searchParams.get('id'));
        res.writeHead(200,{'Content-Type':'image/png','Cache-Control':'private, max-age=31536000, immutable','X-Content-Type-Options':'nosniff'});res.end(bytes);return;
      }
      if(req.method==='GET'&&url.pathname==='/api/portable'){
        res.setHeader('Content-Disposition',`attachment; filename="bve-review-${url.searchParams.get('id')}.json"`);json(200,kernel.portable(credential,url.searchParams.get('id'),{jobId:url.searchParams.get('jobId')}));return;
      }
      if(req.method==='POST'&&url.pathname==='/api/op'){
        let body='',length=0;
        for await (const b of req){length+=b.length;if(length>34*1024*1024)throw new Fault('Request too large',413);body+=b;}
        const x=JSON.parse(body);
        const value=kernel.call(credential,x.op,x.key,x.input);json(value.conflict?409:200,value);return;
      }
      throw new Fault('Not found',404);
    }catch(e){json(e.status||400,{error:e.message});}
  });
  try{await new Promise((ok,no)=>{server.once('error',no);server.listen(port,'127.0.0.1',ok);});}catch(e){kernel.close();unlinkSync(lockPath);throw e;}
  origin=`http://127.0.0.1:${server.address().port}`;
  timer=setInterval(()=>{try{kernel.reconcile(credentials.butler);}catch(e){console.error('Butler reconciliation pending:',e.message);}},750);timer.unref();
  const stop=async()=>{clearInterval(timer);await new Promise(ok=>server.close(ok));kernel.close();if(existsSync(lockPath))unlinkSync(lockPath);};
  return {server,kernel,credentials,origin,stop};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const argument=flag=>{const i=process.argv.indexOf(flag);return i<0?null:process.argv[i+1];};
  const root=argument('--root')??process.env.BVE_ROOT,configPath=argument('--workspace-config');let setup={};
  if(configPath){check(root&&isAbsolute(root)&&isAbsolute(configPath),'EXPLICIT_ROOT_REQUIRED');const g=new RootGuard(dirname(configPath));setup=JSON.parse(g.read(basename(configPath)));check(Object.keys(setup).every(k=>['workspace','expectedHead'].includes(k)),'INVALID_METADATA');}
  const app=await serve({...setup,...(root?{root}:{}),demo:process.argv.includes('--demo')});
  console.log(`BVE V2 development candidate: ${app.origin}\nPrivate root: ${app.kernel.root}\n${process.argv.includes('--demo')?'SIMULATION: authored fixtures. No native workers.':'Project records are available. Native project staffing/return requires the installed host driver; see installation status.'}\nStop with Ctrl+C; resume with the same BVE_ROOT.`);
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>app.stop().then(()=>process.exit(0)));
}
