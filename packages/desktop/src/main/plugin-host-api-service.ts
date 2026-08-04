import {
  PLUGIN_API_CATALOG_MAJOR,
  PLUGIN_API_CATALOG_VERSION,
  evaluatePluginApiAvailability,
  getPluginApiDefinition,
  getPluginApiWireContract,
  isPluginApiAvailable,
  isPluginApiCommitPreserving,
  maximumPluginApiRequestBytes,
  maximumPluginApiResultBytes,
  parsePluginApiCall,
  parsePluginApiResult,
  pluginApiCatalog,
  type ApiAvailability,
  type PluginApiGenerationReference,
  type PluginApiId,
} from "@convax/plugin-api"
import { parse as parseConvaxUri } from "@convax/uri"

import type { PluginCanvasEventSubscription, PluginPrincipal } from "../plugin-capability-contracts"
import { PluginHostApiError } from "../plugin-host-errors"
import type {
  PluginHostApiConnectionRequest,
  PluginHostApiMainCall,
  PluginHostApiMainConnection,
  PluginHostInvocationLease,
  PluginHostInvocationLeaseClaims,
  PluginHostMutationCheckpoint,
  PluginHostNodeBinding,
  PluginHostNodeContext,
  PluginHostNodeContextPort,
  PluginHostNodeOperationsPort,
  PluginHostPrincipalPort,
  PluginHostResolvedPrincipal,
  PluginHostTransportContext,
} from "../plugin-host-api-main-contracts"

export interface PluginHostApiServiceOptions {
  createId?: () => string
  maximumInFlightRequests?: number
  maximumRequestBytes?: number
  maximumResponseBytes?: number
  maximumSubscriptions?: number
  nodes: PluginHostNodeContextPort
  operations: PluginHostNodeOperationsPort
  principals: PluginHostPrincipalPort
}

const defaultMaximumRequestBytes = maximumPluginApiRequestBytes
const defaultMaximumResponseBytes = maximumPluginApiResultBytes
const defaultMaximumInFlightRequests = 16
const defaultMaximumSubscriptions = 64
const hostApiIds = new Set<PluginApiId>(pluginApiCatalog.apis.map(({ id }) => id))

interface BoundPluginHostInvocationLease {
  assertActive(claims: PluginHostInvocationLeaseClaims): Promise<void> | void
  readonly claims: Readonly<PluginHostInvocationLeaseClaims>
  readonly principal: Readonly<PluginPrincipal>
  readonly resolved: Readonly<PluginHostResolvedPrincipal>
  readonly signal: AbortSignal
}

export class PluginHostApiConnectionInvalidError extends PluginHostApiError {
  constructor(pluginId: string) {
    super("stale-context", `Plugin Host API connection is no longer current: ${pluginId}`)
    this.name = "PluginHostApiConnectionInvalidError"
  }
}

export class PluginHostApiScopeError extends PluginHostApiError {
  constructor(message: string) {
    super("stale-context", message)
    this.name = "PluginHostApiScopeError"
  }
}

export class PluginHostInvocationLeaseInvalidError extends PluginHostApiError {
  constructor(message = "Plugin Host API invocation lease is invalid or no longer active") {
    super("stale-context", message)
    this.name = "PluginHostInvocationLeaseInvalidError"
  }
}

function requireTransport(value: PluginHostTransportContext | undefined) {
  if (!value) throw new PluginHostApiScopeError("Plugin Host API call requires a transport context")
  return value
}

export class PluginHostApiService {
  readonly #createId: () => string
  readonly #maximumRequestBytes: number
  readonly #maximumResponseBytes: number
  readonly #maximumInFlightRequests: number
  readonly #maximumSubscriptions: number
  readonly #nodes: PluginHostNodeContextPort
  readonly #operations: PluginHostNodeOperationsPort
  readonly #principals: PluginHostPrincipalPort

