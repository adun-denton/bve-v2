# Functional interfaces and local integration

## Availability

| Capability | Current state | Evidence |
|---|---|---|
| Conductor commissioning and event read/consume | Demonstrated deterministic interface; simulated creative interpretation | Kernel and browser two-iteration tests |
| Generator allocation/start | Demonstrated deterministic interface; serial fixture dispatch | Recovery and duplicate-start tests |
| Executor original-byte delivery | Simulated PNG worker; native host not exercised by this public fixture evidence | Authored PNGs through independent Butler intake |
| Butler intake, source reconciliation, events, continuation | Demonstrated offline while AI absent | Tests plus server timer |
| Live native tool/model/telemetry | Unverified and unavailable by default | No native image call made; model/cost/usage remain unknown |
| Concurrent native execution | Unverified, disabled | Serial fallback only |
| Live push to a Conductor conversation | Unavailable | Durable polling resume works; failed delivery and simulated acknowledgement/consumption tested |
| Designer usefulness and design acceptance | Unverified | No human acceptance asserted; tests record none |

No image call is spent on capability discovery. `src/adapters.mjs` declares unavailable native support separately from simulated fixtures. An adapter must expose actual original bytes, supported PNG format and an uncharged compatible capability before allocation. Documented-only support cannot allocate. A `demonstrated` record must carry host evidence; a label is not proof. The trusted local operator must verify it before configuring that adapter. There is no provider fallback or model selection inferred from a requested worker name.

## Supported local operations

`src/kernel.mjs` exposes `Kernel.call(credential, operation, key, input)`, `read(credential, kind)`, assignment-scoped `assignment(token)`, `original(token, artifactId)`, and purpose-bound `portable(credential, submissionId, {jobId})`. The database handle is private. Ownership is selected by provisioned function credentials, never by an input `role` property. `Kernel.reconcile(butlerCredential)` is deterministic maintenance, not executor authority.

The loopback server exposes:

| Route | Contract |
|---|---|
| `POST /api/op` | `{op, key, input}`, `Authorization: Bearer FUNCTION_TOKEN` |
| `GET /api/read?kind=request` | Role-specific bounded record kinds |
| `GET /api/assignment` | Assignment token reveals only its own frozen job |
| `GET /api/original?id=ARTIFACT_ID` | Function credential, or assignment token limited to its job's sources |
| `GET /api/portable?id=SUBMISSION_ID` | Human/Conductor review-evidence export; optional jobId selects exact production dependencies. Historical availability and missing inputs are explicit; no credentials |

Human operations: `project.create`, `request.create`, `draft.save`, `review.submit`, `design.accept`. Conductor: `iteration.commission`, `creativeContext.supply`, `event.ack`, `event.consume`. Generator: `job.allocate`, `attempt.start`. Butler: `event.delivery`, plus reconciliation. Assignment token: `result.deliver` only. Body size is bounded. Unknown paths/operations and boundary crossings reject.

The browser holds only the human credential. A local owner can inspect its own credential file and SQLite; this is application-level function separation, not OS sandboxing against its owner. Never give a broad local credential to an image worker. A worker receives one assignment token plus frozen specification and source bytes/roles.

### Conductor resume path

With BVE running and the same root selected:

```sh
node scripts/conductor.mjs resume
```

This returns pending creative requests, unread events, submitted words/geometry, historical coverage and recoverable optional creative context. It does not consume events merely by reading. `node scripts/conductor.mjs consume EVENT_ID` explicitly records consumption. Delivery attempts and acknowledgement remain separate. A failed push is retained unread. A polling host can read the event, record acknowledgement using `event.ack` with its actual receipt, then consume it. No native chat notification is claimed.

To commission from an authorized request, prepare a private JSON packet with a stable `key` and `input` containing `requestId`, distinct `specifications`, and a separate `interpretation` when parent feedback exists. Send it through `node scripts/conductor.mjs commission /private/specifications.json`. See `fixtureSpecifications` only as an authored example. This is an adapter interface for a local coding/executor session, not a manual designer administration step. User submission succeeds even when this session is absent.

### Generator and executor

Generator allocates each queued job with an explicit compatible capability. `job.allocate` returns a scoped assignment and stable attempt identity. `attempt.start` commits before invoking the tool. A duplicate start is **rejected even with the original idempotency key**; inspect existing state instead of treating a recovered start receipt as new execution permission. An assigned unsent job can resume. Running, uncertain, delivered and completed jobs are never redispatched by `dispatch()`.

