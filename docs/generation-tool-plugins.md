# Generation Tool Plugins

Status: implementation contract for maintainers and Plugin authors.

Convax generation is a tool boundary, not a provider abstraction. Concrete
services, models, credentials, routing rules and vendor task APIs live entirely in
an external tool implementation. Convax discovers only the installed tool contract
and keeps Canvas scope, inputs, output admission and document mutation under host
control.

This design has two independent Plugin roles:

- a **Generation Tool Plugin** declares one external MCP command and the generation
  tools it implements;
- a **Generation Caller Plugin** is a sandboxed Canvas Web surface granted the
  narrow `generation.execute` capability so it can use installed generation tools.

A `convax.plugin/2`, `/3`, or `/4` package may have either role or both. Declaring a
runtime does not grant its iframe caller authority, and granting caller authority
does not let an iframe start processes or issue arbitrary MCP calls. V4 preserves
the v3 generation, operation, service, and execution semantics; its additional
`contributes.skills` metadata is consumed only by the Desktop-owned Plugin/Skill
lifecycle.

The same executable package may also declare a **Service contribution** for account
connection and metering status. It shares the exact runtime, install-time executable authorization,
MCP client, invalidation and process disposal used by generation; it is not a second
provider or process framework.

## Ownership and call path

Desktop main owns the composition, native staging and process boundary. It does not
own a catalog of providers or models.

```text
Toolbar / Canvas UI -------- generation IPC ---------+
                                                     |
OpenCode Agent -- model or declared operation adapter +--> GenerationCanvasService
                                                     |      | validate live scope/revision
sandboxed Plugin -- versioned host generation calls -+      | stage selected inputs
                                                            | call installed MCP tool
                                                            | admit output
                                                            v
                                                CanvasResourceBusinessService
                                                            |
                                                .convax/assets + normal file/text nodes
```

`GenerationCanvasService` is the one application operation shared by all three
callers. OpenCode is a client of that operation for Agent turns; it is not the
execution bus, and Toolbar or Plugin actions do not need an OpenCode session.

Installing a Generation Tool Plugin never creates a vendor-specific Canvas node.
Toolbar and Agent actions may start generation from ordinary Canvas selections;
normal text, image, video and audio nodes become typed references only when the
chosen tool accepts their roles. Generated results are admitted as the existing
normal text or `file` nodes. Vendor identity remains an execution detail of the
headless tool and is never encoded in Canvas node types.

The Desktop file-card surface composes one host-rendered **Generate** tab beside
the existing **Agent** conversation. The Generate tab is a direct caller of this
same service and groups image, video and audio in one surface. The clicked card is
never an implicit reference: direct generation includes only nodes the user
explicitly mentions. Agent mode may prepare its own scoped Canvas context. Its model
picker is the installed generation-tool list; it is not a second model or provider registry.
Tool-specific choices such as aspect ratio, resolution, duration and style come
only from the selected MCP tool's own `tools/list.inputSchema`; they are not copied
into the Plugin manifest or a host provider registry. Main projects that schema
into bounded scalar controls and never exposes the raw JSON Schema to renderer.

Relevant implementation boundaries are:

- [`plugin-contracts.ts`](../packages/desktop/src/plugin-contracts.ts): manifest
  schema and capability validation;
- [`generation-plugin-runtime.ts`](../packages/desktop/src/main/generation-plugin-runtime.ts):
  installed-tool discovery, authorization and MCP process lifecycle;
- [`managed-plugin-companions.ts`](../packages/desktop/src/main/managed-plugin-companions.ts):
  verified Registry companion publication, resolution and reconciliation;
- [`generation-canvas-service.ts`](../packages/desktop/src/main/generation-canvas-service.ts):
  staging, result admission and Canvas resource mutation;
- [`generation-agent-tools.ts`](../packages/desktop/src/main/generation-agent-tools.ts):
  the thin OpenCode-facing `canvas_generate` adapter;
- [`plugin-operation-agent-tools.ts`](../packages/desktop/src/main/plugin-operation-agent-tools.ts):
  the generic Agent adapter for manifest-declared operation tools;
- [`media-operation-selection-action.ts`](../packages/desktop/src/renderer/media-operation-selection-action.ts):
  manifest-driven discovery and request construction for host-rendered media actions;
