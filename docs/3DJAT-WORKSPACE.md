# Prepared workspace integration — J03B

This slice connects an explicitly reviewed prepared domain to private BVE operations. It does not provision a business environment, authenticate proposed human decisions, install a host, create sessions, change image limits or implement J04. Accepted J03A remains the independent file authority. Filesystem owners remain trusted; local unsynchronized storage is required.

## Decisions recorded before implementation

| Concern | Decision |
|---|---|
| Identity | Trusted constructor configuration verifies workspace/head/absolute approved folders before operational initialization. Explicit owner adoption consumes the frozen workspace.adopt request, reuses product UUIDs, and creates no request/round/staff. Exact-ID existing projects retain operational history; unrelated IDs are untouched |
| Fields | Working name, productCode, facts and templates come only from verified domain files. SQLite project rows own display P-codes, operational brief/defaults/instructions/history. Projection rows have no public write endpoint |
| APIs | Trusted owner setup/adoption and internal selection primitives only; no workspace commands added to HTTP/Kernel.call. Frozen request validation supplies human context only after existing owner credentials verify. Responses are internal operational acknowledgement records, not a new public command/result format |
| Migration | Opt-in integration metadata v1 and SQLite user_version 1; ordinary roots remain version 0. Existing legacy state requires explicit migration, quiescence and a verified current private backup. Unsupported marker/SQLite/integration versions refuse before initialization. Never run older source on integrated live state |
| Projection | Rebuild from a fully verified head; compare content as well as exact head. On file failure expose stale historical knowledge and block requests/commissioning needing current knowledge. Domain commit and cache acknowledgement are separate; refresh failure never rewinds domain history |
| Frozen selection | Owner-only narrow product/template/business selection checks current exact references and persists original verified bytes, bounded to J03A closure limits. Immutable snapshots survive later edits/cache rebuild and require no live domain for historical reading |
| Adoption commits | Connection/schema and adoption are separate operational transactions. Scoped receipt lookup precedes stale CAS; adoption/project links/ack commit together. Before commit: rollback; after commit/before reply: uncertain, reconcile same packet/key. No distributed file/SQLite transaction is claimed |
| Paths | One resolver for adopted approved Products/UUID and legacy runtime Projects/UUID, used for displayed and created folders. Explicit absolute roots, case/device/realpath checks, no junction/symlink/hard-link escapes, disjoint business/runtime roots; approved base folders must already exist |
| Quiescence | Exclusive nonce operational lock around every adopted-kernel transaction/schema boundary; combined backup locks domain first, then operations. No PID/TTL stealing; explicit quiescent hash-checked recovery preserves lock bytes. Locks span filesystem/SQLite copy only, never model/host waits |
| Combined closure | New private destination: domain metadata/history snapshot, consistent SQLite backup, private marker/credentials, all referenced historical attachment originals and resolvable operational evidence. Missing required bytes/evidence is incomplete; external historical sources remain explicitly unresolved. Manifest published last, exact hashes verified |
| Restore | Verify complete backup before allocating two new roots, restore exact domain/original/operational bytes, explicitly rebind only private absolute mapping and rebuild disposable cache. Preserve IDs, receipts, historical selections and attempts/approvals. Completion marker last; interruptions preserve partial new roots and never overlay live state |
| Bounds | J03A JSON/closure limits unchanged. Combined backup uses bounded streaming, at most 4096 payload files, 1GiB SQLite, 1GiB attachments in aggregate, 2GiB total, existing 256MiB per attachment, 1MiB manifest. Capacity refuses; no history eviction |

Windows/local filesystem verification of the submitted J03B source is required before acceptance. Linux tests and process kills do not prove Windows behavior, directory flush ordering or power-loss durability. J02 native readiness, IMG20 and P1122-COLD remain separate gates.

## Explicit connection and ownership

The trusted local owner supplies this private configuration, never source JSON or an HTTP role label:

```js
const workspace = {
  schemaVersion: '3djat.connection.v1', workspaceId,
  domainRoot: approvedAbsoluteBusinessRoot,
  runtimeRoot: approvedAbsolutePrivateRuntimeRoot,
  paths: { business: approvedBusinessFolder, products: approvedProductsFolder,
    templates: approvedTemplatesFolder, operations: approvedOperationsFolder },
  storage: 'local-unsynced'
};
const kernel = new Kernel(workspace.runtimeRoot, {
  workspace, expectedHead: independentlyReviewedHead
});
// owner is the existing private installation credential set, never packet.actor.
const packet = {
  schemaVersion: '3djat.command.v1', operation: 'workspace.adopt', key,
  expected: { domainHead: reviewedCurrentHead, entityRevision: 0 },
  input: { ...preparedWorkspaceRecord, revision: 1, domainHead: reviewedCurrentHead }
};
const acknowledgement = kernel.adoptWorkspace(owner, packet);
```

