import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import type { GenerationToolSummary } from "../generation-contracts"
import type { InstalledWebPluginSummary } from "../plugin-contracts"
import { GenerationRecoveryRuntimeStore } from "./generation-recovery-runtime-store"
import {
  toolPluginAuthorizationIdentity,
  toolPluginManifestSha256,
  type ToolPluginExecutableBinding,
} from "./tool-plugin-authorizations"

const plugin: InstalledWebPluginSummary = {
  capabilities: [],
  contributes: {
    generation: {
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
  id: "recovery-test",
  name: "Recovery Test",
  runtime: { args: ["serve", "--stdio"], command: "recovery-test", type: "mcp-stdio" },
  schema: "convax.plugin/7",
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

async function fixture(root: string, binding = "binding-one") {
  const executablePath = path.join(root, "sidecar")
  const bytes = Buffer.from("#!/bin/sh\nexit 0\n")
  await fs.writeFile(executablePath, bytes, { mode: 0o700 })
  const sourceBinding: ToolPluginExecutableBinding = {
    path: executablePath,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    size: bytes.byteLength,
  }
  const pluginPackageDigest = toolPluginManifestSha256(plugin)
  const authorizationIdentity = toolPluginAuthorizationIdentity(plugin, "path", sourceBinding)
  const runtimeAuthorizationDigest = createHash("sha256").update(authorizationIdentity).digest("hex")
  const recoveryBindingDigest = createHash("sha256").update(binding).digest("hex")
  const executionBindingDigest = createHash("sha256")
    .update(JSON.stringify([pluginPackageDigest, runtimeAuthorizationDigest, recoveryBindingDigest]))
    .digest("hex")
  return {
    bindingKind: "path" as const,
    executablePath,
    executionBindingDigest,
    plugin,
    pluginPackageDigest,
    recoveryBindingDigest,
    runtimeAuthorizationDigest,
    sourceBinding,
    tool,
  }
}

describe("GenerationRecoveryRuntimeStore", () => {
  test("pins exact authorized bytes and reopens them after the installed source changes", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "convax-recovery-runtime-test-"))
    try {
      const input = await fixture(directory)
      const store = new GenerationRecoveryRuntimeStore(path.join(directory, "store", "runtime-v1"))
      const pinned = await store.pin(input)
      await fs.writeFile(input.executablePath, "#!/bin/sh\nexit 9\n", { mode: 0o700 })
      const reopened = await store.open(input.executionBindingDigest)
      expect(reopened).toMatchObject({
        executionBindingDigest: input.executionBindingDigest,
        pluginPackageDigest: input.pluginPackageDigest,
        recoveryBindingDigest: input.recoveryBindingDigest,
        runtimeAuthorizationDigest: input.runtimeAuthorizationDigest,
        tool,
      })
      expect(reopened.executablePath).toBe(pinned.executablePath)
      expect(await fs.readFile(reopened.executablePath, "utf8")).toBe("#!/bin/sh\nexit 0\n")
      expect((await fs.stat(path.dirname(reopened.executablePath))).mode & 0o777).toBe(0o700)
      expect((await fs.stat(reopened.executablePath)).mode & 0o777).toBe(0o500)
      await store.remove(input.executionBindingDigest)
      await expect(store.open(input.executionBindingDigest)).rejects.toThrow()
    } finally {
      await fs.rm(directory, { force: true, recursive: true })
    }
  })

  test("fails closed when a pinned executable or binding record is tampered", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "convax-recovery-runtime-tamper-test-"))
    try {
      const input = await fixture(directory)
      const store = new GenerationRecoveryRuntimeStore(path.join(directory, "store", "runtime-v1"))
      const pinned = await store.pin(input)
      await fs.chmod(pinned.executablePath, 0o600)
      await fs.writeFile(pinned.executablePath, "#!/bin/sh\nexit 7\n")
      await expect(store.open(input.executionBindingDigest)).rejects.toThrow("executable changed")
    } finally {
      await fs.rm(directory, { force: true, recursive: true })
    }
  })

  test("bounds pinned runtime count and executable bytes", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "convax-recovery-runtime-bounds-test-"))
    try {
      const root = path.join(directory, "store", "runtime-v1")
      const store = new GenerationRecoveryRuntimeStore(root, { maxExecutableBytes: 64, maxRecords: 1 })
      await store.pin(await fixture(directory, "binding-one"))
      await expect(store.pin(await fixture(directory, "binding-two"))).rejects.toThrow("record limit")
      const tooSmall = new GenerationRecoveryRuntimeStore(path.join(directory, "small"), {
        maxExecutableBytes: 4,
      })
      await expect(tooSmall.pin(await fixture(directory, "binding-three"))).rejects.toThrow("executable is invalid")
    } finally {
      await fs.rm(directory, { force: true, recursive: true })
    }
  })
})
