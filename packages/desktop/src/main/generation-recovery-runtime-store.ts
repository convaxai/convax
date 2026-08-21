import { createHash, randomUUID } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import { isDeepStrictEqual } from "node:util"

import type { GenerationToolSummary } from "../generation-contracts"
import {
  parseWebPluginManifest,
  webPluginManifestSchemaV8,
  webPluginManifestSchemaV9,
  type InstalledWebPluginSummary,
} from "../plugin-contracts"
import type { ActivePluginRuntimeIdentity } from "./plugin-installation-runtime"
import { pluginSnapshotCanonicalDigest, type PluginSnapshotByteIdentity } from "./plugin-installation-snapshots"

export const generationRecoveryRuntimeSchema = "convax.generation-lro-runtime/3" as const
export const generationRecoveryOwnerPrefix = "generation-binding:" as const

export interface GenerationRecoveryRuntimeRecord {
  executionBindingDigest: string
  plugin: InstalledWebPluginSummary
  pluginIdentity: ActivePluginRuntimeIdentity
  pluginPackageDigest: string
  recoveryBindingDigest: string
  runtimeAuthorizationDigest: string
  schema: typeof generationRecoveryRuntimeSchema
  sourceBinding: GenerationRecoveryExecutableBinding
  tool: GenerationToolSummary
  toolBindingDigest: string
}

export interface GenerationRecoveryExecutableBinding extends PluginSnapshotByteIdentity {
  runtime?: "bun"
}

export interface GenerationRecoveryExecutionBindingInput {
  pluginIdentity: ActivePluginRuntimeIdentity
  pluginPackageDigest: string
  recoveryBindingDigest: string
  runtimeAuthorizationDigest: string
  sourceBinding: GenerationRecoveryExecutableBinding
  toolBindingDigest: string
}

const digestPattern = /^[a-f0-9]{64}$/
const maximumRecordBytes = 256 * 1024
const defaultMaximumExecutableBytes = 512 * 1024 * 1024

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  const keys = Object.keys(value).sort()
  const sortedExpected = [...expected].sort()
  return keys.length === sortedExpected.length && keys.every((key, index) => key === sortedExpected[index])
}

function requireDigest(value: unknown, label: string) {
  if (typeof value !== "string" || !digestPattern.test(value)) {
    throw new Error(`${label} is invalid`)
  }
  return value
}

function parseExecutableBinding(value: unknown): GenerationRecoveryExecutableBinding {
  if (!isRecord(value)) throw new Error("Pinned generation recovery executable binding is invalid")
  const expected = value.runtime === undefined ? ["sha256", "size"] : ["runtime", "sha256", "size"]
  if (
    !exactKeys(value, expected) ||
    typeof value.sha256 !== "string" ||
    !digestPattern.test(value.sha256) ||
    typeof value.size !== "number" ||
    !Number.isSafeInteger(value.size) ||
    value.size < 1 ||
    value.size > defaultMaximumExecutableBytes ||
    (value.runtime !== undefined && value.runtime !== "bun")
  ) {
    throw new Error("Pinned generation recovery executable binding is invalid")
  }
  return {
    ...(value.runtime === undefined ? {} : { runtime: value.runtime }),
    sha256: value.sha256,
    size: value.size,
  }
}

function parsePluginIdentity(value: unknown): ActivePluginRuntimeIdentity {
  if (
    !isRecord(value) ||
    !exactKeys(value, ["activeRevision", "activeSetDigest", "pluginId", "snapshotDigest", "version"]) ||
    typeof value.activeRevision !== "number" ||
    !Number.isSafeInteger(value.activeRevision) ||
    value.activeRevision < 1 ||
    typeof value.pluginId !== "string" ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.pluginId) ||
    typeof value.version !== "string" ||
    !value.version ||
    value.version.length > 128
  ) {
    throw new Error("Pinned generation recovery Plugin identity is invalid")
  }
  return {
    activeRevision: value.activeRevision,
    activeSetDigest: requireDigest(value.activeSetDigest, "Pinned generation recovery ActiveSet digest"),
    pluginId: value.pluginId,
    snapshotDigest: requireDigest(value.snapshotDigest, "Pinned generation recovery snapshot digest"),
    version: value.version,
  }
}

export function generationRecoveryOwnerKey(executionBindingDigest: string) {
  return `${generationRecoveryOwnerPrefix}${requireDigest(
    executionBindingDigest,
    "Pinned generation recovery execution binding",
  )}`
}

export function generationRecoveryExecutionBindingDigest(input: GenerationRecoveryExecutionBindingInput) {
  const pluginIdentity = parsePluginIdentity(input.pluginIdentity)
  const sourceBinding = parseExecutableBinding(input.sourceBinding)
  const parts = [
    requireDigest(input.pluginPackageDigest, "Pinned generation recovery Plugin package digest"),
    pluginIdentity.activeRevision,
    pluginIdentity.activeSetDigest,
    pluginIdentity.snapshotDigest,
    createHash("sha256").update(JSON.stringify(sourceBinding)).digest("hex"),
    requireDigest(input.runtimeAuthorizationDigest, "Pinned generation recovery authorization digest"),
    requireDigest(input.recoveryBindingDigest, "Pinned generation recovery protocol binding digest"),
    requireDigest(input.toolBindingDigest, "Pinned generation recovery tool binding digest"),
  ]
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex")
}

