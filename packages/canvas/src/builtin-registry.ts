import {
  BuiltinCanvasNode,
  BuiltinFolderFileNode,
  BuiltinMediaFileNode,
  BuiltinTextFileNode,
} from "./components/builtin-node"
import { createAgentNode, createMediaNode } from "./document"
import { createCanvasFileRendererRegistry, type CanvasFileRendererDefinition } from "./file-renderer-registry"
import { builtinCanvasInspectorContribution } from "./inspector"
import { createCanvasNodeRegistry } from "./node-registry"
import type { CanvasMediaKind } from "./types"

function mediaRenderer(kind: CanvasMediaKind): CanvasFileRendererDefinition {
  const canCreateEmptyCard = kind === "image" || kind === "video"
  return {
    id: kind,
    label: kind[0]!.toUpperCase() + kind.slice(1),
    component: BuiltinMediaFileNode,
    inspector: builtinCanvasInspectorContribution,
    matches: (data) => data.kind === kind,
    ...(canCreateEmptyCard
      ? {
          create(input) {
            const node = createMediaNode({
              id: input.id,
              position: input.position,
              resource: {
                id: input.id ?? kind,
                kind,
                metadata: {},
                state: { status: "ready" },
              },
            })
            return { ...node, data: { ...node.data, status: "idle" as const } }
          },
        }
      : { hidden: true }),
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
