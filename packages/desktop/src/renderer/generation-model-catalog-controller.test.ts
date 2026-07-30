import { describe, expect, mock, test } from "bun:test"

import type {
  GenerationOutputModality,
  GenerationToolDescription,
  GenerationToolSummary,
} from "../generation-contracts"
import { GenerationModelCatalogController } from "./generation-model-catalog-controller"

function deferred<T>() {
  let reject!: (reason?: unknown) => void
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle
    reject = fail
  })
  return { promise, reject, resolve }
}

function tool(id: string, output: GenerationOutputModality = "image"): GenerationToolSummary {
  return {
    acceptedInputs: ["text"],
    description: `${id} description`,
    id,
    kind: "model",
    modelName: id,
    output,
    pluginId: "creative-service",
    pluginName: "Creative Service",
    title: id,
    toolId: "generate",
  }
}

function operation(id: string, output: GenerationOutputModality = "image"): GenerationToolSummary {
  const { modelName: _modelName, ...base } = tool(id, output)
  return { ...base, kind: "operation" }
}

function description(toolId: string, label = "Quality"): GenerationToolDescription {
  return {
    fields: [
      {
        choices: [{ label: "High", value: "high" }],
        id: "quality",
        kind: "select",
        label,
        required: false,
      },
    ],
    toolId,
  }
}

