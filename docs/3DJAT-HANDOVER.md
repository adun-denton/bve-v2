# 3DJAT handover

Start here for the J12 authored continuation of reviewed J11 `69f4036`. This is a coding package awaiting independent review, not an installed environment or accepted release. The exact submitted head/tree is in the return's SOURCE-PROOF.json; preserve that source and its Git bundle. `candidate.json` describes an older upstream candidate, not this handover pin. The known coding checkout is not Mahsa's operating installation.

## What exists and who acts next

The three structures remain separate: business/product/template files hold business authority; private SQLite holds operational history and original bytes; source and private host integration supply software/instructions. Product IDs and choices survive sessions. Reviewed Conductor/Butler/worker files describe roles; they do not prove real supported sessions. Staff remains one SOL Conductor, one on-demand LUNA Butler and zero to six workers, with zero setup workers or image calls.

Use the existing photo -> prepare -> compare -> comment -> revise -> compare -> explicitly select Instagram artistic workflow. Technical setup belongs here, outside Products.

| Stage | Current readiness | Next owner/action |
|---|---|---|
| 1 Discover/preserve | Operating machine, roots, permissions, capacity and backup unverified | Installer identifies existing source, business/runtime roots and owner; preserves edits and verifies backup before change |
| 2 Business identity/folders | File authority implemented; actual private mapping unverified | Business owner verifies agreed path map, all four product seeds, sources and existing roots; do not move them into a sample tree |
| 3 Definitions and sessions | Definitions available; real Conductor/Butler blocked | Host owner supplies actual supported IDs, instruction acknowledgements, model/resume evidence and harmless round trip; no role-file substitution |
| 4 Contracts/defaults | Authored validation available; live facts/Brand/logo/RAW unverified | Business owner preserves unknown facts and proposal/approval distinctions; missing optional media blocks only dependent operations |
| 5 Activation decision | Blocked | Installer/supervisor resolves every mandatory prerequisite, exact source/root compatibility, host ownership and preservation; a concrete installation-dependent session exception requires its specific approval |
| 6 BVE last | Production connection/installation not authorized | Installer uses accepted source, exact existing roots and supported connection/backup paths only after Stage 5 and separate provisioning authority |
| 7 Integrated/user handover | Incomplete; native pilot blocked, user testing deferred | Independent reviewer completes qualification; later Mahsa reviews the three planned examples |

`node scripts/handover.mjs <absolute-business-root> <absolute-runtime-root>` provides a concise read-only view. `--json` adds paths, hashes and file identities for private inspection. It never opens SQLite, prints credentials, initializes folders, starts the server, installs a host or authenticates native receipts. Exit 1 means activation remains blocked; exit 2 is invalid CLI usage. Ready rows certify only the named readable files, not a functioning installation. This informational command does not wrap or change the existing server's authority; direct startup still requires the seven-stage decision. Keep its technical JSON private.

## Discover actual paths before commands

Record source pin and clean/dirty state, Node 24.x/Git versions, machine/operator, business root/workspace UUID/head/path map, explicit runtime root, private principal registry and driver/envelope locations, storage/free space and preservation backup. Check ACLs without exposing secret values. Keep live SQLite on reliable local unsynced storage. Do not guess drive letters or use a default empty root. Existing path-map and schema/source mismatches stop the handover; do not migrate or downgrade to make startup pass.

The commands below are supported methods for a later authorized operator. Replace variables only with discovered, approved paths; none are operating-machine paths supplied by this package. Run from the exact reviewed source checkout.

```powershell
$BusinessRoot = '<verified absolute business root>'
$RuntimeRoot = '<verified absolute existing private runtime>'
node scripts/handover.mjs $BusinessRoot $RuntimeRoot
node scripts/domain-inspect.mjs $BusinessRoot
```

