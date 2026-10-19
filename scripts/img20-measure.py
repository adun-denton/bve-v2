"""Run only on explicitly supplied disposable inputs; reports never close IMG20.
Uses Python stdlib/Pillow already installed on this host; installs nothing.
Raw private results must not be committed. Source files and bearer remain private.
"""
import argparse, hashlib, json, os, pathlib, platform, subprocess, threading, time, urllib.request, uuid, queue, signal

def sha(b): return hashlib.sha256(b).hexdigest()
def dump(p, v):
    temp=p.with_name(p.name+'.next')
    fd=os.open(temp,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
    with os.fdopen(fd,'w') as out:
        out.write(json.dumps(v,indent=2,ensure_ascii=False)+'\n');out.flush();os.fsync(out.fileno())
    os.replace(temp,p)

def error_record(e): return {'code':getattr(e,'code',type(e).__name__),'message':str(e)}

class WorkerFailure(RuntimeError):
    def __init__(self,value): self.code=value.get('code','WORKER_FAILED');super().__init__('Worker failure; inspect private lifecycle: '+self.code)

class Protocol:
    def __init__(self,p,timeout):
        self.p=p;self.timeout=timeout;self.lines=queue.Queue()
        self.thread=threading.Thread(target=self.reader,daemon=True);self.thread.start()
    def reader(self):
        try:
            for line in self.p.stdout:self.lines.put(line)
            self.lines.put(None)
        except BaseException as e:self.lines.put(e)
    def read(self):
        try:line=self.lines.get(timeout=self.timeout)
        except queue.Empty:raise TimeoutError('Owned worker protocol timeout; exit not yet confirmed')
        if isinstance(line,BaseException):raise line
        if line is None:raise RuntimeError('Worker EOF; inspect private stderr and last lifecycle')
        value=json.loads(line)
        if value.get('type')=='failure':raise WorkerFailure(value)
        return value
    def rpc(self,v):self.p.stdin.write(json.dumps(v)+'\n');self.p.stdin.flush();return self.read()

def proc_sample(pid):
    try:
        comm=pathlib.Path(f'/proc/{pid}/comm').read_text().strip()
        if comm not in ['node','nodejs']:return None  # Mounted /proc may belong to a different PID namespace.
        values={}
        for line in pathlib.Path(f'/proc/{pid}/status').read_text().splitlines():
            k,_,v=line.partition(':')
            if k in ['VmRSS','VmHWM','VmSwap']: values[k]=int(v.split()[0])*1024
        return values
    except FileNotFoundError: return None

class Observer:
    def __init__(self, pid, dest):
        self.pid=pid;self.dest=dest;self.stop=threading.Event();self.rows=[];self.phase='idle'
        self.error=None;self.thread=threading.Thread(target=self.guarded_run);self.thread.start()
    def guarded_run(self):
        try:self.run()
        except BaseException as e:self.error=e
    def run(self):
        last=time.monotonic()
        with self.dest.open('x') as out:
            while not self.stop.is_set():
                now=time.monotonic();mem={}
                if pathlib.Path('/proc/meminfo').exists():
                    for l in pathlib.Path('/proc/meminfo').read_text().splitlines():
                        k,_,v=l.partition(':')
                        if k in ['MemTotal','MemAvailable','SwapFree']:mem[k]=int(v.split()[0])*1024
                row={'time':time.time(),'phase':self.phase,'intervalMs':(now-last)*1000,'process':proc_sample(self.pid),'processIdentity':'verified Node comm or NOT MEASURED (null process); PID namespaces may differ','physical':mem}
                pressure=pathlib.Path('/proc/pressure/memory');row['pressure']=pressure.read_text() if pressure.exists() else None
                row['cgroup']={k:(pathlib.Path('/sys/fs/cgroup')/k).read_text() for k in ['memory.current','memory.max','memory.events'] if (pathlib.Path('/sys/fs/cgroup')/k).exists()}
                row['vmstat']={k:int(v) for k,v in (line.split() for line in pathlib.Path('/proc/vmstat').read_text().splitlines()) if k in ['pswpin','pswpout','oom_kill']}
                out.write(json.dumps(row)+'\n');out.flush();self.rows.append(row);last=now;self.stop.wait(.02)
    def close(self): self.stop.set();self.thread.join()

def http(origin, token, route, packet=None):
    data=json.dumps(packet,ensure_ascii=False).encode() if packet else None
    req=urllib.request.Request(origin+route,data=data,headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'})
    with urllib.request.urlopen(req,timeout=120) as r:return r.read()

def run(root, inputs, output, label, budgets, recovery=False, old_source=None, *, authored_control=None, protocol_timeout=120, after_backup=None):
    folder=output/label;folder.mkdir(mode=0o700)
    state={'schemaVersion':'img20.private-controller.v1','sourcePin':None,'label':label,'status':'RUNNING','phase':'allocation','records':[],'completed':[],'worker':{'pid':None,'exit':'UNKNOWN'},'workerLifecycle':str(folder/'worker'/'lifecycle.json'),'firstError':None,'secondaryErrors':[],'IMG20':'OPEN','limitations':['Linux-only collector','No browser/target-machine certification','Read last worker checkpoint if protocol is lost']}
    p=observer=errors=protocol=None;records=state['records'];crashes=[];index=0;primary=None
    def failure(e):
        if state['firstError'] is None:state['firstError']=error_record(e)
        else:state['secondaryErrors'].append(error_record(e))
    def checkpoint(phase,detail=None):
        nonlocal index
        state['phase']=phase
        if detail is not None:state['completed'].append({'phase':phase,'detail':detail})
        index+=1;dest=folder/f'checkpoint-{index:04}.json';dump(dest,state)
        state['lastCheckpoint']={'file':str(dest),'sha256':sha(dest.read_bytes())};dump(folder/'result.json',state)
    def completed(phase,detail):
        checkpoint(phase,detail);rpc({'op':'checkpoint','phase':phase,'detail':detail})
    previous={}
    try:
        checkpoint('allocation')
        if platform.system()!='Linux':raise RuntimeError('UNSUPPORTED_HOST: Linux /proc and wait4 collector required')
        state['sourcePin']=subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip()
        for sig in [signal.SIGTERM,signal.SIGINT]:
            if threading.current_thread() is threading.main_thread():
                previous[sig]=signal.getsignal(sig);signal.signal(sig,lambda *_:(_ for _ in ()).throw(KeyboardInterrupt('Controller interrupted')))
        config=folder/'input.json';dump(config,{'disposableExperiment':True,'files':inputs})
        checkpoint('configured',{'inputs':[{'path':f['path'],'sha256':f['sha256'],'width':f['width'],'height':f['height']} for f in inputs]})
        errors=(folder/'stderr.log').open('w')
        command=['node','scripts/img20-worker.mjs',str(config),str(folder/'worker')]
        if authored_control in ['missing-marker','timeout','secondary']:command.append('--authored-'+authored_control)
        elif authored_control is not None:raise ValueError('Unknown fixed authored control')
        p=subprocess.Popen(command,cwd=root,text=True,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=errors)
        state['worker']['pid']=p.pid;checkpoint('worker-owned')
        observer=Observer(p.pid,folder/'os-memory.ndjson');protocol=Protocol(p,protocol_timeout);rpc=protocol.rpc
        initial=protocol.read();origin=initial['origin'];token=initial['credential']
        state['worker']['reportedPid']=initial['pid'];state['roots']={k:initial[k] for k in ['runtime','sourceRoot']};checkpoint('ready')
        time.sleep(1);idle=rpc({'op':'status'})
        if old_source:
            before={f:sha(pathlib.Path(initial['runtime'],f).read_bytes()) for f in ['bve-v2-root.json','workspace.sqlite','credentials.json']}
            code="import {Kernel} from "+json.dumps(pathlib.Path(old_source,'src/kernel.mjs').as_uri())+";try{const k=new Kernel(process.argv[1]);k.close();process.exitCode=5;}catch(e){if(e.code!=='UNSUPPORTED_SCHEMA')throw e;console.log(e.code)}"
            old=subprocess.run(['node','--input-type=module','-e',code,initial['runtime']],capture_output=True,text=True,check=True)
            after={f:sha(pathlib.Path(initial['runtime'],f).read_bytes()) for f in before}
            assert before==after
            dump(folder/'old-source-refusal.json',{'source':subprocess.check_output(['git','rev-parse','HEAD'],cwd=old_source,text=True).strip(),'refusal':old.stdout.strip(),'unchanged':before==after})
        for i,f in enumerate(inputs):
            observer.phase=f'import-{i+1}';rpc({'op':'phase','name':observer.phase});raw=pathlib.Path(f['path']).read_bytes();h=sha(raw);assert h==f['sha256']
            ident=str(uuid.uuid4());packet={'schemaVersion':'3djat.command.v1','operation':'asset.import.stage','key':str(uuid.uuid4()),'expected':{'domainHead':initial['head'],'entityRevision':0},'input':{'schemaVersion':'3djat.historical-import.v1','importId':ident,'productId':initial['productId'],'origin':'import','kind':'historical-base','filename':f'image-{i+1}.png','source':{'kind':'file','sourceId':'authored-png','revision':'experiment-input-by-hash','sha256':h,'location':f'image-{i+1}.png','locator':{'kind':'section','section':'Explicit disposable verification input; historical linkage not established'},'observedAt':'2026-10-19T00:00:00.000Z'},'sha256':h,'encodedBytes':len(raw),'format':'image/png','width':f['width'],'height':f['height'],'bitDepth':8,'interlaced':False,'historicalParent':None,'historicalApproval':None,'importedAt':'2026-10-19T00:00:00.000Z'}}
            # Derivative remains creative, without inventing a parent/approval claim.
            if f.get('kind')=='historical-creative':packet['input']['kind']='historical-creative'
            start=time.monotonic();s=json.loads(http(origin,token,'/api/asset-import',packet));assert s['schemaVersion']=='3djat.result.v1',s
            completed(f'stage-{i+1}',{'packet':packet,'receipt':s,'sha256':h})
            commit={'schemaVersion':'3djat.command.v1','operation':'asset.import.commit','key':str(uuid.uuid4()),'expected':{'domainHead':initial['head'],'entityRevision':1},'input':{'importId':ident,'stageReceipt':s['receipt'],'sha256':h}}
            r=json.loads(http(origin,token,'/api/asset-import',commit));assert r['schemaVersion']=='3djat.result.v1',r;import_ms=(time.monotonic()-start)*1000
            completed(f'commit-{i+1}',{'packet':commit,'receipt':r,'sha256':h})
            assert json.loads(http(origin,token,'/api/asset-import',commit))==r
            completed(f'replay-{i+1}',r)
            artifact=r['reference']['id'];observer.phase=f'export-{i+1}';rpc({'op':'phase','name':observer.phase});start=time.monotonic()
            original=http(origin,token,'/api/original?id='+artifact);assert original==raw
            original_file=folder/f'http-{i+1}.png';original_file.write_bytes(original)
            completed(f'original-{i+1}',{'artifactId':artifact,'file':str(original_file),'sha256':sha(original)})
            portable=json.loads(http(origin,token,'/api/import-portable?id='+artifact));export_ms=(time.monotonic()-start)*1000
            import base64
            assert original==base64.b64decode(portable['original']['bytes']);assert portable['origin']['provenance']['origin']=='import' and portable['freshAcceptance'] is False
            portable_file=folder/f'portable-{i+1}.json';dump(portable_file,portable)
            completed(f'portable-{i+1}',{'artifactId':artifact,'originalSha256':h,'file':str(portable_file),'fileSha256':sha(portable_file.read_bytes())})
            view=json.loads(http(origin,token,'/api/import?id='+ident));assert view['artifact']['sha256']==h
            review_file=folder/f'review-{i+1}.json';dump(review_file,view)
            completed(f'review-{i+1}',{'importId':ident,'file':str(review_file),'sha256':sha(review_file.read_bytes())})
            records.append({'index':i+1,'sha256':h,'artifactId':artifact,'importId':ident,'encodedBytes':len(raw),'width':f['width'],'height':f['height'],'importMs':import_ms,'originalPlusPortableExportMs':export_ms,'stage':s,'commit':r,'stagePacket':packet,'commitPacket':commit})
            completed(f'transport-{i+1}',records[-1])
        state['beforeBackup']=rpc({'op':'status'});completed('pre-backup-status',state['beforeBackup'])
        observer.phase='backup-restore';backup=rpc({'op':'backup-restore'});assert backup['complete'];assert sorted(x['sha256'] for x in backup['restored'])==sorted(x['sha256'] for x in records)
        state['backup']=backup;completed('backup-restore',backup)
        if after_backup:after_backup(initial)
        if recovery:
            observer.phase='recovery'
            recovered=rpc({'op':'recovery','stagePacket':records[0]['stagePacket'],'commitPacket':records[0]['commitPacket']})
            crashes=recovered['rows'];origin=recovered['origin'];assert len(crashes)==4
            state['recovery']=crashes;completed('recovery',crashes)
        status=rpc({'op':'status'});assert status['counts']['artifact']==len(inputs)+len(crashes);assert status['counts']['importReceipt']==2*status['counts']['artifact'];assert all(status['counts'][k]==0 for k in ['job','assignment','iteration','request','round','sessionBinding','acceptance'])
        assert {x['hash'] for x in status['originals']}=={x['sha256'] for x in inputs}
        rpc({'op':'stop','retainSuccess':True});p.stdin.close()
        deadline=time.monotonic()+10
        while True:
            waited,exit_status,usage=os.wait4(p.pid,os.WNOHANG)
            if waited:break
            if time.monotonic()>deadline:raise TimeoutError('Worker stop did not confirm exit')
            time.sleep(.02)
        p.returncode=os.waitstatus_to_exitcode(exit_status);assert waited==p.pid and p.returncode==0
        state['worker'].update(exit='CONFIRMED',returncode=p.returncode)
        status['wait4MaxRssKiB']=usage.ru_maxrss;status['wait4MinorFaults']=usage.ru_minflt;status['wait4MajorFaults']=usage.ru_majflt
        state['statusResult']=status;checkpoint('worker-stopped',state['worker'])
        observer.close()
        peak=max([x['process'].get('VmHWM',0) for x in observer.rows if x['process']]+[status['maxRssKiB']*1024,status['wait4MaxRssKiB']*1024]);baseline=idle['memory']['rss'];available=min(x['physical']['MemAvailable']/x['physical']['MemTotal'] for x in observer.rows if x['physical'])
        verdict={'serverPeakRssBytes':peak,'idleRssBytes':baseline,'deltaBytes':peak-baseline,'serverAbsolutePass':peak<=budgets['serverAbsoluteRssBytes'],'serverDeltaPass':peak-baseline<=budgets['serverRssDeltaBytes'],'minimumAvailablePhysicalRatio':available,'availablePhysicalPass':available>=budgets['availablePhysicalRatioMinimum'] if any(x['process'] for x in observer.rows) else None,'externalProcessSampling':'MEASURED' if any(x['process'] for x in observer.rows) else 'NOT MEASURED: mounted proc PID view does not identify the Node server','physicalViewLimitation':'mounted proc/cgroup host view; target machine not observed','maxExternalSampleGapMs':max(x['intervalMs'] for x in observer.rows),'maxInternalSampleGapMs':status['maxInternalGapMs'],'browserProcessTree':'NOT MEASURED','targetMachineTiming':'NOT MEASURED','uiResponsiveness':'NOT MEASURED','pagingStall':'NOT MEASURED; raw pressure/swap retained','IMG20':'OPEN'}
        state['verdict']=verdict;state['status']='SUCCEEDED';checkpoint('complete')
    except BaseException as e:
        primary=e;failure(e)
        state['status']='INTERRUPTED' if isinstance(e,KeyboardInterrupt) or getattr(e,'code',None)=='INTERRUPTED' else 'BLOCKED' if getattr(e,'code',None)=='OPERATIONAL_LOCKED' else 'FAILED'
    finally:
        if p is not None:
            try:
                if p.returncode is None:
                    p.terminate()
                    try:p.wait(timeout=5)
                    except subprocess.TimeoutExpired:p.kill();p.wait(timeout=5)
                state['worker'].update(exit='CONFIRMED',returncode=p.returncode)
                if primary is None and p.returncode!=0:raise RuntimeError('Owned worker nonzero exit')
            except BaseException as e:failure(e);state['worker']['exit']='UNKNOWN';state['status']='UNKNOWN'
            for handle in [p.stdin,p.stdout]:
                try:handle.close()
                except BaseException as e:failure(e)
            if protocol:protocol.thread.join(timeout=1)
        for handle in [observer,errors]:
            if handle:
                try:handle.close()
                except BaseException as e:failure(e)
        if observer and getattr(observer,'error',None):failure(observer.error)
        try:
            lifecycle=folder/'worker'/'lifecycle.json'
            if lifecycle.exists():
                value=json.loads(lifecycle.read_text());state['workerLastCheckpoint']=value.get('lastCheckpoint');state['workerStatus']=value.get('status');state['recoveryChildren']=value.get('children',[])
                if state['worker']['exit']=='CONFIRMED' and value.get('status') in ['FAILED','BLOCKED','INTERRUPTED','UNKNOWN']:
                    cause=value.get('firstError')
                    if cause and state['firstError'] is None:state['firstError']=cause
        except BaseException as e:failure(e)
        if state['firstError'] and state['status']=='SUCCEEDED':state['status']='FAILED'
        try:checkpoint('final')
        except BaseException as e:
            failure(e)
            if state['status']=='SUCCEEDED':state['status']='FAILED'
            try:dump(folder/'failure.json',state)
            except BaseException:pass  # Caller still receives failure; last durable checkpoint remains.
        for sig,handler in previous.items():signal.signal(sig,handler)
    if state['firstError']:raise WorkerFailure({'code':state['firstError']['code']}) from primary
    return state

def main():
    a=argparse.ArgumentParser();a.add_argument('--inputs',required=True,type=pathlib.Path);a.add_argument('--output',required=True,type=pathlib.Path);a.add_argument('--budgets',required=True,type=pathlib.Path);a.add_argument('--old-source',type=pathlib.Path);o=a.parse_args()
    o.output=o.output.resolve();o.output.mkdir(mode=0o700)
    root=pathlib.Path(__file__).resolve().parents[1]
    summary={'schemaVersion':'img20.private-controller-batch.v1','status':'RUNNING','sourcePin':None,'completed':[],'lastRun':None,'firstError':None,'secondaryErrors':[],'IMG20':'OPEN'}
    try:
        dump(o.output/'batch.json',summary)
        summary['sourcePin']=subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip()
        inputs=json.loads(o.inputs.read_text())['files'];budgets=json.loads(o.budgets.read_text())['budgets']
        runs=[(inputs[:count],f'serial-{count}-'+('warm' if rep==0 else str(rep)),False) for count in [1,6] for rep in range(4)]+[(inputs,'complete-dataset',True)]
        for files,label,recovery in runs:
            summary['lastRun']=str(o.output/label/'result.json');dump(o.output/'batch.json',summary)
            result=run(root,files,o.output,label,budgets,recovery=recovery,old_source=o.old_source if recovery else None)
            summary['completed'].append({'label':label,'sourcePin':result['sourcePin'],'verdict':result['verdict']});dump(o.output/'batch.json',summary)
        summary['status']='SUCCEEDED';dump(o.output/'summary.json',summary)
    except BaseException as e:
        summary['status']='INTERRUPTED' if isinstance(e,KeyboardInterrupt) else 'FAILED';summary['firstError']=error_record(e)
        try:dump(o.output/'batch-failure.json',summary)
        except BaseException as secondary:summary['secondaryErrors'].append(error_record(secondary))
        raise WorkerFailure({'code':summary['firstError']['code']}) from None
    finally:
        try:dump(o.output/'batch.json',summary)
        except BaseException:
            if summary['status']=='SUCCEEDED':raise

if __name__=='__main__':main()
