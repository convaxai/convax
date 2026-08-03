import type { AgentToolDefinition, AgentToolProvider, AgentToolScope } from "@convax/agent-runtime"
import {
  CanvasResourcePartialFailureError,
  type CanvasAddResourceSourcesRequest,
  type CanvasAutoLayoutOptions,
  type CanvasApplicationCommandResult,
  type CanvasApplicationService,
  type CanvasDocumentRef,
  type CanvasPrimitiveCommand,
  type CanvasResourceBusinessService,
  type CanvasResourceSource,
} from "@convax/canvas/application"
import type { CanvasPoint } from "@convax/canvas/core"
import {
  CANVAS_VIEW_MAX_ZOOM,
  CANVAS_VIEW_MIN_ZOOM,
  type CanvasViewCommand,
  type CanvasViewCommandRequest,
} from "@convax/canvas/view"
import {
  requireProjectResourceReference,
  type ProjectCanvasCatalogProjectionV2,
} from "@convax/project/canvas"
import type { CanvasRendererBridge } from "./canvas-renderer-bridge"

type CanvasApplicationPort = Pick<CanvasApplicationService, "execute" | "query">
type CanvasResourcePort = Pick<CanvasResourceBusinessService, "addResources">
interface ProjectCanvasPort {
  getCanvasCatalog(input: { readonly projectId: string }): Promise<ProjectCanvasCatalogProjectionV2>
}

function commandSchema(type: string, properties: Record<string, unknown>, required: readonly string[] = []) {
  return {
    additionalProperties: false,
    properties: { type: { const: type }, ...properties },
    required: ["type", ...required],
    type: "object",
  }
}

const nonEmptyStringSchema = { minLength: 1, type: "string" }
const stringArraySchema = { items: nonEmptyStringSchema, type: "array" }
const pointSchema = {
  additionalProperties: false,
  properties: { x: { type: "number" }, y: { type: "number" } },
  required: ["x", "y"],
  type: "object",
}
const animationSchema = { enum: ["instant", "smooth"], type: "string" }
const resourceSourceSchema = {
  oneOf: [
    {
      additionalProperties: false,
      properties: {
        kind: { const: "new-text" },
        name: { type: "string" },
        sourceId: nonEmptyStringSchema,
        text: { type: "string" },
      },
      required: ["kind", "sourceId", "text"],
      type: "object",
    },
    {
      additionalProperties: false,
      properties: {
        kind: { const: "host-file" },
        path: nonEmptyStringSchema,
        sourceId: nonEmptyStringSchema,
      },
      required: ["kind", "path", "sourceId"],
      type: "object",
    },
    {
      additionalProperties: false,
      properties: {
        kind: { const: "host-directory" },
        path: nonEmptyStringSchema,
        sourceId: nonEmptyStringSchema,
      },
      required: ["kind", "path", "sourceId"],
      type: "object",
    },
  ],
}
const primitiveCommandSchema = {
  oneOf: [
    commandSchema("elements.remove", {
      edgeIds: stringArraySchema,
      nodeIds: stringArraySchema,
    }),
    commandSchema(
      "nodes.move",
      {
        delta: pointSchema,
        nodeIds: stringArraySchema,
      },
      ["delta", "nodeIds"],
    ),
    commandSchema(
      "nodes.connect",
      {
        connection: {
          additionalProperties: false,
          description:
            "A directed connection from the source card's right-side output to the target card's left-side input.",
          properties: {
            label: { type: "string" },
            source: {
              description: "Node whose right-side output emits this connection.",
              ...nonEmptyStringSchema,
            },
            target: {
              description: "Node whose left-side input receives this connection.",
              ...nonEmptyStringSchema,
            },
          },
          required: ["source", "target"],
          type: "object",
        },
      },
      ["connection"],
    ),
    commandSchema("nodes.group", { label: { type: "string" }, nodeIds: stringArraySchema }, ["nodeIds"]),
    commandSchema("nodes.ungroup", { nodeId: nonEmptyStringSchema }, ["nodeId"]),
    commandSchema(
      "nodes.layout",
      {
        gap: { minimum: 0, type: "number" },
        layout: { enum: ["grid", "horizontal", "vertical"], type: "string" },
        nodeIds: stringArraySchema,
      },
      ["nodeIds"],
    ),
    commandSchema(
      "nodes.align",
      {
        direction: { enum: ["left", "center", "right", "top", "middle", "bottom"], type: "string" },
        nodeIds: stringArraySchema,
      },
      ["direction", "nodeIds"],
    ),
    commandSchema(
      "nodes.distribute",
      {
        axis: { enum: ["horizontal", "vertical"], type: "string" },
        nodeIds: stringArraySchema,
      },
      ["axis", "nodeIds"],
    ),
  ],
}
const viewCommandSchema = {
  oneOf: [
    commandSchema(
      "nodes.reveal",
      {
        animation: animationSchema,
        fit: { enum: ["center", "contain", "none"], type: "string" },
        nodeIds: stringArraySchema,
        select: { type: "boolean" },
      },
      ["nodeIds"],
    ),
    commandSchema("selection.clear", {}),
    commandSchema("selection.set", { edgeIds: stringArraySchema, nodeIds: stringArraySchema }),
    commandSchema("viewport.fit", {
      animation: animationSchema,
      maxZoom: { maximum: CANVAS_VIEW_MAX_ZOOM, minimum: CANVAS_VIEW_MIN_ZOOM, type: "number" },
      nodeIds: stringArraySchema,
      padding: { minimum: 0, type: "number" },
    }),
    commandSchema(
      "viewport.center",
      {
        animation: animationSchema,
        position: pointSchema,
        zoom: { maximum: CANVAS_VIEW_MAX_ZOOM, minimum: CANVAS_VIEW_MIN_ZOOM, type: "number" },
      },
      ["position"],
    ),
    commandSchema(
      "viewport.zoom",
      {
        animation: animationSchema,
        zoom: { maximum: CANVAS_VIEW_MAX_ZOOM, minimum: CANVAS_VIEW_MIN_ZOOM, type: "number" },
      },
      ["zoom"],
    ),
    commandSchema(
      "notification.show",
      {
        description: { type: "string" },
        kind: { enum: ["error", "info", "success", "warning"], type: "string" },
        title: nonEmptyStringSchema,
      },
      ["kind", "title"],
    ),
  ],
}
const canvasFields = {
  canvasId: { description: "Canvas id returned by canvas_list for the current Project", minLength: 1, type: "string" },
}

