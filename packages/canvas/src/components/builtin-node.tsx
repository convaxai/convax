import { Button, Tooltip, cn } from "@convax/ui"
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
  Copy,
  Bold,
  Code2,
  Download,
  Ellipsis,
  Bot,
  File,
  FileUp,
  Folder,
  GripVertical,
  Heading1,
  Heading2,
  Image as ImageIcon,
  Italic,
  List,
  ListOrdered,
  LoaderCircle,
  Maximize2,
  Music2,
  Pause,
  Pilcrow,
  Play,
  Plus,
  Quote,
  RefreshCw,
  Save,
  Scan,
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
  type DragEvent,
  type ErrorInfo,
  type Ref,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from "react"
import { createPortal } from "react-dom"
import { updateCanvasNodeData } from "../commands"
import {
  CANVAS_NODE_INPUT_HANDLE_ID,
  CANVAS_NODE_OUTPUT_HANDLE_ID,
  getIncomingConnectedCanvasFileNodeIds,
} from "../connections"
import { useCanvasEditor, useCanvasOverlayRoot } from "../editor-context"
import { getCanvasTextFileFormat } from "../file-import"
import { getCanvasNodeGenerationToolId, setCanvasNodeGenerationToolId } from "../generation-preference"
import {
  getCanvasNodeGenerationRun,
  isCanvasNodeGenerationRunActive,
  type CanvasNodeGenerationRun,
} from "../generation-run"
import { fitCanvasMediaNodeToIntrinsicSize } from "../media-sizing"
import { partitionCanvasSelectionActions, type CanvasSelectionAction } from "../selection-actions"
import { canShowNodeLocalMutationSurface, isSingleNodeSelectionContext } from "../selection-context"
import { CanvasTextResourceConflictError, useCanvasService, type CanvasTextResourceService } from "../services"
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
import { FileRendererBoundary } from "./file-renderer-boundary"

