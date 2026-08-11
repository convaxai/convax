import { Button, LoadingSpinner, Tooltip, cn } from "@convax/ui"
import type { Editor, JSONContent } from "@tiptap/core"
import DragHandle, { type DragHandleProps } from "@tiptap/extension-drag-handle-react"
import Placeholder from "@tiptap/extension-placeholder"
import { TableKit } from "@tiptap/extension-table"
import TextAlign from "@tiptap/extension-text-align"
import { Markdown } from "@tiptap/markdown"
import { EditorContent, useEditor, useEditorState } from "@tiptap/react"
import { BubbleMenu, type BubbleMenuProps } from "@tiptap/react/menus"
import StarterKit from "@tiptap/starter-kit"
import { Handle, NodeResizer, NodeToolbar, Position, useConnection, type NodeProps } from "@xyflow/react"
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Clapperboard,
  ArrowDownLeft,
  ArrowUpRight,
  Copy,
  Bold,
  Code2,
  Download,
  Ellipsis,
  Bot,
  File,
  FileText,
  FileUp,
  Folder,
  GripVertical,
  Heading1,
  Heading2,
  Image as ImageIcon,
  Italic,
  List,
  ListOrdered,
  Maximize2,
  Music2,
  Pause,
  Pilcrow,
  Play,
  Plus,
  Quote,
  RefreshCw,
  Save,
  Sparkles,
  Strikethrough,
  Trash2,
  Type,
  Video as VideoIcon,
  Volume2,
  VolumeX,
  Workflow,
  X,
} from "lucide-react"
import {
  cloneElement,
  createContext,
  isValidElement,
  type CSSProperties,
  type DragEvent,
  type ErrorInfo,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type Ref,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import { createPortal } from "react-dom"
import {
  normalizeCanvasTextNodeTitle,
} from "../commands"
import { isCanvasEmptyImageNodeData } from "../document"
import { useCanvasOverlayPresence } from "./use-overlay-presence"
import {
  CANVAS_NODE_INPUT_HANDLE_ID,
  CANVAS_NODE_OUTPUT_HANDLE_ID,
  getIncomingConnectedCanvasFileNodeIds,
} from "../connections"
import { useCanvasEditor, useCanvasNodeEntryPresentation, useCanvasOverlayRoot } from "../editor-context"
import { useCanvasMutationSurface } from "./canvas-mutation-surface"
import { getCanvasTextFileFormat } from "../file-import"
import { getCanvasNodeGenerationToolId } from "../generation-preference"
import {
  getCanvasGroupAppearance,
  getCanvasGroupEmoji,
  hasUnsupportedCanvasGroupAppearance,
  type CanvasGroupAppearance,
} from "../group-appearance"
import { isCanvasGroupFolded } from "../group-fold"
import {
  getCanvasNodeGenerationRun,
  isCanvasNodeGenerationRunActive,
  type CanvasNodeGenerationRun,
} from "../generation-run"
import { fitCanvasMediaNodeToIntrinsicSize } from "../media-sizing"
import { CANVAS_FORCED_COLORS_QUERY, CANVAS_MOTION_DURATION, resolveCanvasRectEnterTransform } from "../motion"
import { partitionCanvasSelectionActions, type CanvasSelectionAction } from "../selection-actions"
import { canShowNodeLocalMutationSurface, isSingleNodeSelectionContext } from "../selection-context"
import {
  CanvasTextResourceConflictError,
  useCanvasService,
  type CanvasAssistantGenerationCapability,
  type CanvasTextResourceService,
} from "../services"
import type {
  CanvasFolderNodeData,
  CanvasMediaKind,
  CanvasMediaNodeData,
  CanvasNode,
  CanvasResourceRuntimeState,
  CanvasTextNodeData,
} from "../types"
import { isCanvasExternalDragChordHeld } from "../use-canvas-shortcuts"
import { ConnectionNodeMenu } from "./connection-node-menu"
import {
  projectCanvasConnectionHandlePointer,
  resolveCanvasConnectionHandleMagnetOffset,
} from "./connection-handle-motion"
import { CanvasMediaViewer } from "./canvas-media-viewer"
import { FileRendererBoundary } from "./file-renderer-boundary"
import { CanvasGroupAppearancePicker } from "./group-appearance-picker"
import { useCanvasGroupPresentation } from "./group-presentation-context"
import {
  createCanvasTextMentionExtension,
  getCanvasTextMentionCandidates,
  isCanvasTextMentionCandidate,
} from "./text-editor-mention"
import { isCanvasTextInlineEditingScopeActive } from "./text-editing-policy"

export { isCanvasEmptyImageNodeData } from "../document"

function ToolbarButton(props: {
  busy?: boolean
  destructive?: boolean
  disabled?: boolean
  icon?: ReactNode
  label: string
  onClick: (event: ReactMouseEvent<HTMLButtonElement>) => void
  preserveFocus?: boolean
  pressed?: boolean
  visibleLabel?: boolean
}) {
  return (
    <Tooltip content={props.label} side="top">
      <span className="inline-flex">
        <Button
          aria-busy={props.busy}
          aria-label={props.label}
          aria-pressed={props.pressed}
          className={cn(
            "convax-node-toolbar__button",
            props.visibleLabel && "convax-node-toolbar__button--labeled",
            props.pressed && "bg-accent text-accent-foreground",
            props.destructive && "text-destructive hover:text-destructive",
          )}
          disabled={props.disabled}
          onClick={props.onClick}
          onPointerDown={(event) => {
            event.stopPropagation()
            if (props.preserveFocus) event.preventDefault()
          }}
          size={props.visibleLabel ? "sm" : "icon-sm"}
          type="button"
          variant="ghost"
        >
          {props.icon}
          {props.visibleLabel ? <span className="convax-node-toolbar__button-label">{props.label}</span> : null}
        </Button>
      </span>
    </Tooltip>
  )
}

function ToolbarDivider() {
  return <span aria-hidden className="convax-node-toolbar__divider" />
}

const ContributedToolbarSelectionActionContext = createContext(false)
interface FileAssistantTrigger {
  open: boolean
  toggle: () => void
}
const FileAssistantTriggerContext = createContext<FileAssistantTrigger | null>(null)
const ContributedToolbarFileAssistantTriggerContext = createContext(false)

function NodeSelectionActionButtons(props: { actions: readonly CanvasSelectionAction[] }) {
  const editor = useCanvasEditor()
  const [overflowOpen, setOverflowOpen] = useState(false)
  const overflowRef = useRef<HTMLDivElement>(null)
  const { overflow, primary } = partitionCanvasSelectionActions(props.actions)
  useEffect(() => {
    if (!overflowOpen) return
    const close = (event: PointerEvent) => {
      if (event.target instanceof Element && overflowRef.current?.contains(event.target)) return
      setOverflowOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOverflowOpen(false)
    }
    window.addEventListener("pointerdown", close)
    window.addEventListener("keydown", closeOnEscape)
    return () => {
      window.removeEventListener("pointerdown", close)
      window.removeEventListener("keydown", closeOnEscape)
    }
  }, [overflowOpen])
  return (
    <>
      {primary.map((action) => {
        const pending = editor.isSelectionActionPending(action.id)
        return (
          <ToolbarButton
            busy={pending}
            key={action.id}
            disabled={pending}
            icon={action.icon ?? <Workflow />}
            label={action.label}
            onClick={() => editor.executeSelectionAction(action)}
          />
        )
      })}
      {overflow.length > 0 ? (
        <div className="relative" ref={overflowRef}>
          <ToolbarButton
            icon={<Ellipsis />}
            label="More actions"
            onClick={() => setOverflowOpen((open) => !open)}
            pressed={overflowOpen}
          />
          {overflowOpen ? (
            <div
              className="absolute left-0 top-full z-50 mt-1 min-w-40 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"
              data-canvas-shortcuts="ignore"
              role="menu"
            >
              {overflow.map((action) => {
                const pending = editor.isSelectionActionPending(action.id)
                return (
                  <button
                    aria-busy={pending}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs hover:bg-accent disabled:opacity-50",
                      action.presentation?.tone === "destructive" && "text-destructive",
                    )}
                    disabled={pending}
                    key={action.id}
                    onClick={() => {
                      editor.executeSelectionAction(action)
                      setOverflowOpen(false)
                    }}
                    role="menuitem"
                    type="button"
                  >
                    <span className="[&>svg]:size-3.5">{action.icon ?? <Workflow />}</span>
                    <span>{action.label}</span>
                  </button>
                )
              })}
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  )
}

function prependNodeToolbarContent(toolbar: ReactNode, leadingContent: ReactNode) {
  const content = (
    <>
      {leadingContent}
      {toolbar ? <ToolbarDivider /> : null}
    </>
  )
  if (
    isValidElement<{ children?: ReactNode; className?: string }>(toolbar) &&
    toolbar.props.className?.split(/\s+/).includes("convax-node-toolbar__surface")
  ) {
    return cloneElement(toolbar, {}, content, toolbar.props.children)
  }
  return (
    <div className="convax-node-toolbar__surface" data-canvas-shortcuts="ignore">
      {content}
      {toolbar}
    </div>
  )
}

function mergeNodeToolbarSelectionActions(toolbar: ReactNode, actions: readonly CanvasSelectionAction[]) {
  return actions.length > 0
    ? prependNodeToolbarContent(toolbar, <NodeSelectionActionButtons actions={actions} />)
    : toolbar
}

function FileAssistantTriggerButton(props: { trigger: FileAssistantTrigger }) {
  return (
    <ToolbarButton
      icon={<Bot />}
      label={props.trigger.open ? "Close Agent" : "Open Agent"}
      onClick={props.trigger.toggle}
      pressed={props.trigger.open}
    />
  )
}

function NodeConnectionHandle(props: {
  connectionInProgress: boolean
  expanded: boolean
  onToggle: () => void
  readOnly: boolean
  reducedMotion: boolean
  side: "left" | "right"
}) {
  const iconRef = useRef<HTMLSpanElement>(null)
  const resetMagnet = useCallback(() => {
    iconRef.current?.style.removeProperty("--canvas-connection-magnet-x")
    iconRef.current?.style.removeProperty("--canvas-connection-magnet-y")
  }, [])
  const moveMagnet = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (props.connectionInProgress || props.reducedMotion) {
        resetMagnet()
        return
      }

      const trigger = event.currentTarget
      const viewportBounds = trigger.getBoundingClientRect()
      const triggerSize = { width: trigger.offsetWidth, height: trigger.offsetHeight }
      const pointer = projectCanvasConnectionHandlePointer(
        { x: event.clientX, y: event.clientY },
        viewportBounds,
        triggerSize,
      )
      const offset = resolveCanvasConnectionHandleMagnetOffset(pointer, triggerSize)
      iconRef.current?.style.setProperty("--canvas-connection-magnet-x", `${offset.x.toFixed(2)}px`)
      iconRef.current?.style.setProperty("--canvas-connection-magnet-y", `${offset.y.toFixed(2)}px`)
    },
    [props.connectionInProgress, props.reducedMotion, resetMagnet],
  )

  useEffect(() => {
    if (props.connectionInProgress || props.reducedMotion) resetMagnet()
  }, [props.connectionInProgress, props.reducedMotion, resetMagnet])

  const left = props.side === "left"
  return (
    <Handle
      aria-disabled={props.readOnly}
      aria-expanded={!props.readOnly && props.expanded}
      aria-label={left ? "Connect input on left" : "Connect output on right"}
      className={`convax-node__connection convax-node__connection--${props.side}`}
      id={left ? CANVAS_NODE_INPUT_HANDLE_ID : CANVAS_NODE_OUTPUT_HANDLE_ID}
      isConnectable={!props.readOnly}
      onClick={
        props.readOnly
          ? undefined
          : (event) => {
              event.preventDefault()
              event.stopPropagation()
              props.onToggle()
            }
      }
      onPointerCancel={resetMagnet}
      onPointerLeave={resetMagnet}
      onPointerMove={moveMagnet}
      position={left ? Position.Left : Position.Right}
      style={props.readOnly ? { opacity: 0, pointerEvents: "none" } : undefined}
      type={left ? "target" : "source"}
    >
      {!props.readOnly ? (
        <span className="convax-node__connection-icon" ref={iconRef}>
          <Plus />
        </span>
      ) : null}
    </Handle>
  )
}

function NodeConnectionHandles(props: { nodeId: string }) {
  const editor = useCanvasEditor()
  const ownsSingleNodeContext = isSingleNodeSelectionContext(editor.selectionContext, props.nodeId)
  const [connectMenuSide, setConnectMenuSide] = useState<"left" | "right" | null>(null)
  const connectionInProgress = useConnection((connection) => connection.inProgress)
  useEffect(() => {
    if (ownsSingleNodeContext) return
    setConnectMenuSide(null)
  }, [ownsSingleNodeContext])
  useEffect(() => {
    if (connectionInProgress) setConnectMenuSide(null)
  }, [connectionInProgress])
  return (
    <>
      <NodeConnectionHandle
        connectionInProgress={connectionInProgress}
        expanded={connectMenuSide === "left"}
        onToggle={() => setConnectMenuSide((current) => (current === "left" ? null : "left"))}
        readOnly={editor.readOnly}
        reducedMotion={editor.reducedMotion}
        side="left"
      />
      <NodeConnectionHandle
        connectionInProgress={connectionInProgress}
        expanded={connectMenuSide === "right"}
        onToggle={() => setConnectMenuSide((current) => (current === "right" ? null : "right"))}
        readOnly={editor.readOnly}
        reducedMotion={editor.reducedMotion}
        side="right"
      />
      {!editor.readOnly && connectMenuSide ? (
        <NodeToolbar
          className="convax-connect-menu-positioner nodrag nowheel"
          isVisible
          offset={50}
          position={connectMenuSide === "left" ? Position.Left : Position.Right}
        >
          <ConnectionNodeMenu
            items={editor.quickConnectionNodeTypes}
            onSelect={(type) => {
              editor.quickConnect(props.nodeId, connectMenuSide, type)
              setConnectMenuSide(null)
            }}
          />
        </NodeToolbar>
      ) : null}
    </>
  )
}

function NodeChrome(props: {
  children: ReactNode
  className?: string
  frameless?: boolean
  icon: ReactNode
  label: string
  node: NodeProps<CanvasNode>
  nodeRef?: Ref<HTMLDivElement>
  resizeMode?: "free" | "proportional"
  toolbar?: ReactNode
}) {
  const editor = useCanvasEditor()
  const {
    entering: nodeEntering,
    notifyAnimationStart,
    phase: nodeEntryPhase,
  } = useCanvasNodeEntryPresentation(props.node.id, editor.enteringNodeIds)
  const mutationSurface = useCanvasMutationSurface(editor.readOnly)
  const ownsSingleNodeContext = isSingleNodeSelectionContext(editor.selectionContext, props.node.id)
  const showMutationToolbar = canShowNodeLocalMutationSurface(
    editor.selectionContext,
    props.node.id,
    !mutationSurface.visible,
  )
  const selectionActionsHandledByContribution = useContext(ContributedToolbarSelectionActionContext)
  const assistantTrigger = useContext(FileAssistantTriggerContext)
  const assistantTriggerHandledByContribution = useContext(ContributedToolbarFileAssistantTriggerContext)
  const selectionActions =
    ownsSingleNodeContext && !selectionActionsHandledByContribution ? editor.visibleSelectionActions : []
  let toolbar = mergeNodeToolbarSelectionActions(props.toolbar, selectionActions)
  if (ownsSingleNodeContext && assistantTrigger && !assistantTriggerHandledByContribution) {
    toolbar = prependNodeToolbarContent(toolbar, <FileAssistantTriggerButton trigger={assistantTrigger} />)
  }
  const showEntryToolbar = Boolean(toolbar && showMutationToolbar)
  const proportionalResize = props.resizeMode === "proportional"
  return (
    <div
      className={cn(
        "convax-node group relative size-full text-card-foreground",
        ownsSingleNodeContext && "is-selected",
      )}
      data-canvas-node-entry-phase={nodeEntryPhase === "idle" ? undefined : nodeEntryPhase}
      data-canvas-node-entering={nodeEntering || undefined}
      data-canvas-node-kind={props.node.data.kind}
      data-canvas-node-resize={proportionalResize ? "proportional" : "free"}
      data-canvas-node-status={props.node.data.status ?? "idle"}
      ref={props.nodeRef}
      tabIndex={props.nodeRef ? -1 : undefined}
    >
      <NodeResizer
        color="var(--ring)"
        handleClassName="convax-node-resizer__handle"
        isVisible={ownsSingleNodeContext && !editor.readOnly}
        keepAspectRatio={proportionalResize}
        lineClassName="convax-node-resizer__line"
        lineStyle={proportionalResize ? { display: "none" } : undefined}
        minWidth={160}
        minHeight={96}
        onResizeStart={editor.beginGesture}
        onResizeEnd={editor.endGesture}
      />
      {toolbar && showMutationToolbar ? (
        <NodeToolbar
          aria-busy={mutationSurface.disabled || undefined}
          className="convax-node-toolbar nodrag nowheel"
          data-canvas-node-entry-phase={nodeEntryPhase === "idle" ? undefined : nodeEntryPhase}
          data-canvas-node-entering={nodeEntering || undefined}
          inert={mutationSurface.disabled || undefined}
          isVisible={showMutationToolbar}
          offset={36}
          onAnimationEnd={(event) => {
            if (
              event.currentTarget !== event.target ||
              event.animationName !== "convax-node-chrome-enter" ||
              !nodeEntering
            ) {
              return
            }
            editor.finishNodeEntry(props.node.id)
          }}
          onAnimationStart={(event) => {
            if (
              event.currentTarget !== event.target ||
              event.animationName !== "convax-node-chrome-enter" ||
              !nodeEntering
            ) {
              return
            }
            notifyAnimationStart()
          }}
          position={Position.Top}
        >
          {toolbar}
        </NodeToolbar>
      ) : null}
      <div
        className="convax-node__entry-shell relative size-full"
        onAnimationStart={(event) => {
          if (event.currentTarget !== event.target || event.animationName !== "convax-node-enter" || !nodeEntering)
            return
          notifyAnimationStart()
        }}
        onAnimationEnd={(event) => {
          if (event.currentTarget !== event.target || event.animationName !== "convax-node-enter" || !nodeEntering)
            return
          if (showEntryToolbar) return
          editor.finishNodeEntry(props.node.id)
        }}
      >
        {!props.frameless ? (
          <div className="convax-node__title flex items-center gap-1.5" data-canvas-node-drag-handle="true">
            <span className="flex size-4 items-center justify-center [&>svg]:size-3.5">{props.icon}</span>
            <span className="truncate">{props.label}</span>
            {props.node.data.status === "pending" ? (
              <LoadingSpinner className="ml-auto" reducedMotion={editor.reducedMotion} size="sm" />
            ) : null}
          </div>
        ) : null}
        <div
          className={cn(
            "size-full",
            props.frameless ? "relative overflow-visible" : "convax-node__surface overflow-hidden border bg-card",
            props.className,
          )}
        >
          {props.children}
        </div>
      </div>
      <NodeConnectionHandles nodeId={props.node.id} />
    </div>
  )
}

function plainTextDocument(text: string): JSONContent {
  return {
    type: "doc",
    content: text
      .replace(/\r\n/g, "\n")
      .split("\n")
      .map((line) => ({
        type: "paragraph",
        ...(line ? { content: [{ type: "text", text: line }] } : {}),
      })),
  }
}

function textEditorSource(data: CanvasTextNodeData): {
  content: JSONContent | string
  contentType: "json" | "markdown"
} {
  const text = data.resourceState?.text ?? ""
  if (textFileFormat(data) === "markdown") return { content: text, contentType: "markdown" }
  return { content: plainTextDocument(text), contentType: "json" }
}

function textDataFingerprint(data: CanvasTextNodeData) {
  return `${textFileFormat(data)}\u0000${data.resourceState?.contentRevision ?? ""}\u0000${data.resourceState?.text ?? ""}`
}

function textFileFormat(data: CanvasTextNodeData) {
  return getCanvasTextFileFormat({ mimeType: data.mimeType, name: data.name ?? "" }) ?? "plain"
}

function textEditorValue(data: CanvasTextNodeData, editor: Editor) {
  return textFileFormat(data) === "markdown" ? editor.getMarkdown() : editor.getText({ blockSeparator: "\n" })
}

export interface CanvasTextDraftState {
  baseContent: string
  baseRevision: string
  content: string
  dirty: boolean
  error: string | null
}

export function createCanvasTextDraftState(input: { contentRevision?: string; text?: string }): CanvasTextDraftState {
  const content = input.text ?? ""
  return {
    baseContent: content,
    baseRevision: input.contentRevision ?? "",
    content,
    dirty: false,
    error: null,
  }
}

export function updateCanvasTextDraft(state: CanvasTextDraftState, content: string): CanvasTextDraftState {
  return { ...state, content, dirty: content !== state.baseContent, error: null }
}

export function applyCanvasTextDraftBase(
  state: CanvasTextDraftState,
  input: { contentRevision?: string; text?: string },
): CanvasTextDraftState {
  return state.dirty ? state : createCanvasTextDraftState(input)
}

export function rebaseCanvasTextDraft(
  state: CanvasTextDraftState,
  input: { contentRevision?: string; text?: string },
): CanvasTextDraftState {
  const baseContent = input.text ?? ""
  return {
    baseContent,
    baseRevision: input.contentRevision ?? "",
    content: state.content,
    dirty: state.content !== baseContent,
    error: null,
  }
}

export function failCanvasTextDraftSave(state: CanvasTextDraftState, error: string): CanvasTextDraftState {
  return { ...state, dirty: true, error }
}

export function completeCanvasTextDraftSave(
  state: CanvasTextDraftState,
  contentRevision: string,
): CanvasTextDraftState {
  return {
    baseContent: state.content,
    baseRevision: contentRevision,
    content: state.content,
    dirty: false,
    error: null,
  }
}

export async function saveCanvasTextDraft(
  state: CanvasTextDraftState,
  nodeId: string,
  service: CanvasTextResourceService,
  signal: AbortSignal,
) {
  if (!state.dirty) return state
  if (!state.baseRevision) throw new Error("Canvas text resource revision is required")
  const result = await service.save({ content: state.content, contentRevision: state.baseRevision, nodeId }, signal)
  return completeCanvasTextDraftSave(state, result.contentRevision)
}

export function discardCanvasTextDraft(state: CanvasTextDraftState): CanvasTextDraftState {
  return {
    baseContent: state.baseContent,
    baseRevision: state.baseRevision,
    content: state.baseContent,
    dirty: false,
    error: null,
  }
}

export function isCanvasTextResourceEditable(state: CanvasResourceRuntimeState | undefined) {
  return state?.status === "ready" && state.editableText === true && Boolean(state.contentRevision)
}

export interface CanvasTextDraftSaveQueue {
  inFlight(): Promise<void> | null
  run(operation: () => Promise<void>): Promise<void>
}

export function createCanvasTextDraftSaveQueue(): CanvasTextDraftSaveQueue {
  let pending: Promise<void> | null = null
  return {
    inFlight: () => pending,
    run(operation) {
      if (pending) return pending
      let current: Promise<void>
      try {
        current = operation()
      } catch (error) {
        current = Promise.reject(error)
      }
      pending = current
      void current.then(
        () => {
          if (pending === current) pending = null
        },
        () => {
          if (pending === current) pending = null
        },
      )
      return current
    },
  }
}

function createTextEditorExtensions(mentionExtension?: ReturnType<typeof createCanvasTextMentionExtension>) {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      link: { openOnClick: false },
    }),
    TableKit.configure({
      table: { resizable: false },
    }),
    TextAlign.configure({ types: ["heading", "paragraph"] }),
    Placeholder.configure({ placeholder: "Start writing...", showOnlyWhenEditable: false }),
    ...(mentionExtension ? [mentionExtension] : []),
    Markdown.configure({ markedOptions: { breaks: true, gfm: true } }),
  ]
}

