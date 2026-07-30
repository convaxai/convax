import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"

import { planPluginCapabilityTopology } from "./plugin-capability-binding-plan"
import {
  PluginInstallationRuntime,
  type PluginInstallationCandidate,
  type PluginInstallationRuntimeFaultPoint,
} from "./plugin-installation-runtime"
import {
  PluginInstallationSnapshotStore,
  type InstalledPluginSnapshotInput,
  type PluginInstallationSnapshotFaultPoint,
} from "./plugin-installation-snapshots"

function sha256(value: string | Uint8Array) {
  return createHash("sha256").update(value).digest("hex")
}

function fileIdentity(relativePath: string, contents: string) {
  return {
    path: relativePath,
    sha256: sha256(contents),
    size: Buffer.byteLength(contents),
  }
}

function activeSet(plugins: readonly { readonly pluginId: string; readonly snapshotDigest: string }[]) {
  const topology = planPluginCapabilityTopology([])
  if (!topology.ok) throw new Error("Empty Plugin capability topology must be valid")
  return { capabilityTopology: topology.topology, plugins }
}

function runtimeCandidate(assetContent: string, version: string): PluginInstallationCandidate {
  const plugin = {
    capabilities: [],
    contributes: {
      canvas: {
        commands: [
          {
            id: "inspect",
            target: { message: "inspect", type: "renderer-message" },
            title: { default: "Inspect" },
          },
        ],
        renderer: { create: true },
        toolbar: [{ command: "inspect", id: "inspect-toolbar" }],
      },
    },
    description: "Crash recovery fixture Plugin",
    entry: "index.html",
    hostApi: {
      major: 1,
      optional: [],
      required: ["host.context.get"],
    },
    id: "alpha",
    name: "alpha",
    schema: "convax.plugin/8",
    version,
  }
  return {
    artifact: {
      sha256: sha256(`alpha:archive:${version}:${assetContent}`),
      size: 2_048,
    },
    files: {
      "index.html": assetContent,
      "manifest.json": JSON.stringify(plugin),
    },
    sourceIdentity: sha256("alpha:source"),
  }
}

function snapshotInput(pluginId: string, version: string): InstalledPluginSnapshotInput {
  const manifest = fileIdentity("manifest.json", `{"id":"${pluginId}","version":"${version}"}`)
  return {
    authorizations: {
      capabilityContractDigest: sha256(`${pluginId}:${version}:capabilities`),
    },
    ownedSkills: [],
    package: {
      artifact: { sha256: sha256(`${pluginId}:${version}:archive`), size: 2_048 },
      files: [fileIdentity("web/index.js", `${pluginId}:${version}`), manifest],
      manifest: { sha256: manifest.sha256, size: manifest.size },
    },
    pluginId,
    sourceIdentity: sha256(`${pluginId}:source`),
    version,
  }
}

async function emit(value: unknown) {
  await new Promise<void>((resolve, reject) => {
    process.stdout.write(`${JSON.stringify(value)}\n`, (error) => {
      if (error) reject(error)
      else resolve()
    })
  })
}

async function waitForExternalKill(point: PluginInstallationRuntimeFaultPoint | PluginInstallationSnapshotFaultPoint) {
  await emit({ point, type: "fault-ready" })
  await new Promise<never>(() => {
    setInterval(() => undefined, 60_000).unref()
  })
}

async function initializeRuntime(root: string) {
  const active = await new PluginInstallationRuntime(root).publish(0, runtimeCandidate("snapshot-a", "1.0.0"))
  const mutableDecoy = path.join(root, "plugins", "alpha", "index.html")
  await fs.mkdir(path.dirname(mutableDecoy), { recursive: true })
  await fs.writeFile(mutableDecoy, "mutable-current-by-id-decoy")
  return active
}

async function crashClosureAfterRename(root: string) {
  const runtime = new PluginInstallationRuntime(root, {
    faultHook(point) {
      if (point === "closure.renamed-before-pointer") return waitForExternalKill(point)
    },
  })
  await runtime.publish(1, runtimeCandidate("snapshot-b", "2.0.0"))
  throw new Error("Closure crash point was not reached")
}

async function inspectRuntime(root: string) {
  const runtime = new PluginInstallationRuntime(root)
  const active = await runtime.readActive()
  const handle = await runtime.acquireActivePlugin("alpha")
  try {
    return {
      active,
      asset: await fs.readFile(await handle.resolveAsset("index.html"), "utf8"),
      closureEntries: (await fs.readdir(path.join(root, "closures"))).sort(),
      garbage: await new PluginInstallationSnapshotStore(path.join(root, "state")).listGarbageCollectionCandidates(),
      resolvedIdentity: handle.identity,
    }
  } finally {
    handle.release()
  }
}

async function initializeState(root: string) {
  const store = new PluginInstallationSnapshotStore(root)
  const alpha = await store.putInstalledSnapshot(snapshotInput("alpha", "1.0.0"))
  const bravo = await store.putInstalledSnapshot(snapshotInput("bravo", "2.0.0"))
  const active = await store.compareAndSwapActiveSet(
    0,
    activeSet([{ pluginId: "alpha", snapshotDigest: alpha.digest }]),
  )
  return { active, alpha, bravo }
}

