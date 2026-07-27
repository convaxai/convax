# Plugin Canvas Capabilities

Status: implemented core, Web adapter, and reverse-MCP adapter for verified v5-v7
Tool sidecars already running through a generation or service contribution. A
standalone Canvas-only Tool activation lifecycle and a direct built-in adapter are
not implemented.

## Ownership

Canvas document semantics, layout, command validation, transactions, revisions and
persistence ports belong to `@convax/canvas`. Desktop main owns installed Plugin
identity, manifest grants, Project scope, transport connections and renderer
coordination. A Web renderer only maps one validated presentation contribution into
the existing Canvas file-renderer registry.

```text
Web iframe / running verified Tool sidecar / future built-in adapter
  -> transport adapter
  -> principal-bound Desktop main broker
  -> Canvas application commands and queries
  -> Project Canvas repository
```

No adapter may implement a second Canvas model, read private `.convax` JSON, or infer
authority from a concrete Plugin id.

## Manifest and protocol

Project-wide Canvas access begins with `convax.plugin/5`. The capability protocol is
versioned independently from the manifest:

```json
{
  "schema": "convax.plugin/5",
  "capabilities": [
    "projects.read",
    "canvas.catalog.read",
    "canvas.document.read",
    "canvas.document.write",
    "canvas.events.subscribe"
  ]
}
```

V5 and v6 use `convax.plugin-capability/1`. V7 negotiates
`convax.plugin-capability/2` for two new, narrow node-scoped capabilities while
leaving the published v1 method set unchanged. Creating a later manifest schema
does not imply creating a permanent `plugin-host/N` chain.

The grants are independent:

- `projects.read` permits pathless discovery of bound Projects and allows the host
  to issue an all-bound-Projects connection.
- `canvas.catalog.read` lists Canvases in an authorized Project.
- `canvas.document.read` reads a document projection and queries nodes.
- `canvas.document.write` executes an atomic document transaction.
- `canvas.events.subscribe` receives revision-only invalidations.

## Declarative own-node materialization

`convax.plugin/7` may contribute a video selection action whose fixed action is
`materialize-own-plugin-node` with `selection-to-created`. The renderer sends only
the installed Plugin id/version, action id, source id and Canvas revision. Main
re-resolves the exact installed manifest under its publication lock, derives the
target renderer node from that principal, and executes the generic
`nodes.materialize-connected` Canvas business command. Canvas validates the source
kind, chooses open placement, creates the node and source-to-created edge in one CAS
commit, and never modifies or removes the source. The manifest cannot name another
Plugin as the target and the action grants no general document-write capability.

## Connected-media preview

`canvas.connectedMedia.stream` is v7-only. A live Plugin frame can open a short-lived
session for one direct incoming managed audio/video node and explicitly close it.
The response contains a pathless media URL and probe facts. The dedicated protocol
supports GET/HEAD and single byte ranges; it never returns a native or Project path
and never encodes the whole resource as a data URL.

Main binds each session to the renderer sender, frame instance, exact Plugin digest,
Project, Canvas revision, owner node, direct edge, source resource reference and file
identity. Every request revalidates those facts. Canvas commits, edge/source changes,
frame destruction, Plugin update/uninstall, explicit close and expiry revoke access.
Session counts, idle/absolute lifetime and media size are bounded. The Plugin asset
CSP admits `convax-connected-media:` only when the exact installed v7 surface has
the stream grant.

Without `projects.read`, a Web connection is limited to the Project that presented
the frame. Every document call still carries `{ projectId, canvasId }`; the broker
checks the Project grant and current Canvas catalog instead of trusting that ref.

## Identity and transports

A connection is bound to an immutable principal:

```ts
interface PluginPrincipal {
  pluginId: string
  pluginVersion: string
  manifestDigest: string
  runtime: "web" | "tool" | "builtin"
}
```

The digest covers the normalized manifest, because the manifest is the permission
authority. Ordinary calls do not rehash unrelated HTML, images or other static
package assets. Built-in native trust and Tool executable authorization continue to
verify their complete, separate byte identities.

The current Web adapter uses a sandboxed `allow-scripts` iframe, a per-frame
`MessageChannel`, and an opaque sender-scoped preload/main connection. It forwards
V5 Project/Canvas methods to the main broker and keeps legacy node-state and
connected-input methods in the node-scoped adapter. The compatibility file
`web-plugin-canvas.tsx` is only a re-export; it owns no host policy.

The verified Tool adapter issues an exact Tool principal and exposes only a fixed
allowlisted reverse-MCP method family. Because a headless sidecar has no presentation
Project, it receives no Canvas connection without `projects.read`; that grant issues
an all-bound-Projects scope and every catalog/document grant is still checked
independently. The connection and its subscriptions close with the existing
generation/service runtime. Convax deliberately rejects a Canvas-only stdio runtime
until there is an explicit activation lifecycle instead of installing an executable
that can never start. Built-in principals are validated by the broker, but a direct
built-in transport adapter remains future work.

## Reads

