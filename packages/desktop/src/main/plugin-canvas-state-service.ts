import type { CanvasNode } from "@convax/canvas"
import type { PluginRequirementV2, PluginStateEnvelopeV2 } from "@convax/canvas/collaboration"

import type { PluginHostMutationCheckpoint, PluginHostNodeBinding } from "../plugin-host-api-main-contracts"
import type { PluginPrincipal } from "../plugin-capability-contracts"
import { matchesWebPluginCanvasNodeIdentity, webPluginNodeMetadata } from "../plugin-canvas-node"
import { PluginHostApiError, PluginHostApiResourceUnavailableError } from "../plugin-host-errors"
import type { CanvasCollaborationSessionOwnerV2 } from "./canvas-collaboration-session-owner"
import type { PluginStateSchemaAuthorityV1 } from "./plugin-state-schema-authority"

export interface PluginCanvasStateServiceOptionsV1 {
  readonly canvas: Pick<CanvasCollaborationSessionOwnerV2, "queryAuthoritative" | "submitAuthoritative">
  readonly schemas: Pick<PluginStateSchemaAuthorityV1, "resolvePrincipal" | "validateState">
}

/** Main-only bridge from an exact leased Plugin schema to the canonical Canvas owner command. */
export class PluginCanvasStateServiceV1 {
  constructor(private readonly options: PluginCanvasStateServiceOptionsV1) {}

  async replace(input: {
    readonly binding: PluginHostNodeBinding
    readonly checkpoint: PluginHostMutationCheckpoint
    readonly commandId: string
    readonly principal: PluginPrincipal
    readonly signal?: AbortSignal
    readonly state: Readonly<Record<string, unknown>>
  }) {
    throwIfAborted(input.signal)
    const schema = await this.options.schemas.resolvePrincipal(input.principal, input.signal)
    if (schema === null) {
      throw new PluginHostApiResourceUnavailableError("Plugin does not declare an immutable Canvas state schema")
    }
    try {
      this.options.schemas.validateState(schema, input.state)
    } catch (error) {
      throw new PluginHostApiResourceUnavailableError("Plugin state does not conform to its immutable schema", {
        cause: error,
      })
    }

    await input.checkpoint.checkpoint()
    const ref = { canvasId: input.binding.canvasId, scopeId: input.binding.projectId }
    const projected = await this.options.canvas.queryAuthoritative(ref)
    const node = requireExactOwnedNode(projected.document.nodes, input.binding, input.principal, schema.pluginStateSchemaDigest)
    const entity = projected.nodeEntities.find((candidate) => candidate.nodeId === node.id)?.entity
    if (!entity) throw new PluginHostApiError("stale-context", "Plugin Canvas node incarnation is unavailable")

    const owner: PluginRequirementV2 = Object.freeze({
      pluginId: input.principal.pluginId,
      snapshotDigest: input.principal.snapshotDigest as PluginRequirementV2["snapshotDigest"],
      pluginStateSchemaDigest: schema.pluginStateSchemaDigest,
      validationArtifact: schema.validationArtifact,
    })
    const plugin: PluginStateEnvelopeV2 = Object.freeze({
      format: "convax.canvas-plugin-state/2",
      ...owner,
      state: structuredClone(input.state),
    })

    await input.checkpoint.checkpoint()
    const committed = await this.options.canvas.submitAuthoritative({
      ref,
      caller: "plugin",
      actor: { id: input.principal.pluginId, kind: "plugin" },
      commandId: input.commandId,
      command: {
        kind: "plugin-state-set",
        node: entity,
        owner,
        plugin,
      },
      signal: input.signal,
    })
    return Object.freeze({
      document: committed.projection,
      node: requireExactOwnedNode(
        committed.projection.nodes,
        input.binding,
        input.principal,
        schema.pluginStateSchemaDigest,
      ),
      operationReceipt: committed.operationReceipt,
    })
  }
}

function requireExactOwnedNode(
  nodes: readonly CanvasNode[],
  binding: PluginHostNodeBinding,
  principal: PluginPrincipal,
  pluginStateSchemaDigest: string,
): CanvasNode {
  const node = nodes.find((candidate) => candidate.id === binding.nodeId)
  const identity = node ? webPluginNodeMetadata(node.data)?.convaxPlugin : undefined
  if (
    !node ||
    !matchesWebPluginCanvasNodeIdentity(principal.pluginId, node.data) ||
    !identity ||
    typeof identity !== "object" ||
    Array.isArray(identity) ||
    (identity as { snapshotDigest?: unknown }).snapshotDigest !== principal.snapshotDigest ||
    (identity as { pluginStateSchemaDigest?: unknown }).pluginStateSchemaDigest !== pluginStateSchemaDigest
  ) {
    throw new PluginHostApiError("stale-context", "Plugin no longer owns the exact canonical Canvas node state")
  }
  return node
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException("The operation was aborted", "AbortError")
}
