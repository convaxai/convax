import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import type { GenerationToolSummary } from "../generation-contracts"
import type { InstalledWebPluginSummary } from "../plugin-contracts"
import {
  GenerationRecoveryRuntimeStore,
  generationRecoveryExecutionBindingDigest,
  generationRecoveryOwnerKey,
  type GenerationRecoveryExecutableBinding,
} from "./generation-recovery-runtime-store"
import { pluginSnapshotCanonicalDigest } from "./plugin-installation-snapshots"

const plugin: InstalledWebPluginSummary = {
  capabilities: [],
  contributes: {
    generation: {
      models: [{ name: "Recovery Test", tool: "generate.image" }],
      tools: [
        {
          acceptedInputs: ["text"],
          description: "Generate an image",
          id: "generate.image",
          output: "image",
          recovery: {
            mode: "long-running-operation",
            schema: "convax.generation-lro/1",
          },
          title: "Generate",
        },
      ],
    },
  },
  description: "Recovery test Plugin",
  hostApi: { major: 3, optional: [], required: [] },
  id: "recovery-test",
  name: "Recovery Test",
  runtime: { args: ["serve", "--stdio"], command: "recovery-test", type: "mcp-stdio" },
  schema: "convax.plugin/8",
  version: "1.0.0",
}

const tool: GenerationToolSummary = {
  acceptedInputs: ["text"],
  description: "Generate an image",
  id: "recovery-test/generate.image",
  kind: "model",
  pluginId: "recovery-test",
  pluginName: "Recovery Test",
  output: "image",
  recovery: "long-running-operation",
  title: "Generate",
  toolId: "generate.image",
}

function fixture(binding = "binding-one", toolBindingDigest = createHash("sha256").update("tool-one").digest("hex")) {
  const sourceBinding: GenerationRecoveryExecutableBinding = {
    sha256: createHash("sha256").update("immutable snapshot companion").digest("hex"),
    size: 4_096,
  }
  const pluginIdentity = {
    activeRevision: 7,
    activeSetDigest: createHash("sha256").update("active-set").digest("hex"),
    pluginId: plugin.id,
    snapshotDigest: createHash("sha256").update("installed-snapshot").digest("hex"),
    version: plugin.version,
  }
  const pluginPackageDigest = pluginSnapshotCanonicalDigest(plugin)
  const runtimeAuthorizationDigest = createHash("sha256").update("snapshot-companion-authorization").digest("hex")
  const recoveryBindingDigest = createHash("sha256").update(binding).digest("hex")
  const executionBindingDigest = generationRecoveryExecutionBindingDigest({
    pluginIdentity,
    pluginPackageDigest,
    recoveryBindingDigest,
    runtimeAuthorizationDigest,
    sourceBinding,
    toolBindingDigest,
  })
  return {
    executionBindingDigest,
    plugin,
    pluginIdentity,
    pluginPackageDigest,
    recoveryBindingDigest,
    runtimeAuthorizationDigest,
    sourceBinding,
    tool,
    toolBindingDigest,
  }
}

