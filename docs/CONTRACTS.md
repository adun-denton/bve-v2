# Operating contracts

## Scope

A clear request persists an authorization record once: original intent, candidate count (1–6; configured default or one), one primary attempt per candidate and no automatic retries. Iteration requests inherit established Fresh/Follow and independent Brand context unless changed. Count, attempt and retry are distinct. An explicit bounded standing iteration policy may authorize additional iterations; absent it, feedback submission generates nothing. Submit and iterate records next intent once and queues interpretation for Conductor, without another confirmation. It never invents an interpretation or image call.

A new decision is needed only for materially ambiguous creative intent, extra attempts beyond scope, a newly charged provider, destructive work or disclosure of private material. Deterministic validation/reconciliation retries need no decision. Serial execution is the default until actual concurrency is demonstrated. Production cannot silently switch providers.

## Records and operations

Mutating commands take an idempotency key. The same key and payload recover the original receipt; changed payload conflicts. Execution start is stricter: after its first durable start, every duplicate start rejects, including a replay of the original key; a lost start response must never authorize a second invocation. Automatic Butler maintenance is deterministic and transactional. A function credential is provisioned by the local owner, not inferred from a role string in a request. Executor tokens are assignment-scoped and reveal only frozen job context. The browser cannot call Generator or Butler by supplying a role label. Conductor cannot invoke their operations. HTTP checks Origin and Host; secrets are never in public source or portable exports.

- Project: identity, name, brief, defaults, independent direction/brand context; isolated in a private root.
- Iteration: project/page, parent review, original user request/scope, distinct frozen specifications, count and separate attempt limit.
- Specification: direction identity and intended sibling difference, exact brief/prompt, canonical Fresh/Follow and independent nullable Brand, explicitly chosen production sources/roles/regions, output limits/preferences, allowance and destination. Supplied direction/Brand contradictions reject. Later defaults never rebind a frozen packet.
- Job: queued → assigned → running → delivered → succeeded/failed; running → uncertain after owner loss. Missing actual inputs make only that unsent job blocked; restoring exact originals returns it to queued/assigned without another reservation/start. One primary attempt; failed/uncertain cannot implicitly return to queued.
- Assignment: executor, random scoped token hash, attempt identity, frozen input, allocated/start timestamps. Allocation sets allowanceReserved=1, invocationsStarted=0; durable start sets invocationsStarted=1. Neither counter proves a provider call, usage or cost. Duplicate starts reject. Unsent reservations recover; uncertainty retains the same attempt. Historical attemptsUsed meant reservation, not measured calls; new records use the explicit fields.
- Delivery: assignment, SHA-256, original bytes, outcome telemetry, durable received time. Butler recomputes PNG decode, size/hash and canonical association. Producer claims are not authority. Same bytes/evidence replay returns the existing receipt; conflicting evidence is retained without overwriting the original. Invalid output yields a failed result, not fabricated success.
- Artifact: immutable identity/version 1, SHA-256, native dimensions/media, original bytes, job/iteration/project/source association and verified receipt. PNG is the initial supported image contract; unsupported formats fail specifically.
- Review draft: versioned CAS updates, image notes/favorites, overall words, whole-image or normalized region rectangles bound to artifact identity/hash/version/dimensions. Geometry uses normalized original image coordinates, independent of zoom.
- Submission: immutable snapshot of draft, exact board artifact identities/hashes/versions/dimensions and explicit intent, unique receipt. Saving/submitting without iterate intent commissions nothing. New feedback creates a new submission; old submissions remain discoverable.
- Continuation: ready submitted context plus immutable reviewEvidence and original feedback; separate historicalCoverage reports available exact originals and precise historical losses. Historical loss never globally blocks commissioning. Each job declares and validates its actual dependencies; only affected jobs block. Optional relevant creativeContext and screenshot availability are associated automatically, AI absent. Child lineage and interpretation remain separate from production inputs.
- Creative context: Conductor supplies a bounded interpretation/decision/rationale through creativeContext.supply; deterministic service validation preserves immutable revisions with exact origin/source references, unknown-or-supplied provenance and supersession. It cannot alter human feedback, register images or override requests. Missing notes remain optional.
- Event: unique iteration/type, creation, delivery attempts (including failure), delivery acknowledgement and consumption stored separately. A send attempt alone never marks read. Failed delivery leaves durable unread state; explicit read/consume is the resume path. Replay cannot commission or dispatch.
- Acceptance: explicit human action referencing a verified artifact; no other operation implies it.

## Safety and recovery invariants

SQLite transactions commit authority atomically. Intake inbox commits before validation, so restart resumes it. Originals are stored in SQLite and immutable via supported interfaces. WAL plus full synchronization protects committed results; backup uses SQLite's backup interface, including original bytes. Database integrity does not replace source hash checks.

Butler runs at startup and on a timer without Conductor. It verifies relevant originals, reconciles inbox and partial/full review events, and assembles continuations. Optional capture unavailability is recorded. Required corrupt/missing production inputs block only dependent unsent jobs with exact IDs; unrelated historical loss is limited review coverage. Unaffected work, feedback and known lineage remain usable. Browser refresh/replacement reopens a durable project/page/iteration URL and server-saved drafts. Local browser pending saves retain a recovery copy and version conflicts are explicit.

Conductor, Generator, Butler and human interfaces are separate entry points. No unrestricted record-update operation is exposed. The initial trusted local owner is outside this application-level boundary; no claim of OS isolation is made.

## Verification categories

Offline contracts and browser fixtures must be demonstrated for two iterations; the first has six distinct direction jobs. Native executor/image-tool/original-byte support, concurrent execution, live notifications, human usefulness and design acceptance remain unverified until actually exercised. Documented or simulated support cannot be relabeled demonstrated native support.

## Review history versus production inputs

Four independent concepts are preserved: the immutable sourceArtifacts review snapshot; original human reference indications in feedback (words/favorites/whole-image notes/normalized regions); specification.sources actually chosen for each job; and parentReviewId/parentIterationId lineage. Fresh may use zero old inputs or an explicitly chosen content reference. Follow uses its declared inputs, not every board image. Neither direction implies Brand on/off.

Each production source freezes artifactId/version/sha256/dimensions and role. Optional sources[].regions freeze normalized-original rectangles and an authored meaning. A reviewRegion binding names reviewId/index and must match that original annotation exactly. No reviewed rectangle is automatically injected. Sources may come from the same project's image library; foreign sources, wrong identities and invalid geometry reject.

Unavailability of a valid known dependency creates a precise blocked job without rolling back unrelated valid jobs. Butler rechecks before allocation/start and on its timer. A missing canonical artifact may be recognized from its immutable full review snapshot but remains unavailable for execution. Old minimal snapshots are not rewritten to invent missing metadata.

Portable v2 export states its purpose. Review-evidence export includes available historical originals and discloses limited coverage. A job export (?jobId=) includes exactly its available dependencies, roles and regions, reports blocked if one is unavailable, and separately discloses historical coverage. It cannot claim complete historical evidence when originals are missing. Relevant optional notes are included; function/assignment credentials never are.
