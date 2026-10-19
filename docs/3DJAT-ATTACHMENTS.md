# Opaque product attachments

Attachment registration preserves design, print, finishing or other opaque bytes in the business file tree. It invokes no decoder, converter, tool or file content, and creates no image artifact, job, worker, round, attempt or acceptance.

## Explicit local scope

The file-only `DomainProducts` writer accepts an optional trusted `attachmentSources` map. `Kernel` and `serve` pass it through their existing `products` option. Existing accessFile-only configuration remains valid; registration without a matching source refuses.

```js
const products = {
  accessFile: absolutePrivateAccessFile,
  attachmentSources: {
    'approved-inputs': {root: absoluteNarrowSourceDirectory, products: [productId]}
  }
};
const writer = new DomainProducts(domainRoot, products);
// Or new Kernel(runtimeRoot, {products, ...existingConnectionOptions}).
// Or serve({root: runtimeRoot, products, ...existingConnectionOptions}).
```

The map is private owner configuration, never HTTP packet authority. At most 16 source IDs are configured, each with an explicit nonempty list of at most 256 product UUIDs. Only a human or correctly product-bound Conductor capability can register. Source-proposer, Butler and workers cannot. Current principal/product/source authorization also gates committed replay. Removing permissions does not change history.

Sources are explicit local directories. Narrow business input folders are supported; the domain master root/ancestors, Domain/Heads/Receipts/Staging/Recovery, configured Operations subtree, private access file/intents and BVE runtime are not attachment source scopes. Select narrow data roots, never credentials. Paths, case, symlinks/junctions, hardlinks, root/file identity and source stability are checked. This preserves the existing trusted filesystem-owner boundary; it is not an OS sandbox or general transfer service.

## Frozen command, source and destination

Use frozen `attachment.register` and `3djat.attachment.v1` through `writer.command(token,packet)`, `Kernel.productCommand(token,packet)` or existing `POST /api/product`. Strict 128KiB UTF-8 JSON and Host/Origin/auth checks remain. No binary upload, generic path reader, attachment download or execution endpoint is added.

`source.kind` must be `file`. `source.sourceId` selects the trusted map; `source.location` is relative to that root. Drive sources return a capability refusal. Filename, declared MIME, source revision/locator/hash/time and bytes are preserved; MIME/type is not independently decoded or certified.

The attachment's separate `location` must equal:

```text
<workspace.paths.products>/<product UUID>/Sources/<SHA-256>.bin
```

The configured path is used, including nondefault/nested product roots. Source and captured destination cannot be the same file. Actual source length/hash must match the declaration. New registration supports a verified `availability: available` declaration; missing/unverified source claims cannot manufacture available bytes. Shape-valid unsupported modes receive operational refusals without new frozen fields/enums.

Initial attachment entity CAS is zero and output revision is one, without adding a revision field to the payload. Exact domain-head CAS serializes the current dossier update. One head publication links attachment metadata, dossier next revision, attributable audit evidence and store receipt. Result owner is domain, outputType is attachment, and reference identifies that attachment, including when product/audit IDs coincide. Existing facts/proposals remain unchanged.

Same authenticated key/payload recovers the original receipt before stale CAS; changed payload conflicts. A different principal/key cannot claim it. After committed capture, source disappearance does not prevent authorized identical replay or current captured-file access. Current source-map permission is still checked, while original source bytes are not reread for committed replay.

## Streamed publication and retained failures

One file is at most 256MiB. Capture, hashing and availability use a fixed 1MiB buffer, not the metadata store's 1MiB whole-record reader. Existing dossier 256-reference and combined-backup 512-record/1GiB attachment aggregate bounds remain. Registration checks the complete retained attachment closure, including historical records, before capture.

Bytes stage under the configured product's `Sources/Attachment-Staging`, then flush/hash and install before metadata publication. Local atomic hard-link/no-overwrite installation followed by unlinking only the newly created staging name prevents overwriting an existing destination. Equal canonical bytes can reconcile an orphan after source verification; conflicts refuse. Unsupported filesystem primitives are capability gaps, not permission to overwrite.

An interrupted two-link state is reconciled under the domain lock only when the canonical file and exactly one digest-named staging file have the same device/inode, two links, exact length/hash and safe guarded ancestors. Only that verified staging link is removed. Unknown links, mismatches and aliases fail closed. Other partials, directories and diagnostic roots remain.

Across known workspace products, quarantined partial staging is bounded to 64 files and 1GiB including the next proposed capture. At a bound, new capture refuses without deleting earlier failures. Later owner inspection/preservation is deliberate; no cleanup worker or automatic lock expiry is installed. Prepublication retries still verify an authorized source. Committed replay does not.

An owned-process interruption can retain a lock. Only after independently confirming exit/quiescence may existing exact-lock-hash recovery preserve/release that known lock, followed by original-key replay. Never steal live/unknown locks. Prepublication failure retains the prior head; possible publication/acknowledgement failure stays pending/uncertain with its original evidence. A later SQLite/cache acknowledgement cannot roll back committed files. Power-loss durability and Windows directory flush remain qualified.

## Current view and backup

Internal `productReview` adds `attachments`, each `{reference,record,current}`. Derived current status is available/missing/corrupt/unavailable with a bounded cause. These are not new frozen attachment enums. Missing/corrupt/unsafe bytes do not erase dossier/fact/note/history reads or mutate original `availability`, provenance or approval.

A review checks at most the dossier's 256 refs and streams at most 1GiB of declared bytes in that request; each file is bounded by its declaration/256MiB. Further entries are unavailable with OUT_OF_BOUNDS. Absence is missing; hash/length/change failure is corrupt; unsafe/unreadable storage is unavailable. Existing metadata work remains separately bounded. Checks are synchronous local work; fixture success is not target responsiveness/memory evidence.

Existing combined backup verifies/copies committed attachment closure and domain/operational records; separate restore preserves paths, references and exact bytes. Missing/corrupt bytes prevent a complete backup. No backup format/limit change is needed. Domain-only metadata snapshots do not contain external attachment bytes. Partial staging, source maps and private access keys/intents are not falsely claimed as part of committed backup closure; retain them separately under owner preservation rules.

## Remaining boundaries

This interface supplies opaque registration/current availability. Previews, structured PNG metadata, dossier entry-authoring extensions, product UI and later template/executor/calibration work are separate. Ordinary 16MP/24MiB and experimental-only 20MP remain unchanged. Authored tests establish no actual Windows/target/browser/memory, authentic recovery/IMG20, native/setup or human/user acceptance. No installation, merge or release follows.
