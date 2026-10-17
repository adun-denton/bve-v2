# Consolidated V2 repair review checkpoint

This is the bounded correction of the existing candidate, based on PR head 115a07a34bd35d84ac00e45253671db4bb254888. It is for final independent technical review before an operator decides to begin the pilot. PR #1 remains draft/unmerged; there is no stable release, native call or operator installation in this coding phase. The machine-readable source commit is recorded in evidence/checks.json. Documentation/evidence commits may follow it without changing tested source bytes.

| ID | Disposition | Evidence / boundary |
|---|---|---|
| R01 | Fixed | Immutable review evidence and feedback; separate historicalCoverage; per-job sources/roles/regions and lineage. Mixed blocked/independent jobs, Fresh empty/content references, chosen one/two Follow references, source corruption/removal and honest portable coverage are in test/repairs.test.mjs and evidence/repair-report.json. |
| R02 | Fixed | Canonical direction and nullable Brand freeze into each specification; contradictions reject. Actual dispatch and scoped assignment are tested for Fresh/Follow × Brand on/off, changes to later defaults and immutable replay. |
| R03 | Fixed | Bounded creativeContext.supply preserves immutable revisions with origin/source validation, optional provenance, advisory constraints and supersession. Recovery before/after child commission, unchanged human records, scoped exports and prohibited operations are tested. |
| R04 | Fixed | Shipped browser harness waits for intended iteration, exact job set, expected image count and decoded/loaded originals. A deliberately held second-image response proves progressive review and bounded complete-board waiting coexist. A pinned rerun also exposed a history route/poll race; the render signature now includes selected iteration and relevant continuation/context changes. A held poll response deterministically verifies matching board/draft restoration without weakening the assertion. |
| A01 | Clarified | allowanceReserved and invocationsStarted replace misleading new-job attemptsUsed. Neither measures provider calls/cost. Existing safety/uncertainty and original-attempt late delivery remain enforced. |
| D01 | Deferred | Detailed Level 1–3 visual controls are not established lean-V2 requirements; evaluate in a separate product slice. |
| D02 | Deferred | Gallery comparison retained. Synchronized two-image detail/zoom awaits usability evidence. |
| I01 | Unverified | Native image workers, original-byte transport, actual tool/model/usage evidence and concurrency require later local verification. Serial fixtures only here. |
| I02 | Unverified / unavailable | Durable unread polling/resume exists; no live push to an active Conductor is claimed. |
| I03 | Deferred extension | Restricted PNG support retained. Other native formats/derived representations are not added or silently transcoded. |
| I04 | Partially evidenced; broader verification pending | Independent reviewed-baseline Windows contract and diagnostic Chrome evidence is acknowledged. This repaired checkpoint runs in Linux; full installation, OS permissions/process recovery and native integration remain unverified. |
| I05 | Unverified | Human usefulness and explicit design acceptance remain untested. |

## Changed source ownership

- src/kernel.mjs: #commission, #sourceSnapshot, #knownSource, #sourceReferences, #dependencyIssues, reconcile and portable separate immutable review evidence from chosen job dependencies. #validateRegion checks coordinate meaning/bindings. New jobs freeze direction/Brand/lineage. Allocation/start use explicit reservation/start counters.
- src/kernel.mjs: creativeContext.supply enters #preserveCreativeContext, a deterministic validation/preservation path for Conductor-authored judgment. read, reconcile and portable expose the appropriate context; no result-registration or human-feedback authority is granted.
- src/adapters.mjs: dispatch sends the actual assignment-scoped packet, skips blocked work without preventing independent jobs, and retains one primary attempt. Authored Conductor fixtures choose sources explicitly; Fresh does not inherit an entire old board.
- src/server.mjs and scripts/conductor.mjs: production-purpose portable export and bounded context supply/resume use existing HTTP/CLI patterns.
- public/app.js: reports limited historical coverage separately from continuation readiness and shows relevant creative notes in review history. Blocked production inputs remain distinct from available images.
- scripts/browser-test.mjs: iteration/job/image-scoped wait, a controlled delayed-original case, note preservation/recovery and exact environment/source identity.
- test/repairs.test.mjs: focused architecture regressions; existing recovery/HTTP/backup tests retained and old conservative-source assertions corrected to the repaired contract.
- scripts/repair-evidence.mjs and scripts/source-evidence.mjs: authored representative packets, note revisions/recovery and committed-blob source hashes tied to the actual tested commit. No private review inputs or local operator paths are published.

## Exact data semantics

Submission sourceArtifacts freezes what was available at review time, including identity/hash/version/native dimensions. Original human words, favorites, notes and normalized rectangles remain in immutable feedback. No rectangle is automatically a generation constraint.

Continuation readiness means submitted context is assembled; historicalCoverage separately reports loss. Production sources are chosen independently per job, with a role and only the specified region meaning. A child retains its parent review/iteration even with no image inputs. Missing known required originals block only the affected unsent job, while safe unaffected work proceeds. Exact restored bytes can recover that reserved unsent job without a new allowance or invocation.

Portable review packets explicitly report limited historical evidence. Production-purpose packets include exact chosen dependencies and their roles/regions; missing dependencies are reported as blocked independently of historical coverage. No claim of complete original evidence is made when historical bytes are missing.

Creative context is advisory authored judgment, not human feedback or operational verification. Current notes relevant to the review/iteration recover before a child exists and after owner/session replacement. Revisions preserve their predecessors. Unknown author/executor/tool provenance remains null; supplied provenance is not independently verified. Notes stay optional even if their references become unavailable.

## Review and environment evidence

Run npm test, then the shipped npm run test:browser with a provisioned Chromium. npm run evidence:repairs collects redacted real worker-visible packets through dispatch. The reports state their source commit and the manifest hashes committed Git blobs, avoiding Windows CRLF checkout mismatches.

The reviewed baseline passed 20 contract tests. Its unmodified browser harness failed independently on Windows at an immediate second-board count. A diagnostic explicit-wait copy passed 20 there; that was not a shipped-harness pass. This repair changes the shipped harness itself and records its final actual check count and environment. Earlier cloud publication cannot substitute for this repaired run.

No extra approval/capture/grant-entry controls were added. Normal submission, explicit iteration intent, optional notes and human acceptance remain separate. Lost starts, restart, uncertain results, duplicate deliveries and unread-event replay are covered by existing plus new regression cases. Native invocation duplication is not claimed as live-proven: the durable dispatch protection is demonstrated offline.

The proposed next technical checkpoint is the exact repaired source commit in evidence/checks.json plus its published PR head. The independent reviewer must read back that actual commit and assess R01–R04/A01 before the operator chooses when to begin local/native and human testing. This coding return does not self-accept the candidate.

## Final coding-session result

Tested implementation: 802a3a9c9b7a471dbbeeaf80b469eec67042a967. The final run passed 37 contract/recovery/HTTP/backup tests and 26 repaired shipped browser checks with zero page errors on Node 24.19.0, Playwright 1.62.1 and Chromium 153.0.8010.0, Linux x64. All three reports name that source commit; the manifest hashes 19 committed Git blobs. Five actual fixture-worker envelopes are redacted in repair-report.json. Documentation/evidence follow in a separate commit with unchanged runtime/test sources. Final independent review and operator testing remain pending.
