// Trusted local file persistence only. No Kernel/SQLite/session/command routing.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { validate } from './contracts/3djat.mjs';

export const STORE_LIMITS = Object.freeze({ fileBytes: 1024 ** 2, totalBytes: 32 * 1024 ** 2,
  files: 4096, heads: 128, writes: 64, external: 512 });
const MARKER = 'domain-store.json', HEAD = 'domain-head.json', LOCK = 'domain-write.lock';
const KINDS = new Set(['product', 'template', 'business-context', 'proposal', 'proposal-decision', 'template-decision', 'attachment', 'evidence']);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const equal = (a, b) => a?.id === b?.id && a?.revision === b?.revision && a?.sha256 === b?.sha256 && a?.path === b?.path;
const stable = value => JSON.stringify(value, (_, x) => x && typeof x === 'object' && !Array.isArray(x)
  ? Object.fromEntries(Object.keys(x).sort().map(k => [k, x[k]])) : x);
export class StoreError extends Error {
  constructor(code, detail = {}) { super(code); this.name = 'StoreError'; this.code = code; this.detail = detail; }
}
const fail = (code, detail) => { throw new StoreError(code, detail); };
const check = (condition, code, detail) => { if (!condition) fail(code, detail); };
function shape(kind, value) {
  const r = validate(kind, value);
  check(r.ok, r.errors.some(e => e.code === 'UNSUPPORTED_SCHEMA') ? 'UNSUPPORTED_SCHEMA' : 'INVALID_RECORD', { kind, errors: r.errors });
}
function keys(v, names) { check(v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === names.length && names.every(k => Object.hasOwn(v, k)), 'INVALID_METADATA'); }
function text(v, max = 200) { check(typeof v === 'string' && v.trim() && v.length <= max, 'INVALID_METADATA'); }
function integer(v, min = 1) { check(Number.isSafeInteger(v) && v >= min && v <= 2147483647, 'INVALID_METADATA'); }
function array(v, max) { check(Array.isArray(v) && v.length <= max, 'CAPACITY'); }
function json(bytes) { try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { fail('INVALID_JSON'); } }
function bytes(value) { const b = Buffer.from(stable(value) + '\n'); check(b.length <= STORE_LIMITS.fileBytes, 'OVERSIZE'); return b; }
const reference = (id, revision, data, location) => ({ id, revision, sha256: hash(data), path: location });
const headRef = (v, b) => reference(v.workspaceId, v.revision, b, `Heads/${v.workspaceId}/${v.revision}.json`);
function identity(kind, v) {
  return kind === 'product' ? v.productId : kind === 'template' ? v.templateId : kind === 'business-context' ? v.workspaceId :
    kind === 'proposal' ? v.proposalId : kind.endsWith('decision') ? v.decisionId : kind === 'attachment' ? v.attachmentId : v.id;
}
function kindOf(v) {
  const kind = v.schemaVersion?.match(/^3djat\.(.+)\.v1$/)?.[1];
  check(KINDS.has(kind), 'UNSUPPORTED_SCHEMA'); return kind;
}
function evidence(v) {
  keys(v, ['schemaVersion', 'id', 'revision', 'description']); check(v.schemaVersion === '3djat.evidence.v1', 'UNSUPPORTED_SCHEMA');
  shape('revision-ref', { id: v.id, revision: v.revision, sha256: '0'.repeat(64), path: 'Domain/evidence.json' }); text(v.description, 2000);
}
export function prepareRecord(kind, value) {
  check(KINDS.has(kind), 'UNSUPPORTED_SCHEMA'); kind === 'evidence' ? evidence(value) : shape(kind, value);
  check(kindOf(value) === kind, 'INVALID_RECORD');
  const data = bytes(value), id = identity(kind, value), revision = value.revision ?? 1;
  return { kind, record: json(data), reference: reference(id, revision, data, `Domain/${kind}/${id}/${revision}.json`), data };
}
function marker(v) {
  keys(v, ['schemaVersion', 'workspaceId', 'workspace', 'genesis']); check(v.schemaVersion === '3djat.domain-store.v1', 'UNSUPPORTED_SCHEMA');
  shape('revision-ref', v.workspace); shape('revision-ref', v.genesis);
  check(v.workspace.id === v.workspaceId && v.workspace.revision === 1 && v.workspace.path === 'Domain/workspace/1.json' && v.genesis.id === v.workspaceId && v.genesis.revision === 1 && v.genesis.path === `Heads/${v.workspaceId}/1.json`, 'WORKSPACE_MISMATCH');
}
function receipt(v) {
  keys(v, ['schemaVersion', 'id', 'revision', 'workspaceId', 'principal', 'operation', 'key', 'payloadHash', 'previousHead', 'records', 'transitions']);
  check(v.schemaVersion === '3djat.store-receipt.v1', 'UNSUPPORTED_SCHEMA'); integer(v.revision); check(v.revision === 1, 'INVALID_METADATA');
  text(v.principal); text(v.operation); text(v.key); shape('revision-ref', v.previousHead); array(v.records, STORE_LIMITS.writes); array(v.transitions, STORE_LIMITS.writes);
  check(/^[0-9a-f]{64}$/.test(v.payloadHash) && /^[0-9a-f]{64}$/.test(v.id), 'INVALID_METADATA');
  check(v.id === hash(Buffer.from(stable([v.workspaceId, v.principal, v.operation, v.key]))), 'INVALID_METADATA');
  for (const r of v.records) shape('revision-ref', r);
  for (const t of v.transitions) { keys(t, ['kind', 'id', 'from', 'to']); check(['product', 'template', 'business-context'].includes(t.kind), 'INVALID_METADATA'); text(t.id, 80); integer(t.from, 0); integer(t.to); check(t.to === t.from + 1, 'REVISION_CONFLICT'); }
}
function requiredReferences(kind, v, external) {
  const refs = [], stack = [{ v, field: '' }]; let n = 0;
  while (stack.length) {
    check(++n <= 30000, 'CAPACITY'); const { v: x, field } = stack.pop();
    if (!x || typeof x !== 'object') continue;
    if (typeof x.path === 'string' && Object.hasOwn(x, 'sha256') && Object.hasOwn(x, 'id')) {
      shape('revision-ref', x);
      if (['experiment', 'evidenceReceipt', 'humanActionReceipt'].includes(field) && ['template-decision', 'proposal-decision'].includes(kind)) external.push({ kind: 'operational-evidence', reference: x, availability: 'not-verified' });
      else { check(/^(Domain|Heads|Receipts)\//.test(x.path), 'INVALID_DOMAIN_REFERENCE', { path: x.path }); refs.push(x); }
      continue;
    }
    if (x.kind === 'file' || x.kind === 'drive') external.push({ kind: 'source', source: x, availability: 'not-verified' });
    if (x.artifactId && x.sha256) external.push({ kind: 'operational-artifact', artifact: x, availability: 'not-verified' });
    if (x.schemaVersion === '3djat.attachment.v1') external.push({ kind: 'attachment-bytes', location: x.location, sha256: x.sha256, availability: 'not-verified' });
    for (const [k, y] of Object.entries(x)) if (typeof y === 'object') stack.push({ v: y, field: Array.isArray(x) ? field : k });
  }
  check(external.length <= STORE_LIMITS.external, 'CAPACITY'); return refs;
}

export class DomainStore {
  constructor(root, { workspaceId, hook = () => {} } = {}) {
    check(typeof root === 'string' && path.isAbsolute(root), 'EXPLICIT_ROOT_REQUIRED');
    const resolved = path.resolve(root); check(!fs.lstatSync(resolved).isSymbolicLink(), 'UNSAFE_PATH');
    this.root = fs.realpathSync.native(resolved); this.rootIdentity = fs.statSync(this.root); this.hook = hook;
    this.markerBytes = this.readFile(MARKER); const m = json(this.markerBytes); marker(m); this.marker = m;
    check(!workspaceId || workspaceId === m.workspaceId, 'WORKSPACE_MISMATCH');
    const wb = this.readFile('workspace.json'); check(hash(wb) === m.workspace.sha256, 'HASH_MISMATCH');
    this.workspace = json(wb); shape('workspace', this.workspace);
    check(this.workspace.workspaceId === m.workspaceId && this.workspace.revision === 1 && equal(this.workspace.domainHead, m.genesis), 'WORKSPACE_MISMATCH');
  }
  static initialize(root, { workspaceId, paths = { business: 'Business', products: 'Products', templates: 'Templates', operations: 'Operations' }, sourceCommit, hook = () => {} }) {
    check(typeof root === 'string' && path.isAbsolute(root), 'EXPLICIT_ROOT_REQUIRED');
    if (!fs.existsSync(root)) fs.mkdirSync(root);
    check(!fs.lstatSync(root).isSymbolicLink(), 'UNSAFE_PATH');
    const s = Object.create(DomainStore.prototype); s.root = fs.realpathSync.native(root); s.rootIdentity = fs.statSync(s.root); s.hook = hook;
    check(fs.readdirSync(s.root).length === 0, 'UNKNOWN_ROOT');
    const lock = s.lock(workspaceId);
    try {
      check(fs.readdirSync(s.root).every(x => x === LOCK), 'UNKNOWN_ROOT');
      const h = { schemaVersion: '3djat.domain-head.v1', workspaceId, revision: 1, previousHead: null, products: [], skus: [], templates: [], business: null, receipts: [] };
      shape('domain-head', h); const hb = bytes(h), hr = headRef(h, hb);
      const w = { schemaVersion: '3djat.workspace.v1', workspaceId, revision: 1, domainHead: hr, paths, contractVersion: '3djat.v1', sourceCommit };
      shape('workspace', w); const wb = bytes(w), wr = reference(workspaceId, 1, wb, 'Domain/workspace/1.json');
      s.writeImmutable(hr.path, hb); s.writeImmutable(wr.path, wb); s.writeImmutable('workspace.json', wb); s.writeImmutable(HEAD, hb);
      s.writeImmutable(MARKER, bytes({ schemaVersion: '3djat.domain-store.v1', workspaceId, workspace: wr, genesis: hr }));
    } finally { s.unlock(lock); }
    return new DomainStore(root, { workspaceId, hook });
  }
  safe(relative, createParents = false) {
    shape('revision-ref', { id: 'path-check', revision: 1, sha256: '0'.repeat(64), path: relative });
    const stat = fs.statSync(this.root); check(stat.dev === this.rootIdentity.dev && stat.ino === this.rootIdentity.ino && fs.realpathSync.native(this.root) === this.root, 'ROOT_CHANGED');
    const parts = relative.split('/'); let current = this.root;
    for (let i = 0; i < parts.length; i++) {
      current = path.join(current, parts[i]);
      if (!fs.existsSync(current)) {
        // existsSync hides dangling symlinks: lstat must still reject them.
        try { check(!fs.lstatSync(current).isSymbolicLink(), 'UNSAFE_PATH'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
        if (createParents && i < parts.length - 1) { fs.mkdirSync(current); this.syncDirectory(path.dirname(current)); }
        else continue;
      }
      const st = fs.lstatSync(current); check(!st.isSymbolicLink() && st.dev === this.rootIdentity.dev, 'UNSAFE_PATH', { path: relative });
      check(i === parts.length - 1 ? st.isFile() && st.nlink === 1 : st.isDirectory(), 'UNSAFE_PATH');
      const actual = fs.realpathSync.native(current), rel = path.relative(this.root, actual);
      check(rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel), 'UNSAFE_PATH');
      // Case aliases are refused, including on case-insensitive Windows filesystems.
      check(fs.readdirSync(path.dirname(current)).includes(parts[i]), 'PATH_CASE_MISMATCH');
    }
    return current;
  }
  readFile(relative) {
    let fd;
    try {
      const location = this.safe(relative); fd = fs.openSync(location, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
      const st = fs.fstatSync(fd); check(st.isFile() && st.nlink === 1 && st.size <= STORE_LIMITS.fileBytes, 'OVERSIZE');
      const data = Buffer.alloc(st.size + 1); let length = 0, count;
      while (length < data.length && (count = fs.readSync(fd, data, length, data.length - length, length)) > 0) length += count;
      check(length === st.size && length <= STORE_LIMITS.fileBytes, 'FILE_CHANGED');
      const after = fs.fstatSync(fd); check(after.size === st.size && after.mtimeMs === st.mtimeMs, 'FILE_CHANGED'); this.safe(relative);
      return data.subarray(0, length);
    } catch (e) { if (e.code === 'ENOENT') fail('MISSING_REFERENCE', { path: relative }); throw e; }
    finally { if (fd !== undefined) fs.closeSync(fd); }
  }
  syncDirectory(directory) {
    let fd;
    try { fd = fs.openSync(directory, 'r'); fs.fsyncSync(fd); }
    catch (e) { if (!(process.platform === 'win32' && ['EPERM', 'EACCES', 'EINVAL', 'EISDIR', 'ENOTSUP'].includes(e.code))) throw e; }
    finally { if (fd !== undefined) fs.closeSync(fd); }
  }
  writeImmutable(relative, data) {
    check(data.length <= STORE_LIMITS.fileBytes, 'OVERSIZE'); const location = this.safe(relative, true);
    if (fs.existsSync(location)) {
      check(this.readFile(relative).equals(data), 'IMMUTABLE_CONFLICT', { path: relative });
      // A matching orphan may have survived a kill before its original flush.
      const existing = fs.openSync(this.safe(relative), fs.constants.O_RDWR | (fs.constants.O_NOFOLLOW ?? 0));
      try { fs.fsyncSync(existing); } finally { fs.closeSync(existing); }
      this.safe(relative); this.syncDirectory(path.dirname(location)); return;
    }
    let fd;
    try { fd = fs.openSync(location, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0), 0o600);
      fs.writeFileSync(fd, data); this.hook('file-flush', { path: relative }); fs.fsyncSync(fd);
    } finally { if (fd !== undefined) fs.closeSync(fd); }
    this.safe(relative); this.syncDirectory(path.dirname(location));
  }
  lock(workspaceId) {
    const data = bytes({ schemaVersion: '3djat.domain-lock.v1', workspaceId, nonce: randomUUID(), pid: process.pid });
    const location = this.safe(LOCK); let fd;
    try { fd = fs.openSync(location, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0), 0o600); fs.writeFileSync(fd, data); fs.fsyncSync(fd); }
    catch (e) { if (e.code === 'EEXIST') fail('LOCKED'); throw e; }
    finally { if (fd !== undefined) fs.closeSync(fd); }
    this.syncDirectory(this.root); return data;
  }
  unlock(data) { check(this.readFile(LOCK).equals(data), 'LOCK_CHANGED'); fs.unlinkSync(this.safe(LOCK)); this.syncDirectory(this.root); }
  recoverLock({ expectedLockHash, confirmedQuiescent }) {
    check(confirmedQuiescent === true, 'QUIESCENCE_REQUIRED'); const b = this.readFile(LOCK); check(hash(b) === expectedLockHash, 'LOCK_CHANGED');
    this.writeImmutable(`Recovery/${randomUUID()}/lock.json`, b); check(hash(this.readFile(LOCK)) === expectedLockHash, 'LOCK_CHANGED');
    fs.unlinkSync(this.safe(LOCK)); this.syncDirectory(this.root);
  }
  read({ atHead = null, retries = 2 } = {}) {
    check(Number.isInteger(retries) && retries >= 0 && retries <= 2, 'INVALID_METADATA');
    for (let attempt = 0; attempt <= retries; attempt++) {
      const b = atHead ? this.readFile(atHead.path) : this.readFile(HEAD), h = json(b); shape('domain-head', h);
      check(h.workspaceId === this.marker.workspaceId, 'WORKSPACE_MISMATCH');
      const r = headRef(h, b); if (atHead) { shape('revision-ref', atHead); check(equal(r, atHead), 'HASH_MISMATCH'); }
      const result = this.closure(r); this.hook('reader-verified', { head: r });
      if (atHead || this.readFile(HEAD).equals(b)) return { ...result, head: h, reference: r };
    }
    fail('HEAD_CHANGED');
  }
  closure(start, supplied = new Map()) {
    const records = new Map(), files = new Map(), external = [], active = new Set(), done = new Set(); let total = 0, heads = 0;
    const stack = [{ ref: start, exit: false }];
    while (stack.length) {
      const { ref: r, exit } = stack.pop(); shape('revision-ref', r);
      if (exit) { active.delete(r.path); done.add(r.path); continue; }
      if (files.has(r.path)) check(hash(files.get(r.path)) === r.sha256, 'REFERENCE_CONFLICT');
      if (done.has(r.path)) continue;
      check(!active.has(r.path), 'REFERENCE_CYCLE'); active.add(r.path);
      const b = supplied.get(r.path) ?? this.readFile(r.path); check(hash(b) === r.sha256, 'HASH_MISMATCH', { path: r.path });
      total += b.length; check(total <= STORE_LIMITS.totalBytes && files.size < STORE_LIMITS.files, 'CAPACITY');
      const v = json(b); let refs, kind;
      if (v.schemaVersion === '3djat.domain-head.v1') {
        shape('domain-head', v); check(v.workspaceId === this.marker.workspaceId && equal(headRef(v, b), r), 'WORKSPACE_MISMATCH');
        check(++heads <= STORE_LIMITS.heads, 'CAPACITY');
        if (!v.previousHead) check(equal(r, this.marker.genesis), 'GENESIS_MISMATCH');
        refs = [v.previousHead, ...v.products.map(x => x.dossier), ...v.templates, v.business, ...v.receipts].filter(Boolean); kind = 'domain-head';
      } else if (v.schemaVersion === '3djat.store-receipt.v1') {
        receipt(v); check(v.workspaceId === this.marker.workspaceId && equal(reference(v.id, 1, b, `Receipts/${v.id}.json`), r), 'INVALID_METADATA');
        refs = [v.previousHead, ...v.records]; kind = 'store-receipt';
      } else if (v.schemaVersion === '3djat.workspace.v1') { shape('workspace', v); check(equal(r, this.marker.workspace), 'REFERENCE_IDENTITY'); refs = []; kind = 'workspace'; }
      else {
        kind = kindOf(v); const p = prepareRecord(kind, v); check(p.reference.path === r.path, 'REFERENCE_IDENTITY');
        // p validates values but hash verification above always uses original bytes.
        check(identity(kind, v) === r.id && (v.revision ?? 1) === r.revision, 'REFERENCE_IDENTITY');
        refs = requiredReferences(kind, v, external);
      }
      records.set(r.path, { kind, value: v, reference: r }); files.set(r.path, b);
      stack.push({ ref: r, exit: true }); for (const child of refs.reverse()) stack.push({ ref: child, exit: false });
    }
    for (const { kind, value: h } of records.values()) if (kind === 'domain-head') {
      check(h.previousHead ? records.get(h.previousHead.path)?.kind === 'domain-head' && records.get(h.previousHead.path).value.revision + 1 === h.revision && h.receipts.length === 1 : h.receipts.length === 0, 'INVALID_HISTORY');
      for (const x of h.products) { const p = records.get(x.dossier.path); check(p?.kind === 'product' && p.value.productId === x.productId && p.value.revision === x.dossier.revision, 'INVALID_INDEX'); }
      for (const t of h.templates) check(records.get(t.path)?.kind === 'template' && records.get(t.path).value.templateId === t.id, 'INVALID_INDEX');
      if (h.business) check(records.get(h.business.path)?.kind === 'business-context' && records.get(h.business.path).value.workspaceId === h.workspaceId, 'INVALID_INDEX');
      const skus = h.products.map(x => records.get(x.dossier.path).value).filter(x => x.productCode !== null).map(x => ({ productCode: x.productCode, productId: x.productId }));
      check(stable(skus) === stable(h.skus), 'INVALID_SKU_INDEX');
      for (const r of h.receipts) check(records.get(r.path)?.kind === 'store-receipt' && equal(records.get(r.path).value.previousHead, h.previousHead), 'INVALID_RECEIPT');
    }
    const wb = this.readFile('workspace.json'); check(hash(wb) === this.marker.workspace.sha256, 'HASH_MISMATCH');
    files.set('workspace.json', wb); files.set(this.marker.workspace.path, this.readFile(this.marker.workspace.path));
    check(hash(files.get(this.marker.workspace.path)) === this.marker.workspace.sha256, 'HASH_MISMATCH'); const mb = this.readFile(MARKER); check(mb.equals(this.markerBytes), 'STORE_CHANGED'); files.set(MARKER, mb);
    check(files.size + 1 <= STORE_LIMITS.files && [...files.values()].reduce((n, b) => n + b.length, 0) + files.get(start.path).length <= STORE_LIMITS.totalBytes, 'CAPACITY');
    return { records, files, external, headCount: heads };
  }
  commit(plan) {
    keys(plan, ['principal', 'operation', 'key', 'expectedHead', 'changes', 'records']);
    const { principal, operation, key, expectedHead, changes, records } = plan;
    text(principal); text(operation); text(key); shape('revision-ref', expectedHead); array(changes, STORE_LIMITS.writes); array(records, STORE_LIMITS.writes);
    const prepared = records.map(x => { keys(x, ['kind', 'record']); return prepareRecord(x.kind, x.record); });
    const changed = changes.map(x => { keys(x, ['kind', 'id', 'expectedRevision', 'record']); return prepareRecord(x.kind, x.record); });
    const payloadHash = hash(bytes({ expectedHead, changes: changes.map((x, i) => ({ kind: x.kind, id: x.id, expectedRevision: x.expectedRevision, reference: changed[i].reference })), records: prepared.map(x => ({ kind: x.kind, reference: x.reference })) }));
    const id = hash(Buffer.from(stable([this.marker.workspaceId, principal, operation, key]))), lock = this.lock(this.marker.workspaceId);
    let publicationPossible = false, intended = null;
    try {
      this.hook('locked', {}); const current = this.read();
      const owner = [...current.records.values()].find(x => x.kind === 'domain-head' && x.value.receipts.some(r => r.id === id));
      if (owner) {
        const prior = current.records.get(owner.value.receipts.find(r => r.id === id).path);
        check(prior.value.payloadHash === payloadHash, 'IDEMPOTENCY_CONFLICT');
        return { head: owner.reference, receipt: prior.reference, replayed: true };
      }
      check(equal(current.reference, expectedHead), 'REVISION_CONFLICT'); check(current.headCount < STORE_LIMITS.heads, 'CAPACITY');
      const h = structuredClone(current.head); h.revision++; h.previousHead = current.reference;
      const transitions = [], seen = new Set();
      for (const change of changes) {
        keys(change, ['kind', 'id', 'expectedRevision', 'record']); check(['product', 'template', 'business-context'].includes(change.kind), 'INVALID_METADATA'); integer(change.expectedRevision, 0);
        const p = prepareRecord(change.kind, change.record); check(p.reference.id === change.id && !seen.has(change.kind + change.id), 'INVALID_RECORD'); seen.add(change.kind + change.id);
        const previous = change.kind === 'product' ? h.products.find(x => x.productId === change.id)?.dossier : change.kind === 'template' ? h.templates.find(x => x.id === change.id) : h.business;
        check((previous?.revision ?? 0) === change.expectedRevision && p.reference.revision === change.expectedRevision + 1, 'REVISION_CONFLICT');
        if (change.kind === 'template') check(previous ? equal(change.record.supersedes, previous) : change.record.supersedes === null, 'REVISION_CONFLICT');
        if (change.kind === 'business-context') check(change.id === this.marker.workspaceId, 'WORKSPACE_MISMATCH');
        if (change.kind === 'product') { const old = h.products.find(x => x.productId === change.id); if (old) old.dossier = p.reference; else h.products.push({ productId: change.id, dossier: p.reference }); }
        else if (change.kind === 'template') { const i = h.templates.findIndex(x => x.id === change.id); if (i < 0) h.templates.push(p.reference); else h.templates[i] = p.reference; }
        else h.business = p.reference;
        transitions.push({ kind: change.kind, id: change.id, from: change.expectedRevision, to: p.reference.revision }); prepared.push(p);
      }
      check(prepared.length <= STORE_LIMITS.writes, 'CAPACITY');
      h.skus = h.products.map(x => prepared.find(p => equal(p.reference, x.dossier))?.record ?? current.records.get(x.dossier.path)?.value)
        .filter(x => x.productCode !== null).map(x => ({ productCode: x.productCode, productId: x.productId }));
      check(new Set(h.skus.map(x => x.productCode)).size === h.skus.length, 'SKU_CONFLICT');
      const rec = { schemaVersion: '3djat.store-receipt.v1', id, revision: 1, workspaceId: this.marker.workspaceId, principal, operation, key, payloadHash,
        previousHead: current.reference, records: prepared.map(x => x.reference), transitions }; receipt(rec);
      check(h.products.length <= 256 && h.templates.length <= 256 && h.skus.length <= 256, 'CAPACITY');
      const rb = bytes(rec), rr = reference(id, 1, rb, `Receipts/${id}.json`); h.receipts = [rr]; shape('domain-head', h);
      const hb = bytes(h); intended = headRef(h, hb);
      const staged = new Map(prepared.map(x => [x.reference.path, x.data])); staged.set(rr.path, rb); staged.set(intended.path, hb);
      for (const [location, data] of staged) if (fs.existsSync(this.safe(location))) check(this.readFile(location).equals(data), 'IMMUTABLE_CONFLICT', { path: location });
      this.closure(intended, staged); // Verify complete proposed closure before making any current change.
      const transaction = randomUUID(); let n = 0;
      for (const data of staged.values()) this.writeImmutable(`Staging/${transaction}/${n++}.json`, data);
      this.hook('after-stage', {});
      for (const [location, data] of staged) this.writeImmutable(location, data);
      this.hook('after-immutable', {});
      const temp = `Staging/${transaction}/head.json`; this.writeImmutable(temp, hb); this.safe(HEAD); this.safe(temp);
      this.hook('before-replace', {}); publicationPossible = true; this.hook('replace', {});
      fs.renameSync(this.safe(temp), this.safe(HEAD)); this.hook('after-replace', {}); this.syncDirectory(this.root);
      const verified = this.read(); check(equal(verified.reference, intended), 'HEAD_CHANGED'); this.hook('before-reply', {});
      return { head: intended, receipt: rr, replayed: false, durability: process.platform === 'win32' ? 'file-fsync;directory-flush-unverified' : 'file-and-directory-fsync;no-power-loss-claim' };
    } catch (e) {
      if (publicationPossible) fail('COMMIT_UNCERTAIN', { intendedHead: intended, cause: e.code ?? 'IO_FAILURE' });
      if (e instanceof StoreError) throw e;
      fail('COMMIT_ABORTED', { cause: e.code ?? 'IO_FAILURE', previousHead: expectedHead });
    } finally {
      try { this.unlock(lock); } catch (e) { if (publicationPossible) fail('COMMIT_UNCERTAIN', { intendedHead: intended, cause: e.code ?? 'LOCK_RELEASE_FAILURE' }); throw e; }
    }
  }
  quarantineOrphans({ expectedHead, confirmedQuiescent }) {
    check(confirmedQuiescent === true, 'QUIESCENCE_REQUIRED'); const lock = this.lock(this.marker.workspaceId);
    try {
      const current = this.read(); check(equal(expectedHead, current.reference), 'REVISION_CONFLICT'); const keep = new Set(current.files.keys());
      const pending = []; const stack = ['Domain', 'Heads', 'Receipts', 'Staging']; let visited = 0, orphanBytes = 0;
      while (stack.length) {
        const rel = stack.pop(); check(++visited <= STORE_LIMITS.files * 2, 'CAPACITY'); const location = path.join(this.root, rel);
        if (!fs.existsSync(location)) continue; const st = fs.lstatSync(location); check(!st.isSymbolicLink(), 'UNSAFE_PATH');
        if (st.isDirectory()) {
          const directory = fs.opendirSync(location);
          try { let child; while ((child = directory.readSync())) { check(stack.length + visited < STORE_LIMITS.files * 2, 'CAPACITY'); stack.push(rel + '/' + child.name); } } finally { directory.closeSync(); }
        } else {
          this.safe(rel); if (!keep.has(rel)) {
            orphanBytes += st.size; check(st.size <= STORE_LIMITS.fileBytes && orphanBytes <= STORE_LIMITS.totalBytes && pending.length < STORE_LIMITS.files, 'CAPACITY'); pending.push(rel);
          }
        }
      }
      const quarantine = `Recovery/${randomUUID()}`;
      for (const rel of pending) { const b = this.readFile(rel); this.writeImmutable(`${quarantine}/${rel}`, b); fs.unlinkSync(this.safe(rel)); this.syncDirectory(path.dirname(path.join(this.root, rel))); }
      this.syncDirectory(this.root); return { quarantine, files: pending };
    } finally { this.unlock(lock); }
  }
  exportTo(destination, { atHead = null } = {}) {
    const snapshot = this.read({ atHead }), files = new Map(snapshot.files);
    files.set(HEAD, files.get(snapshot.reference.path)); freshDestination(destination);
    const target = targetWriter(destination, this.hook);
    for (const [location, b] of files) { target.writeImmutable(location, b); this.hook('export-file', { path: location }); }
    const manifest = { schemaVersion: '3djat.domain-snapshot.v1', workspaceId: this.marker.workspaceId, head: snapshot.reference,
      files: [...files].map(([location, b]) => ({ path: location, sha256: hash(b), bytes: b.length })), external: snapshot.external };
    target.writeImmutable('domain-snapshot.json', bytes(manifest)); verifySnapshot(destination); return manifest;
  }
}
function freshDestination(root) { check(typeof root === 'string' && path.isAbsolute(root), 'EXPLICIT_ROOT_REQUIRED'); check(!fs.existsSync(root), 'DESTINATION_EXISTS'); fs.mkdirSync(root); }
function targetWriter(root, hook = () => {}) { check(typeof root === 'string' && path.isAbsolute(root), 'EXPLICIT_ROOT_REQUIRED'); check(!fs.lstatSync(root).isSymbolicLink(), 'UNSAFE_PATH'); const s = Object.create(DomainStore.prototype); s.root = fs.realpathSync.native(root); s.rootIdentity = fs.statSync(s.root); s.hook = hook; return s; }
export function verifySnapshot(root) {
  const reader = targetWriter(root), b = reader.readFile('domain-snapshot.json'), m = json(b);
  keys(m, ['schemaVersion', 'workspaceId', 'head', 'files', 'external']); check(m.schemaVersion === '3djat.domain-snapshot.v1', 'UNSUPPORTED_SCHEMA');
  shape('revision-ref', m.head); array(m.files, STORE_LIMITS.files); array(m.external, STORE_LIMITS.external); let total = 0; const paths = new Set();
  for (const f of m.files) { keys(f, ['path', 'sha256', 'bytes']); check(!paths.has(f.path), 'INVALID_METADATA'); paths.add(f.path); integer(f.bytes, 0);
    const data = reader.readFile(f.path); check(data.length === f.bytes && hash(data) === f.sha256, 'HASH_MISMATCH'); total += data.length; check(total <= STORE_LIMITS.totalBytes, 'CAPACITY'); }
  const s = new DomainStore(root, { workspaceId: m.workspaceId }), view = s.read(); check(equal(view.reference, m.head), 'HASH_MISMATCH');
  const required = new Set([...view.files.keys(), HEAD]); check(required.size === paths.size && [...required].every(x => paths.has(x)), 'INCOMPLETE_SNAPSHOT');
  check(stable(view.external) === stable(m.external), 'INCOMPLETE_SNAPSHOT'); return m;
}
export function restoreSnapshot(snapshotRoot, destination) {
  const manifest = verifySnapshot(snapshotRoot), source = new DomainStore(snapshotRoot); freshDestination(destination);
  const target = targetWriter(destination);
  for (const f of manifest.files.filter(x => x.path !== MARKER)) target.writeImmutable(f.path, source.readFile(f.path));
  target.writeImmutable(MARKER, source.readFile(MARKER));
  const restored = new DomainStore(destination, { workspaceId: manifest.workspaceId }).read(); check(equal(restored.reference, manifest.head), 'HASH_MISMATCH'); return restored;
}
