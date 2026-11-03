# Original PNGs and working copies

BVE validates and retains the exact PNG supplied. Historical imports declare
the measured IHDR bit depth (8 or 16), width, height and SHA-256. Commit
verifies all of them against the retained bytes. Ordinary roots accept
non-interlaced grayscale, grayscale-alpha, RGB and RGBA PNGs up to 20 million
pixels and 160 MiB each, subject to the existing 256 MiB retained-import quota.
These limits are independent of frozen generation allowances. There is no
automatic format promotion, root marker change or schema migration.

Photo cards use a bounded 384-pixel thumbnail. The photo editor requests the
stored raster at full size, including at zoom, so the browser can use the
original detail and color declarations. Annotation coordinates use the stored
raster orientation. Display precision depends on the browser and screen.

For authenticated human and project-scoped Conductor reads, the
`/api/original` exact-reference query takes `view=full` or `view=working8`
with the same product, ID, version, hash and dimensions as `view=media`.
Both raster views return PNG bytes with `X-BVE-Image-Role`,
`X-BVE-Source-SHA256` and `X-BVE-Image-SHA256`. The original routes and
portable exports still return the retained bytes. The browser asks for the
working copy only if it cannot decode the original at the expected dimensions.
For 8-bit input, the compatibility read passes through the original.

For 16-bit input, the compatibility read rounds each sample to its nearest
8-bit value, with a maximum error of 128 in original sample units. Dimensions,
RGB/gray color family, straight alpha and hidden color samples are preserved
within that precision. Transparency-key comparisons happen at 16-bit
precision before an alpha channel is produced. Compatible ICC payloads and
color declarations are copied without a color transform; profile framing is
checked and the profile itself is interpreted by the consumer. Arbitrary
private metadata stays in the original. HDR declarations and animated
conversion are unsupported. The derivative is transient and never registered
as an original, version or accepted output.

The conventional Pillow recipe executor retains its existing limits and
requires separately prepared 8-bit inputs. It does not automatically use a
working copy, because its frozen source hash and receipts describe the
selected original. Import, display and compatibility conversion invoke no
image model.

To update an existing installation, pin the reviewed candidate commit in the
existing checkout, reconcile any local CSS changes, and restart the same
launcher with the same root, configuration and browser profile. Keep existing
imports and briefs. Reimport a full-size source as a distinct asset if needed;
a source update cannot restore pixels or precision already absent from an
old import. Once a new 16-bit or larger original is retained, an older build
may not be able to verify or reopen it. Do not use an older build as a
transparent rollback after such an import.
