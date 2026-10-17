# Install BVE

## Candidate identity and prerequisites

This is a development candidate, not an approved stable release. Use the exact commit from the implementation return/PR, or the exact `implementationCommit` in the published candidate manifest when present. Never substitute the latest arbitrary branch as a stable release. The public repository and these instructions are sufficient; private MSB access is not required.

Supported runtime contract: Node.js 24.x with its bundled npm and `node:sqlite`. Tested here on Node 24.19.0, Linux x64. Windows and macOS operation is not yet exercised. Install Node 24 from its official vendor or a recognized version manager if absent. Git is needed to retrieve a pinned checkout. The application has **zero runtime npm dependencies**; browser testing alone uses pinned Playwright 1.62.1.

An authorized local session receiving **Install BVE.** should perform routine discovery, dependency provisioning, new private-root setup and startup without repeated confirmations. Preserve every preexisting BVE pilot/root. Do not migrate old databases, adopt legacy instructions, expose the service publicly or install a paid provider.

## Install and start

Use a new source directory. Replace `EXACT_CANDIDATE_SHA` with the remotely verified commit supplied in the implementation return (or the manifest's implementation commit).

```sh
git clone https://github.com/adun-denton/bve-v2.git bve-v2
cd bve-v2
git checkout --detach EXACT_CANDIDATE_SHA
node --version
npm ci --omit=dev --ignore-scripts
npm test
npm start
```

Open **http://127.0.0.1:4317/** in a modern browser. Default private root: `~/.bve-v2/workspace-v1` (Windows: the equivalent under the current user's home directory). The source checkout and private root are separate. An unrecognized nonempty root is rejected. Existing V2 roots reopen with their records intact. Protect the root using the local account's filesystem permissions; Windows ACL behavior has not been verified here.

For an explicit root on PowerShell:

```powershell
$env:BVE_ROOT = Join-Path $env:USERPROFILE 'BVE-V2-private\workspace-v1'
npm start
```

On POSIX shells:

```sh
export BVE_ROOT="$HOME/BVE-V2-private/workspace-v1"
npm start
```

The server binds loopback only, checks Host/Origin and supplies a same-origin human credential to the UI. Function credentials stay in the private root. Do not publish them, forward the port, use a public tunnel, or put the root in the repository.

Normal initialization is empty, with no fabricated integration. Create a project, enter its brief, and request exploration. Without a Conductor/native worker adapter, the request is durably saved and its exact capability gap is shown; it does not fabricate AI work. Existing boards, reviews and source continuation remain usable.

## Authored demonstration, kept separate

Use an independent demo root to avoid mixing fixtures with real work:

```sh
BVE_ROOT="$HOME/BVE-V2-demo/workspace-v1" npm run demo
```

PowerShell: set `$env:BVE_ROOT` to a new demo directory, then `npm run demo`. This seeds six explicitly authored raster compositions via simulated Conductor and executor functions, with real kernel/Butler intake. It makes no model calls. The fixture seed is idempotent. For the two-iteration automated demonstration, install development dependencies and Chromium:

```sh
npm ci --ignore-scripts
npx playwright install chromium
npm run verify
```

On Linux, Playwright may require system browser libraries (`npx playwright install --with-deps chromium` in an authorized development environment). Tests use temporary private roots; none touch an existing pilot. In an environment with a separately provisioned compatible Chromium, set `BVE_BROWSER_EXECUTABLE` to its executable. The cloud evidence used Chromium 153.0.8010.0 from the registry-provisioned `@sparticuz/chromium` package because the standard CDN archive was unavailable. That fallback is a test dependency only and is not required for local BVE operation.

## Stop, resume and browser replacement

Stop the owner terminal with **Ctrl+C**. Resume with the same `BVE_ROOT` and `npm start`; use the same browser URL. If port 4317 is occupied by another application, use an explicit `PORT` and its printed loopback URL. A second owner of the same root is rejected. There is no daemon/service installation in this candidate.

Closing the browser does not stop the owner or Butler. Drafts already saved to SQLite survive any browser replacement. Pending unsent edits are retained in the originating browser's storage, with explicit version-conflict recovery; unsent edits cannot survive destruction of that browser's storage. Open the durable link `http://127.0.0.1:4317/#project=PROJECT_ID&page=board&iteration=ITERATION_ID` to reveal the selected results directly. The address bar carries that link automatically. The base URL reopens the latest project when no saved route exists.

If the owner process disappears, SQLite retains committed state. Startup marks previously running external attempts **uncertain**, processes persisted delivery inbox entries, reconstructs continuations and preserves unread events. Unsent assignments remain recoverable. Nothing retries an uncertain image call merely because the owner restarts or a lease expires. Reconcile its original attempt with its executor; a late original can be delivered under the same assignment. Do not delete records to make a new attempt appear unused.

## Backup and recovery

With the same root selected, choose a **new private destination**:

```sh
npm run backup -- /new/private/bve-backup-2026-10-17
```

The online SQLite backup includes originals and records in a consistent snapshot, plus the root marker and function credentials. It excludes the live owner lock. Existing destinations are refused, never overwritten. Keep backups private; they contain originals and credentials. Online backup and restoration into a new root are tested.

To restore, stop BVE, preserve the damaged root, and point `BVE_ROOT` at the backup directory (or a separate complete copy), then start. Do not overlay files into a running root. Review unread events/uncertain attempts in Inspector. A corrupt required original blocks its dependent continuation with an exact identity; saved feedback and unaffected evidence remain available. Restore the exact missing bytes from backup rather than substituting a different image. Screenshots do not repair missing originals.

Rollback is to stop this candidate and keep its independent private root for recovery. Existing legacy code/runtime are unaffected; only a documentation pointer is added to the historical repository. Do not try to open a V2 database with legacy software.
