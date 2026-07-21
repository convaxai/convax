import { describe, expect, mock, test } from "bun:test"
import type { NodeProps } from "@xyflow/react"
import type { ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { createAgentNode, createCanvasDocument, createGroupNode, createTextNode } from "../document"
import { CanvasEditorProvider, type CanvasEditorController } from "../editor-context"
import { createCanvasFileRendererRegistry } from "../file-renderer-registry"
import { getCanvasNodeGenerationToolId, setCanvasNodeGenerationToolId } from "../generation-preference"
import type { CanvasSelectionAction } from "../selection-actions"
import type { CanvasSelectionDragPreparationStatus, CanvasSelectionDragSource } from "../selection-drag-source"
import { deriveCanvasSelectionContext } from "../selection-context"
import { CanvasServicesProvider, createCanvasServices, type CanvasAssistantRequest } from "../services"
import type { CanvasDocument, CanvasNode, CanvasSelection } from "../types"

mock.module("@xyflow/react", () => ({
  Handle: (props: { children?: ReactNode }) => <div>{props.children}</div>,
  NodeResizer: (props: { isVisible?: boolean }) => (props.isVisible === false ? null : <div data-node-resizer />),
  NodeToolbar: (props: { children?: ReactNode; isVisible?: boolean }) => (
    <div data-node-toolbar data-visibility={props.isVisible === undefined ? "default" : String(props.isVisible)}>
      {props.children}
    </div>
  ),
  Position: { Bottom: "bottom", Left: "left", Right: "right", Top: "top" },
  getBezierPath: () => ["", 0, 0, 0, 0],
  useConnection: (selector: (state: { inProgress: boolean }) => unknown) => selector({ inProgress: false }),
}))

const {
  BuiltinCanvasNode,
  BuiltinMediaFileNode,
  CanvasNodeChrome,
  CanvasNodeToolbarButton,
  ExpandedTextEditorDialog,
  startCanvasSelectionDragFromNode,
} = await import("./builtin-node")

const node: CanvasNode = {
  id: "node-a",
  data: { kind: "test-file", label: "Test file" },
  position: { x: 0, y: 0 },
  type: "file",
}

function selection(nodeIds: readonly string[], edgeIds: readonly string[] = []): CanvasSelection {
  return { edgeIds: new Set(edgeIds), nodeIds: new Set(nodeIds) }
}

function nodeProps(selected = true, target = node): NodeProps<CanvasNode> {
  return {
    data: target.data,
    deletable: true,
    draggable: true,
    dragging: false,
    id: target.id,
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
    executeSelectionAction?: CanvasEditorController["executeSelectionAction"]
    rendererUsesChrome?: boolean
    node?: CanvasNode
    selectionDragArmed?: boolean
    selectionDragSource?: CanvasSelectionDragSource | null
    selectionDragStatus?: CanvasSelectionDragPreparationStatus
    startSelectionDrag?: CanvasEditorController["startSelectionDrag"]
    visibleSelectionActions?: readonly CanvasSelectionAction[]
  } = {},
) {
  const targetNode = options.node ?? node
  const fileRenderers = createCanvasFileRendererRegistry([
    {
      component: options.rendererUsesChrome
        ? (props) => (
            <CanvasNodeChrome
              icon={null}
              label="Registered renderer"
              node={props}
              toolbar={<div className="convax-node-toolbar__surface" data-renderer-toolbar />}
            >
              <div data-file-renderer />
            </CanvasNodeChrome>
          )
        : (props) => <div data-file-renderer data-selected={String(props.selected)} />,
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
    document: options.document ?? createCanvasDocument({ id: "canvas-test", nodes: [targetNode] }),
    duplicateNode: () => {},
    endGesture: () => {},
    executeSelectionAction: options.executeSelectionAction ?? (() => {}),
    fileRenderers,
    finishSelectionDrag: () => {},
    hydrating,
    isSelectionActionPending: () => false,
    quickConnect: () => {},
    readOnly,
    removeNode: () => {},
    selectNodes: () => {},
    selection: currentSelection,
    selectionContext: deriveCanvasSelectionContext(currentSelection),
    selectionDragArmed: options.selectionDragArmed ?? false,
    selectionDragChordHeld: options.selectionDragArmed ?? false,
    selectionDragModeActive: false,
    selectionDragStatus: options.selectionDragStatus ?? "unavailable",
    setSelectionDragCandidateNode: () => {},
    startSelectionDrag: options.startSelectionDrag ?? (() => false),
    visibleSelectionActions: options.visibleSelectionActions ?? [],
    visibleSelectionDragSource: options.selectionDragSource ?? null,
  }
  const services = createCanvasServices({
    assistant: { render: options.assistantRender ?? (() => <div data-assistant-toolbar />) },
  })

  return renderToStaticMarkup(
    <CanvasServicesProvider services={services}>
      <CanvasEditorProvider controller={controller}>{child(nodeProps(true, targetNode))}</CanvasEditorProvider>
    </CanvasServicesProvider>,
  )
}

function toolbarCount(markup: string) {
  return markup.match(/data-node-toolbar/g)?.length ?? 0
}

describe("built-in node toolbar visibility", () => {
  test("renders an almost full-screen editor dialog for text nodes", () => {
    const markup = renderToStaticMarkup(
      <ExpandedTextEditorDialog
        editor={null}
        label="Story outline"
        onClose={() => {}}
        toolbar={<div data-text-formatting />}
      />,
    )

    expect(markup).toContain('role="dialog"')
    expect(markup).toContain('aria-modal="true"')
    expect(markup).toContain("Story outline")
    expect(markup).toContain("h-[calc(100vh-32px)]")
    expect(markup).toContain("w-[calc(100vw-32px)]")
    expect(markup).toContain("convax-text-editor-dialog__toolbar-inner")
    expect(markup).toContain("data-text-formatting")
    expect(markup).toContain('aria-label="Close expanded editor"')
  })

  test("can show a compact visible label for commands without a meaningful icon", () => {
    const markup = renderToStaticMarkup(<CanvasNodeToolbarButton label="刷新图片" onClick={() => {}} visibleLabel />)

    expect(markup).toContain("刷新图片")
    expect(markup).toContain("convax-node-toolbar__button--labeled")
    expect(markup).toContain('aria-label="刷新图片"')
  })

  test("keeps an empty media body passive while upload remains in the node toolbar", () => {
    const markup = renderWithEditor(selection(["node-a"]), false, (props) => (
      <BuiltinMediaFileNode {...props} data={{ kind: "image", label: "Image", url: "" }} />
    ))

    expect(markup).toContain("convax-media-empty__content")
    expect(markup).toContain("Use the toolbar to add content")
    expect(markup).toContain('aria-label="Add image"')
    expect(markup).not.toContain("convax-media-empty__action")
  })

  test("marks image and video cards for aligned borderless media chrome", () => {
    const imageMarkup = renderWithEditor(selection([]), false, (props) => (
      <BuiltinMediaFileNode
        {...props}
        data={{ kind: "image", label: "Portrait", url: "asset://portrait" }}
      />
    ))
    const videoMarkup = renderWithEditor(selection([]), false, (props) => (
      <BuiltinMediaFileNode
        {...props}
        data={{ kind: "video", label: "Clip", url: "asset://clip" }}
      />
    ))

    expect(imageMarkup).toContain("convax-node__surface--media")
    expect(imageMarkup).toContain('src="asset://portrait"')
    expect(videoMarkup).toContain("convax-node__surface--media")
    expect(videoMarkup).toContain('src="asset://clip"')
  })

  test("renders persisted pending and error resource lifecycle overlays", () => {
    const pending = renderWithEditor(selection([]), false, (props) => (
      <BuiltinCanvasNode {...props} data={{ ...props.data, status: "pending" }} />
    ))
    expect(pending).toContain('data-canvas-persisted-resource-status="pending"')
    expect(pending).toContain('aria-busy="true"')
    expect(pending).toContain("正在生成…")
    expect(pending).not.toContain("data-assistant-toolbar")

    const failed = renderWithEditor(selection([]), false, (props) => (
      <BuiltinCanvasNode
        {...props}
        data={{ ...props.data, error: "Generation could not be completed", status: "error" }}
      />
    ))
    expect(failed).toContain('data-canvas-persisted-resource-status="error"')
    expect(failed).toContain('role="alert"')
    expect(failed).toContain("Generation could not be completed")
    expect(failed).not.toContain("修改并重试")
    expect(failed).not.toContain("data-assistant-toolbar")
  })

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

  test("shows node-local focus chrome only for the sole selected card", () => {
    const render = (currentSelection: CanvasSelection, readOnly = false) =>
      renderWithEditor(currentSelection, readOnly, (props) => (
        <CanvasNodeChrome icon={null} label="Test" node={props}>
          <div />
        </CanvasNodeChrome>
      ))

    const single = render(selection(["node-a"]))
    expect(single).toContain("is-selected")
    expect(single).toContain("data-node-resizer")

    for (const aggregate of [selection(["node-a", "node-b"]), selection(["node-a"], ["edge-a"])]) {
      const markup = render(aggregate)
      expect(markup).not.toContain("is-selected")
      expect(markup).not.toContain("data-node-resizer")
    }
    expect(render(selection(["node-a"]), true)).not.toContain("data-node-resizer")
  })

  test("passes single-card activation instead of aggregate membership to registered renderers", () => {
    const render = (currentSelection: CanvasSelection) =>
      renderWithEditor(currentSelection, false, (props) => <BuiltinCanvasNode {...props} />)

    expect(render(selection(["node-a"]))).toContain('data-selected="true"')
    expect(render(selection(["node-a", "node-b"]))).toContain('data-selected="false"')
    expect(render(selection(["node-a"], ["edge-a"]))).toContain('data-selected="false"')
  })

  test("suppresses per-card group focus and resize chrome in aggregate selection", () => {
    const group = createGroupNode({
      height: 240,
      id: "group-a",
      position: { x: 0, y: 0 },
      width: 360,
    })
    const render = (currentSelection: CanvasSelection) =>
      renderWithEditor(currentSelection, false, (props) => <BuiltinCanvasNode {...props} />, false, { node: group })

    const single = render(selection([group.id]))
    expect(single).toContain("ring-2")
    expect(single).toContain("data-node-resizer")

    const multi = render(selection([group.id, "node-b"]))
    expect(multi).not.toContain("ring-2")
    expect(multi).not.toContain("data-node-resizer")
  })

  test("adds host selection actions to every eligible node toolbar", () => {
    const action: CanvasSelectionAction = {
      execute: () => undefined,
      id: "agent.add-to-conversation",
      label: "Add to conversation",
    }
    const render = (toolbar?: ReactNode, currentSelection = selection(["node-a"]), readOnly = false) =>
      renderWithEditor(
        currentSelection,
        readOnly,
        (props) => (
          <CanvasNodeChrome icon={null} label="Test" node={props} toolbar={toolbar}>
            <div />
          </CanvasNodeChrome>
        ),
        false,
        { visibleSelectionActions: [action] },
      )

    expect(render()).toContain('aria-label="Add to conversation"')
    const withLocalToolbar = render(<div className="convax-node-toolbar__surface" data-local-toolbar />)
    expect(withLocalToolbar).toContain('aria-label="Add to conversation"')
    expect(withLocalToolbar).toContain("data-local-toolbar")
    expect(withLocalToolbar.match(/aria-label="Add to conversation"/g)).toHaveLength(1)
    const withContributedToolbar = renderWithEditor(
      selection(["node-a"]),
      false,
      (props) => <BuiltinCanvasNode {...props} />,
      false,
      { visibleSelectionActions: [action] },
    )
    expect(withContributedToolbar).toContain("data-contributed-toolbar")
    expect(withContributedToolbar.match(/aria-label="Add to conversation"/g)).toHaveLength(1)
    const withChromeAndContribution = renderWithEditor(
      selection(["node-a"]),
      false,
      (props) => <BuiltinCanvasNode {...props} />,
      false,
      { rendererUsesChrome: true, visibleSelectionActions: [action] },
    )
    expect(withChromeAndContribution).toContain("data-renderer-toolbar")
    expect(withChromeAndContribution).toContain("data-contributed-toolbar")
    expect(withChromeAndContribution.match(/aria-label="Add to conversation"/g)).toHaveLength(1)
    expect(render(undefined, selection(["node-a", "node-b"]))).not.toContain("Add to conversation")
    expect(render(undefined, selection(["node-a"], ["edge-a"]))).not.toContain("Add to conversation")
    expect(render(undefined, selection(["node-a"]), true)).not.toContain("Add to conversation")
  })

  test("makes every selected node body draggable only while the held host gesture is ready", () => {
    const dragSource: CanvasSelectionDragSource = {
      id: "native-files",
      label: "Drag outside Convax",
      prepare: async () => ({ dispose: () => undefined, start: () => undefined }),
      preparingLabel: "Preparing media",
      visible: () => true,
    }
    const render = (
      currentSelection: CanvasSelection,
      status: CanvasSelectionDragPreparationStatus,
      readOnly = false,
      selected = true,
    ) =>
      renderWithEditor(
        currentSelection,
        readOnly,
        (props) => <BuiltinCanvasNode {...props} selected={selected} />,
        false,
        { selectionDragArmed: true, selectionDragSource: dragSource, selectionDragStatus: status },
      )

    const ready = render(selection(["node-a"]), "ready")
    expect(ready).toContain('data-canvas-selection-drag-state="ready"')
    expect(ready).toContain('draggable="true"')
    expect(ready).toContain("Drag outside Convax")
    expect(ready).not.toContain('aria-label="Drag outside Convax"')

    const preparing = render(selection(["node-a"]), "preparing")
    expect(preparing).toContain('data-canvas-selection-drag-state="preparing"')
    expect(preparing).toContain('draggable="false"')
    expect(preparing).toContain('role="status"')
    expect(preparing).toContain("Preparing media")

    const multi = renderWithEditor(
      selection(["node-a", "node-b"]),
      false,
      (props) => (
        <>
          <BuiltinCanvasNode {...props} />
          <BuiltinCanvasNode {...props} id="node-b" />
        </>
      ),
      false,
      { selectionDragArmed: true, selectionDragSource: dragSource, selectionDragStatus: "ready" },
    )
    expect(multi.match(/draggable="true"/g)).toHaveLength(2)
    expect(multi.match(/data-canvas-selection-drag-hint/g)).toHaveLength(1)
    expect(render(selection(["node-a"]), "ready", true)).toContain('draggable="true"')
    expect(render(selection(["node-a"]), "ready", false, false)).toContain('draggable="true"')
    expect(render(selection(["node-b"]), "ready", false, false)).not.toContain("data-canvas-selection-drag-state")
  })

  test("starts the whole prepared selection only while the exact drag chord remains held", () => {
    const start = mock(() => true)
    const dragEvent = (
      overrides: Partial<{ altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }> = {},
    ) => ({
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      preventDefault: mock(() => undefined),
      shiftKey: false,
      stopPropagation: mock(() => undefined),
      ...overrides,
    })

    const notReady = dragEvent({ metaKey: true, shiftKey: true })
    expect(startCanvasSelectionDragFromNode(notReady, false, false, "meta", start)).toBeFalse()
    const released = dragEvent({ metaKey: true })
    expect(startCanvasSelectionDragFromNode(released, true, false, "meta", start)).toBeFalse()
    const otherPlatform = dragEvent({ ctrlKey: true, shiftKey: true })
    expect(startCanvasSelectionDragFromNode(otherPlatform, true, false, "meta", start)).toBeFalse()
    const held = dragEvent({ metaKey: true, shiftKey: true })
    expect(startCanvasSelectionDragFromNode(held, true, false, "meta", start)).toBeTrue()

    const modeDrag = dragEvent()
    expect(startCanvasSelectionDragFromNode(modeDrag, true, true, "meta", start)).toBeTrue()

    expect(start).toHaveBeenCalledTimes(2)
    for (const event of [notReady, released, otherPlatform, held, modeDrag]) {
      expect(event.preventDefault).toHaveBeenCalledTimes(1)
      expect(event.stopPropagation).toHaveBeenCalledTimes(1)
    }
  })

  test("keeps a non-media Agent entry inside the single-card toolbar boundary", () => {
    const selected = renderWithEditor(selection(["node-a"]), false, (props) => <BuiltinCanvasNode {...props} />)
    expect(toolbarCount(selected)).toBe(1)
    expect(selected).toContain('aria-label="Open Agent"')
    expect(selected).not.toContain("data-assistant-toolbar")
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

  test("keeps only visual-media assistants mounted but disabled during document hydration", () => {
    const genericMarkup = renderWithEditor(
      selection(["node-a"]),
      true,
      (props) => <BuiltinCanvasNode {...props} />,
      true,
    )
    expect(toolbarCount(genericMarkup)).toBe(0)
    expect(genericMarkup).not.toContain("data-assistant-toolbar")

    const imageNode: CanvasNode = {
      data: { kind: "image", label: "Image", url: "" },
      id: "node-image",
      position: { x: 0, y: 0 },
      type: "file",
    }
    const markup = renderWithEditor(
      selection([imageNode.id]),
      true,
      (props) => <BuiltinCanvasNode {...props} />,
      true,
      { node: imageNode },
    )
    expect(toolbarCount(markup)).toBe(1)
    expect(markup).toContain('aria-busy="true"')
    expect(markup).toContain('disabled=""')
    expect(markup).toContain('inert=""')
    expect(markup).toContain("data-assistant-toolbar")
  })

  test("gives only image and video assistants a direct-generation capability", () => {
    for (const output of ["image", "video"] as const) {
      const mediaNode: CanvasNode = {
        data: { kind: output, label: output === "image" ? "Image" : "Video", url: "" },
        id: `node-${output}`,
        position: { x: 0, y: 0 },
        type: "file",
      }
      let request: CanvasAssistantRequest | undefined
      const markup = renderWithEditor(selection([mediaNode.id]), false, (props) => <BuiltinCanvasNode {...props} />, false, {
        assistantRender: (next) => {
          request = next
          return <div data-assistant-toolbar />
        },
        node: mediaNode,
      })

      expect(request?.generation?.output).toBe(output)
      expect(request?.generation?.onActivityChange).toBeFunction()
      expect(markup).toContain("data-assistant-toolbar")
      expect(markup).not.toContain('aria-label="Open Agent"')
    }

    let genericRequest: CanvasAssistantRequest | undefined
    const genericMarkup = renderWithEditor(
      selection([node.id]),
      false,
      (props) => <BuiltinCanvasNode {...props} />,
      false,
      {
        assistantRender: (next) => {
          genericRequest = next
          return <div data-assistant-toolbar />
        },
      },
    )
    expect(genericRequest).toBeUndefined()
    expect(genericMarkup).toContain('aria-label="Open Agent"')
    expect(genericMarkup).not.toContain("data-assistant-toolbar")
  })

  test("gives a visual-media assistant only its owner's persisted generation-model setter", () => {
    const imageNode: CanvasNode = {
      data: { kind: "image", label: "Image", url: "" },
      id: "node-image",
      position: { x: 0, y: 0 },
      type: "file",
    }
    const stored = setCanvasNodeGenerationToolId(
      createCanvasDocument({ id: "canvas-test", nodes: [imageNode] }),
      imageNode.id,
      "plugin.example:image.generate",
    )
    let request: CanvasAssistantRequest | undefined
    let committed: CanvasDocument | undefined
    renderWithEditor(selection([imageNode.id]), false, (props) => <BuiltinCanvasNode {...props} />, false, {
      assistantRender: (next) => {
        request = next
        return <div data-assistant-toolbar />
      },
      commit: (update) => {
        committed = update(stored)
      },
      document: stored,
      node: imageNode,
    })

    expect(request?.generation?.ownerToolId).toBe("plugin.example:image.generate")
    expect(request?.mentionedNodeIds).toEqual([])
    expect(request?.generation?.onActivityChange).toBeFunction()
    request?.generation?.onOwnerToolIdChange?.("plugin.example:image.alternate")
    expect(committed && getCanvasNodeGenerationToolId(committed.nodes[0])).toBe("plugin.example:image.alternate")
  })

  test("defaults file and Agent conversations to direct incoming inputs only", () => {
    const incoming = createTextNode({ id: "incoming", position: { x: -320, y: 0 }, text: "Input" })
    const outgoing = createTextNode({ id: "outgoing", position: { x: 640, y: 0 }, text: "Output" })
    const imageOwner: CanvasNode = {
      data: { kind: "image", label: "Image", url: "" },
      id: "image-owner",
      position: { x: 0, y: 0 },
      type: "file",
    }
    const imageDocument = createCanvasDocument({
      edges: [
        { id: "incoming-edge", source: incoming.id, target: imageOwner.id },
        { id: "duplicate-input", source: incoming.id, target: imageOwner.id },
        { id: "outgoing-edge", source: imageOwner.id, target: outgoing.id },
      ],
      id: "canvas-test",
      nodes: [imageOwner, incoming, outgoing],
    })
    let fileRequest: CanvasAssistantRequest | undefined
    renderWithEditor(
      selection([imageOwner.id]),
      false,
      (props) => <BuiltinCanvasNode {...props} />,
      false,
      {
        assistantRender: (request) => {
          fileRequest = request
          return <div data-assistant-toolbar />
        },
        document: imageDocument,
        node: imageOwner,
      },
    )
    expect(fileRequest?.mentionedNodeIds).toEqual([incoming.id])

    const agentOwner = createAgentNode({ id: "agent-owner", position: { x: 0, y: 0 } })
    const agentDocument = createCanvasDocument({
      edges: [
        { id: "agent-input", source: incoming.id, target: agentOwner.id },
        { id: "agent-output", source: agentOwner.id, target: outgoing.id },
      ],
      id: "canvas-test",
      nodes: [agentOwner, incoming, outgoing],
    })
    let agentRequest: CanvasAssistantRequest | undefined
    renderWithEditor(
      selection([agentOwner.id]),
      false,
      (props) => <BuiltinCanvasNode {...props} />,
      false,
      {
        assistantRender: (request) => {
          agentRequest = request
          return <div data-assistant-toolbar />
        },
        document: agentDocument,
        node: agentOwner,
      },
    )
    expect(agentRequest?.mode).toBe("agent")
    expect(agentRequest?.mentionedNodeIds).toEqual([incoming.id])
  })
})
