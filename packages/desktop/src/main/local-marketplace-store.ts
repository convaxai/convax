import { createHash, randomUUID } from "node:crypto"
import { constants as fsConstants } from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"

import { parseAgentSkillMarkdown } from "@convax/agent-runtime/node"
import {
  canonicalJson,
  parseMcpServerExtension,
  parseServerPackage,
  sha256Hex,
  type SourceKey,
  type SourceQualifiedItem,
} from "@convax/marketplace"
import { readBoundedAuthorityFile } from "./bounded-authority-file"
import { syncDirectoryEntry, syncFileBytes } from "./filesystem-durability"
import { parsePluginRuntimeSurface, projectMcpRuntimeSurface } from "./marketplace-runtime-surface"
import type { MarketplaceItemKind } from "./marketplace-state"

export interface LocalMarketplaceIdentity {
  marketplaceId: string
  policyVersion: 1
  sourceInstanceId: string
}

export interface LocalMarketplacePackage {
  digest: string
  id: string
  kind: MarketplaceItemKind
  revision: number
  snapshotKey: string
  version: string
}

export interface LocalMarketplaceIndex {
  packages: LocalMarketplacePackage[]
  revision: number
  schema: "convax.local-marketplace-index/1"
}

export interface LocalMarketplaceStoreOptions {
  /** Test seam used to prove source mutation is detected before publication. */
  beforeSourceRecheck?: () => Promise<void>
  /** Authoritative InstallRecord/Transition references that forbid identity recreation. */
  hasRetainedReferences?: () => Promise<boolean>
  marketplaceId: string
  root: string
  transition: LocalMarketplaceImportTransition
}

export interface LocalMarketplaceImportTransition {
  recover?(input: {
    isIndexed(candidate: LocalMarketplacePackage): Promise<boolean>
    rollbackSnapshot(candidate: LocalMarketplacePackage): Promise<void>
  }): Promise<void>
  run(input: {
    candidate: LocalMarketplacePackage
    commitIndex(): Promise<void>
    rollbackSnapshot(): Promise<void>
  }): Promise<void>
}

interface InventoryFile {
  bytes: Uint8Array
  mode: number
  path: string
}

const maxFiles = 1_024
const maxFileBytes = 4 * 1024 * 1024
const maxTotalBytes = 32 * 1024 * 1024
const maxDepth = 16
const maxIndexPackages = 4_096
const maxIdentityBytes = 4 * 1024
const maxIndexBytes = 8 * 1024 * 1024
const maxTransitionBytes = 2 * 1024 * 1024
const safeMarketplaceId = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u
const windowsReservedName = /^(?:con|prn|aux|nul|com[1-9\u00b9\u00b2\u00b3]|lpt[1-9\u00b9\u00b2\u00b3])(?:\.|$)/iu
const digestPattern = /^[a-f0-9]{64}$/u
const sourceInstancePattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const identityFile = "marketplace.json"
const indexFile = "index-v1.json"
const rootMarkers = [
  ["manifest.json", "plugin"],
  ["SKILL.md", "skill"],
  ["server.json", "mcp-server"],
] as const

function assertSafeSegment(segment: string) {
  if (
    !segment ||
    segment === "." ||
    segment === ".." ||
    segment.includes("\0") ||
    /[\\/:*?"<>|\u0000-\u001f]/u.test(segment) ||
    /[. ]$/u.test(segment) ||
    windowsReservedName.test(segment)
  ) {
    throw new Error(`Local import contains an unsafe path segment: ${JSON.stringify(segment)}`)
  }
}

function portablePath(input: string) {
  const segments = input.split(path.sep)
  for (const segment of segments) assertSafeSegment(segment)
  return segments.map((segment) => segment.normalize("NFC")).join("/")
}

function pathKey(value: string) {
  const normalized = value.normalize("NFC")
  return process.platform === "darwin" || process.platform === "win32" ? normalized.toLowerCase() : normalized
}

function decodeJson(bytes: Uint8Array, label: string): Record<string, unknown> {
  try {
    const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("not an object")
    return value as Record<string, unknown>
  } catch (error) {
    throw new Error(`${label} is invalid`, { cause: error })
  }
}

function requireIdentityText(value: unknown, label: string) {
  if (typeof value !== "string" || value.length === 0 || value.length > 256 || value.includes("\0")) {
    throw new Error(`${label} is invalid`)
  }
  return value
}

function skillName(bytes: Uint8Array) {
  let text: string
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  } catch (error) {
    throw new Error("SKILL.md is invalid", { cause: error })
  }
  return requireIdentityText(parseAgentSkillMarkdown(text).name, "Skill name")
}

