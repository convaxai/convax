import { describe, expect, mock, test } from "bun:test"

import type { GenerationToolDescription, GenerationToolSummary } from "../generation-contracts"
import {
  pluginServiceStatusSchema,
  type PluginServiceStatus,
  type PluginServiceSummary,
} from "../plugin-service-contracts"
import type { PreparedGenerationToolExecution } from "./generation-canvas-service"
import {
  ServiceAwareGenerationTools,
  type GenerationModelCatalogExpansionPort,
  type GenerationPluginServiceAvailabilityPort,
} from "./service-aware-generation-tools"

const connected: PluginServiceStatus = {
  account: { availability: "unavailable" },
  billing: { availability: "unavailable" },
  credential: { configured: true, verification: "verified" },
  credits: { availability: "unavailable" },
  plan: { availability: "unavailable" },
  schema: pluginServiceStatusSchema,
  state: "connected",
  usage: { availability: "unavailable" },
}

function generationTool(pluginId: string, toolId = "generate.image"): GenerationToolSummary {
  return {
    acceptedInputs: ["text"],
    description: "Generate an image",
    id: `${pluginId}/${toolId}`,
    kind: "model",
    modelName: "Image Model",
    output: "image",
    pluginId,
    pluginName: pluginId,
    title: "Generate image",
    toolId,
  }
}

function operationTool(pluginId: string, toolId = "transform.image"): GenerationToolSummary {
  return {
    ...generationTool(pluginId, toolId),
    kind: "operation",
    modelName: undefined,
  }
}

function modelVariant(base: GenerationToolSummary, suffix: string, modelName: string): GenerationToolSummary {
  return {
    ...base,
    id: `${base.id}.model-selection-${suffix.padEnd(64, "0")}`,
    modelName,
  }
}

function service(pluginId: string): PluginServiceSummary {
  return {
    actions: ["authorize"],
    capabilities: ["image"],
    description: "Image service",
    models: [{ capability: "image", id: "generate.image", name: "Image Model" }],
    pluginId,
    pluginName: pluginId,
    version: "1.0.0",
  }
}

function setup(
  input: {
    availabilityTimeoutMs?: number
    expandModelTool?: (tool: GenerationToolSummary, signal?: AbortSignal) => Promise<readonly GenerationToolSummary[]>
    getStatus?: (pluginId: string, signal?: AbortSignal) => Promise<PluginServiceStatus>
    inspectModelCatalog?: GenerationModelCatalogExpansionPort["inspectModelCatalog"]
    now?: () => number
    refreshAfterMs?: number
    services?: readonly PluginServiceSummary[]
    statuses?: Readonly<Record<string, PluginServiceStatus | Error>>
    tools?: readonly GenerationToolSummary[]
  } = {},
) {
  const listedTools = input.tools ?? [generationTool("remote-images")]
  const describeTool = mock(async (toolId: string): Promise<GenerationToolDescription> => ({ fields: [], toolId }))
  const dispatch = mock(async () => ({ content: [] }))
  const call: PreparedGenerationToolExecution["call"] = mock(
    async (_input, _signal, lifecycleObserver, _operation, dispatchHooks) => {
      await dispatchHooks?.validate?.()
      await dispatchHooks?.guard?.()
      await dispatchHooks?.validate?.()
      await lifecycleObserver?.({ type: "external-started" })
      return dispatch()
    },
  )
  const prepared: PreparedGenerationToolExecution = {
    call,
    validateInput: mock(() => ({})),
  }
  const prepareTool = mock(async () => prepared)
  const prepareRecoveryTool = mock(async () => ({ execution: prepared, tool: listedTools[0]! }))
  const releaseRecoveryTool = mock(async () => undefined)
  const expandModelTool = mock(input.expandModelTool ?? (async (tool: GenerationToolSummary) => [tool]))
  const inspectModelCatalog = input.inspectModelCatalog ? mock(input.inspectModelCatalog) : undefined
  const listTools = mock(async (options: { output?: GenerationToolSummary["output"] } = {}) =>
    options.output ? listedTools.filter((tool) => tool.output === options.output) : listedTools,
  )
  const toolPort: GenerationModelCatalogExpansionPort = {
    describeTool,
    expandModelTool,
    ...(inspectModelCatalog ? { inspectModelCatalog } : {}),
    listTools,
    prepareRecoveryTool,
    prepareTool,
    releaseRecoveryTool,
  }
  const getStatus = mock(
    input.getStatus ??
      (async (pluginId: string) => {
        const result = input.statuses?.[pluginId] ?? connected
        if (result instanceof Error) throw result
        return result
      }),
  )
  const servicePort: GenerationPluginServiceAvailabilityPort = {
    getStatus,
    listServices: mock(async () => input.services ?? [service("remote-images")]),
  }
  const options = {
    ...(input.availabilityTimeoutMs === undefined ? {} : { availabilityTimeoutMs: input.availabilityTimeoutMs }),
    ...(input.now === undefined ? {} : { now: input.now }),
    ...(input.refreshAfterMs === undefined ? {} : { refreshAfterMs: input.refreshAfterMs }),
  }
  return {
    call,
    describeTool,
    dispatch,
    expandModelTool,
    getStatus,
    inspectModelCatalog,
    listTools,
    prepareRecoveryTool,
    prepareTool,
    releaseRecoveryTool,
    subject: new ServiceAwareGenerationTools(toolPort, servicePort, options),
  }
}

