import { createHash } from "node:crypto"
import { lstatSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const releaseDirectory = "docs/superpowers/specs/authorities/collaboration-v10/r5"
const paths = {
  uri: "docs/superpowers/specs/2026-07-31-global-uri-protocol.md",
  canvas: `${releaseDirectory}/appendices/canvas-schema.md`,
  kernel: `${releaseDirectory}/appendices/collaboration-kernel.md`,
  control: `${releaseDirectory}/appendices/control-plane.md`,
  project: `${releaseDirectory}/appendices/project-persistence.md`,
  main: `${releaseDirectory}/main.md`,
  bundle: `${releaseDirectory}/protocol-schema-bundle-v2.json`,
  manifest: `${releaseDirectory}/authority.sha256`,
} as const

const artifactDefinitions = [
  { name: "canvas-schema", format: "convax.canvas-protocol-schema/2", path: paths.canvas },
  { name: "collaboration-kernel", format: "convax.collaboration-kernel-protocol-schema/2", path: paths.kernel },
  { name: "control-plane", format: "convax.control-plane-protocol-schema/2", path: paths.control },
  { name: "project-persistence", format: "convax.project-persistence-protocol-schema/2", path: paths.project },
] as const

const domainDefinitions = [
  {
    owner: "kernel",
    path: paths.kernel,
    marker: "Kernel-owned domains are exactly:",
    fence: "```text",
    count: 19,
  },
  {
    owner: "control",
    path: paths.control,
    marker: "The control-plane artifact contributes the following exactly 62 closed domains",
    fence: "```text",
    count: 62,
  },
  {
    owner: "project",
    path: paths.project,
    marker: "The Project owner contributes exactly the following seventeen digest domains",
    fence: "```text",
    count: 17,
  },
  {
    owner: "canvas",
    path: paths.canvas,
    marker: "The Canvas owner contributes exactly these 29 strict UTF-8-sorted, duplicate-free",
    fence: "~~~text",
    count: 29,
  },
] as const

const encoder = new TextEncoder()
const decoder = new TextDecoder("utf-8", { fatal: true })

type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json }

export interface GeneratedAuthorityReleaseV1 {
  readonly bundleBytes: Uint8Array
  readonly manifestBytes: Uint8Array
  readonly protocolBundleSha256: string
  readonly protocolDigest: string
  readonly manifestSha256: string
}

