# Plugin SDK publication and bundle provenance

`@convax/plugin-sdk` is an authoring ABI package, not evidence that a Convax Host
implements any particular capability. Its publication chain therefore produces an
independent Host package release manifest. Capability approval continues to use the
Plugin API Catalog and Host runtime conformance receipt.

## Evidence split

The two evidence families answer different questions:

- `convax.plugin-api-runtime-conformance/1` proves that one Host commit implements
  one exact Plugin API Catalog. A protected capability decision may consume it.
- `convax.host-package-release/1` with profile
  `convax.plugin-sdk-authoring-package/1` proves the npm byte identity of one SDK
  release and the exact Plugin API package/Catalog identity tested when that SDK was
  released. It grants no Host capability and is not a capability decision receipt.

Binding a capability receipt directly to the SDK would be unsound. The SDK declares
a compatible Plugin API range, while a Plugin build can resolve a different exact
version inside that range. An SDK-bound receipt would neither prove the Plugin's
actual dependency closure nor remain stable across compatible SDK-only releases.

The final provenance chain is:

```text
Host runtime receipt -> exact Plugin API Catalog and Host commit
Host package release -> exact SDK npm tarball and release-time Plugin API identity
Plugin frozen lock   -> exact SDK and Plugin API tarballs actually installed
Plugin attestation   -> frozen-lock digest, source package and emitted bundle bytes
```

No link may be inferred from a version string alone.

## Protected publication workflows

All workflows dispatch from the exact head of protected `convax-next`. They have no
commit input: the source commit is always `github.sha`.

The unprivileged `build` or `verify` job checks out that commit with persisted
credentials disabled, installs with `bun install --frozen-lockfile
--ignore-scripts`, builds the Plugin API release dependency before the SDK
declarations, runs the exact SDK release conformance profile, and creates the
candidate evidence. The environment-gated privileged job never checks out source,
never invokes Bun/Node/Git or a repository path, and consumes only checksummed
artifacts from the unprivileged job. All third-party Actions are pinned to full
commit SHAs.

### Initial `0.1.0` bootstrap

`plugin-sdk-bootstrap.yml` refuses to run after `@convax/plugin-sdk` exists. It
packs and attests the exact initial tarball but does not publish. An independent npm
maintainer verifies the GitHub attestation and checksums, then publishes that exact
tarball with interactive 2FA:

```sh
for artifact in \
  ./convax-plugin-sdk-0.1.0.tgz \
  ./convax-plugin-api-1.0.0.tgz \
  ./plugin-api.json \
  ./host-package-release.json \
  ./SHA256SUMS \
  ./SHA512SUMS; do
  gh attestation verify "$artifact" \
    --repo microvoid/convax \
    --signer-workflow microvoid/convax/.github/workflows/plugin-sdk-bootstrap.yml \
    --source-ref refs/heads/convax-next \
    --source-digest <exact-40-character-bootstrap-commit> \
    --deny-self-hosted-runners
done
sha256sum --check SHA256SUMS
sha512sum --check SHA512SUMS
npm publish ./convax-plugin-sdk-0.1.0.tgz \
  --access public \
  --registry=https://registry.npmjs.org
```

Repacking is forbidden because it changes the npm byte identity.

### Later npm staging

After the package exists, `plugin-sdk-npm-stage.yml` requires a new stable version,
attests the exact candidate, and submits only that tarball through npm staged
publishing. The npm trusted publisher must be scoped to:

- repository `microvoid/convax`;
- workflow `plugin-sdk-npm-stage.yml`;
- environment `plugin-sdk-npm-stage`; and
- stage publication only.

A maintainer reviews and approves the staged package with 2FA.

### Immutable Host package evidence

After npm exposes the version, `plugin-sdk-release.yml` downloads the exact npm SDK
tarball and the release-time Plugin API tarball, verifies both registry SHA-512 SRI
values, deterministically repacks the SDK from the protected Host commit, requires
that source package to be byte-identical to the npm tarball, and checks that:

