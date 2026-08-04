import {
  assertPortableKeys,
  parsePortableStableId,
  parsePortableStringArray,
  portableArray,
  portableRecord,
  portableText,
} from "./primitives"
import {
  parsePortablePluginCanvasUiContribution,
  type PortablePluginUiCommand,
  type PortablePluginUiMenuItem,
  type PortablePluginUiToolbarItem,
} from "./ui"
import { parsePortablePluginStateSchemaV1, type PortableBoundedValueSchemaV1 } from "./state-schema"

export interface PortablePluginCanvasRendererContribution {
  readonly create?: boolean
  readonly extensions?: readonly string[]
  readonly height?: number
  readonly mimeTypes?: readonly string[]
  readonly nodeKinds?: readonly string[]
  readonly stateSchema?: PortableBoundedValueSchemaV1
  readonly width?: number
}

export interface PortablePluginLocalizedText {
  readonly default: string
  readonly "zh-CN"?: string
}

export type PortablePluginCanvasSelectionActionEditor =
  | "time-point"
  | "time-range"
  | "crop-region"
  | "confirmation"
  | "immediate"

export interface PortablePluginCanvasSelectionActionStep {
  readonly tool: string
}

export interface PortablePluginCanvasGenerationSelectionActionContribution {
  readonly description: PortablePluginLocalizedText
  readonly editor: PortablePluginCanvasSelectionActionEditor
  readonly id: string
  /**
   * Host-owned visual treatment for an exact immediate image operation. This
   * is presentation metadata, never a provider identity or execution grant.
   */
  readonly presentation?: "cutout-scan"
  readonly steps: readonly PortablePluginCanvasSelectionActionStep[]
  readonly target: "image" | "video"
  readonly title: PortablePluginLocalizedText
}

export interface PortablePluginCanvasMaterializeSelectionActionContribution {
  readonly action: {
    readonly connect: "selection-to-created"
    readonly type: "materialize-own-plugin-node"
  }
  readonly description: PortablePluginLocalizedText
  readonly id: string
  readonly target: "video"
  readonly title: PortablePluginLocalizedText
}

export type PortablePluginCanvasSelectionActionContribution =
  | PortablePluginCanvasGenerationSelectionActionContribution
  | PortablePluginCanvasMaterializeSelectionActionContribution

export interface PortablePluginCanvasContribution {
  readonly commands?: readonly PortablePluginUiCommand[]
  readonly menus?: readonly PortablePluginUiMenuItem[]
  readonly renderer?: PortablePluginCanvasRendererContribution
  readonly selectionActions?: readonly PortablePluginCanvasSelectionActionContribution[]
  readonly toolbar?: readonly PortablePluginUiToolbarItem[]
}

const portablePluginCanvasSelectionActionEditors = [
  "time-point",
  "time-range",
  "crop-region",
  "confirmation",
  "immediate",
] as const satisfies readonly PortablePluginCanvasSelectionActionEditor[]

function isPortablePluginCanvasSelectionActionEditor(
  value: unknown,
): value is PortablePluginCanvasSelectionActionEditor {
  return portablePluginCanvasSelectionActionEditors.some((editor) => editor === value)
}

function parseSelectionActionTarget(value: unknown, label: string): "image" | "video" {
  if (value === "image" || value === "video") return value
  throw new TypeError(`${label} target must be image or video`)
}

function parseDimension(value: unknown, label: string) {
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > 8_192) {
    throw new TypeError(`${label} must be an integer between 1 and 8192`)
  }
  return Number(value)
}

function parseRenderer(value: unknown): PortablePluginCanvasRendererContribution {
  const input = portableRecord(value, "Canvas renderer contribution")
  assertPortableKeys(
    input,
    ["create", "extensions", "height", "mimeTypes", "nodeKinds", "stateSchema", "width"],
    "Canvas renderer contribution",
  )
  if (input.create !== undefined && typeof input.create !== "boolean") {
    throw new TypeError("Canvas renderer create must be a boolean")
  }
  const extensions = parsePortableStringArray(input.extensions, "Canvas renderer extensions", (item) => {
    const normalized = item.toLowerCase()
    if (!/^\.[a-z0-9][a-z0-9._+-]{0,31}$/u.test(normalized)) {
      throw new TypeError(`Invalid Canvas renderer extension: ${item}`)
    }
    return normalized
  })
  const mimeTypes = parsePortableStringArray(input.mimeTypes, "Canvas renderer MIME types", (item) => {
    const normalized = item.toLowerCase()
    if (!/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/u.test(normalized)) {
      throw new TypeError(`Invalid Canvas renderer MIME type: ${item}`)
    }
    return normalized
  })
  const nodeKinds = parsePortableStringArray(input.nodeKinds, "Canvas renderer node kinds", (item) => {
    if (!/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u.test(item)) {
      throw new TypeError(`Invalid Canvas renderer node kind: ${item}`)
    }
    return item
  })
  if (input.create !== true && !extensions?.length && !mimeTypes?.length && !nodeKinds?.length) {
    throw new TypeError("Canvas renderer must be creatable or match an extension, MIME type, or node kind")
  }
  return {
    ...(input.create === undefined ? {} : { create: input.create }),
    ...(extensions === undefined ? {} : { extensions }),
    ...(input.height === undefined ? {} : { height: parseDimension(input.height, "Canvas renderer height") }),
    ...(mimeTypes === undefined ? {} : { mimeTypes }),
    ...(nodeKinds === undefined ? {} : { nodeKinds }),
    ...(input.stateSchema === undefined ? {} : { stateSchema: parsePortablePluginStateSchemaV1(input.stateSchema) }),
    ...(input.width === undefined ? {} : { width: parseDimension(input.width, "Canvas renderer width") }),
  }
}