export function generateAuthorityReleaseV1(): GeneratedAuthorityReleaseV1 {
  const inputs = new Map<string, Uint8Array>()
  for (const path of [paths.uri, paths.canvas, paths.kernel, paths.control, paths.project, paths.main]) {
    inputs.set(path, readCompleteTextFile(path))
  }

  const texts = new Map([...inputs].map(([path, bytes]) => [path, decoder.decode(bytes)]))
  const artifacts = artifactDefinitions.map(({ name, format, path }) => ({
    name,
    format,
    artifactDigest: domainDigest("convax.protocol-schema-artifact/2", requireMapValue(inputs, path)),
  }))

  const ownerDomains = domainDefinitions.map((definition) => {
    const domains = extractTextFence(requireMapValue(texts, definition.path), definition.marker, definition.fence)
      .split("\n")
      .filter((line) => line.length > 0)
    requireExactCount(domains, definition.count, `${definition.owner} domains`)
    requireDistinct(domains, `${definition.owner} domains`)
    for (const domain of domains) {
      if (!/^convax\.[a-z0-9-]+\/2$/u.test(domain)) fail(`${definition.owner} has invalid domain ${domain}`)
    }
    return domains
  })
  const domainRegistry = ownerDomains.flat().sort(compareUtf8)
  requireExactCount(domainRegistry, 127, "domain registry")
  requireDistinct(domainRegistry, "domain registry")

  const kernelText = requireMapValue(texts, paths.kernel)
  const controlText = requireMapValue(texts, paths.control)
  const typeNamespaces = parseExactJsonFence(
    kernelText,
    "The exact `typeNamespaces` tuple is:",
  )
  if (!Array.isArray(typeNamespaces) || typeNamespaces.length !== 5) fail("typeNamespaces must contain exactly five entries")

  const yjsWireCodec = parseLiteralInterface(kernelText, "YjsWireCodecV2")
  requireExactKeys(
    yjsWireCodec,
    ["applyCodec", "format", "package", "packageIntegrity", "stateVectorCodec", "updateCodec", "updateVersion", "version"],
    "YjsWireCodecV2",
  )
  if (yjsWireCodec.format !== "convax.yjs-wire-codec/2" || yjsWireCodec.package !== "yjs") {
    fail("YjsWireCodecV2 discriminators are invalid")
  }

  const limits = parseLiteralInterface(controlText, "ProtocolLimitsV2")
  requireExactCount(Object.keys(limits), 73, "ProtocolLimitsV2 fields")
  if (limits.format !== "convax.protocol-limits/2") fail("ProtocolLimitsV2 format is invalid")

  const channelContract = parsePeerChannelContract(controlText)
  const core = {
    format: "convax.protocol-schema-bundle-core/2",
    protocolMajor: "2",
    artifacts,
    typeNamespaces,
    domainRegistry,
    yjsWireCodec,
    uriProtocolDigest: ordinarySha256(requireMapValue(inputs, paths.uri)),
    limitsDigest: domainDigest("convax.protocol-limits/2", encodeRestrictedJcs(limits)),
    channelContractDigest: domainDigest("convax.peer-channel-contract/2", encodeRestrictedJcs(channelContract)),
  } satisfies Json
  const protocolDigest = domainDigest("convax.protocol-schema-bundle-core/2", encodeRestrictedJcs(core))
  const bundle = {
    format: "convax.protocol-schema-bundle/2",
    core,
    coreDigest: protocolDigest,
    protocolDigest,
  } satisfies Json
  const bundleBytes = appendLf(encodeRestrictedJcs(bundle))
  const reparsed = JSON.parse(decoder.decode(bundleBytes.subarray(0, bundleBytes.byteLength - 1))) as Json
  requireSameBytes(encodeRestrictedJcs(reparsed), bundleBytes.subarray(0, bundleBytes.byteLength - 1), "bundle re-encode")

  const memberBytes = new Map(inputs)
  memberBytes.set(paths.bundle, bundleBytes)
  const manifestPaths = [paths.uri, paths.canvas, paths.kernel, paths.control, paths.project, paths.main, paths.bundle]
    .sort(compareUtf8)
  requireExactCount(manifestPaths, 7, "manifest members")
  requireDistinct(manifestPaths, "manifest members")
  const manifestBytes = encoder.encode(
    `${manifestPaths.map((path) => `${ordinarySha256(requireMapValue(memberBytes, path))}  ${path}`).join("\n")}\n`,
  )

  return Object.freeze({
    bundleBytes: new Uint8Array(bundleBytes),
    manifestBytes: new Uint8Array(manifestBytes),
    protocolBundleSha256: ordinarySha256(bundleBytes),
    protocolDigest,
    manifestSha256: ordinarySha256(manifestBytes),
  })
}

export function verifyGeneratedAuthorityReleaseV1(release: GeneratedAuthorityReleaseV1): void {
  requireSameBytes(readCompleteTextFile(paths.bundle), release.bundleBytes, "installed bundle")
  requireSameBytes(readCompleteTextFile(paths.manifest), release.manifestBytes, "installed manifest")
}

