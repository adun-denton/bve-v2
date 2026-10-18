// Authored disposable data only. No sources, approvals, photographs or business claims.
import { readFileSync } from 'node:fs';
import { prepareRecord } from '../../../src/domain-store.mjs';
export const WORKSPACE = 'bbbbbbbb-bbbb-4bbb-9bbb-bbbbbbbbbbbb';
export const PRODUCT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const source = { schemaVersion: '3djat.evidence.v1', id: 'authored-source', revision: 1,
  description: 'Authored test provenance only; no authenticated approval or real source.' };
export function product(id = PRODUCT) {
  const p = JSON.parse(readFileSync(new URL('./minimal-product.json', import.meta.url)));
  p.productId = id; p.productCode = '0007'; p.sourceReceipt = prepareRecord('evidence', source).reference; return p;
}
export function template() {
  return { schemaVersion: '3djat.template.v1', templateId: 'authored-operation', revision: 1,
    title: 'Authored operation', kind: 'operation', appliesTo: ['authored-channel'], instructions: 'Authored descriptive data.',
    inputs: [{ role: 'product-base', kind: 'verified-image', required: true }], allowedChanges: ['background'],
    outputs: [{ role: 'creative-candidate', format: 'image/png' }], exploration: { parameters: {}, presets: {} }, sourceRefs: [], supersedes: null };
}
export function plan(head, key = 'authored-create') {
  return { principal: 'provisioned-test-principal', operation: 'authored-storage-test', key, expectedHead: head,
    changes: [{ kind: 'product', id: PRODUCT, expectedRevision: 0, record: product() },
      { kind: 'template', id: 'authored-operation', expectedRevision: 0, record: template() }],
    records: [{ kind: 'evidence', record: source }] };
}
export function noop(head, key) { return { ...plan(head, key), changes: [], records: [] }; }
