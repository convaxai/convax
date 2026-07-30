import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"

const SDK_PACKAGE_NAME = "@convax/plugin-sdk"
const API_PACKAGE_NAME = "@convax/plugin-api"
const CATALOG_SCHEMA = "convax.plugin-api-catalog/3"
export const HOST_PACKAGE_RELEASE_SCHEMA = "convax.host-package-release/1" as const
export const PLUGIN_SDK_RELEASE_PROFILE = "convax.plugin-sdk-authoring-package/1" as const
export const PLUGIN_SDK_CHECK_RESULTS_SCHEMA = "convax.plugin-sdk-check-results/1" as const
export const SIGSTORE_BUNDLE_MEDIA_TYPE = "application/vnd.dev.sigstore.bundle.v0.3+json" as const
export const SIGSTORE_BUNDLE_SUFFIX = ".sigstore.json" as const
export const SIGSTORE_OIDC_ISSUER = "https://token.actions.githubusercontent.com" as const
export const CONVAX_REPOSITORY_ID = "1293264965" as const
export const CONVAX_REPOSITORY_OWNER_ID = "125447777" as const
const PROTECTED_WORKFLOW_REF = "refs/heads/convax-next"
const MAX_CATALOG_BYTES = 16 * 1024 * 1024
const MAX_PACKAGE_JSON_BYTES = 128 * 1024
const MAX_TARBALL_BYTES = 32 * 1024 * 1024
const STABLE_VERSION = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/u
const COMMIT = /^[a-f0-9]{40}$/u
const POSITIVE_INTEGER = /^[1-9][0-9]*$/u
const NPM_INTEGRITY = /^sha512-[A-Za-z0-9+/]+={0,2}$/u

export const pluginSdkReleaseCheckDefinitions = [
  {
    id: "plugin-api-release-dependency-build",
    command: "bun --cwd packages/plugin-api build",
    argv: ["--cwd", "packages/plugin-api", "build"],
  },
  {
    id: "plugin-sdk-typecheck",
    command: "bun --cwd packages/plugin-sdk typecheck",
    argv: ["--cwd", "packages/plugin-sdk", "typecheck"],
  },
  {
    id: "plugin-sdk-test",
    command: "bun --cwd packages/plugin-sdk test",
    argv: ["--cwd", "packages/plugin-sdk", "test"],
  },
  {
    id: "plugin-sdk-pack-check",
    command: "bun --cwd packages/plugin-sdk pack:check",
    argv: ["--cwd", "packages/plugin-sdk", "pack:check"],
  },
  {
    id: "package-boundaries",
    command: "bun run package:boundaries",
    argv: ["run", "package:boundaries"],
  },
  {
    id: "release-evidence-policy",
    command: "bun test scripts/plugin-sdk-release-evidence.test.ts scripts/plugin-sdk-release-workflows.test.ts",
    argv: ["test", "scripts/plugin-sdk-release-evidence.test.ts", "scripts/plugin-sdk-release-workflows.test.ts"],
  },
] as const

export const pluginSdkReleaseConformanceChecks = pluginSdkReleaseCheckDefinitions.map(
  ({ argv: _argv, ...check }) => check,
)

type EvidenceInput = {
  readonly apiCatalogBytes: Uint8Array
  readonly apiPackageCatalogBytes: Uint8Array
  readonly apiPackageJson: unknown
  readonly apiTarballBytes: Uint8Array
  readonly apiTarballIntegrity: string
  readonly apiVersion: string
  readonly checkResults: unknown
  readonly commit: string
  readonly repository: string
  readonly repositoryId: string
  readonly repositoryOwnerId: string
  readonly runAttempt: string
  readonly runId: string
  readonly sdkPackageJson: unknown
  readonly sdkSourceTarballBytes: Uint8Array
  readonly sdkTarballBytes: Uint8Array
  readonly sdkTarballIntegrity: string
  readonly sdkVersion: string
  readonly workflowRef: string
}

function fail(message: string): never {
  throw new TypeError(`Plugin SDK release evidence: ${message}`)
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex")
}

function sha512Integrity(bytes: Uint8Array): string {
  return `sha512-${createHash("sha512").update(bytes).digest("base64")}`
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function parseJson(bytes: Uint8Array, label: string): Record<string, unknown> {
  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    fail(`${label} must be valid JSON`)
  }
  if (!isRecord(parsed)) fail(`${label} must be an object`)
  return parsed
}

function exactBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false
  return left.every((byte, index) => byte === right[index])
}

function exactKeys(value: Record<PropertyKey, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort()
  const sortedExpected = [...expected].sort()
  return keys.length === sortedExpected.length && keys.every((key, index) => key === sortedExpected[index])
}

function assertTarball(bytes: Uint8Array, integrity: string, label: string): void {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_TARBALL_BYTES) {
    fail(`${label} tarball size is outside the admitted bound`)
  }
  if (!NPM_INTEGRITY.test(integrity)) fail(`${label} integrity must be one SHA-512 SRI`)
  if (sha512Integrity(bytes) !== integrity) fail(`${label} tarball does not match its SHA-512 integrity`)
}

function assertPassedCheckResults(value: unknown): void {
  if (
    !isRecord(value) ||
    !exactKeys(value, ["checks", "profile", "schema"]) ||
    value.schema !== PLUGIN_SDK_CHECK_RESULTS_SCHEMA ||
    value.profile !== PLUGIN_SDK_RELEASE_PROFILE ||
    !Array.isArray(value.checks) ||
    value.checks.length !== pluginSdkReleaseCheckDefinitions.length
  ) {
    fail("check results do not match the release conformance profile")
  }
  const expectedIds = pluginSdkReleaseCheckDefinitions.map(({ id }) => id)
  value.checks.forEach((check, index) => {
    if (
      !isRecord(check) ||
      !exactKeys(check, ["id", "status"]) ||
      check.id !== expectedIds[index] ||
      check.status !== "passed"
    ) {
      fail(`check result ${index} does not prove one passed profile check`)
    }
  })
}