const tools = [
  {
    name: "canvas_list",
    description: "List the Canvases in the host-scoped current Project. This tool cannot switch Projects.",
    inputSchema: {
      additionalProperties: false,
      properties: {},
      type: "object",
    },
  },
  {
    name: "canvas_query_nodes",
    description:
      "Query serializable Canvas node summaries before deciding what to change or reveal. incomingNodeIds are direct inputs from source/right-output edges; outgoingNodeIds are outputs to target/left-input edges.",
    inputSchema: {
      additionalProperties: false,
      properties: {
        canvasId: canvasFields.canvasId,
        kind: { type: "string" },
        limit: { maximum: 500, minimum: 1, type: "integer" },
        nodeIds: { items: { type: "string" }, type: "array" },
        relatedToNodeId: {
          description: "Direction-agnostic neighbor filter; inspect incomingNodeIds to identify inputs.",
          type: "string",
        },
        text: { type: "string" },
      },
      required: ["canvasId"],
      type: "object",
    },
  },
  {
    name: "canvas_auto_layout",
    description:
      "Apply the Canvas business auto-layout to the whole document or a selected node set. Directed layouts arrange unrelated cards on a deterministic shelf; component packing preserves the current mental map.",
    inputSchema: {
      additionalProperties: false,
      properties: {
        canvasId: canvasFields.canvasId,
        commandId: { minLength: 1, type: "string" },
        nodeIds: stringArraySchema,
        options: {
          additionalProperties: false,
          properties: {
            componentGap: { minimum: 0, type: "number" },
            componentPackingScale: { exclusiveMinimum: 0, maximum: 1, type: "number" },
            crossGap: { minimum: 0, type: "number" },
            isolatedPlacement: { enum: ["left", "preserve"], type: "string" },
            mainGap: { minimum: 0, type: "number" },
            nodeGap: { minimum: 0, type: "number" },
            nodePackingScale: { exclusiveMinimum: 0, maximum: 1, type: "number" },
            strategy: {
              enum: ["component-packing", "horizontal-directed-cluster", "vertical-directed-cluster"],
              type: "string",
            },
          },
          type: "object",
        },
      },
      required: ["canvasId", "commandId"],
      type: "object",
    },
  },
  {
    name: "canvas_add_resources",
    description:
      "Preferred business tool for publishing new Markdown text or adding trusted Project files and directories. It prepares resources, sizes and places cards, applies relations, saves atomically, and refreshes the live editor.",
    inputSchema: {
      additionalProperties: false,
      properties: {
        anchor: {
          ...pointSchema,
        },
        canvasId: canvasFields.canvasId,
        commandId: { minLength: 1, type: "string" },
        relation: {
          additionalProperties: false,
          properties: {
            anchorNodeIds: stringArraySchema,
            direction: { enum: ["from-anchor", "to-anchor"], type: "string" },
            mode: { enum: ["connect", "none"], type: "string" },
          },
          required: ["anchorNodeIds", "mode"],
          type: "object",
        },
        sources: {
          description: "Sources with a stable sourceId and kind new-text, host-file, or host-directory.",
          items: resourceSourceSchema,
          minItems: 1,
          type: "array",
        },
        view: {
          description: "Optional reveal/select/fit behavior after the editor reloads.",
          additionalProperties: false,
          properties: {
            animation: animationSchema,
            fit: { enum: ["center", "contain", "none"], type: "string" },
            select: { type: "boolean" },
            viewId: nonEmptyStringSchema,
          },
          type: "object",
        },
      },
      required: ["anchor", "canvasId", "commandId", "sources"],
      type: "object",
    },
  },
  {
    name: "canvas_apply_primitive",
    description:
      "Advanced low-level Canvas mutations: remove, move, connect, group, ungroup, layout, align, or distribute. Prefer business tools when one matches the task.",
    inputSchema: {
      additionalProperties: false,
      properties: {
        canvasId: canvasFields.canvasId,
        command: {
          description:
            "A Canvas primitive command with type elements.remove or nodes.move/connect/group/ungroup/layout/align/distribute.",
          ...primitiveCommandSchema,
        },
        commandId: { minLength: 1, type: "string" },
      },
      required: ["canvasId", "command", "commandId"],
      type: "object",
    },
  },
  {
    name: "canvas_view",
    description:
      "Control a live Canvas view: reveal/select nodes, fit/center/zoom the viewport, clear selection, or show a notification. UI actions are valid Agent capabilities.",
    inputSchema: {
      additionalProperties: false,
      properties: {
        canvasId: canvasFields.canvasId,
        command: {
          description: "A nodes.reveal, selection.set/clear, viewport.fit/center/zoom, or notification.show command.",
          ...viewCommandSchema,
        },
        viewId: { default: "desktop-main", type: "string" },
      },
      required: ["canvasId", "command"],
      type: "object",
    },
  },
] as const satisfies readonly AgentToolDefinition[]

