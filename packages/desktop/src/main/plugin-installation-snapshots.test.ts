/* oxlint-disable typescript-eslint/await-thenable -- Bun's async `.rejects` matcher is thenable at runtime. */
import { afterEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { planPluginCapabilityTopology } from "./plugin-capability-binding-plan"
import {
  activePluginPointerSchema,
  activePluginSetSnapshotSchema,
  ActivePluginSetRevisionConflictError,
  legacyActivePluginSetSnapshotSchema,
  PluginInstallationSnapshotStore,
  PluginInstallationSnapshotStoreError,
  pluginSnapshotCanonicalDigest,
  pluginSnapshotCanonicalJson,
  type InstalledPluginSnapshotInput,
  type PluginInstallationSnapshotFaultPoint,
} from "./plugin-installation-snapshots"

const roots: string[] = []

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex")
}

function fileIdentity(relativePath: string, contents: string) {
  return {
    path: relativePath,
    sha256: digest(contents),
    size: Buffer.byteLength(contents),
  }
}

function activeSet(plugins: readonly { readonly pluginId: string; readonly snapshotDigest: string }[]) {
  const topology = planPluginCapabilityTopology([])
  if (!topology.ok) throw new Error("Empty Plugin capability topology must be valid")
  return {
    capabilityTopology: topology.topology,
    plugins: plugins.map((plugin) => ({
      activationId: digest(`${plugin.pluginId}:${plugin.snapshotDigest}:activation`),
      ...plugin,
    })),
  }
}

function snapshotInput(
  pluginId: string,
  options: { companion?: boolean; hook?: boolean; version?: string } = {},
): InstalledPluginSnapshotInput {
  const manifest = fileIdentity("manifest.json", `{"id":"${pluginId}"}`)
  const hook = fileIdentity("hooks/index.mjs", `export const Plugin = () => "${pluginId}"`)
  const packageFiles = [
    fileIdentity("web/index.js", `console.log("${pluginId}")`),
    manifest,
    ...(options.hook ? [hook] : []),
  ]
  return {
    authorizations: {
      capabilityContractDigest: digest(`${pluginId}:capabilities`),
      ...(options.companion ? { companionExecutionDigest: digest(`${pluginId}:companion-authorization`) } : {}),
      ...(options.hook ? { hookExecutionDigest: digest(`${pluginId}:hook-authorization`) } : {}),
    },
    ...(options.companion
      ? {
          companion: {
            entryPath: "bin/companion",
            mode: "native" as const,
            sha256: digest(`${pluginId}:companion`),
            size: 1_024,
            target: "darwin-arm64",
          },
        }
      : {}),
    ...(options.hook
      ? {
          hook: {
            entryPath: hook.path,
            sha256: hook.sha256,
            size: hook.size,
          },
        }
      : {}),
    ownedSkills: [
      {
        files: [fileIdentity("references/api.md", `# ${pluginId} API`), fileIdentity("SKILL.md", `# ${pluginId}`)],
        name: `${pluginId}-workflow`,
      },
    ],
    package: {
      artifact: { sha256: digest(`${pluginId}:archive`), size: 2_048 },
      files: packageFiles,
      manifest: { sha256: manifest.sha256, size: manifest.size },
    },
    pluginId,
    sourceIdentity: digest(`${pluginId}:source`),
    version: options.version ?? "1.0.0",
  }
}

async function fixture(
  faultPoint?: PluginInstallationSnapshotFaultPoint,
): Promise<{ root: string; store: PluginInstallationSnapshotStore }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "convax-plugin-installation-snapshots-"))
  roots.push(root)
  return {
    root,
    store: new PluginInstallationSnapshotStore(root, {
      faultHook:
        faultPoint === undefined
          ? undefined
          : (point) => {
              if (point === faultPoint) throw new Error(`simulated crash at ${point}`)
            },
    }),
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { force: true, recursive: true })))
})

