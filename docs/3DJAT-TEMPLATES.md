# Governed template registry candidate

Business files own template revisions and human adoption history. SQLite receives exact signed action events and a disposable projection after file publication. Templates supply Conductor instructions; they cannot grant tools, source access, providers, attempts, budgets or staff. The registry implements no operation request/commission, calibration/promotion, template UI or new image capability. Ordinary operation remains16MP/24MiB;20MP remains an explicitly separate experiment. User testing and platform/native qualification remain separate.

`head.templates` indexes the latest ingested revision. Ingestion never adopts it. Human adoption selects an exact reachable revision for each applicability; it can explicitly be untested. Revision kind is stable within an ID. A different kind needs a distinct ID. A newer narrower draft preserves earlier active scopes. Summary scopes are latest declarations union active adoption keys, max24, filtered by read grant.

## Standalone and native entry points

`DomainTemplates(root,{accessFile,authenticate:null,hook})` in `src/domain-templates.mjs` needs an existing explicit domain and private policy file. `command(token,packet)` accepts frozen `template.ingest` and `template.adopt` only, returning the frozen result/failure. A shape-valid `template.promote` returns CAPABILITY_UNAVAILABLE. New commands do not fetch sources, execute instructions or provision anything. Unknown fields/operations refuse.

The Kernel option `templates:{accessFile}` enables `templateCommand` and `templateReview`; POST `/api/template` and `/api/template-review` use the existing actual native bearer transport. If product access is configured, it must use the same private file. No native-to-standalone fallback exists in template APIs. No template permission follows from product wildcard, a session/project binding or a JSON role label. Template methods do not adopt/link products or allocate jobs.

Inputs use fatal UTF8 and a128KiB inclusive request bound; output views are at most1MiB, otherwise VALIDATION_LIMIT. Native authorization failures return403, other valid-command failures409. Query failures are typed errors, not invented command failures. Existing product APIs and product action hashes remain unchanged.

## Owner policy

The shared private access file supports the existing `3djat.product-access.v1` (no template rights) and explicit v2. V2 retains workspace/key and principal id/role/tokenHash/products/sourceIds, adding `templateGrant:null|{templateIds,appliesTo,operations,sourceIds}`. IDs are exact, unique, no wildcard; max24 template IDs/24 applicability IDs/3 operations/32 source IDs. Operations are read/ingest/adopt. Template-local sources are separate from the product extraction sourceIds. Human adopt also needs read; source-proposer can ingest only with nonempty permitted sources; Conductor cannot adopt.

Trusted local owner only: provision an identity with existing `provisionProductPrincipal`; template-only identities explicitly use products:[],sourceIds:[]. `configureTemplateGrant(file,{workspaceId,principalId,role,grant,expectedSha256,confirmedQuiescent:true})` upgrades/updates/revokes the grant, preserving keys/token hashes and a separate exact readback-verified private backup. Reading never migrates policy. Adding a principal to v2 preserves all grants and gives the new identity a null grant. No owner policy API is exposed through HTTP or sessions. Use only disposable authored files during development; production configuration is not implied.

Native grants bind exact currently authenticated identity+role (`bve-human` or exact `bve-session-<id>`), not a caller-supplied principal. Discovery intersects native and registered product scope. Template ID/applicability/source policy is checked again on replay, while locked, immediately before publication and on uncertain receipt lookup. Revoked grants cannot replay old success. Private file/key/token/intents are outside domain/runtime and excluded from public/domain/combined snapshots; preserve them separately. Old product code refuses v2 private policy; never downgrade/overwrite a live file to roll code back.

## Commands and history

Ingest uses expected current domain head and latest template revision. Initial proposed revision1/supersedes null; next revision n+1/exact prior ref. At most64 IDs/64 revisions per ID. Exact sources remain in the draft even if currently unresolved; source-free human/Conductor ingest is permitted within grant. An adoption targets an exact signed reachable ingest, including an earlier revision. It requires verified current local source bytes (<=1MiB/source,<=16MiB/request,64KiB hashing chunks). Drive sources remain unresolved; no automatic fetch/fallback.

Adoption's expected entityRevision/input.expectedRevision are a per-template **decision sequence**, initially0, not a template revision. `supersedesDecision` is null initially, then the exact previous stream tail. Appending changes only the listed applicability keys. Example:D1 adopts revision1 for artistic+catalogue; D2 adopts revision2 for artistic and points to D1. Catalogue stays D1/revision1. A later catalogue decision points to D2, the whole-stream tail. Max128 decisions overall, constrained further by existing128-head/32MiB store limits. No history truncation, orphan scan, compaction or withdrawal command is added. Unsupported unsigned legacy registry history refuses CAPABILITY_UNAVAILABLE; inconsistent signed history refuses EVIDENCE_MISMATCH.

