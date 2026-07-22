import { afterEach, describe, expect, mock, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import {
  CanvasCommandIdConflictError,
  CanvasRevisionConflictError,
  createCanvasNodeContentGuard,
  type CanvasApplicationCommandResult,
} from "@convax/canvas/application"
import {
  createAgentNode,
  createCanvasDocument,
  createMediaNode,
  createTextNode as createCanvasTextNode,
  type CanvasDocument,
} from "@convax/canvas/core"
import { projectResourceReferenceKey, type ProjectResourceReference } from "@convax/project/canvas"
import type { GenerationCanvasRequest, GenerationToolDescription, GenerationToolSummary } from "../generation-contracts"
import {
  GenerationCanvasService,
  type GenerationCanvasFilePublisherPort,
  type GenerationCanvasManagedAssetPort,
  type GenerationCanvasProjectPort,
  type GenerationCanvasResourcePort,
  type GenerationCanvasServiceOptions,
  type PreparedGenerationToolExecution,
  type GenerationToolExecutionPort,
} from "./generation-canvas-service"
import { copyStableFile } from "./stable-file-copy"
import type { CanvasRendererBridge } from "./canvas-renderer-bridge"
import type { McpToolCallResult } from "./stdio-mcp-client"
import { validateGenerationToolInput } from "./generation-tool-input-schema"

const temporaryDirectories: string[] = []

function managedReference(
  name = "reference.png",
  sha256 = "a".repeat(64),
  mediaType = "image/png",
): Extract<ProjectResourceReference, { kind: "managed-asset" }> {
  return { kind: "managed-asset", mediaType, name, sha256 }
}

function projectFileReference(path: string): Extract<ProjectResourceReference, { kind: "project-file" }> {
  return { kind: "project-file", path }
}

function createTextNode(input: { id: string; label?: string; position: { x: number; y: number }; text?: string }) {
  const text = input.text ?? ""
  return createCanvasTextNode({
    id: input.id,
    label: input.label,
    metadata: {
      [projectResourceReferenceKey]: projectFileReference(`References/${input.id}.md`),
    },
    mimeType: "text/markdown",
    name: `${input.id}.md`,
    position: input.position,
    resourceState: { contentRevision: "runtime-only", status: "ready", text },
  })
}

async function temporaryDirectory() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "convax-generation-service-test-"))
  temporaryDirectories.push(directory)
  return directory
}

async function writeProjectTextReferences(root: string, entries: Record<string, string>) {
  await fs.mkdir(path.join(root, "References"), { recursive: true })
  for (const [id, text] of Object.entries(entries)) {
    await fs.writeFile(path.join(root, "References", `${id}.md`), text, "utf8")
  }
}

function projectPortFor(
  root: string,
  onResolve?: (portablePath: string) => Promise<void> | void,
): GenerationCanvasProjectPort {
  const nativePath = (portablePath: string) => path.join(root, ...portablePath.split("/"))
  return {
    async readFileInfo(input) {
      const target = nativePath(input.path)
      const stat = await fs.stat(target)
      return {
        mimeType: "text/markdown",
        name: path.basename(target),
        path: input.path,
        size: stat.size,
      }
    },
    async resolveEntryPath(input) {
      const portablePath = input.path ?? ""
      await onResolve?.(portablePath)
      return nativePath(portablePath)
    },
  }
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { force: true, recursive: true })),
  )
})

function request(overrides: Partial<GenerationCanvasRequest> = {}): GenerationCanvasRequest {
  return {
    anchor: { x: 120, y: 80 },
    expectedRevision: 0,
    operationId: "operation-one",
    prompt: "Draw a small fox",
    ref: { canvasId: "canvas-one", scopeId: "project-one" },
    references: [],
    ...overrides,
  }
}

function tool(overrides: Partial<GenerationToolSummary> = {}): GenerationToolSummary {
  return {
    acceptedInputs: [],
    description: "Generate text",
    id: "creative-tools/write",
    kind: "model",
    modelName: "Write",
    output: "text",
    pluginId: "creative-tools",
    pluginName: "Creative Tools",
    title: "Write",
    toolId: "write",
    ...overrides,
  }
}

function pluginNode(id = "plugin-owner", pluginId = "creative-tools"): CanvasDocument["nodes"][number] {
  return {
    data: {
      kind: `plugin.${pluginId}`,
      label: "Plugin",
    },
    id,
    position: { x: 320, y: 0 },
    type: "file",
  }
}

function commandResult(document: CanvasDocument, createdNodeIds = ["generated-one"]): CanvasApplicationCommandResult {
  return {
    affectedNodeIds: createdNodeIds,
    changed: true,
    createdNodeIds,
    document: { ...document, revision: document.revision + 1 },
    storageVersion: "storage-two",
    warnings: [],
  }
}

function persistedCommandResult(
  document: CanvasDocument,
  createdNodeIds: readonly string[],
  affectedNodeIds: readonly string[] = createdNodeIds,
): CanvasApplicationCommandResult {
  return {
    affectedNodeIds: [...affectedNodeIds],
    changed: true,
    createdNodeIds: [...createdNodeIds],
    document,
    storageVersion: `storage-${document.revision}`,
    warnings: [],
  }
}

type GenerationLimitOverrides = Pick<
  GenerationCanvasServiceOptions,
  "maxInputBytes" | "maxInputFileBytes" | "maxInlineOutputFileBytes" | "maxOutputFileBytes" | "maxOutputFiles"
>

function setup(
  options: {
    assets?: GenerationCanvasManagedAssetPort
    document?: CanvasDocument
    loadDocument?: () => Promise<{ document: CanvasDocument | null }> | { document: CanvasDocument | null }
    prepareTool?: (tool: GenerationToolSummary, signal?: AbortSignal) => Promise<void>
    publisher?: GenerationCanvasFilePublisherPort
    project?: Partial<GenerationCanvasProjectPort>
    resource?: Partial<GenerationCanvasResourcePort>
    result?: McpToolCallResult | ((input: Record<string, unknown>, signal?: AbortSignal) => Promise<McpToolCallResult>)
    scopeId?: string
    selectedTool?: GenerationToolSummary
    toolDescription?: GenerationToolDescription
  } & GenerationLimitOverrides,
) {
  const document = options.document ?? createCanvasDocument({ id: "canvas-one", title: "Canvas" })
  const selectedTool = options.selectedTool ?? tool()
  const calls: Record<string, unknown>[] = []
  const call: PreparedGenerationToolExecution["call"] = async (input, signal, onExternalStart) => {
    calls.push(input)
    onExternalStart?.()
    return typeof options.result === "function"
      ? options.result(input, signal)
      : (options.result ?? { content: [{ text: "A generated paragraph", type: "text" }] })
  }
  const tools: GenerationToolExecutionPort = {
    async describeTool() {
      return options.toolDescription ?? { fields: [], toolId: selectedTool.id }
    },
    async listTools() {
      return [selectedTool]
    },
    async prepareTool(selected, signal) {
      await options.prepareTool?.(selected, signal)
      const description = options.toolDescription ?? { fields: [], toolId: selectedTool.id }
      return { call, validateInput: (input) => validateGenerationToolInput(description, input) }
    },
  }
  const published: Array<{
    bytes?: Uint8Array
    extension: string
    name?: string
    projectId: string
    sourcePath?: string
  }> = []
  const publisher = options.publisher ?? {
    async publishGenerated(input: {
      bytes?: Uint8Array
      extension: string
      name?: string
      projectId: string
      sourcePath?: string
    }) {
      published.push(input)
      return { path: `Generated/generated-${published.length}${input.extension}` }
    },
  }
  const project: GenerationCanvasProjectPort = {
    async readFileInfo() {
      throw new Error("Unexpected readFileInfo")
    },
    async resolveEntryPath() {
      throw new Error("Unexpected resolveEntryPath")
    },
    ...options.project,
  }
  const resourceRequests: Parameters<GenerationCanvasResourcePort["addResources"]>[0][] = []
  const replacementRequests: Parameters<GenerationCanvasResourcePort["replaceResource"]>[0][] = []
  const resources: GenerationCanvasResourcePort = {
    async addResources(input) {
      resourceRequests.push(input)
      return commandResult(document)
    },
    async createPendingResource() {
      throw new Error("Unexpected createPendingResource")
    },
    async failPendingResource() {
      throw new Error("Unexpected failPendingResource")
    },
    async replaceResource(input) {
      replacementRequests.push(input)
      return {
        ...commandResult(document, []),
        affectedNodeIds: [input.targetNodeId],
      }
    },
    ...options.resource,
  }
  const viewRequests: Parameters<CanvasRendererBridge["executeView"]>[0][] = []
  const viewSnapshot = {
    documentId: document.id,
    revision: document.revision,
    scopeId: options.scopeId ?? "project-one",
    selectedEdgeIds: [],
    selectedNodeIds: [],
    viewId: "desktop-main",
    viewport: { x: 0, y: 0, zoom: 1 },
  }
  const renderer: CanvasRendererBridge = {
    async executeView(input) {
      viewRequests.push(input)
      return {
        foundNodeIds: ["generated-one"],
        missingNodeIds: [],
        snapshot: { ...viewSnapshot, revision: document.revision + 1 },
      }
    },
    async getViewSnapshot() {
      return { ...viewSnapshot, revision: document.revision }
    },
    async reloadDocument() {
      return true
    },
  }
  return {
    calls,
    renderer,
    replacementRequests,
    resourceRequests,
    service: new GenerationCanvasService({
      assets: options.assets ?? {
        async resolve() {
          throw new Error("Unexpected managed asset resolve")
        },
      },
      documents: {
        async load() {
          return options.loadDocument ? options.loadDocument() : { document }
        },
      },
      ...(options.maxInputBytes === undefined ? {} : { maxInputBytes: options.maxInputBytes }),
      ...(options.maxInputFileBytes === undefined ? {} : { maxInputFileBytes: options.maxInputFileBytes }),
      ...(options.maxInlineOutputFileBytes === undefined
        ? {}
        : { maxInlineOutputFileBytes: options.maxInlineOutputFileBytes }),
      ...(options.maxOutputFileBytes === undefined ? {} : { maxOutputFileBytes: options.maxOutputFileBytes }),
      ...(options.maxOutputFiles === undefined ? {} : { maxOutputFiles: options.maxOutputFiles }),
      publisher,
      projects: project,
      renderer,
      resources,
      temporaryRoot: os.tmpdir(),
      tools,
    }),
    published,
    viewRequests,
  }
}

