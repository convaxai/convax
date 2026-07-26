import { randomUUID } from "node:crypto"
import type { CanvasApplicationService } from "@convax/canvas/application"

import { hasWebPluginCanvasSurface, webPluginManifestSchemaV7 } from "../plugin-contracts"
import { createWebPluginCanvasNode } from "../plugin-canvas-node"
import type {
  PluginMaterializationInput,
  PluginMaterializationResult,
} from "../plugin-materialization-contracts"
import type { WebPluginManager } from "./plugin-manager"

type MaterializationPluginStore = Pick<WebPluginManager, "resolveCapabilityIdentity" | "withPluginMutation">

/**
 * Main-only admission path for a declarative "materialize my own renderer"
 * action. Plugin identity and the target node shape are derived from the
 * currently installed manifest while its publication lock is held.
 */
export class PluginMaterializationService {
  constructor(
    private readonly input: {
      application: Pick<CanvasApplicationService, "execute">
      plugins: MaterializationPluginStore
    },
  ) {}

  async materialize(request: PluginMaterializationInput): Promise<PluginMaterializationResult> {
    validateMaterializationInput(request)
    return this.input.plugins.withPluginMutation(request.pluginId, async (mutation) => {
      const identity = await this.input.plugins.resolveCapabilityIdentity(request.pluginId, mutation)
      if (!identity || identity.plugin.schema !== webPluginManifestSchemaV7) {
        throw new Error("Plugin materialization contribution is not installed")
      }
      const plugin = identity.plugin
      if (plugin.version !== request.pluginVersion) {
        throw new Error("Plugin changed before its Canvas node was materialized")
      }
      if (!hasWebPluginCanvasSurface(plugin)) {
        throw new Error("Plugin materialization renderer is unavailable")
      }
      const contribution = plugin.contributes.canvas.selectionActions?.find(
        (candidate) => candidate.id === request.actionId,
      )
      if (!contribution || !("action" in contribution)) {
        throw new Error("Plugin materialization action is unavailable")
      }
      if (
        contribution.action.type !== "materialize-own-plugin-node" ||
        contribution.action.connect !== "selection-to-created"
      ) {
        throw new Error("Plugin materialization action is not supported")
      }

      const node = createWebPluginCanvasNode(plugin, {
        // Canvas owns the authoritative open placement beside the source.
        position: { x: 0, y: 0 },
      })
      const result = await this.input.application.execute({
        canvasId: request.canvasId,
        envelope: {
          actor: { id: `${plugin.id}@${plugin.version}`, kind: "plugin" },
          command: {
            node,
            sourceKind: contribution.target,
            sourceNodeId: request.sourceNodeId,
            type: "nodes.materialize-connected",
          },
          commandId: `plugin-materialize-${randomUUID()}`,
          expectedRevision: request.expectedRevision,
        },
        scopeId: request.projectId,
      })
      if (!result.createdNodeIds.includes(node.id)) {
        throw new Error("Canvas did not materialize the Plugin node")
      }
      return { createdNodeId: node.id, revision: result.document.revision }
    })
  }
}

function validateMaterializationInput(input: PluginMaterializationInput) {
  if (!input || typeof input !== "object") throw new Error("Plugin materialization request is required")
  for (const [label, value, maximum] of [
    ["actionId", input.actionId, 80],
    ["canvasId", input.canvasId, 256],
    ["pluginId", input.pluginId, 128],
    ["pluginVersion", input.pluginVersion, 128],
    ["projectId", input.projectId, 256],
    ["sourceNodeId", input.sourceNodeId, 256],
  ] as const) {
    if (typeof value !== "string" || !value || value !== value.trim() || value.length > maximum || value.includes("\0")) {
      throw new Error(`Plugin materialization ${label} is invalid`)
    }
  }
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) {
    throw new Error("Plugin materialization expectedRevision must be a non-negative integer")
  }
}
