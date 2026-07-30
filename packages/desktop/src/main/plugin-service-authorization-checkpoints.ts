import { randomUUID } from "node:crypto"
import { constants as fsConstants } from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"

import { requireWebPluginId } from "../plugin-contracts"

export const pluginServiceAuthorizationCheckpointSchema = "convax.plugin-service-authorization-checkpoint/2" as const

const maximumCheckpointBytes = 64 * 1024
const maximumCookieNames = 32
const maximumCookieValueBytes = 16 * 1024
const maximumCookieBytes = 32 * 1024
const maximumCheckpointAgeMs = 15 * 60_000
const maximumFutureClockSkewMs = 60_000
const cookieNamePattern = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]{1,128}$/
const sha256Pattern = /^[a-f0-9]{64}$/

export type PluginServiceAuthorizationAction = "authorize" | "reauthorize"

/**
 * The immutable main-only identity must bind the normalized Plugin declaration
 * and the install-authorized executable bytes. It must never be a renderer
 * supplied identifier.
 */
export interface PluginServiceAuthorizationCheckpointBinding {
  cookieNames: readonly string[]
  cookieOrigin: string
  pluginId: string
  serviceIdentity: string
  snapshotDigest: string
}

export interface PluginServiceAuthorizationCheckpointCookie {
  /** Milliseconds since the Unix epoch. Omitted for a browser-session Cookie. */
  expiresAt?: number
  name: string
  value: string
}

export interface PluginServiceAuthorizationCheckpoint extends PluginServiceAuthorizationCheckpointBinding {
  action: PluginServiceAuthorizationAction
  capturedAt: number
  cookies: readonly PluginServiceAuthorizationCheckpointCookie[]
  schema: typeof pluginServiceAuthorizationCheckpointSchema
}

export interface PluginServiceAuthorizationCheckpointIdentity {
  pluginId: string
  serviceIdentity: string
  snapshotDigest: string
}

/** Secret-free main-only metadata used to decide whether a fresh sidecar request should resume. */
export interface PluginServiceAuthorizationCheckpointSummary extends PluginServiceAuthorizationCheckpointIdentity {
  action: PluginServiceAuthorizationAction
  capturedAt: number
}

interface PluginServiceAuthorizationCheckpointStoreOptions {
  now?: () => number
}

class PluginServiceAuthorizationCheckpointError extends Error {
  readonly invalid: boolean

  constructor(invalid: boolean) {
    super("Plugin service authorization checkpoint is invalid or inaccessible")
    this.name = "PluginServiceAuthorizationCheckpointError"
    this.invalid = invalid
  }
}

function checkpointError(invalid = true) {
  return new PluginServiceAuthorizationCheckpointError(invalid)
}

/** Main-only classification; never includes an origin, Cookie name, or value. */
export function isInvalidPluginServiceAuthorizationCheckpoint(error: unknown) {
  return error instanceof PluginServiceAuthorizationCheckpointError && error.invalid
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code
}

function isStrictRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function strictRecord(value: unknown) {
  if (!isStrictRecord(value)) throw checkpointError()
  return value
}

function requireExactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  const keys = Object.keys(value).sort()
  const sortedExpected = [...expected].sort()
  if (keys.length !== sortedExpected.length || keys.some((key, index) => key !== sortedExpected[index])) {
    throw checkpointError()
  }
}

function requireServiceIdentity(value: unknown) {
  if (typeof value !== "string" || !sha256Pattern.test(value)) throw checkpointError()
  return value
}

function normalizeIdentity(
  value: PluginServiceAuthorizationCheckpointIdentity,
): PluginServiceAuthorizationCheckpointIdentity {
  const input = strictRecord(value)
  requireExactKeys(input, ["pluginId", "serviceIdentity", "snapshotDigest"])
  if (typeof input.pluginId !== "string") throw checkpointError()
  return {
    pluginId: requireWebPluginId(input.pluginId),
    serviceIdentity: requireServiceIdentity(input.serviceIdentity),
    snapshotDigest: requireServiceIdentity(input.snapshotDigest),
  }
}

