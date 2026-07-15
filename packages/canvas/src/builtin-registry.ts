import { BuiltinCanvasNode } from "./components/builtin-node"
import { createMediaNode, createTextNode } from "./document"
import { createCanvasNodeRegistry } from "./node-registry"
import type { CanvasNodeDefinition } from "./node-registry"
import type { CanvasMediaKind, CanvasResource } from "./types"

function mediaDefinition(kind: CanvasMediaKind): CanvasNodeDefinition {
  return {
    type: kind,
    label: kind[0].toUpperCase() + kind.slice(1),
    component: BuiltinCanvasNode,
    create(input) {
      const resource = input.data?.resource as CanvasResource | undefined
      return createMediaNode({
        id: input.id,
        label: typeof input.data?.label === "string" ? input.data.label : undefined,
        position: input.position,
        resource: resource ?? { id: input.id ?? kind, kind, url: "" },
      })
    },
  }
}

export function createDefaultCanvasNodeRegistry() {
  return createCanvasNodeRegistry([
    {
      type: "text",
      label: "Text",
      component: BuiltinCanvasNode,
      create: (input) => createTextNode({ id: input.id, position: input.position }),
    },
    mediaDefinition("image"),
    mediaDefinition("video"),
    mediaDefinition("audio"),
    mediaDefinition("file"),
    {
      type: "group",
      label: "Group",
      component: BuiltinCanvasNode,
      create: (input) => ({
        id: input.id ?? `group_${Date.now()}`,
        type: "group",
        position: input.position,
        data: { kind: "group", label: "Group" },
        style: { width: 480, height: 320 },
      }),
    },
  ])
}