function packageIdentity(kind: MarketplaceItemKind, files: readonly InventoryFile[]) {
  const byPath = new Map(files.map((file) => [file.path, file]))
  if (kind === "plugin") {
    const { manifest } = parsePluginRuntimeSurface(decodeJson(byPath.get("manifest.json")!.bytes, "manifest.json"))
    return {
      id: requireIdentityText(manifest.id, "Plugin id"),
      version: requireIdentityText(manifest.version, "Plugin version"),
    }
  }
  if (kind === "skill") return { id: skillName(byPath.get("SKILL.md")!.bytes), version: "local" }
  const definition = decodeJson(byPath.get("server.json")!.bytes, "server.json")
  const extensionFile = byPath.get("convax-mcp.json")
  const parsed = parseServerPackage(
    definition,
    extensionFile ? decodeJson(extensionFile.bytes, "convax-mcp.json") : undefined,
  )
  return {
    id: parsed.id,
    version: parsed.version,
  }
}

function digestInventory(files: readonly InventoryFile[]) {
  const hash = createHash("sha256")
  for (const file of files) {
    const filePath = new TextEncoder().encode(file.path)
    const header = Buffer.alloc(8)
    header.writeUInt32BE(filePath.byteLength, 0)
    header.writeUInt32BE(file.bytes.byteLength, 4)
    hash.update(header)
    hash.update(filePath)
    hash.update(file.bytes)
  }
  return hash.digest("hex")
}

function assertMcpInert(files: readonly InventoryFile[]) {
  const allowedRoot = /^(?:server\.json|convax-mcp\.json|README(?:\.[A-Za-z0-9_-]+)?|LICENSE(?:\.[A-Za-z0-9_-]+)?)$/iu
  const allowedPresentation = /^(?:assets|showcase)\/[A-Za-z0-9._/-]+\.(?:jpe?g|png|webp)$/iu
  for (const file of files) {
    if ((file.mode & 0o111) !== 0 || (!allowedRoot.test(file.path) && !allowedPresentation.test(file.path))) {
      throw new Error("Local MCP snapshot contains executable or server script content")
    }
  }
}

function assertNotAborted(signal?: AbortSignal) {
  if (!signal?.aborted) return
  const error = signal.reason instanceof Error ? signal.reason : new Error("Operation was canceled")
  error.name = "AbortError"
  throw error
}