All four approved absolute base folders must already exist and exactly match the prepared workspace's relative path map. The domain and runtime roots and the four domain base folders must not overlap each other. Reserved storage namespaces cannot be business folders. Explicit configuration is validated before creating SQLite or credentials. `storage` is the trusted owner's local/non-synchronized-storage attestation, not automatic detection of cloud synchronization; UNC roots are refused. The code does not discover business roots, move files, create a second business hierarchy or sandbox its filesystem owner.

Connection configuration is persisted only in the existing SQLite records table as `domainIntegration/active`, schema `3djat.integration.v1`, with config and adoptionRevision. This is private installation binding, not another business head. SQLite user_version 1 identifies this opt-in extension; there are no new tables or writable current-business APIs. Existing rows remain operational history. Prepared workspace.json stays the immutable initial mapping/genesis record supplied by J03A.

`adoptWorkspace(owner, packet)` uses the frozen workspace.adopt request and validateCommand's caller/CAS rules. Owner credentials are checked first through the existing installation boundary, then authenticatedCaller=human is supplied internally. Adoption revision is the local mapping/acknowledgement sequence (0→1 initially); subsequent explicit acknowledgements advance it by one. Relative paths and workspace identity must match the prepared store; its exact current head must match expected.domainHead and input.domainHead. The resulting internal `3djat.adoption-ack.v1` record contains id, revision, workspaceId, head and projectIds. It is an operational receipt, not a public 3djat.result or a claim that a domain mutation occurred. Scoped existing SQLite receipts bind workspace/owner/operation/key and exact packet payload. Replaying an original key returns its original acknowledgement before stale head/mapping rejection; a changed payload conflicts.

Every prepared product maps to its exact UUID. A matching existing UUID is adopted only through this explicit call, retaining its operational history, brief/defaults and old physical folder. Other projects are untouched even if names match. Adopted folders resolve to approved Products/UUID; ordinary folders resolve to runtime/Projects/UUID. All statement views, project creation/activation projections, project reads, Butler-ready creation and deterministic reconciliation share that resolver. No files are moved from old folders. Adoption itself creates no product folder, request, round, staff or job. Session binding can subsequently reuse this UUID through the existing owner API; project.activate must not be used to duplicate a prepared product.

| Field | Authority after adoption |
|---|---|
| UUID | Prepared product UUID, reused as project.id |
| Working name, productCode, facts, dossier entries | Verified current product file; null/unknown retained |
| P001-style code | Existing BVE display code, independent of productCode |
| Templates/business context | Verified exact domain records |
| Operational brief/defaults, projectInstruction, rounds/jobs/results/acceptance | Existing operational records/APIs |
| Current folder | Approved mapping plus exact UUID; no stored-path override |

Kernel.read(project) adds a domain object with status=current/stale, cause, exact head/reference and record. When stale these are labelled cached historical knowledge; requests and commissioning that need current product knowledge refuse DOMAIN_UNAVAILABLE. Ordinary historical records and frozen selections remain available. This also applies when the domain disappears during the same open kernel: project views retain cached identity/name/code/dossier/head, and statements retain their cached project name/head. Both expose folder=null. Reconciliation continues existing operational work without creating adopted directories while current domain verification is unavailable. Returning the exact original root permits verified refresh in that kernel without resetting bindings, histories or receipts. The resolver still checks root identity and existing product paths before returning stale history; replacement roots and junction/symlink escapes refuse, including dangling links. No UI workflow was added.

`refreshDomain(owner)` fully verifies files and reconstructs the projection; it compares content as well as head tags, including rebuilding malformed cache JSON. Cache rows (`3djat.projection.v1`) are disposable. Failure returns status=stale, verifiedHead when observed, cause and cacheCommitPossible where a cache transaction may have committed. The domain remains unchanged. Fix source availability through its owning process and retry/reopen; cache success is not a domain commit acknowledgement or approval.

## Frozen selections

```js
const selection = kernel.freezeDomainSelection(owner, {
  key, projectId: productId, expectedHead, product: exactProductReference,
  templates: [exactTemplateReference], business: null
});
const historical = kernel.frozenDomainSelection(owner, selection.id);
```

