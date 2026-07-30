# Plugin API publication and evidence

`@convax/plugin-api` is a public trust boundary. Its npm package, generated Catalog,
Host implementation and protected Plugin-governance receipt must identify the same
contract bytes. A successful local build or an Actions artifact is not publication
evidence.

## Why initial publication is separate

npm staged publishing requires the package to exist before `npm stage publish` can
accept a candidate. The initial `@convax/plugin-api@1.0.0` package does not satisfy
that prerequisite, and a trusted publisher cannot be configured for a package that
does not yet exist. The bootstrap therefore has one deliberately narrower exception:
Actions prepares and attests exact bytes, but an independent npm maintainer publishes
that exact tarball interactively with 2FA.

This is not a permanent direct-publish path. After the package exists, all automated
candidates use the stage-only trusted publisher.

## Protected workflows

All three workflows must be dispatched from the exact head of protected
`convax-next`. They have no commit input: `COMMIT` is always the run's
`GITHUB_SHA`, eliminating an otherwise meaningless second source of identity. Their
unprivileged build/verification jobs check out that exact SHA with persisted
credentials disabled. Privileged attestation, npm-stage, and Release jobs never
check out or execute repository code: they consume only the exact checksummed
artifact produced by the unprivileged job. The workflows reject a package version
that differs from `packages/plugin-api/package.json`, any Catalog schema other than
`convax.plugin-api-catalog/3`, and any non-stable SemVer.

### 1. Initial bootstrap preparation

Run `plugin-api-bootstrap.yml` from the exact protected `convax-next` head with
version `1.0.0`. It fails if `@convax/plugin-api` already exists. It runs:

- package typecheck, tests, compatibility verification, generated-output check and
  real external-consumer pack check;
- the Desktop Host API adapter/service, Plugin asset protocol/CSP and
  connected-media runtime conformance tests; and
- exact tarball/Catalog identity, size, SHA-256 and SHA-512 checks.

The workflow attests and uploads the tarball, standalone Catalog, conformance record
and checksum files. It never calls `npm publish`.

An independent maintainer must download that one artifact, verify its GitHub
attestation and checksums, and publish the exact tarball with interactive 2FA:

```sh
gh attestation verify ./convax-plugin-api-1.0.0.tgz \
  --repo microvoid/convax \
  --signer-workflow microvoid/convax/.github/workflows/plugin-api-bootstrap.yml \
  --source-ref refs/heads/convax-next \
  --source-digest <exact-40-character-bootstrap-commit> \
  --deny-self-hosted-runners
sha256sum --check SHA256SUMS
sha512sum --check SHA512SUMS
npm publish ./convax-plugin-api-1.0.0.tgz \
  --access public \
  --registry=https://registry.npmjs.org
```

Do not rebuild locally before publishing. Repacking produces a different byte
identity even when its extracted files look equivalent.

### 2. Later npm staged publication

After `1.0.0` exists, configure the npm trusted publisher for:

- repository: `microvoid/convax`;
- workflow: `plugin-api-npm-stage.yml`;
- environment: `plugin-api-npm-stage`;
- permission: stage publishing only, not direct publishing.

Keep npm package access at “require 2FA and disallow tokens.” Run the workflow for a
new stable version. It refuses version reuse, reruns the same package and Host runtime
checks, attests the exact candidate, and invokes `npm stage publish`. A maintainer
must inspect and approve that staged package with 2FA before it becomes public.

### 3. Registry-backed immutable Host evidence

Only after npm exposes the exact version, enable immutable Releases for
`microvoid/convax`, set the repository Actions variable
`CONVAX_IMMUTABLE_RELEASES_ENABLED=true`, and run `plugin-api-release.yml` with the
current exact protected head whose checked-in package version and Catalog bytes
match the published npm package. The Host commit may advance after npm staging, but
the release workflow re-runs conformance at that newer commit and rejects any
Catalog drift from the published package.

The variable is an operator guard, not proof that the GitHub setting exists. The
workflow proves the final state by publishing a draft Release, making it public, and
requiring `gh release verify` plus `gh release verify-asset` to succeed. If
verification fails and the new Release is still mutable, the workflow removes only
the Release and tag that it created in that run. An actually immutable Release
cannot be deleted by this rollback.