function setupPendingGeneration(
  result: McpToolCallResult | ((input: Record<string, unknown>, signal?: AbortSignal) => Promise<McpToolCallResult>),
  options: {
    prepareTool?: (tool: GenerationToolSummary, signal?: AbortSignal) => Promise<void>
    roundTripPending?: boolean
  } = {},
) {
  const reference = createTextNode({ id: "brief", position: { x: 0, y: 0 }, text: "Stable brief" })
  const owner = createTextNode({ id: "plugin-owner", position: { x: 360, y: 0 }, text: "Plugin card" })
  let currentDocument = createCanvasDocument({
    edges: [{ id: "reference-to-owner", source: reference.id, target: owner.id }],
    id: "canvas-one",
    nodes: [reference, owner],
    title: "Canvas",
  })
  let liveRevision = currentDocument.revision
  const createRequests: Parameters<GenerationCanvasResourcePort["createPendingResource"]>[0][] = []
  const failureRequests: Parameters<GenerationCanvasResourcePort["failPendingResource"]>[0][] = []
  const replacementRequests: Parameters<GenerationCanvasResourcePort["replaceResource"]>[0][] = []
  const reloadRevisions: number[] = []
  const pendingNodeId = "pending-one"

  const harness = setup({
    document: currentDocument,
    loadDocument: () => ({ document: currentDocument }),
    prepareTool: options.prepareTool,
    resource: {
      async addResources() {
        throw new Error("Pending generation must not add a second Canvas node")
      },
      async createPendingResource(input) {
        createRequests.push(input)
        const node = createMediaNode({
          id: pendingNodeId,
          label: "Image",
          position: input.anchor,
          resource: { id: pendingNodeId, kind: "image", url: "" },
        })
        node.data.status = "pending"
        currentDocument = {
          ...currentDocument,
          edges: [
            ...currentDocument.edges,
            ...(input.relation?.mode === "connect"
              ? input.relation.anchorNodeIds.map((anchorNodeId, index) => ({
                  id: `pending-edge-${index}`,
                  source: anchorNodeId,
                  target: pendingNodeId,
                }))
              : []),
          ],
          nodes: [...currentDocument.nodes, node],
          revision: currentDocument.revision + 1,
        }
        if (options.roundTripPending) {
          currentDocument = {
            ...currentDocument,
            nodes: currentDocument.nodes.map((current) =>
              current.id === pendingNodeId
                ? {
                    ...current,
                    data: { kind: "image" as const, label: "Image", status: "pending" as const, url: "" },
                  }
                : current,
            ),
          }
        }
        return persistedCommandResult(
          currentDocument,
          [pendingNodeId],
          [...(input.relation?.mode === "connect" ? input.relation.anchorNodeIds : []), pendingNodeId],
        )
      },
      async failPendingResource(input) {
        failureRequests.push(input)
        const target = currentDocument.nodes.find((node) => node.id === input.targetNodeId)
        if (
          !target ||
          target.data.status !== "pending" ||
          JSON.stringify(createCanvasNodeContentGuard(target)) !== JSON.stringify(input.expectedTarget)
        ) {
          throw new Error("Pending target changed")
        }
        currentDocument = {
          ...currentDocument,
          nodes: currentDocument.nodes.map((node) =>
            node.id === input.targetNodeId
              ? { ...node, data: { ...node.data, error: input.message, status: "error" as const } }
              : node,
          ),
          revision: currentDocument.revision + 1,
        }
        return persistedCommandResult(currentDocument, [], [input.targetNodeId])
      },
      async replaceResource(input) {
        replacementRequests.push(input)
        currentDocument = {
          ...currentDocument,
          nodes: currentDocument.nodes.map((node) =>
            node.id === input.targetNodeId
              ? { ...node, data: { ...node.data, error: undefined, status: "idle" as const, url: "managed" } }
              : node,
          ),
          revision: currentDocument.revision + 1,
        }
        return persistedCommandResult(currentDocument, [], [input.targetNodeId])
      },
    },
    result,
    selectedTool: tool({
      acceptedInputs: ["text"],
      id: "creative-tools/draw",
      output: "image",
      toolId: "draw",
    }),
  })
  harness.renderer.getViewSnapshot = mock(async () => ({
    documentId: currentDocument.id,
    revision: liveRevision,
    scopeId: "project-one",
    selectedEdgeIds: [],
    selectedNodeIds: [],
    viewId: "desktop-main",
    viewport: { x: 0, y: 0, zoom: 1 },
  }))
  harness.renderer.reloadDocument = mock(async () => {
    liveRevision = currentDocument.revision
    reloadRevisions.push(liveRevision)
    return true
  })

  return {
    ...harness,
    createRequests,
    failureRequests,
    getDocument: () => currentDocument,
    mutateDocument(mutate: (document: CanvasDocument) => CanvasDocument) {
      currentDocument = mutate(currentDocument)
      liveRevision = currentDocument.revision
    },
    pendingNodeId,
    reference,
    owner,
    reloadRevisions,
    replacementRequests,
  }
}