describe("GenerationModelCatalogController", () => {
  test("bounds the window catalog refresh age", () => {
    const client = {
      describeTool: mock(async ({ toolId }) => description(toolId)),
      listTools: mock(async () => []),
    }
    expect(() => new GenerationModelCatalogController(client, { refreshAfterMs: 0 })).toThrow("refresh age is invalid")
    expect(() => new GenerationModelCatalogController(client, { refreshAfterMs: 24 * 60 * 60_000 + 1 })).toThrow(
      "refresh age is invalid",
    )
    expect(() => new GenerationModelCatalogController(client, { retryAfterMs: 0 })).toThrow("retry age is invalid")
    expect(() => new GenerationModelCatalogController(client, { retryAfterMs: 24 * 60 * 60_000 + 1 })).toThrow(
      "retry age is invalid",
    )
  })

  test("single-flights initial discovery and serves remounts from the full cached catalog", async () => {
    const pending = deferred<readonly GenerationToolSummary[]>()
    const listTools = mock(() => pending.promise)
    const controller = new GenerationModelCatalogController({
      describeTool: mock(async ({ toolId }) => description(toolId)),
      listTools,
    })

    controller.setScope({ authorityVersion: 1, scopeId: "project-a" })
    const first = controller.listTools("image")
    const second = controller.listTools("video")

    expect(listTools).toHaveBeenCalledTimes(1)
    expect(controller.getSnapshot()).toMatchObject({
      loading: true,
      ready: false,
      refreshing: false,
      scopeId: "project-a",
    })

    pending.resolve([tool("image-one"), tool("video-one", "video")])
    expect(await first).toEqual([tool("image-one")])
    expect(await second).toEqual([tool("video-one", "video")])

    expect(controller.peekTools()).toEqual([tool("image-one"), tool("video-one", "video")])
    expect(await controller.listTools("image")).toEqual([tool("image-one")])
    expect(listTools).toHaveBeenCalledTimes(1)
    expect(listTools).toHaveBeenCalledWith({ refresh: true, scopeId: "project-a" })
  })

  test("keeps cached tools visible while a scheduled Main revalidation refreshes every consumer", async () => {
    const refresh = deferred<readonly GenerationToolSummary[]>()
    const listTools = mock()
      .mockResolvedValueOnce([tool("model-v1")])
      .mockImplementationOnce(() => refresh.promise)
    let scheduledRefresh: (() => void) | undefined
    const scheduleRefresh = mock((callback: () => void, delayMs: number) => {
      expect(delayMs).toBe(10)
      scheduledRefresh = callback
      return () => {
        scheduledRefresh = undefined
      }
    })
    const controller = new GenerationModelCatalogController(
      {
        describeTool: mock(async ({ toolId }) => description(toolId)),
        listTools,
      },
      { refreshAfterMs: 10, scheduleRefresh },
    )

    controller.setScope({ authorityVersion: "stable", scopeId: "project-a" })
    await controller.listTools()
    expect(await controller.listTools()).toEqual([tool("model-v1")])
    expect(listTools).toHaveBeenCalledTimes(1)

    scheduledRefresh?.()
    await Promise.resolve()
    expect(listTools).toHaveBeenCalledTimes(2)
    expect(listTools).toHaveBeenLastCalledWith({ refresh: true, scopeId: "project-a" })
    const explicitRefresh = controller.refresh()
    expect(listTools).toHaveBeenCalledTimes(2)
    expect(controller.getSnapshot()).toMatchObject({
      loading: false,
      ready: true,
      refreshing: true,
      tools: [tool("model-v1")],
    })

    refresh.resolve([tool("model-v2")])
    expect(await explicitRefresh).toEqual([tool("model-v2")])
    while (controller.getSnapshot().refreshing) await Promise.resolve()
    expect(controller.peekTools()).toEqual([tool("model-v2")])
    expect(scheduleRefresh).toHaveBeenCalledTimes(2)
    controller.dispose()
  })

  test("retries an empty shared catalog with bounded backoff without remount loading", async () => {
    const localOperation = operation("local-operation")
    const listTools = mock()
      .mockResolvedValueOnce([localOperation])
      .mockResolvedValueOnce([localOperation])
      .mockResolvedValueOnce([localOperation, tool("recovered-model")])
    let scheduledRefresh: (() => void) | undefined
    const scheduledDelays: number[] = []
    const scheduleRefresh = mock((callback: () => void, delayMs: number) => {
      scheduledDelays.push(delayMs)
      scheduledRefresh = callback
      return () => {
        if (scheduledRefresh === callback) scheduledRefresh = undefined
      }
    })
    const controller = new GenerationModelCatalogController(
      {
        describeTool: mock(async ({ toolId }) => description(toolId)),
        listTools,
      },
      { refreshAfterMs: 100, retryAfterMs: 10, scheduleRefresh },
    )

    controller.setScope({ authorityVersion: "stable", scopeId: "project-a" })
    expect(await controller.listTools()).toEqual([localOperation])
    expect(controller.getSnapshot()).toMatchObject({
      loading: false,
      ready: true,
      refreshing: false,
      tools: [localOperation],
    })
    expect(scheduledDelays).toEqual([10])
    expect(await controller.listTools()).toEqual([localOperation])
    expect(listTools).toHaveBeenCalledTimes(1)

    scheduledRefresh?.()
    expect(controller.getSnapshot()).toMatchObject({
      loading: false,
      ready: true,
      refreshing: true,
      tools: [localOperation],
    })
    while (controller.getSnapshot().refreshing) await Promise.resolve()
    expect(controller.peekTools()).toEqual([localOperation])
    expect(scheduledDelays).toEqual([10, 20])

    scheduledRefresh?.()
    expect(controller.getSnapshot()).toMatchObject({
      loading: false,
      ready: true,
      refreshing: true,
      tools: [localOperation],
    })
    while (controller.getSnapshot().refreshing) await Promise.resolve()
    expect(controller.peekTools()).toEqual([localOperation, tool("recovered-model")])
    expect(scheduledDelays).toEqual([10, 20, 100])
    expect(listTools).toHaveBeenCalledTimes(3)
    controller.dispose()
  })

  test("keeps ready data during authority revalidation and retains it with an exposed error on failure", async () => {
    const refresh = deferred<readonly GenerationToolSummary[]>()
    const listTools = mock()
      .mockResolvedValueOnce([tool("model-v1")])
      .mockImplementationOnce(() => refresh.promise)
    const controller = new GenerationModelCatalogController({
      describeTool: mock(async ({ toolId }) => description(toolId)),
      listTools,
    })

    controller.setScope({ authorityVersion: "v1", scopeId: "project-a" })
    await controller.listTools()
    controller.setScope({ authorityVersion: "v2", scopeId: "project-a" })

    expect(controller.getSnapshot()).toMatchObject({
      authorityVersion: "v2",
      loading: false,
      ready: true,
      refreshing: true,
      tools: [tool("model-v1")],
    })
    expect(controller.peekTools()).toEqual([tool("model-v1")])
    const joinedRefresh = controller.listTools()
    expect(listTools).toHaveBeenCalledTimes(2)

    const explicitRefresh = controller.refresh()
    refresh.reject(new Error("service temporarily unavailable"))
    const joinedRefreshError = await joinedRefresh.catch((error: unknown) => error)
    expect(joinedRefreshError).toBeInstanceOf(Error)
    const refreshError = await explicitRefresh.catch((error: unknown) => error)
    expect(refreshError).toBeInstanceOf(Error)
    if (!(refreshError instanceof Error)) throw new Error("Expected catalog refresh to reject")
    expect(refreshError.message).toBe("service temporarily unavailable")

    expect(controller.getSnapshot()).toMatchObject({
      error: "service temporarily unavailable",
      loading: false,
      ready: true,
      refreshing: false,
      tools: [tool("model-v1")],
    })
  })

  test("lets cached consumers join authority revalidation and receive the refreshed catalog", async () => {
    const refresh = deferred<readonly GenerationToolSummary[]>()
    const listTools = mock()
      .mockResolvedValueOnce([tool("model-v1")])
      .mockImplementationOnce(() => refresh.promise)
    const controller = new GenerationModelCatalogController({
      describeTool: mock(async ({ toolId }) => description(toolId)),
      listTools,
    })

    controller.setScope({ authorityVersion: "v1", scopeId: "project-a" })
    await controller.listTools()
    controller.setScope({ authorityVersion: "v2", scopeId: "project-a" })

    expect(controller.peekTools()).toEqual([tool("model-v1")])
    const listed = controller.listTools()
    refresh.resolve([tool("model-v2")])

    expect(await listed).toEqual([tool("model-v2")])
    expect(controller.peekTools()).toEqual([tool("model-v2")])
    expect(listTools).toHaveBeenCalledTimes(2)
    expect(listTools.mock.calls).toEqual([
      [{ refresh: true, scopeId: "project-a" }],
      [{ refresh: true, scopeId: "project-a" }],
    ])
  })

  test("commits explicit send-time revalidation into the shared snapshot", async () => {
    const listTools = mock()
      .mockResolvedValueOnce([tool("model-v1")])
      .mockResolvedValueOnce([tool("model-v2")])
    const controller = new GenerationModelCatalogController({
      describeTool: mock(async ({ toolId }) => description(toolId)),
      listTools,
    })

    controller.setScope({ authorityVersion: "stable", scopeId: "project-a" })
    await controller.listTools()
    expect(controller.peekTools()).toEqual([tool("model-v1")])

    expect(await controller.refresh()).toEqual([tool("model-v2")])
    expect(controller.getSnapshot()).toMatchObject({
      ready: true,
      refreshing: false,
      tools: [tool("model-v2")],
    })
    expect(controller.peekTools()).toEqual([tool("model-v2")])
    expect(listTools).toHaveBeenCalledTimes(2)
  })

  test("isolates Project scopes and ignores late catalog responses", async () => {
    const projectA = deferred<readonly GenerationToolSummary[]>()
    const projectB = deferred<readonly GenerationToolSummary[]>()
    const listTools = mock(({ scopeId }: { scopeId: string }) =>
      scopeId === "project-a" ? projectA.promise : projectB.promise,
    )
    const controller = new GenerationModelCatalogController({
      describeTool: mock(async ({ toolId }) => description(toolId)),
      listTools,
    })

    controller.setScope({ authorityVersion: 1, scopeId: "project-a" })
    controller.setScope({ authorityVersion: 1, scopeId: "project-b" })
    expect(controller.peekTools()).toBeUndefined()

    projectB.resolve([tool("project-b-model")])
    await controller.listTools()
    projectA.resolve([tool("project-a-model")])
    await Promise.resolve()
    await Promise.resolve()

    expect(controller.getSnapshot()).toMatchObject({
      scopeId: "project-b",
      tools: [tool("project-b-model")],
    })
  })

  test("caches and single-flights descriptions, then revalidates them after an authority change", async () => {
    const initial = deferred<GenerationToolDescription>()
    const updated = deferred<GenerationToolDescription>()
    const describeTool = mock()
      .mockImplementationOnce(() => initial.promise)
      .mockImplementationOnce(() => updated.promise)
    const controller = new GenerationModelCatalogController({
      describeTool,
      listTools: mock(async () => [tool("model-one")]),
    })
    controller.setScope({ authorityVersion: 1, scopeId: "project-a" })
    await controller.listTools()

    const first = controller.describeTool("model-one")
    const second = controller.describeTool("model-one")
    expect(describeTool).toHaveBeenCalledTimes(1)
    initial.resolve(description("model-one"))
    expect(await first).toEqual(description("model-one"))
    expect(await second).toEqual(description("model-one"))
    expect(await controller.describeTool("model-one")).toEqual(description("model-one"))
    expect(describeTool).toHaveBeenCalledTimes(1)

    controller.setScope({ authorityVersion: 2, scopeId: "project-a" })
    expect(controller.peekDescription("model-one")).toEqual(description("model-one"))
    const revalidation = controller.describeTool("model-one")
    expect(controller.getDescriptionSnapshot("model-one")).toMatchObject({
      description: description("model-one"),
      refreshing: true,
    })
    expect(describeTool).toHaveBeenCalledTimes(2)

    updated.reject(new Error("description refresh failed"))
    const revalidationError = await revalidation.catch((error: unknown) => error)
    expect(revalidationError).toBeInstanceOf(Error)
    if (!(revalidationError instanceof Error)) throw new Error("Expected description refresh to reject")
    expect(revalidationError.message).toBe("description refresh failed")
    expect(controller.getDescriptionSnapshot("model-one")).toEqual({
      description: description("model-one"),
      error: "description refresh failed",
      refreshing: false,
    })
  })

  test("clears old-scope descriptions and ignores their late responses", async () => {
    const projectA = deferred<GenerationToolDescription>()
    const describeTool = mock(({ scopeId, toolId }: { scopeId: string; toolId: string }) =>
      scopeId === "project-a" ? projectA.promise : Promise.resolve(description(toolId, "Project B")),
    )
    const controller = new GenerationModelCatalogController({
      describeTool,
      listTools: mock(async () => [tool("model-one")]),
    })
    controller.setScope({ authorityVersion: 1, scopeId: "project-a" })
    await controller.listTools()
    const stale = controller.describeTool("model-one")

    controller.setScope({ authorityVersion: 1, scopeId: "project-b" })
    await controller.listTools()
    expect(controller.peekDescription("model-one")).toBeUndefined()
    expect(await controller.describeTool("model-one")).toEqual(description("model-one", "Project B"))

    projectA.resolve(description("model-one", "Project A"))
    await stale
    expect(controller.peekDescription("model-one")).toEqual(description("model-one", "Project B"))
  })
})
