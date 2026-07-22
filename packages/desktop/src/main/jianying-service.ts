import { execFile as nodeExecFile } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import { constants as fsConstants, createReadStream, createWriteStream } from "node:fs"
import fs from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"
import { pipeline } from "node:stream/promises"
import { TextDecoder, TextEncoder } from "node:util"

import type {
  JianyingCanvasExportResult,
  JianyingDraftStatus,
  JianyingDraftStatusResult,
  JianyingExportTarget,
} from "../jianying-contracts"

const jianyingExecutableName = "VideoFusion-macOS"
const activeDraftSampleIntervalMs = 100
const activeDraftLockRetryDelayMs = 50
const draftTokenLifetimeMs = 5 * 60_000
const maxDraftTokens = 1_000
const draftContentFileNames = ["draft_info.json", "draft_content.json"] as const
const activeToNewDraftWipMessage =
  "Creating a new JianYing draft while another draft is open is still WIP. Return JianYing to its home screen and retry."
const strictUtf8Decoder = new TextDecoder("utf-8", { fatal: true })
const utf8Encoder = new TextEncoder()
export interface JianyingCommandResult {
  exitCode: number
  stderr: string
  stdout: string
}

export type JianyingCommandRunner = (
  executable: string,
  args: readonly string[],
  timeoutMs: number,
  signal?: AbortSignal,
) => Promise<JianyingCommandResult>

export interface JianyingActiveDraft {
  draftName: string
  draftPath: string
  lockPath: string
  pid: number
}

export interface JianyingDraftObservation {
  draft?: JianyingActiveDraft
  processIds: readonly number[]
  reason?: string
  status: JianyingDraftStatus
}

export interface JianyingSourceMedia {
  mimeType: string
  path: string
}

export interface StagedMediaItem {
  mimeType: string
  name: string
  path: string
  sha256: string
  size: number
}

interface DirectoryIdentity {
  birthtimeMs: number
  dev: number
  ino: number
  path: string
  realPath: string
}

export interface StagedMediaBatch {
  directory: string
  identity?: {
    batch: DirectoryIdentity
    root: DirectoryIdentity
  }
  items: readonly StagedMediaItem[]
}

interface DraftRootSnapshot {
  directoryIdentities: ReadonlySet<string>
  entries: ReadonlySet<string>
  root: DirectoryIdentity
}

interface DraftTokenRecord {
  expiresAt: number
  observation: JianyingDraftObservation
}

export interface JianyingNativeAdapter {
  dispatchImport(
    input: {
      batch: StagedMediaBatch
      expected: JianyingDraftObservation
      target: "current" | "new"
    },
    signal?: AbortSignal,
  ): Promise<{
    createdDraft: boolean
    draft: JianyingActiveDraft
    importStatus: JianyingCanvasExportResult["importStatus"]
  }>
  inspect(signal?: AbortSignal): Promise<JianyingDraftObservation>
}

export class JianyingIntegrationService {
  private operationQueue = Promise.resolve()
  private readonly tokens = new Map<string, DraftTokenRecord>()

  constructor(
    private readonly native: JianyingNativeAdapter,
    private readonly stagingRoot = path.join(homedir(), "Movies", "JianyingPro", "ConvaxImports"),
  ) {}

  async getDraftStatus(): Promise<JianyingDraftStatusResult> {
    const observation = await this.native.inspect()
    const result: JianyingDraftStatusResult = {
      ...(observation.draft ? { draftName: observation.draft.draftName } : {}),
      ...(observation.reason ? { reason: observation.reason } : {}),
      status: observation.status,
    }
    if (!["active", "no_active_draft", "not_running"].includes(observation.status)) return result
    this.pruneTokens()
    while (this.tokens.size >= maxDraftTokens) {
      const oldest = this.tokens.keys().next().value
      if (!oldest) break
      this.tokens.delete(oldest)
    }
    const draftToken = `jianying_${randomUUID()}`
    this.tokens.set(draftToken, { expiresAt: Date.now() + draftTokenLifetimeMs, observation })
    return { ...result, draftToken }
  }

  exportMedia(
    sourceMedia: readonly JianyingSourceMedia[],
    target: JianyingExportTarget,
    signal?: AbortSignal,
  ): Promise<JianyingCanvasExportResult> {
    const operation = this.operationQueue.then(() => this.exportMediaLocked(sourceMedia, target, signal))
    this.operationQueue = operation.then(
      () => undefined,
      () => undefined,
    )
    return operation
  }