- the packed SDK identity is `@convax/plugin-sdk@<version>`;
- its sole Convax dependency is the packed `@convax/plugin-api` range
  `^<release-time-api-version>` with no `workspace:` or `catalog:` placeholder;
- the Plugin API tarball identity matches that version; and
- its embedded `/3` Catalog is byte-identical to the Catalog at the Host commit.

The source-pack equality is mandatory: passing current-source tests beside a
different npm tarball would create false provenance even when both package manifests
declare the same name, version, and Plugin API range.

It emits `host-package-release.json`, attests the complete evidence set, publishes
it under `plugin-sdk-v<version>-<commit>`, and requires GitHub Release and asset
verification to succeed after the Release becomes immutable. The immutable assets
are the exact SDK and Plugin API tarballs, `plugin-api.json`,
`host-package-release.json`, and `SHA256SUMS`.

## Host package release schema

`host-package-release.json` is closed by the generator and policy tests. It includes:

- exact repository, full commit, protected workflow ref, run id and attempt;
- SDK package name/version, SHA-256 and npm SHA-512 SRI;
- one Plugin API dependency with declared range, release-time resolved version,
  tarball SHA-256/SRI and Catalog schema/version/SHA-256; and
- the complete ordered SDK conformance check profile, all passed.

The release-time resolved Plugin API version is a tested baseline, not a claim about
what a later Plugin build resolved. The Plugin bundle must attest its actual lock.

## Required `convax-plugins` migration contract

This repository does not write the sibling repository. Before any
`convax.plugin/8` bundle is published, `convax-plugins` must implement a protected
release gate with all of the following:

1. Use a frozen, repository-committed lockfile. The release job must fail on lock
   mutation, lifecycle-script execution during dependency installation, a registry
   other than the admitted npm registry, or any Git/file/workspace dependency for
   `@convax/plugin-sdk` or `@convax/plugin-api`.
2. Record the actual locked SDK and Plugin API package names, versions, registry
   URLs, npm SHA-512 SRI values and SHA-256 tarball digests. Verify the SDK tarball
   against one immutable `plugin-sdk-v<version>-<commit>` Host Release and verify the
   actual Plugin API tarball/Catalog against its immutable Plugin API Host evidence.
3. Require the actual locked Plugin API version to satisfy the SDK tarball's
   declared range. Do not substitute the SDK release-time baseline for the actual
   lock identity.
4. Generate a canonical frozen-lock statement with a schema version, Host Release
   identities, dependency identities, lockfile SHA-256, Plugin package-manifest
   SHA-256, build entrypoint identity and output bundle SHA-256. Unknown or duplicate
   fields and dependencies fail closed.
5. Build in an unprivileged job. A separate environment-gated attestation/publish
   job must not check out or execute repository code; it may consume only the exact
   checksummed bundle, frozen-lock statement and review receipts produced upstream.
6. Attest the bundle, frozen-lock statement and checksums together. Publishing must
   re-verify those exact bytes and must reject version reuse.
7. Keep capability governance independent. Every required new Host API still needs
   its protected decision receipt bound to the exact Catalog contract digest and
   Host runtime evidence; the SDK Host package release is never accepted as that
   receipt.

Until this gate exists, an SDK npm version or Host Release is insufficient provenance
for a concrete Plugin bundle.

## Required external configuration

Repository files cannot establish branch protection, Environment reviewers,
self-review prevention, administrator-bypass policy, npm trusted publishing,
interactive bootstrap review, immutable GitHub Releases, or private-repository
attestation availability. Configure `plugin-sdk-bootstrap`,
`plugin-sdk-npm-stage`, and `plugin-sdk-release` Environments with protected
`convax-next` deployment rules and independent reviewers. Reuse the acknowledged
`CONVAX_PRIVATE_ATTESTATIONS_ENABLED`,
`CONVAX_PRIVATE_NPM_PUBLISHING_ENABLED`, and
`CONVAX_IMMUTABLE_RELEASES_ENABLED` guards only after the corresponding platform
controls are actually enabled.

Missing npm bytes, dependency drift, a non-`/3` Catalog, a mutable/unverified
Release, a reused version, an unprotected workflow ref, or unavailable network
evidence fails closed.