async function inventory(root: string, signal?: AbortSignal): Promise<InventoryFile[]> {
  assertNotAborted(signal)
  const lexicalRoot = path.resolve(root)
  const lexicalStat = await fs.lstat(lexicalRoot)
  if (lexicalStat.isSymbolicLink()) throw new Error("Local import root must not be a symbolic link")
  const absoluteRoot = await fs.realpath(root)
  const rootStat = await fs.lstat(absoluteRoot)
  if (!rootStat.isDirectory()) throw new Error("Local import source must be a directory")
  const files: InventoryFile[] = []
  const seen = new Set<string>()
  let totalBytes = 0

  const visit = async (directory: string, relativeDirectory: string, depth: number): Promise<void> => {
    if (depth > maxDepth) throw new Error("Local import exceeds the maximum directory depth")
    const directoryBefore = await fs.lstat(directory)
    if (directoryBefore.isSymbolicLink() || !directoryBefore.isDirectory()) {
      throw new Error("Local import source directory changed during import")
    }
    const entries = await fs.readdir(directory, { withFileTypes: true })
    entries.sort((left, right) => left.name.localeCompare(right.name, "en"))
    for (const entry of entries) {
      assertNotAborted(signal)
      assertSafeSegment(entry.name)
      const portable = portablePath(relativeDirectory ? path.join(relativeDirectory, entry.name) : entry.name)
      const key = pathKey(portable)
      if (seen.has(key)) throw new Error(`Local import contains a case-colliding path: ${portable}`)
      seen.add(key)
      const native = path.join(directory, entry.name)
      const metadata = await fs.lstat(native)
      if (metadata.isSymbolicLink()) throw new Error("Local import must not contain symbolic links")
      if (metadata.isDirectory()) {
        await visit(native, portable, depth + 1)
        continue
      }
      if (!metadata.isFile()) throw new Error("Local import must contain only regular files")
      if (metadata.nlink !== 1) throw new Error("Local import files must not have multiple hard links")
      if (metadata.size > maxFileBytes) throw new Error("Local import contains a file that exceeds the size limit")
      totalBytes += metadata.size
      if (totalBytes > maxTotalBytes) throw new Error("Local import exceeds the total size limit")
      if (files.length >= maxFiles) throw new Error("Local import exceeds the file count limit")
      const handle = await fs.open(native, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0))
      try {
        const opened = await handle.stat()
        if (
          !opened.isFile() ||
          opened.nlink !== 1 ||
          opened.dev !== metadata.dev ||
          opened.ino !== metadata.ino ||
          opened.size !== metadata.size
        ) {
          throw new Error("Local import source changed during import")
        }
        const bytes = new Uint8Array(metadata.size)
        let offset = 0
        while (offset < bytes.byteLength) {
          assertNotAborted(signal)
          const { bytesRead } = await handle.read(bytes, offset, bytes.byteLength - offset, offset)
          if (bytesRead === 0) throw new Error("Local import source changed during import")
          offset += bytesRead
        }
        const after = await handle.stat()
        const pathAfter = await fs.lstat(native)
        if (
          after.dev !== opened.dev ||
          after.ino !== opened.ino ||
          after.size !== opened.size ||
          after.mtimeMs !== opened.mtimeMs ||
          after.ctimeMs !== opened.ctimeMs ||
          pathAfter.dev !== opened.dev ||
          pathAfter.ino !== opened.ino ||
          pathAfter.size !== opened.size ||
          pathAfter.mtimeMs !== opened.mtimeMs ||
          pathAfter.ctimeMs !== opened.ctimeMs ||
          pathAfter.nlink !== 1
        ) {
          throw new Error("Local import source changed during import")
        }
        files.push({ bytes, mode: metadata.mode, path: portable })
      } finally {
        await handle.close()
      }
    }
    const directoryAfter = await fs.lstat(directory)
    if (
      !directoryAfter.isDirectory() ||
      directoryAfter.isSymbolicLink() ||
      directoryAfter.dev !== directoryBefore.dev ||
      directoryAfter.ino !== directoryBefore.ino ||
      directoryAfter.mtimeMs !== directoryBefore.mtimeMs ||
      directoryAfter.ctimeMs !== directoryBefore.ctimeMs
    )
      throw new Error("Local import source directory changed during import")
  }
  await visit(absoluteRoot, "", 0)
  files.sort((left, right) => left.path.localeCompare(right.path, "en"))
  return files
}

function detectKind(files: readonly InventoryFile[]): MarketplaceItemKind {
  const names = new Set(files.filter((file) => !file.path.includes("/")).map((file) => file.path))
  const matches = rootMarkers.filter(([marker]) => names.has(marker))
  if (matches.length !== 1) throw new Error("Local import must contain exactly one root marker")
  return matches[0]![1]
}

