import {
  CanvasOutline,
  CanvasEditor,
  CanvasGenerationPanel,
  CanvasInspector,
  type CanvasDocument,
  createDefaultCanvasFileRendererRegistry,
  createDefaultCanvasNodeRegistry,
  createCanvasViewRegistry,
  createCanvasServices,
  matchesCanvasSelectionProjectionScope,
  type CanvasEditorHandle,
  type CanvasGenerateService,
  type CanvasInspectorProjection,
  type CanvasNotification,
  type CanvasSelectionProjection,
  type CanvasSelectionAction,
  type CanvasSelectionActionContext,
  type CanvasSelectionDragSource,
} from "@convax/canvas"
import { ProjectController, ProjectSidebar } from "@convax/project"
import { ProjectFilesController } from "@convax/project-files"
import {
  dehydrateProjectCanvasDocument,
  markProjectCanvasResourcesStale,
  ProjectCanvasController,
} from "@convax/project/canvas"
import { WorkbenchController, WorkbenchLayoutController, WorkbenchLayoutParts } from "@convax/workbench"
import {
  CheckCircle2,
  Crop,
  FileOutput,
  ImageDown,
  Info,
  Layers3,
  MessageSquarePlus,
  Scissors,
  TriangleAlert,
  XCircle,
} from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import { createRoot } from "react-dom/client"
import { createAgentCanvasInstructions, createAgentCanvasNodeResource } from "../agent-canvas-context"
import { hasWebPluginCanvasSurface, type InstalledWebPluginSummary, type WebPluginManifest } from "../plugin-contracts"
import { AgentPanel, type AgentPanelHandle } from "./agent-panel"
import { AgentDrawerTrigger } from "./agent-drawer-header"
import { AgentGenerationPreferenceProvider } from "./agent-generation-preference"
import { isGenerationModelTool } from "./agent-generation-models"
import { resolveAgentCompactStatus, type AgentCompactStatus } from "./agent-panel-state"
import { subscribeInstalledPluginInventory } from "./installed-plugin-inventory"
import { createAddSelectionToConversationAction } from "./agent-selection-action"
import { ApplicationCommandPalette } from "./application-command-palette"
import type { ApplicationCommand } from "./application-command-model"
import { ApplicationTitlebar } from "./application-titlebar"
import {
  readAppLanguagePreference,
  resolveAppLocale,
  writeAppLanguagePreference,
  type AppLanguagePreference,
} from "./app-language"
import {
  applyAppearancePreferences,
  readAppearancePreferences,
  writeAppearancePreferences,
  type AppearancePreferences,
} from "./appearance-preferences"
import { resolveCanvasAppearancePalette } from "./appearance-themes"
import { createRendererCanvasPersistence } from "./canvas-command-persistence"
import { createInitialCanvasDocument } from "./canvas-document"
import {
  CanvasCardConversationPanel,
  canvasCardAgentContextNodeIds,
  canvasCardAgentInitialMentionNodeIds,
  canvasCardGenerationReferenceConstraint,
} from "./canvas-card-conversation-panel"
import { createCanvasMediaSelectionDragSource } from "./canvas-media-drag-source"
import { createCanvasRendererRequestHandler } from "./canvas-renderer-request-handler"
import { publishCanvasSelectionToWorkbench } from "./canvas-workbench-selection"
import { resolveCanvasUploadItems } from "./canvas-upload"
import {
  closeDesktopSettings,
  createDesktopSurfaceState,
  openDesktopHome,
  openDesktopSettings,
  openDesktopWorkspace,
} from "./desktop-surface-state"
import { DesktopProtocolGate } from "./desktop-protocol-gate"
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
  canRunPluginMaterialization,
  listInstalledPluginMaterializationActions,
} from "./plugin-materialization-selection-action"
import {
  mediaOperationCancellationNotice,
  MediaOperationPartialError,
  type MediaOperationProgress,
  runMediaOperationSequence,
} from "./media-operation-runner"
import { DesktopPluginFrameRegistry } from "./plugin-frame-registry"
import { openPluginInAgent, showPluginAgentSession } from "./plugin-agent-entry"
import { executePluginCanvasImageWrite } from "./plugin-canvas-image-write"
import { ProjectEmptyState, ProjectLoadingState } from "./project-empty-state"
import { ProjectCanvasSidebar } from "./project-canvas-sidebar"
import { ProjectCanvasWorkbenchCoordinator, runProjectCanvasResourceRelink } from "./project-canvas-workbench"
import { ProjectDetailsPanel } from "./project-details-panel"
import { ProjectHome } from "./project-home"
import { RendererErrorBoundary } from "./renderer-error-boundary"
import { ServiceCatalogController } from "./service-catalog-controller"
import { subscribeMountedCanvasResourceInvalidation } from "./project-resource-invalidation"
import { SettingsView } from "./settings-view"
import { readWorkbenchLayoutPreferences, writeWorkbenchLayoutPreferences } from "./workbench-layout-preferences"
import { readLastCanvasPreference, writeLastCanvasPreference } from "./workbench-preferences"
import { WorkspaceShell } from "./workspace-shell"
import { WorkspaceStatusBar } from "./workspace-status-bar"
import { summarizeWorkspaceCanvasActivity } from "./workspace-activity-model"
import { WorkspaceTaskIndicator } from "./workspace-task-indicator"
import { resolveWorkspaceLayout } from "./workspace-layout-model"
import { WorkspaceEntryCoordinator, waitForMountedWorkspaceTarget } from "./workspace-entry"
import { WorkspaceUtilityDrawer, type WorkspaceUtilityActiveMode } from "./workspace-utility-drawer"
import {
  closedWorkspaceUtilityDrawer,
  openAgentUtility,
  openGenerateUtility,
  openInspectorUtility,
  reconcileWorkspaceUtilityDrawer,
  type WorkspaceUtilityDrawerState,
} from "./workspace-utility-drawer-state"
import { createWebPluginCanvasContribution, type WebPluginCanvasHost } from "./web-plugin-canvas"
import { WebPluginGenerationProjectionCoordinator } from "./web-plugin-generation-projection"
import { webPluginCanvasRendererId } from "../plugin-canvas-node"
import "./styles.css"
import "./appearance-themes.css"

