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
  createTextNode,
  type CanvasDocument,
} from "@convax/canvas/core"
import { projectFileReferenceKey } from "@convax/project/canvas"
import type { GenerationCanvasRequest, GenerationToolDescription, GenerationToolSummary } from "../generation-contracts"
import {
  GenerationCanvasService,
  type GenerationCanvasProjectPort,
  type GenerationCanvasResourcePort,
  type PreparedGenerationToolExecution,
  type GenerationToolExecutionPort,
} from "./generation-canvas-service"
import { copyStableFile } from "./stable-file-copy"
import type { CanvasRendererBridge } from "./canvas-renderer-bridge"
import type { McpToolCallResult } from "./stdio-mcp-client"
import { validateGenerationToolInput } from "./generation-tool-input-schema"

const temporaryDirectories: string[] = []

async function temporaryDirectory() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "convax-generation-service-test-"))
  temporaryDirectories.push(directory)
  return directory
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

function setup(options: {
  document?: CanvasDocument
  loadDocument?: () => Promise<{ document: CanvasDocument | null }> | { document: CanvasDocument | null }
  maxInputBytes?: number
  prepareTool?: (tool: GenerationToolSummary, signal?: AbortSignal) => Promise<void>
  project?: Partial<GenerationCanvasProjectPort>
  resource?: Partial<GenerationCanvasResourcePort>
  result?: McpToolCallResult | ((input: Record<string, unknown>, signal?: AbortSignal) => Promise<McpToolCallResult>)
  scopeId?: string
  selectedTool?: GenerationToolSummary
  toolDescription?: GenerationToolDescription
}) {
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
  const imported: string[][] = []
  const deleted: string[][] = []
  const project: GenerationCanvasProjectPort = {
    async deleteManagedAssets(input) {
      deleted.push(input.paths)
    },
    async importEntries(input) {
      imported.push(input.sourcePaths)
      return {
        targetPaths: input.sourcePaths.map((source, index) => `.convax/assets/${index + 1}-${path.basename(source)}`),
      }
    },
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
    async runDocumentMutation(_ref, mutate) {
      return mutate()
    },
    async runDocumentRead(_ref, read) {
      return read()
    },
  }
  return {
    calls,
    deleted,
    imported,
    renderer,
    replacementRequests,
    resourceRequests,
    service: new GenerationCanvasService({
      documents: {
        async load() {
          return options.loadDocument ? options.loadDocument() : { document }
        },
      },
      ...(options.maxInputBytes === undefined ? {} : { maxInputBytes: options.maxInputBytes }),
      projects: project,
      renderer,
      resources,
      temporaryRoot: os.tmpdir(),
      tools,
    }),
    viewRequests,
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

  test("commits text output without changing the caller's selection or viewport", async () => {
    const { calls, imported, resourceRequests, service, viewRequests } = setup({})

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
    expect(imported).toEqual([])
    expect(resourceRequests).toHaveLength(1)
    expect(resourceRequests[0]).toMatchObject({
      actor: { id: "renderer:1", kind: "ui" },
      canvasId: "canvas-one",
      commandId: "generation:operation-one",
      expectedRevision: 0,
      scopeId: "project-one",
      sources: [{ kind: "inline-text", name: "Generated", text: "A generated paragraph" }],
    })
    expect(resourceRequests[0].conflictPolicy).toBeUndefined()
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
    const reference = createTextNode({ id: "brief", position: { x: 0, y: 0 }, text: "Stable brief" })
    const relationAnchor = createTextNode({ id: "silent-video", position: { x: 360, y: 0 }, text: "Pair anchor" })
    const document = createCanvasDocument({ id: "canvas-one", nodes: [reference, relationAnchor], title: "Canvas" })
    const { calls, resourceRequests, service } = setup({
      document,
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
      conflictPolicy: "reject",
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
      source: { kind: "inline-text", name: "Generated", text: "A generated paragraph" },
      targetNodeId: owner.id,
    })
    expect(replacementRequests[0]?.conflictPolicy).toBeUndefined()
    expect(viewRequests).toEqual([])
  })

  test("admits only the first media output when one card is the generation result owner", async () => {
    const owner = createTextNode({ id: "owner-card", position: { x: 20, y: 40 }, text: "Generate me" })
    const document = createCanvasDocument({ id: "canvas-one", nodes: [owner], title: "Canvas" })
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])
    const { imported, replacementRequests, resourceRequests, service } = setup({
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

    expect(imported).toHaveLength(1)
    expect(imported[0]).toHaveLength(1)
    expect(path.basename(imported[0]![0]!)).toContain("first")
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
    expect(changed.imported).toEqual([])
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
    const { resourceRequests, service } = setup({
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
    expect(result.warnings).toHaveLength(32)
    expect(result.warnings.at(-1)).toBe("1 additional generation warning was omitted.")
  })

  test("stages managed image references and admits generated files as managed assets", async () => {
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
        metadata: { [projectFileReferenceKey]: { path: ".convax/assets/reference.png" } },
        mimeType: "image/png",
        name: "reference.png",
        url: "",
      },
    })
    document.nodes.push(owner, image)
    document.edges.push({ id: "reference-edge", source: image.id, target: owner.id })
    let stagedReferencePath = ""
    const { imported, resourceRequests, service } = setup({
      document,
      project: {
        async readFileInfo() {
          return {
            mimeType: "image/png",
            name: "reference.png",
            path: ".convax/assets/reference.png",
            size: png.length,
          }
        },
        async resolveEntryPath() {
          return referencePath
        },
      },
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
    expect(imported).toHaveLength(1)
    expect(resourceRequests[0]).toMatchObject({
      conflictPolicy: "reject",
      relation: { anchorNodeIds: ["image-one"], direction: "from-anchor", mode: "connect" },
      sources: [{ kind: "host-file" }],
    })
    expect(resourceRequests[0]!.sources[0]).toHaveProperty("path", expect.stringContaining(".convax/assets/"))
  })

  test("enforces one total byte budget across every staged reference", async () => {
    const first = createTextNode({ id: "first", position: { x: 0, y: 0 }, text: "123456" })
    const second = createTextNode({ id: "second", position: { x: 0, y: 0 }, text: "abcdef" })
    const document = createCanvasDocument({ id: "canvas-one", nodes: [first, second], title: "Canvas" })
    const { calls, service } = setup({
      document,
      maxInputBytes: 8,
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

  test("rechecks reference revision after staging and before starting a paid tool", async () => {
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
        metadata: { [projectFileReferenceKey]: { path: ".convax/assets/reference.png" } },
        mimeType: "image/png",
        name: "reference.png",
        url: "",
      },
    })
    const document = createCanvasDocument({ id: "canvas-one", nodes: [image], title: "Canvas" })
    const { calls, renderer, service } = setup({
      document,
      project: {
        async readFileInfo() {
          return {
            mimeType: "image/png",
            name: "reference.png",
            path: ".convax/assets/reference.png",
            size: png.length,
          }
        },
        async resolveEntryPath() {
          document.revision += 1
          return referencePath
        },
      },
      selectedTool: tool({
        acceptedInputs: ["reference_image"],
        id: "creative-tools/draw",
        output: "image",
        toolId: "draw",
      }),
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
    ).rejects.toThrow("revision must match")
    expect(calls).toHaveLength(0)
  })

  test.each([
    ["Toolbar", { id: "renderer:1", kind: "ui" as const }],
    ["Agent", { id: "opencode:project-one", kind: "agent" as const }],
  ])("rechecks a same-revision %s source-node snapshot before starting a paid tool", async (_caller, actor) => {
    const reference = createTextNode({ id: "brief", position: { x: 0, y: 0 }, text: "Original brief" })
    const document = createCanvasDocument({ id: "canvas-one", nodes: [reference], title: "Canvas" })
    const { calls, service } = setup({
      document,
      async prepareTool() {
        reference.data.text = "Replacement brief"
      },
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
        metadata: { [projectFileReferenceKey]: { path: ".convax/assets/reference.png" } },
        mimeType: "image/png",
        name: "reference.png",
        url: "",
      },
    })
    const document = createCanvasDocument({ id: "canvas-one", nodes: [image], title: "Canvas" })
    let loads = 0
    const { calls, resourceRequests, service } = setup({
      document,
      async loadDocument() {
        loads += 1
        if (loads === 2) {
          await fs.rename(referencePath, originalPath)
          await fs.writeFile(referencePath, png)
        }
        return { document }
      },
      project: {
        async readFileInfo() {
          return {
            mimeType: "image/png",
            name: "reference.png",
            path: ".convax/assets/reference.png",
            size: png.length,
          }
        },
        async resolveEntryPath() {
          return referencePath
        },
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

  test("removes newly imported managed assets when the Canvas commit fails", async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])
    const { deleted, service } = setup({
      resource: {
        async addResources() {
          throw new Error("Canvas commit failed")
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
    ).rejects.toThrow("Canvas commit failed")
    expect(deleted).toHaveLength(1)
    expect(deleted[0]).toHaveLength(1)
    expect(deleted[0]![0]).toStartWith(".convax/assets/")
  })

  test("rejects a stale live revision before starting the external tool", async () => {
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

    await expect(service.generate(request(), { id: "renderer:1", kind: "ui" })).rejects.toThrow("revision must match")
    expect(calls).toHaveLength(0)
  })

  test("fails closed when a Toolbar or Agent reference changes during generation", async () => {
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
      selectedTool: tool({ acceptedInputs: ["text"] }),
    })

    const pending = service.generate(request({ references: [{ nodeId: reference.id, role: "text" }] }), {
      id: "renderer:1",
      kind: "ui",
    })
    await started
    reference.data.text = "Replacement brief"
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

    await expect(pending).rejects.toThrow("revision must match")
    expect(resourceRequests).toHaveLength(0)
  })

  test("rechecks a managed asset after output import and before committing generated nodes", async () => {
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
        metadata: { [projectFileReferenceKey]: { path: ".convax/assets/reference.png" } },
        mimeType: "image/png",
        name: "reference.png",
        url: "",
      },
    })
    const document = createCanvasDocument({ id: "canvas-one", nodes: [image], title: "Canvas" })
    const { calls, deleted, resourceRequests, service } = setup({
      document,
      project: {
        async importEntries(input) {
          await fs.rename(referencePath, originalPath)
          await fs.writeFile(referencePath, png)
          return { targetPaths: input.sourcePaths.map((source) => `.convax/assets/${path.basename(source)}`) }
        },
        async readFileInfo() {
          return {
            mimeType: "image/png",
            name: "reference.png",
            path: ".convax/assets/reference.png",
            size: png.length,
          }
        },
        async resolveEntryPath() {
          return referencePath
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
    ).rejects.toThrow("references changed")
    expect(calls).toHaveLength(1)
    expect(resourceRequests).toHaveLength(0)
    expect(deleted).toHaveLength(1)
  })

  test("does not replay a referenced generation commit after a revision conflict", async () => {
    const reference = createTextNode({ id: "brief", position: { x: 0, y: 0 }, text: "Stable brief" })
    const document = createCanvasDocument({ id: "canvas-one", nodes: [reference], title: "Canvas" })
    let commitAttempts = 0
    const { calls, service } = setup({
      document,
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

    await expect(service.generate(generationRequest, actor)).rejects.toBeInstanceOf(CanvasRevisionConflictError)
    document.revision = 1
    await expect(service.generate(generationRequest, actor)).rejects.toBeInstanceOf(CanvasRevisionConflictError)
    expect(calls).toHaveLength(1)
    expect(commitAttempts).toBe(1)
  })

  test("cancels referenced generation after output import without committing stale output", async () => {
    const controller = new AbortController()
    const reference = createTextNode({ id: "brief", position: { x: 0, y: 0 }, text: "Stable brief" })
    const document = createCanvasDocument({ id: "canvas-one", nodes: [reference], title: "Canvas" })
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])
    const { deleted, resourceRequests, service } = setup({
      document,
      project: {
        async importEntries(input) {
          controller.abort("generation was canceled")
          return { targetPaths: input.sourcePaths.map((source) => `.convax/assets/${path.basename(source)}`) }
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
    ).rejects.toMatchObject({ name: "AbortError" })
    expect(resourceRequests).toHaveLength(0)
    expect(deleted).toHaveLength(1)
  })

  test("commits referenced generation with reject-on-conflict semantics", async () => {
    const reference = createTextNode({ id: "brief", position: { x: 0, y: 0 }, text: "Stable brief" })
    const document = createCanvasDocument({ id: "canvas-one", nodes: [reference], title: "Canvas" })
    const { resourceRequests, service } = setup({
      document,
      selectedTool: tool({ acceptedInputs: ["text"] }),
    })

    await service.generate(request({ references: [{ nodeId: reference.id, role: "text" }] }), {
      id: "opencode:project-one",
      kind: "agent",
    })

    expect(resourceRequests[0]).toMatchObject({
      conflictPolicy: "reject",
      relation: { anchorNodeIds: [reference.id], direction: "from-anchor", mode: "connect" },
    })
  })

  test.each(["edge", "source", "revision"] as const)(
    "fails closed when a Plugin card's direct-incoming scope changes by %s",
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
          metadata: { [projectFileReferenceKey]: { path: ".convax/assets/reference.png" } },
          mimeType: "image/png",
          name: "reference.png",
          url: "",
        },
      })
      const document = createCanvasDocument({
        edges: [{ id: "reference-edge", source: image.id, target: owner.id }],
        id: "canvas-one",
        nodes: [owner, image],
        title: "Canvas",
      })
      const { imported, resourceRequests, service } = setup({
        document,
        project: {
          async readFileInfo() {
            return {
              mimeType: "image/png",
              name: "reference.png",
              path: ".convax/assets/reference.png",
              size: png.length,
            }
          },
          async resolveEntryPath() {
            return referencePath
          },
        },
        async result() {
          if (change === "edge") document.edges = []
          else if (change === "source") {
            image.data.metadata = {
              [projectFileReferenceKey]: { path: ".convax/assets/replaced.png" },
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

      await expect(
        service.generate(
          request({
            referenceConstraint: { ownerNodeId: owner.id, type: "direct-incoming" },
            references: [{ nodeId: image.id, role: "reference_image" }],
            toolId: "creative-tools/draw",
          }),
          { id: "renderer:1", kind: "ui" },
        ),
      ).rejects.toThrow("direct incoming references changed")
      expect(imported).toHaveLength(0)
      expect(resourceRequests).toHaveLength(0)
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

  test("rejects a replaced output directory before importing artifacts", async () => {
    const outside = await temporaryDirectory()
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])
    await fs.writeFile(path.join(outside, "result.png"), png)
    const { imported, service } = setup({
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
    expect(imported).toHaveLength(0)
  })

  test("bounds structured artifact declarations before reading paths", async () => {
    const { imported, service } = setup({
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
    expect(imported).toHaveLength(0)
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
