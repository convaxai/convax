import {
  CanvasEditor,
  type CanvasDocument,
  createDefaultCanvasFileRendererRegistry,
  createDefaultCanvasNodeRegistry,
  createCanvasViewRegistry,
  createCanvasServices,
  type CanvasEditorHandle,
  type CanvasGenerateService,
  type CanvasMediaKind,
  type CanvasNotification,
  type CanvasSelectionAction,
  type CanvasSelectionActionContext,
  type CanvasSelectionDragSource,
} from "@convax/canvas"
import { ProjectController, ProjectSidebar } from "@convax/project"
import { ProjectFilesController, type ProjectFileInfo } from "@convax/project-files"
import {
  dehydrateProjectCanvasDocument,
  ProjectCanvasController,
  hydrateProjectCanvasDocument,
  projectFileReferenceKey,
} from "@convax/project/canvas"
import { WorkbenchController, WorkbenchLayoutController, WorkbenchLayoutParts } from "@convax/workbench"
import {
  CheckCircle2,
  Clapperboard,
  Crop,
  FileOutput,
  ImageDown,
  Info,
  Layers3,
  MessageSquarePlus,
  PanelLeftOpen,
  Scissors,
  TriangleAlert,
  XCircle,
} from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import { createRoot } from "react-dom/client"
import { createAgentCanvasInstructions, createAgentCanvasNodeResource } from "../agent-canvas-context"
import { hasWebPluginCanvasSurface, type InstalledWebPluginSummary } from "../plugin-contracts"
import { jianyingBuiltinPluginId, jianyingBuiltinPluginVersion } from "../jianying-contracts"
import { AgentPanel, type AgentPanelHandle } from "./agent-panel"
import { AgentGenerationPreferenceProvider } from "./agent-generation-preference"
import { isGenerationModelTool } from "./agent-generation-models"
import { createAddSelectionToConversationAction } from "./agent-selection-action"
import {
  readAppLanguagePreference,
  resolveAppLocale,
  writeAppLanguagePreference,
  type AppLanguagePreference,
} from "./app-language"
import { ApplicationMenu, type ApplicationMenuTarget } from "./application-menu"
import { createRendererCanvasPersistence } from "./canvas-command-persistence"
import { createInitialCanvasDocument } from "./canvas-document"
import { CanvasCardConversationPanel, canvasCardAgentContextNodeIds } from "./canvas-card-conversation-panel"
import { createCanvasMediaSelectionDragSource } from "./canvas-media-drag-source"
import { createCanvasRendererRequestHandler } from "./canvas-renderer-request-handler"
import { resolveCanvasUploadItems } from "./canvas-upload"
import { DesktopProtocolGate } from "./desktop-protocol-gate"
import {
  canExportSelectionToJianying,
  exportCanvasMediaToJianying,
  normalizeJianyingRendererError,
} from "./jianying-selection-action"
import {
  canResumeMediaOperation,
  canRunMediaOperation,
  createMediaOperationGenerateRequests,
  isMediaOperationDialogInScope,
  listInstalledMediaOperationActions,
  localizedMediaOperationText,
  type MediaOperationDialogRequest,
  type MediaOperationEditor,
  type MediaOperationInput,
} from "./media-operation-selection-action"
import { MediaOperationDialog } from "./media-operation-dialog"
import {
  mediaOperationCancellationNotice,
  MediaOperationPartialError,
  type MediaOperationProgress,
  runMediaOperationSequence,
} from "./media-operation-runner"
import { DesktopPluginFrameRegistry } from "./plugin-frame-registry"
import { executePluginCanvasImageWrite } from "./plugin-canvas-image-write"
import { ProjectEmptyState, ProjectLoadingState } from "./project-empty-state"
import { ProjectCanvasSidebar } from "./project-canvas-sidebar"
import { ProjectCanvasWorkbenchCoordinator } from "./project-canvas-workbench"
import { RendererErrorBoundary } from "./renderer-error-boundary"
import { ServiceCatalogController } from "./service-catalog-controller"
import { SettingsView, type SettingsSection } from "./settings-view"
import { readWorkbenchLayoutPreferences, writeWorkbenchLayoutPreferences } from "./workbench-layout-preferences"
import { migrateLastCanvasPreference, writeLastCanvasPreference } from "./workbench-preferences"
import { createWebPluginCanvasContribution, type WebPluginCanvasHost } from "./web-plugin-canvas"
import { WebPluginGenerationProjectionCoordinator } from "./web-plugin-generation-projection"
import "./styles.css"

const primarySidebarBounds = { defaultSize: 292, defaultVisible: true, maxSize: 480, minSize: 220 }
const secondarySidebarBounds = { defaultSize: 380, defaultVisible: true, maxSize: 4096, minSize: 300 }
const primarySidebarCollapseThreshold = 180
const secondarySidebarCollapseThreshold = 260
const collapsedPrimarySidebarSize = 44
const collapsedSecondarySidebarSize = 44
const minimumCanvasPeekSize = 160
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
  if (sourceTokens.some((token) => !token))
    throw new Error("Only files from the local disk can be added to a project canvas")
  const imported = await window.convax.projectFiles.importEntries({
    destinationPath: ".convax/assets",
    projectId,
    sourceTokens,
  })
  const projectFiles = await Promise.all(
    (imported.targetPaths ?? []).map((path) => window.convax.projectFiles.readFileInfo({ path, projectId })),
  )
  if (signal.aborted) throw signal.reason
  return projectFiles
}

async function copyCanvasProjectFiles(paths: string[], projectId: string, signal: AbortSignal) {
  if (paths.length === 0) return []
  await ensureProjectAssetsDirectory(projectId)
  const copied = await window.convax.projectFiles.copyEntries({ destinationPath: ".convax/assets", paths, projectId })
  const projectFiles = await Promise.all(
    (copied.targetPaths ?? []).map((path) => window.convax.projectFiles.readFileInfo({ path, projectId })),
  )
  if (signal.aborted) throw signal.reason
  return projectFiles
}

function hydrateRendererCanvasDocument(document: CanvasDocument, projectId: string, title?: string) {
  return hydrateProjectCanvasDocument(
    {
      ...document,
      metadata: { ...document.metadata, title: title ?? document.metadata.title },
    },
    ({ path }) => projectAssetUrl(projectId, path),
  )
}

function mediaOperationActionIcon(editor: MediaOperationEditor) {
  if (editor === "time-point") return <ImageDown />
  if (editor === "time-range") return <Scissors />
  if (editor === "crop-region") return <Crop />
  return <Layers3 />
}

