import { createHash } from "node:crypto"
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join, relative } from "node:path"

import { KERNEL_DIGEST_DOMAINS, PROTOCOL_SCHEMA_ARTIFACTS } from "../../packages/collaboration/src/constants"
import { encodeRestrictedJcs } from "../../packages/collaboration/src/jcs"

type ArtifactDefinition = Readonly<{
  format: string
  name: string
  owner: "canvas" | "control-plane" | "kernel" | "project-index"
  output: string
  roots: readonly string[]
  sources?: readonly string[]
  semantics: readonly string[]
  exclude?: (path: string) => boolean
}>

type BuiltArtifact = Readonly<{
  bytes: Uint8Array
  definition: ArtifactDefinition
  digest: string
}>

const ARTIFACT_SOURCE_FORMAT = "convax.protocol-schema-source-artifact"
const SOURCE_DIGEST_POLICY = "sha256-exact-file-bytes-v1"
const ARTIFACT_DIGEST_POLICY = "sha256-domain-exact-artifact-bytes-v1"
const ARTIFACT_DIRECTORY = "packages/collaboration/protocol/artifacts"

const definitions: readonly ArtifactDefinition[] = Object.freeze([
  Object.freeze({
    format: "convax.canvas-protocol-schema",
    name: "canvas-schema",
    owner: "canvas",
    output: `${ARTIFACT_DIRECTORY}/canvas-schema.json`,
    roots: Object.freeze(["packages/canvas/src/collaboration"]),
    sources: Object.freeze([
      "packages/canvas/src/generation-run.ts",
      "packages/canvas/src/resource-placement.ts",
    ]),
    semantics: Object.freeze([
      "fixed-k-owner-mutations-do-not-scan-unrelated-canvas-history",
      "history-independent-owner-state-merkle-patricia-root",
      "scope-row-high-watermark-placement-v1",
      "single-current-runtime-with-sealed-immediate-predecessor-import",
    ]),
    exclude: (path) =>
      path.endsWith("/index.ts") ||
      path.endsWith(".test.ts") ||
      path.endsWith(".test.tsx") ||
      path.includes("/immediate-predecessor-migration.ts") ||
      path.includes("/projection-patch.ts") ||
      path.includes("/renderer-projection-store.ts") ||
      path.includes("/renderer-resource-hierarchy-index.ts") ||
      path.includes("/renderer-viewport-index.ts"),
  }),
  Object.freeze({
    format: "convax.collaboration-kernel-protocol-schema",
    name: "collaboration-kernel",
    owner: "kernel",
    output: `${ARTIFACT_DIRECTORY}/collaboration-kernel.json`,
    roots: Object.freeze(["packages/collaboration/src"]),
    semantics: Object.freeze([
      "atomic-accepted-frame-persistence-v1",
      "exact-single-local-yjs-transaction-update-v1",
      "history-independent-owner-state-merkle-patricia-root",
      "single-current-runtime-with-isolated-exact-predecessor-migrator",
    ]),
    exclude: (path) =>
      path.endsWith("/index.ts") ||
      path.endsWith("/constants.ts") ||
      path.endsWith("/current-protocol.ts") ||
      path.endsWith("/latency-diagnostics.ts") ||
      path.endsWith("/migration.ts") ||
      path.endsWith(".test.ts") ||
      path.includes("test-support"),
  }),
  Object.freeze({
    format: "convax.control-plane-protocol-schema",
    name: "control-plane",
    owner: "control-plane",
    output: `${ARTIFACT_DIRECTORY}/control-plane.json`,
    roots: Object.freeze(["apps/api/src"]),
    semantics: Object.freeze([
      "browser-safe-control-plane-only",
      "payload-bytes-remain-outside-control-plane",
      "single-current-protocol-attestation",
    ]),
    exclude: (path) => path.endsWith("/index.ts") || path.endsWith(".test.ts"),
  }),
  Object.freeze({
    format: "convax.project-persistence-protocol-schema",
    name: "project-persistence",
    owner: "project-index",
    output: `${ARTIFACT_DIRECTORY}/project-persistence.json`,
    roots: Object.freeze([
      "packages/project/src/collaboration",
      "packages/project/src/node/collaboration",
    ]),
    semantics: Object.freeze([
      "fixed-k-project-index-mutations-do-not-scan-unrelated-project-history",
      "single-file-accepted-frame-log-v1",
      "single-current-layout-with-verified-immediate-predecessor-import",
      "unknown-or-corrupt-prior-data-remains-unchanged-in-recovery",
    ]),
    exclude: (path) =>
      path.endsWith("/index.ts") ||
      path.endsWith(".test.ts") ||
      path.endsWith(".bench.ts") ||
      path.includes("/immediate-predecessor-") ||
      path.includes("benchmark-fixture"),
  }),
])

export async function generateCurrentProtocolSchemaArtifacts(repositoryRoot: string): Promise<void> {
  const artifacts = await buildArtifacts(repositoryRoot)
  for (const artifact of artifacts) {
    const target = join(repositoryRoot, artifact.definition.output)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, artifact.bytes, { mode: 0o644 })
  }
  await writeArtifactAnchors(repositoryRoot, artifacts)
}

