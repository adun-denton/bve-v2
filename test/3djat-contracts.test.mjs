import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validate, validateCommand, validateResolvedOperation, validateEvidence, COMMANDS, LIMITS, CONTRACT_SHAPES } from '../src/contracts/3djat.mjs';

// Entirely authored examples: no real products, sources, prices, sessions or hashes.
const fixture = name => JSON.parse(readFileSync(new URL(`./fixtures/3djat/${name}.json`, import.meta.url)));
const clone = x => structuredClone(x);
const U = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', V = 'bbbbbbbb-bbbb-4bbb-9bbb-bbbbbbbbbbbb';
const H = 'a'.repeat(64), NOW = '2026-01-01T00:00:00.000Z';
const R = (id = 'fixture-ref', revision = 1, sha256 = H) => ({ id, revision, sha256, path: `Revisions/${id}/${revision}.json` });
const source = () => ({ kind: 'file', sourceId: 'fixture-source', revision: 'r1', sha256: H,
  location: 'Sources/fixture.txt', locator: { kind: 'page', page: 1 }, observedAt: NOW });
const unknown = () => ({ state: 'unknown', value: null, sourceRefs: [], decision: null });
const accepted = value => ({ state: 'accepted', value, sourceRefs: [source()], decision: R('fixture-decision') });
const artifact = (artifactId = V) => ({ productId: U, artifactId, version: 1, sha256: H, width: 400, height: 300 });
const product = () => fixture('minimal-product');
const template = () => ({ schemaVersion: '3djat.template.v1', templateId: 'fixture-operation', revision: 1,
  title: 'Authored fixture operation', kind: 'operation', appliesTo: ['fixture-channel'], instructions: 'Preserve the authored object; explore the background.',
  inputs: [{ role: 'product-base', kind: 'verified-image', required: true }], allowedChanges: ['background'],
  outputs: [{ role: 'creative-candidate', format: 'image/png' }],
  exploration: { parameters: { breadth: { type: 'enum', values: ['focused', 'wide'] }, strength: { type: 'number', min: 0, max: 1 }, enabled: { type: 'boolean' } },
    presets: { focused: { breadth: 'focused', strength: 0.5, enabled: true } } }, sourceRefs: [], supersedes: null });
const proposal = () => ({ schemaVersion: '3djat.proposal.v1', proposalId: V, productId: U, expectedRevision: 1,
  changes: [{ field: 'material', fact: { state: 'accepted', value: 'Authored fixture material', sourceRefs: [source()] } }], reason: 'Authored extraction', corrects: null });
const decision = () => ({ schemaVersion: '3djat.template-decision.v1', decisionId: U, template: R('fixture-operation'),
  action: 'adopt', purpose: 'Authored fixture testing', appliesTo: ['fixture-channel'], expectedRevision: 1,
  experiment: null, outputs: [], evidenceReceipt: null, humanActionReceipt: R('fixture-human-action'),
  decidedAt: NOW, supersedesDecision: null, reason: 'Explicit authored untested adoption' });
function resolved() {
  const p = product(), t = template();
  const head = { schemaVersion: '3djat.domain-head.v1', workspaceId: V, revision: 1, previousHead: null,
    products: [{ productId: U, dossier: R(U) }], skus: [], business: null, templates: [R(t.templateId)], receipts: [R()] };
  const run = { schemaVersion: '3djat.operation-run.v1', runId: V, productId: U, domainHead: R(V), product: R(U), template: R(t.templateId),
    brand: null, branded: false, brandInstructions: null, applicability: 'fixture-channel', intent: 'Authored exploration request',
    direction: 'Fresh', selection: { breadth: 'focused', strength: 0.5, enabled: true }, preset: 'focused', acceptedFacts: clone(p.facts),
    sources: [{ artifact: artifact(), role: 'product-base', regions: [] }], attachments: [],
    requestedOutputs: [{ role: 'creative-candidate', count: 3 }], executionKind: 'generative', executorId: 'fixture-native-adapter',
    parentRoundId: null, parentArtifacts: [], allowance: { primaryAttempts: 3, maxRetries: 0 }, canonical: { direction: 'Fresh', brand: null, count: 3 } };
  return { run, context: { template: { reference: R(t.templateId), record: t }, product: { reference: R(U), record: p },
    head: { reference: R(V), record: head }, canonical: clone(run.canonical) } };
}
function calibration() {
  return { schemaVersion: '3djat.calibration.v1', experimentId: V, productId: U, revision: 1, lifecycle: 'completed',
    commonSources: [artifact()], commonIntent: 'Authored test request', commonSettings: { strength: 0.5 }, seed: null,
    executorId: 'fixture-adapter', executorVersion: 'fixture-1', changedDimension: 'Authored contrast instruction', uncontrolledVariables: ['Unknown fixture noise'],
    variants: [{ template: R('fixture-operation'), roundId: U, outcome: 'completed',
      outputs: [{ variant: R('fixture-operation'), artifact: artifact(), jobId: U, receipt: R('fixture-output') }], failureCode: null }], receipt: R('fixture-experiment-receipt') };
}
const visual = () => ({ schemaVersion: '3djat.visual-assessment.v1', assessmentId: U, template: R('fixture-operation'),
  status: 'untested', experiment: null, outputs: [], receipts: [] });
const imported = () => ({ schemaVersion: '3djat.historical-import.v1', importId: V, productId: U, origin: 'import', kind: 'historical-base',
  filename: 'authored-fixture.png', source: source(), sha256: H, encodedBytes: 100, format: 'image/png', width: 400, height: 300,
  bitDepth: 8, interlaced: false, historicalParent: null,
  historicalApproval: { origin: 'historical', claimedApprover: null, claimedAt: null, evidence: [source()] }, importedAt: NOW });
function ok(result) { assert.equal(result.ok, true, JSON.stringify(result.errors)); assert.deepEqual(result.errors, []); }
function fails(result, code, path) {
  assert.equal(result.ok, false, 'Expected rejection');
  assert.ok(result.errors.some(x => x.code === code && (!path || x.path.includes(path))), JSON.stringify(result.errors));
}
function mutate(kind, original, fn, code, path) { const v = clone(original); fn(v); fails(validate(kind, v), code, path); }
const command = (operation, input, entityRevision = 1) => ({ schemaVersion: '3djat.command.v1', operation, key: 'fixture-key',
  expected: { domainHead: R(V), entityRevision }, input });

