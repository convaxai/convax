import { createHash, randomUUID } from "node:crypto"
import { lstat, mkdir, open, readdir, rename, rm, writeFile, type FileHandle } from "node:fs/promises"
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path"

export interface ManagedAgentSkillLimits {
  maxFileBytes: number
  maxFiles: number
  maxTotalBytes: number
}

export interface ManagedAgentSkill {
  description: string
  directory: string
  name: string
  skillFile: string
}

export interface AgentSkillInspectionFile {
  content: Uint8Array
  path: string
}

export interface AgentSkillInspection {
  description: string
  files: AgentSkillInspectionFile[]
  name: string
}

export interface ManagedAgentSkillInspection extends AgentSkillInspection, ManagedAgentSkill {}

export interface ManagedAgentSkillInstallOptions {
  expectedName?: string
}

export interface ManagedAgentSkillPrepareOptions extends ManagedAgentSkillInstallOptions {
  /** Replaces an existing managed Skill only when the host has already established ownership. */
  replaceExisting?: boolean
}

export interface ManagedAgentSkillPublicationRecovery {
  name: string
  nextSha256?: string
  operation: "install" | "remove" | "replace"
  previousSha256?: string
  schema: "convax.managed-skill-publication/1"
  transactionId: string
}

/**
 * Generic, host-agnostic publication transaction for composing a managed Skill
 * mutation with another durable capability. Plugin ownership remains a Desktop
 * concern; this store only provides reversible filesystem publication.
 */
export interface ManagedAgentSkillPublication {
  readonly recovery: ManagedAgentSkillPublicationRecovery
  readonly skill: ManagedAgentSkill
  publish(): Promise<void>
  commit(): Promise<void>
  rollback(): Promise<void>
}

export const defaultManagedAgentSkillLimits: Readonly<ManagedAgentSkillLimits> = Object.freeze({
  maxFileBytes: 2 * 1024 * 1024,
  maxFiles: 512,
  maxTotalBytes: 20 * 1024 * 1024,
})

interface SkillFile {
  content: Uint8Array
  mode: number
  path: string
}

const kebabName = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const windowsReservedName = /^(?:con|prn|aux|nul|com[1-9\u00b9\u00b2\u00b3]|lpt[1-9\u00b9\u00b2\u00b3])(?:\.|$)/iu
const stagingPrefix = ".install-"
const publicationRecoverySchema = "convax.managed-skill-publication/1" as const
const publicationTransactionPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const publicationDigestPattern = /^[a-f0-9]{64}$/

function errorCode(error: unknown) {
  return error && typeof error === "object" && "code" in error ? String(error.code) : undefined
}

function pathKey(value: string) {
  const normalized = value.normalize("NFC")
  return process.platform === "win32" || process.platform === "darwin" ? normalized.toLowerCase() : normalized
}

function isContained(parent: string, candidate: string) {
  const fromParent = relative(pathKey(parent), pathKey(candidate))
  return fromParent === "" || (fromParent !== ".." && !fromParent.startsWith(`..${sep}`) && !isAbsolute(fromParent))
}

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
    throw new Error(`Skill package contains an unsafe path segment: ${JSON.stringify(segment)}`)
  }
}

function assertSkillName(name: string) {
  assertSafeSegment(name)
  if (name.length > 64 || !kebabName.test(name)) {
    throw new Error("Skill name must be a kebab-case identifier of at most 64 characters")
  }
}

function normalizePackagePath(value: string) {
  if (!value || value.startsWith("/") || value.includes("\\") || value.includes("\0")) {
    throw new Error(`Skill package path is invalid: ${JSON.stringify(value)}`)
  }
  const segments = value.split("/")
  for (const segment of segments) assertSafeSegment(segment)
  return segments.map((segment) => segment.normalize("NFC")).join("/")
}

export function digestAgentSkillFiles(files: readonly AgentSkillInspectionFile[]) {
  const hash = createHash("sha256")
  for (const file of [...files].sort((left, right) => compareText(left.path, right.path))) {
    const pathBytes = new TextEncoder().encode(file.path)
    const header = Buffer.alloc(8)
    header.writeUInt32BE(pathBytes.byteLength, 0)
    header.writeUInt32BE(file.content.byteLength, 4)
    hash.update(header)
    hash.update(pathBytes)
    hash.update(file.content)
  }
  return hash.digest("hex")
}

