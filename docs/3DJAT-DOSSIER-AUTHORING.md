# Governed dossier extension backend

This backend adds file-owned business description, modeling software, production cost and typed design/production/finishing content. It does not implement the product UI, generate catalogue text, execute design files, establish genuine human approval or qualify an operating installation.

`product.v1`, its three facts and `proposal.v1`'s five change fields remain unchanged. The extension is reached through the same verified domain-head/receipt closure. SQLite retains operational action copies and disposable projections only. No read or standalone write requires BVE or SQLite. Current extension fields are derived by the shared reader; there is no second current-facts file/database.

## Shapes

The closed executable contracts are in `src/contracts/3djat.mjs`:

- `dossier-proposal.v1`: proposalId, productId, expectedRevision, origin (`source-extract` or `human-authored`), payload, replaces (record reference or null), reason, corrects (proposal reference or null).
- A field payload has kind=`field`, field=`description`/`modelingSoftware`/`productionCost`, fact={state,value,sourceRefs}. Accepted values are text (20000/500 characters) or the existing typed price (amount string, currency/unit, per, effectiveDate); unknown/not-applicable carry null. Unknown is never zero. Source-extract requires at least one source; human-authored can have none.
- An entry payload has kind=`entry`, entryId, entryKind, entryType, date, title, text, attachmentRefs, sourceRefs. Allowed pairs are design/design-file, design/design-revision, production/print-test, production/production-note, finishing/finishing-process. Date is claimed business date, not publication time. Title<=200, text<=20000, sources<=16, attachments<=15. A design-file entry requires an attachment; no MIME/filename assertion proves a native design format.
- `dossier-decision.v1`: decisionId, productId, proposal, expectedRevision, outcome (`accepted`/`rejected`/`superseded`), reason, decidedAt, humanActionReceipt, supersedesDecision, correctedProposal. Nullable links are explicit null.
- `dossier-record.v1`: id=decisionId, productId, revision=1, proposal, decision, origin, payload, previous. The writer materializes it only on accepted human action. Body text/field value lives in this actual immutable JSON file. A typed product entry references this file and exact registered attachments; an embedded free note is never assigned a fictitious revision reference.

Only these two commands are added to the existing command/result/failure enums:

| Command | Authenticated caller | Output |
|---|---|---|
| product.dossier.proposal.submit | human, scoped Conductor, source-proposer | dossier-proposal reference, revision1 |
| product.dossier.proposal.decide | human only | current product reference/revision |

Each command uses the existing command.v1 key/expected head/entity revision envelope. Both input.expectedRevision and envelope entityRevision name the current existing product revision. Publication advances the domain head. Acceptance atomically publishes decision, record, advanced product/sourceReceipt, signed action and receipt. Reject/supersede publish no record and do not advance product revision. A scalar acceptance advances product CAS even though its value is an auxiliary file record.

## Authentication and action evidence

Standalone bearer provisioning uses the existing private registry helper. Through BVE, the real authenticated caller/session establishes identity/role/product scope. For the new source-bearing submissions only, an optional exact id+role registry entry supplies sourceIds; its product scope is intersected with current verified scope. No entry means no source IDs. The trusted owner may explicitly provision `bve-human` or `bve-session-<binding-id>` quiescently using `provisionProductPrincipal`; this never replaces actual bearer authentication. No automatic source discovery or role fallback is added. Source-free human-authored fields/entries use the actual authenticated human/product authority independently of optional extraction policy. A sourced human-authored payload still requires extraction scope, and standalone registry bearers always retain their native registry product restriction. These rules also apply to committed replay. Existing command scopes are unchanged.

Every source-bearing submission, including human and Conductor, requires configured source IDs. Only human may submit human-authored content or a correction. Only human may decide. Conductor can propose an extraction, not certify it or impersonate its reviewer. Current policy/authority is rechecked on committed replay and under lock/before publication. Source-byte loss alone does not invalidate a committed replay. JSON role/source labels confer nothing.

`decisionActionReference` supports old and new decide operations as a bytes-only helper. It excludes ONLY input.humanActionReceipt from that decision fingerprint; every other field/key/expected value remains bound. The writer requires the exact event reference, authentic caller and MAC. Old helper hashes are preserved. Private key/access/intents stay outside domain exports/combined backups.

