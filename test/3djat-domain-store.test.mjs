import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { DomainStore, prepareRecord, verifySnapshot, restoreSnapshot, STORE_LIMITS } from '../src/domain-store.mjs';
import { WORKSPACE, PRODUCT, product, template, source, plan, noop } from './fixtures/3djat/domain-store-fixture.mjs';
const digest = b => createHash('sha256').update(b).digest('hex');
const childScript = fileURLToPath(new URL('./fixtures/3djat/domain-store-process.mjs', import.meta.url));
function area(t) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), '3djat-authored-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; }
function setup(t, options = {}) {
  const dir = area(t), root = path.join(dir, 'store');
  const s = DomainStore.initialize(root, { workspaceId: WORKSPACE, sourceCommit: '8cbdbb06bb940fa83445fc346e4d44b223606169', ...options });
  return { dir, root, s, head: s.read().reference };
}
const rejects = (fn, code) => assert.throws(fn, e => e.code === code, code);
function child(root, mode, stopAt = '', head = null) {
  const c = spawn(process.execPath, [childScript, root, mode, stopAt, JSON.stringify(head)], { stdio: ['ignore', 'pipe', 'pipe'] });
  let buffer = ''; const messages = [], pending = []; let error = '';
  c.stderr.on('data', x => { error += x; });
  c.stdout.on('data', chunk => { buffer += chunk; while (buffer.includes('\n')) { const i = buffer.indexOf('\n'); const m = JSON.parse(buffer.slice(0, i)); buffer = buffer.slice(i + 1); if (pending.length) pending.shift()(m); else messages.push(m); } });
  c.result = () => messages.length ? Promise.resolve(messages.shift()) : new Promise((resolve, reject) => {
    const timer = setTimeout(() => { c.kill('SIGKILL'); reject(new Error('Child timeout: ' + error)); }, 15000);
    pending.push(x => { clearTimeout(timer); resolve(x); });
  });
  c.closed = once(c, 'close'); return c;
}
async function stop(c) { c.kill('SIGKILL'); await c.closed; }
function recover(s) {
  const expectedLockHash = digest(fs.readFileSync(path.join(s.root, 'domain-write.lock')));
  rejects(() => s.recoverLock({ expectedLockHash, confirmedQuiescent: false }), 'QUIESCENCE_REQUIRED');
  rejects(() => s.recoverLock({ expectedLockHash: '0'.repeat(64), confirmedQuiescent: true }), 'LOCK_CHANGED');
  s.recoverLock({ expectedLockHash, confirmedQuiescent: true });
}

test('initialization requires an explicit empty root and validates workspace/schema without migration', t => {
  const { s, root, dir } = setup(t); assert.equal(s.read().head.revision, 1);
  rejects(() => DomainStore.initialize(root, { workspaceId: WORKSPACE }), 'UNKNOWN_ROOT');
  rejects(() => new DomainStore('relative'), 'EXPLICIT_ROOT_REQUIRED');
  rejects(() => new DomainStore(root, { workspaceId: PRODUCT }), 'WORKSPACE_MISMATCH');
  const unknown = path.join(dir, 'unknown'); fs.mkdirSync(unknown); fs.writeFileSync(path.join(unknown, 'legacy.json'), '{}');
  rejects(() => DomainStore.initialize(unknown, { workspaceId: WORKSPACE }), 'UNKNOWN_ROOT');
  const marker = path.join(root, 'domain-store.json'), saved = fs.readFileSync(marker), m = JSON.parse(saved);
  m.schemaVersion = '3djat.domain-store.v2'; fs.writeFileSync(marker, JSON.stringify(m));
  rejects(() => new DomainStore(root), 'UNSUPPORTED_SCHEMA'); rejects(() => s.read(), 'STORE_CHANGED');
  fs.writeFileSync(marker, saved); assert.equal(s.read().head.revision, 1);
});

