# Session and artifact interfaces

Current ownership and operations are in [CONTRACTS](CONTRACTS.md), host integration in [HOST-DRIVER](HOST-DRIVER.md), and the supported workflow in [Examples A–C](EXAMPLES.md). There is no supervisor; allocation/start are internal deterministic helpers. Conductor commissions, Butler organizes/presents, exact workers produce originals.

Kernel.call takes a credential, operation, stable key and bounded input. read returns allowed project/job records, including derived statements/rounds, current instruction revisions and safe roster history. assignment(token) exposes one frozen job. For an adopted operation it also supplies an operationSelection assigned projection of the exact retained run (product reference, accepted facts and settings), template/allowed changes and independent Brand records. Product notes/proposals, business dossiers, the unrelated domain closure and permission evidence are excluded; this assigned historical view does not establish current execution authority. worker.start still checks the current selection fence. original(token,id) returns exact verified bytes; assignment tokens can read only their declared sources. portable exports distinguish human review evidence from exact production dependencies and disclose missing history/input coverage. No token appears in public exports.

| Loopback route | Contract |
|---|---|
| POST /api/op | {op,key,input}, Authorization: Bearer scoped credential |
| GET /api/read?kind=... | Role/project/job-scoped records |
| GET /api/round?id=... | Scoped round, checkpoint, attributable statements and ordered presentation |
| GET /api/assignment | Exact frozen assignment using its token |
| GET /api/original?id=... | Verified original PNG within function/assignment scope |
| GET /api/portable?id=...&jobId=... | Review or exact production-source export; no credentials |

HTTP checks Host/Origin, binds loopback and bounds bodies. The browser receives only a human credential. Local owner credentials stay private. Scoped Kernel command transport supports tested shared-file hosts without cross-execution loopback; inaccessible local roots remain inaccessible.

Creative specifications freeze canonical Fresh/Follow and independent nullable Brand. Production references and optional source-bound normalized regions are explicitly selected, preserving immutable human feedback/lineage separately. Advisory context revisions remain bounded, attributable, optional and relevant to continuation/export. Unknown tool/model/cost/usage stay unknown.

A compatible uncharged executor must return original supported PNG bytes. The exact worker's runWorker helper compares its adapter capability with the allocation snapshot, refuses a selected executor-ID substitution, and gives that adapter a scoped readOriginal function. Source hash verification precedes start and checks every scoped read against a private snapshot of the declared hashes. Capability classification is snapshotted before start; a callback cannot relabel fixture output by mutating its own capability object. The assigned worker callback, rather than the Conductor helper, produces/returns bytes. Simulated capability requires simulated outcome evidence; a missing, malformed or thrown result remains uncertain without reinvocation. Requested tier/executor labels are distinct from attributable model evidence; null/unknown model, cost and usage are not inferred. Native documented-only support cannot allocate. The independent service recomputes decode/hash/dimensions and canonical association; neither worker report nor adapter success registers an artifact. Identical delivery replays its receipt; conflicting deliveries retain evidence without overwrite. Durable inbox and once-only start preserve uncertainty, late originals and recovery. No automatic retry, charged provider or format conversion is inferred.

Native worker/tool/byte support, actual concurrency, originating-chat automatic completion, browser opening and human design usefulness require actual host evidence. Authored fixtures and historical probes are labeled separately from current supported integration. Unsupported integration does not block durable project/history review but must not be called an operational native handoff.