function parseRecord(value: unknown): GenerationRecoveryRuntimeRecord {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "executionBindingDigest",
      "plugin",
      "pluginIdentity",
      "pluginPackageDigest",
      "recoveryBindingDigest",
      "runtimeAuthorizationDigest",
      "schema",
      "sourceBinding",
      "tool",
      "toolBindingDigest",
    ]) ||
    value.schema !== generationRecoveryRuntimeSchema ||
    !isRecord(value.plugin) ||
    !isRecord(value.pluginIdentity) ||
    !isRecord(value.sourceBinding) ||
    !isRecord(value.tool)
  ) {
    throw new Error("Pinned generation recovery runtime record is invalid")
  }
  const plugin = parseWebPluginManifest(value.plugin)
  const pluginIdentity = parsePluginIdentity(value.pluginIdentity)
  const pluginPackageDigest = requireDigest(
    value.pluginPackageDigest,
    "Pinned generation recovery Plugin package digest",
  )
  const recoveryBindingDigest = requireDigest(
    value.recoveryBindingDigest,
    "Pinned generation recovery protocol binding digest",
  )
  const runtimeAuthorizationDigest = requireDigest(
    value.runtimeAuthorizationDigest,
    "Pinned generation recovery authorization digest",
  )
  const sourceBinding = parseExecutableBinding(value.sourceBinding)
  const toolBindingDigest = requireDigest(value.toolBindingDigest, "Pinned generation recovery tool binding digest")
  const executionBindingDigest = requireDigest(
    value.executionBindingDigest,
    "Pinned generation recovery execution binding",
  )
  const rawTool = structuredClone(value.tool) as unknown as GenerationToolSummary & { serviceId?: string }
  const tool: GenerationToolSummary = {
    ...rawTool,
    serviceId: rawTool.serviceId ?? plugin.id,
  }
  const declaredTool =
    plugin.schema === webPluginManifestSchemaV8
      ? tool.serviceId === plugin.id && plugin.contributes.generation?.tools.some(({ id }) => id === tool.toolId)
      : plugin.schema === webPluginManifestSchemaV9
        ? (tool.serviceId === plugin.id && plugin.contributes.generation?.tools.some(({ id }) => id === tool.toolId)) ||
          plugin.contributes.services?.some(
            (service) =>
              service.id === tool.serviceId && service.generation?.tools.some(({ id }) => id === tool.toolId),
          )
        : false
  if (
    tool.recovery !== "long-running-operation" ||
    tool.pluginId !== plugin.id ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(tool.serviceId) ||
    !declaredTool ||
    !plugin.hostApi ||
    plugin.runtime?.type !== "mcp-stdio" ||
    plugin.id !== pluginIdentity.pluginId ||
    plugin.version !== pluginIdentity.version
  ) {
    throw new Error("Pinned generation recovery runtime tool binding is invalid")
  }
  if (pluginSnapshotCanonicalDigest(plugin) !== pluginPackageDigest) {
    throw new Error("Pinned generation recovery Plugin package changed")
  }
  if (
    generationRecoveryExecutionBindingDigest({
      pluginIdentity,
      pluginPackageDigest,
      recoveryBindingDigest,
      runtimeAuthorizationDigest,
      sourceBinding,
      toolBindingDigest,
    }) !== executionBindingDigest
  ) {
    throw new Error("Pinned generation recovery execution binding changed")
  }
  return {
    executionBindingDigest,
    plugin,
    pluginIdentity,
    pluginPackageDigest,
    recoveryBindingDigest,
    runtimeAuthorizationDigest,
    schema: generationRecoveryRuntimeSchema,
    sourceBinding,
    tool,
    toolBindingDigest,
  }
}

function serializedRecord(record: GenerationRecoveryRuntimeRecord) {
  const json = `${JSON.stringify(record)}\n`
  if (Buffer.byteLength(json, "utf8") > maximumRecordBytes) {
    throw new Error("Pinned generation recovery runtime record is too large")
  }
  return json
}

async function ensurePrivateDirectory(directory: string, label: string) {
  try {
    const stat = await fs.lstat(directory)
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`${label} must be a real directory`)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    await fs.mkdir(directory, { mode: 0o700 })
  }
  await fs.chmod(directory, 0o700)
  return fs.realpath(directory)
}

export class GenerationRecoveryRuntimeStore {
  readonly #maxRecords: number
  #mutationTail = Promise.resolve()