async function crashActiveSetAfterRename(root: string) {
  const bravo = await new PluginInstallationSnapshotStore(root).putInstalledSnapshot(snapshotInput("bravo", "2.0.0"))
  const store = new PluginInstallationSnapshotStore(root, {
    faultHook(point) {
      if (point === "active-set.renamed-before-pointer") return waitForExternalKill(point)
    },
  })
  await store.compareAndSwapActiveSet(1, activeSet([{ pluginId: "bravo", snapshotDigest: bravo.digest }]))
  throw new Error("ActiveSet crash point was not reached")
}

async function alphaPinIdentity(root: string) {
  const store = new PluginInstallationSnapshotStore(root)
  const active = await store.readActive()
  const reference = active.activeSet?.descriptor.plugins.find(({ pluginId }) => pluginId === "alpha")
  if (!active.activeSet || !reference) throw new Error("Alpha is not the active fixture Plugin")
  return {
    activeRevision: active.revision,
    activeSetDigest: active.activeSet.digest,
    pluginId: reference.pluginId,
    snapshotDigest: reference.snapshotDigest,
  }
}

async function crashOwnerPin(root: string, point: "owner-pins.renamed" | "owner-pins.temp-synced") {
  const identity = await alphaPinIdentity(root)
  const store = new PluginInstallationSnapshotStore(root, {
    faultHook(candidate) {
      if (candidate === point) return waitForExternalKill(candidate)
    },
  })
  await store.pinActivePluginForOwner("generation-operation:crash-e2e", identity)
  throw new Error("Owner pin crash point was not reached")
}

async function inspectState(root: string) {
  const store = new PluginInstallationSnapshotStore(root)
  return {
    active: await store.readActive(),
    activeSetEntries: (await fs.readdir(path.join(root, "active-sets"))).sort(),
    garbage: await store.listGarbageCollectionCandidates(),
    installedEntries: (await fs.readdir(path.join(root, "installed"))).sort(),
    ownerPins: await store.readOwnerPins(),
  }
}

async function switchStateToBravo(root: string) {
  const store = new PluginInstallationSnapshotStore(root)
  const bravo = await store.putInstalledSnapshot(snapshotInput("bravo", "2.0.0"))
  return store.compareAndSwapActiveSet(1, activeSet([{ pluginId: "bravo", snapshotDigest: bravo.digest }]))
}

async function assertPinnedCollectionRejected(root: string) {
  const store = new PluginInstallationSnapshotStore(root)
  const pins = await store.readOwnerPins()
  const pin = pins.pins.find(({ ownerKey }) => ownerKey === "generation-operation:crash-e2e")
  if (!pin) throw new Error("Expected crash E2E owner pin")
  let rejected = false
  try {
    await store.collectGarbageCollectionCandidates({
      activeSetDigests: [pin.activeSetDigest],
      installedSnapshotDigests: [pin.snapshotDigest],
    })
  } catch {
    rejected = true
  }
  return {
    rejected,
    retained: (await store.readInstalledSnapshot(pin.snapshotDigest)).descriptor.pluginId,
  }
}

async function unpinAndCollect(root: string) {
  const store = new PluginInstallationSnapshotStore(root)
  const pins = await store.readOwnerPins()
  const pin = pins.pins.find(({ ownerKey }) => ownerKey === "generation-operation:crash-e2e")
  if (!pin) throw new Error("Expected crash E2E owner pin")
  const { ownerKey: _, ...identity } = pin
  await store.unpinPluginOwner(pin.ownerKey, identity)
  const candidates = await store.listGarbageCollectionCandidates()
  return {
    candidates,
    collected: await store.collectGarbageCollectionCandidates(candidates),
  }
}

const [command, root] = process.argv.slice(2)
if (!command || !root || !path.isAbsolute(root)) {
  throw new Error("Usage: plugin-installation-crash-e2e.fixture.ts <command> <absolute-root>")
}

const commands: Readonly<Record<string, () => Promise<unknown>>> = {
  "runtime:collect": () => new PluginInstallationRuntime(root).collectGarbage(),
  "runtime:crash-closure": () => crashClosureAfterRename(root),
  "runtime:init": () => initializeRuntime(root),
  "runtime:inspect": () => inspectRuntime(root),
  "state:collect": async () => {
    const store = new PluginInstallationSnapshotStore(root)
    const candidates = await store.listGarbageCollectionCandidates()
    return store.collectGarbageCollectionCandidates(candidates)
  },
  "state:crash-active-set": () => crashActiveSetAfterRename(root),
  "state:crash-pin-after": () => crashOwnerPin(root, "owner-pins.renamed"),
  "state:crash-pin-before": () => crashOwnerPin(root, "owner-pins.temp-synced"),
  "state:init": () => initializeState(root),
  "state:inspect": () => inspectState(root),
  "state:reject-pinned-collection": () => assertPinnedCollectionRejected(root),
  "state:switch-bravo": () => switchStateToBravo(root),
  "state:unpin-and-collect": () => unpinAndCollect(root),
}

const operation = commands[command]
if (!operation) throw new Error(`Unknown crash E2E fixture command: ${command}`)
await emit({ type: "result", value: await operation() })
