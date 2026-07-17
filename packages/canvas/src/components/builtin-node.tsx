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
  Music2,
  Pause,
  Pencil,
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
} from "lucide-react"
import { Component, type ReactNode, useEffect, useRef, useState } from "react"
import { updateCanvasNodeData } from "../commands"
import { getConnectedCanvasFileNodeIds } from "../connections"
import { useCanvasEditor } from "../editor-context"
import { canShowNodeLocalMutationSurface, isSingleNodeSelectionContext } from "../selection-context"
import { useCanvasService } from "../services"
import type {
  CanvasFolderNodeData,
  CanvasMediaKind,
  CanvasMediaNodeData,
  CanvasNode,
  CanvasRichTextContent,
  CanvasTextNodeData,
} from "../types"
import { ConnectionNodeMenu } from "./connection-node-menu"

function ToolbarButton(props: {
  destructive?: boolean
  disabled?: boolean
  icon: ReactNode
  label: string
  onClick: () => void
  preserveFocus?: boolean
  pressed?: boolean
}) {
  return (
    <Tooltip content={props.label} side="top">
      <span className="inline-flex">
        <Button
          aria-label={props.label}
          aria-pressed={props.pressed}
          className={cn(
            "convax-node-toolbar__button",
            props.pressed && "bg-accent text-accent-foreground",
            props.destructive && "text-destructive hover:text-destructive",
          )}
          disabled={props.disabled}
          onClick={props.onClick}
          onPointerDown={(event) => {
            event.stopPropagation()
            if (props.preserveFocus) event.preventDefault()
          }}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          {props.icon}
        </Button>
      </span>
    </Tooltip>
  )
}

function ToolbarDivider() {
  return <span aria-hidden className="convax-node-toolbar__divider" />
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
  const showMutationToolbar = canShowNodeLocalMutationSurface(
    editor.selectionContext,
    props.node.id,
    editor.readOnly,
  )
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
        props.node.selected && "is-selected",
      )}
    >
      <NodeResizer
        color="var(--ring)"
        handleClassName="convax-node-resizer__handle"
        isVisible={props.node.selected && !editor.readOnly}
        lineClassName="convax-node-resizer__line"
        minWidth={160}
        minHeight={96}
        onResizeStart={editor.beginGesture}
        onResizeEnd={editor.endGesture}
      />
      {props.toolbar && showMutationToolbar ? (
        <NodeToolbar className="convax-node-toolbar nodrag nowheel" offset={36} position={Position.Top}>
          {props.toolbar}
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
            aria-label="Connect on left"
            className="convax-node__connection convax-node__connection--left"
            id="target-left"
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              setConnectMenuSide((current) => current === "left" ? null : "left")
            }}
            position={Position.Left}
            type="target"
          >
            <span className="convax-node__connection-icon"><Plus /></span>
          </Handle>
          <Handle
            aria-expanded={connectMenuSide === "right"}
            aria-label="Connect on right"
            className="convax-node__connection convax-node__connection--right"
            id="source-right"
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              setConnectMenuSide((current) => current === "right" ? null : "right")
            }}
            position={Position.Right}
            type="source"
          >
            <span className="convax-node__connection-icon"><Plus /></span>
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
    content: text.replace(/\r\n/g, "\n").split("\n").map((line) => ({
      type: "paragraph",
      ...(line ? { content: [{ type: "text", text: line }] } : {}),
    })),
  }
}

function textEditorSource(data: CanvasTextNodeData): { content: JSONContent | string; contentType: "json" | "markdown" } {
  if (data.richText?.type === "doc") {
    return { content: data.richText as JSONContent, contentType: "json" }
  }
  if (data.format === "markdown") return { content: data.text, contentType: "markdown" }
  return { content: plainTextDocument(data.text), contentType: "json" }
}