  constructor(
    private readonly rootPath: string,
    options: { maxRecords?: number } = {},
  ) {
    if (!path.isAbsolute(rootPath)) throw new Error("Generation recovery runtime root must be absolute")
    this.#maxRecords = options.maxRecords ?? 256
    if (!Number.isSafeInteger(this.#maxRecords) || this.#maxRecords < 1 || this.#maxRecords > 4_096) {
      throw new Error("Generation recovery runtime record limit is invalid")
    }
  }

  async pin(input: Omit<GenerationRecoveryRuntimeRecord, "schema">) {
    const validated = parseRecord({ ...input, schema: generationRecoveryRuntimeSchema })
    return this.#withMutation(async () => {
      const parent = await ensurePrivateDirectory(path.dirname(this.rootPath), "Generation recovery runtime parent")
      const root = await ensurePrivateDirectory(
        path.join(parent, path.basename(this.rootPath)),
        "Generation recovery runtime root",
      )
      const target = path.join(root, validated.executionBindingDigest)
      try {
        const existing = await this.open(validated.executionBindingDigest)
        if (!isDeepStrictEqual(existing, validated)) {
          throw new Error("Pinned generation recovery execution binding already has another record")
        }
        return existing
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
      }
      const records = await this.#recordNames(root, true)
      if (records.length >= this.#maxRecords) {
        throw new Error("Pinned generation recovery runtime store reached its record limit")
      }
      const temporary = path.join(root, `.runtime-${randomUUID()}.tmp`)
      await fs.mkdir(temporary, { mode: 0o700 })
      try {
        await fs.writeFile(path.join(temporary, "record.json"), serializedRecord(validated), {
          flag: "wx",
          mode: 0o400,
        })
        try {
          await fs.rename(temporary, target)
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
          await fs.rm(temporary, { force: true, recursive: true })
        }
        const published = await this.open(validated.executionBindingDigest)
        if (!isDeepStrictEqual(published, validated)) {
          throw new Error("Pinned generation recovery execution binding already has another record")
        }
        return published
      } catch (error) {
        await fs.rm(temporary, { force: true, recursive: true }).catch(() => undefined)
        throw error
      }
    })
  }

  async open(executionBindingDigest: string) {
    requireDigest(executionBindingDigest, "Pinned generation recovery execution binding")
    const root = await fs.realpath(this.rootPath)
    const directory = path.join(root, executionBindingDigest)
    const directoryStat = await fs.lstat(directory)
    if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) {
      throw new Error("Pinned generation recovery runtime directory is invalid")
    }
    const entries = await fs.readdir(directory, { withFileTypes: true })
    if (
      entries.length !== 1 ||
      entries[0]?.name !== "record.json" ||
      !entries[0].isFile() ||
      entries[0].isSymbolicLink()
    ) {
      throw new Error("Pinned generation recovery runtime files are invalid")
    }
    const recordPath = path.join(directory, "record.json")
    const [recordStat, bytes] = await Promise.all([fs.lstat(recordPath), fs.readFile(recordPath)])
    if (
      recordStat.isSymbolicLink() ||
      !recordStat.isFile() ||
      bytes.byteLength < 1 ||
      bytes.byteLength > maximumRecordBytes
    ) {
      throw new Error("Pinned generation recovery runtime files are invalid")
    }
    const record = parseRecord(JSON.parse(bytes.toString("utf8")) as unknown)
    if (record.executionBindingDigest !== executionBindingDigest) {
      throw new Error("Pinned generation recovery runtime identity changed")
    }
    return record
  }

  async list() {
    return this.#withMutation(async () => {
      let root: string
      try {
        root = await fs.realpath(this.rootPath)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return [] as GenerationRecoveryRuntimeRecord[]
        throw error
      }
      const names = await this.#recordNames(root, true)
      return Promise.all(names.map((name) => this.open(name)))
    })
  }

  async remove(executionBindingDigest: string) {
    requireDigest(executionBindingDigest, "Pinned generation recovery execution binding")
    await this.#withMutation(async () => {
      let root: string
      try {
        root = await fs.realpath(this.rootPath)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return
        throw error
      }
      await fs.rm(path.join(root, executionBindingDigest), { force: true, recursive: true })
    })
  }

  async #withMutation<T>(operation: () => Promise<T>) {
    const previous = this.#mutationTail
    let release: () => void = () => {}
    this.#mutationTail = new Promise<void>((resolve) => {
      release = resolve
    })
    await previous
    try {
      return await operation()
    } finally {
      release()
    }
  }

  async #recordNames(root: string, cleanTemporary: boolean) {
    const names: string[] = []
    for (const entry of await fs.readdir(root, { withFileTypes: true })) {
      if (entry.name.startsWith(".runtime-") && entry.name.endsWith(".tmp")) {
        if (cleanTemporary) await fs.rm(path.join(root, entry.name), { force: true, recursive: true })
        continue
      }
      if (!entry.isDirectory() || entry.isSymbolicLink() || !digestPattern.test(entry.name)) {
        throw new Error("Pinned generation recovery runtime store contains invalid state")
      }
      names.push(entry.name)
    }
    return names.sort()
  }
}
