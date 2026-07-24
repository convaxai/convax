import { randomUUID } from "node:crypto"
import { constants as fsConstants } from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"

import { requireWebPluginId } from "../plugin-contracts"

const petStateSchema = "convax.pet-state/1" as const
const maximumStateBytes = 512 * 1024
const maximumPositions = 64
const maximumWatermarks = 256

export interface PetPersistedPreferences {
  selectedPetId?: string
}

export interface PetPersistedState {
  awake: boolean
  displayId?: string
  positions: Record<string, { scaleFactor?: number; x: number; y: number }>
  preferences: PetPersistedPreferences
  providerId?: string
  schema: typeof petStateSchema
  seen: Record<string, number>
}

export type PetStateWrite = Omit<PetPersistedState, "schema"> & { schema?: typeof petStateSchema }

export const defaultPetState: PetPersistedState = Object.freeze({
  awake: false,
  positions: Object.freeze({}),
  preferences: Object.freeze({}),
  schema: petStateSchema,
  seen: Object.freeze({}),
})

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error
}

function asRecord(value: unknown, label: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as Record<string, unknown>
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  required: readonly string[],
  label: string,
) {
  const allowedSet = new Set(allowed)
  const unknown = Object.keys(value).find((key) => !allowedSet.has(key))
  if (unknown) throw new Error(`${label} contains an unsupported field: ${unknown}`)
  const missing = required.find((key) => !(key in value))
  if (missing) throw new Error(`${label} is missing field: ${missing}`)
}

function boundedKey(value: string, label: string, maximum = 256) {
  if (value.length < 1 || value.length > maximum) throw new Error(`${label} is invalid`)
  return value
}

function parsePosition(value: unknown, label: string) {
  const input = asRecord(value, label)
  exactKeys(input, ["scaleFactor", "x", "y"], ["x", "y"], label)
  if (!Number.isSafeInteger(input.x) || !Number.isSafeInteger(input.y)) {
    throw new Error(`${label} position must use finite safe coordinates`)
  }
  if (Math.abs(input.x as number) > 1_000_000 || Math.abs(input.y as number) > 1_000_000) {
    throw new Error(`${label} position is outside the supported range`)
  }
  if (
    input.scaleFactor !== undefined &&
    (typeof input.scaleFactor !== "number" ||
      !Number.isFinite(input.scaleFactor) ||
      input.scaleFactor < 0.25 ||
      input.scaleFactor > 8)
  ) {
    throw new Error(`${label} scale factor is invalid`)
  }
  return {
    ...(input.scaleFactor === undefined ? {} : { scaleFactor: input.scaleFactor as number }),
    x: input.x as number,
    y: input.y as number,
  }
}

function parsePreferences(value: unknown): PetPersistedPreferences {
  const input = asRecord(value, "Pet preferences")
  exactKeys(input, ["selectedPetId"], [], "Pet preferences")
  if (input.selectedPetId === undefined) return {}
  if (
    typeof input.selectedPetId !== "string" ||
    input.selectedPetId.length > 80 ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.selectedPetId)
  ) {
    throw new Error("Pet selectedPetId is invalid")
  }
  return { selectedPetId: input.selectedPetId }
}

export function boundPetState(value: unknown): PetPersistedState {
  const input = asRecord(value, "Pet state")
  exactKeys(
    input,
    ["awake", "displayId", "positions", "preferences", "providerId", "schema", "seen"],
    ["awake", "positions", "preferences", "seen"],
    "Pet state",
  )
  if (input.schema !== undefined && input.schema !== petStateSchema) throw new Error("Pet state schema is unsupported")
  if (typeof input.awake !== "boolean") throw new Error("Pet awake state must be boolean")

  const positionInput = asRecord(input.positions, "Pet positions")
  const positions = Object.fromEntries(
    Object.entries(positionInput)
      .sort(([left], [right]) => left.localeCompare(right))
      .slice(0, maximumPositions)
      .map(([displayId, position]) => [
        boundedKey(displayId, "Pet display id", 128),
        parsePosition(position, displayId),
      ]),
  )

  const seenInput = asRecord(input.seen, "Pet seen watermarks")
  const watermarks = Object.entries(seenInput).map(([key, timestamp]) => {
    boundedKey(key, "Pet watermark key")
    if (!Number.isSafeInteger(timestamp) || (timestamp as number) < 0) {
      throw new Error("Pet watermark must be a non-negative safe timestamp")
    }
    return [key, timestamp as number] as const
  })
  watermarks.sort(([leftKey, left], [rightKey, right]) => right - left || leftKey.localeCompare(rightKey))
  const seen = Object.fromEntries(watermarks.slice(0, maximumWatermarks))
  const preferences = parsePreferences(input.preferences)
  const providerId = input.providerId === undefined ? undefined : requireWebPluginId(input.providerId)
  if (input.displayId !== undefined && typeof input.displayId !== "string") {
    throw new Error("Pet display id is invalid")
  }
  const displayId = input.displayId === undefined ? undefined : boundedKey(input.displayId, "Pet display id", 128)
  return {
    awake: input.awake,
    ...(displayId === undefined ? {} : { displayId }),
    positions,
    preferences,
    ...(providerId === undefined ? {} : { providerId }),
    schema: petStateSchema,
    seen,
  }
}