This narrow internal primitive checks adopted identity, exact current membership and head, then stores immutable original verified bytes in a `3djat.selection.v1` operational record. It uses the accepted J03A closure verifier again on historical reads, with an in-memory file map, without touching the live domain. It preserves the selected product/templates/business references and the complete verified metadata/history closure needed to resolve them. The maximum is 128 selections; each retains J03A's 4096-file/32MiB/1MiB-per-file limits and at most 16 selected templates. Capacity refuses rather than evicting history. Scoped receipt replay returns the same ID. Existing rows cannot be overwritten through this primitive. A later edit, projection rebuild or restart cannot rebind old bytes. J07 will call this primitive; J03B adds no operation/calibration executor. Snapshot validity proves exact data, not actual human approval, operational executability or external-byte availability.

## Schema, interruption and rollback

Known upstream roots without explicit mapping keep their default UUID/folder behavior and SQLite user_version 0. First connection of populated legacy state requires migrate=true, confirmedQuiescent=true and migrationBackup pointing to a new private SQLite-only backup. Stop all older owners/clients first. The backup's marker/credential bytes and full logical records/receipts/original-byte fingerprint must match the source; stale backups refuse BACKUP_MISMATCH. This is a reviewed opt-in metadata migration, not automatic adoption by name or folder discovery. Empty fresh roots need no legacy backup. Unknown populated roots, unsupported root/SQLite/integration versions and missing operational databases refuse; no empty history is fabricated.

| Interrupted boundary | Retained outcome / next action |
|---|---|
| Invalid config/domain/head, before operational initialization | No operational root allocated; correct reviewed inputs |
| Initial marker/credentials written, before schema exists | Preserved incomplete root, MISSING_OPERATIONAL_DATABASE on reopen; investigate it and use another fresh root, never silently initialize history |
| Before connection transaction commits | Metadata/version roll back; retry explicit setup with the same verified inputs |
| Connection committed, reply hook failed | CONNECTION_UNCERTAIN; retry/reopen reads the committed binding, no second workspace |
| Before adoption commit | Project links/ack/receipt roll back together |
| Adoption commit attempted or reply failed | ADOPTION_UNCERTAIN; reconcile exact original packet/key to the original receipt |
| Domain writer published, projection refresh fails | Domain head survives; stale/cacheCommitPossible status is honest; retry refresh, never roll back domain files |
| Interrupted combined export | Missing/invalid completion manifest is INCOMPLETE_BACKUP; preserve partial output and choose a new destination |
| Interrupted restore | New partial roots retained; restore-in-progress.json makes Kernel refuse RESTORE_INCOMPLETE; inspect/preserve them and restore again into new paths |

Do not run an older source checkout against integrated/newer live state. Root/SQLite version checks in this source cannot retrofit checks into old binaries. For rollback, preserve the live roots, copy a verified pre-migration private backup into another new owner-only runtime directory and use its compatible accepted source there; keep the business root intact. Never overlay live data, launch directly in the retained backup, delete business revisions or reset attempt/approval history. Separate restoration is the rollback boundary.

## Combined private backup and separate restore

`backupRoot(source, newDestination, {hook})` preserves the old API. For an unadopted root it writes the existing SQLite/private-marker/credentials backup plus backup-scope.json explicitly marked sqlite-only. For an integrated root it routes to backupCombined. Both source and destination must be separately approved; combined roots/destinations cannot overlap. Destination must not exist.

Combined backup acquires the accepted domain lock first and operational-write.lock second. Every integrated Kernel schema/transaction boundary participates in the operational lock, including constructor recovery, reconciliation, commissioning and intake. Writers fail with LOCKED/OPERATIONAL_LOCKED rather than creating a mixed snapshot. Locks contain exclusive random nonce/PID diagnostic bytes, are flushed and released only on exact-byte match, and are never stolen by PID/TTL. recoverOperationalLock requires independently established quiescence plus expectedLockHash, preserves the bytes under private Recovery, then removes only that lock. J03A's lock recovery remains separate. No lock spans model/host/tool invocation.

| Backup path | Scope and verification |
|---|---|
| domain/ | J03A complete metadata/history snapshot and manifest; independently readable without SQLite |
| runtime/workspace.sqlite | SQLite native backup; switched to DELETE journal mode before hashing so verification creates no WAL/SHM sidecars |
| runtime/bve-v2-root.json, credentials.json | Exact private files, owner-only file creation; credentials never appear in domain export or manifest contents |
| attachments/relative-location | Every referenced historical attachment original, verified size/SHA-256 with bounded 1MiB streaming buffers; no execution/conversion |
| evidence/Operational/kind/id.json | Exact SQLite record doc bytes for supported declared external evidence references; hash/ID/revision verified |
| combined-backup.json | Versioned private completion manifest written last; workspace/head, sorted path/size/hash inventory, attachments, evidence and unresolved historical sources |

