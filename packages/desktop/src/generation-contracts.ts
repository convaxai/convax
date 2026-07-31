export type GenerationOutputModality = "text" | "image" | "video" | "audio"
export type GenerationToolKind = "model" | "operation"
export type GenerationToolDelivery = "canvas" | "return"
export type GenerationToolInputBinding = "direct-incoming"

export const generationIpcChannels = {
  cancel: "generation:cancel",
  describeTool: "generation:describe-tool",
  generate: "generation:generate",
  listTools: "generation:list-tools",
  reconcileCanvas: "generation:reconcile-canvas",
} as const

export const generationCanvasRevisionConflictCode = "CONVAX_GENERATION_CANVAS_REVISION_CONFLICT"

export function isGenerationCanvasRevisionConflictFailure(failure: unknown) {
  return failure instanceof Error && failure.message.includes(generationCanvasRevisionConflictCode)
}

export type GenerationInputRole =
  | "text"
  | "reference_image"
  | "reference_video"
  | "first_frame"
  | "last_frame"
  | "audio"

export interface GenerationToolSummary {
  /**
   * Host-stable selection id. Static tools use the installed Plugin/tool id;
   * runtime-catalog models use an opaque host-derived id that does not expose
   * the Plugin's model selector value.
   */
  id: string
  /** Declarative v3 classification; legacy v2 generation tools are models. */
  kind: GenerationToolKind
  /** Concrete model display name, intentionally excluding the owning service name. */
  modelName?: string
  pluginId: string
  pluginName: string
  /** Plugin-local dedicated Agent tool id for v3 operations. */
  agentId?: string
  /** Declarative result destination. Omission preserves the legacy Canvas result behavior. */
  delivery?: GenerationToolDelivery
  /** Optional host-enforced binding for Canvas reference inputs. */
  inputBinding?: GenerationToolInputBinding
  /** Plugin-local manifest tool id. Runtime model variants retain their shared base tool id. */
  toolId: string
  title: string
  description: string
  output: GenerationOutputModality
  /** Present only when manifest and runtime satisfy the complete generic recovery contract. */
  recovery?: "long-running-operation"
  acceptedInputs: readonly GenerationInputRole[]
}

export type GenerationToolInputValue = string | number | boolean

export type GenerationToolInput = Readonly<Record<string, GenerationToolInputValue>>

interface GenerationToolInputFieldBase {
  description?: string
  id: string
  label: string
  required: boolean
}

export interface GenerationToolSelectField extends GenerationToolInputFieldBase {
  choices: readonly {
    label: string
    value: string
  }[]
  defaultValue?: string
  kind: "select"
}

export interface GenerationToolTextField extends GenerationToolInputFieldBase {
  defaultValue?: string
  kind: "text"
  maxLength: number
  minLength: number
}

export interface GenerationToolNumberField extends GenerationToolInputFieldBase {
  defaultValue?: number
  kind: "number" | "integer"
  maximum: number
  minimum: number
}

export interface GenerationToolBooleanField extends GenerationToolInputFieldBase {
  defaultValue?: boolean
  kind: "boolean"
}

/** Renderer-safe projection of one MCP tool's current top-level input schema. */
export type GenerationToolInputField =
  | GenerationToolSelectField
  | GenerationToolTextField
  | GenerationToolNumberField
  | GenerationToolBooleanField

export interface GenerationToolDescription {
  fields: readonly GenerationToolInputField[]
  toolId: string
}

export interface GenerationCanvasReference {
  nodeId: string
  role: GenerationInputRole
}

/** Host-neutral Canvas mutation for admitted results. Omission means add after generation completes. */
export type GenerationResultMode =
  | { type: "add" }
  | { type: "create-pending-node" }
  | { nodeId: string; type: "replace-node" }
  /** Trusted host-only mode for a text operation whose declared delivery is `return`. */
  | { type: "return" }

/** Host-derived relationship guard used by card/Plugin callers. */
export interface GenerationReferenceConstraint {
  ownerNodeId: string
  /** Present for manifest-declared bindings and derived from the installed tool, never from Agent input. */
  ownerPluginId?: string
  type: "direct-incoming"
}

export interface GenerationCanvasRequest {
  operationId: string
  ref: {
    scopeId: string
    canvasId: string
  }
  expectedRevision: number
  /** Trusted host-only output cardinality guard; this never enters the Tool Plugin input. */
  expectedOutputCount?: number
  prompt: string
  /**
   * Canvas text nodes whose authoritative content Main appends to `prompt`.
   * These ids never become model reference inputs or cross into the Tool Plugin.
   */
  promptContextNodeIds?: readonly string[]
  /** Omit only when exactly one installed tool can satisfy the request. */
  toolId?: string
  /** Tool-owned scalar inputs validated in Main against its current MCP input schema. */
  toolInput?: GenerationToolInput
  output?: GenerationOutputModality
  references: readonly GenerationCanvasReference[]
  /** Trusted host-only relation anchors; these never enter the Tool Plugin input. */
  relationAnchorNodeIds?: readonly string[]
  resultMode?: GenerationResultMode
  /** Never accepted from sandboxed Plugin payloads; the trusted host derives it from the owning card. */
  referenceConstraint?: GenerationReferenceConstraint
  anchor: {
    x: number
    y: number
  }
}

export interface GenerationCanvasResult {
  createdNodeIds: readonly string[]
  /** Present only for a text operation whose declared delivery is `return`. */
  outputText?: string
  revision: number
  toolId: string
  warnings: readonly string[]
}

export interface GenerationCanvasReconcileRequest {
  ref: {
    canvasId: string
    scopeId: string
  }
}

export interface GenerationCanvasReconcileResult {
  failedNodeIds: readonly string[]
  revision: number
}

export interface GenerationListToolsRequest {
  output?: GenerationOutputModality
  refresh?: boolean
  scopeId: string
}

export interface GenerationDescribeToolRequest {
  scopeId: string
  toolId: string
}

export interface GenerationCancelRequest {
  operationId: string
}

export interface GenerationClient {
  cancel(input: GenerationCancelRequest): Promise<void>
  describeTool(input: GenerationDescribeToolRequest): Promise<GenerationToolDescription>
  generate(input: GenerationCanvasRequest): Promise<GenerationCanvasResult>
  listTools(input: GenerationListToolsRequest): Promise<readonly GenerationToolSummary[]>
  reconcileCanvas(input: GenerationCanvasReconcileRequest): Promise<GenerationCanvasReconcileResult>
}