- [`web-plugin-canvas.tsx`](../packages/desktop/src/renderer/web-plugin-canvas.tsx):
  the scoped sandboxed-Plugin caller adapter.

## `convax.plugin/2` manifest

`convax.plugin/1` remains static-only. Executable generation declarations and the
`generation.execute` caller capability require `convax.plugin/2`, whose mounted Web
surface uses `convax.plugin-host/2`.

A Tool Plugin must declare `runtime` together with at least one executable
`contributes.generation` or `contributes.service` entry. A caller-only v2 Plugin
omits both and requests `generation.execute`. A package that both contributes tools
and calls generation declares all three.

This headless Tool Plugin example deliberately contains no Web surface, service or
model identity:

```json
{
  "schema": "convax.plugin/2",
  "id": "creative-tools",
  "name": "Creative Tools",
  "description": "Generate Canvas media through an external MCP command",
  "version": "1.0.0",
  "contributes": {
    "generation": {
      "tools": [
        {
          "id": "image.generate",
          "title": "Generate image",
          "description": "Generate an image from a prompt and optional visual references",
          "output": "image",
          "acceptedInputs": ["text", "reference_image", "first_frame", "last_frame"]
        },
        {
          "id": "video.generate",
          "title": "Generate video",
          "description": "Generate a video from typed Canvas references",
          "output": "video",
          "acceptedInputs": ["text", "reference_image", "reference_video", "first_frame", "last_frame", "audio"]
        }
      ]
    }
  },
  "runtime": {
    "type": "mcp-stdio",
    "command": "creative-tools-mcp",
    "args": ["serve", "--stdio"]
  }
}
```

A Tool-only package does not need a fake HTML entry or Canvas contribution. A
caller-only package uses v2 with an `entry`, Canvas contribution and
`capabilities: ["generation.execute"]`, but does not declare `runtime` or
an executable contribution. A package may declare both roles when it genuinely owns
both a Web surface and executable tools.

## Declarative `convax.plugin/3` and `/4` catalogs and operations

`convax.plugin/3` and `/4` remove the legacy ambiguity between a generation model and
a deterministic media operation. Their generation declaration must include `models`,
which explicitly maps pure model display names to tool ids; an unreferenced tool is
an operation. Existing v2 tools retain their original model semantics. The v4 host
uses the same model, Agent-operation, Canvas selection-action, service, executable
authorization, and output-admission paths as v3; owned Skills do not alter tool
discovery or execution.

```json
{
  "schema": "convax.plugin/3",
  "id": "video-operations",
  "name": "Video Operations",
  "description": "Declarative video operations",
  "version": "1.0.0",
  "capabilities": [],
  "contributes": {
    "generation": {
      "tools": [
        {
          "id": "video.transform",
          "title": "Transform video",
          "description": "Create one transformed video",
          "output": "video",
          "acceptedInputs": ["reference_video"]
        }
      ],
      "models": []
    },
    "agent": {
      "tools": [{ "id": "transform_video", "tool": "video.transform" }]
    },
    "canvas": {
      "selectionActions": [
        {
          "id": "trim",
          "title": { "default": "Trim", "zh-CN": "截取" },
          "description": { "default": "Create a video from a selected time range" },
          "target": "video",
          "editor": "time-range",
          "steps": [{ "tool": "video.transform" }]
        }
      ]
    }
  },
  "runtime": {
    "type": "mcp-stdio",
    "command": "video-operations-mcp"
  }
}
```

Agent and Canvas selection-action references must resolve to declared operations;
model tools cannot acquire operation surfaces. Host-rendered video selection actions
accept only `time-point`, `time-range`, `crop-region`, or `confirmation` editors,
and every step must reference a tool that accepts `reference_video`. The host derives
scope, revision, assets, relationships, and execution identity exactly as it does for
all other Tool Plugin calls; no Plugin id receives core special handling.

A service contribution contains only an explicit subset of fixed host actions:

```json
{
  "contributes": {
    "service": {
      "actions": ["sign_out"]
    }
  },
  "runtime": {
    "type": "mcp-stdio",
    "command": "creative-tools-mcp"
  }
}
```