Declared operational evidence can resolve the existing round, statement, statementEvent, checkpoint, event, submission, acceptance and workspaceAcknowledgement record kinds via Operational/kind/id.json. Unknown/future evidence kinds are incomplete, not fabricated. This verifies bytes/identity only; an authored acknowledgement does not become a real human action because a test reference points to it. Operational artifact references additionally match exact project/version/hash/dimensions and verified originals. Missing required attachments/evidence blocks a complete backup. External historical source locations may remain not-verified. Unreferenced surrounding business files and forensic Recovery/orphan staging are preserved at the source and are not claimed included; this is the declared domain/operational/attachment closure, not a whole-drive backup.

Verification checks manifest/file hashes, exact domain closure, SQLite integrity/version, operational top-level references, original BLOB hashes and accepted PNG dimensions, frozen selections, private credential shape and attachment/evidence closure. No credential values enter manifests. New files/directories use 0600/0700 where the platform enforces POSIX modes; Windows owners must verify appropriate local ACLs independently. Effective SQLite size (including WAL pages) is checked before traversal/copy. The bounded pilot limits above can refuse a larger valid store; they never silently drop evidence.

```js
const manifest = verifyCombined(backupRoot);
const result = restoreCombined(backupRoot, {
  businessRoot: newAbsoluteBusinessRoot, runtimeRoot: newAbsolutePrivateRuntimeRoot,
  paths: approvedNewAbsoluteFolders, storage: 'local-unsynced'
});
```

Restore verifies source before allocating either destination. Both roots must be nonexistent; the explicit new folder map must match the preserved relative workspace paths. It restores domain metadata, creates only those approved base folders under the new business root, restores attachment originals and private operational files, and verifies them. It rebinds only the technical absolute configuration and rebuilds the disposable projection in a transaction. Historical selections, original bytes, operational receipts, IDs, attempts and approvals are retained; no reconciliation or recovery routine is invoked to manufacture workflow events. Completion marker combined-restore.json is written last and the in-progress marker removed. Independent domain inspection still works when SQLite is absent; Kernel refuses to recreate missing operational history.

Read-only inspection: `node scripts/domain-inspect.mjs /absolute/restored-business-root`.

Private recovery CLI: `node scripts/restore-workspace.mjs /absolute/combined-backup /absolute/new-mapping.json`. The mapping JSON contains businessRoot, runtimeRoot, paths and storage as above; it grants no authority to overwrite existing roots.

Server connection is available through explicit serve({root, workspace, expectedHead}) options. CLI uses `node src/server.mjs --root /absolute/private-runtime --workspace-config /absolute/connection.json`; connection JSON contains only workspace and expectedHead. Once connected, reopen the same explicit runtime root normally; the persisted binding is verified. No server is needed to prepare/read domain files. This coding slice does not authorize running that command on the operating installation.

## Verification and outstanding gates

Public tests use authored unknown/null product facts, fictional codes/templates, dummy session claims, deterministic fixture PNGs and attachment bytes. They do not call image/host providers. Run on existing Node 24.x:

```sh
node --test test/3djat-workspace.test.mjs test/3djat-workspace-backup.test.mjs
npm test
```

Coverage includes exact UUID adoption/replay/conflicts; no setup workforce/request/round; legacy backed migration and all folder sites; projection corruption/refresh failure; frozen historical selections; schema/interruption refusal; real backup/domain/operational child-process contention; exact original/attachment/credential restore; preserved running attempt/acceptance; missing/corrupt/incomplete payloads; multi-chunk attachments; symlink/junction/root replacement; and Windows-only path/backup/restore checks. An OS that refuses moving an open SQLite directory reports that replacement scenario skipped, never passed.

For overseer Windows verification, use J03A's disposable PowerShell procedure, substitute the two focused test filenames above, then run npm test on the exact submitted J03B commit. Allocate a new local non-synchronized temporary directory and preserve logs, source SHA, Node/Windows version and volume filesystem. The new Windows-specific test must run rather than skip; retain any explicit OS refusal skip. Windows directory fsync restrictions remain as documented by J03A. Earlier J03A Windows success does not certify J03B. Independent review, not these fixture results, accepts J03 or releases J04.
