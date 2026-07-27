import type { ComponentType } from "react"
import type { NodeProps } from "@xyflow/react"
import type { CanvasInspectorContribution } from "./inspector"
import type { CanvasNodeCreateInput } from "./node-registry"
import type { CanvasNode, CanvasNodeData } from "./types"

export interface CanvasFileRendererDefinition {
  /** Stable renderer identifier, persisted as `node.data.kind`. */
  id: string
  label: string
  /** Complete node renderer; use the exported CanvasNodeChrome for standard handles/resizing. */
  component: ComponentType<NodeProps<CanvasNode>>
  /** Render-only contributions can omit create and stay out of insertion menus. */
  create?: (input: CanvasNodeCreateInput) => CanvasNode
  hidden?: boolean
  /** Explicit, bounded opt-in for the read-only Canvas Inspector. */
  inspector?: CanvasInspectorContribution
  matches: (data: CanvasNodeData) => boolean
  priority?: number
  /** Optional secondary toolbar contribution mounted above the renderer's own toolbar. */
  toolbar?: ComponentType<NodeProps<CanvasNode>>
}

export interface CanvasFileRendererPlugin {
  id: string
  renderers: readonly CanvasFileRendererDefinition[]
}

export interface CanvasFileRendererRegistry {
  get: (id: string) => CanvasFileRendererDefinition | undefined
  getVersion: () => number
  list: () => readonly CanvasFileRendererDefinition[]
  register: (definition: CanvasFileRendererDefinition) => () => void
  registerPlugin: (plugin: CanvasFileRendererPlugin) => () => void
  resolve: (data: CanvasNodeData) => CanvasFileRendererDefinition | undefined
  subscribe: (listener: () => void) => () => void
}

function compareRenderers(left: CanvasFileRendererDefinition, right: CanvasFileRendererDefinition) {
  return (right.priority ?? 0) - (left.priority ?? 0) || left.id.localeCompare(right.id)
}

function validateId(value: string, label: string) {
  if (!value.trim() || value !== value.trim()) throw new Error(`${label} must be a non-empty stable id`)
  if (value === "agent" || value === "group") {
    throw new Error(`${label} is reserved for a Canvas node type: ${value}`)
  }
}

export function createCanvasFileNode(
  definition: CanvasFileRendererDefinition,
  input: CanvasNodeCreateInput,
): CanvasNode | undefined {
  const created = definition.create?.(input)
  if (!created) return undefined
  if (created.data.kind === "agent" || created.data.kind === "group") {
    throw new Error(`Canvas file renderer created a non-file node: ${definition.id}`)
  }
  return {
    ...created,
    type: "file",
    data: { ...created.data, kind: definition.id },
  }
}

export function createCanvasFileRendererRegistry(
  initial: readonly CanvasFileRendererDefinition[] = [],
): CanvasFileRendererRegistry {
  const definitions = new Map<string, CanvasFileRendererDefinition>()
  const plugins = new Map<string, CanvasFileRendererPlugin>()
  const listeners = new Set<() => void>()
  let version = 0
  const emit = () => {
    version += 1
    listeners.forEach((listener) => listener())
  }
  const add = (definition: CanvasFileRendererDefinition) => {
    validateId(definition.id, "Canvas file renderer id")
    if (definitions.has(definition.id)) throw new Error(`Canvas file renderer is already registered: ${definition.id}`)
    definitions.set(definition.id, definition)
  }
  for (const definition of initial) add(definition)

  const registry: CanvasFileRendererRegistry = {
    get(id) {
      return definitions.get(id)
    },
    getVersion() {
      return version
    },
    list() {
      return [...definitions.values()].sort(compareRenderers)
    },
    register(definition) {
      add(definition)
      emit()
      return () => {
        if (definitions.get(definition.id) !== definition) return
        definitions.delete(definition.id)
        emit()
      }
    },
    registerPlugin(plugin) {
      validateId(plugin.id, "Canvas file renderer plugin id")
      if (plugins.has(plugin.id)) throw new Error(`Canvas file renderer plugin is already registered: ${plugin.id}`)
      const registered: CanvasFileRendererDefinition[] = []
      try {
        for (const definition of plugin.renderers) {
          add(definition)
          registered.push(definition)
        }
      } catch (error) {
        for (const definition of registered) definitions.delete(definition.id)
        throw error
      }
      plugins.set(plugin.id, plugin)
      emit()
      return () => {
        if (plugins.get(plugin.id) !== plugin) return
        plugins.delete(plugin.id)
        for (const definition of plugin.renderers) {
          if (definitions.get(definition.id) === definition) definitions.delete(definition.id)
        }
        emit()
      }
    },
    resolve(data) {
      for (const definition of registry.list()) {
        try {
          if (definition.matches(data)) return definition
        } catch {
          // One plugin must not prevent a lower-priority renderer from handling the file.
        }
      }
      return undefined
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
  return registry
}