## Review, correction and history

A new proposal's replaces must exactly name the active accepted record for its field/logical entry, or null initially. Corrections preserve original product, origin, subject, sources/attachments (subsets only) and replaces. The one exception is correcting an already accepted original: replaces must name that original's still-current materialized record. New sources/files or another subject require an independent proposal. Old proposals and decisions are never edited.

Edit uses explicit commands: human submits corrected proposal linked to original; human supersedes original naming correction and exact prior decision if present; human accepts correction. An older original may be rejected or explicitly superseded, but a future original or stale acceptance refuses. The corrected proposal must be current and exactly linked; acceptance needs its active original→correction supersession. Previously accepted content stays current during supersession until corrected acceptance commits. The existing five-field C1 chain is unchanged.

Acceptance resolves current local source hashes and registered same-product attachment refs/bytes and rechecks under lock/before publication. Unavailable/changed/remote unresolved sources block a new acceptance; they do not erase pending/rejected/history or force a second mutation on replay. Recording/adopting an attributed assertion is not proof of a real print test, generated artifact, historical approval or visual acceptance. Free notes remain separate and do not silently become governed facts.

## Shared reader and errors

`readProductDossier(root,{productId,atHead=null,accessFile=null})` and authenticated `readReview(token,{productId,atHead})` share the same join. Both retain the existing product/reference and add dossierExtension with schemaVersion, evidenceVerification, fields, records (including active flag), proposals/status/source availability and decisions. Fields default to unknown/null without a write; a deliberately accepted unknown retains record/decision links. Records remain current by committed replacement chain/publication order, not filenames or claimed dates. The join verifies exact accepted proposal/decision/materialization, product transitions/envelopes and duplicates; it rejects fabricated/detached content.

Without accessFile the independent read labels hash-only: portable content/history, no identity certification or write authority. Explicit accessFile requires MAC verification and fails if invalid/missing/mismatched; never silently downgrade. Authenticated review always verifies MACs. Query errors retain static StoreError/Fault behavior, with no invented operation/key/receipt or private exception paths. The HTTP review response is limited to1MiB UTF-8 with VALIDATION_LIMIT and no truncation; file reading remains within32MiB closure limits. Requests remain128KiB raw UTF-8.

## Publication, compatibility and recovery

The existing exclusive lock, immutable files, fsync and atomic head replacement remain the method. Same committed principal/operation/key/exact packet replays the original result before stale CAS; changed packet conflicts. Before publication failure leaves prior truth current and retains staging/orphans. Possible publication/ack failure returns EXPORT_PENDING, with a real committed receipt when resolvable; reconcile the original key. No automatic lock/orphan recovery, new journal or retry of operational work is introduced. New dossier events are copied to SQLite only after file publication; a failed event/projection acknowledgement does not undo file truth.

New allowlisted kinds and identity mapping are additive. Only dossier-decision.humanActionReceipt gains the required external operational event reference handling. Existing domain-store/snapshot/combined markers and SQL version remain unchanged. Old readers read old heads and refuse new kinds; they must not drop data to appear compatible. Preserve a verified pre-extension snapshot before first write. Rollback means restoring a separate verified old snapshot with old source, never overlaying or rewinding newer business data.

Domain export/restore includes JSON closure; attachment bytes remain explicitly external. Combined backup already copies every reachable attachment and matching operational event, including new kinds after normal evidence synchronization. Missing event/attachment refuses complete backup. Separate restore preserves actual text/hashes and never exports the private access context; provision/preserve that context explicitly for future authenticated writes. No backup format rewrite is required.

Existing limits remain:1MiB file/32MiB closure/4096files/128heads/64writes/512external refs, depth48/nodes30000. Per-product extension bounds:128proposals/256decisions/256accepted records; each original typed array256. Exceeding limits refuses before publication; no eviction/truncation. Attachment256MiB, aggregate review/registered bytes1GiB, combined total2GiB remain unchanged. Ordinary16MP/24MiB, experimental-only20MP and all platform/recovery/memory/browser/intended-machine/native/setup/IMG20 gates remain separate and open. User testing awaits whole implementation and integrated independent review.