function install(release: GeneratedAuthorityReleaseV1): void {
  const temporary = mkdtempSync(join(tmpdir(), "convax-collaboration-authority-"))
  try {
    const temporaryBundle = join(temporary, "protocol-schema-bundle-v2.json")
    const temporaryManifest = join(temporary, "authority.sha256")
    writeFileSync(temporaryBundle, release.bundleBytes, { flag: "wx", mode: 0o600 })
    writeFileSync(temporaryManifest, release.manifestBytes, { flag: "wx", mode: 0o600 })
    requireSameBytes(new Uint8Array(readFileSync(temporaryBundle)), release.bundleBytes, "temporary bundle")
    requireSameBytes(new Uint8Array(readFileSync(temporaryManifest)), release.manifestBytes, "temporary manifest")
    installCreateOnly(paths.bundle, release.bundleBytes)
    installCreateOnly(paths.manifest, release.manifestBytes)
    verifyGeneratedAuthorityReleaseV1(release)
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
}

function installCreateOnly(path: string, bytes: Uint8Array): void {
  const absolutePath = join(repositoryRoot, path)
  try {
    const existing = lstatSync(absolutePath)
    if (!existing.isFile() || existing.isSymbolicLink()) fail(`${path} exists but is not a regular non-symlink file`)
    requireSameBytes(new Uint8Array(readFileSync(absolutePath)), bytes, path)
  } catch (error) {
    if (!isMissing(error)) throw error
    writeFileSync(absolutePath, bytes, { flag: "wx", mode: 0o644 })
  }
}

function readCompleteTextFile(path: string): Uint8Array {
  const absolutePath = join(repositoryRoot, path)
  const stat = lstatSync(absolutePath)
  if (!stat.isFile() || stat.isSymbolicLink()) fail(`${path} must be a regular non-symlink file`)
  const bytes = new Uint8Array(readFileSync(absolutePath))
  try {
    decoder.decode(bytes)
  } catch (error) {
    throw new Error(`${path} must be valid UTF-8`, { cause: error })
  }
  if (bytes.byteLength < 2 || bytes.at(-1) !== 0x0a || bytes.at(-2) === 0x0a || bytes.includes(0x0d)) {
    fail(`${path} must use LF and have exactly one final LF`)
  }
  return bytes
}

function extractTextFence(text: string, marker: string, fence: "```text" | "~~~text"): string {
  requireUnique(text, marker)
  const markerIndex = text.indexOf(marker)
  const start = text.indexOf(`${fence}\n`, markerIndex)
  if (start < 0) fail(`missing ${fence} after ${marker}`)
  const contentStart = start + fence.length + 1
  const end = text.indexOf(`\n${fence.slice(0, 3)}`, contentStart)
  if (end < 0) fail(`unterminated ${fence} after ${marker}`)
  return text.slice(contentStart, end)
}

function parseExactJsonFence(text: string, marker: string): Json {
  const exactText = extractFenceWithArbitraryTag(text, marker, "```json")
  const value = JSON.parse(exactText) as Json
  const source = encodeRestrictedJcs(value)
  const exact = encoder.encode(exactText)
  requireSameBytes(source, exact, marker)
  return value
}

function extractFenceWithArbitraryTag(text: string, marker: string, fence: string): string {
  requireUnique(text, marker)
  const start = text.indexOf(`${fence}\n`, text.indexOf(marker))
  if (start < 0) fail(`missing ${fence} after ${marker}`)
  const contentStart = start + fence.length + 1
  const end = text.indexOf("\n```", contentStart)
  if (end < 0) fail(`unterminated ${fence} after ${marker}`)
  return text.slice(contentStart, end)
}

function parseLiteralInterface(text: string, name: string): Record<string, string> {
  const block = extractInterface(text, name)
  const value: Record<string, string> = {}
  for (const line of block.slice(block.indexOf("{") + 1, -1).split("\n")) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    const match = /^(?:readonly )?([A-Za-z][A-Za-z0-9]*): "([^"]*)"$/u.exec(trimmed)
    if (!match) fail(`${name} contains a non-literal field: ${trimmed}`)
    const [, key, literal] = match
    if (key in value) fail(`${name} repeats ${key}`)
    value[key] = literal
  }
  return value
}