  private async exportMediaLocked(
    sourceMedia: readonly JianyingSourceMedia[],
    target: JianyingExportTarget,
    signal?: AbortSignal,
  ) {
    throwIfAborted(signal)
    if (sourceMedia.length === 0) throw new Error("Select at least one image or video to export")
    const expected =
      target.kind === "current-or-new"
        ? await this.requireActionableObservation(await this.native.inspect(signal))
        : this.consumeToken(target.draftToken)
    throwIfAborted(signal)
    if (target.kind === "new" && expected.draft) {
      throw new Error(activeToNewDraftWipMessage)
    }
    const batch = await stageMediaBatch(sourceMedia, this.stagingRoot, signal)
    throwIfAborted(signal)
    const current = await this.requireActionableObservation(await this.native.inspect(signal))
    if (!sameObservation(expected, current)) {
      throw new Error("The JianYing draft state changed before export. Inspect it again before retrying.")
    }
    throwIfAborted(signal)
    await assertStagedMediaBatchIdentity(batch, signal)

    let nativeTarget: "current" | "new"
    if (target.kind === "current") {
      if (!current.draft) throw new Error("The inspected JianYing draft is no longer active")
      nativeTarget = "current"
    } else if (target.kind === "new" || !current.draft) {
      nativeTarget = "new"
    } else {
      nativeTarget = "current"
    }

    await assertStagedMediaBatchIdentity(batch, signal)
    const result = await this.native.dispatchImport({ batch, expected: current, target: nativeTarget }, signal)
    try {
      await assertStagedMediaBatchIdentity(batch)
    } catch (error) {
      throw automationOutcomeUnknown("JianYing may have imported the media, but its persistent batch changed", error)
    }
    return {
      createdDraft: result.createdDraft,
      draftName: result.draft.draftName,
      importedMediaCount: batch.items.length,
      importStatus: result.importStatus,
    } satisfies JianyingCanvasExportResult
  }

  private consumeToken(token: string) {
    this.pruneTokens()
    const record = this.tokens.get(token)
    this.tokens.delete(token)
    if (!record) throw new Error("The JianYing draft observation expired. Inspect it again before exporting.")
    return record.observation
  }

  private pruneTokens() {
    const now = Date.now()
    for (const [token, record] of this.tokens) {
      if (record.expiresAt <= now) this.tokens.delete(token)
    }
  }

  private async requireActionableObservation(observation: JianyingDraftObservation) {
    if (["active", "no_active_draft", "not_running"].includes(observation.status)) return observation
    throw new Error(
      observation.reason ||
        (observation.status === "unsupported"
          ? "JianYing export is currently supported only on macOS"
          : "The active JianYing draft could not be determined safely"),
    )
  }
}

export interface JianyingMaterialImportTransport {
  createDraft(signal?: AbortSignal): Promise<void>
  dispatchMaterialImport(
    input: {
      media: readonly {
        mediaType: "image" | "video"
        mimeType: string
        name: string
        path: string
      }[]
      target: "current"
    },
    signal?: AbortSignal,
  ): Promise<unknown>
}

export class MacOSJianyingNativeAdapter implements JianyingNativeAdapter {
  constructor(
    private readonly options: {
      commandRunner?: JianyingCommandRunner
      platform?: NodeJS.Platform
      sleep?: (milliseconds: number) => Promise<void>
      transport: JianyingMaterialImportTransport
    },
  ) {}

  async inspect(signal?: AbortSignal) {
    throwIfAborted(signal)
    if ((this.options.platform ?? process.platform) !== "darwin") {
      return unsupportedObservation()
    }
    const first = await this.sample(signal)
    throwIfAborted(signal)
    await this.sleep(activeDraftSampleIntervalMs)
    throwIfAborted(signal)
    const second = await this.sample(signal)
    return combineObservations(first, second)
  }

  async dispatchImport(
    input: {
      batch: StagedMediaBatch
      expected: JianyingDraftObservation
      target: "current" | "new"
    },
    signal?: AbortSignal,
  ) {
    throwIfAborted(signal)
    if ((this.options.platform ?? process.platform) !== "darwin") {
      throw new Error("JianYing export is currently supported only on macOS")
    }
    if (input.target === "current" && (input.expected.status !== "active" || !input.expected.draft)) {
      throw new Error("The inspected JianYing draft is no longer active")
    }
    if (!["active", "no_active_draft", "not_running"].includes(input.expected.status)) {
      throw new Error(input.expected.reason || "JianYing is not ready for media import")
    }
    if (input.target === "new" && input.expected.draft) {
      throw new Error(activeToNewDraftWipMessage)
    }

    let destinationDraft = input.expected.draft
    if (input.target === "new") {
      const draftRootSnapshots = await captureDraftRootSnapshots(input.expected, signal)
      throwIfAborted(signal)
      const createStartedAt = Date.now()
      await this.options.transport.createDraft(signal)
      destinationDraft = await this.waitForNewDraft(input.expected, draftRootSnapshots, createStartedAt)
    }

    if (!destinationDraft) {
      throw new Error("JianYing did not activate a draft before media import")
    }
    throwIfAborted(signal)
    await this.options.transport.dispatchMaterialImport(
      {
        media: input.batch.items.map((item) => ({
          mediaType: item.mimeType.startsWith("image/") ? ("image" as const) : ("video" as const),
          mimeType: item.mimeType,
          name: item.name,
          path: item.path,
        })),
        target: "current",
      },
      signal,
    )

    const draft = await this.waitForCurrentDraft(destinationDraft)
    return {
      createdDraft: input.target === "new",
      draft,
      importStatus: "dispatched" as const,
    }
  }

