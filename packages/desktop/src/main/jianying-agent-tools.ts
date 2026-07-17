import type { AgentToolDefinition, AgentToolProvider, AgentToolScope } from "@convax/agent-runtime"

import type { JianyingClient, JianyingExportTarget } from "../jianying-contracts"

const nonEmptyString = { minLength: 1, type: "string" }

const tools = [
  {
    description:
      "Inspect the stable, currently open JianYing draft before exporting Canvas media. The short-lived draftToken must be passed to jianying_export_canvas_media. If status is active, ask the user whether to use that draft or create a new draft. Current-draft export can proceed immediately. Creating a new draft while another draft is open is a macOS WIP: ask the user to return JianYing to its home screen, inspect again, and proceed only after status becomes no_active_draft or not_running.",
    inputSchema: { additionalProperties: false, properties: {}, type: "object" },
    name: "jianying_get_draft_status",
  },
  {
    description:
      "Export Project-backed image/video Canvas nodes to JianYing's material panel and timeline. Always call jianying_get_draft_status first. When it reports active, ask the user to choose current or new; never choose silently. Use current immediately when chosen. If the user chooses new, ask them to return JianYing to its home screen and inspect again; active-to-new is WIP and fails closed. Target new only from a no_active_draft or not_running observation. Ambiguous, unavailable, and unsupported states must not be treated as no active draft.",
    inputSchema: {
      additionalProperties: false,
      properties: {
        expectedRevision: { minimum: 0, type: "integer" },
        nodeIds: { items: nonEmptyString, maxItems: 500, minItems: 1, type: "array", uniqueItems: true },
        target: {
          additionalProperties: false,
          properties: {
            draftToken: nonEmptyString,
            kind: { enum: ["current", "new"], type: "string" },
          },
          required: ["draftToken", "kind"],
          type: "object",
        },
      },
      required: ["expectedRevision", "nodeIds", "target"],
      type: "object",
    },
    name: "jianying_export_canvas_media",
  },
] as const satisfies readonly AgentToolDefinition[]

export function createJianyingAgentToolProvider(
  client: JianyingClient,
  options: {
    isEnabled: () => boolean | Promise<boolean>
    resolveActiveCanvas: (scope: AgentToolScope) => Promise<{
      canvasId: string
      revision: number
      scopeId: string
    } | null>
  },
): AgentToolProvider {
  return {
    listTools: async () => ((await options.isEnabled()) ? tools : []),
    async callTool(scope, name, input) {
      if (!(await options.isEnabled())) throw new Error("The built-in JianYing Plugin is not installed")
      if (name === "jianying_get_draft_status") {
        if (Object.keys(input).length !== 0) throw new Error("jianying_get_draft_status does not accept arguments")
        return client.getDraftStatus()
      }
      if (name !== "jianying_export_canvas_media") throw new Error(`Unknown JianYing tool: ${name}`)
      if (Object.keys(input).some((key) => !["expectedRevision", "nodeIds", "target"].includes(key))) {
        throw new Error("JianYing export input contains unsupported fields")
      }
      const nodeIds = requiredStringArray(input.nodeIds, "nodeIds")
      const expectedRevision = requiredInteger(input.expectedRevision, "expectedRevision")
      const targetInput = record(input.target, "target")
      const kind = requiredString(targetInput.kind, "target.kind")
      if (kind !== "current" && kind !== "new") throw new Error("target.kind must be current or new")
      if (Object.keys(targetInput).some((key) => key !== "kind" && key !== "draftToken")) {
        throw new Error("target contains unsupported fields")
      }
      const target: JianyingExportTarget = {
        draftToken: requiredString(targetInput.draftToken, "target.draftToken"),
        kind,
      }
      const activeCanvas = await options.resolveActiveCanvas(scope)
      if (!activeCanvas || activeCanvas.scopeId !== scope.scopeId) {
        throw new Error("A live Canvas in the active Project is required for JianYing export")
      }
      if (activeCanvas.revision !== expectedRevision) {
        throw new Error(
          `The active Canvas changed before JianYing export (expected revision ${expectedRevision}, found ${activeCanvas.revision})`,
        )
      }
      return client.exportCanvasMedia({
        expectedRevision,
        nodeIds,
        ref: { canvasId: activeCanvas.canvasId, scopeId: activeCanvas.scopeId },
        target,
      })
    },
  }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as Record<string, unknown>
}

function requiredString(value: unknown, label: string) {
  if (typeof value !== "string" || !value) throw new Error(`${label} must be a non-empty string`)
  return value
}

function requiredInteger(value: unknown, label: string) {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(`${label} must be a non-negative integer`)
  return value as number
}

function requiredStringArray(value: unknown, label: string) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 500)
    throw new Error(`${label} must be a non-empty array`)
  const items = value.map((item, index) => requiredString(item, `${label}[${index}]`))
  if (new Set(items).size !== items.length) throw new Error(`${label} contains duplicate ids`)
  return items
}
