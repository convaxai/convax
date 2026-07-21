import { createHash, randomUUID } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import type {
  ProjectEntry,
  ProjectMutationResult,
  ProjectRecord,
} from "../contracts"

export interface ProjectRegistryRecord extends ProjectRecord {}

export interface ProjectRegistryFile {
  projects: ProjectRegistryRecord[]
  version: 1
}

export interface ProjectManifest {
  projectId: string
  schemaVersion: "convax.project/1"
}

const ignoredNames = new Set([
  ".convax",
  ".git",
  ".next",
  ".turbo",
  ".vite",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "release",
])

export const projectManifestPath = ".convax/project.json"
export const textPreviewBytes = 64 * 1024

export function normalizeRelativePath(value?: string) {
  const input = (value ?? "").replaceAll("\\", "/")
  if (!input || input === ".") return ""
  if (input.includes("\0") || path.posix.isAbsolute(input) || /^[a-zA-Z]:\//.test(input)) {
    throw new Error(`Invalid project-relative path: ${value}`)
  }
  const normalized = path.posix.normalize(input).replace(/^\.\//, "")
  if (normalized === ".." || normalized.startsWith("../")) throw new Error(`Project path escapes its root: ${value}`)
  for (const segment of normalized.split("/").filter(Boolean)) validateName(segment)
  return normalized === "." ? "" : normalized
}

export function requireEntryPath(value: string) {
  const normalized = normalizeRelativePath(value)
  if (!normalized) throw new Error("The project root cannot be modified")
  return normalized
}

export function validateName(value: string) {
  const name = value.trim()
  const stem = name.split(".")[0]?.toUpperCase()
  if (!name
    || name === "."
    || name === ".."
    || /[\\/:*?"<>|\u0000-\u001f\u007f]/.test(name)
    || /[. ]$/.test(value)
    || stem && /^(CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³]|CONIN\$|CONOUT\$)$/.test(stem)) {
    throw new Error(`Invalid project entry name: ${value}`)
  }
  return name
}

export function assertUserMutationPath(relativePath: string) {
  if (relativePath.split("/").some(isReservedConvaxSegment)) {
    throw new Error(`Project path is reserved for Convax: ${relativePath}`)
  }
}

function isReservedConvaxSegment(segment: string) {
  return segment.replace(/[. ]+$/g, "").toLowerCase() === ".convax"
}

export function ensureInside(candidate: string, rootPath: string, requestedPath: string) {
  const relative = path.relative(rootPath, candidate)
  if (relative === "" || (!isParentRelativePath(relative) && !path.isAbsolute(relative))) return
  throw new Error(`Project path escapes its root: ${requestedPath}`)
}

export function assertNotProjectRoot(candidate: string, rootPath: string) {
  if (path.relative(rootPath, candidate) === "") throw new Error("The project root cannot be modified")
}

export function isInsidePath(candidate: string, rootPath: string) {
  const relative = path.relative(rootPath, candidate)
  return relative === "" || (!isParentRelativePath(relative) && !path.isAbsolute(relative))
}

function isParentRelativePath(relativePath: string) {
  return relativePath === ".." || relativePath.startsWith(`..${path.sep}`)
}

export function joinRelative(parentPath: string, name: string) {
  return parentPath ? `${parentPath}/${name}` : name
}

export function parentOf(relativePath: string) {
  const parent = path.posix.dirname(relativePath)
  return parent === "." ? "" : parent
}

export function textFileKey(projectId: string, relativePath: string) {
  return `${projectId}:${relativePath}`
}

export function normalizeSelectionRoots(paths: readonly string[]) {
  const selected = new Set(paths)
  return [...selected].filter((relativePath) => {
    const segments = relativePath.split("/")
    return !segments.slice(0, -1).some((_, index) => selected.has(segments.slice(0, index + 1).join("/")))
  })
}

export function parseProjectManifest(value: unknown): ProjectManifest {
  if (!value || typeof value !== "object") throw new Error("Project manifest is invalid")
  const input = value as Partial<ProjectManifest>
  if (input.schemaVersion !== "convax.project/1") {
    throw new Error("Project manifest schema is not supported")
  }
  const projectId = requireProjectId(input.projectId)
  return { projectId, schemaVersion: "convax.project/1" }
}

export function requireProjectId(value: unknown) {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9_-]{0,95}$/.test(value)) {
    throw new Error(`Invalid project id: ${String(value)}`)
  }
  return value
}