Adoption requires experiment/evidenceReceipt=null and outputs=[]. It creates no assessment IDs, operational compatibility or visual evidence. Existing contract, operational, visual and human states stay independent. New persisted revisions are valid; operational=not-assessed/null; visual=untested/null; human state comes from exact signed decisions per applicability. Four states such as valid-but-blocked, adopted-but-untested and tested-but-unapproved must not collapse into one approved flag. Real visual testing/promotion is a later implementation.

`templateDecisionActionReference({workspaceId,principalId,packet})` computes bytes only. Adopt hashes the full command excluding only input.humanActionReceipt, binds actual identity/op/key/time/expected head/sequence/scope/reason, and references `Operational/event/<id>.json`. The event hash excludes the MAC container and avoids a cycle. The writer recomputes this reference after authentication and signs role+event with retained private key in ordinary domain evidence. Ingest uses the first private intent timestamp. Full-packet private intent hashing includes humanActionReceipt. Same identity/op/key/packet replays its original result/receipt before stale CAS; changed payload conflicts. New template intents obey shared inclusive512: replay existing at capacity, refuse a513th key. Product intent behavior is preserved.

File publication is authoritative first. Native action copy/projection failure returns EXPORT_PENDING with real domain receipt; explicit same-key reconciliation copies the same event without another decision/head/job. Preserve partial roots/first outcomes; do not pretend cross-store atomicity or diagnose earlier unrelated publication/lock failures from a passing retry.

Semantic history also reconstructs each frozen store plan from its verified subject and audit references, checks SHA256 of canonical JSON with its trailing LF, and requires exact receipt record order and transitions. A mismatch refuses EVIDENCE_MISMATCH before selection, command replay, intent creation or operational acknowledgement, including in non-authoritative hash-only reads. The action command hash has different bytes and cannot substitute for this store-plan hash.

## Closed queries and views

All queries have schemaVersion=`3djat.template-query.v1`, kind and exact current atHead (revision-ref). Unknown/omitted fields refuse:

| kind | Additional required fields |
|---|---|
| list | applicability:identifier|null |
| template | templateId:identifier |
| discovery | productId:UUID,applicability:identifier,branded:boolean,brandTemplateId:identifier|null |

Branded=true requires an exact non-null Brand ID; false requires null. Two Brand IDs are legitimate; never infer one by title/order. Ungranted ID refuses INVALID_SCOPE. Granted missing/wrong-kind/unadopted/unavailable Brand blocks preparation with BRAND_SETUP_NEEDED. If only its current source is absent, retain its recorded chosen ref and report availability cause too. No automatic Brand or persistent default is installed.

`readRegistry(token,query)` returns `{schemaVersion:'3djat.template-view.v1',kind,head,authority:'domain-files',evidenceVerification,data}`. List data.templates contains summaries with templateId/kind/latest/decisionSequence/streamTail and applicability choices/status/blockers. Scopes are filtered without exposing raw off-scope instructions. Template detail returns latest/sequence/tail, all revisions (record/ref/source status/per-applicability statuses), all decisions (record/ref/activeAppliesTo/audit/publication/receipt). Raw detail requires rights to all historical declared scopes; no misleading partial history. Discovery returns product ref/applicability/branded/brandTemplateId/brand and operation choices. Chosen includes exact template/decision refs,purpose,applicability. Selectable means adopted **preparation availability**, never execution readiness/permission. Known source/Brand blockers are not a fabricated operational assessment. Source status never reads ungranted IDs.

`readTemplateRegistry(root,{query,accessFile:null})` is a trusted filesystem owner's independent reader, not an anonymous network API. It exposes hash-consistent recorded decisions but every selectable flag is false with CAPABILITY_UNAVAILABLE. Supplied retained private context must verify all signatures/workspace or refuse, never downgrade. Missing current source retains exact choice and blocks it; missing current domain/closure refuses without stale projection fallback.

## Portability and compatibility

Existing domain snapshot closure carries every ingested revision, signed decision and audit, including never-adopted history. Domain-only separate restore is business evidence, not a complete operational backup or a fresh grant. Existing combined backup requires genuine copied Operational/event rows; standalone unacknowledged actions cause INCOMPLETE_BACKUP until an explicitly configured native connection acknowledges real domain events. No experiment/job/receipt is invented. Restore only to new destinations; retain incomplete exports and original roots. Retained key is separately required to authenticate old actions.

Frozen head/template/decision/command/result schemas, store/workspace/backup/root/SQL/image policies and legacy selection helpers remain unchanged. Legacy selection still means latest-index membership, not human adoption. Adoption-aware operation snapshots/requests/commissioning require the subsequent reviewed slice; this registry persists no new operational snapshot kind. No merge, release or production installation follows this candidate.