export function canOpenCanvasTextLineMenu(linePrefix: string) {
  return linePrefix.trim().length === 0
}

export function moveCanvasTextLineMenuIndex(current: number, direction: 1 | -1, itemCount: number) {
  if (itemCount <= 0) return 0
  return (current + direction + itemCount) % itemCount
}

export function getCanvasTextMenuGeometry(surfaceHeight: number, anchorTop: number) {
  const maxHeight = Math.min(204, Math.max(32, surfaceHeight - 16))
  return {
    gripTop: Math.max(16, Math.min(surfaceHeight - 48, anchorTop)),
    maxHeight,
    popupTop: Math.max(8, Math.min(anchorTop + 28, surfaceHeight - maxHeight - 8)),
  }
}

export function isCanvasTextLineMenuSelectionValid(input: {
  selectionFrom: number
  slashCharacter: string
  slashPosition: number | null
}) {
  return input.slashPosition !== null && input.slashCharacter === "/" && input.selectionFrom === input.slashPosition + 1
}

export function resolveCanvasTextHandleTarget(input: {
  documentSize: number
  hoverPosition: number | null
  selectionFrom: number
}) {
  return Math.max(1, Math.min(input.documentSize, input.hoverPosition ?? input.selectionFrom))
}

const canvasTextBlockCommands = [
  { command: "paragraph", icon: <Type />, label: "Text" },
  { command: "heading-1", icon: <Heading1 />, label: "Heading 1" },
  { command: "heading-2", icon: <Heading2 />, label: "Heading 2" },
  { command: "bullet", icon: <List />, label: "Bullet list" },
  { command: "ordered", icon: <ListOrdered />, label: "Numbered list" },
  { command: "quote", icon: <Quote />, label: "Quote" },
] as const

type CanvasTextBlockCommand = (typeof canvasTextBlockCommands)[number]["command"]
export type CanvasTextInlineCommand = "bold" | "code" | "italic" | "strike"

const canvasTextInlineCommands = [
  { command: "bold", icon: <Bold />, label: "Bold" },
  { command: "italic", icon: <Italic />, label: "Italic" },
  { command: "strike", icon: <Strikethrough />, label: "Strikethrough" },
  { command: "code", icon: <Code2 />, label: "Inline code" },
] as const satisfies readonly {
  command: CanvasTextInlineCommand
  icon: ReactNode
  label: string
}[]

export function shouldShowCanvasTextInlineMenu(input: {
  codeBlockActive: boolean
  editable: boolean
  selectionFrom: number
  selectionTo: number
  textSelection: boolean
}) {
  return input.editable && input.textSelection && !input.codeBlockActive && input.selectionFrom !== input.selectionTo
}

const canvasTextBubbleMenuOptions: NonNullable<BubbleMenuProps["options"]> = {
  flip: true,
  inline: true,
  offset: 8,
  placement: "top",
  shift: true,
}

const shouldShowCanvasTextBubbleMenu: NonNullable<BubbleMenuProps["shouldShow"]> = ({ editor, from, to }) =>
  shouldShowCanvasTextInlineMenu({
    codeBlockActive: editor.isActive("codeBlock"),
    editable: editor.isEditable,
    selectionFrom: from,
    selectionTo: to,
    textSelection: editor.state.selection.$from.parent.inlineContent && editor.state.selection.$to.parent.inlineContent,
  })

export function runCanvasTextInlineCommand(editor: Editor, command: CanvasTextInlineCommand) {
  const chain = editor.chain().focus()
  if (command === "bold") return chain.toggleBold().run()
  if (command === "italic") return chain.toggleItalic().run()
  if (command === "strike") return chain.toggleStrike().run()
  return chain.toggleCode().run()
}

function CanvasTextInlineToolbar({ editor }: { editor: Editor }) {
  const active = useEditorState({
    editor,
    selector: ({ editor: currentEditor }) => ({
      bold: currentEditor.isActive("bold"),
      code: currentEditor.isActive("code"),
      italic: currentEditor.isActive("italic"),
      strike: currentEditor.isActive("strike"),
    }),
  })

  return (
    <div
      aria-label="Text formatting"
      className="convax-text-inline-menu flex items-center gap-0.5 rounded-lg bg-surface-raised/96 p-1 text-foreground shadow-[var(--ui-shadow-medium)] backdrop-blur"
      data-canvas-text-inline-menu="true"
      role="toolbar"
    >
      {canvasTextInlineCommands.map(({ command, icon, label }) => (
        <Tooltip content={label} key={command} side="top">
          <button
            aria-label={label}
            aria-pressed={active[command]}
            className={cn(
              "grid size-7 place-items-center rounded-md text-muted-foreground outline-none transition-[background-color,color,transform] duration-100 hover:bg-surface-inset hover:text-foreground active:scale-95 focus-visible:ring-2 focus-visible:ring-focus-ring [&>svg]:size-3.5",
              active[command] && "bg-primary/12 text-primary",
            )}
            onClick={() => runCanvasTextInlineCommand(editor, command)}
            onPointerDown={(event) => {
              event.preventDefault()
              event.stopPropagation()
            }}
            type="button"
          >
            {icon}
          </button>
        </Tooltip>
      ))}
    </div>
  )
}

interface CanvasTextFormattingAction {
  active: (editor: Editor) => boolean
  icon: ReactNode
  label: string
  run: (editor: Editor) => void
}

const canvasTextFormattingActions: readonly (CanvasTextFormattingAction | null)[] = [
  {
    active: (editor) => editor.isActive("paragraph"),
    icon: <Pilcrow />,
    label: "Paragraph",
    run: (editor) => {
      editor.chain().focus().setParagraph().run()
    },
  },
  {
    active: (editor) => editor.isActive("heading", { level: 1 }),
    icon: <Heading1 />,
    label: "Heading 1",
    run: (editor) => {
      editor.chain().focus().toggleHeading({ level: 1 }).run()
    },
  },
  {
    active: (editor) => editor.isActive("heading", { level: 2 }),
    icon: <Heading2 />,
    label: "Heading 2",
    run: (editor) => {
      editor.chain().focus().toggleHeading({ level: 2 }).run()
    },
  },
  null,
  {
    active: (editor) => editor.isActive("bold"),
    icon: <Bold />,
    label: "Bold",
    run: (editor) => {
      editor.chain().focus().toggleBold().run()
    },
  },
  {
    active: (editor) => editor.isActive("italic"),
    icon: <Italic />,
    label: "Italic",
    run: (editor) => {
      editor.chain().focus().toggleItalic().run()
    },
  },
  {
    active: (editor) => editor.isActive("strike"),
    icon: <Strikethrough />,
    label: "Strikethrough",
    run: (editor) => {
      editor.chain().focus().toggleStrike().run()
    },
  },
  {
    active: (editor) => editor.isActive("code"),
    icon: <Code2 />,
    label: "Inline code",
    run: (editor) => {
      editor.chain().focus().toggleCode().run()
    },
  },
  null,
  {
    active: (editor) => editor.isActive("bulletList"),
    icon: <List />,
    label: "Bullet list",
    run: (editor) => {
      editor.chain().focus().toggleBulletList().run()
    },
  },
  {
    active: (editor) => editor.isActive("orderedList"),
    icon: <ListOrdered />,
    label: "Numbered list",
    run: (editor) => {
      editor.chain().focus().toggleOrderedList().run()
    },
  },
  {
    active: (editor) => editor.isActive("blockquote"),
    icon: <Quote />,
    label: "Quote",
    run: (editor) => {
      editor.chain().focus().toggleBlockquote().run()
    },
  },
  null,
  {
    active: (editor) => editor.isActive({ textAlign: "left" }),
    icon: <AlignLeft />,
    label: "Align left",
    run: (editor) => {
      editor.chain().focus().setTextAlign("left").run()
    },
  },
  {
    active: (editor) => editor.isActive({ textAlign: "center" }),
    icon: <AlignCenter />,
    label: "Align center",
    run: (editor) => {
      editor.chain().focus().setTextAlign("center").run()
    },
  },
  {
    active: (editor) => editor.isActive({ textAlign: "right" }),
    icon: <AlignRight />,
    label: "Align right",
    run: (editor) => {
      editor.chain().focus().setTextAlign("right").run()
    },
  },
]