function ToolbarButton(props: {
  destructive?: boolean
  disabled?: boolean
  icon?: ReactNode
  label: string
  onClick: () => void
  preserveFocus?: boolean
  pressed?: boolean
  visibleLabel?: boolean
}) {
  return (
    <Tooltip content={props.label} side="top">
      <span className="inline-flex">
        <Button
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
            key={action.id}
            disabled={pending}
            icon={pending ? <LoaderCircle className="animate-spin" /> : (action.icon ?? <Workflow />)}
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
                    <span className="[&>svg]:size-3.5">
                      {pending ? <LoaderCircle className="animate-spin" /> : (action.icon ?? <Workflow />)}
                    </span>
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

function NodeChrome(props: {
  children: ReactNode
  className?: string
  icon: ReactNode
  label: string
  node: NodeProps<CanvasNode>
  nodeRef?: Ref<HTMLDivElement>
  toolbar?: ReactNode
}) {
  const editor = useCanvasEditor()
  const ownsSingleNodeContext = isSingleNodeSelectionContext(editor.selectionContext, props.node.id)
  const showMutationToolbar = canShowNodeLocalMutationSurface(editor.selectionContext, props.node.id, editor.readOnly)
  const selectionActionsHandledByContribution = useContext(ContributedToolbarSelectionActionContext)
  const assistantTrigger = useContext(FileAssistantTriggerContext)
  const assistantTriggerHandledByContribution = useContext(ContributedToolbarFileAssistantTriggerContext)
  const selectionActions =
    ownsSingleNodeContext && !selectionActionsHandledByContribution ? editor.visibleSelectionActions : []
  let toolbar = mergeNodeToolbarSelectionActions(props.toolbar, selectionActions)
  if (ownsSingleNodeContext && assistantTrigger && !assistantTriggerHandledByContribution) {
    toolbar = prependNodeToolbarContent(toolbar, <FileAssistantTriggerButton trigger={assistantTrigger} />)
  }
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
    <div
      className={cn(
        "convax-node group relative size-full text-card-foreground",
        ownsSingleNodeContext && "is-selected",
      )}
      data-canvas-node-kind={props.node.data.kind}
      data-canvas-node-status={props.node.data.status ?? "idle"}
      ref={props.nodeRef}
      tabIndex={props.nodeRef ? -1 : undefined}
    >
      <NodeResizer
        color="var(--ring)"
        handleClassName="convax-node-resizer__handle"
        isVisible={ownsSingleNodeContext && !editor.readOnly}
        lineClassName="convax-node-resizer__line"
        minWidth={160}
        minHeight={96}
        onResizeStart={editor.beginGesture}
        onResizeEnd={editor.endGesture}
      />
      {toolbar && showMutationToolbar ? (
        <NodeToolbar className="convax-node-toolbar nodrag nowheel" offset={36} position={Position.Top}>
          {toolbar}
        </NodeToolbar>
      ) : null}
      <div className="convax-node__title flex items-center gap-1.5" data-canvas-node-drag-handle="true">
        <span className="flex size-4 items-center justify-center [&>svg]:size-3.5">{props.icon}</span>
        <span className="truncate">{props.label}</span>
        {props.node.data.status === "pending" ? <LoaderCircle className="ml-auto size-3.5 animate-spin" /> : null}
      </div>
      <div className={cn("convax-node__surface size-full overflow-hidden border bg-card", props.className)}>
        {props.children}
      </div>
      <>
        <Handle
          aria-disabled={editor.readOnly}
          aria-expanded={!editor.readOnly && connectMenuSide === "left"}
          aria-label="Connect input on left"
          className="convax-node__connection convax-node__connection--left"
          id={CANVAS_NODE_INPUT_HANDLE_ID}
          isConnectable={!editor.readOnly}
          onClick={
            editor.readOnly
              ? undefined
              : (event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  setConnectMenuSide((current) => (current === "left" ? null : "left"))
                }
          }
          position={Position.Left}
          style={editor.readOnly ? { opacity: 0, pointerEvents: "none" } : undefined}
          type="target"
        >
          {!editor.readOnly ? (
            <span className="convax-node__connection-icon">
              <Plus />
            </span>
          ) : null}
        </Handle>
        <Handle
          aria-disabled={editor.readOnly}
          aria-expanded={!editor.readOnly && connectMenuSide === "right"}
          aria-label="Connect output on right"
          className="convax-node__connection convax-node__connection--right"
          id={CANVAS_NODE_OUTPUT_HANDLE_ID}
          isConnectable={!editor.readOnly}
          onClick={
            editor.readOnly
              ? undefined
              : (event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  setConnectMenuSide((current) => (current === "right" ? null : "right"))
                }
          }
          position={Position.Right}
          style={editor.readOnly ? { opacity: 0, pointerEvents: "none" } : undefined}
          type="source"
        >
          {!editor.readOnly ? (
            <span className="convax-node__connection-icon">
              <Plus />
            </span>
          ) : null}
        </Handle>
        {!editor.readOnly && connectMenuSide ? (
          <NodeToolbar
            className="convax-connect-menu-positioner nodrag nowheel"
            isVisible
            offset={50}
            position={connectMenuSide === "left" ? Position.Left : Position.Right}
          >
            <ConnectionNodeMenu
              items={editor.connectionNodeTypes}
              onSelect={(type) => {
                editor.quickConnect(props.node.id, connectMenuSide, type)
                setConnectMenuSide(null)
              }}
            />
          </NodeToolbar>
        ) : null}
      </>
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

function createTextEditorExtensions() {
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
    <div className="group/text-editor relative min-h-0 flex-1 overflow-hidden" ref={surfaceRef}>
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
        className="convax-text-editor convax-text-editor--expanded nodrag nowheel size-full overflow-auto"
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
  label: string
  onClose: () => void
  onSave?: () => void
  error?: string | null
  discardLabel?: string
  onDiscard?: () => void
  onReload?: () => void
  reloading?: boolean
  saving?: boolean
  toolbar?: ReactNode
}) {
  const titleId = useId()
  const overlayRoot = useCanvasOverlayRoot()
  const layer = (
    <div
      className="convax-text-editor-dialog-layer absolute inset-0 z-[120] grid place-items-center bg-foreground/25 p-4 backdrop-blur-[2px]"
      data-canvas-shortcuts="ignore"
      onKeyDown={(event) => {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
          event.preventDefault()
          props.onSave?.()
          return
        }
        if (event.key !== "Escape") return
        event.preventDefault()
        event.stopPropagation()
        props.onClose()
      }}
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) props.onClose()
      }}
      role="presentation"
    >
      <section
        aria-labelledby={titleId}
        aria-modal="true"
        className="convax-text-editor-dialog relative flex size-full min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl border border-border bg-surface-panel text-foreground shadow-[var(--ui-shadow-high)]"
        role="dialog"
      >
        <header className="flex shrink-0 items-center gap-3 border-b border-border bg-surface-raised/95 px-4 py-3">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base font-semibold" id={titleId}>
              {props.label}
            </h2>
            <p className="text-xs text-muted-foreground">Expanded text editor</p>
          </div>
          <Button
            aria-label={props.saving ? "Saving text" : "Close expanded editor"}
            disabled={props.saving}
            onClick={props.onClose}
            size="icon-sm"
            variant="ghost"
          >
            <X />
          </Button>
        </header>
        {props.error ? (
          <div
            className="flex shrink-0 items-center gap-2 border-b border-border bg-surface-raised/95 px-4 py-2 text-xs"
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
        {props.toolbar ? (
          <div
            aria-label="Text formatting"
            className="convax-text-editor-dialog__toolbar shrink-0 overflow-x-auto border-b border-border bg-surface-raised/95 px-4 py-2"
            role="toolbar"
          >
            <div className="convax-text-editor-dialog__toolbar-inner">{props.toolbar}</div>
          </div>
        ) : null}
        <TextEditorContextMenus editor={props.editor} />
      </section>
    </div>
  )
  if (typeof document === "undefined") return layer
  return overlayRoot ? createPortal(layer, overlayRoot) : layer
}