export function toProjectRecord(project: ProjectRegistryRecord): ProjectRecord {
  return {
    createdAt: project.createdAt,
    id: project.id,
    lastOpenedAt: project.lastOpenedAt,
    missing: project.missing,
    name: project.name,
    rootPath: project.rootPath,
  }
}

export function projectIdForPath(rootPath: string) {
  return `project_${createHash("sha256").update(rootPath).digest("hex").slice(0, 20)}`
}

export function compareProjects(left: ProjectRecord, right: ProjectRecord) {
  return right.lastOpenedAt - left.lastOpenedAt || left.name.localeCompare(right.name)
}

export function compareEntries(left: ProjectEntry, right: ProjectEntry) {
  if (left.kind !== right.kind) return left.kind === "directory" ? -1 : 1
  return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" })
}

export function mutation(
  operation: ProjectMutationResult["operation"],
  projectId: string,
  affectedPaths: string[],
  sourcePaths?: string[],
  targetPaths?: string[],
): ProjectMutationResult {
  return { affectedPaths, operation, projectId, sourcePaths, targetPaths }
}

export async function movePath(source: string, target: string) {
  try {
    await fs.rename(source, target)
  } catch (error) {
    if (!isNodeError(error) || error.code !== "EXDEV") throw error
    await copyPath(source, target)
    await fs.rm(source, { recursive: true })
  }
}

export async function copyPath(source: string, target: string): Promise<void> {
  const stat = await fs.lstat(source)
  if (stat.isSymbolicLink()) throw new Error(`Symbolic links cannot be imported: ${source}`)
  if (stat.isFile()) {
    await fs.copyFile(source, target, fs.constants.COPYFILE_EXCL)
    return
  }
  if (!stat.isDirectory()) throw new Error(`File type is not supported: ${source}`)
  await fs.mkdir(target)
  for (const child of await fs.readdir(source)) {
    const childSource = path.join(source, child)
    if ((await fs.lstat(childSource)).isSymbolicLink()) continue
    await copyPath(childSource, path.join(target, child))
  }
}

export async function assertPortableTree(source: string): Promise<void> {
  const stat = await fs.lstat(source)
  if (!stat.isDirectory()) return
  const names = new Set<string>()
  for (const dirent of await fs.readdir(source, { withFileTypes: true })) {
    if (dirent.isSymbolicLink()) continue
    const name = validateName(dirent.name)
    if (isReservedConvaxSegment(name)) throw new Error(`Project path is reserved for Convax: ${source}`)
    const key = name.toLocaleLowerCase("en-US")
    if (names.has(key)) throw new Error(`Directory contains names that collide on Windows: ${source}`)
    names.add(key)
    if (dirent.isDirectory()) await assertPortableTree(path.join(source, name))
  }
}

export async function nextAvailablePath(
  directory: string,
  originalName: string,
  reserved = new Set<string>(),
  caseInsensitive = false,
) {
  const extension = path.extname(originalName)
  const stem = extension ? originalName.slice(0, -extension.length) : originalName
  let candidate = path.join(directory, originalName)
  let index = 1
  while (reserved.has(collisionKey(candidate, caseInsensitive)) || await existsPortable(candidate, caseInsensitive)) {
    candidate = path.join(directory, `${stem} copy${index === 1 ? "" : ` ${index}`}${extension}`)
    index += 1
  }
  return candidate
}

export function collisionKey(filePath: string, caseInsensitive: boolean) {
  const normalized = path.normalize(filePath)
  return caseInsensitive ? normalized.toLocaleLowerCase("en-US") : normalized
}