`service.status` is required whenever `contributes.service` exists. Optional action
values map exactly to `service.authorize`, `service.reauthorize`,
`service.authorization.cancel`, and `service.sign_out`; a manifest cannot rename a
method or declare arbitrary calls. An empty action list is valid for a read-only
status surface. Hosts render only declared actions, so lack of an application-safe
authorization exchange is represented honestly rather than by a fake reauthorize
button.

The declaration rules are intentionally small:

- output modalities are `text`, `image`, `video` and `audio`;
- reference roles are `text`, `reference_image`, `reference_video`, `first_frame`,
  `last_frame` and `audio`;
- `acceptedInputs` is the compatibility declaration for optional Canvas
  references and may be `[]` for a prompt-only tool; the prompt is always passed
  separately and a call may contain no references;
- tool ids are unique inside the Plugin. The host-stable id exposed to callers is
  `<plugin-id>/<tool-id>`, for example `creative-tools/image.generate`;
- provider, model, credential and routing fields are not part of the manifest and
  are rejected as unknown fields. A sidecar may own such configuration internally
  or expose multiple declared tools when the user needs distinct choices.

`runtime.command` is always a bare executable name; it is never an absolute or
package-relative path. For an official Registry install, Desktop first looks for a
host-managed companion bound to that exact Plugin id, Plugin version and command.
If none exists, it preserves the explicit integration path by resolving the command
only through absolute entries in the Convax process's `PATH`. Convax does not guess
Homebrew, user-local or vendor-specific locations.

In either case the host resolves the real executable, requires an executable regular
file, and fingerprints its live bytes during installation. At execution it creates
and verifies a unique launch snapshot in its own private temporary directory outside
the immutable companion or `PATH` installation, then runs that snapshot rather than
resolving the original pathname again. The random verified snapshot protects against ordinary
replacement of the install-verified entrypoint. It is not a same-account OS sandbox:
another process already running as the same user can inspect Convax memory, read the
CLI's login state, or race user-writable directory entries. Stronger isolation still
requires an OS sandbox, not another provider abstraction.
Arguments are static, bounded CLI tokens: whitespace, shell/code metacharacters,
native paths and traversing paths are rejected. `shell` is disabled.
Windows declarations still reject `.cmd`, `.bat` and PowerShell shims rather than
routing through a shell. Actual Tool Plugin execution currently fails closed on
Windows until Desktop owns the launched process tree with a Job Object; listing and
installing declarations remains portable.

## Installation, authorization and process lifecycle

The Plugin package remains a validated static package with `manifest.json` plus any
declared Web entry/assets. A headless Tool Plugin needs only its manifest. An
executable is separate from the Plugin ZIP and is never served as a Plugin asset.

An optional official Registry `companions` entry contains a command, companion
SemVer and one or more target records. The command must exactly equal
`manifest.runtime.command`; targets are limited to `darwin|linux|win32` and
`arm64|x64`. Each target declares an immutable raw Release asset with exact byte
size and SHA-256. Its URL must be exactly:

```text
https://github.com/microvoid/convax-plugins/releases/download/plugin-<plugin-id>-v<plugin-version>/convax-companion-<command>-<companion-version>-<platform>-<arch>[.exe]
```

Desktop selects only the exact current platform/architecture, enforces a 128 MiB
download ceiling, and rechecks size and digest before writing. It publishes the
executable with private permissions below a host-owned path keyed by Plugin,
Plugin version, command and companion version. Existing bytes at the same immutable
identity must match exactly; different bytes require a version bump. A missing
target, download failure, digest change, symlink, or Plugin publication failure
leaves the previous installed Plugin/companion pair usable. Startup, update and
uninstall reconcile stale companion versions and orphan Plugin directories.

Choosing an explicit install or update is consent to execute only the exact Tool
Plugin identity being published. Before publishing the package, Desktop resolves
either the managed companion or the explicit `PATH` fallback, fingerprints it, and
transactionally coordinates a private authorization receipt with the package
switch. The receipt binds the
normalized manifest fingerprint, binding kind (`managed` or `path`), real path,
size and SHA-256. A Registry Plugin with a companion requires that managed binding;
it cannot silently authorize a same-named PATH executable. An unresolved manual
import fails before the Plugin appears installed. Listing and installation never
start the executable.

