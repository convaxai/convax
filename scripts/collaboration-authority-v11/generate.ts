import { createHash } from "node:crypto"
import { lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
export const V11_RELEASE_DIRECTORY = "docs/superpowers/specs/authorities/collaboration-v11/r1" as const
export const V11_PATHS = Object.freeze({
  uri: "docs/superpowers/specs/2026-07-31-global-uri-protocol.md",
  canvas: `${V11_RELEASE_DIRECTORY}/appendices/canvas-schema.md`,
  kernel: `${V11_RELEASE_DIRECTORY}/appendices/collaboration-kernel.md`,
  control: `${V11_RELEASE_DIRECTORY}/appendices/control-plane.md`,
  project: `${V11_RELEASE_DIRECTORY}/appendices/project-persistence.md`,
  historicalPin: `${V11_RELEASE_DIRECTORY}/historical-v10-r5-pin.json`,
  main: `${V11_RELEASE_DIRECTORY}/main.md`,
  bundle: `${V11_RELEASE_DIRECTORY}/protocol-schema-bundle-v3.json`,
  manifest: `${V11_RELEASE_DIRECTORY}/authority.sha256`,
} as const)

const artifacts = Object.freeze([
  { name: "canvas-schema", format: "convax.canvas-protocol-schema/3", path: V11_PATHS.canvas },
  { name: "collaboration-kernel", format: "convax.collaboration-kernel-protocol-schema/3", path: V11_PATHS.kernel },
  { name: "control-plane", format: "convax.control-plane-protocol-schema/3", path: V11_PATHS.control },
  { name: "project-persistence", format: "convax.project-persistence-protocol-schema/3", path: V11_PATHS.project },
] as const)

const digestDomainsV3 = Object.freeze([
  "convax.causal-context/3",
  "convax.causal-edit-core/3",
  "convax.causal-edit-frame-digest/3",
  "convax.causal-edit-signature/3",
  "convax.causal-signer-authority/3",
  "convax.local-owner-edit-authorization-core/3",
  "convax.local-owner-edit-authorization-signature/3",
  "convax.local-owner-canvas-genesis-checkpoint-core/3",
  "convax.local-owner-canvas-genesis-checkpoint-object/3",
  "convax.local-owner-canvas-genesis-checkpoint-signature/3",
  "convax.local-owner-canvas-genesis-proof/3",
  "convax.local-owner-project-index-genesis-checkpoint-core/3",
  "convax.local-owner-project-index-genesis-checkpoint-object/3",
  "convax.local-owner-project-index-genesis-checkpoint-signature/3",
  "convax.local-owner-project-index-genesis-proof/3",
  "convax.local-project-owner-binding-core/3",
  "convax.local-project-owner-binding-signature/3",
  "convax.local-project-owner-public-key/3",
  "convax.protocol-schema-artifact/3",
  "convax.protocol-schema-bundle-core/3",
  "convax.protocol-promotion-bridge-core/3",
  "convax.protocol-promotion-bridge-signature/3",
  "convax.typed-intent/3",
].sort(compareUtf8))

type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json }

export interface GeneratedSuccessorAuthorityReleaseV1 {
  readonly bundleBytes: Uint8Array
  readonly manifestBytes: Uint8Array
  readonly manifestSha256: string
  readonly protocolBundleSha256: string
  readonly protocolDigest: string
}

