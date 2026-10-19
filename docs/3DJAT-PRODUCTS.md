# Governed product dossiers

## Decisions before implementation

| Boundary | Decision |
|---|---|
| Commands/CAS | Only frozen product.create/read, product.proposal.submit/decide, product.note.add. Current exact head and dossier CAS; create protects absence 0. Semantic resolution is rechecked under the accepted DomainStore lock |
| Authentication | Explicit private local access file, outside business/runtime roots, holds random bearer hashes and a writer MAC key. Human and proposal-only principals are provisioned by the trusted filesystem owner. BVE reuses its existing human/session authentication; author labels confer no scope |
| Durable identity/replay | UUID is explicit in the frozen create packet. Deterministic action/note IDs and a bounded private first-submission timestamp reservation preserve replay through prepublication faults. Committed scoped store receipts replay before stale checks; changed packet conflicts |
| Receipts | File-owned signed evidence records bind authenticated principal/role, operation/key/product and exact command fingerprint. A decision's public action reference binds those intended bytes, not authority. No credential or MAC key enters the domain |
| Proposal index | Derive bounded proposal/decision histories from committed heads/receipts, never directory names or proposal accepted flags. Resolve exact refs and active links; original bytes remain immutable |
| Correction | Submit current B with exact corrects=A; human supersession publishes a decision linking exact committed B coherently; accept B separately. Old originals can be rejected/current-corrected, never directly accepted stale. Existing terminal decisions require exact active supersession links |
| Evidence availability | Local sources verify safe relative bytes/hash within existing file bounds. Drive/unavailable bytes remain unresolved; such proposals stay readable and cannot install accepted facts. Corrections retain original field/source identities |
| File/SQLite | Publish files first. Operational copies of authentic action evidence, UUID adoption and cache refresh are separate acknowledgements. Failure returns a frozen failure with a resolvable durable receipt when known; same key reconciles, never rolls back files |
| Creation/project | Exact UUID adoption uses J03B owner primitives, creates no request/round/job/staff and never calls project.activate. Brief/defaults remain operational |
| Standalone | File-only semantic writer/reader imports no SQLite, server or kernel. Private access is explicitly provisioned, never discovered. Independent inspection works without any operational database |

This is application code for authored review. No production setup, actual human approval/native readiness, J05 imports, UI or image-limit changes are established.

## Explicit access and entry points

`src/domain-products.mjs` imports filesystem/crypto, the accepted DomainStore and frozen contracts only. It imports no SQLite, Kernel or server. Direct file owners can use `readProductDossier(domainRoot,{productId,atHead=null})` for a verified `{head,product:{reference,record}}` snapshot without any capability file, runtime or database. This is local file access, not an authenticated remote reader. Direct edits are corruption, not supported mutation.

For independently authorized local setup, the trusted owner provisions a new private access file outside the domain and runtime roots:

```js
const human = provisionProductPrincipal(absoluteAccessFile, {
  workspaceId, id: 'local-human', role: 'human', products: '*', sourceIds: []
});
const source = provisionProductPrincipal(absoluteAccessFile, {
  workspaceId, id: 'source-a', role: 'source-proposer', products: [productId],
  sourceIds: ['source-a']
});
const writer = new DomainProducts(domainRoot, {accessFile:absoluteAccessFile});
const resultOrFailure = writer.command(source.token, frozenCommand);
```

Provisioning is a private library function for the filesystem owner, absent from HTTP. It returns `{principalId,role,token}` once; only token hashes are stored. Role is human, source-proposer or conductor. Source-proposer maps to source-reader for dossier reading, permits only configured product IDs (`'*'` explicitly means all) and proposal sources with configured source IDs. It never decides, creates products or adds notes. Provision/edit private access under owner quiescence, preserve its MAC key and submission reservations, and retain a separate private backup. This is a minimal local capability boundary, not account login/RBAC or an OS sandbox. Filesystem owners can read/edit their own private files; do not grant an external session those filesystem permissions or human/owner credentials.

`new Kernel(runtimeRoot,{products:{accessFile:absoluteAccessFile},...existingWorkspaceOptions})` and `serve({root,...,products:{accessFile}})` explicitly enable delegation; ordinary roots/options are unchanged. Existing persisted J03B connection must match. Registry data is not stored in the business projection or a second database. The product writer is initialized lazily only after checking the already-bound domain identity, so enabling it cannot silently adopt a copied replacement root.

| Entry point | Exact input/output |
|---|---|
| `DomainProducts.command(token,packet)` | One frozen command from the five above; frozen `3djat.result.v1` or `3djat.failure.v1` for identifiable supported command/key. Malformed/unidentifiable or unsupported envelopes throw a bounded StoreError |
| `Kernel.productCommand(token,packet)` | Same packet/typed response; additionally materializes authentic action evidence, adopts exact UUID if missing and refreshes disposable projection |
| `DomainProducts.readReview(token,{productId,atHead})` | Exact two-field internal query; explicit verified historical/current head. Returns `{head,product,proposals,decisions,authority:'domain-files'}` for one permitted product |
| `Kernel.productReview(token,query)` | Same bounded file-owned query. This is an internal read format, not an invented public command/result shape |
| POST `/api/product` | Raw frozen command, bearer credential, 128KiB body bound, typed response; 200 result / 409 failure |
| POST `/api/product-review` | Raw two-field query, bearer, same body bound, internal review view |

