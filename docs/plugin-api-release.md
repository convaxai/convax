# Plugin API publication and evidence

`@convax/plugin-api` is a public trust boundary. Its npm package, generated Catalog,
Host implementation and protected Plugin-governance receipt must identify the same
contract bytes. A successful local build or an Actions artifact is not publication
evidence.

## Why initial publication is separate

npm staged publishing requires the package to exist before `npm stage publish` can
accept a candidate. The initial public `@convax/plugin-api@2.0.0` package does not satisfy
that prerequisite, and a trusted publisher cannot be configured for a package that
does not yet exist. The bootstrap therefore has one deliberately narrower exception:
Actions prepares and signs exact bytes through public Rekor, but an independent npm
maintainer publishes that exact tarball interactively with 2FA.

This is not a permanent direct-publish path. After the package exists, all automated
candidates use stage-only npm publishing followed by human 2FA approval.

## History is evidence, not a compatibility runtime

The current `2.0.0` package admits only `convax.plugin-api-catalog/3` and
`convax.plugin-api-wire-schema/3`. The original `history/1.0.0.json` remains
byte-for-byte `catalog/2` plus `wire-schema/2`, bound by
`history/ledger.json`; it is never passed to the current Catalog or wire-schema
interpreter. The history verifier checks its bounded identity tokens, whole-file
SHA-256 and each contract digest over opaque `{ dialect, request, result }` JSON.

The ledger lives in the same repository and is therefore not an external trust
root. Package tests pin the known `1.0.0` receipt and reject deletion or mutation,
while protected review must permit only additive history changes. Public-Rekor
Sigstore bundles and the independently verified immutable GitHub Release are the
external publication evidence.

## Protected workflows

All three workflows must be dispatched from the exact head of protected
`main`. They have no commit input: `COMMIT` is always the run's
`GITHUB_SHA`, eliminating an otherwise meaningless second source of identity. Their
unprivileged build/verification jobs check out that exact SHA with persisted
credentials disabled. Privileged signing, npm-stage, and Release jobs never check
out or execute repository code: they consume only the exact checksummed artifact
produced by the unprivileged job. Every job also binds the immutable GitHub
repository id `1322708874` and owner id `312877127`; a repository-name takeover is
not accepted. The workflows reject a package version that differs from
`packages/plugin-api/package.json`, any Catalog schema other than
`convax.plugin-api-catalog/3`, and any non-stable SemVer.

The privileged jobs use GitHub OIDC with pinned Cosign `v3.0.6`. Every artifact gets
an adjacent `.sigstore.json` bundle with media type
`application/vnd.dev.sigstore.bundle.v0.3+json`. Verification requires the exact
workflow name, workflow file identity, protected ref, repository, source SHA,
`workflow_dispatch` trigger, GitHub OIDC issuer, one public Rekor entry, a signed
entry timestamp and an inclusion proof. SCT or transparency-log bypass flags are
not admitted. This works for the private source repository without GitHub Artifact
Attestations or a paid protected Environment.

Public Rekor is a deliberate disclosure boundary. Repository/workflow identity,
protected ref, source SHA, artifact digest and signing time become permanently
public even though the source repository and GitHub Release are private. Artifact
names and certificate identity must never contain source, credentials, customer
identifiers or private paths.

### 1. Initial bootstrap preparation

Run `plugin-api-bootstrap.yml` from the exact protected `main` head with
version `2.0.0`. It fails if `@convax/plugin-api` already exists. It runs:

- package typecheck, tests, compatibility verification, generated-output check and
  real external-consumer pack check;
- the Desktop Host API adapter/service, Plugin asset protocol/CSP and
  connected-media runtime conformance tests; and
- exact tarball/Catalog identity, size, SHA-256 and SHA-512 checks.

The workflow signs the tarball, standalone Catalog, conformance record and both
checksum files, immediately verifies every bundle against public Rekor, and uploads
the exact artifacts plus adjacent bundles. It never calls `npm publish`.

An independent maintainer must download the signed-evidence artifact, install
Cosign `v3.0.6`, verify every adjacent bundle and checksum, and publish the exact
tarball with interactive 2FA:

