import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { serve } from '../src/server.mjs';

test('loopback HTTP rejects role spoofing, cross-origin writes and read leaks',async()=>{
  const root=join(mkdtempSync(join(tmpdir(),'bve-http-')),'private'),app=await serve({root,port:0});
  try{
    const bootstrap=await(await fetch(app.origin+'/api/bootstrap')).json();assert.equal(bootstrap.token,app.credentials.human);assert.ok(!JSON.stringify(bootstrap).includes(app.credentials.conductor));
    let r=await fetch(app.origin+'/api/op',{method:'POST',headers:{Authorization:`Bearer ${bootstrap.token}`,'Content-Type':'application/json'},body:JSON.stringify({op:'job.allocate',key:'fake',input:{role:'generator'}})});assert.equal(r.status,403);
    r=await fetch(app.origin+'/api/op',{method:'POST',headers:{Origin:'https://example.invalid',Authorization:`Bearer ${bootstrap.token}`},body:'{}'});assert.equal(r.status,403);
    r=await fetch(app.origin+'/api/read?kind=project');assert.equal(r.status,403);
    r=await fetch(app.origin+'/api/read?kind=assignment',{headers:{Authorization:`Bearer ${bootstrap.token}`}});assert.equal(r.status,403);
    r=await fetch(app.origin+'/src/kernel.mjs');assert.equal(r.status,404);
    await assert.rejects(()=>serve({root,port:0}),/running owner/);
  }finally{await app.stop();}
});