  constructor(options: PluginHostApiServiceOptions) {
    this.#createId = options.createId ?? (() => globalThis.crypto.randomUUID())
    this.#maximumRequestBytes = positiveLimit(
      options.maximumRequestBytes,
      defaultMaximumRequestBytes,
      "Plugin Host API request byte limit",
    )
    this.#maximumResponseBytes = positiveLimit(
      options.maximumResponseBytes,
      defaultMaximumResponseBytes,
      "Plugin Host API response byte limit",
    )
    this.#maximumInFlightRequests = positiveLimit(
      options.maximumInFlightRequests,
      defaultMaximumInFlightRequests,
      "Plugin Host API in-flight request limit",
    )
    this.#maximumSubscriptions = positiveLimit(
      options.maximumSubscriptions,
      defaultMaximumSubscriptions,
      "Plugin Host API subscription limit",
    )
    this.#nodes = options.nodes
    this.#operations = options.operations
    this.#principals = options.principals
  }

  async connect(request: PluginHostApiConnectionRequest): Promise<PluginHostApiMainConnection> {
    const principal = freezePrincipal(request.principal)
    const invocationLease =
      request.invocationLease === undefined ? undefined : bindInvocationLease(request.invocationLease, principal)
    const node = request.node === undefined ? undefined : freezeNodeBinding(request.node)
    const initial = invocationLease
      ? await this.#resolveInvocation(principal, invocationLease, invocationLease.claims.operationId)
      : await this.#resolveCurrent(principal)
    if (principal.runtime === "web" && !node) {
      throw new PluginHostApiScopeError("A Web Plugin Host API connection requires an owning Canvas node")
    }
    if (principal.runtime === "web" && !request.transport) {
      throw new PluginHostApiScopeError("A Web Plugin Host API connection requires a transport context")
    }
    if (node) await this.#requireNode(principal, node, undefined, initial.resolved)
    const declared = new Set([...initial.resolved.hostApi.required, ...initial.resolved.hostApi.optional])
    const connectionId = boundedString(this.#createId(), "Plugin Host API connection id", 128)
    const connectionAbort = new AbortController()
    const subscriptions = new Map<string, PluginCanvasEventSubscription>()
    let closed = false
    let inFlightRequests = 0

    const close = () => {
      if (closed) return
      closed = true
      connectionAbort.abort(new Error("Plugin Host API connection is closed"))
      // Revoke sender/frame-owned resources before unrelated subscription
      // disposal can fail. Lifecycle cleanup is fail-closed and must not rely
      // on renderer unload code awaiting any operation.
      try {
        this.#operations.closeConnection({
          ...(node ? { binding: node } : {}),
          connectionId,
          principal,
          ...(request.transport ? { transport: request.transport } : {}),
        })
      } finally {
        for (const subscription of subscriptions.values()) {
          try {
            subscription.close()
          } catch {
            // One subscription cannot block exact-frame resource revocation or
            // disposal of the remaining subscriptions.
          }
        }
        subscriptions.clear()
      }
    }

    const checkpoint = (
      method: PluginApiId,
      operationId: string,
      signal?: AbortSignal,
    ): PluginHostMutationCheckpoint => ({
      checkpoint: async () => {
        if (closed) throw new Error("Plugin Host API connection is closed")
        const authorized = await this.#authorize(principal, method, node, signal, invocationLease, operationId)
        if (!node) throw new PluginHostApiScopeError(`Plugin Host API requires an owning node: ${method}`)
        return this.#requireNode(principal, node, signal, authorized.resolved)
      },
    })

    return Object.freeze({
      close,
      execute: async (call: PluginHostApiMainCall, execution: { operationId: string; signal?: AbortSignal }) => {
        call = parsePluginApiCall(call)
        if (closed) throw new Error("Plugin Host API connection is closed")
        const operationId = boundedString(execution.operationId, "Plugin Host API operation id", 128)
        let signal = execution.signal
        if (invocationLease) signal = combineSignals(signal, invocationLease.signal)
        signal = combineSignals(signal, connectionAbort.signal)
        if (inFlightRequests >= this.#maximumInFlightRequests) {
          throw new Error(`Plugin Host API connection exceeds ${this.#maximumInFlightRequests} in-flight requests`)
        }
        inFlightRequests += 1
        let rollbackOpenedSession: (() => Promise<boolean>) | undefined
        try {
          throwIfAborted(signal)
          assertSerializedSize(
            call,
            Math.min(this.#maximumRequestBytes, getPluginApiWireContract(call.method).request.maxBytes),
            "Plugin Host API request",
          )
          if (!hostApiIds.has(call.method)) throw new Error(`Unknown Plugin Host API: ${call.method}`)
          const authorized = await this.#authorize(principal, call.method, node, signal, invocationLease, operationId)
          const reauthorizeNode = async (binding: PluginHostNodeBinding) => {
            const current = await this.#authorize(principal, call.method, node, signal, invocationLease, operationId)
            return this.#requireNode(principal, binding, signal, current.resolved)
          }
          let result: unknown

          if (call.method === "host.context.get") {
            requireNoParams(call.params)
            const context = await this.#requireNode(
              principal,
              requireNode(node, call.method),
              signal,
              authorized.resolved,
            )
            result = hostContext(authorized, context)
          } else if (call.method === "canvas.inputs.list") {
            requireNoParams(call.params)
            const binding = requireNode(node, call.method)
            await this.#requireNode(principal, binding, signal, authorized.resolved)
            const inputs = await this.#operations.listInputs({ binding, principal, signal })
            await reauthorizeNode(binding)
            result = { inputs: sanitizeInputs(inputs) }
          } else if (call.method === "canvas.inputs.image.open") {
            const binding = requireNode(node, call.method)
            const params = exactRecord(call.params, ["inputKey"], "Plugin image input open request")
            const inputKey = boundedString(params.inputKey, "Plugin image input key", 2_048)
            await this.#requireNode(principal, binding, signal, authorized.resolved)
            const opened = await this.#operations.openImageInput({
              binding,
              connectionId,
              inputKey,
              principal,
              signal,
              transport: requireTransport(request.transport),
            })
            rollbackOpenedSession = () =>
              this.#operations.closeImageInput({
                binding,
                connectionId,
                principal,
                sessionId: opened.sessionId,
                transport: requireTransport(request.transport),
              })
            await reauthorizeNode(binding)
            result = sanitizeOpenedImageInput(opened)
          } else if (call.method === "canvas.inputs.image.close") {
            const binding = requireNode(node, call.method)
            const params = exactRecord(call.params, ["sessionId"], "Plugin image input close request")
            const sessionId = boundedString(params.sessionId, "Plugin image input session id", 128)
            result = {
              closed: await this.#operations.closeImageInput({
                binding,
                connectionId,
                principal,
                sessionId,
                signal,
                transport: requireTransport(request.transport),
              }),
            }
          } else if (call.method === "canvas.inputs.open") {
            const binding = requireNode(node, call.method)
            const params = exactRecord(call.params, ["inputKey"], "Plugin input open request")
            const inputKey = boundedString(params.inputKey, "Plugin input key", 2_048)
            await this.#requireNode(principal, binding, signal, authorized.resolved)
            const opened = await this.#operations.openInput({
              binding,
              connectionId,
              inputKey,
              principal,
              signal,
              transport: requireTransport(request.transport),
            })
            rollbackOpenedSession = () =>
              this.#operations.closeInput({
                binding,
                connectionId,
                principal,
                sessionId: opened.sessionId,
                transport: requireTransport(request.transport),
              })
            await reauthorizeNode(binding)
            result = sanitizeOpenedInput(opened)
          } else if (call.method === "canvas.inputs.close") {
            const binding = requireNode(node, call.method)
            const params = exactRecord(call.params, ["sessionId"], "Plugin input close request")
            const sessionId = boundedString(params.sessionId, "Plugin input session id", 128)
            result = {
              closed: await this.#operations.closeInput({
                binding,
                connectionId,
                principal,
                sessionId,
                signal,
                transport: requireTransport(request.transport),
              }),
            }
          } else if (call.method === "canvas.node.get") {
            requireNoParams(call.params)
            const context = await this.#requireNode(
              principal,
              requireNode(node, call.method),
              signal,
              authorized.resolved,
            )
            result = structuredClone(context.node)
            assertRendererSafeNode(result)
          } else if (call.method === "canvas.node.state.replace") {
            const binding = requireNode(node, call.method)
            result = await this.#operations.replaceNodeState({
              binding,
              checkpoint: checkpoint(call.method, operationId, signal),
              operationId,
              principal,
              signal,
              state: structuredClone(call.params.state) as Record<string, unknown>,
            })
          } else if (call.method === "canvas.resource.image.create") {
            const binding = requireNode(node, call.method)
            const created = await this.#operations.createCanvasImage({
              binding,
              checkpoint: checkpoint(call.method, operationId, signal),
              dataUrl: call.params.dataUrl,
              name: call.params.name,
              operationId,
              principal,
              signal,
            })
            result = sanitizeCanvasImageResult(created)
          } else if (call.method === "project.file.text.read") {
            const binding = requireNode(node, call.method)
            const path = call.params.path
            await this.#requireNode(principal, binding, signal, authorized.resolved)
            const read = await this.#operations.readProjectText({
              path,
              principal,
              projectId: binding.projectId,
              signal,
            })
            await reauthorizeNode(binding)
            result = sanitizeProjectTextResult(read, path)
          } else if (call.method === "agent.prompt") {
            const binding = requireNode(node, call.method)
            const prompted = await this.#operations.promptAgent({
              binding,
              checkpoint: checkpoint(call.method, operationId, signal),
              principal,
              signal,
              text: call.params.text,
            })
            result = { text: boundedString(prompted.text, "Plugin Agent acknowledgement", 64 * 1024, true) }
          } else if (call.method === "generation.tools.list") {
            const binding = requireNode(node, call.method)
            const params =
              call.params === undefined
                ? {}
                : exactRecord(call.params, ["output"], "Plugin generation tool list request")
            const output = optionalGenerationOutput(params.output)
            await this.#requireNode(principal, binding, signal, authorized.resolved)
            const tools = await this.#operations.listGenerationTools({ binding, output, principal, signal })
            await reauthorizeNode(binding)
            result = { tools: sanitizeGenerationTools(tools, output) }
          } else if (call.method === "generation.execute") {
            const binding = requireNode(node, call.method)
            const params = exactRecord(
              call.params,
              ["output", "prompt", "references", "resultMode", "toolId"],
              "Plugin generation request",
            )
            const execution = await this.#operations.executeGeneration({
              binding,
              checkpoint: checkpoint(call.method, operationId, signal),
              output: optionalGenerationOutput(params.output),
              operationId,
              principal,
              prompt: call.params.prompt,
              references: optionalGenerationReferences(params.references),
              resultMode: optionalGenerationResultMode(params.resultMode),
              signal,
              toolId:
                params.toolId === undefined
                  ? undefined
                  : boundedString(params.toolId, "Plugin generation tool id", 256),
            })
            result = sanitizeGenerationResult(execution)
          } else if (call.method === "projects.list") {
            requireNoParams(call.params)
            result = { projects: await request.canvas.listProjects(signal) }
          } else if (call.method === "canvas.catalog.list") {
            const params = exactRecord(call.params, ["projectId"], "Plugin Canvas catalog request")
            result = await request.canvas.listCanvases(
              boundedString(params.projectId, "Plugin Project id", 256),
              signal,
            )
          } else if (call.method === "canvas.document.get") {
            const params = exactRecord(call.params, ["projection", "ref"], "Plugin Canvas document request")
            result = await request.canvas.getDocument(
              canvasRef(params.ref),
              documentProjection(params.projection),
              signal,
            )
          } else if (call.method === "canvas.nodes.query") {
            const params = exactRecord(call.params, ["query", "ref"], "Plugin Canvas node query request")
            result = await request.canvas.queryNodes(canvasRef(params.ref), nodeQuery(params.query), signal)
          } else if (call.method === "canvas.transaction.execute") {
            result = await request.canvas.transact(call.params, signal)
          } else if (call.method === "canvas.events.subscribe") {
            if (subscriptions.size >= this.#maximumSubscriptions) {
              throw new Error(`Plugin Host API connection exceeds ${this.#maximumSubscriptions} subscriptions`)
            }
            const params = exactRecord(call.params, ["ref"], "Plugin Canvas event subscription request")
            const filter = canvasFilter(params.ref)
            const subscriptionId = boundedString(this.#createId(), "Plugin subscription id", 128)
            if (subscriptions.has(subscriptionId)) throw new Error("Plugin subscription id collision")
            const subscription = await request.canvas.subscribe(
              filter,
              (event) => {
                if (!closed && subscriptions.has(subscriptionId)) {
                  request.onCanvasEvent?.({ event: structuredClone(event), subscriptionId })
                }
              },
              signal,
            )
            if (closed || signal?.aborted) {
              subscription.close()
              throwIfAborted(signal)
              throw new Error("Plugin Host API connection is closed")
            }
            subscriptions.set(subscriptionId, subscription)
            result = { subscriptionId }
          } else if (call.method === "canvas.events.unsubscribe") {
            const params = exactRecord(call.params, ["subscriptionId"], "Plugin Canvas unsubscribe request")
            const subscriptionId = boundedString(params.subscriptionId, "Plugin subscription id", 128)
            const subscription = subscriptions.get(subscriptionId)
            if (subscription) {
              subscriptions.delete(subscriptionId)
              subscription.close()
            }
            result = { removed: Boolean(subscription) }
          } else {
            result = assertNever(call)
          }

          // Mutation/execution ports own the last irreversible checkpoint. Once a
          // Canvas CAS or external call has succeeded, a racing transport abort
          // must not rewrite that authoritative outcome into a retryable failure.
          if (!isPluginApiCommitPreserving(call.method)) {
            throwIfAborted(signal)
            await this.#authorize(principal, call.method, node, signal, invocationLease, operationId)
          }
          assertSerializedSize(
            result,
            Math.min(this.#maximumResponseBytes, getPluginApiWireContract(call.method).result.maxBytes),
            "Plugin Host API response",
          )
          const parsed = parsePluginApiResult(call.method, structuredClone(result))
          rollbackOpenedSession = undefined
          return parsed
        } catch (error) {
          if (rollbackOpenedSession) {
            let revoked = false
            try {
              revoked = await rollbackOpenedSession()
            } catch {
              // Fall through to exact-frame revocation below.
            }
            if (!revoked) {
              // A failed targeted revocation must not leave an unreachable bearer
              // session behind. Closing the connection revokes every session for
              // the same exact sender/frame principal.
              try {
                close()
              } catch {
                // Preserve the original call failure. The production adapter's
                // frame revocation is synchronous and non-throwing for a validated
                // connection identity.
              }
            }
          }
          throw error
        } finally {
          inFlightRequests -= 1
        }
      },
      supports: (method: PluginApiId) => declared.has(method) && hostApiIds.has(method),
    })
  }

  async #authorize(
    principal: PluginPrincipal,
    method: PluginApiId,
    node?: PluginHostNodeBinding,
    signal?: AbortSignal,
    invocationLease?: BoundPluginHostInvocationLease,
    operationId?: string,
  ): Promise<{
    availability: ApiAvailability
    live: Awaited<ReturnType<PluginHostPrincipalPort["liveState"]>>
    resolved: PluginHostResolvedPrincipal
  }> {
    let authority: {
      live: Awaited<ReturnType<PluginHostPrincipalPort["liveState"]>>
      resolved: PluginHostResolvedPrincipal
    }
    if (invocationLease) {
      if (operationId === undefined) {
        throw new PluginHostInvocationLeaseInvalidError("Plugin Host API invocation operation is missing")
      }
      authority = await this.#resolveInvocation(principal, invocationLease, operationId, signal)
    } else {
      authority = await this.#resolveCurrent(principal, signal)
    }
    const { live, resolved } = authority
    const availability = evaluatePluginApiAvailability(method, resolved.hostApi, {
      audience: principal.runtime === "web" ? "web-plugin" : "companion",
      catalogMajor: PLUGIN_API_CATALOG_MAJOR,
      catalogVersion: PLUGIN_API_CATALOG_VERSION,
      disabled: live.disabled,
      grants: resolved.capabilities,
      hasContext: getPluginApiDefinition(method).scope === "own-node" ? node !== undefined : true,
      recovering: live.recovering,
      setupComplete: live.setupComplete,
    })
    if (!isPluginApiAvailable(availability)) {
      if (availability.reason === "permission-denied") {
        throw new PluginHostApiError(
          "permission-denied",
          `Plugin Host API is unavailable: ${method} (${availability.reason})`,
        )
      }
      if (availability.reason === "missing-context") {
        throw new PluginHostApiError(
          "stale-context",
          `Plugin Host API is unavailable: ${method} (${availability.reason})`,
        )
      }
      throw new Error(`Plugin Host API is unavailable: ${method} (${availability.reason})`)
    }
    return { availability, live, resolved }
  }

  async #resolveCurrent(principal: PluginPrincipal, signal?: AbortSignal) {
    throwIfAborted(signal)
    const resolved = await this.#principals.resolve(principal, signal)
    throwIfAborted(signal)
    if (!resolved || !samePrincipal(principal, resolved)) {
      throw new PluginHostApiConnectionInvalidError(principal.pluginId)
    }
    const live = await this.#principals.liveState(principal, signal)
    throwIfAborted(signal)
    return { live, resolved }
  }

  async #resolveInvocation(
    principal: PluginPrincipal,
    lease: BoundPluginHostInvocationLease,
    operationId: string,
    signal?: AbortSignal,
  ) {
    const invocationSignal = combineSignals(signal, lease.signal)
    throwIfAborted(invocationSignal)
    if (
      operationId !== lease.claims.operationId ||
      lease.claims.providerPluginId !== principal.pluginId ||
      !sameExactPrincipal(principal, lease.principal) ||
      !samePrincipal(principal, lease.resolved)
    ) {
      throw new PluginHostInvocationLeaseInvalidError()
    }
    await lease.assertActive(lease.claims)
    throwIfAborted(invocationSignal)
    return {
      live: { disabled: false, recovering: false, setupComplete: true },
      resolved: lease.resolved,
    }
  }

  async #requireNode(
    principal: PluginPrincipal,
    binding: PluginHostNodeBinding,
    signal?: AbortSignal,
    resolved?: PluginHostResolvedPrincipal,
  ) {
    throwIfAborted(signal)
    if (!resolved) await this.#resolveCurrent(principal, signal)
    const context = await this.#nodes.resolve({ binding, principal, signal })
    throwIfAborted(signal)
    if (
      !context ||
      context.project.id !== binding.projectId ||
      context.canvas.id !== binding.canvasId ||
      context.node.id !== binding.nodeId
    ) {
      throw new PluginHostApiScopeError("Plugin owning Project, Canvas, or node changed")
    }
    return context
  }
}