On every runtime start, Desktop silently resolves the executable and requires the
matching persisted receipt, then resolves it once more before snapshotting. Missing,
tampered or changed receipts, declarations, binding sources or bytes fail closed
with a bounded instruction to reinstall the Plugin; renderer errors never disclose
the native path. There is no first-call permission dialog. Restart preserves valid
installation consent. Upgrade keeps old and new immutable receipts usable around
the package switch and then removes the superseded one; uninstall removes the Plugin
first and revokes its receipt best-effort. Crash-partial and orphaned states cannot
execute, and startup reconciliation removes them.

After verification, Desktop starts the command with:

- a private, empty, short-lived host directory as its working directory;
- no shell;
- an environment allowlist containing executable lookup, home/config, temporary
  directory, locale and required platform variables;
- no ambient API-key or unrelated application-secret variables.

The home/config variables intentionally allow a separately installed CLI to reuse
its own login or cookie state. This does **not** sandbox the command: it runs with
the user's OS account and can use that account's filesystem and network authority.
Authors must make this clear in package documentation and should use the narrowest
possible sidecar. Installation authorization remains bound to the exact declaration,
binding source and resolved executable bytes.

The runtime is lazy and reused after a successful start. Before copying potentially
large references, the host resolves, authorizes, snapshots, starts and verifies the
exact declared MCP tool. Preparation returns an in-process execution bound to that
Plugin fingerprint, tool declaration and running sidecar; if the Plugin changes
during staging, the call fails before sending `tools/call`. Plugin update/removal,
application shutdown, or a non-cancellation protocol failure closes and evicts the
process. Declared tools are visible from the validated manifest without starting
the command, but the first call also verifies that MCP `tools/list` exposes the
exact declared tool id.

## MCP stdio subset

The command speaks newline-delimited JSON-RPC 2.0 over stdin/stdout. Desktop uses
MCP protocol version `2025-03-26` and only the following surface:

1. `initialize`, followed by `notifications/initialized`;
2. paginated `tools/list`;
3. `tools/call` for the selected declared tool;
4. `notifications/cancelled` when an in-flight request is canceled.

The sidecar must keep logs and human-readable diagnostics on stderr. Desktop drains
stderr but never returns its raw content to Toolbar, Agent or Plugin callers, since
CLI diagnostics may contain cookies, tokens or native paths. Writing non-JSON data
to stdout, duplicate tool ids, oversized messages, unsupported result content, or a
missing declared tool fails the call. A single JSON message is currently limited to
64 MiB, so large media should be returned as files rather than inline base64.

### Service status and actions

Service calls receive exactly `{}`. A successful `service.status` or service action
returns `structuredContent` using `convax.plugin-service-status/1`:

```json
{
  "schema": "convax.plugin-service-status/1",
  "state": "connected",
  "credential": { "configured": true, "verification": "verified" },
  "account": { "availability": "unavailable" },
  "credits": { "availability": "available", "remaining": 80, "unit": "credits" },
  "usage": { "availability": "unavailable" }
}
```

Account availability may instead include one bounded `displayName`. Usage
availability may include bounded non-negative `consumed`, `unit`, and optional
`period`. Missing or unsupported account, credit, or usage APIs must use
`availability: "unavailable"`; the host does not infer or scrape those values.

Main rejects unknown fields, impossible credential/connection states, unbounded
numbers, URLs, native paths and malformed display text. It discards normal MCP
`content`, stderr, and raw errors rather than forwarding them to preload. The
renderer can pass only a validated Plugin id to one fixed bridge method per action.
Plugin updates or uninstalls invalidate in-flight results, and renderer destruction
cancels outstanding calls. The Services settings page is host-rendered; it never
loads Plugin HTML. `sign_out` requires an explicit host confirmation because it may
delete the sidecar's local credential.

The application menu and Services settings share one Desktop-owned read model.
For a Plugin service, capability badges and model rows are projected from the same
static `contributes.generation.tools` declarations used by generation execution;
listing them does not start the sidecar. OpenCode appears as the existing built-in
LLM runtime and lists only the bounded provider/model projection supplied by
`@convax/agent-runtime`. This display catalog has no generic execute method and does
not alter either tool selection or Agent model routing.

An `authorize` or `reauthorize` action may instead request a main-owned browser
exchange. This is a two-phase fixed protocol, not a general MCP callback. The first
action still receives `{}` and may return exactly:

