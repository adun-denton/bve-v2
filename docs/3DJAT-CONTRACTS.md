# 3DJAT contracts v1 — J01 review baseline

The separate [J03A standalone domain-store proposal](3DJAT-DOMAIN-STORE.md) implements bounded file persistence against these unchanged types; runtime adoption and authenticated workflows remain later gates.

These are additive interfaces for the 3DJAT adaptation. This contract module supplies pure validation and authored examples only. The separate [product workflow implementation](3DJAT-PRODUCTS.md) delegates its five governed product commands to a semantic domain writer and explicit server endpoint; the remaining commands are not installed by that slice. Existing [operating contracts](CONTRACTS.md), APIs, record interpretation and limits remain intact. Downstream implementations use the independently accepted exact contract baseline.

All top-level persisted records use `schemaVersion: "3djat.<record-name>.v1"`; commands use `3djat.command.v1`. The common contract family is `3djat.v1`. Structural reference/value types have no redundant version field. Unknown versions and unknown fields at every nested level reject. Version changes require a reviewed migration; this module implements none.

## Validation entry points and meaning

```js
import { validate, validateCommand, validateResolvedOperation, validateEvidence }
  from '../src/contracts/3djat.mjs';

validate('product', dossier, { currentRevision: 1, projectId });
validateCommand(portableCommand, trustedContext);
validateResolvedOperation(frozenRun, resolvedContext);
validateEvidence('visual-assessment', storedAssessment, resolvedExperimentContext);
// Each returns {ok: boolean, errors: Error[]}; never mutates caller values.
```

`validate(kind, value, context = {})` checks the exact shape, intrinsic invariants and explicitly supplied contextual constraints. Its success means data validity, never execution permission, actual evidence availability, verified hashes, human approval or session readiness. In particular, a stored human decision can have valid shape without an authenticated author. `validate('command', ...)` is structural; integrations must use `validateCommand` for input-specific and caller/CAS comparisons as well.

`validateCommand` checks the command-specific input and, when supplied, the **already authenticated** caller capability, current head and current entity revision. Absence of context is useful for portable authoring validation; it is not authorization. Runtime mutation entry points MUST supply verified caller/current-state context and perform durable CAS/idempotency under their owning transaction or lock. A user-submitted `authenticatedCaller`, `currentRevision` or head in JSON is never trusted context. Portable packets contain none of these capabilities.

For standalone `validate`, `currentRevision` compares only the named root record: `revision` for product/template/workspace/domain-head/calibration snapshots, or `expectedRevision` for proposal/proposal-decision/template-decision. It never propagates to revision-bearing children or assessment members. Command validation instead uses the command-specific CAS subject below: a proposed revision and an existing current revision are different values. Use `validateCommand`, rather than standalone snapshot validation, to validate a proposed command revision.

`validateResolvedOperation` additionally requires `context.template`, `product`, `head`, and `canonical`. The first three are `{reference, record}` pairs. It binds IDs/revisions/reference hashes, the head's product/template membership, selected fact values, applicability, template inputs/outputs, exploration values/presets and independent canonical direction/Brand/count. A branded run additionally requires `context.brand: {reference, record, decision}` for an applicable adopted/promoted Brand revision. The resolver verifies bytes/hashes and current adoption/decision status before supplying context. The function cannot read files or establish that a supplied hash corresponds to supplied bytes. History is validated against its frozen head, never silently rebound to today's head.

`validateEvidence` supports `visual-assessment`, `template-decision`, `template-assessments`, and `calibration-review`. A non-untested visual assessment, promotion or calibration review requires `context.experiment: {reference, record}`. A template human decision also requires `context.template: {reference, record}`. The gate checks exact variant/revision/path/hash, actual output and receipt references, compatible outcomes and applicability. Supplied experiment records must themselves satisfy the calibration contract. Runtime independently resolves committed operational evidence and authenticates human actions; this gate proves neither. Missing evidence returns `MISSING_CONTEXT`; shape-only reading remains possible with `validate` and must be labelled unresolved.

`CONTRACT_SHAPES`, `SCHEMA_VERSIONS`, `COMMANDS`, `ERROR_CODES` and `LIMITS` are deeply frozen metadata. No validator imports libraries, dispatches tools, reads mutable state, computes hashes, changes files or creates sessions. Inputs are plain JSON objects/arrays/scalars. Nonfinite numbers, accessors, sparse arrays, symbols, non-JSON prototypes and cycles reject before field inspection. Proxies are outside the JSON input contract. Validation has 48-level/30,000-node limits and returns at most 64 safe, structured errors.

## Domain authority and commit obligations

| Record/information | Owner | Required authenticated writer |
|---|---|---|
| Workspace identity/path map, domain head, business context | 3DJAT immutable files and atomic head | Human-approved domain writer |
| Accepted product dossiers, SKU index, notes and source references | Same file authority | Domain writer under narrow command scope; facts require human decision provenance |
| Original proposals and correction/supersession chains | Same file authority | Human, Conductor or proposal-only external source capability |
| Proposal decisions; template adoption/purpose/applicability | Same file authority | Actual human decision capability only |
| Template drafts/revisions | Same file authority; ingest does not adopt | Human, Conductor or source-proposer |
| Current domain cache | BVE SQLite, disposable **read-only cache** | Deterministic rebuild from verified files only |
| Frozen selected domain snapshots, attempts, jobs, imports, results, artifact decisions, calibration, statements/checkpoints/events/receipts | Existing BVE SQLite | Existing narrow operational authority plus future scoped additions |
| PNG originals | Existing immutable BVE original storage and independent intake | Deterministic verification, never the producing AI |
| Non-image attachment originals | Immutable business files plus domain manifest | Scoped registration; no execution/conversion |

J03 implements: exclusive local domain write lock; expected head revision **and hash** plus entity revision check; immutable revision/decision/receipt writes and flush; then one atomic same-filesystem `domain-head.json` replacement. The head publishes product, SKU, business, template and receipt indexes together. Before publication, new files are uncommitted orphans. Crash recovery uses verified heads/backups/receipts, never newest filenames. Path strings alone cannot establish junction/symlink containment or Windows flush/replace semantics. Concurrent multi-machine writers are unsupported.

An independent reader reads the head, verifies referenced bytes and hashes, then rechecks the head for a coherent view. No BVE, SQLite or AI session is needed to read accepted knowledge. Direct editing of accepted immutable revisions is corruption. New work requiring current facts blocks if current files are unavailable; a stale cache cannot supply authority. Historical frozen runs remain historical.

Operational calibration evidence commits in SQLite **before** domain template approval references its immutable receipt. There is no transaction spanning files and SQLite. Interruption leaves a completed experiment awaiting human approval. A domain decision cannot fabricate operational success. Domain receipts contain portable exact evidence references; absence of operational originals must remain visible. Combined backups quiesce domain writers/commissioning and verify domain-head/attachment/SQLite closure. Restore to a separate location and rebuild cache; never infer lost attempts/approvals from facts.

## Identity, facts and corrections

The product UUID is the BVE project UUID; display codes are separate. `productCode` is required and nullable, case-sensitive, unique when present within the workspace, 1–80 characters, with no numeric conversion or trimming. Leading zeros survive. `workingName` is required, 1–200 characters. `product.create` accepts an optional single note, with no photo, SKU, brief, staff, operation or generation prerequisite. Its committed dossier receives unknown facts, empty histories and a durable source receipt.