function hostContext(
  authorized: {
    live: Awaited<ReturnType<PluginHostPrincipalPort["liveState"]>>
    resolved: PluginHostResolvedPrincipal
  },
  context: PluginHostNodeContext,
) {
  const availability = [...authorized.resolved.hostApi.required, ...authorized.resolved.hostApi.optional].map((id) =>
    evaluatePluginApiAvailability(id, authorized.resolved.hostApi, {
      audience: "web-plugin",
      catalogMajor: PLUGIN_API_CATALOG_MAJOR,
      catalogVersion: PLUGIN_API_CATALOG_VERSION,
      disabled: authorized.live.disabled,
      grants: authorized.resolved.capabilities,
      hasContext: true,
      recovering: authorized.live.recovering,
      setupComplete: authorized.live.setupComplete,
    }),
  )
  const result = {
    canvas: structuredClone(context.canvas),
    hostApi: { availability, catalogVersion: PLUGIN_API_CATALOG_VERSION },
    node: structuredClone(context.node),
    plugin: {
      id: authorized.resolved.pluginId,
      name: authorized.resolved.pluginName,
      version: authorized.resolved.pluginVersion,
    },
    project: structuredClone(context.project),
  }
  assertRendererSafeNode(result.node)
  return result
}

function samePrincipal(principal: PluginPrincipal, resolved: PluginHostResolvedPrincipal) {
  return (
    resolved.activeRevision === principal.activeRevision &&
    resolved.activeSetDigest === principal.activeSetDigest &&
    resolved.manifestDigest === principal.manifestDigest &&
    resolved.pluginId === principal.pluginId &&
    resolved.pluginVersion === principal.pluginVersion &&
    resolved.snapshotDigest === principal.snapshotDigest
  )
}

