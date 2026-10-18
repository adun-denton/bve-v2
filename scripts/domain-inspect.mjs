#!/usr/bin/env node
// Standalone, read-only and explicit-root only. Does not discover or open BVE.
import { DomainStore } from '../src/domain-store.mjs';
if (process.argv.length !== 3) { console.error('Usage: node scripts/domain-inspect.mjs <absolute-disposable-root>'); process.exitCode = 2; }
else {
  try {
    const v = new DomainStore(process.argv[2]).read();
    console.log(JSON.stringify({ head: v.reference, products: v.head.products, templates: v.head.templates,
      files: v.files.size, historicalHeads: v.headCount, external: v.external }, null, 2));
  } catch (e) { console.error(JSON.stringify({ error: e.code ?? 'READ_FAILURE', detail: e.detail ?? {} })); process.exitCode = 1; }
}