export async function verifyCurrentProtocolSchemaArtifacts(repositoryRoot: string): Promise<void> {
  const artifacts = await buildArtifacts(repositoryRoot)
  for (const [index, artifact] of artifacts.entries()) {
    const actual = new Uint8Array(await readFile(join(repositoryRoot, artifact.definition.output)).catch(() => {
      throw new Error(`${artifact.definition.output} is missing; run bun scripts/collaboration-protocol/schema-artifacts.ts`)
    }))
    if (!sameBytes(actual, artifact.bytes)) {
      throw new Error(`${artifact.definition.output} differs from its exact current owner sources`)
    }
    const anchor = PROTOCOL_SCHEMA_ARTIFACTS[index]
    if (
      anchor === undefined ||
      anchor.name !== artifact.definition.name ||
      anchor.format !== artifact.definition.format ||
      anchor.artifactDigest !== artifact.digest
    ) {
      throw new Error(`${artifact.definition.name} source artifact differs from PROTOCOL_SCHEMA_ARTIFACTS`)
    }
  }
}

async function buildArtifacts(repositoryRoot: string): Promise<readonly BuiltArtifact[]> {
  const built: BuiltArtifact[] = []
  for (const definition of definitions) {
    const paths = new Set(definition.sources ?? [])
    for (const root of definition.roots) {
      for (const path of await collectTypeScriptSources(repositoryRoot, root)) paths.add(path)
    }
    const sourcePaths = [...paths].filter((path) => !definition.exclude?.(path)).sort()
    const sources = await Promise.all(sourcePaths.map(async (path) => Object.freeze({
      path,
      sha256: ordinarySha256(new Uint8Array(await readFile(join(repositoryRoot, path)))),
    })))
    const value = Object.freeze({
      artifactDigestPolicy: ARTIFACT_DIGEST_POLICY,
      artifactFormat: definition.format,
      format: ARTIFACT_SOURCE_FORMAT,
      name: definition.name,
      owner: definition.owner,
      semantics: definition.semantics,
      sourceDigestPolicy: SOURCE_DIGEST_POLICY,
      sources: Object.freeze(sources),
    })
    const body = encodeRestrictedJcs(value)
    const bytes = new Uint8Array(body.byteLength + 1)
    bytes.set(body)
    bytes[body.byteLength] = 0x0a
    built.push(Object.freeze({
      bytes,
      definition,
      digest: domainSeparatedSha256(KERNEL_DIGEST_DOMAINS.protocolSchemaArtifact, bytes),
    }))
  }
  return Object.freeze(built)
}

async function collectTypeScriptSources(repositoryRoot: string, root: string): Promise<readonly string[]> {
  const absoluteRoot = join(repositoryRoot, root)
  const result: string[] = []
  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true })
    for (const entry of entries) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await visit(path)
      else if (entry.isFile() && entry.name.endsWith(".ts")) {
        result.push(relative(repositoryRoot, path).split("\\").join("/"))
      }
    }
  }
  await visit(absoluteRoot)
  return Object.freeze(result.sort())
}

async function writeArtifactAnchors(repositoryRoot: string, artifacts: readonly BuiltArtifact[]): Promise<void> {
  const constantsPath = join(repositoryRoot, "packages/collaboration/src/constants.ts")
  const source = await readFile(constantsPath, "utf8")
  const replacement = [
    "export const PROTOCOL_SCHEMA_ARTIFACTS = Object.freeze([",
    ...artifacts.flatMap(({ definition, digest }) => [
      "  Object.freeze({",
      `    artifactDigest: \"${digest}\",`,
      `    format: \"${definition.format}\",`,
      `    name: \"${definition.name}\",`,
      "  }),",
    ]),
    "] as const)",
  ].join("\n")
  const anchorPattern = /export const PROTOCOL_SCHEMA_ARTIFACTS = Object\.freeze\(\[[\s\S]*?\]\s+as const\)/
  if (!anchorPattern.test(source)) throw new Error("Could not locate PROTOCOL_SCHEMA_ARTIFACTS anchor")
  const updated = source.replace(anchorPattern, replacement)
  if (updated !== source) await writeFile(constantsPath, updated)
}

function ordinarySha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex")
}

function domainSeparatedSha256(domain: string, bytes: Uint8Array): string {
  return createHash("sha256").update(new TextEncoder().encode(domain)).update(Uint8Array.of(0)).update(bytes).digest("hex")
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && left.every((byte, index) => byte === right[index])
}

if (import.meta.main) {
  const repositoryRoot = join(import.meta.dir, "..", "..")
  if (process.argv.includes("--check")) {
    await verifyCurrentProtocolSchemaArtifacts(repositoryRoot)
    console.log(`current protocol schema artifacts are up to date: ${ARTIFACT_DIRECTORY}`)
  } else {
    await generateCurrentProtocolSchemaArtifacts(repositoryRoot)
    console.log(`wrote current protocol schema artifacts: ${ARTIFACT_DIRECTORY}`)
  }
}