function sameExactPrincipal(left: PluginPrincipal, right: PluginPrincipal) {
  return (
    left.activeRevision === right.activeRevision &&
    left.activeSetDigest === right.activeSetDigest &&
    left.manifestDigest === right.manifestDigest &&
    left.pluginId === right.pluginId &&
    left.pluginVersion === right.pluginVersion &&
    left.runtime === right.runtime &&
    left.snapshotDigest === right.snapshotDigest
  )
}

function bindInvocationLease(
  lease: PluginHostInvocationLease,
  connectionPrincipal: PluginPrincipal,
): BoundPluginHostInvocationLease {
  if (!lease || typeof lease.assertActive !== "function" || !(lease.signal instanceof AbortSignal)) {
    throw new PluginHostInvocationLeaseInvalidError()
  }
  if (connectionPrincipal.runtime !== "tool") {
    throw new PluginHostInvocationLeaseInvalidError("Web Plugin Host API connections cannot carry invocation leases")
  }
  const principal = freezePrincipal(lease.principal)
  const claims = Object.freeze({
    consumerPluginId: boundedString(lease.claims?.consumerPluginId, "Plugin Host invocation consumer id", 128),
    operationId: boundedString(lease.claims?.operationId, "Plugin Host invocation operation id", 128),
    providerPluginId: boundedString(lease.claims?.providerPluginId, "Plugin Host invocation provider id", 128),
  })
  const resolved = freezeInvocationResolvedPrincipal(lease.resolved)
  if (
    claims.providerPluginId !== connectionPrincipal.pluginId ||
    !sameExactPrincipal(connectionPrincipal, principal) ||
    !samePrincipal(connectionPrincipal, resolved)
  ) {
    throw new PluginHostInvocationLeaseInvalidError()
  }
  return Object.freeze({
    assertActive: lease.assertActive.bind(lease),
    claims,
    principal,
    resolved,
    signal: lease.signal,
  })
}