  private async waitForCurrentDraft(expected: JianyingActiveDraft) {
    const deadline = Date.now() + 10_000
    let lastReason = ""
    while (Date.now() < deadline) {
      let observation: JianyingDraftObservation
      try {
        observation = await this.inspect()
      } catch (error) {
        lastReason = safeNativeFailureReason(error)
        await this.sleep(200)
        continue
      }
      if (observation.status === "active" && observation.draft) {
        if (!sameDraft(observation.draft, expected)) {
          throw automationOutcomeUnknown("The active JianYing draft changed during media import")
        }
        return observation.draft
      }
      if (observation.status === "no_active_draft" || observation.status === "not_running") {
        throw automationOutcomeUnknown("The active JianYing draft closed during media import")
      }
      lastReason = observation.reason ?? observation.status
      await this.sleep(200)
    }
    throw automationOutcomeUnknown(
      `JianYing received the media, but the current draft could not be rechecked${lastReason ? `: ${lastReason}` : ""}`,
    )
  }

  private async waitForNewDraft(
    previous: JianyingDraftObservation,
    snapshots: readonly DraftRootSnapshot[],
    dispatchStartedAt: number,
  ) {
    const previousLockPath = previous.draft?.lockPath
    const deadline = Date.now() + 45_000
    let lastReason = ""
    while (Date.now() < deadline) {
      let observation: JianyingDraftObservation
      try {
        observation = await this.inspect()
      } catch (error) {
        lastReason = safeNativeFailureReason(error)
        await this.sleep(250)
        continue
      }
      if (observation.status === "active" && observation.draft && observation.draft.lockPath !== previousLockPath) {
        let provenNew = false
        try {
          provenNew = await proveNewDraftDirectory(observation.draft, snapshots, dispatchStartedAt)
        } catch (error) {
          throw automationOutcomeUnknown(
            "JianYing activated a different draft, but its directory identity could not be verified",
            error,
          )
        }
        if (!provenNew) {
          throw automationOutcomeUnknown(
            "JianYing activated a different draft, but it was not proven to be newly created",
          )
        }
        return observation.draft
      }
      lastReason = observation.reason ?? observation.status
      await this.sleep(250)
    }
    throw automationOutcomeUnknown(
      `JianYing received the force-create request, but a new draft could not be verified${lastReason ? `: ${lastReason}` : ""}`,
    )
  }

  private async sample(signal?: AbortSignal): Promise<JianyingDraftObservation> {
    const ps = await this.runCommand("/bin/ps", ["-axo", "pid=,comm="], 5_000, signal)
    if (ps.exitCode !== 0)
      return unavailableObservation(`Could not enumerate JianYing processes (exit code ${ps.exitCode})`)
    const processIds = parseJianyingProcessIds(ps.stdout)
    if (processIds.length === 0) {
      return { processIds, reason: `Process not found: ${jianyingExecutableName}`, status: "not_running" }
    }
    const candidates: JianyingActiveDraft[] = []
    for (const pid of processIds) {
      const lsof = await this.runCommand("/usr/sbin/lsof", ["-F0n", "-p", String(pid)], 5_000, signal)
      if (lsof.exitCode !== 0) {
        return unavailableObservation(
          `Could not inspect JianYing process ${pid} (exit code ${lsof.exitCode})`,
          processIds,
        )
      }
      const candidateCountBeforeProcess = candidates.length
      let vanishedLockCount = 0
      for (const lockPath of parseLockedPaths(lsof.stdout)) {
        try {
          const canonicalLock = await this.realpathDraftLock(lockPath, signal)
          if (path.basename(canonicalLock) !== ".locked") continue
          const draftPath = path.dirname(canonicalLock)
          if (!(await containsDraftContent(draftPath))) continue
          candidates.push({
            draftName: path.basename(draftPath),
            draftPath,
            lockPath: canonicalLock,
            pid,
          })
        } catch (error) {
          throwIfAborted(signal)
          if (isNodeError(error, "ENOENT")) {
            vanishedLockCount += 1
            continue
          }
          return unavailableObservation(jianyingDraftLockValidationFailure(pid, error), processIds)
        }
      }
      if (vanishedLockCount > 0 && candidates.length === candidateCountBeforeProcess) {
        return unavailableObservation(
          `JianYing process ${pid} changed its active draft lock while Convax was inspecting it; retry the export`,
          processIds,
        )
      }
    }
    const unique = [...new Map(candidates.map((draft) => [`${draft.pid}\0${draft.lockPath}`, draft])).values()]
    if (unique.length > 1) {
      return {
        processIds,
        reason: `Multiple active JianYing drafts were found: ${unique.map((draft) => draft.draftName).join(", ")}`,
        status: "ambiguous",
      }
    }
    if (unique.length === 0) {
      return { processIds, reason: "JianYing is running without an active draft", status: "no_active_draft" }
    }
    return { draft: unique[0], processIds, status: "active" }
  }

  private async realpathDraftLock(lockPath: string, signal?: AbortSignal) {
    try {
      return await fs.realpath(lockPath)
    } catch (error) {
      if (!isNodeError(error, "ENOENT")) throw error
      await this.sleep(activeDraftLockRetryDelayMs)
      throwIfAborted(signal)
      return fs.realpath(lockPath)
    }
  }

  private runCommand(executable: string, args: readonly string[], timeoutMs: number, signal?: AbortSignal) {
    return (this.options.commandRunner ?? runJianyingCommand)(executable, args, timeoutMs, signal)
  }

  private sleep(milliseconds: number) {
    return (this.options.sleep ?? delay)(milliseconds)
  }
}

