// Invoked by the installer, not the designer. Driver is trusted private local code.
import { readFileSync } from 'node:fs';
import { join,resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Kernel } from '../src/kernel.mjs';
import { installHost,unavailableHost,installationStatus } from '../src/host-installation.mjs';
const [command='status',driverPath,projectId]=process.argv.slice(2);
if(!process.env.BVE_ROOT)throw Error('Set BVE_ROOT to the exact preserved private root; no implicit empty workspace');
const root=resolve(process.env.BVE_ROOT),owner=JSON.parse(readFileSync(join(root,'credentials.json')));
// Do not claim ownership or mark running attempts uncertain from this control client.
const kernel=new Kernel(root,{recover:false});
try{
  if(command==='status')console.log(JSON.stringify(installationStatus(kernel,owner),null,2));
  else if(command==='install'){
    const host=driverPath?(await import(pathToFileURL(resolve(driverPath)).href)).default:unavailableHost;
    const result=await installHost({kernel,owner,origin:process.env.BVE_URL??'http://127.0.0.1:4317',host,projectId:projectId??null});
    console.log(JSON.stringify(result,null,2));if(result.status!=='operational')process.exitCode=2;
  }else throw Error('Usage: npm run install:host -- install PRIVATE_HOST_DRIVER.mjs [EXISTING_PROJECT_ID] | status');
}finally{kernel.close();}
