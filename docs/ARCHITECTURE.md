# Architecture and ontology

| Term | Meaning |
|---|---|
| Role | Enduring responsibility, independent of its executor. |
| Function | Bounded capability owned by a role. |
| Job | Work instance with frozen inputs, output conditions and stopping point. |
| Executor | Replaceable human, AI, script or host service performing work. |
| Agent | AI executor only; never a synonym for role or component. |
| Artifact | Durable identifiable output with original bytes and history. |
| Protocol | Allowed interactions and transitions. |
| Kernel | Authoritative records and invariants. |
| Authorization | Existing user intent translated into bounded scope. |
| Acceptance | Explicit human design judgment, separate from permission and verification. |

| Owner | Interface | Prohibited transfer |
|---|---|---|
| Conductor | Commission distinct specifications; read/interpret submitted feedback; consume events | Cannot invoke images, deliver files, register outcomes, edit human submissions or accept designs |
| Generator | Allocate compatible jobs and start each attempt once | Cannot verify/register its own output or accept designs |
| Assigned executor | Deliver original bytes and actual outcome evidence for its assignment | Cannot select another job, replace authority or claim another role by label |
| Butler | Independently decode/hash bytes, reconcile known state, register results, prepare review/continuation/events | Cannot invent creative interpretation, invoke uncertain work again, rewrite feedback or accept designs |
| Human | Save drafts, submit, explicitly request iteration, accept a selected artifact | Submission/favorite cannot imply acceptance or generation |

Node runs a loopback HTTP server and a deterministic Butler timer. SQLite transactions own state and original BLOBs, eliminating cross-file commit gaps. Content hashes identify immutable byte storage; per-job artifact identities preserve separate provenance even for identical pixels. No active AI session is required. Narrow local interfaces and per-function credentials enforce application boundaries, without a general identity framework. The single local owner can access its database; this is not a hostile multi-user security sandbox.

Cloud development creates code and authored test evidence. The delivered runtime uses a new private local root, never an existing BVE root by default. Host adapters receive bounded assignments and return original bytes; inaccessible local storage is exchanged through portable packets. No local service is exposed publicly. An absent adapter leaves jobs queued with a specific capability gap. Default native worker and live notification capabilities are unavailable. Simulation is isolated and explicitly labeled.

An invocation is durably marked running before adapter entry. Loss of its process produces uncertainty; lease expiry never means safe re-invocation. Unsent assigned work can be recovered, running work cannot be dispatched again. Deliveries use a durable inbox: intake repeats deterministically after interruption. Results, reviews and events survive browser or AI loss. Missing optional screenshots/notes do not block source-bound continuation. A corrupt required source blocks only dependent continuation and is reported by identity.

No legacy code is extracted for this candidate. The kernel, adapters, fixtures, tests and UI are newly authored.
