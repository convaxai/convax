import {
  CanvasEditor,
  createDefaultCanvasFileRendererRegistry,
  createDefaultCanvasNodeRegistry,
  createCanvasViewRegistry,
  createCanvasServices,
  type CanvasEditorHandle,
  type CanvasMediaKind,
  type CanvasNotification,
} from "@convax/canvas"
import type { AgentResource } from "@convax/agent-runtime"
import {
  ProjectController,
  ProjectSidebar,
} from "@convax/project"
import { ProjectFilesController, type ProjectFileInfo } from "@convax/project-files"
import {
  ProjectCanvasController,
  hydrateProjectCanvasDocument,
  projectFileReferenceKey,
} from "@convax/project/canvas"
import {
  WorkbenchController,
  WorkbenchLayoutController,
  WorkbenchLayoutParts,
} from "@convax/workbench"
import { CheckCircle2, Info, TriangleAlert, XCircle } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import { createRoot } from "react-dom/client"
import { agentCanvasNodeResourceUri } from "../agent-canvas-context"
import { AgentPanel } from "./agent-panel"
import { createInitialCanvasDocument } from "./canvas-document"
import { resolveCanvasUploadItems } from "./canvas-upload"
import { DesktopProtocolGate } from "./desktop-protocol-gate"
import { ProjectEmptyState, ProjectLoadingState } from "./project-empty-state"
import { ProjectCanvasSidebar } from "./project-canvas-sidebar"
import { ProjectCanvasWorkbenchCoordinator } from "./project-canvas-workbench"
import {
  readWorkbenchLayoutPreferences,
  writeWorkbenchLayoutPreferences,
} from "./workbench-layout-preferences"
import { migrateLastCanvasPreference, writeLastCanvasPreference } from "./workbench-preferences"
import "./styles.css"

const primarySidebarBounds = { defaultSize: 292, maxSize: 480, minSize: 220 }
const secondarySidebarBounds = { defaultSize: 380, defaultVisible: true, maxSize: 620, minSize: 300 }
const secondarySidebarCollapseThreshold = 260
const collapsedSecondarySidebarSize = 44
const minimumWorkbenchSurfaceSize = 520
const overlaySidebarBreakpoint = 1040

