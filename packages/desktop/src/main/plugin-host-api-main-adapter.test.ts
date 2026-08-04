import { describe, expect, mock, test } from "bun:test"

import type { PluginPrincipal } from "../plugin-capability-contracts"
import type { PluginHostMutationCheckpoint, PluginHostNodeContext } from "../plugin-host-api-main-contracts"
import { pluginHostApiRemoteFailure, PluginHostApiResourceUnavailableError } from "../plugin-host-errors"
import { PluginCanvasImagePublicationPartialSuccessError } from "./plugin-canvas-image-service"
import { PluginHostApiMainAdapter } from "./plugin-host-api-main-adapter"

const principal: PluginPrincipal = {
  activeRevision: 1,
  activeSetDigest: "a".repeat(64),
  manifestDigest: "b".repeat(64),
  pluginId: "fixture",
  pluginVersion: "1.0.0",
  runtime: "web",
  snapshotDigest: "c".repeat(64),
}
const binding = { canvasId: "canvas-1", nodeId: "plugin-node", projectId: "project-1" }
const document = {
  edges: [
    {
      id: "edge-1",
      source: "source-1",
      sourceHandle: "output",
      target: binding.nodeId,
      targetHandle: "input",
    },
  ],
  id: binding.canvasId,
  nodes: [
    {
      data: { kind: "video", label: "Source" },
      id: "source-1",
      position: { x: 0, y: 0 },
      type: "file",
    },
    {
      data: {
        kind: "plugin.fixture",
        label: "Fixture",
        metadata: { convaxPlugin: { id: principal.pluginId, version: principal.pluginVersion } },
      },
      id: binding.nodeId,
      position: { x: 100, y: 0 },
      type: "file",
    },
  ],
  title: "Canvas",
} as const

function adapter(options?: {
  document?: () => unknown
  generation?: Record<string, unknown>
  images?: { createForHostApi: () => Promise<never> }
  open?: () => Promise<never>
  openImage?: () => Promise<never>
  readTextFile?: () => Promise<never>
}) {
  const sessions = new Map<string, { frameId: string; senderId: number }>()
  const open = mock(
    options?.open ??
      (async (request: { frameId: string }, senderId: number) => {
        sessions.set("session-1", { frameId: request.frameId, senderId })
        return {
          probe: {
            duration: { estimated: false, milliseconds: 100 },
            kind: "video" as const,
            mediaRevision: "revision",
            mimeType: "video/mp4",
            size: 100,
          },
          sessionId: "session-1",
          url: "convax-connected-media://session-1/token",
        }
      }),
  )
  const close = mock((request: { frameId: string; sessionId: string }, senderId: number) => {
    const owner = sessions.get(request.sessionId)
    if (!owner || owner.frameId !== request.frameId || owner.senderId !== senderId) return false
    sessions.delete(request.sessionId)
    return true
  })
  const openImage = mock(
    options?.openImage ??
      (async () => ({
        probe: {
          contentRevision: "d".repeat(64),
          height: 1,
          kind: "image" as const,
          mimeType: "image/png" as const,
          size: 8,
          width: 1,
        },
        sessionId: "image-session-1",
        url: "convax-connected-media://image-session-1/token",
      })),
  )
  const closeImage = mock(() => true)
  const instance = new PluginHostApiMainAdapter({
    agent: {} as never,
    application: {
      async execute() { throw new Error("unused") },
      async query() {
        const projection = options?.document?.() ?? document
        return { nodes: [], projection } as never
      },
    },
    canvases: {
      async getCanvasCatalog() {
        const route = {
          activationDigest: "a".repeat(64),
          canvasId: binding.canvasId as never,
          routeProjectionDigest: "b".repeat(64),
          shardEpoch: "AAAAAAAAAAAAAAAAAAAAAA" as never,
          state: "live" as const,
          title: "Canvas",
        }
        return {
          format: "convax.project-canvas-catalog-projection/2" as const,
          projectId: binding.projectId as never,
          routes: [route],
          visibleCanvases: [route],
        } as never
      },
    },
    generation: (options?.generation ?? {}) as never,
    images: (options?.images ?? {}) as never,
    media: {
      close: close as never,
      closeImage: closeImage as never,
      open: open as never,
      openImage: openImage as never,
      revokeFrame: mock(() => 0),
    },
    projects: {
      async list() {
        return [
          {
            createdAt: 1,
            id: binding.projectId,
            lastOpenedAt: 1,
            name: "Project",
            rootPath: "/must-not-cross-renderer",
          },
        ]
      },
      readTextFile:
        options?.readTextFile ??
        (async () => {
          throw new Error("unused")
        }),
      async resolveEntryPath() {
        throw new Error("unused")
      },
    },
    states: {} as never,
  })
  return { close, closeImage, instance, open, openImage }
}