```json
{
  "schema": "convax.plugin-service-browser-authorization/1",
  "authorization_id": "request_0123456789abcdef",
  "login_url": "https://accounts.example.com/sign-in",
  "cookie_origin": "https://accounts.example.com",
  "cookie_names": ["session_id"],
  "timeout_seconds": 300
}
```

Both URLs must be canonical HTTPS without credentials or fragments, and the login
URL must have exactly the requested cookie origin. Cookie names are a unique,
bounded RFC token allowlist. Main opens the URL in a fresh non-persistent Electron
session with Node disabled, sandboxing enabled, permissions and downloads denied,
and non-HTTPS navigation blocked. Installing the Tool Plugin and choosing Configure
is the explicit consent for this fixed tool flow; completing sign-in continues
automatically when an allowlisted Cookie appears, with no second command prompt.
HTTPS login popups retain their real opener while inheriting the same temporary
session and recursive security guards. A child popup closing never settles the root
authorization.

Main then queries only that exact origin, drops every cookie whose name is not in
the request allowlist, enforces per-value and aggregate bounds, and makes the one
fixed internal `service.authorization.complete` call:

```json
{
  "schema": "convax.plugin-service-browser-authorization-completion/1",
  "authorization_id": "request_0123456789abcdef",
  "cookie_origin": "https://accounts.example.com",
  "cookies": [{ "name": "session_id", "value": "..." }]
}
```

That tool is not a manifest action and cannot be selected by renderer input. Its
one-shot continuation is bound to the exact manifest, executable snapshot and MCP
client that returned the request. Cancellation, timeout, window destruction,
Plugin update/uninstall, missing approved cookies, or an invalid completion status
fail closed. A remote root close gets a short bounded exact-origin recheck grace so
Chromium can publish a final Cookie mutation. Before the temporary browser session
is cleared, Main atomically stores only the already-filtered envelope in a private
mode-0600, short-lived recovery checkpoint bound to the manifest and verified executable bytes.
The checkpoint is deleted only after the sidecar durably accepts it; a crash or
sidecar restart in between can replay it into a fresh authorization id without
opening another login page. Explicit cancellation/sign-out and Plugin update or
uninstall delete it. This is never a persistent Chromium profile. Authorization
requests, URLs and cookie values remain in main; they never enter preload, renderer
status, logs, or caller-visible errors. App quit first drains any in-flight
checkpoint/sidecar handoff, then disposes the shared Tool Plugin runtime.

### Tool input

Every declared generation MCP tool receives a `convax.generation-call/1` object.
Its host-reserved envelope fields are stable and use snake case where shown:

```json
{
  "schema": "convax.generation-call/1",
  "operation_id": "convax-<opaque-host-scoped-sha256>",
  "prompt": "Create the next shot",
  "output": "video",
  "output_directory": "<absolute short-lived output directory>",
  "references": [
    {
      "kind": "file",
      "node_id": "frame-node",
      "role": "first_frame",
      "name": "frame.png",
      "mime_type": "image/png",
      "path": "<absolute path to a staged temporary copy>"
    },
    {
      "kind": "text",
      "node_id": "notes-node",
      "role": "text",
      "text": "Camera and continuity notes"
    }
  ]
}
```

The fixed host-reserved keys are `schema`, `operation_id`, `prompt`, `output`,
`output_directory`, and `references`. A tool may add top-level custom inputs only
by declaring them in that exact MCP tool's current `tools/list.inputSchema`.
Desktop lazily starts only the selected sidecar when configuration is opened,
projects direct top-level scalar properties into a bounded renderer-safe form, and
supports string/select, finite number, safe integer, and boolean fields. Raw JSON
Schema, nested values, native paths, arbitrary MCP methods, and unsupported
constraints never cross preload.

The current bounded projection accepts at most 32 custom fields from a 64 KiB
schema. Field ids are 1–64 ASCII alphanumeric/dot/dash/underscore characters and
must begin with a letter. Strings are capped at 4096 characters; select fields
accept at most 64 unique string choices from `enum` or `oneOf` string `const`
entries; numbers are finite within ±10^12; integers are safe integers; and booleans
are direct toggles. A required custom field using an unsupported shape makes the
tool non-configurable and non-executable through this boundary. Optional unsupported
fields are omitted from the host surface and cannot be submitted.

