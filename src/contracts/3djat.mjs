// Additive J01 contracts only. No runtime dispatch, I/O, authentication or hashing.
export const LIMITS = Object.freeze({ pngPixels: 16_000_000, pngBytes: 24 * 1024 ** 2,
  proposedPngPixels: 20_000_000, attachmentBytes: 256 * 1024 ** 2,
  candidates: 6, text: 20_000, list: 256, depth: 48, nodes: 30_000 });

const str = (max = 200, min = 1, pattern) => ({ type: 'string', min, max, ...(pattern ? { pattern } : {}) });
const num = (min, max, integer = false) => ({ type: 'number', min, max, integer });
const en = (...values) => ({ type: 'enum', values });
const obj = fields => ({ type: 'object', fields });
const arr = (items, max = 256, min = 0) => ({ type: 'array', items, min, max });
const ref = name => ({ type: 'ref', name });
const nullable = schema => ({ type: 'nullable', schema });
const optional = schema => ({ type: 'optional', schema });
const union = (tag, variants) => ({ type: 'union', tag, variants });
const dict = (values, max = 24) => ({ type: 'map', values, max });
const uuid = str(36, 36, 'uuid'), hash = str(64, 64, 'sha256'), id = str(80, 1, 'identifier');
const path = str(512, 1, 'path'), text = str(20_000), date = str(10, 10, 'date');
const time = str(24, 24, 'timestamp'), rev = num(1, 2_147_483_647, true);
const bool = en(true, false);
const R = ref('revision-ref'), T = ref('template-ref'), S = ref('source-ref');
const schemas = Object.create(null);
function record(name, fields) {
  schemas[name] = obj({ schemaVersion: en(`3djat.${name}.v1`), ...fields });
}
schemas['revision-ref'] = obj({ id, revision: rev, sha256: hash, path });
schemas['template-ref'] = obj({ id, revision: rev, sha256: hash, path });
schemas['locator'] = union('kind', {
  page: obj({ kind: en('page'), page: num(1, 100_000, true), section: optional(str(500)) }),
  cells: obj({ kind: en('cells'), sheet: str(100), range: str(40, 1, 'range') }),
  section: obj({ kind: en('section'), section: str(500) })
});
schemas['source-ref'] = union('kind', {
  file: obj({ kind: en('file'), sourceId: id, revision: str(), sha256: hash,
    location: path, locator: ref('locator'), observedAt: time }),
  drive: obj({ kind: en('drive'), sourceId: id, revision: str(), sha256: hash,
    fileId: str(200, 1, 'identifier'), modifiedAt: time, locator: ref('locator'), observedAt: time })
});
schemas['dimensions'] = obj({ length: num(Number.MIN_VALUE, 1e9), width: num(Number.MIN_VALUE, 1e9),
  height: num(Number.MIN_VALUE, 1e9), unit: en('mm', 'cm', 'm', 'in') });
schemas['price'] = obj({ amount: str(24, 1, 'decimal'), currency: en('IRR', 'IRT', 'USD', 'EUR', 'GBP', 'AED'),
  unit: en('rial', 'toman', 'major'), per: en('item', 'set', 'kg'), effectiveDate: date });
function fact(value) { return union('state', {
  unknown: obj({ state: en('unknown'), value: en(null), sourceRefs: arr(S, 16), decision: en(null) }),
  accepted: obj({ state: en('accepted'), value, sourceRefs: arr(S, 16, 1), decision: R }),
  'not-applicable': obj({ state: en('not-applicable'), value: en(null), sourceRefs: arr(S, 16), decision: R })
}); }
schemas['facts'] = obj({ material: fact(str(500)), dimensions: fact(ref('dimensions')), sellingPrice: fact(ref('price')) });
schemas['dossier-entry'] = obj({ id: uuid, date, kind: en('design', 'production', 'finishing'),
  title: str(), references: arr(R, 16, 1), sourceRefs: arr(S, 16) });
schemas['note'] = obj({ id: uuid, text, createdAt: time, receipt: R });
record('workspace', { workspaceId: uuid, revision: rev, domainHead: R,
  paths: obj({ business: path, products: path, templates: path, operations: path }),
  contractVersion: en('3djat.v1'), sourceCommit: str(40, 40, 'commit') });
record('domain-head', { workspaceId: uuid, revision: rev, previousHead: nullable(R),
  products: arr(obj({ productId: uuid, dossier: R })),
  skus: arr(obj({ productCode: str(80), productId: uuid })), business: nullable(R),
  templates: arr(T), receipts: arr(R) });
record('product', { productId: uuid, revision: rev, productCode: nullable(str(80)), workingName: str(),
  facts: ref('facts'), designRevisions: arr(ref('dossier-entry')), productionRecords: arr(ref('dossier-entry')),
  finishingRecords: arr(ref('dossier-entry')), attachments: arr(R), notes: arr(ref('note')), sourceReceipt: R });
record('business-context', { workspaceId: uuid, revision: rev, instructions: text,
  sourceRefs: arr(S, 16, 1), decision: R, sourceReceipt: R });
const changeVariants = {};
for (const [field, value] of Object.entries({ material: str(500), dimensions: ref('dimensions'), sellingPrice: ref('price'),
  productCode: str(80), workingName: str() })) {
  changeVariants[field] = obj({ field: en(field), fact: union('state', {
    accepted: obj({ state: en('accepted'), value, sourceRefs: arr(S, 16, 1) }),
    unknown: obj({ state: en('unknown'), value: en(null), sourceRefs: arr(S, 16) }),
    'not-applicable': obj({ state: en('not-applicable'), value: en(null), sourceRefs: arr(S, 16) }) }) });
}
schemas['change'] = union('field', changeVariants);
record('proposal', { proposalId: uuid, productId: uuid, expectedRevision: rev,
  changes: arr(ref('change'), 5, 1), reason: text, corrects: nullable(R) });
record('proposal-decision', { decisionId: uuid, productId: uuid, proposal: R, expectedRevision: rev,
  outcome: en('accepted', 'rejected', 'superseded'), reason: text, decidedAt: time,
  humanActionReceipt: R, supersedesDecision: nullable(R), correctedProposal: nullable(R) });
schemas['parameter'] = union('type', {
  enum: obj({ type: en('enum'), values: arr(str(100), 24, 1) }),
  number: obj({ type: en('number'), min: num(-1e9, 1e9), max: num(-1e9, 1e9) }),
  boolean: obj({ type: en('boolean') })
});
// Selections are primitive values; schema validates bounded values before parameter checks.
schemas['selection-value'] = { type: 'primitive' };
schemas['selection'] = dict(ref('selection-value'));
schemas['input-declaration'] = obj({ role: id, kind: en('verified-image', 'attachment'), required: bool });
schemas['output-declaration'] = obj({ role: id, format: en('image/png') });
record('template', { templateId: id, revision: rev, title: str(), kind: en('operation', 'brand'),
  appliesTo: arr(id, 24, 1), instructions: text, inputs: arr(ref('input-declaration'), 24),
  allowedChanges: arr(str(500), 24), outputs: arr(ref('output-declaration'), 6),
  exploration: optional(obj({ parameters: dict(ref('parameter')), presets: dict(ref('selection')) })),
  sourceRefs: arr(S, 16), supersedes: nullable(T) });