function requireCanonicalHttpsOrigin(value: unknown) {
  if (typeof value !== "string" || !value || value.length > 2_048 || value !== value.trim()) {
    throw checkpointError()
  }
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw checkpointError()
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.origin !== value ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  ) {
    throw checkpointError()
  }
  return parsed.origin
}

function requireCookieNames(value: unknown) {
  if (!Array.isArray(value) || value.length < 1 || value.length > maximumCookieNames) {
    throw checkpointError()
  }
  const names = value.map((name) => {
    if (typeof name !== "string" || !cookieNamePattern.test(name)) throw checkpointError()
    return name
  })
  if (new Set(names).size !== names.length) throw checkpointError()
  return names.sort()
}

function requirePositiveTimestamp(value: unknown) {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) throw checkpointError()
  return Number(value)
}

function requireCookies(value: unknown, cookieNames: readonly string[]) {
  if (!Array.isArray(value) || value.length < 1 || value.length > maximumCookieNames) {
    throw checkpointError()
  }
  const allowlist = new Set(cookieNames)
  const seen = new Set<string>()
  let totalBytes = 0
  const cookies = value.map((raw): PluginServiceAuthorizationCheckpointCookie => {
    const cookie = strictRecord(raw)
    const hasExpiry = cookie.expiresAt !== undefined
    requireExactKeys(cookie, hasExpiry ? ["expiresAt", "name", "value"] : ["name", "value"])
    if (
      typeof cookie.name !== "string" ||
      !cookieNamePattern.test(cookie.name) ||
      !allowlist.has(cookie.name) ||
      seen.has(cookie.name) ||
      typeof cookie.value !== "string" ||
      !cookie.value ||
      /[\u0000-\u0020\u007f;]/.test(cookie.value)
    ) {
      throw checkpointError()
    }
    const valueBytes = Buffer.byteLength(cookie.value, "utf8")
    if (valueBytes > maximumCookieValueBytes) throw checkpointError()
    totalBytes += Buffer.byteLength(cookie.name, "utf8") + valueBytes
    if (totalBytes > maximumCookieBytes) throw checkpointError()
    seen.add(cookie.name)
    return {
      ...(hasExpiry ? { expiresAt: requirePositiveTimestamp(cookie.expiresAt) } : {}),
      name: cookie.name,
      value: cookie.value,
    }
  })
  return cookies.sort((left, right) => left.name.localeCompare(right.name))
}

function normalizeBinding(
  value: PluginServiceAuthorizationCheckpointBinding,
): PluginServiceAuthorizationCheckpointBinding {
  const input = strictRecord(value)
  requireExactKeys(input, ["cookieNames", "cookieOrigin", "pluginId", "serviceIdentity", "snapshotDigest"])
  if (typeof input.pluginId !== "string") throw checkpointError()
  return {
    cookieNames: requireCookieNames(input.cookieNames),
    cookieOrigin: requireCanonicalHttpsOrigin(input.cookieOrigin),
    pluginId: requireWebPluginId(input.pluginId),
    serviceIdentity: requireServiceIdentity(input.serviceIdentity),
    snapshotDigest: requireServiceIdentity(input.snapshotDigest),
  }
}