All new HTTP routes follow the existing loopback Host, Origin and authentication boundary; malformed requests retain the server's bounded 400/403/413 handling. Legacy `/api/op`, Kernel.call, browser/UI, and existing limits remain unchanged. No generic record reader/writer is exposed. The trusted `authenticate`, `beforePublish` and diagnostic `hook` constructor options serve Kernel integration/test seams; they are never supplied by request JSON. Registry, DomainStore and signing/authentication state are private class members.

BVE delegates its authenticated human token as principal `bve-human`; session principals use the actual binding ID and its single project scope, and other existing credentials retain only their applicable frozen caller scope. Source principals use the separate provisioned token, never BVE owner credentials. A caller-supplied actor/role/approved property rejects and cannot become trusted context.

## Frozen commands and receipts

Creation requires the frozen explicit `productId` UUID, nullable string `productCode`, workingName and optional note. A client generates/preserves its UUID and key once before submitting; retries reuse that exact packet. No media, brief, project activation, installation, request, session or generation is a prerequisite for standalone creation. No numeric SKU conversion occurs. Creation publishes revision 1, source/action evidence, optional note and the SKU index in one domain head.

Submit uses the frozen proposal, current exact head and dossier expectedRevision. It records only a claim. `fact.state=accepted` is the proposed target, never authority. Sources preserve exact kind/ID/revision/hash/location or Drive identity, locator and observation time. Local `sources[].status='verified'` means safe bounded bytes match the declared SHA only; it does not prove locator accuracy, extraction truth or real human approval. Drive and missing/oversize/changed sources stay unresolved. No external network fetch, image inference, unit/currency conversion or arbitrary source execution occurs. Acceptance requires available matching local bytes for every declared source; unsafe paths/root changes explicitly refuse.

Human decisions carry an exact intended action reference. The public bytes helper below removes the receipt itself before fingerprinting to avoid self-reference. The helper does not authenticate anything; the actual token is checked separately, including under the writer lock:

```js
packet.input.humanActionReceipt = decisionActionReference({
  workspaceId, principalId: human.principalId, packet
});
writer.command(human.token, packet);
// For the existing BVE human bearer, principalId is 'bve-human'.
```

The decision's own decidedAt is retained. For creates/notes/proposals, a first-submission timestamp reservation under the private `<accessFile>.intents` directory makes generated action/note IDs and bytes stable across prepublication faults. Reservations bind workspace writer principal, operation/key and full canonical packet hash. Changed-payload keys conflict. Private reservations never become current product authority.

One signed `3djat.evidence.v1` record per mutation contains a bounded `3djat.product-action.v1` description: public action event, role and MAC. The MAC key and bearer secrets stay private. The public event identifies principal, operation/key/product, exact command hash, workspace and recorded time. It records an authenticated action/intent, not a claim that a business decision succeeded or that a real-world person's identity was independently verified. The event's exact canonical JSON is the decision's Operational/event reference. The signed domain record is included in the normal store receipt closure, so independent domain history retains its provenance bytes. MAC checks require the retained trusted private access file; they are not portable public-key attestation or proof of actual human approval.

Every publication uses J03A's existing exclusive lock, head hash/revision and SKU index. The semantic snapshot is verified again under that lock, caller scope and source bytes are rechecked, then existing Store.commit publishes the complete immutable closure. Two local writers may receive lock/CAS conflict; no lock theft, arbitrary retries or multi-machine writing is supported. Same scoped packet replays its original receipt before stale-state rejection, including after later changes; a changed packet conflicts. Replay verifies the original signed audit. No private credential or source data is placed in errors.

Result owner is domain. `reference` is the exact output-type record: proposal for submit, product for create/read/note/decision. `committedRevision` equals that output reference's revision, not the author's dossier expectedRevision or a fabricated domain-head sequence. Reject/supersede returns the unchanged current product pointer. `receipt` resolves to the actual J03 store receipt; the head publishing that receipt is discoverable in the verified closure. A read uses the existing product publication receipt and creates no mutation receipt. Historical replay returns its original output pointer; current projection/review is separate.

Frozen failures use contract codes: revision/SKU/idempotency/scope/evidence/source/validation errors; root identity/case changes map to UNSAFE_PATH; unavailable IO/lock capability refuses. A possibly published file transaction returns EXPORT_PENDING. If durable publication is known but later reply/adoption/cache fails, its real store receipt is supplied as evidence. Replay the original key to reconcile; never roll back facts. Invalid/unidentifiable envelopes cannot be represented as a valid frozen failure and use the adapter's malformed-request handling.

## Decisions, correction and histories