export function buildPluginSdkReleaseEvidence(input: EvidenceInput): Record<string, unknown> {
  if (input.repository !== "microvoid/convax") fail("repository must be microvoid/convax")
  if (input.repositoryId !== CONVAX_REPOSITORY_ID) fail("repository id must match the immutable Convax repository id")
  if (input.repositoryOwnerId !== CONVAX_REPOSITORY_OWNER_ID) {
    fail("repository owner id must match the immutable Convax owner id")
  }
  if (!COMMIT.test(input.commit)) fail("commit must be one lowercase full SHA")
  if (!STABLE_VERSION.test(input.sdkVersion) || !STABLE_VERSION.test(input.apiVersion)) {
    fail("package versions must be stable SemVer")
  }
  if (!POSITIVE_INTEGER.test(input.runId) || !POSITIVE_INTEGER.test(input.runAttempt)) {
    fail("workflow run id and attempt must be positive integers")
  }
  const allowedWorkflows = new Map([
    [
      `${input.repository}/.github/workflows/plugin-sdk-bootstrap.yml@${PROTECTED_WORKFLOW_REF}`,
      "Prepare Plugin SDK bootstrap",
    ],
    [
      `${input.repository}/.github/workflows/plugin-sdk-npm-stage.yml@${PROTECTED_WORKFLOW_REF}`,
      "Stage Plugin SDK npm package",
    ],
    [
      `${input.repository}/.github/workflows/plugin-sdk-release.yml@${PROTECTED_WORKFLOW_REF}`,
      "Publish Plugin SDK immutable evidence",
    ],
  ])
  const workflowName = allowedWorkflows.get(input.workflowRef)
  if (!workflowName) {
    fail("workflow ref must identify a protected Plugin SDK publication workflow")
  }
  assertTarball(input.sdkTarballBytes, input.sdkTarballIntegrity, "Plugin SDK")
  if (!exactBytes(input.sdkSourceTarballBytes, input.sdkTarballBytes)) {
    fail("published Plugin SDK tarball is not byte-identical to the package reproduced from the Host commit")
  }
  assertTarball(input.apiTarballBytes, input.apiTarballIntegrity, "Plugin API")
  assertPassedCheckResults(input.checkResults)

  if (!isRecord(input.sdkPackageJson)) fail("Plugin SDK package.json must be an object")
  if (
    input.sdkPackageJson.name !== SDK_PACKAGE_NAME ||
    input.sdkPackageJson.version !== input.sdkVersion ||
    !isRecord(input.sdkPackageJson.dependencies) ||
    !exactKeys(input.sdkPackageJson.dependencies, [API_PACKAGE_NAME])
  ) {
    fail("Plugin SDK package identity or dependency set does not match the release")
  }
  const declaredApiRange = input.sdkPackageJson.dependencies[API_PACKAGE_NAME]
  if (declaredApiRange !== `^${input.apiVersion}`) {
    fail("packed Plugin SDK must declare the release-time Plugin API identity as its compatible baseline")
  }

  if (
    !isRecord(input.apiPackageJson) ||
    input.apiPackageJson.name !== API_PACKAGE_NAME ||
    input.apiPackageJson.version !== input.apiVersion
  ) {
    fail("Plugin API package identity does not match the dependency evidence")
  }
  if (input.apiCatalogBytes.byteLength === 0 || input.apiCatalogBytes.byteLength > MAX_CATALOG_BYTES) {
    fail("Plugin API Catalog size is outside the admitted bound")
  }
  if (!exactBytes(input.apiCatalogBytes, input.apiPackageCatalogBytes)) {
    fail("published Plugin API Catalog is not byte-identical to the Host Catalog")
  }
  const catalog = parseJson(input.apiCatalogBytes, "Plugin API Catalog")
  if (catalog.schema !== CATALOG_SCHEMA || catalog.version !== input.apiVersion) {
    fail("Plugin API Catalog schema/version does not match the dependency evidence")
  }

  return {
    schema: HOST_PACKAGE_RELEASE_SCHEMA,
    profile: PLUGIN_SDK_RELEASE_PROFILE,
    host: {
      repository: input.repository,
      repositoryId: input.repositoryId,
      repositoryOwnerId: input.repositoryOwnerId,
      commit: input.commit,
    },
    workflow: {
      ref: input.workflowRef,
      runId: input.runId,
      runAttempt: input.runAttempt,
    },
    sigstore: {
      bundle: {
        mediaType: SIGSTORE_BUNDLE_MEDIA_TYPE,
        suffix: SIGSTORE_BUNDLE_SUFFIX,
      },
      certificate: {
        identity: `https://github.com/${input.workflowRef}`,
        oidcIssuer: SIGSTORE_OIDC_ISSUER,
        workflowName,
        workflowRef: PROTECTED_WORKFLOW_REF,
        repository: input.repository,
        sourceSha: input.commit,
        trigger: "workflow_dispatch",
      },
      transparencyLog: {
        inclusionRequired: true,
      },
    },
    package: {
      name: SDK_PACKAGE_NAME,
      version: input.sdkVersion,
      tarballSha256: sha256(input.sdkTarballBytes),
      tarballIntegrity: input.sdkTarballIntegrity,
    },
    dependencies: [
      {
        name: API_PACKAGE_NAME,
        declaredRange: declaredApiRange,
        resolvedVersion: input.apiVersion,
        tarballSha256: sha256(input.apiTarballBytes),
        tarballIntegrity: input.apiTarballIntegrity,
        catalogSchema: CATALOG_SCHEMA,
        catalogVersion: input.apiVersion,
        catalogSha256: sha256(input.apiCatalogBytes),
      },
    ],
    checks: pluginSdkReleaseConformanceChecks.map((check) => ({
      ...check,
      status: "passed",
    })),
  }
}

type Arguments = {
  readonly apiCatalog: string
  readonly apiPackageCatalog: string
  readonly apiPackageJson: string
  readonly apiTarball: string
  readonly apiTarballIntegrity: string
  readonly apiVersion: string
  readonly checkResults: string
  readonly commit: string
  readonly output: string
  readonly repository: string
  readonly repositoryId: string
  readonly repositoryOwnerId: string
  readonly runAttempt: string
  readonly runId: string
  readonly sdkPackageJson: string
  readonly sdkSourceTarball: string
  readonly sdkTarball: string
  readonly sdkTarballIntegrity: string
  readonly sdkVersion: string
  readonly workflowRef: string
}