function compareText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0
}

function validatePublicationRecovery(
  value: ManagedAgentSkillPublicationRecovery,
): ManagedAgentSkillPublicationRecovery {
  if (value.schema !== publicationRecoverySchema || !publicationTransactionPattern.test(value.transactionId)) {
    throw new Error("Managed Skill publication recovery receipt is invalid")
  }
  assertSkillName(value.name)
  if (!(["install", "remove", "replace"] as const).includes(value.operation)) {
    throw new Error("Managed Skill publication recovery receipt is invalid")
  }
  if (value.previousSha256 !== undefined && !publicationDigestPattern.test(value.previousSha256)) {
    throw new Error("Managed Skill publication recovery receipt is invalid")
  }
  if (value.nextSha256 !== undefined && !publicationDigestPattern.test(value.nextSha256)) {
    throw new Error("Managed Skill publication recovery receipt is invalid")
  }
  if (
    (value.operation === "install" && (value.previousSha256 !== undefined || value.nextSha256 === undefined)) ||
    (value.operation === "replace" && (value.previousSha256 === undefined || value.nextSha256 === undefined)) ||
    (value.operation === "remove" && (value.previousSha256 === undefined || value.nextSha256 !== undefined))
  ) {
    throw new Error("Managed Skill publication recovery receipt is invalid")
  }
  return value
}

function decodeScalar(value: string) {
  const trimmed = value.trim()
  if (trimmed.startsWith('"')) {
    try {
      const decoded = JSON.parse(trimmed) as unknown
      if (typeof decoded !== "string") throw new Error("not a string")
      return decoded
    } catch {
      throw new Error("Skill frontmatter contains an invalid quoted string")
    }
  }
  if (trimmed.startsWith("'")) {
    if (!trimmed.endsWith("'") || trimmed.length < 2) {
      throw new Error("Skill frontmatter contains an invalid quoted string")
    }
    return trimmed.slice(1, -1).replaceAll("''", "'")
  }
  return trimmed
}

function parseFrontmatter(content: Uint8Array) {
  let text: string
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(content).replace(/^\uFEFF/u, "")
  } catch {
    throw new Error("SKILL.md must be valid UTF-8")
  }
  const lines = text.split(/\r?\n/u)
  if (lines[0]?.trim() !== "---") throw new Error("SKILL.md must start with YAML frontmatter")
  const closing = lines.findIndex((line, index) => index > 0 && line.trim() === "---")
  if (closing < 0) throw new Error("SKILL.md frontmatter is not closed")

  const values = new Map<string, string>()
  for (let index = 1; index < closing; index += 1) {
    const line = lines[index]!
    if (!line.trim() || line.trimStart().startsWith("#")) continue
    const match = line.match(/^([A-Za-z][A-Za-z0-9_-]*):(?:\s*(.*))?$/u)
    if (!match) continue
    const key = match[1]!
    if (key !== "name" && key !== "description") continue
    if (values.has(key)) throw new Error(`SKILL.md frontmatter repeats ${key}`)
    const raw = match[2] ?? ""
    const block = raw.match(/^([>|])[-+]?$/u)
    if (!block) {
      values.set(key, decodeScalar(raw))
      continue
    }

    const blockLines: string[] = []
    while (index + 1 < closing) {
      const next = lines[index + 1]!
      if (next && !/^\s/u.test(next)) break
      index += 1
      blockLines.push(next.replace(/^ {1,2}/u, ""))
    }
    values.set(key, block[1] === ">" ? blockLines.join(" ").trim() : blockLines.join("\n").trim())
  }

  const name = values.get("name")?.trim() ?? ""
  const description = values.get("description")?.trim() ?? ""
  assertSkillName(name)
  if (!description) throw new Error("SKILL.md frontmatter requires a description")
  if (description.length > 1_024) throw new Error("Skill description must contain at most 1024 characters")
  return { description, name }
}

