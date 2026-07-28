import {
  canonicalJson,
  classifyServerPackageForCatalog,
  parseBuiltinBundleArchive,
  parseMarketplaceDescriptor,
  parseMcpServerExtension,
  parseRegistryV1,
  parseRegistryV2,
  parseShowcaseV2,
  projectRegistryV1,
  sha256Hex,
  identityKeyForMcpServer,
  versionKeyForMcpServer,
  type McpManagedStdioDelivery,
  type ParsedServerPackage,
  type RegistryPackage,
  type RegistryV1,
  type RegistryV2,
  type ShowcaseV2,
} from "@convax/marketplace"
import { chmod, lstat, mkdir, open, readdir, readFile, realpath, rename, unlink, writeFile } from "node:fs/promises"
import { constants } from "node:fs"
import { basename, dirname, join, relative, resolve, sep } from "node:path"
import { execFile } from "node:child_process"
import { promisify } from "node:util"

export type StarterKind = "plugin" | "skill" | "mcp-server"

export interface StarterOptions {
  id: string
  name: string
  owner: string
  repository: string
  starter: StarterKind
}

export interface BuildMarketplaceOptions {
  root: string
  outDir: string
  official?: boolean
  sequence?: number
  previousRegistryPath?: string
  bootstrapPreviousV1Path?: string
  initialOfficial?: boolean
  v1Revision?: string
  publishIdentities?: readonly string[]
}

export interface MarketplaceBuildResult {
  registry: RegistryV2
  registrySha256: string
  registryV1?: RegistryV1
  showcase: ShowcaseV2
  artifacts: Array<{
    path: string
    size: number
    sha256: string
    releaseTag: string
    url: string
    kind: StarterKind
    id: string
    version: string
  }>
  releasePlan: {
    schema: "convax.release-plan/1"
    releases: Array<{
      tag: string
      assets: Array<{ path: string; name: string; size: number; sha256: string; url: string }>
    }>
  }
  productLockInput: Record<string, unknown>
}

interface DiscoveredPackage {
  kind: StarterKind
  id: string
  version: string
  root: string
  contentRoot: string
  presentation: { name: string; description?: string }
  authoring?: Record<string, unknown>
  manifest?: Record<string, unknown>
  server?: Record<string, unknown>
  extension?: ReturnType<typeof parseMcpServerExtension>
  catalogSupported?: boolean
  mcpRuntime?: ParsedServerPackage["runtime"]
}

const MARKERS: Readonly<Record<StarterKind, string>> = {
  plugin: "manifest.json",
  skill: "SKILL.md",
  "mcp-server": "server.json",
}
const KIND_DIRECTORY: Readonly<Record<StarterKind, string>> = {
  plugin: "plugins",
  skill: "skills",
  "mcp-server": "mcp-servers",
}
const TARGET = /^(darwin|linux|win32)-(arm64|x64)$/
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const execFileAsync = promisify(execFile)

function jsonBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(`${canonicalJson(value)}\n`)
}

async function atomicWrite(path: string, bytes: Uint8Array | string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.tmp-${process.pid}-${crypto.randomUUID()}`
  await writeFile(temporary, bytes, { mode: 0o600 })
  await rename(temporary, path)
}

async function readStableRegularFile(
  path: string,
  label: string,
  maxSize: number,
): Promise<{ bytes: Uint8Array; mode: number }> {
  const before = await lstat(path, { bigint: true })
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n) {
    throw new TypeError(`${label} must be a regular single-link no-follow file`)
  }
  if (before.size < 1n || before.size > BigInt(maxSize)) throw new TypeError(`${label} exceeds its byte limit`)
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const opened = await handle.stat({ bigint: true })
    if (
      !opened.isFile() ||
      opened.nlink !== 1n ||
      opened.dev !== before.dev ||
      opened.ino !== before.ino ||
      opened.size !== before.size
    ) {
      throw new TypeError(`${label} changed before read`)
    }
    const bytes = new Uint8Array(Number(opened.size))
    let offset = 0
    while (offset < bytes.byteLength) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.byteLength - offset, offset)
      if (bytesRead < 1) throw new TypeError(`${label} changed during read`)
      offset += bytesRead
    }
    const after = await handle.stat({ bigint: true })
    const pathAfter = await lstat(path, { bigint: true })
    if (
      after.dev !== opened.dev ||
      after.ino !== opened.ino ||
      after.size !== opened.size ||
      after.mtimeNs !== opened.mtimeNs ||
      after.ctimeNs !== opened.ctimeNs ||
      pathAfter.dev !== opened.dev ||
      pathAfter.ino !== opened.ino ||
      pathAfter.size !== opened.size ||
      pathAfter.mtimeNs !== opened.mtimeNs ||
      pathAfter.ctimeNs !== opened.ctimeNs ||
      pathAfter.nlink !== 1n
    ) {
      throw new TypeError(`${label} changed during read`)
    }
    return { bytes, mode: Number(opened.mode) }
  } finally {
    await handle.close()
  }
}

function assertSegment(value: string, label: string): void {
  if (!SAFE_SEGMENT.test(value) || WINDOWS_RESERVED.test(value) || value.endsWith(".") || value.endsWith(" ")) {
    throw new TypeError(`${label} is not a safe portable path segment`)
  }
}

async function readJson(path: string, label: string): Promise<unknown> {
  const { bytes } = await readStableRegularFile(path, label, 1024 * 1024)
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))
  } catch {
    throw new TypeError(`${label} is not valid UTF-8 JSON`)
  }
}

function parseSkill(
  markdown: string,
  directoryName: string,
): { id: string; version: string; name: string; description?: string } {
  if (!markdown.startsWith("---\n")) throw new TypeError("SKILL.md must start with YAML frontmatter")
  const end = markdown.indexOf("\n---", 4)
  if (end < 0) throw new TypeError("SKILL.md frontmatter is not closed")
  const fields = new Map<string, string>()
  for (const line of markdown.slice(4, end).split("\n")) {
    const separator = line.indexOf(":")
    if (separator <= 0) continue
    fields.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim())
  }
  const id = fields.get("name") ?? directoryName
  const version = fields.get("version") ?? "0.1.0"
  assertSegment(id, "Skill name")
  return {
    id,
    version,
    name: fields.get("title") ?? id,
    ...(fields.get("description") ? { description: fields.get("description") } : {}),
  }
}

async function classifyPackageRoot(packageRoot: string): Promise<StarterKind> {
  const matches: StarterKind[] = []
  for (const kind of Object.keys(MARKERS) as StarterKind[]) {
    const path = join(packageRoot, MARKERS[kind])
    const info = await lstat(path).catch(() => undefined)
    if (info) {
      if (!info.isFile() || info.isSymbolicLink())
        throw new TypeError(`${MARKERS[kind]} must be a regular no-follow file`)
      matches.push(kind)
    }
  }
  if (matches.length !== 1) throw new TypeError("package root must contain exactly one supported root marker")
  return matches[0]
}

async function inspectPackage(packageRoot: string, expected?: StarterKind): Promise<DiscoveredPackage> {
  const info = await lstat(packageRoot)
  if (!info.isDirectory() || info.isSymbolicLink()) throw new TypeError("package root must be a no-follow directory")
  const authoringPath = join(packageRoot, "convax-package.json")
  const authoring = await readJson(authoringPath, "convax-package.json").catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
    throw error
  })
  const contentRoot = authoring === undefined ? packageRoot : join(packageRoot, "package")
  const authoringKind =
    authoring && typeof authoring === "object" && !Array.isArray(authoring)
      ? (authoring as Record<string, unknown>).kind
      : undefined
  const kind =
    authoringKind === "plugin" || authoringKind === "skill" || authoringKind === "mcp-server"
      ? authoringKind
      : await classifyPackageRoot(contentRoot)
  if (authoring !== undefined) {
    const markerInfo = await lstat(join(contentRoot, MARKERS[kind])).catch(() => undefined)
    if (!markerInfo?.isFile() || markerInfo.isSymbolicLink()) {
      throw new TypeError(`authoring metadata kind ${kind} requires ${MARKERS[kind]} in package/`)
    }
  }
  if (expected && kind !== expected) throw new TypeError(`package marker does not match ${expected}`)
  const directoryName = basename(packageRoot)
  if (kind === "plugin") {
    const manifest = (await readJson(join(contentRoot, "manifest.json"), "manifest.json")) as Record<string, unknown>
    const metadata = authoring as Record<string, unknown> | undefined
    const id =
      typeof metadata?.id === "string" ? metadata.id : typeof manifest.id === "string" ? manifest.id : directoryName
    const version =
      typeof metadata?.version === "string"
        ? metadata.version
        : typeof manifest.version === "string"
          ? manifest.version
          : undefined
    if (!version) throw new TypeError("Plugin manifest must contain version")
    if (metadata && (metadata.kind !== "plugin" || manifest.id !== id || manifest.version !== version)) {
      throw new TypeError("Plugin authoring metadata does not match package manifest")
    }
    assertSegment(id, "Plugin id")
    return {
      kind,
      id,
      version,
      root: packageRoot,
      contentRoot,
      presentation: {
        name:
          typeof metadata?.name === "string" ? metadata.name : typeof manifest.name === "string" ? manifest.name : id,
        ...(typeof metadata?.description === "string"
          ? { description: metadata.description }
          : typeof manifest.description === "string"
            ? { description: manifest.description }
            : {}),
      },
      manifest,
      ...(metadata ? { authoring: metadata } : {}),
    }
  }
  if (kind === "skill") {
    const markdown = await readFile(join(contentRoot, "SKILL.md"), "utf8")
    const skill = parseSkill(markdown, directoryName)
    const metadata = authoring as Record<string, unknown> | undefined
    const id = typeof metadata?.id === "string" ? metadata.id : skill.id
    const version = typeof metadata?.version === "string" ? metadata.version : skill.version
    if (metadata && metadata.kind !== "skill") throw new TypeError("Skill authoring metadata kind mismatch")
    return {
      kind,
      id,
      version,
      root: packageRoot,
      contentRoot,
      presentation: {
        name: typeof metadata?.name === "string" ? metadata.name : skill.name,
        ...(typeof metadata?.description === "string"
          ? { description: metadata.description }
          : skill.description
            ? { description: skill.description }
            : {}),
      },
      ...(metadata ? { authoring: metadata } : {}),
    }
  }
  const server = (await readJson(join(contentRoot, "server.json"), "server.json")) as Record<string, unknown>
  const extensionPath = join(contentRoot, "convax-mcp.json")
  const extensionJson = await readJson(extensionPath, "convax-mcp.json").catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
    throw error
  })
  const extension = extensionJson === undefined ? undefined : parseMcpServerExtension(extensionJson)
  const admission = classifyServerPackageForCatalog(server, extension)
  const parsed = admission.supported ? admission.package : admission
  return {
    kind,
    id: parsed.id,
    version: parsed.version,
    root: packageRoot,
    contentRoot,
    presentation: {
      name: typeof server.title === "string" ? server.title : parsed.id,
      ...(typeof server.description === "string" ? { description: server.description } : {}),
    },
    server,
    catalogSupported: admission.supported,
    ...(admission.supported ? { mcpRuntime: admission.package.runtime } : {}),
    ...(authoring ? { authoring: authoring as Record<string, unknown> } : {}),
    ...(extension ? { extension } : {}),
  }
}

async function listPackageRoots(root: string): Promise<Array<{ kind: StarterKind; root: string }>> {
  const result: Array<{ kind: StarterKind; root: string }> = []
  for (const kind of Object.keys(KIND_DIRECTORY) as StarterKind[]) {
    const parent = join(root, "packages", KIND_DIRECTORY[kind])
    const entries = await readdir(parent, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return []
      throw error
    })
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue
      if (!entry.isDirectory() || entry.isSymbolicLink()) throw new TypeError(`invalid package entry ${entry.name}`)
      assertSegment(entry.name, "package directory")
      result.push({ kind, root: join(parent, entry.name) })
    }
  }
  return result.sort((left, right) => compareAscii(`${left.kind}/${left.root}`, `${right.kind}/${right.root}`))
}

export async function discoverMarketplacePackages(root: string): Promise<DiscoveredPackage[]> {
  const packages = await Promise.all(
    (await listPackageRoots(root)).map(async ({ kind, root: packageRoot }) => {
      try {
        return await inspectPackage(packageRoot, kind)
      } catch (error) {
        throw new TypeError(
          `${relative(root, packageRoot)}: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        )
      }
    }),
  )
  const identities = new Set<string>()
  for (const entry of packages) {
    const identity = `${entry.kind}\0${entry.id}`
    if (identities.has(identity)) throw new TypeError(`duplicate package identity ${entry.kind}/${entry.id}`)
    identities.add(identity)
  }
  return packages
}