test('multi-record visibility, exact byte hashes, leading zero SKU and standalone process read', async t => {
  const { s, root, head } = setup(t), out = s.commit(plan(head)), view = s.read();
  assert.equal(view.head.revision, 2); assert.deepEqual(view.head.skus, [{ productCode: '0007', productId: PRODUCT }]);
  assert.equal(view.head.templates.length, 1); assert.equal(view.head.receipts.length, 1);
  const p = view.records.get(view.head.products[0].dossier.path).value;
  assert.equal(p.facts.material.state, 'unknown'); assert.equal(p.facts.sellingPrice.value, null);
  for (const r of view.records.values()) assert.equal(digest(fs.readFileSync(path.join(root, r.reference.path))), r.reference.sha256);
  assert.deepEqual(out.head, view.reference); assert.equal(fs.existsSync(path.join(root, 'workspace.sqlite')), false);
  const c = child(root, 'read'); assert.deepEqual((await c.result()).head, out.head); await c.closed;
  const inspected = spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/domain-inspect.mjs', import.meta.url)), root], { encoding: 'utf8' });
  assert.equal(inspected.status, 0, inspected.stderr); assert.equal(JSON.parse(inspected.stdout).head.sha256, out.head.sha256);
});

test('head/entity CAS, scoped replay before stale rejection, changed payload and SKU conflicts', t => {
  const { s, head } = setup(t), first = plan(head), result = s.commit(first);
  const later = s.commit(noop(result.head, 'later'));
  assert.deepEqual(s.commit(first), { head: result.head, receipt: result.receipt, replayed: true });
  rejects(() => s.commit({ ...first, changes: [] }), 'IDEMPOTENCY_CONFLICT');
  rejects(() => s.commit({ ...first, key: 'stale' }), 'REVISION_CONFLICT');
  const staleEntity = noop(later.head, 'entity-stale'), p = product(); p.revision = 2;
  staleEntity.changes = [{ kind: 'product', id: PRODUCT, expectedRevision: 0, record: p }];
  rejects(() => s.commit(staleEntity), 'REVISION_CONFLICT');
  const next = noop(later.head, 'entity-next'); next.changes = [{ kind: 'product', id: PRODUCT, expectedRevision: 1, record: p }];
  const updated = s.commit(next); assert.equal(s.read().head.products[0].dossier.revision, 2);
  const dup = product(WORKSPACE), collision = noop(updated.head, 'sku-conflict'); collision.changes = [{ kind: 'product', id: WORKSPACE, expectedRevision: 0, record: dup }];
  rejects(() => s.commit(collision), 'SKU_CONFLICT');
  // Identical key is a separate scope under a different provisioned principal or operation.
  const other = { ...noop(updated.head, first.key), principal: 'another-provisioned-principal' };
  assert.equal(s.commit(other).replayed, false);
});

test('two real writer processes contend; killed owner is never stolen automatically', async t => {
  const { s, root, head } = setup(t), owner = child(root, 'commit', 'locked', head);
  t.after(() => owner.kill('SIGKILL')); const event = await owner.result(); assert.equal(event.stage, 'locked');
  const contender = child(root, 'commit', '', head), rejected = await contender.result(); await contender.closed;
  assert.equal(rejected.error, 'LOCKED'); assert.notEqual(event.pid, contender.pid);
  await stop(owner); rejects(() => s.commit(plan(head)), 'LOCKED');
  recover(s); assert.equal(s.commit(plan(head)).replayed, false);
  assert.ok(fs.readdirSync(path.join(root, 'Recovery')).length > 0);
});

for (const boundary of ['after-stage', 'after-immutable', 'before-replace', 'after-replace', 'before-reply']) {
  test(`real process kill/reopen at ${boundary}: complete old/new state and exact replay`, async t => {
    const { s, root, head } = setup(t), c = child(root, 'commit', boundary, head);
    t.after(() => c.kill('SIGKILL')); assert.equal((await c.result()).stage, boundary); await stop(c);
    const reopened = new DomainStore(root), published = ['after-replace', 'before-reply'].includes(boundary);
    const v = reopened.read(); assert.equal(v.head.revision, published ? 2 : 1);
    assert.equal(v.head.products.length, published ? 1 : 0); assert.equal(v.head.templates.length, published ? 1 : 0);
    recover(reopened); const replay = reopened.commit(plan(head)); assert.equal(replay.replayed, published);
    assert.equal(reopened.read().head.revision, 2);
    const preserved = reopened.quarantineOrphans({ expectedHead: reopened.read().reference, confirmedQuiescent: true });
    assert.ok(preserved.files.length > 0); assert.equal(reopened.read().head.revision, 2);
    assert.equal(fs.existsSync(path.join(root, preserved.quarantine, preserved.files[0])), true);
  });
}