schemas['region'] = obj({ space: en('normalized-original'), x: num(0, 1), y: num(0, 1),
  w: num(Number.MIN_VALUE, 1), h: num(Number.MIN_VALUE, 1), meaning: str(2000),
  reviewRegion: optional(obj({ reviewId: uuid, index: num(0, 23, true) })) });
schemas['artifact-ref'] = obj({ productId: uuid, artifactId: uuid, version: rev, sha256: hash,
  width: num(1, 16_000_000, true), height: num(1, 16_000_000, true) });
schemas['source-artifact'] = obj({ artifact: ref('artifact-ref'), role: id, regions: arr(ref('region'), 24) });
schemas['allowance'] = obj({ primaryAttempts: num(1, 6, true), maxRetries: en(0) });
schemas['canonical'] = obj({ direction: en('Fresh', 'Follow'), brand: nullable(text), count: num(1, 6, true) });
record('operation-run', { runId: uuid, productId: uuid, domainHead: R, product: R, template: T,
  brand: nullable(T), branded: bool, brandInstructions: nullable(text), applicability: id, intent: text,
  direction: en('Fresh', 'Follow'), selection: ref('selection'), preset: nullable(id),
  acceptedFacts: ref('facts'), sources: arr(ref('source-artifact'), 6),
  attachments: arr(obj({ reference: R, role: id }), 24),
  requestedOutputs: arr(obj({ role: id, count: num(1, 6, true) }), 6, 1),
  executionKind: en('generative', 'deterministic'), executorId: id,
  parentRoundId: nullable(uuid), parentArtifacts: arr(ref('artifact-ref'), 24),
  allowance: ref('allowance'), canonical: ref('canonical') });
record('contract-assessment', { assessmentId: uuid, template: T, outcome: en('valid', 'invalid'),
  validatorVersion: en('3djat.v1'), errorCodes: arr(id, 64), receipt: R });
record('operational-assessment', { assessmentId: uuid, template: T, run: R, executorId: id,
  inputHashes: arr(hash, 48), outcome: en('pending', 'compatible', 'blocked'),
  blockers: arr(en('MISSING_SOURCE', 'HASH_MISMATCH', 'CAPABILITY_UNAVAILABLE', 'INVALID_SCOPE', 'BRAND_SETUP_NEEDED'), 24), receipt: R });
record('visual-assessment', { assessmentId: uuid, template: T, status: en('untested', 'partial', 'tested'),
  experiment: nullable(R), outputs: arr(ref('artifact-ref'), 24), receipts: arr(R, 24) });
record('template-decision', { decisionId: uuid, template: T, action: en('adopt', 'promote', 'reject', 'supersede'),
  purpose: str(500), appliesTo: arr(id, 24, 1), expectedRevision: num(0, 2_147_483_647, true), experiment: nullable(R),
  outputs: arr(ref('artifact-ref'), 24), evidenceReceipt: nullable(R),
  humanActionReceipt: R, decidedAt: time, supersedesDecision: nullable(R), reason: text });
record('template-assessments', { template: T, contract: ref('contract-assessment'),
  operational: nullable(ref('operational-assessment')), visual: ref('visual-assessment'),
  human: nullable(ref('template-decision')) });
schemas['historical-approval'] = obj({ origin: en('historical'), claimedApprover: nullable(str()),
  claimedAt: nullable(date), evidence: arr(S, 16, 1) });
record('historical-import', { importId: uuid, productId: uuid, origin: en('import'),
  kind: en('historical-base', 'historical-creative'), filename: str(255, 1, 'filename'),
  source: S, sha256: hash, encodedBytes: num(1, LIMITS.pngBytes, true), format: en('image/png'),
  width: num(1, 16_000_000, true), height: num(1, 16_000_000, true), bitDepth: en(8), interlaced: en(false),
  historicalParent: nullable(ref('artifact-ref')), historicalApproval: nullable(ref('historical-approval')),
  importedAt: time });
record('attachment', { attachmentId: uuid, productId: uuid, sha256: hash,
  location: path, filename: str(255, 1, 'filename'), mime: str(100, 3, 'mime'),
  bytes: num(1, LIMITS.attachmentBytes, true), availability: en('available', 'missing', 'unverified'), source: S });
schemas['calibration-output'] = obj({ variant: T, artifact: ref('artifact-ref'), jobId: uuid, receipt: R });
schemas['calibration-variant'] = obj({ template: T, roundId: nullable(uuid),
  outcome: en('draft', 'ready', 'running', 'completed', 'partial', 'blocked', 'failed'),
  outputs: arr(ref('calibration-output'), 6), failureCode: nullable(id) });
record('calibration', { experimentId: uuid, productId: uuid, revision: rev,
  lifecycle: en('draft', 'ready', 'running', 'completed', 'partial', 'blocked', 'failed', 'reviewed'),
  commonSources: arr(ref('artifact-ref'), 24, 1), commonIntent: text,
  commonSettings: ref('selection'), seed: nullable(num(0, 2_147_483_647, true)),
  executorId: id, executorVersion: str(), changedDimension: str(500), uncontrolledVariables: arr(str(500), 24),
  variants: arr(ref('calibration-variant'), 6, 1), receipt: nullable(R) });
record('calibration-review', { reviewId: uuid, experiment: R, comments: text,
  selectedVariants: arr(T, 6), humanActionReceipt: R, reviewedAt: time });
record('candidate-decision', { decisionId: uuid, productId: uuid, artifact: ref('artifact-ref'),
  action: en('retain', 'reject', 'accept-for-editing', 'approve-output'),
  purpose: str(500), channel: nullable(id), reason: text, decidedAt: time,
  humanActionReceipt: R, supersedesDecision: nullable(R) });
record('execution-result', { runId: uuid, productId: uuid, roundId: uuid, jobId: uuid, assignmentId: uuid,
  outputRole: id, outcome: en('succeeded', 'partial', 'failed', 'uncertain'),
  executorKind: en('worker', 'service'), executorId: id,
  artifact: nullable(ref('artifact-ref')), receipt: R, recipeHash: nullable(hash), parameters: ref('selection'),
  tool: nullable(str()), model: nullable(str()), version: nullable(str()),
  startedAt: time, finishedAt: nullable(time), cost: nullable(obj({ amount: str(24, 1, 'decimal'), currency: en('USD', 'EUR', 'IRR', 'IRT') })),
  usage: nullable(obj({ inputUnits: num(0, 1e12, true), outputUnits: num(0, 1e12, true), unit: id })),
  exitCode: nullable(num(-255, 255, true)), failureCode: nullable(id) });
