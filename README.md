# BVE V2

**Operational host-installation contract change — development candidate.** [PR #1](https://github.com/adun-denton/bve-v2/pull/1) remains draft/unmerged. The installation lifecycle now provisions and verifies actual role sessions through a narrow host driver; server startup alone is incomplete. The earlier checkpoint did not implement this requirement.

Tested source: [dcee826c8fd8d08d5c1eaeb4848879f337ba94ae](https://github.com/adun-denton/bve-v2/tree/dcee826c8fd8d08d5c1eaeb4848879f337ba94ae). **47 contract checks and 28 unmodified browser checks pass**, with zero page errors. See candidate.json for the exact tested source and [host installation review](docs/HOST-INSTALLATION-REVIEW.md) for results, actual cloud probe identities and missing capabilities. Fixtures do not establish native operational installation. The existing Windows installation and prior operator work were not accessed or modified here. A native driver and user-facing Conductor handoff remain unavailable in this cloud host.

A local, image-first AI–human design workspace. Humans judge designs; replaceable executors perform bounded work; durable software owns authority and continuity.

This is a clean architectural reset with independent history. The [historical BVE](https://github.com/adun-denton/brand-visual-engine) remains a reference. No legacy source, runtime database, compatibility architecture, or private project material is imported.

**Development candidate; no approved stable release.** This checkpoint includes authored fixture/browser evidence and an active cloud role probe. Earlier local session-assisted native intake is operator-reported history and was not inspected here. No paid provider or production deployment is part of this candidate.

Start with [WHY](docs/WHY.md), [architecture and ontology](docs/ARCHITECTURE.md), and [operating contracts](docs/CONTRACTS.md). These govern implementation, rather than historical personas or workflows.

## Run locally

Node.js 24.x is required (tested: 24.19.0). This is a pinned development-candidate workflow: use the exact commit returned for the review checkpoint, not an arbitrary latest branch.

```sh
npm ci --omit=dev --ignore-scripts
npm test
npm start
```

Open http://127.0.0.1:4317/ . Private state defaults to `~/.bve-v2/workspace-v1`, outside the repository; select the exact preserved `BVE_ROOT` for an existing installation. Existing unknown/nonempty roots are refused. No legacy runtime is accessed. Stop with Ctrl+C; restart with the same root. Ordinary review and continuation survive browser/AI replacement. Running image attempts become uncertain on owner recovery and are never automatically retried.

[Installation, backup and recovery](docs/INSTALL.md) · [functional APIs and native integration handoff](docs/ADAPTERS.md) · [human journey and action count](docs/WORKFLOW.md) · [verification evidence](docs/VERIFICATION.md)

`npm run demo` uses an independent `BVE_ROOT` chosen by the operator and seeds clearly labeled authored PNG fixtures through simulated adapters. These authored fixtures do not verify native workers, concurrency, push notifications, human usefulness or design acceptance. For browser verification, install dev dependencies and Chromium as described in the installation guide.
