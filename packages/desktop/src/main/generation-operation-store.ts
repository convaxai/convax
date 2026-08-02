import { createHash, randomUUID } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"

import { isCanvasGenerationOperationId, isCanvasGenerationTaskId } from "@convax/canvas/core"

import { syncDirectoryEntry, syncFileBytes } from "./filesystem-durability"

export const generationOperationLedgerSchema = "convax.generation-operation-ledger/1" as const

export type GenerationOperationPhase =
  | "prepared"
  | "dispatching"
  | "accepted"
  | "result-ready"
  | "committed"
  | "acknowledged"
  | "cancelled"
  | "failed"
  | "indeterminate"

export interface GenerationOperationLedger {
  canvasId: string
  createdAt: number
  executionBindingDigest: string
  inputSnapshotId: string
  nodeId: string
  operationId: string
  phase: GenerationOperationPhase
  pluginPackageDigest: string
  projectId: string
  requestDigest: string
  resultDigest?: string
  runtimeAuthorizationDigest: string
  schema: typeof generationOperationLedgerSchema
  sidecarRecoveryBindingDigest: string
  targetGuardDigest: string
  taskId?: string
  toolId: string
  updatedAt: number
}

type GenerationOperationIdentity = Pick<
  GenerationOperationLedger,
  "canvasId" | "nodeId" | "operationId" | "projectId"
>

const digestPattern = /^[a-f0-9]{64}$/
const safeIdentifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/
const safeToolIdPattern = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,511}$/
const unsafePrivateValue =
  /(?:^|[._:/-])(?:authorization|cookie|password|passwd|secret|token|api[-_]?key|access[-_]?key|ak|sk)(?:[._:/-]|$)|(?:^|[._:-])(?:users|home|tmp|private)(?:[._:/-]|$)/i
const ledgerKeys = [
  "canvasId",
  "createdAt",
  "executionBindingDigest",
  "inputSnapshotId",
  "nodeId",
  "operationId",
  "phase",
  "pluginPackageDigest",
  "projectId",
  "requestDigest",
  "resultDigest",
  "runtimeAuthorizationDigest",
  "schema",
  "sidecarRecoveryBindingDigest",
  "targetGuardDigest",
  "taskId",
  "toolId",
  "updatedAt",
] as const
const phases = new Set<GenerationOperationPhase>([
  "prepared",
  "dispatching",
  "accepted",
  "result-ready",
  "committed",
  "acknowledged",
  "cancelled",
  "failed",
  "indeterminate",
])
const phaseTransitions: Record<GenerationOperationPhase, ReadonlySet<GenerationOperationPhase>> = {
  accepted: new Set(["accepted", "result-ready", "cancelled", "failed", "indeterminate"]),
  acknowledged: new Set(["acknowledged"]),
  cancelled: new Set(["cancelled", "acknowledged"]),
  committed: new Set(["committed", "acknowledged"]),
  dispatching: new Set(["dispatching", "accepted", "result-ready", "cancelled", "failed", "indeterminate"]),
  failed: new Set(["failed", "acknowledged"]),
  indeterminate: new Set(["indeterminate"]),
  prepared: new Set(["prepared", "dispatching", "accepted", "result-ready", "cancelled", "failed", "indeterminate"]),
  "result-ready": new Set(["result-ready", "committed", "cancelled", "failed", "indeterminate"]),
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableJson(entry === undefined ? null : entry)).join(",")}]`
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`
  }
  return JSON.stringify(value) ?? "null"
}

export function generationOperationRequestDigest(value: unknown) {
  return createHash("sha256").update(stableJson(value)).digest("hex")
}

function scopedKey(identity: GenerationOperationIdentity) {
  return createHash("sha256")
    .update(stableJson({
      canvasId: identity.canvasId,
      nodeId: identity.nodeId,
      operationId: identity.operationId,
      projectId: identity.projectId,
    }))
    .digest("hex")
}

function requireSafeIdentifier(value: unknown, label: string) {
  if (
    typeof value !== "string" ||
    !safeIdentifierPattern.test(value) ||
    unsafePrivateValue.test(value) ||
    value.includes("..")
  ) {
    throw new Error(`Generation operation ${label} is unsafe`)
  }
  return value
}

function requireDigest(value: unknown, label: string) {
  if (typeof value !== "string" || !digestPattern.test(value)) {
    throw new Error(`Generation operation ${label} is invalid`)
  }
  return value
}

function requireTime(value: unknown, label: string) {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`Generation operation ${label} is invalid`)
  }
  return value as number
}

