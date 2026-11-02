# Imported photo edit instructions

This candidate adds pre-generation instruction capture to the installed 3DJAT baseline `6029957a3874bd733753f083d7c8bee89c166ef7`.

In Products / Photos & Content, choose **Edit instructions** on an imported photo. The larger photo view supports zoom, whole-image words, up to 24 rectangular regions with separate instructions, correction/removal, and previous/next navigation across retained imports. Drafts autosave to the existing SQLite store; browser buffers preserve unsent words. A conflicting saved version requires an explicit recovery choice. **Submit edit instructions** freezes the exact draft version. Submitted status means instructions were recorded; image editing has not started.

The Operations launcher has **Include submitted photo edit instructions**. When enabled, submitted regional instructions are copied into the corresponding exact selected source, and whole-image words are retained with their artifact identity in operation intent. Unsubmitted drafts are not used. An operation request still requires its existing explicit save action and subsequent configured execution. No generation job, iteration, review link, approval or new staff is fabricated.

## Records and API

Authenticated `POST /api/photo-brief` takes `{action,key,input}`:
- `read`: `{artifact}`, returns its current draft and immutable submitted requests.
- `save`: `{artifact,expectedVersion,note,regions}`.
- `submit`: `{artifact,draftVersion}`.

Artifact identity uses the existing `artifact-ref` contract: productId, artifactId, version, sha256, width, height. Regions use the existing normalized-original geometry and meaning contract, without a reviewRegion link. Imported provenance and retained original bytes are checked independently. Product authority is checked on every read, write and replay. Only the human owner writes; a scoped Conductor can read its product's instructions.

Records use the existing `records` table (`photoBriefDraft`, `photoEditRequest`) and transaction/receipt mechanism. Reusing the same key/payload returns its receipt. Different payloads conflict; submitting the same artifact draft version under another key returns the same request. Ambiguous responses retain the exact original packet. Server restart recovers SQLite records independently of the browser.

## Compatibility and verification

The code adds record kinds without a SQLite schema, user_version or root marker change. No runtime migration or replacement root is required. Preserve the current private root, configuration, access file, imports, pending requests and staff. Use the existing backup procedure before applying a source update. Reconcile an existing uncommitted imported-original display correction in public/app.js; this candidate also renders imported originals without requiring a job and directs instruction editing to the product page.

Focused authored-fixture tests cover three imported artifacts with no generation jobs, separate drafts, multiple regions, correction/removal, exact persisted identity, stale writes, idempotency, lost submission responses, cold restart, zoom/viewport geometry and unchanged originals. Browser and native installation readiness require the recorded test results; the presence of test code alone is not evidence of success.

Assignment-bound image execution and original-result return are outside this change. No local installation is updated by publishing this development branch.
