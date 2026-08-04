import type {
  AgentCapabilities,
  AgentMessage,
  AgentModelCatalog,
  AgentPermissionRequest,
  AgentQuestionRequest,
  AgentResource,
  AgentSession,
  AgentSessionState,
} from "@convax/agent-runtime"
import type { CanvasDocument } from "@convax/canvas"
import type { ProjectEntry } from "@convax/project-files"
import { parseProjectEntryDrag, PROJECT_ENTRY_DRAG_TYPE } from "@convax/project-files/drag"
import type { PetDisplayedSession } from "../pet-contracts"
import { parseProjectCanvasDrag, PROJECT_CANVAS_DRAG_TYPE, type ProjectCanvas } from "@convax/project/canvas"
import { Button, cn, createToolInputDefaultValues, Loading, LoadingSpinner, reconcileToolInputValues, Tooltip, TooltipProvider, validateToolInputValues } from "@convax/ui"
import type {
  GenerationToolDescription,
  GenerationToolInput,
  GenerationToolInputValue,
  GenerationToolSummary,
} from "../generation-contracts"
import {
  AtSign,
  BookOpen,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  FileText,
  Folder,
  LoaderCircle,
  MessageSquare,
  PanelsTopLeft,
  Plus,
  Send,
  ShieldAlert,
  Sparkles,
  Square,
  SquareTerminal,
  X,
} from "lucide-react"
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { isAgentCanvasResource, shouldFlushAgentCanvasContext } from "../agent-canvas-context"
import { AgentGenerationModelPicker, type AgentModelPickerTab } from "./agent-generation-model-picker"
import {
  AgentGenerationCatalogRequestTracker,
  agentGenerationModelSelectionTitle,
  createAgentPromptInstructions,
  findAgentGenerationTool,
  isAgentGenerationOutput,
  reconcileAgentGenerationToolPreference,
  reconcileAgentGenerationToolSelection,
  type AgentGenerationToolSelection,
} from "./agent-generation-models"
import {
  type AgentCompactStatus,
  agentSessionContentKey,
  AgentSessionStateRequestTracker,
  agentResourceKey,
  canvasAgentResource,
  containEmbeddedResourceDrag,
  embeddedConversationTitle,
  embeddedConversationSessions,
  displayedAgentSession,
  filterStandaloneAgentSessions,
  forgetStaleEmbeddedConversation,
  isAgentScrollNearBottom,
  mergeAgentResources,
  resolveAgentCompactStatus,
  selectAgentSessionAfterRefresh,
  withAgentStoppingState,
} from "./agent-panel-state"
import {
  AgentComposerCompositionController,
  AgentComposerRequestTracker,
  agentComposerDraftWithResources,
  agentComposerResources,
  agentComposerText,
  closeAgentComposerSuggestion,
  emptyAgentComposerDraft,
  filterAgentSkills,
  hasAgentComposerContent,
  moveAgentComposerSuggestion,
  normalizeAgentComposerDraft,
  openAgentComposerSuggestion,
  reconcileAgentComposerSuggestionOptions,
  resolveAgentComposerSuggestionOption,
  setAgentComposerSuggestionHover,
  shouldDismissAgentResourcePicker,
  shouldShowAgentComposerPlaceholder,
  type AgentComposerDraft,
  type AgentComposerSuggestionState,
} from "./agent-composer-state"
import {
  buildAgentCanvasReferenceTree,
  buildAgentProjectReferenceTree,
  buildAgentReferenceStatusById,
  filterAgentReferenceTree,
  moveAgentReferenceTreeActive,
} from "./agent-composer-tree"
import {
  agentComposerResourceAttribute,
  agentComposerTokenActionAttribute,
  agentComposerTokenAttribute,
  captureAgentComposerSelection,
  findAgentComposerQueryRange,
  focusAgentComposerAtEnd,
  insertAgentComposerPlainText,
  insertAgentComposerResources,
  insertAgentComposerTrigger,
  parseAgentComposerResource,
  readAgentComposerDraft,
  removeAgentComposerToken,
  repairAgentComposerInsertedTriggerSelection,
  replaceAgentComposerQuery,
  replaceAgentComposerToken,
  writeAgentComposerDraft,
  type AgentComposerQueryRange,
} from "./agent-composer-dom"
import {
  AgentComposerPicker,
  agentComposerPickerOptionId,
  createAgentComposerPickerAnchor,
  type AgentComposerPickerAnchor,
  type AgentComposerPickerOption,
} from "./agent-composer-picker"
import { AgentMarkdown } from "./agent-markdown"
import { useAgentGenerationPreference } from "./agent-generation-preference"
import { useAgentModelCatalog } from "./agent-model-catalog"
import { findAgentLlmModel, reconcileAgentLlmModelSelection, reconcileAgentLlmModelSelectionFromReadyCatalog, type AgentLlmModelSelection } from "./agent-llm-models"
import {
  agentConversationAnnouncementState,
  agentConversationCopyText,
  agentConversationTurnHasFailure,
  buildAgentConversationTurns,
  resolveAgentConversationAnnouncement,
  type AgentConversationAnnouncementState,
  type AgentConversationTurn,
} from "./agent-conversation-presentation"
import { getAgentToolPresentation } from "./agent-tool-presentation"
import { AgentActivitySummary } from "./agent-activity-summary"
import { AgentDrawerHeader, AgentDrawerTrigger } from "./agent-drawer-header"
import "./agent-panel.css"

const resourceDragType = "application/x-convax-agent-resource"

type GenerationDescriptionLoad =
  | { scope: string; status: "loading" }
  | { error: string; scope: string; status: "error" }
  | { scope: string; status: "ready"; value: GenerationToolDescription }