export function generateSuccessorAuthorityReleaseV1(): GeneratedSuccessorAuthorityReleaseV1 {
  const sourcePaths = [
    V11_PATHS.uri,
    V11_PATHS.canvas,
    V11_PATHS.kernel,
    V11_PATHS.control,
    V11_PATHS.project,
    V11_PATHS.historicalPin,
    V11_PATHS.main,
  ] as const
  const inputs = new Map(sourcePaths.map((path) => [path, readCompleteFile(path)]))
  const historicalPin = decodeCanonicalJson(requireValue(inputs, V11_PATHS.historicalPin), "historical V10/R5 pin")
  validateHistoricalPin(historicalPin)

  const core = {
    format: "convax.protocol-schema-bundle-core/3",
    protocolMajor: "3",
    frameMagic: "CVXCOLL3",
    artifacts: artifacts.map(({ name, format, path }) => ({
      name,
      format,
      artifactDigest: domainDigest("convax.protocol-schema-artifact/3", requireValue(inputs, path)),
    })),
    typeNamespaces: [
      { namespace: "canvas-schema", imports: ["collaboration-kernel", "global-uri"] },
      { namespace: "collaboration-kernel", imports: ["global-uri"] },
      { namespace: "control-plane", imports: ["collaboration-kernel", "global-uri", "project-persistence"] },
      { namespace: "global-uri", imports: [] },
      { namespace: "project-persistence", imports: ["canvas-schema", "collaboration-kernel", "control-plane", "global-uri"] },
    ],
    digestDomains: digestDomainsV3,
    ownerIntentFormat: "convax.typed-intent/2",
    yjsWireCodec: {
      format: "convax.yjs-wire-codec/3",
      package: "yjs",
      version: "13.6.31",
      packageIntegrity: "sha512-Eq+5BRfbeGyqGVrTJL3bEcr8gKkxPuyuoHmAwpk52fDb8kOVMrfVSTRPd6yiGgX5Fskb96qCRjzjbRjrL4YEnw==",
      updateVersion: "v1",
      updateCodec: "Y.encodeStateAsUpdate",
      stateVectorCodec: "Y.encodeStateVector",
      applyCodec: "Y.applyUpdate",
    },
    uriProtocolDigest: ordinarySha256(requireValue(inputs, V11_PATHS.uri)),
    historicalAuthorityPinSha256: ordinarySha256(requireValue(inputs, V11_PATHS.historicalPin)),
    historicalProtocolDigest: requireHistoricalProtocolDigest(historicalPin),
  } satisfies Json
  const protocolDigest = domainDigest("convax.protocol-schema-bundle-core/3", encodeCanonicalJson(core))
  const bundle = {
    format: "convax.protocol-schema-bundle/3",
    core,
    coreDigest: protocolDigest,
    protocolDigest,
  } satisfies Json
  const bundleBytes = appendLf(encodeCanonicalJson(bundle))

  const members = new Map(inputs)
  members.set(V11_PATHS.bundle, bundleBytes)
  const manifestPaths = [...sourcePaths, V11_PATHS.bundle].sort(compareUtf8)
  const manifestBytes = new TextEncoder().encode(
    `${manifestPaths.map((path) => `${ordinarySha256(requireValue(members, path))}  ${path}`).join("\n")}\n`,
  )
  return Object.freeze({
    bundleBytes,
    manifestBytes,
    manifestSha256: ordinarySha256(manifestBytes),
    protocolBundleSha256: ordinarySha256(bundleBytes),
    protocolDigest,
  })
}

export function verifyGeneratedSuccessorAuthorityReleaseV1(release = generateSuccessorAuthorityReleaseV1()): void {
  sameBytes(readCompleteFile(V11_PATHS.bundle), release.bundleBytes, "installed V11 bundle")
  sameBytes(readCompleteFile(V11_PATHS.manifest), release.manifestBytes, "installed V11 manifest")
}

export function installGeneratedSuccessorAuthorityReleaseV1(release = generateSuccessorAuthorityReleaseV1()): void {
  mkdirSync(join(repositoryRoot, V11_RELEASE_DIRECTORY), { recursive: true })
  installCreateOnly(V11_PATHS.bundle, release.bundleBytes)
  installCreateOnly(V11_PATHS.manifest, release.manifestBytes)
  verifyGeneratedSuccessorAuthorityReleaseV1(release)
}

function validateHistoricalPin(value: Json): void {
  if (!value || Array.isArray(value) || typeof value !== "object") fail("historical pin must be an object")
  const source = value as Record<string, Json>
  exactKeys(source, ["activePointer", "authorityId", "evidence", "format", "manifest", "protocolBundle", "revision", "snapshot"], "historical pin")
  if (source.format !== "convax.historical-authority-pin/1" || source.authorityId !== "collaboration-v10" || source.revision !== "r5") fail("historical pin identity is invalid")
  if (!Array.isArray(source.snapshot) || source.snapshot.length !== 15) fail("historical pin must bind the exact fifteen-file R5 snapshot")
  const expectedPaths = [
    "docs/superpowers/specs/2026-07-31-global-uri-protocol.md",
    "docs/superpowers/specs/authorities/collaboration-v10/r5/appendices/canvas-schema.md",
    "docs/superpowers/specs/authorities/collaboration-v10/r5/appendices/collaboration-kernel.md",
    "docs/superpowers/specs/authorities/collaboration-v10/r5/appendices/control-plane.md",
    "docs/superpowers/specs/authorities/collaboration-v10/r5/appendices/project-persistence.md",
    "docs/superpowers/specs/authorities/collaboration-v10/r5/authority.sha256",
    "docs/superpowers/specs/authorities/collaboration-v10/r5/main.md",
    "docs/superpowers/specs/authorities/collaboration-v10/r5/protocol-schema-bundle-v2.json",
    "docs/superpowers/specs/authorities/collaboration-v10/r5/review-evidence.json",
    "docs/superpowers/specs/authorities/collaboration-v10/r5/reviews/canvas-intent-runtime/receipt.json",
    "docs/superpowers/specs/authorities/collaboration-v10/r5/reviews/canvas-intent-runtime/report.md",
    "docs/superpowers/specs/authorities/collaboration-v10/r5/reviews/collaboration-api/receipt.json",
    "docs/superpowers/specs/authorities/collaboration-v10/r5/reviews/collaboration-api/report.md",
    "docs/superpowers/specs/authorities/collaboration-v10/r5/reviews/project-store-reviewer/receipt.json",
    "docs/superpowers/specs/authorities/collaboration-v10/r5/reviews/project-store-reviewer/report.md",
  ]
  for (let index = 0; index < expectedPaths.length; index += 1) {
    const entry = source.snapshot[index]
    if (!entry || Array.isArray(entry) || typeof entry !== "object") fail(`historical pin member ${index} is invalid`)
    exactKeys(entry as Record<string, Json>, ["path", "sha256"], `historical pin member ${index}`)
    if ((entry as Record<string, Json>).path !== expectedPaths[index] || !isSha((entry as Record<string, Json>).sha256)) fail(`historical pin member ${index} identity is invalid`)
    const bytes = readCompleteFile(expectedPaths[index]!)
    if (ordinarySha256(bytes) !== (entry as Record<string, Json>).sha256) fail(`historical R5 member drifted: ${expectedPaths[index]}`)
  }
}