Facts are exactly `material`, `dimensions`, `sellingPrice`. `state=unknown` means `value=null`, `decision=null`; `not-applicable` means `value=null` with a decision reference; `accepted` means a typed nonnull value, at least one source reference, and a decision reference. Unknown is never numeric zero or filler text. Known zero price is `amount: "0"` with units/date/source/decision. Physical dimensions must be positive and include an explicit unit. Prices use decimal strings without sign/exponent/grouping, at most 16 integer and 6 fractional digits; `IRR/rial` and `IRT/toman` are distinct. Other supported currencies use `unit=major`. `per` specifies item/set/kg; `effectiveDate` is an actual calendar date. No implicit currency conversion or material inference from photographs.

Typed proposal paths are only `material`, `dimensions`, `sellingPrice`, `productCode`, `workingName`. They are field names, not JSON paths or arbitrary record updates. The latter two use the same source-backed change shape; an unknown/not-applicable productCode clears it to null, but a workingName cannot be cleared. Proposals are immutable pending claims; status is derived from append-only decisions, not an author-supplied flag. A proposal's `fact.state=accepted` describes its **proposed target state**, not an already accepted fact.

Edit keeps the original: submit a new proposal with `corrects` pointing to the original; record a `superseded` decision on the original with `correctedProposal` pointing to the correction; accept the corrected proposal through a separate human decision. Both immutable claims and all superseded decisions remain. The domain writer must commit the linked change coherently and check original/corrected references, product, current revision, actual human provenance and SKU index. JSON `actor`, `role`, `approved`, or `humanActionReceipt` supplied as an extra proposal field rejects. An authenticated capability creates decision receipts; possession of a well-formed reference is insufficient.

### Proposal authoring revision and current decision context

A proposal's `expectedRevision` preserves the dossier revision against which that immutable claim was authored. A decision's `expectedRevision` protects the **current** dossier revision. `validateCommand` still requires decision input, envelope `expected.entityRevision` and supplied `context.currentRevision` to agree, and checks the exact supplied current domain head. When `context.proposal` resolves the original, these outcome-specific relations apply:

| Decision outcome | Original proposal authoring revision | Correction |
|---|---|---|
| `accepted` | Equals current decision revision | Must be null; stale acceptance refuses |
| `rejected` | Less than or equal to current decision revision | Must be null; no fact installation is implied |
| `superseded` with correction | Less than or equal to current decision revision | Same product, current decision revision, distinct immutable proposal ID/ref, `corrects` equals exact original ref |
| `superseded` without correction | Equals current decision revision | No broader supersession policy |

Future original revisions always refuse. For example, an unchanged pending proposal authored at dossier 1 can be rejected at dossier 2 under current CAS, or superseded by a correction authored at dossier 2. Its original bytes remain unchanged. Accepting that original directly at dossier 2 still refuses; accepting the corrected proposal is a separate current-revision human decision. Proposal submission and rejection/supersession may advance the domain head without changing the accepted dossier revision; the semantic writer must define that publication/result behavior rather than manufacture dossier equality.

Supplied original/correction context uses the existing `{reference, record}` pairs. The original command ref must equal its supplied ref in ID/revision/path/hash; that ref's ID must equal the original record's `proposalId`, and its product must equal the decision's product. A correction ref must likewise equal its supplied ref and record ID; original/correction IDs must differ even if hashes or paths differ. Its `corrects` link must match all four original-ref fields, and its product and authoring revision must match the current decision. These checks compare supplied data only: resolving actual immutable bytes and their authenticity remains the writer's responsibility.

If a correction is requested with original context, missing correction context returns `MISSING_CONTEXT` at `$/context/correctedProposal`. A supplied correction context is checked even when original context is omitted. Supplying neither pair remains valid for portable authoring/historical shape checks; success with absent or partial context is not a resolved mutation gate. Runtime must supply both pairs for a corrected decision, authenticated human scope, current state and exact source/active-decision evidence under its lock. The validator cannot tell whether an older claim is pending, accepted or already superseded, or whether `supersedesDecision` still names an active decision. In particular, permission to reject an older pending claim does not authorize rewriting accepted facts or bypassing active-decision policy.

Reference/link/record-identity mismatches use `EVIDENCE_MISMATCH`; equal original/correction IDs or a correction on another outcome use `INVALID_REFERENCE`. Revision relation failures use `REVISION_CONFLICT` at `$/context/proposal/record/expectedRevision` or `$/context/correctedProposal/record/expectedRevision`. Context identity/product/link errors point to their actual `$/context/.../reference/id`, `record/productId` or `record/corrects` field; command-to-context ref mismatches point to `$/input/proposal` or `$/input/correctedProposal` (without `/input` for standalone record validation). Existing envelope/input CAS and caller/project-scope errors retain their paths. Stored record shapes, schema family/version, caller permissions and side-effect-free validation are unchanged; no migration or application workflow is introduced by these contextual semantics.

Local sources carry safe relative location, exact revision/hash, bounded page/cell/section locator and observation time. Drive sources carry file ID, exact revision, modification time, hash and locator. A changed source never rewrites accepted facts. Unverifiable extraction remains a proposal. Design/production/finishing records are dated, typed append-only entries with immutable references; notes have IDs/time/receipts.

## Templates, assessments and frozen operations

Initial stable template IDs/titles remain `basic-editing` / Basic Editing, `advanced-editing` / Advanced Editing, `creative-composition` / Creative Composition, `logo-placement` / Logo Placement, `instagram-output` / Instagram Post / Story Output, and `brand` / 3DJAT Brand. This change installs no template or brand doctrine. Stable IDs can also identify authored variants. Title changes are explicit reviewed metadata changes, not ID changes. Changed instructions require a new revision/hash; `supersedes` references an older revision of the same ID. The writer must verify revision advancement and immutable bytes.

Templates declare applicability, input roles/kinds, permitted creative changes and PNG output roles. Brand uses the same revision mechanism, has `kind=brand`, and declares zero outputs: it is an optional instruction template, never an executor. An operation declares at least one output role. There are no universal Light/Medium/Heavy controls, sequence interpreter, generic workflow language or automatic fidelity detector. Parameter types are enum, bounded number, boolean; presets are subsets of declared parameters with matching types/ranges. Missing selection keys are unspecified; a selected preset's keys must all appear with the same values. No implicit preset/default merge may alter a frozen run.

The four assessments are separate records, tied to the exact template reference:

| Dimension | Evidence and meaning |
|---|---|
| Contract validity | Validator version, valid/invalid outcome, error codes and receipt; not authoring flags |
| Operational acceptance | Actual run reference, executor ID, input hashes, pending/compatible/blocked outcome, blocker codes and preflight receipt |
| Visual testing | Untested/partial/tested record bound to committed experiment, exact variant outputs and corresponding receipts |
| Human approval | Append-only adopt/promote/reject/supersede decision with purpose, applicability, time and authenticated human action receipt |

Valid-but-blocked, adopted-but-untested, and tested-but-unapproved are valid combinations. Adoption expressly allows an untested revision without calling it tested. Promotion requires successful matching variant outputs, an experiment receipt and human scope. Neither success nor approval transfers to changed revision/hash/path. Revoked/superseded decisions remain historical; runtime resolves the latest applicable decision and verifies its authority. A stored shape cannot establish current adoption.

The operation envelope freezes the exact domain head, product revision/hash and selected accepted facts, operation revision/hash, optional Brand revision/hash and instruction text, user words, applicability, selection/preset, exact source artifacts, roles and normalized-original regions, outputs, execution kind/executor, parent lineage, allowance and canonical request. Source versions are positive integers; hashes/dimensions and product ownership are explicit. Regions retain existing `meaning` and optional `{reviewId,index}` association. Runtime must resolve submitted human region evidence and compare exact geometry; syntax cannot prove annotation authenticity. Historical parent artifacts are distinct from selected production inputs.