interface FailedAgentSubmission {
  draft: AgentComposerDraft
  id: number
  message: string
  sessionId: string
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function resourceLabel(resource: AgentResource) {
  if (resource.name) return resource.name
  if (resource.kind === "skill") return resource.name
  if (resource.kind === "resource") return resource.uri
  return resource.path.split("/").at(-1) || resource.path
}

function supportsResourceDrop(dataTransfer: DataTransfer) {
  const types = Array.from(dataTransfer.types)
  return (
    types.includes(PROJECT_ENTRY_DRAG_TYPE) ||
    types.includes(PROJECT_CANVAS_DRAG_TYPE) ||
    types.includes(resourceDragType)
  )
}

function agentComposerPickerAnchor(
  root: HTMLElement,
  anchor: HTMLElement | (AgentComposerQueryRange & { query?: string }),
): AgentComposerPickerAnchor {
  let rect: DOMRect
  if (anchor instanceof HTMLElement) rect = anchor.getBoundingClientRect()
  else {
    const range = document.createRange()
    range.setStart(anchor.node, anchor.end)
    range.collapse(true)
    rect = range.getBoundingClientRect()
  }
  const fallback = root.getBoundingClientRect()
  return createAgentComposerPickerAnchor(rect, fallback, {
    height: window.innerHeight,
    width: window.innerWidth,
  })
}

export interface AgentPanelLayout {
  collapsedWidth: number
  maxWidth: number
  maxWidthStyle: string
  minWidth: number
  open: boolean
  onOpenChange(open: boolean): void
  onResizeKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void
  onResizeStart(event: React.PointerEvent<HTMLDivElement>): void
  resizable?: boolean
  resizing: boolean
  width: number
}

export interface AgentPanelProps {
  activeCanvas?: Pick<ProjectCanvas, "id" | "name">
  beforePrompt?: () => Promise<void>
  canvases: ProjectCanvas[]
  className?: string
  /** Set false when the workspace shell renders AgentDrawerTrigger itself. */
  collapsedEntry?: boolean
  /** Host-owned context that is always submitted and cannot be removed from the composer. */
  contextResources?: readonly AgentResource[]
  conversationKey?: string
  embedded?: boolean
  embeddedHeader?: boolean
  generationCatalogVersion?: string
  /** Render as content inside Desktop's persistent utility drawer region. */
  hosted?: boolean
  /** Removable @ references inserted once when this conversation surface opens. */
  initialResources?: readonly AgentResource[]
  onOpenServices?: () => void
  onSessionDisplayed?: (input: PetDisplayedSession) => void
  onStatusChange?: (status: AgentCompactStatus) => void
  layout?: AgentPanelLayout
  onOpenSkillDetails?: (name: string) => boolean | Promise<boolean>
  /**
   * Supplied only by a future provenance-safe review owner. Ordinary completed
   * Agent output is not pending Canvas change.
   */
  pendingChanges?: boolean
  projectId?: string
  projectName?: string
  utilityCloseLabel?: string
  utilityOnClose?: () => void
  utilityNavigation?: ReactNode
}

export interface AgentPanelHandle {
  addResources(resources: readonly AgentResource[]): void
  finishSession(input: { scopeId: string; sessionId: string }): void
  focusComposer(): void
  openSession(sessionId: string): Promise<void>
  showSession(input: { scopeId: string; session: AgentSession }): boolean
}

export async function routeAgentSkillOpen(
  name: string,
  scopeId: string,
  onOpenDetails: AgentPanelProps["onOpenSkillDetails"],
  openLocal: (input: { name: string; scopeId: string }) => Promise<void>,
) {
  if (await onOpenDetails?.(name)) return "details" as const
  await openLocal({ name, scopeId })
  return "local" as const
}

export const AgentPanel = forwardRef<AgentPanelHandle, AgentPanelProps>(function AgentPanel(props, ref) {
  const embedded = props.embedded === true
  const hosted = !embedded && props.hosted === true
  const compactEmbeddedChrome = embedded && props.embeddedHeader === false
  const sharedGenerationPreference = useAgentGenerationPreference()
  const sharedModelCatalog = useAgentModelCatalog()
  const sharedGenerationController = sharedModelCatalog?.generationController
  const sharedGenerationSnapshot = sharedModelCatalog?.generation
  const sharedLlmCatalog = sharedModelCatalog?.llm.catalog
  const refreshSharedLlmModels = sharedModelCatalog?.refreshLlmModels
  const usesSharedModelCatalog = sharedModelCatalog !== null
  const sharedGenerationSelection = sharedGenerationPreference?.selection
  const setSharedGenerationSelection = sharedGenerationPreference?.setSelection
  const sharedLlmSelection = sharedGenerationPreference?.llmSelection
  const setSharedLlmSelection = sharedGenerationPreference?.setLlmSelection
  const generationCatalogVersion = props.generationCatalogVersion ?? ""
  const generationCatalogScope = JSON.stringify([props.projectId ?? null, generationCatalogVersion])
  const llmCatalogScope = JSON.stringify([props.projectId ?? null, generationCatalogVersion])
  const conversationScope = JSON.stringify([
    props.projectId ?? null,
    embedded ? "embedded" : "panel",
    embedded ? (props.conversationKey ?? null) : null,
  ])
  const contextResources = mergeAgentResources(props.contextResources ?? [])
  const initialResourcesRef = useRef(mergeAgentResources(props.initialResources ?? []))
  initialResourcesRef.current = mergeAgentResources(props.initialResources ?? [])
  const open = hosted || embedded || props.layout?.open === true
  const [historyVisible, setHistoryVisible] = useState(false)
  const [suggestion, setSuggestion] = useState<AgentComposerSuggestionState>({ open: false })
  const [suggestionQuery, setSuggestionQuery] = useState("")
  const [referenceTab, setReferenceTab] = useState<"canvas" | "project">("project")
  const [suggestionAnchor, setSuggestionAnchor] = useState<AgentComposerPickerAnchor>()
  const [generationModelPickerOpen, setGenerationModelPickerOpen] = useState(false)
  const [modelPickerTab, setModelPickerTab] = useState<AgentModelPickerTab>("llm")
  const [localGenerationTools, setGenerationTools] = useState<readonly GenerationToolSummary[]>([])
  const [localGenerationToolsLoading, setGenerationToolsLoading] = useState(false)
  const [localGenerationToolsError, setGenerationToolsError] = useState<string>()
  const [localGenerationToolSelection, setLocalGenerationToolSelection] = useState<AgentGenerationToolSelection>()
  const generationToolSelection = sharedGenerationPreference ? sharedGenerationSelection : localGenerationToolSelection
  const setGenerationToolSelection = useCallback(
    (selection?: AgentGenerationToolSelection) => {
      if (setSharedGenerationSelection) setSharedGenerationSelection(selection)
      else setLocalGenerationToolSelection(selection)
    },
    [setSharedGenerationSelection],
  )
  const [localLlmCatalog, setLlmCatalog] = useState<AgentModelCatalog>()
  const [localLlmCatalogLoading, setLlmCatalogLoading] = useState(false)
  const [localLlmCatalogError, setLlmCatalogError] = useState<string>()
  const [localLlmSelection, setLocalLlmSelection] = useState<AgentLlmModelSelection>()
  const llmSelection = sharedGenerationPreference ? sharedLlmSelection : localLlmSelection
  const setLlmSelection = useCallback(
    (selection?: AgentLlmModelSelection) => {
      if (setSharedLlmSelection) setSharedLlmSelection(selection)
      else setLocalLlmSelection(selection)
    },
    [setSharedLlmSelection],
  )
  const [generationDescription, setGenerationDescription] = useState<GenerationDescriptionLoad>({
    scope: "",
    status: "loading",
  })
  const [generationToolInput, setGenerationToolInput] = useState<Record<string, GenerationToolInputValue>>({})
  const [composerFocused, setComposerFocused] = useState(false)
  const [dropActive, setDropActive] = useState(false)
  const [composerDraft, setComposerDraft] = useState<AgentComposerDraft>(() =>
    agentComposerDraftWithResources(initialResourcesRef.current),
  )
  const [projectListings, setProjectListings] = useState<Map<string, readonly ProjectEntry[]>>(() => new Map())
  const [expandedProjectPaths, setExpandedProjectPaths] = useState<Set<string>>(() => new Set())
  const [loadedCanvasDocuments, setLoadedCanvasDocuments] = useState<Map<string, CanvasDocument>>(() => new Map())
  const [expandedCanvasIds, setExpandedCanvasIds] = useState<Set<string>>(() => new Set())
  const [inventoryLoadingKeys, setInventoryLoadingKeys] = useState<Set<string>>(() => new Set())
  const [inventoryErrors, setInventoryErrors] = useState<Map<string, string>>(() => new Map())
  const [sessions, setSessions] = useState<AgentSession[]>([])
  const [sessionId, setSessionId] = useState<string>()
  const [sessionState, setSessionState] = useState<AgentSessionState>()
  const [capabilities, setCapabilities] = useState<AgentCapabilities>()
  const [capabilitiesError, setCapabilitiesError] = useState<string>()
  const [capabilitiesLoading, setCapabilitiesLoading] = useState(false)
  const [loading, setLoading] = useState(false)
  const [sessionCatalogReadyScope, setSessionCatalogReadyScope] = useState("")
  const [promptingSessionIds, setPromptingSessionIds] = useState<Set<string>>(() => new Set())
  const [stoppingSessionIds, setStoppingSessionIds] = useState<Set<string>>(() => new Set())
  const [failedSubmissions, setFailedSubmissions] = useState<FailedAgentSubmission[]>([])
  const [creatingSession, setCreatingSession] = useState(false)
  const [followingLatest, setFollowingLatest] = useState(true)
  const [error, setError] = useState<string>()
  const [composerFocusRequest, setComposerFocusRequest] = useState(0)
  const composerRef = useRef<HTMLDivElement>(null)
  const pendingComposerFocusRef = useRef(false)
  const composerSurfaceRef = useRef<HTMLDivElement>(null)
  const composerPickerRef = useRef<HTMLDivElement>(null)
  const composerDraftRef = useRef(composerDraft)
  const composerQueryRangeRef = useRef<AgentComposerQueryRange | undefined>(undefined)
  const composerSelectionRef = useRef<Range | undefined>(undefined)
  const editingTokenRef = useRef<HTMLElement | undefined>(undefined)
  const scrollViewportRef = useRef<HTMLDivElement>(null)
  const stickToBottomRef = useRef(true)
  const activeSessionIdRef = useRef(sessionId)
  const promptingSessionIdsRef = useRef(promptingSessionIds)
  const stoppingSessionIdsRef = useRef(stoppingSessionIds)
  const failedSubmissionIdRef = useRef(0)
  const sessionStateRequestRef = useRef(new AgentSessionStateRequestTracker())
  const sessionListRequestRef = useRef(0)
  const activeProjectRef = useRef(props.projectId)
  const activeScopeRef = useRef(conversationScope)
  const setComposerPickerElement = useCallback((element: HTMLDivElement | null) => {
    composerPickerRef.current = element
  }, [])
  const capabilitiesRequestRef = useRef<Promise<AgentCapabilities> | undefined>(undefined)
  const compositionControllerRef = useRef(new AgentComposerCompositionController())
  const requestTrackerRef = useRef(new AgentComposerRequestTracker())
  const generationCatalogRequestRef = useRef(new AgentGenerationCatalogRequestTracker())
  const generationDescriptionRequestRef = useRef(new AgentGenerationCatalogRequestTracker())
  const generationToolInputOwnerRef = useRef("")
  const llmCatalogRequestRef = useRef(new AgentGenerationCatalogRequestTracker())
  const llmCatalogValueScopeRef = useRef("")
  const generationToolSelectionRef = useRef(generationToolSelection)
  const llmSelectionRef = useRef(llmSelection)
  const generationCatalogVersionRef = useRef(generationCatalogVersion)
  const generationRef = useRef(0)
  const mountedRef = useRef(false)
  const creatingSessionRef = useRef(false)
  const restoredSessionRef = useRef<string | undefined>(undefined)
  const sessionProjectRef = useRef<string | undefined>(undefined)
  const sessionScopeRef = useRef<string | undefined>(undefined)
  activeProjectRef.current = props.projectId
  activeScopeRef.current = conversationScope
  activeSessionIdRef.current = sessionId
  composerDraftRef.current = composerDraft
  promptingSessionIdsRef.current = promptingSessionIds
  stoppingSessionIdsRef.current = stoppingSessionIds
  generationCatalogVersionRef.current = generationCatalogVersion
  generationToolSelectionRef.current = generationToolSelection
  llmSelectionRef.current = llmSelection

  const generationTools = useMemo(
    () =>
      sharedGenerationSnapshot
        ? sharedGenerationSnapshot.tools.filter((tool) => isAgentGenerationOutput(tool.output))
        : localGenerationTools,
    [localGenerationTools, sharedGenerationSnapshot],
  )
  const generationToolsLoading = sharedGenerationSnapshot
    ? sharedGenerationSnapshot.loading
    : localGenerationToolsLoading
  const generationToolsError = sharedGenerationSnapshot
    ? sharedGenerationSnapshot.ready
      ? undefined
      : sharedGenerationSnapshot.error
    : localGenerationToolsError
  const llmCatalog = usesSharedModelCatalog ? sharedLlmCatalog : localLlmCatalog
  const llmCatalogLoading = usesSharedModelCatalog
    ? sharedModelCatalog.llm.loading && !sharedLlmCatalog
    : localLlmCatalogLoading
  const llmCatalogError = usesSharedModelCatalog
    ? sharedLlmCatalog
      ? undefined
      : sharedModelCatalog.llm.error
    : localLlmCatalogError

  const selectedGenerationTool = findAgentGenerationTool(generationToolSelection, generationTools)
  const selectedGenerationToolId = selectedGenerationTool?.id
  const validatedGenerationToolSelection =
    selectedGenerationTool && isAgentGenerationOutput(selectedGenerationTool.output)
      ? { id: selectedGenerationTool.id, output: selectedGenerationTool.output }
      : undefined
  const generationDescriptionScope = selectedGenerationToolId
    ? JSON.stringify([generationCatalogScope, selectedGenerationToolId])
    : ""
  const generationToolInputOwner = selectedGenerationToolId
    ? JSON.stringify([props.projectId ?? null, selectedGenerationToolId])
    : ""
  const currentGenerationDescription =
    generationDescriptionScope && generationDescription.scope === generationDescriptionScope
      ? generationDescription
      : undefined
  const generationToolInputValidation =
    currentGenerationDescription?.status === "ready"
      ? validateToolInputValues(currentGenerationDescription.value.fields, generationToolInput)
      : undefined
  const generationConfigurationReady =
    !validatedGenerationToolSelection ||
    Boolean(currentGenerationDescription?.status === "ready" && generationToolInputValidation?.valid)
  const validatedGenerationToolInput: GenerationToolInput | undefined = generationToolInputValidation?.valid
    ? generationToolInputValidation.input
    : undefined
  const selectedLlmModel = findAgentLlmModel(llmSelection, llmCatalog)
  const validatedLlmSelection = selectedLlmModel
    ? { modelId: selectedLlmModel.model.modelId, providerId: selectedLlmModel.provider.providerId }
    : undefined
  const displayedModelTitle =
    modelPickerTab === "llm"
      ? selectedLlmModel?.model.modelName
      : selectedGenerationTool?.output === modelPickerTab
        ? agentGenerationModelSelectionTitle(selectedGenerationTool)
        : undefined
  const displayedModelLoading = modelPickerTab === "llm" ? llmCatalogLoading : generationToolsLoading
  const displayedModelLabel = displayedModelTitle ?? (displayedModelLoading ? "Loading…" : "Choose a model")

  const selectSession = useCallback((nextSessionId?: string) => {
    activeSessionIdRef.current = nextSessionId
    setSessionId(nextSessionId)
  }, [])

  const replaceComposerDraft = useCallback((next: AgentComposerDraft) => {
    const normalized = normalizeAgentComposerDraft(next)
    composerDraftRef.current = normalized
    setComposerDraft(normalized)
    if (composerRef.current) writeAgentComposerDraft(composerRef.current, normalized)
  }, [])

  const setSessionPrompting = useCallback((targetSessionId: string, prompting: boolean) => {
    const next = new Set(promptingSessionIdsRef.current)
    if (prompting) next.add(targetSessionId)
    else next.delete(targetSessionId)
    promptingSessionIdsRef.current = next
    if (mountedRef.current) setPromptingSessionIds(next)
  }, [])

  const setSessionStopping = useCallback((targetSessionId: string, stopping: boolean) => {
    const next = new Set(stoppingSessionIdsRef.current)
    if (stopping) next.add(targetSessionId)
    else next.delete(targetSessionId)
    stoppingSessionIdsRef.current = next
    if (mountedRef.current) setStoppingSessionIds(next)
  }, [])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      generationRef.current += 1
      generationCatalogRequestRef.current.invalidate()
      generationDescriptionRequestRef.current.invalidate()
      llmCatalogRequestRef.current.invalidate()
      sessionStateRequestRef.current.clear()
      sessionListRequestRef.current += 1
      requestTrackerRef.current.invalidate()
      compositionControllerRef.current.dispose()
    }
  }, [])

  const loadGenerationTools = useCallback(() => {
    const scopeId = props.projectId
    if (sharedGenerationController) {
      if (!scopeId) return Promise.resolve<readonly GenerationToolSummary[]>([])
      return sharedGenerationController
        .listTools()
        .then((listed) => {
          const tools = listed.filter((tool) => isAgentGenerationOutput(tool.output))
          if (!mountedRef.current || activeProjectRef.current !== scopeId) return tools
          const current = generationToolSelectionRef.current
          const reconciled = reconcileAgentGenerationToolPreference(current, tools)
          if (current?.id !== reconciled?.id || current?.output !== reconciled?.output) {
            setGenerationToolSelection(reconciled)
          }
          return tools
        })
        // The shared snapshot owns user-visible failure state and keeps stale data.
        // Event/effect callers intentionally fire-and-forget this reconciliation.
        .catch(() => [])
    }
    const isLatest = generationCatalogRequestRef.current.begin(generationCatalogScope)
    setGenerationTools([])
    setGenerationToolsError(undefined)
    if (!scopeId) {
      setGenerationToolsLoading(false)
      return Promise.resolve<readonly GenerationToolSummary[]>([])
    }
    setGenerationToolsLoading(true)
    return window.convax.generation
      .listTools({ scopeId })
      .then((listed) => {
        const tools = listed.filter((tool) => isAgentGenerationOutput(tool.output))
        if (!mountedRef.current || activeProjectRef.current !== scopeId || !isLatest()) return tools
        setGenerationTools(tools)
        const current = generationToolSelectionRef.current
        const reconciled = reconcileAgentGenerationToolSelection(current, tools)
        if (current?.id !== reconciled?.id || current?.output !== reconciled?.output) {
          setGenerationToolSelection(reconciled)
        }
        return tools
      })
      .catch((cause) => {
        if (mountedRef.current && activeProjectRef.current === scopeId && isLatest()) {
          setGenerationToolsError(errorMessage(cause))
        }
        return []
      })
      .finally(() => {
        if (mountedRef.current && activeProjectRef.current === scopeId && isLatest()) {
          setGenerationToolsLoading(false)
        }
      })
  }, [generationCatalogScope, props.projectId, setGenerationToolSelection, sharedGenerationController])

  const loadLlmModels = useCallback((options?: { reconcileReady?: boolean; refreshShared?: boolean; throwOnError?: boolean }) => {
    const scopeId = props.projectId
    if (usesSharedModelCatalog) {
      const request = options?.refreshShared ? refreshSharedLlmModels?.() : Promise.resolve(sharedLlmCatalog)
      return (request ?? Promise.resolve(sharedLlmCatalog))
        .then((readyCatalog) => {
          if (
            options?.reconcileReady !== false &&
            scopeId &&
            mountedRef.current &&
            activeProjectRef.current === scopeId
          ) {
            const current = llmSelectionRef.current
            const reconciled = reconcileAgentLlmModelSelectionFromReadyCatalog(current, readyCatalog)
            if (current?.providerId !== reconciled?.providerId || current?.modelId !== reconciled?.modelId) {
              setLlmSelection(reconciled)
            }
          }
          return readyCatalog ?? { providers: [] }
        })
        .catch((cause) => {
          if (options?.throwOnError) throw cause
          return sharedLlmCatalog ?? { providers: [] }
        })
    }
    const isLatest = llmCatalogRequestRef.current.begin(llmCatalogScope)
    if (llmCatalogValueScopeRef.current !== llmCatalogScope) {
      llmCatalogValueScopeRef.current = ""
      setLlmCatalog(undefined)
    }
    setLlmCatalogError(undefined)
    if (!scopeId) {
      llmCatalogValueScopeRef.current = ""
      setLlmCatalogLoading(false)
      return Promise.resolve<AgentModelCatalog>({ providers: [] })
    }
    setLlmCatalogLoading(true)
    return window.convax.agent
      .listModels({ scopeId })
      .then((catalog) => {
        if (!mountedRef.current || activeProjectRef.current !== scopeId || !isLatest()) return catalog
        llmCatalogValueScopeRef.current = llmCatalogScope
        setLlmCatalog(catalog)
        if (options?.reconcileReady !== false) {
          const current = llmSelectionRef.current
          const reconciled = reconcileAgentLlmModelSelection(current, catalog)
          if (current?.providerId !== reconciled?.providerId || current?.modelId !== reconciled?.modelId) {
            setLlmSelection(reconciled)
          }
        }
        return catalog
      })
      .catch((cause) => {
        if (mountedRef.current && activeProjectRef.current === scopeId && isLatest()) {
          setLlmCatalogError(errorMessage(cause))
        }
        if (options?.throwOnError) throw cause
        return { providers: [] }
      })
      .finally(() => {
        if (mountedRef.current && activeProjectRef.current === scopeId && isLatest()) {
          setLlmCatalogLoading(false)
        }
      })
  }, [llmCatalogScope, props.projectId, refreshSharedLlmModels, setLlmSelection, sharedLlmCatalog, usesSharedModelCatalog])

  useEffect(() => {
    void loadGenerationTools()
    return () => generationCatalogRequestRef.current.invalidate()
  }, [loadGenerationTools])

  useEffect(() => {
    if (!props.projectId || !sharedGenerationSnapshot?.ready) return
    const current = generationToolSelectionRef.current
    if (!current) return
    const reconciled = reconcileAgentGenerationToolPreference(current, generationTools)
    if (current.id !== reconciled?.id || current.output !== reconciled?.output) {
      setGenerationToolSelection(reconciled)
    }
  }, [
    generationTools,
    props.projectId,
    setGenerationToolSelection,
    sharedGenerationSnapshot?.ready,
  ])

  useEffect(() => {
    const ownerChanged = generationToolInputOwnerRef.current !== generationToolInputOwner
    generationToolInputOwnerRef.current = generationToolInputOwner
    if (ownerChanged) setGenerationToolInput({})
    if (!props.projectId || !selectedGenerationToolId || !generationDescriptionScope) {
      generationDescriptionRequestRef.current.invalidate()
      setGenerationDescription({ scope: "", status: "loading" })
      return undefined
    }
    const scopeId = props.projectId
    const selectedId = selectedGenerationToolId
    const isLatest = generationDescriptionRequestRef.current.begin(generationDescriptionScope)
    const cachedDescription = sharedGenerationController?.peekDescription(selectedId)
    if (cachedDescription?.toolId === selectedId) {
      setGenerationToolInput((current) =>
        ownerChanged
          ? createToolInputDefaultValues(cachedDescription.fields)
          : reconcileToolInputValues(cachedDescription.fields, current),
      )
      setGenerationDescription({ scope: generationDescriptionScope, status: "ready", value: cachedDescription })
    } else {
      setGenerationDescription({ scope: generationDescriptionScope, status: "loading" })
    }
    const descriptionRequest = sharedGenerationController
      ? sharedGenerationController.describeTool(selectedId)
      : window.convax.generation.describeTool({ scopeId, toolId: selectedId })
    void descriptionRequest.then(
      (result) => {
        if (!mountedRef.current || activeProjectRef.current !== scopeId || !isLatest()) return
        if (result.toolId !== selectedId) {
          setGenerationDescription({
            error: "The generation model returned a stale configuration.",
            scope: generationDescriptionScope,
            status: "error",
          })
          return
        }
        setGenerationToolInput((current) =>
          reconcileToolInputValues(result.fields, current, cachedDescription?.toolId !== selectedId),
        )
        setGenerationDescription({ scope: generationDescriptionScope, status: "ready", value: result })
      },
      (cause) => {
        if (mountedRef.current && activeProjectRef.current === scopeId && isLatest()) {
          if (cachedDescription?.toolId === selectedId) return
          setGenerationDescription({
            error: errorMessage(cause),
            scope: generationDescriptionScope,
            status: "error",
          })
        }
      },
    )
    return () => {
      if (isLatest()) generationDescriptionRequestRef.current.invalidate()
    }
  }, [
    generationDescriptionScope,
    generationToolInputOwner,
    props.projectId,
    selectedGenerationToolId,
    sharedGenerationController,
  ])

  const refreshSessions = useCallback(
    async (preferredSessionId?: string) => {
      if (embedded || !props.projectId) return []
      const scopeId = props.projectId
      const scope = conversationScope
      const request = ++sessionListRequestRef.current
      const result = filterStandaloneAgentSessions(await window.convax.agent.listSessions({ scopeId, limit: 60 }))
      if (
        !mountedRef.current ||
        activeProjectRef.current !== scopeId ||
        activeScopeRef.current !== scope ||
        request !== sessionListRequestRef.current
      )
        return result
      setSessions(result)
      const selected = selectAgentSessionAfterRefresh(result, activeSessionIdRef.current, preferredSessionId)
      sessionProjectRef.current = scopeId
      sessionScopeRef.current = scope
      selectSession(selected)
      return result
    },
    [conversationScope, embedded, props.projectId, selectSession],
  )

  const refreshSessionState = useCallback(
    async (targetSessionId = sessionId) => {
      if (!props.projectId || !targetSessionId) {
        setSessionState(undefined)
        return
      }
      const scopeId = props.projectId
      const scope = conversationScope
      const isLatestRequest = sessionStateRequestRef.current.begin(scope, targetSessionId)
      const result = await window.convax.agent.getSessionState({
        scopeId,
        sessionId: targetSessionId,
        limit: 200,
      })
      if (
        isLatestRequest() &&
        mountedRef.current &&
        activeProjectRef.current === scopeId &&
        activeScopeRef.current === scope &&
        activeSessionIdRef.current === targetSessionId
      )
        setSessionState(result)
      return result
    },
    [conversationScope, props.projectId, sessionId],
  )

  useEffect(() => {
    generationRef.current += 1
    sessionStateRequestRef.current.clear()
    sessionListRequestRef.current += 1
    sessionProjectRef.current = undefined
    sessionScopeRef.current = undefined
    setSessions([])
    const cachedSessionId = embedded
      ? embeddedConversationSessions.get(props.projectId, props.conversationKey)
      : undefined
    if (cachedSessionId && props.projectId) {
      sessionProjectRef.current = props.projectId
      sessionScopeRef.current = conversationScope
    }
    restoredSessionRef.current = cachedSessionId
    selectSession(cachedSessionId)
    setSessionState(undefined)
    setCapabilities(undefined)
    setCapabilitiesError(undefined)
    capabilitiesRequestRef.current = undefined
    requestTrackerRef.current.invalidate()
    setProjectListings(new Map())
    setExpandedProjectPaths(new Set())
    setLoadedCanvasDocuments(new Map())
    setExpandedCanvasIds(new Set())
    setInventoryLoadingKeys(new Set())
    setInventoryErrors(new Map())
    llmCatalogRequestRef.current.invalidate()
    llmCatalogValueScopeRef.current = ""
    setLlmCatalog(undefined)
    setLlmCatalogError(undefined)
    setLlmCatalogLoading(false)
    setHistoryVisible(false)
    setSuggestion(closeAgentComposerSuggestion())
    setSuggestionQuery("")
    setSuggestionAnchor(undefined)
    setReferenceTab("project")
    setGenerationModelPickerOpen(false)
    setComposerFocused(false)
    pendingComposerFocusRef.current = false
    setDropActive(false)
    replaceComposerDraft(agentComposerDraftWithResources(initialResourcesRef.current))
    promptingSessionIdsRef.current = new Set()
    setPromptingSessionIds(new Set())
    stoppingSessionIdsRef.current = new Set()
    setStoppingSessionIds(new Set())
    setFailedSubmissions([])
    stickToBottomRef.current = true
    setFollowingLatest(true)
    setError(undefined)
    setCapabilitiesLoading(false)
    setLoading(false)
    setSessionCatalogReadyScope(embedded && props.projectId ? conversationScope : "")
  }, [conversationScope, replaceComposerDraft, selectSession])

  useEffect(() => {
    if (sessionCatalogReadyScope !== conversationScope) return
    void loadLlmModels()
    return () => llmCatalogRequestRef.current.invalidate()
  }, [conversationScope, loadLlmModels, sessionCatalogReadyScope])

  useEffect(() => {
    if (embedded || !open || !props.projectId) {
      setLoading(false)
      setSessionCatalogReadyScope(embedded && props.projectId ? conversationScope : "")
      return
    }
    const scopeId = props.projectId
    const scope = conversationScope
    let stale = false
    const request = ++sessionListRequestRef.current
    setLoading(true)
    setSessionCatalogReadyScope("")
    void window.convax.agent
      .listSessions({ scopeId, limit: 60 })
      .then((listedSessions) => {
        const result = filterStandaloneAgentSessions(listedSessions)
        if (
          stale ||
          !mountedRef.current ||
          activeProjectRef.current !== scopeId ||
          activeScopeRef.current !== scope ||
          request !== sessionListRequestRef.current
        )
          return
        setSessions(result)
        sessionProjectRef.current = scopeId
        sessionScopeRef.current = scope
        selectSession(result[0]?.id)
      })
      .catch((cause) => {
        if (!stale) setError(errorMessage(cause))
      })
      .finally(() => {
        if (!stale) {
          setLoading(false)
          setSessionCatalogReadyScope(scope)
        }
      })
    return () => {
      stale = true
    }
  }, [conversationScope, embedded, open, props.projectId, selectSession])

  useEffect(() => {
    if (
      !props.projectId ||
      !sessionId ||
      sessionProjectRef.current !== props.projectId ||
      sessionScopeRef.current !== conversationScope
    ) {
      setSessionState(undefined)
      return
    }
    const scopeId = props.projectId
    const scope = conversationScope
    let stale = false
    setLoading(true)
    void refreshSessionState(sessionId)
      .then(() => {
        if (restoredSessionRef.current === sessionId) restoredSessionRef.current = undefined
      })
      .catch((cause) => {
        if (stale || !mountedRef.current || activeProjectRef.current !== scopeId || activeScopeRef.current !== scope)
          return
        const recovered =
          embedded &&
          restoredSessionRef.current === sessionId &&
          forgetStaleEmbeddedConversation(embeddedConversationSessions, scopeId, props.conversationKey, sessionId)
        if (recovered) {
          restoredSessionRef.current = undefined
          sessionProjectRef.current = undefined
          sessionScopeRef.current = undefined
          selectSession(undefined)
          setSessionState(undefined)
          setError(undefined)
          return
        }
        setError(errorMessage(cause))
      })
      .finally(() => {
        if (!stale && mountedRef.current && activeProjectRef.current === scopeId && activeScopeRef.current === scope)
          setLoading(false)
      })
    return () => {
      stale = true
    }
  }, [
    conversationScope,
    embedded,
    props.conversationKey,
    props.projectId,
    refreshSessionState,
    selectSession,
    sessionId,
  ])

  const runtimeBusy =
    Boolean(sessionId && promptingSessionIds.has(sessionId)) ||
    sessionState?.status.type === "busy" ||
    sessionState?.status.type === "retry"
  const responseStopping = Boolean(sessionId && stoppingSessionIds.has(sessionId))
  const awaitingInteraction = Boolean(sessionState?.pendingPermissions.length || sessionState?.pendingQuestions.length)
  const interactionDisabled = runtimeBusy || responseStopping || loading || creatingSession
  useEffect(() => {
    const root = composerRef.current
    if (!root) return
    for (const button of root.querySelectorAll<HTMLButtonElement>(`button[${agentComposerTokenActionAttribute}]`)) {
      button.disabled = interactionDisabled
    }
  }, [composerDraft, interactionDisabled])
  const displayedResources = contextResources
  const sessionContentKey = useMemo(() => agentSessionContentKey(sessionState), [sessionState])
  useEffect(() => {
    const reportDisplayed = () => {
      const displayed = displayedAgentSession({
        documentVisible: document.visibilityState === "visible",
        historyVisible,
        open,
        projectId: props.projectId,
        selectedSessionId: sessionId,
        stateSessionId: sessionState?.session.id,
      })
      if (displayed) props.onSessionDisplayed?.(displayed)
    }
    reportDisplayed()
    document.addEventListener("visibilitychange", reportDisplayed)
    return () => document.removeEventListener("visibilitychange", reportDisplayed)
  }, [
    historyVisible,
    open,
    props.onSessionDisplayed,
    props.projectId,
    sessionContentKey,
    sessionId,
    sessionState?.session.id,
  ])
  useEffect(() => {
    if (!runtimeBusy || !sessionId) return
    let stopped = false
    let timer: number | undefined
    const poll = async () => {
      try {
        await refreshSessionState(sessionId)
      } catch (cause) {
        if (!stopped) setError(errorMessage(cause))
      }
      if (!stopped) timer = window.setTimeout(poll, 700)
    }
    timer = window.setTimeout(poll, 350)
    return () => {
      stopped = true
      if (timer) window.clearTimeout(timer)
    }
  }, [refreshSessionState, runtimeBusy, sessionId])

  useEffect(() => {
    const viewport = scrollViewportRef.current
    if (!viewport || !stickToBottomRef.current) return
    const frame = window.requestAnimationFrame(() => {
      viewport.scrollTop = viewport.scrollHeight
    })
    return () => window.cancelAnimationFrame(frame)
  }, [historyVisible, open, runtimeBusy, sessionContentKey])

  useEffect(() => {
    const viewport = scrollViewportRef.current
    if (!viewport) return
    const settleDisclosureScroll = () => {
      window.requestAnimationFrame(() => {
        if (stickToBottomRef.current) viewport.scrollTop = viewport.scrollHeight
        else {
          const next = isAgentScrollNearBottom(viewport)
          stickToBottomRef.current = next
          setFollowingLatest(next)
        }
      })
    }
    viewport.addEventListener("toggle", settleDisclosureScroll, true)
    return () => viewport.removeEventListener("toggle", settleDisclosureScroll, true)
  }, [historyVisible, open])

  const loadCapabilities = useCallback(() => {
    if (!props.projectId) return Promise.resolve(undefined)
    if (capabilities) return Promise.resolve(capabilities)
    if (capabilitiesRequestRef.current) return capabilitiesRequestRef.current
    const scopeId = props.projectId
    const scope = conversationScope
    const isLatest = requestTrackerRef.current.begin(scope, "capabilities")
    setCapabilitiesError(undefined)
    setCapabilitiesLoading(true)
    const request = window.convax.agent
      .listCapabilities({ scopeId })
      .then((result) => {
        if (
          mountedRef.current &&
          activeProjectRef.current === scopeId &&
          activeScopeRef.current === scope &&
          isLatest()
        )
          setCapabilities(result)
        return result
      })
      .catch((cause) => {
        if (
          mountedRef.current &&
          activeProjectRef.current === scopeId &&
          activeScopeRef.current === scope &&
          isLatest()
        )
          setCapabilitiesError(errorMessage(cause))
        throw cause
      })
      .finally(() => {
        if (capabilitiesRequestRef.current === request) capabilitiesRequestRef.current = undefined
        if (
          mountedRef.current &&
          activeProjectRef.current === scopeId &&
          activeScopeRef.current === scope &&
          isLatest()
        )
          setCapabilitiesLoading(false)
      })
    capabilitiesRequestRef.current = request
    return request
  }, [capabilities, conversationScope, props.projectId])

  const setInventoryLoading = useCallback((key: string, loading: boolean) => {
    setInventoryLoadingKeys((current) => {
      const next = new Set(current)
      if (loading) next.add(key)
      else next.delete(key)
      return next
    })
  }, [])

  const clearInventoryError = useCallback((key: string) => {
    setInventoryErrors((current) => {
      if (!current.has(key)) return current
      const next = new Map(current)
      next.delete(key)
      return next
    })
  }, [])

  const setInventoryError = useCallback((key: string, message: string) => {
    setInventoryErrors((current) => new Map(current).set(key, message))
  }, [])

  const loadProjectDirectory = useCallback(
    async (path: string) => {
      const scopeId = props.projectId
      if (!scopeId) return
      const key = `project:${path}`
      const isLatest = requestTrackerRef.current.begin(scopeId, key)
      setInventoryLoading(key, true)
      clearInventoryError(key)
      try {
        const listing = await window.convax.projectFiles.listDirectory({ path, projectId: scopeId })
        if (!mountedRef.current || activeProjectRef.current !== scopeId || !isLatest()) return
        setProjectListings((current) => new Map(current).set(path, listing.entries))
      } catch (cause) {
        if (mountedRef.current && activeProjectRef.current === scopeId && isLatest()) {
          setInventoryError(key, errorMessage(cause))
        }
      } finally {
        if (mountedRef.current && activeProjectRef.current === scopeId && isLatest()) setInventoryLoading(key, false)
      }
    },
    [clearInventoryError, props.projectId, setInventoryError, setInventoryLoading],
  )

  const loadCanvasDocument = useCallback(
    async (canvasId: string) => {
      const scopeId = props.projectId
      if (!scopeId || !props.canvases.some((canvas) => canvas.id === canvasId)) return
      const key = `canvas:${canvasId}`
      const isLatest = requestTrackerRef.current.begin(scopeId, key)
      setInventoryLoading(key, true)
      clearInventoryError(key)
      try {
        if (canvasId === props.activeCanvas?.id) await props.beforePrompt?.()
        const snapshot = await window.convax.canvas.documents.load({ canvasId, scopeId })
        if (!mountedRef.current || activeProjectRef.current !== scopeId || !isLatest()) return
        const document = snapshot.projection
        if (!document) throw new Error(`Canvas document was not found: ${canvasId}`)
        setLoadedCanvasDocuments((current) => new Map(current).set(canvasId, document))
      } catch (cause) {
        if (mountedRef.current && activeProjectRef.current === scopeId && isLatest()) {
          setInventoryError(key, errorMessage(cause))
        }
      } finally {
        if (mountedRef.current && activeProjectRef.current === scopeId && isLatest()) setInventoryLoading(key, false)
      }
    },
    [
      clearInventoryError,
      props.activeCanvas?.id,
      props.beforePrompt,
      props.canvases,
      props.projectId,
      setInventoryError,
      setInventoryLoading,
    ],
  )

  const closeComposerSuggestion = useCallback(() => {
    composerQueryRangeRef.current = undefined
    editingTokenRef.current = undefined
    setSuggestion(closeAgentComposerSuggestion())
    setSuggestionQuery("")
    setSuggestionAnchor(undefined)
  }, [])

  const closeGenerationModelPicker = useCallback(() => {
    setGenerationModelPickerOpen(false)
  }, [])

  useEffect(() => {
    if (interactionDisabled) {
      closeComposerSuggestion()
      closeGenerationModelPicker()
    }
  }, [closeComposerSuggestion, closeGenerationModelPicker, interactionDisabled])

  useEffect(() => {
    if (!generationModelPickerOpen) return
    const dismiss = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || !composerSurfaceRef.current?.contains(event.target)) {
        closeGenerationModelPicker()
      }
    }
    document.addEventListener("pointerdown", dismiss)
    return () => document.removeEventListener("pointerdown", dismiss)
  }, [closeGenerationModelPicker, generationModelPickerOpen])

  const syncComposerDraft = useCallback(() => {
    if (!composerRef.current) return
    const next = readAgentComposerDraft(composerRef.current)
    composerDraftRef.current = next
    setComposerDraft(next)
  }, [])

  const referenceRows = useMemo(
    () =>
      referenceTab === "project"
        ? buildAgentProjectReferenceTree({ expandedPaths: expandedProjectPaths, listings: projectListings })
        : buildAgentCanvasReferenceTree({
            activeCanvasId: props.activeCanvas?.id,
            canvases: props.canvases,
            documents: loadedCanvasDocuments,
            expandedIds: expandedCanvasIds,
          }),
    [
      expandedCanvasIds,
      expandedProjectPaths,
      loadedCanvasDocuments,
      projectListings,
      props.activeCanvas?.id,
      props.canvases,
      referenceTab,
    ],
  )
  const visibleReferenceRows = useMemo(
    () => filterAgentReferenceTree(referenceRows, suggestionQuery),
    [referenceRows, suggestionQuery],
  )
  const suggestionOptions = useMemo<AgentComposerPickerOption[]>(() => {
    if (!suggestion.open) return []
    if (suggestion.trigger === "skill") {
      return filterAgentSkills(capabilities?.skills ?? [], suggestionQuery).map((skill) => ({
        description: skill.description,
        id: `skill:${skill.name}`,
        label: skill.name,
        optionType: "skill",
        resource: { kind: "skill", name: skill.name },
      }))
    }
    return visibleReferenceRows.map((row) => ({ ...row, optionType: "reference" }))
  }, [
    capabilities?.skills,
    suggestion.open,
    suggestion.open ? suggestion.trigger : undefined,
    suggestionQuery,
    visibleReferenceRows,
  ])

  const referenceStatusById = useMemo(
    () => buildAgentReferenceStatusById(inventoryLoadingKeys, inventoryErrors),
    [inventoryErrors, inventoryLoadingKeys],
  )
  const projectRootUnavailable = !projectListings.has("")
  const suggestionLoading = suggestion.open
    ? suggestion.trigger === "skill"
      ? capabilitiesLoading
      : referenceTab === "project" && projectRootUnavailable && inventoryLoadingKeys.has("project:")
    : false
  const suggestionError = suggestion.open
    ? suggestion.trigger === "skill"
      ? capabilitiesError
      : referenceTab === "project" && projectRootUnavailable
        ? inventoryErrors.get("project:")
        : undefined
    : undefined
  const selectableSuggestionOptions = useMemo(
    () => (suggestionLoading || suggestionError ? [] : suggestionOptions),
    [suggestionError, suggestionLoading, suggestionOptions],
  )
  const activeSuggestionOption = suggestion.open
    ? resolveAgentComposerSuggestionOption(suggestion, selectableSuggestionOptions)
    : undefined

  useEffect(() => {
    setSuggestion((current) =>
      current.open ? reconcileAgentComposerSuggestionOptions(current, selectableSuggestionOptions) : current,
    )
  }, [selectableSuggestionOptions])

  const changeReferenceTab = useCallback(
    (tab: "canvas" | "project") => {
      setReferenceTab(tab)
      setSuggestion((current) => (current.open ? { ...current, activeId: undefined, hoveredId: undefined } : current))
      if (tab === "project" && (!projectListings.has("") || inventoryErrors.has("project:"))) {
        void loadProjectDirectory("")
      }
    },
    [inventoryErrors, loadProjectDirectory, projectListings],
  )

  const toggleReferenceOption = useCallback(
    (option: Extract<AgentComposerPickerOption, { optionType: "reference" }>) => {
      if (!option.expandable) return
      if (option.section === "project") {
        if (option.resource.kind !== "directory") return
        const path = option.resource.path
        const expanding = !expandedProjectPaths.has(path)
        setExpandedProjectPaths((current) => {
          const next = new Set(current)
          if (expanding) next.add(path)
          else next.delete(path)
          return next
        })
        if (expanding && (!projectListings.has(path) || inventoryErrors.has(`project:${path}`))) {
          void loadProjectDirectory(path)
        }
        return
      }

      const expanding = !expandedCanvasIds.has(option.id)
      setExpandedCanvasIds((current) => {
        const next = new Set(current)
        if (expanding) next.add(option.id)
        else next.delete(option.id)
        return next
      })
      if (option.kind !== "canvas" || !expanding) return
      const canvasId = option.id.slice("canvas:".length)
      if (!loadedCanvasDocuments.has(canvasId) || inventoryErrors.has(`canvas:${canvasId}`)) {
        void loadCanvasDocument(canvasId)
      }
    },
    [
      expandedCanvasIds,
      expandedProjectPaths,
      inventoryErrors,
      loadCanvasDocument,
      loadedCanvasDocuments,
      loadProjectDirectory,
      projectListings,
    ],
  )

  const retryReferenceInventory = useCallback(() => {
    if (referenceTab === "project") void loadProjectDirectory("")
  }, [loadProjectDirectory, referenceTab])

  const retryReferenceOption = useCallback(
    (option: Extract<AgentComposerPickerOption, { optionType: "reference" }>) => {
      if (option.section === "project" && option.resource.kind === "directory") {
        void loadProjectDirectory(option.resource.path)
      } else if (option.section === "canvas" && option.kind === "canvas") {
        void loadCanvasDocument(option.id.slice("canvas:".length))
      }
    },
    [loadCanvasDocument, loadProjectDirectory],
  )

  const updateComposerQuery = useCallback(() => {
    const root = composerRef.current
    if (!root) return
    const match = findAgentComposerQueryRange(root)
    if (!match) {
      composerQueryRangeRef.current = undefined
      if (suggestion.open && suggestion.mode === "query") closeComposerSuggestion()
      return
    }
    const continuingQuery = suggestion.open && suggestion.mode === "query" && suggestion.trigger === match.trigger
    composerQueryRangeRef.current = match
    composerSelectionRef.current = captureAgentComposerSelection(root)
    setSuggestionQuery(match.query)
    setSuggestionAnchor(agentComposerPickerAnchor(root, match))
    setSuggestion((current) => {
      if (current.open && current.mode === "query" && current.trigger === match.trigger) return current
      return openAgentComposerSuggestion(match.trigger, [], { kind: "caret" })
    })
    if (match.trigger === "skill") void loadCapabilities().catch(() => undefined)
    else {
      if (!continuingQuery) setReferenceTab("project")
      if (
        (!continuingQuery || referenceTab === "project") &&
        (!projectListings.has("") || inventoryErrors.has("project:"))
      ) {
        void loadProjectDirectory("")
      }
    }
    closeGenerationModelPicker()
  }, [
    closeComposerSuggestion,
    closeGenerationModelPicker,
    inventoryErrors,
    loadCapabilities,
    loadProjectDirectory,
    projectListings,
    referenceTab,
    suggestion,
  ])

  const refreshComposerSuggestionAnchor = useCallback(() => {
    const root = composerRef.current
    if (!root) return
    const token = editingTokenRef.current
    if (token?.isConnected && root.contains(token)) {
      setSuggestionAnchor(agentComposerPickerAnchor(root, token))
      return
    }
    const query = composerQueryRangeRef.current
    if (query?.node.isConnected && root.contains(query.node)) {
      setSuggestionAnchor(agentComposerPickerAnchor(root, query))
    }
  }, [])

  useLayoutEffect(() => {
    if (suggestion.open) refreshComposerSuggestionAnchor()
  }, [expandedCanvasIds, expandedProjectPaths, referenceTab, refreshComposerSuggestionAnchor, suggestion.open])

  useEffect(() => {
    if (!suggestion.open) return
    window.addEventListener("resize", refreshComposerSuggestionAnchor)
    window.addEventListener("scroll", refreshComposerSuggestionAnchor, true)
    return () => {
      window.removeEventListener("resize", refreshComposerSuggestionAnchor)
      window.removeEventListener("scroll", refreshComposerSuggestionAnchor, true)
    }
  }, [refreshComposerSuggestionAnchor, suggestion.open])

  const openSkill = useCallback(
    async (name: string) => {
      if (!props.projectId) return
      try {
        await routeAgentSkillOpen(name, props.projectId, props.onOpenSkillDetails, (input) =>
          window.convax.agent.skills.openSkill(input),
        )
      } catch (cause) {
        if (mountedRef.current) setError(errorMessage(cause))
      }
    },
    [props.onOpenSkillDetails, props.projectId],
  )

  const addResources = useCallback(
    (next: readonly AgentResource[]) => {
      if (!next.length) return
      const root = composerRef.current
      if (root) {
        insertAgentComposerResources(root, next, composerSelectionRef.current)
        syncComposerDraft()
      } else {
        replaceComposerDraft({
          segments: [
            ...composerDraftRef.current.segments,
            ...next.map((resource) => ({ resource, type: "resource" as const })),
          ],
        })
      }
      closeComposerSuggestion()
    },
    [closeComposerSuggestion, replaceComposerDraft, syncComposerDraft],
  )

  useImperativeHandle(
    ref,
    () => ({
      addResources(resources) {
        if (!props.projectId || resources.length === 0) return
        pendingComposerFocusRef.current = true
        addResources(resources)
        props.layout?.onOpenChange(true)
        setComposerFocusRequest((request) => request + 1)
      },
      async openSession(targetSessionId) {
        if (embedded || !props.projectId) throw new Error("The Agent panel cannot open this conversation")
        props.layout?.onOpenChange(true)
        const available = await refreshSessions(targetSessionId)
        if (!available.some((session) => session.id === targetSessionId)) {
          throw new Error("The Agent conversation is no longer available")
        }
        selectSession(targetSessionId)
        setHistoryVisible(false)
        stickToBottomRef.current = true
        setFollowingLatest(true)
        await refreshSessionState(targetSessionId)
      },
      finishSession(input) {
        if (props.projectId !== input.scopeId) return
        setSessionPrompting(input.sessionId, false)
        if (activeSessionIdRef.current === input.sessionId) {
          void Promise.all([refreshSessionState(input.sessionId), refreshSessions(input.sessionId)]).catch((cause) => {
            if (
              mountedRef.current &&
              activeProjectRef.current === input.scopeId &&
              activeScopeRef.current === conversationScope &&
              activeSessionIdRef.current === input.sessionId
            ) {
              setError(errorMessage(cause))
            }
          })
        } else {
          void refreshSessions().catch(() => undefined)
        }
      },
      focusComposer() {
        if (!props.projectId) return
        pendingComposerFocusRef.current = true
        props.layout?.onOpenChange(true)
        setComposerFocusRequest((request) => request + 1)
      },
      showSession(input) {
        if (props.projectId !== input.scopeId) return false
        sessionProjectRef.current = input.scopeId
        sessionScopeRef.current = conversationScope
        restoredSessionRef.current = undefined
        setSessions((current) => [input.session, ...current.filter((session) => session.id !== input.session.id)])
        selectSession(input.session.id)
        setSessionState(undefined)
        setHistoryVisible(false)
        setSessionPrompting(input.session.id, true)
        stickToBottomRef.current = true
        setFollowingLatest(true)
        props.layout?.onOpenChange(true)
        void refreshSessionState(input.session.id).catch((cause) => {
          if (
            mountedRef.current &&
            activeProjectRef.current === input.scopeId &&
            activeScopeRef.current === conversationScope &&
            activeSessionIdRef.current === input.session.id
          ) {
            setError(errorMessage(cause))
          }
        })
        return true
      },
    }),
    [
      addResources,
      conversationScope,
      embedded,
      props.layout?.onOpenChange,
      props.projectId,
      refreshSessions,
      refreshSessionState,
      selectSession,
      setSessionPrompting,
    ],
  )

  useLayoutEffect(() => {
    if (!open || !pendingComposerFocusRef.current || !composerRef.current) return
    pendingComposerFocusRef.current = false
    writeAgentComposerDraft(composerRef.current, composerDraftRef.current)
    focusAgentComposerAtEnd(composerRef.current)
  }, [composerDraft, composerFocusRequest, open])

  const selectComposerSuggestion = useCallback(
    (option: AgentComposerPickerOption) => {
      const root = composerRef.current
      if (!root) return
      const editingToken = editingTokenRef.current
      const query = composerQueryRangeRef.current
      if (suggestion.open && suggestion.mode === "edit" && editingToken) {
        replaceAgentComposerToken(root, editingToken, option.resource)
      } else if (query) {
        replaceAgentComposerQuery(root, query, option.resource)
      } else {
        insertAgentComposerResources(root, [option.resource], composerSelectionRef.current)
      }
      syncComposerDraft()
      closeComposerSuggestion()
    },
    [closeComposerSuggestion, suggestion, syncComposerDraft],
  )

  const editComposerToken = useCallback(
    (root: HTMLElement, token: HTMLElement, resource: AgentResource) => {
      const trigger = resource.kind === "skill" ? "skill" : "reference"
      editingTokenRef.current = token
      composerQueryRangeRef.current = undefined
      composerSelectionRef.current = captureAgentComposerSelection(root)
      setSuggestionQuery("")
      setSuggestionAnchor(agentComposerPickerAnchor(root, token))
      setSuggestion(
        openAgentComposerSuggestion(trigger, selectableSuggestionOptions, {
          kind: "token",
          tokenId: agentResourceKey(resource),
        }),
      )
      if (trigger === "skill") void loadCapabilities().catch(() => undefined)
      else if (isAgentCanvasResource(resource)) setReferenceTab("canvas")
      else {
        setReferenceTab("project")
        if (!projectListings.has("") || inventoryErrors.has("project:")) void loadProjectDirectory("")
      }
      closeGenerationModelPicker()
    },
    [
      closeGenerationModelPicker,
      inventoryErrors,
      loadCapabilities,
      loadProjectDirectory,
      projectListings,
      selectableSuggestionOptions,
    ],
  )

  const insertComposerQueryTrigger = useCallback(
    (trigger: "@" | "$") => {
      const root = composerRef.current
      if (!root) return
      insertAgentComposerTrigger(root, trigger, composerSelectionRef.current)
      syncComposerDraft()
      updateComposerQuery()
    },
    [syncComposerDraft, updateComposerQuery],
  )

  useEffect(() => {
    if (!suggestion.open) return
    const dismissForTarget = (target: EventTarget | null) => {
      if (
        !(target instanceof Node) ||
        shouldDismissAgentResourcePicker(composerSurfaceRef.current, target, composerPickerRef.current)
      )
        closeComposerSuggestion()
    }
    const onPointerDown = (event: PointerEvent) => dismissForTarget(event.target)
    const onFocusIn = (event: FocusEvent) => dismissForTarget(event.target)
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      event.preventDefault()
      closeComposerSuggestion()
    }
    document.addEventListener("pointerdown", onPointerDown)
    document.addEventListener("focusin", onFocusIn)
    document.addEventListener("keydown", onKeyDown)
    return () => {
      document.removeEventListener("pointerdown", onPointerDown)
      document.removeEventListener("focusin", onFocusIn)
      document.removeEventListener("keydown", onKeyDown)
    }
  }, [closeComposerSuggestion, suggestion.open])

  useEffect(() => {
    if (!composerFocused || (suggestion.open && suggestion.mode === "edit")) return
    const update = () =>
      compositionControllerRef.current.runWhenIdle(() => window.requestAnimationFrame(updateComposerQuery))
    document.addEventListener("selectionchange", update)
    return () => document.removeEventListener("selectionchange", update)
  }, [composerFocused, suggestion, updateComposerQuery])

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      if (!supportsResourceDrop(event.dataTransfer)) return
      containEmbeddedResourceDrag(embedded, event)
      event.preventDefault()
      setDropActive(false)
      if (!props.projectId) return
      const projectEntries = parseProjectEntryDrag(event.dataTransfer.getData(PROJECT_ENTRY_DRAG_TYPE))
      if (projectEntries?.projectId === props.projectId) {
        addResources(
          projectEntries.entries.map((entry) => ({
            kind: entry.kind,
            name: entry.name,
            path: entry.path,
          })),
        )
        return
      }
      const projectCanvas = parseProjectCanvasDrag(event.dataTransfer.getData(PROJECT_CANVAS_DRAG_TYPE))
      if (projectCanvas?.projectId === props.projectId) {
        addResources([canvasAgentResource(projectCanvas.canvas)])
        return
      }
      const resource = parseAgentComposerResource(event.dataTransfer.getData(resourceDragType))
      if (resource) addResources([resource])
    },
    [addResources, embedded, props.projectId],
  )

  const createSession = useCallback(async () => {
    if (!props.projectId || creatingSessionRef.current) return undefined
    const scopeId = props.projectId
    const scope = conversationScope
    const generation = generationRef.current
    creatingSessionRef.current = true
    setCreatingSession(true)
    setError(undefined)
    try {
      const session = await window.convax.agent.createSession({
        scopeId,
        title: embedded ? embeddedConversationTitle(props.conversationKey) : undefined,
      })
      if (
        !mountedRef.current ||
        generationRef.current !== generation ||
        activeProjectRef.current !== scopeId ||
        activeScopeRef.current !== scope
      )
        return undefined
      sessionListRequestRef.current += 1
      restoredSessionRef.current = undefined
      if (embedded) {
        embeddedConversationSessions.remember(scopeId, props.conversationKey, session.id)
      } else {
        setSessions((current) => [session, ...current.filter((item) => item.id !== session.id)])
      }
      sessionProjectRef.current = scopeId
      sessionScopeRef.current = scope
      selectSession(session.id)
      setSessionState(undefined)
      setHistoryVisible(false)
      stickToBottomRef.current = true
      setFollowingLatest(true)
      return session
    } finally {
      creatingSessionRef.current = false
      if (mountedRef.current && generationRef.current === generation) setCreatingSession(false)
    }
  }, [conversationScope, embedded, props.conversationKey, props.projectId, selectSession])

  const send = useCallback(async () => {
    const submittedDraft = composerDraftRef.current
    const text = agentComposerText(submittedDraft).trim()
    const submittedResources = mergeAgentResources(contextResources, agentComposerResources(submittedDraft))
    if (!props.projectId || interactionDisabled || (!text && submittedResources.length === 0)) return
    if (!validatedLlmSelection) {
      setError("Connect an LLM service with an available model before sending.")
      closeComposerSuggestion()
      setModelPickerTab("llm")
      setGenerationModelPickerOpen(true)
      if (!llmCatalogLoading && (!llmCatalog || llmCatalogError)) {
        void loadLlmModels({ refreshShared: true })
      }
      return
    }
    if (validatedGenerationToolSelection && !generationConfigurationReady) {
      setError("Complete the selected generation model's required options before sending.")
      closeComposerSuggestion()
      setGenerationModelPickerOpen(true)
      return
    }
    closeComposerSuggestion()
    closeGenerationModelPicker()
    const scopeId = props.projectId
    const scope = conversationScope
    const generation = generationRef.current
    const submittedCatalogVersion = generationCatalogVersion
    const submittedGenerationSelection = validatedGenerationToolSelection
    const submittedLlmSelection = llmSelectionRef.current
    const submittedGenerationToolInput = validatedGenerationToolInput
    const submittedActiveCanvas = props.activeCanvas
    const isCurrentScope = () =>
      mountedRef.current &&
      generationRef.current === generation &&
      activeProjectRef.current === scopeId &&
      activeScopeRef.current === scope
    const isActiveTarget = (targetSessionId: string) =>
      isCurrentScope() && activeSessionIdRef.current === targetSessionId
    let cleared = false
    let targetSessionId = sessionScopeRef.current === scope ? sessionId : undefined
    let verifiedGenerationSelection = submittedGenerationSelection
    let verifiedGenerationTools = generationTools
    let verifiedLlmSelection = submittedLlmSelection
    setError(undefined)
    try {
      if (submittedGenerationSelection) {
        const listed = sharedGenerationController
          ? await sharedGenerationController.refresh()
          : await window.convax.generation.listTools({ scopeId })
        if (!isCurrentScope()) return
        if (generationCatalogVersionRef.current !== submittedCatalogVersion) {
          throw new Error("Installed generation models changed. Review the model selection and send again.")
        }
        verifiedGenerationTools = listed.filter((tool) => isAgentGenerationOutput(tool.output))
        if (!sharedGenerationController) setGenerationTools(verifiedGenerationTools)
        verifiedGenerationSelection = reconcileAgentGenerationToolSelection(
          submittedGenerationSelection,
          verifiedGenerationTools,
        )
        if (
          generationToolSelectionRef.current?.id !== verifiedGenerationSelection?.id ||
          generationToolSelectionRef.current?.output !== verifiedGenerationSelection?.output
        ) {
          setGenerationToolSelection(verifiedGenerationSelection)
        }
        if (!verifiedGenerationSelection) {
          setModelPickerTab(submittedGenerationSelection.output)
          setGenerationModelPickerOpen(true)
          throw new Error("The selected generation model is no longer installed. Choose another available model.")
        }
      }
      if (!submittedLlmSelection) {
        throw new Error("No LLM service provides an available model. Open Services to install or configure one.")
      }
      const catalog = await loadLlmModels({
        reconcileReady: false,
        refreshShared: true,
        throwOnError: true,
      })
      if (!isCurrentScope()) return
      const verifiedLlmModel = findAgentLlmModel(submittedLlmSelection, catalog)
      verifiedLlmSelection = verifiedLlmModel
        ? { modelId: verifiedLlmModel.model.modelId, providerId: verifiedLlmModel.provider.providerId }
        : undefined
      if (
        llmSelectionRef.current?.providerId !== verifiedLlmSelection?.providerId ||
        llmSelectionRef.current?.modelId !== verifiedLlmSelection?.modelId
      ) {
        setLlmSelection(verifiedLlmSelection)
      }
      if (!verifiedLlmSelection) {
        setModelPickerTab("llm")
        setGenerationModelPickerOpen(true)
        throw new Error("The selected LLM model is no longer connected. Choose another available model.")
      }
      if (!targetSessionId && embedded) {
        targetSessionId = embeddedConversationSessions.get(scopeId, props.conversationKey)
        if (targetSessionId) {
          sessionProjectRef.current = scopeId
          sessionScopeRef.current = scope
          selectSession(targetSessionId)
        }
      }
      if (!targetSessionId) targetSessionId = (await createSession())?.id
      if (!targetSessionId || !isCurrentScope()) return
      setSessionPrompting(targetSessionId, true)
      replaceComposerDraft(emptyAgentComposerDraft())
      stickToBottomRef.current = true
      setFollowingLatest(true)
      cleared = true
      if (
        shouldFlushAgentCanvasContext({
          activeCanvas: submittedActiveCanvas,
          resources: submittedResources,
        })
      ) {
        await props.beforePrompt?.()
      }
      // beforePrompt can outlive the node that owns an embedded panel. Never
      // continue with a send after unmounting or switching Canvas scope.
      if (!isCurrentScope()) return
      if (verifiedGenerationSelection && generationCatalogVersionRef.current !== submittedCatalogVersion) {
        throw new Error("Installed generation models changed. Review the model selection and send again.")
      }
      await window.convax.agent.prompt({
        instructions: createAgentPromptInstructions({
          activeCanvas: submittedActiveCanvas,
          generationSelection: verifiedGenerationSelection,
          generationToolInput: verifiedGenerationSelection ? submittedGenerationToolInput : undefined,
          generationTools: verifiedGenerationTools,
          resources: submittedResources,
        }),
        model: verifiedLlmSelection,
        resources: submittedResources,
        scopeId,
        sessionId: targetSessionId,
        text,
      })
      if (!isCurrentScope()) return
      if (isActiveTarget(targetSessionId)) {
        await Promise.all([refreshSessionState(targetSessionId), refreshSessions(targetSessionId)]).catch((cause) => {
          if (targetSessionId && isActiveTarget(targetSessionId)) setError(errorMessage(cause))
        })
      } else {
        await refreshSessions().catch(() => undefined)
      }
    } catch (cause) {
      if (!isCurrentScope()) return
      const message = errorMessage(cause)
      const activeTarget = Boolean(targetSessionId && isActiveTarget(targetSessionId))
      if (cleared && targetSessionId) {
        const failedSessionId = targetSessionId
        if (activeTarget && !hasAgentComposerContent(composerDraftRef.current)) {
          replaceComposerDraft(submittedDraft)
        } else {
          setFailedSubmissions((current) => [
            ...current,
            {
              draft: submittedDraft,
              id: ++failedSubmissionIdRef.current,
              message,
              sessionId: failedSessionId,
            },
          ])
        }
      }
      if (!targetSessionId || activeTarget) setError(message)
      if (targetSessionId && activeTarget) await refreshSessionState(targetSessionId).catch(() => undefined)
    } finally {
      if (targetSessionId && isCurrentScope()) setSessionPrompting(targetSessionId, false)
    }
  }, [
    contextResources,
    closeComposerSuggestion,
    closeGenerationModelPicker,
    conversationScope,
    createSession,
    embedded,
    generationCatalogVersion,
    generationConfigurationReady,
    generationTools,
    interactionDisabled,
    llmCatalog,
    llmCatalogError,
    llmCatalogLoading,
    loadLlmModels,
    props.activeCanvas,
    props.beforePrompt,
    props.conversationKey,
    props.projectId,
    refreshSessionState,
    refreshSessions,
    replaceComposerDraft,
    selectSession,
    sessionId,
    setGenerationToolSelection,
    setLlmSelection,
    setSessionPrompting,
    sharedGenerationController,
    validatedGenerationToolInput,
    validatedGenerationToolSelection,
    validatedLlmSelection,
  ])

  const abort = useCallback(async () => {
    if (!props.projectId || !sessionId || sessionScopeRef.current !== conversationScope) return
    const scopeId = props.projectId
    const scope = conversationScope
    const targetSessionId = sessionId
    if (stoppingSessionIdsRef.current.has(targetSessionId)) return
    const isCurrentScope = () =>
      mountedRef.current && activeProjectRef.current === scopeId && activeScopeRef.current === scope
    const isActiveTarget = () => isCurrentScope() && activeSessionIdRef.current === targetSessionId
    try {
      await withAgentStoppingState(
        (stopping) => setSessionStopping(targetSessionId, stopping),
        async () => {
          await window.convax.agent.abort({ scopeId, sessionId: targetSessionId })
          if (isActiveTarget()) await refreshSessionState(targetSessionId)
        },
        isCurrentScope,
      )
    } catch (cause) {
      if (isActiveTarget()) setError(errorMessage(cause))
    }
  }, [conversationScope, props.projectId, refreshSessionState, sessionId, setSessionStopping])

  const conversationTurns = useMemo(
    () => buildAgentConversationTurns(sessionState?.messages ?? []),
    [sessionState?.messages],
  )
  const latestConversationTurn = conversationTurns.at(-1)
  const compactStatus = useMemo(
    () =>
      resolveAgentCompactStatus({
        failed: Boolean(error || (latestConversationTurn && agentConversationTurnHasFailure(latestConversationTurn))),
        interaction: sessionState?.pendingPermissions.length
          ? "permission"
          : sessionState?.pendingQuestions.length
            ? "question"
            : undefined,
        pendingChanges: props.pendingChanges,
        working: runtimeBusy || responseStopping,
      }),
    [
      error,
      latestConversationTurn,
      props.pendingChanges,
      responseStopping,
      runtimeBusy,
      sessionState?.pendingPermissions.length,
      sessionState?.pendingQuestions.length,
    ],
  )
  useEffect(
    () => props.onStatusChange?.(compactStatus),
    [compactStatus.detail, compactStatus.kind, compactStatus.label, props.onStatusChange],
  )
  const failedSubmission = failedSubmissions[0]
  const failedConversationTitle = failedSubmission
    ? sessions.find((session) => session.id === failedSubmission.sessionId)?.title || "another conversation"
    : undefined
  const canRestoreFailedSubmission =
    Boolean(failedSubmission) && !interactionDisabled && !hasAgentComposerContent(composerDraft)

  if (!props.projectId) return null

  if (!embedded && !open) {
    if (props.collapsedEntry === false) return null
    return (
      <TooltipProvider>
        <aside
          aria-label="Agent status"
          className="pointer-events-none absolute right-3 top-3 z-40"
          data-agent-drawer-collapsed
        >
          <AgentDrawerTrigger onOpen={() => props.layout?.onOpenChange(true)} status={compactStatus} />
        </aside>
      </TooltipProvider>
    )
  }

  const PanelRoot = hosted ? "div" : "aside"

  return (
    <TooltipProvider>
      <PanelRoot
        className={cn(
          "agent-panel",
          hosted
            ? "relative flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden bg-surface-panel text-text-primary"
            : embedded
              ? "relative flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden bg-card text-card-foreground"
              : "relative z-40 flex shrink-0 flex-col overflow-hidden border-l border-border bg-card text-card-foreground max-[1040px]:absolute max-[1040px]:inset-y-0 max-[1040px]:right-0 max-[1040px]:shadow-2xl",
          !embedded &&
            !hosted &&
            !props.layout?.resizing &&
            "transition-[width] duration-200 ease-out motion-reduce:transition-none",
          props.className,
        )}
        data-agent-panel-hosted={hosted || undefined}
        data-agent-runtime-state={responseStopping ? "stopping" : runtimeBusy ? "running" : "idle"}
        style={embedded || hosted ? undefined : { maxWidth: props.layout?.maxWidthStyle, width: props.layout?.width }}
      >
        {!embedded && !hosted && props.layout?.resizable !== false ? (
          <div
            aria-label="Resize agent panel"
            aria-orientation="vertical"
            aria-valuemax={props.layout?.maxWidth}
            aria-valuemin={props.layout?.minWidth}
            aria-valuenow={props.layout?.width}
            className="absolute inset-y-0 -left-1 z-50 w-2 cursor-col-resize touch-none outline-none focus-visible:bg-primary/20"
            onKeyDown={props.layout?.onResizeKeyDown}
            onPointerDown={props.layout?.onResizeStart}
            role="separator"
            tabIndex={0}
          />
        ) : null}
        {!compactEmbeddedChrome ? (
          <AgentDrawerHeader
            closeLabel={props.utilityCloseLabel}
            collapse={hosted}
            createDisabled={!props.projectId || creatingSession}
            historyVisible={historyVisible}
            onClose={hosted ? props.utilityOnClose : embedded ? undefined : () => props.layout?.onOpenChange(false)}
            onCreate={() => void createSession().catch((cause) => setError(errorMessage(cause)))}
            onHistory={embedded ? undefined : () => setHistoryVisible((value) => !value)}
            restart={embedded}
            status={compactStatus}
            title={embedded ? "Agent" : props.projectName ? `${props.projectName} Agent` : "Agent"}
            toolCount={capabilities?.toolIds.length}
            utilityNavigation={hosted ? props.utilityNavigation : undefined}
          />
        ) : null}

        {!embedded && historyVisible ? (
          <ConversationHistory
            busySessionIds={promptingSessionIds}
            disabled={creatingSession}
            loading={loading}
            onSelect={(id) => {
              stickToBottomRef.current = true
              setFollowingLatest(true)
              sessionProjectRef.current = props.projectId
              sessionScopeRef.current = conversationScope
              setSessionState(undefined)
              selectSession(id)
              setHistoryVisible(false)
            }}
            selectedId={sessionId}
            sessions={sessions}
          />
        ) : (
          <>
            <div className="relative flex min-h-0 flex-1">
              <div
                className="agent-conversation-viewport flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-4 [overflow-anchor:none]"
                data-agent-conversation-viewport
                onScroll={(event) => {
                  const next = isAgentScrollNearBottom(event.currentTarget)
                  stickToBottomRef.current = next
                  setFollowingLatest(next)
                }}
                ref={scrollViewportRef}
              >
                {!props.projectId ? (
                  <EmptyState
                    icon={<Folder />}
                    title="Open a project"
                    description="The agent uses the active project as its OpenCode working directory."
                  />
                ) : loading && !sessionState ? (
                  <Loading
                    className="agent-empty-state m-auto"
                    label="Loading conversation…"
                    size="sm"
                  />
                ) : !sessionId || !conversationTurns.length ? (
                  <EmptyState
                    icon={<Sparkles />}
                    title="Start a conversation"
                    description="Ask about the project, reference content with @, or use a Skill with $."
                  />
                ) : (
                  <div className="agent-conversation-stack space-y-5">
                    {conversationTurns.map((turn, index) => (
                      <ConversationTurnView
                        awaitingInput={awaitingInteraction && index === conversationTurns.length - 1}
                        busy={runtimeBusy && index === conversationTurns.length - 1}
                        copyDisabled={runtimeBusy || responseStopping}
                        key={`${conversationScope}:${sessionId}:${turn.id}`}
                        onOpenSkill={openSkill}
                        turn={turn}
                      />
                    ))}
                  </div>
                )}
                {sessionState?.pendingPermissions.map((request) => (
                  <PermissionCard
                    key={request.id}
                    onReply={async (reply) => {
                      const scopeId = props.projectId
                      if (!scopeId) return
                      await window.convax.agent.replyPermission({ scopeId, requestId: request.id, reply })
                      if (
                        activeProjectRef.current === scopeId &&
                        activeScopeRef.current === conversationScope &&
                        activeSessionIdRef.current === request.sessionID
                      )
                        await refreshSessionState(request.sessionID)
                    }}
                    request={request}
                  />
                ))}
                {sessionState?.pendingQuestions.map((request) => (
                  <QuestionCard
                    key={request.id}
                    onReject={async () => {
                      const scopeId = props.projectId
                      if (!scopeId) return
                      await window.convax.agent.rejectQuestion({ scopeId, requestId: request.id })
                      if (
                        activeProjectRef.current === scopeId &&
                        activeScopeRef.current === conversationScope &&
                        activeSessionIdRef.current === request.sessionID
                      )
                        await refreshSessionState(request.sessionID)
                    }}
                    onReply={async (answers) => {
                      const scopeId = props.projectId
                      if (!scopeId) return
                      await window.convax.agent.replyQuestion({ answers, scopeId, requestId: request.id })
                      if (
                        activeProjectRef.current === scopeId &&
                        activeScopeRef.current === conversationScope &&
                        activeSessionIdRef.current === request.sessionID
                      )
                        await refreshSessionState(request.sessionID)
                    }}
                    request={request}
                  />
                ))}
              </div>
              {!followingLatest ? (
                <button
                  className="agent-scroll-latest absolute bottom-2 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-surface-raised px-2.5 py-1 text-[10px] text-muted-foreground shadow-[var(--ui-shadow-low)] transition-[color,transform] hover:text-foreground active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                  data-agent-scroll-latest
                  onClick={() => {
                    stickToBottomRef.current = true
                    setFollowingLatest(true)
                    const viewport = scrollViewportRef.current
                    if (viewport) viewport.scrollTop = viewport.scrollHeight
                  }}
                  type="button"
                >
                  <ChevronDown aria-hidden="true" className="size-3" />
                  Jump to latest
                </button>
              ) : null}
            </div>

            <div
              aria-live="polite"
              className="agent-runtime-status flex h-7 shrink-0 items-center px-3 text-[11px] text-muted-foreground"
              data-agent-runtime-status={responseStopping ? "stopping" : runtimeBusy ? "running" : "idle"}
            >
              <span
                className={cn(
                  "flex items-center gap-2 transition-opacity",
                  runtimeBusy || responseStopping ? "opacity-100" : "pointer-events-none opacity-0",
                )}
              >
                <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" />
                {responseStopping ? "Stopping OpenCode…" : "OpenCode is working…"}
              </span>
            </div>

            <div
              className={cn(
                "relative shrink-0 bg-card",
                compactEmbeddedChrome ? "px-3 pb-3 pt-0" : embedded ? "p-2 pt-0" : "p-3 pt-0",
              )}
            >
              {failedSubmission ? (
                <div
                  className="agent-notice mb-2 flex items-start gap-2 rounded-lg bg-status-warning-surface px-2.5 py-2 text-xs text-status-warning"
                  data-agent-notice="submission"
                >
                  <span className="min-w-0 flex-1">
                    A message in {failedConversationTitle} failed: {failedSubmission.message}
                    {failedSubmissions.length > 1 ? ` · ${failedSubmissions.length - 1} more` : ""}
                  </span>
                  <button
                    className="shrink-0 font-medium underline underline-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={!canRestoreFailedSubmission}
                    onClick={() => {
                      replaceComposerDraft(failedSubmission.draft)
                      setFailedSubmissions((current) => current.filter((item) => item.id !== failedSubmission.id))
                    }}
                    title={
                      canRestoreFailedSubmission
                        ? "Restore in the current conversation"
                        : "Finish or clear the current draft before restoring here"
                    }
                    type="button"
                  >
                    Restore here
                  </button>
                  <button
                    aria-label="Dismiss failed message"
                    onClick={() =>
                      setFailedSubmissions((current) => current.filter((item) => item.id !== failedSubmission.id))
                    }
                    type="button"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              ) : null}
              {error ? (
                <div
                  className="agent-notice mb-2 flex items-start gap-2 rounded-lg bg-status-danger-surface px-2.5 py-2 text-xs text-status-danger"
                  data-agent-notice="error"
                >
                  <span className="min-w-0 flex-1">{error}</span>
                  <button aria-label="Dismiss error" onClick={() => setError(undefined)} type="button">
                    <X className="size-3.5" />
                  </button>
                </div>
              ) : null}
              <div className="relative" ref={composerSurfaceRef}>
                {generationModelPickerOpen ? (
                  <AgentGenerationModelPicker
                    activeTab={modelPickerTab}
                    description={
                      currentGenerationDescription?.status === "ready" ? currentGenerationDescription.value : undefined
                    }
                    descriptionError={
                      currentGenerationDescription?.status === "error" ? currentGenerationDescription.error : undefined
                    }
                    descriptionLoading={Boolean(
                      validatedGenerationToolSelection &&
                        (!currentGenerationDescription || currentGenerationDescription.status === "loading"),
                    )}
                    error={generationToolsError}
                    llmCatalog={llmCatalog}
                    llmError={llmCatalogError}
                    llmLoading={llmCatalogLoading}
                    llmSelected={validatedLlmSelection}
                    loading={generationToolsLoading}
                    onClose={closeGenerationModelPicker}
                    onLlmSelect={setLlmSelection}
                    onOpenServices={() => {
                      closeGenerationModelPicker()
                      props.onOpenServices?.()
                    }}
                    onSelect={(selection) => {
                      setGenerationToolSelection(selection)
                      setGenerationToolInput({})
                    }}
                    onTabChange={(tab) => {
                      setModelPickerTab(tab)
                      if (tab === "llm" && llmCatalogError && !llmCatalogLoading) {
                        void loadLlmModels({ refreshShared: true })
                      }
                    }}
                    onToolInputChange={setGenerationToolInput}
                    selected={validatedGenerationToolSelection}
                    toolInput={generationToolInput}
                    tools={generationTools}
                  />
                ) : suggestion.open && suggestionAnchor ? (
                  <AgentComposerPicker
                    activeId={suggestion.activeId}
                    anchor={suggestionAnchor}
                    error={suggestionError}
                    loading={suggestionLoading}
                    onClose={closeComposerSuggestion}
                    onElementChange={setComposerPickerElement}
                    onHoverChange={(hoveredId) =>
                      setSuggestion((current) =>
                        current.open ? setAgentComposerSuggestionHover(current, hoveredId) : current,
                      )
                    }
                    onOpenSkill={openSkill}
                    onReferenceTabChange={changeReferenceTab}
                    onReferenceRetry={retryReferenceOption}
                    onRetry={() => {
                      if (suggestion.trigger === "skill") void loadCapabilities().catch(() => undefined)
                      else retryReferenceInventory()
                    }}
                    onSelect={selectComposerSuggestion}
                    onToggle={toggleReferenceOption}
                    options={selectableSuggestionOptions}
                    referenceTab={referenceTab}
                    referenceStatusById={referenceStatusById}
                    trigger={suggestion.trigger}
                  />
                ) : null}
                <div
                  className={cn(
                    "agent-composer-frame",
                    compactEmbeddedChrome
                      ? "bg-transparent py-2.5"
                      : "rounded-[24px] bg-surface-raised p-2 shadow-[var(--ui-shadow-low)] transition-[background-color,box-shadow] focus-within:shadow-[var(--ui-shadow-medium)]",
                    dropActive && "bg-primary/5 ring-2 ring-primary/40",
                  )}
                  data-agent-composer-surface={compactEmbeddedChrome ? "flat" : "framed"}
                  data-agent-composer-state={
                    responseStopping ? "stopping" : runtimeBusy ? "running" : dropActive ? "drop" : "idle"
                  }
                  onDragEnter={(event) => {
                    if (!supportsResourceDrop(event.dataTransfer)) return
                    containEmbeddedResourceDrag(embedded, event)
                    event.preventDefault()
                    setDropActive(true)
                  }}
                  onDragLeave={(event) => {
                    if (supportsResourceDrop(event.dataTransfer)) containEmbeddedResourceDrag(embedded, event)
                    if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget))
                      setDropActive(false)
                  }}
                  onDragOver={(event) => {
                    if (!supportsResourceDrop(event.dataTransfer)) return
                    containEmbeddedResourceDrag(embedded, event)
                    event.preventDefault()
                    event.dataTransfer.dropEffect = "copy"
                  }}
                  onDrop={handleDrop}
                >
                  {displayedResources.length > 0 ? (
                    <div className="mb-2 flex flex-wrap gap-1.5">
                      {displayedResources.map((resource) => (
                        <ResourceChip key={agentResourceKey(resource)} locked resource={resource} />
                      ))}
                    </div>
                  ) : null}
                  <div
                    aria-activedescendant={
                      activeSuggestionOption ? agentComposerPickerOptionId(activeSuggestionOption.id) : undefined
                    }
                    aria-autocomplete={suggestion.open ? "list" : undefined}
                    aria-controls={suggestion.open ? `agent-composer-${suggestion.trigger}-picker` : undefined}
                    aria-expanded={suggestion.open ? true : undefined}
                    aria-label="Message the project agent"
                    aria-multiline="true"
                    aria-placeholder={
                      props.projectId
                        ? embedded
                          ? "Ask about this context…"
                          : "Ask about this project…"
                        : "Open a project to start chatting"
                    }
                    className={cn(
                      "agent-composer-editor max-h-40 w-full overflow-y-auto whitespace-pre-wrap break-words bg-transparent px-1 text-sm leading-5 outline-none before:pointer-events-none before:text-muted-foreground data-[empty=true]:before:content-[attr(data-placeholder)] focus:data-[empty=true]:before:hidden",
                      compactEmbeddedChrome ? "min-h-20" : "min-h-10",
                      interactionDisabled && "cursor-not-allowed opacity-60",
                    )}
                    contentEditable={Boolean(props.projectId) && !interactionDisabled}
                    data-agent-composer-editor
                    data-empty={shouldShowAgentComposerPlaceholder(composerDraft, composerFocused) ? "true" : undefined}
                    data-placeholder={
                      props.projectId
                        ? embedded
                          ? "Ask about this context…"
                          : "Ask about this project…"
                        : "Open a project to start chatting"
                    }
                    onClick={(event) => {
                      if (interactionDisabled) return
                      const action =
                        event.target instanceof HTMLElement
                          ? event.target.closest<HTMLElement>(`[${agentComposerTokenActionAttribute}]`)
                          : null
                      const token = action?.closest<HTMLElement>(`[${agentComposerTokenAttribute}]`)
                      if (!action || !token) {
                        composerSelectionRef.current = captureAgentComposerSelection(event.currentTarget)
                        updateComposerQuery()
                        return
                      }
                      event.preventDefault()
                      if (action.getAttribute(agentComposerTokenActionAttribute) === "remove") {
                        removeAgentComposerToken(event.currentTarget, token)
                        closeComposerSuggestion()
                        syncComposerDraft()
                        return
                      }
                      const resource = parseAgentComposerResource(
                        token.getAttribute(agentComposerResourceAttribute) ?? "",
                      )
                      if (resource) editComposerToken(event.currentTarget, token, resource)
                    }}
                    onBlur={(event) => {
                      setComposerFocused(false)
                      const target = event.relatedTarget
                      if (
                        !(target instanceof Node) ||
                        shouldDismissAgentResourcePicker(composerSurfaceRef.current, target, composerPickerRef.current)
                      )
                        closeComposerSuggestion()
                    }}
                    onFocus={(event) => {
                      setComposerFocused(true)
                      composerSelectionRef.current = captureAgentComposerSelection(event.currentTarget)
                    }}
                    onCompositionEnd={() => {
                      compositionControllerRef.current.finish(
                        () => {
                          syncComposerDraft()
                          updateComposerQuery()
                        },
                        (callback) => {
                          const frame = window.requestAnimationFrame(callback)
                          return () => window.cancelAnimationFrame(frame)
                        },
                      )
                    }}
                    onCompositionStart={() => compositionControllerRef.current.start()}
                    onInput={(event) => {
                      repairAgentComposerInsertedTriggerSelection(event.currentTarget, event.nativeEvent as InputEvent)
                      syncComposerDraft()
                      compositionControllerRef.current.runWhenIdle(updateComposerQuery)
                    }}
                    onKeyDown={(event) => {
                      if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return
                      if (suggestion.open) {
                        if (event.key === "Tab" && suggestion.trigger === "reference") {
                          event.preventDefault()
                          changeReferenceTab(referenceTab === "project" ? "canvas" : "project")
                          return
                        }
                        if (
                          suggestion.trigger === "reference" &&
                          (event.key === "ArrowRight" || event.key === "ArrowLeft") &&
                          !event.altKey &&
                          !event.ctrlKey &&
                          !event.metaKey &&
                          !event.shiftKey
                        ) {
                          event.preventDefault()
                          const option = selectableSuggestionOptions.find(
                            (candidate) => candidate.id === suggestion.activeId && candidate.optionType === "reference",
                          )
                          const shouldToggle =
                            option?.optionType === "reference" &&
                            option.expandable &&
                            (event.key === "ArrowRight" ? !option.expanded : option.expanded)
                          if (shouldToggle && option?.optionType === "reference") {
                            toggleReferenceOption(option)
                          } else {
                            const activeId = moveAgentReferenceTreeActive(
                              visibleReferenceRows,
                              suggestion.activeId,
                              event.key === "ArrowRight" ? "child" : "parent",
                            )
                            setSuggestion((current) => (current.open ? { ...current, activeId } : current))
                          }
                          return
                        }
                        if (
                          (event.key === "ArrowDown" || event.key === "ArrowUp") &&
                          !event.altKey &&
                          !event.ctrlKey &&
                          !event.metaKey &&
                          !event.shiftKey
                        ) {
                          event.preventDefault()
                          setSuggestion((current) =>
                            current.open
                              ? moveAgentComposerSuggestion(
                                  current,
                                  event.key === "ArrowDown" ? 1 : -1,
                                  selectableSuggestionOptions,
                                )
                              : current,
                          )
                          return
                        }
                        if (event.key === "Escape") {
                          event.preventDefault()
                          closeComposerSuggestion()
                          return
                        }
                        if (event.key === "Enter" && !event.shiftKey) {
                          event.preventDefault()
                          const option = resolveAgentComposerSuggestionOption(suggestion, selectableSuggestionOptions)
                          if (option) selectComposerSuggestion(option)
                          return
                        }
                      }
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault()
                        void send()
                      }
                    }}
                    onKeyUp={(event) => {
                      composerSelectionRef.current = captureAgentComposerSelection(event.currentTarget)
                      if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
                        compositionControllerRef.current.runWhenIdle(updateComposerQuery)
                    }}
                    onPaste={(event) => {
                      event.preventDefault()
                      insertAgentComposerPlainText(event.currentTarget, event.clipboardData.getData("text/plain"))
                      syncComposerDraft()
                      updateComposerQuery()
                    }}
                    ref={composerRef}
                    role={suggestion.open ? "combobox" : "textbox"}
                    suppressContentEditableWarning
                  />
                  <div className="agent-composer-toolbar flex items-center gap-0.5 pt-1">
                    <Tooltip content="Reference Project or Canvas content">
                      <Button
                        aria-controls="agent-composer-reference-picker"
                        aria-expanded={suggestion.open && suggestion.trigger === "reference"}
                        aria-label="Reference Project or Canvas content"
                        data-agent-composer-action="reference"
                        disabled={!props.projectId || interactionDisabled}
                        onClick={() => insertComposerQueryTrigger("@")}
                        onPointerDown={(event) => {
                          event.preventDefault()
                          if (composerRef.current)
                            composerSelectionRef.current = captureAgentComposerSelection(composerRef.current)
                        }}
                        size="icon-sm"
                        variant={suggestion.open && suggestion.trigger === "reference" ? "secondary" : "ghost"}
                      >
                        <AtSign />
                      </Button>
                    </Tooltip>
                    <Tooltip content="Use a Skill">
                      <Button
                        aria-controls="agent-composer-skill-picker"
                        aria-expanded={suggestion.open && suggestion.trigger === "skill"}
                        aria-label="Use a Skill"
                        data-agent-composer-action="skill"
                        disabled={!props.projectId || interactionDisabled}
                        onClick={() => insertComposerQueryTrigger("$")}
                        onPointerDown={(event) => {
                          event.preventDefault()
                          if (composerRef.current)
                            composerSelectionRef.current = captureAgentComposerSelection(composerRef.current)
                        }}
                        size="icon-sm"
                        variant={suggestion.open && suggestion.trigger === "skill" ? "secondary" : "ghost"}
                      >
                        <Sparkles />
                      </Button>
                    </Tooltip>
                    <button
                      aria-expanded={generationModelPickerOpen}
                      aria-haspopup="dialog"
                      aria-label={`Select Agent models, ${displayedModelLabel}`}
                      className="agent-composer-model flex min-w-0 max-w-[70%] items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-muted-foreground outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50"
                      data-agent-composer-action="model"
                      disabled={!props.projectId || interactionDisabled}
                      onClick={() => {
                        if (generationModelPickerOpen) {
                          closeGenerationModelPicker()
                          return
                        }
                        closeComposerSuggestion()
                        setGenerationModelPickerOpen(true)
                        if (generationToolsError) void loadGenerationTools()
                        if (modelPickerTab === "llm" && llmCatalogError && !llmCatalogLoading) {
                          void loadLlmModels({ refreshShared: true })
                        }
                      }}
                      type="button"
                    >
                      <Sparkles className="size-3.5 shrink-0" />
                      <span className="shrink-0 font-medium text-foreground">Agent models</span>
                      <span className="truncate">{displayedModelLabel}</span>
                      <ChevronDown className="size-3 shrink-0" />
                    </button>
                    {compactEmbeddedChrome ? (
                      <>
                        <Tooltip content="Restart conversation for this context">
                          <Button
                            aria-label="Restart embedded conversation"
                            disabled={!props.projectId || creatingSession}
                            onClick={() => void createSession().catch((cause) => setError(errorMessage(cause)))}
                            size="icon-sm"
                            variant="ghost"
                          >
                            <Plus />
                          </Button>
                        </Tooltip>
                      </>
                    ) : null}
                    <span className="min-w-0 flex-1" />
                    {runtimeBusy || responseStopping ? (
                      <Tooltip content={responseStopping ? "Stopping…" : "Stop"}>
                        <Button
                          aria-label={responseStopping ? "Stopping response" : "Stop response"}
                          disabled={responseStopping}
                          onClick={() => void abort()}
                          size="icon-sm"
                          variant="outline"
                        >
                          {responseStopping ? (
                            <LoaderCircle className="animate-spin motion-reduce:animate-none" />
                          ) : (
                            <Square className="fill-current" />
                          )}
                        </Button>
                      </Tooltip>
                    ) : (
                      <Tooltip content={validatedLlmSelection ? "Send" : "Choose an LLM model in Services"}>
                        <Button
                          aria-label="Send message"
                          disabled={
                            !props.projectId ||
                            interactionDisabled ||
                            !generationConfigurationReady ||
                            (!hasAgentComposerContent(composerDraft) && displayedResources.length === 0)
                          }
                          onClick={() => void send()}
                          size="icon-sm"
                        >
                          <Send />
                        </Button>
                      </Tooltip>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </PanelRoot>
    </TooltipProvider>
  )
})

