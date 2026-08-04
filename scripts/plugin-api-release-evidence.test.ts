import { createHash } from "node:crypto"
import { describe, expect, test } from "bun:test"

import { buildPluginApiReleaseEvidence, pluginApiReleaseConformanceChecks } from "./plugin-api-release-evidence"

const catalogBytes = new TextEncoder().encode(
  `${JSON.stringify({
    schema: "convax.plugin-api-catalog/3",
    version: "2.0.0",
    apis: [
      {
        id: "host.context.get",
        contract: { digest: `sha256:${"1".repeat(64)}` },
      },
    ],
  })}\n`,
)
const tarballBytes = new TextEncoder().encode("exact package bytes")
const npmIntegrity = `sha512-${createHash("sha512").update(tarballBytes).digest("base64")}`

function input(overrides: Record<string, unknown> = {}) {
  return {
    catalogBytes,
    checkResults: {
      schema: "convax.plugin-api-check-results/1",
      profile: "convax.plugin-api-host-runtime/1",
      checks: pluginApiReleaseConformanceChecks.map(({ id }) => ({ id, status: "passed" })),
    },
    commit: "a".repeat(40),
    packageCatalogBytes: catalogBytes,
    packageJson: { name: "@convax/plugin-api", version: "2.0.0" },
    repository: "convaxai/convax",
    repositoryId: "1322708874",
    repositoryOwnerId: "312877127",
    tarballIntegrity: npmIntegrity,
    tarballBytes,
    version: "2.0.0",
    workflowRef: "convaxai/convax/.github/workflows/plugin-api-release.yml@refs/heads/main",
    ...overrides,
  }
}

describe("Plugin API release evidence", () => {
  test("binds one exact Host commit, Catalog and npm tarball", () => {
    expect(buildPluginApiReleaseEvidence(input())).toEqual({
      schema: "convax.plugin-api-runtime-conformance/1",
      profile: "convax.plugin-api-host-runtime/1",
      host: {
        repository: "convaxai/convax",
        repositoryId: "1322708874",
        repositoryOwnerId: "312877127",
        commit: "a".repeat(40),
      },
      workflow: {
        ref: "convaxai/convax/.github/workflows/plugin-api-release.yml@refs/heads/main",
      },
      sigstore: {
        bundle: {
          mediaType: "application/vnd.dev.sigstore.bundle.v0.3+json",
          suffix: ".sigstore.json",
        },
        certificate: {
          identity:
            "https://github.com/convaxai/convax/.github/workflows/plugin-api-release.yml@refs/heads/main",
          oidcIssuer: "https://token.actions.githubusercontent.com",
          workflowName: "Publish Plugin API immutable evidence",
          workflowRef: "refs/heads/main",
          repository: "convaxai/convax",
          sourceSha: "a".repeat(40),
          trigger: "workflow_dispatch",
        },
        transparencyLog: {
          inclusionRequired: true,
        },
      },
      pluginApi: {
        package: "@convax/plugin-api",
        version: "2.0.0",
        catalogSchema: "convax.plugin-api-catalog/3",
        catalogSha256: createHash("sha256").update(catalogBytes).digest("hex"),
        tarballSha256: createHash("sha256").update(tarballBytes).digest("hex"),
        tarballIntegrity: npmIntegrity,
        contractCoverage: [
          {
            id: "host.context.get",
            digest: `sha256:${"1".repeat(64)}`,
          },
        ],
        contractCoverageSha256: createHash("sha256")
          .update(JSON.stringify([{ id: "host.context.get", digest: `sha256:${"1".repeat(64)}` }]))
          .digest("hex"),
      },
      checks: pluginApiReleaseConformanceChecks.map((check) => ({
        ...check,
        status: "passed",
      })),
    })
  })

  test("rejects retired Catalog dialects and mismatched package bytes", () => {
    const retired = new TextEncoder().encode(
      `${JSON.stringify({
        schema: "convax.plugin-api-catalog/2",
        version: "1.0.0",
        apis: [{ id: "host.context.get", contract: { digest: `sha256:${"1".repeat(64)}` } }],
      })}\n`,
    )
    expect(() => buildPluginApiReleaseEvidence(input({ catalogBytes: retired, packageCatalogBytes: retired }))).toThrow(
      "Catalog schema/version",
    )
    expect(() => buildPluginApiReleaseEvidence(input({ packageCatalogBytes: new TextEncoder().encode("{}") }))).toThrow(
      "byte-identical",
    )
  })

  test("rejects wrong npm bytes, identity and workflow authority", () => {
    expect(() => buildPluginApiReleaseEvidence(input({ tarballIntegrity: `sha512-${"A".repeat(88)}` }))).toThrow(
      "does not match its SHA-512 integrity",
    )
    expect(() =>
      buildPluginApiReleaseEvidence(input({ packageJson: { name: "@convax/plugin-api", version: "1.0.1" } })),
    ).toThrow("package identity")
    expect(() =>
      buildPluginApiReleaseEvidence(
        input({
          workflowRef: "convaxai/convax/.github/workflows/other.yml@refs/heads/main",
        }),
      ),
    ).toThrow("protected Plugin API publication workflow")
    expect(() =>
      buildPluginApiReleaseEvidence(
        input({
          checkResults: {
            schema: "convax.plugin-api-check-results/1",
            profile: "convax.plugin-api-host-runtime/1",
            checks: [{ id: "plugin-api-typecheck", status: "passed" }],
          },
        }),
      ),
    ).toThrow("release conformance profile")
  })

  test("rejects mutable repository-name reuse through immutable repository identifiers", () => {
    expect(() => buildPluginApiReleaseEvidence(input({ repositoryId: "1" }))).toThrow("immutable Convax repository id")
    expect(() => buildPluginApiReleaseEvidence(input({ repositoryOwnerId: "1" }))).toThrow("immutable Convax owner id")
  })

  test("emits retry-stable evidence for one version and commit", () => {
    const first = JSON.stringify(buildPluginApiReleaseEvidence(input()))
    const retry = JSON.stringify(buildPluginApiReleaseEvidence(input()))
    expect(retry).toBe(first)
    expect(first).not.toContain("runId")
    expect(first).not.toContain("runAttempt")
  })
})
