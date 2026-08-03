import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { parseWebPluginManifest } from "../plugin-contracts"
import { PluginInstallationClosureStore } from "./plugin-installation-closure-store"
import { planPluginCapabilityTopology } from "./plugin-capability-binding-plan"
import { PluginInstallationSnapshotStore, pluginSnapshotCanonicalDigest } from "./plugin-installation-snapshots"
import { openDesktopPluginRuntimeSession, pluginRuntimeUnavailableMessage } from "./plugin-runtime-startup"

function runtime(readActive: () => Promise<unknown>) {
  return { readActive } as never
}

function sha256(value: string | Uint8Array) {
  return createHash("sha256").update(value).digest("hex")
}

async function fileDigests(files: readonly string[]) {
  return Object.fromEntries(
    await Promise.all(files.map(async (file) => [file, sha256(await fs.readFile(file))] as const)),
  )
}

test("keeps a valid persisted Plugin runtime available without creating quarantine state", async () => {
  let temporaryDirectories = 0
  const persistent = runtime(async () => ({ plugins: [], revision: 0 }))
  const session = await openDesktopPluginRuntimeSession("/persisted", {
    createRuntime: () => persistent,
    async createTemporaryDirectory() {
      temporaryDirectories += 1
      return "/temporary"
    },
  })

  expect(session.state).toEqual({ state: "ready" })
  expect(session.installations).toBe(persistent)
  expect(session.updateInstallations).toBe(persistent)
  expect(session.dataDirectory).toBe("/persisted")
  expect(() => session.assertMutable()).not.toThrow()
  await session.dispose()
  expect(temporaryDirectories).toBe(0)
})

test("quarantines the complete Plugin session after persisted ActiveSet validation fails", async () => {
  const failure = new Error("private closure path and manifest details")
  failure.name = "PluginInstallationRuntimeError"
  const persistent = runtime(async () => {
    throw failure
  })
  const quarantined = runtime(async () => ({ plugins: [], revision: 0 }))
  const roots: string[] = []
  const removed: string[] = []
  const session = await openDesktopPluginRuntimeSession("/persisted", {
    createRuntime(root) {
      roots.push(root)
      return roots.length === 1 ? persistent : quarantined
    },
    async createTemporaryDirectory() {
      return "/temporary"
    },
    async removeTemporaryDirectory(root) {
      removed.push(root)
    },
  })

  expect(roots).toEqual([
    path.join("/persisted", "plugin-installations"),
    path.join("/temporary", "plugin-installations"),
  ])
  expect(session.state).toEqual({ errorType: "PluginInstallationRuntimeError", state: "quarantined" })
  expect(session.installations).toBe(quarantined)
  expect(session.updateInstallations).toBe(quarantined)
  expect(session.dataDirectory).toBe("/temporary")
  expect(() => session.assertMutable()).toThrow(pluginRuntimeUnavailableMessage)
  await session.dispose()
  await session.dispose()
  expect(removed).toEqual(["/temporary"])
})

test("does not expose a quarantine runtime that cannot validate its own empty state", async () => {
  const persistent = runtime(async () => {
    throw new Error("persisted runtime failed")
  })
  const quarantineFailure = new Error("quarantine runtime failed")
  const quarantined = runtime(async () => {
    throw quarantineFailure
  })
  let calls = 0
  const removed: string[] = []

  await expect(
    openDesktopPluginRuntimeSession("/persisted", {
      createRuntime() {
        calls += 1
        return calls === 1 ? persistent : quarantined
      },
      async createTemporaryDirectory() {
        return "/temporary"
      },
      async removeTemporaryDirectory(root) {
        removed.push(root)
      },
    }),
  ).rejects.toBe(quarantineFailure)
  expect(removed).toEqual(["/temporary"])
})

