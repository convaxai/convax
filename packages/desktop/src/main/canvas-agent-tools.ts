import type { AgentToolDefinition, AgentToolProvider, AgentToolScope } from "@convax/agent-runtime"
import {
  type CanvasAddResourceSourcesRequest,
  type CanvasApplicationCommandResult,
  type CanvasApplicationService,
  type CanvasDocumentRef,
  type CanvasPrimitiveCommand,
  type CanvasResourceBusinessService,
  type CanvasResourceSource,
} from "@convax/canvas/application"
import type { CanvasPoint } from "@convax/canvas/core"
import type { CanvasViewCommand, CanvasViewCommandRequest } from "@convax/canvas/view"
import type { CanvasRendererBridge } from "./canvas-renderer-bridge"

type CanvasApplicationPort = Pick<CanvasApplicationService, "execute" | "query">
type CanvasResourcePort = Pick<CanvasResourceBusinessService, "addResources">

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
        format: { enum: ["markdown", "plain"], type: "string" },
        kind: { const: "inline-text" },
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
    {
      additionalProperties: false,
      properties: {
        kind: { const: "remote-url" },
        mimeType: { type: "string" },
        name: { type: "string" },
        sourceId: nonEmptyStringSchema,
        url: nonEmptyStringSchema,
      },
      required: ["kind", "sourceId", "url"],
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
    commandSchema("nodes.move", {
      delta: pointSchema,
      nodeIds: stringArraySchema,
    }, ["delta", "nodeIds"]),
    commandSchema("nodes.connect", {
      connection: {
        additionalProperties: false,
        properties: { label: { type: "string" }, source: nonEmptyStringSchema, target: nonEmptyStringSchema },
        required: ["source", "target"],
        type: "object",
      },
    }, ["connection"]),
    commandSchema("nodes.group", { label: { type: "string" }, nodeIds: stringArraySchema }, ["nodeIds"]),
    commandSchema("nodes.ungroup", { nodeId: nonEmptyStringSchema }, ["nodeId"]),
    commandSchema("nodes.layout", {
      gap: { minimum: 0, type: "number" },
      layout: { enum: ["grid", "horizontal", "vertical"], type: "string" },
      nodeIds: stringArraySchema,
    }),
    commandSchema("nodes.align", {
      direction: { enum: ["left", "center", "right", "top", "middle", "bottom"], type: "string" },
      nodeIds: stringArraySchema,
    }, ["direction", "nodeIds"]),
    commandSchema("nodes.distribute", {
      axis: { enum: ["horizontal", "vertical"], type: "string" },
      nodeIds: stringArraySchema,
    }, ["axis", "nodeIds"]),
  ],
}
const viewCommandSchema = {
  oneOf: [
    commandSchema("nodes.reveal", {
      animation: animationSchema,
      fit: { enum: ["center", "contain", "none"], type: "string" },
      nodeIds: stringArraySchema,
      select: { type: "boolean" },
    }, ["nodeIds"]),
    commandSchema("selection.clear", {}),
    commandSchema("selection.set", { edgeIds: stringArraySchema, nodeIds: stringArraySchema }),
    commandSchema("viewport.fit", {
      animation: animationSchema,
      maxZoom: { exclusiveMinimum: 0, type: "number" },
      nodeIds: stringArraySchema,
      padding: { minimum: 0, type: "number" },
    }),
    commandSchema("viewport.center", {
      animation: animationSchema,
      position: pointSchema,
      zoom: { exclusiveMinimum: 0, type: "number" },
    }, ["position"]),
    commandSchema("viewport.zoom", {
      animation: animationSchema,
      zoom: { exclusiveMinimum: 0, type: "number" },
    }, ["zoom"]),
    commandSchema("notification.show", {
      description: { type: "string" },
      kind: { enum: ["error", "info", "success", "warning"], type: "string" },
      title: nonEmptyStringSchema,
    }, ["kind", "title"]),
  ],
}
const canvasFields = {
  canvasId: { description: "Canvas id from the active host scope", minLength: 1, type: "string" },
  expectedRevision: { description: "Revision returned by the latest Canvas query", minimum: 0, type: "integer" },
}