test('two separately authored docs-based product fixtures validate without fixture exceptions', () => {
  ok(validate('product', fixture('minimal-product'))); ok(validate('product', fixture('source-backed-product')));
  assert.equal(fixture('source-backed-product').productCode, '0007');
});
test('minimal creation has no media, SKU, brief, staff or request prerequisite', () => {
  ok(validateCommand(command('product.create', { productId: U, productCode: null, workingName: 'Authored planter' }, 0)));
  mutate('product', product(), x => x.facts.material.value = 0, 'INVALID_VALUE');
  mutate('product', product(), x => x.facts.material.state = 'pending', 'INVALID_VALUE');
  const p = product(); p.facts.material = accepted('Fixture material');
  p.facts.dimensions = { state: 'not-applicable', value: null, sourceRefs: [], decision: R() }; ok(validate('product', p));
  p.facts.material.decision = null; fails(validate('product', p), 'INVALID_TYPE');
});
test('unknown numeric facts are null; zero price is a known explicit value, dimensions must be positive', () => {
  const p = product();
  p.facts.sellingPrice = accepted({ amount: '0', currency: 'IRR', unit: 'rial', per: 'item', effectiveDate: '2026-01-01' }); ok(validate('product', p));
  for (const [currency, unit] of [['IRT', 'toman'], ['USD', 'major']]) { p.facts.sellingPrice.value.currency = currency; p.facts.sellingPrice.value.unit = unit; ok(validate('product', p)); }
  p.facts.sellingPrice.value.unit = 'toman'; fails(validate('product', p), 'INVALID_VALUE', '/unit');
  p.facts.dimensions = accepted({ length: 0, width: 1, height: 1, unit: 'cm' }); fails(validate('product', p), 'OUT_OF_BOUNDS');
});
test('explicit contextual SKU and revision conflicts preserve identity and leading zeros', () => {
  const p = product(); p.productCode = '0007';
  ok(validate('product', p, { projectId: U, currentRevision: 1, skus: [{ productCode: '0007', productId: U }] }));
  fails(validate('product', p, { skus: [{ productCode: '0007', productId: V }] }), 'SKU_CONFLICT');
  fails(validate('proposal', proposal(), { currentRevision: 2 }), 'REVISION_CONFLICT');
  fails(validate('product', p, { projectId: V }), 'INVALID_SCOPE');
  mutate('product', p, x => x.productCode = 7, 'INVALID_TYPE');
});
test('schema, nested unknowns, malformed references and excessive bounds reject', () => {
  mutate('product', product(), x => x.schemaVersion = '3djat.product.v2', 'UNSUPPORTED_SCHEMA');
  mutate('product', product(), x => x.facts.material.approved = true, 'UNKNOWN_FIELD', '/facts/material/approved');
  mutate('product', product(), x => x.productId = 'z'.repeat(36), 'INVALID_REFERENCE');
  mutate('product', product(), x => x.sourceReceipt.sha256 = 'G'.repeat(64), 'INVALID_REFERENCE');
  mutate('product', product(), x => x.workingName = 'x'.repeat(201), 'OUT_OF_BOUNDS');
  mutate('product', product(), x => x.attachments = Array(257).fill(R()), 'VALIDATION_LIMIT');
  mutate('source-ref', source(), x => x.locator.page = 0, 'OUT_OF_BOUNDS');
  mutate('source-ref', source(), x => x.observedAt = '2026-02-30T00:00:00.000Z', 'INVALID_REFERENCE');
  ok(validate('source-ref', { kind: 'drive', sourceId: 'fixture-drive', revision: 'fixture-r1', sha256: H, fileId: 'fixture-drive-id',
    modifiedAt: NOW, locator: { kind: 'cells', sheet: 'Authored fixture', range: 'A1:C2' }, observedAt: NOW }));
  mutate('source-ref', source(), x => x.locator = { kind: 'cells', sheet: 'Fixture', range: 'A0:C2' }, 'INVALID_REFERENCE');
});
test('portable reference paths reject POSIX/Windows/encoded traversal and device paths', () => {
  for (const path of ['../x', '/x', 'C:/x', 'C:\\x', '\\\\server\\x', 'a//b', 'a/./b', 'a/../b', 'a/%2e%2e/x', 'a/x:stream', 'a/CON.txt', 'a/thing.', 'a/thing ', 'a/\u0000']) {
    fails(validate('revision-ref', { ...R(), path }), 'UNSAFE_PATH');
  }
  ok(validate('revision-ref', { ...R(), path: 'Products/نمونه/1.json' }));
});
test('proposal ingress rejects approval, arbitrary dossier updates and wrong typed units', () => {
  ok(validate('proposal', proposal()));
  for (const key of ['approved', 'actor', 'role', 'humanActionReceipt']) mutate('proposal', proposal(), x => x[key] = true, 'UNKNOWN_FIELD');
  mutate('proposal', proposal(), x => x.changes[0].field = 'facts.__proto__.approved', 'INVALID_VALUE');
  mutate('proposal', proposal(), x => x.changes[0] = { field: 'dimensions', fact: { state: 'accepted', value: { length: 1, width: 1, height: 1, unit: 'pixels' }, sourceRefs: [source()] } }, 'INVALID_VALUE');
  const p = proposal(); p.changes[0] = { field: 'sellingPrice', fact: { state: 'accepted', value: { amount: '12', currency: 'IRR', unit: 'toman', per: 'item', effectiveDate: '2026-01-01' }, sourceRefs: [source()] } };
  fails(validate('proposal', p), 'INVALID_VALUE');
});
test('field correction retains original proposal; stored decisions do not confer permission', () => {
  const original = proposal(), corrected = proposal(); corrected.proposalId = U; corrected.corrects = R(V);
  corrected.changes[0].fact.value = 'Corrected authored claim'; ok(validate('proposal', corrected));
  const d = { schemaVersion: '3djat.proposal-decision.v1', decisionId: U, productId: U, proposal: R(V), expectedRevision: 1,
    outcome: 'superseded', reason: 'Replaced with corrected proposal', decidedAt: NOW, humanActionReceipt: R(), supersedesDecision: null, correctedProposal: R(U) };
  const c = { proposal: { reference: R(V), record: original }, correctedProposal: { reference: R(U), record: corrected } };
  ok(validate('proposal-decision', d, c));
  const before = clone(original); c.correctedProposal.record.corrects = R('unrelated'); fails(validate('proposal-decision', d, c), 'EVIDENCE_MISMATCH');
  assert.deepEqual(original, before);
  ok(validate('proposal-decision', d)); // Shape only, not an authenticated decision.
  fails(validateCommand(command('product.proposal.decide', d), { authenticatedCaller: 'source-proposer' }), 'INVALID_SCOPE');
});
test('authoring, frozen envelopes and human decisions are distinct contracts', () => {
  ok(validate('template', template()));
  for (const key of ['tested', 'approved', 'shell', 'credentials', 'permissionEscalation', 'executor', 'budget']) mutate('template', template(), x => x[key] = true, 'UNKNOWN_FIELD');
  mutate('template', template(), x => x.exploration.parameters.strength.shell = 'fixture', 'UNKNOWN_FIELD');
  for (const key of ['shell', 'credentials', 'permission_escalation', 'provider', 'budget']) {
    mutate('template', template(), x => x.exploration.parameters[key] = { type: 'boolean' }, 'INVALID_VALUE');
  }
  fails(validate('operation-run', template()), 'UNKNOWN_FIELD');
  fails(validate('template', decision()), 'UNKNOWN_FIELD');
  const t = template(); t.instructions = 'Text mentioning shell, passwords or approval is data; it never executes.'; ok(validate('template', t));
});
test('template exploration presets check keys/types/ranges and permit operation-specific controls', () => {
  mutate('template', template(), x => x.exploration.presets.focused.strength = 'strong', 'INVALID_SELECTION');
  mutate('template', template(), x => x.exploration.presets.focused.unknown = 1, 'INVALID_SELECTION');
  mutate('template', template(), x => x.exploration.parameters.strength.min = 2, 'INVALID_SELECTION');
  mutate('template', template(), x => x.outputs = [], 'INVALID_VALUE');
  const b = template(); b.kind = 'brand'; b.outputs = []; b.exploration = undefined; delete b.exploration; ok(validate('template', b));
});
test('valid-but-blocked, adopted-but-untested and tested-but-unapproved are independent records', () => {
  const bundle = { schemaVersion: '3djat.template-assessments.v1', template: R('fixture-operation'),
    contract: { schemaVersion: '3djat.contract-assessment.v1', assessmentId: U, template: R('fixture-operation'), outcome: 'valid', validatorVersion: '3djat.v1', errorCodes: [], receipt: R() },
    operational: { schemaVersion: '3djat.operational-assessment.v1', assessmentId: V, template: R('fixture-operation'), run: R('fixture-run'), executorId: 'fixture-adapter',
      inputHashes: [H], outcome: 'blocked', blockers: ['CAPABILITY_UNAVAILABLE'], receipt: R() }, visual: visual(), human: decision() };
  ok(validate('template-assessments', bundle));
  bundle.human = null; bundle.visual = { ...visual(), status: 'tested', experiment: R('fixture-experiment'), outputs: [artifact()], receipts: [R('fixture-output')] };
  ok(validate('template-assessments', bundle, { experiment: { reference: R('fixture-experiment'), record: calibration() } }));
  bundle.template.revision = 2; fails(validate('template-assessments', bundle), 'EVIDENCE_MISMATCH');
});
test('resolved operation binds exact domain head/product/template and canonical request', () => {
  const { run, context } = resolved(); ok(validate('operation-run', run)); ok(validateResolvedOperation(run, context));
  fails(validateResolvedOperation(run), 'MISSING_CONTEXT');
  context.template.reference.sha256 = 'b'.repeat(64); fails(validateResolvedOperation(run, context), 'HASH_MISMATCH');
  const x = resolved(); x.context.product.record.facts.material = accepted('Changed fixture fact'); fails(validateResolvedOperation(x.run, x.context), 'EVIDENCE_MISMATCH');
  const y = resolved(); y.context.canonical.direction = 'Follow'; fails(validateResolvedOperation(y.run, y.context), 'INVALID_SCOPE');
});
test('unknown exploration values/preset changes/missing sources and output roles fail', () => {
  for (const [mutateRun, code] of [
    [r => r.selection.unknown = 'wide', 'INVALID_SELECTION'], [r => r.selection.strength = '0.5', 'INVALID_SELECTION'],
    [r => r.selection.strength = 2, 'INVALID_SELECTION'], [r => r.preset = 'missing', 'INVALID_SELECTION'],
    [r => r.selection.breadth = 'wide', 'INVALID_SELECTION'], [r => r.sources = [], 'MISSING_SOURCE'],
    [r => r.requestedOutputs[0].role = 'unknown', 'INVALID_SCOPE']]) {
    const { run, context } = resolved(); mutateRun(run); fails(validateResolvedOperation(run, context), code);
  }
});
test('explicit unbranded choice differs from missing Brand/default branded request', () => {
  const { run, context } = resolved(); ok(validateResolvedOperation(run, context));
  delete run.brand; fails(validate('operation-run', run), 'INVALID_TYPE');
  run.brand = null; run.branded = true; fails(validate('operation-run', run), 'BRAND_SETUP_NEEDED');
  const b = template(); b.templateId = 'fixture-brand'; b.kind = 'brand'; b.outputs = [];
  run.brand = R('fixture-brand'); run.brandInstructions = b.instructions; run.canonical.brand = b.instructions;
  context.canonical.brand = b.instructions; fails(validateResolvedOperation(run, context), 'BRAND_SETUP_NEEDED');
  const d = decision(); d.template = R('fixture-brand');
  context.brand = { reference: R('fixture-brand'), record: b, decision: d }; context.head.record.templates.push(R('fixture-brand'));
  ok(validateResolvedOperation(run, context));
  context.brand.decision.template.revision = 2; fails(validateResolvedOperation(run, context), 'EVIDENCE_MISMATCH');
});
test('Fresh/Follow independent Brand, regions, counts and once-only allowance remain bounded', () => {
  const { run } = resolved();
  mutate('operation-run', run, x => x.direction = 'Follow', 'INVALID_SCOPE');
  run.direction = 'Follow'; run.canonical.direction = 'Follow'; ok(validate('operation-run', run));
  for (const count of [1, 6]) { run.requestedOutputs[0].count = count; run.allowance.primaryAttempts = count; run.canonical.count = count; ok(validate('operation-run', run)); }
  mutate('operation-run', run, x => x.requestedOutputs[0].count = 7, 'OUT_OF_BOUNDS');
  mutate('operation-run', run, x => x.allowance.primaryAttempts = 1, 'OUTPUT_COUNT');
  mutate('operation-run', run, x => x.allowance.maxRetries = 1, 'INVALID_VALUE');
  mutate('operation-run', run, x => x.sources[0].regions = [{ space: 'normalized-original', x: .9, y: 0, w: .2, h: .2, meaning: 'Authored region' }], 'OUT_OF_BOUNDS');
  mutate('operation-run', run, x => x.sources[0].artifact.productId = V, 'INVALID_SCOPE');
  mutate('operation-run', run, x => x.sources.push(clone(x.sources[0])), 'INVALID_VALUE');
});
test('channel outputs account independently; deterministic service is not an AI worker', () => {
  const { run, context } = resolved(); run.executionKind = 'deterministic'; run.executorId = 'fixture-editor'; run.preset = null; run.selection = {};
  run.requestedOutputs = [{ role: 'feed', count: 1 }, { role: 'story', count: 1 }]; run.canonical.count = 2; context.canonical.count = 2; run.allowance.primaryAttempts = 2;
  context.template.record.outputs = [{ role: 'feed', format: 'image/png' }, { role: 'story', format: 'image/png' }];
  ok(validateResolvedOperation(run, context));
});
test('historical import has no synthetic generation job and no fresh acceptance', () => {
  ok(validate('historical-import', imported()));
  mutate('historical-import', imported(), x => x.jobId = U, 'UNKNOWN_FIELD');
  mutate('historical-import', imported(), x => x.historicalApproval.origin = 'design.accept', 'INVALID_VALUE');
  fails(validate('candidate-decision', imported()), 'UNKNOWN_FIELD');
  fails(validateCommand(command('design.accept', imported())), 'INVALID_VALUE');
  ok(validate('artifact-origin', { schemaVersion: '3djat.artifact-origin.v1', artifact: artifact(), provenance: { origin: 'import', importRecord: R() } }));
});
test('PNG limits remain 16MP/24MiB/8-bit/non-interlaced; 20MP is only proposed', () => {
  assert.equal(LIMITS.pngPixels, 16_000_000); assert.equal(LIMITS.proposedPngPixels, 20_000_000);
  const i = imported(); i.width = 4000; i.height = 4000; i.encodedBytes = 24 * 1024 ** 2; ok(validate('historical-import', i));
  i.height = 4001; fails(validate('historical-import', i), 'UNSUPPORTED_IMAGE');
  mutate('historical-import', imported(), x => { x.width = 4946; x.height = 3278; }, 'UNSUPPORTED_IMAGE');
  mutate('historical-import', imported(), x => x.encodedBytes = 24 * 1024 ** 2 + 1, 'OUT_OF_BOUNDS');
  mutate('historical-import', imported(), x => x.bitDepth = 16, 'INVALID_VALUE');
  mutate('historical-import', imported(), x => x.interlaced = true, 'INVALID_VALUE');
});
test('attachments are bounded declarations, never verified image artifacts', () => {
  const a = { schemaVersion: '3djat.attachment.v1', attachmentId: V, productId: U, sha256: H, location: 'Sources/fixture.stl', filename: 'fixture.stl',
    mime: 'model/stl', bytes: 256 * 1024 ** 2, availability: 'unverified', source: source() };
  ok(validate('attachment', a)); mutate('attachment', a, x => x.bytes++, 'OUT_OF_BOUNDS');
  fails(validate('artifact-ref', a), 'UNKNOWN_FIELD');
  mutate('attachment', a, x => x.source.sha256 = 'b'.repeat(64), 'HASH_MISMATCH');
});
test('calibration outputs bind exact variants and unavailable/failed outcomes cannot prove tested success', () => {
  const e = calibration(); ok(validate('calibration', e));
  mutate('calibration', e, x => x.variants[0].outputs[0].variant.revision = 2, 'EVIDENCE_MISMATCH');
  mutate('calibration', e, x => x.variants[0].outcome = 'failed', 'EVIDENCE_MISMATCH');
  const v = { ...visual(), status: 'tested', experiment: R('fixture-experiment'), outputs: [artifact()], receipts: [R('fixture-output')] };
  const c = { experiment: { reference: R('fixture-experiment'), record: e } }; ok(validate('visual-assessment', v, c));
  e.lifecycle = 'blocked'; e.variants[0].outcome = 'blocked'; e.variants[0].outputs = []; e.variants[0].failureCode = 'CAPABILITY_UNAVAILABLE';
  ok(validate('calibration', e)); fails(validate('visual-assessment', v, c), 'EVIDENCE_MISMATCH');
  const p = clone(v); p.template.sha256 = 'b'.repeat(64); fails(validate('visual-assessment', p, c), 'EVIDENCE_MISMATCH');
});
test('partial calibration and scoped promotion require actual matching receipt references', () => {
  const e = calibration(), c = { experiment: { reference: R('fixture-experiment'), record: e } };
  const d = decision(); d.action = 'promote'; d.experiment = R('fixture-experiment'); d.outputs = [artifact()]; d.evidenceReceipt = e.receipt;
  ok(validate('template-decision', d, c));
  mutate('template-decision', d, x => x.purpose = '', 'OUT_OF_BOUNDS');
  mutate('template-decision', d, x => x.appliesTo = [], 'OUT_OF_BOUNDS');
  const wrong = clone(d); wrong.evidenceReceipt = R('wrong-receipt'); fails(validate('template-decision', wrong, c), 'EVIDENCE_MISMATCH');
  e.lifecycle = 'partial'; e.variants[0].outcome = 'partial'; fails(validate('template-decision', d, c), 'EVIDENCE_MISMATCH');
  const v = { ...visual(), status: 'partial', experiment: R('fixture-experiment'), outputs: [artifact()], receipts: [R('fixture-output')] }; ok(validate('visual-assessment', v, c));
});
test('candidate decisions append scoped purposes and supersession without replacing legacy acceptance', () => {
  const d = { schemaVersion: '3djat.candidate-decision.v1', decisionId: U, productId: U, artifact: artifact(), action: 'approve-output',
    purpose: 'Authored fixture channel review', channel: 'fixture-channel', reason: 'Authored reason', decidedAt: NOW, humanActionReceipt: R(), supersedesDecision: R('old-decision') };
  ok(validate('candidate-decision', d)); mutate('candidate-decision', d, x => x.channel = null, 'INVALID_VALUE');
  for (const action of ['retain', 'reject', 'accept-for-editing']) { d.action = action; d.channel = null; ok(validate('candidate-decision', d)); }
  assert.equal(COMMANDS['design.accept'], undefined);
});
test('domain head binds dossier/SKU indexes and exact previous revision', () => {
  const { context } = resolved(), h = context.head.record; ok(validate('domain-head', h));
  mutate('domain-head', h, x => x.skus = [{ productCode: '0001', productId: V }], 'INVALID_REFERENCE');
  mutate('domain-head', h, x => x.products.push(clone(x.products[0])), 'INVALID_VALUE');
  mutate('domain-head', h, x => x.revision = 2, 'REVISION_CONFLICT');
  mutate('domain-head', h, x => x.products[0].dossier.id = V, 'INVALID_REFERENCE');
});
test('all 18 proposed commands have bounded input/output and exact owner/caller metadata', () => {
  assert.equal(Object.keys(COMMANDS).length, 18);
  for (const [op, d] of Object.entries(COMMANDS)) {
    assert.ok(CONTRACT_SHAPES[d.output]); assert.ok(d.callers.length); assert.ok(['domain', 'operational'].includes(d.owner));
    fails(validateCommand(command(op, { arbitraryUpdate: true })), 'UNKNOWN_FIELD');
  }
  const p = command('product.proposal.submit', proposal()); ok(validateCommand(p, { authenticatedCaller: 'source-proposer', currentHead: R(V), currentRevision: 1 }));
  fails(validateCommand(p, { currentHead: R(V, 2) }), 'REVISION_CONFLICT');
  const d = decision(); fails(validateCommand(command('template.promote', d)), 'INVALID_SCOPE');
  const e = calibration(); fails(validateCommand(command('calibration.create', e)), 'INVALID_SCOPE');
});
test('malformed optional contextual data returns structured errors rather than throwing', () => {
  fails(validate('visual-assessment', visual(), { experiment: {} }), 'INVALID_TYPE');
  fails(validate('product', product(), { arbitraryRole: 'human' }), 'UNKNOWN_FIELD');
});
test('readiness definitions cannot stand in for actual session evidence or exception approval', () => {
  const r = { schemaVersion: '3djat.readiness.v1', workspaceId: V, stage: 'pre-install', definitionEvidence: [R()], provisioning: 'pass',
    roles: [], roundTrip: null, workerCount: 0, imageCalls: 0, exception: null };
  fails(validate('readiness', r), 'EVIDENCE_MISMATCH');
  r.provisioning = 'blocked'; ok(validate('readiness', r));
  r.provisioning = 'exception-approved'; fails(validate('readiness', r), 'EVIDENCE_MISMATCH');
  r.exception = { dependency: 'Authored host dependency', observedFailure: R(), alternatives: ['Authored alternative'], prerequisites: [R()], postInstallAction: 'Authored activation',
    owner: 'Fixture operator', acceptanceTest: 'Authored non-generation round trip', approvalReceipt: null };
  fails(validate('readiness', r), 'EVIDENCE_MISMATCH'); r.provisioning = 'exception-required'; ok(validate('readiness', r));
  r.exception.approvalReceipt = R('explicit-exception'); r.provisioning = 'exception-approved'; ok(validate('readiness', r));
  mutate('readiness', r, x => x.workerCount = 1, 'INVALID_VALUE');
});
test('pure validators preserve caller inputs and reject nonportable/accessor/cyclic values without executing getters', () => {
  const { run, context } = resolved(), before = clone({ run, context });
  function deepFreeze(v) { if (v && typeof v === 'object') { Object.values(v).forEach(deepFreeze); Object.freeze(v); } }
  deepFreeze(run); deepFreeze(context); ok(validateResolvedOperation(run, context)); assert.deepEqual({ run, context }, before);
  const p = product(); Object.defineProperty(p, 'trap', { enumerable: true, get() { throw new Error('Must not run'); } }); fails(validate('product', p), 'NON_PORTABLE');
  const cycle = {}; cycle.self = cycle; fails(validate('product', cycle), 'NON_PORTABLE');
  const bigint = product(); bigint.revision = 1n; fails(validate('product', bigint), 'NON_PORTABLE');
  const bad = product(); bad.facts.material.value = NaN; fails(validate('product', bad), 'NON_PORTABLE');
  const nested = product(); let n = nested; for (let i = 0; i < 60; i++) n = n.next = {}; fails(validate('product', nested), 'VALIDATION_LIMIT');
});
test('errors are stable, bounded and portable; handoffs cannot transport credentials', () => {
  const p = product(); p.sourceReceipt.path = '../unsafe'; const a = validate('product', p); assert.deepEqual(validate('product', p), a);
  ok(validate('error', a.errors[0])); fails(validate('unknown-kind', {}), 'UNKNOWN_CONTRACT');
  const h = { schemaVersion: '3djat.handoff.v1', workspaceId: V, target: 'domain-writer', command: command('product.proposal.submit', proposal()), references: [R()], expiresAt: NOW };
  ok(validate('handoff', h)); mutate('handoff', h, x => x.command.credential = 'fixture-never-real', 'UNKNOWN_FIELD');
  const f = { schemaVersion: '3djat.failure.v1', operation: 'product.read', key: 'fixture-key', error: a.errors[0] }; ok(validate('failure', f));
});
test('evidence gate requires resolved evidence, without confusing shape validation with authentication', () => {
  const v = { ...visual(), status: 'tested', experiment: R('fixture-experiment'), outputs: [artifact()], receipts: [R('fixture-output')] };
  ok(validate('visual-assessment', v)); fails(validateEvidence('visual-assessment', v), 'MISSING_CONTEXT');
  ok(validateEvidence('visual-assessment', v, { experiment: { reference: R('fixture-experiment'), record: calibration() } }));
  fails(validateEvidence('template-decision', decision()), 'MISSING_CONTEXT');
  ok(validateEvidence('template-decision', decision(), { template: { reference: R('fixture-operation'), record: template() } }));
});
test('positive command matrix is executable and result references retain the command-specific owner/type', () => {
  const w = { schemaVersion: '3djat.workspace.v1', workspaceId: V, revision: 1, domainHead: R(V),
    paths: { business: 'Business', products: 'Products', templates: 'Templates', operations: 'Operations' }, contractVersion: '3djat.v1', sourceCommit: 'a'.repeat(40) };
  const d = { schemaVersion: '3djat.proposal-decision.v1', decisionId: U, productId: U, proposal: R('fixture-proposal'), expectedRevision: 1,
    outcome: 'accepted', reason: 'Authored human decision', decidedAt: NOW, humanActionReceipt: R(), supersedesDecision: null, correctedProposal: null };
  const a = { schemaVersion: '3djat.attachment.v1', attachmentId: V, productId: U, sha256: H, location: 'Sources/fixture.stl', filename: 'fixture.stl',
    mime: 'model/stl', bytes: 100, availability: 'unverified', source: source() };
  const e = calibration(); e.lifecycle = 'draft'; e.receipt = null; e.variants[0].outcome = 'draft'; e.variants[0].outputs = []; e.variants[0].roundId = null;
  const promote = decision(); promote.action = 'promote'; promote.experiment = R(); promote.outputs = [artifact()]; promote.evidenceReceipt = R();
  const candidate = { schemaVersion: '3djat.candidate-decision.v1', decisionId: U, productId: U, artifact: artifact(), action: 'retain',
    purpose: 'Authored retention', channel: null, reason: 'Authored reason', decidedAt: NOW, humanActionReceipt: R(), supersedesDecision: null };
  const inputs = {
    'product.create': { productId: U, productCode: null, workingName: 'Authored fixture' }, 'product.read': { productId: U, atHead: R(V) },
    'product.proposal.submit': proposal(), 'product.proposal.decide': d, 'product.note.add': { productId: U, text: 'Authored note' },
    'template.ingest': template(), 'template.adopt': decision(), 'operation.request': resolved().run, 'operation.commission': resolved().run,
    'asset.import.stage': imported(), 'asset.import.commit': { importId: V, stageReceipt: R(), sha256: H }, 'attachment.register': a,
    'calibration.create': e, 'calibration.review': { schemaVersion: '3djat.calibration-review.v1', reviewId: U, experiment: R(), comments: 'Authored review', selectedVariants: [], humanActionReceipt: R(), reviewedAt: NOW },
    'template.promote': promote, 'candidate.decide': candidate, 'workspace.adopt': w,
    'workspace.export': { workspaceId: V, head: R(V), includeAttachments: true }
  };
  // Independent command examples: current CAS subject revisions, not child/snapshot revisions.
  const currentRevisions = {
    'product.create': 0, 'product.read': 1, 'product.proposal.submit': 1, 'product.proposal.decide': 1, 'product.note.add': 1,
    'template.ingest': 0, 'template.adopt': 1, 'operation.request': 0, 'operation.commission': 4,
    'asset.import.stage': 0, 'asset.import.commit': 2, 'attachment.register': 0, 'calibration.create': 0,
    'calibration.review': 1, 'template.promote': 1, 'candidate.decide': 0, 'workspace.adopt': 0, 'workspace.export': 1
  };
  assert.deepEqual(Object.keys(inputs).sort(), Object.keys(COMMANDS).sort());
  for (const [operation, input] of Object.entries(inputs)) {
    const packet = command(operation, input, currentRevisions[operation]);
    const context = { authenticatedCaller: COMMANDS[operation].callers[0], currentRevision: currentRevisions[operation], currentHead: R(V), projectId: U };
    if (operation === 'workspace.adopt') { packet.expected.domainHead = null; context.currentHead = null; }
    ok(validateCommand(packet, context));
    fails(validateCommand(packet, { ...context, currentRevision: currentRevisions[operation] + 1 }), 'REVISION_CONFLICT', '/expected/entityRevision');
    fails(validateCommand(packet, { ...context, currentHead: R(V, 2) }), 'REVISION_CONFLICT', '/expected/domainHead');
    fails(validateCommand(packet, { ...context, authenticatedCaller: 'worker' }), 'INVALID_SCOPE');
    if (input.productId !== undefined) fails(validateCommand(packet, { ...context, projectId: V }), 'INVALID_SCOPE', '/input/productId');
    const result = { schemaVersion: '3djat.result.v1', operation, key: 'fixture-key', receipt: R(), owner: COMMANDS[operation].owner, committedRevision: 1,
      outputType: COMMANDS[operation].output, reference: R() };
    ok(validate('result', result)); result.outputType = 'invalid'; fails(validate('result', result), 'INVALID_VALUE');
  }
});
test('R1: template creation and advancement distinguish proposed revision from expected lineage', () => {
  const c = { authenticatedCaller: 'human', currentRevision: 0, currentHead: R(V) };
  const first = command('template.ingest', template(), 0); ok(validateCommand(first, c));
  first.input.revision = 2; fails(validateCommand(first, c), 'REVISION_CONFLICT', '/input/revision');
  first.input.revision = 1; first.input.supersedes = R('fixture-operation'); fails(validateCommand(first, c), 'REVISION_CONFLICT', '/input/supersedes');
  const next = command('template.ingest', { ...template(), revision: 2, supersedes: R('fixture-operation') }, 1);
  c.currentRevision = 1; c.template = { reference: R('fixture-operation'), record: template() }; ok(validateCommand(next, c));
  for (const revision of [1, 3]) { const bad = clone(next); bad.input.revision = revision; fails(validateCommand(bad, c), 'REVISION_CONFLICT', '/input/revision'); }
  const missing = clone(next); missing.input.supersedes = null; fails(validateCommand(missing, c), 'REVISION_CONFLICT', '/input/supersedes');
  const drift = clone(next); drift.input.supersedes.sha256 = 'b'.repeat(64); fails(validateCommand(drift, c), 'EVIDENCE_MISMATCH');
  const unrelated = clone(c); unrelated.template.record.templateId = 'another-template'; fails(validateCommand(next, unrelated), 'EVIDENCE_MISMATCH');
  ok(validate('template', next.input, { currentRevision: 2 })); // Reading stored revision 2, not proposing it.
  fails(validate('template', next.input, { currentRevision: 1 }), 'REVISION_CONFLICT', '/revision');
});
test('R1: first workspace adoption has explicitly absent head; proposed mapping revisions advance exactly once', () => {
  const w = { schemaVersion: '3djat.workspace.v1', workspaceId: V, revision: 1, domainHead: R(V),
    paths: { business: 'Business', products: 'Products', templates: 'Templates', operations: 'Operations' }, contractVersion: '3djat.v1', sourceCommit: 'a'.repeat(40) };
  const p = command('workspace.adopt', w, 0); p.expected.domainHead = null;
  const c = { authenticatedCaller: 'human', currentRevision: 0, currentHead: null }; ok(validateCommand(p, c));
  // Legacy authoring/inspection callers may omit context; mutation integrations must provide it.
  ok(validateCommand(p, { authenticatedCaller: 'human', currentRevision: 0 }));
  const invalid = clone(p); invalid.input.revision = 2; fails(validateCommand(invalid, c), 'REVISION_CONFLICT');
  fails(validateCommand(p, { ...c, currentHead: R(V) }), 'REVISION_CONFLICT', '/expected/domainHead');
  p.expected.domainHead = R(V); p.expected.entityRevision = 1; p.input.revision = 2;
  ok(validateCommand(p, { authenticatedCaller: 'human', currentRevision: 1, currentHead: R(V) }));
  p.expected.domainHead = null; fails(validateCommand(p, { authenticatedCaller: 'human', currentRevision: 1, currentHead: null }), 'INVALID_SCOPE');
});
test('R1: calibration creation requires absent experiment 0 and draft revision 1, not product or template revision', () => {
  const e = calibration(); e.revision = 1; e.lifecycle = 'draft'; e.receipt = null;
  e.variants[0].outcome = 'draft'; e.variants[0].roundId = null; e.variants[0].outputs = [];
  e.variants[0].template.revision = 9; e.commonSources[0].version = 7;
  const p = command('calibration.create', e, 0), c = { authenticatedCaller: 'human', currentRevision: 0, currentHead: R(V), projectId: U };
  ok(validateCommand(p, c));
  const bad = clone(p); bad.input.revision = 2; fails(validateCommand(bad, c), 'REVISION_CONFLICT', '/input/revision');
  bad.expected.entityRevision = 1; fails(validateCommand(bad, { ...c, currentRevision: 1 }), 'REVISION_CONFLICT', '/expected/entityRevision');
  bad.input.lifecycle = 'running'; fails(validateCommand(bad, c), 'INVALID_SCOPE');
});
test('R1: adoption pointer and candidate decision stream start at zero and do not use selected template/artifact versions', () => {
  const d = decision(); d.expectedRevision = 0; d.template.revision = 8;
  const c = { authenticatedCaller: 'human', currentHead: R(V), currentRevision: 0 };
  ok(validateCommand(command('template.adopt', d, 0), c));
  d.expectedRevision = 5; ok(validateCommand(command('template.adopt', d, 5), { ...c, currentRevision: 5 }));
  fails(validateCommand(command('template.adopt', d, 4), { ...c, currentRevision: 4 }), 'REVISION_CONFLICT', '/input/expectedRevision');
  const candidate = { schemaVersion: '3djat.candidate-decision.v1', decisionId: U, productId: U, artifact: { ...artifact(), version: 8 }, action: 'retain',
    purpose: 'Authored retention', channel: null, reason: 'Authored reason', decidedAt: NOW, humanActionReceipt: R(), supersedesDecision: null };
  ok(validateCommand(command('candidate.decide', candidate, 0), c));
  fails(validateCommand(command('candidate.decide', candidate, 1), { ...c, currentRevision: 1 }), 'REVISION_CONFLICT', '/input/supersedesDecision');
  candidate.supersedesDecision = R('prior-decision'); ok(validateCommand(command('candidate.decide', candidate, 5), { ...c, currentRevision: 5 }));
  fails(validateCommand(command('candidate.decide', candidate, 0), c), 'REVISION_CONFLICT', '/input/supersedesDecision');
});
test('R1: exact read/export heads and calibration review experiment revisions match the explicit CAS subject', () => {
  const c = { authenticatedCaller: 'human', currentHead: R(V), currentRevision: 1 };
  const read = command('product.read', { productId: U, atHead: R(V) }); ok(validateCommand(read, c));
  read.input.atHead.sha256 = 'b'.repeat(64); fails(validateCommand(read, c), 'REVISION_CONFLICT', '/input/atHead');
  const exp = command('workspace.export', { workspaceId: V, head: R(V), includeAttachments: true }); ok(validateCommand(exp, c));
  exp.input.head.revision = 2; fails(validateCommand(exp, c), 'REVISION_CONFLICT');
  const review = command('calibration.review', { schemaVersion: '3djat.calibration-review.v1', reviewId: U, experiment: R(V), comments: 'Authored review', selectedVariants: [], humanActionReceipt: R(), reviewedAt: NOW });
  ok(validateCommand(review, { ...c, experiment: { reference: R(V), record: calibration() } }));
  review.input.experiment.revision = 2; fails(validateCommand(review, c), 'REVISION_CONFLICT', '/input/experiment/revision');
});
test('R2: execution costs keep their closed telemetry shape for null, zero and positive values in every supported currency', () => {
  const r = { schemaVersion: '3djat.execution-result.v1', runId: U, productId: U, roundId: U, jobId: U, assignmentId: V,
    outputRole: 'fixture-output', outcome: 'succeeded', executorKind: 'service', executorId: 'fixture-editor', artifact: artifact(), receipt: R(),
    recipeHash: H, parameters: { opacity: 0.5 }, tool: 'Authored editor', model: null, version: 'fixture-1', startedAt: NOW, finishedAt: NOW,
    cost: null, usage: null, exitCode: 0, failureCode: null };
  ok(validate('execution-result', r));
  for (const currency of ['USD', 'EUR', 'IRR', 'IRT']) {
    for (const amount of ['0', '0.00', '1', '12.345678']) {
      r.cost = { amount, currency }; ok(validate('execution-result', r));
    }
    r.cost = { amount: '1', currency, unit: currency === 'IRR' ? 'rial' : currency === 'IRT' ? 'toman' : 'major' };
    fails(validate('execution-result', r), 'UNKNOWN_FIELD', '/cost/unit');
  }
  for (const amount of [0, '', '-1', '1e2', '01', 'NaN', '1.1234567', '10000000000000000']) {
    r.cost = { amount, currency: 'USD' }; assert.equal(validate('execution-result', r).ok, false, `Malformed cost: ${amount}`);
  }
  r.cost = { amount: '1', currency: 'GBP' }; fails(validate('execution-result', r), 'INVALID_VALUE', '/cost/currency');
  r.cost = null; ok(validate('execution-result', r));
  mutate('execution-result', r, x => x.artifact = null, 'EVIDENCE_MISMATCH');
  r.outcome = 'uncertain'; r.artifact = null; r.finishedAt = null; r.exitCode = null; ok(validate('execution-result', r));
  r.outcome = 'failed'; fails(validate('execution-result', r), 'INVALID_VALUE'); r.failureCode = 'CAPABILITY_UNAVAILABLE'; ok(validate('execution-result', r));
});
test('R2: direct and nested product prices still require type-specific currency/unit agreement', () => {
  for (const [currency, unit] of [['IRR', 'rial'], ['IRT', 'toman'], ['USD', 'major'], ['EUR', 'major'], ['GBP', 'major'], ['AED', 'major']]) {
    const price = { amount: '12.25', currency, unit, per: 'item', effectiveDate: '2026-01-01' };
    ok(validate('price', price));
    const p = product(); p.facts.sellingPrice = accepted(price); ok(validate('product', p));
    const change = proposal(); change.changes[0] = { field: 'sellingPrice', fact: { state: 'accepted', value: price, sourceRefs: [source()] } };
    ok(validate('proposal', change));
    price.unit = unit === 'major' ? 'rial' : 'major';
    fails(validate('price', price), 'INVALID_VALUE', '/unit');
    fails(validate('product', p), 'INVALID_VALUE', '/facts/sellingPrice/value/unit');
    fails(validateCommand(command('product.proposal.submit', change), { authenticatedCaller: 'source-proposer', currentHead: R(V), currentRevision: 1 }), 'INVALID_VALUE', '/unit');
  }
});

