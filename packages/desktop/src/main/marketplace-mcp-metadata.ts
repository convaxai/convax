import { randomUUID } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"

import {
  canonicalJson,
  identityKeyForMcpServer,
  parseMcpServerExtension,
  parseServerPackage,
  sha256Hex,
  versionKeyForMcpServer,
  type McpServerExtension,
  type SourceKey,
  type SourceQualifiedItem,
} from "@convax/marketplace"

import { readBoundedAuthorityFile } from "./bounded-authority-file"
import {
  createManagedMcpLaunchTemplateFromVerifiedExtension,
  type ManagedMcpExecutableBinding,
  type ManagedMcpRuntimeManager,
} from "./managed-mcp-runtime-manager"

interface HttpMetadata {
  endpoint: string
  mode: "http"
  serverJson: Record<string, unknown>
  serverJsonSha256: string
  transport: "sse" | "streamable-http"
}

interface ManagedMetadata {
  executable: ManagedMcpExecutableBinding | null
  extension: McpServerExtension
  extensionSha256: string
  mode: "managed-stdio"
  runtimeTarget: string
  serverJson: Record<string, unknown>
  serverJsonSha256: string
}

export interface MarketplaceMcpRecord {
  id: string
  metadata: HttpMetadata | ManagedMetadata
  revision: number
  sourceKey: SourceKey
  version: string
}

export function marketplaceMcpServerKey(id: string) {
  return `mcp_${identityKeyForMcpServer(id)}`
}

interface MetadataState {
  records: MarketplaceMcpRecord[]
  revision: number
  schema: "convax.mcp-marketplace-metadata/1"
}

const maxStateBytes = 8 * 1024 * 1024
const maxRecords = 1_024
const digestPattern = /^[a-f0-9]{64}$/u

function emptyState(): MetadataState {
  return { records: [], revision: 0, schema: "convax.mcp-marketplace-metadata/1" }
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  const actual = Object.keys(value).sort()
  const sortedExpected = [...expected].sort()
  return actual.length === sortedExpected.length && actual.every((entry, index) => entry === sortedExpected[index])
}

function isContained(root: string, candidate: string) {
  const relative = path.relative(root, candidate)
  return relative !== "" && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative)
}

