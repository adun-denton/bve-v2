# BVE V2

A local, image-first AI–human design workspace. Humans judge designs; replaceable executors perform bounded work; durable software owns authority and continuity.

This is a clean architectural reset with independent history. The [historical BVE](https://github.com/adun-denton/brand-visual-engine) remains a reference. No legacy source, runtime database, compatibility architecture, or private project material is imported.

**Development candidate; no approved stable release or demonstrated native image integration.** The implementation checkpoint will include offline and browser evidence using authored fixtures. No paid provider or production deployment is part of this candidate.

Start with [WHY](docs/WHY.md), [architecture and ontology](docs/ARCHITECTURE.md), and [operating contracts](docs/CONTRACTS.md). These govern implementation, rather than historical personas or workflows.

## Run locally

Node.js 24.x is required (tested: 24.19.0). This is a pinned development-candidate workflow: use the exact commit returned for the review checkpoint, not an arbitrary latest branch.

```sh
npm ci --omit=dev --ignore-scripts
npm test
npm start
```

Open http://127.0.0.1:4317/ . Private state defaults to `~/.bve-v2/workspace-v1`, outside the repository; use `BVE_ROOT` to choose a new private root. Existing unknown/nonempty roots are refused. No legacy runtime is accessed. Stop with Ctrl+C; restart with the same root. Ordinary review and continuation survive browser/AI replacement. Running image attempts become uncertain on owner recovery and are never automatically retried.

[Installation, backup and recovery](docs/INSTALL.md) · [functional APIs and native integration handoff](docs/ADAPTERS.md) · [human journey and action count](docs/WORKFLOW.md) · [verification evidence](docs/VERIFICATION.md)

`npm run demo` uses an independent `BVE_ROOT` chosen by the operator and seeds clearly labeled authored PNG fixtures through simulated adapters. Native workers, concurrency, push notifications, human usefulness and design acceptance remain unverified. For browser verification, install dev dependencies and Chromium as described in the installation guide.