export function CanvasTextFormattingToolbar(props: {
  disabled?: boolean
  editor: Editor
  onCommand: (command: (editor: Editor) => void) => void
}) {
  return (
    <div
      aria-label="Rich text controls"
      className="convax-node-toolbar__surface"
      data-canvas-text-formatting-toolbar="true"
      role="group"
    >
      {canvasTextFormattingActions.map((action, index) =>
        action ? (
          <ToolbarButton
            disabled={props.disabled}
            icon={action.icon}
            key={action.label}
            label={action.label}
            onClick={() => props.onCommand(action.run)}
            preserveFocus
            pressed={action.active(props.editor)}
          />
        ) : (
          <ToolbarDivider key={`divider-${index}`} />
        ),
      )}
    </div>
  )
}

function TextEditorContextMenus(props: { editor: Editor | null }) {
  if (!props.editor) {
    return (
      <button
        aria-label="Open block handle menu"
        className="absolute left-2 top-7 grid size-7 place-items-center rounded-md text-muted-foreground opacity-0"
        disabled
        type="button"
      >
        <GripVertical className="size-4" />
      </button>
    )
  }
  return <ReadyTextEditorContextMenus editor={props.editor} />
}

function ReadyTextEditorContextMenus(props: { editor: Editor }) {
  const commands = canvasTextBlockCommands
  const surfaceRef = useRef<HTMLDivElement>(null)
  const handleButtonRef = useRef<HTMLButtonElement>(null)
  const handleRootRef = useRef<HTMLDivElement>(null)
  const handleItemRefs = useRef<Array<HTMLButtonElement | null>>([])
  const handleTargetPositionRef = useRef<number | null>(null)
  const slashPositionRef = useRef<number | null>(null)
  const lineMenuId = useId()
  const [handleMenuOpen, setHandleMenuOpen] = useState(false)
  const [handleMenuIndex, setHandleMenuIndex] = useState(0)
  const [lineMenuOpen, setLineMenuOpen] = useState(false)
  const [lineMenuIndex, setLineMenuIndex] = useState(0)
  const [menuPopupTop, setMenuPopupTop] = useState(56)
  const [menuMaxHeight, setMenuMaxHeight] = useState(192)

  const syncMenuPositionAt = useCallback((clientTop: number) => {
    const surface = surfaceRef.current
    if (!surface) return
    const bounds = surface.getBoundingClientRect()
    const anchorTop = clientTop - bounds.top - 4
    const geometry = getCanvasTextMenuGeometry(surface.clientHeight, anchorTop)
    setMenuMaxHeight(geometry.maxHeight)
    setMenuPopupTop(geometry.popupTop)
  }, [])

  const syncMenuPosition = useCallback(() => {
    const editor = props.editor
    if (!editor) return
    try {
      const caret = editor.view.coordsAtPos(editor.state.selection.from)
      syncMenuPositionAt(caret.top)
    } catch {}
  }, [props.editor, syncMenuPositionAt])

  const setHandleLocked = useCallback(
    (locked: boolean) => {
      if (!props.editor.isDestroyed) props.editor.commands.setMeta("lockDragHandle", locked)
    },
    [props.editor],
  )

  const closeHandleMenu = useCallback(() => {
    setHandleLocked(false)
    setHandleMenuOpen(false)
    handleTargetPositionRef.current = null
  }, [setHandleLocked])

  const runBlockCommand = (command: CanvasTextBlockCommand, targetPosition: number | null = null) => {
    const editor = props.editor
    const chain = editor.chain().focus()
    if (targetPosition !== null) {
      chain.setTextSelection(
        resolveCanvasTextHandleTarget({
          documentSize: editor.state.doc.content.size,
          hoverPosition: targetPosition,
          selectionFrom: editor.state.selection.from,
        }),
      )
    }
    if (command === "paragraph") chain.setParagraph().run()
    else if (command === "heading-1") chain.setHeading({ level: 1 }).run()
    else if (command === "heading-2") chain.setHeading({ level: 2 }).run()
    else if (command === "bullet") chain.toggleBulletList().run()
    else if (command === "ordered") chain.toggleOrderedList().run()
    else chain.toggleBlockquote().run()
    closeHandleMenu()
    setLineMenuOpen(false)
  }

  const runLineCommand = (command: Parameters<typeof runBlockCommand>[0]) => {
    const editor = props.editor
    const slashPosition = slashPositionRef.current
    if (
      slashPosition === null ||
      !isCanvasTextLineMenuSelectionValid({
        selectionFrom: editor.state.selection.from,
        slashCharacter: editor.state.doc.textBetween(slashPosition, slashPosition + 1),
        slashPosition,
      })
    ) {
      slashPositionRef.current = null
      setLineMenuOpen(false)
      editor.commands.focus()
      return
    }
    editor
      .chain()
      .focus()
      .deleteRange({ from: slashPosition, to: slashPosition + 1 })
      .run()
    slashPositionRef.current = null
    runBlockCommand(command)
  }

  const closeLineMenuIfInvalid = useCallback(() => {
    const editor = props.editor
    const slashPosition = slashPositionRef.current
    if (
      !isCanvasTextLineMenuSelectionValid({
        selectionFrom: editor.state.selection.from,
        slashCharacter: slashPosition === null ? "" : editor.state.doc.textBetween(slashPosition, slashPosition + 1),
        slashPosition,
      })
    ) {
      slashPositionRef.current = null
      setLineMenuOpen(false)
    }
  }, [props.editor])

  useEffect(() => {
    const editor = props.editor
    const handleSelectionUpdate = () => {
      syncMenuPosition()
      closeLineMenuIfInvalid()
      if (!editor.state.selection.empty) closeHandleMenu()
    }
    const handleBlur = () => {
      window.requestAnimationFrame(() => {
        if (!surfaceRef.current?.contains(document.activeElement)) closeLineMenuIfInvalid()
      })
    }
    editor.on("selectionUpdate", handleSelectionUpdate)
    editor.on("focus", syncMenuPosition)
    editor.on("blur", handleBlur)
    return () => {
      editor.off("selectionUpdate", handleSelectionUpdate)
      editor.off("focus", syncMenuPosition)
      editor.off("blur", handleBlur)
    }
  }, [closeHandleMenu, closeLineMenuIfInvalid, props.editor, syncMenuPosition])

  useEffect(() => {
    const editorDom = props.editor?.view.dom
    if (!editorDom) return
    if (lineMenuOpen) {
      editorDom.setAttribute("aria-controls", lineMenuId)
      editorDom.setAttribute("aria-expanded", "true")
      editorDom.setAttribute("aria-haspopup", "listbox")
      editorDom.setAttribute("aria-activedescendant", `${lineMenuId}-item-${lineMenuIndex}`)
    } else {
      editorDom.removeAttribute("aria-controls")
      editorDom.removeAttribute("aria-expanded")
      editorDom.removeAttribute("aria-haspopup")
      editorDom.removeAttribute("aria-activedescendant")
    }
    return () => {
      editorDom.removeAttribute("aria-controls")
      editorDom.removeAttribute("aria-expanded")
      editorDom.removeAttribute("aria-haspopup")
      editorDom.removeAttribute("aria-activedescendant")
    }
  }, [lineMenuId, lineMenuIndex, lineMenuOpen, props.editor])

  useEffect(() => {
    if (!handleMenuOpen) return
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Node && handleRootRef.current?.contains(target)) return
      closeHandleMenu()
    }
    document.addEventListener("pointerdown", closeOnOutsidePointer, true)
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer, true)
  }, [closeHandleMenu, handleMenuOpen])

  useEffect(() => () => setHandleLocked(false), [setHandleLocked])

  const handleDragStart = useCallback<NonNullable<DragHandleProps["onElementDragStart"]>>(() => {
    closeHandleMenu()
    setLineMenuOpen(false)
  }, [closeHandleMenu])

  const handleNodeChange = useCallback<NonNullable<DragHandleProps["onNodeChange"]>>(
    ({ node, pos }) => {
      handleTargetPositionRef.current = node
        ? resolveCanvasTextHandleTarget({
            documentSize: props.editor.state.doc.content.size,
            hoverPosition: pos + 1,
            selectionFrom: props.editor.state.selection.from,
          })
        : null
    },
    [props.editor],
  )

  const focusHandleMenuItem = (index: number) => {
    const nextIndex = (index + commands.length) % commands.length
    setHandleMenuIndex(nextIndex)
    handleItemRefs.current[nextIndex]?.focus()
  }

  const menu = (line: boolean) => (
    <div
      aria-label={line ? "Line menu" : "Block handle menu"}
      className={cn(
        "z-30 grid w-40 gap-0.5 overflow-y-auto rounded-lg bg-surface-raised/98 p-1.5 text-xs text-foreground shadow-[var(--ui-shadow-medium)] backdrop-blur",
        line ? "absolute" : "absolute left-9 top-0",
      )}
      data-ui-menu-surface=""
      id={line ? lineMenuId : undefined}
      onKeyDown={
        line
          ? undefined
          : (event) => {
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault()
                focusHandleMenuItem(handleMenuIndex + (event.key === "ArrowDown" ? 1 : -1))
              } else if (event.key === "Home" || event.key === "End") {
                event.preventDefault()
                focusHandleMenuItem(event.key === "Home" ? 0 : commands.length - 1)
              } else if (event.key === "Escape") {
                event.preventDefault()
                closeHandleMenu()
                handleButtonRef.current?.focus()
              } else if (event.key === "Tab") {
                closeHandleMenu()
              }
            }
      }
      role={line ? "listbox" : "menu"}
      style={line ? { left: 44, maxHeight: menuMaxHeight, top: menuPopupTop } : { maxHeight: menuMaxHeight }}
    >
      {commands.map(({ command, icon, label }, index) => (
        <button
          aria-selected={line ? lineMenuIndex === index : undefined}
          className={cn(
            "flex w-full items-center justify-start gap-2 rounded-md px-2 py-1.5 text-left outline-none hover:bg-surface-inset focus-visible:ring-2 focus-visible:ring-focus-ring [&>svg]:size-3.5 [&>svg]:shrink-0",
            line && lineMenuIndex === index && "bg-surface-inset",
          )}
          id={line ? `${lineMenuId}-item-${index}` : undefined}
          key={command}
          onFocus={() => {
            if (!line) setHandleMenuIndex(index)
          }}
          onMouseDown={(event) => {
            event.preventDefault()
            event.stopPropagation()
          }}
          onClick={() => (line ? runLineCommand(command) : runBlockCommand(command, handleTargetPositionRef.current))}
          ref={(element) => {
            if (!line) handleItemRefs.current[index] = element
          }}
          role={line ? "option" : "menuitem"}
          tabIndex={line ? -1 : handleMenuIndex === index ? 0 : -1}
          type="button"
        >
          {icon}
          {label}
        </button>
      ))}
    </div>
  )

  return (
    <div
      className="convax-text-editor-context-surface group/text-editor relative min-h-0 flex-1 overflow-visible"
      ref={surfaceRef}
    >
      <DragHandle
        className="convax-text-block-handle-anchor"
        editor={props.editor}
        nested
        onElementDragStart={handleDragStart}
        onNodeChange={handleNodeChange}
      >
        <div className="convax-text-block-handle relative" ref={handleRootRef}>
          <button
            aria-expanded={handleMenuOpen}
            aria-haspopup="menu"
            aria-label="Open block handle menu"
            className={cn(
              "grid size-7 place-items-center rounded-md text-muted-foreground outline-none transition-[background-color,color,transform] duration-100 hover:bg-surface-inset hover:text-foreground active:scale-95 focus-visible:ring-2 focus-visible:ring-focus-ring",
              handleMenuOpen && "bg-surface-inset text-foreground",
            )}
            draggable
            onClick={() => {
              setLineMenuOpen(false)
              slashPositionRef.current = null
              if (handleMenuOpen) {
                closeHandleMenu()
                return
              }
              setHandleLocked(true)
              setHandleMenuIndex(0)
              setHandleMenuOpen(true)
              window.requestAnimationFrame(() => handleItemRefs.current[0]?.focus())
            }}
            ref={handleButtonRef}
            type="button"
          >
            <GripVertical className="size-4" />
          </button>
          {handleMenuOpen ? menu(false) : null}
        </div>
      </DragHandle>
      <BubbleMenu
        editor={props.editor}
        options={canvasTextBubbleMenuOptions}
        pluginKey="convaxTextInlineMenu"
        shouldShow={shouldShowCanvasTextBubbleMenu}
      >
        <CanvasTextInlineToolbar editor={props.editor} />
      </BubbleMenu>
      {lineMenuOpen ? menu(true) : null}
      <EditorContent
        className="convax-text-editor convax-text-editor--expanded nodrag nowheel min-h-full w-full overflow-visible"
        data-canvas-shortcuts="ignore"
        editor={props.editor}
        onKeyDown={(event) => {
          if (lineMenuOpen) {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault()
              event.stopPropagation()
              const direction = event.key === "ArrowDown" ? 1 : -1
              setLineMenuIndex((index) => moveCanvasTextLineMenuIndex(index, direction, commands.length))
              return
            }
            if (event.key === "Home" || event.key === "End") {
              event.preventDefault()
              event.stopPropagation()
              setLineMenuIndex(event.key === "Home" ? 0 : commands.length - 1)
              return
            }
            if (event.key === "Enter") {
              event.preventDefault()
              event.stopPropagation()
              runLineCommand(commands[lineMenuIndex].command)
              return
            }
          }
          if (event.key === "/") {
            const editor = props.editor
            if (!editor) return
            const { $from } = editor.state.selection
            const linePrefix = $from.parent.textBetween(0, $from.parentOffset)
            if (!canOpenCanvasTextLineMenu(linePrefix)) return
            slashPositionRef.current = editor.state.selection.from
            setHandleMenuOpen(false)
            setLineMenuIndex(0)
            window.requestAnimationFrame(() => {
              syncMenuPosition()
              setLineMenuOpen(true)
            })
          } else if (event.key === "Escape" && (lineMenuOpen || handleMenuOpen)) {
            event.preventDefault()
            event.stopPropagation()
            setLineMenuOpen(false)
            setHandleMenuOpen(false)
            slashPositionRef.current = null
          } else if (lineMenuOpen) {
            window.requestAnimationFrame(closeLineMenuIfInvalid)
          }
        }}
      />
    </div>
  )
}