The adapter returns `outcome`, original `bytes` as base64, and `evidence` with `kind: host|simulated` plus actual observed executor/tool/model/usage/cost data where available; unknowns remain null. The assignment ID is mandatory and cannot name another job. Identical bytes/outcome/evidence recover the existing delivery. Conflicts retain their bytes/evidence and original-delivery association; they cannot overwrite authority.

A reported uncertainty is an observation, not a completed image receipt: it retains the attempt and allows an actual late original from the same invocation. It never spends another attempt. Success claims cannot register artifacts: Butler recomputes PNG content validation, SHA-256, native dimensions, limits and canonical associations. Delivery inbox commit is separate from intake commit so restart recovers in-between interruption. Native bytes live in SQLite BLOBs; no rewrite/resizing occurs.

The first image contract supports 8-bit, non-interlaced PNG (grayscale, RGB, grayscale-alpha, RGBA) up to 16MP and 24MiB. JPEG, palette/interlaced PNG, animation and other formats are deferred. Do not silently convert an unsupported original to make it appear byte-identical.

## Operational installation lifecycle (changed requirement)

The 17 October 2026 user-directed requirement brings native host integration and actual role-session handoff into installation completion. The earlier candidate treated it as a subsequent phase; server startup alone no longer satisfies installation. See [INSTALL](INSTALL.md) and the narrow [host driver](HOST-DRIVER.md).

The installer provisions distinct actual Conductor, Generator and Butler sessions, role-specific instructions, scoped project bearers, identities, idempotent provisioning keys, durable delegation/receipt records, replacement and polling/resume. Creation labels are not evidence. Every session must perform a fresh scoped context read, and Conductor must send readiness routes received by both role sessions. Only a tested native host with applicable image/original-byte evidence and a usable initial Conductor link can be marked operational. Fixture/probe installations remain explicitly incomplete for native operation.

The session API adds host.resume, host.delegate and host.receipt through the existing /api/op boundary. It cannot grant another function by a role label. Conductor may delegate readiness, dispatch of a commissioned exact iteration, or reconciliation; Generator may dispatch only its assigned iteration routes; Butler's session asks the independent deterministic service to reconcile. Assigned executor result delivery remains unchanged. Routes, read/ack/completion receipts and replacements are durable SQLite records. Only the local installation owner can create/revoke session bindings; those methods are not HTTP operations.

The reusable role helpers are src/host-runtime.mjs. HTTP is normal; scoped Kernel command transport is supported for tested shared-filesystem hosts with unreachable cross-execution loopback. It opens recover:false and never takes owner responsibility. It cannot make inaccessible Windows state available. Read/acknowledgement/consumption and generation scope remain distinct. See role instructions in docs/roles.

Host setup must preserve existing work, back up before runtime/schema changes, and resume the same project. No extra image calls merely to test installation, no paid-provider fallback, no repeated designer permissions. If any essential host capability is missing, installation remains incomplete and names the gap. The designer receives a ready Conductor session only after actual verification; it is not delegated back to the designer as a configuration task.

## Repaired source and creative-context contracts

Every new job freezes direction and nullable Brand from its canonical request. A contradictory supplied field rejects; later defaults cannot change the packet. The scoped assignment and the actual dispatch packet contain both without needing project credentials. Sources/roles remain independent.

Conductor chooses specification.sources and optional sources[].regions. Each source identifies its artifact/version/hash with a role; each region has space=normalized-original, x/y/w/h and authored meaning. Optional reviewRegion={reviewId,index} must match the original human geometry and source. Parent lineage preserves the review regardless of the chosen generation inputs. Fresh may use none; Follow may use a subset.

Use node scripts/conductor.mjs context /private/creative-context.json with the same {key,input} command shape as commissioning. The narrow operation accepts projectId, iterationId, optional reviewId, kind (interpretation/decision/rationale), text (1–4000 characters), at most six exact sources, at most twelve constraints (300 characters each), optional provenance (author/executor/tool, each null or at most 200 characters), and optional supersedes. There are at most eight current notes per exact origin. Revision records keep a stable contextId, increasing version, immutable revision ID and supersession link; a stale revision cannot branch over a superseded head.

Deterministic service validation enforces project/iteration/review/source associations and preserves the record transactionally. Author/executor/tool values are author-supplied, not independently verified; unknowns stay null. createdAt is receipt creation time. Human feedback and result registration are inaccessible through this operation. Context remains advisory and optional even if its own historical reference is lost. Resume/continuation and portable export include relevant current revisions plus revision links, not unrelated notes/chat history.

Allocation records allowanceReserved; durable pre-invocation start records invocationsStarted. Neither is observed provider usage/cost. Unsent recovery, uncertainty and late original delivery preserve the same attempt and never create a retry or refund claim.
