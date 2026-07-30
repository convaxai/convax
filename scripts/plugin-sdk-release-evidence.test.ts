import { createHash } from "node:crypto"
import { describe, expect, test } from "bun:test"

import { buildPluginSdkReleaseEvidence, pluginSdkReleaseConformanceChecks } from "./plugin-sdk-release-evidence"

const apiCatalogBytes = new TextEncoder().encode(
  `${JSON.stringify({
    schema: "convax.plugin-api-catalog/3",
    version: "1.0.0",
    apis: [{ id: "host.context.get" }],
  })}\n`,
)
const sdkTarballBytes = new TextEncoder().encode("exact Plugin SDK package bytes")
const apiTarballBytes = new TextEncoder().encode("exact Plugin API package bytes")
const sdkIntegrity = `sha512-${createHash("sha512").update(sdkTarballBytes).digest("base64")}`
const apiIntegrity = `sha512-${createHash("sha512").update(apiTarballBytes).digest("base64")}`

function input(overrides: Record<string, unknown> = {}) {
  return {
    apiCatalogBytes,
    apiPackageCatalogBytes: apiCatalogBytes,
    apiPackageJson: { name: "@convax/plugin-api", version: "1.0.0" },
    apiTarballBytes,
    apiTarballIntegrity: apiIntegrity,
    apiVersion: "1.0.0",
    checkResults: {
      schema: "convax.plugin-sdk-check-results/1",
      profile: "convax.plugin-sdk-authoring-package/1",
      checks: pluginSdkReleaseConformanceChecks.map(({ id }) => ({ id, status: "passed" })),
    },
    commit: "a".repeat(40),
    repository: "microvoid/convax",
    repositoryId: "1293264965",
    repositoryOwnerId: "125447777",
    runAttempt: "1",
    runId: "123",
    sdkPackageJson: {
      name: "@convax/plugin-sdk",
      version: "0.1.0",
      dependencies: { "@convax/plugin-api": "^1.0.0" },
    },
    sdkSourceTarballBytes: sdkTarballBytes,
    sdkTarballBytes,
    sdkTarballIntegrity: sdkIntegrity,
    sdkVersion: "0.1.0",
    workflowRef: "microvoid/convax/.github/workflows/plugin-sdk-release.yml@refs/heads/convax-next",
    ...overrides,
  }
}

describe("Plugin SDK Host package release evidence", () => {
  test("binds exact SDK and release-time Plugin API npm identities without becoming a capability receipt", () => {
    expect(buildPluginSdkReleaseEvidence(input())).toEqual({
      schema: "convax.host-package-release/1",
      profile: "convax.plugin-sdk-authoring-package/1",
      host: {
        repository: "microvoid/convax",
        repositoryId: "1293264965",
        repositoryOwnerId: "125447777",
        commit: "a".repeat(40),
      },
      workflow: {
        ref: "microvoid/convax/.github/workflows/plugin-sdk-release.yml@refs/heads/convax-next",
        runId: "123",
        runAttempt: "1",
      },
      sigstore: {
        bundle: {
          mediaType: "application/vnd.dev.sigstore.bundle.v0.3+json",
          suffix: ".sigstore.json",
        },
        certificate: {
          identity:
            "https://github.com/microvoid/convax/.github/workflows/plugin-sdk-release.yml@refs/heads/convax-next",
          oidcIssuer: "https://token.actions.githubusercontent.com",
          workflowName: "Publish Plugin SDK immutable evidence",
          workflowRef: "refs/heads/convax-next",
          repository: "microvoid/convax",
          sourceSha: "a".repeat(40),
          trigger: "workflow_dispatch",
        },
        transparencyLog: {
          inclusionRequired: true,
        },
      },
      package: {
        name: "@convax/plugin-sdk",
        version: "0.1.0",
        tarballSha256: createHash("sha256").update(sdkTarballBytes).digest("hex"),
        tarballIntegrity: sdkIntegrity,
      },
      dependencies: [
        {
          name: "@convax/plugin-api",
          declaredRange: "^1.0.0",
          resolvedVersion: "1.0.0",
          tarballSha256: createHash("sha256").update(apiTarballBytes).digest("hex"),
          tarballIntegrity: apiIntegrity,
          catalogSchema: "convax.plugin-api-catalog/3",
          catalogVersion: "1.0.0",
          catalogSha256: createHash("sha256").update(apiCatalogBytes).digest("hex"),
        },
      ],
      checks: pluginSdkReleaseConformanceChecks.map((check) => ({
        ...check,
        status: "passed",
      })),
    })
  })

  test("rejects workspace ranges, extra dependencies and a different release-time API baseline", () => {
    for (const dependencies of [
      { "@convax/plugin-api": "workspace:^" },
      { "@convax/plugin-api": "^1.1.0" },
      { "@convax/plugin-api": "^1.0.0", "unreviewed-package": "1.0.0" },
    ]) {
      expect(() =>
        buildPluginSdkReleaseEvidence(
          input({
            sdkPackageJson: {
              name: "@convax/plugin-sdk",
              version: "0.1.0",
              dependencies,
            },
          }),
        ),
      ).toThrow()
    }
  })

  test("rejects dependency byte drift, Catalog drift and non-protected workflow authority", () => {
    expect(() => buildPluginSdkReleaseEvidence(input({ apiTarballIntegrity: `sha512-${"A".repeat(88)}` }))).toThrow(
      "Plugin API tarball does not match",
    )
    expect(() =>
      buildPluginSdkReleaseEvidence(input({ apiPackageCatalogBytes: new TextEncoder().encode("{}") })),
    ).toThrow("not byte-identical")
    expect(() =>
      buildPluginSdkReleaseEvidence(
        input({
          workflowRef: "microvoid/convax/.github/workflows/other.yml@refs/heads/convax-next",
        }),
      ),
    ).toThrow("protected Plugin SDK publication workflow")
  })

  test("rejects mutable repository-name reuse through immutable repository identifiers", () => {
    expect(() => buildPluginSdkReleaseEvidence(input({ repositoryId: "1" }))).toThrow("immutable Convax repository id")
    expect(() => buildPluginSdkReleaseEvidence(input({ repositoryOwnerId: "1" }))).toThrow("immutable Convax owner id")
  })

  test("rejects an npm SDK tarball that cannot be reproduced from the Host commit", () => {
    expect(() =>
      buildPluginSdkReleaseEvidence(
        input({
          sdkSourceTarballBytes: new TextEncoder().encode("different source package bytes"),
        }),
      ),
    ).toThrow("not byte-identical to the package reproduced from the Host commit")
  })

  test("rejects incomplete or reordered release checks", () => {
    expect(() =>
      buildPluginSdkReleaseEvidence(
        input({
          checkResults: {
            schema: "convax.plugin-sdk-check-results/1",
            profile: "convax.plugin-sdk-authoring-package/1",
            checks: [{ id: "plugin-sdk-typecheck", status: "passed" }],
          },
        }),
      ),
    ).toThrow("release conformance profile")
  })
})