function freezeInvocationResolvedPrincipal(
  resolved: PluginHostResolvedPrincipal,
): Readonly<PluginHostResolvedPrincipal> {
  if (!resolved || !Array.isArray(resolved.capabilities) || !resolved.hostApi) {
    throw new PluginHostInvocationLeaseInvalidError()
  }
  const hostApi = Object.freeze({
    major: resolved.hostApi.major,
    optional: Object.freeze([...resolved.hostApi.optional]),
    required: Object.freeze([...resolved.hostApi.required]),
  })
  return Object.freeze({
    activeRevision: resolved.activeRevision,
    activeSetDigest: resolved.activeSetDigest,
    capabilities: Object.freeze([...resolved.capabilities]),
    hostApi,
    manifestDigest: resolved.manifestDigest,
    pluginId: boundedString(resolved.pluginId, "Plugin Host invocation resolved Plugin id", 128),
    pluginName: boundedString(resolved.pluginName, "Plugin Host invocation resolved Plugin name", 512),
    pluginVersion: boundedString(resolved.pluginVersion, "Plugin Host invocation resolved Plugin version", 128),
    snapshotDigest: resolved.snapshotDigest,
  })
}

function freezePrincipal(principal: PluginPrincipal): PluginPrincipal {
  if (
    !principal ||
    !Number.isSafeInteger(principal.activeRevision) ||
    principal.activeRevision < 0 ||
    !sha256(principal.activeSetDigest) ||
    !sha256(principal.manifestDigest) ||
    !sha256(principal.snapshotDigest) ||
    (principal.runtime !== "web" && principal.runtime !== "tool")
  ) {
    throw new Error("Plugin Host API principal is invalid")
  }
  return Object.freeze({
    activeRevision: principal.activeRevision,
    activeSetDigest: principal.activeSetDigest,
    manifestDigest: principal.manifestDigest,
    pluginId: boundedString(principal.pluginId, "Plugin id", 128),
    pluginVersion: boundedString(principal.pluginVersion, "Plugin version", 128),
    runtime: principal.runtime,
    snapshotDigest: principal.snapshotDigest,
  })
}