test("quarantining a real legacy ActiveSet leaves its pointer, descriptors, and closure bytes unchanged", async () => {
  const userDataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "convax-plugin-runtime-startup-"))
  const installationRoot = path.join(userDataDirectory, "plugin-installations")
  const snapshotStore = new PluginInstallationSnapshotStore(path.join(installationRoot, "state"))
  const closureStore = new PluginInstallationClosureStore(path.join(installationRoot, "closures"))
  const legacyManifestValue = {
    capabilities: [],
    contributes: { canvas: { renderer: { create: true } } },
    description: "Legacy Plugin persisted before the Host API v2 cutover",
    entry: "index.html",
    hostApi: { major: 1, optional: [], required: ["host.context.get"] },
    id: "legacy",
    name: "Legacy",
    schema: "convax.plugin/8",
    version: "1.0.0",
  }
  const legacyManifest = JSON.stringify(legacyManifestValue)
  const currentProjection = parseWebPluginManifest({
    ...legacyManifestValue,
    hostApi: { ...legacyManifestValue.hostApi, major: 3 },
  })
  const packageFiles = [
    { bytes: Buffer.from("<h1>legacy</h1>"), path: "index.html" },
    { bytes: Buffer.from(legacyManifest), path: "manifest.json" },
  ]
  const fileIdentities = packageFiles.map((file) => ({
    path: file.path,
    sha256: sha256(file.bytes),
    size: file.bytes.byteLength,
  }))
  const manifestIdentity = fileIdentities.find((file) => file.path === "manifest.json")
  if (!manifestIdentity) throw new Error("Expected a legacy manifest identity")
  const { path: _manifestPath, ...manifestBytes } = manifestIdentity
  let session: Awaited<ReturnType<typeof openDesktopPluginRuntimeSession>> | undefined

  try {
    const snapshot = await snapshotStore.putInstalledSnapshot({
      authorizations: {
        capabilityContractDigest: pluginSnapshotCanonicalDigest({
          ...currentProjection,
          hostApi: { ...currentProjection.hostApi, major: 1 },
        }),
      },
      ownedSkills: [],
      package: {
        artifact: { sha256: sha256("legacy archive"), size: 2_048 },
        files: fileIdentities,
        manifest: manifestBytes,
      },
      pluginId: "legacy",
      sourceIdentity: sha256("legacy source"),
      version: "1.0.0",
    })
    await closureStore.ensureLayout()
    await closureStore.publish(snapshot, packageFiles, undefined)
    const topology = planPluginCapabilityTopology([])
    if (!topology.ok) throw new Error("Expected an empty Plugin capability topology")
    const published = await snapshotStore.compareAndSwapActiveSet(0, {
      capabilityTopology: topology.topology,
      plugins: [{ pluginId: "legacy", snapshotDigest: snapshot.digest }],
    })
    if (!published.activeSet) throw new Error("Expected a published legacy ActiveSet")

    const authorityFiles = [
      path.join(installationRoot, "state", "active-pointer.json"),
      path.join(installationRoot, "state", "active-sets", `${published.activeSet.digest}.json`),
      path.join(installationRoot, "state", "installed", `${snapshot.digest}.json`),
      path.join(installationRoot, "closures", snapshot.digest, "package", "manifest.json"),
      path.join(installationRoot, "closures", snapshot.digest, "package", "index.html"),
    ]
    const before = await fileDigests(authorityFiles)

    session = await openDesktopPluginRuntimeSession(userDataDirectory)
    if (!session) throw new Error("Expected a quarantined Plugin runtime session")
    const activeSession = session

    expect(activeSession.state).toEqual({
      errorType: "PluginInstallationRuntimeError",
      retiredHostApiRecovery: {
        plugins: [
          {
            artifact: { sha256: sha256("legacy archive"), size: 2_048 },
            pluginId: "legacy",
            snapshotDigest: snapshot.digest,
            sourceIdentity: sha256("legacy source"),
            version: "1.0.0",
          },
        ],
        revision: 1,
      },
      state: "quarantined",
    })
    expect(activeSession.dataDirectory).not.toBe(userDataDirectory)
    expect(() =>
      activeSession.assertUpdateMutable({
        pluginId: "legacy",
        sourceIdentity: sha256("legacy source"),
      }),
    ).not.toThrow()
    expect(() =>
      activeSession.assertUpdateMutable({
        pluginId: "other",
        sourceIdentity: sha256("other source"),
      }),
    ).toThrow(pluginRuntimeUnavailableMessage)
    await expect(activeSession.updateInstallations.readActive()).rejects.toThrow("Immutable Plugin manifest is invalid")
    expect(await fileDigests(authorityFiles)).toEqual(before)
  } finally {
    await session?.dispose()
    await fs.rm(userDataDirectory, { force: true, recursive: true })
  }
})