export function ExpandedTextEditorDialog(props: {
  editor: Editor | null
  onClose: () => void
  onSave?: () => void
  onTitleChange?: (title: string) => void
  onTitleCommit?: () => void
  title?: string
  /** @deprecated Use title. Legacy callers receive a read-only title field. */
  label?: string
  error?: string | null
  discardLabel?: string
  onDiscard?: () => void
  onReload?: () => void
  reloading?: boolean
  reducedMotion?: boolean
  saving?: boolean
  sourceRect?: { height: number; left: number; top: number; width: number }
  /** @deprecated Formatting is contextual inside the editor. */
  toolbar?: ReactNode
}) {
  const title = props.title ?? props.label ?? "Untitled"
  const titleId = useId()
  const overlayRoot = useCanvasOverlayRoot()
  const modalRef = useRef<HTMLDialogElement>(null)
  const dialogRef = useRef<HTMLElement>(null)
  const titleRef = useRef<HTMLTextAreaElement>(null)
  const [themeStyle, setThemeStyle] = useState<CSSProperties>()
  useLayoutEffect(() => {
    if (!overlayRoot || typeof getComputedStyle !== "function") return
    const computed = getComputedStyle(overlayRoot)
    const variables = [
      "--accent",
      "--accent-foreground",
      "--background",
      "--border",
      "--card",
      "--card-foreground",
      "--canvas-accent",
      "--canvas-accent-foreground",
      "--canvas-background",
      "--canvas-edge",
      "--canvas-edge-active",
      "--canvas-edge-flow",
      "--canvas-grid",
      "--canvas-interactive-hover",
      "--canvas-interactive-pressed",
      "--canvas-interactive-selected",
      "--canvas-node-background",
      "--canvas-node-border",
      "--canvas-node-radius",
      "--canvas-surface",
      "--canvas-text",
      "--canvas-text-muted",
      "--foreground",
      "--input",
      "--muted",
      "--muted-foreground",
      "--popover",
      "--popover-foreground",
      "--primary",
      "--primary-foreground",
      "--ring",
    ] as const
    const next = { colorScheme: computed.colorScheme } as CSSProperties
    const custom = next as CSSProperties & Record<(typeof variables)[number], string>
    for (const variable of variables) {
      const value = computed.getPropertyValue(variable).trim()
      if (value) custom[variable] = value
    }
    setThemeStyle(next)
  }, [overlayRoot])
  useLayoutEffect(() => {
    const modal = modalRef.current
    if (!modal || modal.open) return undefined
    if (typeof modal.showModal === "function") modal.showModal()
    else modal.setAttribute("open", "")
    return () => {
      if (typeof modal.close === "function" && modal.open) modal.close()
      else modal.removeAttribute("open")
    }
  }, [])
  useLayoutEffect(() => {
    const title = titleRef.current
    if (!title) return
    title.style.height = "auto"
    title.style.height = `${title.scrollHeight}px`
  }, [title])
  useLayoutEffect(() => {
    const dialog = dialogRef.current
    if (
      !dialog ||
      !props.sourceRect ||
      props.reducedMotion ||
      typeof dialog.animate !== "function" ||
      (typeof window !== "undefined" &&
        typeof window.matchMedia === "function" &&
        window.matchMedia(CANVAS_FORCED_COLORS_QUERY).matches)
    )
      return undefined
    const initial = resolveCanvasRectEnterTransform(props.sourceRect, dialog.getBoundingClientRect())
    if (!initial) return undefined
    const animation = dialog.animate(
      [
        { opacity: 0.72, transform: initial.transform, transformOrigin: initial.transformOrigin },
        { opacity: 1, transform: "none", transformOrigin: initial.transformOrigin },
      ],
      {
        duration: CANVAS_MOTION_DURATION.viewport,
        easing: "cubic-bezier(0.16, 1, 0.3, 1)",
        fill: "both",
      },
    )
    return () => {
      animation.cancel()
    }
  }, [
    props.reducedMotion,
    props.sourceRect?.height,
    props.sourceRect?.left,
    props.sourceRect?.top,
    props.sourceRect?.width,
  ])
  const close = () => {
    props.onTitleCommit?.()
    props.onClose()
  }
  const layer = (
    <dialog
      aria-labelledby={titleId}
      aria-modal="true"
      className="convax-canvas convax-text-editor-modal fixed inset-0 z-[2147483647] m-0 size-full max-h-none max-w-none border-0 bg-transparent p-[clamp(12px,3vw,32px)] text-foreground"
      data-canvas-reduced-motion={String(Boolean(props.reducedMotion))}
      data-canvas-shortcuts="ignore"
      onCancel={(event) => {
        event.preventDefault()
        close()
      }}
      onKeyDown={(event) => {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
          event.preventDefault()
          props.onTitleCommit?.()
          props.onSave?.()
        }
      }}
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) close()
      }}
      ref={modalRef}
      role="dialog"
      style={themeStyle}
    >
      <section
        className="convax-text-editor-dialog relative mx-auto flex size-full min-h-0 min-w-0 max-w-[1080px] flex-col overflow-hidden rounded-xl bg-surface-panel text-foreground shadow-[var(--ui-shadow-high)]"
        data-canvas-rect-enter={props.sourceRect ? "true" : undefined}
        ref={dialogRef}
      >
        <h2 className="sr-only" id={titleId}>
          Edit text document
        </h2>
        <Button
          aria-label={props.saving ? "Saving text" : "Close expanded editor"}
          className="absolute right-4 top-4 z-30 rounded-md bg-surface-panel/85 text-muted-foreground shadow-[var(--ui-shadow-low)] transition-[background-color,color,transform] duration-100 hover:bg-surface-inset hover:text-foreground active:scale-95 focus-visible:ring-2 focus-visible:ring-focus-ring motion-reduce:transition-none"
          disabled={props.saving}
          onClick={close}
          size="icon-sm"
          variant="ghost"
        >
          <X />
        </Button>
        {props.error ? (
          <div
            className="absolute left-1/2 top-4 z-30 flex max-w-[min(720px,calc(100%-112px))] -translate-x-1/2 items-center gap-2 rounded-lg bg-surface-raised px-3 py-2 text-xs shadow-[var(--ui-shadow-medium)]"
            role="alert"
          >
            <span className="min-w-0 flex-1">{props.error}</span>
            {props.onReload ? (
              <Button disabled={props.reloading || props.saving} onClick={props.onReload} size="sm" variant="secondary">
                {props.reloading ? "Reloading…" : "Reload latest"}
              </Button>
            ) : null}
            <Button disabled={props.reloading || props.saving} onClick={props.onDiscard} size="sm" variant="ghost">
              {props.discardLabel ?? "Discard draft"}
            </Button>
          </div>
        ) : null}
        <div className="convax-text-editor-dialog__document flex min-h-0 flex-1 flex-col overflow-y-auto">
          <div className="convax-text-editor-dialog__title-wrap">
            <textarea
              aria-label="Document title"
              className="convax-text-editor-dialog__title"
              disabled={props.saving}
              maxLength={200}
              onBlur={props.onTitleCommit}
              onChange={props.onTitleChange ? (event) => props.onTitleChange?.(event.currentTarget.value) : undefined}
              placeholder="Untitled"
              readOnly={!props.onTitleChange}
              ref={titleRef}
              rows={1}
              spellCheck
              value={title}
            />
          </div>
          <TextEditorContextMenus editor={props.editor} />
        </div>
      </section>
    </dialog>
  )
  if (typeof document === "undefined") return layer
  return createPortal(layer, document.body)
}

/** @deprecated Use ExpandedTextEditorDialog. */
export const TextEditorDrawer = ExpandedTextEditorDialog