function freezeNodeBinding(binding: PluginHostNodeBinding): PluginHostNodeBinding {
  return Object.freeze({
    canvasId: boundedString(binding.canvasId, "Plugin Canvas id", 256),
    nodeId: boundedString(binding.nodeId, "Plugin node id", 2_048),
    projectId: boundedString(binding.projectId, "Plugin Project id", 256),
  })
}

function requireNode(binding: PluginHostNodeBinding | undefined, method: PluginApiId) {
  if (!binding) throw new PluginHostApiScopeError(`Plugin Host API requires an owning node: ${method}`)
  return binding
}

function sanitizeInputs(inputs: readonly unknown[]) {
  if (!Array.isArray(inputs) || inputs.length > 256) throw new Error("Plugin input catalog is invalid")
  const inputKeys = new Set<string>()
  return inputs.map((candidate, index) => {
    const value = exactRecord(
      candidate,
      ["durationMs", "height", "inputKey", "kind", "label", "mediaRevision", "mimeType", "name", "status", "width"],
      `Plugin input ${index}`,
    )
    const inputKey = boundedString(value.inputKey, `Plugin input ${index} key`, 2_048)
    if (inputKeys.has(inputKey)) throw new Error("Plugin input catalog contains duplicate keys")
    inputKeys.add(inputKey)
    return {
      ...(optionalFinite(value.durationMs) === undefined ? {} : { durationMs: optionalFinite(value.durationMs) }),
      ...(optionalFinite(value.height) === undefined ? {} : { height: optionalFinite(value.height) }),
      inputKey,
      kind: boundedString(value.kind, `Plugin input ${index} kind`, 80),
      label: boundedString(value.label, `Plugin input ${index} label`, 512),
      ...(value.mediaRevision === undefined
        ? {}
        : { mediaRevision: boundedString(value.mediaRevision, `Plugin input ${index} revision`, 128) }),
      ...(value.mimeType === undefined
        ? {}
        : { mimeType: boundedString(value.mimeType, `Plugin input ${index} MIME`, 256) }),
      ...(value.name === undefined ? {} : { name: boundedString(value.name, `Plugin input ${index} name`, 512) }),
      ...(value.status === "error" || value.status === "idle" || value.status === "pending"
        ? { status: value.status }
        : {}),
      ...(optionalFinite(value.width) === undefined ? {} : { width: optionalFinite(value.width) }),
    }
  })
}

