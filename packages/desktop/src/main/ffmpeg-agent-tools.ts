import { randomUUID } from "node:crypto"
import type { AgentToolDefinition, AgentToolProvider, AgentToolScope } from "@convax/agent-runtime"
import type {
  GenerationCanvasRequest,
  GenerationCanvasResult,
  GenerationInputRole,
  GenerationOutputModality,
  GenerationToolSummary,
} from "../generation-contracts"
import { GenerationToolReportedError } from "./generation-canvas-service"
import type { GenerationCanvasAgentPort } from "./generation-agent-tools"

export interface FfmpegAgentActiveCanvas {
  canvasId: string
  revision: number
  scopeId: string
}

export interface FfmpegAgentToolProviderOptions {
  resolveActiveCanvas(): Promise<FfmpegAgentActiveCanvas | null>
}

interface FfmpegAgentToolConfig {
  agentName: string
  output: FfmpegOutputModality
  toolId: string
}

type FfmpegOutputModality = Exclude<GenerationOutputModality, "text">

const ffmpegPluginId = "ffmpeg-tools"
const outputPlaceholder = "{{output}}"
const maximumArgumentCount = 256
const maximumArgumentLength = 1_024
const maximumArgumentsJsonLength = 4_096
const maximumOutputNameLength = 128
const maximumReferences = 16
const maximumRelationNodeIds = 16
const canvasNodeIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/u

const outputExtensions: Readonly<Record<FfmpegOutputModality, readonly string[]>> = {
  audio: ["flac", "m4a", "mp3", "ogg", "wav"],
  image: ["gif", "jpeg", "jpg", "png", "webp"],
  video: ["mov", "mp4", "webm"],
}

const ffmpegToolConfigs: readonly FfmpegAgentToolConfig[] = [
  { agentName: "ffmpeg_run_image", output: "image", toolId: `${ffmpegPluginId}/run.image` },
  { agentName: "ffmpeg_run_video", output: "video", toolId: `${ffmpegPluginId}/run.video` },
  { agentName: "ffmpeg_run_audio", output: "audio", toolId: `${ffmpegPluginId}/run.audio` },
]

const topLevelFields = new Set(["anchor", "arguments", "outputName", "references", "relationNodeIds"])

/**
 * Direct Agent surface for the installed FFmpeg Tool Plugin. It intentionally
 * does not expose the companion's raw MCP envelope or native paths: execution
 * still goes through GenerationCanvasService so outputs remain verified,
 * managed, committed, and related to their Canvas inputs.
 */
export function createFfmpegAgentToolProvider(
  service: GenerationCanvasAgentPort,
  options: FfmpegAgentToolProviderOptions,
): AgentToolProvider {
  return {
    async listTools() {
      const installed = await installedFfmpegTools(service)
      return ffmpegToolConfigs.flatMap((config) => {
        const tool = installed.get(config.toolId)
        return tool ? [definition(config, tool)] : []
      })
    },

    async callTool(scope, name, input, context) {
      const config = ffmpegToolConfigs.find((candidate) => candidate.agentName === name)
      if (!config) throw new Error(`Unknown FFmpeg Plugin tool: ${name}`)
      const tool = (await installedFfmpegTools(service)).get(config.toolId)
      if (!tool) throw new Error(`FFmpeg Plugin tool is not installed: ${config.toolId}`)
      const active = await requireActiveCanvas(scope, options)
      const parsed = parseInput(input, tool, config.output)
      const request: GenerationCanvasRequest = {
        anchor: parsed.anchor,
        expectedOutputCount: 1,
        expectedRevision: active.revision,
        operationId: `ffmpeg-${randomUUID()}`,
        output: config.output,
        prompt: `Run ${config.toolId} through the installed FFmpeg Tools Plugin.`,
        ref: { canvasId: active.canvasId, scopeId: active.scopeId },
        references: parsed.references,
        ...(parsed.relationNodeIds.length ? { relationAnchorNodeIds: parsed.relationNodeIds } : {}),
        toolId: config.toolId,
        toolInput: {
          arguments_json: JSON.stringify(parsed.arguments),
          output_name: parsed.outputName,
        },
      }
      let result: GenerationCanvasResult
      try {
        result = await service.generate(
          request,
          { id: `opencode:${requiredIdentifier(scope.scopeId, "Agent scope id")}`, kind: "agent" },
          context?.signal,
        )
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") throw error
        if (error instanceof GenerationToolReportedError) {
          throw reportedFfmpegError(error)
        }
        throw hiddenFfmpegExecutionError()
      }
      return {
        changed: result.createdNodeIds.length > 0,
        createdNodeIds: result.createdNodeIds,
        revision: result.revision,
        toolId: result.toolId,
        warnings: result.warnings,
      }
    },
  }
}