describe("ServiceAwareGenerationTools", () => {
  test("bounds the session catalog refresh age", () => {
    expect(() => setup({ refreshAfterMs: 0 })).toThrow("refresh age is invalid")
    expect(() => setup({ refreshAfterMs: 24 * 60 * 60_000 + 1 })).toThrow("refresh age is invalid")
  })

  test("hides models without service contributions and keeps service-independent operations", async () => {
    const model = generationTool("local-images")
    const operation = operationTool("local-images")
    const { getStatus, subject } = setup({ services: [], tools: [model, operation] })

    expect(await subject.listTools()).toEqual([operation])
    expect(getStatus).not.toHaveBeenCalled()
  })

  test("exposes installed service models without waiting for live service status", async () => {
    const available = generationTool("available-images")
    const disconnected = generationTool("disconnected-images")
    const attention = generationTool("attention-images")
    const operation = operationTool("local-images")
    const { getStatus, subject } = setup({
      services: [service("available-images"), service("disconnected-images"), service("attention-images")],
      statuses: {
        "attention-images": {
          ...connected,
          credential: { configured: true, verification: "failed" },
          state: "attention",
        },
        "disconnected-images": {
          ...connected,
          credential: { configured: false, verification: "unknown" },
          state: "disconnected",
        },
      },
      tools: [available, disconnected, attention, operation],
    })

    expect(await subject.listTools({ output: "image" })).toEqual([available, disconnected, attention, operation])
    expect(getStatus).not.toHaveBeenCalled()
  })

  test("does not start an unresponsive service-status request while listing models", async () => {
    const model = generationTool("remote-images")
    const { getStatus, subject } = setup({
      getStatus: async () => new Promise<PluginServiceStatus>(() => undefined),
      tools: [model],
    })

    expect(await subject.listTools()).toEqual([model])
    expect(getStatus).not.toHaveBeenCalled()
  })

  test("expands installed model catalogs without a service-status admission request", async () => {
    const events: string[] = []
    const available = generationTool("available-images")
    const unavailable = generationTool("disconnected-images")
    const operation = operationTool("local-images")
    const alpha = modelVariant(available, "a", "Alpha Image")
    const beta = modelVariant(available, "b", "Beta Image")
    const offline = modelVariant(unavailable, "c", "Offline Image")
    const { expandModelTool, getStatus, subject } = setup({
      expandModelTool: async (tool) => {
        events.push(`expand:${tool.pluginId}`)
        return tool.pluginId === available.pluginId ? [alpha, beta] : [offline]
      },
      services: [service(available.pluginId), service(unavailable.pluginId)],
      tools: [available, unavailable, operation],
    })

    expect(await subject.listTools()).toEqual([alpha, beta, offline, operation])
    expect(expandModelTool).toHaveBeenCalledTimes(2)
    expect(expandModelTool.mock.calls[0]?.[0]).toEqual(available)
    expect(events).toEqual([`expand:${available.pluginId}`, `expand:${unavailable.pluginId}`])
    expect(getStatus).not.toHaveBeenCalled()
  })

  test("isolates one connected service catalog failure", async () => {
    const failed = generationTool("failed-images")
    const available = generationTool("available-images")
    const variant = modelVariant(available, "a", "Available Image")
    const operation = operationTool("local-images")
    const { subject } = setup({
      expandModelTool: async (tool) => {
        if (tool.pluginId === failed.pluginId) throw new Error("private catalog diagnostic")
        return [variant]
      },
      services: [service(failed.pluginId), service(available.pluginId)],
      tools: [failed, available, operation],
    })

    expect(await subject.listTools()).toEqual([variant, operation])
  })

  test("does not let a service-status change erase an inspected model catalog", async () => {
    const model = generationTool("remote-images")
    const variant = modelVariant(model, "a", "Runtime Image")
    const operation = operationTool("local-images")
    let status = connected
    const { expandModelTool, getStatus, subject } = setup({
      expandModelTool: async () => {
        status = {
          ...connected,
          credential: { configured: false, verification: "unknown" },
          state: "disconnected",
        }
        return [variant]
      },
      getStatus: async () => status,
      tools: [model, operation],
    })

    expect(await subject.listTools()).toEqual([variant, operation])
    expect(expandModelTool).toHaveBeenCalledTimes(1)
    expect(getStatus).not.toHaveBeenCalled()
  })

  test("keeps the declared base tool identity on runtime model variants", async () => {
    const base = generationTool("remote-images")
    const variant = modelVariant(base, "a", "Runtime Image")
    const { describeTool, prepareTool, subject } = setup({
      expandModelTool: async () => [variant],
      tools: [base],
    })

    expect(await subject.listTools()).toEqual([variant])
    await subject.describeTool(variant.id)
    await subject.prepareTool(variant)
    expect(describeTool).toHaveBeenCalledWith(variant.id, expect.any(AbortSignal))
    expect(prepareTool).toHaveBeenCalledWith(variant, undefined)
  })

  test("reuses one session snapshot across repeated model listings and descriptions", async () => {
    const selected = generationTool("remote-images")
    const { describeTool, getStatus, listTools, subject } = setup({ tools: [selected] })

    expect(await subject.listTools()).toEqual([selected])
    expect(await subject.listTools({ output: "image" })).toEqual([selected])
    expect(await subject.describeTool(selected.id)).toEqual({ fields: [], toolId: selected.id })
    expect(await subject.describeTool(selected.id)).toEqual({ fields: [], toolId: selected.id })

    expect(listTools).toHaveBeenCalledTimes(1)
    expect(getStatus).not.toHaveBeenCalled()
    expect(describeTool).toHaveBeenCalledTimes(1)
  })

  test("coalesces concurrent cold catalog refreshes", async () => {
    const selected = generationTool("remote-images")
    let release!: () => void
    const inspected = new Promise<
      readonly { description: GenerationToolDescription; summary: GenerationToolSummary }[]
    >((resolve) => {
      release = () => resolve([{ description: { fields: [], toolId: selected.id }, summary: selected }])
    })
    const { inspectModelCatalog, subject } = setup({
      inspectModelCatalog: async () => inspected,
      tools: [selected],
    })

    const first = subject.refresh()
    const second = subject.refresh()
    expect(second).toBe(first)
    release()
    await Promise.all([first, second])

    expect(inspectModelCatalog).toHaveBeenCalledTimes(1)
    expect(await subject.listTools()).toEqual([selected])
  })

  test("serves a stale snapshot while an age-triggered refresh commits the next catalog", async () => {
    const base = generationTool("remote-images")
    const alpha = modelVariant(base, "a", "Alpha")
    const beta = modelVariant(base, "b", "Beta")
    let now = 0
    let next = alpha
    let releaseRefresh: (() => void) | undefined
    const { inspectModelCatalog, subject } = setup({
      inspectModelCatalog: async () => {
        if (!releaseRefresh) {
          return [{ description: { fields: [], toolId: next.id }, summary: next }]
        }
        return new Promise((resolve) => {
          const release = releaseRefresh!
          releaseRefresh = () => {
            release()
            resolve([{ description: { fields: [], toolId: next.id }, summary: next }])
          }
        })
      },
      now: () => now,
      refreshAfterMs: 1,
      tools: [base],
    })

    expect(await subject.listTools()).toEqual([alpha])
    next = beta
    now = 2
    releaseRefresh = () => undefined
    expect(await subject.listTools()).toEqual([alpha])
    while (inspectModelCatalog!.mock.calls.length < 2) await Promise.resolve()
    const refreshing = subject.refresh()
    releaseRefresh()
    await refreshing
    expect(await subject.listTools()).toEqual([beta])
  })

  test("awaits an explicit renderer revalidation and returns the refreshed shared catalog", async () => {
    const base = generationTool("remote-images")
    const alpha = modelVariant(base, "a", "Alpha")
    const beta = modelVariant(base, "b", "Beta")
    let selected = alpha
    const { inspectModelCatalog, subject } = setup({
      inspectModelCatalog: async () => [{ description: { fields: [], toolId: selected.id }, summary: selected }],
      tools: [base],
    })

    expect(await subject.listTools()).toEqual([alpha])
    selected = beta
    expect(await subject.listTools({ refresh: true })).toEqual([beta])
    expect(inspectModelCatalog).toHaveBeenCalledTimes(2)
  })

  test("single-flights explicit revalidation while ordinary readers keep the last-good catalog", async () => {
    const base = generationTool("remote-images")
    const alpha = modelVariant(base, "a", "Alpha")
    const beta = modelVariant(base, "b", "Beta")
    let inspection = 0
    let resolveRefresh!: () => void
    let signalRefreshStarted!: () => void
    const refreshStarted = new Promise<void>((resolve) => {
      signalRefreshStarted = resolve
    })
    const { inspectModelCatalog, subject } = setup({
      inspectModelCatalog: async () => {
        inspection += 1
        if (inspection === 1) return [{ description: { fields: [], toolId: alpha.id }, summary: alpha }]
        signalRefreshStarted()
        await new Promise<void>((resolve) => {
          resolveRefresh = resolve
        })
        return [{ description: { fields: [], toolId: beta.id }, summary: beta }]
      },
      tools: [base],
    })

    expect(await subject.listTools()).toEqual([alpha])
    const firstRefresh = subject.listTools({ refresh: true })
    await refreshStarted
    const joinedRefresh = subject.listTools({ refresh: true })
    expect(await subject.listTools()).toEqual([alpha])
    expect(inspectModelCatalog).toHaveBeenCalledTimes(2)

    resolveRefresh()
    expect(await firstRefresh).toEqual([beta])
    expect(await joinedRefresh).toEqual([beta])
    expect(inspectModelCatalog).toHaveBeenCalledTimes(2)
  })

  test("ignores a late catalog refresh from an invalidated epoch", async () => {
    const base = generationTool("remote-images")
    const initial = modelVariant(base, "a", "Initial")
    const stale = modelVariant(base, "b", "Stale")
    const current = modelVariant(base, "c", "Current")
    let inspection = 0
    let resolveStale!: () => void
    let signalStaleStarted!: () => void
    const staleStarted = new Promise<void>((resolve) => {
      signalStaleStarted = resolve
    })
    const { subject } = setup({
      inspectModelCatalog: async () => {
        inspection += 1
        const selected = inspection === 1 ? initial : inspection === 2 ? stale : current
        if (inspection === 2) {
          signalStaleStarted()
          await new Promise<void>((resolve) => {
            resolveStale = resolve
          })
        }
        return [{ description: { fields: [], toolId: selected.id }, summary: selected }]
      },
      tools: [base],
    })

    expect(await subject.listTools()).toEqual([initial])
    const staleRefresh = subject.refresh()
    await staleStarted
    subject.invalidate()
    await subject.refresh()
    resolveStale()
    await staleRefresh

    expect(await subject.listTools()).toEqual([current])
  })

  test("keeps the same-epoch last-good catalog when a background inspection fails", async () => {
    const base = generationTool("remote-images")
    const variant = modelVariant(base, "a", "Available")
    let fail = false
    const { subject } = setup({
      inspectModelCatalog: async () => {
        if (fail) throw new Error("private model catalog failure")
        return [{ description: { fields: [], toolId: variant.id }, summary: variant }]
      },
      tools: [base],
    })

    expect(await subject.listTools()).toEqual([variant])
    fail = true
    await subject.refresh()
    expect(await subject.listTools()).toEqual([variant])
  })

  test("does not use credential verification to admit the installed display catalog", async () => {
    const model = generationTool("available-images")
    const { getStatus, subject } = setup({
      services: [service("available-images")],
      statuses: {
        "available-images": {
          ...connected,
          credential: { configured: true, verification: "unverified" },
        },
      },
      tools: [model],
    })

    expect(await subject.listTools()).toEqual([model])
    expect(getStatus).not.toHaveBeenCalled()
  })

  test("uses the same fail-closed service rule for Agent LLM provider availability", async () => {
    const noService = setup({ services: [] })
    expect(await noService.subject.isPluginAvailable("remote-images")).toBeFalse()

    for (const state of ["disconnected", "attention", "unknown"] as const) {
      const { subject } = setup({
        statuses: { "remote-images": { ...connected, state } },
      })
      expect(await subject.isPluginAvailable("remote-images")).toBeFalse()
    }

    const failed = setup({ statuses: { "remote-images": new Error("private status error") } })
    expect(await failed.subject.isPluginAvailable("remote-images")).toBeFalse()

    const available = setup()
    expect(await available.subject.isPluginAvailable("remote-images")).toBeTrue()
  })

  test("keeps Agent provider admission live after warming the display catalog", async () => {
    let status = connected
    const { getStatus, subject } = setup({
      getStatus: async () => status,
    })
    expect(await subject.listTools()).toHaveLength(1)
    const catalogStatusCalls = getStatus.mock.calls.length
    expect(catalogStatusCalls).toBe(0)
    status = { ...connected, state: "disconnected" }

    expect(await subject.isPluginAvailable("remote-images")).toBeFalse()
    expect(getStatus).toHaveBeenCalledTimes(catalogStatusCalls + 1)
  })

  test("does not let a failed status request hide installed models", async () => {
    const failed = generationTool("failed-images")
    const available = generationTool("available-images")
    const { getStatus, subject } = setup({
      services: [service("failed-images"), service("available-images")],
      statuses: { "failed-images": new Error("private sidecar diagnostic") },
      tools: [failed, available],
    })

    expect(await subject.listTools()).toEqual([failed, available])
    expect(getStatus).not.toHaveBeenCalled()
  })

  test("keeps installed models visible across sign-out and background refresh", async () => {
    let status = connected
    const model = generationTool("remote-images")
    const { subject } = setup({
      getStatus: async () => status,
      tools: [model],
    })

    expect(await subject.listTools()).toEqual([model])
    status = {
      ...connected,
      credential: { configured: false, verification: "unknown" },
      state: "disconnected",
    }
    await subject.refresh()
    expect(await subject.listTools()).toEqual([model])
    status = connected
    await subject.refresh()
    expect(await subject.listTools()).toEqual([model])
  })

  test("does not request service status for a catalog with several installed models", async () => {
    const remoteService = service("remote-images")
    remoteService.models = [
      { capability: "image", id: "generate.one", name: "Image Model One" },
      { capability: "image", id: "generate.two", name: "Image Model Two" },
    ]
    const { getStatus, subject } = setup({
      services: [remoteService],
      tools: [generationTool("remote-images", "generate.one"), generationTool("remote-images", "generate.two")],
    })

    expect(await subject.listTools()).toHaveLength(2)
    expect(getStatus).not.toHaveBeenCalled()
  })

  test("requires the service model projection to match the exact tool id and output", async () => {
    const wrongId = generationTool("remote-images", "undeclared.model")
    const wrongOutput: GenerationToolSummary = {
      ...generationTool("remote-images"),
      output: "video",
    }
    const { getStatus, subject } = setup({ tools: [wrongId, wrongOutput] })

    expect(await subject.listTools()).toEqual([])
    expect(getStatus).not.toHaveBeenCalled()
  })

  test("serves the cached model description but rechecks service availability before preparation", async () => {
    const selected = generationTool("remote-images")
    const { describeTool, getStatus, prepareTool, subject } = setup({ tools: [selected] })

    await subject.describeTool(selected.id)
    const statusCallsAfterDescription = getStatus.mock.calls.length
    await subject.describeTool(selected.id)
    await subject.prepareTool(selected)
    expect(describeTool).toHaveBeenCalledWith(selected.id, expect.any(AbortSignal))
    expect(describeTool).toHaveBeenCalledTimes(1)
    expect(prepareTool).toHaveBeenCalledWith(selected, undefined)
    expect(statusCallsAfterDescription).toBe(0)
    expect(getStatus).toHaveBeenCalledTimes(1)
  })

  test("describes an installed model but blocks preparation when its service is disconnected", async () => {
    const selected = generationTool("remote-images")
    const { describeTool, prepareTool, subject } = setup({
      statuses: {
        "remote-images": {
          ...connected,
          credential: { configured: false, verification: "unknown" },
          state: "disconnected",
        },
      },
      tools: [selected],
    })

    expect(await subject.describeTool(selected.id)).toEqual({ fields: [], toolId: selected.id })
    await expect(subject.prepareTool(selected)).rejects.toThrow("Open Services")
    expect(describeTool).toHaveBeenCalledTimes(1)
    expect(prepareTool).not.toHaveBeenCalled()
  })

  test("rechecks service availability immediately before a prepared model call", async () => {
    const selected = generationTool("remote-images")
    let status = connected
    const { call, getStatus, prepareTool, subject } = setup({
      getStatus: async () => status,
      tools: [selected],
    })
    const prepared = await subject.prepareTool(selected)
    status = {
      ...connected,
      credential: { configured: false, verification: "unknown" },
      state: "disconnected",
    }

    await expect(prepared.call({ prompt: "must not dispatch" })).rejects.toThrow("Open Services")
    expect(prepareTool).toHaveBeenCalledWith(selected, undefined)
    expect(getStatus).toHaveBeenCalledTimes(2)
    expect(call).not.toHaveBeenCalled()
  })

  test("blocks dispatch when a service disconnects after Canvas validation", async () => {
    const selected = generationTool("remote-images")
    let status = connected
    const { call, dispatch, getStatus, subject } = setup({
      getStatus: async () => status,
      tools: [selected],
    })
    const prepared = await subject.prepareTool(selected)

    const externalStarted = mock(async () => undefined)
    await expect(
      prepared.call({ prompt: "must remain unbilled" }, undefined, externalStarted, undefined, {
        validate: async () => {
          status = {
            ...connected,
            credential: { configured: false, verification: "unknown" },
            state: "disconnected",
          }
        },
      }),
    ).rejects.toThrow("Open Services")

    expect(call).toHaveBeenCalledTimes(1)
    expect(dispatch).not.toHaveBeenCalled()
    expect(externalStarted).not.toHaveBeenCalled()
    expect(getStatus).toHaveBeenCalledTimes(3)
  })

  test("bounds concurrent model catalog inspections", async () => {
    let active = 0
    let maximumActive = 0
    const pluginIds = Array.from({ length: 9 }, (_, index) => `remote-images-${index}`)
    const { getStatus, subject } = setup({
      expandModelTool: async (tool) => {
        active += 1
        maximumActive = Math.max(maximumActive, active)
        await Promise.resolve()
        active -= 1
        return [tool]
      },
      services: pluginIds.map(service),
      tools: pluginIds.map((pluginId) => generationTool(pluginId)),
    })

    expect(await subject.listTools()).toHaveLength(9)
    expect(maximumActive).toBe(4)
    expect(getStatus).not.toHaveBeenCalled()
  })

  test("times out an unresponsive Agent-provider status check and aborts its Main request", async () => {
    let statusSignal: AbortSignal | undefined
    const { subject } = setup({
      availabilityTimeoutMs: 1,
      getStatus: async (_pluginId, signal) => {
        statusSignal = signal
        return new Promise<PluginServiceStatus>(() => undefined)
      },
    })

    expect(await subject.isPluginAvailable("remote-images")).toBeFalse()
    expect(statusSignal?.aborted).toBeTrue()
  })

  test("times out an unresponsive model catalog without hiding other operations", async () => {
    let catalogSignal: AbortSignal | undefined
    const operation = operationTool("local-images")
    const { subject } = setup({
      availabilityTimeoutMs: 1,
      expandModelTool: async (_tool, signal) => {
        catalogSignal = signal
        return new Promise<readonly GenerationToolSummary[]>(() => undefined)
      },
      tools: [generationTool("remote-images"), operation],
    })

    expect(await subject.listTools()).toEqual([operation])
    expect(catalogSignal?.aborted).toBeTrue()
  })

  test("propagates caller cancellation before a stale model can be prepared", async () => {
    const selected = generationTool("remote-images")
    const { prepareTool, subject } = setup({ tools: [selected] })
    const controller = new AbortController()
    controller.abort(new DOMException("Canceled by caller", "AbortError"))

    await expect(subject.prepareTool(selected, controller.signal)).rejects.toMatchObject({ name: "AbortError" })
    expect(prepareTool).not.toHaveBeenCalled()
  })

  test("forwards accepted-operation recovery without rechecking current service availability", async () => {
    const { getStatus, prepareRecoveryTool, releaseRecoveryTool, subject } = setup({
      statuses: {
        "remote-images": {
          ...connected,
          credential: { configured: false, verification: "unknown" },
          state: "disconnected",
        },
      },
    })
    const binding = {
      executionBindingDigest: "execution-digest",
      pluginPackageDigest: "plugin-digest",
      runtimeAuthorizationDigest: "authorization-digest",
      sidecarRecoveryBindingDigest: "sidecar-digest",
      toolId: "remote-images/generate.image",
    }

    await expect(subject.prepareRecoveryTool?.(binding)).resolves.toMatchObject({
      tool: { id: "remote-images/generate.image" },
    })
    await subject.releaseRecoveryTool?.(binding.executionBindingDigest)

    expect(prepareRecoveryTool).toHaveBeenCalledWith(binding)
    expect(releaseRecoveryTool).toHaveBeenCalledWith(binding.executionBindingDigest)
    expect(getStatus).not.toHaveBeenCalled()
  })
})