```sh
commit=<exact-40-character-bootstrap-commit>
identity=https://github.com/convaxai/convax/.github/workflows/plugin-api-bootstrap.yml@refs/heads/main
for artifact in \
  convax-plugin-api-2.0.0.tgz \
  plugin-api.json \
  runtime-conformance.json \
  SHA256SUMS \
  SHA512SUMS; do
  jq -e '
    .mediaType == "application/vnd.dev.sigstore.bundle.v0.3+json" and
    (.verificationMaterial.certificate.rawBytes | length > 0) and
    (.verificationMaterial.tlogEntries | length == 1) and
    (.verificationMaterial.tlogEntries[0].inclusionPromise.signedEntryTimestamp | length > 0) and
    (.verificationMaterial.tlogEntries[0].inclusionProof.rootHash | length > 0)
  ' "$artifact.sigstore.json" >/dev/null
  cosign verify-blob \
    --bundle "$artifact.sigstore.json" \
    --certificate-identity "$identity" \
    --certificate-oidc-issuer https://token.actions.githubusercontent.com \
    --certificate-github-workflow-name "Prepare Plugin API bootstrap" \
    --certificate-github-workflow-ref refs/heads/main \
    --certificate-github-workflow-repository convaxai/convax \
    --certificate-github-workflow-sha "$commit" \
    --certificate-github-workflow-trigger workflow_dispatch \
    "$artifact"
done
jq -e '
  .host.repository == "convaxai/convax" and
  .host.repositoryId == "1322708874" and
  .host.repositoryOwnerId == "312877127"
' runtime-conformance.json >/dev/null
sha256sum --check SHA256SUMS
sha512sum --check SHA512SUMS
NPM_CONFIG_PROVENANCE=false npm publish ./convax-plugin-api-2.0.0.tgz \
  --access public \
  --registry=https://registry.npmjs.org
```

Do not rebuild locally before publishing. Repacking produces a different byte
identity even when its extracted files look equivalent.

### 2. Later npm staged publication

After `2.0.0` exists, configure npm staged publishing for:

- repository: `convaxai/convax`;
- workflow: `plugin-api-npm-stage.yml`;
- permission: stage publishing only, not direct publishing.

Keep npm package access at “require 2FA and disallow tokens.” Run the workflow for a
new stable version. It refuses version reuse, reruns the same package and Host
runtime checks, signs and verifies every exact artifact through public Rekor, and
invokes `npm stage publish --provenance=false`. A maintainer must compare the staged
tarball to the signed candidate, inspect it, and approve that staged package with
2FA before it becomes public. The private repository does not claim native npm
provenance; the Sigstore bundles are the source-build identity evidence.

### 3. Registry-backed immutable Host evidence

Only after npm exposes the exact version, enable immutable Releases for
`convaxai/convax`, set the repository Actions variable
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
4. emits `runtime-conformance.json` bound to repository name and immutable ids,
   commit, protected workflow, Catalog SHA-256, tarball SHA-256 and SHA-512;
5. signs the exact npm tarball, `plugin-api.json`, runtime evidence and checksums
   through public Rekor and publishes every artifact plus its adjacent bundle in tag
   `plugin-api-v<version>-<commit>`; and
6. redownloads the complete Release, compares every artifact and bundle byte for
   byte, re-verifies each Sigstore bundle, then requires `gh release verify` and
   `gh release verify-asset` for every artifact and every bundle.

This immutable Host Release is the input to the separate protected decision workflow
in `convax-plugins`. It does not itself approve a Plugin capability request.

## Runtime conformance evidence schema

`runtime-conformance.json` has the fixed schema
`convax.plugin-api-runtime-conformance/1` and profile
`convax.plugin-api-host-runtime/1`. A consumer must reject unknown fields, a
non-exact schema/profile, wrong repository or immutable repository/owner ids,
non-full commit, a final receipt whose workflow ref is not the protected
`plugin-api-release.yml`, non-positive decimal string run identity, a package other
than `@convax/plugin-api`, a non-`/3` Catalog, a version mismatch, malformed
SHA-256/SHA-512 values, duplicate check ids, or any check whose status is not
`passed`.

The `sigstore` object is also exact: bundle media type and suffix, GitHub workflow
certificate identity, OIDC issuer, workflow name, protected ref, repository, source
SHA, trigger, and mandatory transparency-log inclusion. It describes the
verification policy used for every adjacent bundle; it is not a claim that merely
embedding the object signed anything.

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

- protect `main`;
- restrict manual dispatch of publication workflows and require independent review
  for the initial npm publication;
- after bootstrap, configure stage-only npm publishing, require human 2FA approval,
  and disallow traditional npm tokens;
- enable immutable GitHub Releases before running the release workflow, set
  `CONVAX_IMMUTABLE_RELEASES_ENABLED=true`, and provide the
  repository or organization secret `IMMUTABLE_RELEASES_READ_TOKEN`, limited to
  Administration read access, so the workflow can verify the real repository
  setting; and
- configure the independent protected `convax-plugins` governance decision and
  required protected-base check.

Missing npm approval, a reused version, non-`/3` Catalog, changed registry bytes,
failed conformance, a commit other than the protected dispatch SHA, a conflicting
release tag, missing public-Rekor inclusion, wrong OIDC certificate constraints,
missing immutable Release verification, or unavailable network evidence all fail
closed. An existing immutable Release is accepted only when its tag target, complete
asset-name set, artifact and bundle bytes, Sigstore verification, Release
verification, and asset verification all exactly match the requested npm-backed
evidence.