export class UnsupportedJianyingNativeAdapter implements JianyingNativeAdapter {
  async inspect(): Promise<JianyingDraftObservation> {
    return unsupportedObservation()
  }

  async dispatchImport(): Promise<never> {
    throw new Error("JianYing export is currently supported only on macOS")
  }
}

export function createJianyingNativeAdapter(options: {
  commandRunner?: JianyingCommandRunner
  platform?: NodeJS.Platform
  sleep?: (milliseconds: number) => Promise<void>
  transport: JianyingMaterialImportTransport
}): JianyingNativeAdapter {
  return (options.platform ?? process.platform) === "darwin"
    ? new MacOSJianyingNativeAdapter(options)
    : new UnsupportedJianyingNativeAdapter()
}

export function jianyingCommandEnvironment(environment: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const commandEnvironment: NodeJS.ProcessEnv = {
    ...environment,
    // Finder-launched macOS applications do not reliably inherit a UTF-8 locale.
    // Keep machine output stable while making pathname bytes printable as UTF-8.
    LANG: "C",
    LC_CTYPE: "UTF-8",
  }
  // LC_ALL overrides LC_CTYPE, so an inherited shell value must not leak into
  // this macOS-only machine protocol.
  delete commandEnvironment.LC_ALL
  return commandEnvironment
}

