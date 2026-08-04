import { randomUUID } from "node:crypto"
import type { CanvasApplicationService } from "@convax/canvas/application"

import {
  webPluginManifestSchemaV8,
  type InstalledWebPluginCanvasSurface,
  type InstalledWebPluginSummary,
} from "../plugin-contracts"
import { createWebPluginCanvasNode } from "../plugin-canvas-node"
import type { PluginMaterializationInput, PluginMaterializationResult } from "../plugin-materialization-contracts"

interface MaterializationPluginStore {
  acquireActivePlugin(pluginId: string): Promise<{
    identity: {
      activeRevision: number
      activeSetDigest: string
      pluginId: string
      snapshotDigest: string
      version: string
    }
    plugin: InstalledWebPluginSummary
    release(): void
  }>
  assertCurrentActivePlugin(identity: {
    activeRevision: number
    activeSetDigest: string
    pluginId: string
    snapshotDigest: string
    version: string
  }): Promise<void>
}

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
    const active = await this.input.plugins.acquireActivePlugin(request.pluginId)
    try {
      const identity = active.identity
      if (
        active.plugin.schema !== webPluginManifestSchemaV8 ||
        !active.plugin.hostApi ||
        !hasActivePluginIdentity(identity)
      ) {
        throw new Error("Plugin materialization contribution is not installed")
      }
      const plugin = active.plugin
      if (plugin.version !== request.pluginVersion) {
        throw new Error("Plugin changed before its Canvas node was materialized")
      }
      if (!hasInstalledCanvasSurface(plugin)) {
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
      await this.input.plugins.assertCurrentActivePlugin(identity)
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
        },
        scopeId: request.projectId,
      })
      if (!result.createdNodeIds.includes(node.id)) {
        throw new Error("Canvas did not materialize the Plugin node")
      }
      return {
        createdNodeId: node.id,
        operationReceipt: structuredClone(result.operationReceipt),
        projection: structuredClone(result.document),
      }
    } finally {
      active.release()
    }
  }
}

function hasInstalledCanvasSurface(plugin: InstalledWebPluginSummary): plugin is InstalledWebPluginCanvasSurface {
  return typeof plugin.entry === "string" && plugin.contributes.canvas?.renderer !== undefined
}

function hasActivePluginIdentity(identity: {
  activeRevision?: number
  activeSetDigest?: string
  snapshotDigest?: string
}): identity is {
  activeRevision: number
  activeSetDigest: string
  snapshotDigest: string
} {
  return (
    Number.isSafeInteger(identity.activeRevision) &&
    (identity.activeRevision ?? -1) >= 0 &&
    typeof identity.activeSetDigest === "string" &&
    /^[a-f0-9]{64}$/.test(identity.activeSetDigest) &&
    typeof identity.snapshotDigest === "string" &&
    /^[a-f0-9]{64}$/.test(identity.snapshotDigest)
  )
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
    if (
      typeof value !== "string" ||
      !value ||
      value !== value.trim() ||
      value.length > maximum ||
      value.includes("\0")
    ) {
      throw new Error(`Plugin materialization ${label} is invalid`)
    }
  }
}
