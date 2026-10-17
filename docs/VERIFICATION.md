# Verification

The exact implementation is designated by candidate.json and evidence/checks.json. Current scenario requirements and operating instructions are in EXAMPLES.md and CONTRACTS.md. The implementation return and PROJECT-REVIEW.md distinguish authored tests from actual host integration.

## Reproduce on a clean pinned source

Use Node 24.x and install dev dependencies plus a compatible Playwright Chromium. BVE_BROWSER_EXECUTABLE may select a separately provisioned browser. The recorded Linux checks use test-only @sparticuz/chromium 153.0.0 / Chromium 153.0.8010.0 and Playwright 1.62.1.

```sh
npm ci --ignore-scripts
npx playwright install chromium
npm run verify > /private/verify.log 2>&1
npm run evidence:repairs
npm run evidence:projects
node scripts/host-evidence.mjs /private/verify.log
node scripts/source-evidence.mjs /private/verify.log
```

Tests use disposable roots; no image-model calls or paid providers. The source manifest requires a clean committed source/instruction set and matching source pins in all reports. Generated evidence/docs may follow the tested implementation without changing those bytes. Include updated canonical examples/instructions when reproducing.

## Current coverage

47 contract tests: existing 37 integrity/recovery/HTTP/backup tests plus ten current project/host tests. Examples A–C cover no premature workforce, exact three-worker generation, Butler readiness, attributable immutable-origin statements, independent intake, automatic checkpoints, fixture return to C1, zero-generation comparison, branch/history and C2 replacement. Negative controls cover maximum staffing before host creation, wrong tier/role/project/statement, omitted material, false worker success, duplicate delivery/start, uncertainty and concurrent/lost-response installation. Backup restores exact originals plus new statements/checkpoints and recreates the project folder.

33 shipped browser checks retain the complete two-iteration raster workflow, exact source regions, autosaved drafts, history/poll synchronization, cold reopening and owner restart. Additional checks display selected existing material in R004, reopen its durable route/source notes, and reveal R005 without losing history. 05-iman-comparison.png is authored fixture evidence. User drafts and production checkpoints remain different persistence concerns.

Actual session/model provisioning, native original return, Butler host-driven browser opening, automatic initiating-chat completion, native concurrency, OS recovery and human usefulness/acceptance remain unverified in this run. The host report explicitly records incomplete native installation. Earlier Windows evidence and child-session probes are historical at their exact prior commits, not reruns of this source.
