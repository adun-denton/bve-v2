import { DatabaseSync, backup } from 'node:sqlite';
import { existsSync, mkdirSync, copyFileSync, chmodSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { constants } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
export async function backupRoot(source,destination){
  source=resolve(source);destination=resolve(destination);
  if(existsSync(destination))throw Error('Backup destination already exists; choose a new path. No data was overwritten.');
  if(!existsSync(join(source,'bve-v2-root.json')))throw Error('Source is not a BVE V2 private root');
  mkdirSync(destination,{recursive:true,mode:0o700});
  const db=new DatabaseSync(join(source,'workspace.sqlite'),{readOnly:true});
  try{await backup(db,join(destination,'workspace.sqlite'));}finally{db.close();}
  for(const file of ['bve-v2-root.json','credentials.json']){copyFileSync(join(source,file),join(destination,file),constants.COPYFILE_EXCL);chmodSync(join(destination,file),0o600);}
  chmodSync(join(destination,'workspace.sqlite'),0o600);return destination;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const dest=process.argv[2];if(!dest)throw Error('Usage: npm run backup -- /new/private/backup-path');
  const source=process.env.BVE_ROOT||join(homedir(),'.bve-v2','workspace-v1');
  console.log('Backup complete:',await backupRoot(source,dest));
}
