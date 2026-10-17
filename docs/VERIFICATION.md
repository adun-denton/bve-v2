# Verification checkpoint

This repaired candidate demonstrates deterministic function contracts and a browser workflow with authored images. See [repair dispositions and exact changed contracts](REPAIR-REVIEW.md). It does not establish live image-model support or human design acceptance.

## Reproduce

```sh
npm ci --ignore-scripts
npx playwright install chromium
npm run verify
npm run evidence:repairs
node scripts/source-evidence.mjs /path/to/captured-verify.log
```

`npm test` exercises kernel/HTTP/backup contracts in temporary private roots. `npm run test:browser` starts its own loopback owner and Chromium, seeds six distinct authored candidates, records source-bound review through UI controls, commissions a source-linked second six-candidate iteration through the Conductor interface, dispatches simulated completions through Generator, and lets Butler register originals. It submits second feedback without requesting generation and reopens the owner/browser. No test calls an image model or a paid provider.

## Contract coverage

- Six unique first direction identifiers/prompts/differences and independent job/attempt identities; transactional commission and idempotent receipts.
- Function credentials, executor-scoped delivery and input-original access; spoofed role labels cannot start, commission, register, accept or reconcile through another function.
- Partial, failed and out-of-order completion; correct original hash, native dimensions and canonical project/iteration/job/source associations.
- Identical replay, conflicting evidence/bytes retained without replacement, committed result with lost response.
- Unsent assignment recovery, running uncertainty, late delivery under original attempt, inbox processing on restart; no new invocation on restart/replayed start/event consumption/lost acknowledgement.
- Durable drafts with version conflict rejection, immutable submissions and precise normalized original-region geometry; review source set frozen before late arrivals.
- Automatic Butler reconciliation/continuation without AI, screenshot or Conductor notes; historical corrupt/missing bytes/metadata limit historical coverage, while only actual required job inputs block their dependent work.
- Durable partial/full events; failed sends leave unread; acknowledgement and consumption remain separate. Simulated delivery is labeled.
- Bounded default one candidate/primary attempt, inherited count/Fresh–Follow/independent Brand, finite standing iteration policy, feedback-only versus Submit and iterate; no automatic acceptance or paid-provider fallback.
- New roots refuse unknown existing data; consistent online backup and recovery into a new root include originals/feedback.
- Loopback Host/Origin checks and no public/static credential or source-file path exposure through supported routes.

## Browser evidence

The machine-readable [browser report](../evidence/browser-report.json) contains the executed check names, both iteration records, six distinct initial specifications, original hashes, source relationships, immutable submissions, independent intake receipts, durable events and capability limits. It contains only authored fixtures; no private runtime or credentials.

- [Six-image board](../evidence/01-six-candidate-board.png)
- [Focused original, zoom, region and human words](../evidence/02-focus-region.png)
- [Parent-linked subsequent iteration](../evidence/03-parent-linked-iteration.png)
- [Mobile board](../evidence/04-mobile-board.png)

See [workflow and action count](WORKFLOW.md) for architectural/usability findings. Results and exact counts are recorded in `evidence/checks.json` at the published checkpoint. GitHub-hosted CI, full Windows/macOS installation, native tool execution, concurrent native workers, live push notifications and human acceptance are not claimed unless separately recorded.

## Environment and failed setup attempts

Cloud verification uses Node 24.19.0 and Playwright 1.62.1. The normal browser-download URL returned a non-archive response in this environment, and OS package provisioning was unavailable. A registry-provisioned Chromium 153.0.8010.0 supplied the test browser using `BVE_BROWSER_EXECUTABLE`; no application runtime dependency changed. Earlier browser harness assertions were corrected for asynchronous hydration and Promise precedence. Only the repaired final full verification pass is the candidate result; earlier failed checks are not represented as passes. Independent reviewed-baseline Windows Node 24.19.0 contract checks passed 20/20; its shipped Chrome harness failed, and a diagnostic explicit-wait copy passed 20/20. This repair is rerun on Linux; repaired Windows/macOS checks are not claimed.

## Repair-specific results

The regression suite includes R01 mixed/independent dependencies, per-job chosen region roles and immutable review coverage; R02 actual worker-visible Fresh/Follow × Brand on/off; R03 bounded context validation/revision/replacement; and A01 reservation/start accounting. See evidence/checks.json for the actual final totals rather than retaining the historical count of 20.

The shipped browser harness now waits for a complete intended-iteration job set and loaded originals. A controlled delayed second-original response preserves a usable partial board before the complete-board assertion. Optional creative notes and unchanged human feedback recover after owner/browser replacement.

The [repair evidence report](../evidence/repair-report.json) contains redacted packets actually received by the fixture worker through dispatch, source/region roles, limited historical coverage, blocked versus independent outcomes and creative-note revisions/recovery. Reports and hashes name the exact source commit. Subsequent evidence/documentation-only commits retain identical runtime/test sources.

During the first pinned repair run, all 37 contract checks passed but the browser history navigation check timed out: polling could change selected state without invalidating the rendered board. That failed source checkpoint is f2e8d25e62c5f066e11ea9173d8b2076bee1344c. The final checkpoint includes the bounded render-signature fix and a deliberately held polling response regression, plus verification that supplied notes appear before child commissioning. Its reported final count supersedes the earlier development pass of 24 browser checks.

Final repaired run: **37 contract tests passed; 26 shipped browser checks passed; zero page errors.** Source commit: 802a3a9c9b7a471dbbeeaf80b469eec67042a967. All 19 committed source/package blobs match the manifest. Native/OS integration and human acceptance remain outside these fixture claims.