export function createCanvasAgentToolProvider(input: {
  application: CanvasApplicationPort
  canvases: ProjectCanvasPort
  renderer: CanvasRendererBridge
  resources: CanvasResourcePort
}): AgentToolProvider {
  return {
    async callTool(scope, name, value, context) {
      const signal = context?.signal
      throwIfAborted(signal)
      if (name === "canvas_list") return listCanvases(input.canvases, scope, value, signal)
      if (name === "canvas_query_nodes") return queryNodes(input.application, input.canvases, scope, value, signal)
      if (name === "canvas_add_resources")
        return addResources(input.canvases, input.resources, input.renderer, scope, value, signal)
      if (name === "canvas_auto_layout")
        return autoLayout(input.application, input.canvases, input.renderer, scope, value, signal)
      if (name === "canvas_apply_primitive")
        return applyPrimitive(input.application, input.canvases, input.renderer, scope, value, signal)
      if (name === "canvas_view") return executeView(input.canvases, input.renderer, scope, value, signal)
      throw new Error(`Unknown Canvas tool: ${name}`)
    },
    listTools: () => tools,
  }
}

async function listCanvases(
  canvases: ProjectCanvasPort,
  scope: AgentToolScope,
  value: Record<string, unknown>,
  signal?: AbortSignal,
) {
  const request = record(value, "canvas_list input")
  if (Object.keys(request).length > 0) throw new Error("canvas_list does not accept Project selection arguments")
  const catalog = await loadProjectCanvasCatalog(canvases, scope, signal)
  return {
    canvases: catalog.visibleCanvases.map((canvas) => ({ id: canvas.canvasId, name: canvas.title })),
    projectId: scope.scopeId,
  }
}

