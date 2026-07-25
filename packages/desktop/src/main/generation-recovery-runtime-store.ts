import { createHash, randomUUID } from "node:crypto"
import { constants } from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"

import type { GenerationToolSummary } from "../generation-contracts"
import type { InstalledWebPluginSummary } from "../plugin-contracts"
import {
  toolPluginAuthorizationIdentity,
  toolPluginManifestSha256,
  type ToolPluginExecutableBinding,
  type ToolPluginExecutableBindingKind,
} from "./tool-plugin-authorizations"

export const generationRecoveryRuntimeSchema = "convax.generation-recovery-runtime/1" as const

export interface GenerationRecoveryRuntimeRecord {
  bindingKind: ToolPluginExecutableBindingKind
  executablePath: string
  executableRuntime?: "bun"
  executionBindingDigest: string
  plugin: InstalledWebPluginSummary
  pluginPackageDigest: string
  recoveryBindingDigest: string
  runtimeAuthorizationDigest: string
  schema: typeof generationRecoveryRuntimeSchema
  sourceBinding: ToolPluginExecutableBinding
  tool: GenerationToolSummary
}

const digestPattern = /^[a-f0-9]{64}$/
const maximumRecordBytes = 256 * 1024
const defaultMaximumExecutableBytes = 512 * 1024 * 1024

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function stableExecutionBindingDigest(
  pluginPackageDigest: string,
  runtimeAuthorizationDigest: string,
  recoveryBindingDigest: string,
) {
  return createHash("sha256")
    .update(JSON.stringify([pluginPackageDigest, runtimeAuthorizationDigest, recoveryBindingDigest]))
    .digest("hex")
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

async function hashFile(filePath: string, maximumBytes = defaultMaximumExecutableBytes) {
  const handle = await fs.open(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const before = await handle.stat()
    if (!before.isFile() || before.size < 1 || before.size > maximumBytes) {
      throw new Error("Pinned generation recovery executable is invalid")
    }
    const bytes = await handle.readFile()
    const after = await handle.stat()
    if (
      bytes.byteLength !== before.size ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs
    ) {
      throw new Error("Pinned generation recovery executable changed while it was read")
    }
    return { bytes, sha256: createHash("sha256").update(bytes).digest("hex"), size: bytes.byteLength }
  } finally {
    await handle.close()
  }
}

function parseRecord(value: unknown, executablePath: string): GenerationRecoveryRuntimeRecord {
  if (!isRecord(value)) throw new Error("Pinned generation recovery runtime record is invalid")
  const allowed = new Set([
    "bindingKind",
    "executableRuntime",
    "executionBindingDigest",
    "plugin",
    "pluginPackageDigest",
    "recoveryBindingDigest",
    "runtimeAuthorizationDigest",
    "schema",
    "sourceBinding",
    "tool",
  ])
  if (
    Object.keys(value).some((key) => !allowed.has(key)) ||
    value.schema !== generationRecoveryRuntimeSchema ||
    (value.bindingKind !== "managed" && value.bindingKind !== "path") ||
    (value.executableRuntime !== undefined && value.executableRuntime !== "bun") ||
    !digestPattern.test(String(value.executionBindingDigest)) ||
    !digestPattern.test(String(value.pluginPackageDigest)) ||
    !digestPattern.test(String(value.recoveryBindingDigest)) ||
    !digestPattern.test(String(value.runtimeAuthorizationDigest)) ||
    !isRecord(value.plugin) ||
    !isRecord(value.sourceBinding) ||
    !isRecord(value.tool)
  ) {
    throw new Error("Pinned generation recovery runtime record is invalid")
  }
  const plugin = structuredClone(value.plugin) as unknown as InstalledWebPluginSummary
  const sourceBinding = structuredClone(value.sourceBinding) as unknown as ToolPluginExecutableBinding
  const tool = structuredClone(value.tool) as unknown as GenerationToolSummary
  if (
    tool.recovery !== "operation-exactly-once" ||
    tool.pluginId !== plugin.id ||
    plugin.runtime?.type !== "mcp-stdio"
  ) {
    throw new Error("Pinned generation recovery runtime tool binding is invalid")
  }
  if (toolPluginManifestSha256(plugin) !== value.pluginPackageDigest) {
    throw new Error("Pinned generation recovery Plugin package changed")
  }
  if (
    createHash("sha256")
      .update(toolPluginAuthorizationIdentity(plugin, value.bindingKind, sourceBinding))
      .digest("hex") !==
    value.runtimeAuthorizationDigest
  ) {
    throw new Error("Pinned generation recovery authorization changed")
  }
  if (
    stableExecutionBindingDigest(
      value.pluginPackageDigest as string,
      value.runtimeAuthorizationDigest as string,
      value.recoveryBindingDigest as string,
    ) !== value.executionBindingDigest
  ) {
    throw new Error("Pinned generation recovery execution binding changed")
  }
  return {
    bindingKind: value.bindingKind,
    executablePath,
    ...(value.executableRuntime === undefined ? {} : { executableRuntime: value.executableRuntime }),
    executionBindingDigest: value.executionBindingDigest as string,
    plugin,
    pluginPackageDigest: value.pluginPackageDigest as string,
    recoveryBindingDigest: value.recoveryBindingDigest as string,
    runtimeAuthorizationDigest: value.runtimeAuthorizationDigest as string,
    schema: generationRecoveryRuntimeSchema,
    sourceBinding,
    tool,
  }
}

function serializedRecord(record: Omit<GenerationRecoveryRuntimeRecord, "executablePath">) {
  const json = `${JSON.stringify(record)}\n`
  if (Buffer.byteLength(json, "utf8") > maximumRecordBytes) {
    throw new Error("Pinned generation recovery runtime record is too large")
  }
  return json
}

export class GenerationRecoveryRuntimeStore {
  readonly #maxExecutableBytes: number
  readonly #maxRecords: number

  constructor(
    private readonly rootPath: string,
    options: { maxExecutableBytes?: number; maxRecords?: number } = {},
  ) {
    if (!path.isAbsolute(rootPath)) throw new Error("Generation recovery runtime root must be absolute")
    this.#maxExecutableBytes = options.maxExecutableBytes ?? defaultMaximumExecutableBytes
    this.#maxRecords = options.maxRecords ?? 256
    if (!Number.isSafeInteger(this.#maxExecutableBytes) || this.#maxExecutableBytes < 1) {
      throw new Error("Generation recovery runtime executable size limit is invalid")
    }
    if (!Number.isSafeInteger(this.#maxRecords) || this.#maxRecords < 1 || this.#maxRecords > 4_096) {
      throw new Error("Generation recovery runtime record limit is invalid")
    }
  }

  async pin(input: {
    bindingKind: ToolPluginExecutableBindingKind
    executablePath: string
    executableRuntime?: "bun"
    executionBindingDigest: string
    plugin: InstalledWebPluginSummary
    pluginPackageDigest: string
    recoveryBindingDigest: string
    runtimeAuthorizationDigest: string
    sourceBinding: ToolPluginExecutableBinding
    tool: GenerationToolSummary
  }) {
    if (!digestPattern.test(input.executionBindingDigest)) {
      throw new Error("Pinned generation recovery execution binding is invalid")
    }
    const parent = await ensurePrivateDirectory(path.dirname(this.rootPath), "Generation recovery runtime parent")
    const root = await ensurePrivateDirectory(
      path.join(parent, path.basename(this.rootPath)),
      "Generation recovery runtime root",
    )
    const target = path.join(root, input.executionBindingDigest)
    let targetExists = false
    try {
      const stat = await fs.lstat(target)
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        throw new Error("Pinned generation recovery runtime directory is invalid")
      }
      targetExists = true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    }
    if (!targetExists) {
      let count = 0
      for (const entry of await fs.readdir(root, { withFileTypes: true })) {
        if (entry.name.startsWith(".runtime-") && entry.name.endsWith(".tmp")) {
          await fs.rm(path.join(root, entry.name), { force: true, recursive: true })
          continue
        }
        if (!entry.isDirectory() || !digestPattern.test(entry.name)) {
          throw new Error("Pinned generation recovery runtime store contains invalid state")
        }
        count += 1
      }
      if (count >= this.#maxRecords) {
        throw new Error("Pinned generation recovery runtime store reached its record limit")
      }
    }
    const temporary = path.join(root, `.runtime-${randomUUID()}.tmp`)
    await fs.mkdir(temporary, { mode: 0o700 })
    try {
      const source = await hashFile(input.executablePath, this.#maxExecutableBytes)
      if (source.sha256 !== input.sourceBinding.sha256 || source.size !== input.sourceBinding.size) {
        throw new Error("Pinned generation recovery executable does not match its authorization")
      }
      const executablePath = path.join(temporary, "entrypoint")
      await fs.writeFile(executablePath, source.bytes, { flag: "wx", mode: 0o500 })
      const record = {
        bindingKind: input.bindingKind,
        ...(input.executableRuntime === undefined ? {} : { executableRuntime: input.executableRuntime }),
        executionBindingDigest: input.executionBindingDigest,
        plugin: structuredClone(input.plugin),
        pluginPackageDigest: input.pluginPackageDigest,
        recoveryBindingDigest: input.recoveryBindingDigest,
        runtimeAuthorizationDigest: input.runtimeAuthorizationDigest,
        schema: generationRecoveryRuntimeSchema,
        sourceBinding: structuredClone(input.sourceBinding),
        tool: structuredClone(input.tool),
      } satisfies Omit<GenerationRecoveryRuntimeRecord, "executablePath">
      await fs.writeFile(path.join(temporary, "record.json"), serializedRecord(record), {
        flag: "wx",
        mode: 0o400,
      })
      try {
        await fs.rename(temporary, target)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
        await fs.rm(temporary, { force: true, recursive: true })
      }
      return this.open(input.executionBindingDigest)
    } catch (error) {
      await fs.rm(temporary, { force: true, recursive: true }).catch(() => undefined)
      throw error
    }
  }

  async open(executionBindingDigest: string) {
    if (!digestPattern.test(executionBindingDigest)) {
      throw new Error("Pinned generation recovery execution binding is invalid")
    }
    const root = await fs.realpath(this.rootPath)
    const directory = path.join(root, executionBindingDigest)
    const directoryStat = await fs.lstat(directory)
    if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) {
      throw new Error("Pinned generation recovery runtime directory is invalid")
    }
    const recordPath = path.join(directory, "record.json")
    const executablePath = path.join(directory, "entrypoint")
    const [recordStat, executableStat, bytes] = await Promise.all([
      fs.lstat(recordPath),
      fs.lstat(executablePath),
      fs.readFile(recordPath),
    ])
    if (
      recordStat.isSymbolicLink() ||
      !recordStat.isFile() ||
      executableStat.isSymbolicLink() ||
      !executableStat.isFile() ||
      bytes.byteLength < 1 ||
      bytes.byteLength > maximumRecordBytes
    ) {
      throw new Error("Pinned generation recovery runtime files are invalid")
    }
    const record = parseRecord(JSON.parse(bytes.toString("utf8")) as unknown, executablePath)
    if (record.executionBindingDigest !== executionBindingDigest) {
      throw new Error("Pinned generation recovery runtime identity changed")
    }
    const executable = await hashFile(executablePath, this.#maxExecutableBytes)
    if (
      executable.sha256 !== record.sourceBinding.sha256 ||
      executable.size !== record.sourceBinding.size ||
      record.executableRuntime !== record.sourceBinding.runtime
    ) {
      throw new Error("Pinned generation recovery executable changed")
    }
    return record
  }

  async remove(executionBindingDigest: string) {
    if (!digestPattern.test(executionBindingDigest)) {
      throw new Error("Pinned generation recovery execution binding is invalid")
    }
    const root = await ensurePrivateDirectory(this.rootPath, "Generation recovery runtime root")
    await fs.rm(path.join(root, executionBindingDigest), { force: true, recursive: true })
  }
}
