# BVE V2

A durable project workspace directed by a Conductor, organized by Butler and served by bounded workers. Generation is one operation; comparison, organization and branching also create project rounds/checkpoints without new images.

Current instructions: [WHY](docs/WHY.md), [architecture](docs/ARCHITECTURE.md), [contracts](docs/CONTRACTS.md) and [role instructions](docs/roles/CONDUCTOR.md). The one canonical worked-example location is [Iman Website: Examples A–C](docs/EXAMPLES.md). Development/debugging history belongs in Git and review evidence, not accumulated role instructions.

One SOL Conductor, one on-demand LUNA Butler, 0–6 LUNA Gen workers; maximum eight active AI sessions. Exploration creates no production staff. Explicit production binds the existing chat to its named project. Every Conductor–Butler operation has attributable statements and an automatic checkpoint. The project survives all sessions.

[Installation/recovery](docs/INSTALL.md) · [host driver](docs/HOST-DRIVER.md) · [human workflow](docs/WORKFLOW.md) · [current implementation review](docs/PROJECT-REVIEW.md) · [exact-source evidence](evidence/checks.json). See candidate.json for the tested implementation commit. [PR #1](https://github.com/adun-denton/bve-v2/pull/1) remains draft/unmerged; main is not an application installation target or a stable release.

Node 24.x is required (tested 24.19.0). Runtime dependencies are zero. Use a pinned checkout and exact private BVE_ROOT. Preserve existing roots/work and back up before runtime changes. Never replace an existing installation with an empty workspace.

```sh
npm ci --omit=dev --ignore-scripts
npm test
npm start
```

The server binds http://127.0.0.1:4317/ and keeps original bytes, records and credentials in the private root. UI drafts autosave. Offline verification uses authored fixtures and no image-model calls. Actual SOL/LUNA provisioning, native original return, automatic initiating-chat completion and browser opening require separate host verification. This cloud work does not modify the operator's Windows installation or claim a ready native staff handoff.