record('artifact-origin', { artifact: ref('artifact-ref'), provenance: union('origin', {
  import: obj({ origin: en('import'), importRecord: R }),
  produced: obj({ origin: en('produced'), run: R, jobId: uuid, assignmentId: uuid, result: R })
}) });
schemas['readiness-role'] = obj({ role: en('conductor', 'butler'), requestedTier: en('SOL', 'LUNA'),
  sessionId: str(200), instructionHash: hash, acknowledgement: R, modelEvidence: R, resumeEvidence: R });
record('readiness', { workspaceId: uuid, stage: en('pre-install', 'post-install'),
  definitionEvidence: arr(R, 16, 1), provisioning: en('pass', 'blocked', 'exception-required', 'exception-approved'),
  roles: arr(ref('readiness-role'), 2), roundTrip: nullable(R), workerCount: en(0), imageCalls: en(0),
  exception: nullable(obj({ dependency: str(500), observedFailure: R, alternatives: arr(str(500), 16, 1),
    prerequisites: arr(R, 16, 1), postInstallAction: text, owner: str(), acceptanceTest: text,
    approvalReceipt: nullable(R) })) });
schemas['expected'] = obj({ domainHead: nullable(R), entityRevision: num(0, 2_147_483_647, true) });

const commandDefinitions = {
  'product.create': ['domain', ['human'], obj({ productId: uuid, productCode: nullable(str(80)), workingName: str(), note: optional(text) }), 'product'],
  'product.read': ['domain', ['human', 'conductor', 'butler', 'source-reader'], obj({ productId: uuid, atHead: R }), 'product'],
  'product.proposal.submit': ['domain', ['human', 'conductor', 'source-proposer'], ref('proposal'), 'proposal'],
  'product.proposal.decide': ['domain', ['human'], ref('proposal-decision'), 'product'],
  'product.note.add': ['domain', ['human', 'conductor'], obj({ productId: uuid, text }), 'product'],
  'template.ingest': ['domain', ['human', 'conductor', 'source-proposer'], ref('template'), 'template'],
  'template.adopt': ['domain', ['human'], ref('template-decision'), 'template-decision'],
  'operation.request': ['operational', ['human'], ref('operation-run'), 'operation-run'],
  'operation.commission': ['operational', ['conductor'], ref('operation-run'), 'operation-run'],
  'asset.import.stage': ['operational', ['human', 'conductor'], ref('historical-import'), 'historical-import'],
  'asset.import.commit': ['operational', ['human', 'conductor'], obj({ importId: uuid, stageReceipt: R, sha256: hash }), 'artifact-ref'],
  'attachment.register': ['domain', ['human', 'conductor'], ref('attachment'), 'attachment'],
  'calibration.create': ['operational', ['human', 'conductor'], ref('calibration'), 'calibration'],
  'calibration.review': ['operational', ['human'], ref('calibration-review'), 'calibration-review'],
  'template.promote': ['domain', ['human'], ref('template-decision'), 'template-decision'],
  'candidate.decide': ['operational', ['human'], ref('candidate-decision'), 'candidate-decision'],
  'workspace.adopt': ['domain', ['human'], ref('workspace'), 'workspace'],
  'workspace.export': ['domain', ['human'], obj({ workspaceId: uuid, head: R, includeAttachments: bool }), 'export-manifest']
};
// CAS protects this existing entity, never a revision-bearing child/snapshot in the input.
// create: absent (0); advance: proposed revision = current + 1; existing: current >= 1;
// append: decision-stream head (0 is its first decision). Receipts replay before these checks.
const commandRevisions = {
  'product.create': { entity: 'product', identity: 'productId', mode: 'create' },
  'product.read': { entity: 'product', identity: 'productId', mode: 'existing' },
  'product.proposal.submit': { entity: 'product', identity: 'productId', mode: 'existing', expectedField: 'expectedRevision' },
  'product.proposal.decide': { entity: 'product', identity: 'productId', mode: 'existing', expectedField: 'expectedRevision' },
  'product.note.add': { entity: 'product', identity: 'productId', mode: 'existing' },
  'template.ingest': { entity: 'template-lineage', identity: 'templateId', mode: 'advance', proposedField: 'revision' },
  'template.adopt': { entity: 'template-adoption-pointer', identity: 'template.id', mode: 'append', expectedField: 'expectedRevision' },
  'operation.request': { entity: 'operation-run', identity: 'runId', mode: 'create' },
  'operation.commission': { entity: 'operation-run', identity: 'runId', mode: 'existing' },
  'asset.import.stage': { entity: 'import', identity: 'importId', mode: 'create' },
  'asset.import.commit': { entity: 'import', identity: 'importId', mode: 'existing' },
  'attachment.register': { entity: 'attachment', identity: 'attachmentId', mode: 'create' },
  'calibration.create': { entity: 'experiment', identity: 'experimentId', mode: 'create', proposedField: 'revision' },
  'calibration.review': { entity: 'experiment', identity: 'experiment.id', mode: 'existing', expectedReference: 'experiment' },
  'template.promote': { entity: 'template-adoption-pointer', identity: 'template.id', mode: 'append', expectedField: 'expectedRevision' },
  'candidate.decide': { entity: 'candidate-decision-stream', identity: 'artifact.artifactId', mode: 'append' },
  'workspace.adopt': { entity: 'workspace-mapping', identity: 'workspaceId', mode: 'advance', proposedField: 'revision' },
  'workspace.export': { entity: 'domain-head', identity: 'workspaceId', mode: 'existing', expectedReference: 'head' }
};
record('export-manifest', { workspaceId: uuid, head: R, revisions: arr(R), attachments: arr(R),
  operationalBackup: nullable(R), evidence: arr(R) });
const commandVariants = {};
for (const [operation, [owner, callers, input, output]] of Object.entries(commandDefinitions)) {
  commandVariants[operation] = obj({ schemaVersion: en('3djat.command.v1'), operation,
    key: id, expected: ref('expected'), input });
  commandVariants[operation].fields.operation = en(operation);
}
schemas.command = union('operation', commandVariants);
record('handoff', { workspaceId: uuid, target: en('conductor', 'butler', 'worker', 'domain-writer'),
  command: ref('command'), references: arr(R, 64), expiresAt: time });
export const ERROR_CODES = Object.freeze(['UNSUPPORTED_SCHEMA', 'UNKNOWN_FIELD', 'INVALID_TYPE', 'INVALID_VALUE',
  'OUT_OF_BOUNDS', 'INVALID_REFERENCE', 'UNSAFE_PATH', 'REVISION_CONFLICT', 'SKU_CONFLICT', 'MISSING_CONTEXT',
  'MISSING_SOURCE', 'HASH_MISMATCH', 'UNSUPPORTED_IMAGE', 'CAPABILITY_UNAVAILABLE', 'ATTEMPT_UNCERTAIN',
  'IMPORT_CONFLICT', 'IDEMPOTENCY_CONFLICT', 'EXPORT_PENDING', 'INVALID_SCOPE', 'BRAND_SETUP_NEEDED', 'INVALID_SELECTION',
  'OUTPUT_COUNT', 'EVIDENCE_MISMATCH', 'NON_PORTABLE', 'VALIDATION_LIMIT', 'UNKNOWN_CONTRACT']);