function normalizeCheckpoint(value: unknown): PluginServiceAuthorizationCheckpoint {
  const input = strictRecord(value)
  requireExactKeys(input, [
    "action",
    "capturedAt",
    "cookieNames",
    "cookieOrigin",
    "cookies",
    "pluginId",
    "schema",
    "serviceIdentity",
    "snapshotDigest",
  ])
  if (
    input.schema !== pluginServiceAuthorizationCheckpointSchema ||
    (input.action !== "authorize" && input.action !== "reauthorize")
  ) {
    throw checkpointError()
  }
  if (typeof input.pluginId !== "string") throw checkpointError()
  const binding: PluginServiceAuthorizationCheckpointBinding = {
    cookieNames: requireCookieNames(input.cookieNames),
    cookieOrigin: requireCanonicalHttpsOrigin(input.cookieOrigin),
    pluginId: requireWebPluginId(input.pluginId),
    serviceIdentity: requireServiceIdentity(input.serviceIdentity),
    snapshotDigest: requireServiceIdentity(input.snapshotDigest),
  }
  return {
    action: input.action,
    capturedAt: requirePositiveTimestamp(input.capturedAt),
    ...binding,
    cookies: requireCookies(input.cookies, binding.cookieNames),
    schema: pluginServiceAuthorizationCheckpointSchema,
  }
}

function sameBinding(
  checkpoint: PluginServiceAuthorizationCheckpoint,
  binding: PluginServiceAuthorizationCheckpointBinding,
) {
  return (
    checkpoint.pluginId === binding.pluginId &&
    checkpoint.serviceIdentity === binding.serviceIdentity &&
    checkpoint.snapshotDigest === binding.snapshotDigest &&
    checkpoint.cookieOrigin === binding.cookieOrigin &&
    JSON.stringify(checkpoint.cookieNames) === JSON.stringify(binding.cookieNames)
  )
}

function checkpointIsExpired(checkpoint: PluginServiceAuthorizationCheckpoint, now: number) {
  return checkpoint.capturedAt + maximumCheckpointAgeMs <= now
}

function sameFileIdentity(left: Awaited<ReturnType<typeof fs.lstat>>, right: Awaited<ReturnType<typeof fs.lstat>>) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
  )
}

function requirePrivateMode(info: Awaited<ReturnType<typeof fs.lstat>>, expected: number) {
  if (process.platform !== "win32" && (Number(info.mode) & 0o777) !== expected) throw checkpointError()
}

async function requirePrivateRoot(rootPath: string, create: boolean) {
  try {
    if (create) await fs.mkdir(rootPath, { mode: 0o700, recursive: true })
    let info: Awaited<ReturnType<typeof fs.lstat>>
    try {
      info = await fs.lstat(rootPath)
    } catch (error) {
      if (!create && isNodeError(error, "ENOENT")) return null
      throw error
    }
    if (!info.isDirectory() || info.isSymbolicLink()) throw checkpointError()
    const [realRoot, realParent] = await Promise.all([fs.realpath(rootPath), fs.realpath(path.dirname(rootPath))])
    if (realRoot !== path.join(realParent, path.basename(rootPath))) throw checkpointError()
    if (create) await fs.chmod(realRoot, 0o700)
    requirePrivateMode(await fs.lstat(realRoot), 0o700)
    return realRoot
  } catch (error) {
    if (error instanceof PluginServiceAuthorizationCheckpointError) throw error
    throw checkpointError(false)
  }
}

async function inspectCheckpointTarget(filePath: string) {
  try {
    const info = await fs.lstat(filePath)
    if (!info.isFile() || info.isSymbolicLink()) throw checkpointError()
    requirePrivateMode(info, 0o600)
    return info
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return null
    if (error instanceof PluginServiceAuthorizationCheckpointError) throw error
    throw checkpointError(false)
  }
}