export async function runJianyingCommand(
  executable: string,
  args: readonly string[],
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<JianyingCommandResult> {
  return new Promise((resolve, reject) => {
    nodeExecFile(
      executable,
      [...args],
      {
        encoding: "buffer",
        env: jianyingCommandEnvironment(),
        maxBuffer: 8 * 1024 * 1024,
        signal,
        timeout: timeoutMs,
      },
      (error, stdout, stderr) => {
        const diagnosticStderr = stderr.toString("utf8")
        if (signal?.aborted) {
          reject(signal.reason ?? new DOMException("Canceled", "AbortError"))
          return
        }
        if (error && (error.killed || error.signal || error.code === "ETIMEDOUT")) {
          resolve({
            exitCode: -1,
            stderr: `${diagnosticStderr}\nJIANYING_COMMAND_OUTCOME_UNKNOWN: command was terminated before its result was confirmed`,
            stdout: stdout.toString("utf8"),
          })
          return
        }
        if (error && typeof error.code !== "number") {
          reject(error)
          return
        }
        const exitCode = error && typeof error.code === "number" ? error.code : 0
        if (exitCode !== 0) {
          resolve({ exitCode, stderr: diagnosticStderr, stdout: stdout.toString("utf8") })
          return
        }
        try {
          resolve({
            exitCode,
            stderr: diagnosticStderr,
            stdout: strictUtf8Decoder.decode(stdout),
          })
        } catch (cause) {
          reject(new Error("JianYing command wrote invalid UTF-8 to stdout", { cause }))
        }
      },
    )
  })
}

export function parseJianyingProcessIds(output: string) {
  const ids = output.split(/\r?\n/).flatMap((line) => {
    const match = /^\s*(\d+)\s+(.+?)\s*$/.exec(line)
    if (!match) return []
    const command = match[2].replaceAll("\\", "/")
    if (path.basename(command) !== jianyingExecutableName || command.includes("/Contents/Frameworks/")) return []
    return [Number(match[1])]
  })
  return [...new Set(ids.filter(Number.isSafeInteger))].sort((left, right) => left - right)
}

export function parseLockedPaths(output: string) {
  return (
    output
      .split("\0")
      .map((field) => field.replace(/^\r?\n/, ""))
      .filter((field) => field.startsWith("n"))
      .map((field) => field.slice(1))
      // lsof uses POSIX paths on macOS. Narrow before decoding so an unrelated
      // socket or file name cannot invalidate otherwise healthy draft detection.
      .filter((name) => path.posix.basename(name) === ".locked")
      .map(decodeLsofNameField)
      .filter((name) => path.posix.basename(name) === ".locked")
  )
}

function decodeLsofNameField(value: string) {
  // lsof's machine format still applies printable, C, and hexadecimal escapes
  // to pathname bytes. Decode only the reversible forms. Caret notation such as
  // `^A` is intentionally left literal because lsof emits the same text for an
  // actual control byte and for a filename containing the two characters.
  const bytes: number[] = []
  let literalStart = 0
  const appendLiteral = (end: number) => {
    for (const byte of utf8Encoder.encode(value.slice(literalStart, end))) bytes.push(byte)
  }

  for (let index = 0; index < value.length; ) {
    if (value[index] !== "\\") {
      index += 1
      continue
    }

    appendLiteral(index)
    const escape = value[index + 1]
    let byte: number
    let consumed = 2
    switch (escape) {
      case "\\":
        byte = 0x5c
        break
      case "b":
        byte = 0x08
        break
      case "f":
        byte = 0x0c
        break
      case "n":
        byte = 0x0a
        break
      case "r":
        byte = 0x0d
        break
      case "t":
        byte = 0x09
        break
      case "x": {
        const hexadecimal = value.slice(index + 2, index + 4)
        if (!/^[0-9a-fA-F]{2}$/.test(hexadecimal)) {
          throw new Error("lsof returned a malformed hexadecimal pathname escape")
        }
        byte = Number.parseInt(hexadecimal, 16)
        consumed = 4
        break
      }
      default:
        throw new Error("lsof returned an unsupported pathname escape")
    }
    bytes.push(byte)
    index += consumed
    literalStart = index
  }
  appendLiteral(value.length)

  let decoded: string
  try {
    decoded = strictUtf8Decoder.decode(Uint8Array.from(bytes))
  } catch (cause) {
    throw new Error("lsof returned a pathname that is not valid UTF-8", { cause })
  }
  if (decoded.includes("\0")) throw new Error("lsof returned a pathname containing a null byte")
  return decoded
}

export function combineObservations(
  first: JianyingDraftObservation,
  second: JianyingDraftObservation,
): JianyingDraftObservation {
  if ([first.status, second.status].includes("unavailable")) {
    return unavailableObservation(
      `Active draft detection was unstable: first=${first.status}, second=${second.status}; ${first.reason ?? second.reason ?? ""}`,
    )
  }
  if ([first.status, second.status].includes("ambiguous") || first.status !== second.status) {
    return {
      processIds: second.processIds,
      reason: `Active draft detection was ambiguous: first=${first.status}, second=${second.status}`,
      status: "ambiguous",
    }
  }
  if (first.status === "active") {
    if (!first.draft || !second.draft || !sameDraft(first.draft, second.draft)) {
      return {
        processIds: second.processIds,
        reason: "The active JianYing draft changed between samples",
        status: "ambiguous",
      }
    }
  } else if (first.processIds.join(",") !== second.processIds.join(",")) {
    return {
      processIds: second.processIds,
      reason: "The JianYing process set changed between samples",
      status: "ambiguous",
    }
  }
  return second
}

async function stageMediaBatch(
  sourceMedia: readonly JianyingSourceMedia[],
  stagingRoot: string,
  signal?: AbortSignal,
): Promise<StagedMediaBatch> {
  throwIfAborted(signal)
  const uniqueSources = [
    ...new Map(
      sourceMedia.map((source) => {
        const resolved = path.resolve(source.path)
        return [`${resolved}\0${source.mimeType.toLowerCase()}`, { mimeType: source.mimeType, path: resolved }] as const
      }),
    ).values(),
  ]
  const sources = await mapWithConcurrency(uniqueSources, 4, (source) =>
    inspectSourceMedia(source.path, source.mimeType, signal),
  )
  const batchDigest = createHash("sha256")
    .update(JSON.stringify(sources.map((source) => [source.path, source.mimeType, source.size, source.sha256])))
    .digest("hex")
    .slice(0, 24)
  const configuredRoot = path.resolve(stagingRoot)
  await fs.mkdir(configuredRoot, { mode: 0o700, recursive: true })
  const rootInfo = await fs.lstat(configuredRoot)
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) {
    throw new Error("The persistent JianYing staging root must be a real directory")
  }
  const root = await fs.realpath(configuredRoot)
  const rootIdentity = await captureDirectoryIdentity(root, "Persistent JianYing staging root")
  if (rootIdentity.dev !== rootInfo.dev || rootIdentity.ino !== rootInfo.ino) {
    throw new Error("The persistent JianYing staging root changed while it was initialized")
  }
  await assertDirectoryIdentity(rootIdentity, "Persistent JianYing staging root")
  const batchDirectory = path.join(root, `batch-${batchDigest}`)
  const items = sources.map((source, index): StagedMediaItem => {
    const name = `${String(index + 1).padStart(3, "0")}-${source.sha256.slice(0, 8)}-${safeFileName(path.basename(source.path))}`
    return {
      mimeType: source.mimeType,
      name,
      path: path.join(batchDirectory, name),
      sha256: source.sha256,
      size: source.size,
    }
  })
  await assertDirectoryIdentity(rootIdentity, "Persistent JianYing staging root")
  const existingBatch = await pathExists(batchDirectory)
  await assertDirectoryIdentity(rootIdentity, "Persistent JianYing staging root")
  if (existingBatch) {
    const batchIdentity = await verifyStagedBatch(rootIdentity, batchDirectory, items, signal)
    await assertOwnedDirectoryIdentity(rootIdentity, batchIdentity, "Persistent JianYing import batch")
    return { directory: batchDirectory, identity: { batch: batchIdentity, root: rootIdentity }, items }
  }
  const staging = path.join(root, `.staging-${batchDigest}-${randomUUID()}`)
  await assertDirectoryIdentity(rootIdentity, "Persistent JianYing staging root")
  await fs.mkdir(staging, { mode: 0o700 })
  await assertDirectoryIdentity(rootIdentity, "Persistent JianYing staging root")
  const stagingIdentity = await captureDirectoryIdentity(
    staging,
    "Temporary JianYing staging directory",
    rootIdentity.realPath,
  )
  let published = false
  let batchIdentity: DirectoryIdentity | undefined
  try {
    for (let index = 0; index < sources.length; index += 1) {
      throwIfAborted(signal)
      await assertOwnedDirectoryIdentity(rootIdentity, stagingIdentity, "Temporary JianYing staging directory")
      const source = sources[index]
      const item = items[index]
      const destination = path.join(staging, item.name)
      await copyNoFollow(source.path, destination, signal)
      await assertOwnedDirectoryIdentity(rootIdentity, stagingIdentity, "Temporary JianYing staging directory")
      const copied = await inspectRegularFile(destination, signal)
      await assertOwnedDirectoryIdentity(rootIdentity, stagingIdentity, "Temporary JianYing staging directory")
      if (copied.size !== item.size || copied.sha256 !== item.sha256) {
        throw new Error(`Media changed while it was being staged: ${path.basename(source.path)}`)
      }
    }
    await assertOwnedDirectoryIdentity(rootIdentity, stagingIdentity, "Temporary JianYing staging directory")
    try {
      await fs.rename(staging, batchDirectory)
      published = true
    } catch (error) {
      if (!isNodeError(error, "EEXIST") && !isNodeError(error, "ENOTEMPTY")) throw error
    }
    await assertDirectoryIdentity(rootIdentity, "Persistent JianYing staging root")
    if (published) {
      batchIdentity = await captureDirectoryIdentity(
        batchDirectory,
        "Persistent JianYing import batch",
        rootIdentity.realPath,
      )
      if (batchIdentity.dev !== stagingIdentity.dev || batchIdentity.ino !== stagingIdentity.ino) {
        throw new Error("The persistent JianYing import batch changed while it was published")
      }
      if (await pathExists(staging)) {
        throw new Error("The temporary JianYing staging path was replaced after publication")
      }
      await assertDirectoryIdentity(rootIdentity, "Persistent JianYing staging root")
    } else {
      await assertOwnedDirectoryIdentity(rootIdentity, stagingIdentity, "Temporary JianYing staging directory")
    }
    batchIdentity = await verifyStagedBatch(rootIdentity, batchDirectory, items, signal, batchIdentity)
  } finally {
    if (!published) {
      await cleanupOwnedDirectory(rootIdentity, stagingIdentity, "Temporary JianYing staging directory")
    }
  }
  if (!batchIdentity) throw new Error("The persistent JianYing import batch was not published")
  await assertOwnedDirectoryIdentity(rootIdentity, batchIdentity, "Persistent JianYing import batch")
  return { directory: batchDirectory, identity: { batch: batchIdentity, root: rootIdentity }, items }
}

