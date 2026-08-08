import { cn } from "@convax/ui"
import type {
  ProjectEntry,
  ProjectFilePreviewPurpose,
  ProjectFilesController,
  ProjectTextPreviewContents,
} from "@convax/project-files"
import { FileAudio, FileCode2, FileImage, FileText, FileVideo, Folder, FolderOpen } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"

export type FilePreviewKind = "audio" | "image" | "markdown" | "text" | "video"

type TextPreviewState =
  | { status: "idle" }
  | { status: "loading" }
  | ({ status: "ready" } & ProjectTextPreviewContents)
  | { status: "error" }

type MediaPreviewState =
  | { status: "idle" }
  | { status: "loading" }
  | { handle: ProjectFilePreviewHandle; status: "ready" }
  | { status: "error" }

export interface ProjectFilePreviewHandle {
  release(): Promise<void> | void
  url: string
}

export type ProjectFilePreviewOpener = (input: {
  path: string
  projectId: string
  purpose: ProjectFilePreviewPurpose
}) => Promise<ProjectFilePreviewHandle>

interface QueuedVideoThumbnailTask {
  reject(error: unknown): void
  resolve(value: string): void
  run(): Promise<string>
  signal: AbortSignal
}

const codeExtensions = new Set(["css", "html", "js", "jsx", "mjs", "ts", "tsx"])
const textExtensions = new Set(["csv", "json", "log", "txt", "yaml", "yml"])
const imageExtensions = new Set(["avif", "gif", "heic", "heif", "jpeg", "jpg", "png", "svg", "webp"])
const videoExtensions = new Set(["m4v", "mov", "mp4", "webm"])
const audioExtensions = new Set(["aac", "flac", "m4a", "mp3", "ogg", "opus", "wav"])

const textPreviewCache = new Map<string, ProjectTextPreviewContents>()
const maximumConcurrentVideoThumbnails = 2
const videoThumbnailTimeoutMs = 15_000
const queuedVideoThumbnailTasks: QueuedVideoThumbnailTask[] = []
let activeVideoThumbnailTasks = 0