function parseIdentity(value: unknown, marketplaceId: string): LocalMarketplaceIdentity {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join("\0") !== ["marketplaceId", "policyVersion", "sourceInstanceId"].sort().join("\0")
  ) {
    throw new Error("Local Marketplace identity is invalid")
  }
  const record = value as Record<string, unknown>
  if (
    record.marketplaceId !== marketplaceId ||
    record.policyVersion !== 1 ||
    typeof record.sourceInstanceId !== "string" ||
    !sourceInstancePattern.test(record.sourceInstanceId)
  ) {
    throw new Error("Local Marketplace identity is invalid")
  }
  return record as unknown as LocalMarketplaceIdentity
}

function parseIndex(value: unknown): LocalMarketplaceIndex {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join("\0") !== ["packages", "revision", "schema"].sort().join("\0")
  ) {
    throw new Error("Local Marketplace index is invalid")
  }
  const record = value as Record<string, unknown>
  if (
    record.schema !== "convax.local-marketplace-index/1" ||
    !Number.isSafeInteger(record.revision) ||
    Number(record.revision) < 0 ||
    !Array.isArray(record.packages) ||
    record.packages.length > maxIndexPackages
  ) {
    throw new Error("Local Marketplace index is invalid")
  }
  const identities = new Set<string>()
  const snapshots = new Set<string>()
  const revisions = new Set<string>()
  for (const item of record.packages) {
    if (
      !item ||
      typeof item !== "object" ||
      Array.isArray(item) ||
      Object.keys(item).sort().join("\0") !==
        ["digest", "id", "kind", "revision", "snapshotKey", "version"].sort().join("\0")
    ) {
      throw new Error("Local Marketplace index is invalid")
    }
    const entry = item as Record<string, unknown>
    if (
      typeof entry.digest !== "string" ||
      !digestPattern.test(entry.digest) ||
      !rootMarkers.some(([, kind]) => kind === entry.kind) ||
      typeof entry.id !== "string" ||
      entry.id.length < 1 ||
      entry.id.length > 256 ||
      typeof entry.version !== "string" ||
      entry.version.length < 1 ||
      entry.version.length > 256 ||
      !Number.isSafeInteger(entry.revision) ||
      Number(entry.revision) < 1 ||
      typeof entry.snapshotKey !== "string" ||
      !/^(?:plugin|skill|mcp-server)\/[a-f0-9]{64}\/[1-9]\d*$/u.test(entry.snapshotKey)
    ) {
      throw new Error("Local Marketplace index is invalid")
    }
    const identity = `${entry.kind}\0${entry.id}`
    const revision = `${identity}\0${entry.revision}`
    if (
      snapshots.has(entry.snapshotKey as string) ||
      revisions.has(revision) ||
      (identities.has(identity) && Number(entry.revision) === 1)
    )
      throw new Error("Local Marketplace index repeats package authority")
    identities.add(identity)
    snapshots.add(entry.snapshotKey as string)
    revisions.add(revision)
  }
  return structuredClone(record) as unknown as LocalMarketplaceIndex
}

async function atomicJson(file: string, value: unknown) {
  const directory = path.dirname(file)
  await fs.mkdir(directory, { mode: 0o700, recursive: true })
  const temporary = path.join(directory, `.${path.basename(file)}.${randomUUID()}.tmp`)
  let published = false
  try {
    const handle = await fs.open(temporary, "wx", 0o600)
    try {
      await handle.writeFile(`${JSON.stringify(value)}\n`)
      await syncFileBytes(handle)
    } finally {
      await handle.close()
    }
    await fs.rename(temporary, file)
    published = true
    await syncDirectoryEntry(directory)
  } finally {
    if (!published) await fs.rm(temporary, { force: true })
  }
}