async function currentInputKey(
  instance: PluginHostApiMainAdapter,
  input: { binding?: typeof binding; principal?: PluginPrincipal } = {},
) {
  const inputs = await instance.listInputs({
    binding: input.binding ?? binding,
    principal: input.principal ?? principal,
  })
  const key = inputs[0]?.inputKey
  if (!key) throw new Error("Expected one connected input key")
  return key
}

describe("PluginHostApiMainAdapter connected media", () => {
  test("binds sessions to Main-issued sender/frame context and rejects cross-frame close", async () => {
    const { close, instance, open } = adapter()
    const controller = new AbortController()
    const inputKey = await currentInputKey(instance)
    const opened = await instance.openInput({
      binding,
      connectionId: "connection-1",
      inputKey,
      principal,
      signal: controller.signal,
      transport: { frameId: "frame-1", senderId: 11 },
    })

    expect(open).toHaveBeenCalledWith(expect.objectContaining({ frameId: "frame-1" }), 11, controller.signal)
    await expect(
      instance.closeInput({
        binding,
        connectionId: "connection-2",
        principal,
        sessionId: opened.sessionId,
        transport: { frameId: "frame-2", senderId: 11 },
      }),
    ).resolves.toBe(false)
    await expect(
      instance.closeInput({
        binding,
        connectionId: "connection-1",
        principal,
        sessionId: opened.sessionId,
        transport: { frameId: "frame-1", senderId: 11 },
      }),
    ).resolves.toBe(true)
    expect(close).toHaveBeenCalledTimes(2)
  })

  test("preserves a typed connected-media resource failure for the portable Catalog error", async () => {
    const { instance } = adapter({
      async open() {
        throw new PluginHostApiResourceUnavailableError("native Project file disappeared")
      },
    })
    const inputKey = await currentInputKey(instance)

    const error = await instance
      .openInput({
        binding,
        connectionId: "connection-1",
        inputKey,
        principal,
        transport: { frameId: "frame-1", senderId: 11 },
      })
      .catch((failure: unknown) => failure)
    expect(error).toBeInstanceOf(PluginHostApiResourceUnavailableError)
    expect(pluginHostApiRemoteFailure("canvas.inputs.open", error)).toEqual({
      code: "resource-unavailable",
      kind: "api",
      message: "Plugin Host API resource is unavailable",
      recoverable: true,
    })
  })

  test("binds connected-image sessions to the exact Main-issued frame and forwards cancellation", async () => {
    const { closeImage, instance, openImage } = adapter()
    const controller = new AbortController()
    const inputKey = await currentInputKey(instance)
    const opened = await instance.openImageInput({
      binding,
      connectionId: "connection-1",
      inputKey,
      principal,
      signal: controller.signal,
      transport: { frameId: "frame-1", senderId: 11 },
    })
    expect(opened.probe).toMatchObject({ contentRevision: "d".repeat(64), mimeType: "image/png" })
    expect(openImage).toHaveBeenCalledWith(
      {
        canvasId: binding.canvasId,
        frameId: "frame-1",
        nodeId: binding.nodeId,
        pluginId: principal.pluginId,
        pluginVersion: principal.pluginVersion,
        projectId: binding.projectId,
        sourceNodeId: "source-1",
      },
      11,
      controller.signal,
    )
    await expect(
      instance.closeImageInput({
        binding,
        connectionId: "connection-1",
        principal,
        sessionId: opened.sessionId,
        signal: controller.signal,
        transport: { frameId: "frame-1", senderId: 11 },
      }),
    ).resolves.toBeTrue()
    expect(closeImage).toHaveBeenCalledWith(
      expect.objectContaining({ frameId: "frame-1", sessionId: opened.sessionId }),
      11,
    )
  })

  test("preserves connected-image resource failures for the Catalog error contract", async () => {
    const { instance } = adapter({
      async openImage() {
        throw new PluginHostApiResourceUnavailableError("connected image disappeared")
      },
    })
    const inputKey = await currentInputKey(instance)
    const error = await instance
      .openImageInput({
        binding,
        connectionId: "connection-1",
        inputKey,
        principal,
        transport: { frameId: "frame-1", senderId: 11 },
      })
      .catch((failure: unknown) => failure)
    expect(pluginHostApiRemoteFailure("canvas.inputs.image.open", error)).toEqual({
      code: "resource-unavailable",
      kind: "api",
      message: "Plugin Host API resource is unavailable",
      recoverable: true,
    })
  })

  test("does not misclassify internal bugs or durable partial success as recoverable resource errors", async () => {
    const bug = new TypeError("programmer invariant failed")
    const media = adapter({
      async open() {
        throw bug
      },
    })
    const inputKey = await currentInputKey(media.instance)
    await expect(
      media.instance.openInput({
        binding,
        connectionId: "connection-1",
        inputKey,
        principal,
        transport: { frameId: "frame-1", senderId: 11 },
      }),
    ).rejects.toBe(bug)

    const project = adapter({
      async readTextFile() {
        throw bug
      },
    })
    const projectFailure = await project.instance
      .readProjectText({
        path: "Notes/input.md",
        principal,
        projectId: binding.projectId,
      })
      .catch((failure: unknown) => failure)
    expect(projectFailure).toBe(bug)
    expect(pluginHostApiRemoteFailure("project.file.text.read", projectFailure)).toEqual({
      code: "internal-error",
      kind: "protocol",
      message: "Plugin Host request failed",
      recoverable: false,
    })

    const image = adapter({
      images: {
        async createForHostApi() {
          throw new PluginCanvasImagePublicationPartialSuccessError(
            "Generated/already-saved.png",
            new Error("Canvas CAS failed"),
          )
        },
      },
    })
    const partial = await image.instance
      .createCanvasImage({
        binding,
        checkpoint: {
          async checkpoint() {
            return {
              canvas: { id: binding.canvasId, name: "Canvas" },
              node: document.nodes[1]!,
              project: { id: binding.projectId, name: "Project" },
            }
          },
        },
        dataUrl: "data:image/png;base64,AAAA",
        name: "capture.png",
        operationId: "operation-1",
        principal,
      })
      .catch((failure: unknown) => failure)
    expect(pluginHostApiRemoteFailure("canvas.resource.image.create", partial)).toEqual({
      code: "partial-success",
      kind: "api",
      message: "Plugin Host API completed only the reported durable file publication",
      recoverable: false,
    })
  })
})

