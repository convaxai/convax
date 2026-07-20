import {
  CanvasEditor,
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
} from "@convax/canvas"
import type { AgentResource } from "@convax/agent-runtime"
import { ProjectController, ProjectSidebar } from "@convax/project"
import { ProjectFilesController, type ProjectFileInfo } from "@convax/project-files"
import { ProjectCanvasController, hydrateProjectCanvasDocument, projectFileReferenceKey } from "@convax/project/canvas"
import { WorkbenchController, WorkbenchLayoutController, WorkbenchLayoutParts } from "@convax/workbench"
import {
  AudioLines,
  CheckCircle2,
  Clapperboard,
  Crop,
  ImageDown,
  Info,
  PanelLeftOpen,
  Scissors,
  TriangleAlert,
  XCircle,
} from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import { createRoot } from "react-dom/client"
import { agentCanvasNodeResourceUri, createAgentCanvasInstructions } from "../agent-canvas-context"
import { hasWebPluginCanvasSurface, type InstalledWebPluginSummary } from "../plugin-contracts"
import { jianyingBuiltinPluginId, jianyingBuiltinPluginVersion } from "../jianying-contracts"
import { AgentPanel } from "./agent-panel"
import { AgentGenerationPreferenceProvider } from "./agent-generation-preference"
import {
  readAppLanguagePreference,
  resolveAppLocale,
  writeAppLanguagePreference,
  type AppLanguagePreference,
} from "./app-language"
import { ApplicationMenu, type ApplicationMenuTarget } from "./application-menu"
import { createInitialCanvasDocument } from "./canvas-document"
import { CanvasCardConversationPanel } from "./canvas-card-conversation-panel"
import { resolveCanvasUploadItems } from "./canvas-upload"
import { DesktopProtocolGate } from "./desktop-protocol-gate"
import {
  canResumeFfmpegAudioVideoSeparation,
  canRunFfmpegTransform,
  createFfmpegGenerateRequests,
  type FfmpegTransformDialogRequest,
  type FfmpegTransformInput,
  isFfmpegDialogInScope,
} from "./ffmpeg-selection-action"
import { FfmpegTransformDialog, ffmpegTransformLabel } from "./ffmpeg-transform-dialog"
import {
  ffmpegSeparationCancellationNotice,
  FfmpegPartialTransformError,
  type FfmpegTransformProgress,
  runFfmpegTransformSequence,
} from "./ffmpeg-transform-runner"
import {
  canExportSelectionToJianying,
  exportCanvasMediaToJianying,
  normalizeJianyingRendererError,
} from "./jianying-selection-action"
import { DesktopPluginFrameRegistry } from "./plugin-frame-registry"
import { ProjectEmptyState, ProjectLoadingState } from "./project-empty-state"
import { ProjectCanvasSidebar } from "./project-canvas-sidebar"
import { ProjectCanvasWorkbenchCoordinator } from "./project-canvas-workbench"
import { SettingsView, type SettingsSection } from "./settings-view"
import { readWorkbenchLayoutPreferences, writeWorkbenchLayoutPreferences } from "./workbench-layout-preferences"
import { migrateLastCanvasPreference, writeLastCanvasPreference } from "./workbench-preferences"
import { createWebPluginCanvasContribution, type WebPluginCanvasHost } from "./web-plugin-canvas"
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