async function createJson(file: string, value: unknown) {
  const directory = path.dirname(file)
  await fs.mkdir(directory, { mode: 0o700, recursive: true })
  const temporary = path.join(directory, `.${path.basename(file)}.${randomUUID()}.tmp`)
  const handle = await fs.open(temporary, "wx", 0o600)
  try {
    await handle.writeFile(`${JSON.stringify(value)}\n`)
    await syncFileBytes(handle)
  } finally {
    await handle.close()
  }
  try {
    await fs.link(temporary, file)
    await fs.unlink(temporary)
    await syncDirectoryEntry(directory)
  } catch (error) {
    await fs.rm(temporary, { force: true })
    throw error
  }
}

interface LocalImportReceipt {
  candidate: LocalMarketplacePackage
  phase: "prepared" | "recovery-required"
  schema: "convax.local-import-transition/1"
}

function parseReceipt(value: unknown): LocalImportReceipt {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join("\0") !== ["candidate", "phase", "schema"].sort().join("\0")
  )
    throw new Error("Local import transition receipt is invalid")
  const receipt = value as Record<string, unknown>
  if (
    receipt.schema !== "convax.local-import-transition/1" ||
    (receipt.phase !== "prepared" && receipt.phase !== "recovery-required")
  )
    throw new Error("Local import transition receipt is invalid")
  const candidate = parseIndex({
    packages: [receipt.candidate],
    revision: 1,
    schema: "convax.local-marketplace-index/1",
  }).packages[0]!
  return {
    candidate,
    phase: receipt.phase,
    schema: "convax.local-import-transition/1",
  }
}

/**
 * Durable commit-point envelope for Local import. A prepared receipt is written
 * before the index commit. Recovery follows the index as the canonical decision:
 * indexed candidates keep their immutable snapshot; unindexed candidates roll it
 * back. No post-commit exception is allowed to guess by deleting bytes.
 */
export class FileLocalMarketplaceImportTransition implements LocalMarketplaceImportTransition {
  readonly #file: string
  #tail = Promise.resolve()

  constructor(file: string) {
    this.#file = path.resolve(file)
  }

  run(input: Parameters<LocalMarketplaceImportTransition["run"]>[0]): Promise<void> {
    return this.#serialize(async () => {
      const receipt: LocalImportReceipt = {
        candidate: structuredClone(input.candidate),
        phase: "prepared",
        schema: "convax.local-import-transition/1",
      }
      await atomicJson(this.#file, receipt)
      let committed = false
      try {
        await input.commitIndex()
        committed = true
        await fs.rm(this.#file, { force: true })
      } catch (error) {
        if (!committed) {
          await input.rollbackSnapshot()
          await fs.rm(this.#file, { force: true })
        } else {
          await atomicJson(this.#file, { ...receipt, phase: "recovery-required" } satisfies LocalImportReceipt)
        }
        throw error
      }
    })
  }

  recover(input: Parameters<NonNullable<LocalMarketplaceImportTransition["recover"]>>[0]): Promise<void> {
    return this.#serialize(async () => {
      let receipt: LocalImportReceipt
      try {
        const value = JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(
            await readBoundedAuthorityFile(this.#file, maxTransitionBytes, "Local import transition receipt"),
          ),
        ) as unknown
        receipt = parseReceipt(value)
      } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return
        throw error
      }
      if (!(await input.isIndexed(receipt.candidate))) await input.rollbackSnapshot(receipt.candidate)
      await fs.rm(this.#file, { force: true })
    })
  }

  #serialize<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.#tail.catch(() => undefined).then(operation)
    this.#tail = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }
}

export class LocalMarketplaceStore {
  readonly #beforeSourceRecheck?: () => Promise<void>
  readonly #hasRetainedReferences?: () => Promise<boolean>
  readonly #marketplaceId: string
  readonly #root: string
  readonly #transition: LocalMarketplaceImportTransition
  #tail = Promise.resolve()
  #recovered = false
  #initializing?: Promise<LocalMarketplaceIdentity>