describe("GenerationCanvasService", () => {
  test("never auto-selects an operation but permits its explicit host tool id", async () => {
    const operation = tool({
      agentId: "run",
      id: "media-tools/trim",
      kind: "operation",
      modelName: undefined,
      toolId: "trim",
    })
    const automatic = setup({ selectedTool: operation })

    await expect(automatic.service.generate(request(), { id: "renderer:1", kind: "ui" })).rejects.toThrow(
      "No installed generation tool accepts this request",
    )
    expect(automatic.calls).toHaveLength(0)

    const explicit = setup({ selectedTool: operation })
    await expect(
      explicit.service.generate(request({ toolId: operation.id }), { id: "renderer:1", kind: "ui" }),
    ).resolves.toMatchObject({ toolId: operation.id })
    expect(explicit.calls).toHaveLength(1)
  })

  const generationLimitMaximums = [
    ["maxInputFileBytes", 2 * 1024 * 1024 * 1024],
    ["maxInputBytes", 2 * 1024 * 1024 * 1024],
    ["maxInlineOutputFileBytes", 64 * 1024 * 1024],
    ["maxOutputFileBytes", 2 * 1024 * 1024 * 1024],
    ["maxOutputFiles", 16],
  ] as const satisfies ReadonlyArray<readonly [keyof GenerationLimitOverrides, number]>
  const invalidGenerationLimitCases = generationLimitMaximums.flatMap(([option, maximum]) =>
    [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1, maximum + 1].map(
      (value) => [option, value, maximum] as const,
    ),
  )

  test.each(invalidGenerationLimitCases)(
    "rejects invalid or hard-limit-raising %s override %p above maximum %p",
    (option, value, maximum) => {
      expect(() => setup({ [option]: value } as GenerationLimitOverrides)).toThrow(
        `Generation ${option} must be a positive safe integer no greater than ${maximum}`,
      )
    },
  )

  test("commits text output without changing the caller's selection or viewport", async () => {
    const { calls, published, resourceRequests, service, viewRequests } = setup({})

    await expect(service.generate(request(), { id: "renderer:1", kind: "ui" })).resolves.toEqual({
      createdNodeIds: ["generated-one"],
      revision: 1,
      toolId: "creative-tools/write",
      warnings: [],
    })

    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      operation_id: "convax-580314c43bc1422ee8937446cd9974a4970792ef5255fa97572d9dd94c829ed7",
      output: "text",
      prompt: "Draw a small fox",
      references: [],
      schema: "convax.generation-call/1",
    })
    expect(Object.keys(calls[0]).sort()).toEqual([
      "operation_id",
      "output",
      "output_directory",
      "prompt",
      "references",
      "schema",
    ])
    expect(published).toEqual([
      {
        bytes: Buffer.from("A generated paragraph", "utf8"),
        extension: ".md",
        name: "generated",
        projectId: "project-one",
      },
    ])
    expect(resourceRequests).toHaveLength(1)
    expect(resourceRequests[0]).toMatchObject({
      actor: { id: "renderer:1", kind: "ui" },
      canvasId: "canvas-one",
      commandId: "generation:operation-one",
      expectedRevision: 0,
      scopeId: "project-one",
      sources: [{ kind: "host-file", path: "Generated/generated-1.md" }],
    })
    expect(resourceRequests[0].conflictPolicy).toBe("retry")
    expect(viewRequests).toHaveLength(1)
    expect(viewRequests[0]?.command).toEqual({
      fit: "none",
      nodeIds: ["generated-one"],
      select: false,
      type: "nodes.reveal",
    })
    expect(viewRequests[0]).toMatchObject({
      expectedRevision: 1,
    })
  })

  test("returns one bounded text operation result without creating or refreshing Canvas nodes", async () => {
    let document = createCanvasDocument({ id: "canvas-one", title: "Canvas" })
    const selectedTool = tool({
      agentId: "import_media",
      delivery: "return",
      id: "media-import/import",
      kind: "operation",
      modelName: undefined,
      toolId: "import",
    })
    const harness = setup({
      document,
      loadDocument: () => ({ document }),
      async result() {
        document = { ...document, revision: 3 }
        return {
          content: [
            { text: "asset-one", type: "text" },
            { text: "asset-two", type: "text" },
          ],
        }
      },
      selectedTool,
    })
    harness.renderer.reloadDocument = mock(async () => true)
    const actor = { id: "opencode:project-one", kind: "agent" as const }
    const returnRequest = request({
      expectedOutputCount: 1,
      resultMode: { type: "return" },
      toolId: selectedTool.id,
    })

    const result = await harness.service.generate(returnRequest, actor)

    expect(result).toEqual({
      createdNodeIds: [],
      outputText: "asset-one\n\nasset-two",
      revision: 3,
      toolId: "media-import/import",
      warnings: [],
    })
    expect(harness.published).toEqual([])
    expect(harness.resourceRequests).toEqual([])
    expect(harness.replacementRequests).toEqual([])
    expect(harness.viewRequests).toEqual([])
    expect(harness.renderer.reloadDocument).toHaveBeenCalledTimes(0)

    await expect(harness.service.generate(returnRequest, actor)).resolves.toEqual(result)
    expect(harness.calls).toHaveLength(1)
  })

  test("rejects malformed or mismatched return delivery before invoking the external tool", async () => {
    const cases: Array<{
      message: string
      request: Partial<GenerationCanvasRequest>
      selectedTool: GenerationToolSummary
    }> = [
      {
        message: "must be text Plugin operations",
        request: { resultMode: { type: "return" }, toolId: "creative-tools/write" },
        selectedTool: tool({ delivery: "return" }),
      },
      {
        message: "requires a Plugin operation declared with return delivery",
        request: { resultMode: { type: "return" }, toolId: "creative-tools/write" },
        selectedTool: tool({ kind: "operation", modelName: undefined }),
      },
      {
        message: "must be text Plugin operations",
        request: { output: "image", resultMode: { type: "return" }, toolId: "creative-tools/draw" },
        selectedTool: tool({
          delivery: "return",
          id: "creative-tools/draw",
          kind: "operation",
          modelName: undefined,
          output: "image",
          toolId: "draw",
        }),
      },
      {
        message: "require the host-only return result mode",
        request: { toolId: "creative-tools/write" },
        selectedTool: tool({ delivery: "return", kind: "operation", modelName: undefined }),
      },
      {
        message: "expect exactly one text output",
        request: {
          expectedOutputCount: 2,
          resultMode: { type: "return" },
          toolId: "creative-tools/write",
        },
        selectedTool: tool({ delivery: "return", kind: "operation", modelName: undefined }),
      },
      {
        message: "require a Plugin operation with accepted inputs",
        request: { toolId: "creative-tools/write" },
        selectedTool: tool({ acceptedInputs: ["text"], inputBinding: "direct-incoming" }),
      },
      {
        message: "require a Plugin operation with accepted inputs",
        request: { toolId: "creative-tools/write" },
        selectedTool: tool({ inputBinding: "direct-incoming", kind: "operation", modelName: undefined }),
      },
      {
        message: "unsupported input binding",
        request: { toolId: "creative-tools/write" },
        selectedTool: tool({ inputBinding: "unsupported" as "direct-incoming" }),
      },
    ]

    for (const input of cases) {
      const harness = setup({ selectedTool: input.selectedTool })
      await expect(
        harness.service.generate(request(input.request), { id: "opencode:project-one", kind: "agent" }),
      ).rejects.toThrow(input.message)
      expect(harness.calls).toEqual([])
    }

    const relation = setup({
      selectedTool: tool({ delivery: "return", kind: "operation", modelName: undefined }),
    })
    await expect(
      relation.service.generate(
        request({
          relationAnchorNodeIds: ["unrelated"],
          resultMode: { type: "return" },
          toolId: "creative-tools/write",
        }),
        { id: "opencode:project-one", kind: "agent" },
      ),
    ).rejects.toThrow("cannot include Canvas relation anchors")
    expect(relation.calls).toEqual([])
  })

  test("bounds returned operation text and retains the attempted side effect for at-most-once replay", async () => {
    const selectedTool = tool({
      delivery: "return",
      kind: "operation",
      modelName: undefined,
    })
    const { calls, resourceRequests, service } = setup({
      result: { content: [{ text: "x".repeat(64 * 1024 + 1), type: "text" }] },
      selectedTool,
    })
    const actor = { id: "opencode:project-one", kind: "agent" as const }
    const returnRequest = request({ resultMode: { type: "return" }, toolId: selectedTool.id })

    await expect(service.generate(returnRequest, actor)).rejects.toThrow("Agent result size limit")
    await expect(service.generate(returnRequest, actor)).rejects.toThrow("Agent result size limit")
    expect(calls).toHaveLength(1)
    expect(resourceRequests).toEqual([])
  })

  test("rechecks return-operation references after the external side effect and never retries a stale attempt", async () => {
    const reference = createTextNode({ id: "brief", position: { x: 0, y: 0 }, text: "Original brief" })
    const document = createCanvasDocument({ id: "canvas-one", nodes: [reference], title: "Canvas" })
    const selectedTool = tool({
      acceptedInputs: ["text"],
      delivery: "return",
      kind: "operation",
      modelName: undefined,
    })
    const { calls, resourceRequests, service } = setup({
      document,
      async result() {
        reference.data.text = "Changed while the operation was running"
        return { content: [{ text: "external-id", type: "text" }] }
      },
      selectedTool,
    })
    const actor = { id: "opencode:project-one", kind: "agent" as const }
    const returnRequest = request({
      references: [{ nodeId: reference.id, role: "text" }],
      resultMode: { type: "return" },
      toolId: selectedTool.id,
    })

    await expect(service.generate(returnRequest, actor)).rejects.toThrow(
      "Generation references changed while the tool was running",
    )
    await expect(service.generate(returnRequest, actor)).rejects.toThrow(
      "Generation references changed while the tool was running",
    )
    expect(calls).toHaveLength(1)
    expect(resourceRequests).toEqual([])
  })

  test("enforces a manifest-declared direct-incoming owner from the installed Plugin", async () => {
    const owner = pluginNode()
    owner.data.kind = "remote-editor"
    owner.data.metadata = { convaxPlugin: { id: "creative-tools" } }
    const reference = createTextNode({ id: "brief", position: { x: 0, y: 0 }, text: "Import this" })
    const document = createCanvasDocument({
      edges: [{ id: "brief-to-plugin", source: reference.id, target: owner.id }],
      id: "canvas-one",
      nodes: [reference, owner],
      title: "Canvas",
    })
    const selectedTool = tool({
      acceptedInputs: ["text"],
      agentId: "import_media",
      delivery: "return",
      inputBinding: "direct-incoming",
      kind: "operation",
      modelName: undefined,
    })
    const harness = setup({
      document,
      result: { content: [{ text: "external-asset", type: "text" }] },
      selectedTool,
    })
    const boundRequest = request({
      expectedOutputCount: 1,
      referenceConstraint: {
        ownerNodeId: owner.id,
        ownerPluginId: selectedTool.pluginId,
        type: "direct-incoming",
      },
      references: [{ nodeId: reference.id, role: "text" }],
      resultMode: { type: "return" },
      toolId: selectedTool.id,
    })

    await expect(
      harness.service.generate(boundRequest, { id: "opencode:project-one", kind: "agent" }),
    ).resolves.toMatchObject({
      createdNodeIds: [],
      outputText: "external-asset",
      toolId: selectedTool.id,
    })
    expect(harness.calls).toHaveLength(1)
    expect(harness.resourceRequests).toEqual([])
  })

  test("rejects a missing, mismatched, or forged direct-incoming Plugin owner before external execution", async () => {
    const reference = createTextNode({ id: "brief", position: { x: 0, y: 0 }, text: "Import this" })
    const selectedTool = tool({
      acceptedInputs: ["text"],
      agentId: "import_media",
      delivery: "return",
      inputBinding: "direct-incoming",
      kind: "operation",
      modelName: undefined,
    })
    const actor = { id: "opencode:project-one", kind: "agent" as const }

    const missing = setup({
      document: createCanvasDocument({ id: "canvas-one", nodes: [reference], title: "Canvas" }),
      selectedTool,
    })
    await expect(
      missing.service.generate(
        request({
          references: [{ nodeId: reference.id, role: "text" }],
          resultMode: { type: "return" },
          toolId: selectedTool.id,
        }),
        actor,
      ),
    ).rejects.toThrow("requires a direct-incoming owner")
    expect(missing.calls).toEqual([])

    const owner = pluginNode("plugin-owner", "another-plugin")
    owner.data.metadata = { convaxPlugin: { id: "creative-tools" } }
    const document = createCanvasDocument({
      edges: [{ id: "brief-to-plugin", source: reference.id, target: owner.id }],
      id: "canvas-one",
      nodes: [reference, owner],
      title: "Canvas",
    })
    const forged = setup({ document, selectedTool })
    await expect(
      forged.service.generate(
        request({
          referenceConstraint: {
            ownerNodeId: owner.id,
            ownerPluginId: selectedTool.pluginId,
            type: "direct-incoming",
          },
          references: [{ nodeId: reference.id, role: "text" }],
          resultMode: { type: "return" },
          toolId: selectedTool.id,
        }),
        actor,
      ),
    ).rejects.toThrow("declared Plugin Canvas node")
    expect(forged.calls).toEqual([])

    const mismatch = setup({ document, selectedTool })
    await expect(
      mismatch.service.generate(
        request({
          referenceConstraint: {
            ownerNodeId: owner.id,
            ownerPluginId: "another-plugin",
            type: "direct-incoming",
          },
          references: [{ nodeId: reference.id, role: "text" }],
          resultMode: { type: "return" },
          toolId: selectedTool.id,
        }),
        actor,
      ),
    ).rejects.toThrow("bound to its installed Plugin")
    expect(mismatch.calls).toEqual([])
  })

  test("rechecks the exact Plugin owner identity after a direct-incoming side effect", async () => {
    const owner = pluginNode()
    const reference = createTextNode({ id: "brief", position: { x: 0, y: 0 }, text: "Import this" })
    const document = createCanvasDocument({
      edges: [{ id: "brief-to-plugin", source: reference.id, target: owner.id }],
      id: "canvas-one",
      nodes: [reference, owner],
      title: "Canvas",
    })
    const selectedTool = tool({
      acceptedInputs: ["text"],
      agentId: "import_media",
      delivery: "return",
      inputBinding: "direct-incoming",
      kind: "operation",
      modelName: undefined,
    })
    const { calls, service } = setup({
      document,
      async result() {
        owner.data.kind = "plugin.another-plugin"
        return { content: [{ text: "external-asset", type: "text" }] }
      },
      selectedTool,
    })
    const boundRequest = request({
      referenceConstraint: {
        ownerNodeId: owner.id,
        ownerPluginId: selectedTool.pluginId,
        type: "direct-incoming",
      },
      references: [{ nodeId: reference.id, role: "text" }],
      resultMode: { type: "return" },
      toolId: selectedTool.id,
    })
    const actor = { id: "opencode:project-one", kind: "agent" as const }

    await expect(service.generate(boundRequest, actor)).rejects.toThrow(
      "direct incoming references changed while the tool was running",
    )
    await expect(service.generate(boundRequest, actor)).rejects.toThrow(
      "direct incoming references changed while the tool was running",
    )
    expect(calls).toHaveLength(1)
  })

  test("creates and reveals a pending node before the external tool resolves, then replaces that same node", async () => {
    let markStarted!: () => void
    let release!: () => void
    const started = new Promise<void>((resolve) => {
      markStarted = resolve
    })
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])
    const harness = setupPendingGeneration(async () => {
      markStarted()
      await gate
      return { content: [{ data: png.toString("base64"), mimeType: "image/png", type: "image" }] }
    })
    const generation = harness.service.generate(
      request({
        output: "image",
        references: [{ nodeId: harness.reference.id, role: "text" }],
        resultMode: { type: "create-pending-node" },
        toolId: "creative-tools/draw",
      }),
      { id: "renderer:1", kind: "ui" },
    )

    await started
    expect(harness.createRequests).toHaveLength(1)
    expect(harness.createRequests[0]).toMatchObject({
      actor: { id: "renderer:1", kind: "ui" },
      anchor: { x: 120, y: 80 },
      canvasId: "canvas-one",
      commandId: "generation-pending:operation-one",
      conflictPolicy: "reject",
      expectedRevision: 0,
      kind: "image",
      relation: {
        anchorNodeIds: [harness.reference.id],
        direction: "from-anchor",
        mode: "connect",
      },
      scopeId: "project-one",
    })
    expect(harness.getDocument().revision).toBe(1)
    expect(harness.getDocument().nodes.find((node) => node.id === harness.pendingNodeId)?.data).toMatchObject({
      kind: "image",
      status: "pending",
    })
    expect(harness.reloadRevisions).toEqual([1])
    expect(harness.viewRequests).toHaveLength(1)
    expect(harness.viewRequests[0]).toMatchObject({
      command: {
        fit: "none",
        nodeIds: [harness.pendingNodeId],
        select: false,
        type: "nodes.reveal",
      },
      expectedRevision: 1,
    })
    expect(harness.replacementRequests).toEqual([])

    release()
    const generated = await generation
    expect(generated).toEqual({
      createdNodeIds: [harness.pendingNodeId],
      revision: 2,
      toolId: "creative-tools/draw",
      warnings: [],
    })
    expect(harness.resourceRequests).toEqual([])
    expect(harness.replacementRequests).toHaveLength(1)
    expect(harness.replacementRequests[0]).toMatchObject({
      commandId: "generation:operation-one",
      conflictPolicy: "retry",
      expectedRevision: 1,
      expectedTarget: expect.objectContaining({
        data: expect.objectContaining({ kind: "image", status: "pending" }),
        type: "file",
      }),
      targetNodeId: harness.pendingNodeId,
    })
    expect(harness.getDocument().nodes.find((node) => node.id === harness.pendingNodeId)?.data.status).toBe("idle")
    expect(harness.reloadRevisions).toEqual([1, 2])
  })

  test("connects a constrained Plugin owner to its pending generation node", async () => {
    let markStarted!: () => void
    let release!: () => void
    const started = new Promise<void>((resolve) => {
      markStarted = resolve
    })
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])
    const harness = setupPendingGeneration(async () => {
      markStarted()
      await gate
      return { content: [{ data: png.toString("base64"), mimeType: "image/png", type: "image" }] }
    })
    const generation = harness.service.generate(
      request({
        output: "image",
        referenceConstraint: { ownerNodeId: harness.owner.id, type: "direct-incoming" },
        references: [{ nodeId: harness.reference.id, role: "text" }],
        resultMode: { type: "create-pending-node" },
        toolId: "creative-tools/draw",
      }),
      { id: "renderer:1", kind: "ui" },
    )

    await started
    expect(harness.createRequests[0]?.relation).toEqual({
      anchorNodeIds: [harness.owner.id],
      direction: "from-anchor",
      mode: "connect",
    })
    expect(harness.getDocument().edges.filter((edge) => edge.target === harness.pendingNodeId)).toEqual([
      expect.objectContaining({ source: harness.owner.id, target: harness.pendingNodeId }),
    ])

    release()
    await expect(generation).resolves.toMatchObject({ createdNodeIds: [harness.pendingNodeId] })
  })

  test("does not create a pending node when cancellation wins during preflight", async () => {
    let markLoadStarted!: () => void
    let releaseLoad!: () => void
    const loadStarted = new Promise<void>((resolve) => {
      markLoadStarted = resolve
    })
    const loadGate = new Promise<void>((resolve) => {
      releaseLoad = resolve
    })
    const document = createCanvasDocument({ id: "canvas-one", title: "Canvas" })
    let createPendingCalls = 0
    const harness = setup({
      document,
      async loadDocument() {
        markLoadStarted()
        await loadGate
        return { document }
      },
      resource: {
        async createPendingResource() {
          createPendingCalls += 1
          throw new Error("Pending generation must not start after cancellation")
        },
      },
      selectedTool: tool({ id: "creative-tools/draw", output: "image", toolId: "draw" }),
    })
    const controller = new AbortController()
    const generation = harness.service.generate(
      request({
        output: "image",
        resultMode: { type: "create-pending-node" },
        toolId: "creative-tools/draw",
      }),
      { id: "renderer:1", kind: "ui" },
      controller.signal,
    )

    await loadStarted
    controller.abort("user canceled")
    releaseLoad()

    await expect(generation).rejects.toMatchObject({ name: "AbortError" })
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(createPendingCalls).toBe(0)
    expect(harness.calls).toEqual([])
  })

  test("retains a failed pending node with a host-safe error instead of raw sidecar details", async () => {
    const harness = setupPendingGeneration({
      content: [{ text: "Failed at /private/tmp/vendor-secret-output.png", type: "text" }],
      isError: true,
    })

    await expect(
      harness.service.generate(
        request({
          output: "image",
          references: [{ nodeId: harness.reference.id, role: "text" }],
          resultMode: { type: "create-pending-node" },
          toolId: "creative-tools/draw",
        }),
        { id: "renderer:1", kind: "ui" },
      ),
    ).rejects.toMatchObject({
      message: "Generation tool reported a failure",
      name: "GenerationToolReportedError",
    })

    expect(harness.replacementRequests).toEqual([])
    expect(harness.failureRequests).toHaveLength(1)
    expect(harness.failureRequests[0]).toMatchObject({
      commandId: "generation-pending-fail:operation-one",
      conflictPolicy: "retry",
      expectedRevision: 1,
      expectedTarget: expect.objectContaining({
        data: expect.objectContaining({ kind: "image", status: "pending" }),
        type: "file",
      }),
      message: "Generation could not be completed",
      targetNodeId: harness.pendingNodeId,
    })
    expect(harness.failureRequests[0]?.message).not.toContain("vendor-secret")
    expect(harness.getDocument().nodes.find((node) => node.id === harness.pendingNodeId)?.data).toMatchObject({
      error: "Generation could not be completed",
      status: "error",
    })
    expect(harness.reloadRevisions).toEqual([1, 2])
  })

  test("does not let a delayed Renderer projection block pending creation or replacement", async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])
    const harness = setupPendingGeneration({
      content: [{ data: png.toString("base64"), mimeType: "image/png", type: "image" }],
    })
    harness.renderer.reloadDocument = mock(() => new Promise<boolean>(() => undefined))

    await expect(
      harness.service.generate(
        request({
          output: "image",
          references: [{ nodeId: harness.reference.id, role: "text" }],
          resultMode: { type: "create-pending-node" },
          toolId: "creative-tools/draw",
        }),
        { id: "renderer:1", kind: "ui" },
      ),
    ).resolves.toMatchObject({ createdNodeIds: [harness.pendingNodeId], revision: 2 })

    expect(harness.calls).toHaveLength(1)
    expect(harness.createRequests).toHaveLength(1)
    expect(harness.replacementRequests).toHaveLength(1)
    expect(harness.getDocument().nodes.find((node) => node.id === harness.pendingNodeId)?.data.status).toBe("idle")
  })

  test("replaces a pending node after JSON persistence omits undefined media fields", async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])
    const harness = setupPendingGeneration(
      { content: [{ data: png.toString("base64"), mimeType: "image/png", type: "image" }] },
      { roundTripPending: true },
    )

    await expect(
      harness.service.generate(
        request({
          output: "image",
          references: [{ nodeId: harness.reference.id, role: "text" }],
          resultMode: { type: "create-pending-node" },
          toolId: "creative-tools/draw",
        }),
        { id: "renderer:1", kind: "ui" },
      ),
    ).resolves.toMatchObject({ createdNodeIds: [harness.pendingNodeId], revision: 2 })

    expect(harness.replacementRequests).toHaveLength(1)
    expect(harness.getDocument().nodes.find((node) => node.id === harness.pendingNodeId)?.data.status).toBe("idle")
  })

  test("marks a pending node error even when the Renderer never finishes synchronizing", async () => {
    const harness = setupPendingGeneration({ content: [], isError: true })
    harness.renderer.reloadDocument = mock(() => new Promise<boolean>(() => undefined))

    await expect(
      harness.service.generate(
        request({
          output: "image",
          references: [{ nodeId: harness.reference.id, role: "text" }],
          resultMode: { type: "create-pending-node" },
          toolId: "creative-tools/draw",
        }),
        { id: "renderer:1", kind: "ui" },
      ),
    ).rejects.toMatchObject({ name: "GenerationToolReportedError" })

    expect(harness.calls).toHaveLength(1)
    expect(harness.failureRequests).toHaveLength(1)
    expect(harness.getDocument().nodes.find((node) => node.id === harness.pendingNodeId)?.data).toMatchObject({
      error: "Generation could not be completed",
      status: "error",
    })
  })

  test("does not create a second pending node when preparation fails after the first node commit", async () => {
    const harness = setupPendingGeneration(
      { content: [{ text: "Unused output", type: "text" }] },
      {
        async prepareTool() {
          throw new Error("Executable authorization was denied")
        },
      },
    )
    const generationRequest = request({
      output: "image",
      references: [{ nodeId: harness.reference.id, role: "text" }],
      resultMode: { type: "create-pending-node" },
      toolId: "creative-tools/draw",
    })
    const actor = { id: "renderer:1", kind: "ui" as const }

    await expect(harness.service.generate(generationRequest, actor)).rejects.toThrow("authorization was denied")
    await expect(harness.service.generate(generationRequest, actor)).rejects.toThrow("authorization was denied")

    expect(harness.createRequests).toHaveLength(1)
    expect(harness.failureRequests).toHaveLength(1)
    expect(harness.calls).toEqual([])
    expect(harness.getDocument().nodes.filter((node) => node.id === harness.pendingNodeId)).toHaveLength(1)
    expect(harness.getDocument().nodes.find((node) => node.id === harness.pendingNodeId)?.data.status).toBe("error")
  })

  test("marks a canceled pending node without deleting it", async () => {
    let markStarted!: () => void
    const started = new Promise<void>((resolve) => {
      markStarted = resolve
    })
    const harness = setupPendingGeneration(async (_input, signal) => {
      markStarted()
      return new Promise<McpToolCallResult>((_resolve, reject) => {
        signal?.addEventListener(
          "abort",
          () => {
            const error = new Error("vendor cancellation details")
            error.name = "AbortError"
            reject(error)
          },
          { once: true },
        )
      })
    })
    const controller = new AbortController()
    const generation = harness.service.generate(
      request({
        output: "image",
        references: [{ nodeId: harness.reference.id, role: "text" }],
        resultMode: { type: "create-pending-node" },
        toolId: "creative-tools/draw",
      }),
      { id: "renderer:1", kind: "ui" },
      controller.signal,
    )

    await started
    controller.abort("user canceled")
    await expect(generation).rejects.toMatchObject({ name: "AbortError" })
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(harness.failureRequests).toHaveLength(1)
    expect(harness.failureRequests[0]?.message).toBe("Generation was canceled")
    expect(harness.getDocument().nodes.find((node) => node.id === harness.pendingNodeId)?.data).toMatchObject({
      error: "Generation was canceled",
      status: "error",
    })
    expect(harness.replacementRequests).toEqual([])
  })

  test("does not recreate a pending node that the user removed while generation was running", async () => {
    let markStarted!: () => void
    let release!: () => void
    const started = new Promise<void>((resolve) => {
      markStarted = resolve
    })
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const harness = setupPendingGeneration(async () => {
      markStarted()
      await gate
      return { content: [], isError: true }
    })
    const generation = harness.service.generate(
      request({
        output: "image",
        references: [{ nodeId: harness.reference.id, role: "text" }],
        resultMode: { type: "create-pending-node" },
        toolId: "creative-tools/draw",
      }),
      { id: "renderer:1", kind: "ui" },
    )

    await started
    harness.mutateDocument((document) => ({
      ...document,
      edges: document.edges.filter(
        (edge) => edge.source !== harness.pendingNodeId && edge.target !== harness.pendingNodeId,
      ),
      nodes: document.nodes.filter((node) => node.id !== harness.pendingNodeId),
      revision: document.revision + 1,
    }))
    release()

    await expect(generation).rejects.toThrow("Generation replacement target changed while the tool was running")
    expect(harness.failureRequests).toHaveLength(1)
    expect(harness.getDocument().nodes.some((node) => node.id === harness.pendingNodeId)).toBe(false)
    expect(harness.replacementRequests).toEqual([])
  })

  test("rejects unexpected output counts before committing resources", async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])
    const { resourceRequests, service } = setup({
      result: {
        content: [
          { data: png.toString("base64"), mimeType: "image/png", type: "image" },
          { data: png.toString("base64"), mimeType: "image/png", type: "image" },
        ],
      },
      selectedTool: tool({ id: "creative-tools/draw", output: "image", toolId: "draw" }),
    })

    await expect(
      service.generate(request({ expectedOutputCount: 1, output: "image", toolId: "creative-tools/draw" }), {
        id: "renderer:1",
        kind: "ui",
      }),
    ).rejects.toThrow("returned 2 outputs; expected exactly 1")
    expect(resourceRequests).toHaveLength(0)
  })

  test("connects host-only relation anchors without exposing them to the generation tool", async () => {
    const root = await temporaryDirectory()
    await writeProjectTextReferences(root, { brief: "Stable brief", "silent-video": "Pair anchor" })
    const reference = createTextNode({ id: "brief", position: { x: 0, y: 0 }, text: "Stable brief" })
    const relationAnchor = createTextNode({ id: "silent-video", position: { x: 360, y: 0 }, text: "Pair anchor" })
    const document = createCanvasDocument({ id: "canvas-one", nodes: [reference, relationAnchor], title: "Canvas" })
    const { calls, resourceRequests, service } = setup({
      document,
      project: projectPortFor(root),
      selectedTool: tool({ acceptedInputs: ["text"] }),
    })

    await service.generate(
      request({
        references: [{ nodeId: reference.id, role: "text" }],
        relationAnchorNodeIds: [reference.id, relationAnchor.id],
      }),
      { id: "renderer:1", kind: "ui" },
    )

    expect(calls[0]?.references).toEqual([{ kind: "text", node_id: reference.id, role: "text", text: "Stable brief" }])
    expect(resourceRequests[0]).toMatchObject({
      conflictPolicy: "retry",
      relation: {
        anchorNodeIds: [reference.id, relationAnchor.id],
        direction: "from-anchor",
        mode: "connect",
      },
    })
  })

  test("rejects a missing relation anchor before starting the external tool", async () => {
    const { calls, resourceRequests, service } = setup({})

    await expect(
      service.generate(request({ relationAnchorNodeIds: ["missing-node"] }), { id: "renderer:1", kind: "ui" }),
    ).rejects.toThrow("relation anchor node was not found")
    expect(calls).toHaveLength(0)
    expect(resourceRequests).toHaveLength(0)
  })

  test("replaces a card resource without adding, moving, revealing, or reconnecting nodes", async () => {
    const owner = createTextNode({
      id: "owner-card",
      label: "Character",
      position: { x: 240, y: 160 },
      text: "Describe a character",
    })
    owner.style = { height: 360, width: 480 }
    const other = createTextNode({ id: "other-card", position: { x: 0, y: 0 }, text: "Keep me" })
    const document = createCanvasDocument({
      edges: [{ id: "owner-edge", source: other.id, target: owner.id }],
      id: "canvas-one",
      nodes: [owner, other],
      title: "Canvas",
    })
    const { replacementRequests, resourceRequests, service, viewRequests } = setup({ document })

    await expect(
      service.generate(request({ resultMode: { nodeId: owner.id, type: "replace-node" } }), {
        id: "renderer:1",
        kind: "ui",
      }),
    ).resolves.toEqual({
      createdNodeIds: [],
      revision: 1,
      toolId: "creative-tools/write",
      warnings: [],
    })

    expect(resourceRequests).toEqual([])
    expect(replacementRequests).toHaveLength(1)
    expect(replacementRequests[0]).toMatchObject({
      actor: { id: "renderer:1", kind: "ui" },
      canvasId: "canvas-one",
      commandId: "generation:operation-one",
      expectedRevision: 0,
      expectedTarget: createCanvasNodeContentGuard(owner),
      scopeId: "project-one",
      source: { kind: "host-file", path: "Generated/generated-1.md" },
      targetNodeId: owner.id,
    })
    expect(replacementRequests[0]?.conflictPolicy).toBe("retry")
    expect(viewRequests).toEqual([])
  })

  test("admits only the first media output when one card is the generation result owner", async () => {
    const owner = createTextNode({ id: "owner-card", position: { x: 20, y: 40 }, text: "Generate me" })
    const document = createCanvasDocument({ id: "canvas-one", nodes: [owner], title: "Canvas" })
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])
    const { published, replacementRequests, resourceRequests, service } = setup({
      document,
      async result(input) {
        const outputDirectory = input.output_directory as string
        await Promise.all([
          fs.writeFile(path.join(outputDirectory, "first.png"), png),
          fs.writeFile(path.join(outputDirectory, "second.png"), png),
        ])
        return {
          content: [],
          structuredContent: {
            artifacts: [
              { mimeType: "image/png", path: "first.png" },
              { mimeType: "image/png", path: "second.png" },
            ],
          },
        }
      },
      selectedTool: tool({ id: "creative-tools/draw", output: "image", toolId: "draw" }),
    })

    const result = await service.generate(
      request({
        output: "image",
        resultMode: { nodeId: owner.id, type: "replace-node" },
        toolId: "creative-tools/draw",
      }),
      { id: "renderer:1", kind: "ui" },
    )

    expect(published).toHaveLength(1)
    expect(path.basename(published[0]?.sourcePath ?? "")).toContain("first")
    expect(resourceRequests).toEqual([])
    expect(replacementRequests).toHaveLength(1)
    expect(replacementRequests[0]?.source).toMatchObject({ kind: "host-file" })
    expect(result).toMatchObject({ createdNodeIds: [], toolId: "creative-tools/draw" })
    expect(result.warnings).toContain("Generation returned 2 outputs; only the first replaced the target card.")
  })

  test("allows unrelated Canvas revisions but rejects replacement-owner edits during a long generation", async () => {
    const owner = createTextNode({ id: "owner-card", position: { x: 20, y: 40 }, text: "Original" })
    let currentDocument = createCanvasDocument({ id: "canvas-one", nodes: [owner], title: "Canvas" })
    const unrelated = setup({
      document: currentDocument,
      loadDocument: () => ({ document: currentDocument }),
      async result() {
        currentDocument = {
          ...currentDocument,
          nodes: [owner, createTextNode({ id: "unrelated", position: { x: 500, y: 0 }, text: "Concurrent edit" })],
          revision: 1,
        }
        return { content: [{ text: "Generated", type: "text" }] }
      },
    })
    unrelated.renderer.getViewSnapshot = mock(async () => ({
      documentId: currentDocument.id,
      revision: currentDocument.revision,
      scopeId: "project-one",
      selectedEdgeIds: [],
      selectedNodeIds: [],
      viewId: "desktop-main",
      viewport: { x: 0, y: 0, zoom: 1 },
    }))

    await expect(
      unrelated.service.generate(request({ resultMode: { nodeId: owner.id, type: "replace-node" } }), {
        id: "renderer:1",
        kind: "ui",
      }),
    ).resolves.toMatchObject({ createdNodeIds: [] })
    expect(unrelated.replacementRequests).toHaveLength(1)

    const editedOwner = { ...owner, data: { ...owner.data, text: "User edited this card" } }
    currentDocument = createCanvasDocument({ id: "canvas-one", nodes: [owner], title: "Canvas" })
    const changed = setup({
      document: currentDocument,
      loadDocument: () => ({ document: currentDocument }),
      async result() {
        currentDocument = { ...currentDocument, nodes: [editedOwner], revision: 1 }
        return { content: [{ text: "Must not land", type: "text" }] }
      },
    })
    changed.renderer.getViewSnapshot = unrelated.renderer.getViewSnapshot

    await expect(
      changed.service.generate(
        request({ operationId: "changed-owner", resultMode: { nodeId: owner.id, type: "replace-node" } }),
        { id: "renderer:1", kind: "ui" },
      ),
    ).rejects.toThrow("replacement target changed")
    expect(changed.replacementRequests).toEqual([])
    expect(changed.published).toEqual([])
  })

  test.each([
    ["missing", createCanvasDocument({ id: "canvas-one", title: "Canvas" }), "missing-card"],
    [
      "agent",
      createCanvasDocument({
        id: "canvas-one",
        nodes: [createAgentNode({ id: "owner-card", position: { x: 0, y: 0 } })],
        title: "Canvas",
      }),
      "owner-card",
    ],
  ] as const)("rejects a %s replacement owner before starting the paid tool", async (_kind, document, nodeId) => {
    const { calls, replacementRequests, service } = setup({ document })

    await expect(
      service.generate(request({ resultMode: { nodeId, type: "replace-node" } }), { id: "renderer:1", kind: "ui" }),
    ).rejects.toThrow(/replacement (node was not found|requires a Canvas file node)/)
    expect(calls).toEqual([])
    expect(replacementRequests).toEqual([])
  })

  test("merges only currently declared scalar tool inputs and fingerprints them", async () => {
    const toolDescription: GenerationToolDescription = {
      fields: [
        {
          choices: [
            { label: "Standard", value: "standard" },
            { label: "High", value: "high" },
          ],
          id: "quality",
          kind: "select",
          label: "Quality",
          required: true,
        },
        {
          id: "steps",
          kind: "integer",
          label: "Steps",
          maximum: 50,
          minimum: 1,
          required: false,
        },
        {
          id: "enhance",
          kind: "boolean",
          label: "Enhance",
          required: false,
        },
      ],
      toolId: "creative-tools/write",
    }
    const { calls, service } = setup({ toolDescription })
    const configured = request({ toolInput: { enhance: true, quality: "high", steps: 20 } })

    await service.generate(configured, { id: "renderer:1", kind: "ui" })
    expect(calls[0]).toMatchObject({
      enhance: true,
      quality: "high",
      schema: "convax.generation-call/1",
      steps: 20,
    })
    await expect(
      service.generate(
        { ...configured, toolInput: { enhance: true, quality: "standard", steps: 20 } },
        { id: "renderer:1", kind: "ui" },
      ),
    ).rejects.toBeInstanceOf(CanvasCommandIdConflictError)
    expect(calls).toHaveLength(1)
  })

  test("revalidates tool input before the external call and rejects reserved or unbounded direct input early", async () => {
    let prepared = 0
    const toolDescription: GenerationToolDescription = {
      fields: [
        {
          choices: [{ label: "High", value: "high" }],
          id: "quality",
          kind: "select",
          label: "Quality",
          required: true,
        },
      ],
      toolId: "creative-tools/write",
    }
    const { calls, service } = setup({
      prepareTool: async () => {
        prepared += 1
      },
      toolDescription,
    })

    await expect(
      service.generate(request({ operationId: "missing-required" }), { id: "renderer:1", kind: "ui" }),
    ).rejects.toThrow("required: quality")
    expect(prepared).toBe(1)
    expect(calls).toEqual([])

    await expect(
      service.generate(request({ operationId: "reserved", toolInput: { prompt: "override" } }), {
        id: "renderer:1",
        kind: "ui",
      }),
    ).rejects.toThrow("cannot override host field")
    const nested = request({ operationId: "nested" })
    Object.assign(nested, { toolInput: { quality: { hidden: true } } })
    await expect(service.generate(nested, { id: "renderer:1", kind: "ui" })).rejects.toThrow(
      "tool input value is invalid",
    )
    expect(prepared).toBe(1)
    expect(calls).toEqual([])
  })

  test("scopes opaque sidecar operation ids to Project, Canvas, and actor", async () => {
    const cases = [
      { actor: { id: "renderer:1", kind: "ui" as const }, canvasId: "canvas-one", scopeId: "project-one" },
      { actor: { id: "renderer:1", kind: "ui" as const }, canvasId: "canvas-one", scopeId: "project-two" },
      { actor: { id: "renderer:1", kind: "ui" as const }, canvasId: "canvas-two", scopeId: "project-one" },
      { actor: { id: "renderer:2", kind: "ui" as const }, canvasId: "canvas-one", scopeId: "project-one" },
      { actor: { id: "renderer:1", kind: "opencode" as const }, canvasId: "canvas-one", scopeId: "project-one" },
    ]
    const externalIds: string[] = []

    for (const entry of cases) {
      const document = createCanvasDocument({ id: entry.canvasId, title: "Canvas" })
      const { calls, service } = setup({ document, scopeId: entry.scopeId })
      await service.generate(request({ ref: { canvasId: entry.canvasId, scopeId: entry.scopeId } }), entry.actor)
      const externalId = calls[0]?.operation_id
      expect(externalId).toMatch(/^convax-[a-f0-9]{64}$/)
      expect(externalId).not.toContain("operation-one")
      externalIds.push(String(externalId))
    }

    expect(new Set(externalIds)).toHaveLength(cases.length)
  })

  test("single-flights and replays one operation without executing the paid tool twice", async () => {
    let release!: () => void
    let started!: () => void
    const running = new Promise<void>((resolve) => {
      started = resolve
    })
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const { calls, resourceRequests, service } = setup({
      async result() {
        started()
        await gate
        return { content: [{ text: "Generated once", type: "text" }] }
      },
    })
    const actor = { id: "renderer:1", kind: "ui" as const }
    const first = service.generate(request(), actor)
    await running
    const replay = service.generate(request(), actor)
    release()

    const [firstResult, replayResult] = await Promise.all([first, replay])
    expect(replayResult).toEqual(firstResult)
    expect(calls).toHaveLength(1)
    expect(resourceRequests).toHaveLength(1)

    await expect(service.generate(request(), actor)).resolves.toEqual(firstResult)
    expect(calls).toHaveLength(1)
    expect(resourceRequests).toHaveLength(1)
  })

  test("lets a replay caller stop waiting without canceling the shared generation", async () => {
    let markStarted!: () => void
    let release!: () => void
    const started = new Promise<void>((resolve) => {
      markStarted = resolve
    })
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const { calls, service } = setup({
      async result() {
        markStarted()
        await gate
        return { content: [{ text: "Shared result", type: "text" }] }
      },
    })
    const actor = { id: "renderer:1", kind: "ui" as const }
    const first = service.generate(request(), actor)
    await started
    const replayController = new AbortController()
    const replay = service.generate(request(), actor, replayController.signal)
    replayController.abort("caller stopped waiting")

    await expect(replay).rejects.toMatchObject({ name: "AbortError" })
    release()
    await expect(first).resolves.toMatchObject({ createdNodeIds: ["generated-one"] })
    expect(calls).toHaveLength(1)
  })

  test("rejects a reused operation id with a different generation payload", async () => {
    const { calls, service } = setup({})
    const actor = { id: "renderer:1", kind: "ui" as const }
    await service.generate(request(), actor)

    await expect(service.generate(request({ prompt: "A different paid request" }), actor)).rejects.toThrow(
      "reused with a different payload",
    )
    expect(calls).toHaveLength(1)
  })

  test("retains an attempted external failure and exposes only bounded normalized MCP text", async () => {
    const diagnostic = `First/last-frame generation requires exactly one first frame and one last frame ${"x".repeat(600)}`
    const { calls, service } = setup({ result: { content: [{ text: diagnostic, type: "text" }], isError: true } })
    const actor = { id: "renderer:1", kind: "ui" as const }

    const error = await service.generate(request(), actor).catch((failure) => failure)
    expect(error).toMatchObject({ name: "GenerationToolReportedError" })
    expect(error.message).toStartWith(
      "Generation tool failed: First/last-frame generation requires exactly one first frame and one last frame ",
    )
    expect(error.message).toEndWith("…")
    expect(error.message.length).toBe("Generation tool failed: ".length + 512)
    expect(error.message).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/)
    await expect(service.generate(request(), actor)).rejects.toThrow(error.message)
    expect(calls).toHaveLength(1)
  })

  test.each([
    "cookie=secret-value",
    "Failed at /private/tmp/generated.png",
    "Failed at C:\\Users\\owner\\generated.png",
    "Failed in src/sidecar.ts:1:1",
    "stderr: request failed",
    "coo\u200bkie=secret-value",
    "Validation failed\n    at /private/tmp/sidecar.js:1:1",
  ])("does not expose sensitive MCP failure text: %s", async (diagnostic) => {
    const { service } = setup({ result: { content: [{ text: diagnostic, type: "text" }], isError: true } })

    await expect(service.generate(request(), { id: "renderer:1", kind: "ui" })).rejects.toMatchObject({
      message: "Generation tool reported a failure",
      name: "GenerationToolReportedError",
    })
  })

  test("does not tombstone a failure before the external tool is ready to call", async () => {
    let ready = false
    const { calls, service } = setup({
      async prepareTool() {
        if (!ready) throw new Error("Executable authorization was denied")
      },
    })
    const actor = { id: "renderer:1", kind: "ui" as const }

    await expect(service.generate(request(), actor)).rejects.toThrow("authorization was denied")
    ready = true
    await expect(service.generate(request(), actor)).resolves.toMatchObject({ createdNodeIds: ["generated-one"] })
    expect(calls).toHaveLength(1)
  })

  test("bounds non-text tool warnings before committing and returning the shared result", async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])
    const { published, resourceRequests, service } = setup({
      result: {
        content: [
          ...Array.from({ length: 33 }, (_, index) => ({ text: `warning ${index + 1}`, type: "text" as const })),
          { data: png.toString("base64"), mimeType: "image/png", type: "image" },
        ],
      },
      selectedTool: tool({ id: "creative-tools/draw", output: "image", toolId: "draw" }),
    })

    const result = await service.generate(request({ output: "image", toolId: "creative-tools/draw" }), {
      id: "renderer:1",
      kind: "ui",
    })

    expect(resourceRequests).toHaveLength(1)
    expect(published).toHaveLength(1)
    expect(published[0]).toMatchObject({ extension: ".png", sourcePath: expect.any(String) })
    expect(published[0]?.bytes).toBeUndefined()
    expect(result.warnings).toHaveLength(32)
    expect(result.warnings.at(-1)).toBe("1 additional generation warning was omitted.")
  })

  test("rejects unexpected admitted output counts before publishing or committing resources", async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])
    const { published, resourceRequests, service } = setup({
      result: {
        content: [
          { data: png.toString("base64"), mimeType: "image/png", type: "image" },
          { data: png.toString("base64"), mimeType: "image/png", type: "image" },
        ],
      },
      selectedTool: tool({ id: "creative-tools/draw", output: "image", toolId: "draw" }),
    })

    await expect(
      service.generate(request({ expectedOutputCount: 1, output: "image", toolId: "creative-tools/draw" }), {
        id: "renderer:1",
        kind: "ui",
      }),
    ).rejects.toThrow("returned 2 outputs; expected exactly 1")
    expect(published).toHaveLength(0)
    expect(resourceRequests).toHaveLength(0)
  })

  test("stages a managed image reference and publishes generated media below Generated", async () => {
    const root = await temporaryDirectory()
    const referencePath = path.join(root, "reference.png")
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])
    await fs.writeFile(referencePath, png)
    const document = createCanvasDocument({ id: "canvas-one", title: "Canvas" })
    const owner = createTextNode({ id: "plugin-card", position: { x: 20, y: 20 } })
    const image = createMediaNode({
      id: "image-one",
      position: { x: 0, y: 0 },
      resource: {
        id: "resource-one",
        kind: "image",
        metadata: { [projectResourceReferenceKey]: managedReference() },
        mimeType: "image/png",
        name: "reference.png",
        state: { status: "stale" },
      },
    })
    document.nodes.push(owner, image)
    document.edges.push({ id: "reference-edge", source: image.id, target: owner.id })
    let stagedReferencePath = ""
    const { published, resourceRequests, service } = setup({
      assets: {
        async resolve() {
          return referencePath
        },
      },
      document,
      async result(input) {
        const references = input.references as Array<{ path: string }>
        stagedReferencePath = references[0]!.path
        expect(stagedReferencePath).not.toBe(referencePath)
        expect(await fs.readFile(stagedReferencePath)).toEqual(png)
        const outputDirectory = input.output_directory as string
        await fs.writeFile(path.join(outputDirectory, "result.png"), png)
        return {
          content: [],
          structuredContent: { artifacts: [{ mimeType: "image/png", path: "result.png" }] },
        }
      },
      selectedTool: tool({
        acceptedInputs: ["reference_image"],
        id: "creative-tools/draw",
        output: "image",
        title: "Draw",
        toolId: "draw",
      }),
    })

    const result = await service.generate(
      request({
        referenceConstraint: { ownerNodeId: owner.id, type: "direct-incoming" },
        references: [{ nodeId: "image-one", role: "reference_image" }],
        toolId: "creative-tools/draw",
      }),
      { id: "renderer:1", kind: "ui" },
    )

    expect(result.toolId).toBe("creative-tools/draw")
    await expect(fs.stat(stagedReferencePath)).rejects.toThrow()
    expect(published).toHaveLength(1)
    expect(published[0]).toMatchObject({
      extension: ".png",
      name: "generated",
      projectId: "project-one",
      sourcePath: expect.any(String),
    })
    expect(resourceRequests[0]).toMatchObject({
      conflictPolicy: "retry",
      relation: { anchorNodeIds: [owner.id], direction: "from-anchor", mode: "connect" },
      sources: [{ kind: "host-file", path: "Generated/generated-1.png" }],
    })
  })

  test("enforces one total byte budget across every staged reference", async () => {
    const root = await temporaryDirectory()
    await writeProjectTextReferences(root, { first: "123456", second: "abcdef" })
    const first = createTextNode({ id: "first", position: { x: 0, y: 0 }, text: "123456" })
    const second = createTextNode({ id: "second", position: { x: 0, y: 0 }, text: "abcdef" })
    const document = createCanvasDocument({ id: "canvas-one", nodes: [first, second], title: "Canvas" })
    const { calls, service } = setup({
      document,
      maxInputBytes: 8,
      project: projectPortFor(root),
      selectedTool: tool({ acceptedInputs: ["text"] }),
    })

    await expect(
      service.generate(
        request({
          references: [
            { nodeId: first.id, role: "text" },
            { nodeId: second.id, role: "text" },
          ],
        }),
        { id: "renderer:1", kind: "ui" },
      ),
    ).rejects.toThrow("total input size limit")
    expect(calls).toHaveLength(0)
  })

  test("reads a text reference from its fresh Project file instead of transient Canvas text", async () => {
    const root = await temporaryDirectory()
    await writeProjectTextReferences(root, { brief: "Fresh text from disk" })
    const reference = createTextNode({ id: "brief", position: { x: 0, y: 0 }, text: "stale runtime text" })
    const document = createCanvasDocument({ id: "canvas-one", nodes: [reference], title: "Canvas" })
    const { calls, service } = setup({
      document,
      project: projectPortFor(root),
      selectedTool: tool({ acceptedInputs: ["text"] }),
    })

    await service.generate(request({ references: [{ nodeId: reference.id, role: "text" }] }), {
      id: "renderer:1",
      kind: "ui",
    })

    expect(calls[0]?.references).toEqual([
      { kind: "text", node_id: reference.id, role: "text", text: "Fresh text from disk" },
    ])
  })

  test("stages project-file media through the Project containment port", async () => {
    const root = await temporaryDirectory()
    const mediaDirectory = path.join(root, "Media")
    const referencePath = path.join(mediaDirectory, "reference.png")
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])
    await fs.mkdir(mediaDirectory)
    await fs.writeFile(referencePath, png)
    const image = createMediaNode({
      id: "project-image",
      position: { x: 0, y: 0 },
      resource: {
        id: "resource-one",
        kind: "image",
        metadata: { [projectResourceReferenceKey]: projectFileReference("Media/reference.png") },
        mimeType: "image/png",
        name: "reference.png",
        state: { status: "stale" },
      },
    })
    const document = createCanvasDocument({ id: "canvas-one", nodes: [image], title: "Canvas" })
    let stagedPath = ""
    const { calls, service } = setup({
      document,
      project: {
        async readFileInfo(input) {
          return { mimeType: "image/png", name: "reference.png", path: input.path, size: png.byteLength }
        },
        async resolveEntryPath() {
          return referencePath
        },
      },
      async result(input) {
        stagedPath = (input.references as Array<{ path: string }>)[0]!.path
        expect(await fs.readFile(stagedPath)).toEqual(png)
        return { content: [{ data: png.toString("base64"), mimeType: "image/png", type: "image" }] }
      },
      selectedTool: tool({
        acceptedInputs: ["reference_image"],
        id: "creative-tools/draw",
        output: "image",
        toolId: "draw",
      }),
    })

    await service.generate(
      request({ references: [{ nodeId: image.id, role: "reference_image" }], toolId: "creative-tools/draw" }),
      { id: "renderer:1", kind: "ui" },
    )

    expect(calls).toHaveLength(1)
    await expect(fs.stat(stagedPath)).rejects.toThrow()
  })

  test("rejects a project-directory generation reference before external work", async () => {
    const image = createMediaNode({
      id: "directory-image",
      position: { x: 0, y: 0 },
      resource: {
        id: "resource-one",
        kind: "image",
        metadata: {
          [projectResourceReferenceKey]: { kind: "project-directory", path: "Media" },
        },
        mimeType: "image/png",
        name: "Media",
        state: { status: "stale" },
      },
    })
    const document = createCanvasDocument({ id: "canvas-one", nodes: [image], title: "Canvas" })
    const { calls, service } = setup({
      document,
      selectedTool: tool({ acceptedInputs: ["reference_image"], output: "image" }),
    })

    await expect(
      service.generate(request({ references: [{ nodeId: image.id, role: "reference_image" }] }), {
        id: "renderer:1",
        kind: "ui",
      }),
    ).rejects.toThrow("cannot use a Project directory")
    expect(calls).toHaveLength(0)
  })

  test("allows an unrelated Main revision after staging while preserving the exact reference guard", async () => {
    const root = await temporaryDirectory()
    const referencePath = path.join(root, "reference.png")
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])
    await fs.writeFile(referencePath, png)
    const image = createMediaNode({
      id: "image-one",
      position: { x: 0, y: 0 },
      resource: {
        id: "resource-one",
        kind: "image",
        metadata: { [projectResourceReferenceKey]: managedReference() },
        mimeType: "image/png",
        name: "reference.png",
        state: { status: "stale" },
      },
    })
    const document = createCanvasDocument({ id: "canvas-one", nodes: [image], title: "Canvas" })
    const { calls, renderer, service } = setup({
      assets: {
        async resolve() {
          document.revision += 1
          return referencePath
        },
      },
      document,
      selectedTool: tool({
        acceptedInputs: ["reference_image"],
        id: "creative-tools/draw",
        output: "image",
        toolId: "draw",
      }),
      result: { content: [{ data: png.toString("base64"), mimeType: "image/png", type: "image" }] },
    })
    // Simulate a renderer that has not observed the repository mutation yet;
    // the paid-call guard must consult the persisted Canvas boundary as well.
    renderer.getViewSnapshot = mock(async () => ({
      documentId: "canvas-one",
      revision: 0,
      scopeId: "project-one",
      selectedEdgeIds: [],
      selectedNodeIds: [],
      viewId: "desktop-main",
      viewport: { x: 0, y: 0, zoom: 1 },
    }))

    await expect(
      service.generate(
        request({ references: [{ nodeId: image.id, role: "reference_image" }], toolId: "creative-tools/draw" }),
        { id: "renderer:1", kind: "ui" },
      ),
    ).resolves.toMatchObject({ revision: 2, toolId: "creative-tools/draw" })
    expect(calls).toHaveLength(1)
  })

  test.each([
    ["Toolbar", { id: "renderer:1", kind: "ui" as const }],
    ["Agent", { id: "opencode:project-one", kind: "agent" as const }],
  ])("rechecks a same-revision %s source-node snapshot before starting a paid tool", async (_caller, actor) => {
    const root = await temporaryDirectory()
    await writeProjectTextReferences(root, { brief: "Original brief", replacement: "Replacement brief" })
    const reference = createTextNode({ id: "brief", position: { x: 0, y: 0 }, text: "Original brief" })
    const document = createCanvasDocument({ id: "canvas-one", nodes: [reference], title: "Canvas" })
    const { calls, service } = setup({
      document,
      async prepareTool() {
        reference.data.metadata = {
          [projectResourceReferenceKey]: projectFileReference("References/replacement.md"),
        }
      },
      project: projectPortFor(root),
      selectedTool: tool({ acceptedInputs: ["text"] }),
    })

    await expect(
      service.generate(request({ references: [{ nodeId: reference.id, role: "text" }] }), actor),
    ).rejects.toThrow("references changed")
    expect(calls).toHaveLength(0)
  })

  test("rechecks a managed asset identity before starting a paid tool", async () => {
    const root = await temporaryDirectory()
    const referencePath = path.join(root, "reference.png")
    const originalPath = path.join(root, "original.png")
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])
    await fs.writeFile(referencePath, png)
    const image = createMediaNode({
      id: "image-one",
      position: { x: 0, y: 0 },
      resource: {
        id: "resource-one",
        kind: "image",
        metadata: { [projectResourceReferenceKey]: managedReference() },
        mimeType: "image/png",
        name: "reference.png",
        state: { status: "stale" },
      },
    })
    const document = createCanvasDocument({ id: "canvas-one", nodes: [image], title: "Canvas" })
    let loads = 0
    const { calls, resourceRequests, service } = setup({
      assets: {
        async resolve() {
          return referencePath
        },
      },
      document,
      async loadDocument() {
        loads += 1
        if (loads === 2) {
          await fs.rename(referencePath, originalPath)
          await fs.writeFile(referencePath, png)
        }
        return { document }
      },
      selectedTool: tool({
        acceptedInputs: ["reference_image"],
        id: "creative-tools/draw",
        output: "image",
        toolId: "draw",
      }),
    })

    await expect(
      service.generate(
        request({ references: [{ nodeId: image.id, role: "reference_image" }], toolId: "creative-tools/draw" }),
        { id: "renderer:1", kind: "ui" },
      ),
    ).rejects.toThrow("references changed")
    expect(calls).toHaveLength(0)
    expect(resourceRequests).toHaveLength(0)
  })

  test("retains a published Generated file and reports only its portable path when Canvas commit fails", async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])
    const canvasFailure = new Error("Canvas commit failed")
    const { published, service } = setup({
      resource: {
        async addResources() {
          throw canvasFailure
        },
      },
      result: { content: [{ data: png.toString("base64"), mimeType: "image/png", type: "image" }] },
      selectedTool: tool({ id: "creative-tools/draw", output: "image", toolId: "draw" }),
    })

    await expect(
      service.generate(request({ output: "image", toolId: "creative-tools/draw" }), {
        id: "renderer:1",
        kind: "ui",
      }),
    ).rejects.toMatchObject({
      message:
        "Generation succeeded and files were saved, but they could not be added to Canvas. Saved files: Generated/generated-1.png",
      name: "GenerationPublicationPartialSuccessError",
      publishedPaths: ["Generated/generated-1.png"],
      cause: canvasFailure,
    })
    expect(published).toHaveLength(1)
  })

  test("preserves all sixteen recovery paths when the configured output ceiling is reached", async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])
    const canvasFailure = new Error("Canvas commit failed after sixteen publications")
    const expectedPaths = Array.from({ length: 16 }, (_, index) => `Generated/generated-${index + 1}.png`)
    const { published, service } = setup({
      maxOutputFiles: 16,
      resource: {
        async addResources() {
          throw canvasFailure
        },
      },
      result: {
        content: Array.from({ length: 16 }, () => ({
          data: png.toString("base64"),
          mimeType: "image/png",
          type: "image" as const,
        })),
      },
      selectedTool: tool({ id: "creative-tools/draw", output: "image", toolId: "draw" }),
    })

    await expect(
      service.generate(request({ expectedOutputCount: 16, output: "image", toolId: "creative-tools/draw" }), {
        id: "renderer:1",
        kind: "ui",
      }),
    ).rejects.toMatchObject({
      cause: canvasFailure,
      name: "GenerationPublicationPartialSuccessError",
      publishedPaths: expectedPaths,
    })
    expect(published).toHaveLength(16)
  })

  test("retains earlier outputs and skips Canvas when a later Generated publication fails", async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 3, 4, 5, 6])
    const secondFailure = new Error("second publication failed")
    let publicationCalls = 0
    const { resourceRequests, service } = setup({
      publisher: {
        async publishGenerated() {
          publicationCalls += 1
          if (publicationCalls === 2) throw secondFailure
          return { path: "Generated/generated-first.png" }
        },
      },
      result: {
        content: [
          { data: png.toString("base64"), mimeType: "image/png", type: "image" },
          { data: png.toString("base64"), mimeType: "image/png", type: "image" },
        ],
      },
      selectedTool: tool({ id: "creative-tools/draw", output: "image", toolId: "draw" }),
    })

    await expect(
      service.generate(request({ expectedOutputCount: 2, output: "image", toolId: "creative-tools/draw" }), {
        id: "renderer:1",
        kind: "ui",
      }),
    ).rejects.toMatchObject({
      cause: secondFailure,
      name: "GenerationPublicationPartialSuccessError",
      publishedPaths: ["Generated/generated-first.png"],
    })
    expect(publicationCalls).toBe(2)
    expect(resourceRequests).toHaveLength(0)
  })

  test("does not use a stale Renderer projection as a paid-call correctness guard", async () => {
    const { calls, renderer, service } = setup({})
    renderer.getViewSnapshot = mock(async () => ({
      documentId: "canvas-one",
      revision: 2,
      scopeId: "project-one",
      selectedEdgeIds: [],
      selectedNodeIds: [],
      viewId: "desktop-main",
      viewport: { x: 0, y: 0, zoom: 1 },
    }))

    await expect(service.generate(request(), { id: "renderer:1", kind: "ui" })).resolves.toMatchObject({ revision: 1 })
    expect(calls).toHaveLength(1)
  })

  test("fails closed when a Toolbar or Agent reference changes during generation", async () => {
    const root = await temporaryDirectory()
    await writeProjectTextReferences(root, { brief: "Original brief" })
    let markStarted!: () => void
    let release!: () => void
    const started = new Promise<void>((resolve) => {
      markStarted = resolve
    })
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const reference = createTextNode({ id: "brief", position: { x: 0, y: 0 }, text: "Original brief" })
    const document = createCanvasDocument({ id: "canvas-one", nodes: [reference], title: "Canvas" })
    const { renderer, resourceRequests, service } = setup({
      document,
      async result() {
        markStarted()
        await gate
        return { content: [{ text: "Generated from the original brief", type: "text" }] }
      },
      project: projectPortFor(root),
      selectedTool: tool({ acceptedInputs: ["text"] }),
    })

    const pending = service.generate(request({ references: [{ nodeId: reference.id, role: "text" }] }), {
      id: "renderer:1",
      kind: "ui",
    })
    await started
    document.revision += 1
    renderer.getViewSnapshot = mock(async () => ({
      documentId: "canvas-one",
      revision: document.revision,
      scopeId: "project-one",
      selectedEdgeIds: [],
      selectedNodeIds: [],
      viewId: "desktop-main",
      viewport: { x: 0, y: 0, zoom: 1 },
    }))
    release()

    await expect(pending).rejects.toThrow("Generation references changed while the tool was running")
    expect(resourceRequests).toHaveLength(0)
  })

  test("retains publication when a managed asset changes before committing generated nodes", async () => {
    const root = await temporaryDirectory()
    const referencePath = path.join(root, "reference.png")
    const originalPath = path.join(root, "original.png")
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])
    await fs.writeFile(referencePath, png)
    const image = createMediaNode({
      id: "image-one",
      position: { x: 0, y: 0 },
      resource: {
        id: "resource-one",
        kind: "image",
        metadata: { [projectResourceReferenceKey]: managedReference() },
        mimeType: "image/png",
        name: "reference.png",
        state: { status: "stale" },
      },
    })
    const document = createCanvasDocument({ id: "canvas-one", nodes: [image], title: "Canvas" })
    const { calls, resourceRequests, service } = setup({
      assets: {
        async resolve() {
          return referencePath
        },
      },
      document,
      publisher: {
        async publishGenerated(input) {
          await fs.rename(referencePath, originalPath)
          await fs.writeFile(referencePath, png)
          return { path: `Generated/generated-1${input.extension}` }
        },
      },
      result: { content: [{ data: png.toString("base64"), mimeType: "image/png", type: "image" }] },
      selectedTool: tool({
        acceptedInputs: ["reference_image"],
        id: "creative-tools/draw",
        output: "image",
        toolId: "draw",
      }),
    })

    await expect(
      service.generate(
        request({ references: [{ nodeId: image.id, role: "reference_image" }], toolId: "creative-tools/draw" }),
        { id: "opencode:project-one", kind: "agent" },
      ),
    ).rejects.toMatchObject({
      name: "GenerationPublicationPartialSuccessError",
      publishedPaths: ["Generated/generated-1.png"],
    })
    expect(calls).toHaveLength(1)
    expect(resourceRequests).toHaveLength(0)
  })

  test("does not replay a referenced generation commit after a revision conflict", async () => {
    const root = await temporaryDirectory()
    await writeProjectTextReferences(root, { brief: "Stable brief" })
    const reference = createTextNode({ id: "brief", position: { x: 0, y: 0 }, text: "Stable brief" })
    const document = createCanvasDocument({ id: "canvas-one", nodes: [reference], title: "Canvas" })
    let commitAttempts = 0
    const { calls, service } = setup({
      document,
      project: projectPortFor(root),
      resource: {
        async addResources() {
          commitAttempts += 1
          throw new CanvasRevisionConflictError(0, 1)
        },
      },
      selectedTool: tool({ acceptedInputs: ["text"] }),
    })
    const generationRequest = request({ references: [{ nodeId: reference.id, role: "text" }] })
    const actor = { id: "renderer:1", kind: "ui" as const }

    await expect(service.generate(generationRequest, actor)).rejects.toMatchObject({
      name: "GenerationPublicationPartialSuccessError",
    })
    document.revision = 1
    await expect(service.generate(generationRequest, actor)).rejects.toMatchObject({
      name: "GenerationPublicationPartialSuccessError",
    })
    expect(calls).toHaveLength(1)
    expect(commitAttempts).toBe(1)
  })

  test("reports partial success when cancellation arrives after Generated publication", async () => {
    const controller = new AbortController()
    const root = await temporaryDirectory()
    await writeProjectTextReferences(root, { brief: "Stable brief" })
    const reference = createTextNode({ id: "brief", position: { x: 0, y: 0 }, text: "Stable brief" })
    const document = createCanvasDocument({ id: "canvas-one", nodes: [reference], title: "Canvas" })
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])
    const { resourceRequests, service } = setup({
      document,
      project: projectPortFor(root),
      publisher: {
        async publishGenerated(input) {
          controller.abort("generation was canceled")
          return { path: `Generated/generated-1${input.extension}` }
        },
      },
      result: { content: [{ data: png.toString("base64"), mimeType: "image/png", type: "image" }] },
      selectedTool: tool({ acceptedInputs: ["text"], id: "creative-tools/draw", output: "image", toolId: "draw" }),
    })

    await expect(
      service.generate(
        request({ references: [{ nodeId: reference.id, role: "text" }], toolId: "creative-tools/draw" }),
        { id: "renderer:1", kind: "ui" },
        controller.signal,
      ),
    ).rejects.toMatchObject({
      name: "GenerationPublicationPartialSuccessError",
      publishedPaths: ["Generated/generated-1.png"],
    })
    expect(resourceRequests).toHaveLength(0)
  })

  test("commits referenced generation with Main-side guarded retry semantics", async () => {
    const root = await temporaryDirectory()
    await writeProjectTextReferences(root, { brief: "Stable brief" })
    const reference = createTextNode({ id: "brief", position: { x: 0, y: 0 }, text: "Stable brief" })
    const document = createCanvasDocument({ id: "canvas-one", nodes: [reference], title: "Canvas" })
    const { resourceRequests, service } = setup({
      document,
      project: projectPortFor(root),
      selectedTool: tool({ acceptedInputs: ["text"] }),
    })

    await service.generate(request({ references: [{ nodeId: reference.id, role: "text" }] }), {
      id: "opencode:project-one",
      kind: "agent",
    })

    expect(resourceRequests[0]).toMatchObject({
      conflictPolicy: "retry",
      relation: { anchorNodeIds: [reference.id], direction: "from-anchor", mode: "connect" },
    })
  })

  test("connects host-only relation anchors without exposing them to the generation tool", async () => {
    const root = await temporaryDirectory()
    await writeProjectTextReferences(root, { brief: "Stable brief", "silent-video": "Pair anchor" })
    const reference = createTextNode({ id: "brief", position: { x: 0, y: 0 }, text: "Stable brief" })
    const relationAnchor = createTextNode({ id: "silent-video", position: { x: 360, y: 0 }, text: "Pair anchor" })
    const document = createCanvasDocument({
      id: "canvas-one",
      nodes: [reference, relationAnchor],
      title: "Canvas",
    })
    const { calls, resourceRequests, service } = setup({
      document,
      project: projectPortFor(root),
      selectedTool: tool({ acceptedInputs: ["text"] }),
    })

    await service.generate(
      request({
        references: [{ nodeId: reference.id, role: "text" }],
        relationAnchorNodeIds: [reference.id, relationAnchor.id],
      }),
      { id: "renderer:1", kind: "ui" },
    )

    expect(calls[0]?.references).toEqual([{ kind: "text", node_id: reference.id, role: "text", text: "Stable brief" }])
    expect(resourceRequests[0]).toMatchObject({
      conflictPolicy: "retry",
      relation: {
        anchorNodeIds: [reference.id, relationAnchor.id],
        direction: "from-anchor",
        mode: "connect",
      },
    })
  })

  test("rejects a missing host-only relation anchor before starting the external tool", async () => {
    const { calls, resourceRequests, service } = setup({})

    await expect(
      service.generate(request({ relationAnchorNodeIds: ["missing-node"] }), {
        id: "renderer:1",
        kind: "ui",
      }),
    ).rejects.toThrow("relation anchor node was not found")
    expect(calls).toHaveLength(0)
    expect(resourceRequests).toHaveLength(0)
  })

  test.each(["edge", "source", "revision"] as const)(
    "guards a Plugin card's direct-incoming scope when the %s changes",
    async (change) => {
      const root = await temporaryDirectory()
      const referencePath = path.join(root, "reference.png")
      const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])
      await fs.writeFile(referencePath, png)
      const owner = createTextNode({ id: "plugin-card", position: { x: 20, y: 20 } })
      const image = createMediaNode({
        id: "image-one",
        position: { x: 0, y: 0 },
        resource: {
          id: "resource-one",
          kind: "image",
          metadata: { [projectResourceReferenceKey]: managedReference() },
          mimeType: "image/png",
          name: "reference.png",
          state: { status: "stale" },
        },
      })
      const document = createCanvasDocument({
        edges: [{ id: "reference-edge", source: image.id, target: owner.id }],
        id: "canvas-one",
        nodes: [owner, image],
        title: "Canvas",
      })
      const { published, resourceRequests, service } = setup({
        assets: {
          async resolve() {
            return referencePath
          },
        },
        document,
        async result() {
          if (change === "edge") document.edges = []
          else if (change === "source") {
            image.data.metadata = {
              [projectResourceReferenceKey]: managedReference("replaced.png", "b".repeat(64)),
            }
          } else document.revision += 1
          return { content: [{ data: png.toString("base64"), mimeType: "image/png", type: "image" }] }
        },
        selectedTool: tool({
          acceptedInputs: ["reference_image"],
          id: "creative-tools/draw",
          output: "image",
          title: "Draw",
          toolId: "draw",
        }),
      })

      const generation = service.generate(
        request({
          referenceConstraint: { ownerNodeId: owner.id, type: "direct-incoming" },
          references: [{ nodeId: image.id, role: "reference_image" }],
          toolId: "creative-tools/draw",
        }),
        { id: "renderer:1", kind: "ui" },
      )
      if (change === "revision") {
        await expect(generation).resolves.toMatchObject({ revision: 2 })
        expect(published).toHaveLength(1)
        expect(resourceRequests).toHaveLength(1)
      } else {
        await expect(generation).rejects.toThrow("direct incoming references changed")
        expect(published).toHaveLength(0)
        expect(resourceRequests).toHaveLength(0)
      }
    },
  )

  test("allows only one semantic first frame and last frame", async () => {
    const { service } = setup({})

    await expect(
      service.generate(
        request({
          references: [
            { nodeId: "image-one", role: "first_frame" },
            { nodeId: "image-two", role: "first_frame" },
          ],
        }),
        { id: "renderer:1", kind: "ui" },
      ),
    ).rejects.toThrow("at most one first_frame")
  })

  test("rejects a replaced output directory before publishing artifacts", async () => {
    const outside = await temporaryDirectory()
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])
    await fs.writeFile(path.join(outside, "result.png"), png)
    const { published, service } = setup({
      async result(input) {
        const outputDirectory = input.output_directory as string
        await fs.rm(outputDirectory, { recursive: true })
        await fs.symlink(outside, outputDirectory, process.platform === "win32" ? "junction" : "dir")
        return {
          content: [],
          structuredContent: { artifacts: [{ mimeType: "image/png", path: "result.png" }] },
        }
      },
      selectedTool: tool({
        acceptedInputs: [],
        id: "creative-tools/draw",
        output: "image",
        title: "Draw",
        toolId: "draw",
      }),
    })

    await expect(
      service.generate(request({ toolId: "creative-tools/draw" }), { id: "renderer:1", kind: "ui" }),
    ).rejects.toThrow("output_directory was replaced")
    expect(published).toHaveLength(0)
  })

  test("bounds structured artifact declarations before reading paths", async () => {
    const { published, service } = setup({
      result: {
        content: [],
        structuredContent: {
          artifacts: Array.from({ length: 17 }, (_, index) => ({ path: `${index}.png` })),
        },
      },
      selectedTool: tool({
        acceptedInputs: [],
        id: "creative-tools/draw",
        output: "image",
        title: "Draw",
        toolId: "draw",
      }),
    })

    await expect(
      service.generate(request({ toolId: "creative-tools/draw" }), { id: "renderer:1", kind: "ui" }),
    ).rejects.toThrow("too many output files")
    expect(published).toHaveLength(0)
  })

  test("propagates cancellation to the Tool Plugin and commits nothing", async () => {
    let receivedSignal: AbortSignal | undefined
    let markStarted!: () => void
    const started = new Promise<void>((resolve) => {
      markStarted = resolve
    })
    const { resourceRequests, service } = setup({
      result: async (_input, signal) => {
        receivedSignal = signal
        markStarted()
        return await new Promise<McpToolCallResult>((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(signal.reason), { once: true })
        })
      },
    })
    const controller = new AbortController()
    const result = service.generate(request(), { id: "renderer:1", kind: "ui" }, controller.signal)
    await started
    controller.abort(new Error("canceled"))

    await expect(result).rejects.toThrow("canceled")
    expect(receivedSignal).toBe(controller.signal)
    expect(resourceRequests).toHaveLength(0)
  })
})

