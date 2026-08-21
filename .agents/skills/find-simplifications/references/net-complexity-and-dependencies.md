# Net complexity and dependency substitution

Judge a simplification by the owned surface removed, not by line count alone.

## Net complexity

Use this comparison:

```text
implementation
+ dedicated tests
+ documentation and generated inputs
+ public API, config, event, package, and maintenance surface
- glue, adapters, tests, docs, migrations, and residual semantics that remain
```

A candidate is strong when the result has one clearer owner, fewer independently changing representations or lifecycle paths, and less code that Convax must test and explain. Moving code into a wrapper, generic helper bucket, Desktop, or a new package does not count as deletion when the same semantics remain.

Include operational costs: release ordering, package exports, platform variants, migrations, recovery, security review, generated catalogs, and cross-repository compatibility. Include the capability given up and the conditions under which it would need to return.

## Dependency substitution

Prefer a Bun/Node builtin at the repository's supported engine floor when it covers the contract. Otherwise evaluate a maintained package against:

- **coverage:** exact owned implementation and dedicated tests it replaces;
- **residual semantics:** validation, security policy, ordering, cancellation, recovery, or portability still owned by Convax;
- **health:** maintenance activity, adoption, issue posture, release cadence, and bus factor;
- **supply chain:** transitive packages, install scripts, native binaries, provenance, advisories, update ownership, and lockfile impact;
- **runtime fit:** browser, Electron Main, preload, renderer, Bun/Node, packaging, ESM/CJS, target platform, and bundle behavior;
- **public fit:** error and edge-case semantics match the existing contract without a large compatibility adapter.

A dependency that adds capability is a feature decision. A dependency that replaces 100 lines but requires 120 lines of translation, guards, and compatibility glue is not a simplification.

Do not collapse a recorded design twin, public package, or security-sensitive implementation merely because a dependency offers a similar API. The proposal must beat the current owner rationale and prove any external or persisted compatibility impact.

## Evidence for a proposed swap

Record the current implementation paths, exact candidate version, removed files or symbols, remaining wrapper behavior, dependency and transitive footprint, health evidence, platform/build impact, and tests that compare the real residual contract. Keep remote health claims time-bound and source-backed when internet research is used.
