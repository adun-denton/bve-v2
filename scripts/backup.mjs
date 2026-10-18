import { DatabaseSync, backup } from 'node:sqlite';
import { existsSync, mkdirSync, copyFileSync, chmodSync } from 'node:fs';
import { join, resolve, isAbsolute } from 'node:path';
import { constants } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { inspectRuntime, check } from '../src/workspace.mjs';
import { backupCombined } from '../src/workspace-backup.mjs';
import { writeFileSync } from 'node:fs';
export async function backupRoot(source,destination,options={}){
  const explicit=isAbsolute(source)&&isAbsolute(destination);source=resolve(source);destination=resolve(destination);
  if(inspectRuntime(source).integration){check(explicit,'EXPLICIT_ROOT_REQUIRED');return backupCombined(source,destination,options);}
  if(existsSync(destination))throw Error('Backup destination already exists; choose a new path. No data was overwritten.');
  if(!existsSync(join(source,'bve-v2-root.json')))throw Error('Source is not a BVE V2 private root');
  mkdirSync(destination,{recursive:true,mode:0o700});
  const db=new DatabaseSync(join(source,'workspace.sqlite'),{readOnly:true});
  try{await backup(db,join(destination,'workspace.sqlite'));}finally{db.close();}
  for(const file of ['bve-v2-root.json','credentials.json']){copyFileSync(join(source,file),join(destination,file),constants.COPYFILE_EXCL);chmodSync(join(destination,file),0o600);}
  chmodSync(join(destination,'workspace.sqlite'),0o600);writeFileSync(join(destination,'backup-scope.json'),JSON.stringify({schemaVersion:'bve.sqlite-only-backup.v1',scope:'sqlite-only',externalDomain:false})+'\n',{flag:'wx',mode:0o600});return destination;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const dest=process.argv[2];if(!dest)throw Error('Usage: npm run backup -- /new/private/backup-path');
  const source=process.env.BVE_ROOT||join(homedir(),'.bve-v2','workspace-v1');
  console.log('Backup complete:',await backupRoot(source,dest));
}
