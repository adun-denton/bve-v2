# Standalone domain store — J03A

J03A implements file storage only, under the accepted [J01 contracts](3DJAT-CONTRACTS.md). No Kernel, SQLite, server, command router, session or production root is used by the store. J03B adoption/cache/combined backup and J04 authenticated business workflows remain separate. This is a trusted local storage primitive, not a generic externally callable record-update API. Principal/scope supplied by its trusted caller must already be provisioned/authenticated; author JSON never grants authority.

## Implementation decisions (recorded before implementation)

| Concern | Decision and failure boundary |
|---|---|
| Exclusive ownership | Exclusive-create lock file, random owner nonce, exact lock-byte verification on release. Never steal by PID, time or presumed death. Explicit lock recovery requires independently confirmed quiescence and exact expected lock hash; preserve its bytes in Recovery first |
| Commit point | Atomic same-directory rename onto domain-head.json after all immutable data, receipt and historical head bytes are flushed. Before rename, new files are uncommitted orphans; once rename is attempted, any failure is publication-uncertain until verified reopen/replay |
| Bytes/hash | Deterministic UTF-8 JSON serialization with final LF on creation; hash those exact bytes. Readers hash original bounded bytes before parsing, not a reserialized approximation |
| Flush/replace | File fsync, close, parent-directory fsync where supported, same-filesystem head replacement. Linux process-kill/reopen tests are not power-loss or Windows durability proof. Windows directory-flush restrictions remain explicit and require the Windows review gate |
| History | Immutable Heads/workspace/revision.json, predecessor references and immutable receipts; only domain-head.json is current authority. Marker pins genesis/workspace identity; immutable workspace.json records the initial mapping/head. No second current journal |
| Replay/CAS | Scope includes trusted workspace/principal/operation/key. Search committed receipt history before stale head/entity checks. Exact same payload returns its original head/receipt even after later commits; changed payload conflicts. Product/template/business transitions compare actual indexed revisions, independently of proposed +1 |
| Containment | Explicit absolute root, canonical root identity, symlink/junction and hard-link refusal, safe relative paths and repeated checks before writes/replacement. Filesystem owner remains trusted; hostile concurrent owner races are not OS-sandboxed. Multi-machine/cloud-sync writers unsupported |
| Bounded reads | 1MiB per JSON file, 32MiB verified closure, 4096 files, 128 heads, 64 submitted records per commit. Cycle-aware iterative traversal. J01 index bounds (256) retained. Capacity fails rather than dropping history/receipts |
| Required versus external | Domain JSON references use reserved Domain/Heads/Receipts namespaces. Required product/template/decision/receipt closure must resolve. Source locations, attachment original bytes and explicitly typed operational evidence references are reported as external/not-verified; never fabricated or claimed included |
| Recovery | Ordinary reads never repair. Preserve locks/orphans explicitly under bounded Recovery paths. Corrupt current state refuses; an explicitly selected verified historical head may be exported and restored to a NEW root. Never silently select newest/previous head or overwrite a valid root |
| Domain snapshot | Copy verified required closure into a new destination, publish a hash/size manifest last, independently verify it; interruption leaves incomplete output. Restore only to a nonexistent new destination, publishing store marker last. No SQLite/attachment-byte backup claim |

Windows verification is mandatory before acceptance. The coding host is Linux; Windows flush/replace/reopen, case/drive behavior and junction tests must be reported separately. No store result proves power-loss durability, actual human approval, native readiness, IMG20 or P1122-COLD.

## API and physical format

```js
import { DomainStore, prepareRecord, verifySnapshot, restoreSnapshot }
  from '../src/domain-store.mjs';

// root must be an explicitly chosen absolute disposable path, absent or empty.
const store = DomainStore.initialize(root, { workspaceId, sourceCommit });
const before = store.read();
const result = store.commit({
  principal: provisionedPrincipal, operation: trustedStorageOperation, key,
  expectedHead: before.reference,
  changes: [{ kind: 'product', id: dossier.productId,
    expectedRevision: 0, record: dossier }],
  records: [{ kind: 'evidence', record: authoredProvenance }]
});
const snapshot = store.read(); // verified records/files maps, head, reference, external
store.exportTo(newSnapshotRoot); // nonexistent destination required
verifySnapshot(newSnapshotRoot);
restoreSnapshot(newSnapshotRoot, newRestoredRoot); // nonexistent destination required
```

The example requires all dossier references, including sourceReceipt, to resolve to matching domain records. `prepareRecord(kind, record)` returns canonical creation bytes and their reference without writing. Supported record kinds are product, template, business-context, proposal, proposal-decision, template-decision, attachment and the small internal evidence record. These are storage inputs only. No public command is installed or authenticated here; template ingest does not mean adoption and a stored decision does not prove human approval.

