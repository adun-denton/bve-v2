# Installation and operational handoff

## Changed contract

The 17 October 2026 user-directed requirement adds operational host provisioning to installation. The earlier candidate stopped at dependencies, private state and server startup; it did not implement separate role sessions or a verified first Conductor handoff. Server startup remains useful for recovery but is not a completed operational installation.

An authorized installation session owns dependency discovery, a reusable host adapter, role instructions, scoped access, distinct real Conductor/Generator/Butler sessions, connection tests and the initial work-session handoff. The designer should not configure credentials, worker chats or file transfer. Ordinary bounded operations use standing authorization without repeated permission dialogs. Human review and explicit design acceptance remain separate.

## Preserve and inspect

Use the exact tested source commit in candidate.json or the implementation return, not arbitrary main. Main is an earlier documentation designation. Do not blindly change an existing checkout's branch. Preserve historical checkouts and uncommitted work. Public installation requires no private planning repository.

For an existing installation, identify its actual source, runtime, root, owner and selected project. Back up the active root before changing runtime or schema. Preserve projects, immutable originals, submitted feedback/favorites, identities, attempt history and unread events. Reopen that same root and project. Do not substitute a new empty root, recreate the project, or regenerate finished work to demonstrate setup. Do not publish local bridge records or scoped tokens. This cloud implementation does not access or modify the operator's Windows installation.

For a new installation only, choose a new private root outside source control. Refuse unknown nonempty roots. Node 24.x with bundled npm/node:sqlite is required (tested 24.19.0). Git retrieves a pinned checkout. Runtime npm dependencies remain zero; browser checks use Playwright 1.62.1. Full Windows/macOS installation and OS recovery are not established by Linux fixture checks.

## Technical installation, owned by the installer

1. Retrieve the pinned checkout into a clean separate directory, or preserve and inspect the intended existing checkout. Install Node 24 if absent, run `npm ci --omit=dev --ignore-scripts` and `npm test`.
2. Select the exact preserved `BVE_ROOT` (new root only for a new installation). Back up an existing root with `npm run backup -- NEW_PRIVATE_DESTINATION` before runtime changes. Start the loopback owner with `npm start`; default URL is http://127.0.0.1:4317/. Do not create a second owner or expose/tunnel the port.
3. Discover actual session creation/reuse, delegation, child image-tool access, original-byte transport and notification/resume support. Separate documented support from exercised support. No setup image calls or paid provider substitutions. Reuse prior native evidence only when its host/executor/transport is applicable and can actually be inspected.
4. Install a private host driver implementing [HOST-DRIVER](HOST-DRIVER.md), using the existing function contracts. Provision actual distinct role sessions and [role instructions](roles/CONDUCTOR.md), identities, scoped access, durable routes and replacement behavior. The built-in unavailable driver honestly leaves setup incomplete. There is no bundled native account integration.
5. Verify fresh scoped context reads by all sessions, Conductor-originated readiness delegations and real recipient receipts, boundaries and recovery. Establish native original-byte delivery under an already pending bounded request, or inspect applicable prior evidence. Do not generate extra images merely to test installation.
6. Start/resume the actual Conductor work session, verify a fresh canonical read of the preserved project (or readiness for a first brief in an empty workspace), and deliver its real user-openable link. Verify it delegates to Generator/Butler without the installer performing their work. Operational completion requires this handoff and tested essential capabilities.

Installer-only entry point, after installing the actual private driver:

```sh
BVE_ROOT=/exact/private/root BVE_URL=http://127.0.0.1:4317 npm run install:host -- install /private/host-driver.mjs EXISTING_PROJECT_ID
BVE_ROOT=/exact/private/root npm run install:host -- status
```

PowerShell: assign `$env:BVE_ROOT` and `$env:BVE_URL` first. Omit project ID only for an empty new workspace. Unbound new-workspace sessions have no ambient record access; the first human-created project binds them automatically. An existing workspace requires explicit project selection. The installer automatically makes an additional private backup before host bindings change. Credentials and session bindings live privately in SQLite; derived role access envelopes live under the private root. These commands are installation administration, not the designer's creative workflow.

The built-in status is **incomplete** without an actual driver. Creating labels, writing instructions, a green server health check or a fixture pass cannot make it operational. An essential gap must be named exactly. A host can be resumed by durable polling when push is absent: the user reopens the supplied Conductor session and sends a resume message if the host cannot wake it. Do not promise background/unattended work from an active-task message test.

## Runtime continuity and boundaries

Conductor commissions/interprets and delegates. Generator allocates and durably starts each bounded attempt once, then manages the assigned executor and original return. Butler's conversational session coordinates continuity; deterministic startup/timer services independently validate/hash/register outputs even when every AI session is gone. Session replacement revokes the old bearer and rebinds unfinished inbox routes; it never creates execution authority for a running/uncertain attempt.

The owner binds loopback only and checks Host/Origin. The browser receives only the human credential. Role sessions receive one project-bound bearer, not all owner credentials; assigned executors receive only their assignment token and frozen inputs. Local filesystem ownership is trusted, not an OS sandbox against the owner. Keep roots, access files and original-return records private. HTTP is the normal transport. A host with tested shared filesystem access but unreachable cross-execution loopback can use the scoped local Kernel command transport, with `recover:false`; it does not acquire owner status or reinterpret an existing start as permission.

Stop the owner with Ctrl+C; restart using the same root. A second owner is refused. No daemon installation is bundled. Closing a browser/session leaves committed reviews and deterministic services intact while the owner lives. Restart marks formerly running work uncertain, recovers the durable inbox and preserves unread events. Never automatically invoke uncertain work again. The exact project/page/iteration URL reopens existing boards. Saved drafts survive browser replacement; unsent edits require that browser's retained storage and explicit version-conflict handling.

## Backup, recovery and rollback

`npm run backup -- NEW_PRIVATE_DESTINATION` uses SQLite's online backup and includes original BLOBs, records, role bindings/receipts, marker and credentials. It excludes the owner lock. Derived session envelopes can be regenerated by safe host resume; host-provider transcripts, external pending results and private bridge files require that driver's own preservation policy. Existing destinations are never overwritten. Keep backups private.

Restore by stopping the owner, preserving the damaged root, and selecting the complete backup or separate copy as BVE_ROOT; never overlay a live root. Inspect unread events and uncertainty. Restore exact missing originals rather than substituting screenshots. Rollback source separately while keeping the active root and backup. Older source does not enforce new session bearers; stopping host automation before rollback is required. Do not open a V2 database with legacy BVE code.

## Verification and separate demonstration

`npm run verify` runs contracts and browser checks on disposable roots; `npm run evidence:repairs` records authored fixture envelopes. Browser checks require dev dependencies and compatible Chromium. The recorded Linux browser came from test-only @sparticuz/chromium 153.0.0; it is not a runtime dependency. `npm run demo` seeds authored PNG fixtures only in an explicitly separate demo root. Tests do not install operational native workers or supply human acceptance. See [HOST-INSTALLATION-REVIEW](HOST-INSTALLATION-REVIEW.md) for the exact installed/demonstrated/unavailable distinction and source pin.