export async function changedMarketplaceVersions(
  root: string,
  baseRevision: string,
): Promise<Array<{ kind: StarterKind; id: string; version: string; releaseTag: string }>> {
  const effectiveBaseRevision = /^0{40}$/.test(baseRevision) ? "4b825dc642cb6eb9a060e54bf8d69288fbee4904" : baseRevision
  const packages = await discoverMarketplacePackages(root)
  const git = async (args: string[]): Promise<string> => {
    const { stdout } = await execFileAsync("git", ["-C", root, ...args], {
      maxBuffer: 8 * 1024 * 1024,
    })
    return stdout
  }
  const dirtyReleaseInputs = await git([
    "status",
    "--porcelain",
    "--untracked-files=all",
    "--",
    "packages",
    "companions",
    ".marketplace",
  ])
  if (dirtyReleaseInputs.trim()) {
    throw new TypeError("release version selection requires a clean committed package closure")
  }
  const baseFiles = (
    await git([
      "ls-tree",
      "-r",
      "--name-only",
      effectiveBaseRevision,
      "--",
      "packages/plugins",
      "packages/skills",
      "packages/mcp-servers",
    ])
  )
    .split("\n")
    .filter(Boolean)
  const baseRoots = new Set<string>()
  for (const path of baseFiles) {
    const match = /^(packages\/(?:plugins|skills|mcp-servers)\/[^/]+)\//.exec(path)
    if (match) baseRoots.add(match[1])
  }
  const show = async (path: string): Promise<string | undefined> => {
    try {
      return await git(["show", `${effectiveBaseRevision}:${path}`])
    } catch (error) {
      const code = (error as { code?: unknown }).code
      if (code === 128 || code === "128") return undefined
      throw error
    }
  }
  const basePackages = new Map<string, { version: string; yanked: boolean }>()
  for (const packageRoot of [...baseRoots].sort()) {
    const authoringText = await show(`${packageRoot}/convax-package.json`)
    let kind: StarterKind
    let id: string
    let version: string
    let yanked = false
    if (authoringText !== undefined) {
      const authoring = JSON.parse(authoringText) as Record<string, unknown>
      if (authoring.kind !== "plugin" && authoring.kind !== "skill" && authoring.kind !== "mcp-server") {
        throw new TypeError(`base package ${packageRoot} has invalid authoring kind`)
      }
      kind = authoring.kind
      if (typeof authoring.id !== "string" || typeof authoring.version !== "string") {
        throw new TypeError(`base package ${packageRoot} has incomplete authoring identity`)
      }
      id = authoring.id
      version = authoring.version
      yanked = authoring.yanked === true
    } else if (packageRoot.startsWith("packages/plugins/")) {
      kind = "plugin"
      const manifestText = await show(`${packageRoot}/manifest.json`)
      if (!manifestText) continue
      const manifest = JSON.parse(manifestText) as Record<string, unknown>
      if (typeof manifest.id !== "string" || typeof manifest.version !== "string") {
        throw new TypeError(`base Plugin ${packageRoot} has incomplete identity`)
      }
      id = manifest.id
      version = manifest.version
    } else if (packageRoot.startsWith("packages/skills/")) {
      kind = "skill"
      const markdown = await show(`${packageRoot}/SKILL.md`)
      if (!markdown) continue
      const skill = parseSkill(markdown, basename(packageRoot))
      id = skill.id
      version = skill.version
    } else {
      kind = "mcp-server"
      const serverText = await show(`${packageRoot}/server.json`)
      if (!serverText) continue
      const extensionText = await show(`${packageRoot}/convax-mcp.json`)
      const admission = classifyServerPackageForCatalog(
        JSON.parse(serverText),
        extensionText === undefined ? undefined : JSON.parse(extensionText),
      )
      id = admission.supported ? admission.package.id : admission.id
      version = admission.supported ? admission.package.version : admission.version
    }
    const identity = `${kind}\0${id}`
    if (basePackages.has(identity)) throw new TypeError(`base tree has duplicate package identity ${kind}/${id}`)
    basePackages.set(identity, { version, yanked })
  }
  const currentByIdentity = new Map(packages.map((entry) => [`${entry.kind}\0${entry.id}`, entry]))
  const changed: Array<{ kind: StarterKind; id: string; version: string; releaseTag: string }> = []
  for (const [identity, previous] of basePackages) {
    if (!currentByIdentity.has(identity) && !previous.yanked) {
      const [kind, id] = identity.split("\0")
      throw new TypeError(`removed ${kind}/${id} must be published as yanked before deletion`)
    }
    if (!currentByIdentity.has(identity) && previous.yanked) {
      const [kind, id] = identity.split("\0") as [StarterKind, string]
      changed.push({
        kind,
        id,
        version: previous.version,
        releaseTag: releaseTagForPackage({ kind, id, version: previous.version }),
      })
    }
  }
  for (const entry of packages) {
    const previous = basePackages.get(`${entry.kind}\0${entry.id}`)
    if (!previous || previous.version !== entry.version) {
      changed.push({
        kind: entry.kind,
        id: entry.id,
        version: entry.version,
        releaseTag: releaseTagForPackage(entry),
      })
      continue
    }
    const closurePaths = new Set([relative(root, entry.root).split(sep).join("/")])
    if (entry.kind === "plugin") {
      for (const ownedSkill of packages) {
        if (ownedSkill.kind === "skill" && ownedSkill.authoring?.ownerPluginId === entry.id) {
          closurePaths.add(relative(root, ownedSkill.root).split(sep).join("/"))
        }
      }
      const companions = entry.authoring?.companions
      if (Array.isArray(companions)) {
        for (const companionValue of companions) {
          if (!companionValue || typeof companionValue !== "object" || Array.isArray(companionValue)) continue
          const companion = companionValue as Record<string, unknown>
          if (typeof companion.source !== "string" || !Array.isArray(companion.targets)) continue
          for (const targetValue of companion.targets) {
            if (!targetValue || typeof targetValue !== "object" || Array.isArray(targetValue)) continue
            const target = targetValue as Record<string, unknown>
            if (typeof target.path !== "string") continue
            closurePaths.add(
              relative(root, resolve(root, companion.source, target.path))
                .split(sep)
                .join("/"),
            )
          }
        }
      }
    } else if (entry.kind === "mcp-server" && entry.extension) {
      closurePaths.add(`.marketplace/companion-inputs/${sha256Hex(`mcp-server\0${entry.id}`)}`)
    }
    const paths = [...closurePaths].sort()
    let trackedChanged = false
    try {
      await execFileAsync("git", ["-C", root, "diff", "--quiet", effectiveBaseRevision, "--", ...paths])
    } catch (error) {
      const code = (error as { code?: unknown }).code
      if (code === 1 || code === "1") trackedChanged = true
      else throw error
    }
    const untracked = await git(["ls-files", "--others", "--exclude-standard", "--", ...paths])
    const ignored = await git(["ls-files", "--others", "--ignored", "--exclude-standard", "--", ...paths])
    if (trackedChanged || untracked.trim() || ignored.trim()) {
      throw new TypeError(
        `immutable ${entry.kind}/${entry.id}@${entry.version} closure changed without a version change`,
      )
    }
  }
  return changed.sort((left, right) => compareAscii(`${left.kind}/${left.id}`, `${right.kind}/${right.id}`))
}

interface InventoryEntry {
  path: string
  bytes: Uint8Array
  mode: number
}