function definition(config: FfmpegAgentToolConfig, tool: GenerationToolSummary): AgentToolDefinition {
  const encodingGuidance =
    config.output === "video"
      ? " The current official Apple Silicon companion guarantees h264_videotoolbox with -allow_sw 1, AAC, and yuv420p; do not assume libx264 is installed."
      : ""
  return {
    name: config.agentName,
    description:
      `Run the installed FFmpeg Tools Plugin directly and create one managed Canvas ${config.output} node connected to its input nodes. ` +
      "Pass FFmpeg argv as literal tokens without the ffmpeg executable or shell quoting. Use {{input:N}} for references in array order and {{output}} exactly once as the final token. The host derives the active Canvas and revision." +
      encodingGuidance,
    inputSchema: {
      additionalProperties: false,
      properties: {
        anchor: {
          additionalProperties: false,
          description: "Optional preferred Canvas position. The host finds a non-overlapping position from this point.",
          properties: { x: { type: "number" }, y: { type: "number" } },
          required: ["x", "y"],
          type: "object",
        },
        arguments: {
          description: "Tokenized FFmpeg argv using host placeholders; never a shell command.",
          items: { maxLength: maximumArgumentLength, type: "string" },
          maxItems: maximumArgumentCount,
          minItems: 1,
          type: "array",
        },
        outputName: {
          description: `Portable ASCII basename for the new ${config.output} artifact. Supported extensions: ${outputExtensions[config.output].join(", ")}.`,
          maxLength: maximumOutputNameLength,
          minLength: 3,
          pattern: "^[A-Za-z0-9][A-Za-z0-9._-]*$",
          type: "string",
        },
        references: {
          description: "Ordered Canvas inputs addressed by {{input:0}}, {{input:1}}, and so on.",
          items: {
            additionalProperties: false,
            properties: {
              nodeId: { minLength: 1, type: "string" },
              role: { enum: [...tool.acceptedInputs], type: "string" },
            },
            required: ["nodeId", "role"],
            type: "object",
          },
          maxItems: maximumReferences,
          minItems: 1,
          type: "array",
        },
        relationNodeIds: {
          description:
            "Optional Canvas nodes to connect to the result without staging them as FFmpeg inputs. Use this to link paired outputs.",
          items: { minLength: 1, type: "string" },
          maxItems: maximumRelationNodeIds,
          type: "array",
          uniqueItems: true,
        },
      },
      required: ["arguments", "outputName", "references"],
      type: "object",
    },
  }
}

function reportedFfmpegError(error: GenerationToolReportedError) {
  return new Error(error.message.replace(/^Generation tool/u, "FFmpeg Plugin"))
}

function hiddenFfmpegExecutionError() {
  return new Error("FFmpeg Plugin operation could not be completed because the Canvas or input state changed")
}

async function installedFfmpegTools(service: GenerationCanvasAgentPort) {
  const tools = await service.listTools()
  const installed = new Map<string, GenerationToolSummary>()
  for (const config of ffmpegToolConfigs) {
    const tool = tools.find((candidate) => candidate.id === config.toolId)
    if (!tool) continue
    if (
      tool.pluginId !== ffmpegPluginId ||
      tool.toolId !== config.toolId.slice(`${ffmpegPluginId}/`.length) ||
      tool.output !== config.output ||
      !Array.isArray(tool.acceptedInputs) ||
      tool.acceptedInputs.length === 0
    ) {
      throw new Error(`Installed FFmpeg Plugin declaration is invalid: ${config.toolId}`)
    }
    installed.set(config.toolId, tool)
  }
  return installed
}

async function requireActiveCanvas(scope: AgentToolScope, options: FfmpegAgentToolProviderOptions) {
  const active = await options.resolveActiveCanvas()
  if (!active || active.scopeId !== scope.scopeId) {
    throw new Error("Open a Canvas in the active Agent Project before running the FFmpeg Plugin")
  }
  requiredIdentifier(active.canvasId, "Active Canvas id")
  requiredIdentifier(active.scopeId, "Active Canvas scope id")
  if (!Number.isSafeInteger(active.revision) || active.revision < 0) {
    throw new Error("Active Canvas revision is invalid")
  }
  return active
}

function parseInput(value: Record<string, unknown>, tool: GenerationToolSummary, output: FfmpegOutputModality) {
  rejectUnknownFields(value, topLevelFields, "FFmpeg Plugin input")
  const references = parseReferences(value.references, tool.acceptedInputs)
  const arguments_ = parseArguments(value.arguments, references.length)
  return {
    anchor: value.anchor === undefined ? { x: 0, y: 0 } : point(value.anchor, "anchor"),
    arguments: arguments_,
    outputName: portableOutputName(value.outputName, output),
    references,
    relationNodeIds: parseRelationNodeIds(value.relationNodeIds),
  }
}

