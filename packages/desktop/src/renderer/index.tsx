import {
  CanvasEditor,
  createDefaultCanvasFileRendererRegistry,
  createDefaultCanvasNodeRegistry,
  createCanvasViewRegistry,
  createCanvasServices,
  type CanvasEditorHandle,
  type CanvasDocument,
  type CanvasGenerateService,
  type CanvasNotification,
  type CanvasSelectionProjection,
  type CanvasSelectionAction,
  type CanvasSelectionActionContext,
  type CanvasSelectionDragSource,
} from "@convax/canvas"
import { ProjectController, ProjectSidebar } from "@convax/project"
import { ProjectFilesController, type ProjectEntry, type ProjectFilePreviewPurpose } from "@convax/project-files"
import {
  markProjectCanvasResourcesStale,
  ProjectCanvasSidebar,
  ProjectCanvasSidebarTools,
  ProjectCanvasController,
  type ProjectCanvasSidebarNodeProjection,
} from "@convax/project/canvas"
import {
  getWorkbenchLayoutPartSnapshot,
  WorkbenchController,
  WorkbenchLayoutController,
  WorkbenchLayoutParts,
} from "@convax/workbench"
import {
  CheckCircle2,
  FileOutput,
  Info,
  Layers3,
  MessageSquarePlus,
  PanelLeftClose,
  TriangleAlert,
  Users,
  XCircle,
} from "lucide-react"
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react"
import { createRoot } from "react-dom/client"
import { I18nextProvider } from "react-i18next"
import { createAgentCanvasNodeResource } from "../agent-canvas-context"
import { parseProjectTeamInvitation } from "../project-team-collaboration-contracts"
import {
  hasWebPluginCanvasSurface,
  type ActiveInstalledWebPluginSummary,
  type WebPluginManifest,
} from "../plugin-contracts"
import { AgentPanel, type AgentPanelHandle } from "./agent-panel"
import { AgentDrawerTrigger } from "./agent-drawer-header"
import { AgentGenerationPreferenceProvider } from "./agent-generation-preference"
import { AgentModelCatalogProvider } from "./agent-model-catalog"
import { isGenerationModelTool } from "./agent-generation-models"
import { resolveAgentCompactStatus, type AgentCompactStatus } from "./agent-panel-state"
import { combineInstalledPluginInventoryChanges, subscribeInstalledPluginInventory } from "./installed-plugin-inventory"
import { createAddSelectionToConversationAction } from "./agent-selection-action"
import { ApplicationCommandPalette } from "./application-command-palette"
import type { ApplicationCommand } from "./application-command-model"
import { ApplicationMenu, type ApplicationMenuTarget } from "./application-menu"
import { ApplicationTitlebar } from "./application-titlebar"
import { CanvasTitlebarTitle } from "./canvas-titlebar-title"
import {
  appI18n,
  changeAppLanguage,
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
import {
  shouldMountResizeHandle,
  startCapturedPointerDrag,
  type CapturedPointerDragSession,
} from "./captured-pointer-drag"
import {
  CanvasCardConversationPanel,
  canvasCardAgentContextNodeIds,
  canvasCardAgentInitialMentionNodeIds,
  canvasCardGenerationReferenceConstraint,
} from "./canvas-card-conversation-panel"
import { createCanvasMediaSelectionDragSource } from "./canvas-media-drag-source"
import { openDesktopCanvasRendererSession, type DesktopCanvasRendererSession } from "./canvas-collaboration-client"
import { mountCanvasSessionWithBackgroundReconcile } from "./canvas-session-mount"
import { createCanvasRendererRequestHandler } from "./canvas-renderer-request-handler"
import { resolveWorkspaceCanvasViewportInsets } from "./canvas-viewport-occlusion"
import { publishCanvasSelectionToWorkbench } from "./canvas-workbench-selection"
import { addCanvasUploadResources } from "./canvas-upload"
import {
  closeDesktopSettings,
  createDesktopSurfaceState,
  openDesktopSettings,
  openDesktopWorkspace,
} from "./desktop-surface-state"
import { DesktopProtocolGate } from "./desktop-protocol-gate"
import {
  DevelopmentEnvironmentBadge,
  developmentApplicationTitle,
  rendererDevelopmentIdentity,
} from "./development-environment"
import { MediaOperationActionIcon } from "./media-operation-action-icon"
import {
  canRunMediaOperation,
  createMediaOperationGenerateRequests,
  createMediaOperationReturnRequest,
  isMediaOperationDialogInScope,
  listInstalledMediaOperationActions,
  localizedMediaOperationText,
  type MediaOperationDialogRequest,
  type MediaOperationInput,
} from "./media-operation-selection-action"
import { MediaOperationDialog } from "./media-operation-dialog"
import { ScopedShortcutService, type ShortcutChord } from "./scoped-shortcut-service"
import { useShortcutFeature, useShortcutScope } from "./use-scoped-shortcuts"
import { preloadMarketplaceProjection } from "./marketplace-projection-cache"
import {
  canRunPluginMaterialization,
  listInstalledPluginMaterializationActions,
} from "./plugin-materialization-selection-action"
import { runMediaOperationAdmission, runMediaOperationReturn } from "./media-operation-runner"
import { DesktopPluginFrameRegistry } from "./plugin-frame-registry"
import { openPluginInAgent } from "./plugin-agent-entry"
import { DesktopPluginLocaleStore } from "./plugin-locale-store"
import {
  ProjectCollaborationPendingState,
  ProjectLocalAuthorityRecoveryState,
  ProjectLoadingState,
  ProjectRecoveryState,
  ProjectRegistryLoadingState,
} from "./project-empty-state"
import { resolveProjectLocalCanvasSurfaceAccess } from "./project-local-canvas-access"
import { ProjectCanvasWorkbenchCoordinator, runProjectCanvasResourceRelink } from "./project-canvas-workbench"
import { projectCanvasSidebarNodes, sameProjectCanvasNodeProjection } from "./project-canvas-sidebar-projection"
import { createProjectFolderBrowseService } from "./project-folder-browse-service"
import { revealProjectFileOnCanvas } from "./project-file-canvas-reveal"
import { ProjectHome } from "./project-home"
import {
  enterSelectedProjectFromHome,
  recoveryErrorAfterProjectSelection,
  resolveProjectBootstrapView,
  resolveProjectStartup,
  type ProjectHomeEntryResult,
} from "./project-home-model"
import { ProjectSidebarShell } from "./project-sidebar-shell"
import { ProjectResetRecoveryState } from "./project-reset-recovery"
import { RendererErrorBoundary } from "./renderer-error-boundary"
import { GenerationModelCatalogController } from "./generation-model-catalog-controller"
import {
  ServiceCatalogController,
  serviceCatalogAgentModelsForScope,
  serviceGenerationAvailabilityVersion,
} from "./service-catalog-controller"
import { subscribeMountedCanvasResourceInvalidation } from "./project-resource-invalidation"
import { SettingsView } from "./settings-view"
import { readWorkbenchLayoutPreferences, writeWorkbenchLayoutPreferences } from "./workbench-layout-preferences"
import { readLastCanvasPreference, writeLastCanvasPreference } from "./workbench-preferences"
import { WorkspaceShell } from "./workspace-shell"
import { resolveWorkspaceLayout, workspaceShellMetrics } from "./workspace-layout-model"
import { WorkspaceResizeHandle } from "./workspace-resize-handle"
import { WorkspaceEntryCoordinator, waitForMountedWorkspaceTarget } from "./workspace-entry"
import {
  WorkspaceUtilityCollapseButton,
  WorkspaceUtilityDrawer,
  type WorkspaceUtilityActiveMode,
} from "./workspace-utility-drawer"
import {
  closedWorkspaceUtilityDrawer,
  openAgentUtility,
  reconcileWorkspaceUtilityDrawer,
  type WorkspaceUtilityDrawerState,
} from "./workspace-utility-drawer-state"
import { createWebPluginCanvasContribution } from "./web-plugin-canvas"
import "./styles.css"
import "./appearance-themes.css"

const primarySidebarBounds = workspaceShellMetrics.primarySidebar
const secondarySidebarBounds = workspaceShellMetrics.utilitySidebar
const primarySidebarCollapseThreshold = 180
const secondarySidebarCollapseThreshold = 260
const sidebarCollapseReopenDelayMs = 1_000

const applicationShortcutScopeId = "desktop.application"
const workspaceShortcutScopeId = "desktop.workspace"
const canvasShortcutScopeId = "desktop.canvas"
const conversationShortcutScopeId = "desktop.conversation"

function primaryShortcutChord(key: string, shift = false): ShortcutChord {
  return window.convax.platform === "darwin" ? { key, meta: true, shift } : { ctrl: true, key, shift }
}

function ShortcutScopeBoundary(props: {
  readonly children: ReactNode
  readonly id: string
  readonly service: ScopedShortcutService
}) {
  const ref = useShortcutScope(props.service, { id: props.id })
  return (
    <div className="size-full min-h-0" ref={ref}>
      {props.children}
    </div>
  )
}

function ensureWorkbenchPartVisible(controller: WorkbenchLayoutController, partId: string) {
  return controller.getSnapshot().parts[partId]?.visible === true || controller.setPartVisible(partId, true)
}

function App() {
  const shortcutService = useMemo(() => new ScopedShortcutService({ document, window }), [])
  const applicationShortcutScopeRef = useShortcutScope(shortcutService, {
    id: applicationShortcutScopeId,
    kind: "application",
  })
  const workspaceShortcutScopeRef = useShortcutScope(shortcutService, { id: workspaceShortcutScopeId })
  const canvasShortcutScopeRef = useShortcutScope(shortcutService, { id: canvasShortcutScopeId })
  const conversationShortcutScopeRef = useShortcutScope(shortcutService, { id: conversationShortcutScopeId })
  useEffect(() => () => shortcutService.dispose(), [shortcutService])
  const developmentIdentity = useMemo(() => rendererDevelopmentIdentity(window.location.href), [])
  const [notification, setNotification] = useState<CanvasNotification | null>(null)
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth)
  const [languagePreference, setLanguagePreference] = useState<AppLanguagePreference>(() =>
    readAppLanguagePreference(localStorage),
  )
  const [appearancePreferences, setAppearancePreferences] = useState(() => readAppearancePreferences(localStorage))
  const [appearanceSaveState, setAppearanceSaveState] = useState<"error" | "idle" | "saved">("idle")
  const [desktopSurface, setDesktopSurface] = useState(createDesktopSurfaceState)
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const [projectTitlebarEntryHost, setProjectTitlebarEntryHost] = useState<HTMLDivElement | null>(null)
  const [activeCanvasNodes, setActiveCanvasNodes] = useState<ProjectCanvasSidebarNodeProjection | null>(null)
  const [projectCanvasFilteredKinds, setProjectCanvasFilteredKinds] = useState<ReadonlySet<string>>(() => new Set())
  const [sidebarNodeReveal, setSidebarNodeReveal] = useState<{
    canvasId: string
    nodeId: string
    projectId: string
  } | null>(null)
  const [agentCompactStatus, setAgentCompactStatus] = useState<AgentCompactStatus>(() => resolveAgentCompactStatus({}))
  const [workspaceUtilityDrawer, setWorkspaceUtilityDrawer] =
    useState<WorkspaceUtilityDrawerState>(closedWorkspaceUtilityDrawer)
  const [mediaOperationDialog, setMediaOperationDialog] = useState<MediaOperationDialogRequest | null>(null)
  const [sharingProjectId, setSharingProjectId] = useState<string | null>(null)
  const [modelCatalogEpoch, setModelCatalogEpoch] = useState(0)
  const [startupEntryAttempt, setStartupEntryAttempt] = useState(0)
  const [startupEntryFailure, setStartupEntryFailure] = useState<{
    message: string
    projectId: string
  } | null>(null)
  const [startupRecoveryPending, setStartupRecoveryPending] = useState<"open" | "retry" | null>(null)
  const [startupRecoveryError, setStartupRecoveryError] = useState<string | null>(null)
  const startupAutoRestoreEnabledRef = useRef(true)
  const startupRecoveryPendingRef = useRef(false)
  const mountedProjectBindingRef = useRef<{
    id: string
    missing: boolean
    rootPath: string
  } | null>(null)
  const closeMediaOperationDialog = useCallback(() => setMediaOperationDialog(null), [])
  const settingsSurface = desktopSurface.kind === "settings" ? desktopSurface : null
  const settingsSection = settingsSurface?.initialSection
  const settingsServiceId = settingsSurface?.initialServiceId
  const settingsSkillName = settingsSurface?.initialSkillName
  const primaryDesktopSurface = settingsSurface?.returnTo ?? desktopSurface.kind
  const locale = useMemo(() => resolveAppLocale(languagePreference), [languagePreference])
  const pluginLocaleStore = useMemo(() => new DesktopPluginLocaleStore(locale), [])
  useEffect(() => {
    pluginLocaleStore.set(locale)
  }, [locale, pluginLocaleStore])
  useEffect(() => {
    document.title = developmentApplicationTitle(developmentIdentity)
  }, [developmentIdentity])
  const canvasEditorRef = useRef<CanvasEditorHandle>(null)
  const agentTitlebarTriggerRef = useRef<HTMLButtonElement>(null)
  const utilityReturnFocusTargetRef = useRef<HTMLElement | null>(null)
  const workspaceShellRef = useRef<HTMLElement>(null)
  const mountWorkspaceShell = useCallback(
    (element: HTMLElement | null) => {
      workspaceShellRef.current = element
      workspaceShortcutScopeRef(element)
    },
    [workspaceShortcutScopeRef],
  )
  const workbenchResizeSessionRef = useRef<CapturedPointerDragSession | null>(null)
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
  const canvasNodeRegistry = useMemo(() => createDefaultCanvasNodeRegistry(), [])
  const canvasFileRendererRegistry = useMemo(() => createDefaultCanvasFileRendererRegistry(), [])
  const canvasViewRegistry = useMemo(() => createCanvasViewRegistry(), [])
  const pluginFrameRegistry = useMemo(() => new DesktopPluginFrameRegistry(), [])
  const [installedPlugins, setInstalledPlugins] = useState<readonly ActiveInstalledWebPluginSummary[]>([])
  const [admittedOperationToolIds, setAdmittedOperationToolIds] = useState<ReadonlySet<string>>(() => new Set())
  const mediaOperationActions = useMemo(
    () => listInstalledMediaOperationActions(installedPlugins, admittedOperationToolIds),
    [admittedOperationToolIds, installedPlugins],
  )
  const pluginMaterializationActions = useMemo(
    () => listInstalledPluginMaterializationActions(installedPlugins),
    [installedPlugins],
  )
  const generationToolCatalogVersionRef = useRef("")
  const pluginHostContextRef = useRef<{
    activeCanvas?: { id: string; name: string }
    activeProject?: { id: string; name: string }
  }>({})
  const flushAuthoritativeCanvas = useCallback(async () => {
    return canvasEditorRef.current?.flush()
  }, [])
  const flushCanvasForAgent = useCallback(async () => {
    await flushAuthoritativeCanvas()
  }, [flushAuthoritativeCanvas])
  const projectController = useMemo(
    () =>
      new ProjectController(window.convax.projects, {
        beforeActiveProjectChange: async () => {
          const canLeave = await canvasEditorRef.current?.prepareToLeave()
          if (canLeave === false) return false
          await canvasEditorRef.current?.flush()
          return true
        },
        onActiveProjectChangeCanceled: () => canvasEditorRef.current?.resumeAfterLeaveCanceled(),
      }),
    [],
  )
  const projectFilesController = useMemo(() => new ProjectFilesController(window.convax.projectFiles), [])
  const projectCanvasController = useMemo(() => new ProjectCanvasController(window.convax.projects.canvases), [])
  const generationModelCatalogController = useMemo(
    () => new GenerationModelCatalogController(window.convax.generation, { storage: localStorage }),
    [],
  )
  const serviceCatalogController = useMemo(
    () =>
      new ServiceCatalogController(window.convax.pluginServices, window.convax.agent, {
        generationCatalog: generationModelCatalogController,
        storage: localStorage,
      }),
    [generationModelCatalogController],
  )
  const [initialLayoutPreferences] = useState(() =>
    readWorkbenchLayoutPreferences(localStorage, {
      primarySidebar: primarySidebarBounds,
      secondarySidebar: secondarySidebarBounds,
    }),
  )
  const workbenchLayoutController = useMemo(() => {
    return new WorkbenchLayoutController({
      parts: {
        [WorkbenchLayoutParts.PrimarySidebar]: {
          collapseReopenDelayMs: sidebarCollapseReopenDelayMs,
          collapseThreshold: primarySidebarCollapseThreshold,
          initialSize: initialLayoutPreferences.primarySidebar.size,
          initialVisible: initialLayoutPreferences.primarySidebar.visible,
          maxSize: primarySidebarBounds.maxSize,
          minSize: primarySidebarBounds.minSize,
        },
        [WorkbenchLayoutParts.SecondarySidebar]: {
          collapseReopenDelayMs: sidebarCollapseReopenDelayMs,
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
            await canvasEditorRef.current?.flush()
          }
          return true
        },
        onInputChangeCanceled: () => canvasEditorRef.current?.resumeAfterLeaveCanceled(),
      }),
    [],
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
  const projectStartup = useMemo(() => resolveProjectStartup(projectSnapshot), [projectSnapshot])
  const startupProjectId = projectStartup.kind === "restore" ? projectStartup.projectId : null
  const currentStartupEntryFailure =
    startupEntryFailure?.projectId === startupProjectId ? startupEntryFailure.message : null
  const projectBootstrapView = resolveProjectBootstrapView({
    entryFailure: currentStartupEntryFailure,
    recoveryError: startupRecoveryError,
    registryError: projectSnapshot.error,
    route: projectStartup,
  })
  const effectivePrimaryDesktopSurface = projectBootstrapView.kind === "opening" ? primaryDesktopSurface : "home"
  const activeProject = projectSnapshot.projects.find((project) => project.id === projectSnapshot.activeProjectId)
  const activeProjectId = activeProject?.id
  const projectResetCandidate = projectSnapshot.pendingRecoveryProjectId
    ? projectSnapshot.projects.find(
        (project) =>
          project.id === projectSnapshot.pendingRecoveryProjectId &&
          project.recovery?.status === "unsupported-project-data",
      )
    : undefined
  const projectCanvasSnapshot = useSyncExternalStore(
    projectCanvasController.subscribe,
    projectCanvasController.getSnapshot,
    projectCanvasController.getSnapshot,
  )
  const canvasCreationUnavailable = Boolean(
    activeProject &&
      projectCanvasSnapshot.projectId === activeProject.id &&
      !projectCanvasSnapshot.busy &&
      !projectCanvasSnapshot.error &&
      projectCanvasSnapshot.creationAvailability !== "available",
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
  const agentModelCatalog = serviceCatalogAgentModelsForScope(serviceCatalogSnapshot, activeProjectId)
  const generationPlugins = installedPlugins.flatMap((plugin) =>
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
  )
  const generationToolCatalogVersion = JSON.stringify([
    modelCatalogEpoch,
    generationPlugins,
    serviceGenerationAvailabilityVersion(
      serviceCatalogSnapshot,
      generationPlugins.map((plugin) => plugin.id),
    ),
  ])
  generationToolCatalogVersionRef.current = generationToolCatalogVersion
  useLayoutEffect(() => {
    generationModelCatalogController.setScope({
      authorityVersion: generationToolCatalogVersion,
      scopeId: activeProjectId,
    })
  }, [activeProjectId, generationModelCatalogController, generationToolCatalogVersion])
  useEffect(
    () => () => {
      workbenchResizeSessionRef.current?.cancel()
      workbenchResizeSessionRef.current = null
    },
    [],
  )
  useEffect(() => {
    void projectController.initialize()
  }, [projectController])
  useEffect(() => {
    if (projectBootstrapView.kind === "opening") return
    setDesktopSurface((current) => {
      if (current.kind === "settings") {
        return current.returnTo === "home" ? current : { ...current, returnTo: "home" }
      }
      return current.kind === "home" ? current : createDesktopSurfaceState()
    })
  }, [projectBootstrapView.kind])
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
  useEffect(
    () => () => {
      generationModelCatalogController.dispose()
    },
    [generationModelCatalogController],
  )
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
    void changeAppLanguage(locale)
    document.documentElement.lang = locale
  }, [locale])
  useEffect(() => {
    applyAppearancePreferences(document.documentElement, appearancePreferences)
  }, [appearancePreferences])
  useEffect(() => {
    if (window.convax.platform !== "darwin") return
    void window.convax.mainWindowControls.setCustomControlsVisible(true).catch(() => undefined)
    return () => {
      void window.convax.mainWindowControls.setCustomControlsVisible(false).catch(() => undefined)
    }
  }, [])
  useEffect(() => {
    const synchronizeStoredLanguage = () => setLanguagePreference(readAppLanguagePreference(localStorage))
    window.addEventListener("storage", synchronizeStoredLanguage)
    return () => {
      window.removeEventListener("storage", synchronizeStoredLanguage)
    }
  }, [])
  useShortcutFeature(shortcutService, {
    allowInEditable: true,
    chords: [primaryShortcutChord(",")],
    id: "application.open-settings",
    onTrigger: () => {
      workspaceEntryCoordinator.cancelPendingEntry()
      closeMediaOperationDialog()
      setDesktopSurface((current) => openDesktopSettings(current, "general"))
    },
    scopeId: applicationShortcutScopeId,
  })
  useShortcutFeature(
    shortcutService,
    settingsSection
      ? {
          allowInEditable: true,
          chords: [{ key: "Escape" }],
          id: "application.close-settings",
          onTrigger: () => setDesktopSurface(closeDesktopSettings),
          priority: 100,
          scopeId: applicationShortcutScopeId,
        }
      : null,
  )
  useEffect(() => {
    if (!workbenchLayoutSnapshot.resize) {
      writeWorkbenchLayoutPreferences(localStorage, workbenchLayoutSnapshot)
    }
  }, [workbenchLayoutSnapshot])
  useEffect(() => {
    const projectId = projectSnapshot.activeProjectId
    const binding = activeProject
      ? {
          id: activeProject.id,
          missing: activeProject.missing === true,
          rootPath: activeProject.rootPath,
        }
      : null
    const previousBinding = mountedProjectBindingRef.current
    const reboundActiveProject =
      binding !== null &&
      previousBinding?.id === binding.id &&
      (previousBinding.rootPath !== binding.rootPath || previousBinding.missing !== binding.missing)
    mountedProjectBindingRef.current = binding

    if (!reboundActiveProject) {
      workbenchController.setProject(projectId)
      void projectFilesController.setProject(projectId)
      void projectCanvasController.setProject(projectId)
      return
    }

    workbenchController.setProject(null)
    workbenchController.setProject(projectId)
    void Promise.all([projectFilesController.setProject(null), projectCanvasController.setProject(null)]).then(
      async () => {
        const currentBinding = mountedProjectBindingRef.current
        if (
          !projectId ||
          currentBinding?.id !== projectId ||
          currentBinding.rootPath !== binding.rootPath ||
          currentBinding.missing !== binding.missing
        ) {
          return
        }
        await Promise.all([projectFilesController.setProject(projectId), projectCanvasController.setProject(projectId)])
      },
    )
  }, [
    activeProject?.missing,
    activeProject?.rootPath,
    projectCanvasController,
    projectFilesController,
    projectSnapshot.activeProjectId,
    workbenchController,
  ])
  useEffect(() => {
    if (
      desktopSurface.kind !== "home" ||
      !startupAutoRestoreEnabledRef.current ||
      !startupProjectId ||
      currentStartupEntryFailure ||
      startupRecoveryPending
    ) {
      return
    }
    const abortController = new AbortController()
    void workspaceEntryCoordinator
      .enter({ projectId: startupProjectId, signal: abortController.signal })
      .then((entered) => {
        if (abortController.signal.aborted || entered) return
        setStartupEntryFailure({
          message:
            locale === "zh-CN"
              ? "Convax 未能恢复这个项目，请重试或重新打开项目文件夹。"
              : "Convax could not restore this Project. Try again or reopen its folder.",
          projectId: startupProjectId,
        })
      })
      .catch((error) => {
        if (abortController.signal.aborted) return
        setStartupEntryFailure({
          message: error instanceof Error ? error.message : String(error),
          projectId: startupProjectId,
        })
      })
    return () => abortController.abort()
  }, [
    currentStartupEntryFailure,
    desktopSurface.kind,
    locale,
    startupEntryAttempt,
    startupProjectId,
    startupRecoveryPending,
    workspaceEntryCoordinator,
  ])
  useLayoutEffect(() => {
    serviceCatalogController.setScopeId(activeProjectId)
  }, [activeProjectId, serviceCatalogController])
  const activeCanvasId =
    workbenchSnapshot.surface.kind === "canvas" && workbenchSnapshot.surface.input.projectId === activeProjectId
      ? workbenchSnapshot.surface.input.canvasId
      : undefined
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
  const activeWorkbenchCanvasRef = useRef<{ canvasId: string; scopeId: string } | null>(null)
  activeWorkbenchCanvasRef.current =
    activeProjectId && activeCanvasId ? { canvasId: activeCanvasId, scopeId: activeProjectId } : null
  const canvasSurfaceAccess = resolveProjectLocalCanvasSurfaceAccess({
    activeCanvasId,
    creationAvailability: projectCanvasSnapshot.creationAvailability,
  })
  useEffect(() => {
    setProjectCanvasFilteredKinds(new Set())
  }, [activeProjectId])
  const canvasSessionScopeKey = `${activeProjectId ?? "no-project"}:${activeCanvasId ?? "no-canvas"}`
  const [mountedCanvasSession, setMountedCanvasSession] = useState<{
    key: string
    session: DesktopCanvasRendererSession
  } | null>(null)
  const [canvasSessionFailure, setCanvasSessionFailure] = useState<{ key: string; message: string } | null>(null)
  useEffect(() => {
    setMountedCanvasSession(null)
    setCanvasSessionFailure(null)
    if (!activeProjectId || !activeCanvasId) return
    const key = `${activeProjectId}:${activeCanvasId}`
    const ref = { canvasId: activeCanvasId, scopeId: activeProjectId }
    return mountCanvasSessionWithBackgroundReconcile({
      onDiagnostic: (diagnostic) => {
        console.warn("[convax] Background Canvas generation reconciliation did not complete", diagnostic)
      },
      onMountFailure: (error) => {
        setCanvasSessionFailure({ key, message: error instanceof Error ? error.message : String(error) })
      },
      onMounted: (session) => setMountedCanvasSession({ key, session }),
      openSession: (signal) =>
        openDesktopCanvasRendererSession({
          ref,
          signal,
          transport: window.convax.canvas.sessions,
        }),
      reconcileCanvas: (mountedRef) => window.convax.generation.reconcileCanvas({ ref: mountedRef }),
      ref,
    })
  }, [activeCanvasId, activeProjectId])
  const activeCanvasSession = mountedCanvasSession?.key === canvasSessionScopeKey ? mountedCanvasSession.session : null
  const activeCanvasSessionFailure =
    canvasSessionFailure?.key === canvasSessionScopeKey ? canvasSessionFailure.message : null
  const publishCanvasSelection = useCallback(
    (projection: CanvasSelectionProjection) => {
      publishCanvasSelectionToWorkbench({
        activeCanvasId,
        activeProjectId,
        controller: workbenchController,
        expectedViewId: "desktop-main",
        projection,
      })
    },
    [activeCanvasId, activeProjectId, workbenchController],
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

  useEffect(() => {
    return subscribeInstalledPluginInventory(
      combineInstalledPluginInventoryChanges(window.convax.plugins, window.convax.marketplaces, () =>
        setModelCatalogEpoch((current) => current + 1),
      ),
      setInstalledPlugins,
      (error) => console.error("Could not load installed Canvas Plugins", error),
    )
  }, [])

  useEffect(() => {
    let active = true
    if (!activeProjectId) {
      setAdmittedOperationToolIds(new Set())
      return () => {
        active = false
      }
    }
    void window.convax.generation
      .listTools({ scopeId: activeProjectId })
      .then((tools) => {
        if (!active) return
        setAdmittedOperationToolIds(new Set(tools.filter((tool) => tool.kind === "operation").map((tool) => tool.id)))
      })
      .catch((error) => {
        if (!active) return
        setAdmittedOperationToolIds(new Set())
        console.error("Could not load admitted Plugin operations", error)
      })
    return () => {
      active = false
    }
  }, [activeProjectId, generationToolCatalogVersion])

  useEffect(() => {
    const disposers: Array<() => void> = []
    for (const plugin of installedPlugins) {
      if (!hasWebPluginCanvasSurface(plugin)) continue
      try {
        disposers.push(
          canvasFileRendererRegistry.registerPlugin(
            createWebPluginCanvasContribution(plugin, {
              frameRegistry: pluginFrameRegistry,
              getActiveProjectId: () => activeProjectIdRef.current,
              locale: pluginLocaleStore,
            }),
          ),
        )
      } catch (error) {
        console.error(`Could not register Canvas Plugin ${plugin.id}`, error)
      }
    }
    return () => disposers.reverse().forEach((dispose) => dispose())
  }, [canvasFileRendererRegistry, installedPlugins, pluginFrameRegistry, pluginLocaleStore])
  useEffect(() => {
    if (
      effectivePrimaryDesktopSurface !== "workspace" ||
      !activeProjectId ||
      projectCanvasSnapshot.projectId !== activeProjectId
    ) {
      return
    }
    void projectCanvasWorkbench.reconcile(activeProjectId, readLastCanvasPreference(localStorage, activeProjectId))
  }, [
    activeProjectId,
    effectivePrimaryDesktopSurface,
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
  useEffect(() => {
    setActiveCanvasNodes((current) =>
      current && current.projectId === activeProjectId && current.canvasId === activeCanvasId ? current : null,
    )
  }, [activeCanvasId, activeProjectId])
  const publishActiveCanvasNodes = useCallback((document: CanvasDocument) => {
    const current = pluginHostContextRef.current
    if (!current.activeProject || current.activeCanvas?.id !== document.id) return
    const next = {
      canvasId: document.id,
      nodes: projectCanvasSidebarNodes(document),
      projectId: current.activeProject.id,
    } satisfies ProjectCanvasSidebarNodeProjection
    setActiveCanvasNodes((previous) => (sameProjectCanvasNodeProjection(previous, next) ? previous : next))
  }, [])
  const publishResolvedCanvasSidebarNodes = useCallback(
    (next: ProjectCanvasSidebarNodeProjection) => {
      const live = workbenchController.getSnapshot()
      if (
        live.projectId !== next.projectId ||
        live.surface.kind !== "canvas" ||
        live.surface.input.projectId !== next.projectId ||
        live.surface.input.canvasId !== next.canvasId
      ) {
        return
      }
      setActiveCanvasNodes((previous) =>
        previous?.projectId === next.projectId && previous.canvasId === next.canvasId ? previous : next,
      )
    },
    [workbenchController],
  )
  const loadProjectCanvasNodes = useCallback(
    async ({ canvasId, projectId }: { canvasId: string; projectId: string }) => {
      const snapshot = await window.convax.canvas.documents.load({ canvasId, scopeId: projectId })
      return projectCanvasSidebarNodes(snapshot.projection)
    },
    [],
  )
  const activateProjectCanvasNode = useCallback(
    async ({ canvasId, nodeId }: { canvasId: string; nodeId: string }) => {
      const projectId = activeProjectId
      if (!projectId || !(await projectCanvasWorkbench.openCanvas(projectId, canvasId))) return
      setSidebarNodeReveal({ canvasId, nodeId, projectId })
    },
    [activeProjectId, projectCanvasWorkbench],
  )
  useEffect(() => {
    const pending = sidebarNodeReveal
    if (!pending) return
    if (pending.projectId !== activeProjectId) {
      setSidebarNodeReveal(null)
      return
    }
    const mounted = canvasEditorScopeRef.current
    if (
      pending.canvasId !== activeCanvasId ||
      mounted?.projectId !== pending.projectId ||
      mounted.canvasId !== pending.canvasId
    ) {
      return
    }
    setSidebarNodeReveal(null)
    void canvasViewRegistry
      .execute({
        command: {
          animation: appearancePreferences.reducedMotion ? "instant" : "smooth",
          fit: "center",
          nodeIds: [pending.nodeId],
          select: true,
          type: "nodes.reveal",
        },
        expectedDocumentId: pending.canvasId,
        expectedScopeId: pending.projectId,
        viewId: "desktop-main",
      })
      .catch((error) => console.warn("Could not reveal the Canvas node from the Project sidebar", error))
  }, [activeCanvasId, activeProjectId, appearancePreferences.reducedMotion, canvasViewRegistry, sidebarNodeReveal])
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
  const openSettings = useCallback(
    (target: ApplicationMenuTarget, serviceId?: string) => {
      workspaceEntryCoordinator.cancelPendingEntry()
      closeMediaOperationDialog()
      setDesktopSurface((current) => openDesktopSettings(current, target, undefined, serviceId))
    },
    [closeMediaOperationDialog, workspaceEntryCoordinator],
  )
  const openServices = useCallback(() => openSettings("services"), [openSettings])
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
        getActiveRef: () => activeWorkbenchCanvasRef.current,
        getEditor: () => canvasEditorRef.current,
        views: canvasViewRegistry,
      }),
    [canvasViewRegistry],
  )
  // Main verifies Canvas session opens against the renderer's live Workbench
  // scope. Register the request bridge before passive session-opening effects
  // run, otherwise first mount can race and appear to have no active Canvas.
  useLayoutEffect(
    () => window.convax.canvas.renderer.onRequest(canvasRendererRequestHandler),
    [canvasRendererRequestHandler],
  )
  const services = useMemo(() => {
    const generateService: CanvasGenerateService = {
      cancel(operationId) {
        return window.convax.generation.cancel({ operationId })
      },
      get catalogVersion() {
        return generationToolCatalogVersionRef.current
      },
      getCachedDescription(toolId) {
        if (!activeProjectId || !activeCanvasId) return undefined
        return generationModelCatalogController.peekDescription(toolId)
      },
      getCachedTools(query) {
        if (!activeProjectId || !activeCanvasId) return undefined
        const tools = generationModelCatalogController.peekTools(query.output)
        if (!tools) return undefined
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
      subscribeCatalog(listener) {
        return generationModelCatalogController.subscribe(listener)
      },
      async describeTool(toolId, signal) {
        if (!activeProjectId || !activeCanvasId) {
          throw new Error("Open a Project Canvas before configuring a generation model")
        }
        if (signal?.aborted) throw signal.reason
        const description = await generationModelCatalogController.describeTool(toolId)
        if (signal?.aborted) throw signal.reason
        return description
      },
      async listTools(query, signal) {
        if (!activeProjectId || !activeCanvasId) return []
        if (signal?.aborted) throw signal.reason
        const tools = await generationModelCatalogController.listTools(query.output)
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
          operationId,
          ...(request.output ? { output: request.output } : {}),
          ...(request.parentId ? { parentId: request.parentId } : {}),
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
      folderBrowse: createProjectFolderBrowseService({
        currentScope: () => {
          const current = pluginHostContextRef.current
          return current.activeProject && current.activeCanvas
            ? { canvasId: current.activeCanvas.id, projectId: current.activeProject.id }
            : null
        },
        flush: flushAuthoritativeCanvas,
        projectFiles: window.convax.projectFiles,
      }),
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
            <ShortcutScopeBoundary
              id={`${conversationShortcutScopeId}:${request.document.id}:${request.ownerNodeId}`}
              service={shortcutService}
            >
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
            </ShortcutScopeBoundary>
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
        async hydrateStale({ signal }) {
          if (!activeProjectId || !activeCanvasId) {
            throw new Error("Open a Project Canvas before refreshing resources")
          }
          if (signal.aborted) throw signal.reason
          const hydrated = await window.convax.canvas.resources.hydrateStale({
            canvasId: activeCanvasId,
          })
          if (signal.aborted) throw signal.reason
          return hydrated
        },
        markStale: markProjectCanvasResourcesStale,
      },
      mutation: {
        async add(request) {
          if (request.signal.aborted) throw request.signal.reason
          if (!activeProjectId || !activeCanvasId || !activeCanvasSession) {
            throw new Error("Open a Project Canvas before adding resources")
          }
          const delivery = await activeCanvasSession.runResourceMutation(
            () =>
              addCanvasUploadResources(
                {
                  ...request,
                  canvasId: activeCanvasId,
                  projectId: activeProjectId,
                },
                {
                  add: (input) => window.convax.canvas.resources.add(input),
                  createCommandId: () => `renderer:${globalThis.crypto.randomUUID()}`,
                  createLocalFileToken: (file) => window.convax.canvas.resources.createLocalFileToken(file),
                  createSourceId: () => `renderer_${globalThis.crypto.randomUUID()}`,
                  sessionId: activeCanvasSession.sessionId,
                },
              ),
            request.signal,
          )
          return {
            authoritativeProjectionDelivered: delivery.projectionDelivered,
            createdNodeIds: delivery.result.createdNodeIds,
            warnings: delivery.result.warnings,
          }
        },
        async relink(request) {
          if (!activeCanvasSession) throw new Error("Open a mounted Project Canvas before relinking resources")
          const delivery = await activeCanvasSession.runResourceMutation(
            () =>
              runProjectCanvasResourceRelink({
                activeCanvasId,
                activeProjectId,
                createCommandId: () => `renderer:${globalThis.crypto.randomUUID()}`,
                projectFiles: projectFilesController,
                request,
                resources: window.convax.canvas.resources,
                sessionId: activeCanvasSession.sessionId,
              }),
            request.signal,
          )
          return {
            authoritativeProjectionDelivered: delivery.projectionDelivered,
            warnings: delivery.result.warnings,
          }
        },
        async saveEditableCopy(request) {
          if (request.signal.aborted) throw request.signal.reason
          if (!activeCanvasId || !activeProjectId || !activeCanvasSession) {
            throw new Error("Open a mounted Project Canvas before saving an editable copy")
          }
          const delivery = await activeCanvasSession.runResourceMutation(
            () =>
              window.convax.canvas.resources.saveEditableCopy({
                canvasId: activeCanvasId,
                commandId: `renderer:${globalThis.crypto.randomUUID()}`,
                nodeId: request.nodeId,
                projectId: activeProjectId,
                sessionId: activeCanvasSession.sessionId,
              }),
            request.signal,
          )
          return {
            authoritativeProjectionDelivered: delivery.projectionDelivered,
            warnings: delivery.result.warnings,
          }
        },
      },
      generate: generateService,
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
  }, [
    activeCanvasId,
    activeCanvasSession,
    activeProjectId,
    flushAuthoritativeCanvas,
    generationModelCatalogController,
    generationToolCatalogVersion,
    shortcutService,
  ])

  const runMediaOperation = useCallback(
    async (request: MediaOperationDialogRequest, input: MediaOperationInput, signal: AbortSignal) => {
      if (signal.aborted) {
        throw signal.reason ?? new DOMException("Canceled", "AbortError")
      }
      const requests = createMediaOperationGenerateRequests(request, input, signal)
      const authoritativeDocument = await flushAuthoritativeCanvas()
      if (signal.aborted) throw signal.reason ?? new DOMException("Canceled", "AbortError")
      const live = pluginHostContextRef.current
      if (
        !authoritativeDocument ||
        authoritativeDocument.id !== request.canvasId ||
        live.activeProject?.id !== request.projectId ||
        live.activeCanvas?.id !== request.canvasId
      ) {
        throw new Error("The active Canvas changed before the media operation could be admitted")
      }

      const steps = requests.map((generateRequest, index) => {
        if (generateRequest.context.documentId !== request.canvasId) {
          throw new Error("Media operation admission must target the active Canvas")
        }
        const referenceConstraint = canvasCardGenerationReferenceConstraint(generateRequest)
        return {
          ...(index === 0
            ? {}
            : { relationAnchorStepIndexes: Array.from({ length: index }, (_, relationIndex) => relationIndex) }),
          request: {
            anchor: generateRequest.anchor,
            expectedOutputCount: 1,
            operationId: generateRequest.operationId ?? globalThis.crypto.randomUUID(),
            ...(generateRequest.output ? { output: generateRequest.output } : {}),
            ...(generateRequest.parentId ? { parentId: generateRequest.parentId } : {}),
            prompt: generateRequest.prompt,
            ...(generateRequest.promptContextNodeIds?.length
              ? { promptContextNodeIds: generateRequest.promptContextNodeIds }
              : {}),
            ref: { canvasId: request.canvasId, scopeId: request.projectId },
            ...(referenceConstraint ? { referenceConstraint } : {}),
            references: generateRequest.references,
            ...(generateRequest.relationAnchorNodeIds
              ? { relationAnchorNodeIds: generateRequest.relationAnchorNodeIds }
              : {}),
            resultMode: { type: "create-pending-node" as const },
            ...(generateRequest.toolId ? { toolId: generateRequest.toolId } : {}),
            ...(generateRequest.toolInput ? { toolInput: generateRequest.toolInput } : {}),
          },
        }
      })
      await runMediaOperationAdmission({
        admit: (admissionRequest) => window.convax.generation.admitCanvas(admissionRequest),
        cancel: (cancelRequest) => window.convax.generation.cancel(cancelRequest),
        request: { steps },
        signal,
      })
    },
    [flushAuthoritativeCanvas],
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
        label: localizedMediaOperationText(action.title, locale, action.i18n),
        icon: <MediaOperationActionIcon editor={action.editor} />,
        visible(context: CanvasSelectionActionContext) {
          return canRunMediaOperation(context, action)
        },
        async execute(context: CanvasSelectionActionContext) {
          if (!activeCanvasId || !activeProjectId) return
          if (action.delivery === "return") {
            const sourceNodeId = context.selectedNodeIds[0]
            if (!sourceNodeId) throw new Error("Select one Project media file before running this action")
            const authoritative = await flushAuthoritativeCanvas()
            if (context.signal.aborted) {
              throw context.signal.reason ?? new DOMException("Canceled", "AbortError")
            }
            const live = pluginHostContextRef.current
            if (
              !authoritative ||
              authoritative.id !== activeCanvasId ||
              live.activeProject?.id !== activeProjectId ||
              live.activeCanvas?.id !== activeCanvasId
            ) {
              throw new Error("The active Canvas changed before the media operation could start")
            }
            const authoritativeContext: CanvasSelectionActionContext = {
              document: authoritative,
              selectedEdgeIds: [],
              selectedNodeIds: [sourceNodeId],
              selectedNodes: authoritative.nodes.filter((node) => node.id === sourceNodeId),
              signal: context.signal,
            }
            const request = createMediaOperationReturnRequest(
              { action, canvasId: activeCanvasId, context: authoritativeContext, projectId: activeProjectId },
              globalThis.crypto.randomUUID(),
            )
            const result = await runMediaOperationReturn({
              cancel: (cancelRequest) => window.convax.generation.cancel(cancelRequest),
              generate: (generateRequest) => window.convax.generation.generate(generateRequest),
              request,
              signal: context.signal,
            })
            if (context.signal.aborted) return
            setNotification({
              description:
                result.warnings.length > 0
                  ? result.warnings.join("\n")
                  : locale === "zh-CN"
                    ? "已完成操作。"
                    : "The operation completed.",
              kind: result.warnings.length > 0 ? "warning" : "success",
              title: localizedMediaOperationText(action.title, locale, action.i18n),
            })
            return
          }
          const request = { action, canvasId: activeCanvasId, context, projectId: activeProjectId }
          if (action.editor === "immediate") {
            await runMediaOperation(request, {}, context.signal)
            return
          }
          setMediaOperationDialog(request)
        },
      })),
      ...pluginMaterializationActions.map((action) => ({
        id: `plugin-materialization-action:${action.pluginId}/${action.id}`,
        label: localizedMediaOperationText(action.title, locale, action.i18n),
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
            title: localizedMediaOperationText(action.title, locale, action.i18n),
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
      runMediaOperation,
    ],
  )

  const selectionDragSource = useMemo<CanvasSelectionDragSource | undefined>(() => {
    const client = window.convax.canvas.externalMediaDrag
    if (window.convax.platform !== "darwin" || !activeCanvasId || !activeProjectId || !client) return undefined
    return createCanvasMediaSelectionDragSource({
      client,
      flush: flushCanvasForAgent,
      icon: <FileOutput />,
      label: locale === "zh-CN" ? "继续按住 ⌘⇧，拖到 Finder 或其他应用" : "Keep holding ⌘⇧ and drag outside Convax",
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

  const canvasShortcutsEnabled = Boolean(
    activeCanvasSession &&
      desktopSurface.kind === "workspace" &&
      !settingsSection &&
      !activeMediaOperationDialog &&
      !sharingProjectId &&
      !workbenchSnapshot.changingInput &&
      !projectCanvasSnapshot.busy &&
      !projectSnapshot.changingActiveProject,
  )
  const reportCanvasHistoryFailure = useCallback((direction: "redo" | "undo", error: unknown) => {
    console.warn(`Canvas ${direction} failed`, error)
    setNotification({
      kind: "error",
      title: direction === "undo" ? "Could not undo Canvas change" : "Could not redo Canvas change",
    })
  }, [])
  const runCanvasHistory = useCallback(
    (direction: "redo" | "undo") => {
      if (!activeCanvasSession) return
      void activeCanvasSession[direction]().catch((error) => reportCanvasHistoryFailure(direction, error))
    },
    [activeCanvasSession, reportCanvasHistoryFailure],
  )
  useShortcutFeature(
    shortcutService,
    canvasShortcutsEnabled
      ? {
          chords: [primaryShortcutChord("z")],
          id: "workspace.canvas.undo",
          onTrigger: () => runCanvasHistory("undo"),
          scopeId: workspaceShortcutScopeId,
        }
      : null,
  )
  useShortcutFeature(
    shortcutService,
    canvasShortcutsEnabled
      ? {
          chords: [primaryShortcutChord("z", true), { ctrl: true, key: "y" }],
          id: "workspace.canvas.redo",
          onTrigger: () => runCanvasHistory("redo"),
          scopeId: workspaceShortcutScopeId,
        }
      : null,
  )
  useShortcutFeature(
    shortcutService,
    canvasShortcutsEnabled
      ? {
          chords: [primaryShortcutChord("z")],
          id: "canvas.undo",
          onTrigger: () => runCanvasHistory("undo"),
          scopeId: canvasShortcutScopeId,
        }
      : null,
  )
  useShortcutFeature(
    shortcutService,
    canvasShortcutsEnabled
      ? {
          chords: [primaryShortcutChord("z", true), { ctrl: true, key: "y" }],
          id: "canvas.redo",
          onTrigger: () => runCanvasHistory("redo"),
          scopeId: canvasShortcutScopeId,
        }
      : null,
  )
  useShortcutFeature(
    shortcutService,
    canvasShortcutsEnabled
      ? {
          chords: [primaryShortcutChord("f")],
          id: "canvas.search",
          onTrigger: () => canvasEditorRef.current?.openSearch(),
          scopeId: canvasShortcutScopeId,
        }
      : null,
  )
  useShortcutFeature(
    shortcutService,
    canvasShortcutsEnabled && selectionDragSource
      ? {
          chords:
            window.convax.platform === "darwin"
              ? [
                  { key: "Meta", meta: true, shift: true },
                  { key: "Shift", meta: true, shift: true },
                ]
              : [
                  { ctrl: true, key: "Control", shift: true },
                  { ctrl: true, key: "Shift", shift: true },
                ],
          consume: false,
          id: "canvas.drag-media-to-other-apps",
          onRelease: () => canvasEditorRef.current?.setExternalDragShortcutHeld(false),
          onTrigger: () => canvasEditorRef.current?.setExternalDragShortcutHeld(true),
          releaseOnAnyOtherKey: true,
          scopeId: canvasShortcutScopeId,
          trigger: "hold",
        }
      : null,
  )

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
      if (event.button !== 0 || !event.isPrimary || workbenchResizeSessionRef.current) return
      const captureTarget = workspaceShellRef.current
      if (!captureTarget) return
      const part = workbenchLayoutController.getSnapshot().parts[partId]
      if (!part || !workbenchLayoutController.beginResize(partId)) return
      event.preventDefault()
      event.currentTarget.focus({ preventScroll: true })
      const startX = event.clientX
      const startSize = part.size
      const direction = partId === WorkbenchLayoutParts.PrimarySidebar ? 1 : -1

      const update = (clientX: number) => {
        const layout = workbenchLayoutController.getSnapshot()
        const primary = getWorkbenchLayoutPartSnapshot(layout, WorkbenchLayoutParts.PrimarySidebar)!
        const secondary = getWorkbenchLayoutPartSnapshot(layout, WorkbenchLayoutParts.SecondarySidebar)!
        const presentation = resolveWorkspaceLayout({
          agentVisible: secondary.visible,
          projectSidebarVisible: primary.visible,
          viewportWidth: window.innerWidth,
        })
        const occupiedByPrimary = presentation.projectSidebar === "dock" ? primary.size : 0
        const occupiedBySecondary = presentation.agent === "dock" ? secondary.size : 0
        const available =
          partId === WorkbenchLayoutParts.PrimarySidebar
            ? window.innerWidth - occupiedBySecondary - workspaceShellMetrics.minimumCanvasPeekSize
            : presentation.utilityPresentation === "dock"
              ? window.innerWidth - occupiedByPrimary - workspaceShellMetrics.minimumCanvasPeekSize
              : presentation.utilityPresentation === "overlay"
                ? window.innerWidth - workspaceShellMetrics.utilityOverlayInset * 2
                : window.innerWidth
        const requested = startSize + (clientX - startX) * direction
        const constrained = Math.min(requested, Math.max(0, available))
        workbenchLayoutController.updateResize(constrained - startSize)
        const resizedPart = getWorkbenchLayoutPartSnapshot(workbenchLayoutController.getSnapshot(), partId)!
        return resizedPart.visible ? undefined : "commit"
      }

      let session: CapturedPointerDragSession | null = null
      session = startCapturedPointerDrag({
        cancel: () => {
          workbenchLayoutController.cancelResize()
        },
        captureTarget,
        commit: () => {
          workbenchLayoutController.endResize()
        },
        onSettled: () => {
          if (workbenchResizeSessionRef.current === session) workbenchResizeSessionRef.current = null
        },
        pointerId: event.pointerId,
        suppressClickAfterCommit: true,
        update,
      })
      if (session) workbenchResizeSessionRef.current = session
    },
    [workbenchLayoutController],
  )

  const primarySidebar = getWorkbenchLayoutPartSnapshot(workbenchLayoutSnapshot, WorkbenchLayoutParts.PrimarySidebar)!
  const secondarySidebar = getWorkbenchLayoutPartSnapshot(
    workbenchLayoutSnapshot,
    WorkbenchLayoutParts.SecondarySidebar,
  )!
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
  const workspaceLayout = resolveWorkspaceLayout({
    agentVisible: secondarySidebar.visible,
    projectSidebarVisible: primarySidebar.visible,
    viewportWidth,
  })
  const primarySidebarOccupiedSize =
    activeProject && primarySidebar.visible && workspaceLayout.projectSidebar === "dock" ? primarySidebar.size : 0
  const secondarySidebarAvailableSize = Math.max(
    secondarySidebarBounds.minSize,
    workspaceLayout.utilityPresentation === "sheet"
      ? viewportWidth
      : workspaceLayout.utilityPresentation === "overlay"
        ? viewportWidth - workspaceShellMetrics.utilityOverlayInset * 2
        : viewportWidth - primarySidebarOccupiedSize - workspaceShellMetrics.minimumCanvasPeekSize,
  )
  const secondarySidebarMaxWidthStyle =
    workspaceLayout.utilityPresentation === "sheet"
      ? "100vw"
      : workspaceLayout.utilityPresentation === "overlay"
        ? `calc(100vw - ${workspaceShellMetrics.utilityOverlayInset * 2}px)`
        : `calc(100vw - ${primarySidebarOccupiedSize + workspaceShellMetrics.minimumCanvasPeekSize}px)`
  const resizingPrimarySidebar = workbenchLayoutSnapshot.resize?.partId === WorkbenchLayoutParts.PrimarySidebar
  const resizingSecondarySidebar = workbenchLayoutSnapshot.resize?.partId === WorkbenchLayoutParts.SecondarySidebar
  const openWorkspaceSettings = useCallback(() => openSettings("general"), [openSettings])
  const openAgentDrawer = useCallback(
    (returnFocusTarget?: HTMLElement | null) => {
      if (!activeProjectId) return
      if (!ensureWorkbenchPartVisible(workbenchLayoutController, WorkbenchLayoutParts.SecondarySidebar)) return
      utilityReturnFocusTargetRef.current = returnFocusTarget ?? null
      setWorkspaceUtilityDrawer(openAgentUtility(activeProjectId))
    },
    [activeProjectId, workbenchLayoutController],
  )
  const openCanvasGenerate = useCallback(() => {
    if (!activeProjectId || !activeCanvasId) return
    const mounted = canvasEditorScopeRef.current
    if (mounted?.projectId !== activeProjectId || mounted.canvasId !== activeCanvasId) return
    mounted.handle.openGenerate()
  }, [activeCanvasId, activeProjectId])
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
          if (!ensureWorkbenchPartVisible(workbenchLayoutController, WorkbenchLayoutParts.SecondarySidebar)) {
            throw new Error("The Agent panel is temporarily locked after resizing")
          }
          setWorkspaceUtilityDrawer(openAgentUtility(lease.projectId))
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
          await waitForMountedWorkspaceTarget({
            read: () => {
              const mounted = canvasEditorScopeRef.current
              return mounted?.projectId === lease.projectId && mounted.canvasId === lease.canvasId
                ? mounted.handle
                : null
            },
          })
          if (!lease.validate("canvas") || !lease.canvasId) {
            throw new Error("The active Canvas changed before the Plugin was ready")
          }
          const result = await window.convax.canvas.pluginSurfaces.create({
            canvasId: lease.canvasId,
            pluginId: plugin.id,
            projectId: lease.projectId,
          })
          // Durable create already succeeded; projection refresh must not undo it.
          try {
            await canvasEditorRef.current?.reloadAuthoritative()
            canvasEditorRef.current?.selectNodes([result.createdNodeId])
          } catch (error) {
            console.warn("Plugin surface created, but Canvas projection refresh failed", error)
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
    async (projectId: string) => {
      setStartupEntryFailure(null)
      try {
        const entered = await workspaceEntryCoordinator.enter({ projectId })
        if (!entered) {
          setStartupEntryFailure({
            message:
              locale === "zh-CN"
                ? "Convax 未能恢复这个项目，请重试或重新打开项目文件夹。"
                : "Convax could not restore this Project. Try again or reopen its folder.",
            projectId,
          })
        }
        return entered
      } catch (error) {
        setStartupEntryFailure({
          message: error instanceof Error ? error.message : String(error),
          projectId,
        })
        throw error
      }
    },
    [locale, workspaceEntryCoordinator],
  )
  const cancelProjectReset = useCallback(() => {
    if (projectSnapshot.pendingRecoveryProjectId) {
      projectController.dismissPendingRecoveryProject(projectSnapshot.pendingRecoveryProjectId)
    }
  }, [projectController, projectSnapshot.pendingRecoveryProjectId])
  const closeUnavailableProjectReset = useCallback(
    (error?: string) => {
      if (error) setStartupRecoveryError(error)
      cancelProjectReset()
    },
    [cancelProjectReset],
  )
  const activateResetProject = useCallback(
    async (projectId: string) => {
      await projectController.activate(projectId)
      const snapshot = projectController.getSnapshot()
      if (snapshot.activeProjectId !== projectId || snapshot.error) {
        throw new Error(snapshot.error ?? "The reset Project could not be activated.")
      }
      const entered = await enterHomeProject(projectId)
      if (entered === false) throw new Error("The reset Project could not be opened.")
    },
    [enterHomeProject, projectController],
  )
  const openProjectFromRecovery = useCallback(() => {
    if (startupRecoveryPendingRef.current) return
    const recoveryErrorBeforeOpen = startupRecoveryError ?? currentStartupEntryFailure ?? projectSnapshot.error
    startupRecoveryPendingRef.current = true
    startupAutoRestoreEnabledRef.current = false
    setStartupRecoveryPending("open")
    setStartupRecoveryError(null)
    void enterSelectedProjectFromHome(projectController, () => projectController.openProject(), enterHomeProject)
      .then((result: ProjectHomeEntryResult) => {
        setStartupRecoveryError(recoveryErrorAfterProjectSelection(result, recoveryErrorBeforeOpen))
      })
      .catch((error: unknown) => {
        setStartupRecoveryError(error instanceof Error ? error.message : String(error))
      })
      .finally(() => {
        startupRecoveryPendingRef.current = false
        setStartupRecoveryPending(null)
      })
  }, [currentStartupEntryFailure, enterHomeProject, projectController, projectSnapshot.error, startupRecoveryError])
  const retryProjectStartup = useCallback(() => {
    if (startupRecoveryPendingRef.current) return
    startupRecoveryPendingRef.current = true
    startupAutoRestoreEnabledRef.current = true
    setStartupRecoveryPending("retry")
    setStartupRecoveryError(null)
    const finishRetry = () => {
      startupRecoveryPendingRef.current = false
      setStartupRecoveryPending(null)
    }
    if (currentStartupEntryFailure && startupProjectId) {
      setStartupEntryFailure(null)
      setStartupEntryAttempt((current) => current + 1)
      void Promise.resolve().then(finishRetry)
      return
    }
    void projectController.initialize().finally(finishRetry)
  }, [currentStartupEntryFailure, projectController, startupProjectId])
  const handleTitlebarBrand = useCallback(() => {
    if (desktopSurface.kind === "settings") setDesktopSurface(closeDesktopSettings)
  }, [desktopSurface.kind])
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
            if (!ensureWorkbenchPartVisible(workbenchLayoutController, WorkbenchLayoutParts.SecondarySidebar)) {
              throw new Error("The Agent panel is temporarily locked after resizing")
            }
            setWorkspaceUtilityDrawer(openAgentUtility(lease.projectId))
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

  const resolveProjectFileThumbnailUrl = useCallback(
    async ({ path, projectId }: { path: string; projectId: string }) =>
      (await window.convax.projectFiles.readFileThumbnail({ path, projectId })).dataUrl,
    [],
  )
  const openProjectFilePreview = useCallback(
    async ({ path, projectId, purpose }: { path: string; projectId: string; purpose: ProjectFilePreviewPurpose }) => {
      const lease = await window.convax.projectFiles.openFilePreview({ path, projectId, purpose })
      let released = false
      return {
        async release() {
          if (released) return
          released = true
          await window.convax.projectFiles.closeFilePreview({ leaseId: lease.leaseId })
        },
        url: lease.url,
      }
    },
    [],
  )
  const handleProjectFileActivate = useCallback(
    ({ entry, projectId }: { entry: ProjectEntry; projectId: string }) => {
      const current = pluginHostContextRef.current
      const canvasId = current.activeCanvas?.id
      if (!canvasId || current.activeProject?.id !== projectId) return
      const scope = { canvasId, projectId }
      void (async () => {
        try {
          await revealProjectFileOnCanvas({
            currentScope: () => {
              const live = pluginHostContextRef.current
              return live.activeProject && live.activeCanvas
                ? { canvasId: live.activeCanvas.id, projectId: live.activeProject.id }
                : null
            },
            documents: window.convax.canvas.documents,
            editor: () => {
              const mounted = canvasEditorScopeRef.current
              return mounted
                ? {
                    canvasId: mounted.canvasId,
                    handle: mounted.handle,
                    projectId: mounted.projectId,
                  }
                : null
            },
            path: entry.path,
            scope,
            views: canvasViewRegistry,
          })
        } catch (error) {
          console.warn("Could not reveal the Project file on Canvas", error)
        }
      })()
    },
    [canvasViewRegistry],
  )

  const activeProjectCanvasNodes =
    activeCanvasId &&
    activeCanvasNodes &&
    activeCanvasNodes.projectId === activeProjectId &&
    activeCanvasNodes.canvasId === activeCanvasId
      ? activeCanvasNodes.nodes
      : []
  const projectSidebar = activeProject ? (
    <ProjectSidebar
      className="w-full"
      controller={projectController}
      extension={{
        actions: (
          <ProjectCanvasSidebarTools
            filteredKinds={projectCanvasFilteredKinds}
            nodes={activeProjectCanvasNodes}
            onFilteredKindsChange={setProjectCanvasFilteredKinds}
          />
        ),
        busy: projectCanvasSnapshot.busy || workbenchSnapshot.changingInput,
        content: ({ query }) => (
          <ProjectCanvasSidebar
            activeCanvasId={activeCanvasId ?? null}
            activeNodes={activeCanvasNodes}
            controller={projectCanvasController}
            filteredKinds={projectCanvasFilteredKinds}
            loadNodes={loadProjectCanvasNodes}
            creationUnavailableReason={
              canvasCreationUnavailable
                ? locale === "zh-CN"
                  ? "当前本地项目不可创建画布。"
                  : "This local Project cannot create a Canvas in its current state."
                : undefined
            }
            navigationBusy={workbenchSnapshot.changingInput}
            navigationError={workbenchSnapshot.error}
            onActivate={(canvasId) => projectCanvasWorkbench.openCanvas(activeProject.id, canvasId)}
            onClearNavigationError={() => workbenchController.clearError()}
            onDelete={(canvasId) => projectCanvasWorkbench.deleteCanvas(activeProject.id, canvasId)}
            onNodeActivate={activateProjectCanvasNode}
            onNodesResolved={publishResolvedCanvasSidebarNodes}
            query={query}
          />
        ),
        count: projectCanvasSnapshot.canvases.length,
        createLabel: canvasCreationUnavailable ? "Local recovery required" : "New canvas",
        label: "Canvases",
        onCreate: canvasCreationUnavailable
          ? undefined
          : () => void projectCanvasWorkbench.createCanvas(activeProject.id),
      }}
      filesCanvasResizeLabel={
        locale === "zh-CN" ? "调整项目文件和画布区域大小" : "Resize Project files and Canvas sections"
      }
      filesController={projectFilesController}
      filesLabel={locale === "zh-CN" ? "项目文件" : "Project files"}
      footerActions={
        <ApplicationMenu locale={locale} onOpenSettings={openSettings} services={serviceCatalogSnapshot} />
      }
      headerActions={
        <div className="flex items-center gap-1">
          <button
            aria-label={locale === "zh-CN" ? "分享项目" : "Share Project"}
            className="grid size-6 shrink-0 place-items-center rounded text-muted-foreground outline-none transition-colors duration-100 hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 motion-reduce:transition-none"
            data-project-share=""
            onClick={() => setSharingProjectId(activeProject.id)}
            title={locale === "zh-CN" ? "分享项目" : "Share Project"}
            type="button"
          >
            <Users className="size-3.5" />
          </button>
          <button
            aria-label={locale === "zh-CN" ? "折叠项目侧栏" : "Collapse project sidebar"}
            className="grid size-6 shrink-0 place-items-center rounded text-muted-foreground outline-none transition-colors duration-100 hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 motion-reduce:transition-none"
            data-project-sidebar-close=""
            onClick={() => workbenchLayoutController.setPartVisible(WorkbenchLayoutParts.PrimarySidebar, false)}
            title={locale === "zh-CN" ? "折叠项目侧栏" : "Collapse project sidebar"}
            type="button"
          >
            <PanelLeftClose className="size-3.5" />
          </button>
        </div>
      }
      hideWhenNoProject
      onFileActivate={handleProjectFileActivate}
      openFilePreview={openProjectFilePreview}
      presentation="workspace"
      resolveFileThumbnailUrl={resolveProjectFileThumbnailUrl}
      searchLabel={locale === "zh-CN" ? "搜索画布或项目文件" : "Search Canvas or Project files"}
    />
  ) : null
  const agentPanelWidth = workspaceLayout.utilityPresentation === "sheet" ? viewportWidth : secondarySidebar.size
  const agentPanelClassName =
    workspaceLayout.utilityPresentation === "sheet"
      ? "!fixed !inset-0 !z-50 !max-w-none !border-l-0"
      : workspaceLayout.utilityPresentation === "overlay"
        ? "!absolute !inset-y-4 !right-4 !z-40"
        : undefined
  const canvasViewportInsets = resolveWorkspaceCanvasViewportInsets({
    presentation: workspaceLayout.utilityPresentation,
    projectSidebarOverlaySize:
      activeProject && primarySidebar.visible && workspaceLayout.projectSidebar === "overlay" ? primarySidebar.size : 0,
    utilityPanelSize: secondarySidebar.size,
    utilityVisible: secondarySidebar.visible,
    viewportWidth,
  })
  const utilityModes = [{ label: locale === "zh-CN" ? "助手" : "Agent", value: "agent" as const }]
  const closeWorkspaceUtility = () => {
    setWorkspaceUtilityDrawer(closedWorkspaceUtilityDrawer)
    workbenchLayoutController.setPartVisible(WorkbenchLayoutParts.SecondarySidebar, false)
    utilityReturnFocusTargetRef.current = null
  }
  const changeWorkspaceUtilityMode = (mode: WorkspaceUtilityActiveMode) => {
    if (!activeProjectId) return
    if (mode === "agent") setWorkspaceUtilityDrawer(openAgentUtility(activeProjectId))
  }
  const applicationCommands = useMemo<readonly ApplicationCommand[]>(
    () => [
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
        run: openCanvasGenerate,
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
    [activeCanvasId, activeProjectId, locale, openAgentDrawer, openCanvasGenerate, openWorkspaceSettings],
  )
  useShortcutFeature(shortcutService, {
    allowInEditable: true,
    chords: [primaryShortcutChord("k")],
    id: "application.command-palette",
    onTrigger: () => setCommandPaletteOpen(true),
    scopeId: applicationShortcutScopeId,
  })

  return (
    <AgentGenerationPreferenceProvider storage={localStorage}>
      <AgentModelCatalogProvider
        generationController={generationModelCatalogController}
        llm={agentModelCatalog}
        refreshLlmModels={serviceCatalogController.refreshAgentModels}
      >
        <div className="relative flex size-full flex-col overflow-hidden" ref={applicationShortcutScopeRef}>
          <ApplicationTitlebar
            centerAction={
              effectivePrimaryDesktopSurface === "workspace" && activeCanvas ? (
                <CanvasTitlebarTitle
                  disabled={projectCanvasSnapshot.busy || workbenchSnapshot.changingInput}
                  key={activeCanvas.id}
                  name={activeCanvas.name}
                  onRename={(name) => projectCanvasController.renameCanvas(activeCanvas.id, name)}
                />
              ) : null
            }
            contextLabel={
              settingsSection
                ? locale === "zh-CN"
                  ? "设置"
                  : "Settings"
                : effectivePrimaryDesktopSurface === "home"
                  ? ""
                  : (activeCanvas?.name ?? activeProject?.name ?? "")
            }
            environmentLabel={developmentIdentity?.label}
            homeLabel={
              desktopSurface.kind === "settings"
                ? locale === "zh-CN"
                  ? "返回工作区"
                  : "Back to workspace"
                : locale === "zh-CN"
                  ? "返回项目工作区"
                  : "Back to workspace"
            }
            leadingActionHostRef={setProjectTitlebarEntryHost}
            onBackToProjects={handleTitlebarBrand}
            platform={window.convax.platform}
            productLabel={effectivePrimaryDesktopSurface === "workspace" ? "" : "Convax"}
            rightAction={
              effectivePrimaryDesktopSurface === "workspace" && activeProjectId ? (
                <AgentDrawerTrigger
                  hidden={secondarySidebar.visible}
                  onOpen={() => openAgentDrawer(agentTitlebarTriggerRef.current)}
                  ref={agentTitlebarTriggerRef}
                  status={agentCompactStatus}
                />
              ) : null
            }
            surface={settingsSection ? "settings" : effectivePrimaryDesktopSurface}
            windowControls={
              window.convax.platform === "darwin"
                ? {
                    closeLabel: locale === "zh-CN" ? "关闭窗口" : "Close window",
                    fullScreenLabel: locale === "zh-CN" ? "切换全屏" : "Toggle full screen",
                    groupLabel: locale === "zh-CN" ? "窗口控制" : "Window controls",
                    minimizeLabel: locale === "zh-CN" ? "最小化窗口" : "Minimize window",
                    onClose: () => void window.convax.mainWindowControls.close().catch(() => undefined),
                    onMinimize: () => void window.convax.mainWindowControls.minimize().catch(() => undefined),
                    onToggleFullScreen: () =>
                      void window.convax.mainWindowControls.toggleFullScreen().catch(() => undefined),
                  }
                : undefined
            }
          />
          <DevelopmentEnvironmentBadge identity={developmentIdentity} />
          <ApplicationCommandPalette
            commands={applicationCommands}
            emptyText={locale === "zh-CN" ? "没有匹配的命令" : "No matching commands"}
            label={locale === "zh-CN" ? "Convax 命令" : "Convax commands"}
            onOpenChange={setCommandPaletteOpen}
            open={commandPaletteOpen}
            placeholder={locale === "zh-CN" ? "搜索命令…" : "Search commands…"}
          />
          <div className="relative min-h-0 flex-1 overflow-hidden">
            {projectResetCandidate ? (
              <ProjectResetRecoveryState
                client={window.convax.projects.recovery}
                locale={locale}
                onCancel={cancelProjectReset}
                onPublished={activateResetProject}
                onUnavailable={closeUnavailableProjectReset}
                project={projectResetCandidate}
                reducedMotion={appearancePreferences.reducedMotion}
              />
            ) : effectivePrimaryDesktopSurface === "home" ? (
              <div
                aria-hidden={settingsSection ? true : undefined}
                className="size-full"
                inert={Boolean(settingsSection) || undefined}
              >
                {projectBootstrapView.kind === "registry-loading" ? (
                  <ProjectRegistryLoadingState locale={locale} reducedMotion={appearancePreferences.reducedMotion} />
                ) : projectBootstrapView.kind === "onboarding" ? (
                  <ProjectHome
                    controller={projectController}
                    locale={locale}
                    onEnterProject={enterHomeProject}
                    onSelectionStart={() => {
                      startupAutoRestoreEnabledRef.current = false
                      setStartupEntryFailure(null)
                      setStartupRecoveryError(null)
                    }}
                    reducedMotion={appearancePreferences.reducedMotion}
                  />
                ) : projectBootstrapView.kind === "recovery" ? (
                  <ProjectRecoveryState
                    error={projectBootstrapView.error}
                    locale={locale}
                    onOpenProject={openProjectFromRecovery}
                    onRetry={retryProjectStartup}
                    opening={startupRecoveryPending === "open"}
                    reducedMotion={appearancePreferences.reducedMotion}
                    retrying={startupRecoveryPending === "retry"}
                  />
                ) : (
                  <ProjectLoadingState
                    projectName={projectBootstrapView.projectName}
                    reducedMotion={appearancePreferences.reducedMotion}
                  />
                )}
              </div>
            ) : (
              <WorkspaceShell
                blocked={Boolean(settingsSection || activeMediaOperationDialog || sharingProjectId)}
                resizing={Boolean(workbenchLayoutSnapshot.resize)}
                utilityMode={workspaceUtilityDrawer.mode}
                workspaceRef={mountWorkspaceShell}
              >
                {activeProject ? (
                  <ProjectSidebarShell
                    entryLabel={activeProject.name}
                    entryPortal={settingsSection ? null : projectTitlebarEntryHost}
                    onOpenChange={(open) =>
                      workbenchLayoutController.setPartVisible(WorkbenchLayoutParts.PrimarySidebar, open)
                    }
                    open={primarySidebar.visible}
                    resizeHandle={
                      shouldMountResizeHandle(primarySidebar.visible, resizingPrimarySidebar) ? (
                        <WorkspaceResizeHandle
                          edge="end"
                          label="Resize project sidebar"
                          maximum={primarySidebarBounds.maxSize}
                          minimum={primarySidebarBounds.minSize}
                          onResizeBy={(delta) => resizeWorkbenchPartBy(WorkbenchLayoutParts.PrimarySidebar, delta)}
                          onPointerDown={(pointerEvent) =>
                            startWorkbenchPartResize(WorkbenchLayoutParts.PrimarySidebar, pointerEvent)
                          }
                          value={primarySidebar.size}
                        />
                      ) : null
                    }
                    size={primarySidebar.size}
                  >
                    {projectSidebar}
                  </ProjectSidebarShell>
                ) : null}
                <section className="workspace-canvas-region relative min-w-0 flex-1" ref={canvasShortcutScopeRef}>
                  {workbenchSnapshot.surface.kind === "empty" && workbenchSnapshot.surface.reason === "no-project" ? (
                    <ProjectRegistryLoadingState locale={locale} reducedMotion={appearancePreferences.reducedMotion} />
                  ) : workbenchSnapshot.surface.kind === "file" ? (
                    <div className="grid size-full place-items-center text-sm text-muted-foreground">
                      File surface is not available yet.
                    </div>
                  ) : canvasSurfaceAccess === "blocked" ? (
                    <ProjectLocalAuthorityRecoveryState
                      locale={locale}
                      readOnly={projectCanvasSnapshot.creationAvailability === "read-only-recovery-required"}
                    />
                  ) : activeCanvasSessionFailure ? (
                    <div className="grid size-full place-items-center bg-background p-8" role="alert">
                      <div className="max-w-md rounded-lg border border-destructive/30 bg-card p-5 text-center shadow-sm">
                        <h2 className="text-base font-semibold text-card-foreground">
                          {rendererFailureCopy.canvasTitle}
                        </h2>
                        <p className="mt-2 text-sm text-muted-foreground">{activeCanvasSessionFailure}</p>
                      </div>
                    </div>
                  ) : workbenchSnapshot.surface.kind === "empty" ||
                    !activeProject ||
                    !activeCanvasId ||
                    !activeCanvasSession ? (
                    <ProjectLoadingState
                      projectName={activeProject?.name ?? "Project"}
                      reducedMotion={appearancePreferences.reducedMotion}
                    />
                  ) : (
                    <RendererErrorBoundary
                      name="Canvas surface"
                      renderFallback={({ retry }) => (
                        <div className="grid size-full place-items-center bg-background p-8" role="alert">
                          <div className="max-w-md rounded-lg border border-destructive/30 bg-card p-5 text-center shadow-sm">
                            <h2 className="text-base font-semibold text-card-foreground">
                              {rendererFailureCopy.canvasTitle}
                            </h2>
                            <p className="mt-2 text-sm text-muted-foreground">
                              {rendererFailureCopy.canvasDescription}
                            </p>
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
                        key={`${activeProject.id}:${activeCanvasId}`}
                        clipboardScope={activeProject.id}
                        fileRendererRegistry={canvasFileRendererRegistry}
                        executeCommand={(command) => activeCanvasSession.executeApplication(command)}
                        session={activeCanvasSession}
                        nodeRegistry={canvasNodeRegistry}
                        onDocumentChange={publishActiveCanvasNodes}
                        onSelectionProjectionChange={publishCanvasSelection}
                        readOnly={
                          workbenchSnapshot.changingInput ||
                          projectCanvasSnapshot.busy ||
                          projectSnapshot.changingActiveProject
                        }
                        reducedMotion={appearancePreferences.reducedMotion}
                        ref={mountCanvasEditor}
                        selectionActions={selectionActions}
                        selectionDragSource={selectionDragSource}
                        services={services}
                        title={activeCanvas?.name ?? (locale === "zh-CN" ? "画布" : "Canvas")}
                        viewportInsets={canvasViewportInsets}
                        viewId="desktop-main"
                        viewRegistry={canvasViewRegistry}
                        viewScopeId={activeProject.id}
                      />
                    </RendererErrorBoundary>
                  )}
                </section>
                <WorkspaceUtilityDrawer
                  agent={({ closeLabel, modeNavigation, onClose }) => (
                    <div className="size-full min-h-0" ref={conversationShortcutScopeRef}>
                      <RendererErrorBoundary
                        name="Agent panel"
                        renderFallback={({ retry }) => (
                          <div className="flex size-full min-h-0 flex-col">
                            <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border-subtle px-2.5">
                              {modeNavigation}
                              <WorkspaceUtilityCollapseButton label={closeLabel} onClose={onClose} />
                            </header>
                            <div className="grid min-h-0 flex-1 place-items-center p-4 text-center" role="alert">
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
                          utilityOnClose={onClose}
                        />
                      </RendererErrorBoundary>
                    </div>
                  )}
                  className={`${agentPanelClassName ?? ""} ${
                    resizingSecondarySidebar
                      ? ""
                      : "transition-[width] duration-300 ease-[cubic-bezier(0.78,0,0.22,1)] motion-reduce:transition-none"
                  }`}
                  closeLabel={locale === "zh-CN" ? "关闭工具抽屉" : "Close utility drawer"}
                  modal={workspaceLayout.utilityPresentation === "sheet"}
                  mode={secondarySidebar.visible ? workspaceUtilityDrawer.mode : "closed"}
                  modes={utilityModes}
                  onClose={closeWorkspaceUtility}
                  onModeChange={changeWorkspaceUtilityMode}
                  presentation={workspaceLayout.utilityPresentation}
                  returnFocusTarget={utilityReturnFocusTargetRef.current}
                  resizeHandle={
                    workspaceLayout.utilityPresentation !== "sheet" ? (
                      <WorkspaceResizeHandle
                        edge="start"
                        label="Resize workspace utilities"
                        maximum={secondarySidebarBounds.maxSize}
                        minimum={secondarySidebarBounds.minSize}
                        onResizeBy={(delta) => resizeWorkbenchPartBy(WorkbenchLayoutParts.SecondarySidebar, delta)}
                        onPointerDown={(pointerEvent) =>
                          startWorkbenchPartResize(WorkbenchLayoutParts.SecondarySidebar, pointerEvent)
                        }
                        value={secondarySidebar.size}
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
                key={`${activeMediaOperationDialog.context.document.id}:${activeMediaOperationDialog.action.pluginId}:${activeMediaOperationDialog.action.id}`}
                locale={locale}
                onClose={closeMediaOperationDialog}
                onConfirm={(input, signal) => runMediaOperation(activeMediaOperationDialog, input, signal)}
                request={activeMediaOperationDialog}
              />
            ) : null}
            {sharingProjectId && activeProject?.id === sharingProjectId && !settingsSection ? (
              <div className="absolute inset-0 z-[90] grid place-items-center bg-background/80 p-6 backdrop-blur-sm">
                <div className="relative w-full max-w-2xl">
                  <button
                    aria-label={locale === "zh-CN" ? "关闭分享" : "Close sharing"}
                    className="absolute right-4 top-4 z-10 rounded px-2 py-1 text-sm text-muted-foreground hover:text-foreground"
                    onClick={() => setSharingProjectId(null)}
                    type="button"
                  >
                    {locale === "zh-CN" ? "关闭" : "Close"}
                  </button>
                  <ProjectCollaborationPendingState
                    locale={locale}
                    onCreateTeam={async (projectId) => {
                      const result = await window.convax.projects.collaboration.bootstrapTeam({ projectId })
                      return { invitation: result.invitation ? JSON.stringify(result.invitation) : null }
                    }}
                    onJoinTeam={async ({ invitation, projectId }) => {
                      await window.convax.projects.collaboration.joinTeam({
                        invitation: parseProjectTeamInvitation(JSON.parse(invitation)),
                        projectId,
                      })
                    }}
                    onReady={() => setSharingProjectId(null)}
                    projectId={sharingProjectId}
                    reducedMotion={appearancePreferences.reducedMotion}
                  />
                </div>
              </div>
            ) : null}
            {settingsSection ? (
              <SettingsView
                activeCanvasId={activeCanvasId}
                activeProjectId={activeProjectId}
                appearancePreferences={appearancePreferences}
                appearanceSaveState={appearanceSaveState}
                className="absolute inset-0 z-[100]"
                initialSection={settingsSection}
                initialServiceId={settingsServiceId}
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
      </AgentModelCatalogProvider>
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
void preloadMarketplaceProjection(window.convax.marketplaces).catch((error) =>
  console.error("Could not warm the local Marketplace display projection", error),
)
void changeAppLanguage(readAppLanguagePreference(localStorage))
reactRoot.render(
  <I18nextProvider i18n={appI18n}>
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
    </RendererErrorBoundary>
  </I18nextProvider>,
)