Brand defaults enabled when applicable in future request preparation. Missing default Brand returns “Brand setup needed” and blocks until a revision is selected or the human explicitly chooses unbranded. In a **resolved** envelope, `branded=false, brand=null, brandInstructions=null` records that explicit choice. Omission is invalid. Branded runs require all three fields to agree with the approved/adopted Brand context. Independent Fresh/Follow direction and Brand remain frozen; no direction implies a Brand choice.

The canonical request maps to existing `{direction, brand, count}`; `brand` equals `brandInstructions` and `count` equals the sum of requested outputs. There are 1–6 candidates, one primary attempt per output and `maxRetries=0`. Each channel result is a separate job even when multiple roles share a round. Successful feed plus failed story remains a partial round with independently usable/reviewable feed; no forced linear pipeline. Up to six unique selected production originals preserve the existing source limit. The downstream mapper flattens `source.artifact` into current source-reference fields without rewriting bytes, IDs, geometry or lineage.

Generative execution uses actual bound workers; deterministic execution uses a narrowly scoped service binding, not a fake LUNA session or extra AI staff. Execution results preserve job/assignment/run/product/round, output role, exact artifact, recipe hash/settings, tool/model/version, timings, nullable cost/usage, exit and failure information. Unknown telemetry remains null, never zero. A known cost is exactly `{amount, currency}` with the same bounded decimal-string syntax as price amounts, but is a separate telemetry type: USD/EUR amounts use the currency's major unit, IRR amounts use rial and IRT amounts use toman. It has no `unit`, `per` or `effectiveDate` fields. Known zero (`"0"`) and positive costs remain known; product-price currency/unit agreement applies only to the price schema, never to cost objects merely sharing `amount` and `currency`. Service dispatch, adapter allowlists, source verification, timeouts, staging confinement and actual intake are later work. Running/uncertain invocations never restart automatically; reconcile the original attempt first.

## Imports, attachments, calibration and candidate decisions

`historical-import` is an **import declaration**, not a verified PNG. It has `origin=import`, source/location/hash, actual historical kind/parent and optional historical-approval assertion with approver/date nullable when unknown. Its dedicated inbox must verify original bytes before commit. No fabricated generation job, assignment or attempt appears. `artifact-origin` is an explicit union: imported provenance references its import record; produced provenance references run/job/assignment/result. Every reader/export must handle both.

Historical approval is only `origin=historical`, with evidence. It cannot become new BVE acceptance. Human current editing/output decisions are separate. Legacy `design.accept` remains untouched; future displays interpret its unspecified purpose as `legacy-unspecified` rather than inventing publication readiness. New candidate decisions append retain/reject/accept-for-editing/approve-output, purpose, reason, exact artifact, optional channel and superseded decision. Output approval requires a channel. Rejection/supersession never deletes an original. Approved Content is derived from applicable human decisions, not a second manually writable list.

Current supported PNG policy remains **16,000,000 pixels, 24MiB encoded, 8-bit, non-interlaced**. This module only checks declared values. 20,000,000 pixels is a conditional proposed J05 IMG20 policy, not an enabled or verified decoder/commission ceiling. No byte decoding, ICC/profile validation or memory/performance claim is made here. The separate proposed attachment bound is 256MiB per file. Attachments preserve bytes/hash/MIME/path/availability and never become PNG artifacts merely because a hash is known. Registration cannot run macros, interpret models, invoke converters or execute attached content. J05 implements bounded actual reading, atomic object installation, orphan reconciliation and backup coverage.

Calibration fixes common product, source identities, request, settings, execution route/version, optional supported seed, changed instruction dimension and uncontrolled variables. Each variant binds its exact template and actual round/output/job/receipt references. Draft/ready/running/completed/partial/blocked/failed/reviewed are recorded honestly; completed requires successful outputs for all variants plus a committed experiment receipt. A failed or unavailable variant cannot supply tested-success evidence. Partial records retain valid sibling outputs. `calibration.create` only accepts draft variants with no execution outputs, rounds or receipt; authoring cannot manufacture empirical evidence. Actual output ownership, recipe/settings equality and receipts must be verified operationally. Human review may select only completed exact variants. Promotion is purpose/applicability-scoped and separate from adoption without calibration.

## Proposed command signatures

All names below are **future interfaces**, not currently callable APIs. Exact signature:

```text
command = {schemaVersion:"3djat.command.v1", operation, key, expected, input}
expected = {domainHead: RevisionRef|null, entityRevision: integer[0..2147483647]}
result = {schemaVersion:"3djat.result.v1", operation, key, receipt,
          owner, committedRevision, outputType, reference}
failure = {schemaVersion:"3djat.failure.v1", operation, key, error}
error = {code, path, recoverability, message, evidence: RevisionRef|null}
```

`reference` points to an immutable record of the table's exact output type; integrations resolve and validate that type before returning/presenting it. `receipt` binds the original command/key/payload fingerprint, exact committed head/entity references and outcome. A result's owner/outputType must match its operation. `committedRevision` identifies the owning domain's committed entity/snapshot revision; reads report the selected revision without creating a mutation. Domain export includes one head's complete revision/attachment/evidence closure and an optional operational backup identity, not private credentials.

`key` is a non-secret 1–80 character identifier. Each mutating command uses same-key/same-payload replay and changed-payload conflict, scoped by workspace/owner/operation and authenticated principal. Replay lookup precedes current-revision rejection so a previously committed identical request recovers its original receipt. For a new mutation, the owning runtime must check the exact expected head/hash and its own CAS entity under its lock/transaction; this introduces no file/SQLite distributed transaction. `expected.entityRevision` and trusted `context.currentRevision` refer to the same **existing subject in the table below**, never a selected product/template/artifact revision by inference.

`create` requires an absent entity (`0`), and any proposed `input.revision` must be `1`; `advance` requires proposed `input.revision = expected.entityRevision + 1`, allowing a new lineage/mapping at `0 → 1`. `existing` requires a positive revision. `append` protects an adoption pointer or candidate-decision-stream sequence, allowing its first human decision at `0`; it does not compare that sequence with the selected template/artifact version. Template decision `expectedRevision` therefore permits zero. Where present, `input.expectedRevision` is an expected **current** value and must equal the envelope expectation. References in the table explicitly marked current must have that revision as well. The exported `COMMANDS[operation].cas` gives `entity`, `identity` (input field path), `mode`, optional `proposedField`/`expectedField`/`expectedReference`, and `head` policy. An `existing` operation consumes a revision; it does not automatically create a new revision merely for reading/appending a separate event.

`context.currentHead=null` expressly means no domain head exists; omitted means not supplied/authoring-only, not absent. `expected.domainHead=null` is allowed only for initial workspace adoption with entity revision `0`, and must match supplied absent-head context. Initial connection to already prepared files may instead supply their exact existing head while the workspace-mapping CAS entity is absent. An existing mapping update requires a nonnull expected head. Other commands require a nonnull head. No retries of execution follow from receipt replay. `product.read` is an exact-head read with no mutation; `input.atHead` must equal `expected.domainHead`, and the selected product snapshot is its revision subject. Recheck the head before a current-view claim. Export is idempotent snapshot materialization; incomplete output returns `EXPORT_PENDING`. The pure validators compare only supplied state and cannot establish concurrency safety or durable receipt replay.

