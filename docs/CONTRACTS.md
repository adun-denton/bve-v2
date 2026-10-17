# Operating contracts

## Scope

A clear request persists an authorization record once: original intent, candidate count (1–6; configured default or one), one primary attempt per candidate and no automatic retries. Iteration requests inherit established Fresh/Follow and independent Brand context unless changed. Count, attempt and retry are distinct. An explicit bounded standing iteration policy may authorize additional iterations; absent it, feedback submission generates nothing. Submit and iterate records next intent once and queues interpretation for Conductor, without another confirmation. It never invents an interpretation or image call.

A new decision is needed only for materially ambiguous creative intent, extra attempts beyond scope, a newly charged provider, destructive work or disclosure of private material. Deterministic validation/reconciliation retries need no decision. Serial execution is the default until actual concurrency is demonstrated. Production cannot silently switch providers.

## Records and operations

All mutating operations take an idempotency key. The same key and payload recover the original receipt; changed payload conflicts. A function credential is provisioned by the local owner, not inferred from a role string in a request. Executor tokens are assignment-scoped and reveal only frozen job context. The browser cannot call Generator or Butler by supplying a role label. Conductor cannot invoke their operations. HTTP checks Origin and Host; secrets are never in public source or portable exports.

- Project: identity, name, brief, defaults, independent direction/brand context; isolated in a private root.
- Iteration: project/page, parent review, original user request/scope, distinct frozen specifications, count and separate attempt limit.
- Specification: direction identity, intended sibling difference, exact brief/prompt, source roles, source hashes/versions/geometry, hard output limits versus preferences, allowance, destination, completion condition, interpretation linked to original review.
- Job: queued → assigned → running → delivered → succeeded/failed; running → uncertain after owner loss. One primary attempt; failed/uncertain cannot implicitly return to queued.
- Assignment: executor, random scoped token hash, attempt identity, frozen input, allocated/start timestamps. Duplicate starts are rejected. An unsent assignment is recoverable; an uncertain invocation retains its identity.
- Delivery: assignment, SHA-256, original bytes, outcome telemetry, durable received time. Butler recomputes PNG decode, size/hash and canonical association. Producer claims are not authority. Same bytes/evidence replay returns the existing receipt; conflicting evidence is retained without overwriting the original. Invalid output yields a failed result, not fabricated success.
- Artifact: immutable identity/version 1, SHA-256, native dimensions/media, original bytes, job/iteration/project/source association and verified receipt. PNG is the initial supported image contract; unsupported formats fail specifically.
- Review draft: versioned CAS updates, image notes/favorites, overall words, whole-image or normalized region rectangles bound to artifact identity/hash/version/dimensions. Geometry uses normalized original image coordinates, independent of zoom.
- Submission: immutable snapshot of draft + explicit intent, unique receipt. Saving/submitting without iterate intent commissions nothing. New feedback creates a new submission; old submissions remain discoverable.
- Continuation: submission, available exact sources, precise missing/corrupt sources, optional screenshot/notes availability; Butler creates automatically, AI absent. Conductor links separate interpretation to the review on a subsequent commission.
- Event: unique iteration/type, creation, delivery attempts (including failure), delivery acknowledgement and consumption stored separately. A send attempt alone never marks read. Failed delivery leaves durable unread state; explicit read/consume is the resume path. Replay cannot commission or dispatch.
- Acceptance: explicit human action referencing a verified artifact; no other operation implies it.

## Safety and recovery invariants

SQLite transactions commit authority atomically. Intake inbox commits before validation, so restart resumes it. Originals are stored in SQLite and immutable via supported interfaces. WAL plus full synchronization protects committed results; backup uses SQLite's backup interface, including original bytes. Database integrity does not replace source hash checks.

Butler runs at startup and on a timer without Conductor. It verifies relevant originals, reconciles inbox and partial/full review events, and assembles continuations. Optional capture unavailability is recorded. Required corrupt/missing originals block dependent next commissioning with exact IDs; unaffected evidence and review remain accessible. Browser refresh/replacement reopens a durable project/page/iteration URL and server-saved drafts. Local browser pending saves retain a recovery copy and version conflicts are explicit.

Conductor, Generator, Butler and human interfaces are separate entry points. No unrestricted record-update operation is exposed. The initial trusted local owner is outside this application-level boundary; no claim of OS isolation is made.

## Verification categories

Offline contracts and browser fixtures must be demonstrated for two iterations; the first has six distinct direction jobs. Native executor/image-tool/original-byte support, concurrent execution, live notifications, human usefulness and design acceptance remain unverified until actually exercised. Documented or simulated support cannot be relabeled demonstrated native support.
