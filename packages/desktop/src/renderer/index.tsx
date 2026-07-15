import {
  CanvasEditor,
  connectCanvasNodes,
  createCanvasDocument,
  createCanvasServices,
  createNoteNode,
  createTextNode,
  type CanvasDocument,
  type CanvasMediaKind,
  type CanvasNotification,
} from "@convax/canvas"
import { CheckCircle2, Info, TriangleAlert, XCircle } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { createRoot } from "react-dom/client"
import "./styles.css"

function createStarterDocument(id = "convax-starter-v1") {
  const brief = createTextNode({
    id: "node_brief",
    label: "Creative brief",
    position: { x: 80, y: 150 },
    text: "Build an open canvas where ideas, media, and agent output can stay connected.",
  })
  const principle = createNoteNode({
    id: "node_principle",
    label: "Architecture",
    position: { x: 460, y: 100 },
    text: "Canvas behavior lives in the SDK. Upload, generation, storage, and export come from the host.",
    tone: "blue",
  })
  const next = createTextNode({
    id: "node_next",
    label: "Try it",
    position: { x: 470, y: 390 },
    text: "Double-click the canvas, press Tab, drag in a file, or open Generate from the toolbar.",
  })
  const document = createCanvasDocument({
    id,
    title: "Convax workspace",
    description: "Generic canvas host example",
    nodes: [brief, principle, next],
  })
  return [
    { source: brief.id, target: principle.id },
    { source: principle.id, target: next.id },
  ].reduce(connectCanvasNodes, document)
}

function readFile(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener("load", () => resolve(String(reader.result)))
    reader.addEventListener("error", () => reject(reader.error ?? new Error("File could not be read")))
    reader.readAsDataURL(file)
  })
}

function mediaKind(file: File): CanvasMediaKind {
  if (file.type.startsWith("image/")) return "image"
  if (file.type.startsWith("video/")) return "video"
  if (file.type.startsWith("audio/")) return "audio"
  return "file"
}

function App() {
  const [notification, setNotification] = useState<CanvasNotification | null>(null)
  const initialDocument = useMemo(
    () => createStarterDocument(new URL(window.location.href).searchParams.get("document") ?? undefined),
    [],
  )
  const services = useMemo(
    () =>
      createCanvasServices({
        upload: {
          async upload(request) {
            if (request.signal.aborted) throw request.signal.reason
            return Promise.all(
              request.files.map(async (file, index) => ({
                id: `resource_${Date.now()}_${index}`,
                kind: mediaKind(file),
                url: await readFile(file),
                name: file.name,
                mimeType: file.type,
              })),
            )
          },
        },
        generate: {
          async generate(request) {
            await new Promise<void>((resolve, reject) => {
              const timeout = window.setTimeout(resolve, 650)
              request.signal.addEventListener("abort", () => {
                window.clearTimeout(timeout)
                reject(request.signal.reason)
              })
            })
            return [
              {
                nodeType: "text",
                title: "Generated idea",
                text: request.references.length
                  ? `${request.prompt}\n\nBuilt from ${request.references.length} selected reference${request.references.length === 1 ? "" : "s"}.`
                  : request.prompt,
              },
            ]
          },
        },
        persistence: {
          async load(documentId, signal) {
            if (signal.aborted) throw signal.reason
            const value = localStorage.getItem(`convax:canvas:${documentId}`)
            return value ? JSON.parse(value) as CanvasDocument : null
          },
          async save(document, signal) {
            if (signal.aborted) throw signal.reason
            localStorage.setItem(`convax:canvas:${document.id}`, JSON.stringify(document))
          },
        },
        export: {
          async export(request, signal) {
            if (signal.aborted) throw signal.reason
            const blob = new Blob([JSON.stringify(request.document, null, 2)], { type: "application/json" })
            const url = URL.createObjectURL(blob)
            const anchor = document.createElement("a")
            anchor.download = `${request.document.metadata.title.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")}.json`
            anchor.href = url
            anchor.click()
            URL.revokeObjectURL(url)
          },
        },
        notify: { show: setNotification },
        telemetry: {
          track(event) {
            console.info("[convax]", event.name, event.properties ?? {})
          },
        },
      }),
    [],
  )

  useEffect(() => {
    if (!notification) return
    const timeout = window.setTimeout(() => setNotification(null), 2800)
    return () => window.clearTimeout(timeout)
  }, [notification])

  return (
    <main className="relative size-full">
      <CanvasEditor initialDocument={initialDocument} services={services} />
      {notification ? <Toast notification={notification} /> : null}
    </main>
  )
}

function Toast({ notification }: { notification: CanvasNotification }) {
  const icon = notification.kind === "success"
    ? <CheckCircle2 className="text-emerald-600" />
    : notification.kind === "error"
      ? <XCircle className="text-destructive" />
      : notification.kind === "warning"
        ? <TriangleAlert className="text-amber-600" />
        : <Info className="text-sky-600" />
  return (
    <div className="absolute bottom-5 right-5 z-50 flex min-w-72 max-w-96 items-start gap-3 rounded-md border border-border bg-popover p-3 text-popover-foreground shadow-lg">
      {icon}
      <div className="min-w-0">
        <div className="text-sm font-medium">{notification.title}</div>
        {notification.description ? <div className="mt-0.5 text-xs text-muted-foreground">{notification.description}</div> : null}
      </div>
    </div>
  )
}

const root = document.getElementById("app")
if (!(root instanceof HTMLElement)) throw new Error("App root was not found")
const reactRoot = import.meta.hot?.data.root ?? createRoot(root)
if (import.meta.hot) import.meta.hot.data.root = reactRoot
reactRoot.render(<App />)