for (const [stage, ioCode, uncertain, revision] of [
  ['file-flush', 'ENOSPC', false, 1], ['after-immutable', 'EACCES', false, 1],
  ['replace', 'EACCES', true, 1], ['after-replace', 'EIO', true, 2], ['before-reply', 'EIO', true, 2]
]) {
  test(`safe ${ioCode} injection at ${stage} reports ${uncertain ? 'uncertainty' : 'abort'}`, t => {
    const { s, root, head } = setup(t);
    s.hook = (at, info) => { if (at === stage && (at !== 'file-flush' || info.path.startsWith('Staging/'))) throw Object.assign(new Error('authored I/O failure'), { code: ioCode }); };
    rejects(() => s.commit(plan(head)), uncertain ? 'COMMIT_UNCERTAIN' : 'COMMIT_ABORTED');
    assert.equal(new DomainStore(root).read().head.revision, revision);
    s.hook = () => {}; assert.equal(s.commit(plan(head)).replayed, revision === 2);
  });
}

test('immutable conflict, byte corruption, missing closure and malformed/oversized heads refuse', t => {
  const { s, root, head } = setup(t), record = prepareRecord('product', product());
  fs.mkdirSync(path.dirname(path.join(root, record.reference.path)), { recursive: true });
  fs.writeFileSync(path.join(root, record.reference.path), '{}');
  rejects(() => s.commit(plan(head)), 'IMMUTABLE_CONFLICT'); fs.unlinkSync(path.join(root, record.reference.path));
  s.commit(plan(head)); const location = path.join(root, record.reference.path), saved = fs.readFileSync(location);
  fs.appendFileSync(location, '\n'); rejects(() => s.read(), 'HASH_MISMATCH');
  fs.unlinkSync(location); rejects(() => s.read(), 'MISSING_REFERENCE'); fs.writeFileSync(location, saved);
  const h = path.join(root, 'domain-head.json'), hb = fs.readFileSync(h);
  fs.writeFileSync(h, '{'); rejects(() => s.read(), 'INVALID_JSON');
  fs.writeFileSync(h, Buffer.alloc(STORE_LIMITS.fileBytes + 1)); rejects(() => s.read(), 'OVERSIZE');
  fs.writeFileSync(h, hb); assert.equal(s.read().head.revision, 2);
});

test('traversal, cycles, oversized input, symlinks, hard links and root replacement refuse', t => {
  const { s, root, dir, head } = setup(t);
  for (const relative of ['../escape', 'C:/escape', 'C:\\escape', '//server/a', 'Domain/%2e%2e/a', 'Domain/CON.txt']) rejects(() => s.readFile(relative), 'INVALID_RECORD');
  const cyclic = product(); cyclic.notes.push(cyclic); rejects(() => prepareRecord('product', cyclic), 'INVALID_RECORD');
  const huge = product(); huge.workingName = 'x'.repeat(STORE_LIMITS.fileBytes + 1); rejects(() => prepareRecord('product', huge), 'INVALID_RECORD');
  const outside = path.join(dir, 'outside'); fs.mkdirSync(outside);
  fs.symlinkSync(outside, path.join(root, 'Domain', 'product'), process.platform === 'win32' ? 'junction' : 'dir');
  rejects(() => s.commit(plan(head)), 'UNSAFE_PATH'); fs.unlinkSync(path.join(root, 'Domain', 'product'));
  const original = path.join(root, 'workspace.json'), alias = path.join(root, 'alias.json'); fs.linkSync(original, alias);
  rejects(() => s.read(), 'UNSAFE_PATH'); fs.unlinkSync(alias);
  fs.renameSync(root, root + '-old'); fs.mkdirSync(root); rejects(() => s.read(), 'ROOT_CHANGED');
});

test('reader retries a changed head and returns a bounded conflict under continuous change', t => {
  const { s } = setup(t); let calls = 0;
  s.hook = at => { if (at === 'reader-verified' && calls++ === 0) { const writer = new DomainStore(s.root); writer.commit(plan(writer.read().reference)); } };
  assert.equal(s.read().head.revision, 2); assert.equal(calls, 2);
  s.hook = at => { if (at === 'reader-verified') { const writer = new DomainStore(s.root); writer.commit(noop(writer.read().reference, 'change-' + calls++)); } };
  rejects(() => s.read(), 'HEAD_CHANGED');
});