export function FilePreviewPortal(props: {
  controller: ProjectFilesController
  entry: ProjectEntry
  kind: FilePreviewKind
  onMouseEnter: () => void
  onMouseLeave: () => void
  openPreview?: ProjectFilePreviewOpener
  position: { left: number; top: number }
  projectId: string
}) {
  const textKind = props.kind === "markdown" || props.kind === "text"
  const cacheKey = `${props.projectId}\u0000${props.entry.path}\u0000${props.entry.modifiedAt}`
  const [textState, setTextState] = useState<TextPreviewState>(() => {
    const cached = textPreviewCache.get(cacheKey)
    return cached ? { status: "ready", ...cached } : { status: "idle" }
  })
  const [mediaState, setMediaState] = useState<MediaPreviewState>({ status: "idle" })

  useEffect(() => {
    if (!textKind) return
    const cached = textPreviewCache.get(cacheKey)
    if (cached) {
      setTextState({ status: "ready", ...cached })
      return
    }
    let stale = false
    setTextState({ status: "loading" })
    void props.controller
      .readTextPreview(props.entry.path)
      .then((result) => {
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
      })
      .catch(() => {
        if (!stale) setTextState({ status: "error" })
      })
    return () => {
      stale = true
    }
  }, [cacheKey, props.controller, props.entry.path, textKind])

  useEffect(() => {
    if (textKind) return
    if (!props.openPreview) {
      setMediaState({ status: "error" })
      return
    }
    let stale = false
    let handle: ProjectFilePreviewHandle | undefined
    setMediaState({ status: "loading" })
    void props
      .openPreview({ path: props.entry.path, projectId: props.projectId, purpose: "preview" })
      .then((opened) => {
        if (!opened.url) throw new Error("Project file preview URL is empty")
        if (stale) {
          releasePreview(opened)
          return
        }
        handle = opened
        setMediaState({ handle: opened, status: "ready" })
      })
      .catch(() => {
        if (!stale) setMediaState({ status: "error" })
      })
    return () => {
      stale = true
      if (handle) releasePreview(handle)
    }
  }, [props.entry.path, props.openPreview, props.projectId, textKind])

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
            <div className="p-4 text-xs text-muted-foreground" role="status">
              Unable to load this preview.
            </div>
          ) : (
            <>
              <pre
                className={cn(
                  "min-h-full whitespace-pre-wrap break-words p-4 text-xs leading-5",
                  props.kind === "markdown" ? "font-sans" : "font-mono",
                )}
              >
                {textState.content}
              </pre>
              {textState.truncated ? (
                <div className="sticky bottom-0 border-t border-border bg-popover/95 px-4 py-2 text-[11px] text-muted-foreground">
                  Preview truncated
                </div>
              ) : null}
            </>
          )}
        </div>
      ) : mediaState.status === "idle" || mediaState.status === "loading" ? (
        <div aria-label="Loading media preview" className="grid h-52 place-items-center bg-muted/50">
          <span className="size-7 animate-pulse rounded-full bg-muted-foreground/15" />
        </div>
      ) : mediaState.status === "error" ? (
        <div className="grid h-28 place-items-center bg-muted/50 p-4 text-xs text-muted-foreground" role="status">
          Unable to load this preview.
        </div>
      ) : props.kind === "image" ? (
        <div className="flex h-52 items-center justify-center bg-muted/50 p-2">
          <img
            alt={props.entry.name}
            className="max-h-full max-w-full rounded-md object-contain"
            draggable={false}
            src={mediaState.handle.url}
          />
        </div>
      ) : props.kind === "video" ? (
        <div className="flex h-52 items-center justify-center bg-black/90">
          <ReleasableVideo label={props.entry.name} url={mediaState.handle.url} />
        </div>
      ) : (
        <div className="flex h-24 items-center justify-center bg-muted/50 px-4">
          <audio className="w-full" controls preload="metadata" src={mediaState.handle.url} />
        </div>
      )}
      <div className="space-y-0.5 border-t border-border px-3 py-2.5">
        <div className="truncate text-xs font-medium">{props.entry.name}</div>
        <div className="truncate text-[10px] text-muted-foreground" title={props.entry.path}>
          {props.entry.path}
        </div>
      </div>
    </div>,
    document.body,
  )
}

function ReleasableVideo(props: { label: string; url: string }) {
  const ref = useRef<HTMLVideoElement | null>(null)
  useEffect(
    () => () => {
      const video = ref.current
      if (!video) return
      clearVideoSource(video)
    },
    [],
  )
  return (
    <video
      aria-label={props.label}
      autoPlay
      className="max-h-full max-w-full"
      controls
      crossOrigin="anonymous"
      loop
      muted
      playsInline
      preload="metadata"
      ref={ref}
      src={props.url}
    />
  )
}

export function captureProjectVideoThumbnail(
  input: { path: string; projectId: string },
  openPreview: ProjectFilePreviewOpener,
  signal: AbortSignal,
) {
  return queueVideoThumbnail(signal, async () => {
    throwIfAborted(signal)
    const handle = await openPreview({ ...input, purpose: "thumbnail" })
    try {
      throwIfAborted(signal)
      return await captureVideoPoster(handle.url, signal)
    } finally {
      await safelyReleasePreview(handle)
    }
  })
}

function captureVideoPoster(url: string, signal: AbortSignal) {
  return new Promise<string>((resolve, reject) => {
    const video = document.createElement("video")
    let settled = false
    const finish = (error?: unknown, poster?: string) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      signal.removeEventListener("abort", onAbort)
      video.removeEventListener("error", onError)
      video.removeEventListener("loadeddata", onLoadedData)
      clearVideoSource(video)
      if (error) reject(error)
      else if (poster) resolve(poster)
      else reject(new Error("Project video thumbnail frame is unavailable"))
    }
    const onAbort = () => finish(abortError())
    const onError = () => finish(new Error("Project video thumbnail could not be decoded"))
    const onLoadedData = () => finish(undefined, videoPosterDataUrl(video))
    const timeout = setTimeout(
      () => finish(new Error("Project video thumbnail timed out")),
      videoThumbnailTimeoutMs,
    )

    signal.addEventListener("abort", onAbort, { once: true })
    video.addEventListener("error", onError, { once: true })
    video.addEventListener("loadeddata", onLoadedData, { once: true })
    video.crossOrigin = "anonymous"
    video.muted = true
    video.playsInline = true
    video.preload = "auto"
    video.src = url
    try {
      video.load()
    } catch (error) {
      finish(error)
    }
  })
}

