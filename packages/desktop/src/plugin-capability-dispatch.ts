import type { CanvasNodeQuery } from "@convax/canvas/application"

import type {
  PluginCanvasCapabilityClient,
  PluginCanvasChangeEvent,
  PluginCanvasDocumentCommand,
  PluginCanvasDocumentProjection,
  PluginCanvasEventSubscription,
  PluginCanvasRef,
} from "./plugin-capability-contracts"
import {
  isDesktopPluginHostRequest,
  pluginCanvasDocumentChangedCommand,
  pluginCapabilityProtocolV1,
  pluginHostFailure,
  pluginHostSuccess,
  type DesktopPluginHostCommand,
  type DesktopPluginHostRequest,
  type DesktopPluginHostResponse,
  type PluginCapabilityProtocol,
} from "./plugin-host-protocol"

const maximumRequestBytes = 1024 * 1024
const maximumResponseBytes = 8 * 1024 * 1024
const maximumInFlightRequests = 16
const maximumSubscriptions = 64
const documentCommandTypes = new Set([
  "canvas.auto-layout",
  "elements.remove",
  "nodes.align",
  "nodes.connect",
  "nodes.distribute",
  "nodes.group",
  "nodes.layout",
  "nodes.move",
  "nodes.setGeometry",
  "nodes.ungroup",
])

export interface PluginCapabilityEventSink {
  send(command: DesktopPluginHostCommand): void
}

export class PluginCapabilityConnection {
  private closed = false
  private inFlightRequests = 0
  private pendingSubscriptions = 0
  private readonly subscriptions = new Map<string, PluginCanvasEventSubscription>()

  constructor(
    private readonly client: PluginCanvasCapabilityClient,
    private readonly events: PluginCapabilityEventSink,
    private readonly createId: () => string = () => globalThis.crypto.randomUUID(),
    private readonly protocol: PluginCapabilityProtocol = pluginCapabilityProtocolV1,
  ) {}

  async dispatch(value: unknown, signal?: AbortSignal): Promise<DesktopPluginHostResponse | null> {
    const id = requestId(value)
    if (!id) return null
    try {
      throwIfAborted(signal)
      if (this.closed) throw new Error("Plugin capability connection is closed")
      assertSerializedSize(value, maximumRequestBytes, "Plugin capability request")
      if (!isDesktopPluginHostRequest(value) || value.protocol !== this.protocol) {
        throw new Error("Invalid Plugin capability request")
      }
      if (this.inFlightRequests >= maximumInFlightRequests) {
        throw new Error(`Plugin capability connection exceeds ${maximumInFlightRequests} in-flight requests`)
      }
      this.inFlightRequests += 1
      let result: unknown
      try {
        result = await this.execute(value, signal)
      } finally {
        this.inFlightRequests -= 1
      }
      if (signal?.aborted && value.method === "canvas.events.subscribe" && isRecord(result)) {
        const subscriptionId = result.subscriptionId
        if (typeof subscriptionId === "string") {
          const subscription = this.subscriptions.get(subscriptionId)
          this.subscriptions.delete(subscriptionId)
          subscription?.close()
        }
      }
      // A transaction result may already represent an irreversible CAS save.
      // Preserve that authoritative success if cancellation raced after the
      // Canvas application's final pre-save checkpoint.
      if (value.method !== "canvas.transaction.execute") throwIfAborted(signal)
      const response = pluginHostSuccess(id, result, this.protocol)
      try {
        assertSerializedSize(response, maximumResponseBytes, "Plugin capability response")
        return response
      } catch (error) {
        if (value.method !== "canvas.transaction.execute") throw error
        const compact = pluginHostSuccess(id, compactCommittedTransactionResult(result), this.protocol)
        return compact
      }
    } catch (error) {
      return pluginHostFailure(id, errorMessage(error), this.protocol)
    }
  }

  close() {
    if (this.closed) return
    this.closed = true
    for (const subscription of this.subscriptions.values()) subscription.close()
    this.subscriptions.clear()
  }

