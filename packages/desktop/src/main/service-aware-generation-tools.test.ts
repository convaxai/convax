import { describe, expect, mock, test } from "bun:test"

import type { GenerationToolDescription, GenerationToolSummary } from "../generation-contracts"
import {
  pluginServiceStatusSchema,
  type PluginServiceStatus,
  type PluginServiceSummary,
} from "../plugin-service-contracts"
import type { GenerationToolExecutionPort, PreparedGenerationToolExecution } from "./generation-canvas-service"
import {
  ServiceAwareGenerationTools,
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
    getStatus?: (pluginId: string, signal?: AbortSignal) => Promise<PluginServiceStatus>
    services?: readonly PluginServiceSummary[]
    statuses?: Readonly<Record<string, PluginServiceStatus | Error>>
    tools?: readonly GenerationToolSummary[]
  } = {},
) {
  const listedTools = input.tools ?? [generationTool("remote-images")]
  const describeTool = mock(async (toolId: string): Promise<GenerationToolDescription> => ({ fields: [], toolId }))
  const prepared: PreparedGenerationToolExecution = {
    call: mock(async () => ({ content: [] })),
    validateInput: mock(() => ({})),
  }
  const prepareTool = mock(async () => prepared)
  const prepareRecoveryTool = mock(async () => ({ execution: prepared, tool: listedTools[0]! }))
  const releaseRecoveryTool = mock(async () => undefined)
  const toolPort: GenerationToolExecutionPort = {
    describeTool,
    listTools: mock(async (options = {}) =>
      options.output ? listedTools.filter((tool) => tool.output === options.output) : listedTools,
    ),
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
  return {
    describeTool,
    getStatus,
    prepareRecoveryTool,
    prepareTool,
    releaseRecoveryTool,
    subject: new ServiceAwareGenerationTools(
      toolPort,
      servicePort,
      input.availabilityTimeoutMs === undefined ? {} : { availabilityTimeoutMs: input.availabilityTimeoutMs },
    ),
  }
}

describe("ServiceAwareGenerationTools", () => {
  test("hides models without service contributions and keeps service-independent operations", async () => {
    const model = generationTool("local-images")
    const operation = operationTool("local-images")
    const { getStatus, subject } = setup({ services: [], tools: [model, operation] })

    expect(await subject.listTools()).toEqual([operation])
    expect(getStatus).not.toHaveBeenCalled()
  })

  test("exposes only models whose owning service is connected", async () => {
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

    expect(await subject.listTools({ output: "image" })).toEqual([available, operation])
    expect(getStatus).toHaveBeenCalledTimes(3)
  })

  test("treats connected as authoritative even when credential verification is not yet refreshed", async () => {
    const model = generationTool("available-images")
    const { subject } = setup({
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

  test("treats one failed status check as unavailable without hiding other usable tools", async () => {
    const failed = generationTool("failed-images")
    const available = generationTool("available-images")
    const { subject } = setup({
      services: [service("failed-images"), service("available-images")],
      statuses: { "failed-images": new Error("private sidecar diagnostic") },
      tools: [failed, available],
    })

    expect(await subject.listTools()).toEqual([available])
  })

  test("reflects sign-out and reauthorization on the next live model listing", async () => {
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
    expect(await subject.listTools()).toEqual([])
    status = connected
    expect(await subject.listTools()).toEqual([model])
  })

  test("checks one service once even when it owns several models", async () => {
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
    expect(getStatus).toHaveBeenCalledTimes(1)
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

  test("rechecks service availability before model description and preparation", async () => {
    const selected = generationTool("remote-images")
    const { describeTool, getStatus, prepareTool, subject } = setup({ tools: [selected] })

    await subject.describeTool(selected.id)
    await subject.prepareTool(selected)
    expect(describeTool).toHaveBeenCalledWith(selected.id, undefined)
    expect(prepareTool).toHaveBeenCalledWith(selected, undefined)
    expect(getStatus).toHaveBeenCalledTimes(2)
  })

  test("blocks a stale model before description or preparation when its service disconnects", async () => {
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

    await expect(subject.describeTool(selected.id)).rejects.toThrow("Open Services")
    await expect(subject.prepareTool(selected)).rejects.toThrow("Open Services")
    expect(describeTool).not.toHaveBeenCalled()
    expect(prepareTool).not.toHaveBeenCalled()
  })

  test("bounds concurrent service status checks", async () => {
    let active = 0
    let maximumActive = 0
    const pluginIds = Array.from({ length: 9 }, (_, index) => `remote-images-${index}`)
    const { subject } = setup({
      getStatus: async () => {
        active += 1
        maximumActive = Math.max(maximumActive, active)
        await Promise.resolve()
        active -= 1
        return connected
      },
      services: pluginIds.map(service),
      tools: pluginIds.map((pluginId) => generationTool(pluginId)),
    })

    expect(await subject.listTools()).toHaveLength(9)
    expect(maximumActive).toBe(4)
  })

  test("times out an unresponsive status check and aborts its Main request", async () => {
    let statusSignal: AbortSignal | undefined
    const { subject } = setup({
      availabilityTimeoutMs: 1,
      getStatus: async (_pluginId, signal) => {
        statusSignal = signal
        return new Promise<PluginServiceStatus>(() => undefined)
      },
    })

    expect(await subject.listTools()).toEqual([])
    expect(statusSignal?.aborted).toBeTrue()
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