function App() {
  const [notification, setNotification] = useState<CanvasNotification | null>(null)
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth)
  const [languagePreference, setLanguagePreference] = useState<AppLanguagePreference>(() =>
    readAppLanguagePreference(localStorage),
  )
  const [settingsSection, setSettingsSection] = useState<SettingsSection | null>(null)
  const [mediaOperationDialog, setMediaOperationDialog] = useState<MediaOperationDialogRequest | null>(null)
  const mediaOperationProgressRef = useRef(new WeakMap<MediaOperationDialogRequest, MediaOperationProgress>())
  const closeMediaOperationDialog = useCallback(() => setMediaOperationDialog(null), [])
  const locale = useMemo(() => resolveAppLocale(languagePreference), [languagePreference])
  const canvasEditorRef = useRef<CanvasEditorHandle>(null)
  const agentPanelRef = useRef<AgentPanelHandle>(null)
  const canvasNodeRegistry = useMemo(() => createDefaultCanvasNodeRegistry(), [])
  const canvasFileRendererRegistry = useMemo(() => createDefaultCanvasFileRendererRegistry(), [])
  const canvasViewRegistry = useMemo(() => createCanvasViewRegistry(), [])
  const pluginFrameRegistry = useMemo(() => new DesktopPluginFrameRegistry(), [])
  const webPluginGenerationProjection = useMemo(() => new WebPluginGenerationProjectionCoordinator(), [])
  const [installedPlugins, setInstalledPlugins] = useState<InstalledWebPluginSummary[]>([])
  const mediaOperationActions = useMemo(() => listInstalledMediaOperationActions(installedPlugins), [installedPlugins])
  const generationToolCatalogVersionRef = useRef("")
  generationToolCatalogVersionRef.current = JSON.stringify(
    installedPlugins.flatMap((plugin) =>
      plugin.contributes.generation
        ? [
            {
              id: plugin.id,
              generation: plugin.contributes.generation,
              runtime: plugin.runtime,
              version: plugin.version,
            },
          ]
        : [],
    ),
  )
  const pluginHostContextRef = useRef<{
    activeCanvas?: { id: string; name: string }
    activeProject?: { id: string; name: string }
  }>({})
  const latestCanvasSaveRef = useRef<Promise<CanvasDocument> | null>(null)
  const drainCanvasSaves = useCallback(async (): Promise<CanvasDocument | undefined> => {
    let authoritativeDocument: CanvasDocument | undefined
    while (true) {
      const pending = latestCanvasSaveRef.current
      if (!pending) return authoritativeDocument
      try {
        authoritativeDocument = await pending
      } catch (error) {
        if (latestCanvasSaveRef.current !== pending) continue
        throw error
      }
      if (latestCanvasSaveRef.current === pending) return authoritativeDocument
    }
  }, [])
  const flushAuthoritativeCanvas = useCallback(async () => {
    const flushedDocument = await canvasEditorRef.current?.flush()
    return (await drainCanvasSaves()) ?? flushedDocument
  }, [drainCanvasSaves])
  const flushCanvasForAgent = useCallback(async () => {
    await flushAuthoritativeCanvas()
  }, [flushAuthoritativeCanvas])
  const projectController = useMemo(
    () =>
      new ProjectController(window.convax.projects, {
        beforeActiveProjectChange: async () => {
          await canvasEditorRef.current?.prepareToLeave()
          await drainCanvasSaves()
        },
        onActiveProjectChangeCanceled: () => canvasEditorRef.current?.resumeAfterLeaveCanceled(),
      }),
    [drainCanvasSaves],
  )
  const projectFilesController = useMemo(() => new ProjectFilesController(window.convax.projectFiles), [])
  const projectCanvasController = useMemo(() => new ProjectCanvasController(window.convax.projects.canvases), [])
  const serviceCatalogController = useMemo(
    () => new ServiceCatalogController(window.convax.pluginServices, window.convax.agent),
    [],
  )
  const workbenchLayoutController = useMemo(() => {
    const preferences = readWorkbenchLayoutPreferences(localStorage, {
      primarySidebar: primarySidebarBounds,
      secondarySidebar: secondarySidebarBounds,
    })
    return new WorkbenchLayoutController({
      parts: {
        [WorkbenchLayoutParts.PrimarySidebar]: {
          collapseThreshold: primarySidebarCollapseThreshold,
          initialSize: preferences.primarySidebar.size,
          initialVisible: preferences.primarySidebar.visible,
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
  const workbenchController = useMemo(
    () =>
      new WorkbenchController({
        beforeInputChange: async (currentInput) => {
          if (currentInput?.kind === "canvas") {
            await canvasEditorRef.current?.prepareToLeave()
            await drainCanvasSaves()
          }
        },
        onInputChangeCanceled: () => canvasEditorRef.current?.resumeAfterLeaveCanceled(),
      }),
    [drainCanvasSaves],
  )
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
  const serviceCatalogSnapshot = useSyncExternalStore(
    serviceCatalogController.subscribe,
    serviceCatalogController.getSnapshot,
    serviceCatalogController.getSnapshot,
  )
  useEffect(() => () => projectController.dispose(), [projectController])
  useEffect(() => () => projectFilesController.dispose(), [projectFilesController])
  useEffect(() => () => projectCanvasController.dispose(), [projectCanvasController])
  useEffect(() => () => workbenchController.dispose(), [workbenchController])
  useEffect(() => () => workbenchLayoutController.dispose(), [workbenchLayoutController])
  useEffect(() => {
    serviceCatalogController.start()
    return () => serviceCatalogController.dispose()
  }, [serviceCatalogController])
  useEffect(() => {
    const updateViewportWidth = () => setViewportWidth(window.innerWidth)
    window.addEventListener("resize", updateViewportWidth)
    return () => window.removeEventListener("resize", updateViewportWidth)
  }, [])
  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])
  useEffect(() => {
    const synchronizeStoredLanguage = () => setLanguagePreference(readAppLanguagePreference(localStorage))
    window.addEventListener("storage", synchronizeStoredLanguage)
    return () => {
      window.removeEventListener("storage", synchronizeStoredLanguage)
    }
  }, [])
  useEffect(() => {
    const openSettingsShortcut = (event: KeyboardEvent) => {
      if ((!event.metaKey && !event.ctrlKey) || event.altKey || event.key !== ",") return
      event.preventDefault()
      closeMediaOperationDialog()
      setSettingsSection("general")
    }
    window.addEventListener("keydown", openSettingsShortcut)
    return () => window.removeEventListener("keydown", openSettingsShortcut)
  }, [closeMediaOperationDialog])
  useEffect(() => {
    if (!settingsSection) return
    const closeSettings = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSettingsSection(null)
    }
    window.addEventListener("keydown", closeSettings)
    return () => window.removeEventListener("keydown", closeSettings)
  }, [settingsSection])
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
  useEffect(() => {
    serviceCatalogController.setScopeId(activeProjectId)
  }, [activeProjectId, serviceCatalogController])
  const activeCanvasId =
    workbenchSnapshot.surface.kind === "canvas" && workbenchSnapshot.surface.input.projectId === activeProjectId
      ? workbenchSnapshot.surface.input.canvasId
      : undefined
  const activeCanvas =
    activeCanvasId && projectCanvasSnapshot.projectId === activeProjectId
      ? projectCanvasSnapshot.canvases.find((canvas) => canvas.id === activeCanvasId)
      : undefined
  const activeMediaOperationDialog = isMediaOperationDialogInScope(
    mediaOperationDialog,
    activeProjectId,
    activeCanvasId,
  )
    ? mediaOperationDialog
    : null
  pluginHostContextRef.current = { activeCanvas, activeProject }
  useEffect(() => {
    setMediaOperationDialog((current) =>
      current && !isMediaOperationDialogInScope(current, activeProjectId, activeCanvasId) ? null : current,
    )
  }, [activeCanvasId, activeProjectId])

  const webPluginHost = useMemo<WebPluginCanvasHost>(() => {
    const currentScope = (projectId: string, canvasId: string) => {
      const current = pluginHostContextRef.current
      if (current.activeProject?.id !== projectId || current.activeCanvas?.id !== canvasId) {
        throw new Error("Plugin call is no longer in the active Project and Canvas")
      }
      return current
    }
    const throwIfAborted = (signal: AbortSignal) => {
      if (signal.aborted) throw signal.reason ?? new Error("Plugin call was canceled")
    }
    return {
      async createCanvasImage(input) {
        const operationId = globalThis.crypto.randomUUID()
        return executePluginCanvasImageWrite(input, {
          assertCurrentScope: (projectId, canvasId) => {
            currentScope(projectId, canvasId)
          },
          cancel: () => window.convax.canvas.pluginImages.cancel({ operationId }),
          flushAuthoritativeCanvas: async () => {
            await flushAuthoritativeCanvas()
            return (
              await window.convax.canvas.documents.load({
                canvasId: input.canvasId,
                scopeId: input.projectId,
              })
            ).document ?? undefined
          },
          write: (authoritativeDocument) =>
            window.convax.canvas.pluginImages.create({
              dataUrl: input.dataUrl,
              expectedRevision: authoritativeDocument.revision,
              name: input.name,
              operationId,
              ownerNodeId: input.nodeId,
              pluginId: input.pluginId,
              pluginVersion: input.pluginVersion,
              ref: { canvasId: input.canvasId, scopeId: input.projectId },
            }),
        })
      },
      async executeCanvasGeneration(input) {
        throwIfAborted(input.signal)
        currentScope(input.projectId, input.canvasId)
        const authoritativeDocument = await flushAuthoritativeCanvas()
        throwIfAborted(input.signal)
        currentScope(input.projectId, input.canvasId)
        if (!authoritativeDocument || authoritativeDocument.id !== input.canvasId) {
          throw new Error("Canvas generation could not resolve Main's authoritative document")
        }
        const operationId = globalThis.crypto.randomUUID()
        const cancel = () => window.convax.generation.cancel({ operationId })
        input.signal.addEventListener("abort", cancel, { once: true })
        try {
          const result = await webPluginGenerationProjection.execute(
            input,
            () =>
              window.convax.generation.generate({
                anchor: input.anchor,
                expectedRevision: authoritativeDocument.revision,
                operationId,
                ...(input.output ? { output: input.output } : {}),
                prompt: input.prompt,
                ref: { canvasId: input.canvasId, scopeId: input.projectId },
                referenceConstraint: { ownerNodeId: input.nodeId, type: "direct-incoming" },
                references: input.references,
                ...(input.resultMode ? { resultMode: { type: input.resultMode } } : {}),
                ...(input.toolId ? { toolId: input.toolId } : {}),
              }),
            async () => {
              const current = pluginHostContextRef.current
              const editor = canvasEditorRef.current
              if (
                !editor ||
                current.activeProject?.id !== input.projectId ||
                current.activeCanvas?.id !== input.canvasId
              ) {
                return
              }
              await editor.reloadAuthoritative()
            },
          )
          throwIfAborted(input.signal)
          currentScope(input.projectId, input.canvasId)
          return result
        } finally {
          input.signal.removeEventListener("abort", cancel)
        }
      },
      getActiveContext() {
        const current = pluginHostContextRef.current
        if (!current.activeProject || !current.activeCanvas) return null
        return {
          canvasId: current.activeCanvas.id,
          canvasName: current.activeCanvas.name,
          projectId: current.activeProject.id,
          projectName: current.activeProject.name,
        }
      },
      async listGenerationTools(input) {
        throwIfAborted(input.signal)
        currentScope(input.projectId, input.canvasId)
        const tools = await window.convax.generation.listTools({
          ...(input.output ? { output: input.output } : {}),
          scopeId: input.projectId,
        })
        throwIfAborted(input.signal)
        currentScope(input.projectId, input.canvasId)
        return tools.map((tool) => ({
          acceptedInputs: tool.acceptedInputs,
          description: tool.description,
          id: tool.id,
          kind: tool.kind,
          output: tool.output,
          title: tool.title,
        }))
      },
      async promptAgent(input) {
        throwIfAborted(input.signal)
        const initial = currentScope(input.projectId, input.canvasId)
        await flushCanvasForAgent()
        throwIfAborted(input.signal)
        currentScope(input.projectId, input.canvasId)

        const session = await window.convax.agent.createSession({
          scopeId: input.projectId,
          title: `Plugin: ${input.pluginName}`,
        })
        const abortSession = () => {
          void window.convax.agent
            .abort({
              scopeId: input.projectId,
              sessionId: session.id,
            })
            .catch(() => undefined)
        }
        input.signal.addEventListener("abort", abortSession, { once: true })
        try {
          throwIfAborted(input.signal)
          currentScope(input.projectId, input.canvasId)
          const resource = createAgentCanvasNodeResource(input.canvasId, input.nodeId, `${input.pluginName} node`)
          const message = await window.convax.agent.prompt({
            instructions: [
              ...createAgentCanvasInstructions({
                activeCanvas: initial.activeCanvas,
                resources: [resource],
              }),
              `A sandboxed Convax Plugin named ${JSON.stringify(input.pluginName)} requested this response through its declared Agent capability. Keep every tool call in the authoritative active Project and Canvas scope.`,
            ],
            resources: [resource],
            scopeId: input.projectId,
            sessionId: session.id,
            text: input.text,
          })
          throwIfAborted(input.signal)
          currentScope(input.projectId, input.canvasId)
          if (message.error) throw new Error(message.error)
          return {
            text: message.parts
              .filter((part) => part.type === "text")
              .map((part) => part.text)
              .join("\n\n"),
          }
        } finally {
          input.signal.removeEventListener("abort", abortSession)
        }
      },
      async readProjectText(input) {
        throwIfAborted(input.signal)
        const current = pluginHostContextRef.current
        if (current.activeProject?.id !== input.projectId || !current.activeCanvas) {
          throw new Error("Plugin call is no longer in the active Project")
        }
        const result = await window.convax.projectFiles.readTextFile({
          path: input.path,
          projectId: input.projectId,
        })
        throwIfAborted(input.signal)
        const latest = pluginHostContextRef.current
        if (latest.activeProject?.id !== input.projectId || latest.activeCanvas?.id !== current.activeCanvas.id) {
          throw new Error("Plugin call completed after its Project or Canvas changed")
        }
        return result
      },
      async readManagedProjectImage(input) {
        throwIfAborted(input.signal)
        const current = pluginHostContextRef.current
        if (current.activeProject?.id !== input.projectId || !current.activeCanvas) {
          throw new Error("Plugin call is no longer in the active Project")
        }
        const result = await window.convax.projectFiles.readManagedImageFile({
          path: input.path,
          projectId: input.projectId,
        })
        throwIfAborted(input.signal)
        const latest = pluginHostContextRef.current
        if (latest.activeProject?.id !== input.projectId || latest.activeCanvas?.id !== current.activeCanvas.id) {
          throw new Error("Plugin call completed after its Project or Canvas changed")
        }
        return result
      },
      async waitForGenerationProjection(input) {
        await webPluginGenerationProjection.wait(input, input.signal)
      },
    }
  }, [flushAuthoritativeCanvas, webPluginGenerationProjection])

  useEffect(() => {
    let active = true
    let request = 0
    const refresh = async () => {
      const current = ++request
      try {
        const inventory = await window.convax.plugins.listPlugins()
        if (active && current === request) setInstalledPlugins(inventory.installed)
      } catch (error) {
        if (active && current === request) console.error("Could not load installed Canvas Plugins", error)
      }
    }
    void refresh()
    const unsubscribe = window.convax.plugins.onDidChange(() => void refresh())
    return () => {
      active = false
      request += 1
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    const disposers: Array<() => void> = []
    for (const plugin of installedPlugins) {
      if (!hasWebPluginCanvasSurface(plugin)) continue
      try {
        disposers.push(
          canvasFileRendererRegistry.registerPlugin(
            createWebPluginCanvasContribution(plugin, {
              frameRegistry: pluginFrameRegistry,
              host: webPluginHost,
            }),
          ),
        )
      } catch (error) {
        console.error(`Could not register Canvas Plugin ${plugin.id}`, error)
      }
    }
    return () => disposers.reverse().forEach((dispose) => dispose())
  }, [canvasFileRendererRegistry, installedPlugins, pluginFrameRegistry, webPluginHost])
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
    generationCatalogVersion: generationToolCatalogVersionRef.current,
  })
  assistantHostRef.current = {
    activeCanvas,
    activeProject,
    beforePrompt: flushCanvasForAgent,
    canvases: projectCanvasSnapshot.canvases,
    generationCatalogVersion: generationToolCatalogVersionRef.current,
  }
  const canvasRendererRequestHandler = useMemo(
    () =>
      createCanvasRendererRequestHandler({
        getActiveRef: () => {
          const current = pluginHostContextRef.current
          return current.activeProject && current.activeCanvas
            ? { canvasId: current.activeCanvas.id, scopeId: current.activeProject.id }
            : null
        },
        getEditor: () => canvasEditorRef.current,
        views: canvasViewRegistry,
      }),
    [canvasViewRegistry],
  )
  useEffect(() => window.convax.canvas.renderer.onRequest(canvasRendererRequestHandler), [canvasRendererRequestHandler])
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
  const services = useMemo(() => {
    const generateService: CanvasGenerateService = {
      get catalogVersion() {
        return generationToolCatalogVersionRef.current
      },
      async describeTool(toolId, signal) {
        if (!activeProjectId || !activeCanvasId) {
          throw new Error("Open a Project Canvas before configuring a generation model")
        }
        if (signal?.aborted) throw signal.reason
        const description = await window.convax.generation.describeTool({
          scopeId: activeProjectId,
          toolId,
        })
        if (signal?.aborted) throw signal.reason
        return description
      },
      async listTools(query, signal) {
        if (!activeProjectId || !activeCanvasId) return []
        if (signal?.aborted) throw signal.reason
        const tools = await window.convax.generation.listTools({
          ...(query.output ? { output: query.output } : {}),
          scopeId: activeProjectId,
        })
        if (signal?.aborted) throw signal.reason
        return tools.filter(isGenerationModelTool).map((tool) => ({
          acceptedInputs: tool.acceptedInputs,
          description: tool.description,
          id: tool.id,
          output: tool.output,
          title: tool.title,
        }))
      },
      async generate(request) {
        if (!activeProjectId || !activeCanvasId) {
          throw new Error("Open a Project Canvas before generating content")
        }
        if (request.context.documentId !== activeCanvasId) {
          throw new Error("Generation must target the active Canvas")
        }
        if (request.signal.aborted) throw request.signal.reason
        const authoritativeDocument = await flushAuthoritativeCanvas()
        if (request.signal.aborted) throw request.signal.reason
        const live = pluginHostContextRef.current
        if (live.activeProject?.id !== activeProjectId || live.activeCanvas?.id !== activeCanvasId) {
          throw new Error("Generation must target the live active Canvas")
        }
        if (!authoritativeDocument || authoritativeDocument.id !== activeCanvasId) {
          throw new Error("Generation could not resolve Main's authoritative Canvas document")
        }
        const operationId = globalThis.crypto.randomUUID()
        const cancel = () => window.convax.generation.cancel({ operationId })
        request.signal.addEventListener("abort", cancel, { once: true })
        try {
          const result = await window.convax.generation.generate({
            anchor: request.anchor,
            ...(request.expectedOutputCount ? { expectedOutputCount: request.expectedOutputCount } : {}),
            expectedRevision: authoritativeDocument.revision,
            operationId,
            ...(request.output ? { output: request.output } : {}),
            prompt: request.prompt,
            ref: { canvasId: activeCanvasId, scopeId: activeProjectId },
            references: request.references,
            ...(request.relationAnchorNodeIds ? { relationAnchorNodeIds: request.relationAnchorNodeIds } : {}),
            ...(request.resultMode ? { resultMode: request.resultMode } : {}),
            ...(request.toolId ? { toolId: request.toolId } : {}),
            ...(request.toolInput ? { toolInput: request.toolInput } : {}),
          })
          if (request.signal.aborted) throw request.signal.reason
          return result
        } finally {
          request.signal.removeEventListener("abort", cancel)
        }
      },
    }
    return createCanvasServices({
      assistant: {
        render(request) {
          const host = assistantHostRef.current
          const contextResources = canvasCardAgentContextNodeIds(request).flatMap((nodeId) => {
            const node = request.document.nodes.find((candidate) => candidate.id === nodeId)
            return node ? [createAgentCanvasNodeResource(request.document.id, node.id, node.data.label)] : []
          })
          const agent = (
            <AgentPanel
              activeCanvas={host.activeCanvas}
              beforePrompt={host.beforePrompt}
              canvases={host.canvases}
              className="!h-full !min-h-0 rounded-none border-0"
              contextResources={contextResources}
              conversationKey={JSON.stringify([request.document.id, request.ownerNodeId])}
              embedded
              embeddedHeader={request.mode !== "file"}
              generationCatalogVersion={host.generationCatalogVersion}
              projectId={host.activeProject?.id}
              projectName={host.activeProject?.name}
            />
          )
          return request.mode === "file" ? (
            <CanvasCardConversationPanel
              agent={agent}
              catalogVersion={host.generationCatalogVersion}
              request={request}
              service={generateService}
            />
          ) : (
            agent
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
      generate: generateService,
      persistence:
        activeProjectId && activeCanvasId
          ? createRendererCanvasPersistence({
              client: window.convax.canvas.documents,
              commandId: () => `renderer-${globalThis.crypto.randomUUID()}`,
              dehydrate: dehydrateProjectCanvasDocument,
              hydrate: (document) =>
                hydrateRendererCanvasDocument(document, activeProjectId, activeCanvasNameRef.current),
              onSavePending: (pending) => {
                latestCanvasSaveRef.current = pending
              },
              ref: { canvasId: activeCanvasId, scopeId: activeProjectId },
            })
          : undefined,
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
  }, [activeCanvasId, activeProjectId, flushAuthoritativeCanvas])

  const runMediaOperation = useCallback(
    async (request: MediaOperationDialogRequest, input: MediaOperationInput, signal: AbortSignal) => {
      const hasMultipleSteps = request.action.steps.length > 1
      if (signal.aborted) {
        if (hasMultipleSteps) {
          const notice = mediaOperationCancellationNotice(locale, undefined)
          setNotification({ description: notice.description, kind: "warning", title: notice.title })
        }
        throw signal.reason ?? new DOMException("Canceled", "AbortError")
      }
      const requests = createMediaOperationGenerateRequests(request, input, signal)
      let initialProgress = mediaOperationProgressRef.current.get(request) ?? {
        createdNodeIds: [],
        nextRequestIndex: 0,
        revision: request.context.document.revision,
        warnings: [],
      }
      if (initialProgress.nextRequestIndex > 0) {
        let snapshot: Awaited<ReturnType<typeof window.convax.canvas.documents.load>>
        try {
          await flushCanvasForAgent()
          if (signal.aborted) throw signal.reason ?? new DOMException("Canceled", "AbortError")
          snapshot = await window.convax.canvas.documents.load({
            canvasId: request.canvasId,
            scopeId: request.projectId,
          })
          if (signal.aborted) throw signal.reason ?? new DOMException("Canceled", "AbortError")
        } catch (failure) {
          if (signal.aborted) {
            mediaOperationProgressRef.current.delete(request)
            const notice = mediaOperationCancellationNotice(locale, initialProgress)
            setNotification({ description: notice.description, kind: "warning", title: notice.title })
            throw failure
          }
          const message =
            locale === "zh-CN"
              ? "暂时无法确认画布中的部分结果。可重试验证，已经完成的步骤不会重复执行。"
              : "The partial Canvas result could not be verified yet. Retry validation without repeating completed steps."
          throw new MediaOperationPartialError(message, initialProgress, { cause: failure })
        }
        if (
          !snapshot.document ||
          !canResumeMediaOperation(request, snapshot.document, initialProgress.createdNodeIds)
        ) {
          mediaOperationProgressRef.current.delete(request)
          setMediaOperationDialog((current) => (current === request ? null : current))
          setNotification({
            description:
              locale === "zh-CN"
                ? "源视频或已创建的结果发生了变化，请重新选择源视频后再执行此操作。"
                : "The source video or a completed result changed. Select the source video and start the operation again.",
            kind: "warning",
            title: locale === "zh-CN" ? "无法继续媒体操作" : "Media operation cannot continue",
          })
          throw new Error("The Plugin media operation cannot resume because its Canvas inputs changed")
        }
        initialProgress = { ...initialProgress, revision: snapshot.document.revision }
        mediaOperationProgressRef.current.set(request, initialProgress)
      }
      let progress: MediaOperationProgress
      try {
        progress = await runMediaOperationSequence({
          generate: (generateRequest) => services.require("generate").generate(generateRequest),
          initialProgress,
          onProgress: (current) => mediaOperationProgressRef.current.set(request, current),
          partialFailureMessage: (failure) => {
            const detail = failure instanceof Error ? failure.message : String(failure)
            return locale === "zh-CN"
              ? `已完成部分结果，但后续步骤失败。可直接重试，已完成的步骤不会重复执行。\n${detail}`
              : `Some results were created, but a later step failed. Retry without repeating completed steps.\n${detail}`
          },
          requests,
          signal,
        })
      } catch (failure) {
        const savedProgress = mediaOperationProgressRef.current.get(request)
        if (signal.aborted && hasMultipleSteps) {
          mediaOperationProgressRef.current.delete(request)
          const notice = mediaOperationCancellationNotice(locale, savedProgress)
          setNotification({
            description: notice.description,
            kind: "warning",
            title: notice.title,
          })
        }
        throw failure
      }
      mediaOperationProgressRef.current.delete(request)
      if (signal.aborted) return
      setMediaOperationDialog((current) => (current === request ? null : current))
      setNotification({
        description: progress.warnings.length
          ? progress.warnings.join("\n")
          : locale === "zh-CN"
            ? `已创建 ${progress.createdNodeIds.length} 个新节点。`
            : `${progress.createdNodeIds.length} new node${progress.createdNodeIds.length === 1 ? "" : "s"} created.`,
        kind: progress.warnings.length > 0 ? "warning" : "success",
        title:
          locale === "zh-CN"
            ? `${localizedMediaOperationText(request.action.title, locale)}完成`
            : `${localizedMediaOperationText(request.action.title, locale)} complete`,
      })
    },
    [flushCanvasForAgent, locale, services],
  )

  const selectionActions = useMemo<readonly CanvasSelectionAction[]>(
    () => [
      createAddSelectionToConversationAction({
        addResources(resources) {
          const panel = agentPanelRef.current
          if (!panel) throw new Error("The Agent panel is not ready")
          panel.addResources(resources)
        },
        canvasId: activeCanvasId,
        icon: <MessageSquarePlus />,
        label: locale === "zh-CN" ? "添加到对话" : "Add to conversation",
      }),
      {
        id: "jianying.import-media",
        label: "导入到剪映",
        icon: <Clapperboard />,
        visible(context) {
          const pluginEnabled = installedPlugins.some(
            (plugin) =>
              plugin.id === jianyingBuiltinPluginId &&
              plugin.version === jianyingBuiltinPluginVersion &&
              plugin.trustedBuiltin === true,
          )
          return window.convax.platform === "darwin" && pluginEnabled && canExportSelectionToJianying(context)
        },
        async execute(context) {
          if (!activeProjectId || !activeCanvasId) {
            throw new Error("Open a Project Canvas before exporting to JianYing")
          }
          try {
            await flushCanvasForAgent()
            if (context.signal.aborted) throw context.signal.reason ?? new DOMException("Canceled", "AbortError")
            const result = await exportCanvasMediaToJianying(
              window.convax.jianying,
              {
                expectedRevision: context.document.revision,
                nodeIds: [...context.selectedNodeIds],
                ref: { canvasId: activeCanvasId, scopeId: activeProjectId },
                target: { kind: "current-or-new" },
              },
              context.signal,
            )
            if (context.signal.aborted) return
            const confirmed = result.importStatus === "confirmed"
            setNotification({
              description: `${result.importedMediaCount} 个素材${confirmed ? "已导入" : "已发送"}到“${result.draftName}”${result.createdDraft ? "（新草稿）" : ""}`,
              kind: "success",
              title: confirmed ? "已导入到剪映" : "已发送到剪映",
            })
          } catch (error) {
            throw normalizeJianyingRendererError(error)
          }
        },
      },
      ...mediaOperationActions.map((action) => ({
        id: `plugin-selection-action:${action.pluginId}/${action.id}`,
        label: localizedMediaOperationText(action.title, locale),
        icon: mediaOperationActionIcon(action.editor),
        visible(context: CanvasSelectionActionContext) {
          return canRunMediaOperation(context, action)
        },
        execute(context: CanvasSelectionActionContext) {
          if (!activeCanvasId || !activeProjectId) return
          setMediaOperationDialog({ action, canvasId: activeCanvasId, context, projectId: activeProjectId })
        },
      })),
    ],
    [activeCanvasId, activeProjectId, flushCanvasForAgent, installedPlugins, locale, mediaOperationActions],
  )

  const selectionDragSource = useMemo<CanvasSelectionDragSource | undefined>(() => {
    const client = window.convax.canvas.externalMediaDrag
    if (window.convax.platform !== "darwin" || !activeCanvasId || !activeProjectId || !client) return undefined
    return createCanvasMediaSelectionDragSource({
      client,
      flush: flushCanvasForAgent,
      icon: <FileOutput />,
      label:
        locale === "zh-CN" ? "继续按住 ⌘⇧，拖到 Finder、剪映或其他应用" : "Keep holding ⌘⇧ and drag outside Convax",
      mode: {
        description:
          locale === "zh-CN"
            ? "已进入跨应用拖出模式。拖动已选素材会将文件拖到其他 App；仍可选择素材、移动和缩放画布。"
            : "Drag selected media to another app. You can still select media, pan, and zoom the canvas.",
        exitLabel: locale === "zh-CN" ? "退出" : "Exit",
        label: locale === "zh-CN" ? "跨应用拖出" : "Drag to Other Apps",
        preparingLabel: locale === "zh-CN" ? "正在准备选中素材" : "Preparing selected media",
      },
      preparingLabel: locale === "zh-CN" ? "正在准备素材，请继续按住 ⌘⇧" : "Preparing media — keep holding ⌘⇧",
      scopeId: activeProjectId,
    })
  }, [activeCanvasId, activeProjectId, flushCanvasForAgent, locale])

  useEffect(() => {
    if (!notification) return
    const timeout = window.setTimeout(() => setNotification(null), 2_800)
    return () => window.clearTimeout(timeout)
  }, [notification])

  const resizeWorkbenchPartBy = useCallback(
    (partId: string, delta: number) => {
      if (!workbenchLayoutController.beginResize(partId)) return
      try {
        workbenchLayoutController.updateResize(delta)
        workbenchLayoutController.endResize()
      } catch (error) {
        workbenchLayoutController.cancelResize()
        throw error
      }
    },
    [workbenchLayoutController],
  )

  const startWorkbenchPartResize = useCallback(
    (partId: string, event: React.PointerEvent<HTMLDivElement>) => {
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
        const occupiedBySecondary = overlays ? 0 : secondary.visible ? secondary.size : collapsedSecondarySidebarSize
        const available =
          partId === WorkbenchLayoutParts.PrimarySidebar
            ? window.innerWidth - occupiedBySecondary - minimumCanvasPeekSize
            : overlays
              ? window.innerWidth - 96
              : window.innerWidth -
                (primary.visible ? primary.size : collapsedPrimarySidebarSize) -
                minimumCanvasPeekSize
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
    },
    [workbenchLayoutController],
  )

  const primarySidebar = workbenchLayoutSnapshot.parts[WorkbenchLayoutParts.PrimarySidebar]!
  const secondarySidebar = workbenchLayoutSnapshot.parts[WorkbenchLayoutParts.SecondarySidebar]!
  const primarySidebarOccupiedSize = primarySidebar.visible ? primarySidebar.size : collapsedPrimarySidebarSize
  const secondarySidebarAvailableSize = Math.max(
    secondarySidebarBounds.minSize,
    viewportWidth <= overlaySidebarBreakpoint
      ? viewportWidth - 96
      : viewportWidth - primarySidebarOccupiedSize - minimumCanvasPeekSize,
  )
  const secondarySidebarMaxWidthStyle =
    viewportWidth <= overlaySidebarBreakpoint
      ? "calc(100vw - 96px)"
      : `calc(100vw - ${primarySidebarOccupiedSize + minimumCanvasPeekSize}px)`
  const resizingPrimarySidebar = workbenchLayoutSnapshot.resize?.partId === WorkbenchLayoutParts.PrimarySidebar
  const resizingSecondarySidebar = workbenchLayoutSnapshot.resize?.partId === WorkbenchLayoutParts.SecondarySidebar
  const openSettings = useCallback(
    (target: ApplicationMenuTarget) => {
      closeMediaOperationDialog()
      setSettingsSection(target)
    },
    [closeMediaOperationDialog],
  )
  const changeLanguage = useCallback((preference: AppLanguagePreference) => {
    setLanguagePreference(preference)
    writeAppLanguagePreference(localStorage, preference)
  }, [])
  const rendererScopeKey = `${activeProjectId ?? "no-project"}:${activeCanvasId ?? "no-canvas"}`
  const rendererFailureCopy =
    locale === "zh-CN"
      ? {
          agentDescription: "其他区域仍可继续使用。你可以单独重试智能助手面板。",
          agentTitle: "智能助手面板暂时无法显示",
          canvasDescription: "项目和智能助手仍可继续使用。你可以单独重试当前画布。",
          canvasTitle: "当前画布暂时无法显示",
          retry: "重试",
        }
      : {
          agentDescription: "The rest of Convax is still available. You can retry only the Agent panel.",
          agentTitle: "The Agent panel could not render",
          canvasDescription: "The project and Agent remain available. You can retry only this Canvas.",
          canvasTitle: "This Canvas could not render",
          retry: "Retry",
        }

  useEffect(() => {
    if (!activeProject || workbenchLayoutSnapshot.resize || !secondarySidebar.visible) return
    if (secondarySidebar.size > secondarySidebarAvailableSize) {
      workbenchLayoutController.setPartSize(WorkbenchLayoutParts.SecondarySidebar, secondarySidebarAvailableSize)
    }
  }, [
    activeProject,
    secondarySidebar.size,
    secondarySidebar.visible,
    secondarySidebarAvailableSize,
    workbenchLayoutController,
    workbenchLayoutSnapshot.resize,
  ])

  return (
    <AgentGenerationPreferenceProvider storage={localStorage}>
      <main
        aria-hidden={settingsSection || activeMediaOperationDialog ? true : undefined}
        className={`relative flex size-full overflow-hidden bg-background${workbenchLayoutSnapshot.resize ? " cursor-col-resize select-none" : ""}`}
        inert={Boolean(settingsSection || activeMediaOperationDialog) || undefined}
      >
        <div
          className={`relative h-full shrink-0 overflow-hidden${!resizingPrimarySidebar || !primarySidebar.visible ? " transition-[width] duration-200 ease-out motion-reduce:transition-none" : ""}`}
          style={{ width: activeProject ? primarySidebarOccupiedSize : 0 }}
        >
          {!activeProject || primarySidebar.visible ? (
            <ProjectSidebar
              className="w-full"
              controller={projectController}
              extension={
                activeProject
                  ? {
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
                      onCreate: () => {
                        void projectCanvasWorkbench.createCanvas(activeProject.id)
                      },
                    }
                  : undefined
              }
              filesController={projectFilesController}
              footerActions={
                <ApplicationMenu locale={locale} onOpenSettings={openSettings} services={serviceCatalogSnapshot} />
              }
              hideWhenNoProject
              resolveFileUrl={({ path, projectId }) => projectAssetUrl(projectId, path)}
            />
          ) : (
            <aside className="flex h-full w-full flex-col items-center border-r border-border bg-card py-2 text-card-foreground">
              <button
                aria-label="Open project sidebar"
                className="grid size-8 place-items-center rounded-md text-muted-foreground outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
                onClick={() => workbenchLayoutController.setPartVisible(WorkbenchLayoutParts.PrimarySidebar, true)}
                title="Open project sidebar"
                type="button"
              >
                <PanelLeftOpen className="size-4" />
              </button>
              <div className="mt-2 h-px w-5 bg-border" />
              <span className="mt-3 [writing-mode:vertical-rl] text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Project
              </span>
              <div className="mt-auto">
                <ApplicationMenu
                  compact
                  locale={locale}
                  onOpenSettings={openSettings}
                  services={serviceCatalogSnapshot}
                />
              </div>
            </aside>
          )}
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
                resizeWorkbenchPartBy(WorkbenchLayoutParts.PrimarySidebar, keyEvent.key === "ArrowLeft" ? -24 : 24)
              }}
              onPointerDown={(pointerEvent) =>
                startWorkbenchPartResize(WorkbenchLayoutParts.PrimarySidebar, pointerEvent)
              }
              role="separator"
              tabIndex={0}
            />
          ) : null}
        </div>
        <section className="relative min-w-0 flex-1">
          {workbenchSnapshot.surface.kind === "empty" && workbenchSnapshot.surface.reason === "no-project" ? (
            <ProjectEmptyState controller={projectController} initialized={projectSnapshot.initialized} />
          ) : workbenchSnapshot.surface.kind === "file" ? (
            <div className="grid size-full place-items-center text-sm text-muted-foreground">
              File surface is not available yet.
            </div>
          ) : workbenchSnapshot.surface.kind === "empty" || !activeProject || !activeCanvas || !initialDocument ? (
            <ProjectLoadingState projectName={activeProject?.name ?? "Project"} />
          ) : (
            <RendererErrorBoundary
              name="Canvas surface"
              renderFallback={({ retry }) => (
                <div className="grid size-full place-items-center bg-background p-8" role="alert">
                  <div className="max-w-md rounded-lg border border-destructive/30 bg-card p-5 text-center shadow-sm">
                    <h2 className="text-base font-semibold text-card-foreground">{rendererFailureCopy.canvasTitle}</h2>
                    <p className="mt-2 text-sm text-muted-foreground">{rendererFailureCopy.canvasDescription}</p>
                    <button
                      className="mt-4 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                      onClick={retry}
                      type="button"
                    >
                      {rendererFailureCopy.retry}
                    </button>
                  </div>
                </div>
              )}
              resetKey={rendererScopeKey}
            >
              <CanvasEditor
                key={`${activeProject.id}:${activeCanvas.id}`}
                clipboardScope={activeProject.id}
                fileRendererRegistry={canvasFileRendererRegistry}
                initialDocument={initialDocument}
                nodeRegistry={canvasNodeRegistry}
                readOnly={
                  workbenchSnapshot.changingInput ||
                  projectCanvasSnapshot.busy ||
                  projectSnapshot.changingActiveProject
                }
                ref={canvasEditorRef}
                selectionActions={selectionActions}
                selectionDragSource={selectionDragSource}
                services={services}
                title={activeCanvas.name}
                viewId="desktop-main"
                viewRegistry={canvasViewRegistry}
                viewScopeId={activeProject.id}
              />
            </RendererErrorBoundary>
          )}
        </section>
        <RendererErrorBoundary
          name="Agent panel"
          renderFallback={({ retry }) => (
            <aside
              className="relative z-40 grid shrink-0 place-items-center overflow-hidden border-l border-border bg-card p-4 text-center text-card-foreground max-[1040px]:absolute max-[1040px]:inset-y-0 max-[1040px]:right-0"
              role="alert"
              style={{
                maxWidth: secondarySidebarMaxWidthStyle,
                width: secondarySidebar.visible ? secondarySidebar.size : collapsedSecondarySidebarSize,
              }}
            >
              {secondarySidebar.visible ? (
                <div>
                  <h2 className="text-sm font-semibold">{rendererFailureCopy.agentTitle}</h2>
                  <p className="mt-2 text-xs leading-5 text-muted-foreground">
                    {rendererFailureCopy.agentDescription}
                  </p>
                  <button
                    className="mt-4 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                    onClick={retry}
                    type="button"
                  >
                    {rendererFailureCopy.retry}
                  </button>
                </div>
              ) : (
                <button
                  aria-label={rendererFailureCopy.agentTitle}
                  className="grid size-8 place-items-center rounded-md text-lg text-muted-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50"
                  onClick={retry}
                  title={rendererFailureCopy.retry}
                  type="button"
                >
                  ↻
                </button>
              )}
            </aside>
          )}
          resetKey={rendererScopeKey}
        >
          <AgentPanel
            activeCanvas={activeCanvas}
            beforePrompt={flushCanvasForAgent}
            canvases={projectCanvasSnapshot.canvases}
            generationCatalogVersion={generationToolCatalogVersionRef.current}
            layout={{
              collapsedWidth: collapsedSecondarySidebarSize,
              maxWidth: secondarySidebarAvailableSize,
              maxWidthStyle: secondarySidebarMaxWidthStyle,
              minWidth: secondarySidebarBounds.minSize,
              onOpenChange: (open) =>
                workbenchLayoutController.setPartVisible(WorkbenchLayoutParts.SecondarySidebar, open),
              onResizeKeyDown: (keyEvent) => {
                if (keyEvent.key !== "ArrowLeft" && keyEvent.key !== "ArrowRight") return
                keyEvent.preventDefault()
                resizeWorkbenchPartBy(
                  WorkbenchLayoutParts.SecondarySidebar,
                  keyEvent.key === "ArrowLeft" ? 24 : -24,
                )
              },
              onResizeStart: (pointerEvent) =>
                startWorkbenchPartResize(WorkbenchLayoutParts.SecondarySidebar, pointerEvent),
              open: secondarySidebar.visible,
              resizing: resizingSecondarySidebar,
              width: secondarySidebar.size,
            }}
            projectId={activeProjectId}
            projectName={activeProject?.name}
            ref={agentPanelRef}
          />
        </RendererErrorBoundary>
        {notification ? <Toast notification={notification} /> : null}
      </main>
      {activeMediaOperationDialog && !settingsSection ? (
        <MediaOperationDialog
          key={`${activeMediaOperationDialog.context.document.id}:${activeMediaOperationDialog.context.document.revision}:${activeMediaOperationDialog.action.pluginId}:${activeMediaOperationDialog.action.id}`}
          locale={locale}
          onClose={closeMediaOperationDialog}
          onConfirm={(input, signal) => runMediaOperation(activeMediaOperationDialog, input, signal)}
          request={activeMediaOperationDialog}
        />
      ) : null}
      {settingsSection ? (
        <SettingsView
          className="fixed inset-0 z-[100]"
          initialSection={settingsSection}
          languagePreference={languagePreference}
          locale={locale}
          onClose={() => setSettingsSection(null)}
          onLanguageChange={changeLanguage}
          onRefreshServices={() => void serviceCatalogController.refresh()}
          onServiceAction={(pluginId, action) => void serviceCatalogController.perform(pluginId, action)}
          pluginClient={window.convax.plugins}
          serviceSnapshot={serviceCatalogSnapshot}
          skillClient={window.convax.agent.skills}
        />
      ) : null}
    </AgentGenerationPreferenceProvider>
  )
}

function Toast({ notification }: { notification: CanvasNotification }) {
  const icon =
    notification.kind === "success" ? (
      <CheckCircle2 className="text-emerald-600" />
    ) : notification.kind === "error" ? (
      <XCircle className="text-destructive" />
    ) : notification.kind === "warning" ? (
      <TriangleAlert className="text-amber-600" />
    ) : (
      <Info className="text-sky-600" />
    )
  return (
    <div className="absolute bottom-5 right-5 z-50 flex min-w-72 max-w-96 items-start gap-3 rounded-md border border-border bg-popover p-3 text-popover-foreground shadow-lg">
      {icon}
      <div className="min-w-0">
        <div className="text-sm font-medium">{notification.title}</div>
        {notification.description ? (
          <div className="mt-0.5 text-xs text-muted-foreground">{notification.description}</div>
        ) : null}
      </div>
    </div>
  )
}

const root = document.getElementById("app")
if (!(root instanceof HTMLElement)) throw new Error("App root was not found")
const reactRoot = import.meta.hot?.data.root ?? createRoot(root)
if (import.meta.hot) import.meta.hot.data.root = reactRoot
reactRoot.render(
  <RendererErrorBoundary
    name="Desktop root"
    renderFallback={({ error }) => (
      <main
        className="grid size-full place-items-center bg-background p-8 text-foreground"
        data-testid="desktop-fatal-renderer-error"
        role="alert"
      >
        <div className="w-full max-w-lg rounded-lg border border-destructive/30 bg-card p-6 shadow-sm">
          <h1 className="text-lg font-semibold">Convax 遇到渲染错误 / could not render</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            当前窗口已被安全保留。请重新加载应用；如果问题持续发生，可在开发者工具中查看已记录的错误。
          </p>
          <details className="mt-3 text-xs text-muted-foreground">
            <summary className="cursor-pointer">Error details</summary>
            <code className="mt-2 block whitespace-pre-wrap break-words">{error.message}</code>
          </details>
          <button
            className="mt-5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            onClick={() => window.location.reload()}
            type="button"
          >
            重新加载 Convax / Reload
          </button>
        </div>
      </main>
    )}
  >
    <DesktopProtocolGate>
      <App />
    </DesktopProtocolGate>
  </RendererErrorBoundary>,
)