function sanitizeOpenedInput(value: unknown) {
  const input = exactRecord(value, ["probe", "sessionId", "url"], "Plugin opened input")
  const url = boundedString(input.url, "Plugin opened input URL", 2_048)
  const sessionId = boundedString(input.sessionId, "Plugin opened input session id", 128)
  requireConnectedMediaBearerUrl(url, sessionId)
  const probe = exactRecord(
    input.probe,
    ["duration", "height", "kind", "mediaRevision", "mimeType", "size", "width"],
    "Plugin opened input probe",
  )
  if (probe.kind !== "audio" && probe.kind !== "video") throw new Error("Plugin opened input kind is invalid")
  return {
    probe: structuredClone(probe),
    sessionId,
    url,
  }
}

function sanitizeOpenedImageInput(value: unknown) {
  const result = parsePluginApiResult("canvas.inputs.image.open", value)
  requireConnectedMediaBearerUrl(result.url, result.sessionId)
  return result
}

function requireConnectedMediaBearerUrl(value: string, sessionId: string) {
  let uri: ReturnType<typeof parseConvaxUri>
  try {
    uri = parseConvaxUri(value)
  } catch {
    throw new Error("Plugin opened input bearer URL is invalid")
  }
  const segments = uri.pathSegments
  if (
    uri.scheme !== "convax-connected-media" ||
    uri.authority !== sessionId ||
    uri.query ||
    uri.fragment ||
    segments.length !== 1 ||
    segments[0]!.includes("/") ||
    !/^[a-f0-9]{32}$/u.test(segments[0]!)
  ) {
    throw new Error("Plugin opened input bearer URL is invalid")
  }
}

function sanitizeCanvasImageResult(value: unknown) {
  return parsePluginApiResult("canvas.resource.image.create", value)
}

function sanitizeProjectTextResult(value: unknown, requestedPath: string) {
  const result = parsePluginApiResult("project.file.text.read", value)
  if (result.path !== requestedPath) throw new Error("Plugin Project text result changed path")
  return result
}

function sanitizeGenerationTools(value: readonly unknown[], expectedOutput?: string) {
  if (!Array.isArray(value) || value.length > 256) throw new Error("Plugin generation tool catalog is invalid")
  const ids = new Set<string>()
  return value.map((candidate, index) => {
    const tool = exactRecord(
      candidate,
      ["acceptedInputs", "description", "id", "kind", "output", "title"],
      `Plugin generation tool ${index}`,
    )
    const id = boundedString(tool.id, `Plugin generation tool ${index} id`, 256)
    if (ids.has(id)) throw new Error("Plugin generation tool catalog contains duplicate ids")
    ids.add(id)
    const output = generationOutput(tool.output)
    if (expectedOutput && output !== expectedOutput) throw new Error("Plugin generation tool output changed")
    if (tool.kind !== "model" && tool.kind !== "operation") throw new Error("Plugin generation tool kind is invalid")
    if (!Array.isArray(tool.acceptedInputs) || tool.acceptedInputs.length > 6) {
      throw new Error("Plugin generation tool acceptedInputs is invalid")
    }
    return {
      acceptedInputs: structuredClone(tool.acceptedInputs),
      description: boundedString(tool.description, `Plugin generation tool ${index} description`, 2_000),
      id,
      kind: tool.kind,
      output,
      title: boundedString(tool.title, `Plugin generation tool ${index} title`, 120),
    }
  })
}

function sanitizeGenerationResult(value: unknown) {
  return parsePluginApiResult("generation.execute", value)
}

