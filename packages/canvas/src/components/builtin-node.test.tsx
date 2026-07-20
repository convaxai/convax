import { describe, expect, mock, test } from "bun:test"
import type { NodeProps } from "@xyflow/react"
import type { ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { createCanvasDocument } from "../document"
import { CanvasEditorProvider, type CanvasEditorController } from "../editor-context"
import { createCanvasFileRendererRegistry } from "../file-renderer-registry"
import { getCanvasNodeGenerationToolId, setCanvasNodeGenerationToolId } from "../generation-preference"
import { deriveCanvasSelectionContext } from "../selection-context"
import { CanvasServicesProvider, createCanvasServices, type CanvasAssistantRequest } from "../services"
import type { CanvasDocument, CanvasNode, CanvasSelection } from "../types"

mock.module("@xyflow/react", () => ({
  Handle: (props: { children?: ReactNode }) => <div>{props.children}</div>,
  NodeResizer: () => null,
  NodeToolbar: (props: { children?: ReactNode; isVisible?: boolean }) => (
    <div data-node-toolbar data-visibility={props.isVisible === undefined ? "default" : String(props.isVisible)}>
      {props.children}
    </div>
  ),
  Position: { Bottom: "bottom", Left: "left", Right: "right", Top: "top" },
  getBezierPath: () => ["", 0, 0, 0, 0],
  useConnection: (selector: (state: { inProgress: boolean }) => unknown) => selector({ inProgress: false }),
}))

const { BuiltinCanvasNode, CanvasNodeChrome } = await import("./builtin-node")

const node: CanvasNode = {
  id: "node-a",
  data: { kind: "test-file", label: "Test file" },
  position: { x: 0, y: 0 },
  type: "file",
}

function selection(nodeIds: readonly string[], edgeIds: readonly string[] = []): CanvasSelection {
  return { edgeIds: new Set(edgeIds), nodeIds: new Set(nodeIds) }
}

function nodeProps(selected = true): NodeProps<CanvasNode> {
  return {
    data: node.data,
    deletable: true,
    draggable: true,
    dragging: false,
    id: node.id,
    isConnectable: true,
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
    selected,
    selectable: true,
    type: "file",
    zIndex: 0,
  }
}

function renderWithEditor(
  currentSelection: CanvasSelection,
  readOnly: boolean,
  child: (props: NodeProps<CanvasNode>) => ReactNode,
  hydrating = false,
  options: {
    assistantRender?: (request: CanvasAssistantRequest) => ReactNode
    commit?: CanvasEditorController["commit"]
    document?: CanvasDocument
  } = {},
) {
  const fileRenderers = createCanvasFileRendererRegistry([
    {
      component: () => <div data-file-renderer />,
      id: "test-file",
      label: "Test file",
      matches: (data) => data.kind === "test-file",
      toolbar: () => <div data-contributed-toolbar />,
    },
  ])
  const controller: CanvasEditorController = {
    beginGesture: () => {},
    cancelGesture: () => {},
    canUpload: false,
    commit: options.commit ?? (() => {}),
    connectionNodeTypes: [],
    document: options.document ?? createCanvasDocument({ id: "canvas-test", nodes: [node] }),
    duplicateNode: () => {},
    endGesture: () => {},
    executeSelectionAction: () => {},
    fileRenderers,
    hydrating,
    isSelectionActionPending: () => false,
    quickConnect: () => {},
    readOnly,
    removeNode: () => {},
    replaceNodeMedia: () => {},
    selectNodes: () => {},
    selection: currentSelection,
    selectionContext: deriveCanvasSelectionContext(currentSelection),
    visibleSelectionActions: [],
  }
  const services = createCanvasServices({
    assistant: { render: options.assistantRender ?? (() => <div data-assistant-toolbar />) },
  })

  return renderToStaticMarkup(
    <CanvasServicesProvider services={services}>
      <CanvasEditorProvider controller={controller}>{child(nodeProps())}</CanvasEditorProvider>
    </CanvasServicesProvider>,
  )
}

function toolbarCount(markup: string) {
  return markup.match(/data-node-toolbar/g)?.length ?? 0
}

describe("built-in node toolbar visibility", () => {
  test("uses React Flow default visibility for the editable sole selected node", () => {
    const markup = renderWithEditor(selection(["node-a"]), false, (props) => (
      <CanvasNodeChrome icon={null} label="Test" node={props} toolbar={<div data-built-in-toolbar />}>
        <div />
      </CanvasNodeChrome>
    ))

    expect(toolbarCount(markup)).toBe(1)
    expect(markup).toContain('data-visibility="default"')
  })

  test("does not mount the built-in toolbar for multi, mixed, or read-only selection", () => {
    const render = (currentSelection: CanvasSelection, readOnly = false) =>
      renderWithEditor(currentSelection, readOnly, (props) => (
        <CanvasNodeChrome icon={null} label="Test" node={props} toolbar={<div data-built-in-toolbar />}>
          <div />
        </CanvasNodeChrome>
      ))

    expect(toolbarCount(render(selection(["node-a", "node-b"])))).toBe(0)
    expect(toolbarCount(render(selection(["node-a"], ["edge-a"])))).toBe(0)
    expect(toolbarCount(render(selection(["node-a"]), true))).toBe(0)
  })

  test("applies the same boundary to contributed and assistant toolbars", () => {
    expect(
      toolbarCount(renderWithEditor(selection(["node-a"]), false, (props) => <BuiltinCanvasNode {...props} />)),
    ).toBe(2)
    expect(
      toolbarCount(
        renderWithEditor(selection(["node-a", "node-b"]), false, (props) => <BuiltinCanvasNode {...props} />),
      ),
    ).toBe(0)
    expect(
      toolbarCount(
        renderWithEditor(selection(["node-a"], ["edge-a"]), false, (props) => <BuiltinCanvasNode {...props} />),
      ),
    ).toBe(0)
    expect(
      toolbarCount(renderWithEditor(selection(["node-a"]), true, (props) => <BuiltinCanvasNode {...props} />)),
    ).toBe(0)
  })

  test("keeps the selected card assistant mounted but disabled during document hydration", () => {
    const markup = renderWithEditor(selection(["node-a"]), true, (props) => <BuiltinCanvasNode {...props} />, true)

    expect(toolbarCount(markup)).toBe(1)
    expect(markup).not.toContain("data-contributed-toolbar")
    expect(markup).toContain('aria-busy="true"')
    expect(markup).toContain('disabled=""')
    expect(markup).toContain('inert=""')
    expect(markup).toContain("data-assistant-toolbar")
  })

  test("gives the file assistant only its owner's persisted generation-model setter", () => {
    const stored = setCanvasNodeGenerationToolId(
      createCanvasDocument({ id: "canvas-test", nodes: [node] }),
      node.id,
      "plugin.example:image.generate",
    )
    let request: CanvasAssistantRequest | undefined
    let committed: CanvasDocument | undefined
    renderWithEditor(selection([node.id]), false, (props) => <BuiltinCanvasNode {...props} />, false, {
      assistantRender: (next) => {
        request = next
        return <div data-assistant-toolbar />
      },
      commit: (update) => {
        committed = update(stored)
      },
      document: stored,
    })

    expect(request?.ownerGenerationToolId).toBe("plugin.example:image.generate")
    request?.onOwnerGenerationToolIdChange?.("plugin.example:image.alternate")
    expect(committed && getCanvasNodeGenerationToolId(committed.nodes[0])).toBe("plugin.example:image.alternate")
  })
})