async function queryNodes(
  application: CanvasApplicationPort,
  canvases: ProjectCanvasPort,
  scope: AgentToolScope,
  input: Record<string, unknown>,
  signal?: AbortSignal,
) {
  const canvasId = requiredString(input.canvasId, "canvasId")
  const kind = optionalString(input.kind, "kind")
  const relatedToNodeId = optionalString(input.relatedToNodeId, "relatedToNodeId")
  const query = {
    ids: optionalStringArray(input.nodeIds, "nodeIds"),
    kinds: kind ? [kind] : undefined,
    limit: optionalInteger(input.limit, "limit", 1, 500),
    relatedToNodeIds: relatedToNodeId ? [relatedToNodeId] : undefined,
    text: optionalString(input.text, "text"),
  }
  const documentRef = ref(scope, canvasId)
  await assertCanvasExists(canvases, scope, canvasId, signal)
  throwIfAborted(signal)
  const result = await application.query(documentRef, { ...query })
  throwIfAborted(signal)
  return result
}

async function addResources(
  canvases: ProjectCanvasPort,
  resources: CanvasResourcePort,
  renderer: CanvasRendererBridge,
  scope: AgentToolScope,
  input: Record<string, unknown>,
  signal?: AbortSignal,
) {
  const canvasId = requiredString(input.canvasId, "canvasId")
  const reveal = resourceRevealOptions(input.view)
  const request: CanvasAddResourceSourcesRequest = {
    actor: actor(scope),
    anchor: point(input.anchor, "anchor"),
    canvasId,
    commandId: requiredString(input.commandId, "commandId"),
    scopeId: scope.scopeId,
    relation: relation(input.relation),
    ...(signal ? { signal } : {}),
    sources: resourceSources(input.sources),
  }
  const documentRef = ref(scope, canvasId)
  await assertCanvasExists(canvases, scope, canvasId, signal)
  throwIfAborted(signal)
  let result
  try {
    result = await resources.addResources(request)
  } catch (error) {
    throw canvasAgentResourceError(error)
  }
  const sync = await documentMutationSync(renderer, documentRef)
  const warnings = [...result.warnings]
  let view
  if (sync.reloaded && reveal) {
    try {
      view = await renderer.executeView({
        command: {
          animation: reveal.animation,
          fit: reveal.fit,
          nodeIds: result.createdNodeIds,
          select: reveal.select,
          type: "nodes.reveal",
        },
        expectedDocumentId: canvasId,
        expectedScopeId: scope.scopeId,
        viewId: reveal.viewId,
      })
    } catch {
      warnings.push("Canvas resources were saved, but the live view could not be updated.")
    }
  }
  return { ...mutationSummary(result), sync, view, warnings }
}

async function autoLayout(
  application: CanvasApplicationPort,
  canvases: ProjectCanvasPort,
  renderer: CanvasRendererBridge,
  scope: AgentToolScope,
  input: Record<string, unknown>,
  signal?: AbortSignal,
) {
  const canvasId = requiredString(input.canvasId, "canvasId")
  const documentRef = ref(scope, canvasId)
  const request = {
    canvasId,
    envelope: {
      actor: actor(scope),
      command: {
        type: "canvas.auto-layout" as const,
        nodeIds: optionalStringArray(input.nodeIds, "nodeIds"),
        options: autoLayoutOptions(input.options),
      },
      commandId: requiredString(input.commandId, "commandId"),
    },
    ...(signal ? { signal } : {}),
    scopeId: scope.scopeId,
  }
  await assertCanvasExists(canvases, scope, canvasId, signal)
  throwIfAborted(signal)
  const result = await application.execute(request)
  return {
    ...mutationSummary(result),
    sync: result.changed ? await documentMutationSync(renderer, documentRef) : undefined,
  }
}