function ConversationHistory(props: {
  busySessionIds: ReadonlySet<string>
  disabled: boolean
  loading: boolean
  onSelect: (id: string) => void
  selectedId?: string
  sessions: AgentSession[]
}) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-2">
      <div className="px-2 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        Conversation history
      </div>
      {props.loading && props.sessions.length === 0 ? (
        <Loading className="p-4" label="Loading…" size="sm" tone="muted" />
      ) : null}
      {props.sessions.length === 0 && !props.loading ? (
        <div className="p-4 text-xs text-muted-foreground">No conversations yet.</div>
      ) : null}
      {props.sessions.map((session) => (
        <button
          className={cn(
            "mb-1 flex w-full items-start gap-2 rounded-md px-2.5 py-2 text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:opacity-60",
            session.id === props.selectedId && "bg-accent text-accent-foreground",
          )}
          disabled={props.disabled}
          key={session.id}
          onClick={() => props.onSelect(session.id)}
          type="button"
        >
          {props.busySessionIds.has(session.id) ? (
            <LoadingSpinner className="mt-0.5 shrink-0 text-primary" size="sm" />
          ) : (
            <MessageSquare className="mt-0.5 size-3.5 shrink-0" />
          )}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-medium">{session.title || "New conversation"}</span>
            <span className="mt-0.5 block text-[10px] text-muted-foreground">
              {new Date(session.updatedAt).toLocaleString()}
            </span>
          </span>
          <ChevronRight className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
        </button>
      ))}
    </div>
  )
}

