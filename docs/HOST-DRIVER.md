# Narrow host driver contract

`src/host-installation.mjs` adds installation lifecycle around the existing Kernel function contracts. It does not create a model provider, chat UI, autonomous-agent framework or substitute validation. A private trusted host module exports the following object for the installer-only CLI. The repository ships no fabricated native driver.

| Member | Required behavior |
|---|---|
| id, kind | Stable actual host identity; kind is native, fixture or probe. Only native can complete operational installation. |
| transport | http (default), or kernel only after shared private-root access is actually demonstrated in the role sessions. |
| discover() | Capability records for sessions, delegation, resume, image, originalBytes and userHandoff; each with status tested/documented/unavailable and actual evidence. Push is optional and must be distinguished. Do not spend image calls. |
| ensureSession({role,key,previous,instructions}) | Create/reuse the actual host session idempotently at the durable key; return id, actual https user link when available, and host creation/reuse receipt. A lost response must not make duplicate workers. If the host cannot ensure that, report a gap. |
| verifySession({role,sessionId,accessFile,instructions}) | Instruct that session to read only its own private envelope and call host.resume. BVE requires a new receipt from the scoped interface; a boolean reply or old receipt is insufficient. Verify the child's actual tools/transport, not only the installer's. |
| verifyDelegation({sessions,projectId}) | Conductor sends fresh host.delegate readiness routes to Generator and Butler; real recipients resume and receipt them. Readiness authorizes no images. The installer checks both durable completed receipts. |
| startConductor({sessionId,projectId,message}) | Resume/start the actual user-facing work session after essential capability checks, obtain a new durable read, and explain readiness without generating. Existing project context must be preserved. |

Capabilities are trusted host-driver observations, not cryptographic attestations or proof from labels. Native image/original evidence must be applicable to the actual assigned executor. A host that has not demonstrated these capabilities remains incomplete. A fixture driver can exercise the full deterministic protocol, but is always fixture-verified, never operational.

The installation writes stable provisioning keys before contacting the host, private tokens and replacement history in SQLite, and derived per-role access envelopes outside Git. A driver may use the active host's delegation controls; it must not tell the designer to create/configure the missing workers. No child should receive the owner credential file. The installation owner can physically read its own files; application scoping is not an OS sandbox.

`scripts/session.mjs PRIVATE_ACCESS_FILE resume` obtains only role-appropriate project records and a durable inbox. `call` accepts a JSON {op,key,input} packet on stdin. Access files and outputs containing assignment tokens are private; do not paste them into public evidence. `src/host-runtime.mjs` provides Generator serial dispatch and Butler reconciliation helpers. Generator dispatch requires a Conductor dispatch route for that exact session/iteration. Images remain within existing request allowance; readiness and event reads authorize none.

The host must route delegation notifications or support actual durable polling/resume. A live message to an active child is not a durable push service. Each send attempt uses event.delivery; its receipt is not event.ack, event.consume or a new request. User-required resume is stated explicitly. No timer in this adapter invokes images or impersonates Conductor. Independent deterministic Butler maintenance remains server-owned.

Replacement revokes the old bearer and assigns unfinished delegation routes to the replacement session. It does not reset the attempt or reclaim an invocation. Delivered results recover from the durable BVE inbox; missing external returns must be reconciled with the original executor/tool. The host must preserve its own returned originals/receipts before delivery; BVE cannot recover an unreturned tool result from an AI transcript that no longer exists.

Empty-workspace sessions begin without project access. The first human project creation atomically binds those sessions; it does not issue a creative request. Existing workspaces require a specific existing project ID. Re-running installation reuses its host key and session IDs, refreshes role reads/routes and makes another private backup. Changing actual host requires separate explicit installation handling; current bindings are never silently reassigned to another provider.

Current cloud probe limitations: child collaboration tasks have real identifiers and tool metadata. Cross-execution HTTP loopback reachability failed, so the scoped Kernel command transport is tested separately. There is no demonstrated Windows private-root connection, durable user-openable child-chat provisioning API, native returned-byte path or unattended event wake. A real Conductor link for the preserved Windows project is unavailable in this environment.