function compareAscii(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

async function inventory(root: string, prefix = ""): Promise<InventoryEntry[]> {
  const entries = await readdir(root, { withFileTypes: true })
  const output: InventoryEntry[] = []
  for (const entry of entries.sort((left, right) => compareAscii(left.name, right.name))) {
    assertSegment(entry.name, "archive entry")
    const path = join(root, entry.name)
    const logicalPath = prefix ? `${prefix}/${entry.name}` : entry.name
    const info = await lstat(path)
    if (info.isSymbolicLink()) throw new TypeError(`symlink is forbidden: ${logicalPath}`)
    if (info.isDirectory()) {
      output.push(...(await inventory(path, logicalPath)))
    } else if (info.isFile()) {
      if (info.size > 32 * 1024 * 1024) throw new TypeError(`file is too large: ${logicalPath}`)
      const stable = await readStableRegularFile(path, logicalPath, 32 * 1024 * 1024)
      output.push({ path: logicalPath, bytes: stable.bytes, mode: stable.mode & 0o111 ? 0o755 : 0o644 })
    } else {
      throw new TypeError(`special file is forbidden: ${logicalPath}`)
    }
  }
  if (output.length > 4_096) throw new TypeError("package contains too many files")
  const total = output.reduce((sum, entry) => sum + entry.bytes.byteLength, 0)
  if (total > 128 * 1024 * 1024) throw new TypeError("package exceeds total byte limit")
  return output
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index++) {
    let value = index
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    table[index] = value >>> 0
  }
  return table
})()

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function u16(value: number): Uint8Array {
  const bytes = new Uint8Array(2)
  new DataView(bytes.buffer).setUint16(0, value, true)
  return bytes
}

function u32(value: number): Uint8Array {
  const bytes = new Uint8Array(4)
  new DataView(bytes.buffer).setUint32(0, value, true)
  return bytes
}

function concat(chunks: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0))
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return result
}

export function createDeterministicZip(entriesValue: readonly InventoryEntry[]): Uint8Array {
  const entries = [...entriesValue].sort((left, right) => compareAscii(left.path, right.path))
  if (entries.length < 1 || entries.length > 4_096) {
    throw new TypeError("deterministic ZIP entries must be a bounded non-empty collection")
  }
  let previousPath = ""
  const caseFoldedPaths = new Set<string>()
  let totalBytes = 0
  for (const entry of entries) {
    const encodedPath = new TextEncoder().encode(entry.path)
    if (
      !/^([A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+$/.test(entry.path) ||
      entry.path.split("/").some((segment) => segment === "..") ||
      encodedPath.byteLength > 256
    ) {
      throw new TypeError(`deterministic ZIP entry path is unsafe: ${entry.path}`)
    }
    if (previousPath === entry.path) throw new TypeError(`deterministic ZIP entry paths must be unique: ${entry.path}`)
    const caseFoldedPath = entry.path.toLocaleLowerCase("en-US")
    if (caseFoldedPaths.has(caseFoldedPath)) {
      throw new TypeError(`deterministic ZIP entry paths must be unique on case-insensitive filesystems: ${entry.path}`)
    }
    caseFoldedPaths.add(caseFoldedPath)
    if (entry.mode !== 0o644 && entry.mode !== 0o755) {
      throw new TypeError(`deterministic ZIP entry mode is unsupported: ${entry.path}`)
    }
    if (entry.bytes.byteLength > 128 * 1024 * 1024) {
      throw new TypeError(`deterministic ZIP entry is too large: ${entry.path}`)
    }
    totalBytes += entry.bytes.byteLength
    if (totalBytes > 128 * 1024 * 1024) throw new TypeError("deterministic ZIP content exceeds its byte limit")
    previousPath = entry.path
  }
  const localChunks: Uint8Array[] = []
  const centralChunks: Uint8Array[] = []
  let offset = 0
  for (const entry of entries) {
    const name = new TextEncoder().encode(entry.path)
    const crc = crc32(entry.bytes)
    const local = concat([
      u32(0x04034b50),
      u16(20),
      u16(0x0800),
      u16(0),
      u16(0),
      u16(33),
      u32(crc),
      u32(entry.bytes.byteLength),
      u32(entry.bytes.byteLength),
      u16(name.byteLength),
      u16(0),
      name,
      entry.bytes,
    ])
    localChunks.push(local)
    centralChunks.push(
      concat([
        u32(0x02014b50),
        u16(0x031e),
        u16(20),
        u16(0x0800),
        u16(0),
        u16(0),
        u16(33),
        u32(crc),
        u32(entry.bytes.byteLength),
        u32(entry.bytes.byteLength),
        u16(name.byteLength),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32((entry.mode & 0xffff) << 16),
        u32(offset),
        name,
      ]),
    )
    offset += local.byteLength
  }
  const central = concat(centralChunks)
  return concat([
    ...localChunks,
    central,
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(entries.length),
    u16(entries.length),
    u32(central.byteLength),
    u32(offset),
    u16(0),
  ])
}

function safeAssetSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, "_")
}

function mcpAssetStem(entry: Pick<DiscoveredPackage, "id" | "version">): string {
  return `${identityKeyForMcpServer(entry.id).slice(0, 16)}-${versionKeyForMcpServer(entry.id, entry.version)}`
}

function releaseTagForPackage(entry: Pick<DiscoveredPackage, "kind" | "id" | "version">): string {
  if (entry.kind === "mcp-server") {
    return `mcp-server-${identityKeyForMcpServer(entry.id).slice(0, 16)}-v${versionKeyForMcpServer(entry.id, entry.version)}`
  }
  return `${entry.kind}-${safeAssetSegment(entry.id)}-v${safeAssetSegment(entry.version)}`
}

function releaseUrl(descriptor: ReturnType<typeof parseMarketplaceDescriptor>, tag: string, asset: string): string {
  return `https://github.com/${descriptor.repository.owner}/${descriptor.repository.name}/releases/download/${tag}/${asset}`
}

async function packageInventory(
  entry: DiscoveredPackage,
  allPackages: readonly DiscoveredPackage[],
): Promise<InventoryEntry[]> {
  const entries = await inventory(entry.contentRoot)
  if (entry.kind !== "plugin" || !entry.manifest) return entries
  const contributes = entry.manifest.contributes
  if (!contributes || typeof contributes !== "object" || Array.isArray(contributes)) return entries
  const skills = (contributes as Record<string, unknown>).skills
  if (!Array.isArray(skills)) return entries
  for (const skillValue of skills) {
    if (!skillValue || typeof skillValue !== "object" || Array.isArray(skillValue)) {
      throw new TypeError(`Plugin ${entry.id} has invalid owned Skill declaration`)
    }
    const declaration = skillValue as Record<string, unknown>
    if (typeof declaration.name !== "string" || typeof declaration.path !== "string") {
      throw new TypeError(`Plugin ${entry.id} has incomplete owned Skill declaration`)
    }
    if (
      declaration.path.startsWith("/") ||
      declaration.path.includes("\\") ||
      declaration.path.split("/").some((segment) => segment === ".." || segment === "" || !SAFE_SEGMENT.test(segment))
    ) {
      throw new TypeError(`Plugin ${entry.id} owned Skill path is unsafe`)
    }
    const declaredRoot = join(entry.contentRoot, ...declaration.path.split("/"))
    const declaredState = await lstat(declaredRoot).catch(() => undefined)
    const skill = declaredState?.isDirectory()
      ? undefined
      : allPackages.find(
          (candidate) =>
            candidate.kind === "skill" &&
            candidate.id === declaration.name &&
            candidate.authoring?.ownerPluginId === entry.id,
        )
    if (!declaredState && !skill) throw new TypeError(`Plugin ${entry.id} owned Skill ${declaration.name} is missing`)
    const ownedEntries = await inventory(declaredState ? declaredRoot : skill!.contentRoot, declaration.path)
    for (const ownedEntry of ownedEntries) {
      if (entries.some((existing) => existing.path === ownedEntry.path)) {
        throw new TypeError(`Plugin ${entry.id} owned Skill path collides with package content`)
      }
      entries.push(ownedEntry)
    }
  }
  entries.sort((left, right) => compareAscii(left.path, right.path))
  return entries
}

async function companionInputs(
  root: string,
  entry: DiscoveredPackage,
  tag: string,
  descriptor: ReturnType<typeof parseMarketplaceDescriptor>,
  outDir?: string,
  artifacts?: MarketplaceBuildResult["artifacts"],
): Promise<McpManagedStdioDelivery["companions"]> {
  if (!entry.extension) return []
  const itemKey = sha256Hex(`mcp-server\0${entry.id}`)
  const base = join(root, ".marketplace", "companion-inputs", itemKey)
  const companions = []
  for (const target of entry.extension.runtime.compatibility.targets) {
    const targetRoot = join(base, target)
    const files = await readdir(targetRoot, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return []
      throw error
    })
    if (files.length !== 1)
      throw new TypeError(`managed MCP ${entry.id} target ${target} must have exactly one companion input`)
    const candidate = files[0]
    if (!candidate.isFile() || candidate.isSymbolicLink() || candidate.name !== entry.extension.runtime.command) {
      throw new TypeError(`managed MCP ${entry.id} companion command mismatch`)
    }
    const { bytes } = await readStableRegularFile(
      join(targetRoot, candidate.name),
      `managed MCP ${entry.id} ${target} companion`,
      128 * 1024 * 1024,
    )
    const asset = `${mcpAssetStem(entry)}-${target}-${candidate.name}`
    const url = releaseUrl(descriptor, tag, asset)
    if (outDir && artifacts) {
      const path = join(outDir, "releases", tag, asset)
      await atomicWrite(path, bytes)
      artifacts.push({
        path,
        size: bytes.byteLength,
        sha256: sha256Hex(bytes),
        releaseTag: tag,
        url,
        kind: entry.kind,
        id: entry.id,
        version: entry.version,
      })
    }
    companions.push({
      target,
      command: candidate.name,
      url,
      size: bytes.byteLength,
      sha256: sha256Hex(bytes),
    })
  }
  return companions
}