function EmptyState(props: { description: string; icon: React.ReactNode; title: string }) {
  return (
    <div className="agent-empty-state m-auto max-w-64 text-center" data-agent-empty-state>
      <div className="agent-empty-state__icon mx-auto mb-3 grid size-9 place-items-center rounded-full bg-accent text-primary [&_svg]:size-4">
        {props.icon}
      </div>
      <div className="text-sm font-medium">{props.title}</div>
      <div className="mt-1.5 text-xs leading-5 text-muted-foreground">{props.description}</div>
    </div>
  )
}

export function ConversationTurnView(props: {
  awaitingInput?: boolean
  busy: boolean
  copyDisabled?: boolean
  onOpenSkill: (name: string) => Promise<void>
  turn: AgentConversationTurn
}) {
  const turnState = props.awaitingInput
    ? "awaiting-input"
    : props.busy
      ? "running"
      : agentConversationTurnHasFailure(props.turn)
        ? "failed"
        : props.turn.interrupted
          ? "cancelled"
          : "completed"
  return (
    <section
      className="agent-conversation-turn space-y-3"
      data-agent-conversation-turn
      data-agent-turn-state={turnState}
    >
      <AgentResponseAnnouncer busy={props.busy} delivery={props.turn.delivery} />
      {props.turn.user ? <MessageSliceView onOpenSkill={props.onOpenSkill} slice={props.turn.user} user /> : null}
      {props.turn.activity.length ? (
        <AgentActivitySummary awaitingInput={props.awaitingInput} busy={props.busy} turn={props.turn}>
          {props.turn.activity.flatMap((slice) =>
            slice.parts.map((part) => (
              <MessagePartView
                interrupted={props.turn.interrupted && !props.busy}
                key={`${slice.message.id}:${part.id}`}
                onOpenSkill={props.onOpenSkill}
                part={part}
              />
            )),
          )}
        </AgentActivitySummary>
      ) : null}
      {props.turn.delivery ? (
        <MessageSliceView
          busy={props.busy}
          copyDisabled={props.copyDisabled}
          key={props.turn.delivery.message.id}
          onOpenSkill={props.onOpenSkill}
          slice={props.turn.delivery}
        />
      ) : null}
      {props.turn.errors.map((entry) => (
        <div
          className="agent-notice rounded-lg bg-status-danger-surface px-2.5 py-2 text-xs text-status-danger"
          data-agent-notice="turn-error"
          key={`${entry.message.id}:${entry.text}`}
        >
          {entry.text}
        </div>
      ))}
    </section>
  )
}