  private async execute(request: DesktopPluginHostRequest, signal?: AbortSignal) {
    if (request.method === "projects.list") {
      requireEmptyParams(request.params)
      return {
        projects: await callWithOptionalSignal(
          signal,
          () => this.client.listProjects(),
          (current) => this.client.listProjects(current),
        ),
      }
    }
    if (request.method === "canvas.catalog.list") {
      const params = exactRecord(request.params, ["projectId"], "Canvas catalog request")
      const projectId = requiredString(params.projectId, "Project id", 256)
      return callWithOptionalSignal(
        signal,
        () => this.client.listCanvases(projectId),
        (current) => this.client.listCanvases(projectId, current),
      )
    }
    if (request.method === "canvas.document.get") {
      const params = exactRecord(request.params, ["projection", "ref"], "Canvas document request")
      const ref = canvasRef(params.ref)
      const documentProjection = projection(params.projection)
      return callWithOptionalSignal(
        signal,
        () => this.client.getDocument(ref, documentProjection),
        (current) => this.client.getDocument(ref, documentProjection, current),
      )
    }
    if (request.method === "canvas.nodes.query") {
      const params = exactRecord(request.params, ["query", "ref"], "Canvas node query request")
      const ref = canvasRef(params.ref)
      const query = nodeQuery(params.query)
      return callWithOptionalSignal(
        signal,
        () => this.client.queryNodes(ref, query),
        (current) => this.client.queryNodes(ref, query, current),
      )
    }
    if (request.method === "canvas.transaction.execute") {
      const params = exactRecord(
        request.params,
        ["commands", "expectedRevision", "ref", "transactionId"],
        "Canvas transaction request",
      )
      if (!Array.isArray(params.commands)) throw new Error("Canvas transaction commands must be an array")
      const commands = params.commands.map(documentCommand)
      const transaction = {
        commands,
        expectedRevision: nonNegativeInteger(params.expectedRevision, "Canvas expected revision"),
        ref: canvasRef(params.ref),
        transactionId: requiredString(params.transactionId, "Canvas transaction id", 128),
      }
      return callWithOptionalSignal(
        signal,
        () => this.client.transact(transaction),
        (current) => this.client.transact(transaction, current),
      )
    }
    if (request.method === "canvas.events.subscribe") {
      if (this.subscriptions.size + this.pendingSubscriptions >= maximumSubscriptions) {
        throw new Error(`Plugin capability connection exceeds ${maximumSubscriptions} subscriptions`)
      }
      const params = exactRecord(request.params, ["ref"], "Canvas event subscription request")
      const filter = canvasFilter(params.ref)
      const subscriptionId = this.createId()
      this.pendingSubscriptions += 1
      try {
        const listener = (event: PluginCanvasChangeEvent) => {
          if (this.closed || !this.subscriptions.has(subscriptionId)) return
          this.events.send({
            command: pluginCanvasDocumentChangedCommand,
            params: { event, subscriptionId },
            protocol: this.protocol,
            type: "command",
          })
        }
        const subscription = await callWithOptionalSignal(
          signal,
          () => this.client.subscribe(filter, listener),
          (current) => this.client.subscribe(filter, listener, current),
        )
        if (signal?.aborted) {
          subscription.close()
          throwIfAborted(signal)
        }
        if (this.closed) {
          subscription.close()
          throw new Error("Plugin capability connection is closed")
        }
        this.subscriptions.set(subscriptionId, subscription)
        return { subscriptionId }
      } finally {
        this.pendingSubscriptions -= 1
      }
    }
    if (request.method === "canvas.events.unsubscribe") {
      const params = exactRecord(request.params, ["subscriptionId"], "Canvas event unsubscribe request")
      const subscriptionId = requiredString(params.subscriptionId, "Canvas subscription id", 256)
      const subscription = this.subscriptions.get(subscriptionId)
      if (!subscription) return { removed: false }
      this.subscriptions.delete(subscriptionId)
      subscription.close()
      return { removed: true }
    }
    throw new Error(`Plugin capability method is unavailable on this connection: ${request.method}`)
  }
}

function callWithOptionalSignal<Result>(
  signal: AbortSignal | undefined,
  withoutSignal: () => Promise<Result>,
  withSignal: (signal: AbortSignal) => Promise<Result>,
) {
  throwIfAborted(signal)
  return signal === undefined ? withoutSignal() : withSignal(signal)
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  if (signal.reason instanceof Error) throw signal.reason
  throw new DOMException("Plugin capability request was canceled", "AbortError")
}

function compactCommittedTransactionResult(value: unknown) {
  const result = isRecord(value) ? value : {}
  const ref = isRecord(result.ref) ? result.ref : {}
  const revision = result.revision
  return {
    affectedNodeIds: [],
    changed: result.changed === true,
    createdNodeIds: [],
    ref: {
      canvasId: boundedString(ref.canvasId, 256),
      projectId: boundedString(ref.projectId, 256),
    },
    revision: typeof revision === "number" && Number.isSafeInteger(revision) && revision >= 0 ? revision : 0,
    storageVersion: boundedString(result.storageVersion, 2_048),
    summaryTruncated: true,
    warnings: [],
  }
}