describe("PluginInstallationSnapshotStore", () => {
  test("canonicalizes object keys and semantically unordered snapshot members", async () => {
    expect(pluginSnapshotCanonicalJson({ z: [3, { b: 2, a: 1 }], a: true })).toBe('{"a":true,"z":[3,{"a":1,"b":2}]}')
    expect(pluginSnapshotCanonicalDigest({ b: 2, a: 1 })).toBe(pluginSnapshotCanonicalDigest({ a: 1, b: 2 }))

    const { root, store } = await fixture()
    const firstInput = snapshotInput("alpha", { hook: true })
    const secondInput: InstalledPluginSnapshotInput = {
      ...firstInput,
      ownedSkills: [...firstInput.ownedSkills].reverse().map((skill) => ({
        ...skill,
        files: [...skill.files].reverse(),
      })),
      package: {
        ...firstInput.package,
        files: [...firstInput.package.files].reverse(),
      },
    }
    const first = await store.putInstalledSnapshot(firstInput)
    const second = await store.putInstalledSnapshot(secondInput)

    expect(second.digest).toBe(first.digest)
    expect(first.descriptor.package.files.map((file) => file.path)).toEqual([
      "hooks/index.mjs",
      "manifest.json",
      "web/index.js",
    ])
    expect(first.descriptor.ownedSkills[0]?.files.map((file) => file.path)).toEqual(["SKILL.md", "references/api.md"])
    expect(Object.isFrozen(first)).toBe(true)
    expect(Object.isFrozen(first.descriptor.package.files)).toBe(true)
    if (process.platform !== "win32") {
      const snapshotPath = path.join(root, "installed", `${first.digest}.json`)
      expect((await fs.stat(snapshotPath)).mode & 0o777).toBe(0o400)
    }
  })

  test("strictly rejects unsafe paths, extra state owners, duplicates, and orphan authorization bindings", async () => {
    const { store } = await fixture()
    const base = snapshotInput("alpha")
    const inputWithForbiddenOwner = {
      ...base,
      oauth: { accessToken: "must-not-enter-snapshot" },
    } as InstalledPluginSnapshotInput
    await expect(store.putInstalledSnapshot(inputWithForbiddenOwner)).rejects.toBeInstanceOf(
      PluginInstallationSnapshotStoreError,
    )
    await expect(
      store.putInstalledSnapshot({
        ...base,
        sourceIdentity: "https://marketplace.example/plugin",
      }),
    ).rejects.toThrow("source identity")
    await expect(
      store.putInstalledSnapshot({
        ...base,
        package: {
          ...base.package,
          files: [...base.package.files, { path: "../escape", sha256: digest("escape"), size: 1 }],
        },
      }),
    ).rejects.toThrow("path")
    await expect(
      store.putInstalledSnapshot({
        ...base,
        package: {
          ...base.package,
          files: [...base.package.files, base.package.files[0]],
        },
      }),
    ).rejects.toThrow("duplicate")
    const setupRequired = await store.putInstalledSnapshot({
      ...base,
      companion: {
        entryPath: "bin/tool",
        mode: "native",
        sha256: digest("companion"),
        size: 1,
        target: "darwin-arm64",
      },
    })
    expect(setupRequired.descriptor.authorizations.companionExecutionDigest).toBeUndefined()
    await expect(
      store.putInstalledSnapshot({
        ...base,
        authorizations: {
          ...base.authorizations,
          companionExecutionDigest: digest("orphan-companion-authorization"),
        },
      }),
    ).rejects.toThrow("requires an immutable companion")
    await expect(
      store.putInstalledSnapshot({
        ...base,
        ownedSkills: [{ files: [fileIdentity("README.md", "missing")], name: "missing-skill-file" }],
      }),
    ).rejects.toThrow("SKILL.md")
    const topology = planPluginCapabilityTopology([])
    if (!topology.ok) throw new Error("Empty Plugin capability topology must be valid")
    await expect(
      store.compareAndSwapActiveSet(0, {
        capabilityTopology: topology.topology,
        plugins: [{ pluginId: "alpha", snapshotDigest: setupRequired.digest }],
      } as never),
    ).rejects.toThrow("reference")
  })

  test("publishes one global pointer with CAS and stable Plugin ordering", async () => {
    const { store } = await fixture()
    const zulu = await store.putInstalledSnapshot(snapshotInput("zulu"))
    const alpha = await store.putInstalledSnapshot(snapshotInput("alpha"))

    const first = await store.compareAndSwapActiveSet(
      0,
      activeSet([
        { pluginId: "zulu", snapshotDigest: zulu.digest },
        { pluginId: "alpha", snapshotDigest: alpha.digest },
      ]),
    )
    expect(first.revision).toBe(1)
    expect(first.activeSet?.descriptor.plugins.map(({ pluginId }) => pluginId)).toEqual(["alpha", "zulu"])

    await expect(
      store.compareAndSwapActiveSet(0, activeSet([{ pluginId: "alpha", snapshotDigest: alpha.digest }])),
    ).rejects.toEqual(expect.any(ActivePluginSetRevisionConflictError))
    expect((await store.readActive()).activeSet?.digest).toBe(first.activeSet?.digest)

    const second = await store.compareAndSwapActiveSet(
      1,
      activeSet([{ pluginId: "alpha", snapshotDigest: alpha.digest }]),
    )
    expect(second.revision).toBe(2)
    expect((await store.readActive()).activeSet?.digest).toBe(second.activeSet?.digest)
  })

  test("reopens byte-exact v1 ActiveSets and upgrades only through the next explicit CAS", async () => {
    const { root, store } = await fixture()
    const alpha = await store.putInstalledSnapshot(snapshotInput("alpha"))
    const topology = planPluginCapabilityTopology([])
    if (!topology.ok) throw new Error("Empty Plugin capability topology must be valid")
    const legacyDescriptor = {
      capabilityTopology: topology.topology,
      plugins: [{ pluginId: "alpha", snapshotDigest: alpha.digest }],
      schema: legacyActivePluginSetSnapshotSchema,
    }
    const legacyDigest = pluginSnapshotCanonicalDigest(legacyDescriptor)
    const legacyBytes = `${pluginSnapshotCanonicalJson(legacyDescriptor)}\n`
    await fs.writeFile(path.join(root, "active-sets", `${legacyDigest}.json`), legacyBytes, { mode: 0o400 })
    await fs.writeFile(
      path.join(root, "active-pointer.json"),
      `${pluginSnapshotCanonicalJson({
        activeSetDigest: legacyDigest,
        revision: 1,
        schema: activePluginPointerSchema,
      })}\n`,
      { mode: 0o600 },
    )

    const reopened = new PluginInstallationSnapshotStore(root)
    const legacy = await reopened.readActive()
    expect(legacy).toMatchObject({
      activeSet: { descriptor: legacyDescriptor, digest: legacyDigest },
      revision: 1,
    })
    expect(await fs.readFile(path.join(root, "active-sets", `${legacyDigest}.json`), "utf8")).toBe(legacyBytes)
    await expect(
      reopened.compareAndSwapActiveSet(0, activeSet([{ pluginId: "alpha", snapshotDigest: alpha.digest }])),
    ).rejects.toBeInstanceOf(ActivePluginSetRevisionConflictError)

    const pinIdentity = {
      activeRevision: 1,
      activeSetDigest: legacyDigest,
      pluginId: "alpha",
      snapshotDigest: alpha.digest,
    }
    await reopened.pinActivePluginForOwner("generation-binding:legacy", pinIdentity)
    const pinned = await reopened.acquireOwnerPinLease("generation-binding:legacy", pinIdentity)
    expect(pinned.activationId).toBeUndefined()
    pinned.lease.release()

    const current = await reopened.compareAndSwapActiveSet(
      1,
      activeSet([{ pluginId: "alpha", snapshotDigest: alpha.digest }]),
    )
    expect(current.activeSet?.descriptor.schema).toBe(activePluginSetSnapshotSchema)
    expect(current.activeSet?.descriptor.plugins[0]).toHaveProperty("activationId")
    expect(await fs.readFile(path.join(root, "active-sets", `${legacyDigest}.json`), "utf8")).toBe(legacyBytes)
  })

  test("refuses to point at a missing or Plugin-id-mismatched snapshot", async () => {
    const { store } = await fixture()
    const alpha = await store.putInstalledSnapshot(snapshotInput("alpha"))
    await expect(
      store.compareAndSwapActiveSet(0, activeSet([{ pluginId: "bravo", snapshotDigest: alpha.digest }])),
    ).rejects.toThrow("does not match")
    await expect(
      store.compareAndSwapActiveSet(0, activeSet([{ pluginId: "alpha", snapshotDigest: digest("missing") }])),
    ).rejects.toBeInstanceOf(PluginInstallationSnapshotStoreError)
    expect(await store.readActive()).toEqual({ activeSet: null, revision: 0 })
  })

  test("fails closed on corrupted snapshots, ActiveSets, and pointers without guessing a fallback", async () => {
    const { root, store } = await fixture()
    const alpha = await store.putInstalledSnapshot(snapshotInput("alpha"))
    const first = await store.compareAndSwapActiveSet(
      0,
      activeSet([{ pluginId: "alpha", snapshotDigest: alpha.digest }]),
    )
    const bravo = await store.putInstalledSnapshot(snapshotInput("bravo"))
    await store.compareAndSwapActiveSet(1, activeSet([{ pluginId: "bravo", snapshotDigest: bravo.digest }]))

    const pointerPath = path.join(root, "active-pointer.json")
    await fs.writeFile(
      pointerPath,
      `${JSON.stringify({
        activeSetDigest: digest("missing-active-set"),
        revision: 2,
        schema: "convax.active-plugin-pointer/1",
      })}\n`,
      { mode: 0o600 },
    )
    await expect(new PluginInstallationSnapshotStore(root).readActive()).rejects.toBeInstanceOf(
      PluginInstallationSnapshotStoreError,
    )

    await fs.writeFile(
      pointerPath,
      `${JSON.stringify({
        activeSetDigest: first.activeSet?.digest,
        revision: 1,
        schema: "convax.active-plugin-pointer/1",
      })}\n`,
      { mode: 0o600 },
    )
    const installedPath = path.join(root, "installed", `${alpha.digest}.json`)
    if (process.platform !== "win32") await fs.chmod(installedPath, 0o600)
    await fs.writeFile(installedPath, `${JSON.stringify(snapshotInput("changed"))}\n`, { mode: 0o400 })
    if (process.platform !== "win32") await fs.chmod(installedPath, 0o400)
    await expect(new PluginInstallationSnapshotStore(root).readActive()).rejects.toBeInstanceOf(
      PluginInstallationSnapshotStoreError,
    )
  })

  test("a crash during a half-written InstalledSnapshot publishes nothing", async () => {
    const { root, store } = await fixture("installed-snapshot.partial-written")
    await expect(store.putInstalledSnapshot(snapshotInput("alpha"))).rejects.toThrow("simulated crash")

    const entries = await fs.readdir(path.join(root, "installed"))
    expect(entries.some((entry) => entry.endsWith(".tmp"))).toBe(true)
    expect(entries.some((entry) => entry.endsWith(".json"))).toBe(false)
    const reopened = new PluginInstallationSnapshotStore(root)
    expect(await reopened.readActive()).toEqual({ activeSet: null, revision: 0 })
    expect(await reopened.listGarbageCollectionCandidates()).toEqual({
      activeSetDigests: [],
      installedSnapshotDigests: [],
    })
  })

  test("a crash after InstalledSnapshot rename preserves the complete immutable snapshot", async () => {
    const { root, store } = await fixture("installed-snapshot.renamed")
    await expect(store.putInstalledSnapshot(snapshotInput("alpha"))).rejects.toThrow("simulated crash")

    const published = (await fs.readdir(path.join(root, "installed"))).find((entry) => entry.endsWith(".json"))
    if (!published) throw new Error("renamed snapshot was not published")
    const expectedDigest = published.slice(0, -".json".length)
    const reopened = new PluginInstallationSnapshotStore(root)
    expect((await reopened.readInstalledSnapshot(expectedDigest)).descriptor.pluginId).toBe("alpha")
  })

  test("a crash after ActiveSet rename but before pointer publication preserves the old revision", async () => {
    const { root, store } = await fixture()
    const alpha = await store.putInstalledSnapshot(snapshotInput("alpha"))
    const bravo = await store.putInstalledSnapshot(snapshotInput("bravo"))
    const previous = await store.compareAndSwapActiveSet(
      0,
      activeSet([{ pluginId: "alpha", snapshotDigest: alpha.digest }]),
    )
    const crashingStore = new PluginInstallationSnapshotStore(root, {
      faultHook(point) {
        if (point === "active-set.renamed-before-pointer") throw new Error("simulated crash")
      },
    })
    await expect(
      crashingStore.compareAndSwapActiveSet(1, activeSet([{ pluginId: "bravo", snapshotDigest: bravo.digest }])),
    ).rejects.toThrow("simulated crash")

    const reopened = new PluginInstallationSnapshotStore(root)
    const active = await reopened.readActive()
    expect(active.revision).toBe(1)
    expect(active.activeSet?.digest).toBe(previous.activeSet?.digest)
    expect((await reopened.listGarbageCollectionCandidates()).activeSetDigests).toHaveLength(1)
  })

  test("a crash with a synced pointer temp preserves the old pointer", async () => {
    const { root, store } = await fixture()
    const alpha = await store.putInstalledSnapshot(snapshotInput("alpha"))
    const bravo = await store.putInstalledSnapshot(snapshotInput("bravo"))
    const previous = await store.compareAndSwapActiveSet(
      0,
      activeSet([{ pluginId: "alpha", snapshotDigest: alpha.digest }]),
    )
    const crashingStore = new PluginInstallationSnapshotStore(root, {
      faultHook(point) {
        if (point === "active-pointer.temp-synced") throw new Error("simulated crash")
      },
    })
    await expect(
      crashingStore.compareAndSwapActiveSet(1, activeSet([{ pluginId: "bravo", snapshotDigest: bravo.digest }])),
    ).rejects.toThrow("simulated crash")

    const reopened = await new PluginInstallationSnapshotStore(root).readActive()
    expect(reopened.revision).toBe(1)
    expect(reopened.activeSet?.digest).toBe(previous.activeSet?.digest)
    expect((await fs.readdir(root)).some((entry) => entry.endsWith(".tmp"))).toBe(true)
  })

  test("a crash after pointer rename exposes only the complete new revision", async () => {
    const { root, store } = await fixture()
    const alpha = await store.putInstalledSnapshot(snapshotInput("alpha"))
    const bravo = await store.putInstalledSnapshot(snapshotInput("bravo"))
    await store.compareAndSwapActiveSet(0, activeSet([{ pluginId: "alpha", snapshotDigest: alpha.digest }]))
    const crashingStore = new PluginInstallationSnapshotStore(root, {
      faultHook(point) {
        if (point === "active-pointer.renamed") throw new Error("simulated crash")
      },
    })
    await expect(
      crashingStore.compareAndSwapActiveSet(1, activeSet([{ pluginId: "bravo", snapshotDigest: bravo.digest }])),
    ).rejects.toThrow("simulated crash")

    const reopened = await new PluginInstallationSnapshotStore(root).readActive()
    expect(reopened.revision).toBe(2)
    expect(reopened.activeSet?.descriptor.plugins).toEqual(
      activeSet([{ pluginId: "bravo", snapshotDigest: bravo.digest }]).plugins,
    )
  })

  test("leases, active references, and owner pins are independent conservative GC roots", async () => {
    const { root, store } = await fixture()
    const active = await store.putInstalledSnapshot(snapshotInput("active"))
    const leased = await store.putInstalledSnapshot(snapshotInput("leased"))
    const pinned = await store.putInstalledSnapshot(snapshotInput("pinned"))
    const collectable = await store.putInstalledSnapshot(snapshotInput("collectable"))
    const pinnedSelection = await store.compareAndSwapActiveSet(
      0,
      activeSet([
        { pluginId: "active", snapshotDigest: active.digest },
        { pluginId: "pinned", snapshotDigest: pinned.digest },
      ]),
    )
    await store.pinActivePluginForOwner("generation-binding:pinned", {
      activeRevision: pinnedSelection.revision,
      activeSetDigest: pinnedSelection.activeSet!.digest,
      pluginId: "pinned",
      snapshotDigest: pinned.digest,
    })
    const selection = await store.compareAndSwapActiveSet(
      pinnedSelection.revision,
      activeSet([{ pluginId: "active", snapshotDigest: active.digest }]),
    )
    const snapshotLease = await store.acquireSnapshotLease([leased.digest])
    const activeSetLease = await store.acquireActiveSetLease(selection.activeSet!.digest)
    expect(await store.getGarbageCollectionEligibility(active.digest)).toMatchObject({
      active: true,
      eligible: false,
      leased: true,
      persistentlyPinned: false,
    })
    expect(await store.getGarbageCollectionEligibility(leased.digest)).toMatchObject({
      active: false,
      eligible: false,
      leased: true,
      persistentlyPinned: false,
    })
    expect(await store.getGarbageCollectionEligibility(pinned.digest)).toMatchObject({
      active: false,
      eligible: false,
      leased: false,
      persistentlyPinned: true,
    })
    expect((await store.listGarbageCollectionCandidates()).installedSnapshotDigests).toEqual([collectable.digest])

    snapshotLease.release()
    snapshotLease.release()
    activeSetLease.release()
    expect(snapshotLease.released).toBe(true)
    expect((await store.listGarbageCollectionCandidates()).installedSnapshotDigests).toEqual(
      [collectable.digest, leased.digest].sort(),
    )

    const reopened = new PluginInstallationSnapshotStore(root)
    expect(await reopened.getGarbageCollectionEligibility(pinned.digest)).toMatchObject({
      eligible: false,
      leased: false,
      persistentlyPinned: true,
    })
    expect((await reopened.readOwnerPins()).pins).toEqual([
      expect.objectContaining({
        ownerKey: "generation-binding:pinned",
        pluginId: "pinned",
        snapshotDigest: pinned.digest,
      }),
    ])
  })

  test("owner pin publication is old-or-new across crashes and rejects tampered membership", async () => {
    const { root, store } = await fixture()
    const alpha = await store.putInstalledSnapshot(snapshotInput("alpha"))
    const active = await store.compareAndSwapActiveSet(
      0,
      activeSet([{ pluginId: "alpha", snapshotDigest: alpha.digest }]),
    )
    const identity = {
      activeRevision: active.revision,
      activeSetDigest: active.activeSet!.digest,
      pluginId: "alpha",
      snapshotDigest: alpha.digest,
    }

    const beforeRename = new PluginInstallationSnapshotStore(root, {
      faultHook(point) {
        if (point === "owner-pins.temp-synced") throw new Error("simulated crash")
      },
    })
    await expect(beforeRename.pinActivePluginForOwner("generation-binding:alpha", identity)).rejects.toThrow(
      "simulated crash",
    )
    expect(await new PluginInstallationSnapshotStore(root).readOwnerPins()).toMatchObject({
      pins: [],
      revision: 0,
    })

    const afterRename = new PluginInstallationSnapshotStore(root, {
      faultHook(point) {
        if (point === "owner-pins.renamed") throw new Error("simulated crash")
      },
    })
    await expect(afterRename.pinActivePluginForOwner("generation-binding:alpha", identity)).rejects.toThrow(
      "simulated crash",
    )
    expect(await new PluginInstallationSnapshotStore(root).readOwnerPins()).toMatchObject({
      pins: [{ ownerKey: "generation-binding:alpha", ...identity }],
      revision: 1,
    })

    const ownerPinsPath = path.join(root, "owner-pins.json")
    const persisted = JSON.parse(await fs.readFile(ownerPinsPath, "utf8")) as {
      pins: Array<{ snapshotDigest: string }>
    }
    persisted.pins[0]!.snapshotDigest = digest("not-in-active-set")
    await fs.writeFile(ownerPinsPath, `${JSON.stringify(persisted)}\n`, { mode: 0o600 })
    await expect(new PluginInstallationSnapshotStore(root).readOwnerPins()).rejects.toBeInstanceOf(
      PluginInstallationSnapshotStoreError,
    )
    await expect(new PluginInstallationSnapshotStore(root).listGarbageCollectionCandidates()).rejects.toBeInstanceOf(
      PluginInstallationSnapshotStoreError,
    )
  })

  test("collects only a freshly revalidated candidate subset and rejects a new lease", async () => {
    const { store } = await fixture()
    const active = await store.putInstalledSnapshot(snapshotInput("active"))
    const collectable = await store.putInstalledSnapshot(snapshotInput("collectable"))
    await store.compareAndSwapActiveSet(0, activeSet([{ pluginId: "active", snapshotDigest: active.digest }]))
    const candidates = await store.listGarbageCollectionCandidates()
    expect(candidates.installedSnapshotDigests).toEqual([collectable.digest])

    const lease = await store.acquireSnapshotLease([collectable.digest])
    await expect(store.collectGarbageCollectionCandidates(candidates)).rejects.toThrow("stale")
    lease.release()

    expect(await store.collectGarbageCollectionCandidates(candidates)).toMatchObject({
      installedSnapshotDigests: [collectable.digest],
    })
    await expect(store.readInstalledSnapshot(collectable.digest)).rejects.toBeInstanceOf(
      PluginInstallationSnapshotStoreError,
    )
    expect((await store.readActive()).activeSet?.descriptor.plugins).toEqual(
      activeSet([{ pluginId: "active", snapshotDigest: active.digest }]).plugins,
    )
  })

  test("never collects a snapshot while a retained historical ActiveSet still references it", async () => {
    const { store } = await fixture()
    const first = await store.putInstalledSnapshot(snapshotInput("alpha"))
    const second = await store.putInstalledSnapshot(snapshotInput("alpha", { version: "2.0.0" }))
    await store.compareAndSwapActiveSet(0, activeSet([{ pluginId: "alpha", snapshotDigest: first.digest }]))
    await store.compareAndSwapActiveSet(1, activeSet([{ pluginId: "alpha", snapshotDigest: second.digest }]))

    const candidates = await store.listGarbageCollectionCandidates()
    expect(candidates.activeSetDigests).toHaveLength(1)
    expect(candidates.installedSnapshotDigests).toEqual([first.digest])
    await expect(
      store.collectGarbageCollectionCandidates({
        activeSetDigests: [],
        installedSnapshotDigests: [first.digest],
      }),
    ).rejects.toThrow("stale")
    expect((await store.readInstalledSnapshot(first.digest)).descriptor.version).toBe("1.0.0")

    await store.collectGarbageCollectionCandidates(candidates)
    await expect(store.readInstalledSnapshot(first.digest)).rejects.toBeInstanceOf(PluginInstallationSnapshotStoreError)
  })
})