function MessageSliceView(props: {
  busy?: boolean
  copyDisabled?: boolean
  onOpenSkill: (name: string) => Promise<void>
  slice: { message: AgentMessage; parts: AgentMessage["parts"] }
  user?: boolean
}) {
  const [copyStatus, setCopyStatus] = useState<"copied" | "copying" | "failed" | "idle">("idle")
  const copyRequestRef = useRef(0)
  const copyText = agentConversationCopyText(props.slice)
  const canCopy = Boolean(
    !props.user && props.slice.message.completedAt !== undefined && !props.busy && !props.copyDisabled && copyText,
  )
  useEffect(() => {
    copyRequestRef.current += 1
    setCopyStatus("idle")
  }, [copyText, props.busy, props.copyDisabled, props.slice.message.id, props.slice.message.sessionId])
  useEffect(
    () => () => {
      copyRequestRef.current += 1
    },
    [],
  )
  const copyResponse = async () => {
    const request = ++copyRequestRef.current
    setCopyStatus("copying")
    try {
      if (!window.navigator.clipboard?.writeText) throw new Error("Clipboard is unavailable")
      await window.navigator.clipboard.writeText(copyText)
      if (copyRequestRef.current === request) setCopyStatus("copied")
    } catch {
      if (copyRequestRef.current === request) setCopyStatus("failed")
    }
  }

  return (
    <article
      aria-busy={props.user ? undefined : Boolean(props.busy)}
      className={cn("agent-message flex", props.user ? "justify-end" : "justify-start")}
      data-agent-message={props.user ? "user" : "assistant"}
    >
      <div
        className={cn(
          "agent-message__surface min-w-0 max-w-[92%] space-y-2 text-sm",
          props.user
            ? "rounded-[18px] rounded-br-md bg-accent px-3 py-2 text-accent-foreground"
            : "w-full text-foreground",
        )}
      >
        {!props.user ? (
          <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            <Bot className="size-3" />
            Agent
          </div>
        ) : null}
        {props.slice.parts.map((part) => (
          <MessagePartView key={part.id} onOpenSkill={props.onOpenSkill} part={part} />
        ))}
        {canCopy ? (
          <div
            className="agent-message-actions flex items-center gap-2 pt-1 text-[11px] text-muted-foreground"
            data-agent-message-actions
          >
            <Tooltip content={copyStatus === "copied" ? "Copied" : "Copy response"}>
              <Button
                aria-label={copyStatus === "copied" ? "Response copied" : "Copy response"}
                disabled={copyStatus === "copying"}
                onClick={() => void copyResponse()}
                size="icon-sm"
                variant="ghost"
              >
                {copyStatus === "copied" ? <Check /> : <Copy />}
              </Button>
            </Tooltip>
            {copyStatus === "copied" ? (
              <span aria-live="polite" data-agent-copy-status role="status">
                Copied
              </span>
            ) : copyStatus === "failed" ? (
              <span aria-live="polite" className="text-status-danger" data-agent-copy-status role="status">
                Couldn’t copy. Select the response text and copy it manually.
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
    </article>
  )
}

function AgentResponseAnnouncer(props: { busy: boolean; delivery?: AgentConversationTurn["delivery"] }) {
  const state = agentConversationAnnouncementState(props.delivery, props.busy)
  const previousRef = useRef<AgentConversationAnnouncementState | undefined>(undefined)
  const [announcement, setAnnouncement] = useState("")

  useEffect(() => {
    const nextAnnouncement = resolveAgentConversationAnnouncement(previousRef.current, state)
    previousRef.current = state
    if (nextAnnouncement) setAnnouncement(nextAnnouncement)
  }, [state.busy, state.completed, state.messageId, state.text])

  return (
    <span aria-atomic="true" aria-live="polite" className="sr-only" data-agent-response-announcer role="status">
      {announcement}
    </span>
  )
}

type AgentToolPart = Extract<AgentMessage["parts"][number], { type: "tool" }>

function agentToolTitle(part: AgentToolPart) {
  return "title" in part.state && part.state.title ? part.state.title : part.tool
}

function agentToolLooksLikeRead(part: AgentToolPart) {
  return /\b(read|find|glob|grep|list|search)\b/i.test(`${part.tool} ${agentToolTitle(part)}`)
}

function agentToolDetail(part: AgentToolPart, resultDetail: string | undefined) {
  if (resultDetail?.trim()) return resultDetail
  if (Object.keys(part.state.input).length === 0) return undefined
  try {
    return JSON.stringify(part.state.input, null, 2)
  } catch {
    return "Tool input could not be displayed"
  }
}

export function MessagePartView({
  interrupted,
  onOpenSkill,
  part,
}: {
  interrupted?: boolean
  onOpenSkill: (name: string) => Promise<void>
  part: AgentMessage["parts"][number]
}) {
  if (part.type === "skill") return <SkillBadge name={part.name} onOpen={() => onOpenSkill(part.name)} />
  if (part.type === "text") return part.synthetic ? null : <AgentMarkdown text={part.text} />
  if (part.type === "reasoning")
    return (
      <div className="flex items-start gap-2 px-1 py-1">
        <BookOpen className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 whitespace-pre-wrap leading-5">{part.text}</div>
      </div>
    )
  if (part.type === "file")
    return (
      <div className="inline-flex max-w-full items-center gap-1.5 rounded-md bg-surface-inset px-2 py-1 text-xs">
        <FileText className="size-3.5" />
        <span className="truncate">{part.filename ?? "File"}</span>
      </div>
    )
  if (part.type === "tool") {
    const presentation = getAgentToolPresentation(part, { interrupted })
    const title = agentToolTitle(part)
    const detail = agentToolDetail(part, presentation.detail)
    const ToolIcon = agentToolLooksLikeRead(part) ? BookOpen : SquareTerminal
    const statusLabel =
      presentation.outcome === "pending"
        ? "Queued"
        : presentation.outcome === "running"
          ? "Running"
          : presentation.outcome === "success"
            ? "Completed"
            : presentation.outcome === "cancelled"
              ? "Cancelled"
              : "Failed"
    const statusIcon =
      presentation.outcome === "running" ? (
        <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin motion-reduce:animate-none" />
      ) : presentation.outcome === "pending" || presentation.outcome === "cancelled" ? (
        <Square aria-hidden="true" className="size-3" />
      ) : presentation.outcome === "failure" ? (
        <X aria-hidden="true" className="size-3.5" />
      ) : (
        <Check aria-hidden="true" className="size-3.5" />
      )
    const row = (
      <>
        <span className="agent-tool-call__status-icon" data-state={presentation.outcome}>
          {statusIcon}
        </span>
        <ToolIcon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-medium text-text-secondary">{title}</span>
        <span className="agent-tool-call__status" data-state={presentation.outcome}>
          {statusLabel}
        </span>
        {detail ? (
          <ChevronRight
            aria-hidden="true"
            className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open/tool:rotate-90 motion-reduce:transition-none"
          />
        ) : null}
      </>
    )
    if (!detail)
      return (
        <div
          className="agent-tool-call agent-tool-call--static"
          data-agent-tool-call
          data-agent-tool-state={presentation.outcome}
        >
          <div className="agent-tool-call__summary">{row}</div>
        </div>
      )
    return (
      <details className="agent-tool-call group/tool" data-agent-tool-call data-agent-tool-state={presentation.outcome}>
        <summary className="agent-tool-call__summary cursor-pointer list-none outline-none focus-visible:ring-2 focus-visible:ring-ring/30 [&::-webkit-details-marker]:hidden">
          {row}
        </summary>
        <div className="agent-tool-call__detail">
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-4">
            {detail}
          </pre>
        </div>
      </details>
    )
  }
  return null
}

function SkillBadge(props: { name: string; onOpen: () => Promise<void> }) {
  return (
    <button
      className="agent-skill-badge inline-flex max-w-full items-center gap-1 rounded-md bg-primary/10 px-1.5 py-1 text-xs font-medium text-primary hover:bg-primary/15"
      onClick={() => void props.onOpen()}
      title={`Open ${props.name} Skill`}
      type="button"
    >
      <Sparkles className="size-3" />
      <span className="truncate">{props.name}</span>
      <ExternalLink className="size-3 opacity-65" />
    </button>
  )
}

function ResourceChip(props: { locked?: boolean; onRemove?: () => void; resource: AgentResource }) {
  const icon =
    props.resource.kind === "directory" ? (
      <Folder />
    ) : isAgentCanvasResource(props.resource) ? (
      <PanelsTopLeft />
    ) : props.resource.kind === "skill" ? (
      <Sparkles />
    ) : (
      <FileText />
    )
  return (
    <span className="agent-resource-chip inline-flex min-w-0 max-w-full items-center gap-1 rounded-md bg-surface-inset px-1.5 py-1 text-[11px]">
      <span className="text-primary [&_svg]:size-3">{icon}</span>
      <span className="max-w-40 truncate">{resourceLabel(props.resource)}</span>
      {props.locked ? <span className="rounded bg-primary/10 px-1 text-[9px] text-primary">context</span> : null}
      {props.onRemove ? (
        <button
          aria-label={`Remove ${resourceLabel(props.resource)}`}
          className="rounded hover:bg-background"
          onClick={props.onRemove}
          type="button"
        >
          <X className="size-3" />
        </button>
      ) : null}
    </span>
  )
}

function PermissionCard(props: {
  onReply: (reply: "always" | "once" | "reject") => Promise<unknown>
  request: AgentPermissionRequest
}) {
  const [replying, setReplying] = useState(false)
  const [replyError, setReplyError] = useState<string>()
  const reply = async (value: "always" | "once" | "reject") => {
    setReplying(true)
    setReplyError(undefined)
    try {
      await props.onReply(value)
    } catch (cause) {
      setReplyError(errorMessage(cause))
    } finally {
      setReplying(false)
    }
  }
  return (
    <div
      className="agent-interaction-card mt-3 rounded-xl bg-surface-raised p-3 text-xs shadow-[var(--ui-shadow-low)]"
      data-agent-interaction-card="permission"
    >
      <div className="flex items-center gap-2 font-medium">
        <ShieldAlert className="size-4 text-status-warning" />
        Permission required
      </div>
      <div className="mt-2 text-muted-foreground">
        OpenCode wants permission to <span className="font-medium text-foreground">{props.request.permission}</span>.
      </div>
      {props.request.patterns.length ? (
        <div className="mt-1 break-all font-mono text-[10px] text-muted-foreground">
          {props.request.patterns.join(", ")}
        </div>
      ) : null}
      {props.request.always.length ? (
        <div className="mt-2 rounded-md bg-surface-inset p-2 text-[10px] text-muted-foreground">
          <span className="font-semibold text-foreground">Always allow scope: </span>
          <span className="break-all font-mono">{props.request.always.join(", ")}</span>
        </div>
      ) : null}
      {replyError ? <div className="mt-2 text-destructive">{replyError}</div> : null}
      <div className="mt-3 flex flex-wrap gap-1.5">
        <Button disabled={replying} onClick={() => void reply("once")} size="sm">
          Allow once
        </Button>
        {props.request.always.length ? (
          <Button disabled={replying} onClick={() => void reply("always")} size="sm" variant="outline">
            Always allow
          </Button>
        ) : null}
        <Button disabled={replying} onClick={() => void reply("reject")} size="sm" variant="ghost">
          Deny
        </Button>
      </div>
    </div>
  )
}

function QuestionCard(props: {
  onReject: () => Promise<unknown>
  onReply: (answers: string[][]) => Promise<unknown>
  request: AgentQuestionRequest
}) {
  const [answers, setAnswers] = useState<string[][]>(() => props.request.questions.map(() => []))
  const [customAnswers, setCustomAnswers] = useState<string[]>(() => props.request.questions.map(() => ""))
  const [replying, setReplying] = useState(false)
  const [replyError, setReplyError] = useState<string>()
  const resolvedAnswers = answers.map((answer, index) => {
    const custom = customAnswers[index]?.trim()
    return custom ? [...answer, custom] : answer
  })
  const update = (index: number, value: string, multiple = false) => {
    if (!multiple)
      setCustomAnswers((current) => current.map((answer, answerIndex) => (answerIndex === index ? "" : answer)))
    setAnswers((current) =>
      current.map((answer, answerIndex) => {
        if (answerIndex !== index) return answer
        if (!multiple) return [value]
        return answer.includes(value) ? answer.filter((item) => item !== value) : [...answer, value]
      }),
    )
  }
  const updateCustom = (index: number, value: string, multiple = false) => {
    setCustomAnswers((current) => current.map((answer, answerIndex) => (answerIndex === index ? value : answer)))
    if (!multiple && value)
      setAnswers((current) => current.map((answer, answerIndex) => (answerIndex === index ? [] : answer)))
  }
  const submit = async () => {
    setReplying(true)
    setReplyError(undefined)
    try {
      await props.onReply(resolvedAnswers)
    } catch (cause) {
      setReplyError(errorMessage(cause))
    } finally {
      setReplying(false)
    }
  }
  const reject = async () => {
    setReplying(true)
    setReplyError(undefined)
    try {
      await props.onReject()
    } catch (cause) {
      setReplyError(errorMessage(cause))
    } finally {
      setReplying(false)
    }
  }
  return (
    <div
      className="agent-interaction-card mt-3 rounded-xl bg-surface-raised p-3 text-xs shadow-[var(--ui-shadow-low)]"
      data-agent-interaction-card="question"
    >
      {props.request.questions.map((question, index) => (
        <div className={cn(index > 0 && "mt-4 pt-1")} key={`${props.request.id}:${index}`}>
          <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-primary">{question.header}</div>
          <div className="mt-1 font-medium">{question.question}</div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {question.options.map((option) => {
              const selected = answers[index]?.includes(option.label)
              return (
                <button
                  className={cn(
                    "rounded-md bg-surface-inset px-2 py-1.5 text-left outline-none transition-[background-color,color,transform] hover:bg-muted active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-ring/40",
                    selected && "bg-accent text-accent-foreground ring-1 ring-primary/45",
                  )}
                  key={option.label}
                  onClick={() => update(index, option.label, question.multiple)}
                  title={option.description}
                  type="button"
                >
                  {option.label}
                </button>
              )
            })}
          </div>
          {question.custom ? (
            <input
              className="mt-2 h-8 w-full rounded-md bg-surface-inset px-2 outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              onChange={(event) => updateCustom(index, event.currentTarget.value, question.multiple)}
              placeholder="Type another answer"
              value={customAnswers[index] ?? ""}
            />
          ) : null}
        </div>
      ))}
      {replyError ? <div className="mt-2 text-destructive">{replyError}</div> : null}
      <div className="mt-3 flex gap-1.5">
        <Button
          disabled={replying || resolvedAnswers.some((answer) => answer.length === 0)}
          onClick={() => void submit()}
          size="sm"
        >
          Submit
        </Button>
        <Button disabled={replying} onClick={() => void reject()} size="sm" variant="ghost">
          Cancel
        </Button>
      </div>
    </div>
  )
}