function parsePeerChannelContract(text: string): Json {
  const block = extractInterface(text, "PeerChannelContractV2")
  const format = requireLiteral(block, "format")
  const awarenessTtlMs = requireLiteral(block, "awarenessTtlMs")
  const malformedStrikeCloseThreshold = requireLiteral(block, "malformedStrikeCloseThreshold")
  const policies = [...block.matchAll(/\{\s*channel: "([^"]+)"; reliability: "([^"]+)"\s*maxBodyBytes: "([^"]+)"; maxRawChunkBytes: (null|"[^"]+")\s*maxInflightPerPeer: (null|"[^"]+"); queuePriority: "([^"]+)"\s*\}/gu)]
    .map((match) => ({
      channel: match[1]!,
      reliability: match[2]!,
      maxBodyBytes: match[3]!,
      maxRawChunkBytes: parseNullableLiteral(match[4]!),
      maxInflightPerPeer: parseNullableLiteral(match[5]!),
      queuePriority: match[6]!,
    }))
  requireExactCount(policies, 4, "PeerChannelContractV2 policies")
  if (format !== "convax.peer-channel-contract/2") fail("PeerChannelContractV2 format is invalid")
  return { format, policies, awarenessTtlMs, malformedStrikeCloseThreshold }
}

function extractInterface(text: string, name: string): string {
  const marker = `interface ${name} {`
  requireUnique(text, marker)
  const start = text.indexOf(marker)
  let depth = 0
  let inString = false
  for (let index = start; index < text.length; index += 1) {
    const character = text[index]!
    if (character === '"' && text[index - 1] !== "\\") inString = !inString
    if (inString) continue
    if (character === "{") depth += 1
    if (character === "}") {
      depth -= 1
      if (depth === 0) return text.slice(start, index + 1)
    }
  }
  fail(`unterminated ${name}`)
}

function requireLiteral(block: string, key: string): string {
  const matches = [...block.matchAll(new RegExp(`^\\s*${key}: "([^"]*)"$`, "gmu"))]
  if (matches.length !== 1) fail(`expected one ${key} literal`)
  return matches[0]![1]!
}

function parseNullableLiteral(value: string): string | null {
  return value === "null" ? null : value.slice(1, -1)
}

function encodeRestrictedJcs(value: Json): Uint8Array {
  return encoder.encode(canonicalize(value))
}

function canonicalize(value: Json): string {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalize(entry)).join(",")}]`
  const object = value as { readonly [key: string]: Json }
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(object[key]!)}`).join(",")}}`
}

function appendLf(bytes: Uint8Array): Uint8Array {
  const result = new Uint8Array(bytes.byteLength + 1)
  result.set(bytes)
  result[result.byteLength - 1] = 0x0a
  return result
}

function ordinarySha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex")
}

function domainDigest(domain: string, bytes: Uint8Array): string {
  return createHash("sha256").update(domain, "utf8").update(new Uint8Array([0])).update(bytes).digest("hex")
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"))
}

function requireUnique(text: string, marker: string): void {
  const first = text.indexOf(marker)
  if (first < 0 || first !== text.lastIndexOf(marker)) fail(`expected unique marker: ${marker}`)
}

function requireExactKeys(value: Record<string, string>, keys: readonly string[], label: string): void {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(`${label} keys differ`)
  }
}

function requireExactCount(value: { readonly length: number }, expected: number, label: string): void {
  if (value.length !== expected) fail(`${label} has ${value.length}, expected ${expected}`)
}

function requireDistinct(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) fail(`${label} contains a duplicate`)
}

function requireSameBytes(actual: Uint8Array, expected: Uint8Array, label: string): void {
  if (actual.byteLength !== expected.byteLength) fail(`${label} byte length differs`)
  let difference = 0
  for (let index = 0; index < actual.byteLength; index += 1) difference |= actual[index]! ^ expected[index]!
  if (difference !== 0) fail(`${label} bytes differ`)
}

function requireMapValue<T>(map: ReadonlyMap<string, T>, key: string): T {
  const value = map.get(key)
  if (value === undefined) fail(`missing fixed input ${key}`)
  return value
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT"
}

function fail(message: string): never {
  throw new Error(message)
}

if (import.meta.main) {
  const release = generateAuthorityReleaseV1()
  if (process.argv.includes("--check")) {
    verifyGeneratedAuthorityReleaseV1(release)
  } else {
    install(release)
  }
  console.log(JSON.stringify({
    manifestSha256: release.manifestSha256,
    protocolBundleSha256: release.protocolBundleSha256,
    protocolDigest: release.protocolDigest,
  }))
}