function parseState(value: unknown, companionRoot: string): MetadataState {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("MCP metadata state is invalid")
  const input = value as Record<string, unknown>
  if (
    Object.keys(input).sort().join("\0") !== ["records", "revision", "schema"].sort().join("\0") ||
    input.schema !== "convax.mcp-marketplace-metadata/1" ||
    !Number.isSafeInteger(input.revision) ||
    Number(input.revision) < 0 ||
    !Array.isArray(input.records) ||
    input.records.length > maxRecords
  ) {
    throw new Error("MCP metadata state is invalid")
  }
  const identities = new Set<string>()
  for (const value of input.records) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("MCP metadata record is invalid")
    const record = value as Record<string, unknown>
    if (
      Object.keys(record).sort().join("\0") !==
        ["id", "metadata", "revision", "sourceKey", "version"].sort().join("\0") ||
      typeof record.id !== "string" ||
      record.id.length < 1 ||
      record.id.length > 200 ||
      identities.has(record.id) ||
      !Number.isSafeInteger(record.revision) ||
      Number(record.revision) < 1 ||
      typeof record.sourceKey !== "string" ||
      !digestPattern.test(record.sourceKey) ||
      typeof record.version !== "string" ||
      record.version.length < 1 ||
      record.version.length > 255 ||
      !record.metadata ||
      typeof record.metadata !== "object" ||
      Array.isArray(record.metadata)
    ) {
      throw new Error("MCP metadata record is invalid")
    }
    identities.add(record.id)
    const metadata = record.metadata as Record<string, unknown>
    const serverJson = metadata.serverJson
    const serverJsonSha256 = metadata.serverJsonSha256
    if (
      typeof serverJsonSha256 !== "string" ||
      !digestPattern.test(serverJsonSha256) ||
      sha256Hex(`${canonicalJson(serverJson)}\n`) !== serverJsonSha256
    )
      throw new Error("MCP metadata server definition digest is invalid")
    if (metadata.mode === "http") {
      if (
        !exactKeys(metadata, ["endpoint", "mode", "serverJson", "serverJsonSha256", "transport"]) ||
        typeof metadata.endpoint !== "string" ||
        (metadata.transport !== "sse" && metadata.transport !== "streamable-http")
      )
        throw new Error("HTTP MCP metadata is invalid")
      const parsed = parseServerPackage(serverJson)
      if (
        parsed.id !== record.id ||
        parsed.version !== record.version ||
        parsed.runtime.kind !== "http-agent" ||
        parsed.runtime.endpoint !== metadata.endpoint ||
        parsed.runtime.transport !== metadata.transport
      )
        throw new Error("HTTP MCP metadata does not close its server definition")
    } else if (metadata.mode === "managed-stdio") {
      if (
        !exactKeys(metadata, [
          "executable",
          "extension",
          "extensionSha256",
          "mode",
          "runtimeTarget",
          "serverJson",
          "serverJsonSha256",
        ]) ||
        typeof metadata.extensionSha256 !== "string" ||
        !digestPattern.test(metadata.extensionSha256) ||
        sha256Hex(`${canonicalJson(metadata.extension)}\n`) !== metadata.extensionSha256 ||
        typeof metadata.runtimeTarget !== "string" ||
        !/^(darwin|linux|win32)-(arm64|x64)$/u.test(metadata.runtimeTarget) ||
        (metadata.executable !== null &&
          (typeof metadata.executable !== "object" || Array.isArray(metadata.executable)))
      )
        throw new Error("Managed MCP metadata is invalid")
      const extension = parseMcpServerExtension(metadata.extension)
      const parsed = parseServerPackage(serverJson, extension)
      const executable = metadata.executable as Record<string, unknown> | null
      const expectedPath = path.join(
        companionRoot,
        identityKeyForMcpServer(record.id),
        versionKeyForMcpServer(record.id, record.version),
        extension.runtime.command,
      )
      if (
        parsed.id !== record.id ||
        parsed.version !== record.version ||
        parsed.runtime.kind !== "managed-stdio" ||
        !extension.runtime.compatibility.targets.includes(metadata.runtimeTarget) ||
        !isContained(companionRoot, expectedPath) ||
        (executable !== null &&
          (!exactKeys(executable, ["path", "sha256", "size"]) ||
            typeof executable.path !== "string" ||
            path.resolve(executable.path) !== expectedPath ||
            typeof executable.sha256 !== "string" ||
            !digestPattern.test(executable.sha256) ||
            !Number.isSafeInteger(executable.size) ||
            Number(executable.size) < 1 ||
            Number(executable.size) > 128 * 1024 * 1024))
      )
        throw new Error("Managed MCP executable binding is invalid")
    } else {
      throw new Error("MCP metadata runtime is invalid")
    }
  }
  return structuredClone(input) as unknown as MetadataState
}

async function atomicWrite(file: string, state: MetadataState) {
  const bytes = `${canonicalJson(state)}\n`
  if (Buffer.byteLength(bytes) > maxStateBytes) throw new Error("MCP metadata state exceeds its byte limit")
  const directory = path.dirname(file)
  await fs.mkdir(directory, { mode: 0o700, recursive: true })
  const temporary = path.join(directory, `.${path.basename(file)}.${randomUUID()}.tmp`)
  const handle = await fs.open(temporary, "wx", 0o600)
  try {
    await handle.writeFile(bytes)
    await handle.sync()
  } finally {
    await handle.close()
  }
  await fs.rename(temporary, file)
  const parent = await fs.open(directory, "r")
  try {
    await parent.sync()
  } finally {
    await parent.close()
  }
}

export class MarketplaceMcpMetadataStore {
  readonly #candidateFile: string
  readonly #companionRoot: string
  readonly #file: string
  readonly #runtimes: ManagedMcpRuntimeManager
  readonly #refreshAgentConfiguration: () => Promise<void>
  #tail = Promise.resolve()

  constructor(options: {
    companionRoot: string
    file: string
    refreshAgentConfiguration(): Promise<void>
    runtimes: ManagedMcpRuntimeManager
  }) {
    this.#companionRoot = path.resolve(options.companionRoot)
    this.#file = path.resolve(options.file)
    this.#candidateFile = `${this.#file}.candidate-v1`
    this.#refreshAgentConfiguration = options.refreshAgentConfiguration
    this.#runtimes = options.runtimes
  }

  async read() {
    try {
      return parseState(
        JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(
            await readBoundedAuthorityFile(this.#file, maxStateBytes, "MCP metadata state"),
          ),
        ),
        this.#companionRoot,
      )
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return emptyState()
      throw error
    }
  }