const tools = [
  {
    name: "canvas_query_nodes",
    description: "Query serializable Canvas node summaries before deciding what to change or reveal.",
    inputSchema: {
      additionalProperties: false,
      properties: {
        canvasId: canvasFields.canvasId,
        kind: { type: "string" },
        limit: { maximum: 500, minimum: 1, type: "integer" },
        nodeIds: { items: { type: "string" }, type: "array" },
        relatedToNodeId: { type: "string" },
        text: { type: "string" },
      },
      required: ["canvasId"],
      type: "object",
    },
  },
  {
    name: "canvas_add_resources",
    description: "Preferred business tool for adding inline text, host files or directories, images, media, or remote URLs. It prepares assets, inspects media, sizes and places cards, applies relations, saves atomically, and refreshes the live editor.",
    inputSchema: {
      additionalProperties: false,
      properties: {
        anchor: {
          ...pointSchema,
        },
        canvasId: canvasFields.canvasId,
        commandId: { minLength: 1, type: "string" },
        expectedRevision: canvasFields.expectedRevision,
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
          description: "Sources with a stable sourceId and kind inline-text, host-file, host-directory, or remote-url.",
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
      required: ["anchor", "canvasId", "commandId", "expectedRevision", "sources"],
      type: "object",
    },
  },
  {
    name: "canvas_apply_primitive",
    description: "Advanced low-level Canvas mutations: remove, move, connect, group, ungroup, layout, align, or distribute. Prefer business tools when one matches the task.",
    inputSchema: {
      additionalProperties: false,
      properties: {
        canvasId: canvasFields.canvasId,
        command: {
          description: "A Canvas primitive command with type elements.remove or nodes.move/connect/group/ungroup/layout/align/distribute.",
          ...primitiveCommandSchema,
        },
        commandId: { minLength: 1, type: "string" },
        expectedRevision: canvasFields.expectedRevision,
      },
      required: ["canvasId", "command", "commandId", "expectedRevision"],
      type: "object",
    },
  },
  {
    name: "canvas_view",
    description: "Control a live Canvas view: reveal/select nodes, fit/center/zoom the viewport, clear selection, or show a notification. UI actions are valid Agent capabilities.",
    inputSchema: {
      additionalProperties: false,
      properties: {
        canvasId: canvasFields.canvasId,
        command: {
          description: "A nodes.reveal, selection.set/clear, viewport.fit/center/zoom, or notification.show command.",
          ...viewCommandSchema,
        },
        expectedRevision: canvasFields.expectedRevision,
        viewId: { default: "desktop-main", type: "string" },
      },
      required: ["canvasId", "command", "expectedRevision"],
      type: "object",
    },
  },
] as const satisfies readonly AgentToolDefinition[]

export function createCanvasAgentToolProvider(input: {
  application: CanvasApplicationPort
  renderer: CanvasRendererBridge
  resources: CanvasResourcePort
}): AgentToolProvider {
  return {
    async callTool(scope, name, value) {
      if (name === "canvas_query_nodes") return queryNodes(input.application, scope, value)
      if (name === "canvas_add_resources") return addResources(input.resources, input.renderer, scope, value)
      if (name === "canvas_apply_primitive") return applyPrimitive(input.application, input.renderer, scope, value)
      if (name === "canvas_view") return executeView(input.renderer, scope, value)
      throw new Error(`Unknown Canvas tool: ${name}`)
    },
    listTools: () => tools,
  }
}

async function queryNodes(application: CanvasApplicationPort, scope: AgentToolScope, input: Record<string, unknown>) {
  const canvasId = requiredString(input.canvasId, "canvasId")
  const kind = optionalString(input.kind, "kind")
  const relatedToNodeId = optionalString(input.relatedToNodeId, "relatedToNodeId")
  return application.query(ref(scope, canvasId), {
    ids: optionalStringArray(input.nodeIds, "nodeIds"),
    kinds: kind ? [kind] : undefined,
    limit: optionalInteger(input.limit, "limit", 1, 500),
    relatedToNodeIds: relatedToNodeId ? [relatedToNodeId] : undefined,
    text: optionalString(input.text, "text"),
  })
}

async function addResources(
  resources: CanvasResourcePort,
  renderer: CanvasRendererBridge,
  scope: AgentToolScope,
  input: Record<string, unknown>,
) {
  const canvasId = requiredString(input.canvasId, "canvasId")
  const reveal = resourceRevealOptions(input.view)
  const request: CanvasAddResourceSourcesRequest = {
    actor: actor(scope),
    anchor: point(input.anchor, "anchor"),
    canvasId,
    commandId: requiredString(input.commandId, "commandId"),
    expectedRevision: requiredInteger(input.expectedRevision, "expectedRevision", 0),
    scopeId: scope.scopeId,
    relation: relation(input.relation),
    sources: resourceSources(input.sources),
  }
  const result = await resources.addResources(request)
  const sync = await syncRenderer(renderer, ref(scope, canvasId))
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
        expectedRevision: result.document.revision,
        expectedScopeId: scope.scopeId,
        viewId: reveal.viewId,
      })
    } catch (error) {
      warnings.push(`Canvas resources were saved, but the live view could not be updated: ${errorMessage(error)}`)
    }
  }
  return { ...mutationSummary(result), sync, view, warnings }
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
  renderer: CanvasRendererBridge,
  scope: AgentToolScope,
  input: Record<string, unknown>,
) {
  const canvasId = requiredString(input.canvasId, "canvasId")
  const result = await application.execute({
    canvasId,
    envelope: {
      actor: actor(scope),
      command: primitive(input.command),
      commandId: requiredString(input.commandId, "commandId"),
      expectedRevision: requiredInteger(input.expectedRevision, "expectedRevision", 0),
    },
    scopeId: scope.scopeId,
  })
  return { ...mutationSummary(result), sync: result.changed ? await syncRenderer(renderer, ref(scope, canvasId)) : undefined }
}