| Command | Existing CAS subject (input identity) | Proposed or expected revision rule |
|---|---|---|
| `product.create` | Product (`productId`) | Create at 0; writer assigns dossier revision 1 |
| `product.read` | Selected product (`productId`) | Existing positive dossier revision; exact `atHead` |
| `product.proposal.submit` | Product dossier (`productId`) | Existing; proposal `expectedRevision` equals current dossier |
| `product.proposal.decide` | Product dossier (`productId`) | Existing; decision `expectedRevision` equals current dossier |
| `product.note.add` | Product dossier (`productId`) | Existing; writer publishes next dossier revision with appended note |
| `template.ingest` | Template lineage (`templateId`) | Advance by exactly 1; `supersedes=null` at 0, else exact previous lineage revision/reference |
| `template.adopt` | Template adoption pointer (`template.id`) | Append; decision `expectedRevision` equals pointer sequence, not template revision |
| `operation.request` | New operational run (`runId`) | Create at 0; selected product/template/head revisions are frozen inputs |
| `operation.commission` | Existing operational run (`runId`) | Existing run-state revision; selected domain snapshots do not supply this CAS |
| `asset.import.stage` | New import (`importId`) | Create at 0; no synthetic generation attempt |
| `asset.import.commit` | Staged import (`importId`) | Existing staged-import state revision; stage receipt resolved independently |
| `attachment.register` | New attachment (`attachmentId`) | Create at 0; existing immutable identity cannot be overwritten |
| `calibration.create` | New experiment (`experimentId`) | Create at 0 with proposed revision 1 and only draft variants |
| `calibration.review` | Experiment (`experiment.id`) | Existing; `input.experiment.revision` equals current experiment revision |
| `template.promote` | Template adoption pointer (`template.id`) | Append; `expectedRevision` equals pointer sequence, independent of tested template revision |
| `candidate.decide` | Candidate decision stream (`artifact.artifactId`) | Append; first sequence 0 has no superseded decision; later append requires an exact prior-decision ref |
| `workspace.adopt` | Workspace mapping (`workspaceId`) | Advance by exactly 1; first mapping is 0 → 1 |
| `workspace.export` | Selected domain head (`workspaceId`) | Existing; `input.head` equals the exact expected head and its revision is the CAS subject |

Decision commands require exact proposal/template/current decision references and authenticated human actions. Edit uses the correction sequence above. A new decision has its own ID while `expectedRevision` protects the accepted product revision or current-template adoption-pointer sequence it affects; the operational candidate stream similarly has its own sequence independent of immutable artifact version. Supersession requires the owning runtime to check the exact prior decision is still applicable and belongs to the same subject/scope. Template ingestion's supplied prior-template context must match the predecessor's exact reference, ID and revision; the domain writer verifies actual immutable bytes. Template and product creation/ingestion never silently replace existing immutable revisions. Operational commission delegates to existing request/round/job/attempt primitives and preserves stricter once-only start: duplicate invocation start rejects even with the original key.

All commands share the failure schema. Codes distinguish invalid input from unavailable capability/source, uncertain attempt, import conflict and incomplete export. Failures before durable ownership is acquired may have `evidence=null`; after a durable failed operation, preserve an immutable failure evidence reference and receipt in the owning store. Do not replace a failure with approval or erase partial outputs.

| Command | Owner | Authenticated capabilities | Input → referenced output |
|---|---|---|---|
| `product.create` | domain | human | `product.create.input` → `product` |
| `product.read` | domain | human, conductor, butler, source-reader | `product.read.input` → `product` |
| `product.proposal.submit` | domain | human, conductor, source-proposer | `proposal` → `proposal` |
| `product.proposal.decide` | domain | human | `proposal-decision` → `product` |
| `product.note.add` | domain | human, conductor | `product.note.add.input` → `product` |
| `template.ingest` | domain | human, conductor, source-proposer | `template` → `template` |
| `template.adopt` | domain | human | `template-decision` → `template-decision` |
| `operation.request` | operational | human | `operation-run` → `operation-run` |
| `operation.commission` | operational | conductor | `operation-run` → `operation-run` |
| `asset.import.stage` | operational | human, conductor | `historical-import` → `historical-import` |
| `asset.import.commit` | operational | human, conductor | `asset.import.commit.input` → `artifact-ref` |
| `attachment.register` | domain | human, conductor | `attachment` → `attachment` |
| `calibration.create` | operational | human, conductor | `calibration` → `calibration` |
| `calibration.review` | operational | human | `calibration-review` → `calibration-review` |
| `template.promote` | domain | human | `template-decision` → `template-decision` |
| `candidate.decide` | operational | human | `candidate-decision` → `candidate-decision` |
| `workspace.adopt` | domain | human | `workspace` → `workspace` |
| `workspace.export` | domain | human | `workspace.export.input` → `export-manifest` |

## Errors, exact types and bounds

Errors use stable codes and `$`-rooted field paths, bounded to 512 characters. Messages are safe generic descriptions (maximum 200 characters), not copies of source/private text. Recoverability is one of correct-input, refresh, supply-source, wait, manual-review. The pure implementation emits refresh for revision conflicts, supply-source for missing source and correct-input otherwise; future runtime failures choose the appropriate documented value. Context failures are rooted under `$/context`. Array indices are decimal path segments. Unknown-field keys are reported as field path segments; input keys must not contain sensitive material.

| Code | Meaning |
|---|---|
| `UNSUPPORTED_SCHEMA` | Unsupported or missing schema version |
| `UNKNOWN_FIELD` | Field outside closed schema |
| `INVALID_TYPE` | Incorrect JSON type |
| `INVALID_VALUE` | Invalid enum/discriminator or incompatible declared value |
| `OUT_OF_BOUNDS` | Length/count/number or region outside bounds |
| `INVALID_REFERENCE` | Malformed identifier/hash/date/locator or broken declared reference |
| `UNSAFE_PATH` | Unsafe relative path syntax |
| `REVISION_CONFLICT` | Stale head/entity/pointer revision; refresh and re-review |
| `SKU_CONFLICT` | Duplicate nonnull productCode in supplied index |
| `MISSING_CONTEXT` | Resolved operation/evidence context missing |
| `MISSING_SOURCE` | Required declared input missing |
| `HASH_MISMATCH` | Exact supplied reference/hash/snapshot mismatch |
| `UNSUPPORTED_IMAGE` | Declared image exceeds current policy; actual decode is later |
| `CAPABILITY_UNAVAILABLE` | Runtime: required verified executor/tool missing |
| `ATTEMPT_UNCERTAIN` | Runtime: reconcile existing invocation; never retry automatically |
| `IMPORT_CONFLICT` | Runtime: same import identity with conflicting bytes |
| `IDEMPOTENCY_CONFLICT` | Runtime: same scoped key with changed payload |
| `EXPORT_PENDING` | Runtime: snapshot materialization incomplete |
| `INVALID_SCOPE` | Caller/request/canonical/product/role mismatch |
| `BRAND_SETUP_NEEDED` | No resolved applicable Brand for branded request |
| `INVALID_SELECTION` | Unknown parameter/preset or incompatible value/type/range |
| `OUTPUT_COUNT` | Total outputs/canonical count/primary allowance disagree |
| `EVIDENCE_MISMATCH` | Declared evidence does not bind the exact record/outcome |
| `NON_PORTABLE` | Not plain JSON; accessors/cycles/unsupported values |
| `VALIDATION_LIMIT` | Depth/node/collection guard exceeded |
| `UNKNOWN_CONTRACT` | Unknown validator contract kind |