async function readCheckpointFile(filePath: string) {
  const before = await inspectCheckpointTarget(filePath)
  if (!before) return null
  if (before.size < 1 || before.size > maximumCheckpointBytes) throw checkpointError()
  const [realFile, realParent] = await Promise.all([fs.realpath(filePath), fs.realpath(path.dirname(filePath))])
  if (realFile !== path.join(realParent, path.basename(filePath))) throw checkpointError()

  let handle: Awaited<ReturnType<typeof fs.open>> | undefined
  try {
    const noFollow = typeof fsConstants.O_NOFOLLOW === "number" ? fsConstants.O_NOFOLLOW : 0
    handle = await fs.open(filePath, fsConstants.O_RDONLY | noFollow)
    const opened = await handle.stat()
    if (!opened.isFile() || !sameFileIdentity(before, opened)) throw checkpointError()
    const bytes = await handle.readFile()
    if (bytes.byteLength !== before.size || bytes.byteLength > maximumCheckpointBytes) throw checkpointError()
    const after = await fs.lstat(filePath)
    if (!sameFileIdentity(before, after)) throw checkpointError()
    let text: string
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
    } catch {
      throw checkpointError()
    }
    try {
      return normalizeCheckpoint(JSON.parse(text) as unknown)
    } catch {
      throw checkpointError()
    }
  } catch (error) {
    if (error instanceof PluginServiceAuthorizationCheckpointError) throw error
    throw checkpointError(false)
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

async function publishCheckpoint(root: string, checkpoint: PluginServiceAuthorizationCheckpoint) {
  const serialized = `${JSON.stringify(checkpoint)}\n`
  if (Buffer.byteLength(serialized, "utf8") > maximumCheckpointBytes) throw checkpointError()
  const target = path.join(root, `${checkpoint.pluginId}.json`)
  const prior = await inspectCheckpointTarget(target)
  const temporaryPath = path.join(root, `.checkpoint-${checkpoint.pluginId}-${randomUUID()}.tmp`)
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined
  try {
    const noFollow = typeof fsConstants.O_NOFOLLOW === "number" ? fsConstants.O_NOFOLLOW : 0
    handle = await fs.open(
      temporaryPath,
      fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | noFollow,
      0o600,
    )
    await handle.chmod(0o600)
    const temporaryInfo = await handle.stat()
    if (!temporaryInfo.isFile()) throw checkpointError()
    if (process.platform !== "win32" && (temporaryInfo.mode & 0o777) !== 0o600) throw checkpointError()
    await handle.writeFile(serialized, "utf8")
    await handle.sync()
    await handle.close()
    handle = undefined

    const current = await inspectCheckpointTarget(target)
    if ((prior === null) !== (current === null) || (prior && current && !sameFileIdentity(prior, current))) {
      throw checkpointError()
    }
    await fs.rename(temporaryPath, target)
    const published = await inspectCheckpointTarget(target)
    if (!published || published.size !== Buffer.byteLength(serialized, "utf8")) throw checkpointError()
    if (process.platform !== "win32") {
      try {
        const directory = await fs.open(root, "r")
        try {
          await directory.sync()
        } finally {
          await directory.close()
        }
      } catch {
        // The mode-0600 temporary file was fsynced and the atomic rename is the
        // commit point. A directory fsync failure must not turn a published
        // credential checkpoint into an apparent pre-commit failure.
      }
    }
  } catch (error) {
    if (error instanceof PluginServiceAuthorizationCheckpointError) throw error
    throw checkpointError(false)
  } finally {
    await handle?.close().catch(() => undefined)
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined)
  }
}

