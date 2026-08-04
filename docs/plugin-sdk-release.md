# Plugin SDK publication and Sigstore provenance

`@convax/plugin-sdk` is an authoring ABI package. Its publication proves package
bytes and their tested `@convax/plugin-api` dependency; it does not prove that a
Host implements a capability. Capability approval remains bound to the Plugin API
Catalog and a Host runtime conformance receipt.

## Evidence split

- `convax.plugin-api-runtime-conformance/1` proves that one Host commit implements
  one exact Plugin API Catalog.
- `convax.host-package-release/1` with profile
  `convax.plugin-sdk-authoring-package/1` proves one SDK npm tarball and the exact
  Plugin API tarball/Catalog tested with it. It grants no Host capability.

The chain is:

```text
Host runtime receipt -> exact Plugin API Catalog and Host commit
Host package release -> exact SDK npm tarball and release-time Plugin API identity
Plugin frozen lock   -> exact SDK and Plugin API tarballs actually installed
Plugin Sigstore proof -> frozen-lock digest, source package and emitted bundle bytes
```

No link may be inferred from a version string alone. The SDK's release-time Plugin
API version is a tested baseline; a Plugin build must attest the exact version in
its own frozen lock.

## Why this repository does not use GitHub or npm native provenance

The source repository is private. GitHub artifact attestations for private
repositories require a GitHub Enterprise Cloud entitlement, and GitHub's private
Sigstore instance does not publish to a transparency log. That makes entitlement
and repository settings hidden prerequisites for an otherwise portable verifier.
The SDK workflows therefore do not request `attestations: write` and do not call
`actions/attest`.

npm trusted publishing supports a private GitHub repository, but npm provenance
does not: npm rejects provenance for a public package when its source repository is
private. `plugin-sdk-npm-stage.yml` consequently fixes
`NPM_CONFIG_PROVENANCE=false` and passes `--provenance=false`. This is an explicit
platform limitation, not a downgrade decided dynamically at runtime.

Every evidence artifact instead receives a Cosign v3 bundle through GitHub Actions
OIDC. The workflow keeps only `id-token: write`, installs
`sigstore/cosign-installer` at the reviewed full commit
`6f9f17788090df1f26f669e9d70d6ae9567deba6`, fixes Cosign to `v3.0.6`, and writes
the signing event to the public Sigstore Rekor log.

Public Rekor is a deliberate disclosure boundary. Repository/workflow identity,
protected ref, source SHA and signing time become permanently public even though
the repository and GitHub Release are private. Do not put source, package contents,
credentials, customer identifiers or private paths in certificate identity or
artifact names.

## Protected publication workflows

All workflows dispatch from the exact head of protected `main`; no workflow
accepts a commit input. The unprivileged `build` or `verify` job checks out
`github.sha` with persisted credentials disabled, installs with
`bun install --frozen-lockfile --ignore-scripts`, runs the complete SDK release
profile, and creates checksummed candidate bytes.

The OIDC-enabled job never checks out source and never runs Bun, Node, Git or a
repository path. It revalidates only the bounded candidate artifact, signs each
admitted file separately, requires a v0.3 Sigstore bundle with a certificate and
one Rekor inclusion promise/proof, and immediately runs `cosign verify-blob` with
all of these exact predicates:

- issuer `https://token.actions.githubusercontent.com`;
- certificate identity
  `https://github.com/convaxai/convax/.github/workflows/<workflow>@refs/heads/main`;
- exact workflow name and ref `refs/heads/main`;
- repository `convaxai/convax`;
- exact 40-character source SHA; and
- trigger `workflow_dispatch`.

The signed `host-package-release.json` additionally fixes the immutable GitHub
repository id `1322708874` and owner id `312877127`. A repository name is routing
data; those ids prevent a deleted-and-recreated namespace from inheriting trust.

All third-party Actions are pinned to full commit SHAs. GitHub Environments and
Environment reviewers are intentionally not trust prerequisites.