test('read verifies original noncanonical bytes and rejects a coherently hashed false index', t => {
  const { s, root, head } = setup(t); s.commit(plan(head));
  const h = s.read().head, ref = h.products[0].dossier, location = path.join(root, ref.path);
  // Author a self-consistent alternate serialization: every referring hash must change.
  const original = JSON.parse(fs.readFileSync(location)), raw = Buffer.from(JSON.stringify(original, null, 3) + '\n\n');
  fs.writeFileSync(location, raw); ref.sha256 = digest(raw);
  const receiptRef = h.receipts[0], receiptPath = path.join(root, receiptRef.path), r = JSON.parse(fs.readFileSync(receiptPath));
  r.records.find(x => x.path === ref.path).sha256 = ref.sha256;
  const rb = Buffer.from(JSON.stringify(r)); fs.writeFileSync(receiptPath, rb); receiptRef.sha256 = digest(rb);
  const publish = () => { const hb = Buffer.from(JSON.stringify(h)); fs.writeFileSync(path.join(root, `Heads/${WORKSPACE}/2.json`), hb); fs.writeFileSync(path.join(root, 'domain-head.json'), hb); };
  publish(); assert.equal(s.read().head.products[0].dossier.sha256, digest(raw));
  h.skus = []; publish(); rejects(() => s.read(), 'INVALID_SKU_INDEX');
});

test('required domain closure is mandatory; template successor CAS binds exact prior reference', t => {
  const { s, head } = setup(t), missing = plan(head); missing.records = [];
  rejects(() => s.commit(missing), 'MISSING_REFERENCE'); assert.deepEqual(s.read().reference, head);
  const result = s.commit(plan(head)), next = template(); next.revision = 2;
  const request = noop(result.head, 'template-next'); request.changes = [{ kind: 'template', id: next.templateId, expectedRevision: 1, record: next }];
  rejects(() => s.commit(request), 'REVISION_CONFLICT');
  next.supersedes = s.read().head.templates[0]; s.commit(request); assert.equal(s.read().head.templates[0].revision, 2);
});