The caller sends only scalar values for chosen custom fields. Omission is the
host's Auto state. A UI may present a declared schema default as its explicit
initial value, but Main never invents or inserts defaults. Immediately before staging/calling, Main reloads the
selected installed tool definition and validates every custom key, type, choice,
range, length, and required field against that current schema. Unknown keys and
all attempts to supply a host-reserved key fail closed. The validated custom fields
are merged at the top level while the fixed envelope wins defensively. A tool with
no supported custom fields receives the byte-for-byte same field set it did before
this extension; no `convax.generation-call/2` exists.

`operation_id` is an opaque, irreversible host-scoped identifier. It is stable only
for a replay of the same logical request from the same Project, Canvas and actor;
the renderer- or Agent-supplied raw operation id is never sent to the sidecar. The
host single-flights and caches that scoped operation, rejects reuse with a different
payload, and passes the opaque id to the sidecar so it can use a remote idempotency
key when its service supports one. Sidecars must not infer authority or user-visible
identity from this value.

The host loads the authoritative live Canvas and validates every reference against
its declared role. Media inputs must already be normal Canvas media nodes backed by
managed `.convax/assets` references. Desktop opens and copies those files into a
private temporary input directory; Project native paths never cross the renderer,
preload, Agent or iframe boundary. Text nodes are copied as bounded text values.
After staging and immediately before `tools/call`, Desktop rechecks both the persisted
Canvas document and the live Canvas revision, plus any direct-incoming constraint, so
a stale request cannot start a paid job.

All request paths in this call object are ephemeral native paths. They must not be
stored in model metadata, Plugin state or generated files. The request authorizes
the tool to read only the supplied reference copies and write results only below
`output_directory`; this protocol scope is not an OS filesystem sandbox.

### Tool result

Return a normal MCP tool result. `isError: true` fails the generation; its raw text
diagnostic is not exposed across the host boundary. Successful results use one or
more of these forms:

| Declared output | Accepted result form                                                |
| --------------- | ------------------------------------------------------------------- |
| `text`          | MCP `content` entries with `{ "type": "text", "text": "..." }`      |
| `image`         | inline MCP image content, or a file result below `output_directory` |
| `audio`         | inline MCP audio content, or a file result below `output_directory` |
| `video`         | a file result below `output_directory`                              |

A file result can be returned as an MCP `resource_link` whose `uri` is a `file:` URL
below `output_directory`, or through structured content:

```json
{
  "content": [{ "type": "text", "text": "Optional non-media diagnostic" }],
  "structuredContent": {
    "artifacts": [
      {
        "path": "renders/result.mp4",
        "mimeType": "video/mp4",
        "name": "result.mp4"
      }
    ]
  }
}
```

Artifact paths are portable relative paths below `output_directory`. Every artifact
must exist before `tools/call` resolves. Absolute paths, traversal, symbolic links,
directories, empty files, files outside the output directory and declared
MIME/extension mismatches are rejected. Desktop detects media signatures rather
than trusting names.

Currently admitted formats are PNG, JPEG, GIF and WebP images; MP4, QuickTime and
WebM video; and MP3, WAV, Ogg, FLAC and M4A audio. Default limits are 32 input
references, 2 GiB total staged input, 16 output files and 2 GiB per input or output
file. Text input/output is bounded separately. Inline base64 is additionally
constrained by the MCP message limit.

For a non-text tool, text content is normalized into at most 32 bounded warnings
rather than inserted as Canvas nodes. After admission, Desktop copies media through the managed
Project asset import, calls `CanvasResourceBusinessService.addResources`, creates
normal Canvas file nodes and connects them to the referenced input nodes. A failed
Canvas commit rolls back newly imported assets. A low-level Project import copy
failure may conservatively leave a partial target: the portable Node filesystem API
cannot atomically prove pathname identity and remove it, so Convax never risks
deleting a concurrent writer's replacement. Text output becomes a normal text
resource. The sidecar never writes Canvas JSON or
chooses Project scope, revision, placement or node ids.

The entire temporary tree is removed after success, failure or cancellation.

## Sandboxed Plugin caller API

A Web surface with `generation.execute` receives exactly two additional methods on
the MessagePort version matching its manifest (`convax.plugin-host/2`, `/3`, or
`/4`):

