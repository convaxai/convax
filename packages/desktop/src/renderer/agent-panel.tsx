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
import { parseProjectCanvasDrag, PROJECT_CANVAS_DRAG_TYPE, type ProjectCanvas } from "@convax/project/canvas"
import { Button, cn, createToolInputDefaultValues, Tooltip, TooltipProvider, validateToolInputValues } from "@convax/ui"
import type {
  GenerationToolDescription,
  GenerationToolInput,
  GenerationToolInputValue,
  GenerationToolSummary,
} from "../generation-contracts"
import {
  AtSign,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileText,
  Folder,
  History,
  ListTree,
  LoaderCircle,
  MessageSquare,
  PanelsTopLeft,
  Plus,
  Send,
  ShieldAlert,
  Sparkles,
  Square,
  Wrench,
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
} from "react"
import { isAgentCanvasResource, shouldFlushAgentCanvasContext } from "../agent-canvas-context"
import { AgentGenerationModelPicker, type AgentModelPickerTab } from "./agent-generation-model-picker"
import {
  AgentGenerationCatalogRequestTracker,
  createAgentPromptInstructions,
  findAgentGenerationTool,
  isAgentGenerationOutput,
  reconcileAgentGenerationToolSelection,
  type AgentGenerationToolSelection,
} from "./agent-generation-models"
import {
  agentSessionContentKey,
  AgentSessionStateRequestTracker,
  agentResourceKey,
  canvasAgentResource,
  containEmbeddedResourceDrag,
  embeddedConversationTitle,
  embeddedConversationSessions,
  filterStandaloneAgentSessions,
  forgetStaleEmbeddedConversation,
  isAgentScrollNearBottom,
  mergeAgentResources,
  selectAgentSessionAfterRefresh,
} from "./agent-panel-state"
import {
  AgentComposerCompositionController,
  AgentComposerRequestTracker,
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
  replaceAgentComposerQuery,
  replaceAgentComposerToken,
  writeAgentComposerDraft,
  type AgentComposerQueryRange,
} from "./agent-composer-dom"
import {
  AgentComposerPicker,
  agentComposerPickerOptionId,
  type AgentComposerPickerAnchor,
  type AgentComposerPickerOption,
} from "./agent-composer-picker"
import { AgentMarkdown } from "./agent-markdown"
import { useAgentGenerationPreference } from "./agent-generation-preference"
import { findAgentLlmModel, reconcileAgentLlmModelSelection, type AgentLlmModelSelection } from "./agent-llm-models"
import { buildAgentConversationTurns, type AgentConversationTurn } from "./agent-conversation-presentation"
import { getAgentToolPresentation } from "./agent-tool-presentation"

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
  const target = rect.width || rect.height ? rect : fallback
  const width = Math.min(352, Math.max(240, window.innerWidth - 16))
  const left = Math.max(8, Math.min(target.left, window.innerWidth - width - 8))
  const top = target.top >= 240 ? Math.max(8, target.top - 324) : Math.min(target.bottom + 6, window.innerHeight - 328)
  return { left, top: Math.max(8, top) }
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
  resizing: boolean
  width: number
}

export interface AgentPanelProps {
  activeCanvas?: Pick<ProjectCanvas, "id" | "name">
  beforePrompt?: () => Promise<void>
  canvases: ProjectCanvas[]
  className?: string
  contextResources?: readonly AgentResource[]
  conversationKey?: string
  embedded?: boolean
  embeddedHeader?: boolean
  generationCatalogVersion?: string
  layout?: AgentPanelLayout
  projectId?: string
  projectName?: string
}

export interface AgentPanelHandle {
  addResources(resources: readonly AgentResource[]): void
}

