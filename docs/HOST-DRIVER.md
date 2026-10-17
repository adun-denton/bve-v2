# Host connection and project staff

The installer configures a trusted private module exporting id, kind (native/fixture/unavailable) and discover(). Capability records distinguish tested/documented/unavailable and evidence for sessions, delegation, resume, userHandoff, image/originalBytes and browser presentation. Runtime readiness is not project-cycle/native verification. There is no bundled native provider and no image call on capability discovery.

The existing first SOL chat becomes the project's Conductor. Local trusted host attachment uses Kernel.bindSession(owner,{role:'conductor',tier:'SOL',sessionId,projectId:null,nonce,hostReceipt}); it creates no project or workforce. Replacement attaches to the existing projectId with replace:true, revoking the previous active Conductor. A host receipt must refer to an actual session; labels/tier declarations are not attestation.

The Conductor-side helpers in src/host-runtime.mjs use these host methods:

| Method | Actual behavior required |
|---|---|
| ensureSession({role,tier,key,previous,instructions}) | Create/resume the exact LUNA Butler or Gen session idempotently at the durable BVE key; return id, actual URL if available and stable creation receipt. Reuse previous staff rather than duplicating it. |
| configureSession({binding,access,instructions}) | Deliver only that session's private scoped envelope/instructions; have it read its actual project/job scope with host.resume. Do not infer its image/transport tools from the installer. |
| sendStatement({sessionId,statementId,projectId,roundId}) | Route the exact assignment to the bound session and record actual receipt; no authority from statement text alone. |
| notifyConductor({sessionId,eventId,roundId,checkpointId}) | Return completion to the originating/current Conductor via a demonstrated mechanism. Return sent, mechanism and evidence; a send is not consumption or generation permission. |
| Host presentation | Actually open/display the supplied durable local BVE round URL when supported. Record unsupported browser opening accurately. |

Staff creation is on demand after production activation. BVE reserves a worker slot before calling ensureSession and binds it to one job. Lost responses retain the stable key. Maximum active roster is eight; completed worker turn retirement must not invent new attempts. The driver owns any necessary actual host turn closure and preservation of external original returns. No advanced recovery/replacement scheduler is required.

Run only the assigned operation through statements. runWorker starts that exact attempt once, invokes its tested compatible adapter, delivers original bytes with assignment token and appends its report. Butler reports readiness/presentation/outcome; deterministic services independently validate/register and commit checkpoints. Conductor's helper does not privately produce/transfer/register the worker output. Follow [Examples A–C](EXAMPLES.md).

scripts/session.mjs PRIVATE_ACCESS_FILE resume returns bounded records. call reads a private {op,key,input} packet on stdin. HTTP is normal; transport:kernel with an existing private root is available only when shared-file access is actually supported. It calls the same scoped Kernel interfaces with recover:false and never takes owner status. Protect envelopes and assignment tokens; do not paste them into public reports. Filesystem owners are trusted, not OS-sandboxed by these application boundaries.

No paid provider fallback, setup generation, assumptions of concurrency or silent one-session imitation. Actual SOL/LUNA session creation, native original return, browser opening and automatic completion in the initiating interaction must each be tested on a supporting host. When push cannot wake the Conductor, retain unread durable events and name the user's required reopen/resume action. Fixture callbacks establish only the authored protocol.