async function sweepCheckpointRoot(
  root: string,
  current: ReadonlyMap<string, PluginServiceAuthorizationCheckpointIdentity | null>,
  now: number,
) {
  const retained: PluginServiceAuthorizationCheckpointSummary[] = []
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    const candidate = path.join(root, entry.name)
    if (!entry.isFile() || entry.isSymbolicLink() || !entry.name.endsWith(".json")) {
      await fs.rm(candidate, { force: true, recursive: true }).catch(() => undefined)
      continue
    }
    const pluginId = entry.name.slice(0, -".json".length)
    let normalizedPluginId: string | undefined
    try {
      normalizedPluginId = requireWebPluginId(pluginId)
    } catch {
      // A malformed file name cannot identify an installed Plugin.
    }
    if (!normalizedPluginId || !current.has(normalizedPluginId)) {
      await fs.rm(candidate, { force: true }).catch(() => undefined)
      continue
    }
    try {
      const checkpoint = await readCheckpointFile(candidate)
      const expectedIdentity = current.get(normalizedPluginId)
      if (
        !checkpoint ||
        checkpoint.pluginId !== normalizedPluginId ||
        (expectedIdentity !== null &&
          (!expectedIdentity ||
            checkpoint.serviceIdentity !== expectedIdentity.serviceIdentity ||
            checkpoint.snapshotDigest !== expectedIdentity.snapshotDigest)) ||
        checkpointIsExpired(checkpoint, now) ||
        checkpoint.cookies.every(({ expiresAt }) => expiresAt !== undefined && expiresAt <= now)
      ) {
        await fs.rm(candidate, { force: true })
      } else {
        retained.push({
          action: checkpoint.action,
          capturedAt: checkpoint.capturedAt,
          pluginId: checkpoint.pluginId,
          serviceIdentity: checkpoint.serviceIdentity,
          snapshotDigest: checkpoint.snapshotDigest,
        })
      }
    } catch (error) {
      if (error instanceof PluginServiceAuthorizationCheckpointError && error.invalid) {
        // Corrupt, tampered, or legacy secret state is never recovered. A
        // transient I/O failure is retained for the next maintenance pass.
        await fs.rm(candidate, { force: true }).catch(() => undefined)
      }
    }
  }
  return retained.sort((left, right) => left.pluginId.localeCompare(right.pluginId))
}

/**
 * Main-only crash-recovery storage for the narrow Cookie handoff between an
 * isolated Electron login session and an unchanged Tool Plugin sidecar.
 *
 * This is deliberately not a Chromium profile. A checkpoint contains only the
 * exact-origin Cookie names approved by the sidecar request and their bounded
 * values. Callers must remove it after a successful completion, explicit cancel
 * or sign-out, and before Plugin update/uninstall.
 */
export class PluginServiceAuthorizationCheckpointStore {
  readonly #now: () => number
  readonly #rootPath: string
  #operations: Promise<void> = Promise.resolve()

  constructor(rootPath: string, options: PluginServiceAuthorizationCheckpointStoreOptions = {}) {
    if (!path.isAbsolute(rootPath) || rootPath.includes("\0")) throw checkpointError()
    this.#rootPath = path.resolve(rootPath)
    this.#now = options.now ?? Date.now
  }

