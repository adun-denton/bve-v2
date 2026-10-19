import * as fs from 'node:fs';
import * as path from 'node:path';
import {Kernel} from '../../../src/kernel.mjs';
const [runtime,sourceRoot,packetFile,stop,artifactId]=process.argv.slice(2),c=JSON.parse(fs.readFileSync(path.join(runtime,'credentials.json')));
const k=new Kernel(runtime,{imports:{sources:{'authored-png':sourceRoot}},workspaceHook(stage){if(stage===stop){fs.writeFileSync(packetFile+'.reached',stage);process.kill(process.pid,'SIGKILL');}}});
try{process.stdout.write(JSON.stringify(artifactId?k.importPortable(c.human,artifactId):k.assetCommand(c.human,JSON.parse(fs.readFileSync(packetFile)))));}finally{k.close();}
