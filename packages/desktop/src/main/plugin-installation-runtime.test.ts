/* oxlint-disable typescript-eslint/await-thenable -- Bun's async `.rejects` matcher is thenable at runtime. */
import { afterEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { parsePluginCapabilityDeclaration, type PluginCapabilityDeclaration } from "@convax/plugin-sdk"

import { PluginInstallationClosureStore } from "./plugin-installation-closure-store"
import { planPluginCapabilityTopology } from "./plugin-capability-binding-plan"
import {
  activePluginPointerSchema,
  ActivePluginSetRevisionConflictError,
  legacyActivePluginSetSnapshotSchema,
  PluginInstallationSnapshotStore,
  pluginSnapshotCanonicalDigest,
  pluginSnapshotCanonicalJson,
} from "./plugin-installation-snapshots"
import {
  PluginExecutionSetupRequiredError,
  PluginInstallationRuntime,
  PluginInstallationRuntimeError,
  type PluginInstallationCandidate,
  type PluginInstallationRuntimeFaultPoint,
} from "./plugin-installation-runtime"

const roots: string[] = []

function sha256(value: string | Uint8Array) {
  return createHash("sha256").update(value).digest("hex")
}

function capabilityDeclaration(input: {
  exports?: readonly string[]
  required?: readonly string[]
}): PluginCapabilityDeclaration {
  const schema = {
    additionalProperties: false,
    properties: {},
    required: [],
    type: "object",
  } as const
  return parsePluginCapabilityDeclaration({
    exports: (input.exports ?? []).map((id) => ({
      docs: { request: "No fields.", response: "No fields.", summary: `Provides ${id}.` },
      id,
      inputSchema: schema,
      operation: "capability.invoke",
      outputSchema: schema,
      sideEffect: "execute",
      version: "1.0.0",
    })),
    imports: {
      optional: [],
      required: (input.required ?? []).map((id) => ({
        id,
        inputSchema: schema,
        outputSchema: schema,
        version: { maximumExclusive: "2.0.0", minimum: "1.0.0" },
      })),
    },
  })
}

function manifest(
  id: string,
  options: {
    assetContent?: string
    capabilityDeclaration?: PluginCapabilityDeclaration
    executable?: boolean
    skillName?: string
    version?: string
  } = {},
) {
  const skillName = options.skillName
  return {
    capabilities: [],
    contributes: {
      agent: {
        mcp: {
          oauth: "none",
          type: "remote",
          url: "https://agent.example.test/mcp",
        },
      },
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
      ...(options.capabilityDeclaration ? { capabilities: options.capabilityDeclaration } : {}),
      ...(options.executable ? { service: { actions: ["authorize"] } } : {}),
      ...(skillName
        ? {
            skills: [
              {
                name: skillName,
                path: `skills/${skillName}`,
              },
            ],
          }
        : {}),
    },
    description: `${id} test Plugin`,
    entry: "index.html",
    hostApi: {
      major: 3,
      optional: [],
      required: ["host.context.get"],
    },
    id,
    name: id,
    ...(options.executable
      ? {
          runtime: {
            command: `${id}-tool`,
            type: "mcp-stdio",
          },
        }
      : {}),
    schema: "convax.plugin/8",
    version: options.version ?? "1.0.0",
  }
}

function candidate(
  id: string,
  options: {
    assetContent?: string
    capabilityDeclaration?: PluginCapabilityDeclaration
    companion?: boolean
    companionAuthorized?: boolean
    skillName?: string
    version?: string
  } = {},
): PluginInstallationCandidate {
  const document = manifest(id, { ...options, executable: options.companion })
  const skillName = options.skillName
  return {
    artifact: {
      sha256: sha256(`${id}:archive:${options.version ?? "1.0.0"}:${options.assetContent ?? "default"}`),
      size: 2_048,
    },
    ...(options.companionAuthorized
      ? {
          executionAuthorization: { companion: true },
        }
      : {}),
    ...(options.companion
      ? {
          companion: {
            bytes: Buffer.from(`native:${id}`),
            entryPath: "bin/tool",
            mode: "native" as const,
            target: "darwin-arm64",
          },
        }
      : {}),
    files: {
      "index.html": options.assetContent ?? `<h1>${id}</h1>`,
      "manifest.json": JSON.stringify(document),
      ...(skillName
        ? {
            [`skills/${skillName}/SKILL.md`]: `---\nname: ${skillName}\ndescription: test\n---\n`,
            [`skills/${skillName}/references/convax-capabilities.md`]: `# ${id}`,
          }
        : {}),
    },
    sourceIdentity: sha256(`${id}:source`),
  }
}

async function fixture(faultPoint?: PluginInstallationRuntimeFaultPoint) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "convax-plugin-installation-runtime-"))
  roots.push(root)
  return {
    root,
    runtime: new PluginInstallationRuntime(root, {
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

describe("PluginInstallationRuntime", () => {
  test("publishes one fully verified closure and leases the exact ActiveSet generation", async () => {
    const { runtime } = await fixture()
    const active = await runtime.publish(
      0,
      candidate("alpha", { companion: true, companionAuthorized: true, skillName: "shared-workflow" }),
    )

    expect(active.revision).toBe(1)
    expect(active.plugins).toHaveLength(1)
    expect(active.plugins[0]?.plugin.contributes.agent?.mcp?.url).toBe("https://agent.example.test/mcp")
    expect(active.plugins[0]?.plugin.contributes.canvas?.toolbar).toEqual([
      { command: "inspect", id: "inspect-toolbar" },
    ])
    expect(active.plugins[0]?.identity).toMatchObject({
      activeRevision: 1,
      pluginId: "alpha",
      version: "1.0.0",
    })
    expect(await runtime.resolveCapabilityIdentity("alpha")).toMatchObject({
      activeRevision: 1,
      digest: pluginSnapshotCanonicalDigest(manifest("alpha", { executable: true, skillName: "shared-workflow" })),
      manifestDigest: pluginSnapshotCanonicalDigest(
        manifest("alpha", { executable: true, skillName: "shared-workflow" }),
      ),
      plugin: { id: "alpha" },
      snapshotDigest: active.plugins[0].identity.snapshotDigest,
    })
    expect(await runtime.resolveCapabilityIdentity("missing")).toBeNull()

    const handle = await runtime.acquireActivePlugin("alpha")
    expect(await fs.readFile(await handle.resolveAsset("index.html"), "utf8")).toBe("<h1>alpha</h1>")
    expect(await fs.readFile(await handle.resolveOwnedSkillFile("shared-workflow", "SKILL.md"), "utf8")).toContain(
      "name: shared-workflow",
    )
    expect(
      await fs.readFile(path.join(await handle.resolveOwnedSkillDirectory("shared-workflow"), "SKILL.md"), "utf8"),
    ).toContain("name: shared-workflow")
    const companionPath = await handle.resolveCompanion()
    if (!companionPath) throw new Error("Expected an active companion")
    expect(await fs.readFile(companionPath, "utf8")).toBe("native:alpha")
    expect(handle.descriptor.authorizations.companionExecutionDigest).toMatch(/^[a-f0-9]{64}$/)
    expect(handle.installationActivationId).toMatch(/^[a-f0-9]{64}$/)

    handle.release()
    handle.release()
    expect(handle.released).toBe(true)
    await expect(handle.resolveAsset("index.html")).rejects.toThrow("lease has been released")
  })

  test("runs an existing v8 Plugin from a byte-exact legacy v1 ActiveSet", async () => {
    const { root, runtime } = await fixture()
    const published = await runtime.publish(0, candidate("alpha", { companion: true, companionAuthorized: true }))
    const current = await new PluginInstallationSnapshotStore(path.join(root, "state")).readActive()
    if (!current.activeSet) throw new Error("Expected an active Plugin set")
    const legacyDescriptor = {
      capabilityTopology: current.activeSet.descriptor.capabilityTopology,
      plugins: published.plugins.map(({ identity }) => ({
        pluginId: identity.pluginId,
        snapshotDigest: identity.snapshotDigest,
      })),
      schema: legacyActivePluginSetSnapshotSchema,
    }
    const legacyDigest = pluginSnapshotCanonicalDigest(legacyDescriptor)
    await fs.writeFile(
      path.join(root, "state", "active-sets", `${legacyDigest}.json`),
      `${pluginSnapshotCanonicalJson(legacyDescriptor)}\n`,
      { mode: 0o400 },
    )
    await fs.writeFile(
      path.join(root, "state", "active-pointer.json"),
      `${pluginSnapshotCanonicalJson({
        activeSetDigest: legacyDigest,
        revision: 2,
        schema: activePluginPointerSchema,
      })}\n`,
      { mode: 0o600 },
    )

    const reopened = new PluginInstallationRuntime(root)
    const active = await reopened.readActive()
    expect(active).toMatchObject({ activeSetDigest: legacyDigest, revision: 2 })
    const handle = await reopened.acquireActivePlugin("alpha")
    expect(handle.installationActivationId).toBeUndefined()
    expect(await handle.resolveCompanion()).toMatch(/\/closures\//)
    handle.release()
  })

  test("rejects an LLM snapshot without the current explicit provider protocol", async () => {
    const { root, runtime } = await fixture()
    const executableCandidate = (id: string, contributions: Record<string, unknown>) => {
      const base = candidate(id, { companion: true, companionAuthorized: true })
      const document = manifest(id, { executable: true })
      return {
        ...base,
        files: {
          ...base.files,
          "manifest.json": JSON.stringify({
            ...document,
            contributes: { ...document.contributes, ...contributions },
          }),
        },
      }
    }
    const mediaTools = executableCandidate("media-tools", {
      generation: {
        models: [],
        tools: [
          {
            acceptedInputs: ["reference_image"],
            description: "Create an image output.",
            id: "image.transform",
            output: "image",
            title: "Transform image",
          },
          {
            acceptedInputs: ["reference_video"],
            description: "Create a video output.",
            id: "video.transform",
            output: "video",
            title: "Transform video",
          },
        ],
      },
    })
    await runtime.publish(0, mediaTools)

    const legacyGateway = executableCandidate("legacy-gateway", {
      llm: {
        modelCatalog: "runtime",
        models: [{ id: "model-1", name: "Model 1" }],
        provider: { id: "legacy-provider", name: "Legacy Provider" },
      },
    })
    await expect(runtime.publish(1, legacyGateway)).rejects.toThrow("Plugin package manifest is invalid")

    const active = await new PluginInstallationRuntime(root).readActive()
    expect(active.plugins.map(({ plugin }) => plugin.id)).toEqual(["media-tools"])
    expect(
      active.plugins
        .find(({ plugin }) => plugin.id === "media-tools")!
        .plugin.contributes.generation?.tools.map(({ id, output }) => ({ id, output })),
    ).toEqual([
      { id: "image.transform", output: "image" },
      { id: "video.transform", output: "video" },
    ])
  })

  test("keeps verified companion bytes inert until the snapshot carries an exact setup binding", async () => {
    const { runtime } = await fixture()
    await runtime.publish(0, candidate("alpha", { companion: true }))

    const handle = await runtime.acquireActivePlugin("alpha")
    const installationActivationId = handle.installationActivationId
    await expect(handle.resolveCompanion()).rejects.toBeInstanceOf(PluginExecutionSetupRequiredError)
    handle.release()

    const authorized = await runtime.authorizeExecution(1, "alpha", { companion: true, hook: false })
    expect(authorized.revision).toBe(2)
    expect(await runtime.executionAuthorizationIdentity("alpha")).toMatch(/^[a-f0-9]{64}$/)
    const authorizedHandle = await runtime.acquireActivePlugin("alpha")
    const companion = await authorizedHandle.resolveCompanion()
    if (!companion) throw new Error("Expected an authorized immutable companion")
    expect(await fs.readFile(companion, "utf8")).toBe("native:alpha")
    expect(authorizedHandle.identity.snapshotDigest).not.toBe(handle.identity.snapshotDigest)
    expect(authorizedHandle.installationActivationId).toBe(installationActivationId)
    authorizedHandle.release()
  })

  test("publishes one atomic per-install activation and never rotates it for unrelated Plugins", async () => {
    const { runtime } = await fixture()
    await runtime.publish(0, candidate("alpha", { companion: true, companionAuthorized: true }))
    const first = await runtime.acquireActivePlugin("alpha")
    const firstActivation = first.installationActivationId
    first.release()

    await runtime.publish(1, candidate("bravo"))
    const afterUnrelated = await runtime.acquireActivePlugin("alpha")
    expect(afterUnrelated.installationActivationId).toBe(firstActivation)
    afterUnrelated.release()

    await runtime.publish(2, candidate("alpha", { companion: true, companionAuthorized: true }))
    const republished = await runtime.acquireActivePlugin("alpha")
    expect(republished.installationActivationId).toMatch(/^[a-f0-9]{64}$/)
    expect(republished.installationActivationId).not.toBe(firstActivation)
    const republishedActivation = republished.installationActivationId
    republished.release()

    await runtime.uninstall(3, "alpha")
    await runtime.publish(4, candidate("alpha", { companion: true, companionAuthorized: true }))
    const reinstalled = await runtime.acquireActivePlugin("alpha")
    expect(reinstalled.installationActivationId).not.toBe(republishedActivation)
    reinstalled.release()
  })

  test("derives static Plugin authorization from the exact capability contract and package bytes", async () => {
    const { runtime } = await fixture()
    const first = await runtime.publish(0, candidate("alpha", { assetContent: "first" }))
    const firstAuthorization = await runtime.executionAuthorizationIdentity("alpha")

    expect(firstAuthorization).toMatch(/^[a-f0-9]{64}$/)

    await runtime.publish(first.revision, candidate("alpha", { assetContent: "second" }))
    const secondAuthorization = await runtime.executionAuthorizationIdentity("alpha")

    expect(secondAuthorization).toMatch(/^[a-f0-9]{64}$/)
    expect(secondAuthorization).not.toBe(firstAuthorization)
  })

  test("a partial closure never changes the previous active generation", async () => {
    const { root, runtime } = await fixture()
    const first = await runtime.publish(0, candidate("alpha"))
    const crashing = new PluginInstallationRuntime(root, {
      faultHook(point) {
        if (point === "closure.file-written") throw new Error("simulated crash")
      },
    })

    await expect(crashing.publish(1, candidate("bravo"))).rejects.toThrow("simulated crash")
    const reopened = await new PluginInstallationRuntime(root).readActive()
    expect(reopened.revision).toBe(1)
    expect(reopened.activeSetDigest).toBe(first.activeSetDigest)
    expect(reopened.plugins.map(({ plugin }) => plugin.id)).toEqual(["alpha"])
  })

  test("a renamed closure without a pointer CAS never changes the previous active generation", async () => {
    const { root, runtime } = await fixture()
    const first = await runtime.publish(0, candidate("alpha"))
    const crashing = new PluginInstallationRuntime(root, {
      faultHook(point) {
        if (point === "closure.renamed-before-pointer") throw new Error("simulated crash")
      },
    })

    await expect(crashing.publish(1, candidate("bravo"))).rejects.toThrow("simulated crash")
    const reopened = await new PluginInstallationRuntime(root).readActive()
    expect(reopened.revision).toBe(1)
    expect(reopened.activeSetDigest).toBe(first.activeSetDigest)
    expect(reopened.plugins.map(({ plugin }) => plugin.id)).toEqual(["alpha"])
  })

  test("a conflicting Plugin-owned Skill name rejects the whole ActiveSet CAS", async () => {
    const { runtime } = await fixture()
    await runtime.publish(0, candidate("alpha", { skillName: "shared-workflow" }))

    await expect(runtime.publish(1, candidate("bravo", { skillName: "shared-workflow" }))).rejects.toThrow(
      "Skill name conflicts",
    )
    const active = await runtime.readActive()
    expect(active.revision).toBe(1)
    expect(active.plugins.map(({ plugin }) => plugin.id)).toEqual(["alpha"])
  })

  test("tampering with active bytes fails startup closed instead of scanning a legacy Plugin directory", async () => {
    const { root, runtime } = await fixture()
    const active = await runtime.publish(0, candidate("alpha"))
    const snapshotDigest = active.plugins[0].identity.snapshotDigest
    const indexPath = path.join(root, "closures", snapshotDigest, "package", "index.html")
    await fs.chmod(indexPath, 0o600)
    await fs.writeFile(indexPath, "<h1>tampered</h1>", { mode: 0o400 })
    await fs.chmod(indexPath, 0o400)

    await expect(new PluginInstallationRuntime(root).readActive()).rejects.toBeInstanceOf(
      PluginInstallationRuntimeError,
    )
    await expect(new PluginInstallationRuntime(root).inspectRetiredHostApiRecovery()).rejects.toThrow(
      "not eligible for retired Host API update recovery",
    )
    const legacy = path.join(root, "legacy-plugins")
    await fs.mkdir(legacy)
    await expect(new PluginInstallationRuntime(root).assertNoLegacyState([legacy])).rejects.toThrow(
      "Unsupported legacy Plugin installation state",
    )
  })

  test("repairs only a byte-valid retired-major ActiveSet through an explicit current-major update", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "convax-plugin-installation-runtime-"))
    roots.push(root)
    const snapshots = new PluginInstallationSnapshotStore(path.join(root, "state"))
    const closures = new PluginInstallationClosureStore(path.join(root, "closures"))
    await closures.ensureLayout()
    const installLegacy = async (id: string) => {
      const legacyManifest = JSON.stringify({
        ...manifest(id),
        hostApi: { major: 1, optional: [], required: ["host.context.get"] },
      })
      const packageFiles = [
        { bytes: Buffer.from(`<h1>${id}</h1>`), path: "index.html" },
        { bytes: Buffer.from(legacyManifest), path: "manifest.json" },
      ]
      const fileIdentities = packageFiles.map((file) => ({
        path: file.path,
        sha256: sha256(file.bytes),
        size: file.bytes.byteLength,
      }))
      const legacyManifestIdentity = fileIdentities.find((file) => file.path === "manifest.json")
      if (!legacyManifestIdentity) throw new Error("Expected a legacy manifest identity")
      const { path: _manifestPath, ...legacyManifestBytes } = legacyManifestIdentity
      const snapshot = await snapshots.putInstalledSnapshot({
        authorizations: { capabilityContractDigest: sha256(legacyManifest) },
        ownedSkills: [],
        package: {
          artifact: { sha256: sha256(`${id} archive`), size: 2_048 },
          files: fileIdentities,
          manifest: legacyManifestBytes,
        },
        pluginId: id,
        sourceIdentity: sha256(`${id}:source`),
        version: "1.0.0",
      })
      await closures.publish(snapshot, packageFiles, undefined)
      return { legacyManifest, snapshot }
    }
    const legacy = await installLegacy("legacy")
    const other = await installLegacy("legacy-other")
    const topologyResult = planPluginCapabilityTopology([])
    if (!topologyResult.ok) throw new Error("Expected an empty Plugin capability topology")
    const published = await snapshots.compareAndSwapActiveSet(0, {
      capabilityTopology: topologyResult.topology,
      plugins: [
        { activationId: sha256("legacy activation"), pluginId: "legacy", snapshotDigest: legacy.snapshot.digest },
        {
          activationId: sha256("legacy-other activation"),
          pluginId: "legacy-other",
          snapshotDigest: other.snapshot.digest,
        },
      ],
    })

    await expect(new PluginInstallationRuntime(root).readActive()).rejects.toThrow(
      "Immutable Plugin manifest is invalid",
    )

    expect(await snapshots.readActive()).toEqual(published)
    expect(
      await fs.readFile(path.join(root, "closures", legacy.snapshot.digest, "package", "manifest.json"), "utf8"),
    ).toBe(legacy.legacyManifest)

    const runtime = new PluginInstallationRuntime(root)
    const recovery = await runtime.inspectRetiredHostApiRecovery()
    expect(recovery).toEqual({
      plugins: [
        {
          artifact: { sha256: sha256("legacy archive"), size: 2_048 },
          hostApiMajor: 1,
          pluginId: "legacy",
          snapshotDigest: legacy.snapshot.digest,
          sourceIdentity: sha256("legacy:source"),
          version: "1.0.0",
        },
        {
          artifact: { sha256: sha256("legacy-other archive"), size: 2_048 },
          hostApiMajor: 1,
          pluginId: "legacy-other",
          snapshotDigest: other.snapshot.digest,
          sourceIdentity: sha256("legacy-other:source"),
          version: "1.0.0",
        },
      ],
      revision: 1,
    })
    await expect(
      runtime.publishRetiredHostApiRecovery(
        1,
        { ...candidate("legacy", { version: "2.0.0" }), sourceIdentity: sha256("wrong source") },
        recovery.plugins[0]!,
      ),
    ).rejects.toThrow("not eligible for retired Host API update recovery")
    await expect(
      runtime.publishRetiredHostApiRecovery(1, candidate("legacy", { version: "2.0.0" }), {
        ...recovery.plugins[0]!,
        artifact: { ...recovery.plugins[0]!.artifact, size: 2_049 },
      }),
    ).rejects.toThrow("not eligible for retired Host API update recovery")
    const repaired = await runtime.publishRetiredHostApiRecovery(
      1,
      {
        ...candidate("legacy", { version: "2.0.0" }),
        sourceIdentity: recovery.plugins[0]!.sourceIdentity,
      },
      recovery.plugins[0]!,
    )
    expect(repaired.revision).toBe(2)
    expect(repaired.plugins.map(({ plugin }) => ({ id: plugin.id, version: plugin.version }))).toEqual([
      { id: "legacy", version: "2.0.0" },
    ])
    expect(
      await fs.readFile(path.join(root, "closures", legacy.snapshot.digest, "package", "manifest.json"), "utf8"),
    ).toBe(legacy.legacyManifest)
    expect(
      await fs.readFile(path.join(root, "closures", other.snapshot.digest, "package", "manifest.json"), "utf8"),
    ).toBe(other.legacyManifest)
  })

  test("requires exact CAS revisions and uninstall never exposes a mixed set", async () => {
    const { runtime } = await fixture()
    await runtime.publish(0, candidate("alpha"))
    await expect(runtime.publish(0, candidate("bravo"))).rejects.toBeInstanceOf(ActivePluginSetRevisionConflictError)
    expect((await runtime.readActive()).plugins.map(({ plugin }) => plugin.id)).toEqual(["alpha"])

    const removed = await runtime.uninstall(1, "alpha")
    expect(removed.revision).toBe(2)
    expect(removed.plugins).toEqual([])
  })

  test("owner-scoped pins retain old closures across update, GC, and restart", async () => {
    const { root, runtime } = await fixture()
    const first = await runtime.publish(0, candidate("alpha"))
    const previous = first.plugins[0].identity
    const previousDigest = previous.snapshotDigest
    await runtime.pinActivePluginForOwner("generation-operation:operation-1", previous)
    await runtime.publish(1, candidate("alpha", { version: "2.0.0" }))

    await runtime.collectGarbage()
    expect(await fs.stat(path.join(root, "closures", previousDigest))).toBeDefined()
    const reopened = new PluginInstallationRuntime(root)
    const retained = await reopened.acquirePinnedPlugin("generation-operation:operation-1", previous)
    expect(await fs.readFile(await retained.resolveAsset("index.html"), "utf8")).toBe("<h1>alpha</h1>")
    retained.release()

    await reopened.unpinPluginOwner("generation-operation:operation-1", previous)
    const collected = await reopened.collectGarbage()
    expect(collected.installedSnapshotDigests).toContain(previousDigest)
    await expect(fs.stat(path.join(root, "closures", previousDigest))).rejects.toMatchObject({ code: "ENOENT" })
    expect((await reopened.readActive()).plugins[0].plugin.version).toBe("2.0.0")
  })

  test("owner-scoped pins merge without a whole-set replacement race", async () => {
    const { runtime } = await fixture()
    const active = await runtime.publish(0, candidate("alpha"))
    const identity = active.plugins[0].identity

    await Promise.all([
      runtime.pinActivePluginForOwner("generation-operation:first", identity),
      runtime.pinActivePluginForOwner("generation-operation:second", identity),
    ])
    expect((await runtime.listOwnerPins()).map(({ ownerKey }) => ownerKey)).toEqual([
      "generation-operation:first",
      "generation-operation:second",
    ])
    await expect(
      runtime.pinActivePluginForOwner("generation-operation:first", {
        ...identity,
        snapshotDigest: "f".repeat(64),
      }),
    ).rejects.toThrow()
  })

  test("resolves only an exact historical ActiveSet snapshot and never falls back to current by id", async () => {
    const { runtime } = await fixture()
    const first = await runtime.publish(0, candidate("alpha"))
    const previous = first.plugins[0].identity
    await runtime.publish(1, candidate("alpha", { version: "2.0.0" }))

    const historical = await runtime.acquirePluginSnapshot({
      activeRevision: previous.activeRevision,
      activeSetDigest: previous.activeSetDigest,
      pluginId: previous.pluginId,
      pluginVersion: previous.version,
      snapshotDigest: previous.snapshotDigest,
    })
    expect(historical.plugin.version).toBe("1.0.0")
    historical.release()
    await expect(
      runtime.acquirePluginSnapshot({
        activeRevision: previous.activeRevision,
        activeSetDigest: previous.activeSetDigest,
        pluginId: previous.pluginId,
        pluginVersion: "2.0.0",
        snapshotDigest: previous.snapshotDigest,
      }),
    ).rejects.toThrow("not observed from a trusted ActiveSet pointer")
    await expect(
      runtime.acquirePluginSnapshot({
        activeRevision: previous.activeRevision + 100,
        activeSetDigest: previous.activeSetDigest,
        pluginId: previous.pluginId,
        pluginVersion: previous.version,
        snapshotDigest: previous.snapshotDigest,
      }),
    ).rejects.toThrow("not observed from a trusted ActiveSet pointer")

    await runtime.collectGarbage()
    await expect(
      runtime.acquirePluginSnapshot({
        activeRevision: previous.activeRevision,
        activeSetDigest: previous.activeSetDigest,
        pluginId: previous.pluginId,
        pluginVersion: previous.version,
        snapshotDigest: previous.snapshotDigest,
      }),
    ).rejects.toThrow()
  })

  test("leases same-version historical bytes through GC and fails closed after release", async () => {
    const { runtime } = await fixture()
    const first = await runtime.publish(0, candidate("alpha", { assetContent: "snapshot-a" }))
    const previous = first.plugins[0].identity
    const second = await runtime.publish(1, candidate("alpha", { assetContent: "snapshot-b" }))
    expect(second.plugins[0].plugin.version).toBe(previous.version)
    expect(second.plugins[0].identity.snapshotDigest).not.toBe(previous.snapshotDigest)

    const historical = await runtime.acquirePluginSnapshot({
      activeRevision: previous.activeRevision,
      activeSetDigest: previous.activeSetDigest,
      pluginId: previous.pluginId,
      pluginVersion: previous.version,
      snapshotDigest: previous.snapshotDigest,
    })
    expect(await fs.readFile(await historical.resolveAsset("index.html"), "utf8")).toBe("snapshot-a")
    expect((await runtime.collectGarbage()).installedSnapshotDigests).not.toContain(previous.snapshotDigest)
    expect(await fs.readFile(await historical.resolveAsset("index.html"), "utf8")).toBe("snapshot-a")

    historical.release()
    expect((await runtime.collectGarbage()).installedSnapshotDigests).toContain(previous.snapshotDigest)
    await expect(
      runtime.acquirePluginSnapshot({
        activeRevision: previous.activeRevision,
        activeSetDigest: previous.activeSetDigest,
        pluginId: previous.pluginId,
        pluginVersion: previous.version,
        snapshotDigest: previous.snapshotDigest,
      }),
    ).rejects.toThrow()
    const current = await runtime.acquireActivePlugin("alpha")
    expect(await fs.readFile(await current.resolveAsset("index.html"), "utf8")).toBe("snapshot-b")
    current.release()
  })

  test("atomically leases one exact ActiveSet with its caller and provider snapshots", async () => {
    const { runtime } = await fixture()
    await runtime.publish(0, candidate("caller"))
    const active = await runtime.publish(1, candidate("provider"))
    const caller = active.plugins.find(({ plugin }) => plugin.id === "caller")!
    const provider = active.plugins.find(({ plugin }) => plugin.id === "provider")!
    const lease = await runtime.acquireActiveSetCallLease(
      { activeRevision: active.revision, activeSetDigest: active.activeSetDigest! },
      caller.identity.snapshotDigest,
      provider.identity.snapshotDigest,
    )

    expect(lease).toMatchObject({
      activeRevision: 2,
      activeSetDigest: active.activeSetDigest,
      callerSnapshotDigest: caller.identity.snapshotDigest,
      providerSnapshotDigest: provider.identity.snapshotDigest,
      released: false,
    })
    await runtime.publish(2, candidate("caller", { version: "2.0.0" }))
    await expect(
      runtime.acquireActiveSetCallLease(
        { activeRevision: active.revision, activeSetDigest: active.activeSetDigest! },
        caller.identity.snapshotDigest,
        provider.identity.snapshotDigest,
      ),
    ).rejects.toThrow("changed before the capability call lease")
    lease.release()
    expect(lease.released).toBeTrue()
  })

  test("leases every Hook and Skill consumer from one ActiveSet generation", async () => {
    const { runtime } = await fixture()
    await runtime.publish(0, candidate("alpha", { skillName: "alpha-workflow" }))
    const current = await runtime.publish(1, candidate("bravo", { skillName: "bravo-workflow" }))
    const set = await runtime.acquireActivePluginSet()
    if (!current.activeSetDigest) throw new Error("Expected an active Plugin set")

    expect(set.activeSetDigest).toBe(current.activeSetDigest)
    expect(set.plugins.map(({ identity }) => identity.activeRevision)).toEqual([2, 2])
    expect(set.plugins.map(({ identity }) => identity.activeSetDigest)).toEqual([
      current.activeSetDigest,
      current.activeSetDigest,
    ])
    set.release()
    expect(set.released).toBeTrue()
    expect(set.plugins.every((handle) => handle.released)).toBeTrue()
  })

  test("rejects an incomplete required capability graph before the ActiveSet CAS", async () => {
    const { runtime } = await fixture()
    await expect(
      runtime.publish(
        0,
        candidate("caller", { capabilityDeclaration: capabilityDeclaration({ required: ["media.render"] }) }),
      ),
    ).rejects.toThrow("required-provider-missing")
    expect(await runtime.readActive()).toMatchObject({ plugins: [], revision: 0 })
  })

  test("persists and reuses one deterministic capability topology for provider and caller", async () => {
    const { runtime } = await fixture()
    await runtime.publish(
      0,
      candidate("provider", {
        capabilityDeclaration: capabilityDeclaration({ exports: ["media.render"] }),
        companion: true,
      }),
    )
    const active = await runtime.publish(
      1,
      candidate("caller", { capabilityDeclaration: capabilityDeclaration({ required: ["media.render"] }) }),
    )
    const plan = await runtime.loadPublishedCapabilityPlan()

    expect(plan).toMatchObject({
      activeRevision: active.revision,
      activeSetDigest: active.activeSetDigest,
    })
    expect(plan?.bindings).toHaveLength(1)
    expect(plan?.bindings[0]).toMatchObject({
      availability: { available: true, capabilityId: "media.render" },
      caller: { pluginId: "caller" },
      provider: { pluginId: "provider" },
      requirement: "required",
    })
    await expect(runtime.uninstall(active.revision, "provider")).rejects.toThrow("required-provider-missing")
    expect((await runtime.readActive()).plugins.map(({ plugin }) => plugin.id)).toEqual(["caller", "provider"])
  })
})