function parseLedger(value: unknown): GenerationOperationLedger {
  if (!isRecord(value)) throw new Error("Generation operation ledger is invalid")
  const allowed = new Set<string>(ledgerKeys)
  if (Object.keys(value).some((key) => !allowed.has(key)) || value.schema !== generationOperationLedgerSchema) {
    throw new Error("Generation operation ledger is invalid")
  }
  if (!isCanvasGenerationOperationId(value.operationId) || unsafePrivateValue.test(value.operationId)) {
    throw new Error("Generation operation operation id is unsafe")
  }
  if (typeof value.phase !== "string" || !phases.has(value.phase as GenerationOperationPhase)) {
    throw new Error("Generation operation phase is invalid")
  }
  if (
    typeof value.toolId !== "string" ||
    !safeToolIdPattern.test(value.toolId) ||
    value.toolId.startsWith("/") ||
    value.toolId.includes("..") ||
    unsafePrivateValue.test(value.toolId)
  ) {
    throw new Error("Generation operation tool id is unsafe")
  }
  if (value.taskId !== undefined && !isCanvasGenerationTaskId(value.taskId)) {
    throw new Error("Generation operation task id is invalid")
  }
  const ledger: GenerationOperationLedger = {
    canvasId: requireSafeIdentifier(value.canvasId, "Canvas id"),
    createdAt: requireTime(value.createdAt, "created time"),
    executionBindingDigest: requireDigest(value.executionBindingDigest, "execution binding digest"),
    inputSnapshotId: requireDigest(value.inputSnapshotId, "input snapshot id"),
    nodeId: requireSafeIdentifier(value.nodeId, "node id"),
    operationId: value.operationId,
    phase: value.phase as GenerationOperationPhase,
    pluginPackageDigest: requireDigest(value.pluginPackageDigest, "Plugin package digest"),
    projectId: requireSafeIdentifier(value.projectId, "Project id"),
    requestDigest: requireDigest(value.requestDigest, "request digest"),
    ...(value.resultDigest === undefined ? {} : { resultDigest: requireDigest(value.resultDigest, "result digest") }),
    runtimeAuthorizationDigest: requireDigest(value.runtimeAuthorizationDigest, "authorization digest"),
    schema: generationOperationLedgerSchema,
    sidecarRecoveryBindingDigest: requireDigest(value.sidecarRecoveryBindingDigest, "recovery binding digest"),
    targetGuardDigest: requireDigest(value.targetGuardDigest, "target guard digest"),
    ...(value.taskId === undefined ? {} : { taskId: value.taskId }),
    toolId: value.toolId,
    updatedAt: requireTime(value.updatedAt, "updated time"),
  }
  if (ledger.updatedAt < ledger.createdAt || stableJson(ledger).length > 16 * 1024) {
    throw new Error("Generation operation ledger is invalid")
  }
  if ((ledger.phase === "accepted" || ledger.phase === "result-ready") && !ledger.taskId) {
    throw new Error("Generation operation accepted phase requires a task id")
  }
  if (ledger.phase === "result-ready" && !ledger.resultDigest) {
    throw new Error("Generation operation result-ready phase requires a result digest")
  }
  return ledger
}

async function ensurePrivateDirectory(root: string) {
  try {
    const existing = await fs.lstat(root)
    if (existing.isSymbolicLink()) throw new Error("Generation operation store root cannot be a symlink")
    if (!existing.isDirectory()) throw new Error("Generation operation store root is invalid")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    await fs.mkdir(root, { mode: 0o700, recursive: true })
  }
  await fs.chmod(root, 0o700)
}

export class GenerationOperationStore {
  readonly #locks = new Map<string, Promise<void>>()
  readonly #maxRecords: number
  readonly #now: () => number