  async write(input: unknown) {
    const checkpoint = normalizeCheckpoint(input)
    return this.#serialized(async () => {
      const now = this.#now()
      if (
        checkpointIsExpired(checkpoint, now) ||
        checkpoint.capturedAt > now + maximumFutureClockSkewMs ||
        checkpoint.cookies.some(({ expiresAt }) => expiresAt !== undefined && expiresAt <= now)
      ) {
        throw checkpointError()
      }
      const root = await requirePrivateRoot(this.#rootPath, true)
      if (!root) throw checkpointError()
      await publishCheckpoint(root, checkpoint)
      return checkpoint
    })
  }

  async read(bindingInput: PluginServiceAuthorizationCheckpointBinding) {
    const binding = normalizeBinding(bindingInput)
    return this.#serialized(async () => {
      const root = await requirePrivateRoot(this.#rootPath, false)
      if (!root) return null
      const target = path.join(root, `${binding.pluginId}.json`)
      const checkpoint = await readCheckpointFile(target)
      if (!checkpoint) return null
      if (!sameBinding(checkpoint, binding)) throw checkpointError()
      if (checkpointIsExpired(checkpoint, this.#now())) {
        await fs.rm(target, { force: true })
        return null
      }
      const cookies = checkpoint.cookies.filter(({ expiresAt }) => expiresAt === undefined || expiresAt > this.#now())
      if (!cookies.length) {
        await fs.rm(target, { force: true })
        return null
      }
      if (cookies.length !== checkpoint.cookies.length) {
        const reduced = { ...checkpoint, cookies }
        await publishCheckpoint(root, reduced)
        return reduced
      }
      return checkpoint
    })
  }

  /** Returns no origin, allowlist, or Cookie data; `read()` must still match the fresh sidecar request. */
  async inspect(identityInput: PluginServiceAuthorizationCheckpointIdentity) {
    const identity = normalizeIdentity(identityInput)
    return this.#serialized(async (): Promise<PluginServiceAuthorizationCheckpointSummary | null> => {
      const root = await requirePrivateRoot(this.#rootPath, false)
      if (!root) return null
      const target = path.join(root, `${identity.pluginId}.json`)
      const checkpoint = await readCheckpointFile(target)
      if (!checkpoint) return null
      if (
        checkpoint.pluginId !== identity.pluginId ||
        checkpoint.serviceIdentity !== identity.serviceIdentity ||
        checkpoint.snapshotDigest !== identity.snapshotDigest
      ) {
        throw checkpointError()
      }
      if (
        checkpointIsExpired(checkpoint, this.#now()) ||
        checkpoint.cookies.every(({ expiresAt }) => expiresAt !== undefined && expiresAt <= this.#now())
      ) {
        await fs.rm(target, { force: true })
        return null
      }
      return {
        action: checkpoint.action,
        capturedAt: checkpoint.capturedAt,
        pluginId: checkpoint.pluginId,
        serviceIdentity: checkpoint.serviceIdentity,
        snapshotDigest: checkpoint.snapshotDigest,
      }
    })
  }

  async remove(pluginIdInput: string) {
    const pluginId = requireWebPluginId(pluginIdInput)
    await this.#serialized(async () => {
      const root = await requirePrivateRoot(this.#rootPath, false)
      if (!root) return
      const target = path.join(root, `${pluginId}.json`)
      try {
        const info = await fs.lstat(target)
        if (!info.isFile() && !info.isSymbolicLink()) throw checkpointError()
        // unlink removes a tampered symlink itself and never follows its target.
        await fs.unlink(target)
      } catch (error) {
        if (isNodeError(error, "ENOENT")) return
        if (error instanceof PluginServiceAuthorizationCheckpointError) throw error
        throw checkpointError(false)
      }
    })
  }

  /** Removes uninstalled, expired, corrupt, and stray recovery state without launching sidecars. */
  async sweep(installedPluginIds: readonly string[]) {
    const installed = new Map<string, null>()
    for (const input of installedPluginIds) {
      const pluginId = requireWebPluginId(input)
      if (installed.has(pluginId)) throw checkpointError()
      installed.set(pluginId, null)
    }
    return this.#serialized(async () => {
      const root = await requirePrivateRoot(this.#rootPath, false)
      return root ? sweepCheckpointRoot(root, installed, this.#now()) : []
    })
  }

  /**
   * Removes checkpoints that cannot belong to the currently installed exact
   * sidecar identities. Installed services whose receipt cannot be inspected
   * transiently may be retained by id; a later `read()` still requires an
   * exact identity match before any Cookie can leave main.
   */
  async reconcile(
    currentInputs: readonly PluginServiceAuthorizationCheckpointIdentity[],
    retainUnknownPluginIds: readonly string[] = [],
  ) {
    const current = new Map<string, PluginServiceAuthorizationCheckpointIdentity | null>()
    for (const input of currentInputs) {
      const identity = normalizeIdentity(input)
      const { pluginId } = identity
      if (current.has(pluginId)) throw checkpointError()
      current.set(pluginId, identity)
    }
    for (const input of retainUnknownPluginIds) {
      const pluginId = requireWebPluginId(input)
      if (current.has(pluginId)) throw checkpointError()
      current.set(pluginId, null)
    }
    return this.#serialized(async () => {
      const root = await requirePrivateRoot(this.#rootPath, false)
      return root ? sweepCheckpointRoot(root, current, this.#now()) : []
    })
  }

  async #serialized<T>(operation: () => Promise<T>) {
    const preceding = this.#operations
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const tail = preceding.catch(() => undefined).then(() => gate)
    this.#operations = tail
    await preceding.catch(() => undefined)
    try {
      return await operation()
    } finally {
      release()
    }
  }
}
