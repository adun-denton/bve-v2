# Conditional PNG ceiling experiment

Status: SOURCE/HARNESS READY, IMG20 OPEN. This branch does not establish a safe
20MP operating limit. Ordinary roots and the standalone verifier still default
to 16,000,000 pixels. No operating installation or native image call is supplied.

The pure contract ceiling is 20,000,000 pixels, including dimension maxima and
nested artifact references. Contract validity confers no runtime permission.
Only a trusted owner's explicit `imports.experimentalPng20: true` opts a
disposable connected root into the experiment. This option is absent from
request JSON, CLI defaults and the ordinary UI. Explicit per-job allowances
remain frozen; an existing 16MP allowance is never raised automatically.
Authored `fixtureSpecifications` accepts an explicit maxPixels for candidate
tests and retains its 16MP default.

## Format and rollback

Before any larger original can be staged, root marker version 3 records exactly
`["historical-import.v1","png20-experiment.v1"]`. A versioned
`pngExperimentFormat/active` row in the existing records table records
`bve.png20-experiment.v1`, version 1, maxPixels 20000000 and the compatible
backup manifest hash (null only for a fresh root). SQL tables/user_version and
the import/declaration/result/authority shapes do not change.

An existing import-enabled marker-2 root requires a complete separate combined
backup, exact domain head AND logical SQLite fingerprint under existing locks,
and confirmed quiescence. Enable historical imports separately first for an
older populated root; do not combine an unbacked historical-format migration
with the candidate. New disposable roots may explicitly opt into both features.

The metadata commits before atomic marker publication. No import can proceed
with candidate metadata and the old marker: ordinary reopen/backup refuses.
Explicit owner reconfiguration can finish a known interrupted promotion, using
the already recorded backup identity. A leftover promotion file is preserved
for inspection rather than silently overwritten. Unknown versions/features
refuse. Accepted older J05A source must be tested against the ACTUAL marker-3
root and refuse before mutation; a mocked version check is insufficient.

Rollback preserves the candidate roots. Separately restore the retained
pre-candidate marker-2 backup and use its compatible accepted source. Never
edit a marker downward, drop history or launch in the retained backup itself.
No live-root migration is authorized by this document.

## Decoder and reader bounds

Encoded bytes remain <=24MiB, depth 8, channels grayscale/RGB/gray-alpha/RGBA,
non-interlaced. IHDR checks run before inflate. CRC, chunk ordering, filters,
exact inflated length and hash checks remain effective. At width W, height H,
channels C, the exact inflate ceiling is `(W*C+1)*H`. Since C<=4, WH<=20M and
H<=20M, this is <=100,000,000 bytes, including every row's filter byte. There is
no additional arbitrary side limit. Narrow/tall images are tested explicitly.
This bounds one inflate allocation, not whole-process RSS; copies, SQLite,
JSON/base64 and decoder overhead still require measurement.

Import capture/verification, historical-parent verification, Kernel original,
source verification, intake, portable export and combined backup/restore all
use the same persisted runtime ceiling. Original bytes and metadata are never
resized, transcoded or replaced with previews. The portable export interruption
seam runs after base64 allocation but before any result is returned. Preview
identities, attachments and remaining J05 metadata integration remain open.

## Reproduction and evidence

Use existing Node 24.x and an already installed Python/Pillow decoder; install
nothing just to claim readiness. All source tests use independently authored
fixtures. Keep authentic media, input lists, capability material, portable
exports and raw private reports outside the repository.

```
node --test test/img20.test.mjs test/3djat-contracts.test.mjs test/3djat-import.test.mjs test/3djat-import-integration.test.mjs
npm test
python scripts/img20-measure.py --inputs /absolute/private/inputs.json --output /absolute/private/new-results --budgets /absolute/private/before-run-budgets.json --old-source /absolute/accepted-j05a-checkout
```

The private input JSON contains `files`, each with absolute path, sha256, width,
height and optional kind=historical-creative. The budget file contains `budgets`:
serverAbsoluteRssBytes=536870912, serverRssDeltaBytes=402653184,
browserProcessTreeDeltaBytes=1073741824, availablePhysicalRatioMinimum=0.2,
targetImportSeconds=10 and targetExportSeconds=10. Fix budgets/host declaration
before running. Run from an isolated exact committed source, with an explicitly
allocated private temporary area (TMPDIR where applicable). Outputs contain
private packets, hashes and full originals; they are not public fixture evidence.

The harness warms once then measures three repetitions of single-image and
serial six-image server transport, each in a fresh server process. It also runs
the complete supplied set through actual HTTP stage/commit/replay, SQLite byte
identity, HTTP original, import-portable, complete combined backup, separate
restore and restored HTTP download. Generic authored dossiers remain unknown;
this is not real business adoption. Historical parent/approval fields remain
null without separately verified evidence. No generation/acceptance is created.
Actual child termination/reached markers and explicit hash-checked lock recovery
exercise four boundaries with the supplied first original. If a bridged test
filesystem re-presents the paused server's owner file, the harness requires its
exact pre-stop bytes, a closed server and confirmed child exit, preserves those
bytes, and records their hash before removing only that known disposable owner.
This does not change operating-server owner recovery or certify that filesystem.

Internal process RSS/heap/external/arrayBuffers sampling requests 20ms. Synchronous
work blocks that sampler: raw gaps are retained, never claimed <=50ms when they
are longer. Independent Linux /proc sampling requests 20ms, records actual gaps,
OS VmHWM/RSS/swap, available physical memory and PSI. OS high-water also comes
from process.resourceUsage and the parent's exact-child wait4 resource usage.
The external sampler verifies Node process identity before accepting /proc
values; a mismatched mounted PID namespace yields NOT MEASURED, not launcher RSS.
Mounted physical/cgroup views are then retained only as host-view observations. Recovery children have separate external samples;
SIGKILL can prevent the final high-water read. A non-Linux host needs its existing
OS peak-working-set collector; this /proc harness does not certify Windows.

Six-image transport is only the server portion of review. No browser memory or
responsiveness is inferred from HTTP completion. Missing browser process-tree,
target-machine, Windows/filesystem, profile interpretation or stall observations
are NOT MEASURED/NOT RUN and leave IMG20 OPEN. Independently decode every source
and returned original with the existing second decoder, compare dimensions,
sample data/full decoded hashes and exact chunk/profile bytes, and report
decoder/version. Byte/profile equality does not establish calibrated color.
Keep all raw samples, worst absolute/delta/repetition and any budget failures.
No averages-only pass, fallback format, silent resize or post-result budget raise.

An overseer independently accepts or rejects IMG20 after all mandatory evidence.
Source tests cannot close J05, M1, P1122-COLD, native readiness or operating setup.