function resourceRevealOptions(value: unknown) {
  if (value === undefined) return undefined
  const input = record(value, "view")
  return {
    animation: optionalEnum(input.animation, "view.animation", ["instant", "smooth"] as const),
    fit: optionalEnum(input.fit, "view.fit", ["center", "contain", "none"] as const),
    select: optionalBoolean(input.select, "view.select") ?? true,
    viewId: optionalString(input.viewId, "view.viewId") ?? "desktop-main",
  }
}

async function applyPrimitive(
  application: CanvasApplicationPort,
  canvases: ProjectCanvasPort,
  renderer: CanvasRendererBridge,
  scope: AgentToolScope,
  input: Record<string, unknown>,
  signal?: AbortSignal,
) {
  const canvasId = requiredString(input.canvasId, "canvasId")
  const request = {
    canvasId,
    envelope: {
      actor: actor(scope),
      command: primitive(input.command),
      commandId: requiredString(input.commandId, "commandId"),
    },
    ...(signal ? { signal } : {}),
    scopeId: scope.scopeId,
  }
  const documentRef = ref(scope, canvasId)
  await assertCanvasExists(canvases, scope, canvasId, signal)
  throwIfAborted(signal)
  const result = await application.execute(request)
  return {
    ...mutationSummary(result),
    sync: result.changed ? await documentMutationSync(renderer, documentRef) : undefined,
  }
}

async function executeView(
  canvases: ProjectCanvasPort,
  renderer: CanvasRendererBridge,
  scope: AgentToolScope,
  input: Record<string, unknown>,
  signal?: AbortSignal,
) {
  const canvasId = requiredString(input.canvasId, "canvasId")
  const request: CanvasViewCommandRequest = {
    command: viewCommand(input.command),
    expectedDocumentId: canvasId,
    expectedScopeId: scope.scopeId,
    viewId: optionalString(input.viewId, "viewId") ?? "desktop-main",
  }
  await assertCanvasExists(canvases, scope, canvasId, signal)
  await assertLiveActiveCanvas(renderer, scope, canvasId, signal)
  throwIfAborted(signal)
  return renderer.executeView(request)
}

async function assertCanvasExists(
  canvases: ProjectCanvasPort,
  scope: AgentToolScope,
  canvasId: string,
  signal?: AbortSignal,
) {
  const catalog = await loadProjectCanvasCatalog(canvases, scope, signal)
  if (!catalog.visibleCanvases.some((canvas) => canvas.canvasId === canvasId)) {
    throw new Error("canvasId is not present in the current Agent Project catalog")
  }
}

async function loadProjectCanvasCatalog(canvases: ProjectCanvasPort, scope: AgentToolScope, signal?: AbortSignal) {
  throwIfAborted(signal)
  const catalog = await canvases.getCanvasCatalog({ projectId: scope.scopeId })
  throwIfAborted(signal)
  if (catalog.projectId !== scope.scopeId) {
    throw new Error("The Canvas catalog is outside the Agent Project scope")
  }
  return catalog
}

async function assertLiveActiveCanvas(
  renderer: CanvasRendererBridge,
  scope: AgentToolScope,
  canvasId: string,
  signal?: AbortSignal,
) {
  throwIfAborted(signal)
  const snapshot = await renderer.getViewSnapshot("desktop-main")
  throwIfAborted(signal)
  if (!snapshot) throw new Error("No live active Canvas is available")
  if (snapshot.scopeId !== scope.scopeId) {
    throw new Error("The live active Canvas is outside the Agent Project scope")
  }
  if (snapshot.documentId !== canvasId) {
    throw new Error("canvasId must match the live active Canvas")
  }
}

