# Current operating contracts

The additive [3DJAT v1 contracts](3DJAT-CONTRACTS.md) define versioned domain-file and operational interfaces with pure validators. The [product dossier writer](3DJAT-PRODUCTS.md) implements the five governed product commands through a separate explicit endpoint; other 3DJAT workflows are not installed. Existing APIs, legacy acceptance semantics and the current 16MP/24MiB PNG policy remain unchanged.

The separate [J03B integration candidate](3DJAT-WORKSPACE.md) supplies trusted owner connection/adoption using the frozen workspace.adopt request, independent file authority, disposable projection, frozen selections and combined private recovery. Kernel.call retains its existing interface; product delegation uses productCommand/POST /api/product and the bounded productReview query. Other workflows and image limits remain unchanged.

Read the fixed [Examples A–C](EXAMPLES.md). Use the implemented method when a capability has an example. For unsupported capabilities, propose a bounded solution using actual tools; do not invent a platform requirement.

## Project and staffing

Exploration is the existing Conductor conversation; it creates no production staff or round. On explicit production intent, project.activate persists the name, brief/current instructions and bounded request, binds that same SOL Conductor and establishes the project folder identity. Human UI requests also persist bounded intent. Project instructions are immutable revisions with expectedVersion; the latest revision is current. Historical revisions are not appended to active instructions.

Only one Conductor and Butler are active per project. Butler and workers declare LUNA; Conductor declares SOL. Host evidence must independently establish actual model/session availability. Role/tier strings alone provide no authority. A worker is bound to one commissioned project/round/job. Each actual session identity has one active assignment. BVE reserves a durable staff key/slot in existing job records before host creation; active plus pending worker slots cannot exceed six. Explicit replacement revokes old authority; it does not recreate a project/staff or authorize a new invocation. Retired worker records remain discoverable.

## Rounds and statements

round.create records operation, original user intent, existing Butler/Conductor, parent round, expected result count and exact references/feedback IDs. Supported operations are generate, compare, organize and branch. Non-generation rounds authorize zero image attempts. Parent references preserve later history. Butler must verify its scope and report ready before generation commission or worker provisioning.

round.commission freezes one distinct specification per authorized candidate using the canonical request. It reuses existing iteration/job/assignment integrity and identifies the owning round. worker.assign allocates internally to the bound worker. Each immutable statement preserves originating Butler instructions unchanged; workers append reports rather than rewriting instructions. statement.report derives attribution from the authenticated binding. Its receiving role/project/job must match; unknown report fields or edits to instructions reject.

A worker report of success is not artifact verification. Job state and independent intake decide whether an artifact exists. Butler knows expectedResults before the first arrival. round.present saves ordered exact verified references, not copies or regenerated originals. Completed presentation must contain all assigned material; generation completion requires the whole batch accounted for and attributable worker reports. A partial/failed/uncertain cycle is accurately incomplete, never a fabricated complete board.

Butler's completed/incomplete report automatically creates an immutable checkpoint with artifacts, statements/event references, presentation, parent and feedback references. The current round status is derived; no duplicate mutable workflow state or manual round Save is required. Late original deliveries/reports retain the original attempt and historical incomplete checkpoint. Conductor appends its final disposition without altering the checkpoint or human acceptance.

## Narrow session APIs

Use Kernel.call(credential, operation, key, input) or loopback POST /api/op with {op,key,input}. The local installer can attach the existing Conductor identity; project actors then use scoped operations:

| Scope | Operations |
|---|---|
| Conductor | project.activate, project.instructions, staff.reserve/bind/retire, round.create/commission/disposition, worker.assign; existing creativeContext.supply and event.ack/consume |
| Butler | statement.report, round.present, event.delivery |
| Exact worker | worker.start, statement.report; assignment token separately permits result.deliver |
| Every bound session | host.resume with its challenge, returning only allowed project/job context |
| Human browser | Existing project/request, draft.save, review.submit and design.accept |

Read kinds round/statement/statementEvent/checkpoint/presentation/projectInstruction/sessionBinding expose safe derived views. Assignment secrets are returned only to their exact worker through private resume. GET /api/round?id=... supplies the round, statement trail, checkpoint and presentation within the caller's read scope. GET /api/original and portable exports retain exact original bytes and existing boundaries. No caller-provided role property grants authority. Session credentials are private; the physical local owner remains trusted, not OS-sandboxed.

## Integrity, authorization and recovery

A clear request records existing authorization once: original intent, 1–6 candidates, one primary attempt per candidate, no automatic retries. Fresh/Follow and independent nullable Brand are frozen from the canonical request. Supplied contradictions reject. Specifications explicitly choose production source identities, roles and normalized-original regions; immutable human evidence/parent lineage are separate. Fresh may choose no old input or a content reference; Follow may choose a subset. Missing historical material limits history; only jobs requiring missing exact originals block.

Mutations use idempotency keys. Same key/payload recovers its receipt; changed payload conflicts. Durable invocation start is stricter: every duplicate start rejects even with the original key. Reservation and invocationsStarted do not measure actual provider calls/cost. Running/uncertain/delivered/resolved attempts are never dispatched again automatically. A late original reconciles its original assignment. Conflicting bytes/evidence are retained without overwriting authority.

Independent services validate original PNG decoding, SHA-256, dimensions, frozen limits and canonical associations; no producer/AI success claim registers an image. Supported originals are 8-bit non-interlaced PNG within 16MP/24MiB. Do not silently transcode unsupported originals. The durable inbox commits before validation so owner recovery finishes interrupted intake. SQLite WAL/full synchronization and online backup protect records and original BLOBs. Source integrity checks remain separate from database integrity.

User words, favorites, whole-image notes and source-bound normalized regions remain immutable on submission. Draft autosave, browser pending buffers and explicit version-conflict recovery protect unsent edits. Project checkpoints do not replace drafts. Feedback without iteration intent or a bounded standing policy generates nothing. Submit and iterate records intent once without another permission dialog. Design acceptance remains an explicit human action on a verified artifact.

Events preserve send attempts, actual acknowledgement and consumption separately. Reading/acknowledging/consuming is not generation authorization. Completed-round return must reach the originating Conductor through the host's demonstrated route; failed/unsupported push retains durable unread polling/resume and names any required human resume action. Do not claim automatic wake or browser opening from fixture callbacks. Deterministic Butler maintenance continues when every AI session is absent.

No repeated approvals for ordinary bounded work. New intent is needed only for materially ambiguous creative direction, extra attempts, a charged provider, destruction or private disclosure. No setup image calls merely to demonstrate staffing. Preserve existing active roots and backups; no silent empty-root replacement or legacy migration. Native integrations and human acceptance are verified independently of authored scenarios.