function executeView(renderer: CanvasRendererBridge, scope: AgentToolScope, input: Record<string, unknown>) {
  const request: CanvasViewCommandRequest = {
    command: viewCommand(input.command),
    expectedDocumentId: requiredString(input.canvasId, "canvasId"),
    expectedRevision: requiredInteger(input.expectedRevision, "expectedRevision", 0),
    expectedScopeId: scope.scopeId,
    viewId: optionalString(input.viewId, "viewId") ?? "desktop-main",
  }
  return renderer.executeView(request)
}

function primitive(value: unknown): CanvasPrimitiveCommand {
  const input = record(value, "command")
  const type = requiredString(input.type, "command.type")
  if (type === "elements.remove") return {
    type,
    edgeIds: optionalStringArray(input.edgeIds, "command.edgeIds"),
    nodeIds: optionalStringArray(input.nodeIds, "command.nodeIds"),
  }
  if (type === "nodes.move") return { type, delta: point(input.delta, "command.delta"), nodeIds: stringArray(input.nodeIds, "command.nodeIds") }
  if (type === "nodes.connect") {
    const connection = record(input.connection, "command.connection")
    return { type, connection: {
      label: optionalString(connection.label, "command.connection.label"),
      source: requiredString(connection.source, "command.connection.source"),
      target: requiredString(connection.target, "command.connection.target"),
    } }
  }
  if (type === "nodes.group") return { type, label: optionalString(input.label, "command.label"), nodeIds: stringArray(input.nodeIds, "command.nodeIds") }
  if (type === "nodes.ungroup") return { type, nodeId: requiredString(input.nodeId, "command.nodeId") }
  if (type === "nodes.layout") return {
    type,
    gap: optionalNumber(input.gap, "command.gap", 0),
    layout: optionalEnum(input.layout, "command.layout", ["grid", "horizontal", "vertical"] as const),
    nodeIds: optionalStringArray(input.nodeIds, "command.nodeIds"),
  }
  if (type === "nodes.align") return {
    type,
    direction: requiredEnum(input.direction, "command.direction", ["left", "center", "right", "top", "middle", "bottom"] as const),
    nodeIds: stringArray(input.nodeIds, "command.nodeIds"),
  }
  if (type === "nodes.distribute") return {
    type,
    axis: requiredEnum(input.axis, "command.axis", ["horizontal", "vertical"] as const),
    nodeIds: stringArray(input.nodeIds, "command.nodeIds"),
  }
  throw new Error(`Unsupported Canvas primitive command: ${type}`)
}

