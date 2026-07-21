import type { CanvasApplicationCommand } from "./commands"

export type CanvasCommandCapabilityLayer = "business" | "primitive"

export interface CanvasCommandCapability {
  commandType: CanvasApplicationCommand["type"]
  defaultForAgent: boolean
  description: string
  layer: CanvasCommandCapabilityLayer
}

/**
 * Stable discovery metadata for tool adapters. Business capabilities are the
 * preferred Agent surface; primitives remain discoverable for precise tasks.
 */
export const canvasCommandCapabilities = [
  {
    commandType: "canvas.auto-layout",
    defaultForAgent: true,
    description: "Arrange related canvas nodes with a deterministic, size-aware directed layout.",
    layer: "business",
  },
  {
    commandType: "resources.add",
    defaultForAgent: true,
    description: "Prepare resources and add correctly sized, placed, and optionally related nodes.",
    layer: "business",
  },
  {
    commandType: "elements.remove",
    defaultForAgent: false,
    description: "Remove canvas nodes or edges by id.",
    layer: "primitive",
  },
  {
    commandType: "nodes.align",
    defaultForAgent: false,
    description: "Align a set of nodes along one axis.",
    layer: "primitive",
  },
  {
    commandType: "nodes.connect",
    defaultForAgent: false,
    description: "Create an edge between two nodes.",
    layer: "primitive",
  },
  {
    commandType: "nodes.distribute",
    defaultForAgent: false,
    description: "Evenly distribute a set of nodes.",
    layer: "primitive",
  },
  {
    commandType: "nodes.group",
    defaultForAgent: false,
    description: "Place a set of nodes in a group.",
    layer: "primitive",
  },
  {
    commandType: "nodes.layout",
    defaultForAgent: false,
    description: "Explicitly arrange a selected node set as a grid, row, or column.",
    layer: "primitive",
  },
  {
    commandType: "nodes.move",
    defaultForAgent: false,
    description: "Move canvas nodes by a delta.",
    layer: "primitive",
  },
  {
    commandType: "nodes.setGeometry",
    defaultForAgent: false,
    description: "Atomically replace absolute positions and optional sizes for a set of nodes.",
    layer: "primitive",
  },
  {
    commandType: "nodes.ungroup",
    defaultForAgent: false,
    description: "Remove a group while keeping its children.",
    layer: "primitive",
  },
] as const satisfies readonly CanvasCommandCapability[]

export function getCanvasCommandCapability(commandType: CanvasApplicationCommand["type"]) {
  return canvasCommandCapabilities.find((capability) => capability.commandType === commandType)!
}
