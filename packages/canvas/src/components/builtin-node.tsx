import { Handle, NodeResizer, NodeToolbar, Position, type NodeProps } from "@xyflow/react"
import { File, Image, LoaderCircle, Music2, Pause, Play, Plus, StickyNote, Type, Volume2, VolumeX } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { cn } from "@convax/ui"
import { updateCanvasNodeData } from "../commands"
import { useCanvasEditor } from "../editor-context"
import type {
  CanvasMediaNodeData,
  CanvasNode,
  CanvasNoteNodeData,
  CanvasTextNodeData,
} from "../types"

const noteTone = {
  neutral: "bg-card",
  yellow: "bg-amber-50 dark:bg-amber-950",
  green: "bg-emerald-50 dark:bg-emerald-950",
  blue: "bg-sky-50 dark:bg-sky-950",
  rose: "bg-rose-50 dark:bg-rose-950",
} as const

function NodeChrome(props: {
  children: React.ReactNode
  className?: string
  icon: React.ReactNode
  label: string
  node: NodeProps<CanvasNode>
}) {
  const editor = useCanvasEditor()
  const [connectMenuSide, setConnectMenuSide] = useState<"left" | "right" | null>(null)
  useEffect(() => {
    if (props.node.selected) return
    setConnectMenuSide(null)
  }, [props.node.selected])
  return (
    <div
      className={cn(
        "convax-node group relative size-full text-card-foreground",
        props.node.selected && "is-selected",
      )}
    >
      <NodeResizer
        color="var(--ring)"
        isVisible={props.node.selected && !editor.readOnly}
        minWidth={160}
        minHeight={96}
        onResizeStart={editor.beginGesture}
        onResizeEnd={editor.endGesture}
      />
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
              className="convax-connect-menu nodrag nowheel"
              isVisible
              offset={50}
              position={connectMenuSide === "left" ? Position.Left : Position.Right}
            >
              <div className="convax-connect-menu__title">Add and connect</div>
              <div className="convax-connect-menu__items">
                {editor.connectionNodeTypes.map((item) => (
                  <button
                    key={item.type}
                    className="convax-connect-menu__item"
                    onClick={() => {
                      editor.quickConnect(props.node.id, connectMenuSide, item.type)
                      setConnectMenuSide(null)
                    }}
                    type="button"
                  >
                    <span className="convax-connect-menu__icon">
                      {item.type === "note" ? <StickyNote /> : item.type === "text" ? <Type /> : <File />}
                    </span>
                    <span className="truncate">{item.label}</span>
                  </button>
                ))}
              </div>
            </NodeToolbar>
          ) : null}
        </>
      ) : null}
    </div>
  )
}

function TextNode(props: NodeProps<CanvasNode>) {
  const editor = useCanvasEditor()
  const data = props.data as CanvasTextNodeData
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(data.text)
  const finishEditing = () => {
    setEditing(false)
    if (value === data.text) return
    editor.commit((document) =>
      updateCanvasNodeData(document, props.id, (current) => ({ ...current, text: value })),
    )
  }
  return (
    <NodeChrome icon={<Type />} label={data.label} node={props}>
      {editing && !editor.readOnly ? (
        <textarea
          autoFocus
          data-canvas-shortcuts="ignore"
          className="nodrag nowheel size-full resize-none bg-transparent p-4 text-sm leading-6 outline-none"
          value={value}
          onBlur={finishEditing}
          onChange={(event) => setValue(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key !== "Escape") return
            setValue(data.text)
            setEditing(false)
          }}
        />
      ) : (
        <div
          className="size-full whitespace-pre-wrap p-4 text-sm leading-6"
          onDoubleClick={() => setEditing(true)}
        >
          {data.text}
        </div>
      )}
    </NodeChrome>
  )
}

function NoteNode(props: NodeProps<CanvasNode>) {
  const data = props.data as CanvasNoteNodeData
  return (
    <NodeChrome className={noteTone[data.tone]} icon={<StickyNote />} label={data.label} node={props}>
      <div className="size-full whitespace-pre-wrap p-4 text-sm leading-6">{data.text}</div>
    </NodeChrome>
  )
}

function VideoBody({ data, selected }: { data: CanvasMediaNodeData; selected: boolean }) {
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
  }, [data.url])

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
        aria-label={data.label}
        className="convax-video__media size-full object-contain"
        loop
        muted={muted}
        onPause={() => setPlaying(false)}
        onPlay={() => setPlaying(true)}
        playsInline
        poster={data.posterUrl}
        preload="metadata"
        src={data.url}
      />
      <div className={cn("convax-video__controls", (hovered || playing || selected) && "is-visible")}>
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

function MediaBody({ data, selected }: { data: CanvasMediaNodeData; selected: boolean }) {
  if (data.kind === "image") {
    return (
      <img
        alt={data.label}
        className="size-full object-contain"
        decoding="async"
        draggable={false}
        loading="lazy"
        src={data.url}
      />
    )
  }
  if (data.kind === "video") {
    return <VideoBody data={data} selected={selected} />
  }
  if (data.kind === "audio") {
    return (
      <div className="flex size-full flex-col items-center justify-center gap-4 p-5">
        <Music2 className="size-8 text-muted-foreground" />
        <audio className="nodrag nowheel w-full" controls preload="metadata" src={data.url} />
      </div>
    )
  }
  return (
    <div className="flex size-full flex-col items-center justify-center gap-3 p-5 text-center">
      <File className="size-8 text-muted-foreground" />
      <span className="max-w-full truncate text-sm">{data.name ?? data.label}</span>
    </div>
  )
}

function MediaNode(props: NodeProps<CanvasNode>) {
  const data = props.data as CanvasMediaNodeData
  const icon = data.kind === "image" ? <Image /> : data.kind === "video" ? <Play /> : data.kind === "audio" ? <Music2 /> : <File />
  return (
    <NodeChrome icon={icon} label={data.label} node={props}>
      <MediaBody data={data} selected={props.selected} />
    </NodeChrome>
  )
}

function GroupNode(props: NodeProps<CanvasNode>) {
  const editor = useCanvasEditor()
  return (
    <div
      className={cn(
        "relative size-full rounded-lg border border-dashed bg-muted/20",
        props.selected ? "border-ring ring-2 ring-ring/20" : "border-border",
      )}
    >
      <NodeResizer
        color="var(--ring)"
        isVisible={props.selected && !editor.readOnly}
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

export function BuiltinCanvasNode(props: NodeProps<CanvasNode>) {
  if (props.data.kind === "text") return <TextNode {...props} />
  if (props.data.kind === "note") return <NoteNode {...props} />
  if (props.data.kind === "group") return <GroupNode {...props} />
  if (["image", "video", "audio", "file"].includes(props.data.kind)) return <MediaNode {...props} />
  return (
    <NodeChrome icon={<File />} label={props.data.label} node={props}>
      <div className="p-4 text-sm text-muted-foreground">No renderer registered for {props.type}.</div>
    </NodeChrome>
  )
}