async function inspectSourceMedia(sourcePath: string, mimeType: string, signal?: AbortSignal) {
  throwIfAborted(signal)
  const normalizedMimeType = mimeType.toLowerCase()
  if (!/^(?:image|video)\/[a-z0-9.+-]+$/.test(normalizedMimeType)) {
    throw new Error(`Unsupported JianYing media type: ${mimeType}`)
  }
  const stat = await fs.lstat(sourcePath)
  if (stat.isSymbolicLink() || !stat.isFile())
    throw new Error(`Canvas media is not a regular file: ${path.basename(sourcePath)}`)
  const canonical = await fs.realpath(sourcePath)
  const inspected = await inspectRegularFile(canonical, signal)
  return { mimeType: normalizedMimeType, path: canonical, ...inspected }
}

async function inspectRegularFile(filePath: string, signal?: AbortSignal) {
  throwIfAborted(signal)
  const handle = await fs.open(filePath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0))
  try {
    const stat = await handle.stat()
    if (!stat.isFile()) throw new Error(`Media is not a regular file: ${path.basename(filePath)}`)
    const digest = createHash("sha256")
    for await (const chunk of createReadStream(filePath, { autoClose: false, fd: handle.fd })) {
      throwIfAborted(signal)
      digest.update(chunk)
    }
    return { sha256: digest.digest("hex"), size: stat.size }
  } finally {
    await handle.close()
  }
}

async function copyNoFollow(source: string, destination: string, signal?: AbortSignal) {
  throwIfAborted(signal)
  const handle = await fs.open(source, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0))
  try {
    const stat = await handle.stat()
    if (!stat.isFile()) throw new Error(`Media is not a regular file: ${path.basename(source)}`)
    await pipeline(
      createReadStream(source, { autoClose: false, fd: handle.fd }),
      createWriteStream(destination, { flags: "wx", mode: 0o600 }),
      { signal },
    )
  } finally {
    await handle.close()
  }
}

async function verifyStagedBatch(
  root: DirectoryIdentity,
  directory: string,
  items: readonly StagedMediaItem[],
  signal?: AbortSignal,
  expectedIdentity?: DirectoryIdentity,
): Promise<DirectoryIdentity> {
  throwIfAborted(signal)
  const identity =
    expectedIdentity ?? (await captureDirectoryIdentity(directory, "Persistent JianYing import batch", root.realPath))
  await assertOwnedDirectoryIdentity(root, identity, "Persistent JianYing import batch")
  const entries = await fs.readdir(directory, { withFileTypes: true })
  await assertOwnedDirectoryIdentity(root, identity, "Persistent JianYing import batch")
  if (entries.length !== items.length || entries.some((entry) => !entry.isFile() || entry.isSymbolicLink())) {
    throw new Error("The persistent JianYing import batch contains unexpected files")
  }
  const expectedNames = new Set(items.map((item) => item.name))
  if (entries.some((entry) => !expectedNames.has(entry.name))) {
    throw new Error("The persistent JianYing import batch no longer matches this export")
  }
  for (const item of items) {
    await assertOwnedDirectoryIdentity(root, identity, "Persistent JianYing import batch")
    const inspected = await inspectRegularFile(item.path, signal)
    await assertOwnedDirectoryIdentity(root, identity, "Persistent JianYing import batch")
    if (inspected.size !== item.size || inspected.sha256 !== item.sha256) {
      throw new Error(`Persistent JianYing media changed after staging: ${item.name}`)
    }
  }
  await assertOwnedDirectoryIdentity(root, identity, "Persistent JianYing import batch")
  return identity
}