function primitive(value: unknown): CanvasPrimitiveCommand {
  const input = record(value, "command")
  const type = requiredString(input.type, "command.type")
  if (type === "elements.remove")
    return {
      type,
      edgeIds: optionalStringArray(input.edgeIds, "command.edgeIds"),
      nodeIds: optionalStringArray(input.nodeIds, "command.nodeIds"),
    }
  if (type === "nodes.move")
    return { type, delta: point(input.delta, "command.delta"), nodeIds: stringArray(input.nodeIds, "command.nodeIds") }
  if (type === "nodes.connect") {
    const connection = record(input.connection, "command.connection")
    return {
      type,
      connection: {
        label: optionalString(connection.label, "command.connection.label"),
        source: requiredString(connection.source, "command.connection.source"),
        target: requiredString(connection.target, "command.connection.target"),
      },
    }
  }
  if (type === "nodes.group")
    return {
      type,
      label: optionalString(input.label, "command.label"),
      nodeIds: stringArray(input.nodeIds, "command.nodeIds"),
    }
  if (type === "nodes.ungroup") return { type, nodeId: requiredString(input.nodeId, "command.nodeId") }
  if (type === "nodes.layout")
    return {
      type,
      gap: optionalNumber(input.gap, "command.gap", 0),
      layout: optionalEnum(input.layout, "command.layout", ["grid", "horizontal", "vertical"] as const),
      nodeIds: stringArray(input.nodeIds, "command.nodeIds"),
    }
  if (type === "nodes.align")
    return {
      type,
      direction: requiredEnum(input.direction, "command.direction", [
        "left",
        "center",
        "right",
        "top",
        "middle",
        "bottom",
      ] as const),
      nodeIds: stringArray(input.nodeIds, "command.nodeIds"),
    }
  if (type === "nodes.distribute")
    return {
      type,
      axis: requiredEnum(input.axis, "command.axis", ["horizontal", "vertical"] as const),
      nodeIds: stringArray(input.nodeIds, "command.nodeIds"),
    }
  throw new Error(`Unsupported Canvas primitive command: ${type}`)
}

function autoLayoutOptions(value: unknown): CanvasAutoLayoutOptions | undefined {
  if (value === undefined) return undefined
  const input = record(value, "options")
  return {
    componentGap: optionalNumber(input.componentGap, "options.componentGap", 0),
    componentPackingScale: optionalBoundedNumber(input.componentPackingScale, "options.componentPackingScale", 0, 1),
    crossGap: optionalNumber(input.crossGap, "options.crossGap", 0),
    isolatedPlacement: optionalEnum(input.isolatedPlacement, "options.isolatedPlacement", [
      "left",
      "preserve",
    ] as const),
    mainGap: optionalNumber(input.mainGap, "options.mainGap", 0),
    nodeGap: optionalNumber(input.nodeGap, "options.nodeGap", 0),
    nodePackingScale: optionalBoundedNumber(input.nodePackingScale, "options.nodePackingScale", 0, 1),
    strategy: optionalEnum(input.strategy, "options.strategy", [
      "component-packing",
      "horizontal-directed-cluster",
      "vertical-directed-cluster",
    ] as const),
  }
}

function viewCommand(value: unknown): CanvasViewCommand {
  const input = record(value, "command")
  const type = requiredString(input.type, "command.type")
  if (type === "nodes.reveal")
    return {
      type,
      animation: animation(input.animation),
      fit: optionalEnum(input.fit, "command.fit", ["center", "contain", "none"] as const),
      nodeIds: stringArray(input.nodeIds, "command.nodeIds"),
      select: optionalBoolean(input.select, "command.select"),
    }
  if (type === "selection.clear") return { type }
  if (type === "selection.set")
    return {
      type,
      edgeIds: optionalStringArray(input.edgeIds, "command.edgeIds"),
      nodeIds: optionalStringArray(input.nodeIds, "command.nodeIds"),
    }
  if (type === "viewport.fit")
    return {
      type,
      animation: animation(input.animation),
      maxZoom: optionalRangedNumber(input.maxZoom, "command.maxZoom", CANVAS_VIEW_MIN_ZOOM, CANVAS_VIEW_MAX_ZOOM),
      nodeIds: optionalStringArray(input.nodeIds, "command.nodeIds"),
      padding: optionalNumber(input.padding, "command.padding", 0),
    }
  if (type === "viewport.center")
    return {
      type,
      animation: animation(input.animation),
      position: point(input.position, "command.position"),
      zoom: optionalRangedNumber(input.zoom, "command.zoom", CANVAS_VIEW_MIN_ZOOM, CANVAS_VIEW_MAX_ZOOM),
    }
  if (type === "viewport.zoom")
    return {
      type,
      animation: animation(input.animation),
      zoom: requiredRangedNumber(input.zoom, "command.zoom", CANVAS_VIEW_MIN_ZOOM, CANVAS_VIEW_MAX_ZOOM),
    }
  if (type === "notification.show")
    return {
      type,
      description: optionalString(input.description, "command.description"),
      kind: requiredEnum(input.kind, "command.kind", ["error", "info", "success", "warning"] as const),
      title: requiredString(input.title, "command.title"),
    }
  throw new Error(`Unsupported Canvas view command: ${type}`)
}