export function BuiltinTextFileNode(props: NodeProps<CanvasNode>) {
  const canvasEditor = useCanvasEditor()
  const textResources = useCanvasService("textResources")
  const ownsSingleNodeContext = isSingleNodeSelectionContext(canvasEditor.selectionContext, props.id)
  const data = props.data as CanvasTextNodeData
  const dataRef = useRef(data)
  const canvasEditorRef = useRef(canvasEditor)
  const appliedFingerprintRef = useRef(textDataFingerprint(data))
  const initialSourceRef = useRef(textEditorSource(data))
  const [editing, setEditing] = useState(false)
  const [expandedOpen, setExpandedOpen] = useState(false)
  const [expandedSourceRect, setExpandedSourceRect] = useState<
    { height: number; left: number; top: number; width: number } | undefined
  >()
  const [saving, setSaving] = useState(false)
  const [reloading, setReloading] = useState(false)
  const [savingEditableCopy, setSavingEditableCopy] = useState(false)
  const [draft, setDraft] = useState(() => createCanvasTextDraftState(data.resourceState ?? {}))
  const [titleDraft, setTitleDraft] = useState(data.label)
  const draftRef = useRef(draft)
  const titleDraftRef = useRef(titleDraft)
  const mentionEnabledRef = useRef(false)
  const editingScopeActiveRef = useRef(false)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const nodeFocusRef = useRef<HTMLDivElement>(null)
  const discardAfterReloadRef = useRef(false)
  const mountedRef = useRef(true)
  const saveControllerRef = useRef<AbortController | null>(null)
  const saveGenerationRef = useRef(0)
  const saveQueueRef = useRef(createCanvasTextDraftSaveQueue())
  const mentionExtensionRef = useRef<ReturnType<typeof createCanvasTextMentionExtension> | null>(null)
  if (!mentionExtensionRef.current) {
    mentionExtensionRef.current = createCanvasTextMentionExtension({
      enabled: () => mentionEnabledRef.current,
      items: (query) => getCanvasTextMentionCandidates(canvasEditorRef.current.document, props.id, query),
      onSelect: (candidate) => {
        const current = canvasEditorRef.current
        if (!isCanvasTextMentionCandidate(current.document, props.id, candidate.id)) return false
        current.executeCommand({
          type: "nodes.connect",
          connection: { source: candidate.id, target: props.id },
        })
        return true
      },
    })
  }
  dataRef.current = data
  canvasEditorRef.current = canvasEditor
  draftRef.current = draft
  titleDraftRef.current = titleDraft
  mentionEnabledRef.current = expandedOpen && editing && !saving
  const editableResource = isCanvasTextResourceEditable(data.resourceState)
  const inlineEditingScopeActive = isCanvasTextInlineEditingScopeActive({
    editableResource,
    ownsSingleNodeContext,
    readOnly: canvasEditor.readOnly,
  })
  editingScopeActiveRef.current = inlineEditingScopeActive

  const textEditor = useEditor({
    content: initialSourceRef.current.content,
    contentType: initialSourceRef.current.contentType,
    editable: false,
    editorProps: {
      attributes: {
        class: "convax-text-editor__prosemirror",
        spellcheck: "true",
      },
    },
    extensions: createTextEditorExtensions(mentionExtensionRef.current),
    shouldRerenderOnTransaction: true,
    onUpdate: ({ editor }) => {
      const next = updateCanvasTextDraft(draftRef.current, textEditorValue(dataRef.current, editor))
      draftRef.current = next
      setDraft(next)
    },
  })

  useEffect(() => {
    if (!expandedOpen) {
      titleDraftRef.current = data.label
      setTitleDraft(data.label)
    }
  }, [data.label, expandedOpen])

  useEffect(() => {
    if (!textEditor) return
    const nextFingerprint = textDataFingerprint(data)
    if (nextFingerprint === appliedFingerprintRef.current) return
    const incomingState = data.resourceState ?? {}
    if (discardAfterReloadRef.current) {
      discardAfterReloadRef.current = false
      const authoritativeDraft = createCanvasTextDraftState(incomingState)
      appliedFingerprintRef.current = nextFingerprint
      draftRef.current = authoritativeDraft
      setDraft(authoritativeDraft)
      const authoritativeSource = textEditorSource(data)
      textEditor.commands.setContent(authoritativeSource.content, {
        contentType: authoritativeSource.contentType,
        emitUpdate: false,
      })
      textEditor.setEditable(false)
      setEditing(false)
      setExpandedOpen(false)
      setExpandedSourceRect(undefined)
      const returnTarget = returnFocusRef.current
      returnFocusRef.current = null
      if (returnTarget) {
        window.requestAnimationFrame(() => {
          if (returnTarget.isConnected) returnTarget.focus()
        })
      }
      return
    }
    const nextDraft =
      draftRef.current.dirty &&
      draftRef.current.error === "This file changed outside Convax. Your draft was kept." &&
      data.resourceState?.contentRevision !== draftRef.current.baseRevision
        ? rebaseCanvasTextDraft(draftRef.current, incomingState)
        : applyCanvasTextDraftBase(draftRef.current, incomingState)
    if (nextDraft === draftRef.current) return
    appliedFingerprintRef.current = nextFingerprint
    draftRef.current = nextDraft
    setDraft(nextDraft)
    const source =
      nextDraft.content === data.resourceState?.text
        ? textEditorSource(data)
        : textEditorSource({
            ...data,
            resourceState: { ...incomingState, text: nextDraft.content },
          } as CanvasTextNodeData)
    textEditor.commands.setContent(source.content, {
      contentType: source.contentType,
      emitUpdate: false,
    })
  }, [data, draft.dirty, textEditor])

  useEffect(() => {
    textEditor?.setEditable(editing && editableResource && !canvasEditor.readOnly && !saving)
  }, [canvasEditor.readOnly, editableResource, editing, saving, textEditor])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      saveGenerationRef.current += 1
      saveControllerRef.current?.abort()
    }
  }, [])

  useEffect(() => {
    if (!expandedOpen || !textEditor) return
    textEditor.setEditable(true)
    textEditor.commands.focus()
  }, [expandedOpen, textEditor])

  const beginEditing = useCallback(
    (position: "start" | "end" = "end") => {
      if (!textEditor || canvasEditor.readOnly || !editableResource || saving) return
      if (!editing) setEditing(true)
      textEditor.setEditable(true)
      textEditor.commands.focus(position)
    },
    [canvasEditor.readOnly, editableResource, editing, saving, textEditor],
  )

  useEffect(() => {
    if (!inlineEditingScopeActive || expandedOpen || editing) return
    beginEditing()
  }, [beginEditing, editing, expandedOpen, inlineEditingScopeActive])

  const openExpandedEditor = (invoker?: HTMLElement) => {
    if (!textEditor || canvasEditor.readOnly || !editableResource || saving) return
    titleDraftRef.current = dataRef.current.label
    setTitleDraft(dataRef.current.label)
    const source = nodeFocusRef.current ?? invoker
    if (source) {
      const rect = source.getBoundingClientRect()
      setExpandedSourceRect({ height: rect.height, left: rect.left, top: rect.top, width: rect.width })
    } else {
      setExpandedSourceRect(undefined)
    }
    returnFocusRef.current =
      nodeFocusRef.current ??
      invoker ??
      (typeof document !== "undefined" && document.activeElement instanceof HTMLElement ? document.activeElement : null)
    if (editing) textEditor.setEditable(true)
    else beginEditing("start")
    setExpandedOpen(true)
  }

  const commitTitle = useCallback(() => {
    const next = normalizeCanvasTextNodeTitle(titleDraftRef.current)
    titleDraftRef.current = next
    setTitleDraft(next)
    if (next === dataRef.current.label) return
    canvasEditorRef.current.executeCommand({ type: "nodes.setTitle", nodeId: props.id, title: next })
  }, [props.id])

  const closeExpandedEditor = useCallback(() => {
    setExpandedOpen(false)
    setExpandedSourceRect(undefined)
    textEditor?.setEditable(false)
    setEditing(false)
    const returnTarget = returnFocusRef.current
    returnFocusRef.current = null
    if (returnTarget) {
      window.requestAnimationFrame(() => {
        if (returnTarget.isConnected) returnTarget.focus()
      })
    }
  }, [textEditor])

  const discardDraft = useCallback(() => {
    if (!textEditor) return
    const next = discardCanvasTextDraft(draftRef.current)
    draftRef.current = next
    setDraft(next)
    const baseData: CanvasTextNodeData = {
      ...dataRef.current,
      resourceState: { ...(dataRef.current.resourceState ?? { status: "ready" }), text: next.content },
    }
    const source = textEditorSource(baseData)
    textEditor.commands.setContent(source.content, {
      contentType: source.contentType,
      emitUpdate: false,
    })
    commitTitle()
    closeExpandedEditor()
  }, [closeExpandedEditor, commitTitle, textEditor])

  const saveDraft = useCallback(
    () =>
      saveQueueRef.current.run(async () => {
        const current = draftRef.current
        if (!current.dirty) {
          textEditor?.setEditable(false)
          setEditing(expandedOpen)
          if (expandedOpen) textEditor?.setEditable(true)
          return
        }
        if (!textResources || !current.baseRevision) throw new Error("Canvas text resource cannot be saved")
        const controller = new AbortController()
        const generation = ++saveGenerationRef.current
        saveControllerRef.current = controller
        setSaving(true)
        textEditor?.setEditable(false)
        try {
          const next = await saveCanvasTextDraft(current, props.id, textResources, controller.signal)
          if (!mountedRef.current || controller.signal.aborted || generation !== saveGenerationRef.current) return
          draftRef.current = next
          setDraft(next)
          const resourceState = {
            ...(dataRef.current.resourceState ?? { status: "ready" as const }),
            contentRevision: next.baseRevision,
            text: next.baseContent,
          }
          const nextData = { ...dataRef.current, resourceState }
          dataRef.current = nextData
          appliedFingerprintRef.current = textDataFingerprint(nextData)
          canvasEditorRef.current.replaceResourceState(props.id, resourceState)
          setEditing(false)
        } catch (error) {
          if (!mountedRef.current || controller.signal.aborted || generation !== saveGenerationRef.current) throw error
          const message =
            error instanceof CanvasTextResourceConflictError
              ? "This file changed outside Convax. Your draft was kept."
              : "Could not save this text file. Your draft was kept."
          const next = failCanvasTextDraftSave(draftRef.current, message)
          draftRef.current = next
          setDraft(next)
          if (editing && editingScopeActiveRef.current) textEditor?.setEditable(true)
          throw error
        } finally {
          if (mountedRef.current && generation === saveGenerationRef.current) {
            saveControllerRef.current = null
            setSaving(false)
          }
        }
      }),
    [editing, expandedOpen, props.id, textEditor, textResources],
  )

  const closeAndSaveTextEditor = useCallback(() => {
    commitTitle()
    if (!draftRef.current.dirty) {
      closeExpandedEditor()
      return
    }
    void saveDraft()
      .then(() => closeExpandedEditor())
      .catch(() => {
        if (!editingScopeActiveRef.current) return
        textEditor?.setEditable(true)
        textEditor?.commands.focus()
      })
  }, [closeExpandedEditor, commitTitle, saveDraft, textEditor])

  useEffect(() => {
    if ((!editing && !expandedOpen) || inlineEditingScopeActive) return
    closeAndSaveTextEditor()
  }, [closeAndSaveTextEditor, editing, expandedOpen, inlineEditingScopeActive])

  const reloadLatestText = useCallback(() => {
    if (!canvasEditor.reloadAuthoritative || reloading) return
    setReloading(true)
    void canvasEditor
      .reloadAuthoritative()
      .catch(() => undefined)
      .finally(() => {
        if (mountedRef.current) setReloading(false)
      })
  }, [canvasEditor, reloading])

  const discardConflictAndReload = useCallback(() => {
    if (!canvasEditor.reloadAuthoritative || reloading) return
    discardAfterReloadRef.current = true
    setReloading(true)
    void canvasEditor
      .reloadAuthoritative()
      .catch(() => {
        discardAfterReloadRef.current = false
      })
      .finally(() => {
        if (mountedRef.current) setReloading(false)
      })
  }, [canvasEditor, reloading])

  useEffect(() => {
    if (!draft.dirty) return undefined
    return canvasEditor.registerPendingDraft({
      discard: discardDraft,
      inFlightSave: () => saveQueueRef.current.inFlight(),
      isDirty: () => draftRef.current.dirty,
      save: saveDraft,
    })
  }, [canvasEditor, discardDraft, draft.dirty, saveDraft])

  const resourceActionToolbar =
    data.resourceState?.status === "missing" ? (
      <div className="convax-node-toolbar__surface" data-canvas-shortcuts="ignore">
        <ToolbarButton
          icon={<RefreshCw />}
          label="Relink selected Project resource"
          onClick={() => canvasEditor.relinkSelectedResource(props.id)}
        />
        <ToolbarButton
          icon={<FileUp />}
          label="Relink local file"
          onClick={() => canvasEditor.relinkResource(props.id)}
        />
        <ToolbarDivider />
        <ToolbarButton icon={<Copy />} label="Duplicate" onClick={() => canvasEditor.duplicateNode(props.id)} />
        <ToolbarButton destructive icon={<Trash2 />} label="Delete" onClick={() => canvasEditor.removeNode(props.id)} />
      </div>
    ) : data.resourceState?.status === "ready" &&
      data.resourceState.editableText === false &&
      data.resourceState.canSaveEditableCopy === true ? (
      <div className="convax-node-toolbar__surface" data-canvas-shortcuts="ignore">
        <ToolbarButton
          disabled={savingEditableCopy}
          icon={savingEditableCopy ? <LoadingSpinner reducedMotion={canvasEditor.reducedMotion} size="sm" /> : <Save />}
          label="Save editable copy"
          onClick={() => {
            setSavingEditableCopy(true)
            void canvasEditor.saveEditableCopy(props.id).finally(() => setSavingEditableCopy(false))
          }}
        />
        <ToolbarDivider />
        <ToolbarButton icon={<Copy />} label="Duplicate" onClick={() => canvasEditor.duplicateNode(props.id)} />
        <ToolbarButton destructive icon={<Trash2 />} label="Delete" onClick={() => canvasEditor.removeNode(props.id)} />
      </div>
    ) : null

  const textToolbar =
    textEditor && editableResource ? (
      <div className="convax-node-toolbar__surface" data-canvas-shortcuts="ignore">
        <ToolbarButton
          disabled={saving}
          icon={<Maximize2 />}
          label="Expand editor"
          onClick={() => openExpandedEditor()}
        />
        <ToolbarDivider />
        <ToolbarButton icon={<Copy />} label="Duplicate" onClick={() => canvasEditor.duplicateNode(props.id)} />
        <ToolbarButton
          destructive
          icon={<Trash2 />}
          label="Delete"
          onClick={() => {
            discardDraft()
            canvasEditor.removeNode(props.id)
          }}
        />
      </div>
    ) : (
      resourceActionToolbar
    )

  return (
    <>
      <NodeChrome icon={<Type />} label={data.label} node={props} nodeRef={nodeFocusRef} toolbar={textToolbar}>
        {draft.error ? (
          <div className="px-3 py-2 text-xs text-destructive" role="alert">
            {draft.error}
          </div>
        ) : null}
        {expandedOpen ? (
          <div className="convax-text-editor__expanded-placeholder size-full overflow-hidden whitespace-pre-wrap p-4 text-sm text-muted-foreground">
            {draft.content}
          </div>
        ) : (
          <EditorContent
            className={cn("convax-text-editor size-full overflow-auto", editing && "nodrag nowheel is-editing")}
            data-canvas-shortcuts={editing ? "ignore" : undefined}
            data-text-format={textFileFormat(data)}
            editor={textEditor}
            onDoubleClick={(event) => {
              event.stopPropagation()
              openExpandedEditor(event.currentTarget)
            }}
            onKeyDown={(event) => {
              if (event.key !== "Escape") return
              event.preventDefault()
              event.stopPropagation()
              discardDraft()
            }}
          />
        )}
      </NodeChrome>
      {expandedOpen ? (
        <ExpandedTextEditorDialog
          editor={textEditor}
          error={draft.error}
          discardLabel={
            draft.error === "This file changed outside Convax. Your draft was kept." ? "Discard and reload" : undefined
          }
          onClose={closeAndSaveTextEditor}
          onDiscard={
            draft.error === "This file changed outside Convax. Your draft was kept."
              ? discardConflictAndReload
              : discardDraft
          }
          onReload={
            draft.error === "This file changed outside Convax. Your draft was kept." ? reloadLatestText : undefined
          }
          onSave={closeAndSaveTextEditor}
          onTitleChange={(title) => {
            titleDraftRef.current = title
            setTitleDraft(title)
          }}
          onTitleCommit={commitTitle}
          reloading={reloading}
          reducedMotion={canvasEditor.reducedMotion}
          saving={saving}
          sourceRect={expandedSourceRect}
          title={titleDraft}
        />
      ) : null}
    </>
  )
}

