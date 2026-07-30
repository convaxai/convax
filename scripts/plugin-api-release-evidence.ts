import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"

const PACKAGE_NAME = "@convax/plugin-api"
const CATALOG_SCHEMA = "convax.plugin-api-catalog/3"
export const PLUGIN_API_RUNTIME_CONFORMANCE_SCHEMA = "convax.plugin-api-runtime-conformance/1" as const
export const PLUGIN_API_RUNTIME_CONFORMANCE_PROFILE = "convax.plugin-api-host-runtime/1" as const
export const PLUGIN_API_CHECK_RESULTS_SCHEMA = "convax.plugin-api-check-results/1" as const
const MAX_CATALOG_BYTES = 16 * 1024 * 1024
const MAX_PACKAGE_JSON_BYTES = 128 * 1024
const MAX_TARBALL_BYTES = 32 * 1024 * 1024
const STABLE_VERSION = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/u
const COMMIT = /^[a-f0-9]{40}$/u
const POSITIVE_INTEGER = /^[1-9][0-9]*$/u
const NPM_INTEGRITY = /^sha512-[A-Za-z0-9+/]+={0,2}$/u

export const pluginApiReleaseCheckDefinitions = [
  {
    id: "plugin-api-typecheck",
    command: "bun --cwd packages/plugin-api typecheck",
    argv: ["--cwd", "packages/plugin-api", "typecheck"],
  },
  {
    id: "plugin-api-test",
    command: "bun --cwd packages/plugin-api test",
    argv: ["--cwd", "packages/plugin-api", "test"],
  },
  {
    id: "plugin-api-compat",
    command: "bun --cwd packages/plugin-api compat",
    argv: ["--cwd", "packages/plugin-api", "compat"],
  },
  {
    id: "plugin-api-generate-check",
    command: "bun --cwd packages/plugin-api generate:check",
    argv: ["--cwd", "packages/plugin-api", "generate:check"],
  },
  {
    id: "plugin-api-pack-check",
    command: "bun --cwd packages/plugin-api pack:check",
    argv: ["--cwd", "packages/plugin-api", "pack:check"],
  },
  {
    id: "release-evidence-policy",
    command: "bun test scripts/plugin-api-release-evidence.test.ts",
    argv: ["test", "scripts/plugin-api-release-evidence.test.ts"],
  },
  {
    id: "host-runtime-conformance",
    command:
      "bun test --isolate packages/desktop/src/main/plugin-host-api-service.test.ts " +
      "packages/desktop/src/main/plugin-host-api-main-adapter.test.ts " +
      "packages/desktop/src/main/plugin-capability-production.test.ts " +
      "packages/desktop/src/main/plugin-asset-protocol.test.ts " +
      "packages/desktop/src/main/plugin-connected-media-service.test.ts " +
      "packages/desktop/src/main/plugin-connected-image-inspector.test.ts",
    argv: [
      "test",
      "--isolate",
      "packages/desktop/src/main/plugin-host-api-service.test.ts",
      "packages/desktop/src/main/plugin-host-api-main-adapter.test.ts",
      "packages/desktop/src/main/plugin-capability-production.test.ts",
      "packages/desktop/src/main/plugin-asset-protocol.test.ts",
      "packages/desktop/src/main/plugin-connected-media-service.test.ts",
      "packages/desktop/src/main/plugin-connected-image-inspector.test.ts",
    ],
    suites: [
      "packages/desktop/src/main/plugin-host-api-service.test.ts",
      "packages/desktop/src/main/plugin-host-api-main-adapter.test.ts",
      "packages/desktop/src/main/plugin-capability-production.test.ts",
      "packages/desktop/src/main/plugin-asset-protocol.test.ts",
      "packages/desktop/src/main/plugin-connected-media-service.test.ts",
      "packages/desktop/src/main/plugin-connected-image-inspector.test.ts",
    ],
  },
] as const

export const pluginApiReleaseConformanceChecks = pluginApiReleaseCheckDefinitions.map(
  ({ argv: _argv, ...check }) => check,
)