  constructor(options: LocalMarketplaceStoreOptions) {
    if (!safeMarketplaceId.test(options.marketplaceId)) throw new Error("Local Marketplace id is invalid")
    this.#beforeSourceRecheck = options.beforeSourceRecheck
    this.#hasRetainedReferences = options.hasRetainedReferences
    this.#marketplaceId = options.marketplaceId
    this.#root = path.resolve(options.root)
    this.#transition = options.transition
  }

  async initialize(): Promise<LocalMarketplaceIdentity> {
    if (this.#initializing) return this.#initializing
    const initializing = this.#initialize()
    this.#initializing = initializing
    try {
      return await initializing
    } finally {
      if (this.#initializing === initializing) this.#initializing = undefined
    }
  }

  async #initialize(): Promise<LocalMarketplaceIdentity> {
    try {
      const root = await fs.lstat(this.#root)
      if (root.isSymbolicLink() || !root.isDirectory()) throw new Error("Local Marketplace root is invalid")
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error
      if (await this.#hasRetainedReferences?.()) {
        throw new Error("Local Marketplace is degraded because its referenced root is missing", { cause: error })
      }
      await fs.mkdir(this.#root, { mode: 0o700, recursive: true })
    }
    const file = path.join(this.#root, identityFile)
    try {
      return parseIdentity(
        JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(
            await readBoundedAuthorityFile(file, maxIdentityBytes, "Local Marketplace identity"),
          ),
        ),
        this.#marketplaceId,
      )
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error
    }
    const existing = await fs.readdir(this.#root)
    if (existing.length > 0 || (await this.#hasRetainedReferences?.())) {
      throw new Error("Local Marketplace is degraded because its identity is missing")
    }
    const identity: LocalMarketplaceIdentity = {
      marketplaceId: this.#marketplaceId,
      policyVersion: 1,
      sourceInstanceId: randomUUID(),
    }
    try {
      await createJson(file, identity)
      return identity
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "EEXIST")) throw error
      return parseIdentity(
        JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(
            await readBoundedAuthorityFile(file, maxIdentityBytes, "Local Marketplace identity"),
          ),
        ),
        this.#marketplaceId,
      )
    }
  }

  async list(): Promise<LocalMarketplaceIndex> {
    await this.initialize()
    if (!this.#recovered && this.#transition.recover) {
      await this.#transition.recover({
        isIndexed: async (candidate) =>
          (await this.#readIndex()).packages.some(
            (entry) => entry.kind === candidate.kind && entry.id === candidate.id && entry.digest === candidate.digest,
          ),
        rollbackSnapshot: (candidate) =>
          fs.rm(this.resolveSnapshotDirectory(candidate), { force: true, recursive: true }),
      })
      this.#recovered = true
    }
    return this.#readIndex()
  }