// C1: immutable authoring revisions differ from the dossier revision protected by
// a current human decision. Authored contexts below establish no real approval.
const C1_CORRECTION = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const C1_OTHER = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
function proposalDecision({originalRevision=1,currentRevision=2,outcome='superseded',correction=true}={}) {
  const original=proposal();original.expectedRevision=originalRevision;
  const corrected={...clone(original),proposalId:C1_CORRECTION,expectedRevision:currentRevision,corrects:R(V)};
  const d={schemaVersion:'3djat.proposal-decision.v1',decisionId:C1_OTHER,productId:U,proposal:R(V),expectedRevision:currentRevision,
    outcome,reason:'Authored contextual decision only',decidedAt:NOW,humanActionReceipt:R('authored-action'),supersedesDecision:null,correctedProposal:correction?R(C1_CORRECTION):null};
  return {packet:command('product.proposal.decide',d,currentRevision),context:{authenticatedCaller:'human',currentHead:R(V),currentRevision,projectId:U,
    proposal:{reference:R(V),record:original},...(correction?{correctedProposal:{reference:R(C1_CORRECTION),record:corrected}}:{})}};
}
for(const originalRevision of [1,2,3])for(const [label,outcome,correction] of [
  ['accept','accepted',false],['reject','rejected',false],['correct','superseded',true],['supersede without correction','superseded',false]
])test(`C1 outcome matrix: ${label}, original ${originalRevision}, current 2`,()=>{
  const {packet,context}=proposalDecision({originalRevision,outcome,correction});
  const before=clone({packet,context}),result=validateCommand(packet,context);
  if(originalRevision===2||originalRevision===1&&['reject','correct'].includes(label))ok(result);
  else fails(result,'REVISION_CONFLICT','/context/proposal/record/expectedRevision');
  assert.deepEqual({packet,context},before);
});
test('C1 same-revision correction and separate corrected acceptance retain the originals',()=>{
  const {packet,context}=proposalDecision({currentRevision:1});ok(validateCommand(packet,context));
  const next=proposalDecision();next.packet.input.outcome='accepted';next.packet.input.proposal=next.context.correctedProposal.reference;
  next.packet.input.correctedProposal=null;next.context.proposal=next.context.correctedProposal;delete next.context.correctedProposal;
  ok(validateCommand(next.packet,next.context));
});
const correctionNegatives=[
  ['stale correction',({context})=>{context.correctedProposal.record.expectedRevision=1;},'REVISION_CONFLICT','/context/correctedProposal/record/expectedRevision'],
  ['future correction',({context})=>{context.correctedProposal.record.expectedRevision=3;},'REVISION_CONFLICT','/context/correctedProposal/record/expectedRevision'],
  ['missing correction context',x=>{delete x.context.correctedProposal;},'MISSING_CONTEXT','/context/correctedProposal'],
  ['foreign correction product',({context})=>{context.correctedProposal.record.productId=V;},'EVIDENCE_MISMATCH','/context/correctedProposal/record/productId'],
  ['foreign original product',({context})=>{context.proposal.record.productId=V;},'EVIDENCE_MISMATCH','/context/proposal/record/productId'],
  ['wrong original ref hash',({packet})=>{packet.input.proposal.sha256='b'.repeat(64);},'EVIDENCE_MISMATCH','/input/proposal'],
  ['wrong original ref path',({packet})=>{packet.input.proposal.path='Revisions/other/1.json';},'EVIDENCE_MISMATCH','/input/proposal'],
  ['wrong original ref revision',({packet})=>{packet.input.proposal.revision=2;},'EVIDENCE_MISMATCH','/input/proposal'],
  ['original ref and record disagree',({context})=>{context.proposal.record.proposalId=C1_OTHER;},'EVIDENCE_MISMATCH','/context/proposal/reference/id'],
  ['original matching refs hide wrong record ID',({packet,context})=>{packet.input.proposal.id=C1_OTHER;context.proposal.reference.id=C1_OTHER;context.correctedProposal.record.corrects.id=C1_OTHER;},'EVIDENCE_MISMATCH','/context/proposal/reference/id'],
  ['wrong correction ref hash',({packet})=>{packet.input.correctedProposal.sha256='b'.repeat(64);},'EVIDENCE_MISMATCH','/input/correctedProposal'],
  ['wrong correction ref revision',({packet})=>{packet.input.correctedProposal.revision=2;},'EVIDENCE_MISMATCH','/input/correctedProposal'],
  ['correction ref and record disagree',({context})=>{context.correctedProposal.record.proposalId=C1_OTHER;},'EVIDENCE_MISMATCH','/context/correctedProposal/reference/id'],
  ['correction matching refs hide wrong record ID',({packet,context})=>{packet.input.correctedProposal.id=C1_OTHER;context.correctedProposal.reference.id=C1_OTHER;},'EVIDENCE_MISMATCH','/context/correctedProposal/reference/id'],
  ['wrong corrects hash',({context})=>{context.correctedProposal.record.corrects.sha256='b'.repeat(64);},'EVIDENCE_MISMATCH','/context/correctedProposal/record/corrects'],
  ['wrong corrects ID',({context})=>{context.correctedProposal.record.corrects.id=C1_OTHER;},'EVIDENCE_MISMATCH','/context/correctedProposal/record/corrects'],
  ['missing corrects link',({context})=>{context.correctedProposal.record.corrects=null;},'EVIDENCE_MISMATCH','/context/correctedProposal/record/corrects'],
  ['same proposal identity with different hash',({packet,context})=>{
    packet.input.correctedProposal.id=V;packet.input.correctedProposal.sha256='b'.repeat(64);
    context.correctedProposal.reference=clone(packet.input.correctedProposal);context.correctedProposal.record.proposalId=V;
  },'INVALID_REFERENCE','/input/correctedProposal/id'],
  ['same exact proposal reference',({packet,context})=>{packet.input.correctedProposal=clone(packet.input.proposal);context.correctedProposal.reference=clone(packet.input.proposal);context.correctedProposal.record.proposalId=V;},'INVALID_REFERENCE','/input/correctedProposal']
];
for(const [name,change,code,path]of correctionNegatives)test(`C1 resolved context refuses ${name}`,()=>{
  const value=proposalDecision({originalRevision:2});change(value);const before=clone(value);fails(validateCommand(value.packet,value.context),code,path);assert.deepEqual(value,before);
});
for(const outcome of ['rejected','superseded'])for(const cas of ['head','entity','input'])test(`C1 ${outcome} preserves ${cas} CAS`,()=>{
  const {packet,context}=proposalDecision({outcome,correction:outcome==='superseded'});
  if(cas==='head')packet.expected.domainHead.sha256='b'.repeat(64);
  if(cas==='entity')packet.expected.entityRevision=1;
  if(cas==='input')packet.input.expectedRevision=1;
  fails(validateCommand(packet,context),'REVISION_CONFLICT',cas==='head'?'/expected/domainHead':cas==='entity'?'/expected/entityRevision':'/input/expectedRevision');
});
for(const outcome of ['rejected','superseded'])test(`C1 ${outcome} cannot inherit human or project authority`,()=>{
  const {packet,context}=proposalDecision({outcome,correction:outcome==='superseded'});
  fails(validateCommand(packet,{...context,authenticatedCaller:'source-proposer'}),'INVALID_SCOPE','/operation');
  fails(validateCommand(packet,{...context,projectId:V}),'INVALID_SCOPE','/input/productId');
});
for(const outcome of ['accepted','rejected'])test(`C1 ${outcome} cannot carry a correction reference`,()=>{
  const {packet,context}=proposalDecision({originalRevision:2,outcome});fails(validateCommand(packet,context),'INVALID_REFERENCE','/input/correctedProposal');
});
test('C1 supplied correction context is checked even when original context is omitted for authoring',()=>{
  const {packet,context}=proposalDecision();delete context.proposal;ok(validateCommand(packet,context));
  context.correctedProposal.record.productId=V;fails(validateCommand(packet,context),'EVIDENCE_MISMATCH','/context/correctedProposal/record/productId');
});
test('C1 context-free historical/authoring validation is distinct from resolved mutation checks',()=>{
  const {packet,context}=proposalDecision({outcome:'accepted',correction:false});
  ok(validate('proposal-decision',packet.input));ok(validateCommand(packet));
  fails(validateCommand(packet,context),'REVISION_CONFLICT','/context/proposal/record/expectedRevision');
  // This source layer authenticates nobody and cannot determine active decisions.
  assert.equal(packet.input.humanActionReceipt.id,'authored-action');
});
test('C1 changed refs and revisions cannot inherit previous validation success',()=>{
  const {packet,context}=proposalDecision();ok(validateCommand(packet,context));
  context.correctedProposal.record.expectedRevision=1;fails(validateCommand(packet,context),'REVISION_CONFLICT');
  context.correctedProposal.record.expectedRevision=2;ok(validateCommand(packet,context));
  context.correctedProposal.reference.sha256='b'.repeat(64);fails(validateCommand(packet,context),'EVIDENCE_MISMATCH');
});
test('C1 validation preserves frozen inputs and emits safe bounded structured diagnostics',()=>{
  const {packet,context}=proposalDecision();context.correctedProposal.record.productId=V;context.correctedProposal.record.expectedRevision=3;
  packet.input.reason='Authored sensitive sentinel that must not enter error messages';const before=clone({packet,context});
  const freeze=x=>{if(x&&typeof x==='object'){Object.values(x).forEach(freeze);Object.freeze(x);}};freeze(packet);freeze(context);
  const result=validateCommand(packet,context);assert.equal(result.ok,false);assert(result.errors.length>0&&result.errors.length<=64);
  for(const error of result.errors){ok(validate('error',error));assert(error.path.startsWith('$'));assert(error.path.length<=512);assert(error.message.length<=200);}
  assert.equal(JSON.stringify(result).includes(packet.input.reason),false);assert.deepEqual({packet,context},before);
});
