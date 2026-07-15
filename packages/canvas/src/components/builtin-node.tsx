import { Handle, NodeResizer, Position, type NodeProps } from "@xyflow/react"
import { File, Image, LoaderCircle, Music2, Play, StickyNote, Type } from "lucide-react"
import { useState } from "react"
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
  return (
    <div
      className={cn(
        "group relative size-full overflow-hidden rounded-lg border bg-card text-card-foreground shadow-sm transition-shadow",
        props.node.selected ? "border-ring shadow-md ring-2 ring-ring/20" : "border-border hover:shadow-md",
        props.className,
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
      <div className="flex h-9 items-center gap-2 border-b border-border/70 px-3 text-xs font-medium text-muted-foreground">
        {props.icon}
        <span className="truncate">{props.label}</span>
        {props.node.data.status === "pending" ? <LoaderCircle className="ml-auto size-3.5 animate-spin" /> : null}
      </div>
      {props.children}
      <Handle className="!size-2.5 !border-2 !border-card !bg-muted-foreground" type="target" position={Position.Left} />
      <Handle className="!size-2.5 !border-2 !border-card !bg-muted-foreground" type="source" position={Position.Right} />
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

function MediaBody({ data }: { data: CanvasMediaNodeData }) {
  if (data.kind === "image") {
    return <img alt={data.label} className="size-full object-contain" draggable={false} src={data.url} />
  }
  if (data.kind === "video") {
    return (
      <video
        className="nodrag nowheel size-full bg-black object-contain"
        controls
        poster={data.posterUrl}
        src={data.url}
      />
    )
  }
  if (data.kind === "audio") {
    return (
      <div className="flex size-full flex-col items-center justify-center gap-4 p-5">
        <Music2 className="size-8 text-muted-foreground" />
        <audio className="nodrag nowheel w-full" controls src={data.url} />
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
      <MediaBody data={data} />
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

