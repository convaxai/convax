import {
  CanvasEditor,
  createCanvasServices,
  parseCanvasDocument,
  type CanvasDocument,
  type CanvasEditorHandle,
  type CanvasMediaKind,
  type CanvasNotification,
} from "@convax/canvas"
import {
  parseProjectEntryDrag,
  PROJECT_ENTRY_DRAG_TYPE,
  ProjectController,
  ProjectSidebar,
  type ProjectFileInfo,
} from "@convax/project"
import { CheckCircle2, Info, TriangleAlert, XCircle } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import { createRoot } from "react-dom/client"
import { createInitialCanvasDocument } from "./canvas-document"
import "./styles.css"

function mediaKindFromMime(mimeType: string): CanvasMediaKind {
  if (mimeType.startsWith("image/")) return "image"
  if (mimeType.startsWith("video/")) return "video"
  if (mimeType.startsWith("audio/")) return "audio"
  return "file"
}

const projectFileReferenceKey = "convaxProjectFile"

interface ProjectFileReference {
  path: string
}

function getProjectFileReference(metadata: unknown): ProjectFileReference | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null
  const value = (metadata as Record<string, unknown>)[projectFileReferenceKey]
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const reference = value as Record<string, unknown>
  return typeof reference.path === "string"
    ? { path: reference.path }
    : null
}

function projectAssetUrl(projectId: string, path: string) {
  const url = new URL(`convax-asset://${projectId}/file`)
  url.searchParams.set("path", path)
  return url.href
}

function projectFileResource(file: ProjectFileInfo, projectId: string) {
  return {
    kind: mediaKindFromMime(file.mimeType),
    metadata: { [projectFileReferenceKey]: { path: file.path } },
    mimeType: file.mimeType,
    name: file.name,
    url: projectAssetUrl(projectId, file.path),
  }
}

function documentForProjectStorage(document: CanvasDocument) {
  return {
    ...document,
    nodes: document.nodes.map((node) => {
      const metadata = "metadata" in node.data ? node.data.metadata : undefined
      if (!getProjectFileReference(metadata)) return node
      return { ...node, data: { ...node.data, url: "" } }
    }),
  }
}

async function hydrateProjectFileUrls(document: CanvasDocument, projectId: string, signal: AbortSignal) {
  if (signal.aborted) throw signal.reason
  return {
    ...document,
    nodes: document.nodes.map((node) => {
      const metadata = "metadata" in node.data ? node.data.metadata : undefined
      const reference = getProjectFileReference(metadata)
      if (!reference) return node
      return { ...node, data: { ...node.data, url: projectAssetUrl(projectId, reference.path) } }
    }),
  }
}

async function ensureProjectAssetsDirectory(projectId: string) {
  await window.convax.projects.writeTextFile({
    content: "",
    createParents: true,
    path: ".convax/assets/.keep",
    projectId,
  })
}

async function importCanvasFiles(files: readonly File[], projectId: string, signal: AbortSignal) {
  if (files.length === 0) return []
  await ensureProjectAssetsDirectory(projectId)
  const sourceTokens = files.map((file) => window.convax.projects.createImportToken(file))
  if (sourceTokens.some((token) => !token)) throw new Error("Only files from the local disk can be added to a project canvas")
  const imported = await window.convax.projects.importEntries({
    destinationPath: ".convax/assets",
    projectId,
    sourceTokens,
  })
  const projectFiles = await Promise.all((imported.targetPaths ?? []).map((path) => window.convax.projects.readFileInfo({ path, projectId })))
  if (signal.aborted) throw signal.reason
  return projectFiles
}

async function copyCanvasProjectFiles(paths: string[], projectId: string, signal: AbortSignal) {
  if (paths.length === 0) return []
  await ensureProjectAssetsDirectory(projectId)
  const copied = await window.convax.projects.copyEntries({ destinationPath: ".convax/assets", paths, projectId })
  const projectFiles = await Promise.all((copied.targetPaths ?? []).map((path) => window.convax.projects.readFileInfo({ path, projectId })))
  if (signal.aborted) throw signal.reason
  return projectFiles
}