function textDataFingerprint(data: CanvasTextNodeData) {
  return `${data.format ?? "plain"}\u0000${data.text}\u0000${JSON.stringify(data.richText ?? null)}`
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
        format: "markdown",
        richText: editor.getJSON() as CanvasRichTextContent,
        text: editor.getMarkdown(),
      }
      const nextFingerprint = textDataFingerprint(nextData)
      if (nextFingerprint === appliedFingerprintRef.current) return
      dataRef.current = nextData
      appliedFingerprintRef.current = nextFingerprint
      canvasEditorRef.current.commit((document) =>
        updateCanvasNodeData(document, nodeIdRef.current, () => nextData),
      )
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
    canvasEditor.endGesture()
  }, [canvasEditor, editing, ownsSingleNodeContext, textEditor])

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
    canvasEditor.cancelGesture()
  }

  const runTextCommand = (command: (editor: Editor) => void) => {
    if (!textEditor) return
    beginEditing()
    command(textEditor)
  }

  const textToolbar = textEditor ? (
    <div className="convax-node-toolbar__surface" data-canvas-shortcuts="ignore">
      <ToolbarButton
        icon={<Pencil />}
        label={editing ? "Finish editing" : "Edit text"}
        onClick={() => editing ? finishEditing() : beginEditing()}
        pressed={editing}
      />
      <ToolbarDivider />
      <div className="convax-node-toolbar__segment" role="group" aria-label="Text style">
        <ToolbarButton
          icon={<Pilcrow />}
          label="Paragraph"
          onClick={() => runTextCommand((editor) => { editor.chain().focus().setParagraph().run() })}
          preserveFocus
          pressed={textEditor.isActive("paragraph")}
        />
        <ToolbarButton
          icon={<Heading1 />}
          label="Heading 1"
          onClick={() => runTextCommand((editor) => { editor.chain().focus().toggleHeading({ level: 1 }).run() })}
          preserveFocus
          pressed={textEditor.isActive("heading", { level: 1 })}
        />
        <ToolbarButton
          icon={<Heading2 />}
          label="Heading 2"
          onClick={() => runTextCommand((editor) => { editor.chain().focus().toggleHeading({ level: 2 }).run() })}
          preserveFocus
          pressed={textEditor.isActive("heading", { level: 2 })}
        />
      </div>
      <ToolbarDivider />
      <ToolbarButton
        icon={<Bold />}
        label="Bold"
        onClick={() => runTextCommand((editor) => { editor.chain().focus().toggleBold().run() })}
        preserveFocus
        pressed={textEditor.isActive("bold")}
      />
      <ToolbarButton
        icon={<Italic />}
        label="Italic"
        onClick={() => runTextCommand((editor) => { editor.chain().focus().toggleItalic().run() })}
        preserveFocus
        pressed={textEditor.isActive("italic")}
      />
      <ToolbarButton
        icon={<Strikethrough />}
        label="Strikethrough"
        onClick={() => runTextCommand((editor) => { editor.chain().focus().toggleStrike().run() })}
        preserveFocus
        pressed={textEditor.isActive("strike")}
      />
      <ToolbarDivider />
      <ToolbarButton
        icon={<List />}
        label="Bullet list"
        onClick={() => runTextCommand((editor) => { editor.chain().focus().toggleBulletList().run() })}
        preserveFocus
        pressed={textEditor.isActive("bulletList")}
      />
      <ToolbarButton
        icon={<ListOrdered />}
        label="Numbered list"
        onClick={() => runTextCommand((editor) => { editor.chain().focus().toggleOrderedList().run() })}
        preserveFocus
        pressed={textEditor.isActive("orderedList")}
      />
      <ToolbarButton
        icon={<Quote />}
        label="Quote"
        onClick={() => runTextCommand((editor) => { editor.chain().focus().toggleBlockquote().run() })}
        preserveFocus
        pressed={textEditor.isActive("blockquote")}
      />
      <ToolbarDivider />
      <ToolbarButton
        icon={<AlignLeft />}
        label="Align left"
        onClick={() => runTextCommand((editor) => { editor.chain().focus().setTextAlign("left").run() })}
        preserveFocus
        pressed={textEditor.isActive({ textAlign: "left" })}
      />
      <ToolbarButton
        icon={<AlignCenter />}
        label="Align center"
        onClick={() => runTextCommand((editor) => { editor.chain().focus().setTextAlign("center").run() })}
        preserveFocus
        pressed={textEditor.isActive({ textAlign: "center" })}
      />
      <ToolbarButton
        icon={<AlignRight />}
        label="Align right"
        onClick={() => runTextCommand((editor) => { editor.chain().focus().setTextAlign("right").run() })}
        preserveFocus
        pressed={textEditor.isActive({ textAlign: "right" })}
      />
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
    <NodeChrome icon={<Type />} label={data.label} node={props} toolbar={textToolbar}>
      <EditorContent
        className={cn("convax-text-editor size-full overflow-auto", editing && "nodrag nowheel is-editing")}
        data-canvas-shortcuts={editing ? "ignore" : undefined}
        data-text-format={data.format ?? "plain"}
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
    </NodeChrome>
  )
}