First connection uses the existing trusted `serve({root, workspace, expectedHead, ...})` and J03 adoption APIs, not `project.activate` to duplicate prepared products. See [workspace connection](3DJAT-WORKSPACE.md). A reviewed connection file contains only `workspace` and `expectedHead`; its workspace has exact workspaceId/domainRoot/runtimeRoot/path map/storage. The existing CLI accepts `node src/server.mjs --root $RuntimeRoot --workspace-config '<verified absolute connection JSON>'`. It does not provision domain records, grants, feature migrations or staff; prepare those only through their existing independently authorized APIs before handing over. No empty-root connection is performed by this coding package.

## Start, stop and resume an already connected runtime

After the prerequisite decision and explicit activation authority, check marker/schema and complete verified backup. Then:

```powershell
node src/server.mjs --root $RuntimeRoot
```

Retain the actual URL printed by that owner process, normally loopback port 4317, and open its Products page on the runtime machine. A printed URL is not evidence of reachable browser presentation. Stop in the owning console with Ctrl+C and wait for exit; do not kill an unidentified owner, delete owner/lock files or start a second owner. Restart the same pinned source with the same explicit runtime root. Closing a browser does not stop the owner. Saved rounds, comments, choices and domain revisions remain; retain the original browser's local storage for unconfirmed actions/unsent edits. Reconcile exact retained keys before new actions. Running/uncertain image attempts must never be automatically retried.

For session replacement, use the installed host's exact supported session mechanism and scoped envelopes; never print or reuse another actor's credential. When automatic wake is unavailable: **Reopen the product's Conductor and ask it to resume the project and read unread durable events.** Inspect and acknowledge the actual durable event/checkpoint. No real Conductor link, verified runtime URL or native receipt is available from this coding run.

## Combined backup and separate restore

Use a new private destination, preserve both runtime and independently authoritative domain state, and keep the host/principal registries, pending envelopes and original browser recovery storage under their separate private preservation policy. The combined backup is declared closure, not a whole-drive or host-session backup; see [backup scope](3DJAT-WORKSPACE.md#combined-private-backup-and-separate-restore).

```powershell
$env:BVE_ROOT = $RuntimeRoot
node scripts/backup.mjs '<new absolute private backup directory>'
node --input-type=module -e "import {verifyCombined} from './src/workspace-backup.mjs'; console.log(verifyCombined(process.argv[1]).schemaVersion)" '<absolute completed backup>'
node scripts/restore-workspace.mjs '<absolute completed backup>' '<absolute reviewed new mapping JSON>'
```

The restore mapping contains `businessRoot`, `runtimeRoot`, `paths`, `storage: 'local-unsynced'`. Both destinations must be nonexistent, separate from preserved roots and the backup; path-map values must match the restored relative workspace folders. Restore verifies bytes/schema before allocating destinations, rebinds only technical absolute paths and rebuilds the disposable projection. Never overlay a live root or launch directly inside the backup. Stop the owner first, preserve the original roots, restore separately, inspect domain records with BVE down, and verify product IDs, historical choices, original hashes and pending attempts before an authorized restart. Newer schemas are refused; rollback requires a verified compatible backup and source, not older code over newer live data. Do not clear unknown locks. Backups contain secrets: do not publish them.

## Evidence limits

J11-UX01 is closed by supervisor v58. Last fully accepted offline stage remains J09 `6186a1c`; J10/J11 integrated qualification is incomplete. Coder J11 7/7 and affected 179/180 remain prior-source evidence; the affected HTTP check failed with localhost EACCES. V57 coder focused/journey 5/5 and final quick UX 4/4 remain separate from v58 independent quick UX 4/4 and its failed Example3 LOCKED run. The retained failure reaches exclusive domain-lock acquisition in worker assignment; the supplied log does not identify the holder or establish a product defect. No lock was cleared and it was not blindly repeated. J12 recovery smoke exercises its own changed discovery/restart/backup boundaries, not that failed Example3 claim.

Actual browser navigation previously failed with `net::ERR_NETWORK_ACCESS_DENIED`; no unchanged retry, bypass or screenshot is provided. Normal/narrow rendered qualification remains open. Authored tests do not establish real native generation, pilot IMG20/P1122-COLD, or Mahsa's acceptance. All 32 inherited dispositions remain unchanged. No production installation, real migration/provisioning, native/paid execution, push retry/bypass, merge or release is authorized here.