function checkedLimits(limits: Partial<ManagedAgentSkillLimits> | undefined): ManagedAgentSkillLimits {
  const merged = { ...defaultManagedAgentSkillLimits, ...limits }
  for (const [key, value] of Object.entries(merged)) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${key} must be a positive integer`)
  }
  return merged
}

function assertFileInventory(files: readonly SkillFile[], limits: ManagedAgentSkillLimits) {
  if (files.length === 0) throw new Error("Skill package is empty")
  if (files.length > limits.maxFiles) throw new Error(`Skill package exceeds the ${limits.maxFiles} file limit`)
  let total = 0
  const paths = new Set<string>()
  for (const file of files) {
    const normalized = normalizePackagePath(file.path)
    const key = normalized.normalize("NFC").toLowerCase()
    if (paths.has(key)) throw new Error(`Skill package repeats a path: ${normalized}`)
    for (const existing of paths) {
      if (existing.startsWith(`${key}/`) || key.startsWith(`${existing}/`)) {
        throw new Error(`Skill package has conflicting file paths: ${normalized}`)
      }
    }
    paths.add(key)
    if (file.content.byteLength > limits.maxFileBytes) {
      throw new Error(`${normalized} exceeds the ${limits.maxFileBytes} byte file limit`)
    }
    total += file.content.byteLength
    if (total > limits.maxTotalBytes) {
      throw new Error(`Skill package exceeds the ${limits.maxTotalBytes} byte total limit`)
    }
  }
}

async function readBoundedFile(handle: FileHandle, size: number) {
  const content = Buffer.alloc(size)
  let offset = 0
  while (offset < size) {
    const { bytesRead } = await handle.read(content, offset, size - offset, offset)
    if (bytesRead === 0) break
    offset += bytesRead
  }
  if (offset !== size) throw new Error("Skill package changed while it was being imported")
  const extra = Buffer.alloc(1)
  if ((await handle.read(extra, 0, 1, size)).bytesRead !== 0) {
    throw new Error("Skill package changed while it was being imported")
  }
  return content
}

async function readDirectoryFiles(source: string, limits: ManagedAgentSkillLimits) {
  const rootInfo = await lstat(source)
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) {
    throw new Error("Skill import source must be a real directory, not a symlink")
  }

  const files: SkillFile[] = []
  let directoryCount = 0
  let totalBytes = 0
  const visit = async (directory: string, segments: string[]): Promise<void> => {
    directoryCount += 1
    if (directoryCount > limits.maxFiles || segments.length > 32) {
      throw new Error("Skill package has too many or too deeply nested directories")
    }
    const entries = await readdir(directory, { withFileTypes: true })
    for (const entry of entries) {
      assertSafeSegment(entry.name)
      const entrySegments = [...segments, entry.name.normalize("NFC")]
      const absolute = join(directory, entry.name)
      const info = await lstat(absolute)
      if (info.isSymbolicLink()) throw new Error(`Skill package cannot contain symlinks: ${entrySegments.join("/")}`)
      if (info.isDirectory()) {
        await visit(absolute, entrySegments)
        continue
      }
      if (!info.isFile()) throw new Error(`Skill package can contain only regular files: ${entrySegments.join("/")}`)
      if (info.size > limits.maxFileBytes) {
        throw new Error(`${entrySegments.join("/")} exceeds the ${limits.maxFileBytes} byte file limit`)
      }
      totalBytes += info.size
      if (totalBytes > limits.maxTotalBytes) {
        throw new Error(`Skill package exceeds the ${limits.maxTotalBytes} byte total limit`)
      }
      const handle = await open(absolute, "r")
      let content: Uint8Array
      try {
        const opened = await handle.stat()
        if (!opened.isFile() || opened.dev !== info.dev || opened.ino !== info.ino || opened.size !== info.size) {
          throw new Error(`Skill package changed while it was being imported: ${entrySegments.join("/")}`)
        }
        content = await readBoundedFile(handle, opened.size)
      } finally {
        await handle.close()
      }
      const after = await lstat(absolute)
      if (
        !after.isFile() ||
        after.isSymbolicLink() ||
        after.dev !== info.dev ||
        after.ino !== info.ino ||
        after.size !== content.byteLength
      ) {
        throw new Error(`Skill package changed while it was being imported: ${entrySegments.join("/")}`)
      }
      totalBytes += content.byteLength - info.size
      if (totalBytes > limits.maxTotalBytes) {
        throw new Error(`Skill package exceeds the ${limits.maxTotalBytes} byte total limit`)
      }
      files.push({ content, mode: info.mode & 0o777, path: entrySegments.join("/") })
      if (files.length > limits.maxFiles) throw new Error(`Skill package exceeds the ${limits.maxFiles} file limit`)
    }
  }
  await visit(source, [])
  assertFileInventory(files, limits)
  return files
}

function skillMetadata(files: readonly SkillFile[]) {
  const skillFiles = files.filter((file) => file.path.toLowerCase() === "skill.md")
  if (skillFiles.length !== 1 || skillFiles[0]!.path !== "SKILL.md") {
    throw new Error("Skill package must contain exactly one root SKILL.md")
  }
  return parseFrontmatter(skillFiles[0]!.content)
}

/** Strict metadata validator for hosts that already own a bounded immutable file inventory. */
export function parseAgentSkillMarkdown(content: string) {
  return parseFrontmatter(new TextEncoder().encode(content))
}

function inspectedFiles(files: readonly SkillFile[]): AgentSkillInspectionFile[] {
  return files
    .map((file) => ({ content: Uint8Array.from(file.content), path: file.path }))
    .sort((left, right) => compareText(left.path, right.path))
}

export async function inspectAgentSkillDirectory(
  sourceDirectory: string,
  limits?: Partial<ManagedAgentSkillLimits>,
): Promise<AgentSkillInspection> {
  if (!sourceDirectory || sourceDirectory.includes("\0") || !isAbsolute(sourceDirectory)) {
    throw new Error("Skill inspection source must be an absolute path")
  }
  const files = await readDirectoryFiles(resolve(sourceDirectory), checkedLimits(limits))
  return { ...skillMetadata(files), files: inspectedFiles(files) }
}

/** A bounded, non-executable store for DSH-compatible user Skill directories. */
export class ManagedAgentSkillStore {
  readonly userDirectory: string
  private readonly configRoot: string
  private readonly limits: ManagedAgentSkillLimits
  private readonly skillsDirectory: string

  constructor(configRoot: string, limits?: Partial<ManagedAgentSkillLimits>) {
    if (!configRoot || configRoot.includes("\0") || !isAbsolute(configRoot)) {
      throw new Error("Managed Skill config root must be an absolute path")
    }
    const root = resolve(configRoot)
    this.configRoot = root
    this.skillsDirectory = join(root, "skills")
    this.userDirectory = join(this.skillsDirectory, "user")
    this.limits = checkedLimits(limits)
  }

  isManagedLocation(location: string) {
    if (!location || location.includes("\0") || !isAbsolute(location)) return false
    const absolute = resolve(location)
    if (!isContained(this.userDirectory, absolute) || pathKey(absolute) === pathKey(this.userDirectory)) return false
    const first = relative(this.userDirectory, absolute).split(sep)[0] ?? ""
    try {
      assertSkillName(first)
      return true
    } catch {
      return false
    }
  }

  async importFromDirectory(sourceDirectory: string) {
    if (!sourceDirectory || sourceDirectory.includes("\0") || !isAbsolute(sourceDirectory)) {
      throw new Error("Skill import source must be an absolute path")
    }
    const source = resolve(sourceDirectory)
    const files = await readDirectoryFiles(source, this.limits)
    const metadata = skillMetadata(files)
    if (basename(source) !== metadata.name) {
      throw new Error("Skill directory name must exactly match the SKILL.md name")
    }
    return this.install(files, metadata)
  }

  async installFromFiles(
    input: Readonly<Record<string, string | Uint8Array>>,
    options?: Readonly<ManagedAgentSkillInstallOptions>,
  ) {
    const files = Object.entries(input).map(([path, content]) => ({
      content: typeof content === "string" ? new TextEncoder().encode(content) : Uint8Array.from(content),
      mode: 0o644,
      path: normalizePackagePath(path),
    }))
    assertFileInventory(files, this.limits)
    const metadata = skillMetadata(files)
    if (options?.expectedName !== undefined) {
      assertSkillName(options.expectedName)
      if (metadata.name !== options.expectedName) {
        throw new Error(`Skill package name does not match the expected name: ${options.expectedName}`)
      }
    }
    return this.install(files, metadata)
  }

  async prepareInstallFromFiles(
    input: Readonly<Record<string, string | Uint8Array>>,
    options: Readonly<ManagedAgentSkillPrepareOptions> = {},
  ): Promise<ManagedAgentSkillPublication> {
    const files = Object.entries(input).map(([path, content]) => ({
      content: typeof content === "string" ? new TextEncoder().encode(content) : Uint8Array.from(content),
      mode: 0o644,
      path: normalizePackagePath(path),
    }))
    assertFileInventory(files, this.limits)
    const metadata = skillMetadata(files)
    if (options.expectedName !== undefined) {
      assertSkillName(options.expectedName)
      if (metadata.name !== options.expectedName) {
        throw new Error(`Skill package name does not match the expected name: ${options.expectedName}`)
      }
    }
    return this.prepareInstall(files, metadata, options.replaceExisting === true)
  }

  async prepareUninstall(name: string): Promise<ManagedAgentSkillPublication | null> {
    assertSkillName(name)
    await this.ensureRoot()
    const target = join(this.userDirectory, name)
    let info
    try {
      info = await lstat(target)
    } catch (error) {
      if (errorCode(error) === "ENOENT") return null
      throw error
    }
    if (info.isSymbolicLink() || !info.isDirectory() || !this.isManagedLocation(target)) {
      throw new Error("Refusing to uninstall a location outside the managed user Skill store")
    }
    const inspection = await this.inspect(name)
    const transactionId = randomUUID()
    const backup = join(this.userDirectory, `${stagingPrefix}backup-${transactionId}`)
    const recovery = {
      name,
      operation: "remove",
      previousSha256: digestAgentSkillFiles(inspection.files),
      schema: publicationRecoverySchema,
      transactionId,
    } as const satisfies ManagedAgentSkillPublicationRecovery
    let published = false
    let committed = false
    return {
      recovery,
      skill: inspection,
      async publish() {
        if (published || committed) throw new Error(`Skill removal transaction is no longer publishable: ${name}`)
        await rename(target, backup)
        published = true
      },
      async commit() {
        if (!published || committed) return
        await rm(backup, { force: true, recursive: true })
        committed = true
      },
      async rollback() {
        if (committed) return
        if (published) {
          await rename(backup, target)
          published = false
        }
        await rm(backup, { force: true, recursive: true })
      },
    }
  }

  /**
   * Completes or rolls back one journaled publication after a host crash. The
   * receipt contains no host-specific ownership data; exact content digests
   * keep recovery from deleting or restoring a directory that changed later.
   */
  async recoverPublication(input: ManagedAgentSkillPublicationRecovery, outcome: "commit" | "rollback"): Promise<void> {
    const recovery = validatePublicationRecovery(input)
    await this.ensureRoot()
    const target = join(this.userDirectory, recovery.name)
    const staging = join(this.userDirectory, `${stagingPrefix}stage-${recovery.transactionId}`)
    const backup = join(this.userDirectory, `${stagingPrefix}backup-${recovery.transactionId}`)
    const digest = (directory: string) => this.directoryDigest(directory, recovery.name)
    const removeExact = async (directory: string, expected: string | undefined, label: string) => {
      const actual = await digest(directory)
      if (actual === undefined) return false
      if (!expected || actual !== expected) throw new Error(`${label} changed before managed Skill recovery`)
      await rm(directory, { recursive: true })
      return true
    }

    if (outcome === "commit") {
      if (recovery.operation === "remove") {
        const current = await digest(target)
        const previous = await digest(backup)
        if (current === recovery.previousSha256 && previous === undefined) {
          await rename(target, backup)
        } else if (current !== undefined || (previous !== undefined && previous !== recovery.previousSha256)) {
          throw new Error("Managed Skill removal changed before recovery")
        }
        await removeExact(backup, recovery.previousSha256, "Managed Skill backup")
        return
      }

      const current = await digest(target)
      const staged = await digest(staging)
      const previous = await digest(backup)
      if (recovery.operation === "install") {
        if (previous !== undefined) throw new Error("Unexpected managed Skill backup for an install")
        if (current === undefined) {
          if (staged !== recovery.nextSha256) throw new Error("Managed Skill staging changed before recovery")
          await rename(staging, target)
        } else if (current !== recovery.nextSha256) {
          throw new Error("Published managed Skill changed before recovery")
        } else {
          await removeExact(staging, recovery.nextSha256, "Managed Skill staging directory")
        }
        return
      }

      if (current === recovery.previousSha256 && staged === recovery.nextSha256 && previous === undefined) {
        await rename(target, backup)
        await rename(staging, target)
      } else if (current === undefined && staged === recovery.nextSha256 && previous === recovery.previousSha256) {
        await rename(staging, target)
      } else if (
        current !== recovery.nextSha256 ||
        (staged !== undefined && staged !== recovery.nextSha256) ||
        (previous !== undefined && previous !== recovery.previousSha256)
      ) {
        throw new Error("Managed Skill replacement changed before recovery")
      }
      await removeExact(backup, recovery.previousSha256, "Managed Skill backup")
      await removeExact(staging, recovery.nextSha256, "Managed Skill staging directory")
      return
    }

    if (recovery.operation === "install") {
      const current = await digest(target)
      const staged = await digest(staging)
      const previous = await digest(backup)
      if (previous !== undefined) throw new Error("Unexpected managed Skill backup for an install")
      if (current !== undefined && current !== recovery.nextSha256) {
        throw new Error("Published managed Skill changed before rollback")
      }
      if (staged !== undefined && staged !== recovery.nextSha256) {
        throw new Error("Managed Skill staging directory changed before rollback")
      }
      await removeExact(target, recovery.nextSha256, "Published managed Skill")
      await removeExact(staging, recovery.nextSha256, "Managed Skill staging directory")
      return
    }

    if (recovery.operation === "replace") {
      const current = await digest(target)
      const previous = await digest(backup)
      const staged = await digest(staging)
      if (current === recovery.previousSha256 && previous === undefined) {
        if (staged !== undefined && staged !== recovery.nextSha256) {
          throw new Error("Managed Skill staging directory changed before rollback")
        }
        await removeExact(staging, recovery.nextSha256, "Managed Skill staging directory")
        return
      }
      if (current !== undefined && current !== recovery.nextSha256) {
        throw new Error("Published managed Skill changed before rollback")
      }
      if (previous !== recovery.previousSha256) throw new Error("Managed Skill backup changed before rollback")
      if (staged !== undefined && staged !== recovery.nextSha256) {
        throw new Error("Managed Skill staging directory changed before rollback")
      }
      if (current !== undefined) await removeExact(target, recovery.nextSha256, "Published managed Skill")
      await rename(backup, target)
      await removeExact(staging, recovery.nextSha256, "Managed Skill staging directory")
      return
    }

    const current = await digest(target)
    const previous = await digest(backup)
    if (current === recovery.previousSha256 && previous === undefined) return
    if (current !== undefined) throw new Error("Removed managed Skill target changed before rollback")
    if (previous !== recovery.previousSha256) throw new Error("Managed Skill removal backup changed before rollback")
    await rename(backup, target)
  }

  /** Remove abandoned pre-publication staging directories; published backups
   * always require a durable receipt and are never guessed away. */
  async cleanupAbandonedPublications(activeTransactionIds: ReadonlySet<string> = new Set()) {
    await this.ensureRoot()
    for (const entry of await readdir(this.userDirectory, { withFileTypes: true })) {
      if (!entry.name.startsWith(stagingPrefix)) continue
      if (entry.isSymbolicLink() || !entry.isDirectory()) {
        throw new Error(`Managed Skill publication remnant is not a real directory: ${entry.name}`)
      }
      const current = /^\.install-(stage|backup)-([0-9a-f-]{36})$/.exec(entry.name)
      if (current) {
        const transactionId = current[2]!
        if (!publicationTransactionPattern.test(transactionId)) {
          throw new Error(`Managed Skill publication remnant is invalid: ${entry.name}`)
        }
        if (activeTransactionIds.has(transactionId)) continue
        if (current[1] === "backup") {
          throw new Error(`Managed Skill backup has no recovery journal: ${entry.name}`)
        }
        await rm(join(this.userDirectory, entry.name), { recursive: true })
        continue
      }
      if (/^\.install-[0-9a-f-]{36}$/.test(entry.name)) {
        await rm(join(this.userDirectory, entry.name), { recursive: true })
        continue
      }
      throw new Error(`Managed Skill publication remnant has no recovery journal: ${entry.name}`)
    }
  }

  async list(): Promise<ManagedAgentSkill[]> {
    await this.ensureRoot()
    const entries = await readdir(this.userDirectory, { withFileTypes: true })
    const skills: ManagedAgentSkill[] = []
    for (const entry of entries) {
      if (entry.name.startsWith(stagingPrefix)) continue
      assertSkillName(entry.name)
      if (entry.isSymbolicLink() || !entry.isDirectory()) {
        throw new Error(`Managed Skill entry is not a real directory: ${entry.name}`)
      }
      const directory = join(this.userDirectory, entry.name)
      const files = await readDirectoryFiles(directory, this.limits)
      const metadata = skillMetadata(files)
      if (metadata.name !== entry.name)
        throw new Error(`Managed Skill directory does not match its name: ${entry.name}`)
      skills.push(this.record(metadata))
    }
    return skills.sort((left, right) => left.name.localeCompare(right.name))
  }

  async inspect(name: string): Promise<ManagedAgentSkillInspection> {
    assertSkillName(name)
    await this.ensureRoot()
    const directory = join(this.userDirectory, name)
    const files = await readDirectoryFiles(directory, this.limits)
    const metadata = skillMetadata(files)
    if (metadata.name !== name) throw new Error(`Managed Skill directory does not match its name: ${name}`)
    return { ...this.record(metadata), files: inspectedFiles(files) }
  }

  async uninstall(name: string) {
    assertSkillName(name)
    await this.ensureRoot()
    const target = join(this.userDirectory, name)
    let info
    try {
      info = await lstat(target)
    } catch (error) {
      if (errorCode(error) === "ENOENT") return false
      throw error
    }
    if (info.isSymbolicLink() || !info.isDirectory() || !this.isManagedLocation(target)) {
      throw new Error("Refusing to uninstall a location outside the managed user Skill store")
    }
    await rm(target, { recursive: true })
    return true
  }

  private record(metadata: { description: string; name: string }): ManagedAgentSkill {
    const directory = join(this.userDirectory, metadata.name)
    return { ...metadata, directory, skillFile: join(directory, "SKILL.md") }
  }

  private async directoryDigest(directory: string, expectedName: string) {
    let info
    try {
      info = await lstat(directory)
    } catch (error) {
      if (errorCode(error) === "ENOENT") return undefined
      throw error
    }
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new Error("Managed Skill recovery path must be a real directory")
    }
    const files = await readDirectoryFiles(directory, this.limits)
    const metadata = skillMetadata(files)
    if (metadata.name !== expectedName) throw new Error("Managed Skill recovery directory has the wrong name")
    return digestAgentSkillFiles(inspectedFiles(files))
  }

  private async ensureRoot() {
    await mkdir(this.configRoot, { recursive: true })
    const configInfo = await lstat(this.configRoot)
    if (configInfo.isSymbolicLink() || !configInfo.isDirectory()) {
      throw new Error("Managed Skill config root cannot be a symlink")
    }
    await mkdir(this.skillsDirectory, { recursive: true })
    const skillsInfo = await lstat(this.skillsDirectory)
    if (skillsInfo.isSymbolicLink() || !skillsInfo.isDirectory()) {
      throw new Error("Managed Skill root cannot be a symlink")
    }
    await mkdir(this.userDirectory, { recursive: true })
    const userInfo = await lstat(this.userDirectory)
    if (userInfo.isSymbolicLink() || !userInfo.isDirectory()) {
      throw new Error("Managed user Skill root cannot be a symlink")
    }
  }

  private async install(files: readonly SkillFile[], metadata: { description: string; name: string }) {
    await this.ensureRoot()
    const target = join(this.userDirectory, metadata.name)
    try {
      await lstat(target)
      throw new Error(`Skill is already installed: ${metadata.name}`)
    } catch (error) {
      if (errorCode(error) !== "ENOENT") throw error
    }

    const staging = join(this.userDirectory, `${stagingPrefix}${randomUUID()}`)
    await mkdir(staging, { mode: 0o700 })
    try {
      for (const file of [...files].sort((left, right) => compareText(left.path, right.path))) {
        const destination = join(staging, ...file.path.split("/"))
        if (!isContained(staging, destination)) throw new Error("Skill package path escapes the staging directory")
        await mkdir(dirname(destination), { recursive: true })
        await writeFile(destination, file.content, { flag: "wx", mode: file.mode })
      }
      await rename(staging, target)
    } catch (error) {
      await rm(staging, { force: true, recursive: true })
      if (errorCode(error) === "EEXIST" || errorCode(error) === "ENOTEMPTY") {
        throw new Error(`Skill is already installed: ${metadata.name}`, { cause: error })
      }
      throw error
    }
    return this.record(metadata)
  }

  private async prepareInstall(
    files: readonly SkillFile[],
    metadata: { description: string; name: string },
    replaceExisting: boolean,
  ): Promise<ManagedAgentSkillPublication> {
    await this.ensureRoot()
    const target = join(this.userDirectory, metadata.name)
    let targetExists = false
    try {
      const info = await lstat(target)
      if (info.isSymbolicLink() || !info.isDirectory() || !this.isManagedLocation(target)) {
        throw new Error("Refusing to replace a location outside the managed user Skill store")
      }
      targetExists = true
    } catch (error) {
      if (errorCode(error) !== "ENOENT") throw error
    }
    if (targetExists && !replaceExisting) throw new Error(`Skill is already installed: ${metadata.name}`)

    const transactionId = randomUUID()
    const staging = join(this.userDirectory, `${stagingPrefix}stage-${transactionId}`)
    const backup = join(this.userDirectory, `${stagingPrefix}backup-${transactionId}`)
    const previousSha256 = targetExists ? digestAgentSkillFiles((await this.inspect(metadata.name)).files) : undefined
    const recovery = {
      name: metadata.name,
      nextSha256: digestAgentSkillFiles(inspectedFiles(files)),
      operation: targetExists ? "replace" : "install",
      ...(previousSha256 ? { previousSha256 } : {}),
      schema: publicationRecoverySchema,
      transactionId,
    } as const satisfies ManagedAgentSkillPublicationRecovery
    await mkdir(staging, { mode: 0o700 })
    try {
      for (const file of [...files].sort((left, right) => compareText(left.path, right.path))) {
        const destination = join(staging, ...file.path.split("/"))
        if (!isContained(staging, destination)) throw new Error("Skill package path escapes the staging directory")
        await mkdir(dirname(destination), { recursive: true })
        await writeFile(destination, file.content, { flag: "wx", mode: file.mode })
      }
    } catch (error) {
      await rm(staging, { force: true, recursive: true })
      throw error
    }

    let published = false
    let backedUp = false
    let committed = false
    const skill = this.record(metadata)
    return {
      recovery,
      skill,
      async publish() {
        if (published || committed)
          throw new Error(`Skill install transaction is no longer publishable: ${metadata.name}`)
        if (targetExists) {
          await rename(target, backup)
          backedUp = true
        }
        try {
          await rename(staging, target)
          published = true
        } catch (error) {
          if (backedUp) {
            await rename(backup, target)
            backedUp = false
          }
          throw error
        }
      },
      async commit() {
        if (!published || committed) return
        await rm(backup, { force: true, recursive: true })
        committed = true
      },
      async rollback() {
        if (committed) return
        if (published) {
          await rm(target, { force: true, recursive: true })
          published = false
        }
        if (backedUp) {
          await rename(backup, target)
          backedUp = false
        }
        await rm(staging, { force: true, recursive: true })
        await rm(backup, { force: true, recursive: true })
      },
    }
  }
}