### Initial `0.1.0` bootstrap

`plugin-sdk-bootstrap.yml` refuses to run after `@convax/plugin-sdk` exists. It
packs the exact initial tarball, creates public Rekor-backed bundles, and uploads
`plugin-sdk-bootstrap-signed-evidence`; it never publishes to npm.

An independent npm maintainer downloads that signed artifact, substitutes the exact
bootstrap SHA below, and verifies every admitted file:

```sh
for artifact in \
  ./convax-plugin-sdk-0.1.0.tgz \
  ./convax-plugin-api-1.0.0.tgz \
  ./plugin-api.json \
  ./host-package-release.json \
  ./SHA256SUMS \
  ./SHA512SUMS; do
  jq -e '
    .mediaType == "application/vnd.dev.sigstore.bundle.v0.3+json" and
    (.verificationMaterial.tlogEntries | length == 1) and
    (.verificationMaterial.tlogEntries[0].inclusionPromise.signedEntryTimestamp | length > 0) and
    (.verificationMaterial.tlogEntries[0].inclusionProof.rootHash | length > 0)
  ' "$artifact.sigstore.json" >/dev/null
  cosign verify-blob \
    --bundle "$artifact.sigstore.json" \
    --certificate-identity \
      "https://github.com/convaxai/convax/.github/workflows/plugin-sdk-bootstrap.yml@refs/heads/main" \
    --certificate-oidc-issuer "https://token.actions.githubusercontent.com" \
    --certificate-github-workflow-name "Prepare Plugin SDK bootstrap" \
    --certificate-github-workflow-ref refs/heads/main \
    --certificate-github-workflow-repository convaxai/convax \
    --certificate-github-workflow-sha <exact-40-character-bootstrap-commit> \
    --certificate-github-workflow-trigger workflow_dispatch \
    "$artifact"
done
jq -e '
  .host.repository == "convaxai/convax" and
  .host.repositoryId == "1322708874" and
  .host.repositoryOwnerId == "312877127"
' host-package-release.json >/dev/null
sha256sum --check SHA256SUMS
sha512sum --check SHA512SUMS
NPM_CONFIG_PROVENANCE=false npm publish ./convax-plugin-sdk-0.1.0.tgz \
  --access public \
  --registry=https://registry.npmjs.org
```

This one-time manual bootstrap requires interactive npm 2FA. Repacking is
forbidden because it changes the npm byte identity.

### Later npm staging

After the package exists, `plugin-sdk-npm-stage.yml` requires an unused stable
version, signs the exact candidate, uploads
`plugin-sdk-npm-stage-signed-evidence`, and invokes only `npm stage publish`.

Configure the npm trusted publisher with:

- repository `convaxai/convax`;
- workflow `plugin-sdk-npm-stage.yml`;
- no GitHub Environment binding; and
- stage-only permission, never direct publish permission.

The trusted publisher submits a candidate only. A human maintainer must review the
downloaded bundles, checksums and staged package diff, then approve the staged npm
version with npm 2FA. Automation must never approve the stage or hold a reusable
npm publishing token.

### Final Host package evidence

After npm exposes the approved version, `plugin-sdk-release.yml`:

1. downloads the exact npm SDK and Plugin API tarballs and verifies their registry
   SHA-512 SRI values;
2. deterministically repacks the SDK from the protected Host commit and requires
   byte equality with the npm tarball;
3. requires the SDK's only Convax dependency to be
   `@convax/plugin-api@^<release-time-version>`;
4. requires the Plugin API tarball's embedded `/3` Catalog to equal the Host
   Catalog byte for byte;
5. signs each tarball, Catalog, release manifest and checksum file independently;
   and
6. publishes the files and adjacent `.sigstore.json` bundles under
   `plugin-sdk-v<version>-<commit>`.

