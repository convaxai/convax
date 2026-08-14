# Plugin and Skill Platform

Status: current architecture boundary.

This document explains ownership and runtime composition. It intentionally does
not duplicate Host API tables, manifest field catalogs, version history, or
Plugin-to-Plugin contracts. Those references are generated from
`@convax/plugin-api` and `@convax/plugin-sdk` so the executable validators,
TypeScript types, human documentation, and Plugin-owned Skill instructions cannot
drift.

## Product model

Every Canvas integration is a Plugin contribution. Concrete 3D directors, media
processing, external editors, generation vendors, and companion tools live in the
`convaxai/convax-plugins` repository. Convax owns only the generic Host:

- Skills compose typed capabilities as Agent instructions.
- MCP contributions are configured through the existing Agent or managed-sidecar
  boundaries.
- Agent and Tool contributions expose typed operations.
- Sandboxed Web contributions render custom Canvas nodes.
- Declarative node renderers and commands project into Host-owned Canvas surfaces.
  `canvas.commands` owns title, Host icon token, and one bounded
  `renderer-message` target. Toolbar and menu placements only reference a command
  id; they cannot redefine its presentation or behavior. Plugin menus are limited
  to the owning node's overflow surface.
- Plugins call Host APIs only when those APIs are explicitly declared and live
  availability checks succeed.
- Plugins call other Plugins only through the typed, Host-mediated capability
  broker.
- Plugins declare bounded localization resources in `manifest.i18n`; Web Plugins
  read and observe the Host locale through the SDK rather than inspecting browser
  globals or inventing another language bridge.

Runtime behavior derives from validated contributions, grants, and exact immutable
snapshot identity. A concrete Plugin id, vendor, model, field name, or catalog
source never changes Host semantics.

Marketplace presentation may derive four bounded Plugin categories from that same
validated contribution set: `service` from `contributes.service`, `video` and
`image` from generation tool outputs, and `skill` from owned Skills. These values
are Host-derived display metadata, not a manifest/Registry authoring field, grant,
runtime-readiness claim, or installation decision. Catalog aggregation keeps them
on the same representative source as the displayed Plugin metadata, and Renderer
filtering is local presentation only.

Marketplace details remain a Host-owned presentation of the same source-qualified
representative as the card. The Renderer identifies only the capability kind and id;
Desktop Main derives and revalidates the immutable package. Skill file trees use the
bounded, non-executable preview projection, and optional Showcase posters are
returned only after size, digest, and media-signature validation. These details do
not grant authority, select a source, expose a native path or release URL, or become
part of the persisted Marketplace card cache.

Desktop resolves a command against the current installed Plugin id and sends it
only to the exact owning iframe generation through an opaque frame lease. A stale
frame, remount, node ownership change, missing command, or missing Host icon token
fails closed; a missing icon uses the Host fallback and never admits Plugin SVG,
HTML, URL, or executable bytes.

Plugin authoring tasks do not own Host evolution. If the generated Catalog and SDK
cannot express a use case, the task must create a structured capability request in
`convax-plugins` and stop; it may not decide to edit this Host repository. See
[`plugin-host-change-governance.md`](plugin-host-change-governance.md).

## Current contracts

Only these breaking-cutover contracts are admitted:

| Boundary                          | Contract                     | Owner                    |
| --------------------------------- | ---------------------------- | ------------------------ |
| Plugin manifest and contributions | `convax.plugin/8`            | `@convax/plugin-sdk`     |
| Marketplace package envelope      | `convax.package/2`           | `@convax/marketplace`    |
| Web/capability transport          | `convax.plugin-capability/3` | Desktop protocol adapter |
| Host API catalog                  | independent SemVer catalog   | `@convax/plugin-api`     |

The Host API catalog evolves independently of the manifest and transport. A Plugin
declares required and optional APIs. Required APIs block activation when the Host
cannot satisfy them; optional APIs remain inspectable through structured
availability. `host.context.get` exposes the connection-scoped availability
projection. `host.locale.get` and the SDK-owned `host.locale.changed` event expose
only the Renderer language preference for the exact Web connection; they carry no
grant or domain authority. See
[`plugin-internationalization.md`](plugin-internationalization.md).

The generated Host API reference is
[`../packages/plugin-api/generated/plugin-api.md`](../packages/plugin-api/generated/plugin-api.md).
Its JSON counterpart is
[`../packages/plugin-api/generated/plugin-api.json`](../packages/plugin-api/generated/plugin-api.json).
Both are checked against append-only compatibility history in CI.

## Contribution plane and call plane

Registration and authority are orthogonal.

```text
convax.plugin/8
  ├─ i18n
  │   ├─ defaultLocale
  │   └─ messages[locale][key]
  ├─ contributes
  │   ├─ skills
  │   ├─ agent.mcp / agent.tools
  │   ├─ generation / companion tools
  │   ├─ canvas renderer / node
  │   └─ node toolbar / host-rendered selection-action menus
  ├─ hostApi
  │   ├─ required
  │   └─ optional
  └─ pluginCapabilities
      ├─ exports
      └─ imports.required / imports.optional
```

Registering a Tool does not grant a Host API. Owning a Skill does not grant the
Skill or Plugin additional authority. Rendering a node does not grant Project-wide
Canvas access. A Plugin-to-Plugin call does not transfer the caller's grants to the
provider.

