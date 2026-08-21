import { describe, expect, mock, test } from "bun:test"
import type { Editor } from "@tiptap/core"
import type { NodeProps } from "@xyflow/react"
import type { ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { createAgentNode, createCanvasDocument, createGroupNode, createMediaNode, createTextNode } from "../document"
import { CanvasEditorProvider, type CanvasEditorController } from "../editor-context"
import { createCanvasFileRendererRegistry } from "../file-renderer-registry"
import { setCanvasNodeGenerationToolId } from "../generation-preference"
import { setCanvasGroupAppearance } from "../group-appearance"
import { setCanvasGroupFolded } from "../group-fold"
import { canvasOptimisticGhostDataKey } from "../optimistic-overlay-react-flow"
import {
  finishCanvasNodeGenerationRun,
  markCanvasNodeGenerationRunRunning,
  startCanvasNodeGenerationRun,
  succeedCanvasNodeGenerationRun,
} from "../generation-run"
import type { CanvasSelectionAction } from "../selection-actions"
import type { CanvasSelectionDragPreparationStatus, CanvasSelectionDragSource } from "../selection-drag-source"
import { deriveCanvasSelectionContext } from "../selection-context"
import { CanvasServicesProvider, createCanvasServices, type CanvasAssistantRequest } from "../services"
import type { CanvasDocument, CanvasMediaNodeData, CanvasNode, CanvasSelection } from "../types"
import { CanvasGroupPresentationProvider, type CanvasGroupPresentationController } from "./group-presentation-context"

mock.module("@xyflow/react", () => ({
  Handle: (props: {
    "aria-disabled"?: boolean
    "aria-label"?: string
    children?: ReactNode
    id?: string
    isConnectable?: boolean
    style?: Record<string, unknown>
  }) => (
    <div
      aria-disabled={props["aria-disabled"]}
      aria-label={props["aria-label"]}
      data-handle-connectable={String(props.isConnectable)}
      data-handle-id={props.id}
      style={props.style}
    >
      {props.children}
    </div>
  ),
  NodeResizer: (props: { isVisible?: boolean; keepAspectRatio?: boolean; lineStyle?: { display?: string } }) =>
    props.isVisible === false ? null : (
      <div
        data-keep-aspect-ratio={String(Boolean(props.keepAspectRatio))}
        data-node-resizer
        data-side-resize={props.lineStyle?.display === "none" ? "hidden" : "visible"}
      />
    ),
  NodeToolbar: (props: {
    "aria-busy"?: boolean
    children?: ReactNode
    className?: string
    "data-canvas-node-entering"?: boolean
    inert?: boolean
    isVisible?: boolean
  }) => (
    <div
      aria-busy={props["aria-busy"]}
      className={props.className}
      data-canvas-node-entering={props["data-canvas-node-entering"] || undefined}
      data-node-toolbar
      data-visibility={props.isVisible === undefined ? "default" : String(props.isVisible)}
      inert={props.inert || undefined}
    >
      {props.children}
    </div>
  ),
  Position: { Bottom: "bottom", Left: "left", Right: "right", Top: "top" },
  getBezierPath: () => ["", 0, 0, 0, 0],
  useConnection: (selector: (state: { inProgress: boolean }) => unknown) => selector({ inProgress: false }),
}))

const {
  BuiltinCanvasNode,
  BuiltinFolderFileNode,
  BuiltinMediaFileNode,
  BuiltinTextFileNode,
  CanvasNodeChrome,
  CanvasNodeToolbarButton,
  CanvasTextFormattingToolbar,
  canOpenCanvasTextLineMenu,
  ExpandedTextEditorDialog,
  TextEditorDrawer,
  getCanvasTextMenuGeometry,
  isCanvasEmptyImageNodeData,
  isCanvasEmptyMediaNodeData,
  isCanvasTextLineMenuSelectionValid,
  isCanvasTextResourceEditable,
  moveCanvasTextLineMenuIndex,
  resolveCanvasTextHandleTarget,
  resolveCanvasGroupTitleEdit,
  runCanvasTextInlineCommand,
  shouldUpdateCutoutMediaSize,
  shouldShowCanvasTextInlineMenu,
  startCanvasSelectionDragFromNode,
} = await import("./builtin-node")
const {
  applyCanvasTextDraftBase,
  completeCanvasTextDraftSave,
  createCanvasTextDraftState,
  discardCanvasTextDraft,
  failCanvasTextDraftSave,
  rebaseCanvasTextDraft,
  saveCanvasTextDraft,
  updateCanvasTextDraft,
} = await import("../services")
const { CanvasMutationSurfaceProvider } = await import("./canvas-mutation-surface")

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
    assistant?: boolean
    assistantRender?: (request: CanvasAssistantRequest) => ReactNode
    canRelinkResource?: boolean
    commit?: CanvasEditorController["commit"]
    document?: CanvasDocument
    enteringNodeIds?: ReadonlySet<string>
    executeCommand?: CanvasEditorController["executeCommand"]
    executeSelectionAction?: CanvasEditorController["executeSelectionAction"]
    isSelectionActionPending?: CanvasEditorController["isSelectionActionPending"]
    mutationSurface?: { disabled: boolean; visible: boolean }
    focusedGroupId?: string | null
    locale?: CanvasEditorController["locale"]
    groupDropTargetId?: string | null
    groupSummaries?: CanvasGroupPresentationController["summaries"]
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
    canRelinkResource: options.canRelinkResource ?? false,
    commit: options.commit ?? (() => {}),
    connectionNodeTypes: [],
    quickConnectionNodeTypes: [],
    document: options.document ?? createCanvasDocument({ id: "canvas-test", nodes: [targetNode] }),
    duplicateNode: () => {},
    endGesture: () => {},
    enteringNodeIds: options.enteringNodeIds ?? new Set(),
    executeCommand: options.executeCommand ?? (() => {}),
    executeSelectionAction: options.executeSelectionAction ?? (() => {}),
    fileRenderers,
    finishNodeEntry: () => {},
    finishSelectionDrag: () => {},
    hydrating,
    isSelectionActionPending: options.isSelectionActionPending ?? (() => false),
    locale: options.locale,
    quickConnect: () => {},
    relinkResource: () => {},
    relinkSelectedResource: () => {},
    replaceResourceState: () => {},
    registerPendingDraft: () => () => {},
    readOnly,
    reducedMotion: false,
    removeNode: () => {},
    saveEditableCopy: async () => {},
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
  const services = createCanvasServices(
    options.assistant === false
      ? {}
      : {
          assistant: { render: options.assistantRender ?? (() => <div data-assistant-toolbar />) },
        },
  )

  const content = (
    <CanvasEditorProvider controller={controller}>
      <CanvasGroupPresentationProvider
        controller={{
          dropTargetId: options.groupDropTargetId ?? null,
          focus: () => {},
          focusedGroupId: options.focusedGroupId ?? null,
          summaries: options.groupSummaries ?? new Map(),
        }}
      >
        {child(nodeProps(true, targetNode))}
      </CanvasGroupPresentationProvider>
    </CanvasEditorProvider>
  )
  return renderToStaticMarkup(
    <CanvasServicesProvider services={services}>
      {options.mutationSurface ? (
        <CanvasMutationSurfaceProvider {...options.mutationSurface}>{content}</CanvasMutationSurfaceProvider>
      ) : (
        content
      )}
    </CanvasServicesProvider>,
  )
}

function toolbarCount(markup: string) {
  return markup.match(/data-node-toolbar/g)?.length ?? 0
}

function openingTagContaining(markup: string, marker: string) {
  const markerIndex = markup.indexOf(marker)
  if (markerIndex < 0) return ""
  const start = markup.lastIndexOf("<", markerIndex)
  const end = markup.indexOf(">", markerIndex)
  return start < 0 || end < 0 ? "" : markup.slice(start, end + 1)
}