const primarySidebarBounds = { defaultSize: 320, defaultVisible: false, maxSize: 480, minSize: 260 }
const secondarySidebarBounds = { defaultSize: 380, defaultVisible: false, maxSize: 4096, minSize: 300 }
const primarySidebarCollapseThreshold = 180
const secondarySidebarCollapseThreshold = 260
const minimumCanvasPeekSize = 160

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
  const [appearancePreferences, setAppearancePreferences] = useState(() => readAppearancePreferences(localStorage))
  const [appearanceSaveState, setAppearanceSaveState] = useState<"error" | "idle" | "saved">("idle")
  const [desktopSurface, setDesktopSurface] = useState(createDesktopSurfaceState)
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const [canvasInspector, setCanvasInspector] = useState<CanvasInspectorProjection | null>(null)
  const [canvasGenerationRunning, setCanvasGenerationRunning] = useState(false)
  const [agentCompactStatus, setAgentCompactStatus] = useState<AgentCompactStatus>(() => resolveAgentCompactStatus({}))
  const [workspaceUtilityDrawer, setWorkspaceUtilityDrawer] =
    useState<WorkspaceUtilityDrawerState>(closedWorkspaceUtilityDrawer)
  const [mediaOperationDialog, setMediaOperationDialog] = useState<MediaOperationDialogRequest | null>(null)
  const [modelCatalogEpoch, setModelCatalogEpoch] = useState(0)
  const mediaOperationProgressRef = useRef(new WeakMap<MediaOperationDialogRequest, MediaOperationProgress>())
  const closeMediaOperationDialog = useCallback(() => setMediaOperationDialog(null), [])
  const settingsSurface = desktopSurface.kind === "settings" ? desktopSurface : null
  const settingsSection = settingsSurface?.initialSection
  const settingsSkillName = settingsSurface?.initialSkillName
  const primaryDesktopSurface = settingsSurface?.returnTo ?? desktopSurface.kind
  const locale = useMemo(() => resolveAppLocale(languagePreference), [languagePreference])
  const canvasEditorRef = useRef<CanvasEditorHandle>(null)
  const canvasEditorScopeRef = useRef<{
    canvasId: string
    handle: CanvasEditorHandle
    projectId: string
  } | null>(null)
  const agentPanelRef = useRef<AgentPanelHandle>(null)
  const agentPanelScopeRef = useRef<{
    handle: AgentPanelHandle
    projectId: string
  } | null>(null)
  const projectDetailsTriggerRef = useRef<HTMLButtonElement>(null)
  const canvasNodeRegistry = useMemo(() => createDefaultCanvasNodeRegistry(), [])
  const canvasFileRendererRegistry = useMemo(() => createDefaultCanvasFileRendererRegistry(), [])
  const canvasViewRegistry = useMemo(() => createCanvasViewRegistry(), [])
  const pluginFrameRegistry = useMemo(() => new DesktopPluginFrameRegistry(), [])
  const webPluginGenerationProjection = useMemo(() => new WebPluginGenerationProjectionCoordinator(), [])
  const [installedPlugins, setInstalledPlugins] = useState<InstalledWebPluginSummary[]>([])
  const mediaOperationActions = useMemo(() => listInstalledMediaOperationActions(installedPlugins), [installedPlugins])
  const pluginMaterializationActions = useMemo(
    () => listInstalledPluginMaterializationActions(installedPlugins),
    [installedPlugins],
  )
  const generationToolCatalogVersionRef = useRef("")
  const generationToolCatalogVersion = JSON.stringify([
    modelCatalogEpoch,
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
  ])
  generationToolCatalogVersionRef.current = generationToolCatalogVersion
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
          const canLeave = await canvasEditorRef.current?.prepareToLeave()
          if (canLeave === false) return false
          await drainCanvasSaves()
          return true
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
  const [initialLayoutPreferences] = useState(() =>
    readWorkbenchLayoutPreferences(localStorage, {
      primarySidebar: primarySidebarBounds,
      secondarySidebar: secondarySidebarBounds,
    }),
  )
  const [projectDetailsPinned, setProjectDetailsPinned] = useState(initialLayoutPreferences.primarySidebar.pinned)
  const workbenchLayoutController = useMemo(() => {
    return new WorkbenchLayoutController({
      parts: {
        [WorkbenchLayoutParts.PrimarySidebar]: {
          collapseThreshold: primarySidebarCollapseThreshold,
          initialSize: initialLayoutPreferences.primarySidebar.size,
          initialVisible: initialLayoutPreferences.primarySidebar.visible,
          maxSize: primarySidebarBounds.maxSize,
          minSize: primarySidebarBounds.minSize,
        },
        [WorkbenchLayoutParts.SecondarySidebar]: {
          collapseThreshold: secondarySidebarCollapseThreshold,
          initialSize: initialLayoutPreferences.secondarySidebar.size,
          initialVisible: initialLayoutPreferences.secondarySidebar.visible,
          maxSize: secondarySidebarBounds.maxSize,
          minSize: secondarySidebarBounds.minSize,
        },
      },
    })
  }, [initialLayoutPreferences])
  const workbenchController = useMemo(
    () =>
      new WorkbenchController({
        beforeInputChange: async (currentInput) => {
          if (currentInput?.kind === "canvas") {
            const canLeave = await canvasEditorRef.current?.prepareToLeave()
            if (canLeave === false) return false
            await drainCanvasSaves()
          }
          return true
        },
        onInputChangeCanceled: () => canvasEditorRef.current?.resumeAfterLeaveCanceled(),
      }),
    [drainCanvasSaves],
  )
  const projectCanvasWorkbench = useMemo(
    () => new ProjectCanvasWorkbenchCoordinator(projectCanvasController, workbenchController),
    [projectCanvasController, workbenchController],
  )
  const workspaceEntryCoordinator = useMemo(
    () =>
      new WorkspaceEntryCoordinator({
        catalog: projectCanvasController,
        project: projectController,
        readLastCanvas: (projectId) => readLastCanvasPreference(localStorage, projectId),
        reconcile: (projectId, preferredCanvasId) => projectCanvasWorkbench.reconcile(projectId, preferredCanvasId),
        showWorkspace: () => setDesktopSurface(openDesktopWorkspace),
        workbench: workbenchController,
      }),
    [projectCanvasController, projectCanvasWorkbench, projectController, workbenchController],
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
  useEffect(() => () => workspaceEntryCoordinator.cancelPendingEntry(), [workspaceEntryCoordinator])
  useEffect(() => {
    serviceCatalogController.start()
    return () => serviceCatalogController.dispose()
  }, [serviceCatalogController])
  useEffect(() => window.convax.pluginServices.onDidChange(() => setModelCatalogEpoch((current) => current + 1)), [])
  useEffect(() => {
    const refreshServicesAfterBrowserReturn = () => void serviceCatalogController.refresh()
    window.addEventListener("focus", refreshServicesAfterBrowserReturn)
    return () => window.removeEventListener("focus", refreshServicesAfterBrowserReturn)
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
    applyAppearancePreferences(document.documentElement, appearancePreferences)
  }, [appearancePreferences])
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
      setDesktopSurface((current) => openDesktopSettings(current, "general"))
    }
    window.addEventListener("keydown", openSettingsShortcut)
    return () => window.removeEventListener("keydown", openSettingsShortcut)
  }, [closeMediaOperationDialog])
  useEffect(() => {
    if (!settingsSection) return
    const closeSettings = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDesktopSurface(closeDesktopSettings)
      }
    }
    window.addEventListener("keydown", closeSettings)
    return () => window.removeEventListener("keydown", closeSettings)
  }, [settingsSection])
  useEffect(() => {
    if (!workbenchLayoutSnapshot.resize) {
      writeWorkbenchLayoutPreferences(localStorage, workbenchLayoutSnapshot, { projectDetailsPinned })
    }
  }, [projectDetailsPinned, workbenchLayoutSnapshot])
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
  useEffect(() => setCanvasGenerationRunning(false), [activeCanvasId, activeProjectId])
  const mountCanvasEditor = useCallback(
    (handle: CanvasEditorHandle | null) => {
      canvasEditorRef.current = handle
      canvasEditorScopeRef.current =
        handle && activeProjectId && activeCanvasId
          ? { canvasId: activeCanvasId, handle, projectId: activeProjectId }
          : null
    },
    [activeCanvasId, activeProjectId],
  )
  const mountAgentPanel = useCallback(
    (handle: AgentPanelHandle | null) => {
      agentPanelRef.current = handle
      agentPanelScopeRef.current = handle && activeProjectId ? { handle, projectId: activeProjectId } : null
    },
    [activeProjectId],
  )
  const activeCanvas =
    activeCanvasId && projectCanvasSnapshot.projectId === activeProjectId
      ? projectCanvasSnapshot.canvases.find((canvas) => canvas.id === activeCanvasId)
      : undefined
  const publishCanvasSelection = useCallback(
    (projection: CanvasSelectionProjection) => {
      if (
        !publishCanvasSelectionToWorkbench({
          activeCanvasId,
          activeProjectId,
          controller: workbenchController,
          expectedViewId: "desktop-main",
          projection,
        })
      ) {
        return
      }
      setCanvasInspector((current) =>
        current && projection.inspector?.nodeId === current.nodeId ? projection.inspector : null,
      )
    },
    [activeCanvasId, activeProjectId, workbenchController],
  )
  const openCanvasInspector = useCallback(
    (projection: CanvasInspectorProjection) => {
      if (
        !activeProjectId ||
        !activeCanvasId ||
        !matchesCanvasSelectionProjectionScope(projection, {
          documentId: activeCanvasId,
          scopeId: activeProjectId,
          viewId: "desktop-main",
        })
      ) {
        return
      }
      setCanvasInspector(projection)
      setWorkspaceUtilityDrawer(
        openInspectorUtility(
          { canvasId: activeCanvasId, projectId: activeProjectId },
          `${projection.nodeId}:${projection.revision}`,
        ),
      )
      workbenchLayoutController.setPartVisible(WorkbenchLayoutParts.SecondarySidebar, true)
    },
    [activeCanvasId, activeProjectId, workbenchLayoutController],
  )
  const activeMediaOperationDialog = isMediaOperationDialogInScope(
    mediaOperationDialog,
    activeProjectId,
    activeCanvasId,
  )
    ? mediaOperationDialog
    : null
  const activeProjectIdRef = useRef<string | null>(activeProjectId ?? null)
  activeProjectIdRef.current = activeProjectId ?? null
  useEffect(
    () =>
      subscribeMountedCanvasResourceInvalidation({
        currentEditor: () => canvasEditorRef.current,
        currentProjectId: () => activeProjectIdRef.current,
        projectFiles: window.convax.projectFiles,
      }),
    [],
  )
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
              (
                await window.convax.canvas.documents.load({
                  canvasId: input.canvasId,
                  scopeId: input.projectId,
                })
              ).document ?? undefined
            )
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
        // A closed Plugin frame stops waiting and projecting only. The accepted
        // Main-owned operation remains visible and explicitly cancellable from
        // its persisted Canvas owner.
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
              resultMode: { type: input.resultMode ?? "create-pending-node" },
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
        const finishAgentSession = showPluginAgentSession(agentPanelRef.current, {
          scopeId: input.projectId,
          session,
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
          const resources = input.skillName ? [resource, { kind: "skill" as const, name: input.skillName }] : [resource]
          const message = await window.convax.agent.prompt({
            instructions: [
              ...createAgentCanvasInstructions({
                activeCanvas: initial.activeCanvas,
                resources,
              }),
              `A sandboxed Convax Plugin named ${JSON.stringify(input.pluginName)} requested this response through its declared Agent capability. Keep every tool call in the authoritative active Project and Canvas scope.`,
            ],
            resources,
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
          finishAgentSession()
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
      async readConnectedImage(input) {
        throwIfAborted(input.signal)
        currentScope(input.projectId, input.canvasId)
        const result = await window.convax.canvas.resources.readConnectedImage({
          canvasId: input.canvasId,
          expectedRevision: input.expectedRevision,
          nodeId: input.nodeId,
          ownerNodeId: input.ownerNodeId,
        })
        throwIfAborted(input.signal)
        currentScope(input.projectId, input.canvasId)
        return result
      },
      async waitForGenerationProjection(input) {
        await webPluginGenerationProjection.wait(input, input.signal)
      },
    }
  }, [flushAuthoritativeCanvas, webPluginGenerationProjection])

  useEffect(() => {
    return subscribeInstalledPluginInventory(window.convax.plugins, setInstalledPlugins, (error) =>
      console.error("Could not load installed Canvas Plugins", error),
    )
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
    if (
      primaryDesktopSurface !== "workspace" ||
      !activeProjectId ||
      projectCanvasSnapshot.projectId !== activeProjectId
    ) {
      return
    }
    void projectCanvasWorkbench.reconcile(activeProjectId, readLastCanvasPreference(localStorage, activeProjectId))
  }, [
    activeProjectId,
    primaryDesktopSurface,
    projectCanvasSnapshot.busy,
    projectCanvasSnapshot.canvases,
    projectCanvasSnapshot.projectId,
    projectCanvasWorkbench,
    workbenchSnapshot.activeInput,
    workbenchSnapshot.changingInput,
    workbenchSnapshot.error,
  ])
  useEffect(() => {
    if (activeProjectId && activeCanvas) writeLastCanvasPreference(localStorage, activeProjectId, activeCanvas.id)
  }, [activeCanvas, activeProjectId])
  const openSkillDetails = useCallback(
    async (name: string) => {
      if (!activeProjectId) return false
      const inventory = await window.convax.agent.skills.listSkills({ scopeId: activeProjectId })
      if (!inventory.skills.some((skill) => skill.name === name && skill.managed)) return false
      setDesktopSurface((current) => openDesktopSettings(current, "capabilities", name))
      return true
    },
    [activeProjectId],
  )
  const openServices = useCallback(() => {
    closeMediaOperationDialog()
    setDesktopSurface((current) => openDesktopSettings(current, "services"))
  }, [closeMediaOperationDialog])
  const assistantHostRef = useRef({
    activeCanvas,
    activeProject,
    beforePrompt: flushCanvasForAgent,
    canvases: projectCanvasSnapshot.canvases,
    generationCatalogVersion: generationToolCatalogVersionRef.current,
    onOpenServices: openServices,
    onOpenSkillDetails: openSkillDetails,
  })
  assistantHostRef.current = {
    activeCanvas,
    activeProject,
    beforePrompt: flushCanvasForAgent,
    canvases: projectCanvasSnapshot.canvases,
    generationCatalogVersion: generationToolCatalogVersionRef.current,
    onOpenServices: openServices,
    onOpenSkillDetails: openSkillDetails,
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
  const [canvasOutlineDocument, setCanvasOutlineDocument] = useState<CanvasDocument | null>(initialDocument)
  useEffect(() => {
    setCanvasOutlineDocument(initialDocument)
  }, [initialDocument])
  const services = useMemo(() => {
    const generateService: CanvasGenerateService = {
      cancel(operationId) {
        return window.convax.generation.cancel({ operationId })
      },
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
          ...(tool.modelName ? { modelName: tool.modelName } : {}),
          output: tool.output,
          serviceId: tool.pluginId,
          serviceName: tool.pluginName,
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
        const operationId = request.operationId ?? globalThis.crypto.randomUUID()
        const referenceConstraint = canvasCardGenerationReferenceConstraint(request)
        const result = await window.convax.generation.generate({
          anchor: request.anchor,
          ...(request.expectedOutputCount ? { expectedOutputCount: request.expectedOutputCount } : {}),
          expectedRevision: authoritativeDocument.revision,
          operationId,
          ...(request.output ? { output: request.output } : {}),
          prompt: request.prompt,
          ...(request.promptContextNodeIds?.length ? { promptContextNodeIds: request.promptContextNodeIds } : {}),
          ref: { canvasId: activeCanvasId, scopeId: activeProjectId },
          ...(referenceConstraint ? { referenceConstraint } : {}),
          references: request.references,
          ...(request.relationAnchorNodeIds ? { relationAnchorNodeIds: request.relationAnchorNodeIds } : {}),
          ...(request.resultMode ? { resultMode: request.resultMode } : {}),
          ...(request.toolId ? { toolId: request.toolId } : {}),
          ...(request.toolInput ? { toolInput: request.toolInput } : {}),
        })
        if (request.signal.aborted) throw request.signal.reason
        return result
      },
    }
    return createCanvasServices({
      draftDecision: {
        decide({ count }) {
          if (window.confirm(`Save ${count === 1 ? "the text draft" : `${count} text drafts`} before leaving?`)) {
            return "save"
          }
          return window.confirm("Discard the pending text draft changes?") ? "discard" : "cancel"
        },
      },
      assistant: {
        render(request) {
          const host = assistantHostRef.current
          const contextResources = canvasCardAgentContextNodeIds(request).flatMap((nodeId) => {
            const node = request.document.nodes.find((candidate) => candidate.id === nodeId)
            return node ? [createAgentCanvasNodeResource(request.document.id, node.id, node.data.label)] : []
          })
          const initialResources = canvasCardAgentInitialMentionNodeIds(request).flatMap((nodeId) => {
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
              initialResources={initialResources}
              onOpenServices={host.onOpenServices}
              onOpenSkillDetails={host.onOpenSkillDetails}
              projectId={host.activeProject?.id}
              projectName={host.activeProject?.name}
            />
          )
          return request.mode === "file" ? (
            <CanvasCardConversationPanel
              agent={agent}
              catalogVersion={host.generationCatalogVersion}
              onOpenServices={host.onOpenServices}
              request={request}
              service={generateService}
            />
          ) : (
            agent
          )
        },
      },
      hydration: {
        async hydrateStale({ document, signal }) {
          if (!activeProjectId || !activeCanvasId) {
            throw new Error("Open a Project Canvas before refreshing resources")
          }
          if (signal.aborted) throw signal.reason
          const hydrated = await window.convax.canvas.resources.hydrateStale({
            canvasId: activeCanvasId,
            revision: document.revision,
          })
          if (signal.aborted) throw signal.reason
          return hydrated
        },
        markStale: markProjectCanvasResourcesStale,
      },
      mutation: {
        async add(request) {
          if (request.signal.aborted) throw request.signal.reason
          if (!activeProjectId || !activeCanvasId) {
            throw new Error("Open a Project Canvas before adding resources")
          }
          const transport = resolveCanvasUploadItems(
            {
              files: request.files ?? [],
              signal: request.signal,
              transfer: request.transfer,
            },
            {
              createSourceId: () => `renderer_${globalThis.crypto.randomUUID()}`,
              projectId: activeProjectId,
            },
          )
          const localFiles = transport.localFiles.map(({ file, ...source }) => {
            const sourceToken = window.convax.canvas.resources.createLocalFileToken(file)
            if (!sourceToken) throw new Error("Only files from the local disk can be added to a Project Canvas")
            return { ...source, sourceToken }
          })
          return window.convax.canvas.resources.add({
            anchor: request.anchor,
            canvasId: activeCanvasId,
            commandId: `renderer:${globalThis.crypto.randomUUID()}`,
            expectedRevision: request.expectedRevision,
            localFiles,
            projectId: activeProjectId,
            ...(request.relation === undefined ? {} : { relation: request.relation }),
            sources: [...request.sources, ...transport.sources],
          })
        },
        async relink(request) {
          return runProjectCanvasResourceRelink({
            activeCanvasId,
            activeProjectId,
            createCommandId: () => `renderer:${globalThis.crypto.randomUUID()}`,
            flush: flushCanvasForAgent,
            projectFiles: projectFilesController,
            request,
            resources: window.convax.canvas.resources,
          })
        },
        async saveEditableCopy(request) {
          if (request.signal.aborted) throw request.signal.reason
          if (!activeCanvasId) throw new Error("Open a Project Canvas before saving an editable copy")
          await flushCanvasForAgent()
          if (request.signal.aborted) throw request.signal.reason
          return window.convax.canvas.resources.saveEditableCopy({
            canvasId: activeCanvasId,
            commandId: `renderer:${globalThis.crypto.randomUUID()}`,
            expectedRevision: request.expectedRevision,
            nodeId: request.nodeId,
          })
        },
      },
      generate: generateService,
      persistence:
        activeProjectId && activeCanvasId
          ? createRendererCanvasPersistence({
              client: {
                execute: (request) => window.convax.canvas.documents.execute(request),
                async load(ref) {
                  await window.convax.generation.reconcileCanvas({ ref })
                  return window.convax.canvas.documents.load(ref)
                },
              },
              commandId: () => `renderer-${globalThis.crypto.randomUUID()}`,
              dehydrate: dehydrateProjectCanvasDocument,
              hydrate: (document) => ({
                ...document,
                metadata: {
                  ...document.metadata,
                  title: activeCanvasNameRef.current ?? document.metadata.title,
                },
              }),
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
      textResources: window.convax.canvas.textResources,
    })
  }, [activeCanvasId, activeProjectId, flushAuthoritativeCanvas, generationToolCatalogVersion])

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
      ...pluginMaterializationActions.map((action) => ({
        id: `plugin-materialization-action:${action.pluginId}/${action.id}`,
        label: localizedMediaOperationText(action.title, locale),
        icon: <Layers3 />,
        visible(context: CanvasSelectionActionContext) {
          return canRunPluginMaterialization(context, action)
        },
        async execute(context: CanvasSelectionActionContext) {
          if (!activeCanvasId || !activeProjectId) {
            throw new Error("Open a Project Canvas before materializing a Plugin node")
          }
          const sourceNodeId = context.selectedNodeIds[0]
          if (!sourceNodeId) throw new Error("Select one video before materializing a Plugin node")
          const authoritative = await flushAuthoritativeCanvas()
          if (context.signal.aborted) throw context.signal.reason ?? new DOMException("Canceled", "AbortError")
          if (!authoritative || authoritative.id !== activeCanvasId) {
            throw new Error("The active Canvas could not be made authoritative")
          }
          const source = authoritative.nodes.find((node) => node.id === sourceNodeId)
          if (!source || source.type !== "file" || source.data.kind !== "video") {
            throw new Error("The selected source is no longer a video")
          }
          const result = await window.convax.canvas.pluginMaterialization.materialize({
            actionId: action.id,
            canvasId: activeCanvasId,
            expectedRevision: authoritative.revision,
            pluginId: action.pluginId,
            pluginVersion: action.pluginVersion,
            projectId: activeProjectId,
            sourceNodeId,
          })
          if (context.signal.aborted) return
          await canvasEditorRef.current?.reloadAuthoritative()
          canvasEditorRef.current?.selectNodes([result.createdNodeId])
          setNotification({
            description:
              locale === "zh-CN"
                ? "已保留源视频，并创建了相连的可编辑 Plugin 节点。"
                : "The source video was preserved and connected to a new editable Plugin node.",
            kind: "success",
            title: localizedMediaOperationText(action.title, locale),
          })
        },
      })),
    ],
    [
      activeCanvasId,
      activeProjectId,
      flushAuthoritativeCanvas,
      flushCanvasForAgent,
      installedPlugins,
      locale,
      mediaOperationActions,
      pluginMaterializationActions,
    ],
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
        const presentation = resolveWorkspaceLayout({
          agentVisible: secondary.visible,
          projectDetailsPinned,
          projectDetailsVisible: primary.visible,
          viewportWidth: window.innerWidth,
        })
        const occupiedByPrimary = presentation.projectDetails === "dock" ? primary.size : 0
        const occupiedBySecondary = presentation.agent === "dock" ? secondary.size : 0
        const available =
          partId === WorkbenchLayoutParts.PrimarySidebar
            ? window.innerWidth - occupiedBySecondary - minimumCanvasPeekSize
            : presentation.agent === "dock"
              ? window.innerWidth - occupiedByPrimary - minimumCanvasPeekSize
              : window.innerWidth - 24
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
    [projectDetailsPinned, workbenchLayoutController],
  )

  const primarySidebar = workbenchLayoutSnapshot.parts[WorkbenchLayoutParts.PrimarySidebar]!
  const secondarySidebar = workbenchLayoutSnapshot.parts[WorkbenchLayoutParts.SecondarySidebar]!
  useEffect(() => {
    setWorkspaceUtilityDrawer((current) => {
      if (!secondarySidebar.visible) return closedWorkspaceUtilityDrawer
      const reconciled = reconcileWorkspaceUtilityDrawer(current, {
        canvasId: activeCanvasId,
        projectId: activeProjectId,
      })
      if (secondarySidebar.visible && reconciled.mode === "closed" && activeProjectId) {
        return openAgentUtility(activeProjectId)
      }
      return reconciled
    })
  }, [activeCanvasId, activeProjectId, secondarySidebar.visible])
  useEffect(() => {
    if (workspaceUtilityDrawer.mode !== "inspector" || canvasInspector) return
    setWorkspaceUtilityDrawer(activeProjectId ? openAgentUtility(activeProjectId) : closedWorkspaceUtilityDrawer)
  }, [activeProjectId, canvasInspector, workspaceUtilityDrawer.mode])
  const workspaceLayout = resolveWorkspaceLayout({
    agentVisible: secondarySidebar.visible,
    projectDetailsPinned,
    projectDetailsVisible: primarySidebar.visible,
    viewportWidth,
  })
  const primarySidebarOccupiedSize = workspaceLayout.projectDetails === "dock" ? primarySidebar.size : 0
  const secondarySidebarAvailableSize = Math.max(
    secondarySidebarBounds.minSize,
    workspaceLayout.agent !== "dock"
      ? viewportWidth - 24
      : viewportWidth - primarySidebarOccupiedSize - minimumCanvasPeekSize,
  )
  const secondarySidebarMaxWidthStyle =
    workspaceLayout.agent === "sheet"
      ? "100vw"
      : workspaceLayout.agent === "overlay"
        ? "calc(100vw - 24px)"
        : `calc(100vw - ${primarySidebarOccupiedSize + minimumCanvasPeekSize}px)`
  const resizingPrimarySidebar = workbenchLayoutSnapshot.resize?.partId === WorkbenchLayoutParts.PrimarySidebar
  const resizingSecondarySidebar = workbenchLayoutSnapshot.resize?.partId === WorkbenchLayoutParts.SecondarySidebar
  const openWorkspaceSettings = useCallback(() => {
    closeMediaOperationDialog()
    setDesktopSurface((current) => openDesktopSettings(current, "general"))
  }, [closeMediaOperationDialog])
  const openAgentDrawer = useCallback(() => {
    if (!activeProjectId) return
    setWorkspaceUtilityDrawer(openAgentUtility(activeProjectId))
    workbenchLayoutController.setPartVisible(WorkbenchLayoutParts.SecondarySidebar, true)
  }, [activeProjectId, workbenchLayoutController])
  const openGenerateDrawer = useCallback(() => {
    if (!activeProjectId || !activeCanvasId || !canvasOutlineDocument) return
    setWorkspaceUtilityDrawer(openGenerateUtility({ canvasId: activeCanvasId, projectId: activeProjectId }))
    workbenchLayoutController.setPartVisible(WorkbenchLayoutParts.SecondarySidebar, true)
  }, [activeCanvasId, activeProjectId, canvasOutlineDocument, workbenchLayoutController])
  const reportWorkspaceEntryFailure = useCallback(
    (error: unknown) =>
      setNotification({
        description: error instanceof Error ? error.message : String(error),
        kind: "warning",
        title: locale === "zh-CN" ? "无法打开项目工作区" : "Project workspace is unavailable",
      }),
    [locale],
  )
  const usePluginInAgent = useCallback(
    (plugin: WebPluginManifest) => {
      void (async () => {
        try {
          if (!activeProjectId) throw new Error("Open a Project before using this Plugin in Agent")
          const lease = await workspaceEntryCoordinator.acquire({ projectId: activeProjectId })
          if (!lease) throw new Error("The active Project changed before Agent was ready")
          setWorkspaceUtilityDrawer(openAgentUtility(lease.projectId))
          workbenchLayoutController.setPartVisible(WorkbenchLayoutParts.SecondarySidebar, true)
          const panel = await waitForMountedWorkspaceTarget({
            read: () => {
              const mounted = agentPanelScopeRef.current
              return mounted?.projectId === lease.projectId ? mounted.handle : null
            },
          })
          if (!lease.validate("project")) throw new Error("The active Project changed before Agent was ready")
          openPluginInAgent(plugin, panel)
        } catch (error) {
          reportWorkspaceEntryFailure(error)
        }
      })()
    },
    [activeProjectId, reportWorkspaceEntryFailure, workbenchLayoutController, workspaceEntryCoordinator],
  )
  const usePluginOnCanvas = useCallback(
    (plugin: WebPluginManifest) => {
      if (!hasWebPluginCanvasSurface(plugin) || plugin.contributes.canvas.renderer.create !== true) return
      void (async () => {
        try {
          if (!activeProjectId) throw new Error("Open a Project before using this Plugin on Canvas")
          const lease = await workspaceEntryCoordinator.acquire({ projectId: activeProjectId })
          if (!lease) throw new Error("The active Project changed before Canvas was ready")
          const editor = await waitForMountedWorkspaceTarget({
            read: () => {
              const mounted = canvasEditorScopeRef.current
              return mounted?.projectId === lease.projectId && mounted.canvasId === lease.canvasId
                ? mounted.handle
                : null
            },
          })
          if (!lease.validate("canvas")) throw new Error("The active Canvas changed before the Plugin was ready")
          if (!editor.insertNode(webPluginCanvasRendererId(plugin.id))) {
            throw new Error("The Plugin node could not be added to the active Canvas")
          }
        } catch (error) {
          reportWorkspaceEntryFailure(error)
        }
      })()
    },
    [activeProjectId, reportWorkspaceEntryFailure, workspaceEntryCoordinator],
  )
  const changeLanguage = useCallback((preference: AppLanguagePreference) => {
    setLanguagePreference(preference)
    writeAppLanguagePreference(localStorage, preference)
  }, [])
  const changeAppearance = useCallback((preferences: AppearancePreferences) => {
    setAppearancePreferences(preferences)
    applyAppearancePreferences(document.documentElement, preferences)
    setAppearanceSaveState(writeAppearancePreferences(localStorage, preferences) ? "saved" : "error")
  }, [])
  const enterHomeProject = useCallback(
    (projectId: string) => workspaceEntryCoordinator.enter({ projectId }),
    [workspaceEntryCoordinator],
  )
  const returnToProjectHome = useCallback(async () => {
    workspaceEntryCoordinator.cancelPendingEntry()
    try {
      await flushAuthoritativeCanvas()
      setDesktopSurface(openDesktopHome)
    } catch (error) {
      setNotification({
        description: error instanceof Error ? error.message : String(error),
        kind: "warning",
        title: locale === "zh-CN" ? "返回项目主页前无法保存画布" : "Could not save before returning to Projects",
      })
    }
  }, [flushAuthoritativeCanvas, locale, workspaceEntryCoordinator])
  const openProjectHomeFromTitlebar = useCallback(() => {
    if (primaryDesktopSurface === "workspace") {
      void returnToProjectHome()
      return
    }
    setDesktopSurface(openDesktopHome)
  }, [primaryDesktopSurface, returnToProjectHome])
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

  const reportDisplayedPetSession = useCallback((input: { projectId: string; sessionId: string }) => {
    void window.convax.pets.markSessionDisplayed(input).catch((error) => {
      console.error("Failed to acknowledge the displayed Pet conversation", error)
    })
  }, [])

  useEffect(
    () =>
      window.convax.pets.onNavigate((target) => {
        void (async () => {
          try {
            const lease = await workspaceEntryCoordinator.acquire({ projectId: target.projectId })
            if (!lease) throw new Error("The activity Project is no longer available")
            setWorkspaceUtilityDrawer(openAgentUtility(lease.projectId))
            workbenchLayoutController.setPartVisible(WorkbenchLayoutParts.SecondarySidebar, true)
            const panel = await waitForMountedWorkspaceTarget({
              read: () => {
                const mounted = agentPanelScopeRef.current
                return mounted?.projectId === lease.projectId ? mounted.handle : null
              },
            })
            if (!lease.validate("project")) throw new Error("The activity Project changed before Agent was ready")
            await panel.openSession(target.sessionId)
            if (!lease.validate("project")) return
            await window.convax.pets.markDisplayed({ activityId: target.activityId, revision: target.revision })
          } catch (error) {
            setNotification({
              description: error instanceof Error ? error.message : String(error),
              kind: "warning",
              title: locale === "zh-CN" ? "无法打开宠物活动" : "Pet activity is unavailable",
            })
          }
        })()
      }),
    [locale, workbenchLayoutController, workspaceEntryCoordinator],
  )

  useEffect(() => {
    if (
      !activeProject ||
      workbenchLayoutSnapshot.resize ||
      !secondarySidebar.visible ||
      workspaceLayout.agent !== "dock"
    )
      return
    if (secondarySidebar.size > secondarySidebarAvailableSize) {
      workbenchLayoutController.setPartSize(WorkbenchLayoutParts.SecondarySidebar, secondarySidebarAvailableSize)
    }
  }, [
    activeProject,
    secondarySidebar.size,
    secondarySidebar.visible,
    secondarySidebarAvailableSize,
    workspaceLayout.agent,
    workbenchLayoutController,
    workbenchLayoutSnapshot.resize,
  ])

  const projectDetails =
    activeProject && workspaceLayout.projectDetails !== "hidden" ? (
      <ProjectDetailsPanel
        canvases={
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
        }
        mode={workspaceLayout.projectDetails}
        onClose={() => workbenchLayoutController.setPartVisible(WorkbenchLayoutParts.PrimarySidebar, false)}
        onPinnedChange={setProjectDetailsPinned}
        open={primarySidebar.visible}
        outline={
          canvasOutlineDocument && canvasOutlineDocument.id === activeCanvasId ? (
            <CanvasOutline
              document={canvasOutlineDocument}
              onActivationError={(error) =>
                setNotification({
                  description: error instanceof Error ? error.message : String(error),
                  kind: "warning",
                  title: locale === "zh-CN" ? "无法定位画布内容" : "Could not reveal Canvas item",
                })
              }
              viewSession={{
                execute: (command) =>
                  canvasViewRegistry.execute({
                    command,
                    expectedDocumentId: canvasOutlineDocument.id,
                    expectedScopeId: activeProject.id,
                    viewId: "desktop-main",
                  }),
              }}
            />
          ) : (
            <div className="grid min-h-40 place-items-center px-6 text-center text-xs text-muted-foreground">
              {locale === "zh-CN" ? "正在载入画布大纲…" : "Loading Canvas outline…"}
            </div>
          )
        }
        pinned={projectDetailsPinned}
        projectName={activeProject.name}
        resources={
          <ProjectSidebar
            className="w-full"
            controller={projectController}
            filesController={projectFilesController}
            hideWhenNoProject
            presentation="embedded-files"
          />
        }
        returnFocusRef={projectDetailsTriggerRef}
      />
    ) : null
  const agentPanelWidth = workspaceLayout.agent === "sheet" ? viewportWidth : secondarySidebar.size
  const agentPanelClassName =
    workspaceLayout.agent === "sheet"
      ? "!fixed !inset-0 !z-50 !max-w-none !border-l-0"
      : workspaceLayout.agent === "overlay"
        ? "!absolute !inset-y-3 !right-3 !z-40 rounded-lg shadow-2xl"
        : undefined
  const utilityDocument = canvasOutlineDocument?.id === activeCanvasId ? canvasOutlineDocument : null
  const utilitySelectedNodeIds =
    workbenchSnapshot.selection?.input.kind === "canvas" &&
    workbenchSnapshot.selection.input.projectId === activeProjectId &&
    workbenchSnapshot.selection.input.canvasId === activeCanvasId &&
    workbenchSnapshot.selection.selection.kind === "canvas-nodes"
      ? workbenchSnapshot.selection.selection.nodeIds
      : []
  const utilityModes = [
    { label: locale === "zh-CN" ? "助手" : "Agent", value: "agent" as const },
    ...(utilityDocument ? [{ label: locale === "zh-CN" ? "生成" : "Generate", value: "generate" as const }] : []),
    ...(canvasInspector ? [{ label: locale === "zh-CN" ? "检查器" : "Inspector", value: "inspector" as const }] : []),
  ]
  const closeWorkspaceUtility = () => {
    setWorkspaceUtilityDrawer(closedWorkspaceUtilityDrawer)
    workbenchLayoutController.setPartVisible(WorkbenchLayoutParts.SecondarySidebar, false)
  }
  const changeWorkspaceUtilityMode = (mode: WorkspaceUtilityActiveMode) => {
    if (!activeProjectId) return
    if (mode === "agent") setWorkspaceUtilityDrawer(openAgentUtility(activeProjectId))
    else if (mode === "generate" && activeCanvasId) {
      setWorkspaceUtilityDrawer(openGenerateUtility({ canvasId: activeCanvasId, projectId: activeProjectId }))
    } else if (mode === "inspector" && activeCanvasId && canvasInspector) {
      setWorkspaceUtilityDrawer(
        openInspectorUtility(
          { canvasId: activeCanvasId, projectId: activeProjectId },
          `${canvasInspector.nodeId}:${canvasInspector.revision}`,
        ),
      )
    }
  }
  const applicationCommands = useMemo<readonly ApplicationCommand[]>(
    () => [
      {
        group: "navigation",
        id: "navigation.home",
        keywords: ["projects"],
        label: locale === "zh-CN" ? "返回项目主页" : "Go to Projects",
        run: openProjectHomeFromTitlebar,
      },
      {
        group: "navigation",
        id: "navigation.settings",
        label: locale === "zh-CN" ? "打开设置" : "Open Settings",
        run: openWorkspaceSettings,
      },
      {
        disabled: !activeProjectId,
        group: "utility",
        id: "utility.agent",
        keywords: ["assistant", "chat"],
        label: locale === "zh-CN" ? "打开智能助手" : "Open Agent",
        run: openAgentDrawer,
      },
      {
        disabled: !activeCanvasId,
        group: "utility",
        id: "utility.generate",
        keywords: ["create", "media"],
        label: locale === "zh-CN" ? "打开生成" : "Open Generate",
        run: openGenerateDrawer,
      },
      {
        disabled: !activeCanvasId,
        group: "canvas",
        id: "canvas.search",
        keywords: ["find", "node"],
        label: locale === "zh-CN" ? "搜索当前画布" : "Search current Canvas",
        run: () => canvasEditorRef.current?.openSearch(),
        shortcut: window.convax.platform === "darwin" ? "⌘F" : "Ctrl F",
      },
    ],
    [
      activeCanvasId,
      activeProjectId,
      locale,
      openAgentDrawer,
      openGenerateDrawer,
      openProjectHomeFromTitlebar,
      openWorkspaceSettings,
    ],
  )
  const workspaceActivity = useMemo(
    () => summarizeWorkspaceCanvasActivity(canvasOutlineDocument),
    [canvasOutlineDocument],
  )
  useEffect(() => {
    const openCommands = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.key.toLocaleLowerCase() !== "k") return
      event.preventDefault()
      setCommandPaletteOpen(true)
    }
    window.addEventListener("keydown", openCommands)
    return () => window.removeEventListener("keydown", openCommands)
  }, [])

  return (
    <AgentGenerationPreferenceProvider storage={localStorage}>
      <div className="flex size-full flex-col overflow-hidden">
        <ApplicationTitlebar
          canvasName={activeCanvas?.name ?? null}
          contextLabel={
            settingsSection
              ? locale === "zh-CN"
                ? "设置"
                : "Settings"
              : primaryDesktopSurface === "home"
                ? "Convax"
                : ""
          }
          detailsButtonRef={projectDetailsTriggerRef}
          detailsOpen={primarySidebar.visible}
          commandsLabel={locale === "zh-CN" ? "打开命令" : "Open commands"}
          homeLabel={locale === "zh-CN" ? "返回项目主页" : "Back to Projects"}
          onBackToProjects={openProjectHomeFromTitlebar}
          onOpenCommands={() => setCommandPaletteOpen(true)}
          onOpenSettings={openWorkspaceSettings}
          onToggleDetails={
            !settingsSection && primaryDesktopSurface === "workspace" && activeProject
              ? () =>
                  workbenchLayoutController.setPartVisible(WorkbenchLayoutParts.PrimarySidebar, !primarySidebar.visible)
              : undefined
          }
          platform={window.convax.platform}
          projectName={!settingsSection && primaryDesktopSurface === "workspace" ? activeProject?.name : undefined}
          settingsLabel={locale === "zh-CN" ? "打开设置" : "Open Settings"}
          surface={settingsSection ? "settings" : primaryDesktopSurface}
        />
        <ApplicationCommandPalette
          commands={applicationCommands}
          emptyText={locale === "zh-CN" ? "没有匹配的命令" : "No matching commands"}
          label={locale === "zh-CN" ? "Convax 命令" : "Convax commands"}
          onOpenChange={setCommandPaletteOpen}
          open={commandPaletteOpen}
          placeholder={locale === "zh-CN" ? "搜索命令…" : "Search commands…"}
        />
        <div className="relative min-h-0 flex-1 overflow-hidden">
          {primaryDesktopSurface === "home" ? (
            <div
              aria-hidden={settingsSection ? true : undefined}
              className="size-full"
              inert={Boolean(settingsSection) || undefined}
            >
              <ProjectHome controller={projectController} locale={locale} onEnterProject={enterHomeProject} />
            </div>
          ) : (
            <WorkspaceShell
              blocked={Boolean(settingsSection || activeMediaOperationDialog)}
              resizing={Boolean(workbenchLayoutSnapshot.resize)}
              statusBar={
                <WorkspaceStatusBar
                  client={window.convax.systemStatus}
                  locale={locale}
                  taskIndicator={
                    <WorkspaceTaskIndicator
                      label={
                        locale === "zh-CN"
                          ? `打开 ${workspaceActivity.total} 个画布任务`
                          : `Open ${workspaceActivity.total} Canvas tasks`
                      }
                      onOpen={openGenerateDrawer}
                      summary={workspaceActivity}
                    />
                  }
                />
              }
              utilityMode={workspaceUtilityDrawer.mode}
            >
              {workspaceLayout.projectDetails === "dock" ? (
                <div
                  className={`relative h-full shrink-0 overflow-hidden border-r border-border${
                    !resizingPrimarySidebar
                      ? " transition-[width] duration-200 ease-out motion-reduce:transition-none"
                      : ""
                  }`}
                  style={{ width: primarySidebar.size }}
                >
                  {projectDetails}
                  <div
                    aria-label="Resize Project Details"
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
                    onPointerDown={(pointerEvent) =>
                      startWorkbenchPartResize(WorkbenchLayoutParts.PrimarySidebar, pointerEvent)
                    }
                    role="separator"
                    tabIndex={0}
                  />
                </div>
              ) : null}
              <section className="relative min-w-0 flex-1">
                {workspaceLayout.projectDetails === "overlay" || workspaceLayout.projectDetails === "sheet"
                  ? projectDetails
                  : null}
                {workbenchSnapshot.surface.kind === "empty" && workbenchSnapshot.surface.reason === "no-project" ? (
                  <ProjectEmptyState controller={projectController} initialized={projectSnapshot.initialized} />
                ) : workbenchSnapshot.surface.kind === "file" ? (
                  <div className="grid size-full place-items-center text-sm text-muted-foreground">
                    File surface is not available yet.
                  </div>
                ) : workbenchSnapshot.surface.kind === "empty" ||
                  !activeProject ||
                  !activeCanvas ||
                  !initialDocument ? (
                  <ProjectLoadingState projectName={activeProject?.name ?? "Project"} />
                ) : (
                  <RendererErrorBoundary
                    name="Canvas surface"
                    renderFallback={({ retry }) => (
                      <div className="grid size-full place-items-center bg-background p-8" role="alert">
                        <div className="max-w-md rounded-lg border border-destructive/30 bg-card p-5 text-center shadow-sm">
                          <h2 className="text-base font-semibold text-card-foreground">
                            {rendererFailureCopy.canvasTitle}
                          </h2>
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
                      appearance={{
                        gridStyle: "dots",
                        palette: resolveCanvasAppearancePalette(
                          appearancePreferences.theme,
                          appearancePreferences.accent,
                          appearancePreferences.customAccent,
                        ),
                      }}
                      key={`${activeProject.id}:${activeCanvas.id}`}
                      clipboardScope={activeProject.id}
                      fileRendererRegistry={canvasFileRendererRegistry}
                      initialDocument={initialDocument}
                      nodeRegistry={canvasNodeRegistry}
                      onDocumentChange={(document) => {
                        if (document.id === activeCanvas.id) setCanvasOutlineDocument(document)
                      }}
                      onInspectorRequest={openCanvasInspector}
                      onGenerateRequest={openGenerateDrawer}
                      onGenerationStateChange={setCanvasGenerationRunning}
                      onSelectionProjectionChange={publishCanvasSelection}
                      readOnly={
                        workbenchSnapshot.changingInput ||
                        projectCanvasSnapshot.busy ||
                        projectSnapshot.changingActiveProject
                      }
                      ref={mountCanvasEditor}
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
              <WorkspaceUtilityDrawer
                agent={({ closeLabel, modeNavigation }) => (
                  <RendererErrorBoundary
                    name="Agent panel"
                    renderFallback={({ retry }) => (
                      <div className="grid size-full place-items-center p-4 text-center" role="alert">
                        <div>
                          <h2 className="text-sm font-semibold">{rendererFailureCopy.agentTitle}</h2>
                          <p className="mt-2 text-xs leading-5 text-text-tertiary">
                            {rendererFailureCopy.agentDescription}
                          </p>
                          <button
                            className="mt-4 rounded-md bg-brand px-3 py-2 text-xs font-medium text-on-brand outline-none focus-visible:ring-2 focus-visible:ring-focus-ring/50"
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
                    <AgentPanel
                      activeCanvas={activeCanvas}
                      beforePrompt={flushCanvasForAgent}
                      canvases={projectCanvasSnapshot.canvases}
                      collapsedEntry={false}
                      generationCatalogVersion={generationToolCatalogVersionRef.current}
                      hosted
                      layout={{
                        collapsedWidth: 0,
                        maxWidth: secondarySidebarAvailableSize,
                        maxWidthStyle: secondarySidebarMaxWidthStyle,
                        minWidth: secondarySidebarBounds.minSize,
                        onOpenChange: (open) => {
                          if (open) openAgentDrawer()
                          else closeWorkspaceUtility()
                        },
                        onResizeKeyDown: () => undefined,
                        onResizeStart: () => undefined,
                        open: secondarySidebar.visible,
                        resizable: false,
                        resizing: resizingSecondarySidebar,
                        width: agentPanelWidth,
                      }}
                      onOpenServices={openServices}
                      onOpenSkillDetails={openSkillDetails}
                      onSessionDisplayed={reportDisplayedPetSession}
                      onStatusChange={setAgentCompactStatus}
                      projectId={activeProjectId}
                      projectName={activeProject?.name}
                      ref={mountAgentPanel}
                      utilityCloseLabel={closeLabel}
                      utilityNavigation={modeNavigation ?? undefined}
                    />
                  </RendererErrorBoundary>
                )}
                className={`${agentPanelClassName ?? ""} ${
                  resizingSecondarySidebar
                    ? ""
                    : "transition-[width] duration-200 ease-out motion-reduce:transition-none"
                }`}
                closeLabel={locale === "zh-CN" ? "关闭工具抽屉" : "Close utility drawer"}
                collapsedEntry={
                  activeProjectId ? (
                    <aside aria-label="Agent status" className="pointer-events-none absolute right-3 top-3 z-40">
                      <AgentDrawerTrigger onOpen={openAgentDrawer} status={agentCompactStatus} />
                    </aside>
                  ) : null
                }
                generate={
                  utilityDocument ? (
                    <CanvasGenerationPanel
                      autoFocus
                      className="p-3"
                      disabled={workbenchSnapshot.changingInput || projectSnapshot.changingActiveProject}
                      document={utilityDocument}
                      generateService={services.require("generate")}
                      onOpenServices={openServices}
                      onSubmit={(submission) => canvasEditorRef.current?.submitGeneration(submission)}
                      scopeId={activeProjectId}
                      selectedNodeIds={utilitySelectedNodeIds}
                      submitting={canvasGenerationRunning}
                    />
                  ) : null
                }
                inspector={canvasInspector ? <CanvasInspector className="pb-3" projection={canvasInspector} /> : null}
                modal={workspaceLayout.agent !== "dock"}
                mode={secondarySidebar.visible ? workspaceUtilityDrawer.mode : "closed"}
                modes={utilityModes}
                onClose={closeWorkspaceUtility}
                onModeChange={changeWorkspaceUtilityMode}
                resizeHandle={
                  workspaceLayout.agent === "dock" ? (
                    <div
                      aria-label="Resize workspace utilities"
                      aria-orientation="vertical"
                      aria-valuemax={secondarySidebarBounds.maxSize}
                      aria-valuemin={secondarySidebarBounds.minSize}
                      aria-valuenow={secondarySidebar.size}
                      className="absolute inset-y-0 -left-1 z-50 w-2 cursor-col-resize touch-none outline-none focus-visible:bg-brand/20"
                      onKeyDown={(keyEvent) => {
                        if (keyEvent.key !== "ArrowLeft" && keyEvent.key !== "ArrowRight") return
                        keyEvent.preventDefault()
                        resizeWorkbenchPartBy(
                          WorkbenchLayoutParts.SecondarySidebar,
                          keyEvent.key === "ArrowLeft" ? 24 : -24,
                        )
                      }}
                      onPointerDown={(pointerEvent) =>
                        startWorkbenchPartResize(WorkbenchLayoutParts.SecondarySidebar, pointerEvent)
                      }
                      role="separator"
                      tabIndex={0}
                    />
                  ) : null
                }
                style={{ maxWidth: secondarySidebarMaxWidthStyle, width: agentPanelWidth }}
                unavailableLabel={
                  locale === "zh-CN" ? "当前工具在这个画布中不可用。" : "This utility is unavailable for this Canvas."
                }
              />
              {notification ? <Toast notification={notification} /> : null}
            </WorkspaceShell>
          )}
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
              activeCanvasId={activeCanvasId}
              activeProjectId={activeProjectId}
              appearancePreferences={appearancePreferences}
              appearanceSaveState={appearanceSaveState}
              className="absolute inset-0 z-[100]"
              initialSection={settingsSection}
              initialSkillName={settingsSkillName}
              languagePreference={languagePreference}
              locale={locale}
              onAppearancePreferencesChange={changeAppearance}
              onClose={() => setDesktopSurface(closeDesktopSettings)}
              onLanguageChange={changeLanguage}
              onRefreshServices={() => void serviceCatalogController.refresh()}
              onServiceAction={(pluginId, action) => void serviceCatalogController.perform(pluginId, action)}
              onServiceCheckout={(pluginId, planKey) => void serviceCatalogController.checkout(pluginId, planKey)}
              onUsePluginOnCanvas={usePluginOnCanvas}
              onUsePluginInAgent={usePluginInAgent}
              petClient={window.convax.pets}
              pluginClient={window.convax.plugins}
              serviceSnapshot={serviceCatalogSnapshot}
              skillClient={window.convax.agent.skills}
            />
          ) : null}
        </div>
      </div>
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
