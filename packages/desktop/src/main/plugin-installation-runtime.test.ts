/* oxlint-disable typescript-eslint/await-thenable -- Bun's async `.rejects` matcher is thenable at runtime. */
import { afterEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { parsePluginCapabilityDeclaration, type PluginCapabilityDeclaration } from "@convax/plugin-sdk"

import { ActivePluginSetRevisionConflictError, pluginSnapshotCanonicalDigest } from "./plugin-installation-snapshots"
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
      major: 1,
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

    handle.release()
    handle.release()
    expect(handle.released).toBe(true)
    await expect(handle.resolveAsset("index.html")).rejects.toThrow("lease has been released")
  })

  test("keeps verified companion bytes inert until the snapshot carries an exact setup binding", async () => {
    const { runtime } = await fixture()
    await runtime.publish(0, candidate("alpha", { companion: true }))

    const handle = await runtime.acquireActivePlugin("alpha")
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
    authorizedHandle.release()
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
    if (process.platform !== "win32") await fs.chmod(indexPath, 0o600)
    await fs.writeFile(indexPath, "<h1>tampered</h1>", { mode: 0o400 })
    if (process.platform !== "win32") await fs.chmod(indexPath, 0o400)

    await expect(new PluginInstallationRuntime(root).readActive()).rejects.toBeInstanceOf(
      PluginInstallationRuntimeError,
    )
    const legacy = path.join(root, "legacy-plugins")
    await fs.mkdir(legacy)
    await expect(new PluginInstallationRuntime(root).assertNoLegacyState([legacy])).rejects.toThrow(
      "Unsupported legacy Plugin installation state",
    )
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