function cloneState(state: PetPersistedState): PetPersistedState {
  return {
    awake: state.awake,
    ...(state.displayId === undefined ? {} : { displayId: state.displayId }),
    positions: Object.fromEntries(Object.entries(state.positions).map(([key, value]) => [key, { ...value }])),
    preferences: { ...state.preferences },
    ...(state.providerId === undefined ? {} : { providerId: state.providerId }),
    schema: petStateSchema,
    seen: { ...state.seen },
  }
}

export class PetStateStore {
  readonly #file: string
  #mutationTail: Promise<void> = Promise.resolve()

  constructor(file: string) {
    if (!path.isAbsolute(file)) throw new Error("Pet state path must be absolute")
    this.#file = file
  }

  async read(): Promise<PetPersistedState> {
    let handle: Awaited<ReturnType<typeof fs.open>> | undefined
    try {
      const noFollow = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0)
      handle = await fs.open(this.#file, noFollow)
      const stat = await handle.stat()
      if (!stat.isFile() || stat.size > maximumStateBytes) throw new Error("Pet state file is invalid")
      const bytes = await handle.readFile()
      if (bytes.byteLength > maximumStateBytes) throw new Error("Pet state file is invalid")
      return boundPetState(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)))
    } catch {
      return cloneState(defaultPetState)
    } finally {
      await handle?.close().catch(() => undefined)
    }
  }

  async write(value: PetStateWrite | PetPersistedState) {
    await this.#exclusive(() => this.#write(value))
  }

  async update(update: (state: PetPersistedState) => PetStateWrite | PetPersistedState) {
    return this.#exclusive(async () => {
      const next = boundPetState(update(await this.read()))
      await this.#write(next)
      return cloneState(next)
    })
  }

  async loadSeen() {
    return { ...(await this.read()).seen }
  }

  async markSeen(key: string, timestamp: number) {
    await this.update((state) => ({ ...state, seen: { ...state.seen, [key]: timestamp } }))
  }

  #exclusive<Result>(operation: () => Promise<Result>) {
    const result = this.#mutationTail.then(operation, operation)
    this.#mutationTail = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  async #write(value: PetStateWrite | PetPersistedState) {
    const state = boundPetState(value)
    const serialized = `${JSON.stringify(state, null, 2)}\n`
    if (Buffer.byteLength(serialized) > maximumStateBytes) throw new Error("Pet state exceeds its size limit")
    const directoryPath = path.dirname(this.#file)
    await fs.mkdir(directoryPath, { mode: 0o700, recursive: true })
    const directoryStat = await fs.lstat(directoryPath)
    if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) {
      throw new Error("Pet state directory must be a real directory")
    }
    try {
      const target = await fs.lstat(this.#file)
      if (target.isSymbolicLink() || !target.isFile()) throw new Error("Pet state target must be a regular file")
    } catch (error) {
      if (!isNodeError(error) || error.code !== "ENOENT") throw error
    }

    const temporary = path.join(directoryPath, `.${path.basename(this.#file)}.${randomUUID()}.tmp`)
    let handle: Awaited<ReturnType<typeof fs.open>> | undefined
    try {
      const noFollow = typeof fsConstants.O_NOFOLLOW === "number" ? fsConstants.O_NOFOLLOW : 0
      handle = await fs.open(
        temporary,
        fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | noFollow,
        0o600,
      )
      await handle.chmod(0o600)
      await handle.writeFile(serialized, "utf8")
      await handle.sync()
      await handle.close()
      handle = undefined
      await fs.rename(temporary, this.#file)
      if (process.platform !== "win32") {
        try {
          const directory = await fs.open(directoryPath, "r")
          try {
            await directory.sync()
          } finally {
            await directory.close()
          }
        } catch {
          // The file fsync and rename already crossed the atomic commit boundary.
        }
      }
    } finally {
      await handle?.close().catch(() => undefined)
      await fs.rm(temporary, { force: true }).catch(() => undefined)
    }
  }
}