// R1: each occurrence must match identity/revision even after its path was verified.
const referenceMutations = {
  id: r => ({ ...r, id: 'wrong-identity' }),
  revision: r => ({ ...r, revision: r.revision + 76 }),
  both: r => ({ ...r, id: 'wrong-identity', revision: r.revision + 76 })
};
const authoredNote = receipt => ({ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  text: 'Authored reference-sharing regression', createdAt: '2026-01-01T00:00:00.000Z', receipt });
function fileHashes(root) {
  return fs.readdirSync(root, { recursive: true }).filter(n => fs.statSync(path.join(root, n)).isFile())
    .sort().map(n => [n, digest(fs.readFileSync(path.join(root, n)))]);
}
function noPublication(s, input, code = 'REFERENCE_IDENTITY') {
  const before = s.read().reference, files = fileHashes(s.root), stages = []; s.hook = at => stages.push(at);
  try { rejects(() => s.commit(input), code); } finally { s.hook = () => {}; }
  assert.deepEqual(s.read().reference, before); assert.deepEqual(fileHashes(s.root), files);
  assert.equal(stages.some(at => ['file-flush', 'after-stage', 'after-immutable', 'before-replace', 'replace', 'after-replace'].includes(at)), false);
}
for (const [mutation, alter] of Object.entries(referenceMutations)) for (const order of ['good-first', 'bad-first']) {
  test(`R1 ${mutation}, ${order}: every shared evidence occurrence rejects before publication`, t => {
    const { s, head } = setup(t), input = plan(head), p = input.changes[0].record, good = p.sourceReceipt;
    // Canonical product traversal visits sourceReceipt before notes.
    p.sourceReceipt = order === 'good-first' ? good : alter(good);
    p.notes = [authoredNote(order === 'good-first' ? alter(good) : good)];
    noPublication(s, input);
  });
}
for (const [mutation, alter] of Object.entries(referenceMutations)) for (const order of ['good-first', 'bad-first']) {
  test(`R1 two product records ${mutation}, ${order}: shared provenance is occurrence-checked`, t => {
    const { s, head } = setup(t), input = plan(head), p = product('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');
    p.productCode = null; p.sourceReceipt = alter(p.sourceReceipt);
    const other = { kind: 'product', id: p.productId, expectedRevision: 0, record: p };
    if (order === 'good-first') input.changes.push(other); else input.changes.unshift(other);
    noPublication(s, input);
  });
}
for (const reverse of [false, true]) {
  test(`R1 two product records identical sharing works in ${reverse ? 'reverse' : 'forward'} order`, t => {
    const { s, head } = setup(t), input = plan(head), p = product('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'); p.productCode = null;
    const other = { kind: 'product', id: p.productId, expectedRevision: 0, record: p };
    if (reverse) input.changes.unshift(other); else input.changes.push(other);
    s.commit(input); const view = new DomainStore(s.root).read(); assert.equal(view.head.products.length, 2);
    for (const ref of view.head.products.map(x => x.dossier)) assert.deepEqual(view.records.get(ref.path).value.sourceReceipt, prepareRecord('evidence', source).reference);
  });
}
test('R1 legitimate identical sharing works within/across records, heads and receipts', t => {
  const { s, head } = setup(t), input = plan(head), good = input.changes[0].record.sourceReceipt;
  input.changes[0].record.notes = [authoredNote(good)];
  // Repeated submitted record references and product references reach the same exact bytes.
  input.records.push({ kind: 'evidence', record: source }); const first = s.commit(input);
  for (const [i, target] of [good, first.head, first.receipt, s.read().head.products[0].dossier].entries()) {
    const current = s.read(), p = structuredClone(current.records.get(current.head.products[0].dossier.path).value);
    p.revision++; p.notes = [authoredNote(target)]; const next = noop(current.reference, 'R1-sharing-' + i);
    next.changes = [{ kind: 'product', id: PRODUCT, expectedRevision: p.revision - 1, record: p }];
    const result = s.commit(next); assert.deepEqual(new DomainStore(s.root).read().reference, result.head);
  }
});
for (const kind of ['product', 'head', 'receipt']) for (const [mutation, alter] of Object.entries(referenceMutations)) {
  test(`R1 cached ${kind} ${mutation}: predecessor traversal cannot hide bad references`, t => {
    const { s, head } = setup(t), first = s.commit(plan(head)), current = s.read();
    const target = kind === 'product' ? current.head.products[0].dossier : kind === 'head' ? first.head : first.receipt;
    const p = product(); p.revision = 2; p.notes = [authoredNote(alter(target))];
    const next = noop(current.reference, 'R1-history-conflict'); next.changes = [{ kind: 'product', id: PRODUCT, expectedRevision: 1, record: p }];
    noPublication(s, next);
  });
}
test('R1 cached hash disagreement still returns REFERENCE_CONFLICT', t => {
  const { s, head } = setup(t), input = plan(head), good = input.changes[0].record.sourceReceipt;
  input.changes[0].record.notes = [authoredNote({ ...good, sha256: '0'.repeat(64) })];
  noPublication(s, input, 'REFERENCE_CONFLICT');
});

