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
| Conductor | Commission distinct specifications; author optional bounded creative context; read/interpret submitted feedback; consume events | Cannot invoke images, deliver files, register outcomes, edit human submissions or accept designs |
| Generator | Allocate compatible jobs and start each attempt once | Cannot verify/register its own output or accept designs |
| Assigned executor | Deliver original bytes and actual outcome evidence for its assignment | Cannot select another job, replace authority or claim another role by label |
| Butler | Independently decode/hash bytes, reconcile known state, register results, prepare review/continuation/events | Cannot invent creative interpretation, invoke uncertain work again, rewrite feedback or accept designs |
| Human | Save drafts, submit, explicitly request iteration, accept a selected artifact | Submission/favorite cannot imply acceptance or generation |

Node runs a loopback HTTP server and a deterministic Butler timer. SQLite transactions own state and original BLOBs, eliminating cross-file commit gaps. Content hashes identify immutable byte storage; per-job artifact identities preserve separate provenance even for identical pixels. No active AI session is required. Narrow local interfaces and per-function credentials enforce application boundaries, without a general identity framework. The single local owner can access its database; this is not a hostile multi-user security sandbox.

Cloud development creates code and authored test evidence. A new installation uses a new private root. An explicitly selected existing V2 installation resumes its preserved root and project after backup; it is never replaced with an empty workspace. Host adapters receive bounded assignments and return original bytes; inaccessible local storage is exchanged through portable packets. No local service is exposed publicly. An absent adapter leaves jobs queued with a specific capability gap. Default native worker and live notification capabilities are unavailable. Simulation is isolated and explicitly labeled.

An invocation is durably marked running before adapter entry. Loss of its process produces uncertainty; lease expiry never means safe re-invocation. Unsent assigned work can be recovered, running work cannot be dispatched again. Deliveries use a durable inbox: intake repeats deterministically after interruption. Results, reviews and events survive browser or AI loss. Missing optional screenshots/notes do not block source-bound continuation. A corrupt required production source blocks only dependent unsent jobs and is reported by identity. Historical review coverage is separate and does not defeat independent Fresh/Follow work.

No legacy code is extracted for this candidate. The kernel, adapters, fixtures, tests and UI are newly authored.

Optional creative context is an immutable, bounded authored record preserved by deterministic application services, not an embedded chat or institutional-memory framework. Human feedback, Conductor interpretation and operational verification remain distinct.

## Selected role-session installation

The 17 October 2026 user requirement changes the installation contract: this host configuration explicitly uses separate Conductor, Generator and Butler sessions. Earlier guidance allowed one executor to perform different functions; that remains an ontology fact, but does not satisfy this selected installation arrangement. Roles remain responsibilities; session identities are replaceable bindings, not authority from conversation labels.

Installation owns technical provisioning and verifies each actual session's scoped connection, Conductor-to-role delegation, original return path, notifications/resume, and initial Conductor handoff. Server startup and named chats alone are incomplete. A missing essential capability is explicit; fixture results cannot close it. See INSTALL and HOST-DRIVER.

A small set of sessionBinding, hostInstallation and delegation records shares existing SQLite transactions and backup. No new database schema, general RBAC, chat framework or provider layer is added. Three role-bound project bearers reuse existing function permissions. Replacing a binding revokes its old bearer and reroutes unfinished inbox work. It cannot change an attempt's invocation marker. Host session records survive owner replacement; live host conversations still require tested host resume support. No claim is made that BVE can create a conversation on a host lacking that operation.

Conductor commissions and interprets, Generator manages attempts and assigned executors, and the Butler session coordinates operational continuity. Deterministic intake/hash/registration remains independent of AI; the server timer still runs with no role session alive. Human review and design acceptance remain separate. Existing active roots are preserved and backed up before installation changes; a new empty root is only appropriate to a genuinely new installation.