function viewCommand(value: unknown): CanvasViewCommand {
  const input = record(value, "command")
  const type = requiredString(input.type, "command.type")
  if (type === "nodes.reveal") return {
    type,
    animation: animation(input.animation),
    fit: optionalEnum(input.fit, "command.fit", ["center", "contain", "none"] as const),
    nodeIds: stringArray(input.nodeIds, "command.nodeIds"),
    select: optionalBoolean(input.select, "command.select"),
  }
  if (type === "selection.clear") return { type }
  if (type === "selection.set") return {
    type,
    edgeIds: optionalStringArray(input.edgeIds, "command.edgeIds"),
    nodeIds: optionalStringArray(input.nodeIds, "command.nodeIds"),
  }
  if (type === "viewport.fit") return {
    type,
    animation: animation(input.animation),
    maxZoom: optionalNumber(input.maxZoom, "command.maxZoom", Number.MIN_VALUE),
    nodeIds: optionalStringArray(input.nodeIds, "command.nodeIds"),
    padding: optionalNumber(input.padding, "command.padding", 0),
  }
  if (type === "viewport.center") return {
    type,
    animation: animation(input.animation),
    position: point(input.position, "command.position"),
    zoom: optionalNumber(input.zoom, "command.zoom", Number.MIN_VALUE),
  }
  if (type === "viewport.zoom") return {
    type,
    animation: animation(input.animation),
    zoom: requiredNumber(input.zoom, "command.zoom", Number.MIN_VALUE),
  }
  if (type === "notification.show") return {
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
    revision: result.document.revision,
    storageVersion: result.storageVersion,
    warnings: result.warnings,
  }
}

async function syncRenderer(renderer: CanvasRendererBridge, value: CanvasDocumentRef) {
  try {
    return { reloaded: await renderer.reloadDocument(value) }
  } catch (error) {
    return { reloaded: false, warning: error instanceof Error ? error.message : String(error) }
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
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
    if (kind === "inline-text") {
      return {
        format: optionalEnum(source.format, `${label}.format`, ["markdown", "plain"] as const),
        kind,
        name: optionalText(source.name, `${label}.name`),
        sourceId,
        text: text(source.text, `${label}.text`),
      }
    }
    if (kind === "host-file" || kind === "host-directory") {
      return {
        kind,
        path: requiredString(source.path, `${label}.path`),
        sourceId,
      }
    }
    if (kind === "remote-url") {
      const urlValue = requiredString(source.url, `${label}.url`)
      let url: URL
      try {
        url = new URL(urlValue)
      } catch {
        throw new Error(`${label}.url must be a valid URL`)
      }
      if (!["http:", "https:"].includes(url.protocol)) throw new Error("Remote Canvas resources must use HTTP or HTTPS")
      return {
        kind,
        mimeType: optionalText(source.mimeType, `${label}.mimeType`),
        name: optionalText(source.name, `${label}.name`),
        sourceId,
        url: urlValue,
      }
    }
    throw new Error(`Unsupported Canvas resource source: ${kind}`)
  })
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
  if (typeof value !== "number" || !Number.isFinite(value) || minimum !== undefined && value < minimum) {
    throw new Error(`${label} must be a finite number${minimum === undefined ? "" : ` >= ${minimum}`}`)
  }
  return value
}

function optionalNumber(value: unknown, label: string, minimum?: number) {
  return value === undefined ? undefined : requiredNumber(value, label, minimum)
}

function requiredInteger(value: unknown, label: string, minimum?: number, maximum?: number) {
  const number = requiredNumber(value, label, minimum)
  if (!Number.isSafeInteger(number) || maximum !== undefined && number > maximum) throw new Error(`${label} must be an integer`)
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

function requiredEnum<const Values extends readonly string[]>(value: unknown, label: string, values: Values): Values[number] {
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
