/* oxlint-disable typescript-eslint/await-thenable -- Bun's async matchers are thenable at runtime. */
import { afterEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { parsePluginCapabilityDeclaration, type PluginCapabilityDeclaration } from "@convax/plugin-sdk"
import type { PluginCapabilityBrokerLimits } from "./plugin-capability-broker"
import { PluginCapabilityBrokerMainService } from "./plugin-capability-broker-service"
import { PluginCanvasCapabilityService } from "./plugin-canvas-capability-service"
import { PluginHostApiService } from "./plugin-host-api-service"
import {
  pluginCapabilityInvocationAuthoritySchema,
  pluginCapabilityNestedInvokeMcpMethod,
} from "./plugin-capability-sidecar-bridge"
import {
  GenerationPluginRuntime,
  generationPluginToolHostId,
  type GenerationPluginMcpClient,
} from "./generation-plugin-runtime"
import { PluginInstallationRuntime, type PluginInstallationCandidate } from "./plugin-installation-runtime"
import { InstalledPluginPrincipalResolver } from "./plugin-principal-resolver"
import { toolPluginCompanionMcpMethod } from "./tool-plugin-canvas-capabilities"
import type {
  McpToolDefinition,
  PluginCapabilityToolOperationMetadata,
  StdioMcpClientOptions,
} from "./stdio-mcp-client"

const roots: string[] = []

function sha256(value: string | Uint8Array) {
  return createHash("sha256").update(value).digest("hex")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

const valueSchema = {
  additionalProperties: false,
  properties: { text: { maxLength: 128, type: "string" } },
  required: ["text"],
  type: "object",
} as const

function declaration(input: {
  exports?: readonly { id: string; operation: string }[]
  optional?: readonly string[]
  required?: readonly string[]
}): PluginCapabilityDeclaration {
  return parsePluginCapabilityDeclaration({
    exports: (input.exports ?? []).map(({ id, operation }) => ({
      docs: { request: "Text.", response: "Text.", summary: `Provides ${id}.` },
      id,
      inputSchema: valueSchema,
      operation,
      outputSchema: valueSchema,
      sideEffect: "execute",
      version: "1.0.0",
    })),
    imports: {
      optional: (input.optional ?? []).map((id) => ({
        id,
        inputSchema: valueSchema,
        outputSchema: valueSchema,
        version: { maximumExclusive: "2.0.0", minimum: "1.0.0" },
      })),
      required: (input.required ?? []).map((id) => ({
        id,
        inputSchema: valueSchema,
        outputSchema: valueSchema,
        version: { maximumExclusive: "2.0.0", minimum: "1.0.0" },
      })),
    },
  })
}

function candidate(
  id: string,
  capabilities: PluginCapabilityDeclaration,
  options: {
    authorized?: boolean
    canvasRead?: boolean
    generation?: boolean
    headless?: boolean
    version?: string
  } = {},
): PluginInstallationCandidate {
  const version = options.version ?? "1.0.0"
  const executable = capabilities.exports.length > 0
  const manifest = {
    capabilities: options.canvasRead ? ["projects.read"] : [],
    contributes: {
      capabilities,
      ...(options.headless ? {} : { canvas: { renderer: { create: true } } }),
      ...(options.generation
        ? {
            generation: {
              models: [{ name: `${id} generation`, tool: "generate.image" }],
              tools: [
                {
                  acceptedInputs: ["text"],
                  description: "Generate an image",
                  id: "generate.image",
                  output: "image",
                  title: "Generate",
                },
              ],
            },
          }
        : {}),
    },
    description: `${id} capability integration fixture`,
    ...(options.headless ? {} : { entry: "index.html" }),
    hostApi: {
      major: 1,
      optional: [],
      required: options.headless
        ? options.canvasRead
          ? ["projects.list"]
          : []
        : options.canvasRead
          ? ["host.context.get", "projects.list"]
          : ["host.context.get"],
    },
    id,
    name: id,
    ...(executable ? { runtime: { command: `${id}-tool`, type: "mcp-stdio" } } : {}),
    schema: "convax.plugin/8",
    version,
  }
  return {
    artifact: { sha256: sha256(`${id}:${version}:archive`), size: 1_024 },
    ...(executable
      ? {
          companion: {
            bytes: Buffer.from(`${id}:${version}:companion`),
            entryPath: `bin/${id}-tool`,
            mode: "native" as const,
            target: "darwin-arm64",
          },
        }
      : {}),
    ...(!executable || options.authorized === false ? {} : { executionAuthorization: { companion: true } }),
    files: {
      "index.html": `<h1>${id}</h1>`,
      "manifest.json": JSON.stringify(manifest),
    },
    sourceIdentity: sha256(`${id}:source`),
  }
}

interface FakeCall {
  readonly client: number
  readonly operationId: string
  readonly tool: string
}

class FakeSidecarClient implements GenerationPluginMcpClient {
  readonly id: number
  readonly options: StdioMcpClientOptions
  readonly tools: readonly McpToolDefinition[]
  readonly calls: FakeCall[]
  readonly hold?: Promise<void>
  readonly listHold?: Promise<void>
  readonly onListTools?: () => void
  readonly reverseCanvas: boolean
  closed = false
  lastCapabilityOperation?: PluginCapabilityToolOperationMetadata
  listClientIds: number[]

  constructor(input: {
    calls: FakeCall[]
    hold?: Promise<void>
    id: number
    listClientIds: number[]
    listHold?: Promise<void>
    onListTools?: () => void
    options: StdioMcpClientOptions
    reverseCanvas?: boolean
    tools: readonly McpToolDefinition[]
  }) {
    this.calls = input.calls
    this.hold = input.hold
    this.id = input.id
    this.listClientIds = input.listClientIds
    this.listHold = input.listHold
    this.onListTools = input.onListTools
    this.options = input.options
    this.reverseCanvas = input.reverseCanvas ?? false
    this.tools = input.tools
  }

  async listTools(signal?: AbortSignal) {
    this.listClientIds.push(this.id)
    this.onListTools?.()
    if (this.listHold) {
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => signal?.removeEventListener("abort", onAbort)
        const onAbort = () => {
          cleanup()
          const error = new Error("Operation was canceled")
          error.name = "AbortError"
          reject(error)
        }
        if (signal?.aborted) {
          onAbort()
          return
        }
        signal?.addEventListener("abort", onAbort, { once: true })
        void this.listHold!.then(
          () => {
            cleanup()
            resolve()
          },
          (error) => {
            cleanup()
            reject(error)
          },
        )
      })
    }
    return this.tools
  }

  async callPluginCapabilityTool(
    tool: string,
    input: Record<string, unknown>,
    operation: PluginCapabilityToolOperationMetadata,
  ) {
    this.calls.push({ client: this.id, operationId: operation.operationId, tool })
    this.lastCapabilityOperation = operation
    if (this.reverseCanvas) {
      await this.options.serverRequestHandler!.handle(
        {
          method: toolPluginCompanionMcpMethod("projects.list"),
          params: {
            _meta: {
              convaxPluginCapability: {
                authorityToken: operation.authorityToken,
                operationId: operation.operationId,
                schema: pluginCapabilityInvocationAuthoritySchema,
              },
            },
          },
        },
        { sendNotification() {}, signal: new AbortController().signal },
      )
    }
    await this.hold
    return { content: [], structuredContent: input }
  }

  async callTool(name: string, input: Record<string, unknown>) {
    return { content: [], structuredContent: input }
  }

  close() {
    this.closed = true
  }
}

