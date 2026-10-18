#!/usr/bin/env node
// Private recovery into two explicitly new roots only; no discovery or live overlay.
import { resolve,dirname,basename,isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RootGuard,check } from '../src/workspace.mjs';
import { restoreCombined } from '../src/workspace-backup.mjs';
export { restoreCombined } from '../src/workspace-backup.mjs';
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const [backup,mapping]=process.argv.slice(2);check(backup&&mapping&&isAbsolute(backup)&&isAbsolute(mapping)&&process.argv.length===4,'EXPLICIT_ROOT_REQUIRED');
  const input=new RootGuard(dirname(mapping)),config=JSON.parse(input.read(basename(mapping)));
  console.log(JSON.stringify(restoreCombined(backup,config)));
}
