# Plugin API Package Contract

`@convax/plugin-api` is the headless, independently publishable source of truth for
the Convax Host API catalog.

## Owns

- Stable Host API ids and their structured contract/documentation metadata.
- Runtime-neutral connection presentation APIs such as `host.locale.get`; the
  Catalog owns their portable shape, not the Desktop preference or event delivery.
- The schema-first `src/method-schemas.ts` descriptor: stable method ids, complete
  nested request/result schemas, semantic refinements, per-direction byte budgets,
  and the versioned schema dialect.
- TypeScript request/result maps and aliases, the generic strict runtime schema
  interpreter, full machine-readable contracts, and deterministic human/Skill
  references derived from that descriptor. Do not hand-declare a parallel payload
  type or add an API-id switch to the parser.
- Catalog release grouping, automatic immutable `since` attribution, and explicit
  `contractSince` attribution for the release that owns the current contract digest.
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

Every value-affecting limit must be data in the portable wire schema. This includes
cross-field limits such as numeric products: serialize the referenced fields and
maximum so the contract digest and compatibility check change with the limit. An
opaque API-specific refinement whose meaning depends on an interpreter constant is
forbidden because it permits runtime semantics to change without changing the
published contract bytes.

The current runtime and generated Catalog have exactly one wire-schema dialect.
Committed history is append-only even before npm publication: a breaking cutover
advances the API major and adds a current snapshot instead of rewriting an earlier
candidate. Retired artifacts may remain only as raw digest-bound audit evidence in
`history/ledger.json`; neither the Host runtime nor the current Catalog parser may
interpret their wire dialect. Changing the current dialect or artifact schema
requires the normal major-version path with interpreter, compatibility, generation,
and hostile-input tests.

The ledger is an in-repository corruption and review guard, not an external trust
root: it can be edited by the same authority as the archived bytes. Tests must pin
every known retired receipt and reject its deletion, token substitution, byte drift,
and opaque contract-digest drift. Protected branch review must reject modification
or deletion of an existing history artifact or receipt. Published npm and immutable
Release bytes, their adjacent public-Rekor Sigstore bundles, and independent
immutable-Release verification remain the external provenance boundary. Publication
must bind the immutable GitHub repository and owner ids plus exact workflow name,
ref, repository, source SHA and trigger; never weaken SCT or transparency-log
verification for a private repository.

Consumers must import `PLUGIN_API_CATALOG_ARTIFACT_SCHEMA` from the root package and
parse untrusted generated JSON with
`parsePluginApiCatalogArtifact` from `@convax/plugin-api/generator`; copying the
artifact schema token or maintaining a consumer-side validator is forbidden.

Append an empty release block when a patch documentation edit or a major change
needs to advance the catalog version without introducing an API. API `since` still
comes only from the non-empty release block that first introduced that id.
Every definition names a strict-SemVer `contractSince` release block. A new API has
`since === contractSince === current Catalog version`. Changing a wire contract
digest advances `contractSince` to the current version; an unchanged digest must
preserve it. Availability compares the connected Host version against
`contractSince`, while generated docs expose both identity lineage and current
contract availability.

Catalog compatibility is intentionally conservative. Removing an API or changing an
existing audience, grant, scope, side-effect classification, completion semantics,
errors, schema dialect, nested request/result schema, refinement, or byte budget
requires a major version. Adding an API requires a minor or major version.
Documentation-only edits require at least a patch version.

This package must remain free of dependencies on other Convax packages and browser,
Electron, filesystem, network, or ambient host state in its root runtime export.
Node filesystem access is isolated to the `./generator` export and CLI.

Run `bun typecheck && bun test && bun run pack:check`.