function mutationSummary(result: CanvasApplicationCommandResult) {
  return {
    affectedNodeIds: result.affectedNodeIds,
    changed: result.changed,
    createdNodeIds: result.createdNodeIds,
    operationReceipt: result.operationReceipt,
    warnings: result.warnings,
  }
}

async function documentMutationSync(renderer: CanvasRendererBridge, value: CanvasDocumentRef) {
  try {
    return { reloaded: await renderer.reloadDocument(value) }
  } catch (error) {
    return { reloaded: false, warning: error instanceof Error ? error.message : String(error) }
  }
}

function canvasAgentResourceError(error: unknown) {
  if (error instanceof CanvasResourcePartialFailureError) {
    const retainedLabels = safeRetainedNoteLabels(error)
    if (retainedLabels) {
      return new Error(`Could not add resources to the Canvas; retained Project files: ${retainedLabels.join(", ")}`)
    }
  }
  return new Error("Could not add resources to the Canvas")
}

function safeRetainedNoteLabels(error: CanvasResourcePartialFailureError): readonly string[] | null {
  try {
    return error.retainedOnFailure.map(({ label }) => {
      const reference = requireProjectResourceReference({ kind: "project-file", path: label })
      if (reference.kind !== "project-file") throw new Error("Retained resource must be a Project file")
      const components = reference.path.split("/")
      const fileName = components[1]
      if (components.length !== 2 || components[0] !== "Notes" || !fileName || !fileName.endsWith(".md")) {
        throw new Error("Retained resource must be a single-level Notes Markdown file")
      }
      if (fileName.length <= ".md".length) throw new Error("Retained Notes file name is required")
      return reference.path
    })
  } catch {
    return null
  }
}

function actor(scope: AgentToolScope) {
  return { id: `opencode:${scope.scopeId}`, kind: "agent" as const }
}

function ref(scope: AgentToolScope, canvasId: string): CanvasDocumentRef {
  return { canvasId, scopeId: scope.scopeId }
}

function resourceSources(value: unknown): CanvasResourceSource[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error("sources must be a non-empty array")
  return value.map((item, index) => {
    const label = `sources[${index}]`
    const source = record(item, label)
    const kind = requiredString(source.kind, `${label}.kind`)
    const sourceId = requiredString(source.sourceId, `${label}.sourceId`)
    if (kind === "new-text") {
      return {
        kind,
        name: optionalText(source.name, `${label}.name`),
        sourceId,
        text: text(source.text, `${label}.text`),
      }
    }
    if (kind === "host-file" || kind === "host-directory") {
      return {
        kind,
        path: trustedProjectRelativePath(source.path, `${label}.path`),
        sourceId,
      }
    }
    throw new Error(`Unsupported Canvas resource source: ${kind}`)
  })
}

function trustedProjectRelativePath(value: unknown, label: string) {
  const path = requiredString(value, label)
  if (
    path.startsWith("/") ||
    path.startsWith("\\\\") ||
    /^[a-z]:[\\/]/i.test(path) ||
    path.includes("\\") ||
    path.split("/").some((segment) => segment === "." || segment === ".." || segment.toLowerCase() === ".convax")
  ) {
    throw new Error(`${label} must be a trusted Project-relative path outside .convax`)
  }
  return path
}

