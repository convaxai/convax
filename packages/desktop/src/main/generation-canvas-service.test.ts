import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

import { createCanvasGenerationTargetGuard, type CanvasApplicationCommandResult } from "@convax/canvas/application"
import {
  createAgentNode,
  createCanvasDocument,
  createMediaNode,
  createTextNode as createCanvasTextNode,
  finishCanvasNodeGenerationRun,
  getCanvasNodeGenerationRun,
  interruptInactiveCanvasNodeGenerationRuns,
  markCanvasNodeGenerationRunRunning,
  startCanvasNodeGenerationRun,
  succeedCanvasNodeGenerationRun,
  type CanvasDocument,
} from "@convax/canvas/core"
import { canvasProjectionResourceMetadataKey, type CanvasResourceRef } from "@convax/canvas/collaboration"
import { encodeBase64url, ordinarySha256, parseId128, parseProjectId } from "@convax/collaboration"
import { parseProjectIndexResourceReference, projectIndexResourceReferenceDigest } from "@convax/project"
import {
  dehydrateProjectCanvasDocument,
  projectResourceReferenceKey,
  type ProjectResourceReference,
} from "@convax/project/canvas"
import type { GenerationCanvasRequest, GenerationToolDescription, GenerationToolSummary } from "../generation-contracts"
import {
  GenerationCanvasService,
  type GenerationCanvasFilePublisherPort,
  type GenerationCanvasManagedAssetPort,
  type GenerationCanvasProjectPort,
  type GenerationCanvasResourcePort,
  type GenerationCanvasServiceOptions,
  type GenerationCanvasRunPort,
  type PreparedGenerationToolExecution,
  type GenerationToolExecutionPort,
} from "./generation-canvas-service"
import { copyStableFile } from "./stable-file-copy"
import type { CanvasRendererBridge } from "./canvas-renderer-bridge"
import type { McpToolCallResult } from "./stdio-mcp-client"
import { validateGenerationToolInput } from "./generation-tool-input-schema"
import type { PreparedGenerationRecovery } from "./generation-plugin-runtime"
import { GenerationInputSnapshotStore } from "./generation-input-snapshot-store"
import { GenerationOperationStore, generationOperationRequestDigest } from "./generation-operation-store"
import { generationRecoveryResultDigest } from "./generation-recovery-result-digest"
import type { GenerationToolOperationMetadata } from "./stdio-mcp-client"
import { canvasOperationReceipt } from "./canvas-application-test-fixtures"

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

function canonicalVideoResource(bytes: Uint8Array) {
  const projectId = parseProjectId("project-one")
  const projectEpoch = parseId128(encodeBase64url(new Uint8Array(16).fill(1)))
  const digest = ordinarySha256(bytes)
  const fileId = `pf_${"a".repeat(64)}`
  const reference = parseProjectIndexResourceReference({
    format: "convax.project-resource-reference",
    projectId,
    projectEpoch,
    entryFileId: fileId,
    familyPrimaryFileId: fileId,
    versionId: `pv_${"b".repeat(64)}`,
    canonicalUri: `convax-project://${projectId}/epochs/${projectEpoch}/entries/${fileId}?blob=sha256%3A${digest}`,
    blob: {
      format: "convax.blob-ref",
      algorithm: "sha256",
      digest,
      byteLength: String(bytes.byteLength) as never,
      mime: "video/mp4",
    },
    versionRecordDigest: ordinarySha256(new TextEncoder().encode(`version:${digest}`)),
  })
  const resource: CanvasResourceRef = {
    format: "convax.canvas-resource-ref",
    uri: reference.canonicalUri,
    mediaClass: "video",
    mime: reference.blob.mime,
    byteLength: reference.blob.byteLength,
    contentDigest: reference.blob.digest,
    ownerProofDigest: projectIndexResourceReferenceDigest(reference),
  }
  return { projectId, reference, resource }
}