type EvidenceInput = {
  readonly catalogBytes: Uint8Array
  readonly checkResults: unknown
  readonly commit: string
  readonly packageCatalogBytes: Uint8Array
  readonly packageJson: unknown
  readonly repository: string
  readonly runAttempt: string
  readonly runId: string
  readonly tarballIntegrity: string
  readonly tarballBytes: Uint8Array
  readonly version: string
  readonly workflowRef: string
}

function fail(message: string): never {
  throw new TypeError(`Plugin API release evidence: ${message}`)
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
  return keys.length === expected.length && keys.every((key, index) => key === [...expected].sort()[index])
}

function assertPassedCheckResults(value: unknown): void {
  if (
    !isRecord(value) ||
    !exactKeys(value, ["checks", "profile", "schema"]) ||
    value.schema !== PLUGIN_API_CHECK_RESULTS_SCHEMA ||
    value.profile !== PLUGIN_API_RUNTIME_CONFORMANCE_PROFILE ||
    !Array.isArray(value.checks) ||
    value.checks.length !== pluginApiReleaseCheckDefinitions.length
  ) {
    fail("check results do not match the release conformance profile")
  }
  const expectedIds = pluginApiReleaseCheckDefinitions.map(({ id }) => id)
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

function catalogContractCoverage(catalog: Record<string, unknown>): readonly {
  readonly id: string
  readonly digest: string
}[] {
  if (!Array.isArray(catalog.apis) || catalog.apis.length === 0 || catalog.apis.length > 1024) {
    fail("Catalog APIs are outside the admitted bound")
  }
  const seen = new Set<string>()
  const coverage = catalog.apis.map((definition, index) => {
    if (!isRecord(definition) || !isRecord(definition.contract)) {
      fail(`Catalog API ${index} does not contain one contract`)
    }
    const id = definition.id
    const digest = definition.contract.digest
    if (
      typeof id !== "string" ||
      !/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/u.test(id) ||
      typeof digest !== "string" ||
      !/^sha256:[a-f0-9]{64}$/u.test(digest) ||
      seen.has(id)
    ) {
      fail(`Catalog API ${index} has an invalid or duplicate contract identity`)
    }
    seen.add(id)
    return { id, digest }
  })
  return coverage.sort((left, right) => left.id.localeCompare(right.id))
}

export function buildPluginApiReleaseEvidence(input: EvidenceInput): Record<string, unknown> {
  if (input.repository !== "microvoid/convax") fail("repository must be microvoid/convax")
  if (!COMMIT.test(input.commit)) fail("commit must be one lowercase full SHA")
  if (!STABLE_VERSION.test(input.version)) fail("version must be one stable SemVer")
  if (!POSITIVE_INTEGER.test(input.runId) || !POSITIVE_INTEGER.test(input.runAttempt)) {
    fail("workflow run id and attempt must be positive integers")
  }
  const allowedWorkflowRefs = new Set([
    `${input.repository}/.github/workflows/plugin-api-bootstrap.yml@refs/heads/convax-next`,
    `${input.repository}/.github/workflows/plugin-api-npm-stage.yml@refs/heads/convax-next`,
    `${input.repository}/.github/workflows/plugin-api-release.yml@refs/heads/convax-next`,
  ])
  if (!allowedWorkflowRefs.has(input.workflowRef)) {
    fail("workflow ref must identify a protected Plugin API publication workflow")
  }
  if (input.catalogBytes.byteLength === 0 || input.catalogBytes.byteLength > MAX_CATALOG_BYTES) {
    fail("Catalog size is outside the admitted bound")
  }
  if (input.tarballBytes.byteLength === 0 || input.tarballBytes.byteLength > MAX_TARBALL_BYTES) {
    fail("package tarball size is outside the admitted bound")
  }
  if (!NPM_INTEGRITY.test(input.tarballIntegrity)) fail("tarball integrity must be one SHA-512 SRI")
  if (sha512Integrity(input.tarballBytes) !== input.tarballIntegrity) {
    fail("package tarball does not match its SHA-512 integrity")
  }
  assertPassedCheckResults(input.checkResults)

  const catalog = parseJson(input.catalogBytes, "Catalog")
  if (catalog.schema !== CATALOG_SCHEMA || catalog.version !== input.version) {
    fail("Catalog schema/version does not match the release")
  }
  const contractCoverage = catalogContractCoverage(catalog)
  const contractCoverageSha256 = sha256(new TextEncoder().encode(JSON.stringify(contractCoverage)))
  if (!exactBytes(input.catalogBytes, input.packageCatalogBytes)) {
    fail("package Catalog is not byte-identical to the standalone Catalog")
  }
  if (
    !isRecord(input.packageJson) ||
    input.packageJson.name !== PACKAGE_NAME ||
    input.packageJson.version !== input.version
  ) {
    fail("package identity does not match the release")
  }

  return {
    schema: PLUGIN_API_RUNTIME_CONFORMANCE_SCHEMA,
    profile: PLUGIN_API_RUNTIME_CONFORMANCE_PROFILE,
    host: {
      repository: input.repository,
      commit: input.commit,
    },
    workflow: {
      ref: input.workflowRef,
      runId: input.runId,
      runAttempt: input.runAttempt,
    },
    pluginApi: {
      package: PACKAGE_NAME,
      version: input.version,
      catalogSchema: CATALOG_SCHEMA,
      catalogSha256: sha256(input.catalogBytes),
      tarballSha256: sha256(input.tarballBytes),
      tarballIntegrity: input.tarballIntegrity,
      contractCoverage,
      contractCoverageSha256,
    },
    checks: pluginApiReleaseConformanceChecks.map((check) => ({
      ...check,
      status: "passed",
    })),
  }
}

type Arguments = {
  readonly catalog: string
  readonly checkResults: string
  readonly commit: string
  readonly output: string
  readonly packageCatalog: string
  readonly packageJson: string
  readonly repository: string
  readonly runAttempt: string
  readonly runId: string
  readonly tarballIntegrity: string
  readonly tarball: string
  readonly version: string
  readonly workflowRef: string
}

function parseArguments(argv: readonly string[]): Arguments {
  const supported = new Set([
    "--catalog",
    "--check-results",
    "--commit",
    "--output",
    "--package-catalog",
    "--package-json",
    "--repository",
    "--run-attempt",
    "--run-id",
    "--tarball",
    "--tarball-integrity",
    "--version",
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
    catalog: values.get("--catalog")!,
    checkResults: values.get("--check-results")!,
    commit: values.get("--commit")!,
    output: values.get("--output")!,
    packageCatalog: values.get("--package-catalog")!,
    packageJson: values.get("--package-json")!,
    repository: values.get("--repository")!,
    runAttempt: values.get("--run-attempt")!,
    runId: values.get("--run-id")!,
    tarballIntegrity: values.get("--tarball-integrity")!,
    tarball: values.get("--tarball")!,
    version: values.get("--version")!,
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
  const catalogBytes = await readBounded(args.catalog, MAX_CATALOG_BYTES, "Catalog")
  const checkResultsBytes = await readBounded(args.checkResults, 128 * 1024, "check results")
  const packageCatalogBytes = await readBounded(args.packageCatalog, MAX_CATALOG_BYTES, "package Catalog")
  const packageJsonBytes = await readBounded(args.packageJson, MAX_PACKAGE_JSON_BYTES, "package.json")
  const tarballBytes = await readBounded(args.tarball, MAX_TARBALL_BYTES, "package tarball")

  const evidence = buildPluginApiReleaseEvidence({
    catalogBytes,
    checkResults: parseJson(checkResultsBytes, "check results"),
    commit: args.commit,
    packageCatalogBytes,
    packageJson: parseJson(packageJsonBytes, "package.json"),
    repository: args.repository,
    runAttempt: args.runAttempt,
    runId: args.runId,
    tarballIntegrity: args.tarballIntegrity,
    tarballBytes,
    version: args.version,
    workflowRef: args.workflowRef,
  })
  const output = resolve(args.output)
  await mkdir(dirname(output), { recursive: true })
  await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`, { flag: "wx" })
}

if (import.meta.main) {
  await main()
}