function VideoBody(props: {
  data: CanvasMediaNodeData
  onMediaLoad?: (size: { height: number; width: number }) => void
  selected: boolean
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const playbackIntentRef = useRef<"idle" | "hover" | "manual" | "paused">("idle")
  const [hovered, setHovered] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [muted, setMuted] = useState(true)

  useEffect(() => {
    playbackIntentRef.current = "idle"
    setHovered(false)
    setPlaying(false)
    setMuted(true)
    return () => videoRef.current?.pause()
  }, [props.data.resourceState?.url])

  const requestPlayback = (intent: "hover" | "manual", forceMuted = false) => {
    const video = videoRef.current
    if (!video) return
    if (forceMuted) {
      video.muted = true
      setMuted(true)
    }
    playbackIntentRef.current = intent
    void video.play().catch(() => {
      if (playbackIntentRef.current === intent) playbackIntentRef.current = "idle"
      setPlaying(false)
    })
  }

  return (
    <div
      className="convax-video relative size-full bg-black"
      onPointerEnter={() => {
        setHovered(true)
        if (playbackIntentRef.current === "idle") requestPlayback("hover", true)
      }}
      onPointerLeave={() => {
        setHovered(false)
        if (playbackIntentRef.current === "hover") {
          playbackIntentRef.current = "idle"
          videoRef.current?.pause()
        } else if (playbackIntentRef.current === "paused") {
          playbackIntentRef.current = "idle"
        }
      }}
    >
      <video
        ref={videoRef}
        aria-label={props.data.label}
        className="convax-video__media size-full object-contain"
        draggable={false}
        loop
        muted={muted}
        onLoadedMetadata={(event) => {
          props.onMediaLoad?.({
            height: event.currentTarget.videoHeight,
            width: event.currentTarget.videoWidth,
          })
        }}
        onPause={() => setPlaying(false)}
        onPlay={() => setPlaying(true)}
        playsInline
        poster={props.data.resourceState?.posterUrl}
        preload="metadata"
        src={props.data.resourceState?.url}
      />
      <div className={cn("convax-video__controls", (hovered || playing || props.selected) && "is-visible")}>
        <button
          aria-label={playing ? "Pause video" : "Play video"}
          className="convax-video__control nodrag"
          onClick={(event) => {
            event.stopPropagation()
            const video = videoRef.current
            if (!video) return
            if (video.paused) requestPlayback("manual")
            else {
              playbackIntentRef.current = "paused"
              video.pause()
            }
          }}
          title={playing ? "Pause video" : "Play video"}
          type="button"
        >
          {playing ? <Pause /> : <Play />}
        </button>
        <button
          aria-label={muted ? "Unmute video" : "Mute video"}
          className="convax-video__control nodrag"
          onClick={(event) => {
            event.stopPropagation()
            const video = videoRef.current
            if (!video) return
            video.muted = !video.muted
            setMuted(video.muted)
          }}
          title={muted ? "Unmute video" : "Mute video"}
          type="button"
        >
          {muted ? <VolumeX /> : <Volume2 />}
        </button>
      </div>
    </div>
  )
}

function mediaIcon(kind: CanvasMediaKind) {
  if (kind === "image") return <ImageIcon />
  if (kind === "video") return <VideoIcon />
  if (kind === "audio") return <Music2 />
  return <File />
}

function mediaLabel(kind: CanvasMediaKind) {
  if (kind === "image") return "image"
  if (kind === "video") return "video"
  if (kind === "audio") return "audio"
  return "file"
}

function EmptyMedia(props: {
  actions?: {
    generateDisabled: boolean
    onGenerate: () => void
    onUpload: () => void
    uploadDisabled: boolean
  }
  kind: CanvasMediaKind
  state: "blank" | "unavailable"
}) {
  const label = mediaLabel(props.kind)
  if (props.actions) {
    return (
      <div className="convax-media-empty convax-media-empty--image size-full" data-canvas-empty-image="true">
        <div className="convax-media-empty__content">
          <span className="convax-media-empty__icon">
            <ImageIcon />
          </span>
          <span className="convax-media-empty__title">Add an image</span>
          <span className="convax-media-empty__hint">Upload your own or create one with Generate.</span>
          <div className="convax-media-empty__actions nodrag nowheel" data-canvas-shortcuts="ignore">
            <Button
              aria-label="Upload image"
              className="convax-media-empty__button"
              disabled={props.actions.uploadDisabled}
              onClick={(event) => {
                event.stopPropagation()
                props.actions?.onUpload()
              }}
              onPointerDown={(event) => event.stopPropagation()}
              size="sm"
              type="button"
              variant="outline"
            >
              <FileUp />
              Upload
            </Button>
            <Button
              aria-label="Generate image"
              className="convax-media-empty__button"
              disabled={props.actions.generateDisabled}
              onClick={(event) => {
                event.stopPropagation()
                props.actions?.onGenerate()
              }}
              onPointerDown={(event) => event.stopPropagation()}
              size="sm"
              type="button"
              variant="secondary"
            >
              <Sparkles />
              Generate
            </Button>
          </div>
        </div>
      </div>
    )
  }
  const blank = props.state === "blank"
  return (
    <div className="convax-media-empty size-full">
      <div className="convax-media-empty__content">
        <span className="convax-media-empty__icon">{mediaIcon(props.kind)}</span>
        <span className="convax-media-empty__title">{blank ? `Empty ${label}` : `${label} unavailable`}</span>
        <span className="convax-media-empty__hint">
          {blank
            ? "Describe what you want to generate below"
            : "Relink a selected Project resource or choose a local file"}
        </span>
      </div>
    </div>
  )
}

const cutoutSourceUrlByNodeId = new Map<string, string>()
const cutoutDissolveDurationMs = 1_740

export function shouldUpdateCutoutMediaSize(resultUrl: string) {
  return resultUrl.trim().length > 0
}

function cutoutParticleNoise(x: number, y: number, seed: number) {
  let value = Math.imul(x + 1_013 * seed, 0x165667b1)
  value = Math.imul(value ^ Math.imul(y + 1_619 * seed, 0x27d4eb2f), 0x4bf19f61)
  return ((value ^ (value >>> 16)) >>> 0) / 0xffffffff
}

function drawCutoutImage(context: CanvasRenderingContext2D, image: HTMLImageElement, width: number, height: number) {
  const imageRatio = image.naturalWidth / image.naturalHeight
  const frameRatio = width / height
  const scale = imageRatio > frameRatio ? width / image.naturalWidth : height / image.naturalHeight
  const drawWidth = image.naturalWidth * scale
  const drawHeight = image.naturalHeight * scale
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = "high"
  context.drawImage(image, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight)
}

function CutoutImageBody(props: {
  cutoutPresentation: "idle" | "scanning" | "result"
  data: CanvasMediaNodeData
  nodeId: string
  onMediaLoad?: (size: { height: number; width: number }) => void
  sourceUrl?: string
}) {
  const resultUrl = props.data.resourceState?.url ?? ""
  const hasResultMedia = shouldUpdateCutoutMediaSize(resultUrl)
  const url = resultUrl || props.sourceUrl || ""
  const sourceImageRef = useRef<HTMLImageElement>(null)
  const resultImageRef = useRef<HTMLImageElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const onMediaLoadRef = useRef(props.onMediaLoad)
  onMediaLoadRef.current = props.onMediaLoad
  const previousUrl = props.sourceUrl || cutoutSourceUrlByNodeId.get(props.nodeId)
  if (props.cutoutPresentation !== "result" && url) cutoutSourceUrlByNodeId.set(props.nodeId, url)
  const candidate =
    props.cutoutPresentation === "result" && previousUrl && previousUrl !== url
      ? { fromUrl: previousUrl, signature: `${previousUrl}\u0000${url}` }
      : undefined
  const [transition, setTransition] = useState<{
    fromUrl: string
    phase: "dissolving" | "done" | "waiting"
    signature: string
  } | null>(null)
  const activeTransition =
    candidate && transition?.signature === candidate.signature
      ? transition
      : candidate
        ? { ...candidate, phase: "waiting" as const }
        : null

  useEffect(() => {
    if (!candidate) {
      if (url) cutoutSourceUrlByNodeId.set(props.nodeId, url)
      if (transition) setTransition(null)
      return
    }
    if (transition?.signature !== candidate.signature) {
      setTransition({ ...candidate, phase: "waiting" })
    }
  }, [candidate?.signature, props.nodeId, transition, url])

  const beginDissolve = useCallback(() => {
    if (!candidate || transition?.phase === "dissolving" || transition?.phase === "done") return
    if (!sourceImageRef.current?.complete || !resultImageRef.current?.complete) return
    if (!sourceImageRef.current.naturalWidth || !resultImageRef.current.naturalWidth) return
    setTransition({ ...candidate, phase: "dissolving" })
  }, [candidate, transition?.phase])

  useLayoutEffect(() => {
    if (!hasResultMedia) return
    const image = resultImageRef.current
    if (!image?.complete || !image.naturalWidth || !image.naturalHeight) return
    onMediaLoadRef.current?.({ height: image.naturalHeight, width: image.naturalWidth })
  }, [hasResultMedia, resultUrl])

  useLayoutEffect(() => {
    if (activeTransition?.phase !== "dissolving") return
    const canvas = canvasRef.current
    const sourceImage = sourceImageRef.current
    const resultImage = resultImageRef.current
    if (!canvas || !sourceImage || !resultImage) return
    const bounds = canvas.getBoundingClientRect()
    const width = Math.max(1, Math.round(bounds.width))
    const height = Math.max(1, Math.round(bounds.height))
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext("2d", { alpha: true })
    if (!context) return
    const sampleCanvas = document.createElement("canvas")
    sampleCanvas.width = width
    sampleCanvas.height = height
    const sampleContext = sampleCanvas.getContext("2d", { alpha: true, willReadFrequently: true })
    if (!sampleContext) return
    drawCutoutImage(sampleContext, sourceImage, width, height)
    const sourcePixels = sampleContext.getImageData(0, 0, width, height).data
    sampleContext.clearRect(0, 0, width, height)
    drawCutoutImage(sampleContext, resultImage, width, height)
    const resultPixels = sampleContext.getImageData(0, 0, width, height).data

    const capacity = width * height
    const sourceX = new Float32Array(capacity)
    const sourceY = new Float32Array(capacity)
    const colors = new Uint8ClampedArray(capacity * 4)
    const delays = new Float32Array(capacity)
    const travels = new Float32Array(capacity)
    const directionOffsets = new Float32Array(capacity)
    const phases = new Float32Array(capacity)
    const speeds = new Float32Array(capacity)
    const lifetimes = new Float32Array(capacity)
    const swayAmplitudes = new Float32Array(capacity)
    const swayFrequencies = new Float32Array(capacity)
    let count = 0
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const pixel = (y * width + x) * 4
        const resultAlpha = resultPixels[pixel + 3]
        // Keep the dissolve on the removed-background side of the matte.
        // U²-Net intentionally leaves soft foreground alpha; sampling every
        // source/result delta would put visible grain across skin and clothing.
        const removedAlpha = resultAlpha < 128 ? Math.max(0, sourcePixels[pixel + 3] - resultAlpha) : 0
        if (removedAlpha === 0) continue
        const color = count * 4
        sourceX[count] = x
        sourceY[count] = y
        colors[color] = sourcePixels[pixel]
        colors[color + 1] = sourcePixels[pixel + 1]
        colors[color + 2] = sourcePixels[pixel + 2]
        colors[color + 3] = removedAlpha
        delays[count] = (x / Math.max(1, width - 1)) * 0.18 + 0.22 * cutoutParticleNoise(x, y, 1)
        travels[count] = 125 + 225 * cutoutParticleNoise(x, y, 2)
        directionOffsets[count] = cutoutParticleNoise(x, y, 3) - 0.5
        phases[count] = cutoutParticleNoise(x, y, 4) * Math.PI * 2
        speeds[count] = 0.25 + 2.1 * cutoutParticleNoise(x, y, 5)
        lifetimes[count] = 300 + 1_340 * cutoutParticleNoise(x, y, 6)
        swayAmplitudes[count] = 0.65 + 0.7 * cutoutParticleNoise(x, y, 7)
        swayFrequencies[count] = 0.72 + 0.68 * cutoutParticleNoise(x, y, 8)
        count += 1
      }
    }

    const frame = context.createImageData(width, height)
    const pixels = frame.data
    const rowStride = width * 4
    const writeParticle = (offset: number, color: number, alpha: number) => {
      if (resultPixels[offset + 3] >= 128) return
      if (alpha <= pixels[offset + 3]) return
      pixels[offset] = colors[color]
      pixels[offset + 1] = colors[color + 1]
      pixels[offset + 2] = colors[color + 2]
      pixels[offset + 3] = alpha
    }
    const startedAt = performance.now()
    let animationFrame = 0
    const drawFrame = (now: number) => {
      const elapsed = now - startedAt
      pixels.fill(0)
      const baseAngle = -0.22 * Math.PI
      for (let index = 0; index < count; index += 1) {
        const lifetime = lifetimes[index]
        if (elapsed >= lifetime) continue
        const delay = Math.min(1_000 * delays[index], 0.35 * lifetime)
        const rawProgress = Math.min(1, Math.max(0, elapsed - delay) / Math.max(1, lifetime - delay))
        const eased =
          ((1 - Math.exp(-8 * rawProgress * rawProgress)) / (1 - Math.exp(-8))) * 0.92 +
          rawProgress * rawProgress * rawProgress * 0.08
        const swayRamp = Math.min(1, 2.4 * rawProgress)
        const angle = baseAngle + 0.99 * directionOffsets[index]
        const travelX = Math.cos(angle) * 0.7 * travels[index] * speeds[index]
        const travelY = (Math.sin(angle) * travels[index] - 18) * 0.7 * speeds[index]
        const sway =
          29 *
          Math.sin(phases[index] + 1.6 * eased * swayFrequencies[index] * Math.PI) *
          swayAmplitudes[index] *
          swayRamp
        const x = Math.round(sourceX[index] + travelX * eased - Math.sin(angle) * sway)
        const y = Math.round(sourceY[index] + travelY * eased + Math.cos(angle) * sway + 8.4 * eased)
        if (x < 0 || x >= width || y < 0 || y >= height) continue
        const fade = Math.max(0, Math.min(1, (elapsed - Math.max(0, lifetime - 50)) / 50))
        const size = 2.5 * (1 - fade * fade * (3 - 2 * fade))
        if (size <= 0.15) continue
        const color = index * 4
        const offset = (y * width + x) * 4
        const alpha = Math.round(colors[color + 3] * (1 - rawProgress))
        if (alpha <= 0) continue
        writeParticle(offset, color, alpha)
        const radius = Math.ceil(Math.max(0, size - 1))
        for (let distance = 1; distance <= radius; distance += 1) {
          const neighborAlpha = Math.round(
            alpha * Math.min(0.48, 1.35 * rawProgress) * Math.max(0, Math.min(1, size - distance)),
          )
          if (neighborAlpha <= 0) continue
          if (x - distance >= 0) writeParticle(offset - 4 * distance, color, neighborAlpha)
          if (x + distance < width) writeParticle(offset + 4 * distance, color, neighborAlpha)
          if (y - distance >= 0) writeParticle(offset - rowStride * distance, color, neighborAlpha)
          if (y + distance < height) writeParticle(offset + rowStride * distance, color, neighborAlpha)
        }
      }
      context.putImageData(frame, 0, 0)
      sourceImage.style.visibility = "hidden"
      canvas.style.visibility = "visible"
      if (elapsed < cutoutDissolveDurationMs) {
        animationFrame = window.requestAnimationFrame(drawFrame)
        return
      }
      canvas.style.visibility = "hidden"
      cutoutSourceUrlByNodeId.set(props.nodeId, url)
      setTransition((current) =>
        current?.signature === activeTransition.signature ? { ...current, phase: "done" } : current,
      )
    }
    drawFrame(startedAt)
    return () => {
      window.cancelAnimationFrame(animationFrame)
      sourceImage.style.visibility = ""
      canvas.style.visibility = "hidden"
    }
  }, [activeTransition?.phase, activeTransition?.signature, props.nodeId, url])

  const imageClassName = "convax-cutout-media__image relative z-[1] size-full object-contain"
  return (
    <div className="convax-cutout-media relative size-full" data-canvas-cutout-presentation={props.cutoutPresentation}>
      <img
        alt=""
        aria-hidden
        className="convax-cutout-media__ambient"
        crossOrigin="anonymous"
        decoding="async"
        draggable={false}
        loading="lazy"
        src={url}
      />
      {activeTransition && activeTransition.phase !== "done" ? (
        <canvas aria-hidden className="convax-cutout-media__dissolve-canvas" ref={canvasRef} />
      ) : null}
      <img
        alt={props.data.label}
        className={imageClassName}
        crossOrigin="anonymous"
        decoding="async"
        draggable={false}
        loading="lazy"
        onLoad={(event) => {
          if (hasResultMedia) {
            onMediaLoadRef.current?.({
              height: event.currentTarget.naturalHeight,
              width: event.currentTarget.naturalWidth,
            })
          }
          beginDissolve()
        }}
        ref={resultImageRef}
        src={url}
      />
      {activeTransition && activeTransition.phase !== "done" ? (
        <img
          alt=""
          aria-hidden
          className={cn(imageClassName, "convax-cutout-media__dissolve-source")}
          crossOrigin="anonymous"
          decoding="async"
          draggable={false}
          onLoad={beginDissolve}
          ref={sourceImageRef}
          src={activeTransition.fromUrl}
        />
      ) : null}
      {props.cutoutPresentation === "scanning" ? (
        <div aria-hidden className="convax-cutout-media__scan">
          <span className="convax-cutout-media__scan-tint" />
          <span className="convax-cutout-media__scan-beam" />
        </div>
      ) : null}
    </div>
  )
}

function MediaBody(props: {
  cutoutPresentation: "idle" | "scanning" | "result"
  cutoutSourceUrl?: string
  data: CanvasMediaNodeData
  emptyImageActions?: {
    generateDisabled: boolean
    onGenerate: () => void
    onUpload: () => void
    uploadDisabled: boolean
  }
  nodeId: string
  onMediaLoad?: (size: { height: number; width: number }) => void
  selected: boolean
}) {
  const url =
    props.data.resourceState?.url ||
    (props.data.kind === "image" && props.cutoutPresentation !== "idle" ? props.cutoutSourceUrl : "") ||
    ""
  if (!url.trim()) {
    return (
      <EmptyMedia
        actions={props.emptyImageActions}
        kind={props.data.kind}
        state={props.data.status === "idle" ? "blank" : "unavailable"}
      />
    )
  }
  if (props.data.kind === "image") {
    return (
      <CutoutImageBody
        cutoutPresentation={props.cutoutPresentation}
        data={props.data}
        nodeId={props.nodeId}
        onMediaLoad={props.onMediaLoad}
        sourceUrl={props.cutoutSourceUrl}
      />
    )
  }
  if (props.data.kind === "video") {
    return <VideoBody data={props.data} onMediaLoad={props.onMediaLoad} selected={props.selected} />
  }
  if (props.data.kind === "audio") {
    return (
      <div className="flex size-full flex-col items-center justify-center gap-4 p-5">
        <Music2 className="size-8 text-muted-foreground" />
        <audio className="nodrag nowheel w-full" controls preload="metadata" src={url} />
      </div>
    )
  }
  return (
    <div className="flex size-full flex-col items-center justify-center gap-3 p-5 text-center">
      <File className="size-8 text-muted-foreground" />
      <span className="max-w-full truncate text-sm">{props.data.name ?? props.data.label}</span>
    </div>
  )
}

function downloadMedia(data: CanvasMediaNodeData) {
  const url = data.resourceState?.url
  if (!url) return
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = data.name ?? data.label
  anchor.rel = "noopener"
  anchor.click()
}

function connectedImageSourceUrl(
  document: {
    edges: readonly { source: string; target: string }[]
    nodes: readonly CanvasNode[]
  },
  targetNodeId: string,
) {
  for (const edge of document.edges) {
    if (edge.target !== targetNodeId) continue
    const source = document.nodes.find((node) => node.id === edge.source)
    if (source?.type !== "file" || source.data.kind !== "image") continue
    const url = (source.data as CanvasMediaNodeData).resourceState?.url
    if (url) return url
  }
  return undefined
}