describe("built-in text file drafts", () => {
  test("keeps edits local when late hydrated props arrive", () => {
    const initial = createCanvasTextDraftState({ contentRevision: "rev-before", text: "original" })
    const dirty = updateCanvasTextDraft(initial, "my draft")
    const afterLateProps = applyCanvasTextDraftBase(dirty, {
      contentRevision: "rev-late",
      text: "late hydration",
    })

    expect(afterLateProps).toEqual(dirty)
    expect(afterLateProps.content).toBe("my draft")
    expect(afterLateProps.dirty).toBeTrue()
  })

  test("preserves a conflicted draft and updates only the local base after save", () => {
    const dirty = updateCanvasTextDraft(
      createCanvasTextDraftState({ contentRevision: "rev-before", text: "original" }),
      "my draft",
    )
    const conflicted = failCanvasTextDraftSave(dirty, "This file changed outside Convax.")

    expect(conflicted).toMatchObject({ content: "my draft", dirty: true, error: expect.any(String) })

    const saved = completeCanvasTextDraftSave(conflicted, "rev-after")
    expect(saved).toEqual({
      baseContent: "my draft",
      baseRevision: "rev-after",
      content: "my draft",
      dirty: false,
      error: null,
    })
    expect(discardCanvasTextDraft(dirty)).toMatchObject({ content: "original", dirty: false })
  })

  test("rebases a conflicted draft onto the authoritative revision without losing local content", () => {
    const conflicted = failCanvasTextDraftSave(
      updateCanvasTextDraft(
        createCanvasTextDraftState({ contentRevision: "rev-before", text: "original" }),
        "my draft",
      ),
      "This file changed outside Convax.",
    )

    expect(rebaseCanvasTextDraft(conflicted, { contentRevision: "rev-latest", text: "latest content" })).toEqual({
      baseContent: "latest content",
      baseRevision: "rev-latest",
      content: "my draft",
      dirty: true,
      error: null,
    })
  })

  test("opens the Line Menu only at an empty line prefix and wraps keyboard selection", () => {
    expect(canOpenCanvasTextLineMenu("")).toBeTrue()
    expect(canOpenCanvasTextLineMenu("   ")).toBeTrue()
    expect(canOpenCanvasTextLineMenu("https:")).toBeFalse()
    expect(moveCanvasTextLineMenuIndex(0, -1, 6)).toBe(5)
    expect(moveCanvasTextLineMenuIndex(5, 1, 6)).toBe(0)
    expect(isCanvasTextLineMenuSelectionValid({ selectionFrom: 11, slashCharacter: "/", slashPosition: 10 })).toBeTrue()
    expect(
      isCanvasTextLineMenuSelectionValid({ selectionFrom: 20, slashCharacter: "/", slashPosition: 10 }),
    ).toBeFalse()
  })

  test("keeps the contextual menu inside the drawer near the bottom edge", () => {
    const geometry = getCanvasTextMenuGeometry(500, 480)
    expect(geometry).toEqual({ gripTop: 452, maxHeight: 204, popupTop: 288 })
    expect(geometry.popupTop + geometry.maxHeight).toBeLessThanOrEqual(492)
  })

  test("targets the hovered block instead of the stale text selection for handle commands", () => {
    expect(resolveCanvasTextHandleTarget({ documentSize: 100, hoverPosition: 72, selectionFrom: 12 })).toBe(72)
    expect(resolveCanvasTextHandleTarget({ documentSize: 100, hoverPosition: null, selectionFrom: 12 })).toBe(12)
    expect(resolveCanvasTextHandleTarget({ documentSize: 100, hoverPosition: 120, selectionFrom: 12 })).toBe(100)
  })

  test("shows inline formatting only for a non-empty editable text selection", () => {
    expect(
      shouldShowCanvasTextInlineMenu({
        codeBlockActive: false,
        editable: true,
        selectionFrom: 4,
        selectionTo: 12,
        textSelection: true,
      }),
    ).toBeTrue()
    expect(
      shouldShowCanvasTextInlineMenu({
        codeBlockActive: false,
        editable: true,
        selectionFrom: 4,
        selectionTo: 4,
        textSelection: true,
      }),
    ).toBeFalse()
    expect(
      shouldShowCanvasTextInlineMenu({
        codeBlockActive: true,
        editable: true,
        selectionFrom: 4,
        selectionTo: 12,
        textSelection: true,
      }),
    ).toBeFalse()
    expect(
      shouldShowCanvasTextInlineMenu({
        codeBlockActive: false,
        editable: false,
        selectionFrom: 4,
        selectionTo: 12,
        textSelection: true,
      }),
    ).toBeFalse()
    expect(
      shouldShowCanvasTextInlineMenu({
        codeBlockActive: false,
        editable: true,
        selectionFrom: 4,
        selectionTo: 12,
        textSelection: false,
      }),
    ).toBeFalse()
  })

  test("runs inline formatting through the editor chain while preserving focus", () => {
    const calls: string[] = []
    const chain = {
      focus() {
        calls.push("focus")
        return this
      },
      run() {
        calls.push("run")
        return true
      },
      toggleBold() {
        calls.push("bold")
        return this
      },
      toggleCode() {
        calls.push("code")
        return this
      },
      toggleItalic() {
        calls.push("italic")
        return this
      },
      toggleStrike() {
        calls.push("strike")
        return this
      },
    }
    const editor = { chain: () => chain } as unknown as Editor

    expect(runCanvasTextInlineCommand(editor, "bold")).toBeTrue()
    expect(calls).toEqual(["focus", "bold", "run"])
  })

  test("saves the local draft through the text resource service only", async () => {
    const save = mock(async () => ({ contentRevision: "rev-after" }))
    const dirty = updateCanvasTextDraft(
      createCanvasTextDraftState({ contentRevision: "rev-before", text: "original" }),
      "# Changed",
    )

    const saved = await saveCanvasTextDraft(dirty, "text-node", { save }, new AbortController().signal)

    expect(save).toHaveBeenCalledWith(
      { content: "# Changed", contentRevision: "rev-before", nodeId: "text-node" },
      expect.any(AbortSignal),
    )
    expect(saved).toMatchObject({ baseContent: "# Changed", baseRevision: "rev-after", dirty: false })
  })

  test("enables editing only for explicitly editable hydrated Project text", () => {
    expect(
      isCanvasTextResourceEditable({
        contentRevision: "a".repeat(64),
        editableText: true,
        status: "ready",
        text: "project",
      }),
    ).toBeTrue()
    expect(
      isCanvasTextResourceEditable({
        contentRevision: "a".repeat(64),
        editableText: false,
        status: "ready",
        text: "managed",
      }),
    ).toBeFalse()
    expect(isCanvasTextResourceEditable({ editableText: true, status: "ready", text: "missing revision" })).toBeFalse()
  })
})