The complete structural grammar below is normative together with the invariants above and executable `CONTRACT_SHAPES`. Every object is closed. All fields are required unless marked `?`; omitted is distinct from null. `T|null` explicitly allows null. Arrays show inclusive item count bounds; maps are closed to arbitrary **values** except their declared value schema and permit only 1–80 character identifier keys, excluding `__proto__`, `prototype`, `constructor`. Parameter/preset/settings map keys also reject execution/capability names after removing underscores/hyphens and folding case: shell, shellcommand, shellscript, exec, command, commandline, executable, argv, credential, credentials, password, token, permissions, permissionescalation, provider, budget, staff, tool, sourceaccess. This is a field-boundary rule, not prose-intent analysis. There are no untyped JSON blobs. Strings count JavaScript UTF-16 code units, must contain non-whitespace, and are neither trimmed nor normalized. Arrays default to at most 256 items; each explicit smaller bound is shown. Integers are exact safe positive revisions unless a different interval is stated. Finite numbers only.

Patterns: UUID is lowercase canonical RFC-style UUID with version 1–8 and RFC variant; SHA-256 and commit are lowercase 64/40 hex. Identifiers match `[A-Za-z0-9][A-Za-z0-9._-]*`. Dates/timestamps are real ISO calendar values (`YYYY-MM-DD`, or UTC `YYYY-MM-DDTHH:mm:ss.sssZ`). Cell ranges are uppercase A1 or A1:C2, 1–3 column letters and 1–7 digit positive row numbers. MIME is lowercase `type/subtype` with alphanumeric/dot/plus/hyphen. Safe paths are nonempty relative POSIX separators; reject absolute/drive/UNC forms, backslashes, percent encoding, colon/ADS, Windows metacharacters, controls, empty/dot/parent segments, trailing dots/spaces and reserved device components. These restrictions do not prove filesystem containment. Filenames forbid separators, encoding/ADS/metacharacters/controls, dot/parent and trailing dot/space.

### revision-ref

```text
revision-ref = { id: string[1..80] /identifier; revision: integer[1..2147483647]; sha256: string[64..64] /sha256; path: string[1..512] /path }
```

### template-ref

```text
template-ref = { id: string[1..80] /identifier; revision: integer[1..2147483647]; sha256: string[64..64] /sha256; path: string[1..512] /path }
```

### locator

```text
locator = union on kind:
  page: { kind: "page"; page: integer[1..100000]; section?: string[1..500] }
  cells: { kind: "cells"; sheet: string[1..100]; range: string[1..40] /range }
  section: { kind: "section"; section: string[1..500] }
```

### source-ref

```text
source-ref = union on kind:
  file: { kind: "file"; sourceId: string[1..80] /identifier; revision: string[1..200]; sha256: string[64..64] /sha256; location: string[1..512] /path; locator: locator; observedAt: string[24..24] /timestamp }
  drive: { kind: "drive"; sourceId: string[1..80] /identifier; revision: string[1..200]; sha256: string[64..64] /sha256; fileId: string[1..200] /identifier; modifiedAt: string[24..24] /timestamp; locator: locator; observedAt: string[24..24] /timestamp }
```

### dimensions

```text
dimensions = { length: number[5e-324..1000000000]; width: number[5e-324..1000000000]; height: number[5e-324..1000000000]; unit: "mm" | "cm" | "m" | "in" }
```

### price

```text
price = { amount: string[1..24] /decimal; currency: "IRR" | "IRT" | "USD" | "EUR" | "GBP" | "AED"; unit: "rial" | "toman" | "major"; per: "item" | "set" | "kg"; effectiveDate: string[10..10] /date }
```

### facts

```text
facts = { material: union on state:
  unknown: { state: "unknown"; value: null; sourceRefs: Array[0..16]<source-ref>; decision: null }
  accepted: { state: "accepted"; value: string[1..500]; sourceRefs: Array[1..16]<source-ref>; decision: revision-ref }
  not-applicable: { state: "not-applicable"; value: null; sourceRefs: Array[0..16]<source-ref>; decision: revision-ref }; dimensions: union on state:
  unknown: { state: "unknown"; value: null; sourceRefs: Array[0..16]<source-ref>; decision: null }
  accepted: { state: "accepted"; value: dimensions; sourceRefs: Array[1..16]<source-ref>; decision: revision-ref }
  not-applicable: { state: "not-applicable"; value: null; sourceRefs: Array[0..16]<source-ref>; decision: revision-ref }; sellingPrice: union on state:
  unknown: { state: "unknown"; value: null; sourceRefs: Array[0..16]<source-ref>; decision: null }
  accepted: { state: "accepted"; value: price; sourceRefs: Array[1..16]<source-ref>; decision: revision-ref }
  not-applicable: { state: "not-applicable"; value: null; sourceRefs: Array[0..16]<source-ref>; decision: revision-ref } }
```

### dossier-entry

```text
dossier-entry = { id: string[36..36] /uuid; date: string[10..10] /date; kind: "design" | "production" | "finishing"; title: string[1..200]; references: Array[1..16]<revision-ref>; sourceRefs: Array[0..16]<source-ref> }
```

### note

```text
note = { id: string[36..36] /uuid; text: string[1..20000]; createdAt: string[24..24] /timestamp; receipt: revision-ref }
```

### workspace

```text
workspace = { schemaVersion: "3djat.workspace.v1"; workspaceId: string[36..36] /uuid; revision: integer[1..2147483647]; domainHead: revision-ref; paths: { business: string[1..512] /path; products: string[1..512] /path; templates: string[1..512] /path; operations: string[1..512] /path }; contractVersion: "3djat.v1"; sourceCommit: string[40..40] /commit }
```

### domain-head

```text
domain-head = { schemaVersion: "3djat.domain-head.v1"; workspaceId: string[36..36] /uuid; revision: integer[1..2147483647]; previousHead: revision-ref | null; products: Array[0..256]<{ productId: string[36..36] /uuid; dossier: revision-ref }>; skus: Array[0..256]<{ productCode: string[1..80]; productId: string[36..36] /uuid }>; business: revision-ref | null; templates: Array[0..256]<template-ref>; receipts: Array[0..256]<revision-ref> }
```

### product

```text
product = { schemaVersion: "3djat.product.v1"; productId: string[36..36] /uuid; revision: integer[1..2147483647]; productCode: string[1..80] | null; workingName: string[1..200]; facts: facts; designRevisions: Array[0..256]<dossier-entry>; productionRecords: Array[0..256]<dossier-entry>; finishingRecords: Array[0..256]<dossier-entry>; attachments: Array[0..256]<revision-ref>; notes: Array[0..256]<note>; sourceReceipt: revision-ref }
```

### business-context

```text
business-context = { schemaVersion: "3djat.business-context.v1"; workspaceId: string[36..36] /uuid; revision: integer[1..2147483647]; instructions: string[1..20000]; sourceRefs: Array[1..16]<source-ref>; decision: revision-ref; sourceReceipt: revision-ref }
```

### change