async function assertStagedMediaBatchIdentity(batch: StagedMediaBatch, signal?: AbortSignal) {
  throwIfAborted(signal)
  if (!batch.identity) throw new Error("The persistent JianYing import batch identity is missing")
  await assertOwnedDirectoryIdentity(batch.identity.root, batch.identity.batch, "Persistent JianYing import batch")
  throwIfAborted(signal)
}

async function captureDirectoryIdentity(
  directory: string,
  label: string,
  containingRoot?: string,
): Promise<DirectoryIdentity> {
  const before = await fs.lstat(directory)
  if (before.isSymbolicLink() || !before.isDirectory()) throw new Error(`${label} must be a real directory`)
  const realPath = await fs.realpath(directory)
  if (containingRoot) assertPathInside(realPath, containingRoot, label)
  const after = await fs.lstat(directory)
  if (after.isSymbolicLink() || !after.isDirectory() || after.dev !== before.dev || after.ino !== before.ino) {
    throw new Error(`${label} changed while its identity was captured`)
  }
  return {
    birthtimeMs: after.birthtimeMs,
    dev: after.dev,
    ino: after.ino,
    path: directory,
    realPath,
  }
}

async function assertDirectoryIdentity(identity: DirectoryIdentity, label: string) {
  const current = await captureDirectoryIdentity(identity.path, label)
  if (current.dev !== identity.dev || current.ino !== identity.ino || current.realPath !== identity.realPath) {
    throw new Error(`${label} changed after it was captured`)
  }
}

async function assertOwnedDirectoryIdentity(root: DirectoryIdentity, directory: DirectoryIdentity, label: string) {
  await assertDirectoryIdentity(root, "Persistent JianYing staging root")
  await assertDirectoryIdentity(directory, label)
  assertPathInside(directory.realPath, root.realPath, label)
  await assertDirectoryIdentity(root, "Persistent JianYing staging root")
}

async function cleanupOwnedDirectory(root: DirectoryIdentity, directory: DirectoryIdentity, label: string) {
  await assertOwnedDirectoryIdentity(root, directory, label)
  const tombstone = path.join(root.realPath, `.cleanup-${randomUUID()}`)
  await fs.rename(directory.path, tombstone)
  const moved = await captureDirectoryIdentity(tombstone, label, root.realPath)
  if (moved.dev !== directory.dev || moved.ino !== directory.ino) {
    if (!(await pathExists(directory.path))) await fs.rename(tombstone, directory.path).catch(() => undefined)
    throw new Error(`${label} was replaced before cleanup; refusing to remove the replacement`)
  }
  await assertDirectoryIdentity(root, "Persistent JianYing staging root")
  await fs.rm(tombstone, { recursive: true })
  await assertDirectoryIdentity(root, "Persistent JianYing staging root")
  if ((await pathExists(tombstone)) || (await pathExists(directory.path))) {
    throw new Error(`${label} was replaced while it was cleaned up; refusing to follow the replacement`)
  }
}

async function captureDraftRootSnapshots(
  current: JianyingDraftObservation,
  signal?: AbortSignal,
): Promise<readonly DraftRootSnapshot[]> {
  const currentRoot = current.draft ? path.dirname(current.draft.draftPath) : null
  const roots = new Map<string, boolean>()
  if (currentRoot) {
    roots.set(currentRoot, true)
  } else {
    for (const candidate of defaultJianyingDraftRoots()) roots.set(candidate, false)
  }
  const snapshots = new Map<string, DraftRootSnapshot>()
  for (const [configuredRoot, required] of roots) {
    throwIfAborted(signal)
    try {
      const realRoot = await fs.realpath(configuredRoot)
      if (snapshots.has(realRoot)) continue
      const root = await captureDirectoryIdentity(realRoot, "JianYing draft root")
      const entries = await fs.readdir(realRoot, { withFileTypes: true })
      const directoryIdentities = new Set<string>()
      await mapWithConcurrency(entries, 8, async (entry) => {
        throwIfAborted(signal)
        if (!entry.isDirectory() || entry.isSymbolicLink()) return
        const stat = await fs.lstat(path.join(realRoot, entry.name))
        if (!stat.isSymbolicLink() && stat.isDirectory()) {
          directoryIdentities.add(directoryIdentityKey(stat.dev, stat.ino))
        }
      })
      await assertDirectoryIdentity(root, "JianYing draft root")
      snapshots.set(realRoot, {
        directoryIdentities,
        entries: new Set(entries.map((entry) => path.join(realRoot, entry.name))),
        root,
      })
    } catch (error) {
      if (signal?.aborted) throw error
      if (isNodeError(error, "ENOENT") && !required) continue
      if (!required) continue
      throw new Error("Could not snapshot the active JianYing draft directory", { cause: error })
    }
  }
  return [...snapshots.values()]
}