function localizedText(value: unknown, label: string, maximum: number): PortablePluginLocalizedText {
  const input = portableRecord(value, label)
  assertPortableKeys(input, ["default", "zh-CN"], label)
  return {
    default: portableText(input.default, `${label} default`, maximum),
    ...(input["zh-CN"] === undefined ? {} : { "zh-CN": portableText(input["zh-CN"], `${label} zh-CN`, maximum) }),
  }
}

function parseSelectionActions(value: unknown): readonly PortablePluginCanvasSelectionActionContribution[] {
  const actions = portableArray(value, "Canvas selection actions", 32, true).map((item, index) => {
    const label = `Canvas selection action ${index}`
    const input = portableRecord(item, label)
    if (input.action !== undefined) {
      assertPortableKeys(input, ["action", "description", "id", "target", "title"], label)
      const id = parsePortableStableId(input.id, `${label} id`)
      if (input.target !== "video") throw new TypeError(`${label} target must be video`)
      const action = portableRecord(input.action, `${label} action`)
      assertPortableKeys(action, ["connect", "type"], `${label} action`)
      if (action.type !== "materialize-own-plugin-node" || action.connect !== "selection-to-created") {
        throw new TypeError(`${label} materialization action is not supported`)
      }
      return {
        action: {
          connect: "selection-to-created" as const,
          type: "materialize-own-plugin-node" as const,
        },
        description: localizedText(input.description, `${label} description`, 2_000),
        id,
        target: "video" as const,
        title: localizedText(input.title, `${label} title`, 120),
      }
    }
    assertPortableKeys(input, ["description", "editor", "id", "presentation", "steps", "target", "title"], label)
    const id = parsePortableStableId(input.id, `${label} id`)
    const target = parseSelectionActionTarget(input.target, label)
    if (!isPortablePluginCanvasSelectionActionEditor(input.editor)) {
      throw new TypeError(`${label} editor is not supported`)
    }
    const editor = input.editor
    if (
      (editor === "immediate") !== (target === "image" && input.presentation === "cutout-scan") ||
      (input.presentation !== undefined && input.presentation !== "cutout-scan")
    ) {
      throw new TypeError(`${label} immediate editor requires image target and cutout-scan presentation`)
    }
    const steps = portableArray(input.steps, `${label} steps`, 16, true).map((step, stepIndex) => {
      const stepLabel = `${label} step ${stepIndex}`
      const stepInput = portableRecord(step, stepLabel)
      assertPortableKeys(stepInput, ["tool"], stepLabel)
      return { tool: parsePortableStableId(stepInput.tool, `${stepLabel} tool`) }
    })
    if (editor !== "confirmation" && steps.length !== 1) {
      throw new TypeError(`${label} editor requires exactly one step`)
    }
    return {
      description: localizedText(input.description, `${label} description`, 2_000),
      editor,
      id,
      ...(input.presentation === undefined ? {} : { presentation: "cutout-scan" as const }),
      steps,
      target,
      title: localizedText(input.title, `${label} title`, 120),
    }
  })
  if (new Set(actions.map((action) => action.id)).size !== actions.length) {
    throw new TypeError("Canvas selection actions contain duplicate ids")
  }
  return actions
}

export function parsePortablePluginCanvasContribution(value: unknown): PortablePluginCanvasContribution {
  const input = portableRecord(value, "Canvas contributions")
  assertPortableKeys(input, ["commands", "menus", "renderer", "selectionActions", "toolbar"], "Canvas contributions")
  const parsedUi = parsePortablePluginCanvasUiContribution({
    ...(input.commands === undefined ? {} : { commands: input.commands }),
    ...(input.menus === undefined ? {} : { menus: input.menus }),
    ...(input.toolbar === undefined ? {} : { toolbar: input.toolbar }),
  })
  return {
    ...(input.commands === undefined ? {} : { commands: parsedUi.commands }),
    ...(input.menus === undefined ? {} : { menus: parsedUi.menus }),
    ...(input.renderer === undefined ? {} : { renderer: parseRenderer(input.renderer) }),
    ...(input.selectionActions === undefined
      ? {}
      : { selectionActions: parseSelectionActions(input.selectionActions) }),
    ...(input.toolbar === undefined ? {} : { toolbar: parsedUi.toolbar }),
  }
}