function App() {
  const [notification, setNotification] = useState<CanvasNotification | null>(null)
  const canvasEditorRef = useRef<CanvasEditorHandle>(null)
  const latestCanvasSaveRef = useRef<Promise<void> | null>(null)
  const drainCanvasSaves = useCallback(async () => {
    while (true) {
      const pending = latestCanvasSaveRef.current
      if (!pending) return
      try {
        await pending
      } catch (error) {
        if (latestCanvasSaveRef.current !== pending) continue
        throw error
      }
      if (latestCanvasSaveRef.current === pending) return
    }
  }, [])
  const projectController = useMemo(() => new ProjectController(window.convax.projects, {
    beforeActiveProjectChange: async () => {
      await canvasEditorRef.current?.prepareToLeave()
      await drainCanvasSaves()
    },
    beforeActiveCanvasChange: async () => {
      await canvasEditorRef.current?.prepareToLeave()
      await drainCanvasSaves()
    },
    onActiveCanvasChangeCanceled: () => canvasEditorRef.current?.resumeAfterLeaveCanceled(),
    onActiveProjectChangeCanceled: () => canvasEditorRef.current?.resumeAfterLeaveCanceled(),
  }), [drainCanvasSaves])
  const projectSnapshot = useSyncExternalStore(
    projectController.subscribe,
    projectController.getSnapshot,
    projectController.getSnapshot,
  )
  useEffect(() => () => projectController.dispose(), [projectController])
  const activeProject = projectSnapshot.projects.find((project) => project.id === projectSnapshot.activeProjectId)
  const activeProjectId = activeProject?.id
  const activeCanvas = projectSnapshot.canvases.find((canvas) => canvas.id === projectSnapshot.activeCanvasId)
  const activeCanvasId = activeCanvas?.id
  const activeCanvasNameRef = useRef(activeCanvas?.name)
  activeCanvasNameRef.current = activeCanvas?.name
  const initialDocument = useMemo(
    () => createInitialCanvasDocument({
      canvasId: activeCanvasId ?? new URL(window.location.href).searchParams.get("document") ?? "convax-welcome",
      canvasName: activeCanvas?.name,
      projectName: activeProject?.name,
    }),
    [activeCanvas?.name, activeCanvasId, activeProject?.name],
  )
  const services = useMemo(
    () =>
      createCanvasServices({
        upload: {
          async upload(request) {
            if (request.signal.aborted) throw request.signal.reason
            if (!activeProjectId && request.files.length > 0) throw new Error("Open a project before adding files to the canvas")
            const importedFiles = activeProjectId
              ? await importCanvasFiles(request.files, activeProjectId, request.signal)
              : []
            const dragged = parseProjectEntryDrag(request.transfer?.data[PROJECT_ENTRY_DRAG_TYPE] ?? "")
            const projectFiles = dragged && dragged.projectId === activeProjectId
              ? await copyCanvasProjectFiles(
                  dragged.entries.filter((entry) => entry.kind === "file").map((entry) => entry.path),
                  activeProjectId,
                  request.signal,
                )
              : []
            const files = [
              ...importedFiles.map((file) => projectFileResource(file, activeProjectId!)),
              ...projectFiles.map((file) => projectFileResource(file, activeProjectId!)),
            ]
            return files.map((file, index) => ({
                id: `resource_${Date.now()}_${index}`,
                ...file,
              }))
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
            if (activeProjectId && activeCanvasId) {
              const result = await window.convax.projects.readCanvasDocument({
                canvasId: activeCanvasId,
                projectId: activeProjectId,
              })
              if (!result.exists) return null
              const document = parseCanvasDocument(JSON.parse(result.content))
              if (!document) throw new Error("Stored canvas document is invalid")
              return hydrateProjectFileUrls({
                ...document,
                id: documentId,
                metadata: { ...document.metadata, title: activeCanvasNameRef.current ?? document.metadata.title },
              }, activeProjectId, signal)
            }
            const value = localStorage.getItem(`convax:canvas:${documentId}`)
            if (!value) return null
            const document = parseCanvasDocument(JSON.parse(value), documentId)
            if (!document) throw new Error("Stored canvas document is invalid")
            return document
          },
          async save(document, signal) {
            const save = (async () => {
              if (signal.aborted) throw signal.reason
              if (activeProjectId && activeCanvasId) {
                const storedDocument = documentForProjectStorage(document)
                await window.convax.projects.writeCanvasDocument({
                  canvasId: activeCanvasId,
                  content: `${JSON.stringify(storedDocument, null, 2)}\n`,
                  projectId: activeProjectId,
                })
                return
              }
              const serialized = JSON.stringify(document)
              if (serialized.length > 4 * 1024 * 1024) throw new Error("Canvas is too large for local storage; open a project to keep large files by reference")
              localStorage.setItem(`convax:canvas:${document.id}`, serialized)
            })()
            latestCanvasSaveRef.current = save
            return save
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
    [activeCanvasId, activeProjectId],
  )

  useEffect(() => {
    if (!notification) return
    const timeout = window.setTimeout(() => setNotification(null), 2800)
    return () => window.clearTimeout(timeout)
  }, [notification])

  return (
    <main className="relative flex size-full overflow-hidden bg-background">
      <ProjectSidebar
        controller={projectController}
        resolveFileUrl={({ path, projectId }) => projectAssetUrl(projectId, path)}
      />
      <section className="relative min-w-0 flex-1">
        <CanvasEditor
          key={activeProjectId && activeCanvasId ? `${activeProjectId}:${activeCanvasId}` : "welcome"}
          clipboardScope={activeProjectId ?? "welcome"}
          initialDocument={initialDocument}
          readOnly={projectSnapshot.changingActiveCanvas || projectSnapshot.changingActiveProject}
          ref={canvasEditorRef}
          services={services}
          title={activeCanvas?.name}
        />
      </section>
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