function generationCheckpoint(
  liveDocument: {
    id: string
    nodes: Array<{
      data: Record<string, unknown>
      id: string
      position: { x: number; y: number }
      type: string
    }>
  },
  ownerBinding = binding,
): PluginHostMutationCheckpoint {
  return {
    async checkpoint() {
      const owner = liveDocument.nodes.find(({ id }) => id === ownerBinding.nodeId)
      if (!owner) throw new Error("Missing test Plugin owner")
      return {
        canvas: { id: ownerBinding.canvasId, name: "Canvas" },
        node: owner as PluginHostNodeContext["node"],
        project: { id: ownerBinding.projectId, name: "Project" },
      }
    },
  }
}

function generationResult() {
  return {
    createdNodeIds: ["generated-1"],
    operationReceipt: null,
    projection: { edges: [], id: binding.canvasId, nodes: [], title: "Canvas" },
    toolId: "tool-1",
    warnings: [],
  }
}

function generationServiceResult() {
  return {
    ...generationResult(),
    projection: { edges: [], id: binding.canvasId, metadata: { title: "Canvas" }, nodes: [] },
  }
}

describe("PluginHostApiMainAdapter generation input keys", () => {
  test("resolves an opaque key without invalidating it for unrelated Canvas edits", async () => {
    const live = structuredClone(document) as any
    const generate = mock(async (_request: unknown) => generationServiceResult())
    const { instance } = adapter({
      document: () => live,
      generation: { generate, listTools: mock(async () => []) },
    })
    const inputKey = await currentInputKey(instance)
    expect(inputKey).not.toContain("source-1")

    live.nodes[0].position.x += 50
    live.nodes.push({
      data: { kind: "text", label: "Unrelated" },
      id: "unrelated",
      position: { x: 500, y: 500 },
      type: "file",
    })

    await expect(
      instance.executeGeneration({
        binding,
        checkpoint: generationCheckpoint(live),
        operationId: "generation-valid",
        principal,
        prompt: "Create",
        references: [{ inputKey, role: "reference_video" }],
      }),
    ).resolves.toEqual(generationResult())
    expect(generate).toHaveBeenCalledTimes(1)
    expect(generate.mock.calls[0]?.[0]).toMatchObject({
      referenceConstraint: {
        ownerNodeId: binding.nodeId,
        ownerPluginId: principal.pluginId,
        type: "direct-incoming",
      },
      references: [{ nodeId: "source-1", role: "reference_video" }],
    })
    expect(JSON.stringify(generate.mock.calls[0]?.[0])).not.toContain("inputKey")
  })

  test("rejects forged keys and role/type mismatches before calling the generation executor", async () => {
    const live = structuredClone(document) as any
    const generate = mock(async (_request: unknown) => generationServiceResult())
    const { instance } = adapter({
      document: () => live,
      generation: { generate, listTools: mock(async () => []) },
    })
    const inputKey = await currentInputKey(instance)
    const base = {
      binding,
      checkpoint: generationCheckpoint(live),
      operationId: "generation-invalid",
      principal,
      prompt: "Create",
    }

    await expect(
      instance.executeGeneration({
        ...base,
        references: [{ inputKey: `${inputKey.slice(0, -1)}x`, role: "reference_video" }],
      }),
    ).rejects.toMatchObject({ code: "stale-context" })
    await expect(
      instance.executeGeneration({
        ...base,
        references: [{ inputKey, role: "reference_image" }],
      }),
    ).rejects.toMatchObject({ code: "resource-unavailable" })
    expect(generate).not.toHaveBeenCalled()
  })

  test("invalidates a key when its direct edge or resource binding changes", async () => {
    const live = structuredClone(document) as any
    const generate = mock(async (_request: unknown) => generationServiceResult())
    const { instance } = adapter({
      document: () => live,
      generation: { generate, listTools: mock(async () => []) },
    })
    const edgeKey = await currentInputKey(instance)
    live.edges[0].id = "replacement-edge"
    await expect(
      instance.executeGeneration({
        binding,
        checkpoint: generationCheckpoint(live),
        operationId: "generation-stale-edge",
        principal,
        prompt: "Create",
        references: [{ inputKey: edgeKey, role: "reference_video" }],
      }),
    ).rejects.toMatchObject({ code: "stale-context" })

    const resourceKey = await currentInputKey(instance)
    live.nodes[0].data.resourceState = { contentRevision: "changed-content", status: "ready" }
    await expect(
      instance.executeGeneration({
        binding,
        checkpoint: generationCheckpoint(live),
        operationId: "generation-stale-resource",
        principal,
        prompt: "Create",
        references: [{ inputKey: resourceKey, role: "reference_video" }],
      }),
    ).rejects.toMatchObject({ code: "stale-context" })
    expect(generate).not.toHaveBeenCalled()
  })

  test("binds keys to the exact Plugin snapshot, owning node, and Project scope", async () => {
    const live = structuredClone(document) as any
    const generate = mock(async (_request: unknown) => generationServiceResult())
    const { instance } = adapter({
      document: () => live,
      generation: { generate, listTools: mock(async () => []) },
    })
    const inputKey = await currentInputKey(instance)
    const otherPrincipal = { ...principal, snapshotDigest: "d".repeat(64) }
    const otherScope = { ...binding, projectId: "project-2" }
    const otherNode = { ...binding, nodeId: "other-plugin-node" }
    live.nodes.push({
      data: {
        kind: "plugin.fixture",
        label: "Other owner",
        metadata: { convaxPlugin: { id: principal.pluginId, version: principal.pluginVersion } },
      },
      id: otherNode.nodeId,
      position: { x: 300, y: 0 },
      type: "file",
    })
    live.edges.push({
      id: "edge-other-owner",
      source: "source-1",
      sourceHandle: "output",
      target: otherNode.nodeId,
      targetHandle: "input",
    })

    for (const [caseName, testBinding, testPrincipal] of [
      ["snapshot", binding, otherPrincipal],
      ["scope", otherScope, principal],
      ["owner", otherNode, principal],
    ] as const) {
      await expect(
        instance.executeGeneration({
          binding: testBinding,
          checkpoint: generationCheckpoint(live, testBinding),
          operationId: `generation-cross-${caseName}`,
          principal: testPrincipal,
          prompt: "Create",
          references: [{ inputKey, role: "reference_video" }],
        }),
      ).rejects.toMatchObject({ code: "stale-context" })
    }
    expect(generate).not.toHaveBeenCalled()
  })
})