function parseArguments(argv: readonly string[]): Arguments {
  const supported = new Set([
    "--api-catalog",
    "--api-package-catalog",
    "--api-package-json",
    "--api-tarball",
    "--api-tarball-integrity",
    "--api-version",
    "--check-results",
    "--commit",
    "--output",
    "--repository",
    "--repository-id",
    "--repository-owner-id",
    "--run-attempt",
    "--run-id",
    "--sdk-package-json",
    "--sdk-source-tarball",
    "--sdk-tarball",
    "--sdk-tarball-integrity",
    "--sdk-version",
    "--workflow-ref",
  ])
  const values = new Map<string, string>()
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]
    const value = argv[index + 1]
    if (!key || !supported.has(key) || !value || values.has(key)) fail("invalid command arguments")
    values.set(key, value)
  }
  for (const key of supported) {
    if (!values.has(key)) fail(`${key} is required`)
  }
  return {
    apiCatalog: values.get("--api-catalog")!,
    apiPackageCatalog: values.get("--api-package-catalog")!,
    apiPackageJson: values.get("--api-package-json")!,
    apiTarball: values.get("--api-tarball")!,
    apiTarballIntegrity: values.get("--api-tarball-integrity")!,
    apiVersion: values.get("--api-version")!,
    checkResults: values.get("--check-results")!,
    commit: values.get("--commit")!,
    output: values.get("--output")!,
    repository: values.get("--repository")!,
    repositoryId: values.get("--repository-id")!,
    repositoryOwnerId: values.get("--repository-owner-id")!,
    runAttempt: values.get("--run-attempt")!,
    runId: values.get("--run-id")!,
    sdkPackageJson: values.get("--sdk-package-json")!,
    sdkSourceTarball: values.get("--sdk-source-tarball")!,
    sdkTarball: values.get("--sdk-tarball")!,
    sdkTarballIntegrity: values.get("--sdk-tarball-integrity")!,
    sdkVersion: values.get("--sdk-version")!,
    workflowRef: values.get("--workflow-ref")!,
  }
}

async function readBounded(path: string, maximum: number, label: string): Promise<Uint8Array> {
  const bytes = await readFile(path)
  if (bytes.byteLength === 0 || bytes.byteLength > maximum) fail(`${label} size is outside the admitted bound`)
  return bytes
}

async function main(): Promise<void> {
  const args = parseArguments(process.argv.slice(2))
  const apiCatalogBytes = await readBounded(args.apiCatalog, MAX_CATALOG_BYTES, "Plugin API Catalog")
  const apiPackageCatalogBytes = await readBounded(
    args.apiPackageCatalog,
    MAX_CATALOG_BYTES,
    "published Plugin API Catalog",
  )
  const apiPackageJsonBytes = await readBounded(args.apiPackageJson, MAX_PACKAGE_JSON_BYTES, "Plugin API package.json")
  const apiTarballBytes = await readBounded(args.apiTarball, MAX_TARBALL_BYTES, "Plugin API tarball")
  const checkResultsBytes = await readBounded(args.checkResults, 128 * 1024, "check results")
  const sdkPackageJsonBytes = await readBounded(args.sdkPackageJson, MAX_PACKAGE_JSON_BYTES, "Plugin SDK package.json")
  const sdkSourceTarballBytes = await readBounded(args.sdkSourceTarball, MAX_TARBALL_BYTES, "source Plugin SDK tarball")
  const sdkTarballBytes = await readBounded(args.sdkTarball, MAX_TARBALL_BYTES, "Plugin SDK tarball")

  const evidence = buildPluginSdkReleaseEvidence({
    apiCatalogBytes,
    apiPackageCatalogBytes,
    apiPackageJson: parseJson(apiPackageJsonBytes, "Plugin API package.json"),
    apiTarballBytes,
    apiTarballIntegrity: args.apiTarballIntegrity,
    apiVersion: args.apiVersion,
    checkResults: parseJson(checkResultsBytes, "check results"),
    commit: args.commit,
    repository: args.repository,
    repositoryId: args.repositoryId,
    repositoryOwnerId: args.repositoryOwnerId,
    runAttempt: args.runAttempt,
    runId: args.runId,
    sdkPackageJson: parseJson(sdkPackageJsonBytes, "Plugin SDK package.json"),
    sdkSourceTarballBytes,
    sdkTarballBytes,
    sdkTarballIntegrity: args.sdkTarballIntegrity,
    sdkVersion: args.sdkVersion,
    workflowRef: args.workflowRef,
  })
  const output = resolve(args.output)
  await mkdir(dirname(output), { recursive: true })
  await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`, { flag: "wx" })
}

if (import.meta.main) {
  await main()
}