function VideoBody(props: { data: CanvasMediaNodeData; fit: "contain" | "cover"; selected: boolean }) {
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
  }, [props.data.url])

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
        loop
        muted={muted}
        onPause={() => setPlaying(false)}
        onPlay={() => setPlaying(true)}
        playsInline
        poster={props.data.posterUrl}
        preload="metadata"
        src={props.data.url}
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

function EmptyMedia(props: { canUpload: boolean; kind: CanvasMediaKind; onPick: () => void }) {
  const label = mediaLabel(props.kind)
  return (
    <div className="convax-media-empty size-full">
      <button
        className="convax-media-empty__action nodrag nowheel"
        disabled={!props.canUpload}
        onClick={(event) => {
          event.stopPropagation()
          props.onPick()
        }}
        onPointerDown={(event) => event.stopPropagation()}
        type="button"
      >
        <span className="convax-media-empty__icon">{mediaIcon(props.kind)}</span>
        <span className="convax-media-empty__title">Add {label}</span>
        <span className="convax-media-empty__hint">Choose a {label} file</span>
      </button>
    </div>
  )
}

function MediaBody(props: {
  canUpload: boolean
  data: CanvasMediaNodeData
  onPick: () => void
  selected: boolean
}) {
  const fit = props.data.fit ?? "contain"
  if (!props.data.url.trim()) {
    return <EmptyMedia canUpload={props.canUpload} kind={props.data.kind} onPick={props.onPick} />
  }
  if (props.data.kind === "image") {
    return (
      <img
        alt={props.data.label}
        className={cn("size-full", fit === "cover" ? "object-cover" : "object-contain")}
        decoding="async"
        draggable={false}
        loading="lazy"
        src={props.data.url}
      />
    )
  }
  if (props.data.kind === "video") {
    return <VideoBody data={props.data} fit={fit} selected={props.selected} />
  }
  if (props.data.kind === "audio") {
    return (
      <div className="flex size-full flex-col items-center justify-center gap-4 p-5">
        <Music2 className="size-8 text-muted-foreground" />
        <audio className="nodrag nowheel w-full" controls preload="metadata" src={props.data.url} />
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
  if (!data.url) return
  const anchor = document.createElement("a")
  anchor.href = data.url
  anchor.download = data.name ?? data.label
  anchor.rel = "noopener"
  anchor.click()
}

export function BuiltinMediaFileNode(props: NodeProps<CanvasNode>) {
  const editor = useCanvasEditor()
  const data = props.data as CanvasMediaNodeData
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
        label={data.url ? `Replace ${mediaLabel(data.kind)}` : `Add ${mediaLabel(data.kind)}`}
        onClick={chooseFile}
      />
      {supportsFit ? (
        <ToolbarButton
          disabled={!data.url}
          icon={<Scan />}
          label={data.fit === "cover" ? "Fit inside frame" : "Fill frame"}
          onClick={() => editor.commit((document) =>
            updateCanvasNodeData(document, props.id, (current) => ({
              ...current,
              fit: data.fit === "cover" ? "contain" : "cover",
            })),
          )}
          pressed={data.fit === "cover"}
        />
      ) : null}
      <ToolbarButton
        disabled={!data.url}
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
    <NodeChrome icon={mediaIcon(data.kind)} label={data.label} node={props} toolbar={toolbar}>
      <MediaBody canUpload={editor.canUpload} data={data} onPick={chooseFile} selected={props.selected} />
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
          {data.path ? <div className="mt-1 truncate text-[11px] text-muted-foreground">{data.path}</div> : null}
        </div>
      </div>
    </NodeChrome>
  )
}

function FileAssistantAccessory(props: NodeProps<CanvasNode>) {
  const editor = useCanvasEditor()
  const assistant = useCanvasService("assistant")
  if (!assistant || !canShowNodeLocalMutationSurface(editor.selectionContext, props.id, editor.readOnly)) return null
  return (
    <NodeToolbar
      className="convax-node-assistant nodrag nowheel"
      offset={28}
      position={Position.Bottom}
    >
      <div data-canvas-shortcuts="ignore">
        {assistant.render({
          document: editor.document,
          mentionedNodeIds: [props.id],
          mode: "file",
          ownerNodeId: props.id,
        })}
      </div>
    </NodeToolbar>
  )
}

function AgentNode(props: NodeProps<CanvasNode>) {
  const editor = useCanvasEditor()
  const assistant = useCanvasService("assistant")
  const mentionedNodeIds = getConnectedCanvasFileNodeIds(editor.document, props.id)
  const toolbar = (
    <div className="convax-node-toolbar__surface" data-canvas-shortcuts="ignore">
      <ToolbarButton icon={<Copy />} label="Duplicate" onClick={() => editor.duplicateNode(props.id)} />
      <ToolbarButton destructive icon={<Trash2 />} label="Delete" onClick={() => editor.removeNode(props.id)} />
    </div>
  )
  return (
    <NodeChrome icon={<Bot />} label={props.data.label} node={props} toolbar={toolbar}>
      <div className="convax-agent-node nodrag nowheel size-full" data-canvas-shortcuts="ignore">
        {assistant
          ? assistant.render({
              document: editor.document,
              mentionedNodeIds,
              mode: "agent",
              ownerNodeId: props.id,
            })
          : <div className="grid size-full place-items-center p-5 text-center text-sm text-muted-foreground">Register an assistant service to use this Agent.</div>}
      </div>
    </NodeChrome>
  )
}

export function BuiltinCanvasNode(props: NodeProps<CanvasNode>) {
  if (props.data.kind === "group") return <GroupNode {...props} />
  if (props.data.kind === "agent" || props.type === "agent") return <AgentNode {...props} />
  return <RegisteredFileNode {...props} />
}

function RegisteredFileNode(props: NodeProps<CanvasNode>) {
  const editor = useCanvasEditor()
  const showMutationToolbar = canShowNodeLocalMutationSurface(editor.selectionContext, props.id, editor.readOnly)
  const definition = editor.fileRenderers.resolve(props.data)
  const Renderer = definition?.component
  const ContributedToolbar = definition?.toolbar
  return (
    <>
      <FileRendererBoundary data={props.data} renderer={Renderer}>
        {Renderer
          ? <Renderer {...props} />
          : <UnknownFileRenderer {...props} />}
      </FileRendererBoundary>
      {ContributedToolbar && showMutationToolbar ? (
        <NodeToolbar className="convax-node-toolbar nodrag nowheel" offset={82} position={Position.Top}>
          <FileRendererBoundary data={props.data} fallback={null} renderer={ContributedToolbar}>
            <ContributedToolbar {...props} />
          </FileRendererBoundary>
        </NodeToolbar>
      ) : null}
      <FileAssistantAccessory {...props} />
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

class FileRendererBoundary extends Component<{
  children: ReactNode
  data: CanvasNode["data"]
  fallback?: ReactNode
  renderer?: unknown
}, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidUpdate(previous: Readonly<{ data: CanvasNode["data"]; renderer?: unknown }>) {
    if (this.state.failed && (previous.data !== this.props.data || previous.renderer !== this.props.renderer)) {
      this.setState({ failed: false })
    }
  }

  render() {
    if (!this.state.failed) return this.props.children
    return this.props.fallback !== undefined ? this.props.fallback : (
      <div className="grid size-full place-items-center rounded-lg border border-destructive/40 bg-card p-4 text-center text-sm text-destructive">
        This file renderer failed. Update the file or plugin to retry.
      </div>
    )
  }
}

export {
  NodeChrome as CanvasNodeChrome,
  ToolbarButton as CanvasNodeToolbarButton,
  ToolbarDivider as CanvasNodeToolbarDivider,
}