export function BuiltinMediaFileNode(props: NodeProps<CanvasNode>) {
  const editor = useCanvasEditor()
  const assistant = useCanvasService("assistant")
  const data = props.data as CanvasMediaNodeData
  const ownerNode = editor.document.nodes.find((node) => node.id === props.id)
  const generationRun = ownerNode ? getCanvasNodeGenerationRun(ownerNode) : undefined
  const cutoutGeneration = generationRun?.toolId === "cutout-studio/background.remove" ? generationRun : undefined
  const cutoutSourceUrl = cutoutGeneration ? connectedImageSourceUrl(editor.document, props.id) : undefined
  const cutoutScanRequested = Boolean(cutoutGeneration && isCanvasNodeGenerationRunActive(cutoutGeneration))
  const cutoutPresentation =
    cutoutGeneration?.status === "succeeded" ? "result" : cutoutScanRequested ? "scanning" : "idle"
  const url = data.resourceState?.url
  const supportsViewer = data.kind === "image" || data.kind === "video"
  const [viewerOpen, setViewerOpen] = useState(false)
  useEffect(() => {
    if (!url) setViewerOpen(false)
  }, [url])
  const emptyImage = isCanvasEmptyImageNodeData(data)
  const toolbar = (
    <div className="convax-node-toolbar__surface" data-canvas-shortcuts="ignore">
      {data.resourceState?.status === "missing" ? (
        <>
          <ToolbarButton
            icon={<RefreshCw />}
            label="Relink selected Project resource"
            onClick={() => editor.relinkSelectedResource(props.id)}
          />
          <ToolbarButton icon={<FileUp />} label="Relink local file" onClick={() => editor.relinkResource(props.id)} />
          <ToolbarDivider />
        </>
      ) : null}
      {supportsViewer ? (
        <ToolbarButton
          disabled={!url}
          icon={<Maximize2 />}
          label={`View ${mediaLabel(data.kind)} full screen`}
          onClick={() => setViewerOpen(true)}
        />
      ) : null}
      <ToolbarButton
        disabled={!url}
        icon={<Download />}
        label={`Download ${mediaLabel(data.kind)}`}
        onClick={() => downloadMedia(data)}
      />
      <ToolbarDivider />
      <ToolbarButton icon={<Copy />} label="Duplicate" onClick={() => editor.duplicateNode(props.id)} />
      <ToolbarButton destructive icon={<Trash2 />} label="Delete" onClick={() => editor.removeNode(props.id)} />
    </div>
  )
  return (
    <>
      <NodeChrome
        className={cn(
          supportsViewer && "convax-node__surface--media",
          data.kind === "image" && url && "convax-node__surface--image",
          data.kind === "video" && "convax-node__surface--video",
        )}
        icon={mediaIcon(data.kind)}
        label={data.label}
        node={props}
        resizeMode="proportional"
        toolbar={toolbar}
      >
        <MediaBody
          cutoutPresentation={cutoutPresentation}
          cutoutSourceUrl={cutoutSourceUrl}
          data={data}
          emptyImageActions={
            emptyImage
              ? {
                  generateDisabled: editor.readOnly || editor.hydrating || !assistant,
                  onGenerate: () => editor.selectNodes([props.id]),
                  onUpload: () => editor.relinkResource(props.id),
                  uploadDisabled: editor.readOnly || editor.hydrating || !editor.canRelinkResource,
                }
              : undefined
          }
          nodeId={props.id}
          onMediaLoad={
            supportsViewer
              ? (size) => {
                  const fitted = fitCanvasMediaNodeToIntrinsicSize(editor.document, {
                    ...size,
                    nodeId: props.id,
                    preserveFrame: cutoutPresentation !== "idle",
                    sourceUrl: url ?? "",
                  })
                  const next = fitted.nodes.find((node) => node.id === props.id)
                  const current = editor.document.nodes.find((node) => node.id === props.id)
                  if (!next || !current) return
                  const width = typeof next.style?.width === "number" ? next.style.width : undefined
                  const height = typeof next.style?.height === "number" ? next.style.height : undefined
                  const sizeChanged = width !== current.style?.width || height !== current.style?.height
                  if (!sizeChanged || width === undefined || height === undefined) return
                  editor.executeCommand({
                    type: "nodes.setGeometry",
                    updates: [{ nodeId: props.id, position: next.position, size: { width, height } }],
                  })
                }
              : undefined
          }
          selected={props.selected}
        />
      </NodeChrome>
      {supportsViewer && url ? (
        <CanvasMediaViewer
          height={data.height}
          kind={data.kind === "image" ? "image" : "video"}
          label={data.name ?? data.label}
          onOpenChange={setViewerOpen}
          open={viewerOpen}
          posterUrl={data.resourceState?.posterUrl}
          url={url}
          width={data.width}
        />
      ) : null}
    </>
  )
}

interface FolderCardPreview {
  id: string
  kind: "file" | "image" | "text" | "video"
  label: string
  url?: string
}