```text
change = union on field:
  material: { field: "material"; fact: union on state:
  accepted: { state: "accepted"; value: string[1..500]; sourceRefs: Array[1..16]<source-ref> }
  unknown: { state: "unknown"; value: null; sourceRefs: Array[0..16]<source-ref> }
  not-applicable: { state: "not-applicable"; value: null; sourceRefs: Array[0..16]<source-ref> } }
  dimensions: { field: "dimensions"; fact: union on state:
  accepted: { state: "accepted"; value: dimensions; sourceRefs: Array[1..16]<source-ref> }
  unknown: { state: "unknown"; value: null; sourceRefs: Array[0..16]<source-ref> }
  not-applicable: { state: "not-applicable"; value: null; sourceRefs: Array[0..16]<source-ref> } }
  sellingPrice: { field: "sellingPrice"; fact: union on state:
  accepted: { state: "accepted"; value: price; sourceRefs: Array[1..16]<source-ref> }
  unknown: { state: "unknown"; value: null; sourceRefs: Array[0..16]<source-ref> }
  not-applicable: { state: "not-applicable"; value: null; sourceRefs: Array[0..16]<source-ref> } }
  productCode: { field: "productCode"; fact: union on state:
  accepted: { state: "accepted"; value: string[1..80]; sourceRefs: Array[1..16]<source-ref> }
  unknown: { state: "unknown"; value: null; sourceRefs: Array[0..16]<source-ref> }
  not-applicable: { state: "not-applicable"; value: null; sourceRefs: Array[0..16]<source-ref> } }
  workingName: { field: "workingName"; fact: union on state:
  accepted: { state: "accepted"; value: string[1..200]; sourceRefs: Array[1..16]<source-ref> }
  unknown: { state: "unknown"; value: null; sourceRefs: Array[0..16]<source-ref> }
  not-applicable: { state: "not-applicable"; value: null; sourceRefs: Array[0..16]<source-ref> } }
```

### proposal

```text
proposal = { schemaVersion: "3djat.proposal.v1"; proposalId: string[36..36] /uuid; productId: string[36..36] /uuid; expectedRevision: integer[1..2147483647]; changes: Array[1..5]<change>; reason: string[1..20000]; corrects: revision-ref | null }
```

### proposal-decision

```text
proposal-decision = { schemaVersion: "3djat.proposal-decision.v1"; decisionId: string[36..36] /uuid; productId: string[36..36] /uuid; proposal: revision-ref; expectedRevision: integer[1..2147483647]; outcome: "accepted" | "rejected" | "superseded"; reason: string[1..20000]; decidedAt: string[24..24] /timestamp; humanActionReceipt: revision-ref; supersedesDecision: revision-ref | null; correctedProposal: revision-ref | null }
```

### parameter

```text
parameter = union on type:
  enum: { type: "enum"; values: Array[1..24]<string[1..100]> }
  number: { type: "number"; min: number[-1000000000..1000000000]; max: number[-1000000000..1000000000] }
  boolean: { type: "boolean" }
```

### selection-value

```text
selection-value = boolean | finite number[-1e9..1e9] | string[1..500]
```

### selection

```text
selection = Map[0..24]<identifier, selection-value>
```

### input-declaration

```text
input-declaration = { role: string[1..80] /identifier; kind: "verified-image" | "attachment"; required: true | false }
```

### output-declaration

```text
output-declaration = { role: string[1..80] /identifier; format: "image/png" }
```

### template

```text
template = { schemaVersion: "3djat.template.v1"; templateId: string[1..80] /identifier; revision: integer[1..2147483647]; title: string[1..200]; kind: "operation" | "brand"; appliesTo: Array[1..24]<string[1..80] /identifier>; instructions: string[1..20000]; inputs: Array[0..24]<input-declaration>; allowedChanges: Array[0..24]<string[1..500]>; outputs: Array[0..6]<output-declaration>; exploration?: { parameters: Map[0..24]<identifier, parameter>; presets: Map[0..24]<identifier, selection> }; sourceRefs: Array[0..16]<source-ref>; supersedes: template-ref | null }
```

### region

```text
region = { space: "normalized-original"; x: number[0..1]; y: number[0..1]; w: number[5e-324..1]; h: number[5e-324..1]; meaning: string[1..2000]; reviewRegion?: { reviewId: string[36..36] /uuid; index: integer[0..23] } }
```

### artifact-ref

```text
artifact-ref = { productId: string[36..36] /uuid; artifactId: string[36..36] /uuid; version: integer[1..2147483647]; sha256: string[64..64] /sha256; width: integer[1..16000000]; height: integer[1..16000000] }
```

### source-artifact

```text
source-artifact = { artifact: artifact-ref; role: string[1..80] /identifier; regions: Array[0..24]<region> }
```

### allowance

```text
allowance = { primaryAttempts: integer[1..6]; maxRetries: 0 }
```

### canonical

```text
canonical = { direction: "Fresh" | "Follow"; brand: string[1..20000] | null; count: integer[1..6] }
```

### operation-run

```text
operation-run = { schemaVersion: "3djat.operation-run.v1"; runId: string[36..36] /uuid; productId: string[36..36] /uuid; domainHead: revision-ref; product: revision-ref; template: template-ref; brand: template-ref | null; branded: true | false; brandInstructions: string[1..20000] | null; applicability: string[1..80] /identifier; intent: string[1..20000]; direction: "Fresh" | "Follow"; selection: selection; preset: string[1..80] /identifier | null; acceptedFacts: facts; sources: Array[0..6]<source-artifact>; attachments: Array[0..24]<{ reference: revision-ref; role: string[1..80] /identifier }>; requestedOutputs: Array[1..6]<{ role: string[1..80] /identifier; count: integer[1..6] }>; executionKind: "generative" | "deterministic"; executorId: string[1..80] /identifier; parentRoundId: string[36..36] /uuid | null; parentArtifacts: Array[0..24]<artifact-ref>; allowance: allowance; canonical: canonical }
```

### contract-assessment

```text
contract-assessment = { schemaVersion: "3djat.contract-assessment.v1"; assessmentId: string[36..36] /uuid; template: template-ref; outcome: "valid" | "invalid"; validatorVersion: "3djat.v1"; errorCodes: Array[0..64]<string[1..80] /identifier>; receipt: revision-ref }
```

### operational-assessment

```text
operational-assessment = { schemaVersion: "3djat.operational-assessment.v1"; assessmentId: string[36..36] /uuid; template: template-ref; run: revision-ref; executorId: string[1..80] /identifier; inputHashes: Array[0..48]<string[64..64] /sha256>; outcome: "pending" | "compatible" | "blocked"; blockers: Array[0..24]<"MISSING_SOURCE" | "HASH_MISMATCH" | "CAPABILITY_UNAVAILABLE" | "INVALID_SCOPE" | "BRAND_SETUP_NEEDED">; receipt: revision-ref }
```

### visual-assessment

```text
visual-assessment = { schemaVersion: "3djat.visual-assessment.v1"; assessmentId: string[36..36] /uuid; template: template-ref; status: "untested" | "partial" | "tested"; experiment: revision-ref | null; outputs: Array[0..24]<artifact-ref>; receipts: Array[0..24]<revision-ref> }
```

### template-decision

```text
template-decision = { schemaVersion: "3djat.template-decision.v1"; decisionId: string[36..36] /uuid; template: template-ref; action: "adopt" | "promote" | "reject" | "supersede"; purpose: string[1..500]; appliesTo: Array[1..24]<string[1..80] /identifier>; expectedRevision: integer[0..2147483647]; experiment: revision-ref | null; outputs: Array[0..24]<artifact-ref>; evidenceReceipt: revision-ref | null; humanActionReceipt: revision-ref; decidedAt: string[24..24] /timestamp; supersedesDecision: revision-ref | null; reason: string[1..20000] }
```

### template-assessments

```text
template-assessments = { schemaVersion: "3djat.template-assessments.v1"; template: template-ref; contract: contract-assessment; operational: operational-assessment | null; visual: visual-assessment; human: template-decision | null }
```

### historical-approval

```text
historical-approval = { origin: "historical"; claimedApprover: string[1..200] | null; claimedAt: string[10..10] /date | null; evidence: Array[1..16]<source-ref> }
```

