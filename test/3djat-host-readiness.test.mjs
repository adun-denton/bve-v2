import test from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { dirname } from 'node:path';
import { validate } from '../src/contracts/3djat.mjs';
import { dispatch, capabilities } from '../src/adapters.mjs';
import { installHost, installationStatus } from '../src/host-installation.mjs';
import { workspace } from './helpers.mjs';

// Authored receipts/identities only. Passing shapes are not genuine session attestations.
const U = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', H = 'a'.repeat(64);
const ref = id => ({ id, revision: 1, sha256: H, path: `Readiness/${id}/1.json` });
const role = (name, tier) => ({ role: name, requestedTier: tier, sessionId: `authored-${name}`,
  instructionHash: H, acknowledgement: ref(`${name}-ack`), modelEvidence: ref(`${name}-model`), resumeEvidence: ref(`${name}-resume`) });
const readiness = () => ({ schemaVersion: '3djat.readiness.v1', workspaceId: U, stage: 'pre-install',
  definitionEvidence: [ref('authored-definitions')], provisioning: 'pass',
  roles: [role('conductor', 'SOL'), role('butler', 'LUNA')], roundTrip: ref('authored-return'), workerCount: 0, imageCalls: 0, exception: null });
function rejected(value, code, field) {
  const result = validate('readiness', value);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(e => e.code === code && e.path.includes(field)), JSON.stringify(result.errors));
}

test('role definitions cannot satisfy the separate session-provisioning gate', () => {
  const value = readiness(); value.roles = []; value.roundTrip = null;
  rejected(value, 'EVIDENCE_MISMATCH', '/provisioning');
  value.provisioning = 'blocked'; assert.equal(validate('readiness', value).ok, true);
});
test('missing actual identity, instruction acknowledgement, model or resume reference rejects a pass declaration', () => {
  for (const field of ['sessionId', 'instructionHash', 'acknowledgement', 'modelEvidence', 'resumeEvidence']) {
    const value = readiness(); delete value.roles[1][field];
    assert.equal(validate('readiness', value).ok, false, field);
  }
  const value = readiness(); value.roundTrip = null; rejected(value, 'EVIDENCE_MISMATCH', '/provisioning');
});
test('role/tier mismatches, missing Butler and duplicate identities reject', () => {
  const tier = readiness(); tier.roles[1].requestedTier = 'SOL'; rejected(tier, 'INVALID_VALUE', '/roles/1/requestedTier');
  const roleName = readiness(); roleName.roles[1].role = 'worker'; rejected(roleName, 'INVALID_VALUE', '/roles/1/role');
  const duplicate = readiness(); duplicate.roles[1].sessionId = duplicate.roles[0].sessionId; rejected(duplicate, 'INVALID_VALUE', '/roles');
  const missing = readiness(); missing.roles.pop(); rejected(missing, 'EVIDENCE_MISMATCH', '/provisioning');
});
test('setup allows zero workers and zero images only', () => {
  assert.equal(validate('readiness', readiness()).ok, true);
  const workers = readiness(); workers.workerCount = 1; rejected(workers, 'INVALID_VALUE', '/workerCount');
  const images = readiness(); images.imageCalls = 1; rejected(images, 'INVALID_VALUE', '/imageCalls');
});
test('host exceptions require concrete dependency evidence and a separate approval reference', () => {
  const value = readiness(); value.roles = []; value.roundTrip = null;
  value.provisioning = 'exception-required';
  value.exception = { dependency: 'Authored host component dependency', observedFailure: ref('authored-failure'),
    alternatives: ['Authored alternative checked'], prerequisites: [ref('authored-prerequisite')],
    postInstallAction: 'Authored deferred activation', owner: 'Authored installer', acceptanceTest: 'Authored non-generation return', approvalReceipt: null };
  assert.equal(validate('readiness', value).ok, true); // Valid outstanding exception, not an approved gate.
  value.provisioning = 'exception-approved'; rejected(value, 'EVIDENCE_MISMATCH', '/exception/approvalReceipt');
  value.exception.approvalReceipt = ref('authored-approval'); assert.equal(validate('readiness', value).ok, true);
  delete value.exception.observedFailure; rejected(value, 'INVALID_TYPE', '/exception/observedFailure');
});
test('well-shaped authored references cannot authenticate sessions; extra native/verified flags reject', () => {
  const value = readiness(), before = structuredClone(value);
  assert.deepEqual(validate('readiness', value), { ok: true, errors: [] });
  assert.deepEqual(value, before); // This is deliberately fictional data accepted as shape only.
  value.roles[0].nativeVerified = true; rejected(value, 'UNKNOWN_FIELD', '/roles/0/nativeVerified');
});
test('advertised/documented-only native executor capability cannot dispatch or invoke an adapter', async () => {
  let invoked = 0;
  const kernel = new Proxy({}, { get() { throw Error('Documented capability must stop before kernel access'); } });
  for (const status of ['documented', 'unavailable', 'unverified']) {
    const result = await dispatch(kernel, {}, { capability: { status, originalBytes: true, formats: ['image/png'], paid: false },
      async execute() { invoked++; throw Error('Not permitted'); } }, ['authored-job']);
    assert.equal(result.gap, capabilities.nativeWorker.reason);
  }
  assert.equal(invoked, 0);
});
test('fixture discovery callbacks retain fixture classification; runtime-ready claims are not operational verification', async () => {
  const w = workspace();
  const claims = Object.fromEntries(['sessions', 'delegation', 'resume', 'userHandoff'].map(key =>
    [key, { status: 'tested', evidence: 'Authored callback only; no actual host/session' }]));
  claims.browser = { status: 'unavailable', evidence: 'Authored missing browser route' };
  claims.push = { status: 'unavailable', evidence: 'Authored manual return only' };
  let discovered = 0, created = 0;
  const driver = { id: 'authored-readiness-driver', kind: 'fixture', async discover() { discovered++; return claims; },
    async ensureSession() { created++; throw Error('Setup must not provision a worker or session here'); } };
  try {
    const fixture = await installHost({ kernel: w.k, owner: w.c, host: driver });
    assert.equal(fixture.status, 'fixture-verified'); assert.equal(fixture.kind, 'fixture');
    assert.equal(fixture.capabilities.browser.status, 'unavailable'); assert.equal(fixture.capabilities.push.status, 'unavailable');
    assert.equal(fixture.staffProvisionedByInstaller, 0); assert.equal(created, 0); assert.equal(discovered, 1);
    // Adversarial trusted-driver claims can yield only the source's runtime-ready status.
    // Neither those strings nor a successful callback authenticates an actual native host.
    driver.kind = 'native';
    const declared = await installHost({ kernel: w.k, owner: w.c, host: driver });
    assert.equal(declared.status, 'runtime-ready'); assert.notEqual(declared.status, 'operational');
    assert.equal(installationStatus(w.k, w.c).capabilities.push.status, 'unavailable');
    assert.equal(created, 0); assert.equal(w.k.hostBindings(w.c).length, 0);
    assert.equal(w.k.read(w.c.human, 'project').length, 0);
  } finally { w.k.close(); rmSync(dirname(w.root), { recursive: true, force: true }); }
});