schemas.error = obj({ code: en(...ERROR_CODES), path: str(512), recoverability: en('correct-input', 'refresh', 'supply-source', 'wait', 'manual-review'),
  message: str(200), evidence: nullable(R) });
record('result', { operation: en(...Object.keys(commandDefinitions)), key: id, receipt: R,
  owner: en('domain', 'operational'), committedRevision: rev, outputType: en(...new Set(Object.values(commandDefinitions).map(x => x[3]))),
  reference: R });
record('failure', { operation: en(...Object.keys(commandDefinitions)), key: id, error: ref('error') });
schemas.context = obj({ currentRevision: optional(num(0, 2_147_483_647, true)), currentHead: optional(nullable(R)),
  projectId: optional(uuid), skus: optional(arr(obj({ productCode: str(80), productId: uuid }))),
  authenticatedCaller: optional(en('human', 'conductor', 'butler', 'source-reader', 'source-proposer', 'worker', 'service')),
  proposal: optional(obj({ reference: R, record: ref('proposal') })),
  correctedProposal: optional(obj({ reference: R, record: ref('proposal') })),
  experiment: optional(obj({ reference: R, record: ref('calibration') })),
  template: optional(obj({ reference: T, record: ref('template') })),
  product: optional(obj({ reference: R, record: ref('product') })),
  head: optional(obj({ reference: R, record: ref('domain-head') })),
  canonical: optional(ref('canonical')),
  brand: optional(obj({ reference: T, record: ref('template'), decision: ref('template-decision') })) });

function freeze(value) {
  if (value && typeof value === 'object') { for (const x of Object.values(value)) freeze(x); Object.freeze(value); }
  return value;
}
export const CONTRACT_SHAPES = freeze(schemas);
export const SCHEMA_VERSIONS = freeze(Object.fromEntries(Object.keys(schemas)
  .filter(k => schemas[k].fields?.schemaVersion).map(k => [k, `3djat.${k}.v1`])));
export const COMMANDS = freeze(Object.fromEntries(Object.entries(commandDefinitions)
  .map(([name, [owner, callers, input, output]]) => [name, { owner, callers, input, output,
    idempotency: name === 'product.read' ? 'read-only' : 'same-key-same-payload-replays;changed-payload-conflicts',
    cas: { ...commandRevisions[name], head: name === 'product.read' ? 'exact-head-read' : 'expected-head-and-entity-revision' } }])));

const own = (o, k) => Object.hasOwn(o, k);
const reservedParameter = key => ['shell', 'shellcommand', 'shellscript', 'exec', 'command', 'commandline',
  'executable', 'argv', 'credential', 'credentials', 'password', 'token', 'permissions', 'permissionescalation',
  'provider', 'budget', 'staff', 'tool', 'sourceaccess'].includes(key.replace(/[_-]/g, '').toLowerCase());
const same = (a, b) => a?.id === b?.id && a?.revision === b?.revision && a?.sha256 === b?.sha256 && a?.path === b?.path;
const sameArtifact = (a, b) => ['productId', 'artifactId', 'version', 'sha256', 'width', 'height'].every(k => a?.[k] === b?.[k]);
const stable = v => JSON.stringify(v, (_, x) => x && typeof x === 'object' && !Array.isArray(x)
  ? Object.fromEntries(Object.keys(x).sort().map(k => [k, x[k]])) : x);