async function pluginCompanions(
  root: string,
  entry: DiscoveredPackage,
  tag: string,
  descriptor: ReturnType<typeof parseMarketplaceDescriptor>,
  outDir?: string,
  artifacts?: MarketplaceBuildResult["artifacts"],
): Promise<RegistryPackage["companions"]> {
  const definitions = entry.authoring?.companions
  if (definitions === undefined) return undefined
  if (!Array.isArray(definitions) || definitions.length === 0 || definitions.length > 16) {
    throw new TypeError(`Plugin ${entry.id} companions must be a bounded array`)
  }
  const result: NonNullable<RegistryPackage["companions"]> = []
  const commands = new Set<string>()
  for (const definitionValue of definitions) {
    if (!definitionValue || typeof definitionValue !== "object" || Array.isArray(definitionValue)) {
      throw new TypeError(`Plugin ${entry.id} companion must be an object`)
    }
    const definition = definitionValue as Record<string, unknown>
    if (
      Object.keys(definition).sort().join(",") !== "command,source,targets,version" ||
      typeof definition.command !== "string" ||
      typeof definition.version !== "string" ||
      typeof definition.source !== "string" ||
      !Array.isArray(definition.targets) ||
      !/^[A-Za-z0-9._-]+$/.test(definition.command) ||
      WINDOWS_RESERVED.test(definition.command) ||
      !/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(
        definition.version,
      )
    ) {
      throw new TypeError(`Plugin ${entry.id} companion metadata is incomplete`)
    }
    if (commands.has(definition.command)) throw new TypeError(`Plugin ${entry.id} has duplicate companion command`)
    commands.add(definition.command)
    const targets: NonNullable<RegistryPackage["companions"]>[number]["targets"] = []
    const targetKeys = new Set<string>()
    for (const targetValue of definition.targets) {
      if (!targetValue || typeof targetValue !== "object" || Array.isArray(targetValue)) {
        throw new TypeError(`Plugin ${entry.id} companion target must be an object`)
      }
      const target = targetValue as Record<string, unknown>
      if (
        Object.keys(target).sort().join(",") !== "arch,path,platform" ||
        (target.platform !== "darwin" && target.platform !== "linux" && target.platform !== "win32") ||
        (target.arch !== "arm64" && target.arch !== "x64") ||
        typeof target.path !== "string"
      ) {
        throw new TypeError(`Plugin ${entry.id} companion target is invalid`)
      }
      const targetKey = `${target.platform}-${target.arch}`
      if (targetKeys.has(targetKey)) throw new TypeError(`Plugin ${entry.id} has duplicate companion target`)
      targetKeys.add(targetKey)
      const source = resolve(root, definition.source, target.path)
      const relativeSource = relative(root, source)
      if (!relativeSource || relativeSource.startsWith(`..${sep}`) || relativeSource === "..") {
        throw new TypeError(`Plugin ${entry.id} companion escapes the Marketplace root`)
      }
      const sourceInfo = await lstat(source)
      if (!sourceInfo.isFile() || sourceInfo.isSymbolicLink()) {
        throw new TypeError(`Plugin ${entry.id} companion must be a regular no-follow file`)
      }
      const { bytes } = await readStableRegularFile(source, `Plugin ${entry.id} companion`, 128 * 1024 * 1024)
      if (bytes.byteLength === 0 || bytes.byteLength > 128 * 1024 * 1024) {
        throw new TypeError(`Plugin ${entry.id} companion size is invalid`)
      }
      const assetName = `${safeAssetSegment(entry.id)}-${safeAssetSegment(definition.version)}-${target.platform}-${target.arch}-${definition.command}`
      const artifactUrl = releaseUrl(descriptor, tag, assetName)
      const artifactSha256 = sha256Hex(bytes)
      if (outDir && artifacts) {
        const artifactPath = join(outDir, "releases", tag, assetName)
        await atomicWrite(artifactPath, bytes)
        artifacts.push({
          path: artifactPath,
          size: bytes.byteLength,
          sha256: artifactSha256,
          releaseTag: tag,
          url: artifactUrl,
          kind: entry.kind,
          id: entry.id,
          version: entry.version,
        })
      }
      targets.push({
        platform: target.platform,
        arch: target.arch,
        artifact: {
          url: artifactUrl,
          size: bytes.byteLength,
          sha256: artifactSha256,
        },
      })
    }
    result.push({ command: definition.command, version: definition.version, targets })
  }
  return result
}

export async function checkMarketplace(root: string): Promise<void> {
  const descriptor = parseMarketplaceDescriptor(await readJson(join(root, "marketplace.json"), "marketplace.json"))
  const packages = await discoverMarketplacePackages(root)
  if (packages.length === 0) throw new TypeError("Marketplace must contain at least one package")
  for (const entry of packages) {
    if (entry.kind === "mcp-server" && entry.extension) {
      await companionInputs(root, entry, "check", descriptor)
    }
    if (entry.kind === "plugin") {
      await pluginCompanions(root, entry, "check", descriptor)
    }
    await packageInventory(entry, packages)
  }
}

