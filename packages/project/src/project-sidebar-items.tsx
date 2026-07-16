import { cn } from "@convax/ui"
import type {
  ProjectEntry,
  ProjectFilesController,
  ProjectTextPreviewContents,
} from "@convax/project-files"
import {
  FileAudio,
  FileCode2,
  FileImage,
  FileText,
  FileVideo,
  Folder,
  FolderOpen,
} from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"

export type FilePreviewKind = "audio" | "image" | "markdown" | "text" | "video"

type TextPreviewState =
  | { status: "idle" }
  | { status: "loading" }
  | ({ status: "ready" } & ProjectTextPreviewContents)
  | { status: "error" }

const codeExtensions = new Set(["css", "html", "js", "jsx", "mjs", "ts", "tsx"])
const textExtensions = new Set(["csv", "json", "log", "txt", "yaml", "yml"])
const imageExtensions = new Set(["avif", "gif", "heic", "heif", "jpeg", "jpg", "png", "svg", "webp"])
const videoExtensions = new Set(["m4v", "mov", "mp4", "webm"])
const audioExtensions = new Set(["aac", "flac", "m4a", "mp3", "ogg", "opus", "wav"])

const textPreviewCache = new Map<string, ProjectTextPreviewContents>()

export function FilePreviewPortal(props: {
  controller: ProjectFilesController
  entry: ProjectEntry
  kind: FilePreviewKind
  onMouseEnter: () => void
  onMouseLeave: () => void
  position: { left: number; top: number }
  projectId: string
  url: string
}) {
  const textKind = props.kind === "markdown" || props.kind === "text"
  const cacheKey = `${props.projectId}\u0000${props.entry.path}\u0000${props.entry.modifiedAt}`
  const [textState, setTextState] = useState<TextPreviewState>(() => {
    const cached = textPreviewCache.get(cacheKey)
    return cached ? { status: "ready", ...cached } : { status: "idle" }
  })

  useEffect(() => {
    if (!textKind) return
    const cached = textPreviewCache.get(cacheKey)
    if (cached) {
      setTextState({ status: "ready", ...cached })
      return
    }
    let stale = false
    setTextState({ status: "loading" })
    void props.controller.readTextPreview(props.entry.path).then((result) => {
      if (stale) return
      if (!result) {
        setTextState({ status: "error" })
        return
      }
      textPreviewCache.set(cacheKey, result)
      while (textPreviewCache.size > 48) {
        const oldestKey = textPreviewCache.keys().next().value
        if (typeof oldestKey !== "string") break
        textPreviewCache.delete(oldestKey)
      }
      setTextState({ status: "ready", ...result })
    }).catch(() => {
      if (!stale) setTextState({ status: "error" })
    })
    return () => {
      stale = true
    }
  }, [cacheKey, props.controller, props.entry.path, textKind])

  if (typeof document === "undefined") return null
  return createPortal(
    <div
      className="fixed z-[120] w-80 overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-2xl"
      data-file-preview-kind={props.kind}
      data-project-file-preview={props.entry.path}
      onMouseEnter={props.onMouseEnter}
      onMouseLeave={props.onMouseLeave}
      style={{ left: props.position.left, top: props.position.top }}
    >
      {textKind ? (
        <div className="h-56 overflow-auto bg-muted/40">
          {textState.status === "idle" || textState.status === "loading" ? (
            <div className="space-y-2 p-4" aria-label="Loading file preview">
              <span className="block h-2.5 w-full animate-pulse rounded bg-muted-foreground/15" />
              <span className="block h-2.5 w-5/6 animate-pulse rounded bg-muted-foreground/15" />
              <span className="block h-2.5 w-2/3 animate-pulse rounded bg-muted-foreground/15" />
            </div>
          ) : textState.status === "error" ? (
            <div className="p-4 text-xs text-muted-foreground" role="status">Unable to load this preview.</div>
          ) : (
            <>
              <pre className={cn("min-h-full whitespace-pre-wrap break-words p-4 text-xs leading-5", props.kind === "markdown" ? "font-sans" : "font-mono")}>{textState.content}</pre>
              {textState.truncated ? <div className="sticky bottom-0 border-t border-border bg-popover/95 px-4 py-2 text-[11px] text-muted-foreground">Preview truncated</div> : null}
            </>
          )}
        </div>
      ) : props.kind === "image" ? (
        <div className="flex h-52 items-center justify-center bg-muted/50 p-2"><img alt={props.entry.name} className="max-h-full max-w-full rounded-md object-contain" draggable={false} src={props.url} /></div>
      ) : props.kind === "video" ? (
        <div className="flex h-52 items-center justify-center bg-black/90"><video autoPlay className="max-h-full max-w-full" controls loop muted playsInline preload="metadata" src={props.url} /></div>
      ) : (
        <div className="flex h-24 items-center justify-center bg-muted/50 px-4"><audio className="w-full" controls preload="metadata" src={props.url} /></div>
      )}
      <div className="space-y-0.5 border-t border-border px-3 py-2.5">
        <div className="truncate text-xs font-medium">{props.entry.name}</div>
        <div className="truncate text-[10px] text-muted-foreground" title={props.entry.path}>{props.entry.path}</div>
      </div>
    </div>,
    document.body,
  )
}