function relation(value: unknown): CanvasAddResourceSourcesRequest["relation"] {
  if (value === undefined) return undefined
  const input = record(value, "relation")
  return {
    anchorNodeIds: stringArray(input.anchorNodeIds, "relation.anchorNodeIds"),
    direction: optionalEnum(input.direction, "relation.direction", ["from-anchor", "to-anchor"] as const),
    mode: requiredEnum(input.mode, "relation.mode", ["connect", "none"] as const),
  }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as Record<string, unknown>
}

function requiredString(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string`)
  return value.trim()
}

function optionalString(value: unknown, label: string) {
  return value === undefined ? undefined : requiredString(value, label)
}

function text(value: unknown, label: string) {
  if (typeof value !== "string") throw new Error(`${label} must be a string`)
  return value
}

function optionalText(value: unknown, label: string) {
  return value === undefined ? undefined : text(value, label)
}

function stringArray(value: unknown, label: string) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`)
  return value.map((item, index) => requiredString(item, `${label}[${index}]`))
}

function optionalStringArray(value: unknown, label: string) {
  return value === undefined ? undefined : stringArray(value, label)
}

function requiredNumber(value: unknown, label: string, minimum?: number) {
  if (typeof value !== "number" || !Number.isFinite(value) || (minimum !== undefined && value < minimum)) {
    throw new Error(`${label} must be a finite number${minimum === undefined ? "" : ` >= ${minimum}`}`)
  }
  return value
}

function optionalNumber(value: unknown, label: string, minimum?: number) {
  return value === undefined ? undefined : requiredNumber(value, label, minimum)
}

function requiredRangedNumber(value: unknown, label: string, minimum: number, maximum: number) {
  const number = requiredNumber(value, label)
  if (number < minimum || number > maximum) {
    throw new Error(`${label} must be between ${minimum} and ${maximum}`)
  }
  return number
}

function optionalRangedNumber(value: unknown, label: string, minimum: number, maximum: number) {
  return value === undefined ? undefined : requiredRangedNumber(value, label, minimum, maximum)
}

function optionalBoundedNumber(value: unknown, label: string, exclusiveMinimum: number, maximum: number) {
  if (value === undefined) return undefined
  const number = requiredNumber(value, label)
  if (number <= exclusiveMinimum || number > maximum) {
    throw new Error(`${label} must be greater than ${exclusiveMinimum} and at most ${maximum}`)
  }
  return number
}

function requiredInteger(value: unknown, label: string, minimum?: number, maximum?: number) {
  const number = requiredNumber(value, label, minimum)
  if (!Number.isSafeInteger(number) || (maximum !== undefined && number > maximum))
    throw new Error(`${label} must be an integer`)
  return number
}

function optionalInteger(value: unknown, label: string, minimum?: number, maximum?: number) {
  return value === undefined ? undefined : requiredInteger(value, label, minimum, maximum)
}

function point(value: unknown, label: string): CanvasPoint {
  const input = record(value, label)
  return { x: requiredNumber(input.x, `${label}.x`), y: requiredNumber(input.y, `${label}.y`) }
}

function optionalBoolean(value: unknown, label: string) {
  if (value !== undefined && typeof value !== "boolean") throw new Error(`${label} must be a boolean`)
  return value as boolean | undefined
}

function requiredEnum<const Values extends readonly string[]>(
  value: unknown,
  label: string,
  values: Values,
): Values[number] {
  const string = requiredString(value, label)
  if (!values.includes(string)) throw new Error(`${label} must be one of ${values.join(", ")}`)
  return string
}

function optionalEnum<const Values extends readonly string[]>(value: unknown, label: string, values: Values) {
  return value === undefined ? undefined : requiredEnum(value, label, values)
}

function animation(value: unknown) {
  return optionalEnum(value, "command.animation", ["instant", "smooth"] as const)
}

function throwIfAborted(signal?: AbortSignal) {
  if (!signal?.aborted) return
  throw signal.reason ?? new DOMException("Canvas Agent operation was canceled", "AbortError")
}
