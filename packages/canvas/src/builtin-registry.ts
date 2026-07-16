import {
  BuiltinCanvasNode,
  BuiltinFolderFileNode,
  BuiltinMediaFileNode,
  BuiltinTextFileNode,
} from "./components/builtin-node"
import { createAgentNode, createMediaNode, createTextNode } from "./document"
import { createCanvasFileRendererRegistry, type CanvasFileRendererDefinition } from "./file-renderer-registry"
import { createCanvasNodeRegistry } from "./node-registry"
import type { CanvasMediaKind, CanvasResource } from "./types"

function mediaRenderer(kind: CanvasMediaKind): CanvasFileRendererDefinition {
  return {
    id: kind,
    label: kind[0]!.toUpperCase() + kind.slice(1),
    component: BuiltinMediaFileNode,
    matches: (data) => data.kind === kind,
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

export function createDefaultCanvasFileRendererRegistry() {
  return createCanvasFileRendererRegistry([
    {
      id: "text",
      label: "Text",
      component: BuiltinTextFileNode,
      create: (input) => createTextNode({ id: input.id, position: input.position }),
      matches: (data) => data.kind === "text",
    },
    mediaRenderer("image"),
    mediaRenderer("video"),
    mediaRenderer("audio"),
    mediaRenderer("file"),
    {
      id: "folder",
      label: "Folder",
      component: BuiltinFolderFileNode,
      matches: (data) => data.kind === "folder",
    },
  ])
}

export function createDefaultCanvasNodeRegistry() {
  return createCanvasNodeRegistry([
    {
      type: "file",
      label: "File",
      component: BuiltinCanvasNode,
      create: (input) => createTextNode({ id: input.id, position: input.position }),
    },
    {
      type: "agent",
      label: "Agent",
      component: BuiltinCanvasNode,
      create: (input) => createAgentNode({ id: input.id, position: input.position }),
    },
  ])
}