function matches(pattern, value) {
  switch (pattern) {
    case 'uuid': return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
    case 'sha256': return /^[0-9a-f]{64}$/.test(value);
    case 'commit': return /^[0-9a-f]{40}$/.test(value);
    case 'identifier': return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value);
    case 'decimal': return /^(0|[1-9][0-9]{0,15})(\.[0-9]{1,6})?$/.test(value);
    case 'date': return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
    case 'timestamp': return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
    case 'range': return /^[A-Z]{1,3}[1-9][0-9]{0,6}(:[A-Z]{1,3}[1-9][0-9]{0,6})?$/.test(value);
    case 'mime': return /^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/.test(value);
    case 'filename': return !/[\\/:%<>|"*?\x00-\x1f\x7f]/.test(value) && value !== '.' && value !== '..' && !/[. ]$/.test(value);
    case 'path': return !/[\\:%<>|"*?\x00-\x1f\x7f]/.test(value) && !value.startsWith('/') && value.split('/').every(p =>
      p && p !== '.' && p !== '..' && !/[. ]$/.test(p) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(p));
    default: return false;
  }
}
function errorsCollector() {
  const errors = [];
  const add = (code, path, message = code) => {
    if (errors.length < 64) errors.push({ code, path: path.slice(0, 512), recoverability:
      code === 'REVISION_CONFLICT' ? 'refresh' : code === 'MISSING_SOURCE' ? 'supply-source' : 'correct-input', message, evidence: null });
  };
  return { errors, add };
}
// Reject non-JSON objects/accessors/cycles before inspecting any caller fields. No getters execute.
function portable(value, add) {
  const seen = new WeakSet(); let nodes = 0;
  function visit(v, p, depth) {
    if (++nodes > LIMITS.nodes || depth > LIMITS.depth) { add('VALIDATION_LIMIT', p); return; }
    if (v === null || typeof v === 'boolean' || typeof v === 'number' && Number.isFinite(v)) return;
    if (typeof v === 'string') { if (v.length > LIMITS.text) add('OUT_OF_BOUNDS', p); return; }
    if (!v || typeof v !== 'object' || seen.has(v) || ![Object.prototype, null, Array.prototype].includes(Object.getPrototypeOf(v))) {
      add('NON_PORTABLE', p); return;
    }
    seen.add(v);
    const keys = Reflect.ownKeys(v);
    if (keys.length > 1024 || Array.isArray(v) && v.length > LIMITS.list) { add('VALIDATION_LIMIT', p); return; }
    for (const key of keys) {
      if (Array.isArray(v) && key === 'length') continue;
      const d = Object.getOwnPropertyDescriptor(v, key);
      if (typeof key !== 'string' || !d.enumerable || !own(d, 'value')) { add('NON_PORTABLE', p); continue; }
      if (Array.isArray(v) && !/^(0|[1-9][0-9]*)$/.test(key)) { add('NON_PORTABLE', p); continue; }
      visit(d.value, `${p}/${key}`, depth + 1);
    }
    if (Array.isArray(v) && Object.keys(v).length !== v.length) add('NON_PORTABLE', p);
    seen.delete(v);
  }
  visit(value, '$', 0);
}
function walk(s, v, p, add) {
  switch (s.type) {
    case 'ref': return walk(schemas[s.name], v, p, add);
    case 'optional': return v === undefined ? undefined : walk(s.schema, v, p, add);
    case 'nullable': return v === null ? undefined : walk(s.schema, v, p, add);
    case 'enum': if (!s.values.includes(v)) add(p.endsWith('/schemaVersion') ? 'UNSUPPORTED_SCHEMA' : 'INVALID_VALUE', p); return;
    case 'string':
      if (typeof v !== 'string') add('INVALID_TYPE', p);
      else if (v.length < s.min || v.length > s.max || !v.trim()) add('OUT_OF_BOUNDS', p);
      else if (s.pattern && !matches(s.pattern, v)) add(s.pattern === 'path' ? 'UNSAFE_PATH' : 'INVALID_REFERENCE', p);
      return;
    case 'number':
      if (typeof v !== 'number' || !Number.isFinite(v) || s.integer && !Number.isInteger(v)) add('INVALID_TYPE', p);
      else if (v < s.min || v > s.max) add('OUT_OF_BOUNDS', p); return;
    case 'primitive':
      if (!(typeof v === 'boolean' || typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1e9 ||
        typeof v === 'string' && v.trim() && v.length <= 500)) add('INVALID_VALUE', p); return;
    case 'union':
      if (!v || typeof v !== 'object' || Array.isArray(v)) { add('INVALID_TYPE', p); return; }
      if (!own(s.variants, v[s.tag])) { add('INVALID_VALUE', `${p}/${s.tag}`); return; }
      return walk(s.variants[v[s.tag]], v, p, add);
    case 'object':
      if (!v || typeof v !== 'object' || Array.isArray(v)) { add('INVALID_TYPE', p); return; }
      for (const k of Object.keys(v)) if (!own(s.fields, k)) add('UNKNOWN_FIELD', `${p}/${k}`);
      for (const [k, f] of Object.entries(s.fields)) walk(f, own(v, k) ? v[k] : undefined, `${p}/${k}`, add);
      if (s === schemas.price && ['IRR', 'IRT', 'USD', 'EUR', 'GBP', 'AED'].includes(v.currency) &&
        v.unit !== (v.currency === 'IRR' ? 'rial' : v.currency === 'IRT' ? 'toman' : 'major')) add('INVALID_VALUE', `${p}/unit`, 'Currency/unit mismatch');
      return;
    case 'array':
      if (!Array.isArray(v)) { add('INVALID_TYPE', p); return; }
      if (v.length < s.min || v.length > s.max) add('OUT_OF_BOUNDS', p);
      for (let i = 0; i < Math.min(v.length, s.max); i++) walk(s.items, v[i], `${p}/${i}`, add);
      return;
    case 'map':
      if (!v || typeof v !== 'object' || Array.isArray(v)) { add('INVALID_TYPE', p); return; }
      if (Object.keys(v).length > s.max) add('OUT_OF_BOUNDS', p);
      for (const [k, x] of Object.entries(v)) {
        if (!matches('identifier', k) || ['__proto__', 'prototype', 'constructor'].includes(k) || reservedParameter(k) || k.length > 80) add('INVALID_VALUE', `${p}/${k}`);
        walk(s.values, x, `${p}/${k}`, add);
      }
  }
}
function unique(xs, key, p, add) {
  const seen = new Set(); for (const x of xs) { const k = key(x); if (seen.has(k)) add('INVALID_VALUE', p, 'Duplicate identity'); seen.add(k); }
}
function select(template, selection, p, add) {
  const parameters = template.exploration?.parameters ?? {};
  for (const [k, v] of Object.entries(selection)) {
    if (!own(parameters, k)) { add('INVALID_SELECTION', `${p}/${k}`, 'Unknown exploration parameter'); continue; }
    const d = parameters[k];
    if (d.type === 'enum' && !d.values.includes(v) || d.type === 'boolean' && typeof v !== 'boolean' ||
      d.type === 'number' && (typeof v !== 'number' || v < d.min || v > d.max)) add('INVALID_SELECTION', `${p}/${k}`);
  }
}
function semantic(kind, v, c, add, p = '$') {
  const err = (code, field, message) => add(code, `${p}/${field}`, message);
  if (c.projectId !== undefined && v.productId !== undefined && c.projectId !== v.productId) err('INVALID_SCOPE', 'productId');
  function sku(code, productId) {
    if (code !== null && c.skus?.some(x => x.productCode === code && x.productId !== productId)) err('SKU_CONFLICT', 'productCode');
  }
  if (kind === 'product') {
    sku(v.productCode, v.productId);
    for (const [key, tag] of [['designRevisions', 'design'], ['productionRecords', 'production'], ['finishingRecords', 'finishing']]) {
      for (const [i, entry] of v[key].entries()) if (entry.kind !== tag) err('INVALID_VALUE', `${key}/${i}/kind`);
    }
  }
  if (kind === 'workspace' && v.domainHead.id !== v.workspaceId) err('INVALID_REFERENCE', 'domainHead/id');
  if (kind === 'domain-head') {
    unique(v.products, x => x.productId, `${p}/products`, add); unique(v.skus, x => x.productCode, `${p}/skus`, add);
    unique(v.skus, x => x.productId, `${p}/skus`, add); unique(v.templates, x => x.id, `${p}/templates`, add);
    if (v.revision === 1 ? v.previousHead !== null : v.previousHead === null || v.previousHead.revision !== v.revision - 1) err('REVISION_CONFLICT', 'previousHead');
    if (v.previousHead && v.previousHead.id !== v.workspaceId) err('INVALID_REFERENCE', 'previousHead/id');
    for (const [i, x] of v.products.entries()) if (x.dossier.id !== x.productId) err('INVALID_REFERENCE', `products/${i}/dossier/id`);
    for (const [i, x] of v.skus.entries()) if (!v.products.some(y => y.productId === x.productId)) err('INVALID_REFERENCE', `skus/${i}/productId`);
  }
  if (kind === 'proposal') {
    unique(v.changes, x => x.field, `${p}/changes`, add);
    for (const x of v.changes) {
      if (x.field === 'productCode') sku(x.fact.value, v.productId);
      if (x.field === 'workingName' && x.fact.state !== 'accepted') err('INVALID_VALUE', 'changes', 'Working name cannot be cleared');
    }
  }
  if (kind === 'proposal-decision' && v.correctedProposal && (same(v.correctedProposal, v.proposal) || v.outcome !== 'superseded')) err('INVALID_REFERENCE', 'correctedProposal');
  if (kind === 'proposal-decision' && c.proposal) {
    if (!same(v.proposal, c.proposal.reference)) err('EVIDENCE_MISMATCH', 'proposal');
    if (c.proposal.record.productId !== v.productId || c.proposal.record.expectedRevision !== v.expectedRevision) err('EVIDENCE_MISMATCH', 'productId');
    if (v.correctedProposal && (!c.correctedProposal || !same(c.correctedProposal.record.corrects, v.proposal) ||
      !same(c.correctedProposal.reference, v.correctedProposal))) err('EVIDENCE_MISMATCH', 'correctedProposal');
  }
  if (kind === 'template') {
    unique(v.appliesTo, x => x, `${p}/appliesTo`, add); unique(v.inputs, x => x.role, `${p}/inputs`, add);
    unique(v.outputs, x => x.role, `${p}/outputs`, add);
    if (v.kind === 'operation' && v.outputs.length === 0 || v.kind === 'brand' && v.outputs.length !== 0) err('INVALID_VALUE', 'outputs');
    for (const [k, d] of Object.entries(v.exploration?.parameters ?? {})) {
      if (d.type === 'number' && d.min > d.max) err('INVALID_SELECTION', `exploration/parameters/${k}`);
      if (d.type === 'enum') unique(d.values, x => x, `${p}/exploration/parameters/${k}/values`, add);
    }
    for (const [k, values] of Object.entries(v.exploration?.presets ?? {})) select(v, values, `${p}/exploration/presets/${k}`, add);
    if (v.supersedes && (v.supersedes.id !== v.templateId || v.supersedes.revision >= v.revision)) err('REVISION_CONFLICT', 'supersedes');
  }
  if (kind === 'operation-run') {
    const count = v.requestedOutputs.reduce((n, x) => n + x.count, 0);
    unique(v.requestedOutputs, x => x.role, `${p}/requestedOutputs`, add);
    unique(v.sources, x => x.artifact.artifactId, `${p}/sources`, add);
    if (count > 6 || count !== v.allowance.primaryAttempts || count !== v.canonical.count) err('OUTPUT_COUNT', 'requestedOutputs');
    if (v.product.id !== v.productId) err('INVALID_SCOPE', 'product/id');
    if (v.direction !== v.canonical.direction || v.brandInstructions !== v.canonical.brand) err('INVALID_SCOPE', 'canonical', 'Canonical direction/Brand conflict');
    if (v.branded && (!v.brand || !v.brandInstructions)) err('BRAND_SETUP_NEEDED', 'brand');
    if (!v.branded && (v.brand !== null || v.brandInstructions !== null)) err('INVALID_SCOPE', 'brand');
    for (const [i, s] of v.sources.entries()) {
      if (s.artifact.productId !== v.productId) err('INVALID_SCOPE', `sources/${i}/artifact/productId`);
      image(s.artifact, `${p}/sources/${i}/artifact`, add);
      for (const [j, r] of s.regions.entries()) if (r.x + r.w > 1 || r.y + r.h > 1) err('OUT_OF_BOUNDS', `sources/${i}/regions/${j}`);
    }
    for (const [i, a] of v.parentArtifacts.entries()) if (a.productId !== v.productId) err('INVALID_SCOPE', `parentArtifacts/${i}`);
  }
  if (kind === 'historical-import') {
    image(v, p, add); if (v.source.sha256 !== v.sha256) err('HASH_MISMATCH', 'source/sha256');
    if (v.historicalParent && v.historicalParent.productId !== v.productId) err('INVALID_SCOPE', 'historicalParent');
  }
  if (kind === 'attachment' && v.source.sha256 !== v.sha256) err('HASH_MISMATCH', 'source/sha256');
  if (kind === 'calibration') {
    unique(v.variants, x => `${x.template.id}:${x.template.revision}:${x.template.sha256}`, `${p}/variants`, add);
    for (const [i, variant] of v.variants.entries()) {
      if (variant.outputs.length && (variant.roundId === null || ['draft', 'ready', 'blocked', 'failed'].includes(variant.outcome))) err('EVIDENCE_MISMATCH', `variants/${i}/outputs`);
      if (variant.outcome === 'completed' && !variant.outputs.length) err('EVIDENCE_MISMATCH', `variants/${i}/outputs`);
      if (['blocked', 'failed'].includes(variant.outcome) && !variant.failureCode) err('INVALID_VALUE', `variants/${i}/failureCode`);
      for (const [j, o] of variant.outputs.entries()) if (!same(o.variant, variant.template) || o.artifact.productId !== v.productId) err('EVIDENCE_MISMATCH', `variants/${i}/outputs/${j}`);
    }
    for (const [i, a] of v.commonSources.entries()) if (a.productId !== v.productId) err('INVALID_SCOPE', `commonSources/${i}`);
    if (v.lifecycle === 'completed' && (v.variants.some(x => x.outcome !== 'completed') || !v.receipt)) err('EVIDENCE_MISMATCH', 'lifecycle');
    if (v.lifecycle === 'reviewed' && !v.receipt) err('EVIDENCE_MISMATCH', 'receipt');
  }
  if (kind === 'visual-assessment') {
    if (v.status === 'untested' && (v.experiment !== null || v.outputs.length || v.receipts.length)) err('EVIDENCE_MISMATCH', 'status');
    if (v.status !== 'untested' && (!v.experiment || !v.outputs.length || v.outputs.length !== v.receipts.length)) err('EVIDENCE_MISMATCH', 'outputs');
    if (c.experiment && v.status !== 'untested') {
      checkExperiment(v.template, v.experiment, v.outputs, c, add, p, v.status === 'tested');
      const variant = c.experiment.record.variants.find(x => same(x.template, v.template));
      if (v.outputs.some((a, i) => !variant?.outputs.some(o => sameArtifact(o.artifact, a) && same(o.receipt, v.receipts[i])))) err('EVIDENCE_MISMATCH', 'receipts');
    }
  }
  if (kind === 'contract-assessment' && (v.outcome === 'valid') !== (v.errorCodes.length === 0)) err('EVIDENCE_MISMATCH', 'outcome');
  if (kind === 'operational-assessment' && (v.outcome === 'blocked') !== (v.blockers.length > 0)) err('EVIDENCE_MISMATCH', 'blockers');
  if (kind === 'template-decision') {
    if (v.action === 'promote' && (!v.experiment || !v.outputs.length || !v.evidenceReceipt)) err('EVIDENCE_MISMATCH', 'experiment');
    if (c.experiment && v.action === 'promote') {
      checkExperiment(v.template, v.experiment, v.outputs, c, add, p, true);
      if (!same(v.evidenceReceipt, c.experiment.record.receipt)) err('EVIDENCE_MISMATCH', 'evidenceReceipt');
    }
    if (c.template && (!same(v.template, c.template.reference) || v.appliesTo.some(x => !c.template.record.appliesTo.includes(x)))) err('EVIDENCE_MISMATCH', 'template');
  }
  if (kind === 'template-assessments') {
    for (const key of ['contract', 'operational', 'visual', 'human']) if (v[key] && !same(v.template, v[key].template)) err('EVIDENCE_MISMATCH', `${key}/template`);
    semantic('contract-assessment', v.contract, c, add, `${p}/contract`);
    if (v.operational) semantic('operational-assessment', v.operational, c, add, `${p}/operational`);
    semantic('visual-assessment', v.visual, c, add, `${p}/visual`);
    if (v.human) semantic('template-decision', v.human, c, add, `${p}/human`);
  }
  if (kind === 'candidate-decision') {
    if (v.artifact.productId !== v.productId) err('INVALID_SCOPE', 'artifact');
    if (v.action === 'approve-output' && v.channel === null) err('INVALID_VALUE', 'channel');
  }
  if (kind === 'calibration-review' && c.experiment) {
    if (!same(v.experiment, c.experiment.reference) || !validate('calibration', c.experiment.record).ok ||
      v.selectedVariants.some(t => !c.experiment.record.variants.some(x => same(x.template, t) && x.outcome === 'completed'))) err('EVIDENCE_MISMATCH', 'selectedVariants');
  }
  if (kind === 'execution-result') {
    if (v.outcome === 'succeeded' && (!v.artifact || !v.finishedAt || v.failureCode !== null)) err('EVIDENCE_MISMATCH', 'outcome');
    if (v.artifact && v.artifact.productId !== v.productId) err('INVALID_SCOPE', 'artifact');
    if (v.outcome === 'uncertain' && v.artifact) err('EVIDENCE_MISMATCH', 'artifact');
    if (v.outcome === 'failed' && v.failureCode === null) err('INVALID_VALUE', 'failureCode');
    if (v.finishedAt !== null && v.finishedAt < v.startedAt) err('INVALID_VALUE', 'finishedAt');
  }
  if (kind === 'readiness') {
    unique(v.roles, x => x.role, `${p}/roles`, add);
    unique(v.roles, x => x.sessionId, `${p}/roles`, add);
    for (const [i, r] of v.roles.entries()) if (r.requestedTier !== (r.role === 'conductor' ? 'SOL' : 'LUNA')) err('INVALID_VALUE', `roles/${i}/requestedTier`);
    if (v.provisioning === 'pass' && (v.roles.length !== 2 || !v.roundTrip || v.exception !== null)) err('EVIDENCE_MISMATCH', 'provisioning');
    if (v.provisioning.startsWith('exception-') && !v.exception) err('EVIDENCE_MISMATCH', 'exception');
    if (v.provisioning === 'exception-approved' && !v.exception?.approvalReceipt) err('EVIDENCE_MISMATCH', 'exception/approvalReceipt');
  }
  if (kind === 'result') {
    const d = COMMANDS[v.operation];
    if (v.owner !== d.owner || v.outputType !== d.output) err('INVALID_SCOPE', 'outputType');
  }
  if (kind === 'handoff') {
    for (const e of validateCommand(v.command, c).errors) add(e.code, `${p}/command${e.path.slice(1)}`, e.message);
  }
  // Geometry checks on nested artifact/region declarations; price checks use its schema above.
  visitNested(v, p, add);
}
function visitNested(v, p, add) {
  if (!v || typeof v !== 'object') return;
  if (own(v, 'artifactId') && own(v, 'width') && own(v, 'height')) image(v, p, add);
  if (v.space === 'normalized-original' && (v.x + v.w > 1 || v.y + v.h > 1)) add('OUT_OF_BOUNDS', p, 'Region exceeds original');
  for (const [k, x] of Object.entries(v)) visitNested(x, `${p}/${k}`, add);
}
function image(v, p, add) { if (v.width * v.height > LIMITS.pngPixels) add('UNSUPPORTED_IMAGE', p, 'Current limit is 16MP; IMG20 is unverified'); }
function checkExperiment(template, experimentRef, outputs, c, add, p, completed) {
  const e = c.experiment;
  const v = e.record.variants.find(x => same(x.template, template));
  if (!validate('calibration', e.record).ok || !same(e.reference, experimentRef) || !v || !['completed', 'partial', 'reviewed'].includes(e.record.lifecycle) ||
    completed && v.outcome !== 'completed' || !['completed', 'partial'].includes(v?.outcome) ||
    outputs.some(a => !v?.outputs.some(o => sameArtifact(o.artifact, a))) || !e.record.receipt) add('EVIDENCE_MISMATCH', `${p}/experiment`);
}
/** Shape + bounded contextual checks. ok never means permission, readiness or verified bytes. */
export function validate(kind, value, context = {}) {
  const { errors, add } = errorsCollector();
  if (!own(schemas, kind)) add('UNKNOWN_CONTRACT', '$');
  else {
    portable(value, add); portable(context, add);
    if (!errors.length) { walk(schemas[kind], value, '$', add); walk(schemas.context, context, '$/context', add); }
    if (!errors.length) {
      semantic(kind, value, context, add);
      // Standalone record checks bind only this record's documented revision, not its children.
      const field = { product: 'revision', template: 'revision', workspace: 'revision', 'domain-head': 'revision',
        calibration: 'revision', proposal: 'expectedRevision', 'proposal-decision': 'expectedRevision', 'template-decision': 'expectedRevision' }[kind];
      if (context.currentRevision !== undefined && field && value[field] !== context.currentRevision) add('REVISION_CONFLICT', `$/${field}`);
    }
  }
  return { ok: errors.length === 0, errors };
}
/** Validate the portable command and optionally check an already-authenticated capability. */
export function validateCommand(packet, context = {}) {
  const checked = validate('command', packet, context);
  if (!checked.ok) return checked;
  const { errors, add } = errorsCollector(), d = COMMANDS[packet.operation];
  if (context.authenticatedCaller !== undefined && !d.callers.includes(context.authenticatedCaller)) add('INVALID_SCOPE', '$/operation');
  if (context.currentHead !== undefined && !same(packet.expected.domainHead, context.currentHead)) add('REVISION_CONFLICT', '$/expected/domainHead');
  if (context.currentRevision !== undefined && packet.expected.entityRevision !== context.currentRevision) add('REVISION_CONFLICT', '$/expected/entityRevision');
  const input = packet.input;
  const current = packet.expected.entityRevision, cas = d.cas;
  if (packet.expected.domainHead === null && !(packet.operation === 'workspace.adopt' && packet.expected.entityRevision === 0)) add('INVALID_SCOPE', '$/expected/domainHead');
  const kind = input.schemaVersion?.replace(/^3djat\./, '').replace(/\.v1$/, '');
  if (kind) semantic(kind, input, context, add, '$/input');
  else if (context.projectId !== undefined && input.productId !== undefined && context.projectId !== input.productId) add('INVALID_SCOPE', '$/input/productId');
  if ((cas.mode === 'create' && current !== 0) || (cas.mode === 'existing' && current === 0)) add('REVISION_CONFLICT', '$/expected/entityRevision');
  if (cas.proposedField && input[cas.proposedField] !== current + 1) add('REVISION_CONFLICT', `$/input/${cas.proposedField}`, 'Proposed revision must be current revision plus one');
  if (cas.expectedField && input[cas.expectedField] !== current) add('REVISION_CONFLICT', `$/input/${cas.expectedField}`);
  if (cas.expectedReference && input[cas.expectedReference].revision !== current) add('REVISION_CONFLICT', `$/input/${cas.expectedReference}/revision`);
  if (packet.operation === 'template.ingest') {
    if (current === 0 ? input.supersedes !== null : input.supersedes === null || input.supersedes.revision !== current) add('REVISION_CONFLICT', '$/input/supersedes');
    if (context.template && (context.template.record.templateId !== input.templateId || context.template.record.revision !== current ||
      !same(context.template.reference, input.supersedes))) add('EVIDENCE_MISMATCH', '$/input/supersedes');
  }
  if (packet.operation === 'product.read' && !same(input.atHead, packet.expected.domainHead)) add('REVISION_CONFLICT', '$/input/atHead');
  if (packet.operation === 'workspace.export' && !same(input.head, packet.expected.domainHead)) add('REVISION_CONFLICT', '$/input/head');
  if (packet.operation === 'candidate.decide' && (current === 0 ? input.supersedesDecision !== null : input.supersedesDecision === null)) add('REVISION_CONFLICT', '$/input/supersedesDecision');
  if (packet.operation === 'product.create') {
    if (context.skus?.some(x => x.productCode === input.productCode && x.productId !== input.productId)) add('SKU_CONFLICT', '$/input/productCode');
  }
  if (packet.operation === 'template.adopt' && input.action !== 'adopt' || packet.operation === 'template.promote' && input.action !== 'promote') add('INVALID_SCOPE', '$/input/action');
  if (packet.operation === 'calibration.create' && (input.lifecycle !== 'draft' || input.receipt !== null || input.variants.some(v => v.outcome !== 'draft' || v.outputs.length || v.roundId !== null))) add('INVALID_SCOPE', '$/input/lifecycle', 'Authoring cannot supply execution evidence');
  return { ok: errors.length === 0, errors };
}
/** Resolved preflight: supplied snapshots are mandatory and must already be independently verified. */
export function validateResolvedOperation(run, context = {}) {
  const checked = validate('operation-run', run, context);
  if (!checked.ok) return checked;
  const { errors, add } = errorsCollector();
  for (const key of ['template', 'product', 'head', 'canonical']) if (!context[key]) add('MISSING_CONTEXT', `$/context/${key}`);
  if (errors.length) return { ok: false, errors };
  for (const [key, kind] of [['template', 'template'], ['product', 'product'], ['head', 'domain-head']]) {
    const entry = context[key];
    const r = validate(kind, entry.record);
    if (!r.ok || !validate('revision-ref', entry.reference).ok) add('INVALID_REFERENCE', `$/context/${key}`);
  }
  if (!validate('canonical', context.canonical).ok) add('INVALID_VALUE', '$/context/canonical');
  if (errors.length) return { ok: false, errors };
  const t = context.template.record, h = context.head.record, p = context.product.record;
  if (!same(run.template, context.template.reference) || t.templateId !== run.template.id || t.revision !== run.template.revision || t.kind !== 'operation') add('HASH_MISMATCH', '$/template');
  if (!same(run.product, context.product.reference) || p.productId !== run.productId || p.revision !== run.product.revision) add('HASH_MISMATCH', '$/product');
  if (!same(run.domainHead, context.head.reference) || h.revision !== run.domainHead.revision || h.workspaceId !== run.domainHead.id ||
    !h.products.some(x => x.productId === run.productId && same(x.dossier, run.product)) || !h.templates.some(x => same(x, run.template))) add('HASH_MISMATCH', '$/domainHead');
  if (stable(p.facts) !== stable(run.acceptedFacts)) add('EVIDENCE_MISMATCH', '$/acceptedFacts');
  if (['direction', 'brand', 'count'].some(k => context.canonical[k] !== run.canonical[k])) add('INVALID_SCOPE', '$/canonical');
  if (!t.appliesTo.includes(run.applicability)) add('INVALID_SCOPE', '$/applicability');
  select(t, run.selection, '$/selection', add);
  if (run.preset !== null) {
    const preset = t.exploration?.presets;
    if (!preset || !own(preset, run.preset) || Object.keys(preset[run.preset]).some(k => run.selection[k] !== preset[run.preset][k])) add('INVALID_SELECTION', '$/preset');
  }
  for (const x of run.requestedOutputs) if (!t.outputs.some(y => y.role === x.role)) add('INVALID_SCOPE', '$/requestedOutputs');
  for (const x of run.sources) if (!t.inputs.some(y => y.role === x.role && y.kind === 'verified-image')) add('INVALID_SCOPE', '$/sources');
  for (const x of run.attachments) if (!t.inputs.some(y => y.role === x.role && y.kind === 'attachment')) add('INVALID_SCOPE', '$/attachments');
  for (const x of t.inputs.filter(y => y.required)) if (!(x.kind === 'verified-image' ? run.sources : run.attachments).some(y => y.role === x.role)) add('MISSING_SOURCE', `$/inputs/${x.role}`);
  if (run.branded) {
    if (!context.brand || !validate('template', context.brand.record).ok || !validate('template-decision', context.brand.decision).ok) add('BRAND_SETUP_NEEDED', '$/brand');
    else {
      const b = context.brand;
      if (!same(run.brand, b.reference) || b.record.templateId !== run.brand.id || b.record.revision !== run.brand.revision || b.record.kind !== 'brand' ||
        !same(b.decision.template, run.brand) || !['adopt', 'promote'].includes(b.decision.action) || !h.templates.some(x => same(x, run.brand)) ||
        !b.record.appliesTo.includes(run.applicability) || !b.decision.appliesTo.includes(run.applicability) || b.record.instructions !== run.brandInstructions) add('EVIDENCE_MISMATCH', '$/brand');
    }
  }
  return { ok: errors.length === 0, errors };
}

/** Relational evidence gate, using records resolved by the trusted runtime. Still no authentication. */
export function validateEvidence(kind, value, context = {}) {
  const allowed = ['visual-assessment', 'template-decision', 'template-assessments', 'calibration-review'];
  if (!allowed.includes(kind)) return { ok: false, errors: [{ code: 'UNKNOWN_CONTRACT', path: '$', recoverability: 'correct-input', message: 'Unsupported evidence contract', evidence: null }] };
  const checked = validate(kind, value, context);
  if (!checked.ok) return checked;
  const { errors, add } = errorsCollector();
  const visual = kind === 'visual-assessment' ? value : kind === 'template-assessments' ? value.visual : null;
  const human = kind === 'template-decision' ? value : kind === 'template-assessments' ? value.human : null;
  if ((visual && visual.status !== 'untested' || human?.action === 'promote' || kind === 'calibration-review') && !context.experiment) add('MISSING_CONTEXT', '$/context/experiment');
  if (human && !context.template) add('MISSING_CONTEXT', '$/context/template');
  return { ok: errors.length === 0, errors };
}