The release workflow:

1. downloads the tarball from `registry.npmjs.org` and verifies npm's SHA-512 SRI;
2. requires the embedded `dist/generated/plugin-api.json` to be byte-identical to
   the Catalog at the exact Host commit;
3. reruns package checks and Host runtime conformance;
4. emits `runtime-conformance.json` bound to repository, commit, protected workflow,
   Catalog SHA-256, tarball SHA-256 and SHA-512; and
5. attests and publishes the exact npm tarball, `plugin-api.json`, runtime evidence
   and checksums in tag `plugin-api-v<version>-<commit>`.

This immutable Host Release is the input to the separate protected decision workflow
in `convax-plugins`. It does not itself approve a Plugin capability request.

## Runtime conformance evidence schema

`runtime-conformance.json` has the fixed schema
`convax.plugin-api-runtime-conformance/1` and profile
`convax.plugin-api-host-runtime/1`. A consumer must reject unknown fields, a
non-exact schema/profile, wrong repository, non-full commit, a final receipt whose
workflow ref is not the protected `plugin-api-release.yml`, non-positive decimal
string run identity, a package other than `@convax/plugin-api`, a non-`/3` Catalog,
a version mismatch, malformed SHA-256/SHA-512 values, duplicate check ids, or any
check whose status is not `passed`.

`pluginApi.contractCoverage` is the API-id-sorted exact list of every
`{ id, contract.digest }` in the Catalog.
`contractCoverageSha256` is SHA-256 over the UTF-8 bytes of compact
`JSON.stringify(contractCoverage)`. Consumers must reconstruct both from the
published Catalog and require exact equality; an old report cannot cover a Catalog
that added or changed an API.

For the current image-input contract, the required Host runtime suite list is:

- `plugin-host-api-service.test.ts`;
- `plugin-host-api-main-adapter.test.ts`;
- `plugin-capability-production.test.ts`;
- `plugin-asset-protocol.test.ts`;
- `plugin-connected-media-service.test.ts`; and
- `plugin-connected-image-inspector.test.ts`.

In particular, `plugin-asset-protocol.test.ts` proves that the opaque connected-image
URL is admitted by the exact iframe CSP projection. Passing the image session service
tests without that CSP test is incomplete evidence. Consumers may admit additional
checks in a future Catalog release, but they must continue to require every check
needed by the capability request they are resolving.

## Required external configuration

Repository files cannot establish these controls:

- protect `convax-next`;
- create `plugin-api-bootstrap`, `plugin-api-npm-stage`, and `plugin-api-release`
  Environments, restrict each to protected `convax-next`, require named reviewers,
  prevent self-review, and disallow administrator bypass;
- restrict manual dispatch of publication workflows and require independent review
  for the initial npm publication;
- after bootstrap, configure the stage-only npm trusted publisher and disallow
  traditional npm tokens;
- enable immutable GitHub Releases before running the release workflow, set
  `CONVAX_IMMUTABLE_RELEASES_ENABLED=true`, and provide the
  `plugin-api-release` Environment with `IMMUTABLE_RELEASES_READ_TOKEN` limited to
  Administration read access so the workflow can verify the real repository setting;
- for a private or internal repository, set
  `CONVAX_PRIVATE_ATTESTATIONS_ENABLED=true` only after confirming the GitHub plan
  supports artifact attestations; for private npm publication also set
  `CONVAX_PRIVATE_NPM_PUBLISHING_ENABLED=true`, which explicitly disables npm public
  provenance because npm trusted publishing does not support private-repository
  provenance; and
- configure the independent `convax-plugins` governance Environment and required
  protected-base check.

Missing npm approval, a reused version, non-`/3` Catalog, changed registry bytes,
failed conformance, a commit other than the protected dispatch SHA, a conflicting
release tag, missing immutable Release verification, or unavailable network evidence
all fail closed. An existing immutable Release is accepted only when its tag target,
complete asset-name set, asset bytes, Release verification, and asset verification
all exactly match the requested npm-backed evidence.
