import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { workspace,first,finish,submit } from './helpers.mjs';
import { backupRoot } from '../scripts/backup.mjs';
import { Kernel } from '../src/kernel.mjs';
import { hash } from '../src/png.mjs';

test('online SQLite backup includes immutable originals and submitted feedback; restore uses a new root',async()=>{
  const w=workspace();let restored;
  try{
    const {i}=first(w,2),images=finish(w,i),{s}=submit(w,i,images);
    const destination=join(w.root,'..','backup');await backupRoot(w.root,destination);
    await assert.rejects(()=>backupRoot(w.root,destination),/already exists/);
    restored=new Kernel(destination);assert.equal(restored.read(w.c.human,'submission')[0].id,s.id);
    assert.equal(restored.read(w.c.human,'continuation')[0].status,'ready');assert.equal(hash(restored.original(w.c.human,images[0].id)),images[0].sha256);
  }finally{restored?.close();w.k.close();}
});