function stableJsonForTest(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJsonForTest).join(",")}]`
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJsonForTest(item)}`)
      .join(",")}}`
  }
  return JSON.stringify(value) ?? "null"
}

function createTextNode(input: {
  id: string
  label?: string
  path?: string
  position: { x: number; y: number }
  text?: string
}) {
  const text = input.text ?? ""
  const resourcePath = input.path ?? `References/${input.id}.md`
  return createCanvasTextNode({
    id: input.id,
    label: input.label,
    metadata: {
      [projectResourceReferenceKey]: projectFileReference(resourcePath),
    },
    mimeType: resourcePath.endsWith(".txt") ? "text/plain" : "text/markdown",
    name: path.posix.basename(resourcePath),
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
        mimeType: input.path.endsWith(".png")
          ? "image/png"
          : input.path.endsWith(".txt")
            ? "text/plain"
            : "text/markdown",
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

function replaceNodeMode(node: CanvasDocument["nodes"][number]) {
  return {
    expectedTarget: createCanvasGenerationTargetGuard(node),
    nodeId: node.id,
    type: "replace-node" as const,
  }
}

function replaceNodeModeFor(document: CanvasDocument, nodeId: string) {
  const node = document.nodes.find((candidate) => candidate.id === nodeId)
  return node
    ? replaceNodeMode(node)
    : {
        expectedTarget: { data: { kind: "image", label: "Missing replacement target" }, type: "file" as const },
        nodeId,
        type: "replace-node" as const,
      }
}

function commandResult(document: CanvasDocument, createdNodeIds = ["generated-one"]): CanvasApplicationCommandResult {
  return {
    affectedNodeIds: createdNodeIds,
    changed: true,
    createdNodeIds,
    document: structuredClone(document),
    operationReceipt: canvasOperationReceipt("generation-test-command"),
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
    document: structuredClone(document),
    operationReceipt: canvasOperationReceipt("generation-test-persisted-command"),
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
    beforeExternalStarted?: () => Promise<void> | void
    currentResources?: GenerationCanvasServiceOptions["currentResources"]
    dispatchGuard?: () => Promise<void> | void
    document?: CanvasDocument
    loadDocument?: () => Promise<{ document: CanvasDocument }> | { document: CanvasDocument }
    prepareTool?: (tool: GenerationToolSummary, signal?: AbortSignal) => Promise<void>
    publisher?: GenerationCanvasFilePublisherPort
    project?: Partial<GenerationCanvasProjectPort>
    resource?: Partial<GenerationCanvasResourcePort>
    result?: McpToolCallResult | ((input: Record<string, unknown>, signal?: AbortSignal) => Promise<McpToolCallResult>)
    recovery?: PreparedGenerationRecovery
    inputSnapshots?: GenerationInputSnapshotStore
    operations?: GenerationOperationStore
    run?: Partial<GenerationCanvasRunPort>
    scopeId?: string
    selectedTool?: GenerationToolSummary
    taskId?: string
    toolDescription?: GenerationToolDescription
  } & GenerationLimitOverrides,
) {
  const document = options.document ?? createCanvasDocument({ id: "canvas-one", title: "Canvas" })
  const selectedTool = options.selectedTool ?? tool()
  const calls: Record<string, unknown>[] = []
  const operationMetadata: Array<GenerationToolOperationMetadata | undefined> = []
  const call: PreparedGenerationToolExecution["call"] = async (
    input,
    signal,
    lifecycleObserver,
    operation,
    dispatchHooks,
  ) => {
    await options.beforeExternalStarted?.()
    await dispatchHooks?.validate?.()
    await options.dispatchGuard?.()
    await dispatchHooks?.guard?.()
    await dispatchHooks?.validate?.()
    await lifecycleObserver?.({ type: "external-started" })
    calls.push(input)
    operationMetadata.push(operation)
    if (options.taskId) await lifecycleObserver?.({ taskId: options.taskId, type: "submitted" })
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
      return {
        call,
        ...(options.recovery === undefined ? {} : { recovery: options.recovery }),
        validateInput: (input) => validateGenerationToolInput(description, input),
      }
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
    async createPendingGenerationResource() {
      throw new Error("Unexpected createPendingGenerationResource")
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
    async replaceGeneratedResource(input) {
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
        snapshot: { ...viewSnapshot },
      }
    },
    async getActiveWorkbenchRef() {
      return null
    },
    async getViewSnapshot() {
      return { ...viewSnapshot }
    },
    async reloadDocument() {
      return true
    },
  }
  const runRequests = {
    finish: [] as Parameters<GenerationCanvasRunPort["finish"]>[0][],
    interruptInactive: [] as Parameters<GenerationCanvasRunPort["interruptInactive"]>[0][],
    markRunning: [] as Parameters<GenerationCanvasRunPort["markRunning"]>[0][],
    start: [] as Parameters<GenerationCanvasRunPort["start"]>[0][],
  }
  const runs: GenerationCanvasRunPort = {
    async finish(input) {
      runRequests.finish.push(input)
      if (options.run?.finish) return options.run.finish(input)
      return { ...commandResult(document, []), affectedNodeIds: [input.nodeId] }
    },
    async interruptInactive(input) {
      runRequests.interruptInactive.push(input)
      if (options.run?.interruptInactive) return options.run.interruptInactive(input)
      const affectedNodeIds = document.nodes.flatMap((node) =>
        (node.data.metadata as Record<string, unknown> | undefined)?.convaxGenerationRun ? [node.id] : [],
      )
      return { ...commandResult(document, []), affectedNodeIds }
    },
    async markRunning(input) {
      runRequests.markRunning.push(input)
      if (options.run?.markRunning) return options.run.markRunning(input)
      return { ...commandResult(document, []), affectedNodeIds: [input.nodeId] }
    },
    async start(input) {
      runRequests.start.push(input)
      if (options.run?.start) return options.run.start(input)
      return { ...commandResult(document, []), affectedNodeIds: [input.nodeId] }
    },
  }
  return {
    calls,
    renderer,
    replacementRequests,
    resourceRequests,
    runRequests,
    service: new GenerationCanvasService({
      assets: options.assets ?? {
        async resolve() {
          throw new Error("Unexpected managed asset resolve")
        },
      },
      application: {
        async query() {
          const loaded = options.loadDocument ? await options.loadDocument() : { document }
          return { nodes: [], projection: structuredClone(loaded.document) }
        },
      },
      currentResources: options.currentResources ?? {
        async queryCurrentResources() {
          throw new Error("Unexpected queryCurrentResources")
        },
      },
      ...(options.inputSnapshots === undefined ? {} : { inputSnapshots: options.inputSnapshots }),
      ...(options.maxInputBytes === undefined ? {} : { maxInputBytes: options.maxInputBytes }),
      ...(options.maxInputFileBytes === undefined ? {} : { maxInputFileBytes: options.maxInputFileBytes }),
      ...(options.maxInlineOutputFileBytes === undefined
        ? {}
        : { maxInlineOutputFileBytes: options.maxInlineOutputFileBytes }),
      ...(options.maxOutputFileBytes === undefined ? {} : { maxOutputFileBytes: options.maxOutputFileBytes }),
      ...(options.maxOutputFiles === undefined ? {} : { maxOutputFiles: options.maxOutputFiles }),
      ...(options.operations === undefined ? {} : { operations: options.operations }),
      publisher,
      projects: project,
      renderer,
      resources,
      runs,
      temporaryRoot: os.tmpdir(),
      tools,
    }),
    published,
    operationMetadata,
    viewRequests,
  }
}

async function setupPendingGeneration(
  result: McpToolCallResult | ((input: Record<string, unknown>, signal?: AbortSignal) => Promise<McpToolCallResult>),
  options: {
    inputSnapshots?: GenerationInputSnapshotStore
    operations?: GenerationOperationStore
    prepareTool?: (tool: GenerationToolSummary, signal?: AbortSignal) => Promise<void>
    dispatchGuard?: () => Promise<void> | void
    recovery?: PreparedGenerationRecovery
    referenceImageSize?: { height: number; width: number }
    roundTripPending?: boolean
    taskId?: string
  } = {},
) {
  const projectRoot = await temporaryDirectory()
  await writeProjectTextReferences(projectRoot, {
    brief: "Stable brief",
    "plugin-owner": "Plugin card",
  })
  const referenceImageBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])
  if (options.referenceImageSize) {
    await fs.mkdir(path.join(projectRoot, "Media"), { recursive: true })
    await fs.writeFile(path.join(projectRoot, "Media", "reference.png"), referenceImageBytes)
  }
  const reference = options.referenceImageSize
    ? {
        ...createMediaNode({
          id: "brief",
          position: { x: 0, y: 0 },
          resource: {
            id: "brief-resource",
            kind: "image",
            metadata: { [projectResourceReferenceKey]: projectFileReference("Media/reference.png") },
            mimeType: "image/png",
            name: "reference.png",
            state: { status: "ready", url: "" },
          },
        }),
        style: { ...options.referenceImageSize },
      }
    : createTextNode({ id: "brief", position: { x: 0, y: 0 }, text: "Stable brief" })
  const owner = createTextNode({ id: "plugin-owner", position: { x: 360, y: 0 }, text: "Plugin card" })
  let currentDocument = createCanvasDocument({
    edges: [{ id: "reference-to-owner", source: reference.id, target: owner.id }],
    id: "canvas-one",
    nodes: [reference, owner],
    title: "Canvas",
  })
  const createRequests: Parameters<GenerationCanvasResourcePort["createPendingGenerationResource"]>[0][] = []
  const replacementRequests: Parameters<GenerationCanvasResourcePort["replaceGeneratedResource"]>[0][] = []
  const reloadRevisions: number[] = []
  let reloadSequence = 0
  const pendingNodeId = "pending-one"

  const harness = setup({
    dispatchGuard: options.dispatchGuard,
    document: currentDocument,
    loadDocument: () => ({ document: currentDocument }),
    prepareTool: options.prepareTool,
    inputSnapshots: options.inputSnapshots,
    operations: options.operations,
    project: projectPortFor(projectRoot),
    resource: {
      async addResources() {
        throw new Error("Pending generation must not add a second Canvas node")
      },
      async createPendingGenerationResource(input) {
        createRequests.push(input)
        const node =
          input.kind === "text"
            ? createCanvasTextNode({
                id: pendingNodeId,
                label: input.label ?? "Text",
                metadata: {},
                position: input.anchor,
                resourceState: { status: "ready", text: "" },
              })
            : createMediaNode({
                id: pendingNodeId,
                label: input.label ?? "Image",
                position: input.anchor,
                resource: {
                  id: pendingNodeId,
                  kind: input.kind,
                  metadata: {},
                  state: { status: "ready", url: "" },
                },
              })
        if (input.size) node.style = { ...input.size }
        node.data.status = "pending"
        const withPending = {
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
        }
        currentDocument = startCanvasNodeGenerationRun(withPending, pendingNodeId, {
          operationId: input.operationId,
          prompt: input.prompt,
          toolId: input.toolId,
        })
        if (options.roundTripPending) {
          currentDocument = JSON.parse(JSON.stringify(currentDocument)) as CanvasDocument
        }
        return persistedCommandResult(
          currentDocument,
          [pendingNodeId],
          [...(input.relation?.mode === "connect" ? input.relation.anchorNodeIds : []), pendingNodeId],
        )
      },
      async replaceGeneratedResource(input) {
        const target = currentDocument.nodes.find((node) => node.id === input.targetNodeId)
        if (!target) {
          throw new Error("Pending target changed")
        }
        const replaced = {
          ...currentDocument,
          nodes: currentDocument.nodes.map((node) =>
            node.id === input.targetNodeId
              ? {
                  ...node,
                  data: {
                    ...node.data,
                    error: undefined,
                    resourceState: { status: "ready" as const, url: "managed" },
                    status: "idle" as const,
                  },
                }
              : node,
          ),
        }
        replacementRequests.push(input)
        currentDocument = succeedCanvasNodeGenerationRun(replaced, input.targetNodeId, input.operationId)
        return persistedCommandResult(currentDocument, [], [input.targetNodeId])
      },
    },
    result,
    recovery: options.recovery,
    taskId: options.taskId,
    run: {
      async finish(input) {
        currentDocument = finishCanvasNodeGenerationRun(
          currentDocument,
          input.nodeId,
          input.operationId,
          input.failureMessage,
        )
        return persistedCommandResult(currentDocument, [], [input.nodeId])
      },
      async markRunning(input) {
        const next = markCanvasNodeGenerationRunRunning(currentDocument, input.nodeId, input.operationId, input.taskId)
        if (next !== currentDocument) {
          currentDocument = next
        }
        return persistedCommandResult(currentDocument, [], [input.nodeId])
      },
      async start() {
        throw new Error("Pending generation run must start with pending node creation")
      },
    },
    selectedTool: tool({
      acceptedInputs: [options.referenceImageSize ? "reference_image" : "text"],
      id: "creative-tools/draw",
      output: "image",
      ...(options.recovery ? { recovery: "long-running-operation" as const } : {}),
      toolId: "draw",
    }),
  })
  harness.renderer.getViewSnapshot = mock(async () => ({
    documentId: currentDocument.id,
    scopeId: "project-one",
    selectedEdgeIds: [],
    selectedNodeIds: [],
    viewId: "desktop-main",
    viewport: { x: 0, y: 0, zoom: 1 },
  }))
  harness.renderer.reloadDocument = mock(async () => {
    reloadSequence += 1
    reloadRevisions.push(reloadSequence)
    return true
  })

  return {
    ...harness,
    createRequests,
    getDocument: () => currentDocument,
    mutateDocument(mutate: (document: CanvasDocument) => CanvasDocument) {
      currentDocument = mutate(currentDocument)
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

    await expect(service.generate(request(), { id: "renderer:1", kind: "ui" })).resolves.toMatchObject({
      createdNodeIds: ["generated-one"],
      operationReceipt: canvasOperationReceipt("generation-test-command"),
      projection: expect.objectContaining({ id: "canvas-one" }),
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
      scopeId: "project-one",
      sources: [{ kind: "host-file", path: "Generated/generated-1.md" }],
    })
    expect(viewRequests).toHaveLength(1)
    expect(viewRequests[0]?.command).toEqual({
      fit: "none",
      nodeIds: ["generated-one"],
      select: false,
      type: "nodes.reveal",
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
      operationReceipt: null,
      outputText: "asset-one\n\nasset-two",
      projection: document,
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
    const root = await temporaryDirectory()
    await writeProjectTextReferences(root, { brief: "Original brief" })
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
        await fs.writeFile(path.join(root, "References", "brief.md"), "Changed while the operation was running", "utf8")
        return { content: [{ text: "external-id", type: "text" }] }
      },
      project: projectPortFor(root),
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
    const root = await temporaryDirectory()
    await writeProjectTextReferences(root, { brief: "Import this" })
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
      project: projectPortFor(root),
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

  test("rejects an outgoing neighbor submitted as a constrained generation input", async () => {
    const owner = createTextNode({ id: "owner", position: { x: 0, y: 0 }, text: "Owner" })
    const output = createTextNode({ id: "output", position: { x: 320, y: 0 }, text: "Not an input" })
    const document = createCanvasDocument({
      edges: [{ id: "owner-to-output", source: owner.id, target: output.id }],
      id: "canvas-one",
      nodes: [owner, output],
      title: "Canvas",
    })
    const selectedTool = tool({ acceptedInputs: ["text"] })
    const harness = setup({ document, selectedTool })

    await expect(
      harness.service.generate(
        request({
          referenceConstraint: { ownerNodeId: owner.id, type: "direct-incoming" },
          references: [{ nodeId: output.id, role: "text" }],
          toolId: selectedTool.id,
        }),
        { id: "renderer:1", kind: "ui" },
      ),
    ).rejects.toThrow("must remain direct incoming")
    expect(harness.calls).toEqual([])
  })

  test("composes durable Project text prompt context without exposing it as a model reference", async () => {
    const root = await temporaryDirectory()
    await fs.mkdir(path.join(root, "Notes"), { recursive: true })
    await writeProjectTextReferences(root, { second: "Second scene detail" })
    await fs.writeFile(path.join(root, "Notes", "first.txt"), "First scene detail", "utf8")
    const first = createTextNode({
      id: "first",
      path: "Notes/first.txt",
      position: { x: 0, y: 0 },
      text: "Stale renderer-only text",
    })
    const second = createTextNode({ id: "second", position: { x: 0, y: 160 }, text: "Second scene detail" })
    const owner = createMediaNode({
      id: "owner",
      position: { x: 360, y: 0 },
      resource: {
        id: "owner",
        kind: "image",
        metadata: {},
        state: { status: "ready", url: "" },
      },
    })
    owner.data.status = "idle"
    const document = dehydrateProjectCanvasDocument(
      createCanvasDocument({
        edges: [
          { id: "first-to-owner", source: first.id, target: owner.id },
          { id: "second-to-owner", source: second.id, target: owner.id },
        ],
        id: "canvas-one",
        nodes: [first, second, owner],
        title: "Canvas",
      }),
    )
    const selectedTool = tool({
      acceptedInputs: [],
      id: "creative-tools/draw",
      output: "image",
      toolId: "draw",
    })
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])
    const harness = setup({
      document,
      project: projectPortFor(root),
      result: { content: [{ data: png.toString("base64"), mimeType: "image/png", type: "image" }] },
      selectedTool,
    })
    const persistedOwner = document.nodes.find((node) => node.id === owner.id)!

    await harness.service.generate(
      request({
        prompt: "test",
        promptContextNodeIds: [first.id, second.id],
        referenceConstraint: { ownerNodeId: owner.id, type: "direct-incoming" },
        resultMode: replaceNodeMode(persistedOwner),
        output: "image",
        toolId: selectedTool.id,
      }),
      { id: "renderer:1", kind: "ui" },
    )

    expect(harness.calls[0]?.prompt).toBe("test\n\nFirst scene detail\n\nSecond scene detail")
    expect(harness.calls[0]?.references).toEqual([])
    expect(harness.runRequests.start[0]?.prompt).toBe("test")
    expect(harness.replacementRequests).toHaveLength(1)
  })

  test("combines text prompt context with media references without conflating their tool inputs", async () => {
    const root = await temporaryDirectory()
    const referencePath = path.join(root, "Media", "reference.png")
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])
    await fs.mkdir(path.dirname(referencePath), { recursive: true })
    await fs.writeFile(referencePath, png)
    await writeProjectTextReferences(root, { brief: "Scene detail" })
    const context = createTextNode({ id: "brief", position: { x: 0, y: 0 }, text: "Scene detail" })
    const image = createMediaNode({
      id: "image-one",
      position: { x: 0, y: 160 },
      resource: {
        id: "resource-one",
        kind: "image",
        metadata: {
          [projectResourceReferenceKey]: projectFileReference("Media/reference.png"),
        },
        mimeType: "image/png",
        name: "reference.png",
        state: { status: "ready", url: "" },
      },
    })
    const document = dehydrateProjectCanvasDocument(
      createCanvasDocument({ id: "canvas-one", nodes: [context, image], title: "Canvas" }),
    )
    const harness = setup({
      document,
      project: projectPortFor(root),
      result: { content: [{ data: png.toString("base64"), mimeType: "image/png", type: "image" }] },
      selectedTool: tool({
        acceptedInputs: ["reference_image"],
        id: "creative-tools/draw",
        output: "image",
        toolId: "draw",
      }),
    })

    await harness.service.generate(
      request({
        output: "image",
        prompt: "Typed instruction",
        promptContextNodeIds: [context.id],
        references: [{ nodeId: image.id, role: "reference_image" }],
        toolId: "creative-tools/draw",
      }),
      { id: "renderer:1", kind: "ui" },
    )

    expect(harness.calls[0]?.prompt).toBe("Typed instruction\n\nScene detail")
    expect(harness.calls[0]?.references).toEqual([
      expect.objectContaining({ kind: "file", node_id: image.id, role: "reference_image" }),
    ])
  })

  test("rejects forged or oversized prompt context before external execution", async () => {
    const owner = createTextNode({ id: "owner", position: { x: 0, y: 0 }, text: "Owner" })
    const outgoing = createTextNode({ id: "outgoing", position: { x: 320, y: 0 }, text: "Not an input" })
    const document = dehydrateProjectCanvasDocument(
      createCanvasDocument({
        edges: [{ id: "owner-to-outgoing", source: owner.id, target: outgoing.id }],
        id: "canvas-one",
        nodes: [owner, outgoing],
        title: "Canvas",
      }),
    )
    const forged = setup({ document })
    await expect(
      forged.service.generate(
        request({
          prompt: "",
          promptContextNodeIds: [outgoing.id],
          referenceConstraint: { ownerNodeId: owner.id, type: "direct-incoming" },
        }),
        { id: "renderer:1", kind: "ui" },
      ),
    ).rejects.toThrow("must remain a direct incoming Canvas text node")
    expect(forged.calls).toEqual([])

    const root = await temporaryDirectory()
    await writeProjectTextReferences(root, {
      empty: "   ",
      oversized: "x".repeat(64 * 1024 + 1),
    })
    const oversized = createTextNode({
      id: "oversized",
      position: { x: 0, y: 0 },
      text: "x".repeat(64 * 1024 + 1),
    })
    const oversizedHarness = setup({
      document: dehydrateProjectCanvasDocument(
        createCanvasDocument({ id: "canvas-one", nodes: [oversized], title: "Canvas" }),
      ),
      project: projectPortFor(root),
    })
    await expect(
      oversizedHarness.service.generate(request({ prompt: "", promptContextNodeIds: [oversized.id] }), {
        id: "renderer:1",
        kind: "ui",
      }),
    ).rejects.toThrow("prompt context is too large")
    expect(oversizedHarness.calls).toEqual([])

    const empty = createTextNode({ id: "empty", position: { x: 0, y: 0 }, text: "   " })
    const emptyHarness = setup({
      document: dehydrateProjectCanvasDocument(
        createCanvasDocument({ id: "canvas-one", nodes: [empty], title: "Canvas" }),
      ),
      project: projectPortFor(root),
    })
    await expect(
      emptyHarness.service.generate(request({ prompt: "", promptContextNodeIds: [empty.id] }), {
        id: "renderer:1",
        kind: "ui",
      }),
    ).rejects.toThrow("prompt context is empty")
    expect(emptyHarness.calls).toEqual([])
  })

  test("rejects prompt context text that changes while the model is running", async () => {
    const root = await temporaryDirectory()
    await writeProjectTextReferences(root, { brief: "Original brief" })
    const context = createTextNode({ id: "brief", position: { x: 0, y: 0 }, text: "Original brief" })
    const document = dehydrateProjectCanvasDocument(
      createCanvasDocument({ id: "canvas-one", nodes: [context], title: "Canvas" }),
    )
    const harness = setup({
      document,
      async result() {
        await fs.writeFile(path.join(root, "References", "brief.md"), "Changed while the model was running", "utf8")
        return { content: [{ text: "Generated result", type: "text" }] }
      },
      project: projectPortFor(root),
    })

    await expect(
      harness.service.generate(request({ prompt: "", promptContextNodeIds: [context.id] }), {
        id: "renderer:1",
        kind: "ui",
      }),
    ).rejects.toThrow("Generation references changed while the tool was running")
    expect(harness.calls).toHaveLength(1)
    expect(harness.resourceRequests).toEqual([])
  })

  test("rejects prompt context whitespace edits while the model is running", async () => {
    const root = await temporaryDirectory()
    await writeProjectTextReferences(root, { brief: "Original brief" })
    const context = createTextNode({ id: "brief", position: { x: 0, y: 0 }, text: "Original brief" })
    const document = dehydrateProjectCanvasDocument(
      createCanvasDocument({ id: "canvas-one", nodes: [context], title: "Canvas" }),
    )
    const harness = setup({
      document,
      async result() {
        await fs.writeFile(path.join(root, "References", "brief.md"), " Original brief ", "utf8")
        return { content: [{ text: "Generated result", type: "text" }] }
      },
      project: projectPortFor(root),
    })

    await expect(
      harness.service.generate(request({ prompt: "", promptContextNodeIds: [context.id] }), {
        id: "renderer:1",
        kind: "ui",
      }),
    ).rejects.toThrow("Generation references changed while the tool was running")
    expect(harness.calls).toHaveLength(1)
    expect(harness.resourceRequests).toEqual([])
  })

  test("rejects a prompt context incoming edge removed while the model is running", async () => {
    const root = await temporaryDirectory()
    await writeProjectTextReferences(root, { brief: "Original brief" })
    const context = createTextNode({ id: "brief", position: { x: 0, y: 0 }, text: "Original brief" })
    const owner = createMediaNode({
      id: "image-output",
      position: { x: 320, y: 0 },
      resource: {
        id: "image-output",
        kind: "image",
        metadata: {},
        state: { status: "ready", url: "" },
      },
    })
    owner.data.status = "idle"
    const document = dehydrateProjectCanvasDocument(
      createCanvasDocument({
        edges: [{ id: "brief-to-output", source: context.id, target: owner.id }],
        id: "canvas-one",
        nodes: [context, owner],
        title: "Canvas",
      }),
    )
    const harness = setup({
      document,
      async result() {
        document.edges = []
        return { content: [{ text: "Generated result", type: "text" }] }
      },
      project: projectPortFor(root),
    })

    await expect(
      harness.service.generate(
        request({
          prompt: "",
          promptContextNodeIds: [context.id],
          referenceConstraint: { ownerNodeId: owner.id, type: "direct-incoming" },
        }),
        { id: "renderer:1", kind: "ui" },
      ),
    ).rejects.toThrow("Generation direct incoming references changed while the tool was running")
    expect(harness.calls).toHaveLength(1)
    expect(harness.resourceRequests).toEqual([])
  })

  test("rechecks the exact Plugin owner identity after a direct-incoming side effect", async () => {
    const root = await temporaryDirectory()
    await writeProjectTextReferences(root, { brief: "Import this" })
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
      project: projectPortFor(root),
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
    const harness = await setupPendingGeneration(async () => {
      markStarted()
      await gate
      return { content: [{ data: png.toString("base64"), mimeType: "image/png", type: "image" }] }
    })
    const generation = harness.service.generate(
      request({
        output: "image",
        parentId: "focused-group",
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
      kind: "image",
      operationId: "operation-one",
      parentId: "focused-group",
      prompt: "Draw a small fox",
      relation: {
        anchorNodeIds: [harness.reference.id],
        direction: "from-anchor",
        mode: "connect",
      },
      scopeId: "project-one",
      toolId: "creative-tools/draw",
    })
    const pending = harness.getDocument().nodes.find((node) => node.id === harness.pendingNodeId)!
    expect(pending.data).toMatchObject({
      kind: "image",
      status: "pending",
    })
    expect(getCanvasNodeGenerationRun(pending)).toMatchObject({
      operationId: "operation-one",
      status: "running",
      toolId: "creative-tools/draw",
    })
    expect(harness.reloadRevisions).toEqual([1])
    expect(harness.viewRequests).toHaveLength(1)
    expect(harness.viewRequests[0]).toMatchObject({
      command: {
        animation: "smooth",
        fit: "center",
        nodeIds: [harness.pendingNodeId],
        select: true,
        type: "nodes.reveal",
      },
    })
    expect(harness.replacementRequests).toEqual([])

    release()
    const generated = await generation
    expect(generated).toMatchObject({
      createdNodeIds: [harness.pendingNodeId],
      operationReceipt: canvasOperationReceipt("generation-test-persisted-command"),
      projection: expect.objectContaining({ id: "canvas-one" }),
      toolId: "creative-tools/draw",
      warnings: [],
    })
    expect(harness.resourceRequests).toEqual([])
    expect(harness.replacementRequests).toHaveLength(1)
    expect(harness.replacementRequests[0]).toMatchObject({
      commandId: "generation:operation-one",
      expectedTarget: expect.objectContaining({
        data: expect.objectContaining({ kind: "image" }),
        type: "file",
      }),
      targetNodeId: harness.pendingNodeId,
    })
    expect(harness.replacementRequests[0]?.expectedTarget.data).not.toHaveProperty("status")
    expect(harness.getDocument().nodes.find((node) => node.id === harness.pendingNodeId)?.data.status).toBe("idle")
    expect(
      getCanvasNodeGenerationRun(harness.getDocument().nodes.find((node) => node.id === harness.pendingNodeId)!)
        ?.status,
    ).toBe("succeeded")
    expect(harness.reloadRevisions).toEqual([1, 2])
  })

  test("derives a same-modality pending result frame from the authoritative visual reference", async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])
    const harness = await setupPendingGeneration(
      { content: [{ data: png.toString("base64"), mimeType: "image/png", type: "image" }] },
      { referenceImageSize: { height: 206, width: 480 } },
    )

    await harness.service.generate(
      request({
        output: "image",
        references: [{ nodeId: harness.reference.id, role: "reference_image" }],
        resultMode: { type: "create-pending-node" },
        toolId: "creative-tools/draw",
      }),
      { id: "renderer:1", kind: "ui" },
    )

    expect(harness.createRequests[0]?.size).toEqual({ height: 206, width: 480 })
    expect(harness.getDocument().nodes.find((node) => node.id === harness.pendingNodeId)?.style).toEqual({
      height: 206,
      width: 480,
    })
  })

  test("keeps pending replacement valid when persistence removes its empty runtime resource placeholder", async () => {
    let markStarted!: () => void
    let release!: () => void
    const started = new Promise<void>((resolve) => {
      markStarted = resolve
    })
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])
    const harness = await setupPendingGeneration(async () => {
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
    harness.mutateDocument((document) => ({
      ...document,
      nodes: document.nodes.map((node) => {
        if (node.id !== harness.pendingNodeId) return node
        const { resourceState: _resourceState, ...data } = node.data
        return { ...node, data }
      }),
    }))
    release()

    await expect(generation).resolves.toMatchObject({
      createdNodeIds: [harness.pendingNodeId],
      toolId: "creative-tools/draw",
    })
    expect(harness.replacementRequests).toHaveLength(1)
  })

  test("keeps a constrained text-card owner as relation-only context for one pending visual result", async () => {
    let markStarted!: () => void
    let release!: () => void
    const started = new Promise<void>((resolve) => {
      markStarted = resolve
    })
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])
    const harness = await setupPendingGeneration(async () => {
      markStarted()
      await gate
      return { content: [{ data: png.toString("base64"), mimeType: "image/png", type: "image" }] }
    })
    const generation = harness.service.generate(
      request({
        expectedOutputCount: 1,
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
    expect(harness.calls[0]?.references).toEqual([
      expect.objectContaining({ node_id: harness.reference.id, role: "text", text: "Stable brief" }),
    ])
    expect(harness.calls[0]?.references).not.toContainEqual(expect.objectContaining({ node_id: harness.owner.id }))
    expect(harness.getDocument().nodes.find((node) => node.id === harness.owner.id)?.data).toEqual(harness.owner.data)
    expect(getCanvasNodeGenerationRun(harness.getDocument().nodes.find((node) => node.id === harness.owner.id)!)).toBe(
      undefined,
    )

    release()
    await expect(generation).resolves.toMatchObject({ createdNodeIds: [harness.pendingNodeId] })
    expect(harness.getDocument().nodes.find((node) => node.id === harness.owner.id)?.data).toEqual(harness.owner.data)
  })

  test("persists a structured task receipt on a host-created pending owner", async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])
    const harness = await setupPendingGeneration(
      { content: [{ data: png.toString("base64"), mimeType: "image/png", type: "image" }] },
      { taskId: "task_safe_pending_123" },
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
    ).resolves.toMatchObject({
      createdNodeIds: [harness.pendingNodeId],
      operationReceipt: canvasOperationReceipt("generation-test-persisted-command"),
    })

    expect(harness.runRequests.markRunning.map(({ taskId }) => taskId)).toEqual([undefined, "task_safe_pending_123"])
    const completed = harness.getDocument().nodes.find((node) => node.id === harness.pendingNodeId)!
    expect(getCanvasNodeGenerationRun(completed)).toMatchObject({
      status: "succeeded",
      taskId: "task_safe_pending_123",
    })
  })

  test("persists recoverable input and ledger boundaries before the paid call and acknowledges after Canvas commit", async () => {
    const privateRoot = await temporaryDirectory()
    const operations = new GenerationOperationStore(path.join(privateRoot, "operations"), { now: () => 42 })
    const inputSnapshots = new GenerationInputSnapshotStore(path.join(privateRoot, "inputs"))
    const storedRequests: unknown[] = []
    const createInputSnapshot = inputSnapshots.create.bind(inputSnapshots)
    spyOn(inputSnapshots, "create").mockImplementation(async (input) => {
      storedRequests.push(structuredClone(input.request))
      return createInputSnapshot(input)
    })
    const pngResult: McpToolCallResult = {
      content: [
        {
          data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]).toString("base64"),
          mimeType: "image/png",
          type: "image",
        },
      ],
    }
    const digestDirectory = path.join(privateRoot, "digest-output")
    await fs.mkdir(digestDirectory, { mode: 0o700 })
    const resultDigest = await generationRecoveryResultDigest(pngResult, digestDirectory)
    const acknowledgements: unknown[] = []
    let waits = 0
    const recovery: PreparedGenerationRecovery = {
      async acknowledge(input) {
        acknowledgements.push(input)
      },
      bindingDigest: "f".repeat(64),
      async cancel() {
        return { schema: "convax.generation-lro-snapshot/1", status: "cancelled" }
      },
      executionBindingDigest: "a".repeat(64),
      async get() {
        return {
          schema: "convax.generation-lro-snapshot/1",
          status: "running",
          taskId: "task_recoverable_123",
        }
      },
      pluginPackageDigest: "c".repeat(64),
      async result() {
        return { result: pngResult, resultDigest }
      },
      runtimeAuthorizationDigest: "e".repeat(64),
      async wait() {
        waits += 1
        return {
          resultDigest,
          schema: "convax.generation-lro-snapshot/1",
          status: "succeeded",
          taskId: "task_recoverable_123",
        }
      },
    }
    const harness = await setupPendingGeneration(pngResult, {
      inputSnapshots,
      operations,
      recovery,
      taskId: "task_recoverable_123",
    })

    await expect(
      harness.service.generate(
        request({
          output: "image",
          prompt: "",
          promptContextNodeIds: [harness.reference.id],
          resultMode: { type: "create-pending-node" },
          toolId: "creative-tools/draw",
        }),
        { id: "renderer:1", kind: "ui" },
      ),
    ).resolves.toMatchObject({ createdNodeIds: [harness.pendingNodeId] })

    expect(await operations.list()).toEqual([])
    expect(await fs.readdir(path.join(privateRoot, "inputs"))).toEqual([])
    expect(harness.operationMetadata[0]).toEqual({
      operationId: "operation-one",
      recovery: "required",
      requestDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
    })
    expect(harness.createRequests[0]?.prompt).toBe("")
    expect(harness.calls[0]?.prompt).toBe("Stable brief")
    expect(harness.calls[0]?.references).toEqual([])
    expect(storedRequests).toEqual([
      expect.objectContaining({
        canvasRequest: expect.objectContaining({
          prompt: "",
          promptContextNodeIds: [harness.reference.id],
          references: [],
        }),
        prompt: "Stable brief",
      }),
    ])
    expect(acknowledgements).toHaveLength(1)
    expect(waits).toBe(1)
  })

  test("does not supervise a live prepared operation during Canvas reconciliation", async () => {
    const privateRoot = await temporaryDirectory()
    const operations = new GenerationOperationStore(path.join(privateRoot, "operations"), { now: () => 42 })
    const inputSnapshots = new GenerationInputSnapshotStore(path.join(privateRoot, "inputs"))
    let enterDispatchGuard!: () => void
    let releaseDispatchGuard!: () => void
    const dispatchGuardEntered = new Promise<void>((resolve) => {
      enterDispatchGuard = resolve
    })
    const dispatchGuardGate = new Promise<void>((resolve) => {
      releaseDispatchGuard = resolve
    })
    const pngResult: McpToolCallResult = {
      content: [
        {
          data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]).toString("base64"),
          mimeType: "image/png",
          type: "image",
        },
      ],
    }
    const digestDirectory = path.join(privateRoot, "digest-output")
    await fs.mkdir(digestDirectory, { mode: 0o700 })
    const resultDigest = await generationRecoveryResultDigest(pngResult, digestDirectory)
    const recovery: PreparedGenerationRecovery = {
      async acknowledge() {},
      bindingDigest: "f".repeat(64),
      async cancel() {
        throw new Error("A live prepared operation must not be cancelled by reconciliation")
      },
      executionBindingDigest: "a".repeat(64),
      async get() {
        return {
          resultDigest,
          schema: "convax.generation-lro-snapshot/1",
          status: "succeeded",
          taskId: "task_live_prepared_123",
        }
      },
      pluginPackageDigest: "c".repeat(64),
      async result() {
        return { result: pngResult, resultDigest }
      },
      runtimeAuthorizationDigest: "e".repeat(64),
      async wait() {
        throw new Error("A completed live operation must not be awaited")
      },
    }
    const harness = await setupPendingGeneration(pngResult, {
      async dispatchGuard() {
        enterDispatchGuard()
        await dispatchGuardGate
      },
      inputSnapshots,
      operations,
      recovery,
      taskId: "task_live_prepared_123",
    })
    const actor = { id: "renderer:1", kind: "ui" as const }
    const generation = harness.service.generate(
      request({
        output: "image",
        references: [{ nodeId: harness.reference.id, role: "text" }],
        resultMode: { type: "create-pending-node" },
        toolId: "creative-tools/draw",
      }),
      actor,
    )

    await dispatchGuardEntered
    try {
      expect(await operations.list()).toEqual([expect.objectContaining({ phase: "prepared" })])

      await harness.service.reconcileCanvas({ canvasId: "canvas-one", scopeId: "project-one" }, actor)

      expect(harness.runRequests.interruptInactive).toHaveLength(0)
      expect(harness.runRequests.finish).toEqual([])
      expect(harness.calls).toEqual([])
      expect(await operations.list()).toEqual([expect.objectContaining({ phase: "prepared" })])
    } finally {
      releaseDispatchGuard()
    }
    await expect(generation).resolves.toMatchObject({ createdNodeIds: [harness.pendingNodeId] })
    expect(harness.calls).toHaveLength(1)
    expect(await operations.list()).toEqual([])
  })

  test("does not supervise a live operation that acquires its target while recovery ledgers are loading", async () => {
    const privateRoot = await temporaryDirectory()
    const operations = new GenerationOperationStore(path.join(privateRoot, "operations"), { now: () => 42 })
    const inputSnapshots = new GenerationInputSnapshotStore(path.join(privateRoot, "inputs"))
    let enterLedgerList!: () => void
    let releaseLedgerList!: () => void
    const ledgerListEntered = new Promise<void>((resolve) => {
      enterLedgerList = resolve
    })
    const ledgerListGate = new Promise<void>((resolve) => {
      releaseLedgerList = resolve
    })
    const originalList = operations.list.bind(operations)
    let listCalls = 0
    const listSpy = spyOn(operations, "list").mockImplementation(async () => {
      listCalls += 1
      if (listCalls === 2) {
        enterLedgerList()
        await ledgerListGate
      }
      return originalList()
    })
    let enterDispatchGuard!: () => void
    let releaseDispatchGuard!: () => void
    const dispatchGuardEntered = new Promise<void>((resolve) => {
      enterDispatchGuard = resolve
    })
    const dispatchGuardGate = new Promise<void>((resolve) => {
      releaseDispatchGuard = resolve
    })
    const pngResult: McpToolCallResult = {
      content: [
        {
          data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]).toString("base64"),
          mimeType: "image/png",
          type: "image",
        },
      ],
    }
    const digestDirectory = path.join(privateRoot, "digest-output")
    await fs.mkdir(digestDirectory, { mode: 0o700 })
    const resultDigest = await generationRecoveryResultDigest(pngResult, digestDirectory)
    const recovery: PreparedGenerationRecovery = {
      async acknowledge() {},
      bindingDigest: "f".repeat(64),
      async cancel() {
        throw new Error("A live prepared operation must not be cancelled by reconciliation")
      },
      executionBindingDigest: "a".repeat(64),
      async get() {
        return {
          resultDigest,
          schema: "convax.generation-lro-snapshot/1",
          status: "succeeded",
          taskId: "task_live_interleaved_123",
        }
      },
      pluginPackageDigest: "c".repeat(64),
      async result() {
        return { result: pngResult, resultDigest }
      },
      runtimeAuthorizationDigest: "e".repeat(64),
      async wait() {
        throw new Error("A live prepared operation must not be awaited by reconciliation")
      },
    }
    const harness = await setupPendingGeneration(pngResult, {
      async dispatchGuard() {
        enterDispatchGuard()
        await dispatchGuardGate
      },
      inputSnapshots,
      operations,
      recovery,
    })
    const actor = { id: "renderer:1", kind: "ui" as const }
    const reconciliation = harness.service.reconcileCanvas({ canvasId: "canvas-one", scopeId: "project-one" }, actor)

    await ledgerListEntered
    const generation = harness.service.generate(
      request({
        output: "image",
        references: [{ nodeId: harness.reference.id, role: "text" }],
        resultMode: { type: "create-pending-node" },
        toolId: "creative-tools/draw",
      }),
      actor,
    )
    await dispatchGuardEntered
    releaseLedgerList()

    try {
      await expect(reconciliation).resolves.toMatchObject({ failedNodeIds: [] })
      expect(await operations.list()).toEqual([expect.objectContaining({ phase: "prepared" })])
      expect(harness.runRequests.finish).toEqual([])
      expect(harness.calls).toEqual([])
    } finally {
      releaseDispatchGuard()
      listSpy.mockRestore()
    }
    await expect(generation).resolves.toMatchObject({ createdNodeIds: [harness.pendingNodeId] })
    expect(await operations.list()).toEqual([])
  })

  test("keeps an active Canvas run live when its execution acquires a target during recovery loading", async () => {
    const privateRoot = await temporaryDirectory()
    const operations = new GenerationOperationStore(path.join(privateRoot, "operations"), { now: () => 42 })
    const inputSnapshots = new GenerationInputSnapshotStore(path.join(privateRoot, "inputs"))
    const owner = createTextNode({ id: "active-owner", position: { x: 0, y: 0 }, text: "Existing output" })
    const document = startCanvasNodeGenerationRun(
      createCanvasDocument({ id: "canvas-one", nodes: [owner], title: "Canvas" }),
      owner.id,
      {
        operationId: "operation-one",
        prompt: "Continue writing",
        toolId: "creative-tools/write",
      },
    )
    let enterLedgerList!: () => void
    let releaseLedgerList!: () => void
    const ledgerListEntered = new Promise<void>((resolve) => {
      enterLedgerList = resolve
    })
    const ledgerListGate = new Promise<void>((resolve) => {
      releaseLedgerList = resolve
    })
    const originalList = operations.list.bind(operations)
    let listCalls = 0
    const listSpy = spyOn(operations, "list").mockImplementation(async () => {
      listCalls += 1
      if (listCalls === 2) {
        enterLedgerList()
        await ledgerListGate
      }
      return originalList()
    })
    let enterRunStart!: () => void
    let releaseRunStart!: () => void
    const runStartEntered = new Promise<void>((resolve) => {
      enterRunStart = resolve
    })
    const runStartGate = new Promise<void>((resolve) => {
      releaseRunStart = resolve
    })
    const harness = setup({
      document,
      inputSnapshots,
      operations,
      run: {
        async interruptInactive() {
          return persistedCommandResult(document, [], [])
        },
        async start() {
          enterRunStart()
          await runStartGate
          return persistedCommandResult(document, [], [owner.id])
        },
      },
    })
    const actor = { id: "renderer:1", kind: "ui" as const }
    const reconciliation = harness.service.reconcileCanvas({ canvasId: "canvas-one", scopeId: "project-one" }, actor)

    await ledgerListEntered
    const controller = new AbortController()
    const generation = harness.service.generate(
      request({
        prompt: "Continue writing",
        resultMode: replaceNodeMode(owner),
        toolId: "creative-tools/write",
      }),
      actor,
      controller.signal,
    )
    await runStartEntered
    releaseLedgerList()

    try {
      await expect(reconciliation).resolves.toMatchObject({ failedNodeIds: [] })
      expect(harness.runRequests.interruptInactive).toHaveLength(0)
    } finally {
      controller.abort("Test cleanup")
      releaseRunStart()
      listSpy.mockRestore()
    }
    await expect(generation).rejects.toMatchObject({ name: "AbortError" })
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
        async createPendingGenerationResource() {
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
    const reason = new DOMException("user canceled", "AbortError")
    expect(() => controller.abort(reason)).not.toThrow()
    releaseLoad()

    await expect(generation).rejects.toMatchObject({ message: "user canceled", name: "AbortError" })
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(createPendingCalls).toBe(0)
    expect(harness.calls).toEqual([])
  })

  test("does not accept an already-aborted first caller", async () => {
    let createPendingCalls = 0
    const harness = setup({
      document: createCanvasDocument({ id: "canvas-one", title: "Canvas" }),
      resource: {
        async createPendingGenerationResource() {
          createPendingCalls += 1
          throw new Error("An already-aborted request must not create a pending owner")
        },
      },
      selectedTool: tool({ id: "creative-tools/draw", output: "image", toolId: "draw" }),
    })
    const controller = new AbortController()
    controller.abort("caller was already closed")

    await expect(
      harness.service.generate(
        request({
          output: "image",
          resultMode: { type: "create-pending-node" },
          toolId: "creative-tools/draw",
        }),
        { id: "renderer:1", kind: "ui" },
        controller.signal,
      ),
    ).rejects.toMatchObject({ name: "AbortError" })
    await Bun.sleep(0)

    expect(createPendingCalls).toBe(0)
    expect(harness.calls).toEqual([])
  })

  test("retains a failed pending node with a host-safe error instead of raw sidecar details", async () => {
    const harness = await setupPendingGeneration({
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
    expect(harness.runRequests.finish).toHaveLength(1)
    expect(harness.runRequests.finish[0]).toMatchObject({
      commandId: "generation:operation-one:terminal",
      nodeId: harness.pendingNodeId,
      operationId: "operation-one",
    })
    expect(harness.runRequests.finish[0]).not.toHaveProperty("failureMessage")
    expect(harness.getDocument().nodes.find((node) => node.id === harness.pendingNodeId)?.data).toMatchObject({
      error: "Generation could not be completed",
      status: "error",
    })
    expect(harness.reloadRevisions).toEqual([1, 2])
  })

  test("does not derive portable service presentation from sidecar-reported text", async () => {
    const harness = await setupPendingGeneration({
      content: [{ text: "Generation model service unavailable", type: "text" }],
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
      message: "Generation tool failed: Generation model service unavailable",
      name: "GenerationToolReportedError",
    })

    expect(harness.runRequests.finish).toHaveLength(1)
    expect(harness.runRequests.finish[0]).not.toHaveProperty("failureMessage")
    const pending = harness.getDocument().nodes.find((node) => node.id === harness.pendingNodeId)!
    expect(pending.data).toMatchObject({ error: "Generation could not be completed", status: "error" })
    expect(getCanvasNodeGenerationRun(pending)).not.toHaveProperty("failureMessage")
  })

  test("does not let a delayed Renderer projection block pending creation or replacement", async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])
    const harness = await setupPendingGeneration({
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
    ).resolves.toMatchObject({
      createdNodeIds: [harness.pendingNodeId],
      operationReceipt: canvasOperationReceipt("generation-test-persisted-command"),
    })

    expect(harness.calls).toHaveLength(1)
    expect(harness.createRequests).toHaveLength(1)
    expect(harness.replacementRequests).toHaveLength(1)
    expect(harness.getDocument().nodes.find((node) => node.id === harness.pendingNodeId)?.data.status).toBe("idle")
  })

  test("replaces a pending node after JSON persistence omits undefined media fields", async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])
    const harness = await setupPendingGeneration(
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
    ).resolves.toMatchObject({
      createdNodeIds: [harness.pendingNodeId],
      operationReceipt: canvasOperationReceipt("generation-test-persisted-command"),
    })

    expect(harness.replacementRequests).toHaveLength(1)
    expect(harness.getDocument().nodes.find((node) => node.id === harness.pendingNodeId)?.data.status).toBe("idle")
  })

  test("marks a pending node error even when the Renderer never finishes synchronizing", async () => {
    const harness = await setupPendingGeneration({ content: [], isError: true })
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
    expect(harness.runRequests.finish).toHaveLength(1)
    expect(harness.getDocument().nodes.find((node) => node.id === harness.pendingNodeId)?.data).toMatchObject({
      error: "Generation could not be completed",
      status: "error",
    })
  })

  test("does not create a second pending node when preparation fails after the first node commit", async () => {
    const harness = await setupPendingGeneration(
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
    expect(harness.runRequests.finish).toHaveLength(1)
    expect(harness.calls).toEqual([])
    expect(harness.getDocument().nodes.filter((node) => node.id === harness.pendingNodeId)).toHaveLength(1)
    expect(harness.getDocument().nodes.find((node) => node.id === harness.pendingNodeId)?.data.status).toBe("error")
  })

  test("fails the card when the final dispatch guard rejects before the tool call", async () => {
    const harness = await setupPendingGeneration(
      { content: [{ text: "Unused output", type: "text" }] },
      {
        dispatchGuard() {
          throw new Error("Generation model service disconnected")
        },
      },
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
    ).rejects.toThrow("service disconnected")

    expect(harness.calls).toEqual([])
    expect(harness.runRequests.markRunning).toEqual([])
    expect(harness.runRequests.finish).toEqual([
      expect.objectContaining({
        failureMessage: "Creative Tools 服务不可用",
        operationId: "operation-one",
      }),
    ])
    const pending = harness.getDocument().nodes.find((node) => node.id === harness.pendingNodeId)!
    expect(pending.data).toMatchObject({ error: "Creative Tools 服务不可用", status: "error" })
    expect(getCanvasNodeGenerationRun(pending)).toMatchObject({
      failureMessage: "Creative Tools 服务不可用",
      status: "failed",
    })
  })

  test("rechecks the replacement target after bounded runtime and service guards", async () => {
    const owner = createTextNode({ id: "owner-card", position: { x: 0, y: 0 }, text: "Before" })
    let currentDocument = createCanvasDocument({ id: "canvas-one", nodes: [owner], title: "Canvas" })
    const { calls, runRequests, service } = setup({
      async dispatchGuard() {
        currentDocument = {
          ...currentDocument,
          nodes: currentDocument.nodes.map((node) =>
            node.id === owner.id
              ? {
                  ...node,
                  data: {
                    ...node.data,
                    resourceState: { status: "ready", text: "Edited during service check" },
                  },
                }
              : node,
          ),
        }
      },
      document: currentDocument,
      loadDocument: () => ({ document: currentDocument }),
    })

    await expect(
      service.generate(request({ resultMode: replaceNodeMode(owner) }), {
        id: "renderer:1",
        kind: "ui",
      }),
    ).rejects.toThrow("replacement target changed")

    expect(calls).toEqual([])
    expect(runRequests.markRunning).toEqual([])
    expect(runRequests.finish).toEqual([expect.objectContaining({ operationId: "operation-one" })])
  })

  test("cleans a prepared recovery ledger when the final dispatch guard rejects", async () => {
    const privateRoot = await temporaryDirectory()
    const operations = new GenerationOperationStore(path.join(privateRoot, "operations"), { now: () => 42 })
    const inputSnapshots = new GenerationInputSnapshotStore(path.join(privateRoot, "inputs"))
    let observedPhase: string | undefined
    const recovery: PreparedGenerationRecovery = {
      async acknowledge() {
        throw new Error("A non-dispatched operation must not be acknowledged through the sidecar")
      },
      bindingDigest: "f".repeat(64),
      async cancel() {
        throw new Error("A non-dispatched operation must not be cancelled")
      },
      executionBindingDigest: "a".repeat(64),
      async get() {
        throw new Error("A non-dispatched operation must not be queried")
      },
      pluginPackageDigest: "c".repeat(64),
      async result() {
        throw new Error("A non-dispatched operation has no result")
      },
      runtimeAuthorizationDigest: "e".repeat(64),
      async wait() {
        throw new Error("A non-dispatched operation must not be awaited")
      },
    }
    const harness = await setupPendingGeneration(
      { content: [{ text: "Unused output", type: "text" }] },
      {
        async dispatchGuard() {
          observedPhase = (await operations.list())[0]?.phase
          throw new Error("Generation model service disconnected")
        },
        inputSnapshots,
        operations,
        recovery,
      },
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
    ).rejects.toThrow("service disconnected")

    expect(observedPhase).toBe("prepared")
    expect(harness.calls).toEqual([])
    expect(harness.runRequests.markRunning).toEqual([])
    expect(harness.runRequests.finish).toEqual([expect.objectContaining({ operationId: "operation-one" })])
    expect(await operations.list()).toEqual([])
    expect(await fs.readdir(path.join(privateRoot, "inputs"))).toEqual([])
  })

  test("marks a canceled pending node without deleting it", async () => {
    let markStarted!: () => void
    const started = new Promise<void>((resolve) => {
      markStarted = resolve
    })
    const harness = await setupPendingGeneration(async (_input, signal) => {
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
    const actor = { id: "renderer:1", kind: "ui" as const }
    const generation = harness.service.generate(
      request({
        output: "image",
        references: [{ nodeId: harness.reference.id, role: "text" }],
        resultMode: { type: "create-pending-node" },
        toolId: "creative-tools/draw",
      }),
      actor,
    )

    await started
    await harness.service.cancel("operation-one", actor)
    await expect(generation).rejects.toMatchObject({ name: "AbortError" })
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(harness.runRequests.finish).toHaveLength(1)
    expect(harness.runRequests.finish[0]).toMatchObject({ operationId: "operation-one" })
    expect(harness.getDocument().nodes.find((node) => node.id === harness.pendingNodeId)?.data).toMatchObject({
      error: "Generation could not be completed",
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
    const harness = await setupPendingGeneration(async () => {
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
    }))
    release()

    await expect(generation).rejects.toThrow("Generation replacement target changed while the tool was running")
    expect(harness.runRequests.finish).toHaveLength(1)
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
      service.generate(request({ resultMode: replaceNodeMode(owner) }), {
        id: "renderer:1",
        kind: "ui",
      }),
    ).resolves.toMatchObject({
      createdNodeIds: [],
      operationReceipt: canvasOperationReceipt("generation-test-command"),
      projection: expect.objectContaining({ id: "canvas-one" }),
      toolId: "creative-tools/write",
      warnings: [],
    })

    expect(resourceRequests).toEqual([])
    expect(replacementRequests).toHaveLength(1)
    expect(replacementRequests[0]).toMatchObject({
      actor: { id: "renderer:1", kind: "ui" },
      canvasId: "canvas-one",
      commandId: "generation:operation-one",
      expectedTarget: createCanvasGenerationTargetGuard(owner),
      operationId: "operation-one",
      scopeId: "project-one",
      source: { kind: "host-file", path: "Generated/generated-1.md" },
      targetNodeId: owner.id,
    })
    expect(viewRequests).toEqual([])
  })

  test("persists submitting, running, structured task receipt, and atomic generated replacement in order", async () => {
    const owner = createTextNode({ id: "owner-card", position: { x: 0, y: 0 }, text: "Before" })
    const document = createCanvasDocument({ id: "canvas-one", nodes: [owner], title: "Canvas" })
    const { calls, renderer, replacementRequests, runRequests, service } = setup({ document, taskId: "task_safe_123" })
    renderer.reloadDocument = mock(async () => true)

    await service.generate(request({ resultMode: replaceNodeMode(owner) }), {
      id: "renderer:1",
      kind: "ui",
    })

    expect(runRequests.start).toHaveLength(1)
    expect(runRequests.start[0]).toMatchObject({
      nodeId: owner.id,
      operationId: "operation-one",
      prompt: "Draw a small fox",
      toolId: "creative-tools/write",
    })
    expect(runRequests.markRunning.map(({ nodeId, operationId, taskId }) => ({ nodeId, operationId, taskId }))).toEqual(
      [
        { nodeId: owner.id, operationId: "operation-one", taskId: undefined },
        { nodeId: owner.id, operationId: "operation-one", taskId: "task_safe_123" },
      ],
    )
    expect(calls).toHaveLength(1)
    expect(replacementRequests[0]).toMatchObject({
      operationId: "operation-one",
      targetNodeId: owner.id,
    })
    expect(runRequests.finish).toEqual([])
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(renderer.reloadDocument).toHaveBeenCalledTimes(2)
  })

  test("rechecks the replacement target after running is persisted and before the paid tool call", async () => {
    const owner = createTextNode({ id: "owner-card", position: { x: 0, y: 0 }, text: "Before" })
    let currentDocument = createCanvasDocument({ id: "canvas-one", nodes: [owner], title: "Canvas" })
    const { calls, runRequests, service } = setup({
      document: currentDocument,
      loadDocument: () => ({ document: currentDocument }),
      run: {
        async markRunning(input) {
          currentDocument = {
            ...currentDocument,
            nodes: currentDocument.nodes.map((node) =>
              node.id === owner.id
                ? {
                    ...node,
                    data: {
                      ...node.data,
                      resourceState: {
                        status: "ready",
                        text: "Edited before external start",
                      },
                    },
                  }
                : node,
            ),
          }
          return persistedCommandResult(currentDocument, [], [owner.id])
        },
      },
    })

    await expect(
      service.generate(request({ resultMode: replaceNodeMode(owner) }), {
        id: "renderer:1",
        kind: "ui",
      }),
    ).rejects.toThrow("replacement target changed")
    expect(runRequests.markRunning).toHaveLength(1)
    expect(calls).toEqual([])
  })

  test("rechecks the replacement target after dispatch authorization is persisted", async () => {
    const privateRoot = await temporaryDirectory()
    const operations = new GenerationOperationStore(path.join(privateRoot, "operations"), { now: () => 42 })
    const inputSnapshots = new GenerationInputSnapshotStore(path.join(privateRoot, "inputs"))
    let recoveryGets = 0
    const recovery: PreparedGenerationRecovery = {
      async acknowledge() {},
      bindingDigest: "f".repeat(64),
      async cancel() {
        return { schema: "convax.generation-lro-snapshot/1", status: "absent" }
      },
      executionBindingDigest: "a".repeat(64),
      async get() {
        recoveryGets += 1
        return { schema: "convax.generation-lro-snapshot/1", status: "absent" }
      },
      pluginPackageDigest: "c".repeat(64),
      async result() {
        throw new Error("A non-dispatched operation has no result")
      },
      runtimeAuthorizationDigest: "e".repeat(64),
      async wait() {
        throw new Error("A non-dispatched operation must not be awaited")
      },
    }
    let harness!: Awaited<ReturnType<typeof setupPendingGeneration>>
    const transition = operations.transition.bind(operations)
    const transitionSpy = spyOn(operations, "transition").mockImplementation(async (identity, update) => {
      const ledger = await transition(identity, update)
      if (update.phase === "dispatching") {
        harness.mutateDocument((document) => ({
          ...document,
          nodes: document.nodes.map((node) =>
            node.id === harness.pendingNodeId
              ? {
                  ...node,
                  data: {
                    ...node.data,
                    resourceState: { status: "ready", url: "edited-during-dispatch-persistence" },
                  },
                }
              : node,
          ),
        }))
      }
      return ledger
    })
    harness = await setupPendingGeneration(
      { content: [{ text: "Unused output", type: "text" }] },
      { inputSnapshots, operations, recovery },
    )

    try {
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
      ).rejects.toThrow("replacement target changed")
    } finally {
      transitionSpy.mockRestore()
    }

    expect(recoveryGets).toBe(1)
    expect(harness.calls).toEqual([])
    expect(harness.runRequests.markRunning).toHaveLength(1)
    expect(await operations.list()).toEqual([])
  })

  test("keeps legacy tools compatible without a task receipt and persists failed terminal state", async () => {
    const owner = createTextNode({ id: "owner-card", position: { x: 0, y: 0 }, text: "Before" })
    const document = createCanvasDocument({ id: "canvas-one", nodes: [owner], title: "Canvas" })
    const legacy = setup({
      document,
      result: { content: [{ text: "safe failure", type: "text" }], isError: true },
    })

    await expect(
      legacy.service.generate(request({ resultMode: replaceNodeMode(owner) }), {
        id: "renderer:1",
        kind: "ui",
      }),
    ).rejects.toThrow("safe failure")
    expect(legacy.runRequests.markRunning.map(({ operationId, taskId }) => ({ operationId, taskId }))).toEqual([
      { operationId: "operation-one", taskId: undefined },
    ])
    expect(legacy.runRequests.finish).toEqual([expect.objectContaining({ operationId: "operation-one" })])
    expect(legacy.replacementRequests).toEqual([])
  })

  test("logs only a bounded error category when terminal persistence exposes private diagnostics", async () => {
    const owner = createTextNode({ id: "owner-card", position: { x: 0, y: 0 }, text: "Before" })
    const document = createCanvasDocument({ id: "canvas-one", nodes: [owner], title: "Canvas" })
    const warning = spyOn(console, "warn").mockImplementation(() => undefined)
    try {
      const harness = setup({
        document,
        result: { content: [{ text: "safe failure", type: "text" }], isError: true },
        run: {
          async finish() {
            throw new Error("token=private-value at /Users/example/private-operation.json")
          },
        },
      })

      await expect(
        harness.service.generate(request({ resultMode: replaceNodeMode(owner) }), {
          id: "renderer:1",
          kind: "ui",
        }),
      ).rejects.toThrow("safe failure")

      const logged = JSON.stringify(warning.mock.calls)
      expect(logged).toContain("terminal Canvas persistence")
      expect(logged).toContain("Error")
      expect(logged).not.toContain("private-value")
      expect(logged).not.toContain("/Users/")
      expect(logged).not.toContain("private-operation")
    } finally {
      warning.mockRestore()
    }
  })

  test("persists explicit node-generation cancellation without replacing the prior resource", async () => {
    const owner = createTextNode({ id: "owner-card", position: { x: 0, y: 0 }, text: "Before" })
    const document = createCanvasDocument({ id: "canvas-one", nodes: [owner], title: "Canvas" })
    let externalStarted!: () => void
    const started = new Promise<void>((resolve) => (externalStarted = resolve))
    const canceled = setup({
      document,
      result: (_input, signal) =>
        new Promise<McpToolCallResult>((_resolve, reject) => {
          externalStarted()
          const abort = () => {
            const error = new Error("Explicit cancel")
            error.name = "AbortError"
            reject(error)
          }
          if (signal?.aborted) abort()
          else signal?.addEventListener("abort", abort, { once: true })
        }),
    })
    const actor = { id: "renderer:1", kind: "ui" as const }
    const pending = canceled.service.generate(request({ resultMode: replaceNodeMode(owner) }), actor)
    await started
    await canceled.service.cancel("operation-one", actor)
    await expect(pending).rejects.toMatchObject({ name: "AbortError" })
    for (let index = 0; index < 10 && canceled.runRequests.finish.length === 0; index += 1) {
      await Bun.sleep(0)
    }
    expect(canceled.runRequests.finish.map(({ operationId }) => operationId)).toEqual(["operation-one"])
    expect(canceled.replacementRequests).toEqual([])
  })

  test("reconciles restart-left active runs to failed without invoking a tool", async () => {
    const owner = createTextNode({ id: "owner-card", position: { x: 0, y: 0 }, text: "Before" })
    const active = startCanvasNodeGenerationRun(
      createCanvasDocument({ id: "canvas-one", nodes: [owner], title: "Canvas" }),
      owner.id,
      {
        operationId: "operation-before-restart",
        prompt: "Do not submit again",
        toolId: "creative-tools/write",
      },
    )
    const { calls, runRequests, service } = setup({ document: active })

    await expect(
      service.reconcileCanvas(
        { canvasId: "canvas-one", scopeId: "project-one" },
        { id: "desktop:renderer", kind: "ui" },
      ),
    ).resolves.toMatchObject({
      failedNodeIds: [owner.id],
      operationReceipt: canvasOperationReceipt("generation-test-command"),
      projection: expect.objectContaining({ id: "canvas-one" }),
    })
    expect(runRequests.interruptInactive).toEqual([expect.objectContaining({ liveRuns: [] })])
    expect(calls).toEqual([])
  })

  test("recovers a provider task accepted before its task receipt reached Canvas without resubmission", async () => {
    const privateRoot = await temporaryDirectory()
    const operations = new GenerationOperationStore(path.join(privateRoot, "operations"), { now: () => 100 })
    const inputs = new GenerationInputSnapshotStore(path.join(privateRoot, "inputs"))
    const owner = createMediaNode({
      id: "owner",
      position: { x: 0, y: 0 },
      resource: {
        id: "old",
        kind: "image",
        metadata: {},
        mimeType: "image/png",
        name: "old.png",
        state: { status: "ready", url: "convax://old" },
      },
    })
    const active = startCanvasNodeGenerationRun(
      createCanvasDocument({ id: "canvas-one", nodes: [owner], title: "Canvas" }),
      owner.id,
      {
        operationId: "operation-recover",
        prompt: "Recover this image",
        toolId: "creative-tools/draw",
      },
    )
    const guard = createCanvasGenerationTargetGuard(active.nodes[0]!)
    const storedInput = await inputs.create({
      files: [],
      request: {
        canvasRequest: {
          references: [],
          relationAnchorNodeIds: [owner.id],
          resultMode: replaceNodeMode(owner),
        },
        input: {},
        operationId: "operation-recover",
        output: "image",
        prompt: "Recover this image",
        referenceSnapshot: stableJsonForTest({
          constraint: null,
          references: [],
          relationAnchors: [{ kind: "image", nodeId: owner.id, type: "file" }],
        }),
        references: [],
        schema: "convax.generation-lro-call/1",
        targetGuard: guard,
        toolId: "creative-tools/draw",
      },
    })
    await operations.create({
      canvasId: "canvas-one",
      createdAt: 0,
      executionBindingDigest: "a".repeat(64),
      inputSnapshotId: storedInput.id,
      nodeId: owner.id,
      operationId: "operation-recover",
      phase: "dispatching",
      pluginPackageDigest: "c".repeat(64),
      projectId: "project-one",
      requestDigest: storedInput.requestDigest,
      runtimeAuthorizationDigest: "e".repeat(64),
      schema: "convax.generation-operation-ledger/1",
      sidecarRecoveryBindingDigest: "f".repeat(64),
      targetGuardDigest: generationOperationRequestDigest(guard),
      toolId: "creative-tools/draw",
      updatedAt: 0,
    })
    const pngResult: McpToolCallResult = {
      content: [
        {
          data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]).toString("base64"),
          mimeType: "image/png",
          type: "image",
        },
      ],
    }
    const replayedBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1])
    const digestOutputDirectory = path.join(privateRoot, "replay-digest-output")
    await fs.mkdir(digestOutputDirectory, { mode: 0o700 })
    const digestReplayPath = path.join(digestOutputDirectory, "replayed.png")
    await fs.writeFile(digestReplayPath, replayedBytes)
    const resultDigest = await generationRecoveryResultDigest(
      {
        content: [
          {
            mimeType: "image/png",
            name: "replayed.png",
            type: "resource_link",
            uri: pathToFileURL(digestReplayPath).toString(),
          },
        ],
      },
      digestOutputDirectory,
    )
    const acknowledgements: unknown[] = []
    let recoveryWaitCalls = 0
    const recovery: PreparedGenerationRecovery = {
      async acknowledge(input) {
        acknowledgements.push(input)
      },
      bindingDigest: "f".repeat(64),
      async cancel() {
        return { schema: "convax.generation-lro-snapshot/1", status: "cancelled" }
      },
      executionBindingDigest: "a".repeat(64),
      async get() {
        return {
          schema: "convax.generation-lro-snapshot/1",
          status: "running",
          taskId: "task_recover_123",
        }
      },
      pluginPackageDigest: "c".repeat(64),
      async result(input) {
        const replayedPath = path.join(input.outputDirectory, "replayed.png")
        await fs.writeFile(replayedPath, replayedBytes)
        return {
          result: {
            content: [
              {
                mimeType: "image/png",
                name: "replayed.png",
                type: "resource_link",
                uri: pathToFileURL(replayedPath).toString(),
              },
            ],
          },
          resultDigest,
        }
      },
      runtimeAuthorizationDigest: "e".repeat(64),
      async wait() {
        recoveryWaitCalls += 1
        if (recoveryWaitCalls <= 9) {
          return {
            schema: "convax.generation-lro-snapshot/1",
            status: "running",
            taskId: "task_recover_123",
          }
        }
        return {
          resultDigest,
          schema: "convax.generation-lro-snapshot/1",
          status: "succeeded",
          taskId: "task_recover_123",
        }
      },
    }
    const harness = setup({
      document: active,
      inputSnapshots: inputs,
      loadDocument: () => ({ document: active }),
      operations,
      recovery,
      result: pngResult,
      run: {
        async interruptInactive() {
          return { ...commandResult(active, []), affectedNodeIds: [] }
        },
      },
      selectedTool: tool({
        id: "creative-tools/draw",
        output: "image",
        recovery: "long-running-operation",
        toolId: "draw",
      }),
    })

    await expect(
      harness.service.reconcileCanvas(
        { canvasId: "canvas-one", scopeId: "project-one" },
        { id: "desktop:startup", kind: "system" },
      ),
    ).resolves.toMatchObject({ failedNodeIds: [] })
    for (let index = 0; index < 2_000; index += 1) {
      if ((await operations.list()).length === 0) break
      await Bun.sleep(1)
    }
    expect(await operations.list()).toEqual([])
    expect(await fs.readdir(path.join(privateRoot, "inputs"))).toEqual([])
    expect(harness.calls).toHaveLength(0)
    expect(harness.runRequests.markRunning).toContainEqual(
      expect.objectContaining({ operationId: "operation-recover", taskId: "task_recover_123" }),
    )
    expect(harness.replacementRequests).toHaveLength(1)
    expect(acknowledgements).toHaveLength(1)
    expect(recoveryWaitCalls).toBe(10)
  })

  test("never replays a prepared recovery ledger after restart", async () => {
    const privateRoot = await temporaryDirectory()
    const operations = new GenerationOperationStore(path.join(privateRoot, "operations"), { now: () => 100 })
    const inputs = new GenerationInputSnapshotStore(path.join(privateRoot, "inputs"))
    const owner = createTextNode({ id: "owner", position: { x: 0, y: 0 }, text: "Before" })
    const active = startCanvasNodeGenerationRun(
      createCanvasDocument({ id: "canvas-one", nodes: [owner], title: "Canvas" }),
      owner.id,
      {
        operationId: "operation-never-dispatched",
        prompt: "Must not be replayed",
        toolId: "creative-tools/write",
      },
    )
    const guard = createCanvasGenerationTargetGuard(active.nodes[0]!)
    const storedInput = await inputs.create({
      files: [],
      request: {
        canvasRequest: {
          references: [],
          relationAnchorNodeIds: [],
          resultMode: replaceNodeMode(owner),
        },
        input: {},
        operationId: "operation-never-dispatched",
        output: "text",
        prompt: "Must not be replayed",
        referenceSnapshot: stableJsonForTest({ constraint: null, references: [], relationAnchors: [] }),
        references: [],
        schema: "convax.generation-lro-call/1",
        targetGuard: guard,
        toolId: "creative-tools/write",
      },
    })
    await operations.create({
      canvasId: "canvas-one",
      createdAt: 0,
      executionBindingDigest: "a".repeat(64),
      inputSnapshotId: storedInput.id,
      nodeId: owner.id,
      operationId: "operation-never-dispatched",
      phase: "prepared",
      pluginPackageDigest: "c".repeat(64),
      projectId: "project-one",
      requestDigest: storedInput.requestDigest,
      runtimeAuthorizationDigest: "e".repeat(64),
      schema: "convax.generation-operation-ledger/1",
      sidecarRecoveryBindingDigest: "f".repeat(64),
      targetGuardDigest: generationOperationRequestDigest(guard),
      toolId: "creative-tools/write",
      updatedAt: 0,
    })
    let recoveryCalls = 0
    const recovery: PreparedGenerationRecovery = {
      async acknowledge() {
        recoveryCalls += 1
      },
      bindingDigest: "f".repeat(64),
      async cancel() {
        recoveryCalls += 1
        return { schema: "convax.generation-lro-snapshot/1", status: "cancelled" }
      },
      executionBindingDigest: "a".repeat(64),
      async get() {
        recoveryCalls += 1
        return { schema: "convax.generation-lro-snapshot/1", status: "prepared" }
      },
      pluginPackageDigest: "c".repeat(64),
      async result() {
        recoveryCalls += 1
        throw new Error("A prepared Main ledger has no replayable result")
      },
      runtimeAuthorizationDigest: "e".repeat(64),
      async wait() {
        recoveryCalls += 1
        return { schema: "convax.generation-lro-snapshot/1", status: "prepared" }
      },
    }
    const harness = setup({
      document: active,
      inputSnapshots: inputs,
      loadDocument: () => ({ document: active }),
      operations,
      recovery,
      run: {
        async interruptInactive() {
          return { ...commandResult(active, []), affectedNodeIds: [] }
        },
      },
      selectedTool: tool({
        id: "creative-tools/write",
        output: "text",
        recovery: "long-running-operation",
        toolId: "write",
      }),
    })

    await harness.service.reconcileCanvas(
      { canvasId: "canvas-one", scopeId: "project-one" },
      { id: "desktop:startup", kind: "system" },
    )
    for (let index = 0; index < 2_000; index += 1) {
      if ((await operations.list()).length === 0) break
      await Bun.sleep(1)
    }

    expect(recoveryCalls).toBe(0)
    expect(harness.calls).toEqual([])
    expect(harness.runRequests.finish).toEqual([
      expect.objectContaining({
        operationId: "operation-never-dispatched",
      }),
    ])
    expect(await operations.list()).toEqual([])
    expect(await fs.readdir(path.join(privateRoot, "inputs"))).toEqual([])
  })

  test("replays the exact stored prompt context and rechecks it at external start", async () => {
    const privateRoot = await temporaryDirectory()
    const projectRoot = await temporaryDirectory()
    await writeProjectTextReferences(projectRoot, { brief: "Stable brief" })
    const operations = new GenerationOperationStore(path.join(privateRoot, "operations"), { now: () => 100 })
    const inputs = new GenerationInputSnapshotStore(path.join(privateRoot, "inputs"))
    const context = createTextNode({ id: "brief", position: { x: 0, y: 0 }, text: "Renderer-only text" })
    delete context.data.resourceState
    const owner = createMediaNode({
      id: "owner",
      position: { x: 360, y: 0 },
      resource: {
        id: "old",
        kind: "image",
        metadata: {},
        state: { status: "ready", url: "convax://old" },
      },
    })
    const active = startCanvasNodeGenerationRun(
      createCanvasDocument({
        edges: [{ id: "brief-to-owner", source: context.id, target: owner.id }],
        id: "canvas-one",
        nodes: [context, owner],
        title: "Canvas",
      }),
      owner.id,
      {
        operationId: "operation-context-recover",
        prompt: "test",
        toolId: "creative-tools/draw",
      },
    )
    const guard = createCanvasGenerationTargetGuard(active.nodes.find((node) => node.id === owner.id)!)
    const referenceSnapshot = stableJsonForTest({
      constraint: null,
      promptContexts: [
        {
          contentDigest: createHash("sha256").update("Stable brief", "utf8").digest("hex"),
          nodeId: context.id,
          source: {
            kind: "text",
            mimeType: "text/markdown",
            reference: projectFileReference("References/brief.md"),
            type: "file",
          },
        },
      ],
      references: [],
      relationAnchors: [],
    })
    const storedInput = await inputs.create({
      files: [],
      request: {
        canvasRequest: {
          prompt: "test",
          promptContextNodeIds: [context.id],
          references: [],
          relationAnchorNodeIds: [],
          resultMode: replaceNodeMode(owner),
        },
        input: {},
        operationId: "operation-context-recover",
        output: "image",
        prompt: "test\n\nStable brief",
        referenceSnapshot,
        references: [],
        schema: "convax.generation-lro-call/1",
        targetGuard: guard,
        toolId: "creative-tools/draw",
      },
    })
    await operations.create({
      canvasId: "canvas-one",
      createdAt: 0,
      executionBindingDigest: "a".repeat(64),
      inputSnapshotId: storedInput.id,
      nodeId: owner.id,
      operationId: "operation-context-recover",
      phase: "dispatching",
      pluginPackageDigest: "c".repeat(64),
      projectId: "project-one",
      requestDigest: storedInput.requestDigest,
      runtimeAuthorizationDigest: "e".repeat(64),
      schema: "convax.generation-operation-ledger/1",
      sidecarRecoveryBindingDigest: "f".repeat(64),
      targetGuardDigest: generationOperationRequestDigest(guard),
      toolId: "creative-tools/draw",
      updatedAt: 0,
    })
    const pngResult: McpToolCallResult = {
      content: [
        {
          data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]).toString("base64"),
          mimeType: "image/png",
          type: "image",
        },
      ],
    }
    const digestDirectory = path.join(privateRoot, "digest-output")
    await fs.mkdir(digestDirectory, { mode: 0o700 })
    const resultDigest = await generationRecoveryResultDigest(pngResult, digestDirectory)
    const acknowledgements: unknown[] = []
    let recoveryReads = 0
    const recovery: PreparedGenerationRecovery = {
      async acknowledge(input) {
        acknowledgements.push(input)
      },
      bindingDigest: "f".repeat(64),
      async cancel() {
        return { schema: "convax.generation-lro-snapshot/1", status: "cancelled" }
      },
      executionBindingDigest: "a".repeat(64),
      async get() {
        recoveryReads += 1
        if (recoveryReads === 1) return { schema: "convax.generation-lro-snapshot/1", status: "prepared" }
        return {
          resultDigest,
          schema: "convax.generation-lro-snapshot/1",
          status: "succeeded",
          taskId: "task_context_recover_123",
        }
      },
      pluginPackageDigest: "c".repeat(64),
      async result() {
        return { result: pngResult, resultDigest }
      },
      runtimeAuthorizationDigest: "e".repeat(64),
      async wait() {
        throw new Error("Prompt-context replay should not wait after succeeding")
      },
    }
    const harness = setup({
      document: active,
      inputSnapshots: inputs,
      loadDocument: () => ({ document: active }),
      operations,
      project: projectPortFor(projectRoot),
      recovery,
      result: pngResult,
      run: {
        async interruptInactive() {
          return { ...commandResult(active, []), affectedNodeIds: [] }
        },
      },
      selectedTool: tool({
        id: "creative-tools/draw",
        output: "image",
        recovery: "long-running-operation",
        toolId: "draw",
      }),
    })

    await harness.service.reconcileCanvas(
      { canvasId: "canvas-one", scopeId: "project-one" },
      { id: "desktop:startup", kind: "system" },
    )
    for (let index = 0; index < 2_000; index += 1) {
      if ((await operations.list()).length === 0) break
      await Bun.sleep(1)
    }

    expect(await operations.list()).toEqual([])
    expect(harness.calls).toHaveLength(1)
    expect(harness.calls[0]?.prompt).toBe("test\n\nStable brief")
    expect(harness.calls[0]?.references).toEqual([])
    expect(harness.replacementRequests).toHaveLength(1)
    expect(acknowledgements).toHaveLength(1)

    const staleInput = await inputs.create({
      files: [],
      request: {
        canvasRequest: {
          prompt: "test",
          promptContextNodeIds: [context.id],
          references: [],
          relationAnchorNodeIds: [],
          resultMode: replaceNodeMode(owner),
        },
        input: {},
        operationId: "operation-context-recover",
        output: "image",
        prompt: "test\n\nStable brief",
        referenceSnapshot,
        references: [],
        schema: "convax.generation-lro-call/1",
        targetGuard: guard,
        toolId: "creative-tools/draw",
      },
    })
    await operations.create({
      canvasId: "canvas-one",
      createdAt: 0,
      executionBindingDigest: "a".repeat(64),
      inputSnapshotId: staleInput.id,
      nodeId: owner.id,
      operationId: "operation-context-recover",
      phase: "dispatching",
      pluginPackageDigest: "c".repeat(64),
      projectId: "project-one",
      requestDigest: staleInput.requestDigest,
      runtimeAuthorizationDigest: "e".repeat(64),
      schema: "convax.generation-operation-ledger/1",
      sidecarRecoveryBindingDigest: "f".repeat(64),
      targetGuardDigest: generationOperationRequestDigest(guard),
      toolId: "creative-tools/draw",
      updatedAt: 0,
    })
    recoveryReads = 0
    const staleHarness = setup({
      async beforeExternalStarted() {
        await fs.writeFile(path.join(projectRoot, "References", "brief.md"), "Changed after restart", "utf8")
      },
      document: active,
      inputSnapshots: inputs,
      loadDocument: () => ({ document: active }),
      operations,
      project: projectPortFor(projectRoot),
      recovery,
      result: pngResult,
      run: {
        async interruptInactive() {
          return { ...commandResult(active, []), affectedNodeIds: [] }
        },
      },
      selectedTool: tool({
        id: "creative-tools/draw",
        output: "image",
        recovery: "long-running-operation",
        toolId: "draw",
      }),
    })

    await staleHarness.service.reconcileCanvas(
      { canvasId: "canvas-one", scopeId: "project-one" },
      { id: "desktop:startup", kind: "system" },
    )
    for (let index = 0; index < 2_000; index += 1) {
      if ((await operations.list())[0]?.phase === "indeterminate") break
      await Bun.sleep(1)
    }

    expect(await operations.list()).toEqual([expect.objectContaining({ phase: "indeterminate" })])
    expect(staleHarness.calls).toEqual([])
    expect(staleHarness.replacementRequests).toEqual([])
  })

  test("never replays a legacy recovery snapshot that omitted its prompt-context ids", async () => {
    const privateRoot = await temporaryDirectory()
    const operations = new GenerationOperationStore(path.join(privateRoot, "operations"), { now: () => 100 })
    const inputs = new GenerationInputSnapshotStore(path.join(privateRoot, "inputs"))
    const context = createTextNode({ id: "brief", position: { x: 0, y: 0 }, text: "Legacy brief" })
    const owner = createMediaNode({
      id: "owner",
      position: { x: 360, y: 0 },
      resource: {
        id: "old",
        kind: "image",
        metadata: {},
        state: { status: "ready", url: "convax://old" },
      },
    })
    const active = startCanvasNodeGenerationRun(
      createCanvasDocument({
        edges: [{ id: "brief-to-owner", source: context.id, target: owner.id }],
        id: "canvas-one",
        nodes: [context, owner],
        title: "Canvas",
      }),
      owner.id,
      {
        operationId: "operation-legacy-context",
        prompt: "test",
        toolId: "creative-tools/draw",
      },
    )
    const guard = createCanvasGenerationTargetGuard(active.nodes.find((node) => node.id === owner.id)!)
    const storedInput = await inputs.create({
      files: [],
      request: {
        canvasRequest: {
          references: [],
          relationAnchorNodeIds: [],
          resultMode: replaceNodeMode(owner),
        },
        input: {},
        operationId: "operation-legacy-context",
        output: "image",
        prompt: "test",
        referenceSnapshot: stableJsonForTest({
          constraint: null,
          promptContexts: [{ nodeId: context.id, text: "Legacy brief" }],
          references: [],
          relationAnchors: [],
        }),
        references: [],
        schema: "convax.generation-lro-call/1",
        targetGuard: guard,
        toolId: "creative-tools/draw",
      },
    })
    await operations.create({
      canvasId: "canvas-one",
      createdAt: 0,
      executionBindingDigest: "a".repeat(64),
      inputSnapshotId: storedInput.id,
      nodeId: owner.id,
      operationId: "operation-legacy-context",
      phase: "dispatching",
      pluginPackageDigest: "c".repeat(64),
      projectId: "project-one",
      requestDigest: storedInput.requestDigest,
      runtimeAuthorizationDigest: "e".repeat(64),
      schema: "convax.generation-operation-ledger/1",
      sidecarRecoveryBindingDigest: "f".repeat(64),
      targetGuardDigest: generationOperationRequestDigest(guard),
      toolId: "creative-tools/draw",
      updatedAt: 0,
    })
    let recoveryReads = 0
    const recovery: PreparedGenerationRecovery = {
      async acknowledge() {},
      bindingDigest: "f".repeat(64),
      async cancel() {
        return { schema: "convax.generation-lro-snapshot/1", status: "cancelled" }
      },
      executionBindingDigest: "a".repeat(64),
      async get() {
        recoveryReads += 1
        return { schema: "convax.generation-lro-snapshot/1", status: "prepared" }
      },
      pluginPackageDigest: "c".repeat(64),
      async result() {
        throw new Error("Legacy prompt context must not be recovered")
      },
      runtimeAuthorizationDigest: "e".repeat(64),
      async wait() {
        throw new Error("Legacy prompt context must not be recovered")
      },
    }
    const harness = setup({
      document: active,
      inputSnapshots: inputs,
      loadDocument: () => ({ document: active }),
      operations,
      recovery,
      run: {
        async interruptInactive() {
          return { ...commandResult(active, []), affectedNodeIds: [] }
        },
      },
      selectedTool: tool({
        id: "creative-tools/draw",
        output: "image",
        recovery: "long-running-operation",
        toolId: "draw",
      }),
    })

    await harness.service.reconcileCanvas(
      { canvasId: "canvas-one", scopeId: "project-one" },
      { id: "desktop:startup", kind: "system" },
    )
    for (let index = 0; index < 2_000; index += 1) {
      if ((await operations.list())[0]?.phase === "indeterminate") break
      await Bun.sleep(1)
    }

    expect(await operations.list()).toEqual([expect.objectContaining({ phase: "indeterminate" })])
    expect(recoveryReads).toBe(0)
    expect(harness.calls).toEqual([])
    expect(harness.replacementRequests).toEqual([])
  })

  test("explicitly cancels a persisted task after restart through the same pinned recovery operation", async () => {
    const privateRoot = await temporaryDirectory()
    const operations = new GenerationOperationStore(path.join(privateRoot, "operations"), { now: () => 100 })
    const inputs = new GenerationInputSnapshotStore(path.join(privateRoot, "inputs"))
    const owner = createTextNode({ id: "owner", position: { x: 0, y: 0 }, text: "Before" })
    const active = markCanvasNodeGenerationRunRunning(
      startCanvasNodeGenerationRun(
        createCanvasDocument({ id: "canvas-one", nodes: [owner], title: "Canvas" }),
        owner.id,
        {
          operationId: "operation-cancel-after-restart",
          prompt: "Cancel this safely",
          toolId: "creative-tools/write",
        },
      ),
      owner.id,
      "operation-cancel-after-restart",
      "task_cancel_123",
    )
    const guard = createCanvasGenerationTargetGuard(active.nodes[0]!)
    const storedInput = await inputs.create({
      files: [],
      request: {
        canvasRequest: {
          references: [],
          relationAnchorNodeIds: [],
          resultMode: replaceNodeMode(owner),
        },
        input: {},
        operationId: "operation-cancel-after-restart",
        output: "text",
        prompt: "Cancel this safely",
        references: [],
        schema: "convax.generation-lro-call/1",
        targetGuard: guard,
        toolId: "creative-tools/write",
      },
    })
    await operations.create({
      canvasId: "canvas-one",
      createdAt: 0,
      executionBindingDigest: "a".repeat(64),
      inputSnapshotId: storedInput.id,
      nodeId: owner.id,
      operationId: "operation-cancel-after-restart",
      phase: "accepted",
      pluginPackageDigest: "c".repeat(64),
      projectId: "project-one",
      requestDigest: storedInput.requestDigest,
      runtimeAuthorizationDigest: "e".repeat(64),
      schema: "convax.generation-operation-ledger/1",
      sidecarRecoveryBindingDigest: "f".repeat(64),
      targetGuardDigest: generationOperationRequestDigest(guard),
      taskId: "task_cancel_123",
      toolId: "creative-tools/write",
      updatedAt: 0,
    })
    const acknowledgements: unknown[] = []
    const recovery: PreparedGenerationRecovery = {
      async acknowledge(input) {
        acknowledgements.push(input)
      },
      bindingDigest: "f".repeat(64),
      async cancel() {
        return {
          schema: "convax.generation-lro-snapshot/1",
          status: "running",
          taskId: "task_cancel_123",
        }
      },
      executionBindingDigest: "a".repeat(64),
      async get() {
        return {
          schema: "convax.generation-lro-snapshot/1",
          status: "running",
          taskId: "task_cancel_123",
        }
      },
      pluginPackageDigest: "c".repeat(64),
      async result() {
        throw new Error("Result replay must not run during cancellation")
      },
      runtimeAuthorizationDigest: "e".repeat(64),
      async wait() {
        return {
          schema: "convax.generation-lro-snapshot/1",
          status: "cancelled",
          taskId: "task_cancel_123",
        }
      },
    }
    const harness = setup({
      document: active,
      inputSnapshots: inputs,
      operations,
      recovery,
      selectedTool: tool({
        id: "creative-tools/write",
        output: "text",
        recovery: "long-running-operation",
        toolId: "write",
      }),
    })

    await harness.service.cancel("operation-cancel-after-restart", {
      id: "desktop:renderer",
      kind: "ui",
    })
    for (let index = 0; index < 100; index += 1) {
      if ((await operations.list()).length === 0) break
      await Bun.sleep(1)
    }
    expect(await operations.list()).toEqual([])
    expect(await fs.readdir(path.join(privateRoot, "inputs"))).toEqual([])
    expect(harness.runRequests.finish).toEqual([
      expect.objectContaining({
        operationId: "operation-cancel-after-restart",
      }),
    ])
    expect(acknowledgements).toEqual([
      expect.objectContaining({
        operationId: "operation-cancel-after-restart",
        taskId: "task_cancel_123",
      }),
    ])
  })

  test("cancels and acknowledges an orphaned persisted task without reviving its deleted node", async () => {
    const privateRoot = await temporaryDirectory()
    const operations = new GenerationOperationStore(path.join(privateRoot, "operations"), { now: () => 100 })
    const inputs = new GenerationInputSnapshotStore(path.join(privateRoot, "inputs"))
    const deletedOwner = createTextNode({ id: "deleted-owner", position: { x: 0, y: 0 }, text: "Before" })
    const guarded = startCanvasNodeGenerationRun(
      createCanvasDocument({ id: "canvas-one", nodes: [deletedOwner], title: "Canvas" }),
      deletedOwner.id,
      {
        operationId: "operation-orphaned",
        prompt: "Do not revive this node",
        toolId: "creative-tools/write",
      },
    )
    const guard = createCanvasGenerationTargetGuard(guarded.nodes[0]!)
    const storedInput = await inputs.create({
      files: [],
      request: {
        canvasRequest: {
          references: [],
          relationAnchorNodeIds: [],
          resultMode: replaceNodeMode(deletedOwner),
        },
        input: {},
        operationId: "operation-orphaned",
        output: "text",
        prompt: "Do not revive this node",
        references: [],
        schema: "convax.generation-lro-call/1",
        targetGuard: guard,
        toolId: "creative-tools/write",
      },
    })
    await operations.create({
      canvasId: "canvas-one",
      createdAt: 0,
      executionBindingDigest: "a".repeat(64),
      inputSnapshotId: storedInput.id,
      nodeId: deletedOwner.id,
      operationId: "operation-orphaned",
      phase: "accepted",
      pluginPackageDigest: "c".repeat(64),
      projectId: "project-one",
      requestDigest: storedInput.requestDigest,
      runtimeAuthorizationDigest: "e".repeat(64),
      schema: "convax.generation-operation-ledger/1",
      sidecarRecoveryBindingDigest: "f".repeat(64),
      targetGuardDigest: generationOperationRequestDigest(guard),
      taskId: "task_orphaned_123",
      toolId: "creative-tools/write",
      updatedAt: 0,
    })
    let cancelCalls = 0
    const acknowledgements: unknown[] = []
    const recovery: PreparedGenerationRecovery = {
      async acknowledge(input) {
        acknowledgements.push(input)
      },
      bindingDigest: "f".repeat(64),
      async cancel() {
        cancelCalls += 1
        return {
          schema: "convax.generation-lro-snapshot/1",
          status: "running",
          taskId: "task_orphaned_123",
        }
      },
      executionBindingDigest: "a".repeat(64),
      async get() {
        throw new Error("An orphan must request cancellation before observation")
      },
      pluginPackageDigest: "c".repeat(64),
      async result() {
        throw new Error("An orphaned result must not be replayed into Canvas")
      },
      runtimeAuthorizationDigest: "e".repeat(64),
      async wait() {
        return {
          schema: "convax.generation-lro-snapshot/1",
          status: "cancelled",
          taskId: "task_orphaned_123",
        }
      },
    }
    const document = createCanvasDocument({ id: "canvas-one", title: "Canvas" })
    const harness = setup({
      document,
      inputSnapshots: inputs,
      operations,
      recovery,
      selectedTool: tool({
        id: "creative-tools/write",
        output: "text",
        recovery: "long-running-operation",
        toolId: "write",
      }),
    })

    await expect(
      harness.service.reconcileDeletedCanvas(
        { canvasId: "canvas-one", scopeId: "project-one" },
        { id: "desktop:startup", kind: "system" },
      ),
    ).resolves.toBeUndefined()
    for (let index = 0; index < 100; index += 1) {
      if ((await operations.list()).length === 0) break
      await Bun.sleep(1)
    }
    expect(await operations.list()).toEqual([])
    expect(await fs.readdir(path.join(privateRoot, "inputs"))).toEqual([])
    expect(cancelCalls).toBe(1)
    expect(acknowledgements).toHaveLength(1)
    expect(harness.calls).toEqual([])
    expect(harness.replacementRequests).toEqual([])
  })

  test("retains an indeterminate orphan ledger when its exact recovery runtime is unavailable", async () => {
    const report = spyOn(console, "warn").mockImplementation(() => undefined)
    const privateRoot = await temporaryDirectory()
    const operations = new GenerationOperationStore(path.join(privateRoot, "operations"), { now: () => 100 })
    const inputs = new GenerationInputSnapshotStore(path.join(privateRoot, "inputs"))
    const deletedOwner = createTextNode({ id: "deleted-legacy-owner", position: { x: 0, y: 0 }, text: "Before" })
    const guarded = startCanvasNodeGenerationRun(
      createCanvasDocument({ id: "canvas-one", nodes: [deletedOwner], title: "Canvas" }),
      deletedOwner.id,
      {
        operationId: "operation-orphaned-without-runtime",
        prompt: "Do not retry this orphan",
        toolId: "creative-tools/write",
      },
    )
    const guard = createCanvasGenerationTargetGuard(guarded.nodes[0]!)
    const storedInput = await inputs.create({
      files: [],
      request: {
        canvasRequest: {
          references: [],
          relationAnchorNodeIds: [],
          resultMode: replaceNodeMode(deletedOwner),
        },
        input: {},
        operationId: "operation-orphaned-without-runtime",
        output: "text",
        prompt: "Do not retry this orphan",
        references: [],
        schema: "convax.generation-lro-call/1",
        targetGuard: guard,
        toolId: "creative-tools/write",
      },
    })
    await operations.create({
      canvasId: "canvas-one",
      createdAt: 0,
      executionBindingDigest: "a".repeat(64),
      inputSnapshotId: storedInput.id,
      nodeId: deletedOwner.id,
      operationId: "operation-orphaned-without-runtime",
      phase: "accepted",
      pluginPackageDigest: "c".repeat(64),
      projectId: "project-one",
      requestDigest: storedInput.requestDigest,
      runtimeAuthorizationDigest: "e".repeat(64),
      schema: "convax.generation-operation-ledger/1",
      sidecarRecoveryBindingDigest: "f".repeat(64),
      targetGuardDigest: generationOperationRequestDigest(guard),
      taskId: "task_orphaned_without_runtime",
      toolId: "creative-tools/write",
      updatedAt: 0,
    })
    const harness = setup({
      document: createCanvasDocument({ id: "canvas-one", title: "Canvas" }),
      inputSnapshots: inputs,
      operations,
      selectedTool: tool({
        id: "creative-tools/write",
        output: "text",
        recovery: "long-running-operation",
        toolId: "write",
      }),
    })

    await harness.service.reconcileDeletedCanvas(
      { canvasId: "canvas-one", scopeId: "project-one" },
      { id: "desktop:startup", kind: "system" },
    )
    for (let index = 0; index < 100; index += 1) {
      if ((await operations.list())[0]?.phase === "indeterminate") break
      await Bun.sleep(1)
    }

    expect(await operations.list()).toEqual([
      expect.objectContaining({
        operationId: "operation-orphaned-without-runtime",
        phase: "indeterminate",
        taskId: "task_orphaned_without_runtime",
      }),
    ])
    expect(await fs.readdir(path.join(privateRoot, "inputs"))).toEqual([storedInput.id])
    expect(harness.calls).toEqual([])
    expect(harness.replacementRequests).toEqual([])
    expect(report).toHaveBeenCalledWith("Canvas generation supervise failed", {
      diagnostics: [{ message: "Generation recovery runtime binding changed", name: "Error" }],
    })
    report.mockRestore()
  })

  test("reconciliation preserves a concurrently started operation by operation identity", async () => {
    const staleOwner = createTextNode({ id: "stale-owner", position: { x: 0, y: 0 }, text: "Before restart" })
    const liveOwner = createTextNode({ id: "live-owner", position: { x: 320, y: 0 }, text: "New request" })
    let currentDocument = startCanvasNodeGenerationRun(
      createCanvasDocument({ id: "canvas-one", nodes: [staleOwner, liveOwner], title: "Canvas" }),
      staleOwner.id,
      {
        operationId: "operation-before-restart",
        prompt: "Do not submit again",
        toolId: "creative-tools/write",
      },
    )
    let releasePreparation!: () => void
    const preparationRelease = new Promise<void>((resolve) => {
      releasePreparation = resolve
    })
    let reportPrepared!: () => void
    const prepared = new Promise<void>((resolve) => {
      reportPrepared = resolve
    })
    const controller = new AbortController()
    let liveGeneration: Promise<unknown> | undefined
    let service!: GenerationCanvasService
    const configured = setup({
      document: currentDocument,
      loadDocument: () => ({ document: currentDocument }),
      async prepareTool() {
        reportPrepared()
        await preparationRelease
      },
      run: {
        async start(input) {
          currentDocument = startCanvasNodeGenerationRun(currentDocument, input.nodeId, {
            operationId: input.operationId,
            prompt: input.prompt,
            toolId: input.toolId,
          })
          return persistedCommandResult(currentDocument, [], [input.nodeId])
        },
        async interruptInactive(input) {
          expect(input.liveRuns).toEqual([])
          liveGeneration = service.generate(
            request({
              operationId: "operation-after-restart",
              prompt: "Keep this request live",
              resultMode: replaceNodeMode(liveOwner),
              toolId: "creative-tools/write",
            }),
            { id: "desktop:renderer", kind: "ui" },
            controller.signal,
          )
          await prepared
          currentDocument = interruptInactiveCanvasNodeGenerationRuns(currentDocument, [
            { nodeId: liveOwner.id, operationId: "operation-after-restart" },
          ])
          return persistedCommandResult(currentDocument, [], [staleOwner.id])
        },
      },
    })
    service = configured.service

    await expect(
      service.reconcileCanvas(
        { canvasId: "canvas-one", scopeId: "project-one" },
        { id: "desktop:renderer", kind: "ui" },
      ),
    ).resolves.toMatchObject({
      failedNodeIds: [staleOwner.id],
      operationReceipt: canvasOperationReceipt("generation-test-persisted-command"),
      projection: expect.objectContaining({ id: "canvas-one" }),
    })
    expect(getCanvasNodeGenerationRun(currentDocument.nodes.find((node) => node.id === staleOwner.id)!)).toMatchObject({
      status: "failed",
    })
    expect(getCanvasNodeGenerationRun(currentDocument.nodes.find((node) => node.id === liveOwner.id)!)).toMatchObject({
      operationId: "operation-after-restart",
      status: "submitting",
    })

    controller.abort("Test cleanup")
    releasePreparation()
    await expect(liveGeneration!).rejects.toMatchObject({ name: "AbortError" })
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
        resultMode: replaceNodeMode(owner),
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

  test("allows unrelated Canvas edits but rejects replacement-owner content edits during a long generation", async () => {
    const owner = createTextNode({ id: "owner-card", position: { x: 20, y: 40 }, text: "Original" })
    let currentDocument = createCanvasDocument({ id: "canvas-one", nodes: [owner], title: "Canvas" })
    const unrelated = setup({
      document: currentDocument,
      loadDocument: () => ({ document: currentDocument }),
      async result() {
        currentDocument = {
          ...currentDocument,
          nodes: [owner, createTextNode({ id: "unrelated", position: { x: 500, y: 0 }, text: "Concurrent edit" })],
        }
        return { content: [{ text: "Generated", type: "text" }] }
      },
    })
    unrelated.renderer.getViewSnapshot = mock(async () => ({
      documentId: currentDocument.id,
      scopeId: "project-one",
      selectedEdgeIds: [],
      selectedNodeIds: [],
      viewId: "desktop-main",
      viewport: { x: 0, y: 0, zoom: 1 },
    }))

    await expect(
      unrelated.service.generate(request({ resultMode: replaceNodeMode(owner) }), {
        id: "renderer:1",
        kind: "ui",
      }),
    ).resolves.toMatchObject({ createdNodeIds: [] })
    expect(unrelated.replacementRequests).toHaveLength(1)

    const editedOwner = {
      ...owner,
      data: {
        ...owner.data,
        resourceState: {
          status: "ready" as const,
          text: "User edited this card",
        },
      },
    }
    currentDocument = createCanvasDocument({ id: "canvas-one", nodes: [owner], title: "Canvas" })
    const changed = setup({
      document: currentDocument,
      loadDocument: () => ({ document: currentDocument }),
      async result() {
        currentDocument = { ...currentDocument, nodes: [editedOwner] }
        return { content: [{ text: "Must not land", type: "text" }] }
      },
    })
    changed.renderer.getViewSnapshot = unrelated.renderer.getViewSnapshot

    await expect(
      changed.service.generate(request({ operationId: "changed-owner", resultMode: replaceNodeMode(owner) }), {
        id: "renderer:1",
        kind: "ui",
      }),
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
      service.generate(request({ resultMode: replaceNodeModeFor(document, nodeId) }), { id: "renderer:1", kind: "ui" }),
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
    ).rejects.toThrow("operation id was reused with a different request")
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
    const reason = new DOMException("caller stopped waiting", "AbortError")
    expect(() => replayController.abort(reason)).not.toThrow()

    await expect(replay).rejects.toMatchObject({ message: "caller stopped waiting", name: "AbortError" })
    release()
    await expect(first).resolves.toMatchObject({ createdNodeIds: ["generated-one"] })
    expect(calls).toHaveLength(1)
  })

  test("detaches the first caller after acceptance without canceling Main's generation", async () => {
    let markStarted!: () => void
    let release!: () => void
    let operationSignal: AbortSignal | undefined
    const started = new Promise<void>((resolve) => {
      markStarted = resolve
    })
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const { calls, service } = setup({
      async result(_input, signal) {
        operationSignal = signal
        markStarted()
        await gate
        return { content: [{ text: "Detached result", type: "text" }] }
      },
    })
    const actor = { id: "renderer:1", kind: "ui" as const }
    const caller = new AbortController()
    const firstWaiter = service.generate(request(), actor, caller.signal)
    await started
    caller.abort("renderer switched Canvas")

    await expect(firstWaiter).rejects.toMatchObject({ name: "AbortError" })
    expect(operationSignal?.aborted).toBeFalse()

    release()
    await expect(service.generate(request(), actor)).resolves.toMatchObject({
      createdNodeIds: ["generated-one"],
    })
    expect(calls).toHaveLength(1)
  })

  test("rejects a reused operation id with a different generation payload", async () => {
    const { calls, service } = setup({})
    const actor = { id: "renderer:1", kind: "ui" as const }
    await service.generate(request(), actor)

    await expect(service.generate(request({ prompt: "A different paid request" }), actor)).rejects.toThrow(
      "reused with a different request",
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
      relation: { anchorNodeIds: [owner.id], direction: "from-anchor", mode: "connect" },
      sources: [{ kind: "host-file", path: "Generated/generated-1.png" }],
    })
  })

  test("stages a pathless canonical Canvas video through the current Project resource projection", async () => {
    const root = await temporaryDirectory()
    const mediaDirectory = path.join(root, "Media")
    const sourcePath = path.join(mediaDirectory, "source.mp4")
    const video = Buffer.from([0, 0, 0, 16, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d])
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])
    await fs.mkdir(mediaDirectory)
    await fs.writeFile(sourcePath, video)
    const fixture = canonicalVideoResource(video)
    const source = createMediaNode({
      id: "canonical-video",
      position: { x: 0, y: 0 },
      resource: {
        id: "canonical-video-resource",
        kind: "video",
        metadata: { [canvasProjectionResourceMetadataKey]: fixture.resource },
        mimeType: "video/mp4",
        name: "source.mp4",
        state: { status: "stale" },
      },
    })
    const document = createCanvasDocument({ id: "canvas-one", nodes: [source], title: "Canvas" })
    const queriedProjects: string[] = []
    let stagedPath = ""
    const { calls, service } = setup({
      currentResources: {
        async queryCurrentResources({ projectId }) {
          queriedProjects.push(projectId)
          return [
            {
              materializedPath: "Media/source.mp4",
              reference: fixture.reference,
              storageClass: "project-file",
            },
          ]
        },
      },
      document,
      project: {
        async readFileInfo(input) {
          return { mimeType: "video/mp4", name: "source.mp4", path: input.path, size: video.byteLength }
        },
        async resolveEntryPath(input) {
          expect(input).toEqual({ path: "Media/source.mp4", projectId: fixture.projectId })
          return sourcePath
        },
      },
      async result(input) {
        stagedPath = (input.references as Array<{ path: string }>)[0]!.path
        expect(stagedPath).not.toBe(sourcePath)
        expect(await fs.readFile(stagedPath)).toEqual(video)
        return { content: [{ data: png.toString("base64"), mimeType: "image/png", type: "image" }] }
      },
      selectedTool: tool({
        acceptedInputs: ["reference_video"],
        id: "media-tools/transform",
        output: "image",
        toolId: "transform",
      }),
    })

    await service.generate(
      request({
        output: "image",
        references: [{ nodeId: source.id, role: "reference_video" }],
        toolId: "media-tools/transform",
      }),
      { id: "renderer:1", kind: "ui" },
    )

    expect(queriedProjects).toEqual([fixture.projectId])
    expect(calls).toHaveLength(1)
    await expect(fs.stat(stagedPath)).rejects.toThrow()
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

  test("stages multiply-linked project-file media through the Project containment port", async () => {
    const root = await temporaryDirectory()
    const mediaDirectory = path.join(root, "Media")
    const referencePath = path.join(mediaDirectory, "reference.png")
    const publicationStagingDirectory = path.join(root, ".convax", "staging")
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])
    await fs.mkdir(mediaDirectory)
    await fs.mkdir(publicationStagingDirectory, { recursive: true })
    await fs.writeFile(referencePath, png)
    await fs.link(referencePath, path.join(publicationStagingDirectory, "retained-publication-alias"))
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

  test("allows an unrelated Canvas edit after staging while preserving the exact reference guard", async () => {
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
          document.nodes.push(createTextNode({ id: "unrelated", position: { x: 500, y: 0 }, text: "Concurrent edit" }))
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
      scopeId: "project-one",
      selectedEdgeIds: [],
      selectedNodeIds: [],
      viewId: "desktop-main",
      viewport: { x: 0, y: 0, zoom: 1 },
    }))

    const generated = await service.generate(
      request({ references: [{ nodeId: image.id, role: "reference_image" }], toolId: "creative-tools/draw" }),
      { id: "renderer:1", kind: "ui" },
    )
    expect(generated).toMatchObject({
      operationReceipt: canvasOperationReceipt("generation-test-command"),
      toolId: "creative-tools/draw",
    })
    expect(calls).toHaveLength(1)
  })

  test.each([
    ["Toolbar", { id: "renderer:1", kind: "ui" as const }],
    ["Agent", { id: "opencode:project-one", kind: "agent" as const }],
  ])("rechecks the exact %s source-node snapshot before starting a paid tool", async (_caller, actor) => {
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
      scopeId: "project-one",
      selectedEdgeIds: [],
      selectedNodeIds: [],
      viewId: "desktop-main",
      viewport: { x: 0, y: 0, zoom: 1 },
    }))

    await expect(service.generate(request(), { id: "renderer:1", kind: "ui" })).resolves.toMatchObject({
      operationReceipt: canvasOperationReceipt("generation-test-command"),
    })
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
    await fs.writeFile(path.join(root, "References", "brief.md"), "Changed while generation was running", "utf8")
    renderer.getViewSnapshot = mock(async () => ({
      documentId: "canvas-one",
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

  test("does not replay a referenced generation commit after the admitted command rejects", async () => {
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
          throw new Error("candidate semantic guard rejected")
        },
      },
      selectedTool: tool({ acceptedInputs: ["text"] }),
    })
    const generationRequest = request({ references: [{ nodeId: reference.id, role: "text" }] })
    const actor = { id: "renderer:1", kind: "ui" as const }

    await expect(service.generate(generationRequest, actor)).rejects.toMatchObject({
      name: "GenerationPublicationPartialSuccessError",
    })
    await expect(service.generate(generationRequest, actor)).rejects.toMatchObject({
      name: "GenerationPublicationPartialSuccessError",
    })
    expect(calls).toHaveLength(1)
    expect(commitAttempts).toBe(1)
  })

  test("reports partial success when cancellation arrives after Generated publication", async () => {
    const root = await temporaryDirectory()
    await writeProjectTextReferences(root, { brief: "Stable brief" })
    const reference = createTextNode({ id: "brief", position: { x: 0, y: 0 }, text: "Stable brief" })
    const document = createCanvasDocument({ id: "canvas-one", nodes: [reference], title: "Canvas" })
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])
    const actor = { id: "renderer:1", kind: "ui" as const }
    let service!: GenerationCanvasService
    const configured = setup({
      document,
      project: projectPortFor(root),
      publisher: {
        async publishGenerated(input) {
          await service.cancel("operation-one", actor)
          return { path: `Generated/generated-1${input.extension}` }
        },
      },
      result: { content: [{ data: png.toString("base64"), mimeType: "image/png", type: "image" }] },
      selectedTool: tool({ acceptedInputs: ["text"], id: "creative-tools/draw", output: "image", toolId: "draw" }),
    })
    service = configured.service

    await expect(
      service.generate(
        request({ references: [{ nodeId: reference.id, role: "text" }], toolId: "creative-tools/draw" }),
        actor,
      ),
    ).rejects.toMatchObject({
      name: "GenerationPublicationPartialSuccessError",
      publishedPaths: ["Generated/generated-1.png"],
    })
    expect(configured.resourceRequests).toHaveLength(0)
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

  test.each(["edge", "source", "unrelated"] as const)(
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
          } else {
            document.nodes.push(
              createTextNode({ id: "unrelated", position: { x: 640, y: 0 }, text: "Concurrent unrelated edit" }),
            )
          }
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
      if (change === "unrelated") {
        await expect(generation).resolves.toMatchObject({
          operationReceipt: canvasOperationReceipt("generation-test-command"),
        })
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
    const actor = { id: "renderer:1", kind: "ui" as const }
    const result = service.generate(request(), actor)
    await started
    await service.cancel("operation-one", actor)

    await expect(result).rejects.toThrow("explicitly canceled")
    expect(receivedSignal?.aborted).toBeTrue()
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