function optionalGenerationReferences(value: unknown) {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length > 32) throw new Error("Plugin generation references are invalid")
  const seen = new Set<string>()
  return value.map((candidate, index): PluginApiGenerationReference => {
    const reference = exactRecord(candidate, ["inputKey", "role"], `Plugin generation reference ${index}`)
    const inputKey = boundedString(reference.inputKey, `Plugin generation reference ${index} input key`, 2_048)
    if (
      reference.role !== "text" &&
      reference.role !== "reference_image" &&
      reference.role !== "reference_video" &&
      reference.role !== "first_frame" &&
      reference.role !== "last_frame" &&
      reference.role !== "audio"
    ) {
      throw new Error("Plugin generation reference role is invalid")
    }
    const key = `${inputKey}\0${reference.role}`
    if (seen.has(key)) throw new Error("Plugin generation references contain duplicates")
    seen.add(key)
    return { inputKey, role: reference.role }
  })
}

function optionalGenerationResultMode(value: unknown) {
  if (value === undefined) return undefined
  if (value !== "create-pending-node" && value !== "return") {
    throw new Error("Plugin generation result mode is invalid")
  }
  return value
}

function optionalGenerationOutput(value: unknown) {
  return value === undefined ? undefined : generationOutput(value)
}

function generationOutput(value: unknown) {
  if (value !== "text" && value !== "image" && value !== "video" && value !== "audio") {
    throw new Error("Plugin generation output is invalid")
  }
  return value
}

function canvasRef(value: unknown) {
  const ref = exactRecord(value, ["canvasId", "projectId"], "Plugin Canvas ref")
  return {
    canvasId: boundedString(ref.canvasId, "Plugin Canvas id", 256),
    projectId: boundedString(ref.projectId, "Plugin Project id", 256),
  }
}

function canvasFilter(value: unknown) {
  const ref = exactRecord(value, ["canvasId", "projectId"], "Plugin Canvas event ref")
  const projectId = boundedString(ref.projectId, "Plugin Project id", 256)
  return ref.canvasId === undefined
    ? { projectId }
    : { canvasId: boundedString(ref.canvasId, "Plugin Canvas id", 256), projectId }
}

function documentProjection(value: unknown) {
  if (value === undefined || value === "geometry") return "geometry" as const
  if (value === "structure") return value
  throw new Error("Plugin Canvas document projection is invalid")
}

function nodeQuery(value: unknown) {
  if (value === undefined) return {}
  const query = exactRecord(value, ["ids", "kinds", "limit", "relatedToNodeIds", "text"], "Plugin node query")
  return structuredClone(query)
}

function requireNoParams(value: unknown) {
  if (value !== undefined) exactRecord(value, [], "Plugin Host API params")
}

function exactRecord(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} must be an object`)
  const allowed = new Set(keys)
  const extra = Object.keys(value).find((key) => !allowed.has(key))
  if (extra) throw new Error(`${label} contains an unsupported field: ${extra}`)
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function boundedString(value: unknown, label: string, maximum: number, allowEmpty = false) {
  if (typeof value !== "string" || (!allowEmpty && !value) || value.length > maximum || value.includes("\0")) {
    throw new Error(`${label} must be a bounded string`)
  }
  return value
}

function nonNegativeInteger(value: unknown, label: string) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} is invalid`)
  }
  return value
}

function optionalFinite(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined
}

function positiveLimit(value: number | undefined, fallback: number, label: string) {
  const limit = value ?? fallback
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error(`${label} must be a positive integer`)
  return limit
}

function sha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value)
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  if (signal.reason instanceof Error) throw signal.reason
  throw new DOMException("Plugin Host API request was canceled", "AbortError")
}

function combineSignals(request: AbortSignal | undefined, connection: AbortSignal) {
  return request === undefined ? connection : AbortSignal.any([request, connection])
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

function assertRendererSafeNode(value: unknown) {
  const forbiddenKeys = new Set([
    "absolutePath",
    "argv",
    "command",
    "environment",
    "executablePath",
    "nativePath",
    "workingDirectory",
  ])
  const visit = (candidate: unknown, key?: string, depth = 0): void => {
    if (depth > 32) throw new Error("Plugin node projection is too deeply nested")
    if (typeof candidate === "string") {
      if (
        (key === "path" || key?.endsWith("Path")) &&
        (candidate.startsWith("/") ||
          candidate.startsWith("file:") ||
          /^[A-Za-z]:[\\/]/u.test(candidate) ||
          candidate.startsWith("\\\\"))
      ) {
        throw new Error("Plugin node projection contains a native path")
      }
      return
    }
    if (!candidate || typeof candidate !== "object") return
    if (Array.isArray(candidate)) {
      candidate.forEach((item) => visit(item, key, depth + 1))
      return
    }
    for (const [childKey, child] of Object.entries(candidate)) {
      if (forbiddenKeys.has(childKey)) throw new Error("Plugin node projection contains native runtime data")
      visit(child, childKey, depth + 1)
    }
  }
  visit(value)
}

function assertNever(value: never): never {
  throw new Error(`Unsupported Plugin Host API call: ${String(value)}`)
}
