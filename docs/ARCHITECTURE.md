# Project-centered architecture

BVE owns durable project reality; a conversation never becomes the project itself. Conductor directs work, Butler organizes/presents it, and bounded workers produce artifacts. A project has identity/name, a private local folder, current instructions/context, session bindings, rounds/statements, original artifacts, feedback and parent/checkpoint references. It survives all session replacement.

The active roster per project is one SOL Conductor, one on-demand LUNA Butler, and 0–6 LUNA Gen workers: at most eight. The first project chat is Conductor. Exploration requires no production workspace or workforce. Explicit production activates the named project and binds that existing chat. Butler receives its assignment and confirms readiness before workers are provisioned. Conductor uses the installed host tools directly; there is no supervisor. The installer supplies technical host integration and is not project staff.

A round is a Conductor–Butler operational cycle, not necessarily generation. An immutable statement establishes assignment, actors, inputs, references and unchanged originating Butler instructions. Attributable events append reports and disposition; current status is derived from events and independently verified job/delivery state. Butler presentation and operational completion automatically commit a checkpoint. User note drafts retain their own autosave/version-conflict recovery. There is no manual Save for a completed round.

The authoritative SQLite records/transactions/receipts remain the storage boundary. Additional round, statement, statementEvent, presentation, checkpoint and projectInstruction records use the same records table; no second database or workflow engine exists. Native originals remain immutable BLOBs. Project folders under BVE_ROOT/Projects/IMMUTABLE_ID are prepared on Butler readiness and reconstructed after backup restoration. Readable P001/R001/J001/S001 codes accompany internal IDs. The folder is not a Codex project.

For explicitly connected [3DJAT workspaces](3DJAT-WORKSPACE.md), business records remain authoritative in the accepted domain files. Their exact UUIDs are reused as projects, current SQLite projections are disposable, and selected historical bytes are immutable operational snapshots. Adopted folders resolve through the approved product path map; ordinary projects retain the default above.

| Actor/service | Authority |
|---|---|
| Conductor | Activate/resume project, version current instructions, assign Butler/workers, commission bounded rounds, interpret feedback, append disposition |
| Butler | Verify assigned project/round, report readiness/outcome, select and present assigned recorded material, return completion |
| Gen worker | Start its own assigned attempt once, deliver original bytes with assignment token, append its own report |
| Deterministic services | Validate bytes/hash/dimensions, register artifacts, recover durable inbox, derive checkpoints/events and reconcile dependencies independently of AI |
| Human | Request/clarify intent, save notes, submit review, explicitly accept a design |

Project/session/job identity is enforced by scoped bearer bindings and narrow validated operations, not labels in statements. Internal deterministic allocation/start helpers retain their existing recovery rules; they do not prescribe another AI role/service. Durable staff provisioning keys reserve a worker slot before calling the host so the seventh worker is rejected before creation. Lost responses reuse the key; uncertain invocation is never automatically repeated. Active Conductor replacement revokes the old bearer while retaining Butler, past worker identities, assignments and branch history.

The loopback server's deterministic maintenance continues without AI. A host with tested shared filesystem access may use scoped Kernel command transport with recover:false; inaccessible local roots are not made available by that option. Native session/model availability, original return, browser opening and automatic originating-chat completion require separate actual host evidence. Authored fixtures cannot establish them. No public tunnel, paid provider fallback or one-session imitation supplies a missing integration.

Follow [Examples A–C](EXAMPLES.md) for supported operations. Future artifact types remain conceptually possible; this revision implements no HTML/CSS generation, website compilation/publishing, generic workflow design, Foreman, advanced recovery scheduling, metric controls or synchronized multi-image zoom.
