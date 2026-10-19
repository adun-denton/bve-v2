"""Run only on explicitly supplied disposable inputs; reports never close IMG20.
Uses Python stdlib/Pillow already installed on this host; installs nothing.
Raw private results must not be committed. Source files and bearer remain private.
"""
import argparse, hashlib, json, os, pathlib, platform, subprocess, threading, time, urllib.request, uuid

def sha(b): return hashlib.sha256(b).hexdigest()
def dump(p, v): p.write_text(json.dumps(v, indent=2, ensure_ascii=False)+'\n')
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
        self.thread=threading.Thread(target=self.run);self.thread.start()
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

def run(root, inputs, output, label, budgets, recovery=False, old_source=None):
    folder=output/label;folder.mkdir(mode=0o700)
    config=folder/'input.json';dump(config,{'disposableExperiment':True,'files':inputs})
    errors=(folder/'stderr.log').open('w')
    p=subprocess.Popen(['node','scripts/img20-worker.mjs',str(config),str(folder/'worker')],cwd=root,text=True,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=errors)
    observer=Observer(p.pid,folder/'os-memory.ndjson')
    def read():
        line=p.stdout.readline()
        if not line:
            if p.poll() is None:p.terminate();p.wait(timeout=30)
            observer.close();errors.close()
            raise RuntimeError('Experiment child stopped: inspect private stderr')
        return json.loads(line)
    def rpc(v):p.stdin.write(json.dumps(v)+'\n');p.stdin.flush();return read()
    initial=read();origin=initial['origin'];token=initial['credential'];records=[];crashes=[]
    # Deliberate one-second idle observation, independent external process sampling.
    time.sleep(1);idle=rpc({'op':'status'})
    try:
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
            commit={'schemaVersion':'3djat.command.v1','operation':'asset.import.commit','key':str(uuid.uuid4()),'expected':{'domainHead':initial['head'],'entityRevision':1},'input':{'importId':ident,'stageReceipt':s['receipt'],'sha256':h}}
            r=json.loads(http(origin,token,'/api/asset-import',commit));assert r['schemaVersion']=='3djat.result.v1',r;import_ms=(time.monotonic()-start)*1000
            assert json.loads(http(origin,token,'/api/asset-import',commit))==r
            artifact=r['reference']['id'];observer.phase=f'export-{i+1}';rpc({'op':'phase','name':observer.phase});start=time.monotonic()
            original=http(origin,token,'/api/original?id='+artifact);portable=json.loads(http(origin,token,'/api/import-portable?id='+artifact));export_ms=(time.monotonic()-start)*1000
            import base64
            assert original==raw==base64.b64decode(portable['original']['bytes']);assert portable['origin']['provenance']['origin']=='import' and portable['freshAcceptance'] is False
            view=json.loads(http(origin,token,'/api/import?id='+ident));assert view['artifact']['sha256']==h
            pathlib.Path(folder/f'http-{i+1}.png').write_bytes(original);dump(folder/f'portable-{i+1}.json',portable);dump(folder/f'review-{i+1}.json',view)
            records.append({'index':i+1,'sha256':h,'artifactId':artifact,'importId':ident,'encodedBytes':len(raw),'width':f['width'],'height':f['height'],'importMs':import_ms,'originalPlusPortableExportMs':export_ms,'stage':s,'commit':r,'stagePacket':packet,'commitPacket':commit})
        observer.phase='backup-restore';backup=rpc({'op':'backup-restore'});assert backup['complete'];assert sorted(x['sha256'] for x in backup['restored'])==sorted(x['sha256'] for x in records)
        if recovery:
            observer.phase='recovery'
            recovered=rpc({'op':'recovery','stagePacket':records[0]['stagePacket'],'commitPacket':records[0]['commitPacket']})
            crashes=recovered['rows'];origin=recovered['origin'];assert len(crashes)==4
        status=rpc({'op':'status'});assert status['counts']['artifact']==len(inputs)+len(crashes);assert status['counts']['importReceipt']==2*status['counts']['artifact'];assert all(status['counts'][k]==0 for k in ['job','assignment','iteration','request','round','sessionBinding','acceptance'])
        assert {x['hash'] for x in status['originals']}=={x['sha256'] for x in inputs}
        rpc({'op':'stop'});p.stdin.close()
        waited,exit_status,usage=os.wait4(p.pid,0);p.returncode=os.waitstatus_to_exitcode(exit_status);assert waited==p.pid and p.returncode==0
        status['wait4MaxRssKiB']=usage.ru_maxrss;status['wait4MinorFaults']=usage.ru_minflt;status['wait4MajorFaults']=usage.ru_majflt
    finally:
        if p.poll() is None:p.terminate();p.wait(timeout=30)
        observer.close();errors.close()
    peak=max([x['process'].get('VmHWM',0) for x in observer.rows if x['process']]+[status['maxRssKiB']*1024,status['wait4MaxRssKiB']*1024]);baseline=idle['memory']['rss'];available=min(x['physical']['MemAvailable']/x['physical']['MemTotal'] for x in observer.rows if x['physical'])
    verdict={'serverPeakRssBytes':peak,'idleRssBytes':baseline,'deltaBytes':peak-baseline,'serverAbsolutePass':peak<=budgets['serverAbsoluteRssBytes'],'serverDeltaPass':peak-baseline<=budgets['serverRssDeltaBytes'],'minimumAvailablePhysicalRatio':available,'availablePhysicalPass':available>=budgets['availablePhysicalRatioMinimum'] if any(x['process'] for x in observer.rows) else None,'externalProcessSampling':'MEASURED' if any(x['process'] for x in observer.rows) else 'NOT MEASURED: mounted proc PID view does not identify the Node server','physicalViewLimitation':'mounted proc/cgroup host view; target machine not observed','maxExternalSampleGapMs':max(x['intervalMs'] for x in observer.rows),'maxInternalSampleGapMs':status['maxInternalGapMs'],'browserProcessTree':'NOT MEASURED','targetMachineTiming':'NOT MEASURED','uiResponsiveness':'NOT MEASURED','pagingStall':'NOT MEASURED; raw pressure/swap retained','IMG20':'OPEN'}
    result={'sourcePin':initial['sourcePin'],'label':label,'records':records,'backup':backup,'status':status,'recovery':crashes,'verdict':verdict};dump(folder/'result.json',result);return result

if __name__=='__main__':
    a=argparse.ArgumentParser();a.add_argument('--inputs',required=True,type=pathlib.Path);a.add_argument('--output',required=True,type=pathlib.Path);a.add_argument('--budgets',required=True,type=pathlib.Path);a.add_argument('--old-source',type=pathlib.Path);o=a.parse_args()
    o.output=o.output.resolve();o.output.mkdir(mode=0o700);root=pathlib.Path(__file__).resolve().parents[1];inputs=json.loads(o.inputs.read_text())['files'];budgets=json.loads(o.budgets.read_text())['budgets'];results=[]
    for count in [1,6]:
        for rep in range(4):results.append(run(root,inputs[:count],o.output,f'serial-{count}-'+('warm' if rep==0 else str(rep)),budgets))
    results.append(run(root,inputs,o.output,'complete-dataset',budgets,recovery=True,old_source=o.old_source))
    dump(o.output/'summary.json',{'results':[{'label':x['label'],'sourcePin':x['sourcePin'],'verdict':x['verdict']} for x in results],'IMG20':'OPEN','note':'Six-image server transport only; no browser/process-tree or target/Windows certification. Internal event-loop samples have blocking gaps; external /proc sampling records actual intervals and OS high-water.'})
