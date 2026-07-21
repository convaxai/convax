import { Button, Tooltip, cn } from "@convax/ui"
import type { Editor, JSONContent } from "@tiptap/core"
import Placeholder from "@tiptap/extension-placeholder"
import { TableKit } from "@tiptap/extension-table"
import TextAlign from "@tiptap/extension-text-align"
import { Markdown } from "@tiptap/markdown"
import { EditorContent, useEditor } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import { Handle, NodeResizer, NodeToolbar, Position, useConnection, type NodeProps } from "@xyflow/react"
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Copy,
  Download,
  Bot,
  File,
  Folder,
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
  Scan,
  Strikethrough,
  Trash2,
  Type,
  Upload,
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
import { useCanvasEditor } from "../editor-context"
import { getCanvasTextFileFormat } from "../file-import"
import { getCanvasNodeGenerationToolId, setCanvasNodeGenerationToolId } from "../generation-preference"
import { fitCanvasMediaNodeToIntrinsicSize } from "../media-sizing"
import type { CanvasSelectionAction } from "../selection-actions"
import { canShowNodeLocalMutationSurface, isSingleNodeSelectionContext } from "../selection-context"
import {
  CanvasFileGenerationActivityOwner,
  useCanvasService,
  type CanvasAssistantGenerationActivity,
  type CanvasFileGenerationActivity,
} from "../services"
import type {
  CanvasFolderNodeData,
  CanvasMediaKind,
  CanvasMediaNodeData,
  CanvasNode,
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
  return props.actions.map((action) => {
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
  })
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
      <div className="convax-node__title flex items-center gap-1.5">
        <span className="flex size-4 items-center justify-center [&>svg]:size-3.5">{props.icon}</span>
        <span className="truncate">{props.label}</span>
        {props.node.data.status === "pending" ? <LoaderCircle className="ml-auto size-3.5 animate-spin" /> : null}
      </div>
      <div className={cn("convax-node__surface size-full overflow-hidden border bg-card", props.className)}>
        {props.children}
      </div>
      {!editor.readOnly ? (
        <>
          <Handle
            aria-expanded={connectMenuSide === "left"}
            aria-label="Connect input on left"
            className="convax-node__connection convax-node__connection--left"
            id={CANVAS_NODE_INPUT_HANDLE_ID}
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              setConnectMenuSide((current) => (current === "left" ? null : "left"))
            }}
            position={Position.Left}
            type="target"
          >
            <span className="convax-node__connection-icon">
              <Plus />
            </span>
          </Handle>
          <Handle
            aria-expanded={connectMenuSide === "right"}
            aria-label="Connect output on right"
            className="convax-node__connection convax-node__connection--right"
            id={CANVAS_NODE_OUTPUT_HANDLE_ID}
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              setConnectMenuSide((current) => (current === "right" ? null : "right"))
            }}
            position={Position.Right}
            type="source"
          >
            <span className="convax-node__connection-icon">
              <Plus />
            </span>
          </Handle>
          {connectMenuSide ? (
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
      ) : null}
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