// Test-only tampering: update every referring hash and manifest size/hash so readers
// reach the identity check, rather than failing on unrelated stale byte hashes.
function rewriteReferenceSnapshot(root, mutate) {
  const manifestPath = path.join(root, 'domain-snapshot.json'), m = JSON.parse(fs.readFileSync(manifestPath));
  const h = JSON.parse(fs.readFileSync(path.join(root, 'domain-head.json'))), pr = h.products[0].dossier, rr = h.receipts[0];
  const p = JSON.parse(fs.readFileSync(path.join(root, pr.path))), r = JSON.parse(fs.readFileSync(path.join(root, rr.path)));
  mutate({ product: p, receipt: r, head: h });
  const pb = Buffer.from(JSON.stringify(p, null, 2) + '\n'); fs.writeFileSync(path.join(root, pr.path), pb); pr.sha256 = digest(pb);
  for (const ref of r.records) if (ref.path === pr.path) ref.sha256 = digest(pb);
  const rb = Buffer.from(JSON.stringify(r, null, 2) + '\n'); fs.writeFileSync(path.join(root, rr.path), rb); rr.sha256 = digest(rb);
  const hb = Buffer.from(JSON.stringify(h, null, 2) + '\n');
  fs.writeFileSync(path.join(root, m.head.path), hb); fs.writeFileSync(path.join(root, 'domain-head.json'), hb); m.head.sha256 = digest(hb);
  for (const f of m.files) { const b = fs.readFileSync(path.join(root, f.path)); f.sha256 = digest(b); f.bytes = b.length; }
  fs.writeFileSync(manifestPath, JSON.stringify(m, null, 2) + '\n');
  for (const f of m.files) { const b = fs.readFileSync(path.join(root, f.path)); assert.equal(digest(b), f.sha256); assert.equal(b.length, f.bytes); }
  return m;
}
for (const [mutation, alter] of Object.entries(referenceMutations)) for (const order of ['good-first', 'bad-first']) {
  test(`R1 independent read/export/verify/restore reject coherent ${mutation} ${order} closure`, t => {
    const { s, head, dir } = setup(t); s.commit(plan(head)); const snapshot = path.join(dir, 'malformed-snapshot'); s.exportTo(snapshot);
    rewriteReferenceSnapshot(snapshot, ({ product: p }) => {
      const good = p.sourceReceipt; p.sourceReceipt = order === 'good-first' ? good : alter(good);
      p.notes = [authoredNote(order === 'good-first' ? alter(good) : good)];
    });
    const reopened = new DomainStore(snapshot), exported = path.join(dir, 'refused-export'), restored = path.join(dir, 'refused-restore');
    rejects(() => reopened.read(), 'REFERENCE_IDENTITY'); rejects(() => reopened.exportTo(exported), 'REFERENCE_IDENTITY');
    rejects(() => verifySnapshot(snapshot), 'REFERENCE_IDENTITY'); rejects(() => restoreSnapshot(snapshot, restored), 'REFERENCE_IDENTITY');
    assert.equal(fs.existsSync(exported), false); assert.equal(fs.existsSync(restored), false);
    const inspected = spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/domain-inspect.mjs', import.meta.url)), snapshot], { encoding: 'utf8' });
    assert.equal(inspected.status, 1); assert.equal(JSON.parse(inspected.stderr).error, 'REFERENCE_IDENTITY');
  });
}
for (const link of ['receipt-record', 'receipt-predecessor']) {
  test(`R1 independent snapshot rejects cached ${link} identity/revision mismatch`, t => {
    const { s, head, dir } = setup(t); s.commit(plan(head)); const snapshot = path.join(dir, 'malformed-snapshot'); s.exportTo(snapshot);
    rewriteReferenceSnapshot(snapshot, ({ receipt: r }) => {
      if (link === 'receipt-record') { const i = r.records.findIndex(x => x.id === source.id); r.records[i] = referenceMutations.both(r.records[i]); }
      else r.previousHead = referenceMutations.both(r.previousHead);
    });
    rejects(() => new DomainStore(snapshot).read(), 'REFERENCE_IDENTITY'); rejects(() => verifySnapshot(snapshot), 'REFERENCE_IDENTITY');
    const restored = path.join(dir, 'refused-restore'); rejects(() => restoreSnapshot(snapshot, restored), 'REFERENCE_IDENTITY');
    assert.equal(fs.existsSync(restored), false);
  });
}
test('R1 coherently rewritten identical sharing snapshot remains readable/exportable/restorable', t => {
  const { s, head, dir } = setup(t); s.commit(plan(head)); const snapshot = path.join(dir, 'valid-shared-snapshot'); s.exportTo(snapshot);
  const m = rewriteReferenceSnapshot(snapshot, ({ product: p }) => { p.notes = [authoredNote({ ...p.sourceReceipt })]; });
  assert.deepEqual(new DomainStore(snapshot).read().reference, m.head); assert.deepEqual(verifySnapshot(snapshot).head, m.head);
  const exported = path.join(dir, 'valid-reexport'); new DomainStore(snapshot).exportTo(exported);
  assert.deepEqual(restoreSnapshot(exported, path.join(dir, 'valid-restore')).reference, m.head);
});

test('finite 256 product index rejects excess without publishing or evicting', t => {
  const { s, head } = setup(t); s.commit(plan(head)); let made = 1;
  while (made < 256) {
    const batch = noop(s.read().reference, 'batch-' + made);
    for (let i = 0; i < Math.min(64, 256 - made); i++) {
      const id = (made + i + 1).toString(16).padStart(8, '0') + '-1111-4111-8111-111111111111', p = product(id); p.productCode = null;
      batch.changes.push({ kind: 'product', id, expectedRevision: 0, record: p });
    }
    made += batch.changes.length; s.commit(batch);
  }
  const before = s.read().reference, extra = noop(before, 'excess'), p = product(WORKSPACE); p.productCode = null;
  extra.changes = [{ kind: 'product', id: WORKSPACE, expectedRevision: 0, record: p }];
  rejects(() => s.commit(extra), 'CAPACITY'); assert.deepEqual(s.read().reference, before); assert.equal(s.read().head.products.length, 256);
});