export async function buildMarketplace(options: BuildMarketplaceOptions): Promise<MarketplaceBuildResult> {
  const descriptor = parseMarketplaceDescriptor(
    await readJson(join(options.root, "marketplace.json"), "marketplace.json"),
  )
  let sequence = options.sequence ?? 1
  if (!options.official && options.previousRegistryPath) {
    const previous = parseRegistryV2(await readJson(options.previousRegistryPath, "previous Registry"))
    if (previous.marketplaceId !== descriptor.id)
      throw new TypeError("previous Registry belongs to another Marketplace")
    const nextSequence = previous.sequence + 1
    if (options.sequence !== undefined && options.sequence !== nextSequence) {
      throw new TypeError("Registry explicit sequence does not match previous next sequence")
    }
    sequence = nextSequence
  }
  if (options.official) {
    if (!options.v1Revision || !/^[a-f0-9]{40}$/.test(options.v1Revision)) {
      throw new TypeError("Official build requires --v1-revision as an exact 40-character lowercase Git SHA")
    }
    const config = (await readJson(
      join(options.root, "registry", "config.json"),
      "Official Registry config",
    )) as Record<string, unknown>
    if (
      Object.keys(config).sort().join(",") !== "sequence,yanked" ||
      !Number.isSafeInteger(config.sequence) ||
      Number(config.sequence) < 1 ||
      !Array.isArray(config.yanked)
    ) {
      throw new TypeError("Official Registry config must strictly declare sequence and yanked")
    }
    let previousSequence: number | undefined
    if (options.previousRegistryPath && options.bootstrapPreviousV1Path) {
      throw new TypeError("Official build cannot combine v2 previous and v1 bootstrap")
    }
    if (options.previousRegistryPath) {
      const previous = parseRegistryV2(await readJson(options.previousRegistryPath, "previous Official Registry"))
      if (previous.marketplaceId !== descriptor.id)
        throw new TypeError("previous Official Registry belongs to another Marketplace")
      previousSequence = previous.sequence
    } else if (options.bootstrapPreviousV1Path) {
      const previous = parseRegistryV1(
        await readJson(options.bootstrapPreviousV1Path, "bootstrap Official Registry v1"),
      )
      previousSequence = previous.sequence
    } else if (!options.initialOfficial) {
      throw new TypeError("Official build requires an explicit previous Registry or initial-candidate flag")
    }
    const nextSequence = Math.max(Number(config.sequence), previousSequence ?? Number(config.sequence)) + 1
    if (options.sequence !== undefined && options.sequence !== nextSequence) {
      throw new TypeError("Official Registry explicit sequence does not match floor/previous next sequence")
    }
    sequence = nextSequence
  }
  const packages = await discoverMarketplacePackages(options.root)
  const outDir = resolve(options.outDir)
  await mkdir(outDir, { recursive: true })
  const artifacts: MarketplaceBuildResult["artifacts"] = []
  const registryPackages: RegistryPackage[] = []
  for (const entry of packages) {
    if (entry.kind === "plugin" || entry.kind === "skill") {
      const tag = releaseTagForPackage(entry)
      const zip = createDeterministicZip(await packageInventory(entry, packages))
      const assetName = `${entry.kind}-${safeAssetSegment(entry.id)}-${safeAssetSegment(entry.version)}.zip`
      const artifactUrl = releaseUrl(descriptor, tag, assetName)
      const path = join(outDir, "releases", tag, assetName)
      await atomicWrite(path, zip)
      const artifact = {
        path,
        size: zip.byteLength,
        sha256: sha256Hex(zip),
        releaseTag: tag,
        url: artifactUrl,
        kind: entry.kind,
        id: entry.id,
        version: entry.version,
      }
      artifacts.push(artifact)
      const companions =
        entry.kind === "plugin"
          ? await pluginCompanions(options.root, entry, tag, descriptor, outDir, artifacts)
          : undefined
      registryPackages.push({
        kind: entry.kind,
        id: entry.id,
        version: entry.version,
        compatibility: { convax: ">=0.1.0" },
        presentation: entry.presentation,
        yanked: entry.authoring?.yanked === true,
        ...(entry.kind === "plugin" && entry.manifest ? { manifest: entry.manifest } : {}),
        ...(companions ? { companions } : {}),
        ...(entry.kind === "skill" && typeof entry.authoring?.ownerPluginId === "string"
          ? { ownerPluginId: entry.authoring.ownerPluginId }
          : {}),
        delivery: {
          kind: "artifact",
          url: artifactUrl,
          size: artifact.size,
          sha256: artifact.sha256,
        },
      })
      continue
    }
    if (entry.kind === "mcp-server" && entry.catalogSupported === false) continue
    const serverBytes = jsonBytes(entry.server)
    const tag = releaseTagForPackage(entry)
    const serverAssetName = `${mcpAssetStem(entry)}-server.json`
    const serverAssetUrl = releaseUrl(descriptor, tag, serverAssetName)
    const serverAssetPath = join(outDir, "releases", tag, serverAssetName)
    await atomicWrite(serverAssetPath, serverBytes)
    artifacts.push({
      path: serverAssetPath,
      size: serverBytes.byteLength,
      sha256: sha256Hex(serverBytes),
      releaseTag: tag,
      url: serverAssetUrl,
      kind: entry.kind,
      id: entry.id,
      version: entry.version,
    })
    if (!entry.extension) {
      const runtime = entry.mcpRuntime
      if (!runtime || runtime.kind !== "http-agent") throw new TypeError("invalid HTTP MCP runtime")
      registryPackages.push({
        kind: "mcp-server",
        id: entry.id,
        version: entry.version,
        compatibility: { convax: ">=0.1.0" },
        presentation: entry.presentation,
        delivery: {
          kind: "mcp-http",
          serverJson: entry.server!,
          serverJsonSha256: sha256Hex(serverBytes),
          runtime: { endpoint: runtime.endpoint, transport: runtime.transport },
        },
      })
    } else {
      const extensionBytes = jsonBytes(entry.extension)
      const extensionAssetName = `${mcpAssetStem(entry)}-convax-mcp.json`
      const extensionAssetUrl = releaseUrl(descriptor, tag, extensionAssetName)
      const extensionAssetPath = join(outDir, "releases", tag, extensionAssetName)
      await atomicWrite(extensionAssetPath, extensionBytes)
      artifacts.push({
        path: extensionAssetPath,
        size: extensionBytes.byteLength,
        sha256: sha256Hex(extensionBytes),
        releaseTag: tag,
        url: extensionAssetUrl,
        kind: entry.kind,
        id: entry.id,
        version: entry.version,
      })
      const companions = await companionInputs(options.root, entry, tag, descriptor, outDir, artifacts)
      registryPackages.push({
        kind: "mcp-server",
        id: entry.id,
        version: entry.version,
        compatibility: { convax: ">=0.1.0" },
        presentation: entry.presentation,
        delivery: {
          kind: "mcp-managed-stdio",
          serverJson: entry.server!,
          serverJsonSha256: sha256Hex(serverBytes),
          extension: entry.extension,
          extensionSha256: sha256Hex(extensionBytes),
          companions,
        },
      })
    }
  }
  registryPackages.sort((left, right) => compareAscii(`${left.kind}/${left.id}`, `${right.kind}/${right.id}`))
  const revision = sha256Hex(canonicalJson(registryPackages))
  const registry = parseRegistryV2({
    schema: "convax.registry/2",
    marketplaceId: descriptor.id,
    sequence,
    revision,
    packages: registryPackages,
  })
  const registryBytes = jsonBytes(registry)
  await atomicWrite(join(outDir, "registry-v2.json"), registryBytes)
  const metadataTag = `registry-v2-${revision}`
  const showcaseReleaseAssets: MarketplaceBuildResult["releasePlan"]["releases"][number]["assets"] = []
  const showcasePackages: ShowcaseV2["packages"] = []
  for (const entry of packages) {
    if (entry.kind === "mcp-server" && entry.catalogSupported === false) continue
    const showcaseValue = entry.authoring?.showcase
    if (showcaseValue === undefined) continue
    if (!showcaseValue || typeof showcaseValue !== "object" || Array.isArray(showcaseValue)) {
      throw new TypeError(`Showcase metadata for ${entry.kind}/${entry.id} must be an object`)
    }
    const showcaseMetadata = showcaseValue as Record<string, unknown>
    if (
      Object.keys(showcaseMetadata).some((key) => key !== "poster" && key !== "animation") ||
      showcaseMetadata.poster === undefined
    ) {
      throw new TypeError(
        `Showcase metadata for ${entry.kind}/${entry.id} must strictly declare poster and optional animation`,
      )
    }
    const buildShowcaseAsset = async (
      slot: "poster" | "animation",
      value: unknown,
    ): Promise<ShowcaseV2["packages"][number]["presentation"]["poster"]> => {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new TypeError(`Showcase ${slot} for ${entry.kind}/${entry.id} must be an object`)
      }
      const metadata = value as Record<string, unknown>
      if (
        Object.keys(metadata).some((key) => !["path", "mime", "alt", "width", "height"].includes(key)) ||
        typeof metadata.path !== "string" ||
        typeof metadata.mime !== "string" ||
        (metadata.alt !== undefined && typeof metadata.alt !== "string") ||
        (metadata.width !== undefined &&
          (!Number.isSafeInteger(metadata.width) || Number(metadata.width) < 1 || Number(metadata.width) > 8_192)) ||
        (metadata.height !== undefined &&
          (!Number.isSafeInteger(metadata.height) || Number(metadata.height) < 1 || Number(metadata.height) > 8_192)) ||
        (metadata.width === undefined) !== (metadata.height === undefined)
      ) {
        throw new TypeError(`Showcase ${slot} for ${entry.kind}/${entry.id} has invalid strict presentation metadata`)
      }
      const allowedMime =
        slot === "poster" ? new Set(["image/png", "image/jpeg", "image/webp"]) : new Set(["video/mp4", "video/webm"])
      if (!allowedMime.has(metadata.mime)) throw new TypeError(`Showcase ${slot} mime is unsupported`)
      if (
        metadata.path.startsWith("/") ||
        metadata.path.includes("\\") ||
        metadata.path.split("/").some((segment) => segment === "" || segment === ".." || !SAFE_SEGMENT.test(segment))
      ) {
        throw new TypeError(`Showcase ${slot} path is unsafe`)
      }
      const source = resolve(entry.root, ...metadata.path.split("/"))
      const relativeSource = relative(entry.root, source)
      if (!relativeSource || relativeSource === ".." || relativeSource.startsWith(`..${sep}`)) {
        throw new TypeError(`Showcase ${slot} escapes its package`)
      }
      const { bytes } = await readStableRegularFile(
        source,
        `Showcase ${entry.kind}/${entry.id} ${slot}`,
        slot === "poster" ? 16 * 1024 * 1024 : 64 * 1024 * 1024,
      )
      const extensionByMime: Record<string, string> = {
        "image/png": "png",
        "image/jpeg": "jpg",
        "image/webp": "webp",
        "video/mp4": "mp4",
        "video/webm": "webm",
      }
      const assetName = `${entry.kind}-${sha256Hex(`${entry.kind}\0${entry.id}`).slice(0, 16)}-${safeAssetSegment(entry.version)}-${slot}.${extensionByMime[metadata.mime]}`
      const path = join(outDir, "releases", metadataTag, assetName)
      const url = releaseUrl(descriptor, metadataTag, assetName)
      await atomicWrite(path, bytes)
      const asset = {
        path: relative(outDir, path).split(sep).join("/"),
        name: assetName,
        size: bytes.byteLength,
        sha256: sha256Hex(bytes),
        url,
      }
      showcaseReleaseAssets.push(asset)
      return {
        url,
        size: asset.size,
        sha256: asset.sha256,
        mime: metadata.mime as ShowcaseV2["packages"][number]["presentation"]["poster"]["mime"],
        ...(metadata.alt === undefined ? {} : { alt: metadata.alt }),
        ...(metadata.width === undefined ? {} : { width: Number(metadata.width), height: Number(metadata.height) }),
      }
    }
    showcasePackages.push({
      kind: entry.kind,
      id: entry.id,
      version: entry.version,
      presentation: {
        ...entry.presentation,
        poster: await buildShowcaseAsset("poster", showcaseMetadata.poster),
        ...(showcaseMetadata.animation === undefined
          ? {}
          : { animation: await buildShowcaseAsset("animation", showcaseMetadata.animation) }),
      },
    })
  }
  const showcase = parseShowcaseV2(
    {
      schema: "convax.showcase/2",
      marketplaceId: descriptor.id,
      revision,
      packages: showcasePackages,
    },
    registry,
    descriptor,
  )
  const showcaseBytes = jsonBytes(showcase)
  await atomicWrite(join(outDir, "showcase-v2.json"), showcaseBytes)
  const { bytes: descriptorBytes } = await readStableRegularFile(
    join(options.root, "marketplace.json"),
    "marketplace descriptor",
    1024 * 1024,
  )
  const sitePathForPagesUrl = (urlValue: string): string => {
    const url = new URL(urlValue)
    const prefix = `/${descriptor.repository.name}/`
    if (
      url.hostname.toLowerCase() !== `${descriptor.repository.owner.toLowerCase()}.github.io` ||
      !url.pathname.startsWith(prefix)
    ) {
      throw new TypeError("descriptor Pages URL does not belong to the declared repository")
    }
    const segments = url.pathname.slice(prefix.length).split("/")
    if (segments.length === 0 || segments.some((segment) => !SAFE_SEGMENT.test(segment))) {
      throw new TypeError("descriptor Pages URL has an unsafe output path")
    }
    return join(outDir, "site", ...segments)
  }
  const registryV1 = options.official ? projectRegistryV1(registry, options.v1Revision!) : undefined
  if (registryV1) await atomicWrite(join(outDir, "registry-v1.json"), jsonBytes(registryV1))
  await atomicWrite(join(outDir, "marketplace.json"), descriptorBytes)
  await atomicWrite(join(outDir, "site", "marketplace.json"), descriptorBytes)
  await atomicWrite(sitePathForPagesUrl(descriptor.registry.v2.url), registryBytes)
  await atomicWrite(sitePathForPagesUrl(descriptor.showcase.v2.url), showcaseBytes)
  if (registryV1 && descriptor.registry.v1) {
    await atomicWrite(sitePathForPagesUrl(descriptor.registry.v1.url), jsonBytes(registryV1))
  }
  const releases = new Map<string, MarketplaceBuildResult["releasePlan"]["releases"][number]>()
  for (const artifact of artifacts) {
    if (options.publishIdentities && !options.publishIdentities.includes(`${artifact.kind}\0${artifact.id}`)) {
      if (!options.official) await unlink(artifact.path)
      continue
    }
    const release = releases.get(artifact.releaseTag) ?? { tag: artifact.releaseTag, assets: [] }
    release.assets.push({
      path: relative(outDir, artifact.path).split(sep).join("/"),
      name: basename(artifact.path),
      size: artifact.size,
      sha256: artifact.sha256,
      url: artifact.url,
    })
    releases.set(artifact.releaseTag, release)
  }
  const metadataAssets = [
    { name: "marketplace.json", bytes: descriptorBytes },
    { name: "registry-v2.json", bytes: registryBytes },
    { name: "showcase-v2.json", bytes: showcaseBytes },
  ]
  const metadataRelease = {
    tag: metadataTag,
    assets: [...showcaseReleaseAssets] as MarketplaceBuildResult["releasePlan"]["releases"][number]["assets"],
  }
  for (const asset of metadataAssets) {
    const path = join(outDir, "releases", metadataTag, asset.name)
    const url = releaseUrl(descriptor, metadataTag, asset.name)
    await atomicWrite(path, asset.bytes)
    metadataRelease.assets.push({
      path: relative(outDir, path).split(sep).join("/"),
      name: asset.name,
      size: asset.bytes.byteLength,
      sha256: sha256Hex(asset.bytes),
      url,
    })
  }
  releases.set(metadataTag, metadataRelease)
  const releasePlan = {
    schema: "convax.release-plan/1" as const,
    releases: [...releases.values()]
      .map((release) => ({
        ...release,
        assets: release.assets.sort((left, right) => compareAscii(left.name, right.name)),
      }))
      .sort((left, right) => compareAscii(left.tag, right.tag)),
  }
  await atomicWrite(join(outDir, "release-plan.json"), jsonBytes(releasePlan))
  const lockArtifact = (asset: { path: string; url: string }) => ({
    path: asset.path,
    url: asset.url,
  })
  const metadataByName = new Map(metadataRelease.assets.map((asset) => [asset.name, asset]))
  const artifactByUrl = new Map(
    artifacts.map((artifact) => [
      artifact.url,
      { path: relative(outDir, artifact.path).split(sep).join("/"), url: artifact.url },
    ]),
  )
  const packageArtifactByIdentity = new Map(
    registryPackages.flatMap((entry) =>
      entry.delivery.kind === "artifact"
        ? [[`${entry.kind}\0${entry.id}`, artifactByUrl.get(entry.delivery.url)!] as const]
        : [],
    ),
  )
  const preinstalled = options.official
    ? (() => {
        return readJson(join(options.root, "catalogs", "preinstalled.json"), "preinstalled config")
      })()
    : Promise.resolve({ schema: "convax.preinstalled-config/1", packages: [] })
  const preinstalledValue = await preinstalled
  if (!preinstalledValue || typeof preinstalledValue !== "object" || Array.isArray(preinstalledValue)) {
    throw new TypeError("preinstalled config must be an object")
  }
  const preinstalledConfig = preinstalledValue as Record<string, unknown>
  if (
    Object.keys(preinstalledConfig).sort().join(",") !== "packages,schema" ||
    preinstalledConfig.schema !== "convax.preinstalled-config/1" ||
    !Array.isArray(preinstalledConfig.packages)
  ) {
    throw new TypeError("preinstalled config must strictly declare schema and packages")
  }
  if (options.official) {
    const expected = [
      {
        marketplaceId: "convax-official",
        kind: "plugin",
        id: "ffmpeg-tools",
        targets: ["darwin-arm64"],
        setup: "explicit",
      },
    ]
    if (canonicalJson(preinstalledConfig.packages) !== canonicalJson(expected)) {
      throw new TypeError("Official preinstalled policy must contain only ffmpeg-tools for darwin-arm64")
    }
  } else if (preinstalledConfig.packages.length !== 0) {
    throw new TypeError("third-party Marketplace cannot emit a Convax product preinstalled policy")
  }
  const productLockInput = {
    schema: "convax.product-lock-catalog-input/1",
    official: {
      descriptor: lockArtifact(metadataByName.get("marketplace.json")!),
      registry: lockArtifact(metadataByName.get("registry-v2.json")!),
      revision,
      showcase: lockArtifact(metadataByName.get("showcase-v2.json")!),
    },
    packages: preinstalledConfig.packages.map((rawPreinstalled) => {
      if (!rawPreinstalled || typeof rawPreinstalled !== "object" || Array.isArray(rawPreinstalled)) {
        throw new TypeError("invalid preinstalled package")
      }
      const selected = rawPreinstalled as Record<string, unknown>
      const entry = registryPackages.find(
        (candidate) => candidate.kind === selected.kind && candidate.id === selected.id,
      )
      if (!entry || entry.kind !== "plugin" || entry.delivery.kind !== "artifact") {
        throw new TypeError(`preinstalled package ${String(selected.kind)}/${String(selected.id)} is unavailable`)
      }
      const packageArtifact = packageArtifactByIdentity.get(`${entry.kind}\0${entry.id}`)
      if (!packageArtifact) throw new TypeError(`preinstalled package ${entry.id} has no locked artifact`)
      const ownedSkillNames =
        entry.manifest?.contributes &&
        typeof entry.manifest.contributes === "object" &&
        !Array.isArray(entry.manifest.contributes) &&
        Array.isArray((entry.manifest.contributes as Record<string, unknown>).skills)
          ? ((entry.manifest.contributes as Record<string, unknown>).skills as unknown[]).flatMap((value) =>
              value &&
              typeof value === "object" &&
              !Array.isArray(value) &&
              typeof (value as Record<string, unknown>).name === "string"
                ? [(value as Record<string, unknown>).name as string]
                : [],
            )
          : []
      const selectedTargets = selected.targets as string[]
      const companions = (entry.companions ?? []).flatMap((companion) =>
        companion.targets
          .filter((target) => selectedTargets.includes(`${target.platform}-${target.arch}`))
          .map((target) => {
            const artifact = artifactByUrl.get(target.artifact.url)
            if (!artifact)
              throw new TypeError(
                `preinstalled companion ${entry.id}/${target.platform}-${target.arch} has no locked artifact`,
              )
            return {
              ...artifact,
              platform: target.platform,
              arch: target.arch,
            }
          }),
      )
      if (companions.length !== selectedTargets.length) {
        throw new TypeError(`preinstalled package ${entry.id} does not close its selected companion targets`)
      }
      return {
        marketplaceId: selected.marketplaceId,
        kind: entry.kind,
        id: entry.id,
        version: entry.version,
        setup: selected.setup,
        artifact: packageArtifact,
        ownedSkills: ownedSkillNames.map((name) => {
          const artifact = packageArtifactByIdentity.get(`skill\0${name}`)
          if (!artifact) throw new TypeError(`owned Skill ${name} has no independently locked artifact`)
          return artifact
        }),
        companions,
      }
    }),
  }
  await atomicWrite(join(outDir, "product-lock-input.catalog.json"), jsonBytes(productLockInput))
  return {
    registry,
    registrySha256: sha256Hex(registryBytes),
    ...(registryV1 ? { registryV1 } : {}),
    showcase,
    artifacts,
    releasePlan,
    productLockInput,
  }
}