export function ExpandedTextEditorDialog(props: {
  editor: Editor | null
  label: string
  onClose: () => void
  toolbar: ReactNode
}) {
  const titleId = useId()
  const layer = (
    <div
      className="convax-canvas fixed inset-0 z-[120] grid place-items-center bg-foreground/25 p-4 backdrop-blur-[2px]"
      data-canvas-shortcuts="ignore"
      onKeyDown={(event) => {
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
        className="convax-text-editor-dialog flex h-[calc(100vh-32px)] w-[calc(100vw-32px)] flex-col overflow-hidden rounded-2xl border border-border bg-popover text-popover-foreground shadow-2xl"
        role="dialog"
      >
        <header className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base font-semibold" id={titleId}>
              {props.label}
            </h2>
            <p className="text-xs text-muted-foreground">Expanded text editor</p>
          </div>
          <Button aria-label="Close expanded editor" onClick={props.onClose} size="icon-sm" variant="ghost">
            <X />
          </Button>
        </header>
        <div
          aria-label="Text formatting"
          className="convax-text-editor-dialog__toolbar shrink-0 border-b border-border px-4 py-2"
          role="toolbar"
        >
          <div className="convax-text-editor-dialog__toolbar-inner flex flex-wrap items-center gap-1">
            {props.toolbar}
          </div>
        </div>
        <EditorContent
          className="convax-text-editor convax-text-editor--expanded nodrag nowheel min-h-0 flex-1 overflow-auto"
          data-canvas-shortcuts="ignore"
          editor={props.editor}
        />
      </section>
    </div>
  )
  return typeof document === "undefined" ? layer : createPortal(layer, document.body)
}

export function BuiltinTextFileNode(props: NodeProps<CanvasNode>) {
  const canvasEditor = useCanvasEditor()
  const ownsSingleNodeContext = isSingleNodeSelectionContext(canvasEditor.selectionContext, props.id)
  const data = props.data as CanvasTextNodeData
  const dataRef = useRef(data)
  const canvasEditorRef = useRef(canvasEditor)
  const nodeIdRef = useRef(props.id)
  const appliedFingerprintRef = useRef(textDataFingerprint(data))
  const initialDataRef = useRef(data)
  const initialSourceRef = useRef(textEditorSource(data))
  const [editing, setEditing] = useState(false)
  const [expanded, setExpanded] = useState(false)
  dataRef.current = data
  canvasEditorRef.current = canvasEditor
  nodeIdRef.current = props.id

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
      const current = dataRef.current
      const nextData: CanvasTextNodeData = {
        ...current,
        resourceState: {
          ...(current.resourceState ?? { status: "stale" }),
          text: textEditorValue(current, editor),
        },
      }
      const nextFingerprint = textDataFingerprint(nextData)
      if (nextFingerprint === appliedFingerprintRef.current) return
      dataRef.current = nextData
      appliedFingerprintRef.current = nextFingerprint
      canvasEditorRef.current.commit((document) => updateCanvasNodeData(document, nodeIdRef.current, () => nextData))
    },
  })

  useEffect(() => {
    if (!textEditor) return
    const nextFingerprint = textDataFingerprint(data)
    if (nextFingerprint === appliedFingerprintRef.current) return
    appliedFingerprintRef.current = nextFingerprint
    const source = textEditorSource(data)
    textEditor.commands.setContent(source.content, {
      contentType: source.contentType,
      emitUpdate: false,
    })
  }, [data, textEditor])

  useEffect(() => {
    textEditor?.setEditable(editing && !canvasEditor.readOnly)
  }, [canvasEditor.readOnly, editing, textEditor])

  useEffect(() => {
    if (!editing || (ownsSingleNodeContext && !canvasEditor.readOnly)) return
    textEditor?.setEditable(false)
    setEditing(false)
    setExpanded(false)
    canvasEditor.endGesture()
  }, [canvasEditor, editing, ownsSingleNodeContext, textEditor])

  useEffect(() => {
    if (!expanded || !textEditor) return
    textEditor.setEditable(true)
    textEditor.commands.focus()
  }, [expanded, textEditor])

  const beginEditing = (position: "start" | "end" = "end") => {
    if (!textEditor || canvasEditor.readOnly) return
    if (!editing) {
      initialDataRef.current = dataRef.current
      canvasEditor.beginGesture()
      setEditing(true)
    }
    textEditor.setEditable(true)
    textEditor.commands.focus(position)
  }

  const finishEditing = () => {
    if (!editing) return
    textEditor?.setEditable(false)
    setEditing(false)
    canvasEditor.endGesture()
  }

  const openExpandedEditor = () => {
    if (!textEditor || canvasEditor.readOnly) return
    if (editing) textEditor.setEditable(true)
    else beginEditing("start")
    setExpanded(true)
  }

  const closeExpandedEditor = () => {
    setExpanded(false)
    finishEditing()
  }

  const cancelEditing = () => {
    if (!textEditor || !editing) return
    const initial = initialDataRef.current
    dataRef.current = initial
    appliedFingerprintRef.current = textDataFingerprint(initial)
    const source = textEditorSource(initial)
    textEditor.commands.setContent(source.content, {
      contentType: source.contentType,
      emitUpdate: false,
    })
    textEditor.setEditable(false)
    setEditing(false)
    setExpanded(false)
    canvasEditor.cancelGesture()
  }

  const runTextCommand = (command: (editor: Editor) => void) => {
    if (!textEditor) return
    beginEditing()
    command(textEditor)
  }

  const formattingToolbar = textEditor ? (
    <>
      <div className="convax-node-toolbar__segment" role="group" aria-label="Text style">
        <ToolbarButton
          icon={<Pilcrow />}
          label="Paragraph"
          onClick={() =>
            runTextCommand((editor) => {
              editor.chain().focus().setParagraph().run()
            })
          }
          preserveFocus
          pressed={textEditor.isActive("paragraph")}
        />
        <ToolbarButton
          icon={<Heading1 />}
          label="Heading 1"
          onClick={() =>
            runTextCommand((editor) => {
              editor.chain().focus().toggleHeading({ level: 1 }).run()
            })
          }
          preserveFocus
          pressed={textEditor.isActive("heading", { level: 1 })}
        />
        <ToolbarButton
          icon={<Heading2 />}
          label="Heading 2"
          onClick={() =>
            runTextCommand((editor) => {
              editor.chain().focus().toggleHeading({ level: 2 }).run()
            })
          }
          preserveFocus
          pressed={textEditor.isActive("heading", { level: 2 })}
        />
      </div>
      <ToolbarDivider />
      <ToolbarButton
        icon={<Bold />}
        label="Bold"
        onClick={() =>
          runTextCommand((editor) => {
            editor.chain().focus().toggleBold().run()
          })
        }
        preserveFocus
        pressed={textEditor.isActive("bold")}
      />
      <ToolbarButton
        icon={<Italic />}
        label="Italic"
        onClick={() =>
          runTextCommand((editor) => {
            editor.chain().focus().toggleItalic().run()
          })
        }
        preserveFocus
        pressed={textEditor.isActive("italic")}
      />
      <ToolbarButton
        icon={<Strikethrough />}
        label="Strikethrough"
        onClick={() =>
          runTextCommand((editor) => {
            editor.chain().focus().toggleStrike().run()
          })
        }
        preserveFocus
        pressed={textEditor.isActive("strike")}
      />
      <ToolbarDivider />
      <ToolbarButton
        icon={<List />}
        label="Bullet list"
        onClick={() =>
          runTextCommand((editor) => {
            editor.chain().focus().toggleBulletList().run()
          })
        }
        preserveFocus
        pressed={textEditor.isActive("bulletList")}
      />
      <ToolbarButton
        icon={<ListOrdered />}
        label="Numbered list"
        onClick={() =>
          runTextCommand((editor) => {
            editor.chain().focus().toggleOrderedList().run()
          })
        }
        preserveFocus
        pressed={textEditor.isActive("orderedList")}
      />
      <ToolbarButton
        icon={<Quote />}
        label="Quote"
        onClick={() =>
          runTextCommand((editor) => {
            editor.chain().focus().toggleBlockquote().run()
          })
        }
        preserveFocus
        pressed={textEditor.isActive("blockquote")}
      />
      <ToolbarDivider />
      <ToolbarButton
        icon={<AlignLeft />}
        label="Align left"
        onClick={() =>
          runTextCommand((editor) => {
            editor.chain().focus().setTextAlign("left").run()
          })
        }
        preserveFocus
        pressed={textEditor.isActive({ textAlign: "left" })}
      />
      <ToolbarButton
        icon={<AlignCenter />}
        label="Align center"
        onClick={() =>
          runTextCommand((editor) => {
            editor.chain().focus().setTextAlign("center").run()
          })
        }
        preserveFocus
        pressed={textEditor.isActive({ textAlign: "center" })}
      />
      <ToolbarButton
        icon={<AlignRight />}
        label="Align right"
        onClick={() =>
          runTextCommand((editor) => {
            editor.chain().focus().setTextAlign("right").run()
          })
        }
        preserveFocus
        pressed={textEditor.isActive({ textAlign: "right" })}
      />
    </>
  ) : null

  const textToolbar = textEditor ? (
    <div className="convax-node-toolbar__surface" data-canvas-shortcuts="ignore">
      <ToolbarButton icon={<Maximize2 />} label="Expand editor" onClick={openExpandedEditor} />
      <ToolbarDivider />
      <ToolbarButton
        icon={<Copy />}
        label="Duplicate"
        onClick={() => {
          finishEditing()
          canvasEditor.duplicateNode(props.id)
        }}
      />
      <ToolbarButton
        destructive
        icon={<Trash2 />}
        label="Delete"
        onClick={() => {
          finishEditing()
          canvasEditor.removeNode(props.id)
        }}
      />
    </div>
  ) : null

  return (
    <>
      <NodeChrome icon={<Type />} label={data.label} node={props} toolbar={textToolbar}>
        {expanded ? (
          <div className="convax-text-editor__expanded-placeholder size-full overflow-hidden whitespace-pre-wrap p-4 text-sm text-muted-foreground">
            {data.resourceState?.text ?? ""}
          </div>
        ) : (
          <EditorContent
            className={cn("convax-text-editor size-full overflow-auto", editing && "nodrag nowheel is-editing")}
            data-canvas-shortcuts={editing ? "ignore" : undefined}
            data-text-format={textFileFormat(data)}
            editor={textEditor}
            onDoubleClick={(event) => {
              event.stopPropagation()
              beginEditing()
            }}
            onKeyDown={(event) => {
              if (event.key !== "Escape") return
              event.preventDefault()
              event.stopPropagation()
              cancelEditing()
            }}
          />
        )}
      </NodeChrome>
      {expanded ? (
        <ExpandedTextEditorDialog
          editor={textEditor}
          label={data.label}
          onClose={closeExpandedEditor}
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

function mediaAccept(kind: CanvasMediaKind) {
  if (kind === "image") return "image/*"
  if (kind === "video") return "video/*"
  if (kind === "audio") return "audio/*"
  return undefined
}

function EmptyMedia(props: { kind: CanvasMediaKind }) {
  const label = mediaLabel(props.kind)
  return (
    <div className="convax-media-empty size-full">
      <div className="convax-media-empty__content" aria-hidden="true">
        <span className="convax-media-empty__icon">{mediaIcon(props.kind)}</span>
        <span className="convax-media-empty__title">Empty {label}</span>
        <span className="convax-media-empty__hint">Use the toolbar to add content</span>
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
  const inputRef = useRef<HTMLInputElement>(null)
  const chooseFile = () => {
    editor.selectNodes([props.id])
    inputRef.current?.click()
  }
  const supportsFit = data.kind === "image" || data.kind === "video"
  const toolbar = (
    <div className="convax-node-toolbar__surface" data-canvas-shortcuts="ignore">
      <ToolbarButton
        disabled={!editor.canUpload}
        icon={<Upload />}
        label={url ? `Replace ${mediaLabel(data.kind)}` : `Add ${mediaLabel(data.kind)}`}
        onClick={chooseFile}
      />
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
      <input
        ref={inputRef}
        accept={mediaAccept(data.kind)}
        className="hidden"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0]
          if (file) editor.replaceNodeMedia(props.id, file)
          event.currentTarget.value = ""
        }}
        type="file"
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
  activity: Exclude<CanvasFileGenerationActivity, { status: "idle" }>
  onRecover: () => void
}) {
  if (props.activity.status === "pending") {
    return (
      <div
        aria-busy="true"
        aria-live="polite"
        className="nodrag nowheel pointer-events-none absolute inset-0 z-20 grid place-items-center overflow-hidden rounded-lg border border-primary/25 bg-card/80 backdrop-blur-sm"
        data-canvas-file-generation-activity="pending"
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
      className="nodrag nowheel absolute inset-0 z-20 grid place-items-center overflow-hidden rounded-lg border border-destructive/35 bg-card/90 p-4 text-center backdrop-blur-sm"
      data-canvas-file-generation-activity="error"
      role="alert"
    >
      <div className="flex max-w-full flex-col items-center gap-2">
        <span className="text-sm font-medium text-destructive">生成失败</span>
        <span className="line-clamp-3 max-w-full text-xs text-muted-foreground">{props.activity.message}</span>
        <Button
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
        className="nodrag nowheel pointer-events-none absolute inset-0 z-20 grid place-items-center overflow-hidden rounded-lg border border-primary/25 bg-card/80 backdrop-blur-sm"
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
      className="nodrag nowheel absolute inset-0 z-20 grid place-items-center overflow-hidden rounded-lg border border-destructive/35 bg-card/90 p-4 text-center backdrop-blur-sm"
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
    onGenerationActivityChange: (activity: CanvasAssistantGenerationActivity) => void
    onInitialGenerationPromptConsumed: () => void
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
                    onActivityChange: props.onGenerationActivityChange,
                    onInitialPromptConsumed: props.onInitialGenerationPromptConsumed,
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
  const [generationOwner] = useState(() => new CanvasFileGenerationActivityOwner())
  const [generationActivity, setGenerationActivity] = useState<CanvasFileGenerationActivity>(generationOwner.activity)
  const [recoveryPrompt, setRecoveryPrompt] = useState<string>()
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
  const onGenerationActivityChange = useCallback(
    (activity: CanvasAssistantGenerationActivity) => {
      const transition = generationOwner.apply(activity)
      setGenerationActivity(transition.activity)
      if (transition.dismissComposer) {
        setRecoveryPrompt(undefined)
        setAssistantOpen(false)
        editor.selectNodes([])
      }
    },
    [editor, generationOwner],
  )
  const onInitialGenerationPromptConsumed = useCallback(() => setRecoveryPrompt(undefined), [])
  useEffect(() => () => generationOwner.dispose(), [generationOwner])
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
    props.data.status === "pending" || props.data.status === "error" ? props.data.status : null
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
      {generationActivity.status === "idle" && !persistedResourceStatus ? (
        <FileAssistantAccessory
          {...props}
          initialGenerationPrompt={recoveryPrompt}
          open={visualMediaAssistant || assistantOpen}
          onGenerationActivityChange={onGenerationActivityChange}
          onInitialGenerationPromptConsumed={onInitialGenerationPromptConsumed}
        />
      ) : null}
      {generationActivity.status === "pending" || generationActivity.status === "error" ? (
        <FileGenerationActivityOverlay
          activity={generationActivity}
          onRecover={() => {
            const prompt = generationActivity.status === "error" ? generationActivity.prompt : undefined
            const transition = generationOwner.apply({ status: "complete" })
            setGenerationActivity(transition.activity)
            setRecoveryPrompt(prompt)
            editor.selectNodes([props.id])
          }}
        />
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