describe("built-in node toolbar visibility", () => {
  test("renders optimistic ghosts without mounting the registered file renderer", () => {
    const ghost: CanvasNode = {
      ...node,
      data: {
        ...node.data,
        [canvasOptimisticGhostDataKey]: true,
        status: "pending",
      },
    }
    const markup = renderWithEditor(selection([]), false, (props) => <BuiltinCanvasNode {...props} />, false, {
      node: ghost,
    })

    expect(markup).toContain('data-canvas-optimistic-ghost="test-file"')
    expect(markup).not.toContain("data-file-renderer")
    expect(markup).not.toContain("data-node-resizer")
  })

  test("renders a known empty text ghost as the final text-card shell instead of a loading placeholder", () => {
    const textGhost = createTextNode({
      id: "ghost-text",
      label: "Text",
      metadata: {},
      position: { x: 0, y: 0 },
      resourceState: { status: "ready", text: "" },
    })
    const markup = renderWithEditor(selection([]), false, (props) => <BuiltinCanvasNode {...props} />, false, {
      node: {
        ...textGhost,
        data: {
          ...textGhost.data,
          [canvasOptimisticGhostDataKey]: true,
          status: "idle",
        },
      },
    })

    expect(markup).toContain('data-canvas-optimistic-empty-card="text"')
    expect(markup).toContain("convax-text-editor__prosemirror")
    expect(markup).toContain('data-placeholder="Start writing..."')
    expect(markup).not.toContain('data-canvas-optimistic-placeholder="pending"')
    expect(markup).not.toContain("data-file-renderer")
    expect(markup).not.toContain("data-node-resizer")
  })

  test("preserves the side-drawer export as a compatibility alias", () => {
    expect(TextEditorDrawer).toBe(ExpandedTextEditorDialog)
    const markup = renderToStaticMarkup(<TextEditorDrawer editor={null} label="Legacy title" onClose={() => {}} />)
    expect(markup).toContain(">Legacy title</textarea>")
    expect(markup).toContain('readOnly=""')
  })

  test("renders a global paper-like modal with an editable title and no permanent chrome row", () => {
    const markup = renderToStaticMarkup(
      <ExpandedTextEditorDialog
        editor={null}
        onTitleChange={() => {}}
        onTitleCommit={() => {}}
        onClose={() => {}}
        onSave={() => {}}
        sourceRect={{ height: 120, left: 20, top: 40, width: 240 }}
        title="Story outline"
        toolbar={<div data-rich-text-toolbar="true" />}
      />,
    )

    expect(markup).toContain("<dialog")
    expect(markup).toContain('role="dialog"')
    expect(markup).toContain('aria-modal="true"')
    expect(markup).toContain('aria-label="Document title"')
    expect(markup).toContain("<textarea")
    expect(markup).toContain(">Story outline</textarea>")
    expect(markup).toContain('rows="1"')
    expect(markup).toContain("convax-text-editor-dialog")
    expect(markup).toContain('data-canvas-rect-enter="true"')
    expect(markup).toContain("convax-text-editor-dialog__title")
    expect(markup).not.toContain("convax-text-editor-drawer")
    expect(markup).toContain('aria-label="Open block handle menu"')
    expect(markup).not.toContain('aria-label="Text formatting"')
    expect(markup).not.toContain('data-rich-text-toolbar="true"')
    expect(markup).not.toContain("Expanded text editor")
    expect(markup).not.toContain(">Save<")
    expect(markup).not.toContain(">Discard<")
    expect(markup).toContain('aria-label="Close expanded editor"')
  })

  test("keeps save conflicts actionable inside the expanded editor", () => {
    const markup = renderToStaticMarkup(
      <ExpandedTextEditorDialog
        editor={null}
        discardLabel="Discard and reload"
        error="This file changed outside Convax. Your draft was kept."
        onClose={() => {}}
        onDiscard={() => {}}
        onReload={() => {}}
        onTitleChange={() => {}}
        onTitleCommit={() => {}}
        title="Story outline"
      />,
    )

    expect(markup).toContain('role="alert"')
    expect(markup).toContain("Reload latest")
    expect(markup).toContain("Discard and reload")
  })

  test("restores the complete fixed rich-text command bar", () => {
    const editor = {
      isActive: (nameOrAttributes: string | Record<string, unknown>) => nameOrAttributes === "bold",
    } as unknown as Editor
    const markup = renderToStaticMarkup(<CanvasTextFormattingToolbar editor={editor} onCommand={() => {}} />)

    for (const label of [
      "Paragraph",
      "Heading 1",
      "Heading 2",
      "Bold",
      "Italic",
      "Strikethrough",
      "Inline code",
      "Bullet list",
      "Numbered list",
      "Quote",
      "Align left",
      "Align center",
      "Align right",
    ]) {
      expect(markup).toContain(`aria-label="${label}"`)
    }
    expect(markup).toContain('data-canvas-text-formatting-toolbar="true"')
    expect(markup).toContain('aria-label="Bold" aria-pressed="true"')
  })

  test("can show a compact visible label for commands without a meaningful icon", () => {
    const markup = renderToStaticMarkup(<CanvasNodeToolbarButton label="刷新图片" onClick={() => {}} visibleLabel />)

    expect(markup).toContain("刷新图片")
    expect(markup).toContain("convax-node-toolbar__button--labeled")
    expect(markup).toContain('aria-label="刷新图片"')
  })

  test("presents idle image and video targets as generation cards instead of missing resources", () => {
    for (const kind of ["image", "video"] as const) {
      const node: CanvasNode = {
        id: `empty-${kind}`,
        type: "file",
        position: { x: 0, y: 0 },
        data: {
          kind,
          label: kind[0]!.toUpperCase() + kind.slice(1),
          metadata: {},
          resourceState: { status: "ready" },
          status: "idle",
        },
      }
      const markup = renderWithEditor(
        selection([node.id]),
        false,
        (props) => <BuiltinMediaFileNode {...props} />,
        false,
        { canRelinkResource: true, node },
      )

      expect(markup).toContain(`data-canvas-empty-media="${kind}"`)
      expect(markup).toContain('class="convax-media-state-card__content"')
      expect(markup).toContain('data-canvas-media-state="empty"')
      expect(markup).toContain(`data-canvas-empty-placeholder="${kind}"`)
      expect(markup).toContain(kind === "video" ? "lucide-video" : "lucide-image")
      expect(markup).toContain("convax-media-state-card__icon")
      expect(markup).not.toContain("convax-media-state-card__title")
      expect(markup).toContain(">Add<")
      expect(markup).not.toContain("convax-node__surface--video")
      expect(openingTagContaining(markup, `aria-label="${kind === "video" ? "Add video" : "Add image"}"`)).toContain(
        "convax-media-state-card__action-button",
      )
      expect(openingTagContaining(markup, `aria-label="${kind === "video" ? "Add video" : "Add image"}"`)).toContain(
        "border-transparent",
      )
      expect(
        openingTagContaining(markup, `aria-label="${kind === "video" ? "Add video" : "Add image"}"`),
      ).not.toContain("bg-primary")
      expect(openingTagContaining(markup, `aria-label="${kind === "video" ? "Add video" : "Add image"}"`)).toContain(
        "h-7",
      )
      expect(markup).toContain(`aria-label="${kind === "video" ? "Add video" : "Add image"}"`)
      expect(markup).not.toContain(`${kind} unavailable`)
      expect(markup).not.toContain("Relink a selected Project resource")
      expect(markup).not.toContain("Add an image")
      expect(markup).not.toContain("Describe what you want to generate below")
      expect(markup).not.toContain(`Empty ${kind}`)
    }
  })

  test("exposes explicit relink actions for missing resources and editable-copy for managed text", () => {
    const missingImage: CanvasNode = {
      id: "missing-image",
      type: "file",
      position: { x: 0, y: 0 },
      data: {
        kind: "image",
        label: "Missing image",
        metadata: {},
        resourceState: { status: "missing" },
      },
    }
    const missingFolder: CanvasNode = {
      id: "missing-folder",
      type: "file",
      position: { x: 0, y: 0 },
      data: {
        kind: "folder",
        label: "Missing folder",
        metadata: {},
        resourceState: { status: "missing" },
      },
    }
    const managedText: CanvasNode = {
      id: "managed-text",
      type: "file",
      position: { x: 0, y: 0 },
      data: {
        kind: "text",
        label: "Managed text",
        metadata: {},
        name: "brief.md",
        resourceState: {
          canSaveEditableCopy: true,
          contentRevision: "a".repeat(64),
          editableText: false,
          status: "ready",
          text: "# Brief",
        },
      },
    }

    const imageMarkup = renderWithEditor(
      selection([missingImage.id]),
      false,
      (props) => <BuiltinMediaFileNode {...props} />,
      false,
      { node: missingImage },
    )
    const folderMarkup = renderWithEditor(
      selection([missingFolder.id]),
      false,
      (props) => <BuiltinFolderFileNode {...props} />,
      false,
      { node: missingFolder },
    )
    const textMarkup = renderWithEditor(
      selection([managedText.id]),
      false,
      (props) => <BuiltinTextFileNode {...props} />,
      false,
      { node: managedText },
    )

    expect(imageMarkup).toContain('aria-label="Relink selected Project resource"')
    expect(imageMarkup).toContain('aria-label="Relink local file"')
    expect(imageMarkup).not.toContain("Relink is not available yet")
    expect(imageMarkup).toContain('class="convax-media-state-card__content"')
    expect(imageMarkup).toContain('data-canvas-media-state="unavailable"')
    expect(imageMarkup).toContain("image unavailable")
    expect(imageMarkup).toContain("Relink a selected Project resource or choose a local file")
    expect(imageMarkup).not.toContain("Empty image")
    expect(folderMarkup).toContain('aria-label="Relink selected Project directory"')
    expect(folderMarkup).not.toContain('aria-label="Relink local file"')
    expect(folderMarkup).toContain("data-canvas-folder-card")
    expect(folderMarkup).toContain("data-canvas-project-folder")
    expect(folderMarkup).toContain("convax-group-folder__paper")
    expect(folderMarkup).toContain("Project folder")
    expect(folderMarkup).not.toContain("convax-node__title")
    expect(textMarkup).toContain('aria-label="Save editable copy"')

    const unmanagedTextMarkup = renderWithEditor(
      selection([managedText.id]),
      false,
      (props) => <BuiltinTextFileNode {...props} />,
      false,
      {
        node: {
          ...managedText,
          data: {
            ...managedText.data,
            resourceState: {
              contentRevision: "a".repeat(64),
              editableText: false,
              status: "ready",
              text: "# Brief",
            },
          },
        },
      },
    )
    expect(unmanagedTextMarkup).not.toContain('aria-label="Save editable copy"')
  })

  test("marks image and video cards for aligned media chrome and video-specific framing", () => {
    const imageMarkup = renderWithEditor(selection([]), false, (props) => (
      <BuiltinMediaFileNode
        {...props}
        data={{
          kind: "image",
          label: "Portrait",
          metadata: {},
          resourceState: { status: "ready", url: "asset://portrait" },
        }}
      />
    ))
    const videoMarkup = renderWithEditor(selection([]), false, (props) => (
      <BuiltinMediaFileNode
        {...props}
        data={{ kind: "video", label: "Clip", metadata: {}, resourceState: { status: "ready", url: "asset://clip" } }}
      />
    ))

    expect(imageMarkup).toContain("convax-node__surface--media")
    expect(imageMarkup).toContain("convax-node__surface--image")
    expect(imageMarkup).not.toContain("convax-node__surface--video")
    expect(imageMarkup).toContain('src="asset://portrait"')
    expect(videoMarkup).toContain("convax-node__surface--media")
    expect(videoMarkup).not.toContain("convax-node__surface--image")
    expect(videoMarkup).toContain("convax-node__surface--video")
    expect(videoMarkup).toContain('src="asset://clip"')
  })

  test("keeps image and video cards fitted and replaces the fit toggle with full-screen viewing", () => {
    for (const kind of ["image", "video"] as const) {
      const mediaNode = createMediaNode({
        id: `${kind}-fit-only`,
        position: { x: 0, y: 0 },
        resource: {
          id: `${kind}-fit-only`,
          kind,
          metadata: {},
          state: { status: "ready", url: `asset://${kind}-fit-only` },
        },
      })
      const legacyCoverNode = { ...mediaNode, data: { ...mediaNode.data, fit: "cover" as const } }
      const markup = renderWithEditor(
        selection([legacyCoverNode.id]),
        false,
        (props) => <BuiltinMediaFileNode {...props} />,
        false,
        { node: legacyCoverNode },
      )

      expect(markup).toContain("object-contain")
      expect(markup).not.toContain("object-cover")
      expect(markup).toContain(`aria-label="View ${kind} full screen"`)
      expect(markup).not.toContain("Fill frame")
      expect(markup).not.toContain("Fit inside frame")
    }
  })

  test("runs cutout scan and dissolve on the adjacent generated image node", () => {
    const source = createMediaNode({
      id: "cutout-source",
      position: { x: 0, y: 0 },
      resource: {
        id: "cutout-source-resource",
        kind: "image",
        metadata: {},
        state: { status: "ready", url: "convax-asset://cutout-source" },
      },
    })
    const pendingBase = createMediaNode({
      id: "cutout-result",
      position: { x: 384, y: 0 },
      resource: {
        id: "cutout-result-resource",
        kind: "image",
        metadata: {},
        state: { status: "ready", url: "" },
      },
    })
    const pending = { ...pendingBase, data: { ...pendingBase.data, status: "pending" as const } }
    const document = {
      ...createCanvasDocument({ id: "cutout-canvas", nodes: [source, pending] }),
      edges: [{ id: "cutout-edge", source: source.id, target: pending.id, type: "canvas" as const }],
    }
    const running = markCanvasNodeGenerationRunRunning(
      startCanvasNodeGenerationRun(document, pending.id, {
        operationId: "cutout-operation",
        prompt: "Remove the image background",
        toolId: "cutout-studio/background.remove",
      }),
      pending.id,
      "cutout-operation",
      "cutout-task",
    )
    const runningNode = running.nodes.find((candidate) => candidate.id === pending.id)!
    const runningMarkup = renderWithEditor(
      selection([pending.id]),
      false,
      (props) => <BuiltinMediaFileNode {...props} />,
      false,
      { document: running, node: runningNode },
    )
    expect(runningMarkup).toContain('data-canvas-cutout-presentation="scanning"')
    expect(runningMarkup).toContain('src="convax-asset://cutout-source"')
    expect(runningMarkup).toContain("convax-cutout-media__dissolve-source")
    expect(runningMarkup).toContain("convax-cutout-media__scan-beam")
    expect(runningMarkup).not.toContain('data-slot="loading-spinner"')

    const awaitingHydration = succeedCanvasNodeGenerationRun(
      {
        ...running,
        nodes: running.nodes.map((candidate) =>
          candidate.id === pending.id
            ? { ...candidate, data: { ...candidate.data, status: "idle" as const } }
            : candidate,
        ),
      },
      pending.id,
      "cutout-operation",
    )
    const awaitingHydrationNode = awaitingHydration.nodes.find((candidate) => candidate.id === pending.id)!
    const awaitingHydrationMarkup = renderWithEditor(
      selection([pending.id]),
      false,
      (props) => <BuiltinMediaFileNode {...props} />,
      false,
      { document: awaitingHydration, node: awaitingHydrationNode },
    )
    expect(awaitingHydrationMarkup).toContain('data-canvas-cutout-presentation="result"')
    expect(awaitingHydrationMarkup).toContain('src="convax-asset://cutout-source"')
    expect(awaitingHydrationMarkup).not.toContain("image unavailable")

    const withResult = {
      ...running,
      nodes: running.nodes.map((candidate) =>
        candidate.id === pending.id
          ? {
              ...candidate,
              data: {
                ...candidate.data,
                resourceState: { status: "ready" as const, url: "convax-asset://cutout-result" },
                status: "idle" as const,
              },
            }
          : candidate,
      ),
    }
    const succeeded = succeedCanvasNodeGenerationRun(withResult, pending.id, "cutout-operation")
    const succeededNode = succeeded.nodes.find((candidate) => candidate.id === pending.id)!
    const succeededMarkup = renderWithEditor(
      selection([pending.id]),
      false,
      (props) => <BuiltinMediaFileNode {...props} />,
      false,
      { document: succeeded, node: succeededNode },
    )
    expect(succeededMarkup).toContain('data-canvas-cutout-presentation="result"')
    expect(succeededMarkup).toContain('src="convax-asset://cutout-result"')
    expect(succeededMarkup).toContain('src="convax-asset://cutout-source"')
    expect(succeededMarkup).toContain('crossorigin="anonymous"')
    expect(succeededMarkup).toContain('loading="eager"')
  })

  test("does not resize the pending cutout node from its source-image scan preview", () => {
    expect(shouldUpdateCutoutMediaSize("")).toBe(false)
    expect(shouldUpdateCutoutMediaSize("   ")).toBe(false)
    expect(shouldUpdateCutoutMediaSize("convax-asset://cutout-result")).toBe(true)
  })

  test("gives newly created empty image and video cards a centered add action", () => {
    for (const kind of ["image", "video"] as const) {
      const emptyMedia: CanvasNode = {
        id: `empty-${kind}`,
        type: "file",
        position: { x: 0, y: 0 },
        data: {
          kind,
          label: kind[0]!.toUpperCase() + kind.slice(1),
          metadata: {},
          resourceState: { status: "ready" },
          status: "idle",
        },
      }
      const addAria = kind === "video" ? "Add video" : "Add image"

      const editable = renderWithEditor(selection([]), false, (props) => <BuiltinMediaFileNode {...props} />, false, {
        canRelinkResource: true,
        node: emptyMedia,
      })
      const readOnly = renderWithEditor(selection([]), true, (props) => <BuiltinMediaFileNode {...props} />, false, {
        canRelinkResource: true,
        node: emptyMedia,
      })
      const chinese = renderWithEditor(selection([]), false, (props) => <BuiltinMediaFileNode {...props} />, false, {
        canRelinkResource: true,
        locale: "zh-CN",
        node: emptyMedia,
      })

      expect(editable).toContain(`data-canvas-empty-media="${kind}"`)
      expect(editable).toContain(`data-canvas-empty-placeholder="${kind}"`)
      expect(editable).toContain(kind === "video" ? "lucide-video" : "lucide-image")
      expect(editable).toContain(">Add<")
      expect(openingTagContaining(editable, `aria-label="${addAria}"`)).not.toContain('disabled=""')
      expect(openingTagContaining(readOnly, `aria-label="${addAria}"`)).toContain('disabled=""')
      expect(chinese).toContain(">添加<")
      expect(chinese).toContain(`aria-label="${kind === "video" ? "添加视频" : "添加图片"}"`)
      expect(editable).not.toContain("Upload")
      expect(editable).not.toContain("Generate")
    }
  })

  test("recognizes the exact durable empty image and video shape after runtime state is stripped on reload", () => {
    for (const kind of ["image", "video"] as const) {
      const durableEmptyData: CanvasMediaNodeData = {
        kind,
        label: kind[0]!.toUpperCase() + kind.slice(1),
        metadata: {},
        status: "idle",
      }
      const durableEmpty: CanvasNode = {
        data: durableEmptyData,
        id: `durable-empty-${kind}`,
        position: { x: 0, y: 0 },
        type: "file",
      }

      expect(isCanvasEmptyMediaNodeData(durableEmptyData)).toBe(true)
      expect(isCanvasEmptyImageNodeData(durableEmptyData)).toBe(kind === "image")
      const markup = renderWithEditor(selection([]), false, (props) => <BuiltinMediaFileNode {...props} />, false, {
        canRelinkResource: true,
        node: durableEmpty,
      })
      expect(markup).toContain(`data-canvas-empty-media="${kind}"`)
      expect(markup).toContain(`aria-label="${kind === "video" ? "Add video" : "Add image"}"`)
      expect(markup).not.toContain(`${kind} unavailable`)
    }
  })

  test("does not mistake referenced, pending, failed, or missing images for a new empty image", () => {
    const cases: CanvasMediaNodeData[] = [
      {
        kind: "image",
        label: "Referenced",
        metadata: {},
        name: "photo.png",
        resourceState: { status: "ready" },
      },
      {
        kind: "image",
        label: "Typed reference",
        metadata: {},
        mimeType: "image/png",
        status: "idle",
      },
      {
        kind: "image",
        label: "Project resource reference",
        metadata: { convaxProjectResource: { kind: "project-file", path: "Images/photo.png" } },
        status: "idle",
      },
      {
        kind: "image",
        label: "Hydrated reference",
        metadata: {},
        resourceState: { status: "ready", url: "convax-resource://photo" },
        status: "idle",
      },
      {
        kind: "image",
        label: "Revisioned resource",
        metadata: {},
        resourceState: { contentRevision: "a".repeat(64), status: "ready" },
        status: "idle",
      },
      {
        kind: "image",
        label: "Runtime poster",
        metadata: {},
        resourceState: { posterUrl: "convax-resource://poster", status: "ready" },
        status: "idle",
      },
      {
        error: "Unexpected resource error",
        kind: "image",
        label: "Inconsistent idle error",
        metadata: {},
        resourceState: { status: "ready" },
        status: "idle",
      },
      {
        kind: "image",
        label: "Pending",
        metadata: {},
        name: "photo.png",
        resourceState: { status: "ready" },
        status: "pending",
      },
      {
        error: "Generation failed",
        kind: "image",
        label: "Failed",
        metadata: {},
        resourceState: { status: "ready" },
        status: "error",
      },
      {
        kind: "image",
        label: "Missing",
        metadata: {},
        resourceState: { status: "missing" },
      },
      {
        kind: "image",
        label: "Awaiting hydration",
        metadata: {},
        resourceState: { status: "stale" },
        status: "idle",
      },
      {
        kind: "video",
        label: "Referenced video",
        metadata: {},
        name: "clip.mp4",
        resourceState: { status: "ready" },
      },
      {
        kind: "video",
        label: "Pending video",
        metadata: {},
        name: "clip.mp4",
        resourceState: { status: "ready" },
        status: "pending",
      },
    ]

    for (const [index, data] of cases.entries()) {
      expect(isCanvasEmptyImageNodeData(data)).toBe(false)
      expect(isCanvasEmptyMediaNodeData(data)).toBe(false)
      const target: CanvasNode = {
        data,
        id: `not-empty-${index}`,
        position: { x: 0, y: 0 },
        type: "file",
      }
      const markup = renderWithEditor(selection([]), false, (props) => <BuiltinMediaFileNode {...props} />, false, {
        canRelinkResource: true,
        node: target,
      })
      expect(markup).not.toContain("data-canvas-empty-media")
      expect(markup).not.toContain('aria-label="Add image"')
      expect(markup).not.toContain('aria-label="Add video"')
    }
  })

  test("renders persisted pending and error resource lifecycle overlays", () => {
    const image = createMediaNode({
      id: "pending-image",
      position: { x: 0, y: 0 },
      resource: {
        id: "pending-image",
        kind: "image",
        metadata: {},
        mimeType: "image/png",
        name: "photo.png",
        state: { status: "ready" },
      },
    })
    const pending = renderWithEditor(
      selection([]),
      false,
      (props) => <BuiltinCanvasNode {...props} data={{ ...props.data, status: "pending" }} />,
      false,
      { node: image },
    )
    expect(pending).toContain('data-canvas-persisted-resource-status="pending"')
    expect(pending).toContain('aria-busy="true"')
    expect(pending).toContain("正在生成…")
    expect(pending).toContain('data-slot="loading-spinner"')
    expect(pending.match(/data-slot="loading-spinner"/g)).toHaveLength(1)
    expect(pending).toContain('aria-hidden="true"')
    expect(pending).not.toContain("data-assistant-toolbar")
    expect(openingTagContaining(pending, 'data-canvas-persisted-resource-status="pending"')).not.toContain("nodrag")

    const failed = renderWithEditor(
      selection([image.id]),
      false,
      (props) => (
        <BuiltinCanvasNode {...props} data={{ ...props.data, error: "Creative Tools 服务不可用", status: "error" }} />
      ),
      false,
      { node: image },
    )
    expect(failed).toContain('data-canvas-persisted-resource-status="error"')
    expect(failed).toContain('role="alert"')
    expect(failed).toContain(">生成失败<")
    expect(failed).not.toContain("Creative Tools 服务不可用")
    expect(failed).not.toContain("修改并重试")
    expect(failed).not.toContain('aria-label="Add image"')
    expect(failed).not.toContain('aria-label="Add video"')
    expect(failed).not.toContain("data-assistant-toolbar")
    expect(openingTagContaining(failed, 'data-canvas-persisted-resource-status="error"')).not.toContain("nodrag")
  })

  test("does not treat a blank image or video card as generation work", () => {
    for (const kind of ["image", "video"] as const) {
      const empty: CanvasNode = {
        data: {
          kind,
          label: kind === "video" ? "Video" : "Image",
          metadata: {},
          resourceState: { status: "ready" },
          status: "pending",
        },
        id: `empty-${kind}`,
        position: { x: 0, y: 0 },
        type: "file",
      }
      expect(isCanvasEmptyMediaNodeData(empty.data)).toBe(true)
      const overlay = renderWithEditor(selection([]), false, (props) => <BuiltinCanvasNode {...props} />, false, {
        node: empty,
      })
      expect(overlay).not.toContain("正在生成")
      expect(overlay).not.toContain('data-canvas-persisted-resource-status="pending"')
      expect(overlay).not.toContain('aria-busy="true"')

      const card = renderWithEditor(selection([]), false, (props) => <BuiltinMediaFileNode {...props} />, false, {
        canRelinkResource: true,
        node: empty,
      })
      expect(card).toContain(`data-canvas-empty-media="${kind}"`)
      expect(card).toContain(`aria-label="${kind === "video" ? "Add video" : "Add image"}"`)
    }
  })

  test("does not treat a blank text card as generation work", () => {
    const text = createTextNode({
      id: "untitled-text",
      label: "Untitled",
      metadata: {},
      position: { x: 0, y: 0 },
      resourceState: { status: "ready", text: "" },
    })
    const pending = renderWithEditor(
      selection([]),
      false,
      (props) => <BuiltinCanvasNode {...props} data={{ ...props.data, status: "pending" }} />,
      false,
      { node: text },
    )
    expect(pending).toContain("Untitled")
    expect(pending).not.toContain("正在生成")
    expect(pending).not.toContain('data-canvas-persisted-resource-status="pending"')
    expect(pending).not.toContain('aria-busy="true"')
  })

  test("pins toolbar visibility to the Canvas-owned sole selection", () => {
    const markup = renderWithEditor(selection(["node-a"]), false, (props) => (
      <CanvasNodeChrome icon={null} label="Test" node={props} toolbar={<div data-built-in-toolbar />}>
        <div />
      </CanvasNodeChrome>
    ))

    expect(toolbarCount(markup)).toBe(1)
    expect(markup).toContain('data-visibility="true"')
    expect(markup).toContain('data-canvas-node-drag-handle="true"')
  })

  test("keeps a sole-selected toolbar mounted but inert during a non-blocking document refresh", () => {
    const markup = renderWithEditor(
      selection(["node-a"]),
      true,
      (props) => (
        <CanvasNodeChrome icon={null} label="Test" node={props} toolbar={<div data-built-in-toolbar />}>
          <div />
        </CanvasNodeChrome>
      ),
      true,
      { mutationSurface: { disabled: true, visible: true } },
    )

    expect(toolbarCount(markup)).toBe(1)
    expect(openingTagContaining(markup, "data-node-toolbar")).toContain('aria-busy="true"')
    expect(openingTagContaining(markup, "data-node-toolbar")).toContain('inert=""')
    expect(openingTagContaining(markup, "data-node-toolbar")).toContain('data-visibility="true"')
  })

  test("exposes host-neutral kind and status hooks for semantic appearance", () => {
    const pendingNode = { ...node, data: { ...node.data, status: "pending" as const } }
    const markup = renderWithEditor(
      selection(["node-a"]),
      false,
      (props) => (
        <CanvasNodeChrome icon={null} label="Test" node={props}>
          <div />
        </CanvasNodeChrome>
      ),
      false,
      { node: pendingNode },
    )

    expect(markup).toContain('data-canvas-node-kind="test-file"')
    expect(markup).toContain('data-canvas-node-status="pending"')
  })

  test("marks only explicitly presented node chrome and keeps the React Flow position layer untouched", () => {
    const entering = renderWithEditor(
      selection(["node-a"]),
      false,
      (props) => (
        <CanvasNodeChrome icon={null} label="Test" node={props} toolbar={<div data-built-in-toolbar />}>
          <iframe title="Plugin surface" />
        </CanvasNodeChrome>
      ),
      false,
      { enteringNodeIds: new Set(["node-a"]) },
    )
    const stable = renderWithEditor(selection([]), false, (props) => (
      <CanvasNodeChrome icon={null} label="Test" node={props}>
        <iframe title="Plugin surface" />
      </CanvasNodeChrome>
    ))

    expect(entering).toContain('data-canvas-node-entering="true"')
    expect(openingTagContaining(entering, "data-node-toolbar")).toContain('data-canvas-node-entering="true"')
    expect(entering).toContain("convax-node__entry-shell")
    expect(entering).toContain("<iframe")
    expect(stable).not.toContain("data-canvas-node-entering")
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

  test("keeps fixed left-input and right-output handles mounted but inert while read-only", () => {
    const render = (readOnly: boolean) =>
      renderWithEditor(selection(["node-a"]), readOnly, (props) => (
        <CanvasNodeChrome icon={null} label="Test" node={props}>
          <div />
        </CanvasNodeChrome>
      ))

    const editable = render(false)
    expect(editable).toContain('data-handle-id="target-left"')
    expect(editable).toContain('data-handle-id="source-right"')
    expect(editable.match(/data-handle-connectable="true"/g)).toHaveLength(2)

    const readOnly = render(true)
    expect(readOnly).toContain('data-handle-id="target-left"')
    expect(readOnly).toContain('data-handle-id="source-right"')
    expect(readOnly.match(/data-handle-connectable="false"/g)).toHaveLength(2)
    expect(readOnly).not.toContain("convax-node__connection-icon")
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

  test("limits media, file, and Project folder cards to corner-only proportional resize", () => {
    for (const kind of ["image", "video", "audio", "file"] as const) {
      const mediaNode = createMediaNode({
        id: `${kind}-resize`,
        position: { x: 0, y: 0 },
        resource: {
          id: `${kind}-resize`,
          kind,
          metadata: {},
          state: { status: "ready", url: `asset://${kind}-resize` },
        },
      })
      const markup = renderWithEditor(
        selection([mediaNode.id]),
        false,
        (props) => <BuiltinMediaFileNode {...props} />,
        false,
        { node: mediaNode },
      )

      expect(markup).toContain('data-keep-aspect-ratio="true"')
      expect(markup).toContain('data-side-resize="hidden"')
    }

    const folderNode: CanvasNode = {
      id: "folder-proportional-resize",
      type: "file",
      position: { x: 0, y: 0 },
      data: {
        kind: "folder",
        label: "Design assets",
        metadata: {},
        resourceState: { status: "ready" },
      },
    }
    const folderMarkup = renderWithEditor(
      selection([folderNode.id]),
      false,
      (props) => <BuiltinFolderFileNode {...props} />,
      false,
      { node: folderNode },
    )

    expect(folderMarkup).toContain('data-keep-aspect-ratio="true"')
    expect(folderMarkup).toContain('data-side-resize="hidden"')

    const textNode = createTextNode({
      id: "text-free-resize",
      metadata: {},
      position: { x: 0, y: 0 },
      resourceState: {
        contentRevision: "a".repeat(64),
        editableText: true,
        status: "ready",
        text: "Free resize",
      },
    })
    const textMarkup = renderWithEditor(
      selection([textNode.id]),
      false,
      (props) => (
        <CanvasNodeChrome icon={null} label="Text" node={props}>
          <div />
        </CanvasNodeChrome>
      ),
      false,
      { node: textNode },
    )

    expect(textMarkup).toContain('data-keep-aspect-ratio="false"')
    expect(textMarkup).toContain('data-side-resize="visible"')
  })

  test("passes single-card activation instead of aggregate membership to registered renderers", () => {
    const render = (currentSelection: CanvasSelection) =>
      renderWithEditor(currentSelection, false, (props) => <BuiltinCanvasNode {...props} />)

    expect(render(selection(["node-a"]))).toContain('data-selected="true"')
    expect(render(selection(["node-a", "node-b"]))).toContain('data-selected="false"')
    expect(render(selection(["node-a"], ["edge-a"]))).toContain('data-selected="false"')
  })

  test("renders unmarked structural Groups expanded without a conflicting local toolbar", () => {
    const group = createGroupNode({
      height: 240,
      id: "group-a",
      position: { x: 0, y: 0 },
      width: 360,
    })
    const render = (currentSelection: CanvasSelection) =>
      renderWithEditor(currentSelection, false, (props) => <BuiltinCanvasNode {...props} />, false, { node: group })

    const single = render(selection([group.id]))
    expect(single).toContain("data-canvas-group")
    expect(single).toContain('data-handle-id="target-left"')
    expect(single).toContain('data-handle-id="source-right"')
    expect(single.match(/data-handle-connectable="true"/g)).toHaveLength(2)
    expect(single).toContain("data-node-resizer")
    expect(single).not.toContain("data-node-toolbar")

    const multi = render(selection([group.id, "node-b"]))
    expect(multi).not.toContain("data-node-resizer")
    expect(
      renderWithEditor(selection([group.id]), true, (props) => <BuiltinCanvasNode {...props} />, false, {
        node: group,
      }),
    ).not.toContain("data-node-resizer")
  })

  test("shows bounded material previews and becomes an inert parent while focused", () => {
    const group = createGroupNode({
      height: 240,
      id: "group-preview",
      label: "References",
      position: { x: 0, y: 0 },
      width: 360,
    })
    const summary = {
      externalIncomingCount: 1,
      externalOutgoingCount: 1,
      itemCount: 5,
      nestedGroupCount: 1,
      previews: [
        { id: "image", kind: "image" as const, label: "Moodboard", url: "asset://moodboard" },
        { id: "notes", kind: "text" as const, label: "Notes" },
      ],
    }
    const document = setCanvasGroupFolded(
      setCanvasGroupAppearance(createCanvasDocument({ id: "canvas-test", nodes: [group] }), group.id, {
        color: "green",
        emoji: "leaf",
      }),
      group.id,
      true,
    )
    const customizedGroup = document.nodes[0]!
    const folder = renderWithEditor(selection([group.id]), false, (props) => <BuiltinCanvasNode {...props} />, false, {
      document,
      groupDropTargetId: group.id,
      groupSummaries: new Map([[group.id, summary]]),
      node: customizedGroup,
    })

    expect(folder).toContain('src="asset://moodboard"')
    expect(folder).toContain('data-canvas-group-color="green"')
    expect(folder).toContain('data-canvas-group-emoji="leaf"')
    expect(folder).toContain("🍃")
    expect(folder).toContain("convax-group-folder__paper")
    expect(folder).toContain("convax-group-folder__overflow")
    expect(folder).toContain("+3")
    expect(folder).toContain("5 items")
    expect(folder).toContain("1 folder")
    expect(folder).toContain("is-drop-target")
    expect(folder).toContain("Rename group")
    expect(folder).toContain('maxLength="20"')
    expect(folder).not.toContain("data-node-toolbar")

    const focused = renderWithEditor(selection([]), false, (props) => <BuiltinCanvasNode {...props} />, false, {
      focusedGroupId: group.id,
      node: group,
    })
    expect(focused).toContain("data-canvas-group-focus-root")
    expect(focused).not.toContain("data-canvas-group-folder")
  })

  test("preserves legacy group titles on blur and cancels edited titles on Escape", () => {
    const legacy = "A legacy group title longer than twenty characters"
    expect(
      resolveCanvasGroupTitleEdit({
        cancelled: false,
        changed: false,
        draft: legacy,
        persisted: legacy,
      }),
    ).toEqual({ shouldCommit: false, title: legacy })
    expect(
      resolveCanvasGroupTitleEdit({
        cancelled: true,
        changed: true,
        draft: "Unwanted edit",
        persisted: legacy,
      }),
    ).toEqual({ shouldCommit: false, title: legacy })
  })

  test("adds host selection actions to every eligible node toolbar", () => {
    const action: CanvasSelectionAction = {
      execute: () => undefined,
      icon: <span data-selection-action-icon />,
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
    const pending = renderWithEditor(selection(["node-a"]), false, (props) => <BuiltinCanvasNode {...props} />, false, {
      isSelectionActionPending: (actionId) => actionId === action.id,
      visibleSelectionActions: [action],
    })
    expect(pending).toContain('aria-busy="true"')
    expect(pending).toContain("data-selection-action-icon")
    expect(pending).not.toContain("data-ui-loading-spinner")
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
    expect(preparing).toMatch(
      /class="[^"]*\bnodrag\b[^"]*\bcursor-wait\b[^"]*" data-canvas-selection-drag-state="preparing"/,
    )
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

  test("starts the whole selection only from a host-prepared ready drag", () => {
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
    expect(startCanvasSelectionDragFromNode(notReady, false, start)).toBeFalse()
    const released = dragEvent({ metaKey: true })
    expect(startCanvasSelectionDragFromNode(released, true, start)).toBeTrue()

    expect(start).toHaveBeenCalledTimes(1)
    for (const event of [notReady, released]) {
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
      data: { kind: "image", label: "Image", metadata: {}, resourceState: { status: "ready", url: "" } },
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
    expect(toolbarCount(markup)).toBe(0)
    expect(markup).toContain('data-canvas-composer-overlay="file-assistant"')
    expect(markup).toContain('aria-busy="true"')
    expect(markup).toContain('disabled=""')
    expect(markup).toContain('inert=""')
    expect(markup).toContain("data-assistant-toolbar")
  })

  test("gives image/video owners replacement generation and text owners related visual generation", () => {
    for (const output of ["image", "video"] as const) {
      const mediaNode: CanvasNode = {
        data: { kind: output, label: output === "image" ? "Image" : "Video", url: "" },
        id: `node-${output}`,
        position: { x: 0, y: 0 },
        type: "file",
      }
      let request: CanvasAssistantRequest | undefined
      const markup = renderWithEditor(
        selection([mediaNode.id]),
        false,
        (props) => <BuiltinCanvasNode {...props} />,
        false,
        {
          assistantRender: (next) => {
            request = next
            return <div data-assistant-toolbar />
          },
          node: mediaNode,
        },
      )

      expect(request?.generation?.output).toBe(output)
      expect(markup).toContain('data-canvas-composer-overlay="file-assistant"')
      expect(markup).toContain("data-assistant-toolbar")
      expect(markup).toContain("convax-node-assistant nodrag")
      expect(markup).not.toContain('class="convax-node-assistant nodrag nowheel"')
      expect(markup).not.toContain('aria-label="Open Agent"')
    }

    const textNode = createTextNode({
      id: "node-text",
      metadata: {},
      position: { x: 0, y: 0 },
      resourceState: { status: "ready", text: "Storyboard" },
    })
    let textRequest: CanvasAssistantRequest | undefined
    const textMarkup = renderWithEditor(
      selection([textNode.id]),
      false,
      (props) => <BuiltinCanvasNode {...props} />,
      false,
      {
        assistantRender: (next) => {
          textRequest = next
          return <div data-assistant-toolbar />
        },
        node: textNode,
      },
    )
    expect(textRequest?.generation).toMatchObject({
      availableOutputs: ["image", "video"],
      output: "image",
    })
    expect(textRequest?.generation?.ownerToolId).toBeUndefined()
    expect(textRequest?.generation?.onOwnerToolIdChange).toBeUndefined()
    expect(textRequest?.mentionedNodeIds).toEqual([])
    expect(textMarkup).toContain('data-canvas-composer-overlay="file-assistant"')
    expect(textMarkup).not.toContain('aria-label="Open Agent"')

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

  test("portals file assistants to the Canvas overlay root instead of React Flow node chrome", async () => {
    const source = await Bun.file(new URL("./builtin-node.tsx", import.meta.url)).text()

    expect(source).toContain("const overlayRoot = useCanvasOverlayRoot()")
    expect(source).toContain("overlayRoot ? createPortal(layer, overlayRoot) : null")
    expect(source).toContain('data-canvas-composer-overlay="file-assistant"')
    expect(source).not.toContain(
      '<NodeToolbar className="convax-node-assistant nodrag nowheel" offset={28} position={Position.Bottom}>',
    )
  })

  test("gives a visual-media assistant only its owner's persisted generation-model setter", () => {
    const imageNode: CanvasNode = {
      data: { kind: "image", label: "Image", metadata: {}, resourceState: { status: "ready", url: "" } },
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
    let command: Parameters<CanvasEditorController["executeCommand"]>[0] | undefined
    renderWithEditor(selection([imageNode.id]), false, (props) => <BuiltinCanvasNode {...props} />, false, {
      assistantRender: (next) => {
        request = next
        return <div data-assistant-toolbar />
      },
      executeCommand: (next) => {
        command = next
      },
      document: stored,
      node: imageNode,
    })

    expect(request?.generation?.ownerToolId).toBe("plugin.example:image.generate")
    expect(request?.mentionedNodeIds).toEqual([])
    request?.generation?.onOwnerToolIdChange?.("plugin.example:image.alternate")
    expect(command).toEqual({
      type: "nodes.setGenerationToolId",
      nodeId: imageNode.id,
      toolId: "plugin.example:image.alternate",
    })
  })

  test("defaults file and Agent conversations to direct incoming inputs only", () => {
    const incoming = createTextNode({
      id: "incoming",
      metadata: {},
      position: { x: -320, y: 0 },
      resourceState: { status: "ready", text: "Input" },
    })
    const outgoing = createTextNode({
      id: "outgoing",
      metadata: {},
      position: { x: 640, y: 0 },
      resourceState: { status: "ready", text: "Output" },
    })
    const imageOwner: CanvasNode = {
      data: { kind: "image", label: "Image", metadata: {}, resourceState: { status: "ready", url: "" } },
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
    renderWithEditor(selection([imageOwner.id]), false, (props) => <BuiltinCanvasNode {...props} />, false, {
      assistantRender: (request) => {
        fileRequest = request
        return <div data-assistant-toolbar />
      },
      document: imageDocument,
      node: imageOwner,
    })
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
    renderWithEditor(selection([agentOwner.id]), false, (props) => <BuiltinCanvasNode {...props} />, false, {
      assistantRender: (request) => {
        agentRequest = request
        return <div data-assistant-toolbar />
      },
      document: agentDocument,
      node: agentOwner,
    })
    expect(agentRequest?.mode).toBe("agent")
    expect(agentRequest?.mentionedNodeIds).toEqual([incoming.id])
  })

  test("hydrates active and terminal generation surfaces from persisted node metadata", () => {
    const imageNode: CanvasNode = {
      data: { kind: "image", label: "Image", url: "" },
      id: "node-image",
      position: { x: 0, y: 0 },
      type: "file",
    }
    const submitting = startCanvasNodeGenerationRun(
      createCanvasDocument({ id: "canvas-test", nodes: [imageNode] }),
      imageNode.id,
      {
        operationId: "operation-one",
        prompt: "Persisted prompt",
        toolId: "plugin.example:image.actual",
      },
    )
    const running = markCanvasNodeGenerationRunRunning(submitting, imageNode.id, "operation-one", "task_safe_123")
    const activeMarkup = renderWithEditor(selection([]), false, (props) => <BuiltinCanvasNode {...props} />, false, {
      document: running,
      node: running.nodes[0],
    })
    expect(activeMarkup).toContain('data-canvas-file-generation-activity="running"')
    expect(activeMarkup).toContain('data-canvas-generation-run-tool-id="plugin.example:image.actual"')
    expect(activeMarkup).not.toContain(">plugin.example:image.actual<")
    expect(activeMarkup).toContain("正在生成")
    expect(activeMarkup).toContain("取消")
    expect(activeMarkup).toContain('data-slot="loading-spinner"')
    const cancelButton = openingTagContaining(activeMarkup, 'aria-label="取消"')
    expect(cancelButton).toContain("convax-media-state-card__action-button")
    expect(cancelButton).toContain('type="button"')
    expect(activeMarkup).not.toContain("data-assistant-toolbar")
    expect(openingTagContaining(activeMarkup, 'data-canvas-file-generation-activity="running"')).not.toContain("nodrag")
    expect(activeMarkup).toContain("nodrag nowheel")

    const failed = finishCanvasNodeGenerationRun(running, imageNode.id, "operation-one", "Creative Tools 服务不可用")
    const failedMarkup = renderWithEditor(selection([]), false, (props) => <BuiltinCanvasNode {...props} />, false, {
      document: failed,
      node: failed.nodes[0],
    })
    expect(failedMarkup).toContain('data-canvas-file-generation-activity="failed"')
    expect(failedMarkup).toContain(">生成失败<")
    expect(failedMarkup).not.toContain("Creative Tools 服务不可用")
    expect(failedMarkup).toContain("lucide-image")
    expect(failedMarkup).toContain('data-canvas-media-state="failed"')
    expect(failedMarkup).toContain("convax-media-state-card--overlay")
    expect(failedMarkup).not.toContain("修改并重试")
    expect(failedMarkup).not.toContain("使用原提示词新建任务")
    expect(failedMarkup).not.toContain('aria-label="Add image"')
    expect(failedMarkup).not.toContain('aria-label="Add video"')
    expect(openingTagContaining(failedMarkup, 'data-canvas-file-generation-activity="failed"')).toContain(
      "pointer-events-none",
    )
    expect(openingTagContaining(failedMarkup, 'data-canvas-file-generation-activity="failed"')).not.toContain("nodrag")

    const failedVideoNode = {
      ...failed.nodes[0]!,
      data: { ...failed.nodes[0]!.data, kind: "video" as const },
    }
    const failedVideoMarkup = renderWithEditor(
      selection([]),
      false,
      (props) => <BuiltinCanvasNode {...props} />,
      false,
      {
        document: { ...failed, nodes: [failedVideoNode] },
        node: failedVideoNode,
      },
    )
    expect(failedVideoMarkup).toContain("lucide-video")
    expect(failedVideoMarkup).toContain("convax-media-state-card--video")

    const genericFailed = finishCanvasNodeGenerationRun(running, imageNode.id, "operation-one")
    const genericFailedMarkup = renderWithEditor(
      selection([]),
      false,
      (props) => <BuiltinCanvasNode {...props} />,
      false,
      {
        document: genericFailed,
        node: genericFailed.nodes[0],
      },
    )
    expect(genericFailedMarkup).toContain(">生成失败<")
    expect(genericFailedMarkup).not.toContain("检查日志")

    const succeeded = succeedCanvasNodeGenerationRun(running, imageNode.id, "operation-one")
    let request: CanvasAssistantRequest | undefined
    const succeededMarkup = renderWithEditor(
      selection([imageNode.id]),
      false,
      (props) => <BuiltinCanvasNode {...props} />,
      false,
      {
        assistantRender: (next) => {
          request = next
          return <div data-assistant-toolbar />
        },
        document: succeeded,
        node: succeeded.nodes[0],
      },
    )
    expect(succeededMarkup).not.toContain('data-canvas-file-generation-activity="succeeded"')
    expect(succeededMarkup).not.toContain("已生成")
    expect(succeededMarkup).not.toContain("Generated with")
    expect(request?.generation?.initialPrompt).toBe("Persisted prompt")
    expect(request?.generation?.ownerToolId).toBeUndefined()
  })
})