/** @deprecated Use ExpandedTextEditorDialog. */
export const TextEditorDrawer = ExpandedTextEditorDialog

export function BuiltinTextFileNode(props: NodeProps<CanvasNode>) {
  const canvasEditor = useCanvasEditor()
  const textResources = useCanvasService("textResources")
  const ownsSingleNodeContext = isSingleNodeSelectionContext(canvasEditor.selectionContext, props.id)
  const data = props.data as CanvasTextNodeData
  const dataRef = useRef(data)
  const appliedFingerprintRef = useRef(textDataFingerprint(data))
  const initialSourceRef = useRef(textEditorSource(data))
  const [editing, setEditing] = useState(false)
  const [expandedOpen, setExpandedOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [reloading, setReloading] = useState(false)
  const [savingEditableCopy, setSavingEditableCopy] = useState(false)
  const [draft, setDraft] = useState(() => createCanvasTextDraftState(data.resourceState ?? {}))
  const draftRef = useRef(draft)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const nodeFocusRef = useRef<HTMLDivElement>(null)
  const discardAfterReloadRef = useRef(false)
  const mountedRef = useRef(true)
  const saveControllerRef = useRef<AbortController | null>(null)
  const saveGenerationRef = useRef(0)
  const saveQueueRef = useRef(createCanvasTextDraftSaveQueue())
  dataRef.current = data
  draftRef.current = draft
  const editableResource = isCanvasTextResourceEditable(data.resourceState)

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
    extensions: createTextEditorExtensions(),
    shouldRerenderOnTransaction: true,
    onUpdate: ({ editor }) => {
      const next = updateCanvasTextDraft(draftRef.current, textEditorValue(dataRef.current, editor))
      draftRef.current = next
      setDraft(next)
    },
  })

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

  const beginEditing = (position: "start" | "end" = "end") => {
    if (!textEditor || canvasEditor.readOnly || !editableResource || saving) return
    if (!editing) setEditing(true)
    textEditor.setEditable(true)
    textEditor.commands.focus(position)
  }

  const openExpandedEditor = (invoker?: HTMLElement) => {
    if (!textEditor || canvasEditor.readOnly || !editableResource || saving) return
    returnFocusRef.current =
      nodeFocusRef.current ??
      invoker ??
      (typeof document !== "undefined" && document.activeElement instanceof HTMLElement ? document.activeElement : null)
    if (editing) textEditor.setEditable(true)
    else beginEditing("start")
    setExpandedOpen(true)
  }

  const closeExpandedEditor = useCallback(() => {
    setExpandedOpen(false)
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
    closeExpandedEditor()
  }, [closeExpandedEditor, textEditor])

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
          canvasEditor.replaceResourceState(props.id, resourceState)
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
          if (editing) textEditor?.setEditable(true)
          throw error
        } finally {
          if (mountedRef.current && generation === saveGenerationRef.current) {
            saveControllerRef.current = null
            setSaving(false)
          }
        }
      }),
    [canvasEditor, editing, expandedOpen, props.id, textEditor, textResources],
  )

  const closeAndSaveTextEditor = useCallback(() => {
    if (!draftRef.current.dirty) {
      closeExpandedEditor()
      return
    }
    void saveDraft()
      .then(() => closeExpandedEditor())
      .catch(() => {
        textEditor?.setEditable(true)
        textEditor?.commands.focus()
      })
  }, [closeExpandedEditor, saveDraft, textEditor])

  useEffect(() => {
    if (!expandedOpen || (ownsSingleNodeContext && !canvasEditor.readOnly && editableResource)) return
    closeAndSaveTextEditor()
  }, [canvasEditor.readOnly, closeAndSaveTextEditor, editableResource, expandedOpen, ownsSingleNodeContext])

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

  const runTextCommand = (command: (editor: Editor) => void) => {
    if (!textEditor || !editableResource || saving) return
    beginEditing()
    command(textEditor)
  }

  const formattingToolbar =
    textEditor && editableResource ? (
      <CanvasTextFormattingToolbar disabled={saving} editor={textEditor} onCommand={runTextCommand} />
    ) : null

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
          icon={savingEditableCopy ? <LoaderCircle className="animate-spin" /> : <Save />}
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
          label={data.label}
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
          reloading={reloading}
          saving={saving}
          toolbar={formattingToolbar}
        />
      ) : null}
    </>
  )
}