export async function buildRegistryV2(options: BuildMarketplaceOptions): Promise<RegistryV2> {
  return (await buildMarketplace(options)).registry
}

export { parseRegistryV1, parseRegistryV2, projectRegistryV1 }

export async function composeProductLockInput(options: {
  catalogDir: string
  builtinDir: string
  outFile: string
}): Promise<Record<string, unknown>> {
  const catalog = (await readJson(
    join(options.catalogDir, "product-lock-input.catalog.json"),
    "Catalog product-lock input",
  )) as Record<string, unknown>
  const builtin = (await readJson(
    join(options.builtinDir, "builtin-lock-input.json"),
    "Builtin product-lock input",
  )) as Record<string, unknown>
  if (catalog.schema !== "convax.product-lock-catalog-input/1" || builtin.schema !== "convax.builtin-lock-input/1") {
    throw new TypeError("incompatible product-lock input fragments")
  }
  const outputRoot = dirname(resolve(options.outFile))
  const prefixArtifact = (base: string, value: unknown): { path: string; url: string } => {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new TypeError("invalid product-lock artifact")
    const artifact = value as Record<string, unknown>
    if (typeof artifact.path !== "string" || typeof artifact.url !== "string")
      throw new TypeError("incomplete product-lock artifact")
    const absolute = resolve(base, ...artifact.path.split("/"))
    const path = relative(outputRoot, absolute).split(sep).join("/")
    if (!path || path === ".." || path.startsWith("../")) {
      throw new TypeError("product-lock fragments must be below the composed output root")
    }
    return { path, url: artifact.url }
  }
  const officialValue = catalog.official
  if (!officialValue || typeof officialValue !== "object" || Array.isArray(officialValue)) {
    throw new TypeError("Catalog product-lock input has no Official metadata")
  }
  const official = officialValue as Record<string, unknown>
  if (!Array.isArray(catalog.packages) || !Array.isArray(builtin.builtinReservations)) {
    throw new TypeError("product-lock input fragments are incomplete")
  }
  const packages = catalog.packages.map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("invalid product-lock package")
    const entry = value as Record<string, unknown>
    if (!Array.isArray(entry.companions) || !Array.isArray(entry.ownedSkills)) {
      throw new TypeError("incomplete product-lock package")
    }
    return {
      ...entry,
      artifact: prefixArtifact(options.catalogDir, entry.artifact),
      companions: entry.companions.map((companion) => {
        if (!companion || typeof companion !== "object" || Array.isArray(companion))
          throw new TypeError("invalid product-lock companion")
        const metadata = companion as Record<string, unknown>
        return {
          ...prefixArtifact(options.catalogDir, metadata),
          platform: metadata.platform,
          arch: metadata.arch,
        }
      }),
      ownedSkills: entry.ownedSkills.map((skill) => prefixArtifact(options.catalogDir, skill)),
    }
  })
  const result = {
    schema: "convax.product-lock-input/1",
    builtinBundle: prefixArtifact(options.builtinDir, builtin.builtinBundle),
    builtinManifestPath: (() => {
      if (typeof builtin.manifestPath !== "string") throw new TypeError("Builtin input has no manifestPath")
      const path = relative(outputRoot, resolve(options.builtinDir, builtin.manifestPath)).split(sep).join("/")
      if (!path || path === ".." || path.startsWith("../")) throw new TypeError("Builtin manifest escapes output root")
      return path
    })(),
    builtinReservations: builtin.builtinReservations,
    official: {
      descriptor: prefixArtifact(options.catalogDir, official.descriptor),
      registry: prefixArtifact(options.catalogDir, official.registry),
      revision: official.revision,
      showcase: prefixArtifact(options.catalogDir, official.showcase),
    },
    packages,
  }
  await atomicWrite(options.outFile, jsonBytes(result))
  return result
}