  install(
    item: SourceQualifiedItem,
    companion?: { bytes: Uint8Array; sha256: string; size: number },
  ): Promise<MarketplaceMcpRecord> {
    return this.#serialize(async () => {
      const state = await this.read()
      const previous = state.records.find((record) => record.id === item.id)
      if (previous && previous.sourceKey !== item.sourceKey) throw new Error("Installed MCP source cannot change")
      const record = await this.#createRecord(item, companion, previous)
      state.records = [...state.records.filter((entry) => entry.id !== item.id), record]
      state.revision += 1
      await atomicWrite(this.#file, state)
      return structuredClone(record)
    })
  }

  prepareCandidate(
    item: SourceQualifiedItem,
    companion?: { bytes: Uint8Array; sha256: string; size: number },
  ): Promise<MarketplaceMcpRecord> {
    return this.#serialize(async () => {
      const state = await this.read()
      const previous = state.records.find((record) => record.id === item.id)
      if (!previous || previous.sourceKey !== item.sourceKey) {
        throw new Error("Managed MCP update candidate has no exact current source")
      }
      try {
        await fs.lstat(this.#candidateFile)
        throw new Error("MCP metadata candidate recovery is required")
      } catch (error) {
        if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
          throw error
        }
      }
      const record = await this.#createRecord(item, companion, previous)
      await atomicWrite(this.#candidateFile, {
        records: [record],
        revision: 1,
        schema: "convax.mcp-marketplace-metadata/1",
      })
      return structuredClone(record)
    })
  }

  async commitCandidate(id: string) {
    return this.#serialize(async () => {
      const candidateState = parseState(
        JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(
            await readBoundedAuthorityFile(this.#candidateFile, maxStateBytes, "MCP metadata candidate"),
          ),
        ),
        this.#companionRoot,
      )
      const candidate = candidateState.records.find((record) => record.id === id)
      if (!candidate || candidateState.records.length !== 1) {
        throw new Error("MCP metadata candidate is unavailable")
      }
      const state = await this.read()
      const current = state.records.find((record) => record.id === id)
      if (!current || current.sourceKey !== candidate.sourceKey || candidate.revision !== current.revision + 1) {
        throw new Error("MCP metadata candidate is stale")
      }
      state.records = [...state.records.filter((record) => record.id !== id), candidate]
      state.revision += 1
      await atomicWrite(this.#file, state)
      await fs.rm(this.#candidateFile, { force: true })
      return structuredClone(candidate)
    })
  }

  async discardCandidate(id: string) {
    return this.#serialize(async () => {
      try {
        const bytes = await readBoundedAuthorityFile(this.#candidateFile, maxStateBytes, "MCP metadata candidate")
        const state = parseState(
          JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
          this.#companionRoot,
        )
        if (state.records.length !== 1 || state.records[0]?.id !== id) {
          throw new Error("MCP metadata candidate identity changed")
        }
        await fs.rm(this.#candidateFile, { force: true })
      } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return
        throw error
      }
    })
  }

  async #createRecord(
    item: SourceQualifiedItem,
    companion: { bytes: Uint8Array; sha256: string; size: number } | undefined,
    previous: MarketplaceMcpRecord | undefined,
  ): Promise<MarketplaceMcpRecord> {
    if (item.kind !== "mcp-server") throw new Error("MCP metadata requires an MCP Server item")
    let metadata: MarketplaceMcpRecord["metadata"]
    if (item.delivery.kind === "mcp-http") {
      metadata = {
        endpoint: item.delivery.runtime.endpoint,
        mode: "http",
        serverJson: structuredClone(item.delivery.serverJson),
        serverJsonSha256: item.delivery.serverJsonSha256,
        transport: item.delivery.runtime.transport,
      }
    } else if (item.delivery.kind === "mcp-managed-stdio") {
      const target = `${process.platform}-${process.arch}`
      const expected = item.delivery.companions.find((entry) => entry.target === target)
      if (!item.delivery.extension.runtime.compatibility.targets.includes(target)) {
        throw new Error("Managed MCP extension does not support this runtime target")
      }
      if (
        (expected !== undefined &&
          (!companion ||
            companion.size !== expected.size ||
            companion.sha256 !== expected.sha256 ||
            companion.bytes.byteLength !== expected.size ||
            sha256Hex(companion.bytes) !== expected.sha256)) ||
        (expected === undefined && companion !== undefined)
      ) {
        throw new Error("Managed MCP companion does not match its verified target")
      }
      const directory = path.join(
        this.#companionRoot,
        identityKeyForMcpServer(item.id),
        versionKeyForMcpServer(item.id, item.version),
      )
      await fs.mkdir(directory, { mode: 0o700, recursive: true })
      const executablePath = path.join(directory, item.delivery.extension.runtime.command)
      if (expected && companion) {
        await publishImmutableExecutable(executablePath, companion.bytes, expected.sha256)
      }
      metadata = {
        executable: expected ? { path: executablePath, sha256: expected.sha256, size: expected.size } : null,
        extension: structuredClone(item.delivery.extension),
        extensionSha256: item.delivery.extensionSha256,
        mode: "managed-stdio",
        runtimeTarget: target,
        serverJson: structuredClone(item.delivery.serverJson),
        serverJsonSha256: item.delivery.serverJsonSha256,
      }
    } else {
      throw new Error("MCP Server delivery is invalid")
    }
    return {
      id: item.id,
      metadata,
      revision: (previous?.revision ?? 0) + 1,
      sourceKey: item.sourceKey,
      version: item.version,
    }
  }

  async setup(record: MarketplaceMcpRecord, pickAddTarget?: () => Promise<string | null>) {
    if (record.metadata.mode === "http") {
      return { authorizationContractDigest: httpAuthorizationContractDigest(record) }
    }
    let effective = record
    if (record.metadata.executable === null) {
      const selected = await pickAddTarget?.()
      if (!selected) return null
      const selectedPath = path.resolve(selected)
      if (path.basename(selectedPath) !== record.metadata.extension.runtime.command) {
        throw new Error("Selected managed MCP target does not match the declared command")
      }
      const metadata = await fs.lstat(selectedPath)
      if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1 || (metadata.mode & 0o111) === 0) {
        throw new Error("Selected managed MCP target is not one executable regular file")
      }
      const bytes = await readBoundedAuthorityFile(selectedPath, 128 * 1024 * 1024, "Selected managed MCP target")
      const executable = {
        path: path.join(
          this.#companionRoot,
          identityKeyForMcpServer(record.id),
          versionKeyForMcpServer(record.id, record.version),
          record.metadata.extension.runtime.command,
        ),
        sha256: sha256Hex(bytes),
        size: bytes.byteLength,
      }
      await fs.mkdir(path.dirname(executable.path), { mode: 0o700, recursive: true })
      await publishImmutableExecutable(executable.path, bytes, executable.sha256)
      const state = await this.read()
      const nextRecord: MarketplaceMcpRecord = {
        ...record,
        metadata: { ...record.metadata, executable },
        revision: record.revision + 1,
      }
      state.records = [...state.records.filter((entry) => entry.id !== record.id), nextRecord]
      state.revision += 1
      await atomicWrite(this.#file, state)
      effective = nextRecord
    }
    if (effective.metadata.mode !== "managed-stdio") throw new Error("Managed MCP metadata is unavailable")
    const managedMetadata = effective.metadata
    const executable = managedMetadata.executable
    if (!executable) throw new Error("Managed MCP executable binding is unavailable")
    const authorizationContractDigest = managedAuthorizationContractDigest(effective)
    return { authorizationContractDigest }
  }

  async activate(record: MarketplaceMcpRecord, authorizationContractDigest: string) {
    if (!(await this.verifyAuthorization(record, authorizationContractDigest))) {
      throw new Error("MCP authorization is no longer valid")
    }
    if (record.metadata.mode === "http") return
    const executable = record.metadata.executable
    if (!executable) throw new Error("Managed MCP executable binding is unavailable")
    await this.#runtimes.publish({
      authorizationContractDigest,
      enabled: true,
      executable,
      grants: record.metadata.extension.grants ?? [],
      launch: createManagedMcpLaunchTemplateFromVerifiedExtension({
        args: record.metadata.extension.runtime.argv,
        command: record.metadata.extension.runtime.command,
      }),
      principalRevision: record.revision,
      productActions: record.metadata.extension.productActions ?? [],
      serverKey: marketplaceMcpServerKey(record.id),
    })
  }

  async uninstall(id: string) {
    return this.#serialize(async () => {
      const state = await this.read()
      const current = state.records.find((record) => record.id === id)
      if (!current) return
      if (current.metadata.mode === "managed-stdio") {
        await this.#runtimes.disable(marketplaceMcpServerKey(id))
        await fs.rm(
          path.join(
            this.#companionRoot,
            identityKeyForMcpServer(current.id),
            versionKeyForMcpServer(current.id, current.version),
          ),
          { force: true, recursive: true },
        )
      }
      state.records = state.records.filter((record) => record.id !== id)
      state.revision += 1
      await atomicWrite(this.#file, state)
    })
  }

  async disableRuntime(id: string) {
    const record = (await this.read()).records.find((entry) => entry.id === id)
    if (record?.metadata.mode === "managed-stdio") {
      await this.#runtimes.disable(marketplaceMcpServerKey(id))
    }
  }

  hardRefresh() {
    return this.#refreshAgentConfiguration()
  }

  async verifyAuthorization(record: MarketplaceMcpRecord, expectedDigest: string) {
    if (record.metadata.mode === "http") {
      return httpAuthorizationContractDigest(record) === expectedDigest
    }
    if (!record.metadata.executable) return false
    const bytes = await readBoundedAuthorityFile(
      record.metadata.executable.path,
      record.metadata.executable.size,
      "Managed MCP companion",
    )
    return (
      bytes.byteLength === record.metadata.executable.size &&
      sha256Hex(bytes) === record.metadata.executable.sha256 &&
      managedAuthorizationContractDigest(record) === expectedDigest
    )
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

function managedAuthorizationContractDigest(record: MarketplaceMcpRecord) {
  if (record.metadata.mode !== "managed-stdio" || !record.metadata.executable) {
    throw new Error("Managed MCP executable binding is unavailable")
  }
  return sha256Hex(
    canonicalJson({
      executable: {
        sha256: record.metadata.executable.sha256,
        size: record.metadata.executable.size,
      },
      extensionOrNone: record.metadata.extensionSha256,
      grants: record.metadata.extension.grants ?? [],
      productActions: record.metadata.extension.productActions ?? [],
      runtimeTarget: record.metadata.runtimeTarget,
      serverDefinitionDigest: record.metadata.serverJsonSha256,
      sourceKey: record.sourceKey,
    }),
  )
}

function httpAuthorizationContractDigest(record: MarketplaceMcpRecord) {
  if (record.metadata.mode !== "http") throw new Error("HTTP MCP metadata is unavailable")
  return sha256Hex(
    canonicalJson({
      endpoint: record.metadata.endpoint,
      outboundPolicy: "socket-gate-required",
      serverDefinitionDigest: record.metadata.serverJsonSha256,
      sourceKey: record.sourceKey,
      transport: record.metadata.transport,
      version: record.version,
    }),
  )
}

export class MarketplaceMcpPostCommitError extends Error {
  readonly committedRecord: MarketplaceMcpRecord
  override readonly name = "MarketplaceMcpPostCommitError"

  constructor(record: MarketplaceMcpRecord, cause: unknown) {
    super("MCP metadata committed, but the Agent hard refresh failed", { cause })
    this.committedRecord = structuredClone(record)
  }
}

async function publishImmutableExecutable(file: string, bytes: Uint8Array, expectedSha256: string) {
  try {
    const existing = await readBoundedAuthorityFile(file, 128 * 1024 * 1024, "Managed MCP companion")
    if (existing.byteLength !== bytes.byteLength || sha256Hex(existing) !== expectedSha256) {
      throw new Error("Managed MCP companion immutable identity already contains different bytes")
    }
    return
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error
  }
  const directory = path.dirname(file)
  const temporary = path.join(directory, `.${path.basename(file)}.${randomUUID()}.tmp`)
  const handle = await fs.open(temporary, "wx", 0o700)
  try {
    await handle.writeFile(bytes)
    await handle.sync()
  } finally {
    await handle.close()
  }
  try {
    await fs.link(temporary, file)
    await fs.unlink(temporary)
    const parent = await fs.open(directory, "r")
    try {
      await parent.sync()
    } finally {
      await parent.close()
    }
  } catch (error) {
    await fs.rm(temporary, { force: true })
    if (!(error && typeof error === "object" && "code" in error && error.code === "EEXIST")) throw error
  }
  const published = await readBoundedAuthorityFile(file, bytes.byteLength, "Managed MCP companion")
  if (published.byteLength !== bytes.byteLength || sha256Hex(published) !== expectedSha256) {
    throw new Error("Managed MCP companion publication failed its immutable identity")
  }
}