function mediaKindFromMime(mimeType: string): CanvasMediaKind {
  if (mimeType.startsWith("image/")) return "image"
  if (mimeType.startsWith("video/")) return "video"
  if (mimeType.startsWith("audio/")) return "audio"
  return "file"
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

function uploadItemId(scope: "local" | "project", index: number) {
  return `resource_${scope}_${Date.now()}_${index}`
}

function canvasNodeResource(canvasId: string, nodeId: string, name: string): AgentResource {
  return {
    kind: "resource",
    name,
    uri: agentCanvasNodeResourceUri(canvasId, nodeId),
  }
}

async function ensureProjectAssetsDirectory(projectId: string) {
  await window.convax.projectFiles.writeTextFile({
    content: "",
    createParents: true,
    path: ".convax/assets/.keep",
    projectId,
  })
}

async function importCanvasFiles(files: readonly File[], projectId: string, signal: AbortSignal) {
  if (files.length === 0) return []
  await ensureProjectAssetsDirectory(projectId)
  const sourceTokens = files.map((file) => window.convax.projectFiles.createImportToken(file))
  if (sourceTokens.some((token) => !token)) throw new Error("Only files from the local disk can be added to a project canvas")
  const imported = await window.convax.projectFiles.importEntries({
    destinationPath: ".convax/assets",
    projectId,
    sourceTokens,
  })
  const projectFiles = await Promise.all((imported.targetPaths ?? []).map((path) => window.convax.projectFiles.readFileInfo({ path, projectId })))
  if (signal.aborted) throw signal.reason
  return projectFiles
}

async function copyCanvasProjectFiles(paths: string[], projectId: string, signal: AbortSignal) {
  if (paths.length === 0) return []
  await ensureProjectAssetsDirectory(projectId)
  const copied = await window.convax.projectFiles.copyEntries({ destinationPath: ".convax/assets", paths, projectId })
  const projectFiles = await Promise.all((copied.targetPaths ?? []).map((path) => window.convax.projectFiles.readFileInfo({ path, projectId })))
  if (signal.aborted) throw signal.reason
  return projectFiles
}

function App() {
  const [notification, setNotification] = useState<CanvasNotification | null>(null)
  const canvasEditorRef = useRef<CanvasEditorHandle>(null)
  const canvasNodeRegistry = useMemo(() => createDefaultCanvasNodeRegistry(), [])
  const canvasFileRendererRegistry = useMemo(() => createDefaultCanvasFileRendererRegistry(), [])
  const canvasViewRegistry = useMemo(() => createCanvasViewRegistry(), [])
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
  const flushCanvasForAgent = useCallback(async () => {
    await canvasEditorRef.current?.flush()
    await drainCanvasSaves()
  }, [drainCanvasSaves])
  const projectController = useMemo(() => new ProjectController(window.convax.projects, {
    beforeActiveProjectChange: async () => {
      await canvasEditorRef.current?.prepareToLeave()
      await drainCanvasSaves()
    },
    onActiveProjectChangeCanceled: () => canvasEditorRef.current?.resumeAfterLeaveCanceled(),
  }), [drainCanvasSaves])
  const projectFilesController = useMemo(() => new ProjectFilesController(window.convax.projectFiles), [])
  const projectCanvasController = useMemo(() => new ProjectCanvasController(window.convax.projects.canvases), [])
  const workbenchLayoutController = useMemo(() => {
    const preferences = readWorkbenchLayoutPreferences(localStorage, {
      primarySidebar: primarySidebarBounds,
      secondarySidebar: secondarySidebarBounds,
    })
    return new WorkbenchLayoutController({
      parts: {
        [WorkbenchLayoutParts.PrimarySidebar]: {
          initialSize: preferences.primarySidebar.size,
          initialVisible: true,
          maxSize: primarySidebarBounds.maxSize,
          minSize: primarySidebarBounds.minSize,
        },
        [WorkbenchLayoutParts.SecondarySidebar]: {
          collapseThreshold: secondarySidebarCollapseThreshold,
          initialSize: preferences.secondarySidebar.size,
          initialVisible: preferences.secondarySidebar.visible,
          maxSize: secondarySidebarBounds.maxSize,
          minSize: secondarySidebarBounds.minSize,
        },
      },
    })
  }, [])
  const workbenchController = useMemo(() => new WorkbenchController({
    beforeInputChange: async (currentInput) => {
      if (currentInput?.kind !== "canvas") return
      await canvasEditorRef.current?.prepareToLeave()
      await drainCanvasSaves()
    },
    onInputChangeCanceled: () => canvasEditorRef.current?.resumeAfterLeaveCanceled(),
  }), [drainCanvasSaves])
  const projectCanvasWorkbench = useMemo(
    () => new ProjectCanvasWorkbenchCoordinator(projectCanvasController, workbenchController),
    [projectCanvasController, workbenchController],
  )
  const projectSnapshot = useSyncExternalStore(
    projectController.subscribe,
    projectController.getSnapshot,
    projectController.getSnapshot,
  )
  const projectCanvasSnapshot = useSyncExternalStore(
    projectCanvasController.subscribe,
    projectCanvasController.getSnapshot,
    projectCanvasController.getSnapshot,
  )
  const workbenchSnapshot = useSyncExternalStore(
    workbenchController.subscribe,
    workbenchController.getSnapshot,
    workbenchController.getSnapshot,
  )
  const workbenchLayoutSnapshot = useSyncExternalStore(
    workbenchLayoutController.subscribe,
    workbenchLayoutController.getSnapshot,
    workbenchLayoutController.getSnapshot,
  )
  useEffect(() => () => projectController.dispose(), [projectController])
  useEffect(() => () => projectFilesController.dispose(), [projectFilesController])
  useEffect(() => () => projectCanvasController.dispose(), [projectCanvasController])
  useEffect(() => () => workbenchController.dispose(), [workbenchController])
  useEffect(() => () => workbenchLayoutController.dispose(), [workbenchLayoutController])
  useEffect(() => {
    if (!workbenchLayoutSnapshot.resize) {
      writeWorkbenchLayoutPreferences(localStorage, workbenchLayoutSnapshot)
    }
  }, [workbenchLayoutSnapshot])
  useEffect(() => {
    const projectId = projectSnapshot.activeProjectId
    workbenchController.setProject(projectId)
    void projectFilesController.setProject(projectId)
    void projectCanvasController.setProject(projectId)
  }, [projectCanvasController, projectFilesController, projectSnapshot.activeProjectId, workbenchController])
  const activeProject = projectSnapshot.projects.find((project) => project.id === projectSnapshot.activeProjectId)
  const activeProjectId = activeProject?.id
  const activeCanvasId = workbenchSnapshot.surface.kind === "canvas"
    && workbenchSnapshot.surface.input.projectId === activeProjectId
    ? workbenchSnapshot.surface.input.canvasId
    : undefined
  const activeCanvas = activeCanvasId && projectCanvasSnapshot.projectId === activeProjectId
    ? projectCanvasSnapshot.canvases.find((canvas) => canvas.id === activeCanvasId)
    : undefined
  useEffect(() => {
    if (!activeProjectId || projectCanvasSnapshot.projectId !== activeProjectId) return
    void projectCanvasWorkbench.reconcile(
      activeProjectId,
      migrateLastCanvasPreference(
        localStorage,
        activeProjectId,
        projectCanvasSnapshot.workbenchPreferenceMigration?.canvasId,
      ),
    )
  }, [
    activeProjectId,
    projectCanvasSnapshot.busy,
    projectCanvasSnapshot.canvases,
    projectCanvasSnapshot.projectId,
    projectCanvasSnapshot.workbenchPreferenceMigration,
    projectCanvasWorkbench,
    workbenchSnapshot.activeInput,
    workbenchSnapshot.changingInput,
    workbenchSnapshot.error,
  ])
  useEffect(() => {
    if (activeProjectId && activeCanvas) writeLastCanvasPreference(localStorage, activeProjectId, activeCanvas.id)
  }, [activeCanvas, activeProjectId])
  const assistantHostRef = useRef({
    activeCanvas,
    activeProject,
    beforePrompt: flushCanvasForAgent,
    canvases: projectCanvasSnapshot.canvases,
  })
  assistantHostRef.current = {
    activeCanvas,
    activeProject,
    beforePrompt: flushCanvasForAgent,
    canvases: projectCanvasSnapshot.canvases,
  }
  useEffect(() => window.convax.canvas.renderer.onRequest(async (request) => {
    if (request.type === "document.reload") {
      if (request.ref.scopeId !== activeProjectId || request.ref.canvasId !== activeCanvasId) {
        return { type: "document.reload", reloaded: false }
      }
      const editor = canvasEditorRef.current
      if (!editor) return { type: "document.reload", reloaded: false }
      await editor.reload()
      return { type: "document.reload", reloaded: true }
    }
    const result = await canvasViewRegistry.execute(request.input)
    return { type: "view.execute", result }
  }), [activeCanvasId, activeProjectId, canvasViewRegistry])
  const activeCanvasNameRef = useRef(activeCanvas?.name)
  activeCanvasNameRef.current = activeCanvas?.name
  const initialDocument = useMemo(() => {
    if (!activeProject || !activeCanvas) return null
    return createInitialCanvasDocument({
      canvasId: activeCanvas.id,
      canvasName: activeCanvas.name,
      projectName: activeProject.name,
    })
  }, [activeCanvas, activeProject])
  const services = useMemo(
    () => {
      let storageVersion: string | null | undefined
      let saveQueue = Promise.resolve()
      return createCanvasServices({
        assistant: {
          render(request) {
            const host = assistantHostRef.current
            const contextResources = request.mentionedNodeIds.flatMap((nodeId) => {
              const node = request.document.nodes.find((candidate) => candidate.id === nodeId)
              return node ? [canvasNodeResource(request.document.id, node.id, node.data.label)] : []
            })
            return (
              <AgentPanel
                activeCanvas={host.activeCanvas}
                beforePrompt={host.beforePrompt}
                canvases={host.canvases}
                className="!h-full !min-h-0 rounded-none border-0"
                contextResources={contextResources}
                conversationKey={JSON.stringify([request.document.id, request.ownerNodeId])}
                embedded
                projectId={host.activeProject?.id}
                projectName={host.activeProject?.name}
              />
            )
          },
        },
        upload: {
          async upload(request) {
            if (request.signal.aborted) throw request.signal.reason
            if (!activeProjectId) throw new Error("Open a project before adding files to the canvas")
            return resolveCanvasUploadItems(request, {
              projectId: activeProjectId,
              async copyProjectMediaFiles(paths, signal) {
                const files = await copyCanvasProjectFiles([...paths], activeProjectId, signal)
                return files.map((file, index) => ({
                  id: uploadItemId("project", index),
                  ...projectFileResource(file, activeProjectId),
                }))
              },
              async importLocalMediaFiles(files, signal) {
                const imported = await importCanvasFiles(files, activeProjectId, signal)
                return imported.map((file, index) => ({
                  id: uploadItemId("local", index),
                  ...projectFileResource(file, activeProjectId),
                }))
              },
              async readProjectTextFile(path, signal) {
                const result = await window.convax.projectFiles.readTextFile({ path, projectId: activeProjectId })
                if (!result.exists) throw new Error(`Could not read ${path}`)
                if (signal.aborted) throw signal.reason
                return result.content
              },
            })
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
            if (!activeProjectId || !activeCanvasId) {
              throw new Error("An active project and canvas are required to load a canvas document")
            }
            if (signal.aborted) throw signal.reason
            const result = await window.convax.canvas.documents.load({
              canvasId: activeCanvasId,
              scopeId: activeProjectId,
            })
            storageVersion = result.storageVersion
            if (!result.document) return null
            if (result.document.id !== documentId) throw new Error("Loaded the wrong canvas document")
            if (signal.aborted) throw signal.reason
            return hydrateProjectCanvasDocument({
              ...result.document,
              metadata: {
                ...result.document.metadata,
                title: activeCanvasNameRef.current ?? result.document.metadata.title,
              },
            }, ({ path }) => projectAssetUrl(activeProjectId, path))
          },
          async save(document, signal) {
            const save = saveQueue.catch(() => undefined).then(async () => {
              if (!activeProjectId || !activeCanvasId) {
                throw new Error("An active project and canvas are required to save a canvas document")
              }
              if (signal.aborted) throw signal.reason
              if (storageVersion === undefined) throw new Error("Canvas must be loaded before it can be saved")
              const result = await window.convax.canvas.documents.save({
                document,
                expectedStorageVersion: storageVersion,
                ref: { canvasId: activeCanvasId, scopeId: activeProjectId },
              })
              storageVersion = result.storageVersion
            })
            saveQueue = save
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
      })
    },
    [activeCanvasId, activeProjectId],
  )

  useEffect(() => {
    if (!notification) return
    const timeout = window.setTimeout(() => setNotification(null), 2800)
    return () => window.clearTimeout(timeout)
  }, [notification])

  const resizeWorkbenchPartBy = useCallback((partId: string, delta: number) => {
    if (!workbenchLayoutController.beginResize(partId)) return
    try {
      workbenchLayoutController.updateResize(delta)
      workbenchLayoutController.endResize()
    } catch (error) {
      workbenchLayoutController.cancelResize()
      throw error
    }
  }, [workbenchLayoutController])

  const startWorkbenchPartResize = useCallback((
    partId: string,
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    const part = workbenchLayoutController.getSnapshot().parts[partId]
    if (!part || !workbenchLayoutController.beginResize(partId)) return
    event.preventDefault()
    const startX = event.clientX
    const startSize = part.size
    const direction = partId === WorkbenchLayoutParts.PrimarySidebar ? 1 : -1

    const update = (clientX: number) => {
      const layout = workbenchLayoutController.getSnapshot()
      const primary = layout.parts[WorkbenchLayoutParts.PrimarySidebar]!
      const secondary = layout.parts[WorkbenchLayoutParts.SecondarySidebar]!
      const overlays = window.innerWidth <= overlaySidebarBreakpoint
      const occupiedBySecondary = overlays
        ? 0
        : secondary.visible
          ? secondary.size
          : collapsedSecondarySidebarSize
      const available = partId === WorkbenchLayoutParts.PrimarySidebar
        ? window.innerWidth - occupiedBySecondary - minimumWorkbenchSurfaceSize
        : overlays
          ? window.innerWidth - 96
          : window.innerWidth - primary.size - minimumWorkbenchSurfaceSize
      const requested = startSize + (clientX - startX) * direction
      const constrained = Math.min(requested, Math.max(0, available))
      workbenchLayoutController.updateResize(constrained - startSize)
    }

    let settled = false
    const cleanup = () => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", finish)
      window.removeEventListener("pointercancel", cancel)
      window.removeEventListener("blur", cancel)
    }
    const move = (moveEvent: PointerEvent) => update(moveEvent.clientX)
    const finish = (finishEvent: PointerEvent) => {
      if (settled) return
      settled = true
      update(finishEvent.clientX)
      cleanup()
      workbenchLayoutController.endResize()
    }
    const cancel = () => {
      if (settled) return
      settled = true
      cleanup()
      workbenchLayoutController.cancelResize()
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", finish)
    window.addEventListener("pointercancel", cancel)
    window.addEventListener("blur", cancel)
  }, [workbenchLayoutController])

  const primarySidebar = workbenchLayoutSnapshot.parts[WorkbenchLayoutParts.PrimarySidebar]!
  const secondarySidebar = workbenchLayoutSnapshot.parts[WorkbenchLayoutParts.SecondarySidebar]!

  return (
    <main className={`relative flex size-full overflow-hidden bg-background${workbenchLayoutSnapshot.resize ? " cursor-col-resize select-none" : ""}`}>
      <div
        className="relative h-full shrink-0"
        style={{ width: activeProject && primarySidebar.visible ? primarySidebar.size : 0 }}
      >
        <ProjectSidebar
          className="w-full"
          controller={projectController}
          extension={activeProject ? {
            busy: projectCanvasSnapshot.busy || workbenchSnapshot.changingInput,
            content: (
              <ProjectCanvasSidebar
                activeCanvasId={activeCanvasId ?? null}
                controller={projectCanvasController}
                navigationBusy={workbenchSnapshot.changingInput}
                navigationError={workbenchSnapshot.error}
                onActivate={(canvasId) => projectCanvasWorkbench.openCanvas(activeProject.id, canvasId)}
                onClearNavigationError={() => workbenchController.clearError()}
                onCreate={() => projectCanvasWorkbench.createCanvas(activeProject.id)}
                onDelete={(canvasId) => projectCanvasWorkbench.deleteCanvas(activeProject.id, canvasId)}
              />
            ),
            count: projectCanvasSnapshot.canvases.length,
            createLabel: "New canvas",
            label: "Canvases",
            onCreate: () => { void projectCanvasWorkbench.createCanvas(activeProject.id) },
          } : undefined}
          filesController={projectFilesController}
          hideWhenNoProject
          resolveFileUrl={({ path, projectId }) => projectAssetUrl(projectId, path)}
        />
        {activeProject && primarySidebar.visible ? (
          <div
            aria-label="Resize project sidebar"
            aria-orientation="vertical"
            aria-valuemax={primarySidebarBounds.maxSize}
            aria-valuemin={primarySidebarBounds.minSize}
            aria-valuenow={primarySidebar.size}
            className="absolute inset-y-0 -right-1 z-50 w-2 cursor-col-resize touch-none outline-none focus-visible:bg-primary/20"
            onKeyDown={(keyEvent) => {
              if (keyEvent.key !== "ArrowLeft" && keyEvent.key !== "ArrowRight") return
              keyEvent.preventDefault()
              resizeWorkbenchPartBy(
                WorkbenchLayoutParts.PrimarySidebar,
                keyEvent.key === "ArrowLeft" ? -24 : 24,
              )
            }}
            onPointerDown={(pointerEvent) => startWorkbenchPartResize(WorkbenchLayoutParts.PrimarySidebar, pointerEvent)}
            role="separator"
            tabIndex={0}
          />
        ) : null}
      </div>
      <section className="relative min-w-0 flex-1">
        {workbenchSnapshot.surface.kind === "empty" && workbenchSnapshot.surface.reason === "no-project" ? (
          <ProjectEmptyState controller={projectController} initialized={projectSnapshot.initialized} />
        ) : workbenchSnapshot.surface.kind === "file" ? (
          <div className="grid size-full place-items-center text-sm text-muted-foreground">File surface is not available yet.</div>
        ) : workbenchSnapshot.surface.kind === "empty" || !activeProject || !activeCanvas || !initialDocument ? (
          <ProjectLoadingState projectName={activeProject?.name ?? "Project"} />
        ) : (
          <CanvasEditor
            key={`${activeProject.id}:${activeCanvas.id}`}
            clipboardScope={activeProject.id}
            fileRendererRegistry={canvasFileRendererRegistry}
            initialDocument={initialDocument}
            nodeRegistry={canvasNodeRegistry}
            readOnly={workbenchSnapshot.changingInput || projectCanvasSnapshot.busy || projectSnapshot.changingActiveProject}
            ref={canvasEditorRef}
            services={services}
            title={activeCanvas.name}
            viewId="desktop-main"
            viewRegistry={canvasViewRegistry}
            viewScopeId={activeProject.id}
          />
        )}
      </section>
      <AgentPanel
        activeCanvas={activeCanvas}
        beforePrompt={flushCanvasForAgent}
        canvases={projectCanvasSnapshot.canvases}
        layout={{
          maxWidth: secondarySidebarBounds.maxSize,
          minWidth: secondarySidebarBounds.minSize,
          onOpenChange: (open) => workbenchLayoutController.setPartVisible(WorkbenchLayoutParts.SecondarySidebar, open),
          onResizeKeyDown: (keyEvent) => {
            if (keyEvent.key !== "ArrowLeft" && keyEvent.key !== "ArrowRight") return
            keyEvent.preventDefault()
            resizeWorkbenchPartBy(
              WorkbenchLayoutParts.SecondarySidebar,
              keyEvent.key === "ArrowLeft" ? 24 : -24,
            )
          },
          onResizeStart: (pointerEvent) => startWorkbenchPartResize(WorkbenchLayoutParts.SecondarySidebar, pointerEvent),
          open: secondarySidebar.visible,
          width: secondarySidebar.size,
        }}
        projectId={activeProjectId}
        projectName={activeProject?.name}
      />
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
reactRoot.render(<DesktopProtocolGate><App /></DesktopProtocolGate>)