function requireHistoricalProtocolDigest(value: Json): string {
  const source = value as Record<string, Json>
  const bundle = source.protocolBundle
  if (!bundle || Array.isArray(bundle) || typeof bundle !== "object") fail("historical protocol bundle pin is invalid")
  exactKeys(bundle as Record<string, Json>, ["path", "protocolDigest", "sha256"], "historical protocol bundle pin")
  const digest = (bundle as Record<string, Json>).protocolDigest
  if (!isSha(digest)) fail("historical protocol digest is invalid")
  return digest
}

function decodeCanonicalJson(bytes: Uint8Array, label: string): Json {
  if (bytes.at(-1) !== 0x0a) fail(`${label} lacks final LF`)
  const body = bytes.slice(0, -1)
  const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)) as Json
  sameBytes(encodeCanonicalJson(value), body, `${label} restricted JCS`)
  return value
}

function readCompleteFile(path: string): Uint8Array {
  const absolute = join(repositoryRoot, path)
  const stat = lstatSync(absolute)
  if (!stat.isFile() || stat.isSymbolicLink()) fail(`${path} must be a regular non-symlink file`)
  const bytes = new Uint8Array(readFileSync(absolute))
  if (bytes.byteLength < 2 || bytes.at(-1) !== 0x0a || bytes.includes(0x0d)) fail(`${path} must use LF with a final LF`)
  new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  return bytes
}

function installCreateOnly(path: string, bytes: Uint8Array): void {
  const absolute = join(repositoryRoot, path)
  try {
    const stat = lstatSync(absolute)
    if (!stat.isFile() || stat.isSymbolicLink()) fail(`${path} exists but is not a regular file`)
    sameBytes(new Uint8Array(readFileSync(absolute)), bytes, path)
  } catch (error) {
    if (!isMissing(error)) throw error
    writeFileSync(absolute, bytes, { flag: "wx", mode: 0o644 })
  }
}

function encodeCanonicalJson(value: Json): Uint8Array {
  const canonical = (entry: Json): string => {
    if (entry === null || typeof entry === "boolean" || typeof entry === "number" || typeof entry === "string") return JSON.stringify(entry)
    if (Array.isArray(entry)) return `[${entry.map(canonical).join(",")}]`
    return `{${Object.keys(entry).sort(compareUtf8).map((key) => `${JSON.stringify(key)}:${canonical((entry as Record<string, Json>)[key]!)}`).join(",")}}`
  }
  return new TextEncoder().encode(canonical(value))
}

function appendLf(bytes: Uint8Array): Uint8Array {
  const result = new Uint8Array(bytes.byteLength + 1)
  result.set(bytes)
  result[result.byteLength - 1] = 0x0a
  return result
}

function exactKeys(value: Record<string, Json>, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort(compareUtf8)
  const sorted = [...expected].sort(compareUtf8)
  if (actual.length !== sorted.length || actual.some((key, index) => key !== sorted[index])) fail(`${label} keys differ`)
}

function ordinarySha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex")
}

function domainDigest(domain: string, bytes: Uint8Array): string {
  return createHash("sha256").update(domain).update(new Uint8Array([0])).update(bytes).digest("hex")
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left), Buffer.from(right))
}

function requireValue<T>(map: ReadonlyMap<string, T>, key: string): T {
  const value = map.get(key)
  if (value === undefined) fail(`missing ${key}`)
  return value
}

function isSha(value: Json): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/u.test(value)
}

function sameBytes(left: Uint8Array, right: Uint8Array, label: string): void {
  if (left.byteLength !== right.byteLength) fail(`${label} byte length differs`)
  let difference = 0
  for (let index = 0; index < left.byteLength; index += 1) difference |= left[index]! ^ right[index]!
  if (difference !== 0) fail(`${label} bytes differ`)
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT"
}

function fail(message: string): never {
  throw new Error(message)
}

if (import.meta.main) {
  const release = generateSuccessorAuthorityReleaseV1()
  if (process.argv.includes("--check")) verifyGeneratedSuccessorAuthorityReleaseV1(release)
  else installGeneratedSuccessorAuthorityReleaseV1(release)
  console.log(JSON.stringify({
    manifestSha256: release.manifestSha256,
    protocolBundleSha256: release.protocolBundleSha256,
    protocolDigest: release.protocolDigest,
  }))
}
