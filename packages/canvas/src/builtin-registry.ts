import {
  BuiltinCanvasNode,
  BuiltinFolderFileNode,
  BuiltinMediaFileNode,
  BuiltinTextFileNode,
} from "./components/builtin-node"
import { createAgentNode } from "./document"
import { createCanvasFileRendererRegistry, type CanvasFileRendererDefinition } from "./file-renderer-registry"
import { builtinCanvasInspectorContribution } from "./inspector"
import { createCanvasNodeRegistry } from "./node-registry"
import type { CanvasMediaKind } from "./types"

function mediaRenderer(kind: CanvasMediaKind): CanvasFileRendererDefinition {
  return {
    id: kind,
    label: kind[0]!.toUpperCase() + kind.slice(1),
    component: BuiltinMediaFileNode,
    hidden: true,
    inspector: builtinCanvasInspectorContribution,
    matches: (data) => data.kind === kind,
  }
}

export function createDefaultCanvasFileRendererRegistry() {
  return createCanvasFileRendererRegistry([
    {
      id: "text",
      label: "Text",
      component: BuiltinTextFileNode,
      inspector: builtinCanvasInspectorContribution,
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
      inspector: builtinCanvasInspectorContribution,
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
    },
    {
      type: "agent",
      label: "Agent",
      component: BuiltinCanvasNode,
      create: (input) => createAgentNode({ id: input.id, position: input.position }),
      hidden: true,
    },
  ])
}