function FolderCardLayers(props: { overflowCount: number; previews: readonly FolderCardPreview[] }) {
  return (
    <>
      <div aria-hidden="true" className="convax-group-folder__back">
        <div className="convax-group-folder__tab" />
      </div>
      <div className="convax-group-folder__papers" aria-hidden="true">
        {props.previews.map((preview, index) => (
          <div className="convax-group-folder__paper" data-paper-index={index} key={preview.id}>
            <div className="convax-group-folder__paper-content">
              {preview.url ? (
                <img alt="" draggable={false} height={72} loading="lazy" src={preview.url} width={120} />
              ) : preview.kind === "text" ? (
                <>
                  <FileText />
                  <span>{preview.label}</span>
                </>
              ) : (
                <>
                  <File />
                  <span>{preview.label}</span>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
      <div aria-hidden="true" className="convax-group-folder__front" />
      {props.overflowCount > 0 ? (
        <span aria-hidden="true" className="convax-group-folder__overflow">
          +{props.overflowCount}
        </span>
      ) : null}
    </>
  )
}

export function resolveCanvasGroupTitleEdit(input: {
  cancelled: boolean
  changed: boolean
  draft: string
  persisted: string
}) {
  if (input.cancelled || !input.changed) return { shouldCommit: false, title: input.persisted }
  const title = Array.from(input.draft.trim()).slice(0, 20).join("") || "Untitled group"
  return { shouldCommit: title !== input.persisted, title }
}

function GroupNode(props: NodeProps<CanvasNode>) {
  const editor = useCanvasEditor()
  const groupPresentation = useCanvasGroupPresentation()
  const focused = groupPresentation.focusedGroupId === props.id
  const ownsSingleNodeContext = isSingleNodeSelectionContext(editor.selectionContext, props.id)
  const summary = groupPresentation.summaries.get(props.id)
  const group = editor.document.nodes.find((node) => node.id === props.id)
  const folded = isCanvasGroupFolded(group)
  const appearance = getCanvasGroupAppearance(group)
  const appearanceUnsupported = hasUnsupportedCanvasGroupAppearance(group)
  const [appearanceAnchor, setAppearanceAnchor] = useState<HTMLElement | null>(null)
  const [title, setTitle] = useState(props.data.label)
  const titleChangedRef = useRef(false)
  const cancelTitleSaveRef = useRef(false)
  useEffect(() => {
    setTitle(props.data.label)
    titleChangedRef.current = false
    cancelTitleSaveRef.current = false
  }, [props.data.label])
  useEffect(() => {
    if (!ownsSingleNodeContext || editor.readOnly || appearanceUnsupported) setAppearanceAnchor(null)
  }, [appearanceUnsupported, editor.readOnly, ownsSingleNodeContext])
  const saveTitle = () => {
    const resolved = resolveCanvasGroupTitleEdit({
      cancelled: cancelTitleSaveRef.current,
      changed: titleChangedRef.current,
      draft: title,
      persisted: props.data.label,
    })
    cancelTitleSaveRef.current = false
    titleChangedRef.current = false
    setTitle(resolved.title)
    if (!resolved.shouldCommit) return
    editor.executeCommand({ type: "nodes.setTitle", nodeId: props.id, title: resolved.title })
  }
  const updateAppearance = (next: CanvasGroupAppearance) => {
    editor.executeCommand({ type: "nodes.setGroupAppearance", nodeId: props.id, appearance: next })
  }
  if (focused) {
    return <div aria-hidden="true" className="pointer-events-none size-full" data-canvas-group-focus-root />
  }
  if (!folded) {
    return (
      <div
        className={cn(
          "relative size-full rounded-lg border border-dashed bg-muted/20",
          props.selected ? "border-ring ring-2 ring-ring/20" : "border-border",
          groupPresentation.dropTargetId === props.id && "ring-4 ring-ring/25",
        )}
        data-canvas-group
        data-canvas-group-drop-target={groupPresentation.dropTargetId === props.id || undefined}
      >
        <NodeResizer
          color="var(--ring)"
          handleClassName="convax-node-resizer__handle"
          isVisible={ownsSingleNodeContext && !editor.readOnly}
          lineClassName="convax-node-resizer__line"
          minWidth={240}
          minHeight={180}
          onResizeStart={editor.beginGesture}
          onResizeEnd={editor.endGesture}
        />
        <div className="pointer-events-none absolute left-3 top-2 text-xs font-medium text-muted-foreground">
          {props.data.label}
        </div>
        <NodeConnectionHandles nodeId={props.id} />
      </div>
    )
  }
  const relationshipCount = (summary?.externalIncomingCount ?? 0) + (summary?.externalOutgoingCount ?? 0)
  const previews = (summary?.previews ?? []).slice(0, 3)
  const overflowCount = Math.max(0, (summary?.itemCount ?? 0) - previews.length)
  return (
    <div
      className={cn(
        "convax-node convax-group-folder relative size-full",
        props.selected && "is-selected",
        groupPresentation.dropTargetId === props.id && "is-drop-target",
      )}
      data-canvas-group-color={appearance.color}
      data-canvas-group-emoji={appearance.emoji}
      data-canvas-folder-card
      data-canvas-group-folder
      data-canvas-group-drop-target={groupPresentation.dropTargetId === props.id || undefined}
    >
      <FolderCardLayers overflowCount={overflowCount} previews={previews} />
      <div className="convax-group-folder__content">
        <div className="flex min-w-0 items-center gap-1">
          <button
            aria-label={appearanceUnsupported ? "Group appearance unavailable" : "Customize group"}
            className="convax-group-folder__emoji nodrag nowheel"
            data-canvas-shortcuts="ignore"
            disabled={editor.readOnly || appearanceUnsupported}
            onClick={(event) => {
              event.stopPropagation()
              setAppearanceAnchor(event.currentTarget)
            }}
            onDoubleClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            type="button"
          >
            <span aria-hidden="true">{getCanvasGroupEmoji(appearance.emoji)}</span>
          </button>
          <input
            aria-label="Rename group"
            className="convax-group-folder__title nodrag min-w-0 flex-1 border-0 bg-transparent p-0 outline-none"
            data-canvas-shortcuts="ignore"
            disabled={editor.readOnly}
            maxLength={20}
            onBlur={saveTitle}
            onChange={(event) => {
              cancelTitleSaveRef.current = false
              titleChangedRef.current = true
              setTitle(Array.from(event.currentTarget.value).slice(0, 20).join(""))
            }}
            onDoubleClick={(event) => event.stopPropagation()}
            onFocus={() => {
              cancelTitleSaveRef.current = false
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur()
              if (event.key === "Escape") {
                cancelTitleSaveRef.current = true
                titleChangedRef.current = false
                setTitle(props.data.label)
                event.currentTarget.blur()
              }
            }}
            title={props.data.label}
            value={title}
          />
        </div>
        <div className="convax-group-folder__meta">
          <span>
            {summary?.itemCount ?? 0} item{summary?.itemCount === 1 ? "" : "s"}
          </span>
          {(summary?.nestedGroupCount ?? 0) > 0 ? (
            <span>
              · {summary?.nestedGroupCount} folder{summary?.nestedGroupCount === 1 ? "" : "s"}
            </span>
          ) : null}
          {relationshipCount > 0 ? (
            <span className="ml-auto flex items-center gap-1" title="Relations crossing this group">
              {(summary?.externalIncomingCount ?? 0) > 0 ? <ArrowDownLeft className="size-3" /> : null}
              {(summary?.externalOutgoingCount ?? 0) > 0 ? <ArrowUpRight className="size-3" /> : null}
              {relationshipCount}
            </span>
          ) : null}
        </div>
      </div>
      <NodeConnectionHandles nodeId={props.id} />
      {appearanceAnchor ? (
        <CanvasGroupAppearancePicker
          anchor={appearanceAnchor}
          appearance={appearance}
          onChange={updateAppearance}
          onClose={() => setAppearanceAnchor(null)}
        />
      ) : null}
    </div>
  )
}

export function BuiltinFolderFileNode(props: NodeProps<CanvasNode>) {
  const editor = useCanvasEditor()
  const data = props.data as CanvasFolderNodeData
  const toolbar = (
    <div className="convax-node-toolbar__surface" data-canvas-shortcuts="ignore">
      {data.resourceState?.status === "missing" ? (
        <>
          <ToolbarButton
            icon={<RefreshCw />}
            label="Relink selected Project directory"
            onClick={() => editor.relinkSelectedResource(props.id)}
          />
          <ToolbarDivider />
        </>
      ) : null}
      <ToolbarButton icon={<Copy />} label="Duplicate" onClick={() => editor.duplicateNode(props.id)} />
      <ToolbarButton destructive icon={<Trash2 />} label="Delete" onClick={() => editor.removeNode(props.id)} />
    </div>
  )
  return (
    <NodeChrome frameless icon={<Folder />} label={data.label} node={props} resizeMode="proportional" toolbar={toolbar}>
      <div
        className={cn("convax-group-folder relative size-full", props.selected && "is-selected")}
        data-canvas-folder-card
        data-canvas-group-color="default"
        data-canvas-project-folder
      >
        <FolderCardLayers
          overflowCount={0}
          previews={[{ id: `${props.id}:directory`, kind: "file", label: data.name ?? data.label }]}
        />
        <div className="convax-group-folder__content">
          <div className="flex min-w-0 items-center gap-1">
            <span aria-hidden="true" className="convax-group-folder__emoji">
              📁
            </span>
            <div className="convax-group-folder__title min-w-0 flex-1" title={data.name ?? data.label}>
              {data.name ?? data.label}
            </div>
          </div>
          <div className="convax-group-folder__meta">
            <span>Project folder</span>
            {data.resourceState?.status === "missing" ? <span className="ml-auto">Missing</span> : null}
          </div>
        </div>
      </div>
    </NodeChrome>
  )
}

function FileGenerationActivityOverlay(props: {
  kind: CanvasNode["data"]["kind"]
  onCancel: () => void
  run: CanvasNodeGenerationRun
}) {
  const editor = useCanvasEditor()
  if (isCanvasNodeGenerationRunActive(props.run)) {
    return (
      <div
        aria-busy="true"
        aria-live="polite"
        className={cn(
          "convax-generation-status-overlay absolute inset-0 z-20 grid place-items-center overflow-hidden bg-card/85 p-4 text-center backdrop-blur-sm",
          (props.kind === "image" || props.kind === "video") && "convax-generation-status-overlay--media",
          props.kind === "video" && "convax-generation-status-overlay--video",
        )}
        data-canvas-file-generation-activity={props.run.status}
        data-canvas-generation-run-tool-id={props.run.toolId}
        role="status"
      >
        <div className="flex flex-col items-center gap-2 text-sm font-medium text-foreground">
          <LoadingSpinner reducedMotion={editor.reducedMotion} size="lg" tone="brand" />
          <span>{props.run.status === "submitting" ? "正在提交…" : "正在生成…"}</span>
          <Button
            className="nodrag nowheel"
            onClick={(event) => {
              event.stopPropagation()
              props.onCancel()
            }}
            onPointerDown={(event) => event.stopPropagation()}
            size="sm"
            type="button"
            variant="outline"
          >
            取消
          </Button>
        </div>
      </div>
    )
  }
  const title = props.run.failureMessage ?? "生成失败"
  return (
    <div
      className={cn(
        "convax-generation-status-overlay pointer-events-none absolute inset-0 z-20 grid place-items-center overflow-hidden bg-black/90 p-4 text-center backdrop-blur-sm",
        (props.kind === "image" || props.kind === "video") && "convax-generation-status-overlay--media",
        props.kind === "video" && "convax-generation-status-overlay--video",
      )}
      data-canvas-file-generation-activity={props.run.status}
      data-canvas-generation-run-tool-id={props.run.toolId}
      role="alert"
    >
      <div className="flex max-w-full flex-col items-center gap-3">
        <span className="text-muted-foreground [&>svg]:size-8">{generationStatusIcon(props.kind)}</span>
        <span className="max-w-full text-sm font-medium text-destructive">{title}</span>
      </div>
    </div>
  )
}

function generationStatusIcon(kind: CanvasNode["data"]["kind"]) {
  if (kind === "video") return <Clapperboard />
  if (kind === "image") return <ImageIcon />
  if (kind === "audio") return <Music2 />
  return <Sparkles />
}

function generationFailureTitle(error?: string) {
  const message = error?.trim()
  if (message && message.length <= 200 && /^[^<>{}\u0000-\u001f\u007f]+ 服务不可用$/u.test(message)) return message
  if (
    message &&
    /(?:service|runtime|provider|server).*(?:unavailable|disconnected|offline)|(?:服务|运行时).*(?:不可用|断开|离线)/i.test(
      message,
    )
  ) {
    return "生成服务不可用"
  }
  return "生成失败"
}

function PersistedResourceStatusOverlay(props: {
  error?: string
  kind: CanvasNode["data"]["kind"]
  status: "error" | "pending"
}) {
  const editor = useCanvasEditor()
  if (props.status === "pending") {
    return (
      <div
        aria-busy="true"
        aria-live="polite"
        className={cn(
          "convax-generation-status-overlay pointer-events-none absolute inset-0 z-20 grid place-items-center overflow-hidden bg-card/80 backdrop-blur-sm",
          (props.kind === "image" || props.kind === "video") && "convax-generation-status-overlay--media",
          props.kind === "video" && "convax-generation-status-overlay--video",
        )}
        data-canvas-persisted-resource-status="pending"
        role="status"
      >
        <div className="flex flex-col items-center gap-2 text-sm font-medium text-foreground">
          <LoadingSpinner reducedMotion={editor.reducedMotion} size="lg" tone="brand" />
          <span>正在生成…</span>
        </div>
      </div>
    )
  }
  const title = generationFailureTitle(props.error)
  return (
    <div
      className={cn(
        "convax-generation-status-overlay pointer-events-none absolute inset-0 z-20 grid place-items-center overflow-hidden bg-black/90 p-4 text-center backdrop-blur-sm",
        (props.kind === "image" || props.kind === "video") && "convax-generation-status-overlay--media",
        props.kind === "video" && "convax-generation-status-overlay--video",
      )}
      data-canvas-persisted-resource-status="error"
      role="alert"
    >
      <div className="flex max-w-full flex-col items-center gap-3">
        <span className="text-muted-foreground [&>svg]:size-8">{generationStatusIcon(props.kind)}</span>
        <span className="max-w-full text-sm font-medium text-destructive">{title}</span>
      </div>
    </div>
  )
}

function FileAssistantAccessory(
  props: NodeProps<CanvasNode> & {
    generationSubmissionMode?: CanvasAssistantGenerationCapability["submissionMode"]
    initialGenerationPrompt?: string
    open: boolean
  },
) {
  const editor = useCanvasEditor()
  const overlayRoot = useCanvasOverlayRoot()
  const assistant = useCanvasService("assistant")
  const [focusWithin, setFocusWithin] = useState(false)
  const ownsSingleNodeContext = isSingleNodeSelectionContext(editor.selectionContext, props.id)
  const visible = Boolean(props.open && assistant && ownsSingleNodeContext && (!editor.readOnly || editor.hydrating))
  const ownerNode = editor.document.nodes.find((node) => node.id === props.id)
  const generationOutputs =
    props.data.kind === "text"
      ? (["image", "video"] as const)
      : props.data.kind === "image" || props.data.kind === "video"
        ? ([props.data.kind] as const)
        : undefined
  const generationOutput = generationOutputs?.[0]
  const replacesOwner = props.data.kind === "image" || props.data.kind === "video"
  const mentionedNodeIds = getIncomingConnectedCanvasFileNodeIds(editor.document, props.id)
  const open = visible
  useEffect(() => {
    if (!open) setFocusWithin(false)
  }, [open])
  const presence = useCanvasOverlayPresence(open)
  if (!presence.present || !assistant) return null
  const layer = (
    <div
      aria-hidden={!open || undefined}
      className={cn("convax-canvas-composer-overlay convax-node-assistant nodrag", focusWithin && "nowheel")}
      data-canvas-composer-overlay="file-assistant"
      data-canvas-presence={presence.phase}
      data-canvas-shortcuts="ignore"
      inert={!open || undefined}
      onBlurCapture={(event) => {
        if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) {
          setFocusWithin(false)
        }
      }}
      onFocusCapture={() => setFocusWithin(true)}
    >
      <div data-canvas-shortcuts="ignore">
        <fieldset
          aria-busy={editor.hydrating || undefined}
          className="m-0 size-full min-w-0 border-0 p-0"
          disabled={!open || editor.readOnly}
          inert={!open || editor.readOnly || undefined}
        >
          {assistant.render({
            document: editor.document,
            ...(generationOutput
              ? {
                  generation: {
                    ...(generationOutputs && generationOutputs.length > 1
                      ? { availableOutputs: generationOutputs }
                      : {}),
                    ...(props.generationSubmissionMode === undefined
                      ? {}
                      : { submissionMode: props.generationSubmissionMode }),
                    ...(props.initialGenerationPrompt === undefined
                      ? {}
                      : { initialPrompt: props.initialGenerationPrompt }),
                    output: generationOutput,
                    ...(replacesOwner
                      ? {
                          onOwnerToolIdChange: (toolId?: string) => {
                            editor.executeCommand({ type: "nodes.setGenerationToolId", nodeId: props.id, toolId })
                          },
                          ownerToolId: ownerNode ? getCanvasNodeGenerationToolId(ownerNode) : undefined,
                        }
                      : {}),
                  },
                }
              : {}),
            mentionedNodeIds,
            mode: "file",
            ownerNodeId: props.id,
          })}
        </fieldset>
      </div>
    </div>
  )
  if (typeof document === "undefined") return layer
  return overlayRoot ? createPortal(layer, overlayRoot) : null
}

function AgentNode(props: NodeProps<CanvasNode>) {
  const editor = useCanvasEditor()
  const assistant = useCanvasService("assistant")
  const mentionedNodeIds = getIncomingConnectedCanvasFileNodeIds(editor.document, props.id)
  const toolbar = (
    <div className="convax-node-toolbar__surface" data-canvas-shortcuts="ignore">
      <ToolbarButton icon={<Copy />} label="Duplicate" onClick={() => editor.duplicateNode(props.id)} />
      <ToolbarButton destructive icon={<Trash2 />} label="Delete" onClick={() => editor.removeNode(props.id)} />
    </div>
  )
  return (
    <NodeChrome icon={<Bot />} label={props.data.label} node={props} toolbar={toolbar}>
      <div className="convax-agent-node nodrag nowheel size-full" data-canvas-shortcuts="ignore">
        {assistant ? (
          assistant.render({
            document: editor.document,
            mentionedNodeIds,
            mode: "agent",
            ownerNodeId: props.id,
          })
        ) : (
          <div className="grid size-full place-items-center p-5 text-center text-sm text-muted-foreground">
            Register an assistant service to use this Agent.
          </div>
        )}
      </div>
    </NodeChrome>
  )
}

function CanvasSelectionDragNodeSurface(props: { children: ReactNode; node: NodeProps<CanvasNode> }) {
  const editor = useCanvasEditor()
  const source = editor.visibleSelectionDragSource
  const armed = Boolean(editor.selectionDragArmed && editor.selection.nodeIds.has(props.node.id) && source)
  const ready = armed && editor.selectionDragStatus === "ready"
  const preparing = armed && editor.selectionDragStatus === "preparing"
  const showsHint = armed && editor.selection.nodeIds.values().next().value === props.node.id
  const label = editor.selectionDragModeActive ? (source?.mode?.label ?? source?.label) : source?.label
  const preparingLabel = editor.selectionDragModeActive
    ? (source?.mode?.preparingLabel ?? label)
    : (source?.preparingLabel ?? label)

  return (
    <div
      className={cn(
        "relative size-full",
        armed && "nodrag",
        ready && "cursor-grab active:cursor-grabbing",
        preparing && "cursor-wait",
      )}
      data-canvas-selection-drag-state={armed ? editor.selectionDragStatus : undefined}
      draggable={ready}
      onDragStart={(event) =>
        startCanvasSelectionDragFromNode(
          event,
          ready,
          editor.selectionDragModeActive,
          source?.shortcutModifier,
          editor.startSelectionDrag,
        )
      }
      onDragEnd={editor.finishSelectionDrag}
      onPointerEnter={() => editor.setSelectionDragCandidateNode(props.node.id)}
      onPointerLeave={() => editor.setSelectionDragCandidateNode(null)}
      onPointerDown={armed ? (event) => event.stopPropagation() : undefined}
    >
      {props.children}
      {showsHint ? (
        <div
          aria-live="polite"
          className="pointer-events-none absolute left-1/2 top-2 z-[80] flex max-w-[calc(100%-1rem)] -translate-x-1/2 items-center gap-1.5 rounded-full border bg-card/95 px-2.5 py-1 text-[11px] font-medium text-card-foreground shadow-sm backdrop-blur"
          data-canvas-selection-drag-hint
          role="status"
        >
          {preparing ? <LoadingSpinner reducedMotion={editor.reducedMotion} size="sm" /> : source?.icon}
          <span className="truncate">{preparing ? preparingLabel : label}</span>
        </div>
      ) : null}
    </div>
  )
}

export function startCanvasSelectionDragFromNode(
  event: Pick<
    DragEvent<HTMLElement>,
    "altKey" | "ctrlKey" | "metaKey" | "preventDefault" | "shiftKey" | "stopPropagation"
  >,
  ready: boolean,
  modeActive: boolean,
  shortcutModifier: "control" | "meta" | undefined,
  start: () => boolean,
) {
  event.preventDefault()
  event.stopPropagation()
  if (!ready || (!modeActive && !isCanvasExternalDragChordHeld(event, shortcutModifier))) return false
  return start()
}

export function BuiltinCanvasNode(props: NodeProps<CanvasNode>) {
  const editor = useCanvasEditor()
  // React Flow keeps aggregate membership; card renderers receive only the sole-card activation state.
  const activeSelected = isSingleNodeSelectionContext(editor.selectionContext, props.id)
  const activeProps = props.selected === activeSelected ? props : { ...props, selected: activeSelected }
  let content: ReactNode
  if (activeProps.data.kind === "group") content = <GroupNode {...activeProps} />
  else if (activeProps.data.kind === "agent" || activeProps.type === "agent") content = <AgentNode {...activeProps} />
  else content = <RegisteredFileNode {...activeProps} />
  return <CanvasSelectionDragNodeSurface node={props}>{content}</CanvasSelectionDragNodeSurface>
}

function RegisteredFileNode(props: NodeProps<CanvasNode>) {
  const editor = useCanvasEditor()
  const mutationSurface = useCanvasMutationSurface(editor.readOnly)
  const assistant = useCanvasService("assistant")
  const telemetry = useCanvasService("telemetry")
  const [assistantOpen, setAssistantOpen] = useState(false)
  const ownsSingleNodeContext = isSingleNodeSelectionContext(editor.selectionContext, props.id)
  const visualMediaAssistant = props.data.kind === "image" || props.data.kind === "video"
  const directAssistant = visualMediaAssistant || props.data.kind === "text"
  const showMutationToolbar = canShowNodeLocalMutationSurface(
    editor.selectionContext,
    props.id,
    !mutationSurface.visible,
  )
  useEffect(() => {
    if (ownsSingleNodeContext && !editor.readOnly && assistant) return
    setAssistantOpen(false)
  }, [assistant, editor.readOnly, ownsSingleNodeContext])
  const assistantTrigger: FileAssistantTrigger | null =
    assistant && !directAssistant && showMutationToolbar
      ? {
          open: assistantOpen,
          toggle: () => setAssistantOpen((current) => !current),
        }
      : null
  const generation = useCanvasService("generate")
  const ownerNode = editor.document.nodes.find((node) => node.id === props.id)
  const generationRun = ownerNode ? getCanvasNodeGenerationRun(ownerNode) : undefined
  const activeGeneration = Boolean(generationRun && isCanvasNodeGenerationRunActive(generationRun))
  const activeCutoutGeneration = activeGeneration && generationRun?.toolId === "cutout-studio/background.remove"
  const definition = editor.fileRenderers.resolve(props.data)
  const Renderer = definition?.component
  const ContributedToolbar = definition?.toolbar
  const rendererId = definition?.id ?? props.data.kind
  const reportRendererError = useCallback(
    (surface: "content" | "toolbar", error: unknown, info: ErrorInfo) => {
      telemetry?.track({
        name: "canvas.file-renderer.failed",
        properties: {
          componentStack: info.componentStack?.slice(0, 4_096),
          errorType: error instanceof Error ? error.name : typeof error,
          rendererId,
          surface,
        },
      })
    },
    [rendererId, telemetry],
  )
  const selectionActions = showMutationToolbar ? editor.visibleSelectionActions : []
  const hasHostToolbarActions = Boolean(assistantTrigger || selectionActions.length > 0)
  const contributedToolbar = ContributedToolbar ? (
    <FileRendererBoundary
      fallback={null}
      onError={(error, info) => reportRendererError("toolbar", error, info)}
      renderer={ContributedToolbar}
    >
      <ContributedToolbar {...props} />
    </FileRendererBoundary>
  ) : null
  const persistedResourceStatus =
    !generationRun && (props.data.status === "pending" || props.data.status === "error") ? props.data.status : null
  return (
    <>
      <FileAssistantTriggerContext.Provider value={assistantTrigger}>
        <ContributedToolbarFileAssistantTriggerContext.Provider value={Boolean(contributedToolbar && assistantTrigger)}>
          <ContributedToolbarSelectionActionContext.Provider
            value={Boolean(contributedToolbar && selectionActions.length > 0)}
          >
            <FileRendererBoundary
              onError={(error, info) => reportRendererError("content", error, info)}
              renderer={Renderer}
            >
              {Renderer ? <Renderer {...props} /> : <UnknownFileRenderer {...props} />}
            </FileRendererBoundary>
          </ContributedToolbarSelectionActionContext.Provider>
        </ContributedToolbarFileAssistantTriggerContext.Provider>
      </FileAssistantTriggerContext.Provider>
      {persistedResourceStatus ? (
        <PersistedResourceStatusOverlay
          error={props.data.error}
          kind={props.data.kind}
          status={persistedResourceStatus}
        />
      ) : null}
      {ContributedToolbar && showMutationToolbar ? (
        <NodeToolbar
          aria-busy={mutationSurface.disabled || undefined}
          className="convax-node-toolbar nodrag nowheel"
          inert={mutationSurface.disabled || undefined}
          isVisible={showMutationToolbar}
          offset={82}
          position={Position.Top}
        >
          {hasHostToolbarActions ? (
            <div className="convax-node-toolbar__cluster">
              <div className="convax-node-toolbar__surface" data-canvas-shortcuts="ignore">
                {assistantTrigger ? <FileAssistantTriggerButton trigger={assistantTrigger} /> : null}
                {assistantTrigger && selectionActions.length > 0 ? <ToolbarDivider /> : null}
                <NodeSelectionActionButtons actions={selectionActions} />
              </div>
              {contributedToolbar}
            </div>
          ) : (
            contributedToolbar
          )}
        </NodeToolbar>
      ) : null}
      {!persistedResourceStatus &&
      !activeGeneration &&
      (!generationRun || generationRun.status === "succeeded" || generationRun.status === "failed") ? (
        <FileAssistantAccessory
          {...props}
          open={directAssistant || assistantOpen}
          initialGenerationPrompt={generationRun?.prompt}
        />
      ) : null}
      {generationRun && generationRun.status !== "succeeded" && !activeCutoutGeneration ? (
        <FileGenerationActivityOverlay
          kind={props.data.kind}
          onCancel={() => generation?.cancel?.(generationRun.operationId)}
          run={generationRun}
        />
      ) : null}
      {generationRun?.status === "succeeded" ? (
        <div
          className="pointer-events-none absolute right-2 top-2 z-10 rounded-full border bg-card/90 px-2 py-0.5 text-[10px] text-muted-foreground shadow-sm"
          data-canvas-file-generation-activity="succeeded"
          data-canvas-generation-run-tool-id={generationRun.toolId}
        >
          已生成
        </div>
      ) : null}
    </>
  )
}

function UnknownFileRenderer(props: NodeProps<CanvasNode>) {
  return (
    <NodeChrome icon={<File />} label={props.data.label} node={props}>
      <div className="p-4 text-sm text-muted-foreground">No file renderer registered for {props.data.kind}.</div>
    </NodeChrome>
  )
}

export {
  NodeChrome as CanvasNodeChrome,
  ToolbarButton as CanvasNodeToolbarButton,
  ToolbarDivider as CanvasNodeToolbarDivider,
}