function VideoBody(props: {
  data: CanvasMediaNodeData
  fit: "contain" | "cover"
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
        className={cn("convax-video__media size-full", props.fit === "cover" ? "object-cover" : "object-contain")}
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

function EmptyMedia(props: { kind: CanvasMediaKind }) {
  const label = mediaLabel(props.kind)
  return (
    <div className="convax-media-empty size-full">
      <div className="convax-media-empty__action">
        <span className="convax-media-empty__icon">{mediaIcon(props.kind)}</span>
        <span className="convax-media-empty__title">{label} unavailable</span>
        <span className="convax-media-empty__hint">Relink a selected Project resource or choose a local file</span>
      </div>
    </div>
  )
}

function MediaBody(props: {
  data: CanvasMediaNodeData
  onMediaLoad?: (size: { height: number; width: number }) => void
  selected: boolean
}) {
  const fit = props.data.fit ?? "contain"
  const url = props.data.resourceState?.url ?? ""
  if (!url.trim()) {
    return <EmptyMedia kind={props.data.kind} />
  }
  if (props.data.kind === "image") {
    return (
      <img
        alt={props.data.label}
        className={cn("size-full", fit === "cover" ? "object-cover" : "object-contain")}
        decoding="async"
        draggable={false}
        loading="lazy"
        onLoad={(event) => {
          props.onMediaLoad?.({
            height: event.currentTarget.naturalHeight,
            width: event.currentTarget.naturalWidth,
          })
        }}
        src={url}
      />
    )
  }
  if (props.data.kind === "video") {
    return <VideoBody data={props.data} fit={fit} onMediaLoad={props.onMediaLoad} selected={props.selected} />
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

export function BuiltinMediaFileNode(props: NodeProps<CanvasNode>) {
  const editor = useCanvasEditor()
  const data = props.data as CanvasMediaNodeData
  const url = data.resourceState?.url
  const supportsFit = data.kind === "image" || data.kind === "video"
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
      {supportsFit ? (
        <ToolbarButton
          disabled={!url}
          icon={<Scan />}
          label={data.fit === "cover" ? "Fit inside frame" : "Fill frame"}
          onClick={() =>
            editor.commit((document) =>
              updateCanvasNodeData(document, props.id, (current) => ({
                ...current,
                fit: data.fit === "cover" ? "contain" : "cover",
              })),
            )
          }
          pressed={data.fit === "cover"}
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
    <NodeChrome
      className={supportsFit ? "convax-node__surface--media" : undefined}
      icon={mediaIcon(data.kind)}
      label={data.label}
      node={props}
      toolbar={toolbar}
    >
      <MediaBody
        data={data}
        onMediaLoad={
          supportsFit
            ? (size) => {
                editor.commit((document) =>
                  fitCanvasMediaNodeToIntrinsicSize(document, {
                    ...size,
                    nodeId: props.id,
                    sourceUrl: url ?? "",
                  }),
                )
              }
            : undefined
        }
        selected={props.selected}
      />
    </NodeChrome>
  )
}

function GroupNode(props: NodeProps<CanvasNode>) {
  const editor = useCanvasEditor()
  return (
    <div
      data-canvas-group
      className={cn(
        "relative size-full rounded-lg border border-dashed bg-muted/20",
        props.selected ? "border-ring ring-2 ring-ring/20" : "border-border",
      )}
    >
      <NodeResizer
        color="var(--ring)"
        handleClassName="convax-node-resizer__handle"
        isVisible={props.selected && !editor.readOnly}
        lineClassName="convax-node-resizer__line"
        minWidth={240}
        minHeight={180}
        onResizeStart={editor.beginGesture}
        onResizeEnd={editor.endGesture}
      />
      <div className="pointer-events-none absolute left-3 top-2 text-xs font-medium text-muted-foreground">
        {props.data.label}
      </div>
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
    <NodeChrome icon={<Folder />} label={data.label} node={props} toolbar={toolbar}>
      <div className="flex size-full flex-col items-center justify-center gap-3 bg-muted/25 p-5 text-center">
        <Folder className="size-10 text-primary/75" />
        <div className="max-w-full">
          <div className="truncate text-sm font-medium">{data.name ?? data.label}</div>
        </div>
      </div>
    </NodeChrome>
  )
}

function FileGenerationActivityOverlay(props: {
  onCancel: () => void
  onRecover: () => void
  run: CanvasNodeGenerationRun
}) {
  if (isCanvasNodeGenerationRunActive(props.run)) {
    return (
      <div
        aria-busy="true"
        aria-live="polite"
        className="absolute inset-0 z-20 grid place-items-center overflow-hidden rounded-lg border border-primary/25 bg-card/85 p-4 text-center backdrop-blur-sm"
        data-canvas-file-generation-activity={props.run.status}
        data-canvas-generation-run-tool-id={props.run.toolId}
        role="status"
      >
        <div className="flex flex-col items-center gap-2 text-sm font-medium text-foreground">
          <LoaderCircle className="size-6 animate-spin text-primary motion-reduce:animate-none" />
          <span>{props.run.status === "submitting" ? "正在提交…" : "正在生成…"}</span>
          <span className="max-w-full truncate text-[11px] font-normal text-muted-foreground">{props.run.toolId}</span>
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
  const title =
    props.run.status === "failed" ? "生成失败" : props.run.status === "cancelled" ? "生成已取消" : "生成已中断"
  const retryIsSafe = props.run.retrySafety === "safe"
  return (
    <div
      className="absolute inset-0 z-20 grid place-items-center overflow-hidden rounded-lg border border-destructive/35 bg-card/90 p-4 text-center backdrop-blur-sm"
      data-canvas-file-generation-activity={props.run.status}
      data-canvas-generation-run-tool-id={props.run.toolId}
      role="alert"
    >
      <div className="flex max-w-full flex-col items-center gap-2">
        <span className="text-sm font-medium text-destructive">{title}</span>
        <span className="max-w-full truncate text-[11px] text-muted-foreground">{props.run.toolId}</span>
        {retryIsSafe ? (
          <Button
            className="nodrag nowheel"
            onClick={(event) => {
              event.stopPropagation()
              props.onRecover()
            }}
            onPointerDown={(event) => event.stopPropagation()}
            size="sm"
            type="button"
            variant="outline"
          >
            修改并重试
          </Button>
        ) : (
          <>
            <span className="max-w-64 text-[11px] leading-4 text-muted-foreground">
              外部任务结果未知，此卡片已锁定以避免重复计费。切换 Agent
              默认模型不会改变该任务；如需重试，请新建同类型卡片（新任务可能另行计费）。
            </span>
            <span
              className="nodrag nowheel"
              data-canvas-generation-retry-blocked="true"
              onPointerDown={(event) => event.stopPropagation()}
            >
              <Button disabled size="sm" type="button" variant="outline">
                本卡片不可重试
              </Button>
            </span>
          </>
        )}
      </div>
    </div>
  )
}

function PersistedResourceStatusOverlay(props: { error?: string; status: "error" | "pending" }) {
  if (props.status === "pending") {
    return (
      <div
        aria-busy="true"
        aria-live="polite"
        className="pointer-events-none absolute inset-0 z-20 grid place-items-center overflow-hidden rounded-lg border border-primary/25 bg-card/80 backdrop-blur-sm"
        data-canvas-persisted-resource-status="pending"
        role="status"
      >
        <div className="flex flex-col items-center gap-2 text-sm font-medium text-foreground">
          <LoaderCircle className="size-6 animate-spin text-primary motion-reduce:animate-none" />
          <span>正在生成…</span>
        </div>
      </div>
    )
  }
  return (
    <div
      className="absolute inset-0 z-20 grid place-items-center overflow-hidden rounded-lg border border-destructive/35 bg-card/90 p-4 text-center backdrop-blur-sm"
      data-canvas-persisted-resource-status="error"
      role="alert"
    >
      <div className="flex max-w-full flex-col items-center gap-2">
        <span className="text-sm font-medium text-destructive">生成失败</span>
        <span className="line-clamp-3 max-w-full text-xs text-muted-foreground">
          {props.error ?? "Resource could not be created"}
        </span>
      </div>
    </div>
  )
}

function FileAssistantAccessory(
  props: NodeProps<CanvasNode> & {
    initialGenerationPrompt?: string
    open: boolean
  },
) {
  const editor = useCanvasEditor()
  const assistant = useCanvasService("assistant")
  const ownsSingleNodeContext = isSingleNodeSelectionContext(editor.selectionContext, props.id)
  const ownerNode = editor.document.nodes.find((node) => node.id === props.id)
  const generationOutput = props.data.kind === "image" || props.data.kind === "video" ? props.data.kind : undefined
  const mentionedNodeIds = getIncomingConnectedCanvasFileNodeIds(editor.document, props.id)
  if (!props.open || !assistant || !ownsSingleNodeContext || (editor.readOnly && !editor.hydrating)) return null
  return (
    <NodeToolbar className="convax-node-assistant nodrag nowheel" offset={28} position={Position.Bottom}>
      <div data-canvas-shortcuts="ignore">
        <fieldset
          aria-busy={editor.hydrating || undefined}
          className="m-0 size-full min-w-0 border-0 p-0"
          disabled={editor.readOnly}
          inert={editor.readOnly || undefined}
        >
          {assistant.render({
            document: editor.document,
            ...(generationOutput
              ? {
                  generation: {
                    ...(props.initialGenerationPrompt === undefined
                      ? {}
                      : { initialPrompt: props.initialGenerationPrompt }),
                    onOwnerToolIdChange: (toolId?: string) => {
                      editor.commit((document) => setCanvasNodeGenerationToolId(document, props.id, toolId))
                    },
                    output: generationOutput,
                    ownerToolId: ownerNode ? getCanvasNodeGenerationToolId(ownerNode) : undefined,
                  },
                }
              : {}),
            mentionedNodeIds,
            mode: "file",
            ownerNodeId: props.id,
          })}
        </fieldset>
      </div>
    </NodeToolbar>
  )
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
          {preparing ? <LoaderCircle className="size-3 animate-spin" /> : source?.icon}
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
  const assistant = useCanvasService("assistant")
  const telemetry = useCanvasService("telemetry")
  const [assistantOpen, setAssistantOpen] = useState(false)
  const ownsSingleNodeContext = isSingleNodeSelectionContext(editor.selectionContext, props.id)
  const visualMediaAssistant = props.data.kind === "image" || props.data.kind === "video"
  const showMutationToolbar = canShowNodeLocalMutationSurface(editor.selectionContext, props.id, editor.readOnly)
  useEffect(() => {
    if (ownsSingleNodeContext && !editor.readOnly && assistant) return
    setAssistantOpen(false)
  }, [assistant, editor.readOnly, ownsSingleNodeContext])
  const assistantTrigger: FileAssistantTrigger | null =
    assistant && !visualMediaAssistant && showMutationToolbar
      ? {
          open: assistantOpen,
          toggle: () => setAssistantOpen((current) => !current),
        }
      : null
  const generation = useCanvasService("generate")
  const ownerNode = editor.document.nodes.find((node) => node.id === props.id)
  const generationRun = ownerNode ? getCanvasNodeGenerationRun(ownerNode) : undefined
  const [dismissedTerminalOperationId, setDismissedTerminalOperationId] = useState<string>()
  const activeGeneration = Boolean(generationRun && isCanvasNodeGenerationRunActive(generationRun))
  const dismissedTerminal = Boolean(
    generationRun &&
      !activeGeneration &&
      generationRun.status !== "succeeded" &&
      dismissedTerminalOperationId === generationRun.operationId,
  )
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
        <PersistedResourceStatusOverlay error={props.data.error} status={persistedResourceStatus} />
      ) : null}
      {ContributedToolbar && showMutationToolbar ? (
        <NodeToolbar className="convax-node-toolbar nodrag nowheel" offset={82} position={Position.Top}>
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
      (!generationRun || generationRun.status === "succeeded" || dismissedTerminal) ? (
        <FileAssistantAccessory
          {...props}
          open={visualMediaAssistant || assistantOpen}
          initialGenerationPrompt={
            generationRun?.status === "succeeded" || dismissedTerminal ? generationRun?.prompt : undefined
          }
        />
      ) : null}
      {generationRun && generationRun.status !== "succeeded" && !dismissedTerminal ? (
        <FileGenerationActivityOverlay
          onCancel={() => generation?.cancel?.(generationRun.operationId)}
          onRecover={() => {
            setDismissedTerminalOperationId(generationRun.operationId)
            editor.selectNodes([props.id])
          }}
          run={generationRun}
        />
      ) : null}
      {generationRun?.status === "succeeded" ? (
        <div
          className="pointer-events-none absolute right-2 top-2 z-10 rounded-full border bg-card/90 px-2 py-0.5 text-[10px] text-muted-foreground shadow-sm"
          data-canvas-file-generation-activity="succeeded"
          data-canvas-generation-run-tool-id={generationRun.toolId}
          title={`Generated with ${generationRun.toolId}`}
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