`canvas.document.get` supports two projections:

- `geometry`: node ids, kinds, labels, parent ids, positions, sizes and edge
  topology.
- `structure`: geometry plus bounded portable metadata, inline fields still present
  in the current schema, and Project-relative resource references.

Projection edges are directed from the source card's right-side output to the target
card's left-side input. For any card, only edges whose `target` is that card describe
its inputs; outgoing neighbors are outputs.

Neither projection contains native paths, runtime/blob/data URLs or resource bytes.
`canvas.nodes.query` provides a smaller indexed-style query result when a full
projection is unnecessary.

The first resource API must remain separate from document reads. It will resolve a
portable reference through Project authority, prove the target Canvas still refers
to it, and recheck the resource revision before returning bounded bytes. Document
read permission alone never grants that capability.

## Writes

`canvas.transaction.execute` receives:

```ts
{
  ref: { projectId, canvasId },
  expectedRevision,
  transactionId,
  commands
}
```

Canvas applies the ordered command list to one starting document, advances the
revision at most once, and persists with one CAS write. The host injects the Plugin
actor; callers cannot impersonate UI or Agent actors. Transactions are request-size
bounded and currently accept 1-256 resource-free commands. Empty transactions are
rejected before they can allocate an idempotency receipt.

The result is a compact revision receipt. If a successful whole-Canvas operation
would make its affected-id summary exceed the transport ceiling, the host returns
the same committed revision with empty id arrays and `summaryTruncated: true`;
response shaping, event delivery, renderer reconciliation, cancellation, or runtime
shutdown never rewrites an already committed transaction into failure.

Resource add/replace and raw resource-reference injection are excluded. Resource
admission has Project-owned staging, lease, publication and cleanup behavior and
will use a separate business capability.

## Renderer consistency

Main serializes external document operations. If the target Canvas is active, the
renderer first acquires an editor lease that blocks local edits, aborts pending
operations, finalizes gestures and flushes the exact document on which the external
operation will build.

- A successful write ends as `committed` and reloads persistence without saving the
  stale editor snapshot.
- A read or failed write ends as `aborted` and releases the lease without reload.
- An inactive Canvas still reserves the document in the renderer while the main
  operation runs. Navigation cannot mount that Canvas (or switch Project) until the
  reservation is released, so an old document can never become editable mid-write.
- A missing active editor or mismatched lease fails closed.

Prepare has an explicit cancel message. A timeout or caller cancellation therefore
cannot leave a late editor flush permanently read-only. Agent Stop and Tool
reverse-MCP cancellation are propagated through queue admission, scope rechecks,
resource preparation and the final Canvas save checkpoint. Once persistence has
committed, renderer reconciliation failure is reported separately and does not turn
the mutation into a failed durable operation.

The same barrier is used by Agent document tools. View operations remain active-view
only.

## Layout extension

Whole-Canvas tidy is a Canvas business operation, not a host grid helper. The built-in
provider is deterministic, size-aware and graph-directed; its conservative
`component-packing` strategy preserves existing component regions and resolves
collisions with a bounded axis sweep, without replacing their mental map with a grid.
Directed strategies place
unrelated nodes on a deterministic shelf by default, while callers may explicitly
request `isolatedPlacement: "preserve"`. A domain-specific
geometry provider receives only a geometry snapshot and returns a revision-bound
geometry plan. Canvas validates ids, finite geometry, duplicate updates and source
revision before applying it atomically.

That provider can own the geometric phase of a role-aware story layout without
gaining persistence access. If the full role workflow must also create, reparent,
resize, or remove groups, each required operation must be a Canvas-owned structural
command before the Plugin can submit it with the calculated geometry as one
transaction. Adding such a command extends every authorized transport without
creating a Web-only Canvas implementation or hiding document mutations inside the
provider.

## Performance envelope

- Prefer `canvas.nodes.query` or `geometry` over `structure` when possible.
- Batch related edits into one transaction; do not send drag-frame mutations.
- Requests are capped at 1 MiB, document responses at 8 MiB, concurrent requests at
  16 per connection, subscriptions at 64 per connection, and transactions at 1-256
  commands.
- Revision notifications are serialized and deduplicated per Canvas; they carry no
  document snapshot and recheck catalog membership immediately before delivery.
- Successful application idempotency receipts retain at most roughly 4 MiB of
  serialized document results in aggregate; unique transaction ids cannot pin a
  thousand maximum-size Canvas documents in main memory.
- Manifest revalidation is proportional to the small normalized manifest, not the
  complete Plugin package.
- External document operations are intentionally serialized because one Desktop
  renderer currently owns one navigation reservation at a time. Independent
  documents can later move to per-document queues by making that reservation set
  multi-document, without changing the Plugin protocol.
- Change events are invalidations rather than full snapshots, avoiding repeated
  document fan-out.

The main remaining performance boundary is very large Canvas projection creation.
If real traces require it, pagination or incremental projections should extend the
broker contract; transports must not bypass Canvas by reading JSON directly.