async function proveNewDraftDirectory(
  draft: JianyingActiveDraft,
  snapshots: readonly DraftRootSnapshot[],
  dispatchStartedAt: number,
) {
  const identity = await captureDirectoryIdentity(draft.draftPath, "New JianYing draft directory")
  if (identity.realPath !== draft.draftPath) return false
  const parent = path.dirname(identity.realPath)
  const snapshot = snapshots.find((candidate) => candidate.root.realPath === parent)
  if (snapshot) {
    await assertDirectoryIdentity(snapshot.root, "JianYing draft root")
    if (
      snapshot.entries.has(identity.realPath) ||
      snapshot.directoryIdentities.has(directoryIdentityKey(identity.dev, identity.ino))
    ) {
      return false
    }
  }
  return Number.isFinite(identity.birthtimeMs) && identity.birthtimeMs > 0 && identity.birthtimeMs >= dispatchStartedAt
}

function defaultJianyingDraftRoots() {
  const relative = path.join("Movies", "JianyingPro", "User Data", "Projects", "com.lveditor.draft")
  return [
    path.join(homedir(), relative),
    path.join(homedir(), "Library", "Containers", "com.lemon.lvpro", "Data", relative),
  ]
}

function directoryIdentityKey(dev: number, ino: number) {
  return `${dev}:${ino}`
}

async function mapWithConcurrency<Input, Output>(
  inputs: readonly Input[],
  concurrency: number,
  operation: (input: Input) => Promise<Output>,
) {
  const outputs: Output[] = []
  let cursor = 0
  await Promise.all(
    Array.from({ length: Math.min(concurrency, inputs.length) }, async () => {
      while (cursor < inputs.length) {
        const index = cursor
        cursor += 1
        outputs[index] = await operation(inputs[index])
      }
    }),
  )
  return outputs
}

function assertPathInside(candidate: string, root: string, label: string) {
  const relative = path.relative(root, candidate)
  if (relative === "" || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`)))
    return
  throw new Error(`${label} escaped its root`)
}

function sameObservation(left: JianyingDraftObservation, right: JianyingDraftObservation) {
  if (left.status !== right.status) return false
  if (left.status === "active") return Boolean(left.draft && right.draft && sameDraft(left.draft, right.draft))
  return left.processIds.join(",") === right.processIds.join(",")
}

function sameDraft(left: JianyingActiveDraft, right: JianyingActiveDraft) {
  return left.pid === right.pid && left.lockPath === right.lockPath && left.draftPath === right.draftPath
}

async function containsDraftContent(draftPath: string) {
  for (const fileName of draftContentFileNames) {
    let stat
    try {
      stat = await fs.lstat(path.join(draftPath, fileName))
    } catch (error) {
      if (isNodeError(error, "ENOENT")) continue
      throw error
    }
    if (stat.isSymbolicLink()) throw new Error(`Draft content cannot be a symbolic link: ${fileName}`)
    if (stat.isFile()) return true
  }
  return false
}

function unavailableObservation(reason: string, processIds: readonly number[] = []): JianyingDraftObservation {
  return { processIds, reason, status: "unavailable" }
}

export function jianyingDraftLockValidationFailure(pid: number, error: unknown) {
  const prefix = `Could not validate a JianYing draft lock held by process ${pid}`
  if (isNodeError(error, "EPERM")) {
    return `${prefix}: macOS denied Convax access to the Movies folder (EPERM). Allow Convax in System Settings > Privacy & Security > Media & Apple Music, then retry.`
  }
  if (isNodeError(error, "EACCES")) {
    return `${prefix}: Convax does not have read access to the JianYing draft files (EACCES). Check their permissions, then retry.`
  }
  if (error instanceof Error && "code" in error && typeof error.code === "string") {
    return `${prefix} (${error.code})`
  }
  return prefix
}

function unsupportedObservation(): JianyingDraftObservation {
  return {
    processIds: [],
    reason: "JianYing export is currently supported only on macOS",
    status: "unsupported",
  }
}

function automationOutcomeUnknown(message: string, cause?: unknown) {
  const code = cause === undefined ? null : /JIANYING_[A-Z0-9_]+/.exec(errorMessage(cause))?.[0]
  const detail = code ? ` (${code})` : ""
  return new Error(`${message}${detail}. The outcome is unknown or partial; do not retry automatically.`)
}

function safeNativeFailureReason(error: unknown) {
  if (error instanceof Error && "code" in error && typeof error.code === "string") {
    return `native inspection failed (${error.code})`
  }
  const code = /JIANYING_[A-Z0-9_]+/.exec(errorMessage(error))?.[0]
  return code ?? "native inspection failed"
}

function safeFileName(name: string) {
  const cleaned = name.replaceAll(/[\u0000-\u001f\u007f/\\]+/g, "-").replaceAll(/^[ .]+|[ .]+$/g, "")
  if (!cleaned) return "media.bin"
  if (cleaned.length <= 160) return cleaned
  const extension = path.extname(cleaned).slice(0, 20)
  return `${path.basename(cleaned, path.extname(cleaned)).slice(0, 160 - extension.length)}${extension}`
}

function pathExists(filePath: string) {
  return fs.lstat(filePath).then(
    () => true,
    (error) => {
      if (isNodeError(error, "ENOENT")) return false
      throw error
    },
  )
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  throw signal.reason ?? new DOMException("Canceled", "AbortError")
}
