# Install and resume BVE

For local testing, the public `main` branch contains the reviewed V2 development candidate; it is **not a stable release**. Check `candidate.json` for the exact tested `implementationCommit` (`2a5be1effa25e23bf57cbe999fb8a686c6f5a366`). Use that commit for byte-identical reproduction, or `main` for the integrated local-testing candidate with subsequent evidence and documentation. Do not confuse publication with native host or designer acceptance. Node 24.x (tested 24.19.0), Git and bundled npm/node:sqlite are required. Runtime npm dependencies are zero. Browser testing uses pinned Playwright 1.62.1 and a compatible Chromium.

Installation owns the reusable host integration: actual session/delegation/model tools, private scoped transport, browser presentation and originating-interaction return. It is not project staff and creates no fixed workforce. The first BVE project chat is the existing SOL Conductor. Exploration does not create production staff/folders. On explicit production intent Conductor activates/resumes the named project and obtains Butler/Gen workers on demand, following [Examples A–C](EXAMPLES.md). Designer credential/file-transfer/worker setup is installer work, not a repeated creative-flow task.

## Mandatory organizational setup gate (before application installation)

Record the exact source checkout, the exact private `BVE_ROOT`, the existing Conductor chat/identity (if any), the selected existing project (if any), and the responsible installer/operator. Then declare `ORGANIZATIONAL SETUP: PASS` only when source, root, preservation/backup status, host-adapter owner and the current instruction locations are known; otherwise declare `FAIL` with the missing item and stop before `npm ci`, `npm start` or host installation. This gate provisions neither a project nor staff: exploration remains the existing Conductor conversation and creates no production folder, round, Butler or workers.

## Preserve the installation

For an existing installation identify its actual source/runtime/root and selected project. Preserve all historical checkouts and uncommitted work. Back up the active root before changing runtime/schema. Keep projects, originals, notes/submissions/favorites, attempt history and unread events. Never replace the root with an empty workspace or regenerate completed work merely to test setup. Keep private local launchers/bridges/tokens out of Git. This cloud candidate does not access the operator's Windows installation.

For a genuinely new installation choose a new private root outside source control. Unknown nonempty roots are refused. Retrieve a pinned clean checkout, run npm ci --omit=dev --ignore-scripts and npm test, select BVE_ROOT, then npm start. The owner binds http://127.0.0.1:4317/ only; no public port/tunnel. A second owner of the same root is refused. The browser receives only its human credential.

```sh
BVE_ROOT=/exact/private/root npm start
```

PowerShell: set `$env:BVE_ROOT` to that exact private root before npm start. Do not blindly change an existing checkout's branch. Default root is ~/.bve-v2/workspace-v1 only for an unconfigured new installation.

## Host adapter and first work

Install a trusted private driver implementing [HOST-DRIVER](HOST-DRIVER.md). Discover actual capabilities without image calls: creating/resuming exact SOL/LUNA sessions, original-byte return in those actual workers, browser presentation and completion to the originating Conductor. Documented tools and the installer's callable tools are not proof of child-session capability. No paid provider substitution.

```sh
BVE_ROOT=/exact/private/root npm run install:host -- install /private/host-driver.mjs
BVE_ROOT=/exact/private/root npm run install:host -- status
```

The installer backs up before updating host configuration and excludes concurrent installation. Runtime-ready means a host connection was supplied, not a demonstrated project production cycle. The built-in unavailable driver leaves integration incomplete. Do not create named dummy chats to close a gap.

The actual host attaches the existing first chat's identity to a scoped Conductor bearer. Production project.activate binds that existing session. The Conductor-side runtime helper reserves staff slots and uses host session tools, reusing B1 and exact job keys. Butler confirms its assigned statement before any workers are provisioned. The host configures each actual session with only its own scoped envelope/instructions; it must verify actual receipt and cannot imitate all actors in the installer. No generation on setup or session replacement.

After supported-host verification, hand the user its actual Conductor session link/identifier with the preserved canonical project context. For new work it should be ready for the first brief; for existing work it must resume the existing project. If automatic return is unavailable, explicitly explain the user's required resume action. Without actual session/model/transport/return/browser support, native operational installation remains incomplete. The current cloud execution verifies fixtures, not an operational Windows staff handoff.

## Mandatory operational round-trip gate (after host installation)

After an explicit production intent only, prove one actual non-generation `Conductor -> Butler -> BVE -> Conductor` cycle against the preserved project: bind/resume the real Conductor; create/resume the exact LUNA Butler at its stable key; deliver and receipt one `compare`, `organize`, or `branch` statement referencing existing records; have Butler verify scope, present only those existing references in BVE, report completion and commit the checkpoint; then return the exact durable event to the originating Conductor and record its acknowledgement or the required manual resume action. Declare `ROUND-TRIP: PASS` only with actual session IDs/receipts, round/checkpoint/event IDs and the demonstrated return mechanism. Any missing receipt, scoped delivery, checkpoint, or return is `FAIL` and leaves operational installation incomplete. Make no image call, create no Gen worker, replace no session, or fabricate a project merely to pass this gate.

## Persistence, backup and rollback

Stop with Ctrl+C; restart the same source/root/URL. Closing a browser/session leaves deterministic owner services running. Owner restart marks previously running external attempts uncertain, processes durable inbox entries and preserves events. Never automatically reinvoke uncertain work. Durable project/page/iteration and project/page/round URLs reopen saved views. Saved drafts survive browser replacement; unsent edits require that originating browser's retained storage and conflict recovery.

```sh
BVE_ROOT=/exact/private/root npm run backup -- /new/private/backup-destination
```

Online SQLite backup includes originals, authoritative records, credentials, roster, statements, events and checkpoints. Existing destinations are never overwritten. Project directories are derived and reconstructed on recovery; external pending tool returns and provider session state require the host driver's preservation policy. Keep backups private.

Restore by stopping the owner, preserving the damaged root and selecting a complete backup/separate copy; never overlay a live root. Restore exact missing original bytes, not screenshots. Roll back source separately while preserving the root and backup. Stop host automation before using source that does not understand current scoped operations. Do not open V2 records with legacy BVE code.

## Disposable verification

npm run verify exercises contracts and browser workflow on disposable roots. npm run evidence:repairs and npm run evidence:projects record authored evidence. npm run demo uses an explicitly separate demo root with simulated PNGs. Install dev dependencies/browser for tests only; BVE_BROWSER_EXECUTABLE can select a provisioned compatible Chromium. The Linux evidence uses test-only @sparticuz/chromium 153.0.0. Fixtures do not prove native generation, concurrent execution, unattended notification, designer usefulness or design acceptance. See the current PROJECT-REVIEW and evidence manifest for exact identities/results.