### historical-import

```text
historical-import = { schemaVersion: "3djat.historical-import.v1"; importId: string[36..36] /uuid; productId: string[36..36] /uuid; origin: "import"; kind: "historical-base" | "historical-creative"; filename: string[1..255] /filename; source: source-ref; sha256: string[64..64] /sha256; encodedBytes: integer[1..25165824]; format: "image/png"; width: integer[1..16000000]; height: integer[1..16000000]; bitDepth: 8; interlaced: false; historicalParent: artifact-ref | null; historicalApproval: historical-approval | null; importedAt: string[24..24] /timestamp }
```

### attachment

```text
attachment = { schemaVersion: "3djat.attachment.v1"; attachmentId: string[36..36] /uuid; productId: string[36..36] /uuid; sha256: string[64..64] /sha256; location: string[1..512] /path; filename: string[1..255] /filename; mime: string[3..100] /mime; bytes: integer[1..268435456]; availability: "available" | "missing" | "unverified"; source: source-ref }
```

### calibration-output

```text
calibration-output = { variant: template-ref; artifact: artifact-ref; jobId: string[36..36] /uuid; receipt: revision-ref }
```

### calibration-variant

```text
calibration-variant = { template: template-ref; roundId: string[36..36] /uuid | null; outcome: "draft" | "ready" | "running" | "completed" | "partial" | "blocked" | "failed"; outputs: Array[0..6]<calibration-output>; failureCode: string[1..80] /identifier | null }
```

### calibration

```text
calibration = { schemaVersion: "3djat.calibration.v1"; experimentId: string[36..36] /uuid; productId: string[36..36] /uuid; revision: integer[1..2147483647]; lifecycle: "draft" | "ready" | "running" | "completed" | "partial" | "blocked" | "failed" | "reviewed"; commonSources: Array[1..24]<artifact-ref>; commonIntent: string[1..20000]; commonSettings: selection; seed: integer[0..2147483647] | null; executorId: string[1..80] /identifier; executorVersion: string[1..200]; changedDimension: string[1..500]; uncontrolledVariables: Array[0..24]<string[1..500]>; variants: Array[1..6]<calibration-variant>; receipt: revision-ref | null }
```

### calibration-review

```text
calibration-review = { schemaVersion: "3djat.calibration-review.v1"; reviewId: string[36..36] /uuid; experiment: revision-ref; comments: string[1..20000]; selectedVariants: Array[0..6]<template-ref>; humanActionReceipt: revision-ref; reviewedAt: string[24..24] /timestamp }
```

### candidate-decision

```text
candidate-decision = { schemaVersion: "3djat.candidate-decision.v1"; decisionId: string[36..36] /uuid; productId: string[36..36] /uuid; artifact: artifact-ref; action: "retain" | "reject" | "accept-for-editing" | "approve-output"; purpose: string[1..500]; channel: string[1..80] /identifier | null; reason: string[1..20000]; decidedAt: string[24..24] /timestamp; humanActionReceipt: revision-ref; supersedesDecision: revision-ref | null }
```

### execution-result

```text
execution-result = { schemaVersion: "3djat.execution-result.v1"; runId: string[36..36] /uuid; productId: string[36..36] /uuid; roundId: string[36..36] /uuid; jobId: string[36..36] /uuid; assignmentId: string[36..36] /uuid; outputRole: string[1..80] /identifier; outcome: "succeeded" | "partial" | "failed" | "uncertain"; executorKind: "worker" | "service"; executorId: string[1..80] /identifier; artifact: artifact-ref | null; receipt: revision-ref; recipeHash: string[64..64] /sha256 | null; parameters: selection; tool: string[1..200] | null; model: string[1..200] | null; version: string[1..200] | null; startedAt: string[24..24] /timestamp; finishedAt: string[24..24] /timestamp | null; cost: { amount: string[1..24] /decimal; currency: "USD" | "EUR" | "IRR" | "IRT" } | null; usage: { inputUnits: integer[0..1000000000000]; outputUnits: integer[0..1000000000000]; unit: string[1..80] /identifier } | null; exitCode: integer[-255..255] | null; failureCode: string[1..80] /identifier | null }
```

### artifact-origin

```text
artifact-origin = { schemaVersion: "3djat.artifact-origin.v1"; artifact: artifact-ref; provenance: union on origin:
  import: { origin: "import"; importRecord: revision-ref }
  produced: { origin: "produced"; run: revision-ref; jobId: string[36..36] /uuid; assignmentId: string[36..36] /uuid; result: revision-ref } }
```

### readiness-role

```text
readiness-role = { role: "conductor" | "butler"; requestedTier: "SOL" | "LUNA"; sessionId: string[1..200]; instructionHash: string[64..64] /sha256; acknowledgement: revision-ref; modelEvidence: revision-ref; resumeEvidence: revision-ref }
```

### readiness

```text
readiness = { schemaVersion: "3djat.readiness.v1"; workspaceId: string[36..36] /uuid; stage: "pre-install" | "post-install"; definitionEvidence: Array[1..16]<revision-ref>; provisioning: "pass" | "blocked" | "exception-required" | "exception-approved"; roles: Array[0..2]<readiness-role>; roundTrip: revision-ref | null; workerCount: 0; imageCalls: 0; exception: { dependency: string[1..500]; observedFailure: revision-ref; alternatives: Array[1..16]<string[1..500]>; prerequisites: Array[1..16]<revision-ref>; postInstallAction: string[1..20000]; owner: string[1..200]; acceptanceTest: string[1..20000]; approvalReceipt: revision-ref | null } | null }
```

### expected

```text
expected = { domainHead: revision-ref | null; entityRevision: integer[0..2147483647] }
```

### export-manifest

```text
export-manifest = { schemaVersion: "3djat.export-manifest.v1"; workspaceId: string[36..36] /uuid; head: revision-ref; revisions: Array[0..256]<revision-ref>; attachments: Array[0..256]<revision-ref>; operationalBackup: revision-ref | null; evidence: Array[0..256]<revision-ref> }
```

### handoff

```text
handoff = { schemaVersion: "3djat.handoff.v1"; workspaceId: string[36..36] /uuid; target: "conductor" | "butler" | "worker" | "domain-writer"; command: command; references: Array[0..64]<revision-ref>; expiresAt: string[24..24] /timestamp }
```

### error

```text
error = { code: "UNSUPPORTED_SCHEMA" | "UNKNOWN_FIELD" | "INVALID_TYPE" | "INVALID_VALUE" | "OUT_OF_BOUNDS" | "INVALID_REFERENCE" | "UNSAFE_PATH" | "REVISION_CONFLICT" | "SKU_CONFLICT" | "MISSING_CONTEXT" | "MISSING_SOURCE" | "HASH_MISMATCH" | "UNSUPPORTED_IMAGE" | "CAPABILITY_UNAVAILABLE" | "ATTEMPT_UNCERTAIN" | "IMPORT_CONFLICT" | "IDEMPOTENCY_CONFLICT" | "EXPORT_PENDING" | "INVALID_SCOPE" | "BRAND_SETUP_NEEDED" | "INVALID_SELECTION" | "OUTPUT_COUNT" | "EVIDENCE_MISMATCH" | "NON_PORTABLE" | "VALIDATION_LIMIT" | "UNKNOWN_CONTRACT"; path: string[1..512]; recoverability: "correct-input" | "refresh" | "supply-source" | "wait" | "manual-review"; message: string[1..200]; evidence: revision-ref | null }
```

### result