test('finite head history retains replay evidence and refuses the 129th head', t => {
  const { s, head } = setup(t), first = noop(head, 'first-history'), firstResult = s.commit(first); let current = firstResult.head;
  for (let n = 3; n <= STORE_LIMITS.heads; n++) current = s.commit(noop(current, 'history-' + n)).head;
  rejects(() => s.commit(noop(current, 'history-full')), 'CAPACITY');
  assert.deepEqual(s.commit(first), { head: firstResult.head, receipt: firstResult.receipt, replayed: true });
  assert.equal(s.read().headCount, STORE_LIMITS.heads);
});

test('domain snapshot/restore preserve actual hashes and report absent external bytes separately', t => {
  const { s, head, dir } = setup(t), input = plan(head);
  input.changes[1].record.sourceRefs = [{ kind: 'file', sourceId: 'authored-missing-source', revision: 'r1', sha256: 'a'.repeat(64),
    location: 'Sources/authored-absent.txt', locator: { kind: 'page', page: 1 }, observedAt: '2026-01-01T00:00:00.000Z' }];
  s.commit(input); const snapshot = path.join(dir, 'snapshot'), destination = path.join(dir, 'restored'), m = s.exportTo(snapshot);
  assert.deepEqual(verifySnapshot(snapshot), m); assert.equal(m.external.length, 1); assert.equal(m.external[0].availability, 'not-verified');
  const restored = restoreSnapshot(snapshot, destination); assert.deepEqual(restored.reference, m.head);
  for (const f of m.files) assert.equal(digest(fs.readFileSync(path.join(destination, f.path))), f.sha256);
  assert.equal(fs.existsSync(path.join(destination, 'workspace.sqlite')), false);
  rejects(() => restoreSnapshot(snapshot, destination), 'DESTINATION_EXISTS'); rejects(() => s.exportTo(s.root), 'DESTINATION_EXISTS');
  fs.appendFileSync(path.join(snapshot, m.head.path), ' '); rejects(() => verifySnapshot(snapshot), 'HASH_MISMATCH');
});

test('interrupted export stays incomplete; corrupt current head can only export explicitly selected history', t => {
  const { s, head, dir, root } = setup(t); s.commit(plan(head)); const failed = path.join(dir, 'interrupted');
  s.hook = at => { if (at === 'export-file') throw Object.assign(new Error('authored denial'), { code: 'EACCES' }); };
  assert.throws(() => s.exportTo(failed)); rejects(() => verifySnapshot(failed), 'MISSING_REFERENCE'); s.hook = () => {};
  fs.writeFileSync(path.join(root, 'domain-head.json'), '{'); rejects(() => s.read(), 'INVALID_JSON');
  const historic = path.join(dir, 'historic'); s.exportTo(historic, { atHead: head });
  const restored = restoreSnapshot(historic, path.join(dir, 'historic-restored')); assert.deepEqual(restored.reference, head);
  assert.equal(fs.readFileSync(path.join(root, 'domain-head.json'), 'utf8'), '{');
});

test('Windows local filesystem gate: actual replace/reopen, exact case, drive paths and junctions', { skip: process.platform !== 'win32' }, t => {
  const { s, root, dir, head } = setup(t); t.diagnostic(JSON.stringify({ node: process.version, os: os.release(), platform: process.platform, filesystem: fs.statfsSync(root).type, method: 'exclusive-create/fsync/rename/reopen; process-kill tests in same suite' }));
  const result = s.commit(plan(head)); assert.deepEqual(new DomainStore(root).read().reference, result.head);
  rejects(() => s.readFile('Workspace.json'), 'PATH_CASE_MISMATCH');
  rejects(() => s.readFile('Z:/outside'), 'INVALID_RECORD');
  const outside = path.join(dir, 'junction-target'); fs.mkdirSync(outside); fs.symlinkSync(outside, path.join(root, 'Staging', 'junction'), 'junction');
  rejects(() => s.readFile('Staging/junction/file.json'), 'UNSAFE_PATH');
});
