import { randomUUID } from "node:crypto"
import type { CanvasApplicationService } from "@convax/canvas/application"

import {
  hasWebPluginCanvasSurface,
  isSupportedWebPluginManifestSchema,
  requireWebPluginId,
  type InstalledWebPluginCanvasSurface,
  type InstalledWebPluginSummary,
} from "../plugin-contracts"
import type { PluginSurfaceCreateInput, PluginSurfaceCreateResult } from "../plugin-surface-contracts"
import type { PluginStateSchemaAuthorityV1 } from "./plugin-state-schema-authority"

interface PluginSurfacePluginStore {
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
 * Main-owned root Plugin surface creation. The Renderer supplies only Project,
 * Canvas, and Plugin ids. Size, schema, snapshot, validation artifact, and
 * initial state are derived from the exact ActiveSet lease.
 */
export class PluginSurfaceService {
  constructor(
    private readonly input: {
      application: Pick<CanvasApplicationService, "execute">
      plugins: PluginSurfacePluginStore
      schemas: Pick<PluginStateSchemaAuthorityV1, "resolveManifestSchema" | "validateState">
    },
  ) {}

  async create(request: PluginSurfaceCreateInput): Promise<PluginSurfaceCreateResult> {
    validateCreateInput(request)
    const active = await this.input.plugins.acquireActivePlugin(request.pluginId)
    try {
      const identity = active.identity
      if (
        !isSupportedWebPluginManifestSchema(active.plugin.schema) ||
        !active.plugin.hostApi ||
        !hasActivePluginIdentity(identity)
      ) {
        throw new Error("Plugin surface contribution is not installed")
      }
      if (!hasWebPluginCanvasSurface(active.plugin)) {
        throw new Error("Plugin surface renderer is unavailable")
      }
      const plugin = active.plugin
      if (plugin.contributes.canvas.renderer.create !== true) {
        throw new Error("Plugin surface creation is not enabled")
      }
      const schema = this.input.schemas.resolveManifestSchema(plugin.contributes.canvas.renderer.stateSchema)
      if (!schema) {
        throw new Error("Plugin surface state schema artifact is unavailable")
      }
      const initialState = Object.freeze({})
      this.input.schemas.validateState(schema, initialState)
      const size = surfaceSize(plugin)
      await this.input.plugins.assertCurrentActivePlugin(identity)
      const result = await this.input.application.execute({
        beforeCommit: async () => {
          await this.input.plugins.assertCurrentActivePlugin(identity)
        },
        canvasId: request.canvasId,
        envelope: {
          actor: { id: "desktop:plugin-surface", kind: "host" },
          command: {
            label: plugin.name,
            plugin: {
              id: identity.pluginId,
              pluginStateSchemaDigest: schema.pluginStateSchemaDigest,
              snapshotDigest: identity.snapshotDigest,
              state: structuredClone(initialState),
              validationArtifact: structuredClone(schema.validationArtifact),
            },
            size,
            type: "plugin.surface.create",
          },
          commandId: `plugin-surface-${randomUUID()}`,
        },
        scopeId: request.projectId,
      })
      const createdNodeId = result.createdNodeIds[0]
      if (!createdNodeId || result.createdNodeIds.length !== 1) {
        throw new Error("Canvas did not create exactly one Plugin surface node")
      }
      return {
        createdNodeId,
        operationReceipt: structuredClone(result.operationReceipt),
        projection: structuredClone(result.document),
      }
    } finally {
      active.release()
    }
  }
}

function surfaceSize(plugin: InstalledWebPluginCanvasSurface) {
  const renderer = plugin.contributes.canvas.renderer
  return Object.freeze({
    height: Math.max(96, renderer.height ?? 420),
    width: Math.max(160, renderer.width ?? 640),
  })
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

function validateCreateInput(input: PluginSurfaceCreateInput) {
  if (!input || typeof input !== "object") throw new Error("Plugin surface create request is required")
  const keys = Object.keys(input).sort()
  if (keys.length !== 3 || keys.join(",") !== "canvasId,pluginId,projectId") {
    throw new Error("Plugin surface create request may contain only projectId, canvasId, and pluginId")
  }
  for (const [label, value, maximum] of [
    ["canvasId", input.canvasId, 256],
    ["pluginId", input.pluginId, 128],
    ["projectId", input.projectId, 256],
  ] as const) {
    if (
      typeof value !== "string" ||
      !value ||
      value !== value.trim() ||
      value.length > maximum ||
      value.includes("\0")
    ) {
      throw new Error(`Plugin surface ${label} is invalid`)
    }
  }
  requireWebPluginId(input.pluginId)
}