export async function existsPortable(filePath: string, caseInsensitive: boolean) {
  if (await exists(filePath)) return true
  if (!caseInsensitive) return false
  try {
    const expected = path.basename(filePath).toLocaleLowerCase("en-US")
    return (await fs.readdir(path.dirname(filePath))).some((name) => name.toLocaleLowerCase("en-US") === expected)
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return false
    throw error
  }
}

export function isIgnoredName(name: string) {
  return ignoredNames.has(name.replace(/[. ]+$/g, "").toLocaleLowerCase("en-US"))
}

export function sameNativePath(left: string, right: string) {
  const leftPath = path.resolve(left)
  const rightPath = path.resolve(right)
  return process.platform === "win32"
    ? leftPath.toLocaleLowerCase("en-US") === rightPath.toLocaleLowerCase("en-US")
    : leftPath === rightPath
}

export async function writeFileReplacing(
  target: string,
  content: string,
  beforeReplace?: (input: { targetPath: string; temporaryPath: string }) => Promise<void>,
) {
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${randomUUID()}.tmp`)
  try {
    await fs.writeFile(temporary, content, { encoding: "utf8", flag: "wx" })
    await beforeReplace?.({ targetPath: target, temporaryPath: temporary })
    await replaceFile(temporary, target)
  } finally {
    await fs.rm(temporary, { force: true })
  }
}

export async function replaceFile(temporary: string, target: string) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await fs.rename(temporary, target)
      return
    } catch (error) {
      if (attempt >= 3 || !isRetryableReplaceError(error)) throw error
      await new Promise<void>((resolve) => setTimeout(resolve, 8 * (attempt + 1)))
    }
  }
}

function isRetryableReplaceError(error: unknown) {
  return isNodeError(error) && ["EACCES", "EBUSY", "ENOTEMPTY", "EPERM"].includes(error.code ?? "")
}

export async function assertNoSymlinkSegments(rootPath: string, relativePath: string) {
  let current = rootPath
  for (const segment of relativePath.split("/").filter(Boolean)) {
    current = path.join(current, segment)
    try {
      if ((await fs.lstat(current)).isSymbolicLink()) {
        throw new Error(`Symbolic links are not supported project entries: ${relativePath}`)
      }
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") return
      throw error
    }
  }
}

export function mimeTypeForPath(filePath: string) {
  const extension = path.extname(filePath).toLowerCase()
  return ({
    ".aac": "audio/aac",
    ".gif": "image/gif",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".json": "application/json",
    ".m4a": "audio/mp4",
    ".markdown": "text/markdown",
    ".md": "text/markdown",
    ".mov": "video/quicktime",
    ".mp3": "audio/mpeg",
    ".mp4": "video/mp4",
    ".png": "image/png",
    ".rtf": "application/rtf",
    ".svg": "image/svg+xml",
    ".text": "text/plain",
    ".txt": "text/plain",
    ".wav": "audio/wav",
    ".webm": "video/webm",
    ".webp": "image/webp",
  } as Record<string, string>)[extension] ?? "application/octet-stream"
}

export async function exists(filePath: string) {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

export async function isDirectory(filePath: string) {
  try {
    return (await fs.stat(filePath)).isDirectory()
  } catch {
    return false
  }
}

export async function isSafeProjectRoot(filePath: string) {
  const rootPath = path.resolve(filePath)
  try {
    const stat = await fs.lstat(rootPath)
    if (stat.isSymbolicLink() || !stat.isDirectory()) return false
    return path.relative(rootPath, await fs.realpath(rootPath)) === ""
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return false
    throw error
  }
}

export function isProjectRecord(value: unknown): value is ProjectRegistryRecord {
  if (!value || typeof value !== "object") return false
  const record = value as Partial<ProjectRecord>
  return typeof record.id === "string"
    && typeof record.name === "string"
    && typeof record.rootPath === "string"
    && typeof record.createdAt === "number"
    && typeof record.lastOpenedAt === "number"
}

export function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error
}
