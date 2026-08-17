# Evidence and consumer classification

Classify consumers before proposing removal. Match labels to evidence, not directory names alone.

## Production

Production consumers include:

- `packages/*/src` and `apps/*/src` runtime code;
- public exports and package entrypoints;
- Electron Main, preload, renderer, IPC, protocol, worker, process, and packaged-resource paths;
- build, packaging, release, migration, recovery, and runtime scripts;
- Plugin API/SDK catalogs, manifests, generated validators, Marketplace artifacts, product locks, and dynamic registrations;
- external or published consumers established by package policy or the sibling Plugin repository.

A production caller usually converts a cleanup into a behavior or compatibility decision. Continue only when the caller itself is proven obsolete and enters the same closure.

## Non-production

Non-production consumers include focused unit tests, fixtures, snapshots, comments, plans, review evidence, and documentation that do not enter a shipped or required validation path. They may reveal why a surface exists. Read them before deciding whether they should be deleted, rewritten around the owner, or retained as negative coverage.

## Ambiguous or dynamic

Treat these as ambiguous until inspected:

- examples and smoke scripts that may be product acceptance paths;
- string-dispatched methods, tools, events, IPC channels, config keys, or manifest contributions;
- generated artifacts whose source lives elsewhere;
- package exports with external consumers;
- runtime registration, lazy loading, reflection, glob discovery, and target-specific packaging;
- persisted or wire fields read only during recovery, migration, downgrade rejection, or cross-version operation.

An ambiguous consumer blocks deletion until evidence resolves it. Silence from one static analyzer does not resolve dynamic or external reachability.

## Search procedure

Start with `rg` and search each relevant spelling:

1. exact symbol and type name;
2. method calls as both `.method(` and `method(`;
3. event, IPC, wire, schema, manifest, config, and package string;
4. export subpath and import specifier;
5. filename, generated input, and registration key;
6. semantic aliases or legacy names recorded in architecture and tests.

Read definitions and call sites. Then inspect package manifests, public `exports`, generators, registries, loaders, and sibling-repository contracts when applicable. Search against the merge base as well as the worktree so a new branch-local consumer is not missed.

Knip, TypeScript diagnostics, coverage, duplication scanners, and IDE references are candidate generators only. They can miss dynamic consumers and can flag intentional public APIs; they can also expose code that tests keep alive. Record their output as a lead, then close the candidate with owner and caller evidence.

## Minimum candidate record

Use a compact table or prose record containing:

| Field             | Required evidence                                                   |
| ----------------- | ------------------------------------------------------------------- |
| Candidate         | Exact symbol, behavior, representation, or lifecycle                |
| Owner             | Package or contributor-workflow owner and canonical source          |
| Production        | Callers, registrations, persisted/wire readers, or explicit none    |
| Non-production    | Tests, docs, fixtures, and what obligation they express             |
| Ambiguous/dynamic | External, generated, string-dispatched, platform, or recovery paths |
| Decision          | Eligible, defer, or reject                                          |
| Falsifier         | Evidence that would reverse the decision                            |

Do not write “unused” when the result is merely “no static TypeScript reference found.”
