import { writeSync } from 'node:fs';
import { DomainStore } from '../../../src/domain-store.mjs';
import { plan } from './domain-store-fixture.mjs';
const [root, mode, stopAt, expected] = process.argv.slice(2);
// Sync pipe writes let the parent observe a boundary while this process is stopped.
const send = value => writeSync(1, JSON.stringify(value) + '\n');
try {
  const store = new DomainStore(root, { hook(stage) {
    if (stage === stopAt) { send({ stage, pid: process.pid }); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0); }
  } });
  if (mode === 'read') send({ head: store.read().reference });
  else send({ result: store.commit(plan(JSON.parse(expected))) });
} catch (e) { send({ error: e.code ?? e.message }); process.exitCode = 2; }