  constructor(
    private readonly root: string,
    options: { maxRecords?: number; now?: () => number } = {},
  ) {
    if (!path.isAbsolute(root)) throw new Error("Generation operation store root must be absolute")
    this.#maxRecords = options.maxRecords ?? 4_096
    if (!Number.isSafeInteger(this.#maxRecords) || this.#maxRecords < 1 || this.#maxRecords > 65_536) {
      throw new Error("Generation operation store record limit is invalid")
    }
    this.#now = options.now ?? Date.now
  }

  async create(input: GenerationOperationLedger) {
    const parsed = parseLedger(input)
    return this.#locked(parsed, async () => {
      await ensurePrivateDirectory(this.root)
      const current = await this.#readOptional(parsed)
      if (current) {
        if (current.requestDigest !== parsed.requestDigest) {
          throw new Error("Generation operation id already exists with a different request digest")
        }
        return current
      }
      if ((await this.list()).length >= this.#maxRecords) {
        throw new Error("Generation operation store reached its record limit")
      }
      const now = this.#now()
      const created = parseLedger({ ...parsed, createdAt: now, updatedAt: now })
      await this.#write(created)
      return created
    })
  }

  async read(identity: GenerationOperationIdentity) {
    await ensurePrivateDirectory(this.root)
    const value = await this.#readOptional(identity)
    if (!value) throw new Error("Generation operation ledger was not found")
    return value
  }

  async list() {
    await ensurePrivateDirectory(this.root)
    const entries = await fs.readdir(this.root, { withFileTypes: true })
    const ledgers: GenerationOperationLedger[] = []
    for (const entry of entries) {
      if (!entry.isFile() || !/^[a-f0-9]{64}\.json$/.test(entry.name)) {
        if (entry.name.startsWith(".operation-") && entry.name.endsWith(".tmp")) continue
        throw new Error("Generation operation store contains invalid state")
      }
      let bytes: string
      try {
        bytes = await fs.readFile(path.join(this.root, entry.name), "utf8")
      } catch (error) {
        // Acknowledgement cleanup may remove a valid entry after readdir. The
        // next list is authoritative; every other read failure remains fatal.
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue
        throw error
      }
      const parsed = parseLedger(JSON.parse(bytes) as unknown)
      if (`${scopedKey(parsed)}.json` !== entry.name) throw new Error("Generation operation ledger key is invalid")
      ledgers.push(parsed)
    }
    return ledgers.sort((left, right) => left.createdAt - right.createdAt || scopedKey(left).localeCompare(scopedKey(right)))
  }

  async transition(
    identity: GenerationOperationIdentity,
    patch: Pick<GenerationOperationLedger, "phase"> &
      Partial<Pick<GenerationOperationLedger, "resultDigest" | "taskId">>,
  ) {
    return this.#locked(identity, async () => {
      const current = await this.read(identity)
      if (!phaseTransitions[current.phase].has(patch.phase)) {
        throw new Error(`Generation operation phase transition is invalid: ${current.phase} -> ${patch.phase}`)
      }
      if (current.taskId && patch.taskId && current.taskId !== patch.taskId) {
        throw new Error("Generation operation received a different task id")
      }
      if (current.resultDigest && patch.resultDigest && current.resultDigest !== patch.resultDigest) {
        throw new Error("Generation operation received a different result digest")
      }
      const next = parseLedger({
        ...current,
        phase: patch.phase,
        ...(current.taskId || patch.taskId ? { taskId: current.taskId ?? patch.taskId } : {}),
        ...(current.resultDigest || patch.resultDigest
          ? { resultDigest: current.resultDigest ?? patch.resultDigest }
          : {}),
        updatedAt: this.#now(),
      })
      await this.#write(next)
      return next
    })
  }

  async remove(identity: GenerationOperationIdentity) {
    return this.#locked(identity, async () => {
      await ensurePrivateDirectory(this.root)
      await fs.rm(path.join(this.root, `${scopedKey(identity)}.json`), { force: true })
    })
  }

  async #readOptional(identity: GenerationOperationIdentity) {
    const file = path.join(this.root, `${scopedKey(identity)}.json`)
    try {
      const stat = await fs.lstat(file)
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 2 || stat.size > 16 * 1024) {
        throw new Error("Generation operation ledger is invalid")
      }
      const parsed = parseLedger(JSON.parse(await fs.readFile(file, "utf8")) as unknown)
      if (scopedKey(parsed) !== scopedKey(identity)) throw new Error("Generation operation ledger is invalid")
      return parsed
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
      if (error instanceof SyntaxError) {
        throw new Error("Generation operation ledger is invalid", { cause: error })
      }
      throw error
    }
  }

  async #write(ledger: GenerationOperationLedger) {
    const target = path.join(this.root, `${scopedKey(ledger)}.json`)
    const temporary = path.join(this.root, `.operation-${randomUUID()}.tmp`)
    const handle = await fs.open(temporary, "wx", 0o600)
    try {
      await handle.writeFile(`${JSON.stringify(ledger, null, 2)}\n`, "utf8")
      await syncFileBytes(handle)
    } finally {
      await handle.close()
    }
    try {
      await fs.rename(temporary, target)
      await syncDirectoryEntry(this.root)
    } catch (error) {
      await fs.rm(temporary, { force: true })
      throw error
    }
  }

  async #locked<T>(identity: GenerationOperationIdentity, action: () => Promise<T>): Promise<T> {
    const key = scopedKey(identity)
    const previous = this.#locks.get(key) ?? Promise.resolve()
    let release!: () => void
    const current = new Promise<void>((resolve) => {
      release = resolve
    })
    const queued = previous.then(() => current)
    this.#locks.set(key, queued)
    await previous
    try {
      return await action()
    } finally {
      release()
      if (this.#locks.get(key) === queued) this.#locks.delete(key)
    }
  }
}
