import { afterEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { PluginExecutionSetupRequiredError, PluginInstallationRuntime } from "./plugin-installation-runtime"
import { PluginSnapshotInstaller } from "./plugin-snapshot-installer"

const roots: string[] = []

function digest(value: string | Uint8Array) {
  return createHash("sha256").update(value).digest("hex")
}

function executableManifest(id: string, version = "1.0.0") {
  return {
    capabilities: [],
    contributes: { service: { actions: ["authorize"] } },
    description: "test",
    hostApi: { major: 1, optional: [], required: [] },
    id,
    name: id,
    runtime: { command: `${id}-tool`, type: "mcp-stdio" },
    schema: "convax.plugin/8",
    version,
  }
}

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "convax-plugin-snapshot-installer-"))
  roots.push(root)
  const runtime = new PluginInstallationRuntime(path.join(root, "installations"))
  return { installer: new PluginSnapshotInstaller(runtime), root, runtime }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { force: true, recursive: true })))
})

describe("PluginSnapshotInstaller", () => {
  test("atomically activates exact companion consent with the complete v8 closure", async () => {
    const { installer, runtime } = await fixture()
    const manifest = executableManifest("media-tools")
    const companion = Buffer.from("native companion")
    const plugin = await installer.install({
      artifact: { sha256: digest("archive"), size: 100 },
      authorizeExecution: true,
      companion: { bytes: companion, command: "media-tools-tool", target: "darwin-arm64-v1" },
      files: { "manifest.json": JSON.stringify(manifest) },
      sourceIdentity: digest("official source"),
    })

    expect(plugin.id).toBe("media-tools")
    const active = await runtime.readActive()
    expect(active.revision).toBe(1)
    const handle = await runtime.acquireActivePlugin("media-tools")
    expect(handle.descriptor.authorizations.companionExecutionDigest).toMatch(/^[a-f0-9]{64}$/)
    const executable = await handle.resolveCompanion()
    if (!executable) throw new Error("Expected active companion")
    expect(await fs.readFile(executable)).toEqual(companion)
    handle.release()
  })

  test("keeps verified bytes inert when setup was deferred", async () => {
    const { installer, runtime } = await fixture()
    const manifest = executableManifest("media-tools")
    await installer.install({
      artifact: { sha256: digest("archive"), size: 100 },
      authorizeExecution: false,
      companion: { bytes: Buffer.from("native"), command: "media-tools-tool", target: "linux-x64-v1" },
      files: { "manifest.json": JSON.stringify(manifest) },
      sourceIdentity: digest("network source"),
    })

    const handle = await runtime.acquireActivePlugin("media-tools")
    await expect(handle.resolveCompanion()).rejects.toBeInstanceOf(PluginExecutionSetupRequiredError)
    handle.release()
  })

  test("rejects legacy schemas and executable packages without immutable companions", async () => {
    const { installer } = await fixture()
    const manifest = executableManifest("media-tools")
    await expect(
      installer.install({
        artifact: { sha256: digest("archive"), size: 100 },
        authorizeExecution: true,
        files: { "manifest.json": JSON.stringify(manifest) },
        sourceIdentity: digest("local source"),
      }),
    ).rejects.toThrow("requires a verified immutable companion")
    await expect(
      installer.install({
        artifact: { sha256: digest("legacy"), size: 100 },
        authorizeExecution: false,
        files: { "manifest.json": JSON.stringify({ ...manifest, schema: "convax.plugin/7" }) },
        sourceIdentity: digest("legacy source"),
      }),
    ).rejects.toThrow()
  })
})