The GitHub Release is an immutable distribution layer, not the sole provenance
authority. The workflow requires both the operator guard and the repository's real
immutable-Release API setting, then requires `gh release verify` and
`gh release verify-asset`. After creating a Release it downloads every asset again,
compares it byte for byte, re-verifies every Sigstore bundle and checks the tag SHA.
An existing tag is accepted only under the same checks. Trust therefore combines
npm's immutable package version, immutable Release assets, signed byte identities
and public Rekor inclusion; private-artifact-attestation entitlement and
Environment reviewers are still not assumed.

## Closed Host package release schema

`host-package-release.json` is generated and consumed as a closed object. It
contains:

- repository name, immutable repository/owner ids and full source commit;
- protected workflow identity, ref, run id and attempt;
- exact Sigstore bundle format/suffix, OIDC issuer, certificate policy and required
  transparency-log inclusion;
- SDK name/version, SHA-256 and npm SHA-512 SRI;
- one Plugin API dependency with declared range, resolved version, tarball
  SHA-256/SRI and Catalog schema/version/SHA-256; and
- the complete ordered release conformance profile, all passed.

Unknown, missing or duplicate semantics fail closed. The bundle suffix is declared
rather than a bundle digest because `host-package-release.json` is itself signed;
embedding its future bundle digest would create a circular artifact.

## Consumer verification contract

A consumer must never treat the GitHub Release, tag, version string or a successful
checksum alone as provenance. It must:

1. require the exact closed asset set and one adjacent bundle per artifact;
2. reject an unknown bundle media type, missing certificate, missing/extra Rekor
   entry, missing inclusion promise/proof or an oversized bundle;
3. run `cosign verify-blob --bundle` without any insecure, offline or
   private-infrastructure bypass and with every exact certificate predicate listed
   above;
4. verify the signed manifest's repository and owner ids, source SHA, workflow
   policy, package identities, dependency identities and complete passed-check list;
5. verify `SHA256SUMS`, npm SRI, tarball manifests and embedded Catalog equality; and
6. reject version reuse, byte drift, a non-`/3` Catalog, an unprotected workflow
   ref, unavailable Rekor evidence or any policy field it does not understand.

Cosign's successful default online verification is the transparency-log
verification. Merely inspecting `inclusionProof` JSON is not a cryptographic
substitute.

## Required `convax-plugins` migration contract

Before a `convax.plugin/8` bundle is published, `convax-plugins` must independently:

1. install from a committed frozen lockfile without lifecycle scripts and reject
   Git/file/workspace dependency sources for `@convax/plugin-sdk` and
   `@convax/plugin-api`;
2. record and verify the actual locked package names, versions, npm URLs, SRI values
   and tarball SHA-256 digests against Host Sigstore evidence;
3. require the actual locked Plugin API version to satisfy the SDK tarball's
   declared range;
4. produce a closed canonical frozen-lock statement binding lockfile, package
   manifest, build entrypoint and output bundle digests;
5. build in an unprivileged job and use a code-free OIDC signing/publishing job that
   revalidates only bounded checksummed artifacts;
6. issue and consume public Rekor-backed Sigstore bundles with exact repository,
   workflow, ref and source-SHA policy; and
7. keep Host capability governance independent from SDK package provenance.

Until that gate exists, an SDK npm version or Host Release is insufficient
provenance for a concrete Plugin bundle.

## Required external controls

Repository files cannot establish branch protection, immutable-Release settings,
npm trusted-publisher scope, maintainer independence or human npm 2FA. Protect
`main`, prevent unreviewed workflow changes, enable immutable Releases and
set `CONVAX_IMMUTABLE_RELEASES_ENABLED=true` only after the API reports them
enabled, keep GitHub-hosted runners for npm trusted publishing, configure only the
stage-only publisher above, and require a human to approve every npm stage.

The fixed repository/owner ids must be re-reviewed only during an intentional
repository transfer. A transfer or loss of public Rekor availability is a release
stop, not a reason to relax verification.