export async function buildBuiltinBundle(options: { root: string; outDir: string; releaseId?: string }): Promise<{
  schema: "convax.builtin-bundle/1"
  release: { id: string }
  members: Array<{
    kind: StarterKind
    id: string
    version: string
    artifact: { path: string; size: number; sha256: string }
    presentation: {
      poster: { path: string; mime: string; size: number; sha256: string }
      animation?: { path: string; mime: string; size: number; sha256: string }
    }
  }>
  archive: { path: string; size: number; sha256: string }
}> {
  const config = (await readJson(join(options.root, "catalogs", "builtin.json"), "builtin config")) as Record<
    string,
    unknown
  >
  if (config.schema !== "convax.builtin-config/1" || !Array.isArray(config.members)) {
    throw new TypeError("invalid Builtin config")
  }
  const discovered = await discoverMarketplacePackages(options.root)
  const members = []
  const archiveEntries: InventoryEntry[] = []
  for (const rawMember of config.members) {
    if (!rawMember || typeof rawMember !== "object") throw new TypeError("invalid Builtin member")
    const member = rawMember as Record<string, unknown>
    const entry = discovered.find((candidate) => candidate.kind === member.kind && candidate.id === member.id)
    if (!entry) throw new TypeError(`missing Builtin member ${String(member.kind)}/${String(member.id)}`)
    if (entry.kind === "mcp-server") throw new TypeError("Builtin V1 bundle does not admit MCP Server")
    const zip = createDeterministicZip(await packageInventory(entry, discovered))
    const path = `members/${entry.kind}-${safeAssetSegment(entry.id)}-${safeAssetSegment(entry.version)}.zip`
    await atomicWrite(join(options.outDir, path), zip)
    archiveEntries.push({ path, bytes: zip, mode: 0o644 })
    const showcaseValue = entry.authoring?.showcase
    if (!showcaseValue || typeof showcaseValue !== "object" || Array.isArray(showcaseValue)) {
      throw new TypeError(`Builtin member ${entry.id} must declare showcase.poster`)
    }
    const showcase = showcaseValue as Record<string, unknown>
    const buildPresentation = async (slot: "poster" | "animation") => {
      const value = showcase[slot]
      if (value === undefined) return undefined
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new TypeError(`Builtin member ${entry.id} ${slot} metadata is invalid`)
      }
      const metadata = value as Record<string, unknown>
      if (typeof metadata.path !== "string" || typeof metadata.mime !== "string") {
        throw new TypeError(`Builtin member ${entry.id} ${slot} metadata is incomplete`)
      }
      const sourcePath = resolve(entry.root, metadata.path)
      const relativePath = relative(entry.root, sourcePath)
      if (!relativePath || relativePath.startsWith(`..${sep}`) || relativePath === "..") {
        throw new TypeError(`Builtin member ${entry.id} ${slot} escapes its authoring root`)
      }
      const { bytes } = await readStableRegularFile(
        sourcePath,
        `Builtin member ${entry.id} ${slot}`,
        slot === "poster" ? 8 * 1024 * 1024 : 32 * 1024 * 1024,
      )
      const extension = basename(metadata.path).split(".").at(-1)
      if (!extension || !/^[a-z0-9]{2,5}$/i.test(extension)) throw new TypeError("invalid presentation extension")
      const assetPath = `presentation/${safeAssetSegment(entry.id)}/${slot}.${extension.toLowerCase()}`
      await atomicWrite(join(options.outDir, assetPath), bytes)
      archiveEntries.push({ path: assetPath, bytes, mode: 0o644 })
      return {
        path: assetPath,
        mime: metadata.mime,
        size: bytes.byteLength,
        sha256: sha256Hex(bytes),
      }
    }
    const poster = await buildPresentation("poster")
    if (!poster) throw new TypeError(`Builtin member ${entry.id} must declare showcase.poster`)
    const animation = await buildPresentation("animation")
    members.push({
      kind: entry.kind,
      id: entry.id,
      version: entry.version,
      artifact: { path, size: zip.byteLength, sha256: sha256Hex(zip) },
      presentation: { poster, ...(animation ? { animation } : {}) },
    })
  }
  const contentDigest = sha256Hex(canonicalJson(members))
  if (options.releaseId !== undefined && options.releaseId !== contentDigest) {
    throw new TypeError("Builtin release id must equal its canonical member content digest")
  }
  const releaseId = contentDigest
  const manifest = { schema: "convax.builtin-bundle/1" as const, release: { id: releaseId }, members }
  const manifestBytes = jsonBytes(manifest)
  await atomicWrite(join(options.outDir, "bundle.json"), manifestBytes)
  const archiveBytes = createDeterministicZip([
    { path: "bundle.json", bytes: manifestBytes, mode: 0o644 },
    ...archiveEntries,
  ])
  const parsedArchive = parseBuiltinBundleArchive(archiveBytes)
  if (canonicalJson(parsedArchive) !== canonicalJson(manifest)) {
    throw new TypeError("Builtin archive consumer projection does not match its generated manifest")
  }
  const descriptor = parseMarketplaceDescriptor(
    await readJson(join(options.root, "marketplace.json"), "marketplace.json"),
  )
  const releaseTag = `builtin-${releaseId}`
  const archiveName = "convax-builtin-bundle.zip"
  const archivePath = join(options.outDir, "releases", releaseTag, archiveName)
  await atomicWrite(archivePath, archiveBytes)
  await atomicWrite(join(options.outDir, archiveName), archiveBytes)
  const bundleLockInput = {
    schema: "convax.builtin-lock-input/1",
    builtinBundle: {
      path: `releases/${releaseTag}/${archiveName}`,
      url: releaseUrl(descriptor, releaseTag, archiveName),
    },
    builtinReservations: members.map(({ kind, id }) => ({ kind, id })),
    manifestPath: "bundle.json",
  }
  await atomicWrite(join(options.outDir, "builtin-lock-input.json"), jsonBytes(bundleLockInput))
  await atomicWrite(
    join(options.outDir, "release-plan.json"),
    jsonBytes({
      schema: "convax.release-plan/1",
      releases: [
        {
          tag: releaseTag,
          assets: [
            {
              path: `releases/${releaseTag}/${archiveName}`,
              name: archiveName,
              url: releaseUrl(descriptor, releaseTag, archiveName),
              size: archiveBytes.byteLength,
              sha256: sha256Hex(archiveBytes),
            },
          ],
        },
      ],
    }),
  )
  return {
    ...manifest,
    archive: { path: archivePath, size: archiveBytes.byteLength, sha256: sha256Hex(archiveBytes) },
  }
}

export async function createMarketplaceTemplate(root: string, kind: StarterKind, id: string): Promise<string> {
  assertSegment(id, "template id")
  const packageRoot = join(root, "packages", KIND_DIRECTORY[kind], id)
  const existing = await lstat(packageRoot).catch(() => undefined)
  if (existing) throw new TypeError(`template already exists: ${id}`)
  await mkdir(packageRoot, { recursive: true })
  if (kind === "plugin") {
    await atomicWrite(
      join(packageRoot, "manifest.json"),
      `${JSON.stringify({ schema: "convax.plugin/1", id, version: "0.1.0", name: id }, null, 2)}\n`,
    )
  } else if (kind === "skill") {
    await atomicWrite(
      join(packageRoot, "SKILL.md"),
      `---\nname: ${id}\nversion: 0.1.0\ndescription: ${id} workflow\n---\n\n# ${id}\n`,
    )
  } else {
    const serverName = id.includes("/") ? id : `io.example/${id}`
    await atomicWrite(
      join(packageRoot, "server.json"),
      `${JSON.stringify(
        {
          $schema: "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json",
          name: serverName,
          description: `${id} MCP Server`,
          version: "0.1.0",
          remotes: [{ type: "streamable-http", url: "https://example.com/mcp" }],
        },
        null,
        2,
      )}\n`,
    )
  }
  return packageRoot
}

