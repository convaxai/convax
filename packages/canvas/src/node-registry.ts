import type { ComponentType } from "react"
import type { NodeProps } from "@xyflow/react"
import type { CanvasNode, CanvasNodeType, CanvasPoint } from "./types"

export interface CanvasNodeCreateInput {
  id?: string
  position: CanvasPoint
  data?: Record<string, unknown>
}

export interface CanvasNodeDefinition {
  type: CanvasNodeType
  label: string
  component: ComponentType<NodeProps<CanvasNode>>
  create: (input: CanvasNodeCreateInput) => CanvasNode
  hidden?: boolean
}

export interface CanvasNodeRegistry {
  get: (type: string) => CanvasNodeDefinition | undefined
  getVersion: () => number
  list: () => readonly CanvasNodeDefinition[]
  register: (definition: CanvasNodeDefinition) => () => void
  subscribe: (listener: () => void) => () => void
}

function validateNodeType(type: string): asserts type is CanvasNodeType {
  if (type !== "file" && type !== "agent") {
    throw new Error(`Canvas node type must be either file or agent: ${type}`)
  }
}

export function createCanvasNodeRegistry(initial: readonly CanvasNodeDefinition[] = []): CanvasNodeRegistry {
  const definitions = new Map<CanvasNodeType, CanvasNodeDefinition>()
  for (const definition of initial) {
    validateNodeType(definition.type)
    if (definitions.has(definition.type)) throw new Error(`Canvas node type is already registered: ${definition.type}`)
    definitions.set(definition.type, definition)
  }
  const listeners = new Set<() => void>()
  let version = 0
  const emit = () => {
    version += 1
    listeners.forEach((listener) => listener())
  }

  return {
    get(type) {
      return type === "file" || type === "agent" ? definitions.get(type) : undefined
    },
    getVersion() {
      return version
    },
    list() {
      return [...definitions.values()]
    },
    register(definition) {
      validateNodeType(definition.type)
      if (definitions.has(definition.type)) throw new Error(`Canvas node type is already registered: ${definition.type}`)
      definitions.set(definition.type, definition)
      emit()
      return () => {
        if (definitions.get(definition.type) !== definition) return
        definitions.delete(definition.type)
        emit()
      }
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
