import { randomUUID } from "node:crypto"
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

function errorCode(error: unknown) {
  return error && typeof error === "object" && "code" in error ? String(error.code) : undefined
}

function pathKey(value: string) {
  const normalized = value.normalize("NFC")
  return process.platform === "win32" || process.platform === "darwin"
    ? normalized.toLowerCase()
    : normalized
}

function isContained(parent: string, candidate: string) {
  const fromParent = relative(pathKey(parent), pathKey(candidate))
  return fromParent === ""
    || (fromParent !== ".." && !fromParent.startsWith(`..${sep}`) && !isAbsolute(fromParent))
}

function assertSafeSegment(segment: string) {
  if (
    !segment
    || segment === "."
    || segment === ".."
    || segment.includes("\0")
    || /[\\/:*?"<>|\u0000-\u001f]/u.test(segment)
    || /[. ]$/u.test(segment)
    || windowsReservedName.test(segment)
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
        !after.isFile()
        || after.isSymbolicLink()
        || after.dev !== info.dev
        || after.ino !== info.ino
        || after.size !== content.byteLength
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

/** A bounded, non-executable store for OpenCode-compatible user Skill directories. */
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
    const metadata = this.metadata(files)
    if (basename(source) !== metadata.name) {
      throw new Error("Skill directory name must exactly match the SKILL.md name")
    }
    return this.install(files, metadata)
  }

  async installFromFiles(input: Readonly<Record<string, string | Uint8Array>>) {
    const files = Object.entries(input).map(([path, content]) => ({
      content: typeof content === "string" ? new TextEncoder().encode(content) : Uint8Array.from(content),
      mode: 0o644,
      path: normalizePackagePath(path),
    }))
    assertFileInventory(files, this.limits)
    return this.install(files, this.metadata(files))
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
      const metadata = this.metadata(files)
      if (metadata.name !== entry.name) throw new Error(`Managed Skill directory does not match its name: ${entry.name}`)
      skills.push(this.record(metadata))
    }
    return skills.sort((left, right) => left.name.localeCompare(right.name))
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

  private metadata(files: readonly SkillFile[]) {
    const skillFiles = files.filter((file) => file.path.toLowerCase() === "skill.md")
    if (skillFiles.length !== 1 || skillFiles[0]!.path !== "SKILL.md") {
      throw new Error("Skill package must contain exactly one root SKILL.md")
    }
    return parseFrontmatter(skillFiles[0]!.content)
  }

  private record(metadata: { description: string; name: string }): ManagedAgentSkill {
    const directory = join(this.userDirectory, metadata.name)
    return { ...metadata, directory, skillFile: join(directory, "SKILL.md") }
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
      for (const file of [...files].sort((left, right) => left.path.localeCompare(right.path))) {
        const destination = join(staging, ...file.path.split("/"))
        if (!isContained(staging, destination)) throw new Error("Skill package path escapes the staging directory")
        await mkdir(dirname(destination), { recursive: true })
        await writeFile(destination, file.content, { flag: "wx", mode: file.mode })
      }
      await rename(staging, target)
    } catch (error) {
      await rm(staging, { force: true, recursive: true })
      if (errorCode(error) === "EEXIST" || errorCode(error) === "ENOTEMPTY") {
        throw new Error(`Skill is already installed: ${metadata.name}`)
      }
      throw error
    }
    return this.record(metadata)
  }
}
