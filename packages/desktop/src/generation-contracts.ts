export type GenerationOutputModality = "text" | "image" | "video" | "audio"

export const generationIpcChannels = {
  cancel: "generation:cancel",
  describeTool: "generation:describe-tool",
  generate: "generation:generate",
  listTools: "generation:list-tools",
} as const

export type GenerationInputRole =
  | "text"
  | "reference_image"
  | "reference_video"
  | "first_frame"
  | "last_frame"
  | "audio"

export interface GenerationToolSummary {
  /** Host-stable id composed from the installed Plugin and its declared tool. */
  id: string
  pluginId: string
  pluginName: string
  toolId: string
  title: string
  description: string
  output: GenerationOutputModality
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

/** Host-derived relationship guard used by card/Plugin callers. */
export interface GenerationReferenceConstraint {
  ownerNodeId: string
  type: "direct-incoming"
}

export interface GenerationCanvasRequest {
  operationId: string
  ref: {
    scopeId: string
    canvasId: string
  }
  expectedRevision: number
  prompt: string
  /** Omit only when exactly one installed tool can satisfy the request. */
  toolId?: string
  /** Tool-owned scalar inputs validated in Main against its current MCP input schema. */
  toolInput?: GenerationToolInput
  output?: GenerationOutputModality
  references: readonly GenerationCanvasReference[]
  /** Never accepted from sandboxed Plugin payloads; the trusted host derives it from the owning card. */
  referenceConstraint?: GenerationReferenceConstraint
  anchor: {
    x: number
    y: number
  }
}

export interface GenerationCanvasResult {
  createdNodeIds: readonly string[]
  revision: number
  toolId: string
  warnings: readonly string[]
}

export interface GenerationListToolsRequest {
  output?: GenerationOutputModality
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
  cancel(input: GenerationCancelRequest): void
  describeTool(input: GenerationDescribeToolRequest): Promise<GenerationToolDescription>
  generate(input: GenerationCanvasRequest): Promise<GenerationCanvasResult>
  listTools(input: GenerationListToolsRequest): Promise<readonly GenerationToolSummary[]>
}