The accepted C1 outcome table governs full contextual validation. Acceptance requires the original's expectedRevision to equal current dossier revision; rejection and explicit linked correction permit an older original. Future originals, stale/future corrections and uncorrected stale supersession refuse. Actual bytes/hash/product/identity are resolved before supplying full original/correction context.

The writer requires pending state for a first decision and null supersedesDecision. Already accepted/rejected claims can only be replaced by explicit corrected supersession naming the exact active prior decision; already superseded claims cannot be silently reopened. Directly reaccepting/rejecting a terminal claim with a new key refuses. Same-key replay remains valid. The review view retains all proposals/decisions, derives their latest state from append-only exact links, and checks signed human provenance of decision history.

Edit sequence: submit B with `corrects=exact A`; preserve A and B as immutable records; human supersession links A to the exact committed B in one verified head; accept B in a separate human action. Publishing pending B alone does not supersede A. The supersession head includes the verified correction bytes and decision together; neither a proposal flag nor an uncommitted filename changes state. Acceptance of B requires the active supersession of A to name B. Corrections keep the same typed field set, and their source refs must be exact members of the corresponding original field's sources; unrelated new source material requires a separate proposal, not a forged edit chain.

Acceptance alone advances dossier revision and applies typed fields while preserving all notes, attachments and dated design/production/finishing entries. Known prices retain exact decimal strings/currency/denomination/per/date; IRR/rial and IRT/toman remain distinct, known zero differs from unknown. Dimensions remain positive with units. Clearing SKU to null preserves UUID/history; workingName cannot be cleared or whitespace. Unknown/not-applicable remain explicit; notes append attributable IDs/time/receipts. Rejection/supersession changes no accepted values or dossier revision.

There is no frozen command for adding design/production/finishing history entries. Existing typed entries are preserved/read; their creation remains a specific coverage limit. No unrestricted dossier update or history editor is added. The wrapper UI remains J06.

## Operational acknowledgement and recovery

The BVE path authenticates first, stores the exact public action event in the existing SQL event kind before domain publication, and records no request/round/job/staff. A prepublication failure can leave an honest attempted-action event; it confers no fact or human acceptance. Standalone writes need no BVE/SQLite. On a later Kernel.productCommand (including frozen product.read), signed domain action events are verified and copied byte-for-byte to operational records before adoption/projection acknowledgement. This materializes authentic recorded actions; it does not invent missing evidence or reconstruct operational approval/attempt history.

These internal product-action copies are excluded from legacy notification reads. Legacy event delivery, acknowledgement and consumption operations refuse to mutate them, preserving the exact bytes referenced by decision evidence and backup verification.

Product UUID adoption uses accepted J03B primitives and existing owner credentials internally, only when the operational mapping is absent. The path creates no duplicate project and never uses project.activate. Cache refresh remains disposable and distinct from file commit. Existing kernel historical stale dossier/statement/frozen selection access and new-request/commission blocking stay intact during live domain loss. Copied replacements and unsafe links still refuse, including before the lazy product writer's first command.

J03B combined backup/restore is unchanged. If a standalone decision's actual referenced Operational/event copy has not been reconciled, combined backup honestly refuses INCOMPLETE_BACKUP. A successful explicit Kernel.productCommand read/write can reconcile the existing signed evidence; it never fabricates a decision. Complete backup preserves domain decisions, operational event bytes and original receipt closure. Restore allocates separate new roots, retains exact business UUID/history, and rebuilds disposable projection using J03B. Independent domain reading works with SQL physically absent.

The private product access file and timestamp reservations are outside J03B's declared combined snapshot scope. Preserve/restore those separately under owner control to continue authenticated writes/MAC verification. Losing them does not erase file-owned accepted knowledge or its stored provenance bytes; it does remove the ability to verify old MACs/continue that identity without the original private key. Tests restore domain/operational data using the retained original access file and state this limit; no complete account/capability backup is claimed. Never overwrite live roots, reset attempts/history, steal locks or invent approvals.

Bounds: accepted J03 file/closure/head limits remain. Local source checks use its 1MiB file bound; larger or remote sources remain unresolved rather than being read without bounds. Review allows at most 128 proposals and 256 decisions per product, refusing excess rather than dropping history. Private registry/reservation files cap at 64KiB, registry at 32 principals, reservations at 512; HTTP bodies cap at 128KiB. Private capability provisioning is quiescent owner work. Windows directory flush/power-loss limitations and trusted-filesystem-owner qualifications remain.

## Verification

```sh
node --test test/3djat-products.test.mjs test/3djat-products-integration.test.mjs
npm test
```

Authored tests cover two principals, name-only creation, SKU/unknown/typed values, source resolution and forgery refusal, C1 rejection/correction journeys, active-decision links, real child-writer contention, BVE-down child read/write, publication/reply/cache/adoption faults, exact replay, combined recovery and unavailable-domain/unsafe-root controls. A Windows-only product create/propose/decide/reopen/replay gate must execute on the submitted source in overseer verification; Linux skips it. All fixtures are disposable and do not establish real human/source approval or native readiness. No installation, real imports, generation, merge or next job is authorized by these tests.