| Method                      | Params                                                 | Result                                                              |
| --------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------- |
| `generation.tools.list`     | optional `{ "output": "image" }` filter                | sanitized installed tool summaries                                  |
| `generation.canvas.execute` | `prompt`, optional `output`, `toolId` and `references` | created node ids, committed revision, selected tool id and warnings |

For `generation.canvas.execute`, `references` contains only `{ nodeId, role }`
items. Explicit references must be supported nodes connected by a direct incoming
Canvas edge to the Plugin's owning file node. When the field is omitted, the host
infers direct incoming text, image, video and audio nodes in edge order using their
default roles. `first_frame` and `last_frame` are explicit image roles.

The iframe cannot supply a Project/Canvas id, native path, revision, placement,
operation id or mutation actor. The host derives all of them from the live bound
frame, rejects read-only/stale scope, rechecks scope after asynchronous work and
allows only one generation call in flight per frame. A caller may omit `toolId` only
when exactly one installed tool accepts the requested output and reference roles.
For this direct-incoming mode, any Canvas revision, edge or referenced source change
during generation fails the operation; it is never replayed onto a newer document.

This capability does not expose process control, environment variables, arbitrary
MCP methods, all Canvas nodes, or a general function-call bridge. The iframe remains
static Web content in `sandbox="allow-scripts"`.

## Cancellation and long-running work

Generation is one host operation even when the external service uses queued jobs or
polling. The sidecar owns that service-specific lifecycle and resolves `tools/call`
only when final output artifacts are ready. Convax does not add a provider job
registry or duplicate a service's task model.

Desktop does not impose an absolute deadline on a generation `tools/call`. A
sidecar that has successfully submitted a queued job keeps the call open while the
service reports a non-terminal state, and resolves only after artifacts are ready
or an explicit terminal failure occurs. Sidecars should bound each status request
and retry temporary observation failures without turning a valid queued/running
state into a job timeout.

Direct UI and sandboxed-Plugin calls wait on the sidecar until completion or
explicit cancellation. Agent calls cross OpenCode's Streamable HTTP MCP client;
the host emits bounded, content-free progress heartbeats for every active tool
call. OpenCode treats its configured timeout as an inactivity window and resets it
on each heartbeat, so it is not an overall generation deadline. Cancellation
propagates from:

- a Toolbar/UI `operationId` cancel request or renderer destruction;
- the OpenCode tool-call `AbortSignal`;
- closing or replacing a sandboxed Plugin frame;
- Plugin removal/update and application shutdown.

For an in-flight MCP request Desktop sends `notifications/cancelled` with the JSON-RPC
request id and rejects the host operation as `AbortError`. Sidecars should stop
local work and cancel remote work when the remote API can do so safely. They must
also tolerate the temporary directories disappearing after cancellation. Convax
does not automatically retry a failed or canceled generation because the external
tool may already have produced a billable or otherwise irreversible side effect.
Once `tools/call` was attempted, the operation id remains an at-most-once tombstone
in the bounded session replay cache; authorization, executable resolution and tool
readiness failures remain retryable with the same id. A replay caller may stop
waiting without canceling the already-owned shared execution; an explicit retry of
an attempted call uses a fresh operation id. On macOS/Linux, process shutdown is
graceful for ordinary eviction and escalates to an immediate process-group kill
when the MCP leader exits or the grace period expires. Windows execution stays
disabled until a Job Object can provide the equivalent owned-tree guarantee.

## Maintainer checklist

Changes to this boundary must preserve all of the following:

- no provider/model registry or concrete service logic in Convax packages;
- one shared generation application service for UI, Agent and Plugin callers;
- host-derived Project/Canvas scope, revision, placement and mutation actor;
- install-authorized and runtime-verified execution before staging, aggregate-bounded
  temporary inputs and bounded outputs;
- generated media entering Canvas only through the managed asset/resource flow;
- strict v1-v4 manifest and matching Plugin-host protocol compatibility;
- explicit install/update authorization, no first-call prompt and no shell execution;
- exact Registry companion target/URL/size/digest checks, atomic rollback and
  explicit `PATH` fallback;
- cancellation, stale-scope, symlink, signature, size and process-disposal tests.

Run the affected Desktop typecheck/tests and the repository boundary check after a
contract change:

```sh
bun --cwd packages/desktop typecheck
bun --cwd packages/desktop test
bun check
```