function boundedString(value: unknown, maximum: number) {
  return typeof value === "string" ? value.slice(0, maximum) : ""
}

function documentCommand(value: unknown): PluginCanvasDocumentCommand {
  const command = exactRecord(value, undefined, "Canvas document command")
  if (typeof command.type !== "string" || !documentCommandTypes.has(command.type)) {
    throw new Error(`Canvas document command is not supported: ${String(command.type)}`)
  }
  // The Canvas application owner performs command-specific validation against
  // the current document. This adapter only admits the resource-free command
  // family and a bounded JSON payload.
  return structuredClone(command) as unknown as PluginCanvasDocumentCommand
}

function nodeQuery(value: unknown): CanvasNodeQuery {
  if (value === undefined) return {}
  const input = exactRecord(value, ["ids", "kinds", "limit", "relatedToNodeIds", "text"], "Canvas node query")
  return {
    ...(input.ids === undefined ? {} : { ids: stringArray(input.ids, "Canvas query ids", 1_000) }),
    ...(input.kinds === undefined ? {} : { kinds: stringArray(input.kinds, "Canvas query kinds", 256) }),
    ...(input.limit === undefined ? {} : { limit: nonNegativeInteger(input.limit, "Canvas query limit") }),
    ...(input.relatedToNodeIds === undefined
      ? {}
      : { relatedToNodeIds: stringArray(input.relatedToNodeIds, "Canvas related node ids", 1_000) }),
    ...(input.text === undefined ? {} : { text: requiredString(input.text, "Canvas query text", 2_000, true) }),
  }
}

function projection(value: unknown): PluginCanvasDocumentProjection {
  if (value === undefined || value === "geometry") return "geometry"
  if (value === "structure") return value
  throw new Error("Canvas document projection must be geometry or structure")
}

function canvasFilter(value: unknown): PluginCanvasRef | { projectId: string } {
  const input = exactRecord(value, ["canvasId", "projectId"], "Canvas event filter")
  const projectId = requiredString(input.projectId, "Project id", 256)
  if (input.canvasId === undefined) return { projectId }
  return { canvasId: requiredString(input.canvasId, "Canvas id", 256), projectId }
}

function canvasRef(value: unknown): PluginCanvasRef {
  const input = exactRecord(value, ["canvasId", "projectId"], "Canvas ref")
  return {
    canvasId: requiredString(input.canvasId, "Canvas id", 256),
    projectId: requiredString(input.projectId, "Project id", 256),
  }
}

function requestId(value: unknown) {
  if (!isRecord(value) || typeof value.id !== "string" || !value.id || value.id.length > 128) return null
  return value.id
}

function requireEmptyParams(value: unknown) {
  if (value === undefined) return
  exactRecord(value, [], "Plugin capability params")
}

function exactRecord(value: unknown, keys: readonly string[] | undefined, label: string) {
  if (!isRecord(value)) throw new Error(`${label} must be an object`)
  if (keys) {
    const allowed = new Set(keys)
    const unsupported = Object.keys(value).find((key) => !allowed.has(key))
    if (unsupported) throw new Error(`${label} contains an unsupported field: ${unsupported}`)
  }
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function requiredString(value: unknown, label: string, maximum: number, allowEmpty = false) {
  if (
    typeof value !== "string" ||
    (!allowEmpty && !value.trim()) ||
    value !== value.trim() ||
    value.length > maximum ||
    value.includes("\0")
  ) {
    throw new Error(`${label} must be a trimmed string of at most ${maximum} characters`)
  }
  return value
}

function stringArray(value: unknown, label: string, maximum: number) {
  if (!Array.isArray(value) || value.length > maximum) throw new Error(`${label} must be a bounded array`)
  const result = value.map((item) => requiredString(item, label, 2_048))
  if (new Set(result).size !== result.length) throw new Error(`${label} contains duplicate values`)
  return result
}

function nonNegativeInteger(value: unknown, label: string) {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(`${label} must be a non-negative integer`)
  return value as number
}

function assertSerializedSize(value: unknown, limit: number, label: string) {
  let serialized: string | undefined
  try {
    serialized = JSON.stringify(value)
  } catch {
    throw new Error(`${label} must be JSON-serializable`)
  }
  if (serialized === undefined || new TextEncoder().encode(serialized).byteLength > limit) {
    throw new Error(`${label} exceeds ${limit} bytes`)
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 512) : "Plugin capability request failed"
}