function parseRelationNodeIds(value: unknown) {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > maximumRelationNodeIds) {
    throw new Error(`relationNodeIds must contain at most ${maximumRelationNodeIds} Canvas nodes`)
  }
  const nodeIds = value.map((nodeId, index) => canvasNodeId(nodeId, `relationNodeIds[${index}]`))
  if (new Set(nodeIds).size !== nodeIds.length) throw new Error("relationNodeIds contains a duplicate node id")
  return nodeIds
}

function parseArguments(value: unknown, referenceCount: number) {
  if (!Array.isArray(value) || value.length === 0 || value.length > maximumArgumentCount) {
    throw new Error(`arguments must contain between 1 and ${maximumArgumentCount} tokens`)
  }
  const arguments_ = value.map((token, index) => {
    if (
      typeof token !== "string" ||
      !token ||
      token.length > maximumArgumentLength ||
      /[\u0000-\u001f\u007f]/u.test(token) ||
      /^\s+$/u.test(token)
    ) {
      throw new Error(`arguments[${index}] must be a bounded non-empty token`)
    }
    return token
  })
  if (
    arguments_.filter((token) => token === outputPlaceholder).length !== 1 ||
    arguments_.at(-1) !== outputPlaceholder
  ) {
    throw new Error("arguments must contain {{output}} exactly once as the final token")
  }
  for (let index = 0; index < referenceCount; index += 1) {
    if (!arguments_.includes(`{{input:${index}}}`)) {
      throw new Error(`arguments must reference ordered Canvas input {{input:${index}}}`)
    }
  }
  if (JSON.stringify(arguments_).length > maximumArgumentsJsonLength) throw new Error("arguments are too large")
  return arguments_
}

function parseReferences(value: unknown, acceptedRoles: readonly GenerationInputRole[]) {
  if (!Array.isArray(value) || value.length === 0 || value.length > maximumReferences) {
    throw new Error(`references must contain between 1 and ${maximumReferences} Canvas nodes`)
  }
  const accepted = new Set<string>(acceptedRoles)
  const pairs = new Set<string>()
  return value.map((item, index) => {
    const label = `references[${index}]`
    const input = record(item, label)
    rejectUnknownFields(input, new Set(["nodeId", "role"]), label)
    const nodeId = canvasNodeId(input.nodeId, `${label}.nodeId`)
    if (!isAcceptedGenerationRole(input.role, accepted)) {
      throw new Error(`${label}.role is not accepted by the installed FFmpeg tool`)
    }
    const role = input.role
    const pair = `${nodeId}\0${role}`
    if (pairs.has(pair)) throw new Error("references contains a duplicate node and role")
    pairs.add(pair)
    return { nodeId, role }
  })
}

function portableOutputName(value: unknown, output: FfmpegOutputModality) {
  const name = requiredIdentifier(value, "outputName")
  const separator = name.lastIndexOf(".")
  const stem = separator > 0 ? name.slice(0, separator) : ""
  const extension = separator > 0 ? name.slice(separator + 1).toLocaleLowerCase("en-US") : ""
  if (
    name.length > maximumOutputNameLength ||
    name === "." ||
    name === ".." ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(name) ||
    !stem ||
    /[. ]$/u.test(name) ||
    /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/iu.test(stem) ||
    !outputExtensions[output].includes(extension)
  ) {
    throw new Error(`outputName must be a portable ${output} basename with a supported extension`)
  }
  return name
}

function point(value: unknown, label: string) {
  const input = record(value, label)
  rejectUnknownFields(input, new Set(["x", "y"]), label)
  if (typeof input.x !== "number" || !Number.isFinite(input.x)) throw new Error(`${label}.x must be finite`)
  if (typeof input.y !== "number" || !Number.isFinite(input.y)) throw new Error(`${label}.y must be finite`)
  return { x: input.x, y: input.y }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`)
  const result: Record<string, unknown> = {}
  for (const key of Object.keys(value)) {
    const entry: unknown = Reflect.get(value, key)
    Object.defineProperty(result, key, {
      configurable: true,
      enumerable: true,
      value: entry,
      writable: true,
    })
  }
  return result
}

function isAcceptedGenerationRole(value: unknown, accepted: ReadonlySet<string>): value is GenerationInputRole {
  return typeof value === "string" && accepted.has(value)
}

function rejectUnknownFields(value: Record<string, unknown>, allowed: ReadonlySet<string>, label: string) {
  const unknown = Object.keys(value).find((key) => !allowed.has(key))
  if (unknown) throw new Error(`${label} contains unsupported field: ${unknown}`)
}

function requiredIdentifier(value: unknown, label: string) {
  if (
    typeof value !== "string" ||
    !value ||
    value !== value.trim() ||
    value.length > 256 ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new Error(`${label} must be a non-empty, trimmed string`)
  }
  return value
}

function canvasNodeId(value: unknown, label: string) {
  const nodeId = requiredIdentifier(value, label)
  if (!canvasNodeIdPattern.test(nodeId)) throw new Error(`${label} must be an opaque Canvas node id`)
  return nodeId
}