async function runtimeFixture(
  input: {
    admission?: "enabled" | "disabled" | "recovering"
    hold?: Promise<void>
    providerAuthorized?: boolean
    providerGeneration?: boolean
    reverseCanvas?: boolean
    failFirstCapabilityStart?: boolean
    limits?: PluginCapabilityBrokerLimits
    listHold?: Promise<void>
    onListTools?: () => void
    onResolveCompanion?: () => void
    onResolveCapabilityIdentity?: () => void
    resolveCompanionGate?: Promise<void>
    resolveCapabilityIdentityGate?: Promise<void>
    tools?: readonly McpToolDefinition[]
  } = {},
) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "convax-p2p-production-"))
  roots.push(root)
  const installations = new PluginInstallationRuntime(path.join(root, "installations"))
  const exported = declaration({
    exports: [{ id: "media.transform", operation: "media.transform" }],
  })
  let active = await installations.publish(
    0,
    candidate("provider", exported, {
      authorized: input.providerAuthorized,
      canvasRead: input.reverseCanvas,
      generation: input.providerGeneration,
      headless: true,
    }),
  )
  active = await installations.publish(
    active.revision,
    candidate("caller", declaration({ required: ["media.transform"] })),
  )
  const calls: FakeCall[] = []
  const clients: FakeSidecarClient[] = []
  const commands: string[] = []
  const listClientIds: number[] = []
  let clientId = 0
  let admission = input.admission ?? "enabled"
  const defaultTools: readonly McpToolDefinition[] = [
    {
      inputSchema: valueSchema,
      name: "media.transform",
      outputSchema: valueSchema,
    },
    ...(input.providerGeneration
      ? [
          {
            inputSchema: {
              additionalProperties: false,
              properties: { prompt: { maxLength: 128, type: "string" } },
              required: ["prompt"],
              type: "object",
            },
            name: "generate.image",
          } satisfies McpToolDefinition,
        ]
      : []),
  ]
  const principals = new InstalledPluginPrincipalResolver(installations)
  const canvasCapabilities = input.reverseCanvas
    ? new PluginCanvasCapabilityService({
        application: {
          async executeTransaction() {
            throw new Error("Unexpected Canvas transaction")
          },
          async query() {
            throw new Error("Unexpected Canvas query")
          },
        },
        canvases: {
          async getCanvasCatalog({ projectId }) {
            return { canvases: [], projectId, revision: 0 }
          },
        },
        changes: {
          publish() {},
          subscribe() {
            return { close() {} }
          },
        },
        documents: {
          async load() {
            throw new Error("Unexpected Canvas document read")
          },
          async save() {
            throw new Error("Unexpected Canvas document write")
          },
        },
        plugins: principals,
        projects: {
          async list() {
            return [
              {
                createdAt: 1,
                id: "project-one",
                lastOpenedAt: 1,
                missing: false,
                name: "One",
                rootPath: "/private/project-one",
              },
            ]
          },
        },
      })
    : undefined
  const unexpectedHostOperation = async (): Promise<never> => {
    throw new Error("Unexpected node-scoped Host API operation")
  }
  const hostApi = canvasCapabilities
    ? new PluginHostApiService({
        nodes: {
          async resolve() {
            return null
          },
        },
        operations: {
          closeConnection() {},
          closeInput: unexpectedHostOperation,
          closeImageInput: unexpectedHostOperation,
          createCanvasImage: unexpectedHostOperation,
          executeGeneration: unexpectedHostOperation,
          listGenerationTools: unexpectedHostOperation,
          listInputs: unexpectedHostOperation,
          openInput: unexpectedHostOperation,
          openImageInput: unexpectedHostOperation,
          promptAgent: unexpectedHostOperation,
          readProjectText: unexpectedHostOperation,
          replaceNodeState: unexpectedHostOperation,
        },
        principals: {
          async liveState() {
            return { disabled: false, recovering: false, setupComplete: true }
          },
          async resolve(principal) {
            const resolved = await principals.resolve(principal)
            return resolved ? { ...resolved, pluginName: principal.pluginId } : null
          },
        },
      })
    : undefined
  let failFirstCapabilityStart = input.failFirstCapabilityStart ?? false
  const pluginSource =
    input.resolveCapabilityIdentityGate ||
    input.onResolveCapabilityIdentity ||
    input.resolveCompanionGate ||
    input.onResolveCompanion ||
    input.failFirstCapabilityStart
      ? (new Proxy(installations, {
          get(target, property) {
            if (property === "acquirePluginSnapshot") {
              return async (identity: Parameters<PluginInstallationRuntime["acquirePluginSnapshot"]>[0]) => {
                const handle = await target.acquirePluginSnapshot(identity)
                if (failFirstCapabilityStart) {
                  failFirstCapabilityStart = false
                  return {
                    ...handle,
                    async resolveCompanion() {
                      throw new Error("injected exact runtime start failure")
                    },
                  }
                }
                if (input.resolveCompanionGate || input.onResolveCompanion) {
                  return {
                    ...handle,
                    async resolveCompanion() {
                      input.onResolveCompanion?.()
                      await input.resolveCompanionGate
                      return handle.resolveCompanion()
                    },
                  }
                }
                return handle
              }
            }
            if (property === "resolveCapabilityIdentity") {
              return async (pluginId: string) => {
                input.onResolveCapabilityIdentity?.()
                await input.resolveCapabilityIdentityGate
                return target.resolveCapabilityIdentity(pluginId)
              }
            }
            const value = Reflect.get(target, property, target) as unknown
            return typeof value === "function" ? value.bind(target) : value
          },
        }) as PluginInstallationRuntime)
      : installations
  const sidecars = new GenerationPluginRuntime({
    ...(canvasCapabilities && hostApi
      ? {
          canvasCapabilities: {
            async connect(request) {
              const canvas = await canvasCapabilities.connect(
                { principal: request.principal, scope: request.scope },
                request.invocationLease,
              )
              return hostApi.connect({ ...request, canvas })
            },
            principals,
          },
        }
      : {}),
    createClient: (options) => {
      commands.push(options.command)
      const client = new FakeSidecarClient({
        calls,
        hold: input.hold,
        id: ++clientId,
        listClientIds,
        listHold: input.listHold,
        onListTools: input.onListTools,
        options,
        reverseCanvas: input.reverseCanvas,
        tools: input.tools ?? defaultTools,
      })
      clients.push(client)
      return client
    },
    environment: {},
    pluginRuntimeState: async () => admission,
    platform: "darwin",
    plugins: pluginSource,
  })
  const service = new PluginCapabilityBrokerMainService({
    installations,
    ...(input.limits === undefined ? {} : { limits: input.limits }),
    principals,
    sidecars,
  })
  return {
    active,
    calls,
    clients,
    commands,
    installations,
    listClientIds,
    principals,
    service,
    setAdmission(next: typeof admission) {
      admission = next
    },
    sidecars,
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { force: true, recursive: true })))
})