  async #readIndex(): Promise<LocalMarketplaceIndex> {
    try {
      return parseIndex(
        JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(
            await readBoundedAuthorityFile(path.join(this.#root, indexFile), maxIndexBytes, "Local Marketplace index"),
          ),
        ),
      )
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        return { packages: [], revision: 0, schema: "convax.local-marketplace-index/1" }
      }
      throw error
    }
  }

  importDirectory(source: string, signal?: AbortSignal): Promise<LocalMarketplacePackage> {
    const run = this.#tail.then(() => this.#importDirectory(source, signal))
    this.#tail = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  garbageCollect(
    isRetained: (candidate: LocalMarketplacePackage) => Promise<boolean>,
  ): Promise<readonly LocalMarketplacePackage[]> {
    const run = this.#tail.then(async () => {
      const current = await this.list()
      const latest = new Map<string, number>()
      for (const candidate of current.packages) {
        const key = `${candidate.kind}\0${candidate.id}`
        latest.set(key, Math.max(latest.get(key) ?? 0, candidate.revision))
      }
      const removed: LocalMarketplacePackage[] = []
      const retained: LocalMarketplacePackage[] = []
      for (const candidate of current.packages) {
        const key = `${candidate.kind}\0${candidate.id}`
        if (candidate.revision === latest.get(key) || (await isRetained(candidate))) {
          retained.push(candidate)
        } else removed.push(candidate)
      }
      if (removed.length > 0) {
        await atomicJson(path.join(this.#root, indexFile), {
          packages: retained,
          revision: current.revision + 1,
          schema: "convax.local-marketplace-index/1",
        } satisfies LocalMarketplaceIndex)
        await Promise.all(
          removed.map((candidate) => fs.rm(this.resolveSnapshotDirectory(candidate), { force: true, recursive: true })),
        )
      }
      return removed
    })
    this.#tail = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  /** Main-only native resolution. Never include this path in a renderer contract or persisted index. */
  resolveSnapshotDirectory(input: Pick<LocalMarketplacePackage, "snapshotKey">) {
    if (!/^(?:plugin|skill|mcp-server)\/[a-f0-9]{64}\/[1-9]\d*$/u.test(input.snapshotKey)) {
      throw new Error("Local Marketplace snapshot key is invalid")
    }
    return path.join(this.#root, "packages", ...input.snapshotKey.split("/"))
  }

  async projectCatalogItem(candidate: LocalMarketplacePackage, sourceKey: SourceKey): Promise<SourceQualifiedItem> {
    const files = await inventory(this.resolveSnapshotDirectory(candidate))
    if (
      digestInventory(files) !== candidate.digest ||
      detectKind(files) !== candidate.kind ||
      canonicalJson(packageIdentity(candidate.kind, files)) !==
        canonicalJson({ id: candidate.id, version: candidate.version })
    )
      throw new Error("Local Marketplace snapshot no longer matches its immutable identity")
    const byPath = new Map(files.map((file) => [file.path, file]))
    let delivery: SourceQualifiedItem["delivery"]
    let description = ""
    let pluginCategories: NonNullable<SourceQualifiedItem["pluginCategories"]> = []
    let runtimeSurface: SourceQualifiedItem["runtimeSurface"] = "none"
    if (candidate.kind === "mcp-server") {
      const serverJson = decodeJson(byPath.get("server.json")!.bytes, "server.json")
      const extensionValue = byPath.get("convax-mcp.json")
        ? decodeJson(byPath.get("convax-mcp.json")!.bytes, "convax-mcp.json")
        : undefined
      const parsed = parseServerPackage(serverJson, extensionValue)
      description = typeof serverJson.description === "string" ? serverJson.description : ""
      const serverJsonSha256 = sha256Hex(`${canonicalJson(serverJson)}\n`)
      if (parsed.runtime.kind === "http-agent") {
        delivery = {
          kind: "mcp-http",
          runtime: { endpoint: parsed.runtime.endpoint, transport: parsed.runtime.transport },
          serverJson,
          serverJsonSha256,
        }
        runtimeSurface = projectMcpRuntimeSurface(delivery)
      } else {
        const extension = parseMcpServerExtension(extensionValue)
        delivery = {
          companions: [],
          extension,
          extensionSha256: sha256Hex(`${canonicalJson(extension)}\n`),
          kind: "mcp-managed-stdio",
          serverJson,
          serverJsonSha256,
        }
        runtimeSurface = projectMcpRuntimeSurface(delivery)
      }
    } else {
      delivery = {
        kind: "artifact",
        sha256: candidate.digest,
        size: Math.max(
          1,
          files.reduce((sum, file) => sum + file.bytes.byteLength, 0),
        ),
        url: "https://local.invalid",
      }
      if (candidate.kind === "plugin") {
        const parsed = parsePluginRuntimeSurface(
          decodeJson(byPath.get("manifest.json")!.bytes, "manifest.json"),
          candidate,
        )
        const manifest = parsed.manifest
        pluginCategories = parsed.pluginCategories
        runtimeSurface = parsed.runtimeSurface
        description = manifest.description
      } else {
        const skill = parseAgentSkillMarkdown(
          new TextDecoder("utf-8", { fatal: true }).decode(byPath.get("SKILL.md")!.bytes),
        )
        description = skill.description
      }
    }
    return {
      catalogRevision: sha256Hex(canonicalJson({ digest: candidate.digest, revision: candidate.revision })),
      catalogSequence: candidate.revision,
      compatibility: { convax: "*" },
      delivery,
      id: candidate.id,
      kind: candidate.kind,
      marketplaceId: this.#marketplaceId,
      official: false,
      presentation: { description, name: candidate.id },
      ...(pluginCategories.length === 0 ? {} : { pluginCategories }),
      runtimeSurface,
      sourceKey,
      sourceKind: "local",
      sourceOrder: 0,
      version: candidate.version,
    }
  }

  async #importDirectory(source: string, signal?: AbortSignal): Promise<LocalMarketplacePackage> {
    assertNotAborted(signal)
    const identity = await this.initialize()
    const first = await inventory(source, signal)
    const kind = detectKind(first)
    if (kind === "mcp-server") assertMcpInert(first)
    const packageInfo = packageIdentity(kind, first)
    const digest = digestInventory(first)
    const current = await this.list()
    const duplicate = current.packages.find(
      (entry) => entry.kind === kind && entry.id === packageInfo.id && entry.digest === digest,
    )
    if (duplicate) return duplicate

    const revision =
      Math.max(
        0,
        ...current.packages
          .filter((entry) => entry.kind === kind && entry.id === packageInfo.id)
          .map((entry) => entry.revision),
      ) + 1
    const identityKey = createHash("sha256").update(`${kind}\0${packageInfo.id}`).digest("hex")
    const staging = path.join(this.#root, "staging", randomUUID())
    const snapshotKey = `${kind}/${identityKey}/${revision}`
    const target = this.resolveSnapshotDirectory({ snapshotKey })
    await fs.mkdir(staging, { mode: 0o700, recursive: true })
    let published = false
    let indexCommitted = false
    try {
      for (const file of first) {
        assertNotAborted(signal)
        const destination = path.join(staging, ...file.path.split("/"))
        await fs.mkdir(path.dirname(destination), { mode: 0o700, recursive: true })
        const handle = await fs.open(destination, "wx", file.mode & 0o111 ? 0o700 : 0o600)
        try {
          await handle.writeFile(file.bytes)
          await syncFileBytes(handle)
        } finally {
          await handle.close()
        }
      }
      if (this.#beforeSourceRecheck) await this.#beforeSourceRecheck()
      const second = await inventory(source, signal)
      if (digestInventory(second) !== digest) throw new Error("Local import source changed during import")
      const staged = await inventory(staging, signal)
      if (digestInventory(staged) !== digest) throw new Error("Local import staging changed during import")
      await fs.mkdir(path.dirname(target), { mode: 0o700, recursive: true })
      await fs.rename(staging, target)
      published = true
      const nextPackage: LocalMarketplacePackage = {
        digest,
        id: packageInfo.id,
        kind,
        revision,
        snapshotKey,
        version: packageInfo.version,
      }
      await this.#transition.run({
        candidate: structuredClone(nextPackage),
        commitIndex: async () => {
          await atomicJson(path.join(this.#root, indexFile), {
            packages: [...current.packages, nextPackage],
            revision: current.revision + 1,
            schema: "convax.local-marketplace-index/1",
          } satisfies LocalMarketplaceIndex)
          indexCommitted = true
        },
        rollbackSnapshot: () => fs.rm(target, { force: true, recursive: true }),
      })
      return nextPackage
    } catch (error) {
      // Once the portable index commit point is crossed, the immutable snapshot
      // is authoritative input to transition recovery and must never be guessed
      // away merely because a later receipt/finalization step failed.
      if (published && !indexCommitted) await fs.rm(target, { force: true, recursive: true })
      throw error
    } finally {
      await fs.rm(staging, { force: true, recursive: true })
      void identity
    }
  }
}