export const AgentPanel = forwardRef<AgentPanelHandle, AgentPanelProps>(function AgentPanel(props, ref) {
  const embedded = props.embedded === true
  const compactEmbeddedChrome = embedded && props.embeddedHeader === false
  const sharedGenerationPreference = useAgentGenerationPreference()
  const sharedGenerationSelection = sharedGenerationPreference?.selection
  const setSharedGenerationSelection = sharedGenerationPreference?.setSelection
  const sharedLlmSelection = sharedGenerationPreference?.llmSelection
  const setSharedLlmSelection = sharedGenerationPreference?.setLlmSelection
  const generationCatalogVersion = props.generationCatalogVersion ?? ""
  const generationCatalogScope = JSON.stringify([props.projectId ?? null, generationCatalogVersion])
  const conversationScope = JSON.stringify([
    props.projectId ?? null,
    embedded ? "embedded" : "panel",
    embedded ? (props.conversationKey ?? null) : null,
  ])
  const contextResources = mergeAgentResources(props.contextResources ?? [])
  const open = embedded || props.layout?.open === true
  const [historyVisible, setHistoryVisible] = useState(false)
  const [showActivity, setShowActivity] = useState(false)
  const [suggestion, setSuggestion] = useState<AgentComposerSuggestionState>({ open: false })
  const [suggestionQuery, setSuggestionQuery] = useState("")
  const [referenceTab, setReferenceTab] = useState<"canvas" | "project">("project")
  const [suggestionAnchor, setSuggestionAnchor] = useState<AgentComposerPickerAnchor>()
  const [generationModelPickerOpen, setGenerationModelPickerOpen] = useState(false)
  const [modelPickerTab, setModelPickerTab] = useState<AgentModelPickerTab>("image")
  const [generationTools, setGenerationTools] = useState<readonly GenerationToolSummary[]>([])
  const [generationToolsLoading, setGenerationToolsLoading] = useState(false)
  const [generationToolsError, setGenerationToolsError] = useState<string>()
  const [localGenerationToolSelection, setLocalGenerationToolSelection] = useState<AgentGenerationToolSelection>()
  const generationToolSelection = sharedGenerationPreference ? sharedGenerationSelection : localGenerationToolSelection
  const setGenerationToolSelection = useCallback(
    (selection?: AgentGenerationToolSelection) => {
      if (setSharedGenerationSelection) setSharedGenerationSelection(selection)
      else setLocalGenerationToolSelection(selection)
    },
    [setSharedGenerationSelection],
  )
  const [llmCatalog, setLlmCatalog] = useState<AgentModelCatalog>()
  const [llmCatalogLoading, setLlmCatalogLoading] = useState(false)
  const [llmCatalogError, setLlmCatalogError] = useState<string>()
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
  const [composerDraft, setComposerDraft] = useState<AgentComposerDraft>(emptyAgentComposerDraft)
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
  const [promptingSessionIds, setPromptingSessionIds] = useState<Set<string>>(() => new Set())
  const [failedSubmissions, setFailedSubmissions] = useState<FailedAgentSubmission[]>([])
  const [creatingSession, setCreatingSession] = useState(false)
  const [followingLatest, setFollowingLatest] = useState(true)
  const [error, setError] = useState<string>()
  const [composerFocusRequest, setComposerFocusRequest] = useState(0)
  const composerRef = useRef<HTMLDivElement>(null)
  const pendingComposerFocusRef = useRef(false)
  const composerSurfaceRef = useRef<HTMLDivElement>(null)
  const composerDraftRef = useRef(composerDraft)
  const composerQueryRangeRef = useRef<AgentComposerQueryRange | undefined>(undefined)
  const composerSelectionRef = useRef<Range | undefined>(undefined)
  const editingTokenRef = useRef<HTMLElement | undefined>(undefined)
  const scrollViewportRef = useRef<HTMLDivElement>(null)
  const stickToBottomRef = useRef(true)
  const activeSessionIdRef = useRef(sessionId)
  const promptingSessionIdsRef = useRef(promptingSessionIds)
  const failedSubmissionIdRef = useRef(0)
  const sessionStateRequestRef = useRef(new AgentSessionStateRequestTracker())
  const sessionListRequestRef = useRef(0)
  const activeProjectRef = useRef(props.projectId)
  const activeScopeRef = useRef(conversationScope)
  const capabilitiesRequestRef = useRef<Promise<AgentCapabilities> | undefined>(undefined)
  const compositionControllerRef = useRef(new AgentComposerCompositionController())
  const requestTrackerRef = useRef(new AgentComposerRequestTracker())
  const generationCatalogRequestRef = useRef(new AgentGenerationCatalogRequestTracker())
  const generationDescriptionRequestRef = useRef(new AgentGenerationCatalogRequestTracker())
  const llmCatalogRequestRef = useRef(new AgentGenerationCatalogRequestTracker())
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
  generationCatalogVersionRef.current = generationCatalogVersion
  generationToolSelectionRef.current = generationToolSelection
  llmSelectionRef.current = llmSelection

  const selectedGenerationTool = findAgentGenerationTool(generationToolSelection, generationTools)
  const validatedGenerationToolSelection =
    selectedGenerationTool && isAgentGenerationOutput(selectedGenerationTool.output)
      ? { id: selectedGenerationTool.id, output: selectedGenerationTool.output }
      : undefined
  const generationDescriptionScope = selectedGenerationTool
    ? JSON.stringify([generationCatalogScope, selectedGenerationTool.id])
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

  const selectSession = useCallback((nextSessionId?: string) => {
    activeSessionIdRef.current = nextSessionId
    setSessionId(nextSessionId)
  }, [])

  useEffect(() => {
    if (generationToolSelection) setModelPickerTab(generationToolSelection.output)
    else if (llmSelection) setModelPickerTab("llm")
  }, [generationToolSelection?.id, generationToolSelection?.output, llmSelection?.modelId, llmSelection?.providerId])

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
  }, [generationCatalogScope, props.projectId, setGenerationToolSelection])

  const loadLlmModels = useCallback(() => {
    const scopeId = props.projectId
    const isLatest = llmCatalogRequestRef.current.begin(props.projectId ?? "")
    setLlmCatalog(undefined)
    setLlmCatalogError(undefined)
    if (!scopeId) {
      setLlmCatalogLoading(false)
      return Promise.resolve<AgentModelCatalog>({ providers: [] })
    }
    setLlmCatalogLoading(true)
    return window.convax.agent
      .listModels({ scopeId })
      .then((catalog) => {
        if (!mountedRef.current || activeProjectRef.current !== scopeId || !isLatest()) return catalog
        setLlmCatalog(catalog)
        const current = llmSelectionRef.current
        const reconciled = reconcileAgentLlmModelSelection(current, catalog)
        if (current?.providerId !== reconciled?.providerId || current?.modelId !== reconciled?.modelId) {
          setLlmSelection(reconciled)
        }
        return catalog
      })
      .catch((cause) => {
        if (mountedRef.current && activeProjectRef.current === scopeId && isLatest()) {
          setLlmCatalogError(errorMessage(cause))
        }
        return { providers: [] }
      })
      .finally(() => {
        if (mountedRef.current && activeProjectRef.current === scopeId && isLatest()) {
          setLlmCatalogLoading(false)
        }
      })
  }, [props.projectId, setLlmSelection])

  useEffect(() => {
    void loadGenerationTools()
    return () => generationCatalogRequestRef.current.invalidate()
  }, [loadGenerationTools])

  useEffect(() => {
    setGenerationToolInput({})
    if (!props.projectId || !selectedGenerationTool || !generationDescriptionScope) {
      generationDescriptionRequestRef.current.invalidate()
      setGenerationDescription({ scope: "", status: "loading" })
      return undefined
    }
    const scopeId = props.projectId
    const selected = selectedGenerationTool
    const isLatest = generationDescriptionRequestRef.current.begin(generationDescriptionScope)
    setGenerationDescription({ scope: generationDescriptionScope, status: "loading" })
    void window.convax.generation.describeTool({ scopeId, toolId: selected.id }).then(
      (result) => {
        if (!mountedRef.current || activeProjectRef.current !== scopeId || !isLatest()) return
        if (result.toolId !== selected.id) {
          setGenerationDescription({
            error: "The generation model returned a stale configuration.",
            scope: generationDescriptionScope,
            status: "error",
          })
          return
        }
        setGenerationToolInput(createToolInputDefaultValues(result.fields))
        setGenerationDescription({ scope: generationDescriptionScope, status: "ready", value: result })
      },
      (cause) => {
        if (mountedRef.current && activeProjectRef.current === scopeId && isLatest()) {
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
  }, [generationDescriptionScope, props.projectId, selectedGenerationTool])

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
    replaceComposerDraft(emptyAgentComposerDraft())
    promptingSessionIdsRef.current = new Set()
    setPromptingSessionIds(new Set())
    setFailedSubmissions([])
    stickToBottomRef.current = true
    setFollowingLatest(true)
    setError(undefined)
    setCapabilitiesLoading(false)
    setLoading(false)
  }, [conversationScope, replaceComposerDraft, selectSession])

  useEffect(() => {
    if (embedded || !open || !props.projectId) {
      setLoading(false)
      return
    }
    const scopeId = props.projectId
    const scope = conversationScope
    let stale = false
    const request = ++sessionListRequestRef.current
    setLoading(true)
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
        if (!stale) setLoading(false)
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
  const awaitingInteraction = Boolean(sessionState?.pendingPermissions.length || sessionState?.pendingQuestions.length)
  const interactionDisabled = runtimeBusy || loading || creatingSession
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
  }, [historyVisible, open, runtimeBusy, sessionContentKey, showActivity])

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
        const document = snapshot.document
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
        await window.convax.agent.skills.openSkill({ name, scopeId: props.projectId })
      } catch (cause) {
        if (mountedRef.current) setError(errorMessage(cause))
      }
    },
    [props.projectId],
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
    }),
    [addResources, props.layout?.onOpenChange, props.projectId],
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
      if (!(target instanceof Node) || shouldDismissAgentResourcePicker(composerSurfaceRef.current, target))
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
        const listed = await window.convax.generation.listTools({ scopeId })
        if (!isCurrentScope()) return
        if (generationCatalogVersionRef.current !== submittedCatalogVersion) {
          throw new Error("Installed generation models changed. Review the model selection and send again.")
        }
        verifiedGenerationTools = listed.filter((tool) => isAgentGenerationOutput(tool.output))
        setGenerationTools(verifiedGenerationTools)
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
          throw new Error("The selected generation model is no longer installed. Choose another model or Auto.")
        }
      }
      if (submittedLlmSelection) {
        const catalog = await window.convax.agent.listModels({ scopeId })
        if (!isCurrentScope()) return
        setLlmCatalog(catalog)
        verifiedLlmSelection = reconcileAgentLlmModelSelection(submittedLlmSelection, catalog)
        if (
          llmSelectionRef.current?.providerId !== verifiedLlmSelection?.providerId ||
          llmSelectionRef.current?.modelId !== verifiedLlmSelection?.modelId
        ) {
          setLlmSelection(verifiedLlmSelection)
        }
        if (!verifiedLlmSelection) {
          throw new Error("The selected LLM model is no longer connected. Choose another model or Auto.")
        }
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
    validatedGenerationToolInput,
    validatedGenerationToolSelection,
  ])

  const abort = useCallback(async () => {
    if (!props.projectId || !sessionId || sessionScopeRef.current !== conversationScope) return
    const scopeId = props.projectId
    const scope = conversationScope
    const targetSessionId = sessionId
    const isActiveTarget = () =>
      mountedRef.current &&
      activeProjectRef.current === scopeId &&
      activeScopeRef.current === scope &&
      activeSessionIdRef.current === targetSessionId
    try {
      await window.convax.agent.abort({ scopeId, sessionId: targetSessionId })
      if (isActiveTarget()) await refreshSessionState(targetSessionId)
    } catch (cause) {
      if (isActiveTarget()) setError(errorMessage(cause))
    }
  }, [conversationScope, props.projectId, refreshSessionState, sessionId])

  const conversationTurns = useMemo(
    () => buildAgentConversationTurns(sessionState?.messages ?? []),
    [sessionState?.messages],
  )
  const failedSubmission = failedSubmissions[0]
  const failedConversationTitle = failedSubmission
    ? sessions.find((session) => session.id === failedSubmission.sessionId)?.title || "another conversation"
    : undefined
  const canRestoreFailedSubmission =
    Boolean(failedSubmission) && !interactionDisabled && !hasAgentComposerContent(composerDraft)

  if (!props.projectId) return null

  if (!embedded && !open) {
    return (
      <TooltipProvider>
        <aside
          className="relative z-40 flex shrink-0 flex-col items-center overflow-hidden border-l border-border bg-card py-2 transition-[width] duration-200 ease-out motion-reduce:transition-none max-[1040px]:absolute max-[1040px]:inset-y-0 max-[1040px]:right-0"
          style={{ width: props.layout?.collapsedWidth }}
        >
          <Tooltip content="Open agent">
            <Button
              aria-label="Open agent"
              onClick={() => props.layout?.onOpenChange(true)}
              size="icon-sm"
              variant="ghost"
            >
              <Bot />
            </Button>
          </Tooltip>
          <div className="mt-2 h-px w-5 bg-border" />
          <span className="mt-3 [writing-mode:vertical-rl] text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Agent
          </span>
        </aside>
      </TooltipProvider>
    )
  }

  return (
    <TooltipProvider>
      <aside
        className={cn(
          embedded
            ? "relative flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden bg-card text-card-foreground"
            : "relative z-40 flex shrink-0 flex-col overflow-hidden border-l border-border bg-card text-card-foreground max-[1040px]:absolute max-[1040px]:inset-y-0 max-[1040px]:right-0 max-[1040px]:shadow-2xl",
          !embedded &&
            !props.layout?.resizing &&
            "transition-[width] duration-200 ease-out motion-reduce:transition-none",
          props.className,
        )}
        style={embedded ? undefined : { maxWidth: props.layout?.maxWidthStyle, width: props.layout?.width }}
      >
        {!embedded ? (
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
          <header
            className={cn("flex shrink-0 items-center gap-1 border-b border-border px-2", embedded ? "h-9" : "h-11")}
          >
            <Bot className="ml-1 size-4 text-primary" />
            <span className={cn("min-w-0 flex-1 truncate font-semibold", embedded ? "text-xs" : "text-sm")}>
              {embedded ? "Agent" : props.projectName ? `${props.projectName} Agent` : "Agent"}
            </span>
            {capabilities ? (
              <span className="mr-1 text-[10px] text-muted-foreground">{capabilities.toolIds.length} tools</span>
            ) : null}
            <Tooltip content={showActivity ? "Hide activity" : "Show activity"}>
              <Button
                aria-label={showActivity ? "Hide agent activity" : "Show agent activity"}
                onClick={() => setShowActivity((value) => !value)}
                size="icon-sm"
                variant={showActivity ? "secondary" : "ghost"}
              >
                <ListTree />
              </Button>
            </Tooltip>
            {!embedded ? (
              <Tooltip content="Conversation history">
                <Button
                  aria-label="Conversation history"
                  onClick={() => setHistoryVisible((value) => !value)}
                  size="icon-sm"
                  variant={historyVisible ? "secondary" : "ghost"}
                >
                  <History />
                </Button>
              </Tooltip>
            ) : null}
            <Tooltip content={embedded ? "Restart conversation for this context" : "New conversation"}>
              <Button
                aria-label={embedded ? "Restart embedded conversation" : "New conversation"}
                disabled={!props.projectId || creatingSession}
                onClick={() => void createSession().catch((cause) => setError(errorMessage(cause)))}
                size="icon-sm"
                variant="ghost"
              >
                <Plus />
              </Button>
            </Tooltip>
            {!embedded ? (
              <Tooltip content="Close agent">
                <Button
                  aria-label="Close agent"
                  onClick={() => props.layout?.onOpenChange(false)}
                  size="icon-sm"
                  variant="ghost"
                >
                  <ChevronRight />
                </Button>
              </Tooltip>
            ) : null}
          </header>
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
                className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-4 [overflow-anchor:none]"
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
                  <div className="m-auto flex items-center gap-2 text-xs text-muted-foreground">
                    <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />
                    Loading conversation…
                  </div>
                ) : !sessionId || !conversationTurns.length ? (
                  <EmptyState
                    icon={<Sparkles />}
                    title="Start a conversation"
                    description="Ask about the project, reference content with @, or use a Skill with $."
                  />
                ) : (
                  <div className="space-y-5">
                    {conversationTurns.map((turn, index) => (
                      <ConversationTurnView
                        awaitingInput={awaitingInteraction && index === conversationTurns.length - 1}
                        busy={runtimeBusy && index === conversationTurns.length - 1}
                        key={turn.id}
                        onOpenSkill={openSkill}
                        onShowActivity={() => setShowActivity(true)}
                        showActivity={showActivity}
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
                  className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full border border-border/70 bg-card px-2.5 py-1 text-[10px] text-muted-foreground shadow-md hover:text-foreground"
                  onClick={() => {
                    stickToBottomRef.current = true
                    setFollowingLatest(true)
                    const viewport = scrollViewportRef.current
                    if (viewport) viewport.scrollTop = viewport.scrollHeight
                  }}
                  type="button"
                >
                  Jump to latest
                </button>
              ) : null}
            </div>

            <div aria-live="polite" className="flex h-7 shrink-0 items-center px-3 text-[11px] text-muted-foreground">
              <span
                className={cn(
                  "flex items-center gap-2 transition-opacity",
                  runtimeBusy ? "opacity-100" : "pointer-events-none opacity-0",
                )}
              >
                <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" />
                OpenCode is working…
              </span>
            </div>

            <div
              className={cn(
                "relative shrink-0 bg-card",
                compactEmbeddedChrome ? "px-3 pb-3 pt-0" : embedded ? "p-2 pt-0" : "p-3 pt-0",
              )}
            >
              {failedSubmission ? (
                <div className="mb-2 flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-2.5 py-2 text-xs text-amber-800 dark:text-amber-300">
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
                <div className="mb-2 flex items-start gap-2 rounded-md border border-destructive/25 bg-destructive/5 px-2.5 py-2 text-xs text-destructive">
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
                    onSelect={(selection) => {
                      setGenerationToolSelection(selection)
                      setGenerationToolInput({})
                    }}
                    onTabChange={(tab) => {
                      setModelPickerTab(tab)
                      if (tab === "llm" && (!llmCatalog || llmCatalogError)) void loadLlmModels()
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
                    compactEmbeddedChrome
                      ? "bg-transparent py-2.5"
                      : "rounded-2xl border border-border/60 bg-card p-2.5 shadow-lg shadow-black/5 transition-[border-color,box-shadow] focus-within:border-ring/60 focus-within:shadow-xl focus-within:shadow-black/[0.07]",
                    dropActive && "rounded-2xl border border-primary bg-primary/5 ring-2 ring-primary/15",
                  )}
                  data-agent-composer-surface={compactEmbeddedChrome ? "flat" : "framed"}
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
                      "max-h-40 w-full overflow-y-auto whitespace-pre-wrap break-words bg-transparent px-1 text-sm leading-5 outline-none before:pointer-events-none before:text-muted-foreground data-[empty=true]:before:content-[attr(data-placeholder)] focus:data-[empty=true]:before:hidden",
                      compactEmbeddedChrome ? "min-h-24" : embedded ? "min-h-12" : "min-h-16",
                      interactionDisabled && "cursor-not-allowed opacity-60",
                    )}
                    contentEditable={Boolean(props.projectId) && !interactionDisabled}
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
                        shouldDismissAgentResourcePicker(composerSurfaceRef.current, target)
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
                    onInput={() => {
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
                      if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) updateComposerQuery()
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
                  <div className="flex items-center gap-1 pt-1">
                    <Tooltip content="Reference Project or Canvas content">
                      <Button
                        aria-controls="agent-composer-reference-picker"
                        aria-expanded={suggestion.open && suggestion.trigger === "reference"}
                        aria-label="Reference Project or Canvas content"
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
                      aria-label={`Select models, ${selectedGenerationTool?.title ?? selectedLlmModel?.model.modelName ?? "Auto"}`}
                      className="flex min-w-0 max-w-[70%] items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-muted-foreground outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={!props.projectId || interactionDisabled}
                      onClick={() => {
                        if (generationModelPickerOpen) {
                          closeGenerationModelPicker()
                          return
                        }
                        closeComposerSuggestion()
                        setGenerationModelPickerOpen(true)
                        if (generationToolsError) void loadGenerationTools()
                        if (modelPickerTab === "llm" && (!llmCatalog || llmCatalogError)) void loadLlmModels()
                      }}
                      type="button"
                    >
                      <Sparkles className="size-3.5 shrink-0" />
                      <span className="shrink-0 font-medium text-foreground">Models</span>
                      <span className="truncate">
                        {selectedGenerationTool?.title ?? selectedLlmModel?.model.modelName ?? "Auto"}
                      </span>
                      <ChevronDown className="size-3 shrink-0" />
                    </button>
                    {compactEmbeddedChrome ? (
                      <>
                        <Tooltip content={showActivity ? "Hide activity" : "Show activity"}>
                          <Button
                            aria-label={showActivity ? "Hide agent activity" : "Show agent activity"}
                            onClick={() => setShowActivity((value) => !value)}
                            size="icon-sm"
                            variant={showActivity ? "secondary" : "ghost"}
                          >
                            <ListTree />
                          </Button>
                        </Tooltip>
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
                    {runtimeBusy ? (
                      <Tooltip content="Stop">
                        <Button
                          aria-label="Stop response"
                          onClick={() => void abort()}
                          size="icon-sm"
                          variant="outline"
                        >
                          <Square className="fill-current" />
                        </Button>
                      </Tooltip>
                    ) : (
                      <Tooltip content="Send">
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
      </aside>
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
        <div className="p-4 text-xs text-muted-foreground">Loading…</div>
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
            <LoaderCircle className="mt-0.5 size-3.5 shrink-0 animate-spin text-primary motion-reduce:animate-none" />
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
    <div className="m-auto max-w-64 text-center">
      <div className="mx-auto mb-3 grid size-9 place-items-center rounded-full bg-accent text-primary [&_svg]:size-4">
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
  onOpenSkill: (name: string) => Promise<void>
  onShowActivity: () => void
  showActivity: boolean
  turn: AgentConversationTurn
}) {
  return (
    <section className="space-y-3">
      {props.turn.user ? <MessageSliceView onOpenSkill={props.onOpenSkill} slice={props.turn.user} user /> : null}
      {props.showActivity && props.turn.activity.length ? (
        <AgentActivity
          awaitingInput={props.awaitingInput}
          busy={props.busy}
          onOpenSkill={props.onOpenSkill}
          turn={props.turn}
        />
      ) : null}
      {props.turn.delivery && !props.busy ? (
        <MessageSliceView onOpenSkill={props.onOpenSkill} slice={props.turn.delivery} />
      ) : null}
      {!props.awaitingInput &&
      !props.busy &&
      !props.showActivity &&
      (props.turn.interrupted || props.turn.tools.failed > 0) ? (
        <AgentActivityNotice
          failed={props.turn.tools.failed}
          interrupted={props.turn.interrupted}
          onShowActivity={props.onShowActivity}
        />
      ) : null}
      {props.turn.errors.map((entry) => (
        <div
          className="rounded-md border border-destructive/25 bg-destructive/5 p-2 text-xs text-destructive"
          key={`${entry.message.id}:${entry.text}`}
        >
          {entry.text}
        </div>
      ))}
    </section>
  )
}

export function AgentActivityNotice(props: { failed: number; interrupted?: boolean; onShowActivity: () => void }) {
  return (
    <button
      className={cn(
        "w-full rounded-md border p-2 text-left text-xs",
        props.interrupted
          ? "border-amber-500/30 bg-amber-500/5 text-amber-800 hover:bg-amber-500/10 dark:text-amber-300"
          : "border-destructive/25 bg-destructive/5 text-destructive hover:bg-destructive/10",
      )}
      onClick={props.onShowActivity}
      type="button"
    >
      {props.interrupted ? "Earlier run was interrupted" : null}
      {props.interrupted && props.failed ? " · " : null}
      {props.failed ? `${props.failed} tool ${props.failed === 1 ? "call failed" : "calls failed"}` : null}. Show
      activity for details.
    </button>
  )
}

function MessageSliceView(props: {
  onOpenSkill: (name: string) => Promise<void>
  slice: { message: AgentMessage; parts: AgentMessage["parts"] }
  user?: boolean
}) {
  return (
    <article className={cn("flex", props.user ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "min-w-0 max-w-[92%] space-y-2 text-sm",
          props.user ? "rounded-xl bg-accent px-3 py-2 text-accent-foreground" : "w-full",
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
      </div>
    </article>
  )
}

function AgentActivity(props: {
  awaitingInput?: boolean
  busy: boolean
  onOpenSkill: (name: string) => Promise<void>
  turn: AgentConversationTurn
}) {
  const tools = props.turn.tools.count
  const label = props.busy
    ? "Working"
    : props.awaitingInput
      ? "Waiting for your response"
      : props.turn.interrupted
        ? "Interrupted activity"
        : props.turn.tools.failed
          ? "Activity completed with errors"
          : "Activity"
  return (
    <div className="rounded-lg border border-border/60 bg-muted/25 px-2.5 py-2 text-xs" data-agent-activity>
      <div className="flex items-center gap-2 text-muted-foreground">
        {props.busy ? (
          <LoaderCircle className="size-3.5 animate-spin text-primary motion-reduce:animate-none" />
        ) : props.awaitingInput || props.turn.interrupted ? (
          <ShieldAlert className="size-3.5 text-amber-600" />
        ) : props.turn.tools.outcome === "failure" ? (
          <X className="size-3.5 text-destructive" />
        ) : (
          <Check className="size-3.5 text-emerald-600" />
        )}
        <span className="min-w-0 flex-1">
          {label}
          {tools ? ` · ${tools} tool${tools === 1 ? "" : "s"}` : ""}
        </span>
      </div>
      <div className="mt-2 space-y-2 border-t border-border/60 pt-2">
        {props.turn.activity.flatMap((slice) =>
          slice.parts.map((part) => (
            <MessagePartView key={`${slice.message.id}:${part.id}`} onOpenSkill={props.onOpenSkill} part={part} />
          )),
        )}
      </div>
    </div>
  )
}

export function MessagePartView({
  onOpenSkill,
  part,
}: {
  onOpenSkill: (name: string) => Promise<void>
  part: AgentMessage["parts"][number]
}) {
  if (part.type === "skill") return <SkillBadge name={part.name} onOpen={() => onOpenSkill(part.name)} />
  if (part.type === "text") return part.synthetic ? null : <AgentMarkdown text={part.text} />
  if (part.type === "reasoning")
    return (
      <details className="rounded-md border border-border bg-muted/35 px-2.5 py-2 text-xs">
        <summary className="cursor-pointer text-muted-foreground">Reasoning</summary>
        <div className="mt-2 whitespace-pre-wrap leading-5">{part.text}</div>
      </details>
    )
  if (part.type === "file")
    return (
      <div className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs">
        <FileText className="size-3.5" />
        <span className="truncate">{part.filename ?? "File"}</span>
      </div>
    )
  if (part.type === "tool") {
    const state = part.state
    const presentation = getAgentToolPresentation(part)
    const pending = presentation.outcome === "pending" || presentation.outcome === "running"
    return (
      <details className="rounded-md border border-border bg-muted/35 px-2.5 py-2 text-xs" data-agent-tool-call>
        <summary className="flex cursor-pointer list-none items-center gap-2">
          {pending ? (
            <LoaderCircle className="size-3.5 animate-spin text-primary" />
          ) : presentation.outcome === "success" ? (
            <Check className="size-3.5 text-emerald-600" />
          ) : (
            <X className="size-3.5 text-destructive" />
          )}
          <Wrench className="size-3.5 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate">{"title" in state && state.title ? state.title : part.tool}</span>
          <ChevronDown className="size-3.5 text-muted-foreground" />
        </summary>
        {presentation.detail ? (
          <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words border-t border-border pt-2 font-mono text-[11px] leading-4">
            {presentation.detail}
          </pre>
        ) : null}
      </details>
    )
  }
  return null
}

function SkillBadge(props: { name: string; onOpen: () => Promise<void> }) {
  return (
    <button
      className="inline-flex max-w-full items-center gap-1 rounded-md bg-primary/10 px-1.5 py-1 text-xs font-medium text-primary hover:bg-primary/15"
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
    <span className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-md border border-border bg-muted/60 px-1.5 py-1 text-[11px]">
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
    <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs">
      <div className="flex items-center gap-2 font-medium">
        <ShieldAlert className="size-4 text-amber-600" />
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
        <div className="mt-2 rounded border border-amber-500/20 bg-background/70 p-2 text-[10px] text-muted-foreground">
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
    <div className="mt-3 rounded-lg border border-primary/25 bg-primary/5 p-3 text-xs">
      {props.request.questions.map((question, index) => (
        <div className={cn(index > 0 && "mt-3 border-t border-border pt-3")} key={`${props.request.id}:${index}`}>
          <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-primary">{question.header}</div>
          <div className="mt-1 font-medium">{question.question}</div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {question.options.map((option) => {
              const selected = answers[index]?.includes(option.label)
              return (
                <button
                  className={cn(
                    "rounded-md border border-border bg-background px-2 py-1.5 text-left hover:bg-muted",
                    selected && "border-primary bg-accent text-accent-foreground",
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
              className="mt-2 h-8 w-full rounded-md border border-input bg-background px-2 outline-none focus:border-ring"
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