describe("Plugin capability production composition", () => {
  test("executes a real two-Plugin ActiveSet binding against the same sidecar generation used for tools/list", async () => {
    const fixture = await runtimeFixture()
    const principal = await fixture.principals.issue("caller", "web")
    await expect(fixture.service.getAvailability(principal, "media.transform")).resolves.toEqual({
      available: true,
      capabilityId: "media.transform",
      requirement: "required",
      version: "1.0.0",
    })
    await expect(
      fixture.service.invoke(principal, {
        capabilityId: "media.transform",
        input: { text: "hello" },
        requestId: "two-plugin-call",
      }),
    ).resolves.toEqual({ text: "hello" })
    expect(fixture.calls).toHaveLength(1)
    expect(fixture.calls[0]).toMatchObject({ client: 1, tool: "media.transform" })
    expect(fixture.listClientIds).toEqual([1, 1])
    expect(path.isAbsolute(fixture.commands[0])).toBeTrue()
    expect(fixture.commands[0]).not.toBe("provider-tool")
    fixture.sidecars.dispose()
  })

  test("single-flights cold broker construction and one exact provider process", async () => {
    let releasePlan!: () => void
    const planGate = new Promise<void>((resolve) => {
      releasePlan = resolve
    })
    let observePlan!: () => void
    const planObserved = new Promise<void>((resolve) => {
      observePlan = resolve
    })
    let loadCount = 0
    let releaseList!: () => void
    const listGate = new Promise<void>((resolve) => {
      releaseList = resolve
    })
    let observeList!: () => void
    const listObserved = new Promise<void>((resolve) => {
      observeList = resolve
    })
    const fixture = await runtimeFixture({ listHold: listGate, onListTools: observeList })
    const service = new PluginCapabilityBrokerMainService({
      installations: {
        acquireActiveSetCallLease: (...args) => fixture.installations.acquireActiveSetCallLease(...args),
        loadPublishedCapabilityPlan: async () => {
          loadCount += 1
          observePlan()
          await planGate
          return fixture.installations.loadPublishedCapabilityPlan()
        },
      },
      principals: fixture.principals,
      sidecars: fixture.sidecars,
    })
    const principal = await fixture.principals.issue("caller", "web")
    const first = service.getAvailability(principal, "media.transform")
    await planObserved
    const second = service.getAvailability(principal, "media.transform")
    await Promise.resolve()
    expect(loadCount).toBe(1)
    releasePlan()
    await listObserved
    expect(fixture.clients).toHaveLength(1)
    releaseList()
    await expect(Promise.all([first, second])).resolves.toEqual([
      {
        available: true,
        capabilityId: "media.transform",
        requirement: "required",
        version: "1.0.0",
      },
      {
        available: true,
        capabilityId: "media.transform",
        requirement: "required",
        version: "1.0.0",
      },
    ])
    expect(new Set(fixture.listClientIds)).toEqual(new Set([1]))
    await fixture.sidecars.disposeAndWait()
  })

  test("removes rejected broker and exact-runtime starts so the next attempt can recover", async () => {
    const fixture = await runtimeFixture({ failFirstCapabilityStart: true })
    let loadCount = 0
    let failPlan = true
    const service = new PluginCapabilityBrokerMainService({
      installations: {
        acquireActiveSetCallLease: (...args) => fixture.installations.acquireActiveSetCallLease(...args),
        loadPublishedCapabilityPlan: async () => {
          loadCount += 1
          if (failPlan) {
            failPlan = false
            throw new Error("injected plan load failure")
          }
          return fixture.installations.loadPublishedCapabilityPlan()
        },
      },
      principals: fixture.principals,
      sidecars: fixture.sidecars,
    })
    const principal = await fixture.principals.issue("caller", "web")
    await expect(service.getAvailability(principal, "media.transform")).rejects.toThrow("plan load failure")
    await expect(service.getAvailability(principal, "media.transform")).resolves.toMatchObject({
      available: false,
      reason: "recovering",
    })
    await expect(service.getAvailability(principal, "media.transform")).resolves.toMatchObject({
      available: true,
    })
    expect(loadCount).toBe(2)
    expect(fixture.clients).toHaveLength(1)
    await fixture.sidecars.disposeAndWait()
  })

  test("isolates the same provider snapshot across different exact ActiveSet identities", async () => {
    let releaseList!: () => void
    const listGate = new Promise<void>((resolve) => {
      releaseList = resolve
    })
    let observeList!: () => void
    const listObserved = new Promise<void>((resolve) => {
      observeList = resolve
    })
    const fixture = await runtimeFixture({ listHold: listGate, onListTools: observeList })
    const oldPlan = await fixture.installations.loadPublishedCapabilityPlan()
    const oldProvider = oldPlan.plugins.find(({ identity }) => identity.pluginId === "provider")!.identity
    const oldInspection = fixture.sidecars.inspect(oldProvider)
    await listObserved

    await fixture.installations.publish(
      fixture.active.revision,
      candidate("caller", declaration({ required: ["media.transform"] }), { version: "1.0.1" }),
    )
    const newPlan = await fixture.installations.loadPublishedCapabilityPlan()
    const newProvider = newPlan.plugins.find(({ identity }) => identity.pluginId === "provider")!.identity
    expect(newProvider.snapshotDigest).toBe(oldProvider.snapshotDigest)
    expect([newProvider.activeRevision, newProvider.activeSetDigest]).not.toEqual([
      oldProvider.activeRevision,
      oldProvider.activeSetDigest,
    ])
    const newInspection = fixture.sidecars.inspect(newProvider)
    for (let attempt = 0; attempt < 1_000 && fixture.clients.length < 2; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1))
    }
    expect(fixture.clients).toHaveLength(2)
    releaseList()
    const [oldRuntime, newRuntime] = await Promise.all([oldInspection, newInspection])
    expect(oldRuntime.state).toBe("ready")
    expect(newRuntime.state).toBe("ready")
    if (oldRuntime.state === "ready" && newRuntime.state === "ready") {
      expect(oldRuntime.generation).not.toBe(newRuntime.generation)
      oldRuntime.release()
      newRuntime.release()
    }
    await fixture.sidecars.disposeAndWait()
  })

  test("shutdown cancels and drains an exact runtime start before releasing its snapshot handle", async () => {
    let releaseCompanion!: () => void
    const companionGate = new Promise<void>((resolve) => {
      releaseCompanion = resolve
    })
    let observeCompanion!: () => void
    const companionObserved = new Promise<void>((resolve) => {
      observeCompanion = resolve
    })
    const fixture = await runtimeFixture({
      onResolveCompanion: observeCompanion,
      resolveCompanionGate: companionGate,
    })
    const plan = await fixture.installations.loadPublishedCapabilityPlan()
    const provider = plan.plugins.find(({ identity }) => identity.pluginId === "provider")!.identity
    const inspection = fixture.sidecars.inspect(provider)
    await companionObserved
    let shutdownSettled = false
    const shutdown = fixture.sidecars.disposeAndWait().then(() => {
      shutdownSettled = true
    })
    await Promise.resolve()
    expect(shutdownSettled).toBeFalse()
    releaseCompanion()
    await shutdown
    await expect(inspection).resolves.toEqual({ state: "recovering" })
    expect(fixture.clients).toHaveLength(0)
  })

  test("shares one process when a provider exposes generation and Plugin capabilities", async () => {
    const fixture = await runtimeFixture({ providerGeneration: true })
    const principal = await fixture.principals.issue("caller", "web")

    await expect(
      fixture.service.invoke(principal, {
        capabilityId: "media.transform",
        input: { text: "capability" },
        requestId: "shared-capability",
      }),
    ).resolves.toEqual({ text: "capability" })
    await expect(
      fixture.sidecars.callTool(generationPluginToolHostId("provider", "generate.image"), {
        prompt: "generation",
      }),
    ).resolves.toMatchObject({ structuredContent: { prompt: "generation" } })

    expect(fixture.commands).toHaveLength(1)
    expect(fixture.listClientIds.every((id) => id === 1)).toBeTrue()
    fixture.sidecars.dispose()
  })

  test("reports setup, disabled, recovering, and contract-mismatch without tools/call", async () => {
    const setup = await runtimeFixture({ providerAuthorized: false })
    const setupPrincipal = await setup.principals.issue("caller", "web")
    await expect(setup.service.getAvailability(setupPrincipal, "media.transform")).resolves.toMatchObject({
      available: false,
      reason: "setup-required",
    })
    expect(setup.calls).toHaveLength(0)
    setup.sidecars.dispose()

    const gated = await runtimeFixture({ admission: "disabled" })
    const principal = await gated.principals.issue("caller", "web")
    await expect(gated.service.getAvailability(principal, "media.transform")).resolves.toMatchObject({
      available: false,
      reason: "disabled",
    })
    gated.setAdmission("recovering")
    await expect(gated.service.getAvailability(principal, "media.transform")).resolves.toMatchObject({
      available: false,
      reason: "recovering",
    })
    expect(gated.calls).toHaveLength(0)
    gated.sidecars.dispose()

    const mismatch = await runtimeFixture({
      tools: [{ inputSchema: valueSchema, name: "media.transform" }],
    })
    const mismatchPrincipal = await mismatch.principals.issue("caller", "web")
    await expect(mismatch.service.getAvailability(mismatchPrincipal, "media.transform")).resolves.toMatchObject({
      available: false,
      reason: "contract-mismatch",
    })
    expect(mismatch.calls).toHaveLength(0)
    mismatch.sidecars.dispose()
  })

  test("rejects update-before-call with zero side effects and lets an accepted leased call finish old bytes", async () => {
    let releaseCall!: () => void
    let observedCall!: () => void
    const observed = new Promise<void>((resolve) => {
      observedCall = resolve
    })
    const hold = new Promise<void>((resolve) => {
      releaseCall = resolve
    })
    const fixture = await runtimeFixture({ hold })
    const originalPrincipal = await fixture.principals.issue("caller", "web")
    const originalCallCount = fixture.calls.length

    const accepted = fixture.service.invoke(originalPrincipal, {
      capabilityId: "media.transform",
      input: { text: "accepted" },
      requestId: "accepted-before-update",
    })
    const poll = setInterval(() => {
      if (fixture.calls.length > originalCallCount) observedCall()
    }, 1)
    await observed
    clearInterval(poll)

    const updated = await fixture.installations.publish(
      fixture.active.revision,
      candidate(
        "provider",
        declaration({
          exports: [{ id: "media.transform", operation: "media.transform" }],
        }),
        { version: "1.0.1" },
      ),
    )
    fixture.sidecars.disposePlugin("provider")
    releaseCall()
    await expect(accepted).resolves.toEqual({ text: "accepted" })

    const callsAfterAccepted = fixture.calls.length
    await expect(
      fixture.service.invoke(originalPrincipal, {
        capabilityId: "media.transform",
        input: { text: "stale" },
        requestId: "stale-after-update",
      }),
    ).rejects.toThrow("stale")
    expect(fixture.calls).toHaveLength(callsAfterAccepted)
    expect(updated.revision).toBeGreaterThan(fixture.active.revision)
    fixture.sidecars.dispose()
  })

  test("starts an accepted historical process after update with one invocation-scoped reverse Canvas lease", async () => {
    let releaseCall!: () => void
    const hold = new Promise<void>((resolve) => {
      releaseCall = resolve
    })
    let releaseLease!: () => void
    const leaseGate = new Promise<void>((resolve) => {
      releaseLease = resolve
    })
    let observedLease!: () => void
    const leaseObserved = new Promise<void>((resolve) => {
      observedLease = resolve
    })
    const fixture = await runtimeFixture({ hold, reverseCanvas: true })
    const historicalService = new PluginCapabilityBrokerMainService({
      installations: {
        acquireActiveSetCallLease: async (...args) => {
          const lease = await fixture.installations.acquireActiveSetCallLease(...args)
          observedLease()
          await leaseGate
          return lease
        },
        loadPublishedCapabilityPlan: () => fixture.installations.loadPublishedCapabilityPlan(),
      },
      principals: fixture.principals,
      sidecars: fixture.sidecars,
    })
    const originalPrincipal = await fixture.principals.issue("caller", "web")
    const accepted = historicalService.invoke(originalPrincipal, {
      capabilityId: "media.transform",
      input: { text: "historical" },
      requestId: "historical-reverse-canvas",
    })
    await leaseObserved

    const updated = await fixture.installations.publish(
      fixture.active.revision,
      candidate(
        "provider",
        declaration({
          exports: [{ id: "media.transform", operation: "media.transform" }],
        }),
        { canvasRead: true, headless: true, version: "1.0.1" },
      ),
    )
    fixture.sidecars.disposePlugin("provider")
    releaseLease()

    for (let attempt = 0; attempt < 1_000 && fixture.calls.length === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1))
    }
    if (fixture.calls.length === 0) await accepted
    const historicalClient = fixture.clients[0]
    const metadata = historicalClient.lastCapabilityOperation!
    const hostRequest = (authorityToken: string, operationId: string) => ({
      method: toolPluginCompanionMcpMethod("projects.list"),
      params: {
        _meta: {
          convaxPluginCapability: {
            authorityToken,
            operationId,
            schema: pluginCapabilityInvocationAuthoritySchema,
          },
        },
      },
    })
    await expect(
      historicalClient.options.serverRequestHandler!.handle(hostRequest(metadata.authorityToken, "e".repeat(64)), {
        sendNotification() {},
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow("not active")
    await expect(
      historicalClient.options.serverRequestHandler!.handle(hostRequest("Z".repeat(43), metadata.operationId), {
        sendNotification() {},
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow("not active")

    releaseCall()
    await expect(accepted).resolves.toEqual({ text: "historical" })
    await expect(
      historicalClient.options.serverRequestHandler!.handle(
        hostRequest(metadata.authorityToken, metadata.operationId),
        { sendNotification() {}, signal: new AbortController().signal },
      ),
    ).rejects.toThrow("not active")
    await expect(
      historicalService.invoke(originalPrincipal, {
        capabilityId: "media.transform",
        input: { text: "stale" },
        requestId: "historical-stale-replay",
      }),
    ).rejects.toThrow("stale")

    const currentPrincipal = await fixture.principals.issue("caller", "web")
    await expect(
      fixture.service.invoke(currentPrincipal, {
        capabilityId: "media.transform",
        input: { text: "current" },
        requestId: "current-after-historical",
      }),
    ).resolves.toEqual({ text: "current" })
    expect(updated.revision).toBeGreaterThan(fixture.active.revision)
    expect(fixture.clients).toHaveLength(2)
    fixture.sidecars.dispose()
  })

  test("aborting tools/list releases the runtime, complete ActiveSet lease, and broker capacity", async () => {
    let releaseList!: () => void
    const listHold = new Promise<void>((resolve) => {
      releaseList = resolve
    })
    let observeList!: () => void
    const listObserved = new Promise<void>((resolve) => {
      observeList = resolve
    })
    const fixture = await runtimeFixture({
      limits: { maximumInFlight: 1, maximumInFlightPerCaller: 1 },
      listHold,
      onListTools: observeList,
    })
    let pairLeaseReleases = 0
    const service = new PluginCapabilityBrokerMainService({
      installations: {
        acquireActiveSetCallLease: async (...args) => {
          const lease = await fixture.installations.acquireActiveSetCallLease(...args)
          return {
            ...lease,
            get released() {
              return lease.released
            },
            release() {
              if (!lease.released) pairLeaseReleases += 1
              lease.release()
            },
          }
        },
        loadPublishedCapabilityPlan: () => fixture.installations.loadPublishedCapabilityPlan(),
      },
      limits: { maximumInFlight: 1, maximumInFlightPerCaller: 1 },
      principals: fixture.principals,
      sidecars: fixture.sidecars,
    })
    const principal = await fixture.principals.issue("caller", "web")
    const controller = new AbortController()
    const canceled = service.invoke(
      principal,
      {
        capabilityId: "media.transform",
        input: { text: "cancel readiness" },
        requestId: "cancel-readiness",
      },
      controller.signal,
    )
    await listObserved
    controller.abort("caller canceled readiness")
    await expect(canceled).rejects.toMatchObject({ code: "aborted" })
    expect(pairLeaseReleases).toBe(1)
    expect(fixture.clients).toHaveLength(1)
    expect(fixture.clients[0]?.closed).toBeTrue()

    releaseList()
    await expect(
      service.invoke(principal, {
        capabilityId: "media.transform",
        input: { text: "after cancel" },
        requestId: "after-cancel-readiness",
      }),
    ).resolves.toEqual({ text: "after cancel" })
    expect(pairLeaseReleases).toBe(2)
    expect(fixture.clients).toHaveLength(2)
    fixture.sidecars.dispose()
  })

  test("binds accepted discovery to the old exact snapshot across an ActiveSet switch barrier", async () => {
    let releaseIdentity!: () => void
    const identityGate = new Promise<void>((resolve) => {
      releaseIdentity = resolve
    })
    let observeIdentity!: () => void
    const identityObserved = new Promise<void>((resolve) => {
      observeIdentity = resolve
    })
    const fixture = await runtimeFixture({
      onResolveCapabilityIdentity: observeIdentity,
      resolveCapabilityIdentityGate: identityGate,
    })
    const originalPrincipal = await fixture.principals.issue("caller", "web")
    const accepted = fixture.service.invoke(originalPrincipal, {
      capabilityId: "media.transform",
      input: { text: "old exact bytes" },
      requestId: "identity-discovery-switch",
    })
    await identityObserved

    const updated = await fixture.installations.publish(
      fixture.active.revision,
      candidate(
        "provider",
        declaration({
          exports: [{ id: "media.transform", operation: "media.transform" }],
        }),
        { headless: true, version: "1.0.1" },
      ),
    )
    releaseIdentity()
    await expect(accepted).resolves.toEqual({ text: "old exact bytes" })
    expect(fixture.clients).toHaveLength(1)

    const currentPrincipal = await fixture.principals.issue("caller", "web")
    await expect(
      fixture.service.invoke(currentPrincipal, {
        capabilityId: "media.transform",
        input: { text: "new exact bytes" },
        requestId: "after-identity-discovery-switch",
      }),
    ).resolves.toEqual({ text: "new exact bytes" })
    expect(updated.revision).toBeGreaterThan(fixture.active.revision)
    expect(fixture.clients).toHaveLength(2)
    fixture.sidecars.dispose()
  })

  test("keeps a readiness-leased process generation callable after it is retired", async () => {
    const fixture = await runtimeFixture()
    const plan = await fixture.installations.loadPublishedCapabilityPlan()
    const binding = plan.bindings.find((candidate) => candidate.capabilityId === "media.transform")!
    const inspection = await fixture.sidecars.inspect(binding.provider!)
    expect(inspection.state).toBe("ready")
    if (inspection.state !== "ready") throw new Error("Provider did not become ready")
    fixture.sidecars.disposePlugin("provider")
    await expect(
      fixture.sidecars.execute({
        authority: {
          async assertActive() {},
          consumerPluginId: "caller",
          operationId: "f".repeat(64),
          providerPluginId: "provider",
        },
        capability: binding.export!,
        input: { text: "leased" },
        invoke: async () => {
          throw new Error("Unexpected nested invoke")
        },
        operationId: "f".repeat(64),
        provider: binding.provider!,
        runtime: inspection,
      }),
    ).resolves.toEqual({ text: "leased" })
    inspection.release()
    fixture.sidecars.dispose()
  })

  test("routes a sidecar nested invoke through the provider's own declared import", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "convax-p2p-nested-"))
    roots.push(root)
    const installations = new PluginInstallationRuntime(path.join(root, "installations"))
    let active = await installations.publish(
      0,
      candidate(
        "child",
        declaration({
          exports: [{ id: "media.child", operation: "media.child" }],
        }),
      ),
    )
    active = await installations.publish(
      active.revision,
      candidate(
        "gateway",
        declaration({
          exports: [{ id: "media.gateway", operation: "media.gateway" }],
          optional: ["media.child"],
        }),
      ),
    )
    await installations.publish(active.revision, candidate("caller", declaration({ required: ["media.gateway"] })))
    const called: string[] = []
    let created = 0
    const sidecars = new GenerationPluginRuntime({
      createClient: (options) => {
        const id = ++created
        const operation = id === 1 ? "media.gateway" : "media.child"
        return {
          async callPluginCapabilityTool(
            tool: string,
            input: Record<string, unknown>,
            metadata: PluginCapabilityToolOperationMetadata,
          ) {
            called.push(tool)
            if (tool === "media.gateway") {
              const result = await options.serverRequestHandler!.handle(
                {
                  method: pluginCapabilityNestedInvokeMcpMethod,
                  params: {
                    _meta: {
                      convaxPluginCapability: {
                        authorityToken: metadata.authorityToken,
                        operationId: metadata.operationId,
                        schema: pluginCapabilityInvocationAuthoritySchema,
                      },
                    },
                    capabilityId: "media.child",
                    input,
                    parentOperationId: metadata.operationId,
                    requestId: "gateway-child",
                  },
                },
                {
                  sendNotification() {},
                  signal: new AbortController().signal,
                },
              )
              if (!isRecord(result)) {
                throw new Error("Nested capability fixture returned a non-object")
              }
              return { content: [], structuredContent: result }
            }
            return { content: [], structuredContent: input }
          },
          async callTool(tool: string, input: Record<string, unknown>) {
            called.push(tool)
            return { content: [], structuredContent: input }
          },
          close() {},
          async listTools() {
            return [
              {
                inputSchema: valueSchema,
                name: operation,
                outputSchema: valueSchema,
              },
            ]
          },
        }
      },
      environment: {},
      pluginRuntimeState: async () => "enabled",
      platform: "darwin",
      plugins: installations,
    })
    const principals = new InstalledPluginPrincipalResolver(installations)
    const service = new PluginCapabilityBrokerMainService({
      installations,
      principals,
      sidecars,
    })
    await expect(
      service.invoke(await principals.issue("caller", "web"), {
        capabilityId: "media.gateway",
        input: { text: "nested" },
        requestId: "outer-gateway",
      }),
    ).resolves.toEqual({ text: "nested" })
    expect(called).toEqual(["media.gateway", "media.child"])
    sidecars.dispose()
  })
})