function App() {
  const [notification, setNotification] = useState<CanvasNotification | null>(null)
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth)
  const [languagePreference, setLanguagePreference] = useState<AppLanguagePreference>(() =>
    readAppLanguagePreference(localStorage),
  )
  const [settingsSection, setSettingsSection] = useState<SettingsSection | null>(null)
  const [ffmpegDialog, setFfmpegDialog] = useState<FfmpegTransformDialogRequest | null>(null)
  const ffmpegProgressRef = useRef(new WeakMap<FfmpegTransformDialogRequest, FfmpegTransformProgress>())
  const closeFfmpegDialog = useCallback(() => setFfmpegDialog(null), [])
  const locale = useMemo(() => resolveAppLocale(languagePreference), [languagePreference])
  const canvasEditorRef = useRef<CanvasEditorHandle>(null)
  const canvasNodeRegistry = useMemo(() => createDefaultCanvasNodeRegistry(), [])
  const canvasFileRendererRegistry = useMemo(() => createDefaultCanvasFileRendererRegistry(), [])
  const canvasViewRegistry = useMemo(() => createCanvasViewRegistry(), [])
  const pluginFrameRegistry = useMemo(() => new DesktopPluginFrameRegistry(), [])
  const [installedPlugins, setInstalledPlugins] = useState<InstalledWebPluginSummary[]>([])
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
          if (currentInput?.kind !== "canvas") return
          await canvasEditorRef.current?.prepareToLeave()
          await drainCanvasSaves()
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
  useEffect(() => () => projectController.dispose(), [projectController])
  useEffect(() => () => projectFilesController.dispose(), [projectFilesController])
  useEffect(() => () => projectCanvasController.dispose(), [projectCanvasController])
  useEffect(() => () => workbenchController.dispose(), [workbenchController])
  useEffect(() => () => workbenchLayoutController.dispose(), [workbenchLayoutController])
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
      closeFfmpegDialog()
      setSettingsSection("general")
    }
    window.addEventListener("keydown", openSettingsShortcut)
    return () => window.removeEventListener("keydown", openSettingsShortcut)
  }, [closeFfmpegDialog])
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
  const activeCanvasId =
    workbenchSnapshot.surface.kind === "canvas" && workbenchSnapshot.surface.input.projectId === activeProjectId
      ? workbenchSnapshot.surface.input.canvasId
      : undefined
  const activeCanvas =
    activeCanvasId && projectCanvasSnapshot.projectId === activeProjectId
      ? projectCanvasSnapshot.canvases.find((canvas) => canvas.id === activeCanvasId)
      : undefined
  const activeFfmpegDialog = isFfmpegDialogInScope(ffmpegDialog, activeProjectId, activeCanvasId) ? ffmpegDialog : null
  pluginHostContextRef.current = { activeCanvas, activeProject }
  useEffect(() => {
    setFfmpegDialog((current) =>
      current && !isFfmpegDialogInScope(current, activeProjectId, activeCanvasId) ? null : current,
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
      async executeCanvasGeneration(input) {
        throwIfAborted(input.signal)
        currentScope(input.projectId, input.canvasId)
        await flushCanvasForAgent()
        throwIfAborted(input.signal)
        currentScope(input.projectId, input.canvasId)
        const operationId = globalThis.crypto.randomUUID()
        const cancel = () => window.convax.generation.cancel({ operationId })
        input.signal.addEventListener("abort", cancel, { once: true })
        try {
          const result = await window.convax.generation.generate({
            anchor: input.anchor,
            expectedRevision: input.expectedRevision,
            operationId,
            ...(input.output ? { output: input.output } : {}),
            prompt: input.prompt,
            ref: { canvasId: input.canvasId, scopeId: input.projectId },
            referenceConstraint: { ownerNodeId: input.nodeId, type: "direct-incoming" },
            references: input.references,
            ...(input.toolId ? { toolId: input.toolId } : {}),
          })
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
          const resource = canvasNodeResource(input.canvasId, input.nodeId, `${input.pluginName} node`)
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
    }
  }, [flushCanvasForAgent])

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
  useEffect(
    () =>
      window.convax.canvas.renderer.onRequest(async (request) => {
        if (request.type === "view.snapshot") {
          const snapshots = canvasViewRegistry.list().filter((snapshot) => snapshot.viewId === request.viewId)
          return { snapshot: snapshots.length === 1 ? snapshots[0]! : null, type: "view.snapshot" }
        }
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
      }),
    [activeCanvasId, activeProjectId, canvasViewRegistry],
  )
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
    let storageVersion: string | null | undefined
    let saveQueue = Promise.resolve()
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
        return tools.map((tool) => ({
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
        await flushCanvasForAgent()
        if (request.signal.aborted) throw request.signal.reason
        const live = pluginHostContextRef.current
        if (live.activeProject?.id !== activeProjectId || live.activeCanvas?.id !== activeCanvasId) {
          throw new Error("Generation must target the live active Canvas")
        }
        const operationId = globalThis.crypto.randomUUID()
        const cancel = () => window.convax.generation.cancel({ operationId })
        request.signal.addEventListener("abort", cancel, { once: true })
        try {
          const result = await window.convax.generation.generate({
            anchor: request.anchor,
            ...(request.expectedOutputCount === undefined ? {} : { expectedOutputCount: request.expectedOutputCount }),
            expectedRevision: request.expectedRevision,
            operationId,
            ...(request.output ? { output: request.output } : {}),
            prompt: request.prompt,
            ref: { canvasId: activeCanvasId, scopeId: activeProjectId },
            references: request.references,
            ...(request.relationAnchorNodeIds?.length ? { relationAnchorNodeIds: request.relationAnchorNodeIds } : {}),
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
          const contextResources = request.mentionedNodeIds.flatMap((nodeId) => {
            const node = request.document.nodes.find((candidate) => candidate.id === nodeId)
            return node ? [canvasNodeResource(request.document.id, node.id, node.data.label)] : []
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
          return hydrateProjectCanvasDocument(
            {
              ...result.document,
              metadata: {
                ...result.document.metadata,
                title: activeCanvasNameRef.current ?? result.document.metadata.title,
              },
            },
            ({ path }) => projectAssetUrl(activeProjectId, path),
          )
        },
        async save(document, signal) {
          const save = saveQueue
            .catch(() => undefined)
            .then(async () => {
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
  }, [activeCanvasId, activeProjectId, flushCanvasForAgent])

  const runFfmpegTransform = useCallback(
    async (request: FfmpegTransformDialogRequest, input: FfmpegTransformInput, signal: AbortSignal) => {
      if (signal.aborted) {
        if (request.kind === "separate-audio") {
          const notice = ffmpegSeparationCancellationNotice(locale, undefined)
          setNotification({ description: notice.description, kind: "warning", title: notice.title })
        }
        throw signal.reason ?? new DOMException("Canceled", "AbortError")
      }
      const requests = createFfmpegGenerateRequests(request, input, signal)
      let initialProgress = ffmpegProgressRef.current.get(request) ?? {
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
            ffmpegProgressRef.current.delete(request)
            const notice = ffmpegSeparationCancellationNotice(locale, initialProgress)
            setNotification({ description: notice.description, kind: "warning", title: notice.title })
            throw failure
          }
          const message =
            locale === "zh-CN"
              ? "暂时无法确认画布中的部分结果。可重试验证，已创建的视频不会重复生成。"
              : "The partial Canvas result could not be verified yet. Retry validation without duplicating the completed video."
          throw new FfmpegPartialTransformError(message, initialProgress, { cause: failure })
        }
        if (
          !snapshot.document ||
          !canResumeFfmpegAudioVideoSeparation(request, snapshot.document, initialProgress.createdNodeIds)
        ) {
          ffmpegProgressRef.current.delete(request)
          setFfmpegDialog((current) => (current === request ? null : current))
          setNotification({
            description:
              locale === "zh-CN"
                ? "源视频或已创建的无声视频发生了变化，请重新选择源视频后再执行音视频分离。"
                : "The source or completed silent video changed. Select the source video and start separation again.",
            kind: "warning",
            title: locale === "zh-CN" ? "无法继续音视频分离" : "Audio/video separation cannot continue",
          })
          throw new Error("FFmpeg separation cannot resume because its Canvas inputs changed")
        }
        initialProgress = { ...initialProgress, revision: snapshot.document.revision }
        ffmpegProgressRef.current.set(request, initialProgress)
      }
      let progress: FfmpegTransformProgress
      try {
        progress = await runFfmpegTransformSequence({
          generate: (generateRequest) => services.require("generate").generate(generateRequest),
          initialProgress,
          onProgress: (current) => ffmpegProgressRef.current.set(request, current),
          partialFailureMessage: (failure) => {
            const detail = failure instanceof Error ? failure.message : String(failure)
            return locale === "zh-CN"
              ? `已创建无声视频，但独立音频创建失败。可直接重试，已完成的视频不会重复创建。\n${detail}`
              : `The silent video was created, but the independent audio failed. Retry to continue without duplicating the completed video.\n${detail}`
          },
          requests,
          signal,
        })
      } catch (failure) {
        const savedProgress = ffmpegProgressRef.current.get(request)
        if (signal.aborted && request.kind === "separate-audio") {
          ffmpegProgressRef.current.delete(request)
          const notice = ffmpegSeparationCancellationNotice(locale, savedProgress)
          setNotification({
            description: notice.description,
            kind: "warning",
            title: notice.title,
          })
        }
        throw failure
      }
      ffmpegProgressRef.current.delete(request)
      if (signal.aborted) return
      setFfmpegDialog((current) => (current === request ? null : current))
      setNotification({
        description: progress.warnings.length
          ? progress.warnings.join("\n")
          : locale === "zh-CN"
            ? `已创建 ${progress.createdNodeIds.length} 个新节点。`
            : `${progress.createdNodeIds.length} new node${progress.createdNodeIds.length === 1 ? "" : "s"} created.`,
        kind: progress.warnings.length > 0 ? "warning" : "success",
        title: locale === "zh-CN" ? "FFmpeg 处理完成" : "FFmpeg transform complete",
      })
    },
    [flushCanvasForAgent, locale, services],
  )

  const selectionActions = useMemo<readonly CanvasSelectionAction[]>(
    () => [
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
          if (!activeProjectId || !activeCanvasId) throw new Error("Open a Project Canvas before exporting to JianYing")
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
      ...(
        [
          { icon: <ImageDown />, kind: "extract-frame" },
          { icon: <Scissors />, kind: "trim" },
          { icon: <AudioLines />, kind: "separate-audio" },
          { icon: <Crop />, kind: "crop" },
        ] as const
      ).map(({ icon, kind }) => ({
        id: `ffmpeg.${kind}`,
        label: ffmpegTransformLabel(locale, kind),
        icon,
        visible(context: CanvasSelectionActionContext) {
          return canRunFfmpegTransform(context, installedPlugins, kind)
        },
        execute(context: CanvasSelectionActionContext) {
          if (!activeCanvasId || !activeProjectId) return
          setFfmpegDialog({ canvasId: activeCanvasId, context, kind, projectId: activeProjectId })
        },
      })),
    ],
    [activeCanvasId, activeProjectId, flushCanvasForAgent, installedPlugins, locale],
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
      closeFfmpegDialog()
      setSettingsSection(target)
    },
    [closeFfmpegDialog],
  )
  const changeLanguage = useCallback((preference: AppLanguagePreference) => {
    setLanguagePreference(preference)
    writeAppLanguagePreference(localStorage, preference)
  }, [])

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
        aria-hidden={settingsSection || activeFfmpegDialog ? true : undefined}
        className={`relative flex size-full overflow-hidden bg-background${workbenchLayoutSnapshot.resize ? " cursor-col-resize select-none" : ""}`}
        inert={Boolean(settingsSection || activeFfmpegDialog) || undefined}
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
              footerActions={<ApplicationMenu locale={locale} onOpenSettings={openSettings} />}
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
                <ApplicationMenu compact locale={locale} onOpenSettings={openSettings} />
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
            <CanvasEditor
              key={`${activeProject.id}:${activeCanvas.id}`}
              clipboardScope={activeProject.id}
              fileRendererRegistry={canvasFileRendererRegistry}
              initialDocument={initialDocument}
              nodeRegistry={canvasNodeRegistry}
              readOnly={
                workbenchSnapshot.changingInput || projectCanvasSnapshot.busy || projectSnapshot.changingActiveProject
              }
              ref={canvasEditorRef}
              selectionActions={selectionActions}
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
              resizeWorkbenchPartBy(WorkbenchLayoutParts.SecondarySidebar, keyEvent.key === "ArrowLeft" ? 24 : -24)
            },
            onResizeStart: (pointerEvent) =>
              startWorkbenchPartResize(WorkbenchLayoutParts.SecondarySidebar, pointerEvent),
            open: secondarySidebar.visible,
            resizing: resizingSecondarySidebar,
            width: secondarySidebar.size,
          }}
          projectId={activeProjectId}
          projectName={activeProject?.name}
        />
        {notification ? <Toast notification={notification} /> : null}
      </main>
      {activeFfmpegDialog && !settingsSection ? (
        <FfmpegTransformDialog
          key={`${activeFfmpegDialog.context.document.id}:${activeFfmpegDialog.context.document.revision}:${activeFfmpegDialog.kind}`}
          locale={locale}
          onClose={closeFfmpegDialog}
          onConfirm={(input, signal) => runFfmpegTransform(activeFfmpegDialog, input, signal)}
          request={activeFfmpegDialog}
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
          pluginClient={window.convax.plugins}
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
  <DesktopProtocolGate>
    <App />
  </DesktopProtocolGate>,
)