```text
result = { schemaVersion: "3djat.result.v1"; operation: "product.create" | "product.read" | "product.proposal.submit" | "product.proposal.decide" | "product.note.add" | "template.ingest" | "template.adopt" | "operation.request" | "operation.commission" | "asset.import.stage" | "asset.import.commit" | "attachment.register" | "calibration.create" | "calibration.review" | "template.promote" | "candidate.decide" | "workspace.adopt" | "workspace.export"; key: string[1..80] /identifier; receipt: revision-ref; owner: "domain" | "operational"; committedRevision: integer[1..2147483647]; outputType: "product" | "proposal" | "template" | "template-decision" | "operation-run" | "historical-import" | "artifact-ref" | "attachment" | "calibration" | "calibration-review" | "candidate-decision" | "workspace" | "export-manifest"; reference: revision-ref }
```

### failure

```text
failure = { schemaVersion: "3djat.failure.v1"; operation: "product.create" | "product.read" | "product.proposal.submit" | "product.proposal.decide" | "product.note.add" | "template.ingest" | "template.adopt" | "operation.request" | "operation.commission" | "asset.import.stage" | "asset.import.commit" | "attachment.register" | "calibration.create" | "calibration.review" | "template.promote" | "candidate.decide" | "workspace.adopt" | "workspace.export"; key: string[1..80] /identifier; error: error }
```

### context

```text
context = { currentRevision?: integer[0..2147483647]; currentHead?: revision-ref | null; projectId?: string[36..36] /uuid; skus?: Array[0..256]<{ productCode: string[1..80]; productId: string[36..36] /uuid }>; authenticatedCaller?: "human" | "conductor" | "butler" | "source-reader" | "source-proposer" | "worker" | "service"; proposal?: { reference: revision-ref; record: proposal }; correctedProposal?: { reference: revision-ref; record: proposal }; experiment?: { reference: revision-ref; record: calibration }; template?: { reference: template-ref; record: template }; product?: { reference: revision-ref; record: product }; head?: { reference: revision-ref; record: domain-head }; canonical?: canonical; brand?: { reference: template-ref; record: template; decision: template-decision } }
```

### product.create.input

```text
{ productId: string[36..36] /uuid; productCode: string[1..80] | null; workingName: string[1..200]; note?: string[1..20000] }
```

### product.read.input

```text
{ productId: string[36..36] /uuid; atHead: revision-ref }
```

### product.note.add.input

```text
{ productId: string[36..36] /uuid; text: string[1..20000] }
```

### asset.import.commit.input

```text
{ importId: string[36..36] /uuid; stageReceipt: revision-ref; sha256: string[64..64] /sha256 }
```

### workspace.export.input

```text
{ workspaceId: string[36..36] /uuid; head: revision-ref; includeAttachments: true | false }
```

## Readiness and downstream gates

Readiness definitions and **actual sessions** are separate evidence. The readiness record references role instruction evidence plus actual Conductor/Butler session identities, independent acknowledgements, model and resume evidence, and a harmless real round-trip receipt. Pre-install provisioning requires one SOL Conductor and one LUNA Butler, distinct sessions, zero workers and zero images. Role files and requested tier labels cannot establish pass. Only BVE-dependent bearer binding/host.resume/first product round normally wait until installation. An installation-dependent host exception records the exact dependency/failure, alternatives, completed prerequisites, minimum post-install action, owner, acceptance test and explicit human/orchestration approval receipt. `exception-required` never means pass; absent support without a demonstrated dependency remains blocked. BVE remains the final production provisioning step. J01 starts no session and changes no role behavior.

| Later owner | Acceptance obligation not established by these tests |
|---|---|
| J02/J12 | Actual supported sessions, verified identity/model/ack/resume, exception authority, non-generation return, browser and notification behavior |
| J03 | File/Windows atomicity, locks/CAS, immutable hash verification, symlink/junction containment, orphan recovery, backup closure/restore and migration refusal |
| J04 | Authenticated human/source boundary, real proposal correction transaction, SKU uniqueness under concurrent writes |
| J05 | Real import/attachment bytes, independent PNG decode/profile/hash preservation, 20MP IMG20 performance/memory/crash gates |
| J06/J07/J12 | P1122-COLD with full stop/fresh browser/replacement session, independent file read, cache rebuild and original hashes |
| J07–J10 | Current template/applicability resolution, verified adapter scope, once-only attempt execution, partial results, private staging and native original return |
| J11 | Actual empirical calibration and human visual/purpose-specific promotion; two-store interruption recovery |

Templates and source prose remain Conductor instructions **as data**. Effective scope is the intersection of the user's request, installed verified adapter policy and validated job contract. Unknown shell/credential/escalation/tool/provider/budget fields reject; permitted prose is not interpreted as shell or executable code. Keyword filtering cannot prove arbitrary prose intent or protect secrets embedded in ordinary text. Portable packets MUST exclude private credentials; authentic capability material is provisioned separately and never exported. Every source/tool/provider/staff/budget/human-decision action still passes runtime authorization.

## Contract decisions and illustrative-plan deltas

| Decision | Reason / review consequence |
|---|---|
| Retain all 18 proposed command names | No downstream worker must choose new names; no dispatcher added |
| Uniform `{id,revision,sha256,path}` immutable refs, required explicit nullable fields | Exact independent-file resolution and no ambiguous omission |
| Explicit fact `decision`, domain head, acceptedFacts, branded choice, allowance and canonical fields | Complete the illustrative shapes without changing business/file versus operational/SQLite ownership |
| `IRT/toman`, `IRR/rial`; decimal strings; explicit dates/units | No currency ambiguity or numeric loss; all values in tests fictional |
| Two entry levels plus resolved-operation/evidence gates | Shape-only history remains readable while actual use/evidence requires supplied records and runtime verification |
| Correction is a linked new proposal plus supersession and separate acceptance | Original source claim and all decisions remain immutable |
| Portable workspace has relative path map; absolute approved master/runtime root stays in private host configuration | Avoid transporting personal paths; J03/J12 validate local binding to this workspace ID |
| Maps/arrays bounded; head indexes capped at 256 entries in v1 | A bounded local pilot; receipts may link previous heads for older history. Larger indexes require a reviewed contract revision, never silent truncation |
| No template sequence interpreter or universal exploration controls | Freeze bounded operation metadata only; future composite steps need a separately reviewed extension |
| Source refs capped at six, regions use existing meaning/reviewRegion | Preserve the executable upstream source contract, not the illustrative absence of bounds |
| 16MP remains effective; 20MP marked proposed; attachment 256MiB separate | No limit increase or unrun IMG20 claim |
| Result points to typed immutable output; credentials never part of portable command | Narrow return contract without arbitrary update payloads or capability transport |
| Command-specific CAS subjects and proposed revision advancement; explicit absent-head context | Initial creation/adoption and next template revision work with authenticated current-state context; nested snapshot versions are not current-state CAS values |
| Product-price unit checks bind only the price type; cost remains `{amount,currency}` | Known cost telemetry accepts zero/positive values without weakening the closed price or cost schema |

No authority boundary or operational kernel ownership is changed. No migration, installation, runtime workflow, current candidate acceptance, release claim, native session, model/image call or human approval is supplied by J01. Public fixtures are independently written fictional product examples, plus inline authored contract examples; hashes/IDs are placeholders with no byte-integrity claim. The private planning package and source assets are not copied into this repository.

Validation commands: `node --test test/3djat-contracts.test.mjs`, then unchanged `npm test` on Node 24.x. Browser/native/image tests are outside pure J01 scope. Independent review, not a passing test suite or draft PR, freezes this baseline.