describe("stable generation file copies", () => {
  test("rejects growth beyond the initial bounded snapshot and removes the partial target", async () => {
    const root = await temporaryDirectory()
    const source = path.join(root, "growing.bin")
    const target = path.join(root, "copy.bin")
    await fs.writeFile(source, Buffer.from([1, 2, 3, 4]))

    await expect(
      copyStableFile({
        description: "Growing generation file",
        expectedRealPath: await fs.realpath(source),
        maximumBytes: 4,
        async prepareTarget() {
          await fs.appendFile(source, Buffer.from([5]))
          return target
        },
        sourcePath: source,
      }),
    ).rejects.toThrow("changed while it was being copied")
    await expect(fs.stat(target)).rejects.toThrow()
  })

  test("rejects same-size in-place mutation instead of keeping mixed contents", async () => {
    const root = await temporaryDirectory()
    const source = path.join(root, "mutating.bin")
    const target = path.join(root, "copy.bin")
    await fs.writeFile(source, Buffer.from("before"))

    await expect(
      copyStableFile({
        description: "Mutating generation file",
        expectedRealPath: await fs.realpath(source),
        maximumBytes: 64,
        async prepareTarget() {
          await fs.writeFile(source, Buffer.from("change"))
          return target
        },
        sourcePath: source,
      }),
    ).rejects.toThrow("changed while it was being copied")
    await expect(fs.stat(target)).rejects.toThrow()
  })

  test("rejects pathname replacement after opening the pinned source", async () => {
    const root = await temporaryDirectory()
    const source = path.join(root, "replaceable.bin")
    const original = path.join(root, "original.bin")
    const target = path.join(root, "copy.bin")
    await fs.writeFile(source, Buffer.from("original"))

    await expect(
      copyStableFile({
        description: "Replaced generation file",
        expectedRealPath: await fs.realpath(source),
        maximumBytes: 64,
        async prepareTarget() {
          await fs.rename(source, original)
          await fs.writeFile(source, Buffer.from("replaced"))
          return target
        },
        sourcePath: source,
      }),
    ).rejects.toThrow("changed while it was being copied")
    await expect(fs.stat(target)).rejects.toThrow()
  })
})