function queueVideoThumbnail(signal: AbortSignal, run: () => Promise<string>) {
  if (signal.aborted) return Promise.reject(abortError())
  return new Promise<string>((resolve, reject) => {
    const task: QueuedVideoThumbnailTask = { reject, resolve, run, signal }
    const onAbort = () => {
      const index = queuedVideoThumbnailTasks.indexOf(task)
      if (index < 0) return
      queuedVideoThumbnailTasks.splice(index, 1)
      reject(abortError())
    }
    signal.addEventListener("abort", onAbort, { once: true })
    task.run = async () => {
      signal.removeEventListener("abort", onAbort)
      return run()
    }
    queuedVideoThumbnailTasks.push(task)
    drainVideoThumbnailQueue()
  })
}

function drainVideoThumbnailQueue() {
  while (activeVideoThumbnailTasks < maximumConcurrentVideoThumbnails) {
    const task = queuedVideoThumbnailTasks.shift()
    if (!task) return
    if (task.signal.aborted) {
      task.reject(abortError())
      continue
    }
    activeVideoThumbnailTasks += 1
    void task
      .run()
      .then(task.resolve, task.reject)
      .finally(() => {
        activeVideoThumbnailTasks -= 1
        drainVideoThumbnailQueue()
      })
  }
}

function videoPosterDataUrl(video: HTMLVideoElement) {
  if (video.videoWidth < 1 || video.videoHeight < 1) return undefined
  try {
    const canvas = document.createElement("canvas")
    canvas.height = 40
    canvas.width = 40
    const context = canvas.getContext("2d")
    if (!context) return undefined
    const scale = Math.max(canvas.width / video.videoWidth, canvas.height / video.videoHeight)
    const width = video.videoWidth * scale
    const height = video.videoHeight * scale
    context.drawImage(video, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height)
    return canvas.toDataURL("image/jpeg", 0.78)
  } catch {
    return undefined
  }
}

function releasePreview(handle: ProjectFilePreviewHandle) {
  try {
    void Promise.resolve(handle.release()).catch(() => undefined)
  } catch {
    // The preview is already leaving; release failure must not retain UI state.
  }
}

function clearVideoSource(video: HTMLVideoElement) {
  try {
    video.pause()
    video.removeAttribute("src")
    video.load()
  } catch {
    // Clearing is best effort; closing the lease below still revokes the stream.
  }
}

async function safelyReleasePreview(handle: ProjectFilePreviewHandle) {
  try {
    await handle.release()
  } catch {
    // A failed thumbnail release is already bounded by the sender-owned lease cap.
  }
}

function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) throw abortError()
}

function abortError() {
  return new DOMException("Project video thumbnail was canceled", "AbortError")
}

export function InlineInput(props: {
  label: string
  onCancel: () => void
  onChange: (value: string) => void
  onCommit: () => Promise<void>
  value: string
}) {
  const committingRef = useRef(false)
  const commit = () => {
    if (committingRef.current) return
    committingRef.current = true
    void props.onCommit().finally(() => {
      committingRef.current = false
    })
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
  if (entry.kind === "directory")
    return expanded ? (
      <FolderOpen className="size-4 shrink-0 text-primary" />
    ) : (
      <Folder className="size-4 shrink-0 text-primary" />
    )
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
        <img alt="" className="size-full object-cover" draggable={false} loading="lazy" src={previewUrl} />
      </span>
    )
  }
  if (previewKind === "audio" && previewUrl) {
    return (
      <span className="grid size-5 shrink-0 place-items-center rounded bg-amber-500/10" aria-hidden="true">
        <FileAudio className="size-3.5 text-amber-600" />
      </span>
    )
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