export async function createMarketplaceStarter(root: string, options: StarterOptions): Promise<void> {
  assertSegment(options.id, "Marketplace id")
  assertSegment(options.owner, "repository owner")
  assertSegment(options.repository, "repository name")
  const rootState = await lstat(root).catch(() => undefined)
  if (rootState) {
    if (!rootState.isDirectory() || rootState.isSymbolicLink()) throw new TypeError("destination must be a directory")
    if ((await readdir(root)).length > 0) throw new TypeError("destination directory must be empty")
  } else {
    await mkdir(root, { recursive: true })
  }
  const pages = `https://${options.owner}.github.io/${options.repository}`
  const descriptor = {
    schema: "convax.marketplace/1",
    id: options.id,
    name: options.name,
    publisher: { name: options.owner },
    repository: { owner: options.owner, name: options.repository },
    registry: { v2: { url: `${pages}/registry-v2.json` } },
    showcase: { v2: { url: `${pages}/showcase-v2.json` } },
    compatibility: { convax: ">=0.1.0" },
    delivery: { kind: "github-pages-releases" },
  }
  await atomicWrite(join(root, "marketplace.json"), `${JSON.stringify(descriptor, null, 2)}\n`)
  await atomicWrite(
    join(root, "package.json"),
    `${JSON.stringify(
      {
        name: options.id,
        private: true,
        type: "module",
        scripts: {
          marketplace: "convax-marketplace",
          check: "convax-marketplace check .",
          "build-index": "convax-marketplace build-index . --out dist",
        },
        devDependencies: {
          "@convax/marketplace-kit": process.env.CONVAX_MARKETPLACE_KIT_SPEC ?? "^0.1.0",
        },
      },
      null,
      2,
    )}\n`,
  )
  await atomicWrite(join(root, "bunfig.toml"), "install.ignoreScripts = true\n")
  await atomicWrite(
    join(root, ".gitignore"),
    "node_modules/\n.bun-cache/\ndist/\nprevious-registry.json\nchanged-packages.json\n",
  )
  await createMarketplaceTemplate(
    root,
    options.starter,
    options.starter === "mcp-server" ? "example-mcp" : `example-${options.starter}`,
  )
  await atomicWrite(
    join(root, "README.md"),
    `# ${options.name}\n\nRun \`bun marketplace check .\` before opening a pull request.\n`,
  )
  await atomicWrite(join(root, "CONTRIBUTING.md"), "# Contributing\n\nPackage content is validated as inert bytes.\n")
  await atomicWrite(
    join(root, "SECURITY.md"),
    "# Security\n\nReport vulnerabilities privately to the repository owner.\n",
  )
  await atomicWrite(join(root, "LICENSE"), "Apache License 2.0\n")
  await atomicWrite(
    join(root, ".github", "workflows", "check.yml"),
    `name: check
on:
  pull_request:
  push:
permissions:
  contents: read
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683
      - uses: oven-sh/setup-bun@735343b667d3e6f658f44d0eca948eb6282f2b76
      - run: bun install --frozen-lockfile --ignore-scripts
      - run: bun marketplace check .
`,
  )
  await atomicWrite(
    join(root, ".github", "workflows", "release.yml"),
    `name: release
on:
  push:
    branches: [main]
permissions:
  contents: read
concurrency:
  group: marketplace-release-\${{ github.ref }}
  cancel-in-progress: false
jobs:
  build:
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    permissions:
      contents: read
    outputs:
      changed: \${{ steps.versions.outputs.changed }}
    steps:
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683
        with:
          fetch-depth: 0
      - uses: oven-sh/setup-bun@735343b667d3e6f658f44d0eca948eb6282f2b76
      - run: bun install --frozen-lockfile --ignore-scripts
      - run: bun marketplace check .
      - id: versions
        run: |
          bun marketplace changed . --base "\${{ github.event.before }}" > changed-packages.json
          if [ "$(jq length changed-packages.json)" -gt 0 ]; then echo "changed=true" >> "$GITHUB_OUTPUT"; else echo "changed=false" >> "$GITHUB_OUTPUT"; fi
      - if: steps.versions.outputs.changed == 'true'
        run: |
          set -euo pipefail
          registry_url="$(jq -r '.registry.v2.url' marketplace.json)"
          status="$(curl --proto '=https' --max-redirs 0 --connect-timeout 10 --max-time 30 --output previous-registry.json --write-out '%{http_code}' "$registry_url")"
          if [ "$status" = "200" ]; then
            bun marketplace build-index . --out dist --changed changed-packages.json --previous previous-registry.json
          elif [ "$status" = "404" ]; then
            rm -f previous-registry.json
            bun marketplace build-index . --out dist --changed changed-packages.json --initial
          else
            echo "Registry fetch failed with HTTP $status" >&2
            exit 1
          fi
      - if: steps.versions.outputs.changed == 'true'
        uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02
        with:
          name: marketplace-release
          path: dist
          if-no-files-found: error
          retention-days: 1
  release:
    needs: build
    if: needs.build.outputs.changed == 'true'
    runs-on: ubuntu-latest
    environment: marketplace-release
    permissions:
      contents: write
      pages: write
      id-token: write
    steps:
      - uses: actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093
        with:
          name: marketplace-release
          path: dist
      - name: Reverify immutable release and Pages bytes
        env:
          GH_REPO: \${{ github.repository }}
        run: |
          set -euo pipefail
          jq -e '
            .schema == "convax.release-plan/1"
            and (.releases | type == "array")
            and (.releases | length > 0)
            and ((.releases | map(.tag) | unique | length) == (.releases | length))
          ' dist/release-plan.json >/dev/null
          planned=0
          while IFS=$'\\t' read -r tag path name size sha url; do
            [[ "$tag" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$ ]]
            [[ "$name" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$ ]]
            [ "$path" = "releases/$tag/$name" ]
            [ "$url" = "https://github.com/$GH_REPO/releases/download/$tag/$name" ]
            [ -f "dist/$path" ] && [ ! -L "dist/$path" ]
            [ "$(wc -c < "dist/$path" | tr -d ' ')" = "$size" ]
            [ "$(sha256sum "dist/$path" | cut -d' ' -f1)" = "$sha" ]
            planned=$((planned + 1))
          done < <(jq -r '.releases[] as $release | $release.assets[] | [$release.tag, .path, .name, (.size|tostring), .sha256, .url] | @tsv' dist/release-plan.json)
          [ "$planned" -gt 0 ]
          [ "$(find dist/releases -type f | wc -l | tr -d ' ')" = "$planned" ]
          pages_owner="\${GH_REPO%%/*}"
          pages_repo="\${GH_REPO#*/}"
          pages_prefix="https://\${pages_owner,,}.github.io/$pages_repo/"
          page_path() {
            case "$1" in
              "$pages_prefix"*) ;;
              *) return 1 ;;
            esac
            relative="\${1#"$pages_prefix"}"
            [[ "$relative" =~ ^([A-Za-z0-9._-]+/)*[A-Za-z0-9._-]+$ ]]
            printf '%s\\n' "$relative"
          }
          [ -f dist/site/marketplace.json ] && [ ! -L dist/site/marketplace.json ]
          registry_page="$(page_path "$(jq -er '.registry.v2.url' dist/site/marketplace.json)")"
          showcase_page="$(page_path "$(jq -er '.showcase.v2.url' dist/site/marketplace.json)")"
          mappings=("marketplace.json:marketplace.json" "registry-v2.json:$registry_page" "showcase-v2.json:$showcase_page")
          if registry_v1_url="$(jq -er '.registry.v1.url // empty' dist/site/marketplace.json)"; then
            registry_v1_page="$(page_path "$registry_v1_url")"
            mappings+=("registry-v1.json:$registry_v1_page")
          fi
          for mapping in "\${mappings[@]}"; do
            name="\${mapping%%:*}"
            page="\${mapping#*:}"
            mapfile -t candidates < <(find dist/releases -type f -name "$name")
            [ "\${#candidates[@]}" -eq 1 ]
            [ -f "dist/site/$page" ] && [ ! -L "dist/site/$page" ]
            cmp --silent "\${candidates[0]}" "dist/site/$page"
          done
      - env:
          GH_TOKEN: \${{ github.token }}
          GH_REPO: \${{ github.repository }}
        run: |
          set -euo pipefail
          jq -r '.releases[].tag' dist/release-plan.json | while read -r tag; do
            mapfile -t assets < <(jq -r --arg tag "$tag" '.releases[] | select(.tag == $tag) | .assets[].path' dist/release-plan.json)
            gh release create "$tag" "\${assets[@]/#/dist/}"
          done
      - uses: actions/configure-pages@983d7736d9b0ae728b81ab479565c72886d7745b
      - uses: actions/upload-pages-artifact@56afc609e74202658d3ffba0e8f6dda462b719fa
        with:
          path: dist/site
      - id: deployment
        uses: actions/deploy-pages@d6db90192e89b64e5d8cf45de0b225a2f1b2c74e
`,
  )
}

export async function addMarketplaceDirectory(root: string, sourceDirectory: string): Promise<string> {
  const source = await realpath(sourceDirectory)
  const sourceInfo = await lstat(source)
  if (!sourceInfo.isDirectory() || sourceInfo.isSymbolicLink())
    throw new TypeError("source must be a no-follow directory")
  const packageInfo = await inspectPackage(source)
  const destination = join(root, "packages", KIND_DIRECTORY[packageInfo.kind], basename(source))
  if (await lstat(destination).catch(() => undefined)) throw new TypeError("destination package already exists")
  const files = await inventory(source)
  await mkdir(destination, { recursive: true })
  for (const entry of files) {
    const path = join(destination, ...entry.path.split("/"))
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, entry.bytes, { mode: entry.mode })
  }
  return destination
}

export async function addTarget(
  root: string,
  mcpDirectory: string,
  options: { target: string; file: string },
): Promise<string> {
  if (!TARGET.test(options.target)) throw new TypeError("invalid target")
  const entry = await inspectPackage(mcpDirectory, "mcp-server")
  if (!entry.extension) throw new TypeError("add-target requires a managed-stdio MCP extension")
  if (!entry.extension.runtime.compatibility.targets.includes(options.target)) {
    throw new TypeError("target is not declared by the MCP extension")
  }
  const sourceInfo = await lstat(options.file)
  if (!sourceInfo.isFile() || sourceInfo.isSymbolicLink() || sourceInfo.nlink !== 1) {
    throw new TypeError("companion must be a regular single-link no-follow file")
  }
  const command = entry.extension.runtime.command
  const sourceBasename = basename(options.file)
  const targetPlatform = options.target.split("-")[0]
  const matches =
    targetPlatform === "win32"
      ? sourceBasename.toLocaleLowerCase("en-US") === command.toLocaleLowerCase("en-US")
      : sourceBasename === command
  if (!matches) throw new TypeError("companion basename must match the declared command")
  const { bytes: sourceBytes } = await readStableRegularFile(options.file, "companion", 128 * 1024 * 1024)
  const sourceDigest = sha256Hex(sourceBytes)
  const itemKey = sha256Hex(`mcp-server\0${entry.id}`)
  const destination = join(root, ".marketplace", "companion-inputs", itemKey, options.target, command)
  if (await lstat(destination).catch(() => undefined)) throw new TypeError("target companion input already exists")
  await mkdir(dirname(destination), { recursive: true })
  await atomicWrite(destination, sourceBytes)
  await chmod(destination, sourceInfo.mode & 0o111 ? 0o755 : 0o644)
  const published = await readFile(destination)
  if (published.byteLength !== sourceBytes.byteLength || sha256Hex(published) !== sourceDigest) {
    throw new TypeError("published companion input failed exact-byte verification")
  }
  return destination
}