export function InlineInput(props: { label: string; onCancel: () => void; onChange: (value: string) => void; onCommit: () => Promise<void>; value: string }) {
  const committingRef = useRef(false)
  const commit = () => {
    if (committingRef.current) return
    committingRef.current = true
    void props.onCommit().finally(() => { committingRef.current = false })
  }
  return (
    <input
      aria-label={props.label}
      autoFocus
      className="mx-1 h-6 min-w-0 flex-1 rounded border border-ring bg-background px-1.5 text-xs outline-none ring-2 ring-ring/20"
      onBlur={commit}
      onChange={(event) => props.onChange(event.currentTarget.value)}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation()
        if (event.key === "Escape") props.onCancel()
        if (event.key === "Enter") commit()
      }}
      value={props.value}
    />
  )
}

export function EntryIcon({
  entry,
  expanded = false,
  previewKind,
  previewUrl,
}: {
  entry: Pick<ProjectEntry, "kind" | "name">
  expanded?: boolean
  previewKind?: FilePreviewKind | null
  previewUrl?: string | null
}) {
  if (entry.kind === "directory") return expanded ? <FolderOpen className="size-4 shrink-0 text-primary" /> : <Folder className="size-4 shrink-0 text-primary" />
  if (previewKind === "image" && previewUrl) {
    return (
      <span className="grid size-5 shrink-0 place-items-center overflow-hidden rounded bg-muted" aria-hidden="true">
        <img alt="" className="size-full object-cover" draggable={false} loading="lazy" src={previewUrl} />
      </span>
    )
  }
  if (previewKind === "video" && previewUrl) {
    return (
      <span className="grid size-5 shrink-0 place-items-center overflow-hidden rounded bg-muted" aria-hidden="true">
        <video className="size-full object-cover" muted playsInline preload="metadata" src={previewUrl} />
      </span>
    )
  }
  if (previewKind === "audio" && previewUrl) {
    return <span className="grid size-5 shrink-0 place-items-center rounded bg-amber-500/10" aria-hidden="true"><FileAudio className="size-3.5 text-amber-600" /></span>
  }
  const extension = entry.name.split(".").pop()?.toLowerCase() ?? ""
  if (imageExtensions.has(extension)) return <FileImage className="size-4 shrink-0 text-emerald-600" />
  if (videoExtensions.has(extension)) return <FileVideo className="size-4 shrink-0 text-rose-500" />
  if (audioExtensions.has(extension)) return <FileAudio className="size-4 shrink-0 text-amber-600" />
  if (codeExtensions.has(extension)) return <FileCode2 className="size-4 shrink-0 text-sky-600" />
  return <FileText className="size-4 shrink-0 text-muted-foreground" />
}

export function getFilePreviewKind(entry: Pick<ProjectEntry, "kind" | "name">): FilePreviewKind | null {
  if (entry.kind !== "file") return null
  const extension = entry.name.split(".").pop()?.toLowerCase() ?? ""
  if (imageExtensions.has(extension)) return "image"
  if (videoExtensions.has(extension)) return "video"
  if (audioExtensions.has(extension)) return "audio"
  if (extension === "md" || extension === "markdown") return "markdown"
  if (textExtensions.has(extension)) return "text"
  return null
}