`changes` can advance only indexed product/template/business-context revisions. Actual previous indexed revision must equal `expectedRevision`; proposed revision must be exactly +1. New indexed entities use expected 0; template successors must name the exact previous immutable reference in supersedes. Business identity must equal workspace identity. Other submitted immutable records are retained through the commit receipt. The total records plus indexed changes cannot exceed 64. No delete/evict primitive is provided.

| Path | Version, fields and meaning |
|---|---|
| domain-store.json | `3djat.domain-store.v1`: schemaVersion, workspaceId, workspace reference, genesis reference; pins initial identity/mapping |
| workspace.json and Domain/workspace/1.json | Exact same frozen J01 workspace bytes, revision 1; genesis mapping remains immutable, never a second current pointer |
| domain-head.json | Frozen J01 domain-head bytes; the single current authority |
| Heads/UUID/N.json | Exact immutable copy of published/proposed head N; predecessor links retain history and receipts |
| Domain/kind/id/N.json | Frozen J01 record bytes; revisionless decision/proposal/attachment types use N=1 and a new identity for each immutable record |
| Receipts/scopeHash.json | `3djat.store-receipt.v1`: schemaVersion, id, revision=1, workspaceId, principal, operation, key, payloadHash, previousHead, records, transitions |
| domain-write.lock | `3djat.domain-lock.v1`: schemaVersion, workspaceId, random nonce and diagnostic PID; raw byte identity owns release, not the PID |
| Staging/transactionUUID/* | Uncommitted immutable copies and a temporary replacement head, all beneath the same root/filesystem |
| Recovery/recoveryUUID/* | Explicitly preserved lock/orphan bytes; never consulted as current authority |
| domain-snapshot.json | `3djat.domain-snapshot.v1`: schemaVersion, workspaceId, head, files (path/sha256/bytes), external; manifest written last |

All internal formats reject unknown fields/version. Internal metadata fields are bounded; principal/operation/key strings are nonempty and at most 200 characters. Receipt scope ID is SHA-256 of canonical `[workspaceId, principal, operation, key]`. Payload hash binds expected head, ordered record references and ordered indexed change identities/CAS/references. Receipt transitions are `{kind,id,from,to}`, at most 64, with +1 progression. Receipt records are at most 64 references. One receipt per non-genesis head points at its predecessor; the original resulting head is found through committed history, avoiding a circular receipt/head hash. Lookup considers receipts owned by committed heads, rather than arbitrary referenced receipt files.

The internal `3djat.evidence.v1` format contains only schemaVersion, id, revision and description (1–2000 characters). It holds authored storage provenance, not signatures, actual human action receipts or provider verification. All hashes prove byte consistency under the filesystem-owner trust boundary, not authorship or tamper-proof history.

`read({atHead, retries})` can inspect an explicitly supplied historical head, without claiming it is current. Current reads allow at most two retries (three attempts total) and return HEAD_CHANGED if publication keeps moving. Closure traversal is iterative and cycle-aware, validates every required referenced schema/hash/identity plus product/template/business and derived SKU indexes, and validates predecessor progression/genesis. Each reference occurrence, including a previously traversed path, must match the resolved exact ID/revision/path/hash before traversal may be skipped. Identical sharing is allowed; a cached hash disagreement returns REFERENCE_CONFLICT and a cached ID/revision disagreement returns REFERENCE_IDENTITY. Supported readers never infer current state from a filename or recover automatically.

The 4096-file and 32MiB closure bounds include workspace metadata and current-head bytes; the separately bounded snapshot manifest is additional. Files are at most 1MiB. Reads use bounded descriptor reads, check before/after size/mtime and path safety, and reject invalid UTF-8/JSON. External references are capped at 512. Heads are capped at 128 including genesis. Frozen indexes remain capped at 256. Successful history is never evicted: the next commit fails CAPACITY when any limit is reached. A larger or longer-lived deployment needs a reviewed retention/contract decision; silently compacting evidence is unsupported.

## Commit, uncertainty and explicit recovery

| Last completed boundary | Observable authority on reopen | Action/result |
|---|---|---|
| Initialization interrupted before marker | Unknown/incomplete root; no automatic adoption | Preserve it; use a newly allocated root or explicit forensic investigation |
| Exclusive lock only | Old verified head; competing writer gets LOCKED | No PID/clock-based stealing; independently quiesce writers first |
| Staged files or some/all immutable files flushed | Old verified head; new bytes are orphans | Ordinary reads ignore orphans; retain or explicitly quarantine them before a different conflicting write |
| Before replacement hook | Old verified head | Prepublication failure is COMMIT_ABORTED (or specific validation/conflict code) |
| Replacement attempted, result/flush/read-back/reply fails | Old or new complete head; caller outcome uncertain | COMMIT_UNCERTAIN includes intended head and cause; reopen/verify and replay the original scope/payload |
| New head read-back verified and lock released | New complete head and original receipt | Success; later same-key replay returns original head/receipt before stale rejection |
| Current head or required closure corrupt | Structured refusal, no accepted snapshot | Preserve corrupt bytes; inspect an explicitly chosen historical reference, export it, restore to a NEW root; never rewrite current silently |

The test hook is a trusted, synchronous fault-injection seam; it is not accepted from record JSON or connected to any command. Boundaries include locked, file-flush, after-stage, after-immutable, before-replace, replace, after-replace, reader-verified and before-reply. The replace hook runs inside the uncertain interval before the real rename, enabling harmless rename-denial injection. File-flush injection runs after writing and before fsync. Matching immutable files are flushed again before reuse, including orphans surviving a pre-flush kill.

Lock release compares exact acquired bytes. A release failure after possible publication is also uncertain. `recoverLock({expectedLockHash, confirmedQuiescent:true})` requires the operator to establish quiescence outside the store; a boolean does not discover or stop processes. It rechecks the lock hash, preserves exact bytes under Recovery and removes only that lock. A mismatched hash returns LOCK_CHANGED. It cannot be used safely while a writer could resume.

`quarantineOrphans({expectedHead, confirmedQuiescent:true})` additionally acquires the ordinary writer lock and checks the verified current head. It scans only Domain/Heads/Receipts/Staging, keeps the complete required historical closure, and copies bounded unreferenced bytes into Recovery before unlinking originals. Traversal is bounded to 8192 entries, with at most 4096 orphan files/32MiB and 1MiB per file. Capacity/unsafe files refuse rather than deleting evidence. Partial quarantine can leave preserved duplicates; it never changes the authoritative head. Recovery history itself is not deleted or silently bounded away. Disk exhaustion requires owner review, not evidence eviction.

Core refusal codes include EXPLICIT_ROOT_REQUIRED, UNKNOWN_ROOT, UNSUPPORTED_SCHEMA, WORKSPACE_MISMATCH, STORE_CHANGED, ROOT_CHANGED, UNSAFE_PATH, PATH_CASE_MISMATCH, INVALID_RECORD, INVALID_METADATA, INVALID_JSON, OVERSIZE, FILE_CHANGED, MISSING_REFERENCE, HASH_MISMATCH, REFERENCE_CONFLICT, REFERENCE_CYCLE, REFERENCE_IDENTITY, INVALID_HISTORY, INVALID_INDEX, INVALID_SKU_INDEX, LOCKED, LOCK_CHANGED, QUIESCENCE_REQUIRED, REVISION_CONFLICT, IDEMPOTENCY_CONFLICT, IMMUTABLE_CONFLICT, SKU_CONFLICT, CAPACITY, HEAD_CHANGED, COMMIT_ABORTED, COMMIT_UNCERTAIN, DESTINATION_EXISTS and INCOMPLETE_SNAPSHOT. `StoreError` has `code` and bounded safe `detail`; native filesystem error codes may also propagate from standalone read/export/recovery. The inspector emits code/detail without private file contents.

## Filesystem and snapshot boundary

Each access rechecks canonical root device/inode and realpath. Relative paths pass the frozen portable-path validator (including Windows drive/UNC/device/ADS and encoded traversal refusal). Existing components must have exact case, resolved containment, the root filesystem device and no symlinks/junctions; final files must be regular with one hard link. Creation uses exclusive open and no-follow where available; replacement rechecks source/destination paths immediately before rename. There remains a check/use race against an adversarial filesystem owner. Trusted local ownership and exclusive application writers are required; this does not support shared cloud folders, multi-machine locks, network filesystem atomicity or protection against a hostile local administrator.

Export copies the verified selected head, all required predecessor/record/receipt bytes and pinned workspace metadata, then writes and verifies the snapshot manifest. Every path/size/hash is checked on independent verification; missing or mismatched manifest entries refuse. Interrupted export has no complete manifest. Unknown extra files are not part of the snapshot or restored. Restore verifies source, requires a nonexistent destination, copies exact bytes and publishes the marker last, then independently reopens it. Partial outputs are retained for inspection; retries use another new destination.

Source file/Drive references, original attachment bytes, artifact byte references and decision fields experiment/evidenceReceipt/humanActionReceipt are externally owned and appear with availability `not-verified`. Their absence is neither a domain closure failure nor an accepted business fact. Other revision references must resolve in reserved Domain/Heads/Receipts namespaces. This export includes domain metadata only; it does not claim original source/attachment bytes, operational SQLite backup, native evidence resolution or authenticated approval. The internal manifest is deliberately separate from the frozen public workspace.export command and export-manifest contract, whose runtime implementation belongs to later work.

Independent inspection, with BVE and SQLite absent:

```sh
node scripts/domain-inspect.mjs /absolute/authored/restored-root
node --test test/3djat-domain-store.test.mjs
npm test
```

All new fixtures are authored: an unnamed planter, leading-zero fictional SKU, unknown/null material/dimensions/price, an unadopted operation template and explicit non-approval provenance. No photos, real product facts, sessions or private planning documents are included. Temporary roots use mkdtemp under the OS temp directory and are removed only by their owning test. Child writers/readers receive the exact disposable root in argv.

Linux evidence covers two distinct writer processes, lock recovery after killing the owner; kill/reopen at after-stage, after-immutable, before-replace, after-replace and before-reply; safe ENOSPC/EACCES/EIO injection including rename uncertainty; bounded/corrupt/missing/immutable/index refusals; head retry; symlink/hard-link/root-change containment; 256-index/128-head capacity; replay; separate snapshot restore without SQLite; and interrupted export. Cyclic author objects reject through J01 validation; the closure walker also tracks active reference paths. A hash-valid cycle cannot be manufactured by merely writing mutually referring SHA-256 placeholders. No process-kill result proves power-loss behavior.

## Windows review procedure — pending on coding host

An overseer must run the submitted commit with existing Node 24.x on a local Windows filesystem. No dependencies, browsers or runtime installs are needed. The Windows-specific test must execute rather than skip; also retain the same-suite child-process, kill, flush/rename/reopen and containment results. The test reports Node, OS release, filesystem type from statfs and method. Record the volume filesystem name (NTFS/ReFS/etc.) separately; a type number alone is not a certification of local filesystem semantics.

Run from the reviewed checkout in PowerShell, using a newly allocated disposable temp directory only:

```powershell
if ($env:OS -ne 'Windows_NT') { throw 'Windows review only' }
if ((node -p 'process.versions.node.split(".")[0]') -ne '24') { throw 'Existing Node 24.x required' }
$reviewRoot = Join-Path ([IO.Path]::GetTempPath()) ('3djat-windows-review-' + [guid]::NewGuid())
New-Item -ItemType Directory -Path $reviewRoot -ErrorAction Stop | Out-Null
$savedTemp = $env:TEMP; $savedTmp = $env:TMP
try {
  $env:TEMP = $reviewRoot; $env:TMP = $reviewRoot
  node -p 'JSON.stringify({node:process.version,platform:process.platform,release:require("node:os").release(),filesystem:require("node:fs").statfsSync(process.env.TEMP).type})' | Tee-Object "$reviewRoot/environment.log"
  [IO.DriveInfo]::new([IO.Path]::GetPathRoot($reviewRoot)) | Select-Object Name,DriveFormat,DriveType | Out-File "$reviewRoot/volume.log"
  git rev-parse HEAD | Out-File "$reviewRoot/commit.log"
  node --test test/3djat-domain-store.test.mjs 2>&1 | Tee-Object "$reviewRoot/targeted.log"
  if ($LASTEXITCODE -ne 0) { throw 'Targeted tests failed' }
  npm test 2>&1 | Tee-Object "$reviewRoot/full.log"
  if ($LASTEXITCODE -ne 0) { throw 'Regression tests failed' }
  Get-FileHash -Algorithm SHA256 "$reviewRoot/*.log"
} finally { $env:TEMP = $savedTemp; $env:TMP = $savedTmp }
# Keep reviewRoot logs for independent review; do not point this procedure at business roots.
```

Windows directory opening/fsync can return EPERM/EACCES/EINVAL/EISDIR/ENOTSUP; only those directory-flush limitations are tolerated on Windows. File fsync and actual rename/read-back failures remain failures or uncertainty. Windows success reports `file-fsync;directory-flush-unverified`; Linux success reports `file-and-directory-fsync;no-power-loss-claim`. Neither platform string asserts storage-hardware ordering or survival of sudden power loss. J03A remains review-pending until the actual Windows gate and independent review pass. J02 native readiness remains unverified; J03B/J04 are not assigned by this storage change.
