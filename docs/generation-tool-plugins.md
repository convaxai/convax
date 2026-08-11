# Generation Tool Plugins

Convax generation is a Plugin tool boundary, not a provider registry. Concrete
vendors, credentials, model routing and downstream task APIs live in an installed
`convax.plugin/8` Tool Plugin and its verified companion. Host packages contain no
vendor class and never branch on Plugin id.

The portable manifest and contribution parser are owned by
`@convax/plugin-sdk`. Runtime-call availability and stable Host API documentation
are generated from `@convax/plugin-api`; this file records architecture invariants
only.

## Contributions

A v8 Plugin may combine independent contributions:

- `runtime.type: "mcp-stdio"` binds one bare command to a verified immutable
  companion;
- `contributes.generation` declares generic tool/model display and selection
  metadata;
- `contributes.agent.tools` exposes selected contributed tools to Agent;
- `contributes.canvas.commands` plus toolbar/menu placements expose Host-rendered
  actions;
- a Web Plugin may declare the `generation.tools.list` and `generation.execute`
  Host APIs;
- `capabilities.exports` may expose exact sidecar operations to other Plugins
  through the Host broker.

These declarations do not grant each other. An iframe cannot start a process or
name an arbitrary MCP operation. Agent, UI, Web Plugin and Plugin-to-Plugin callers
all enter Main-owned typed adapters.

Host-rendered command and action text is a bounded localized object with a required
`default` value and optional `zh-CN` value. Desktop resolves that portable text
through the current application locale; it neither rewrites Plugin-authored text
nor creates a Desktop-only localization schema.

An immediate image action is the strict generic combination
`editor: "immediate"`, `target: "image"` and
`presentation: "cutout-scan"`. It has exactly one step referencing a non-model
image-output operation that accepts `reference_image`. The Host preserves the
source and creates the generated image as a separate Canvas result. The
presentation token supplies only a Host-owned visual treatment; it grants no
execution authority and never identifies a concrete Plugin.

## Execution path

```text
UI / Agent / Web Plugin / Plugin capability broker
  -> Desktop Main generation adapter
  -> exact ActiveSet and companion byte lease
  -> tools/list contract validation
  -> staged bounded Project inputs
  -> exact MCP tools/call
  -> no-clobber Generated/ publication
  -> CanvasResourceBusinessService
```

Main derives Project, Canvas, revision, placement, actor and operation id. It
revalidates the current scope, selected tool contract, input references,
cancellation and exact Plugin identity immediately before the external side
effect and before every Canvas persistence call. Renderer state is never a
correctness prerequisite.

## Tool contract

`tools/list` is authoritative for the current runtime generation. The Host accepts
only bounded closed input/output schemas and matches the exact manifest-declared
operation. A single explicitly marked top-level selector may represent a dynamic
generation model id; Main removes it from ordinary controls and binds an opaque
validated selection immediately before execution.

Main may project all admitted model families from one exact runtime response into
one bounded, display-only session snapshot. Startup provisioning and Plugin or
service lifecycle changes invalidate and asynchronously warm a new epoch.
Concurrent refreshes for one epoch are single-flight and commit atomically. An
age-triggered refresh serves the prior same-epoch snapshot until replacement
succeeds. Empty model results and transient failures remain retryable with bounded
backoff so a still-starting service is not cached as permanently ready. That Main
session snapshot is never persisted or treated as execution authority. Installed
manifest/service membership and the current bounded tool schema admit display;
`service.status` is neither awaited nor used to remove installed models during
discovery. Main reloads the selected tool schema and service status immediately
before execution.

An optional fixed `service.usage.list` call is a Services display projection only.
Its bounded history never participates in generation availability, preparation,
dispatch, billing authority, or recovery.

Renderer may persist the last complete validated Service display projection so a
cold window can show the installed list, status, credits, and optional usage history
immediately. Installed inventory, status, and usage revalidate independently in the
background while prior values remain visible. The cache is bounded, versioned, and
display-only. Credential-changing actions clear prior usage before reloading it;
every action and generation dispatch still uses live Main/sidecar checks.

Renderer may likewise persist one last-complete generation/Agent model display
projection. A cold window renders that strictly validated, bounded, versioned cache
immediately and revalidates it in the background. Service rows group their models
for navigation but are not a separately committed provider choice. Cached ids never
authorize a call: Agent prompts recheck the exact OpenCode provider/model pair and
generation preparation rechecks the exact tool, schema, lease, and live Service
status before dispatch.

Plugin-to-Plugin exports name the exact MCP tool operation. Availability and
execution must use the same lease-derived sidecar session; echoing identity strings
is not provenance.

## Outputs and partial success

Generated bytes first become no-clobber user-visible Project files under
`Generated/`, then normal Canvas resources. A Canvas failure after publication
retains the file and reports bounded partial success. A stale Plugin, sender
destruction or cancellation before publication produces no user file. Plugins
never write `.convax` JSON, choose pending node ids or replace arbitrary nodes.
For a pending result with exactly one same-modality visual reference, Main may
derive that reference's presentation size; Canvas commits the size with the pending
node and preserves the frame when the generated resource replaces it.

## Long-running work

Accepted queued or running work has no arbitrary overall timeout. Sidecars bound
individual network requests and keep non-terminal work alive until success,
explicit terminal failure or caller cancellation.

Restart recovery requires the complete Scheduler–Agent–Supervisor/LRO contract.
`operationId` is the durable idempotency identity; downstream `taskId` is opaque.
The recovery record pins the exact ActiveSet/snapshot/companion/tool binding. A
Plugin without that complete contract is marked failed after restart and is never
silently replayed. Recovery-capable Plugins query or resume the same operation id;
they never create a replacement billable operation during restart recovery.

The in-process Plugin capability broker rejects only a concurrent duplicate.
Billing-grade replay safety belongs to the provider's durable `operationId`/LRO
implementation; the Host does not retain an unbounded completed-call ledger.

## Security and lifecycle

- install/update consent binds the normalized v8 manifest and exact companion
  bytes;
- no PATH fallback, shell invocation, mutable package execution or concrete Plugin
  privilege exists;
- process disposal owns the entire process tree and fails closed where the platform
  cannot guarantee it;
- cancellation crosses queues, staging, runtime preparation and MCP;
- no native path, credential, cookie, raw diagnostic or arbitrary MCP name crosses
  preload;
- update/uninstall blocks new calls while leases allow already admitted calls to
  settle safely.

## Authoring and validation

Plugin authors consume generated Skill references. If an API or contribution is
missing, they submit a structured Host capability request for human review and do
not inspect or modify Host code.

Contract changes run the package-local SDK/API tests, Desktop typecheck and tests,
package-boundary check, Registry/pack checks, plus update/uninstall/cancellation,
crash-recovery, schema-mismatch and partial-success fault tests.