## Immutable installation and activation

Desktop validates and publishes a complete, content-addressed Plugin closure:
manifest, static package, owned Skills, separately authorized Hook snapshot, and
exact companion bytes. It then builds one global `ActivePluginSet` that resolves
Skill-name conflicts and required Plugin dependencies before changing a single
compare-and-swap pointer.

```text
userData/plugin-installations/
  closures/<snapshot-digest>/
  state/
    installed/<snapshot-digest>.json
    active-sets/<active-set-digest>.json
    active-pointer.json
    owner-pins.json
```

Every runtime principal binds:

```text
{ activeRevision, activeSetDigest, snapshotDigest }
```

New calls resolve only the current ActiveSet. Work already in flight retains a
lease on its exact immutable snapshots. Durable long-running Host owners may hold
a bounded persistent pin; a pin preserves bytes but grants no execution authority.
Unsupported legacy state is rejected without silently rewriting or deleting it.
LLM contributions are validated identically at authoring, installation, startup,
and execution: `provider.protocol` must explicitly be `openai` or `openrouter`.
The Host does not retain an older LLM manifest parser, infer a protocol, or adapt a
retired model-catalog tool. An installed snapshot that does not satisfy the current
manifest remains invalid and non-executable; Host never parses it as migration or
in-place update input.

The packaged product lock may retain a bounded replacement closure for offline
recovery of one exact retired-Host-API Plugin binding. This is not a preinstall or
discovery source: the Host exposes it only to the existing explicit update path
after quarantine inspection matches source, Plugin id, old version, archive
SHA-256/size, immutable snapshot digest, and old Host API major. Fresh installs,
default provisioning, mismatched snapshots, and directory scans cannot consume it.
The successful CAS remains inert for the quarantined process until restart.

Plugin-owned Skills are read directly from the leased immutable closure. A generic
`resolveSkillPaths` port passes only absolute Skill directories to
`@convax/agent-runtime`; the Agent runtime never receives Plugin ids, ActiveSet
policy, or ownership journals. Standalone Skills retain their independent managed
directory and lifecycle.

## Plugin-to-Plugin calls

A provider exports a stable capability id, exact version, provider-local operation,
side-effect class, closed bounded request/response schemas, and generated
documentation. A caller imports a required or optional half-open SemVer interval.

ActiveSet planning binds each import to one exact provider snapshot:

- missing, incompatible, ambiguous, or self-only required providers reject
  activation;
- required dependency cycles reject activation;
- optional unresolved imports remain unavailable with structured reasons;
- runtime calls atomically validate and lease caller, provider, and the exact
  ActiveSet plan;
- request and response values are schema- and byte-bounded;
- cancellation, depth, re-entrancy, concurrency, and request replay are bounded;
- the provider executes under only its own principal and grants;
- nested calls may use only the provider's own declared imports.

Direct object references, Plugin-to-Plugin MessageChannels, mutable registries,
service locators, dynamic “first provider wins,” and renderer-selected providers
are forbidden.

## Trust boundaries

| Surface                           | Execution owner                | Boundary                                                                         |
| --------------------------------- | ------------------------------ | -------------------------------------------------------------------------------- |
| Web node                          | sandboxed iframe               | `sandbox="allow-scripts"`; no same-origin, Node, Electron, or generic bridge     |
| Host-rendered menu/Toolbar/action | Host UI + typed Main executor  | declarative contribution and current scope                                       |
| Companion Tool                    | Desktop-owned child process    | exact closure bytes, no shell, bounded environment and process-tree cancellation |
| Skill                             | OpenCode instruction discovery | no implicit Plugin or Host authority                                             |
| Hook                              | OpenCode native Plugin runtime | separately authorized exact immutable self-contained module                      |
| Remote MCP                        | OpenCode native MCP client     | validated HTTPS declaration; OpenCode owns OAuth and protocol                    |

Canvas and Project domain invariants remain in their owning application services.
UI, Agent, Host API, and Plugin-to-Plugin adapters are thin entry points into the
same business operations.

## Generated documentation workflow

An API or Plugin contract change starts in typed source with TSDoc:

1. add or change the catalog/manifest/capability definition;
2. update the append-only compatibility release input;
3. run the deterministic generator;
4. run compatibility and drift checks;
5. package the generated reference into human docs and Plugin-owned Skill
   `references/` during build/release.

Installed Skills are immutable snapshot bytes. A Host upgrade never edits an
installed Skill. A Plugin update publishes a new closure containing references
generated against its declared required/optional API set and Plugin capability
imports.

The stable `SKILL.md` remains a compact workflow index and links to generated
references. This keeps normal Agent context small while making exact availability,
version, scope, grants, side effects, and stable errors discoverable when needed.

## Conformance gates

Release and CI must fail closed on:

- generated JSON/Markdown or Skill-reference drift;
- breaking catalog changes without a major version;
- Plugin manifests not accepted by the same parser used by Desktop;
- unresolved required Plugin imports, ambiguity, or dependency cycles;
- package closure or ActiveSet digest mismatch;
- stale runtime identity or lease mismatch;
- Host handlers not represented in the API catalog;
- concrete Plugin ids or vendors in generic runtime branches;
- package-boundary, standalone pack, typecheck, or fault-injection failures.
