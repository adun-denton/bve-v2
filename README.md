# BVE V2

**Designated development candidate:** [156c5e4](https://github.com/adun-denton/bve-v2/tree/156c5e4e4c027ff515adaf556254460eea39c71f) — 20 contract tests and 20 browser checks passed with authored fixtures. [Review checkpoint](https://github.com/adun-denton/bve-v2/tree/0664e2e797b77e5cc0f6358a8d20f9bae9da3c43) · [Pinned installation handoff](https://github.com/adun-denton/bve-v2/blob/0664e2e797b77e5cc0f6358a8d20f9bae9da3c43/docs/INSTALL.md) · [Evidence](https://github.com/adun-denton/bve-v2/blob/0664e2e797b77e5cc0f6358a8d20f9bae9da3c43/docs/VERIFICATION.md). Native integration and human acceptance remain unverified.

```sh
git clone https://github.com/adun-denton/bve-v2.git
cd bve-v2
git checkout --detach 156c5e4e4c027ff515adaf556254460eea39c71f
npm ci --omit=dev --ignore-scripts
npm test
npm start
```

A local, image-first AI–human design workspace. Humans judge designs; replaceable executors perform bounded work; durable software owns authority and continuity.

This is a clean architectural reset with independent history. The [historical BVE](https://github.com/adun-denton/brand-visual-engine) remains a reference. No legacy source, runtime database, compatibility architecture, or private project material is imported.

**Development candidate; no approved stable release or demonstrated native image integration.** The implementation checkpoint includes offline and browser evidence using authored fixtures. No paid provider or production deployment is part of this candidate.

Start with [WHY](docs/WHY.md), [architecture and ontology](docs/ARCHITECTURE.md), and [operating contracts](docs/CONTRACTS.md). These govern implementation, rather than historical personas or workflows.
