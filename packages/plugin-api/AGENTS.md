# Plugin API Package Contract

`@convax/plugin-api` is the headless, independently publishable source of truth for
the Convax Host API catalog.

## Owns

- Stable Host API ids and their structured contract/documentation metadata.
- The schema-first `src/method-schemas.ts` descriptor: stable method ids, complete
  nested request/result schemas, semantic refinements, per-direction byte budgets,
  and the versioned schema dialect.
- TypeScript request/result maps and aliases, the generic strict runtime schema
  interpreter, full machine-readable contracts, and deterministic human/Skill
  references derived from that descriptor. Do not hand-declare a parallel payload
  type or add an API-id switch to the parser.
- Catalog release grouping and automatic `since` attribution.
- Plugin required/optional Host API declaration validation.
- Runtime-neutral availability, structured remote-error, cancellation/result
  delivery metadata, and helpers.
- Deterministic JSON/Markdown generation and append-only compatibility history.

## Does not own

- Desktop handlers, transports, IPC, permissions, grants, principals, or runtime
  availability state.
- Plugin manifests, concrete Plugins, Plugin-owned Skills, or publication policy.
- A second copy of prose API documentation.

## Admission gate

- A concrete Plugin task may propose a missing Host API but must not edit this
  package. Only a separate human-approved Host task may add a Catalog release.
- Every approved API starts as a generic Catalog definition with audience, grant,
  scope, side effect, explicit `completion`, stable errors, and falsifiable
  conformance tests plus one schema descriptor entry. Concrete Plugin ids, vendors,
  models, and one-off payloads are rejection conditions.
- Generated JSON, Markdown, and Skill references are outputs; never patch them to
  simulate an API before the typed Catalog source is approved.

`src/catalog.ts` is the editable semantic metadata/prose source;
`src/method-schemas.ts` is the sole editable payload-contract source. The latter
must derive the public TypeScript map, runtime validation, full nested JSON
contracts, byte limits, docs and history digest. A semantic change to the generic
interpreter requires a schema-dialect bump. Never hand-edit
`generated/plugin-api.json`, `generated/plugin-api.md`, or a history snapshot. Add
APIs and their schema entries in one release, run `bun history:append`, and then run
`bun generate`.

Consumers must import `PLUGIN_API_CATALOG_ARTIFACT_SCHEMA` from the root package and
parse untrusted generated JSON with
`parsePluginApiCatalogArtifact` from `@convax/plugin-api/generator`; copying the
artifact schema token or maintaining a consumer-side validator is forbidden.

Append an empty release block when a patch documentation edit or a major change
needs to advance the catalog version without introducing an API. API `since` still
comes only from the non-empty release block that first introduced that id.

Catalog compatibility is intentionally conservative. Removing an API or changing an
existing audience, grant, scope, side-effect classification, completion semantics,
errors, schema dialect, nested request/result schema, refinement, or byte budget
requires a major version. Adding an API requires a minor or major version.
Documentation-only edits require at least a patch version.

This package must remain free of dependencies on other Convax packages and browser,
Electron, filesystem, network, or ambient host state in its root runtime export.
Node filesystem access is isolated to the `./generator` export and CLI.

Run `bun typecheck && bun test && bun run pack:check`.