describe("GenerationRecoveryRuntimeStore", () => {
  test("persists only exact snapshot and Companion identity without a native executable path", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "convax-recovery-runtime-test-"))
    try {
      const input = fixture()
      const store = new GenerationRecoveryRuntimeStore(path.join(directory, "store", "runtime-v3"))
      const pinned = await store.pin(input)
      const reopened = await store.open(input.executionBindingDigest)

      expect(reopened).toEqual(pinned)
      expect(reopened).toMatchObject({
        executionBindingDigest: input.executionBindingDigest,
        pluginIdentity: input.pluginIdentity,
        pluginPackageDigest: input.pluginPackageDigest,
        recoveryBindingDigest: input.recoveryBindingDigest,
        runtimeAuthorizationDigest: input.runtimeAuthorizationDigest,
        sourceBinding: input.sourceBinding,
        toolBindingDigest: input.toolBindingDigest,
      })
      expect(generationRecoveryOwnerKey(input.executionBindingDigest)).toBe(
        `generation-binding:${input.executionBindingDigest}`,
      )
      const recordPath = path.join(directory, "store", "runtime-v3", input.executionBindingDigest, "record.json")
      const serialized = await fs.readFile(recordPath, "utf8")
      expect(serialized).not.toContain("executablePath")
      expect(serialized).not.toContain("entrypoint")
      expect(await fs.readdir(path.dirname(recordPath))).toEqual(["record.json"])

      await store.remove(input.executionBindingDigest)
      await expect(store.open(input.executionBindingDigest)).rejects.toThrow()
    } finally {
      await fs.rm(directory, { force: true, recursive: true })
    }
  })

  test("binds the exact snapshot, Companion bytes, and tool/model selection into the execution digest", () => {
    const input = fixture()
    expect(fixture("binding-two").executionBindingDigest).not.toBe(input.executionBindingDigest)
    expect(
      fixture("binding-one", createHash("sha256").update("tool-two").digest("hex")).executionBindingDigest,
    ).not.toBe(input.executionBindingDigest)
    expect(
      generationRecoveryExecutionBindingDigest({
        ...input,
        pluginIdentity: {
          ...input.pluginIdentity,
          snapshotDigest: createHash("sha256").update("another-snapshot").digest("hex"),
        },
      }),
    ).not.toBe(input.executionBindingDigest)
    expect(
      generationRecoveryExecutionBindingDigest({
        ...input,
        sourceBinding: { ...input.sourceBinding, sha256: "f".repeat(64) },
      }),
    ).not.toBe(input.executionBindingDigest)
  })

  test("persists only the tool binding digest and never a raw runtime selector", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "convax-model-bound-recovery-runtime-test-"))
    try {
      const modelValue = "vendor/alpha:image"
      const toolBindingDigest = createHash("sha256")
        .update(JSON.stringify({ fieldId: "engine", value: modelValue }))
        .digest("hex")
      const input = fixture("binding-model", toolBindingDigest)
      const store = new GenerationRecoveryRuntimeStore(path.join(directory, "store", "runtime-v3"))
      await store.pin(input)
      const serialized = await fs.readFile(
        path.join(directory, "store", "runtime-v3", input.executionBindingDigest, "record.json"),
        "utf8",
      )

      expect(serialized).toContain(toolBindingDigest)
      expect(serialized).not.toContain(modelValue)
    } finally {
      await fs.rm(directory, { force: true, recursive: true })
    }
  })

  test("fails closed when a snapshot identity or binding record is tampered", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "convax-recovery-runtime-tamper-test-"))
    try {
      const input = fixture()
      const root = path.join(directory, "store", "runtime-v3")
      const store = new GenerationRecoveryRuntimeStore(root)
      await store.pin(input)
      const recordPath = path.join(root, input.executionBindingDigest, "record.json")
      const record = JSON.parse(await fs.readFile(recordPath, "utf8")) as Record<string, any>
      record.pluginIdentity.snapshotDigest = "f".repeat(64)
      await fs.chmod(recordPath, 0o600)
      await fs.writeFile(recordPath, `${JSON.stringify(record)}\n`)

      await expect(store.open(input.executionBindingDigest)).rejects.toThrow("execution binding changed")
    } finally {
      await fs.rm(directory, { force: true, recursive: true })
    }
  })

  test("rejects an unsupported recovery schema without rewriting its bytes", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "convax-recovery-runtime-schema-test-"))
    try {
      const input = fixture()
      const root = path.join(directory, "store", "runtime-v3")
      const store = new GenerationRecoveryRuntimeStore(root)
      await store.pin(input)
      const recordPath = path.join(root, input.executionBindingDigest, "record.json")
      const record = JSON.parse(await fs.readFile(recordPath, "utf8")) as Record<string, unknown>
      record.schema = "convax.generation-lro-runtime/2"
      const unsupportedBytes = `${JSON.stringify(record)}\n`
      await fs.chmod(recordPath, 0o600)
      await fs.writeFile(recordPath, unsupportedBytes)

      await expect(store.open(input.executionBindingDigest)).rejects.toThrow("record is invalid")
      expect(await fs.readFile(recordPath, "utf8")).toBe(unsupportedBytes)
    } finally {
      await fs.rm(directory, { force: true, recursive: true })
    }
  })

  test("bounds record count and validates the complete binding before publication", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "convax-recovery-runtime-bounds-test-"))
    try {
      const root = path.join(directory, "store", "runtime-v3")
      const store = new GenerationRecoveryRuntimeStore(root, { maxRecords: 1 })
      await store.pin(fixture("binding-one"))
      await expect(store.pin(fixture("binding-two"))).rejects.toThrow("record limit")

      const invalidRoot = path.join(directory, "invalid", "runtime-v3")
      const invalid = new GenerationRecoveryRuntimeStore(invalidRoot)
      await expect(
        invalid.pin({
          ...fixture("binding-three"),
          runtimeAuthorizationDigest: "not-a-digest",
        }),
      ).rejects.toThrow("authorization digest is invalid")
      await expect(fs.readdir(path.dirname(invalidRoot)).catch(() => [])).resolves.toEqual([])
    } finally {
      await fs.rm(directory, { force: true, recursive: true })
    }
  })

  test("serializes concurrent publications before enforcing the global record bound", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "convax-recovery-runtime-concurrency-test-"))
    try {
      const root = path.join(directory, "store", "runtime-v3")
      const store = new GenerationRecoveryRuntimeStore(root, { maxRecords: 1 })
      const results = await Promise.allSettled([
        store.pin(fixture("concurrent-binding-one")),
        store.pin(fixture("concurrent-binding-two")),
      ])

      expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1)
      expect(results.filter(({ status }) => status === "rejected")).toHaveLength(1)
      expect(await store.list()).toHaveLength(1)
      expect((await fs.readdir(root)).some((entry) => entry.endsWith(".tmp"))).toBe(false)
    } finally {
      await fs.rm(directory, { force: true, recursive: true })
    }
  })

  test("rejects legacy Plugins before writing a recovery record", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "convax-recovery-runtime-legacy-test-"))
    try {
      const input = fixture()
      const store = new GenerationRecoveryRuntimeStore(path.join(directory, "store", "runtime-v3"))
      const legacy = { ...plugin, schema: "convax.plugin/7" } as unknown as InstalledWebPluginSummary
      await expect(store.pin({ ...input, plugin: legacy })).rejects.toThrow()
      await expect(fs.readdir(path.join(directory, "store")).catch(() => [])).resolves.toEqual([])
    } finally {
      await fs.rm(directory, { force: true, recursive: true })
    }
  })

  test("lists records deterministically and cleans incomplete temporary publications", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "convax-recovery-runtime-list-test-"))
    try {
      const root = path.join(directory, "store", "runtime-v3")
      const store = new GenerationRecoveryRuntimeStore(root)
      const first = fixture("binding-one")
      const second = fixture("binding-two")
      await store.pin(second)
      await store.pin(first)
      await fs.mkdir(path.join(root, ".runtime-crash.tmp"))

      expect((await store.list()).map(({ executionBindingDigest }) => executionBindingDigest)).toEqual(
        [first.executionBindingDigest, second.executionBindingDigest].sort(),
      )
      await expect(fs.access(path.join(root, ".runtime-crash.tmp"))).rejects.toThrow()
    } finally {
      await fs.rm(directory, { force: true, recursive: true })
    }
  })
})
