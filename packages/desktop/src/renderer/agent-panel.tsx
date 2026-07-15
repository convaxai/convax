import type {
  AgentCapabilities,
  AgentMessage,
  AgentPermissionRequest,
  AgentQuestionRequest,
  AgentResource,
  AgentSession,
  AgentSessionState,
} from "@convax/agent-runtime"
import {
  parseProjectCanvasDrag,
  parseProjectEntryDrag,
  PROJECT_CANVAS_DRAG_TYPE,
  PROJECT_ENTRY_DRAG_TYPE,
  type ProjectCanvas,
} from "@convax/project"
import { Button, cn, Tooltip, TooltipProvider } from "@convax/ui"
import {
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  History,
  LoaderCircle,
  MessageSquare,
  PanelsTopLeft,
  Paperclip,
  Plus,
  Send,
  ShieldAlert,
  Sparkles,
  Square,
  Wrench,
  X,
} from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { getAgentToolPresentation } from "./agent-tool-presentation"

const resourceDragType = "application/x-convax-agent-resource"
const panelOpenKey = "convax:agent-panel:open"
const panelWidthKey = "convax:agent-panel:width"
const defaultPanelWidth = 380
const minimumPanelWidth = 300
const maximumPanelWidth = 620

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function resourceKey(resource: AgentResource) {
  if (resource.kind === "skill") return `skill:${resource.name}`
  if (resource.kind === "canvas") return `canvas:${resource.canvasId}`
  return `${resource.kind}:${resource.path}`
}

function resourceLabel(resource: AgentResource) {
  if (resource.name) return resource.name
  if (resource.kind === "skill") return resource.name
  if (resource.kind === "canvas") return resource.canvasId
  return resource.path.split("/").at(-1) || resource.path
}

function appendResources(current: AgentResource[], added: readonly AgentResource[]) {
  const existing = new Set(current.map(resourceKey))
  return [...current, ...added.filter((resource) => {
    const key = resourceKey(resource)
    if (existing.has(key)) return false
    existing.add(key)
    return true
  })]
}

function serializeResource(resource: AgentResource) {
  return JSON.stringify({ resource, version: 1 })
}

function parseResource(value: string): AgentResource | null {
  try {
    const parsed = JSON.parse(value) as { resource?: AgentResource; version?: number }
    if (parsed.version !== 1 || !parsed.resource) return null
    const resource = parsed.resource
    if (resource.kind === "skill") return typeof resource.name === "string" ? { kind: "skill", name: resource.name } : null
    if (!(["canvas", "directory", "file"] as string[]).includes(resource.kind)) return null
    if (resource.kind === "canvas") {
      return typeof resource.canvasId === "string"
        ? { canvasId: resource.canvasId, kind: "canvas", name: resource.name }
        : null
    }
    if (typeof resource.path !== "string") return null
    if (resource.kind === "directory") return { kind: "directory", path: resource.path, name: resource.name }
    if (resource.kind === "file") return { kind: "file", path: resource.path, name: resource.name }
    return null
  } catch {
    return null
  }
}

function supportsResourceDrop(dataTransfer: DataTransfer) {
  const types = Array.from(dataTransfer.types)
  return types.includes(PROJECT_ENTRY_DRAG_TYPE)
    || types.includes(PROJECT_CANVAS_DRAG_TYPE)
    || types.includes(resourceDragType)
}

function initialPanelOpen() {
  return localStorage.getItem(panelOpenKey) !== "false"
}

function initialPanelWidth() {
  const value = Number(localStorage.getItem(panelWidthKey))
  return Number.isFinite(value) ? Math.min(maximumPanelWidth, Math.max(minimumPanelWidth, value)) : defaultPanelWidth
}

export function AgentPanel(props: {
  activeCanvas?: Pick<ProjectCanvas, "id" | "name">
  beforePrompt?: () => Promise<void>
  canvases: ProjectCanvas[]
  projectId?: string
  projectName?: string
}) {
  const [open, setOpenState] = useState(initialPanelOpen)
  const [width, setWidth] = useState(initialPanelWidth)
  const [historyVisible, setHistoryVisible] = useState(false)
  const [resourcePickerOpen, setResourcePickerOpen] = useState(false)
  const [dropActive, setDropActive] = useState(false)
  const [draft, setDraft] = useState("")
  const [resources, setResources] = useState<AgentResource[]>([])
  const [sessions, setSessions] = useState<AgentSession[]>([])
  const [sessionId, setSessionId] = useState<string>()
  const [sessionState, setSessionState] = useState<AgentSessionState>()
  const [capabilities, setCapabilities] = useState<AgentCapabilities>()
  const [capabilitiesLoading, setCapabilitiesLoading] = useState(false)
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [creatingSession, setCreatingSession] = useState(false)
  const [error, setError] = useState<string>()
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const stickToBottomRef = useRef(true)
  const activeRequestRef = useRef(0)
  const sessionListRequestRef = useRef(0)
  const activeProjectRef = useRef(props.projectId)
  const creatingSessionRef = useRef(false)
  const sessionProjectRef = useRef<string | undefined>(undefined)
  activeProjectRef.current = props.projectId

  const setOpen = useCallback((next: boolean) => {
    setOpenState(next)
    localStorage.setItem(panelOpenKey, String(next))
  }, [])

  const refreshSessions = useCallback(async (preferredSessionId?: string) => {
    if (!props.projectId) return []
    const projectId = props.projectId
    const request = ++sessionListRequestRef.current
    const result = await window.convax.agent.listSessions({ projectId, limit: 60 })
    if (activeProjectRef.current !== projectId || request !== sessionListRequestRef.current) return result
    setSessions(result)
    const selected = preferredSessionId && result.some((session) => session.id === preferredSessionId)
      ? preferredSessionId
      : result[0]?.id
    sessionProjectRef.current = projectId
    setSessionId(selected)
    return result
  }, [props.projectId])

  const refreshSessionState = useCallback(async (targetSessionId = sessionId) => {
    if (!props.projectId || !targetSessionId) {
      setSessionState(undefined)
      return
    }
    const request = ++activeRequestRef.current
    const projectId = props.projectId
    const result = await window.convax.agent.getSessionState({
      projectId,
      sessionId: targetSessionId,
      limit: 200,
    })
    if (request === activeRequestRef.current && activeProjectRef.current === projectId) setSessionState(result)
  }, [props.projectId, sessionId])

  useEffect(() => {
    activeRequestRef.current += 1
    sessionListRequestRef.current += 1
    sessionProjectRef.current = undefined
    setSessions([])
    setSessionId(undefined)
    setSessionState(undefined)
    setCapabilities(undefined)
    setHistoryVisible(false)
    setResourcePickerOpen(false)
    setDropActive(false)
    setResources([])
    setDraft("")
    setSending(false)
    setError(undefined)
    setCapabilitiesLoading(false)
    setLoading(false)
  }, [props.projectId])

  useEffect(() => {
    if (!open || !props.projectId) {
      setLoading(false)
      return
    }
    let stale = false
    const request = ++sessionListRequestRef.current
    setLoading(true)
    void window.convax.agent.listSessions({ projectId: props.projectId, limit: 60 }).then((result) => {
      if (stale || request !== sessionListRequestRef.current) return
      setSessions(result)
      sessionProjectRef.current = props.projectId
      setSessionId(result[0]?.id)
    }).catch((cause) => {
      if (!stale) setError(errorMessage(cause))
    }).finally(() => {
      if (!stale) setLoading(false)
    })
    return () => { stale = true }
  }, [open, props.projectId])

  useEffect(() => {
    if (!props.projectId || !sessionId || sessionProjectRef.current !== props.projectId) {
      setSessionState(undefined)
      return
    }
    const projectId = props.projectId
    let stale = false
    setLoading(true)
    void refreshSessionState(sessionId).catch((cause) => {
      if (!stale && activeProjectRef.current === projectId) setError(errorMessage(cause))
    }).finally(() => {
      if (!stale && activeProjectRef.current === projectId) setLoading(false)
    })
    return () => { stale = true }
  }, [props.projectId, refreshSessionState, sessionId])

  const runtimeBusy = sending || sessionState?.status.type === "busy" || sessionState?.status.type === "retry"
  const interactionDisabled = runtimeBusy || loading || creatingSession
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
    if (stickToBottomRef.current) messagesEndRef.current?.scrollIntoView({ block: "end" })
  }, [sending, sessionState?.messages, sessionState?.pendingPermissions, sessionState?.pendingQuestions])

  const addResources = useCallback((next: readonly AgentResource[]) => {
    setResources((current) => appendResources(current, next))
    setResourcePickerOpen(false)
  }, [])

  const handleDrop = useCallback((event: React.DragEvent) => {
    if (!supportsResourceDrop(event.dataTransfer)) return
    event.preventDefault()
    setDropActive(false)
    if (!props.projectId) return
    const projectEntries = parseProjectEntryDrag(event.dataTransfer.getData(PROJECT_ENTRY_DRAG_TYPE))
    if (projectEntries?.projectId === props.projectId) {
      addResources(projectEntries.entries.map((entry) => ({
        kind: entry.kind,
        name: entry.name,
        path: entry.path,
      })))
      return
    }
    const projectCanvas = parseProjectCanvasDrag(event.dataTransfer.getData(PROJECT_CANVAS_DRAG_TYPE))
    if (projectCanvas?.projectId === props.projectId) {
      addResources([{
        canvasId: projectCanvas.canvas.id,
        kind: "canvas",
        name: projectCanvas.canvas.name,
      }])
      return
    }
    const resource = parseResource(event.dataTransfer.getData(resourceDragType))
    if (resource) addResources([resource])
  }, [addResources, props.projectId])

  const createSession = useCallback(async () => {
    if (!props.projectId || creatingSessionRef.current) return undefined
    const projectId = props.projectId
    creatingSessionRef.current = true
    setCreatingSession(true)
    setError(undefined)
    try {
      const session = await window.convax.agent.createSession({ projectId })
      if (activeProjectRef.current !== projectId) return undefined
      activeRequestRef.current += 1
      sessionListRequestRef.current += 1
      setSessions((current) => [session, ...current.filter((item) => item.id !== session.id)])
      sessionProjectRef.current = projectId
      setSessionId(session.id)
      setSessionState(undefined)
      setHistoryVisible(false)
      return session
    } finally {
      creatingSessionRef.current = false
      setCreatingSession(false)
    }
  }, [props.projectId])

  const send = useCallback(async () => {
    const text = draft.trim()
    if (!props.projectId || interactionDisabled || (!text && resources.length === 0)) return
    const projectId = props.projectId
    const submittedResources = resources
    const submittedDraft = draft
    const submittedActiveCanvas = props.activeCanvas
    let cleared = false
    let targetSessionId = sessionId
    setError(undefined)
    setSending(true)
    try {
      if (!targetSessionId) targetSessionId = (await createSession())?.id
      if (!targetSessionId || activeProjectRef.current !== projectId) return
      if (submittedActiveCanvas || submittedResources.some((resource) => resource.kind === "canvas")) {
        await props.beforePrompt?.()
      }
      if (activeProjectRef.current !== projectId) return
      setDraft("")
      setResources([])
      stickToBottomRef.current = true
      cleared = true
      await window.convax.agent.prompt({
        activeCanvas: submittedActiveCanvas
          ? { canvasId: submittedActiveCanvas.id, name: submittedActiveCanvas.name }
          : undefined,
        projectId,
        resources: submittedResources,
        sessionId: targetSessionId,
        text,
      })
      if (activeProjectRef.current !== projectId) return
      await Promise.all([refreshSessionState(targetSessionId), refreshSessions(targetSessionId)])
    } catch (cause) {
      if (activeProjectRef.current !== projectId) return
      if (cleared) {
        setDraft((current) => current || submittedDraft)
        setResources((current) => appendResources(current, submittedResources))
      }
      setError(errorMessage(cause))
      if (targetSessionId) await refreshSessionState(targetSessionId).catch(() => undefined)
    } finally {
      if (activeProjectRef.current === projectId) setSending(false)
    }
  }, [createSession, draft, interactionDisabled, props.activeCanvas, props.beforePrompt, props.projectId, refreshSessionState, refreshSessions, resources, sessionId])

  const abort = useCallback(async () => {
    if (!props.projectId || !sessionId) return
    try {
      await window.convax.agent.abort({ projectId: props.projectId, sessionId })
      await refreshSessionState(sessionId)
    } catch (cause) {
      setError(errorMessage(cause))
    }
  }, [props.projectId, refreshSessionState, sessionId])

  const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    const startX = event.clientX
    const startWidth = width
    const move = (moveEvent: PointerEvent) => {
      const available = Math.max(minimumPanelWidth, window.innerWidth - 520)
      const next = Math.min(maximumPanelWidth, available, Math.max(220, startWidth + startX - moveEvent.clientX))
      setWidth(next)
    }
    const finish = () => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", finish)
      setWidth((current) => {
        if (current < 260) {
          setOpen(false)
          return defaultPanelWidth
        }
        const next = Math.max(minimumPanelWidth, current)
        localStorage.setItem(panelWidthKey, String(next))
        return next
      })
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", finish, { once: true })
  }

  if (!props.projectId) return null

  if (!open) {
    return (
      <TooltipProvider>
        <aside className="relative z-40 flex w-11 shrink-0 flex-col items-center border-l border-border bg-card py-2 max-[1040px]:absolute max-[1040px]:inset-y-0 max-[1040px]:right-0">
          <Tooltip content="Open agent">
            <Button aria-label="Open agent" onClick={() => setOpen(true)} size="icon-sm" variant="ghost"><Bot /></Button>
          </Tooltip>
          <div className="mt-2 h-px w-5 bg-border" />
          <span className="mt-3 [writing-mode:vertical-rl] text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Agent</span>
        </aside>
      </TooltipProvider>
    )
  }

  return (
    <TooltipProvider>
      <aside
        className="relative z-40 flex shrink-0 flex-col border-l border-border bg-card text-card-foreground max-[1040px]:absolute max-[1040px]:inset-y-0 max-[1040px]:right-0 max-[1040px]:shadow-2xl"
        style={{ maxWidth: "calc(100vw - 96px)", width }}
      >
        <div aria-label="Resize agent panel" className="absolute inset-y-0 -left-1 z-50 w-2 cursor-col-resize" onPointerDown={startResize} role="separator" />
        <header className="flex h-11 shrink-0 items-center gap-1 border-b border-border px-2">
          <Bot className="ml-1 size-4 text-primary" />
          <span className="min-w-0 flex-1 truncate text-sm font-semibold">{props.projectName ? `${props.projectName} Agent` : "Agent"}</span>
          {capabilities ? <span className="mr-1 text-[10px] text-muted-foreground">{capabilities.toolIds.length} tools</span> : null}
          <Tooltip content="Conversation history"><Button aria-label="Conversation history" onClick={() => setHistoryVisible((value) => !value)} size="icon-sm" variant={historyVisible ? "secondary" : "ghost"}><History /></Button></Tooltip>
          <Tooltip content="New conversation"><Button aria-label="New conversation" disabled={!props.projectId || interactionDisabled} onClick={() => void createSession().catch((cause) => setError(errorMessage(cause)))} size="icon-sm" variant="ghost"><Plus /></Button></Tooltip>
          <Tooltip content="Close agent"><Button aria-label="Close agent" onClick={() => setOpen(false)} size="icon-sm" variant="ghost"><ChevronRight /></Button></Tooltip>
        </header>

        {historyVisible ? (
          <ConversationHistory
            disabled={interactionDisabled}
            loading={loading}
            onSelect={(id) => {
              activeRequestRef.current += 1
              stickToBottomRef.current = true
              sessionProjectRef.current = props.projectId
              setSessionState(undefined)
              setSessionId(id)
              setHistoryVisible(false)
            }}
            selectedId={sessionId}
            sessions={sessions}
          />
        ) : (
          <>
            <div
              className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-4"
              onScroll={(event) => {
                const element = event.currentTarget
                stickToBottomRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80
              }}
            >
              {!props.projectId ? (
                <EmptyState icon={<Folder />} title="Open a project" description="The agent uses the active project as its OpenCode working directory." />
              ) : loading && !sessionState ? (
                <div className="m-auto flex items-center gap-2 text-xs text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />Loading conversation…</div>
              ) : !sessionId || !sessionState?.messages.length ? (
                <EmptyState icon={<Sparkles />} title="Start a conversation" description="Ask about the project, attach a canvas, or drag files, folders, and skills below." />
              ) : (
                <div className="space-y-4">
                  {sessionState.messages.map((message) => <MessageView key={message.id} message={message} />)}
                </div>
              )}
              {sessionState?.pendingPermissions.map((request) => (
                <PermissionCard
                  key={request.id}
                  onReply={(reply) => props.projectId
                    ? window.convax.agent.replyPermission({ projectId: props.projectId, requestId: request.id, reply }).then(() => refreshSessionState())
                    : Promise.resolve()}
                  request={request}
                />
              ))}
              {sessionState?.pendingQuestions.map((request) => (
                <QuestionCard
                  key={request.id}
                  onReject={() => props.projectId
                    ? window.convax.agent.rejectQuestion({ projectId: props.projectId, requestId: request.id }).then(() => refreshSessionState())
                    : Promise.resolve()}
                  onReply={(answers) => props.projectId
                    ? window.convax.agent.replyQuestion({ answers, projectId: props.projectId, requestId: request.id }).then(() => refreshSessionState())
                    : Promise.resolve()}
                  request={request}
                />
              ))}
              {runtimeBusy ? <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground"><LoaderCircle className="size-3.5 animate-spin" />OpenCode is working…</div> : null}
              <div ref={messagesEndRef} />
            </div>

            <div className="relative shrink-0 border-t border-border bg-card p-3">
              {error ? <div className="mb-2 flex items-start gap-2 rounded-md border border-destructive/25 bg-destructive/5 px-2.5 py-2 text-xs text-destructive"><span className="min-w-0 flex-1">{error}</span><button aria-label="Dismiss error" onClick={() => setError(undefined)} type="button"><X className="size-3.5" /></button></div> : null}
              {resourcePickerOpen ? (
                <ResourcePicker
                  activeCanvasId={props.activeCanvas?.id}
                  canvases={props.canvases}
                  capabilities={capabilities}
                  loading={capabilitiesLoading}
                  onAdd={addResources}
                />
              ) : null}
              <div
                className={cn("rounded-lg border border-input bg-background p-2 shadow-sm transition-colors focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20", dropActive && "border-primary bg-primary/5 ring-2 ring-primary/20")}
                onDragEnter={(event) => {
                  if (!supportsResourceDrop(event.dataTransfer)) return
                  event.preventDefault()
                  setDropActive(true)
                }}
                onDragLeave={(event) => {
                  if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDropActive(false)
                }}
                onDragOver={(event) => {
                  if (!supportsResourceDrop(event.dataTransfer)) return
                  event.preventDefault()
                  event.dataTransfer.dropEffect = "copy"
                }}
                onDrop={handleDrop}
              >
                {resources.length > 0 ? (
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {resources.map((resource) => (
                      <ResourceChip key={resourceKey(resource)} onRemove={() => setResources((current) => current.filter((item) => resourceKey(item) !== resourceKey(resource)))} resource={resource} />
                    ))}
                  </div>
                ) : null}
                <textarea
                  aria-label="Message the project agent"
                  className="max-h-40 min-h-16 w-full resize-none bg-transparent px-1 text-sm leading-5 outline-none placeholder:text-muted-foreground"
                  disabled={!props.projectId || interactionDisabled}
                  onChange={(event) => setDraft(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                      event.preventDefault()
                      void send()
                    }
                  }}
                  placeholder={props.projectId ? "Ask about this project…" : "Open a project to start chatting"}
                  value={draft}
                />
                <div className="flex items-center gap-1 pt-1">
                  <Tooltip content="Attach canvas or skill"><Button aria-label="Attach canvas or skill" disabled={!props.projectId || interactionDisabled} onClick={() => {
                    const next = !resourcePickerOpen
                    setResourcePickerOpen(next)
                    if (next && props.projectId) {
                      const projectId = props.projectId
                      setCapabilitiesLoading(true)
                      void window.convax.agent.listCapabilities({ projectId })
                        .then((result) => {
                          if (activeProjectRef.current === projectId) setCapabilities(result)
                        })
                        .catch((cause) => {
                          if (activeProjectRef.current === projectId) setError(errorMessage(cause))
                        })
                        .finally(() => {
                          if (activeProjectRef.current === projectId) setCapabilitiesLoading(false)
                        })
                    }
                  }} size="icon-sm" variant={resourcePickerOpen ? "secondary" : "ghost"}><Paperclip /></Button></Tooltip>
                  <span className="min-w-0 flex-1 truncate px-1 text-[10px] text-muted-foreground">Drop project files, folders, canvases, or skills</span>
                  {runtimeBusy ? (
                    <Tooltip content="Stop"><Button aria-label="Stop response" onClick={() => void abort()} size="icon-sm" variant="outline"><Square className="fill-current" /></Button></Tooltip>
                  ) : (
                    <Tooltip content="Send"><Button aria-label="Send message" disabled={!props.projectId || interactionDisabled || (!draft.trim() && resources.length === 0)} onClick={() => void send()} size="icon-sm"><Send /></Button></Tooltip>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </aside>
    </TooltipProvider>
  )
}

function ConversationHistory(props: { disabled: boolean; loading: boolean; onSelect: (id: string) => void; selectedId?: string; sessions: AgentSession[] }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-2">
      <div className="px-2 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Conversation history</div>
      {props.loading && props.sessions.length === 0 ? <div className="p-4 text-xs text-muted-foreground">Loading…</div> : null}
      {props.sessions.length === 0 && !props.loading ? <div className="p-4 text-xs text-muted-foreground">No conversations yet.</div> : null}
      {props.sessions.map((session) => (
        <button
          className={cn("mb-1 flex w-full items-start gap-2 rounded-md px-2.5 py-2 text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:opacity-60", session.id === props.selectedId && "bg-accent text-accent-foreground")}
          disabled={props.disabled}
          key={session.id}
          onClick={() => props.onSelect(session.id)}
          type="button"
        >
          <MessageSquare className="mt-0.5 size-3.5 shrink-0" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-medium">{session.title || "New conversation"}</span>
            <span className="mt-0.5 block text-[10px] text-muted-foreground">{new Date(session.updatedAt).toLocaleString()}</span>
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
      <div className="mx-auto mb-3 grid size-9 place-items-center rounded-full bg-accent text-primary [&_svg]:size-4">{props.icon}</div>
      <div className="text-sm font-medium">{props.title}</div>
      <div className="mt-1.5 text-xs leading-5 text-muted-foreground">{props.description}</div>
    </div>
  )
}

function MessageView({ message }: { message: AgentMessage }) {
  const user = message.role === "user"
  const visibleParts = message.parts.filter((part) => part.type !== "step-start" && part.type !== "step-finish")
  return (
    <article className={cn("flex", user ? "justify-end" : "justify-start")}>
      <div className={cn("min-w-0 max-w-[92%] space-y-2 text-sm", user ? "rounded-xl bg-accent px-3 py-2 text-accent-foreground" : "w-full")}>
        {!user ? <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground"><Bot className="size-3" />Agent</div> : null}
        {visibleParts.map((part) => <MessagePartView key={part.id} part={part} />)}
        {message.error ? <div className="rounded-md border border-destructive/25 bg-destructive/5 p-2 text-xs text-destructive">{message.error}</div> : null}
      </div>
    </article>
  )
}

function MessagePartView({ part }: { part: AgentMessage["parts"][number] }) {
  if (part.type === "text") return part.synthetic ? null : <div className="whitespace-pre-wrap break-words leading-6">{part.text}</div>
  if (part.type === "reasoning") return <details className="rounded-md border border-border bg-muted/35 px-2.5 py-2 text-xs"><summary className="cursor-pointer text-muted-foreground">Reasoning</summary><div className="mt-2 whitespace-pre-wrap leading-5">{part.text}</div></details>
  if (part.type === "file") return <div className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs"><FileText className="size-3.5" /><span className="truncate">{part.filename ?? "File"}</span></div>
  if (part.type === "tool") {
    const state = part.state
    const presentation = getAgentToolPresentation(part)
    const pending = presentation.outcome === "pending" || presentation.outcome === "running"
    return (
      <details className="rounded-md border border-border bg-muted/35 px-2.5 py-2 text-xs">
        <summary className="flex cursor-pointer list-none items-center gap-2">
          {pending ? <LoaderCircle className="size-3.5 animate-spin text-primary" /> : presentation.outcome === "success" ? <Check className="size-3.5 text-emerald-600" /> : <X className="size-3.5 text-destructive" />}
          <Wrench className="size-3.5 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate">{"title" in state && state.title ? state.title : part.tool}</span>
          <ChevronDown className="size-3.5 text-muted-foreground" />
        </summary>
        {presentation.detail ? <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words border-t border-border pt-2 font-mono text-[11px] leading-4">{presentation.detail}</pre> : null}
      </details>
    )
  }
  return null
}

function ResourcePicker(props: {
  activeCanvasId?: string
  canvases: ProjectCanvas[]
  capabilities?: AgentCapabilities
  loading: boolean
  onAdd: (resources: AgentResource[]) => void
}) {
  return (
    <div className="absolute inset-x-3 bottom-[calc(100%+4px)] z-50 max-h-72 overflow-auto rounded-lg border border-border bg-popover p-2 text-popover-foreground shadow-xl">
      <div className="px-2 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Canvases</div>
      {props.canvases.map((canvas) => {
        const resource: AgentResource = { canvasId: canvas.id, kind: "canvas", name: canvas.name }
        return <ResourceRow active={canvas.id === props.activeCanvasId} icon={<PanelsTopLeft />} key={canvas.id} onAdd={() => props.onAdd([resource])} resource={resource} />
      })}
      <div className="mt-1 border-t border-border px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Skills</div>
      {props.loading ? <div className="flex items-center gap-2 px-2 py-2 text-xs text-muted-foreground"><LoaderCircle className="size-3.5 animate-spin" />Discovering OpenCode skills…</div> : props.capabilities?.skills.length ? props.capabilities.skills.map((skill) => {
        const resource: AgentResource = { kind: "skill", name: skill.name }
        return <ResourceRow description={skill.description} icon={<Sparkles />} key={skill.name} onAdd={() => props.onAdd([resource])} resource={resource} />
      }) : <div className="px-2 py-2 text-xs text-muted-foreground">No skills discovered by OpenCode.</div>}
    </div>
  )
}

function ResourceRow(props: { active?: boolean; description?: string; icon: React.ReactNode; onAdd: () => void; resource: AgentResource }) {
  return (
    <button
      className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted"
      draggable
      onClick={props.onAdd}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "copy"
        event.dataTransfer.setData(resourceDragType, serializeResource(props.resource))
        event.dataTransfer.setData("text/plain", resourceLabel(props.resource))
      }}
      type="button"
    >
      <span className="mt-0.5 text-primary [&_svg]:size-3.5">{props.icon}</span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-xs font-medium"><span className="truncate">{resourceLabel(props.resource)}</span>{props.active ? <span className="rounded bg-primary/10 px-1 text-[9px] text-primary">active</span> : null}</span>
        {props.description ? <span className="mt-0.5 block line-clamp-2 text-[10px] leading-4 text-muted-foreground">{props.description}</span> : null}
      </span>
    </button>
  )
}

function ResourceChip(props: { onRemove: () => void; resource: AgentResource }) {
  const icon = props.resource.kind === "directory" ? <Folder /> : props.resource.kind === "canvas" ? <PanelsTopLeft /> : props.resource.kind === "skill" ? <Sparkles /> : <FileText />
  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-md border border-border bg-muted/60 px-1.5 py-1 text-[11px]">
      <span className="text-primary [&_svg]:size-3">{icon}</span>
      <span className="max-w-40 truncate">{resourceLabel(props.resource)}</span>
      <button aria-label={`Remove ${resourceLabel(props.resource)}`} className="rounded hover:bg-background" onClick={props.onRemove} type="button"><X className="size-3" /></button>
    </span>
  )
}

function PermissionCard(props: { onReply: (reply: "always" | "once" | "reject") => Promise<unknown>; request: AgentPermissionRequest }) {
  const [replying, setReplying] = useState(false)
  const [replyError, setReplyError] = useState<string>()
  const reply = async (value: "always" | "once" | "reject") => {
    setReplying(true)
    setReplyError(undefined)
    try { await props.onReply(value) } catch (cause) { setReplyError(errorMessage(cause)) } finally { setReplying(false) }
  }
  return (
    <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs">
      <div className="flex items-center gap-2 font-medium"><ShieldAlert className="size-4 text-amber-600" />Permission required</div>
      <div className="mt-2 text-muted-foreground">OpenCode wants permission to <span className="font-medium text-foreground">{props.request.permission}</span>.</div>
      {props.request.patterns.length ? <div className="mt-1 break-all font-mono text-[10px] text-muted-foreground">{props.request.patterns.join(", ")}</div> : null}
      {props.request.always.length ? (
        <div className="mt-2 rounded border border-amber-500/20 bg-background/70 p-2 text-[10px] text-muted-foreground">
          <span className="font-semibold text-foreground">Always allow scope: </span>
          <span className="break-all font-mono">{props.request.always.join(", ")}</span>
        </div>
      ) : null}
      {replyError ? <div className="mt-2 text-destructive">{replyError}</div> : null}
      <div className="mt-3 flex flex-wrap gap-1.5">
        <Button disabled={replying} onClick={() => void reply("once")} size="sm">Allow once</Button>
        {props.request.always.length ? <Button disabled={replying} onClick={() => void reply("always")} size="sm" variant="outline">Always allow</Button> : null}
        <Button disabled={replying} onClick={() => void reply("reject")} size="sm" variant="ghost">Deny</Button>
      </div>
    </div>
  )
}

function QuestionCard(props: { onReject: () => Promise<unknown>; onReply: (answers: string[][]) => Promise<unknown>; request: AgentQuestionRequest }) {
  const [answers, setAnswers] = useState<string[][]>(() => props.request.questions.map(() => []))
  const [customAnswers, setCustomAnswers] = useState<string[]>(() => props.request.questions.map(() => ""))
  const [replying, setReplying] = useState(false)
  const [replyError, setReplyError] = useState<string>()
  const resolvedAnswers = answers.map((answer, index) => {
    const custom = customAnswers[index]?.trim()
    return custom ? [...answer, custom] : answer
  })
  const update = (index: number, value: string, multiple = false) => {
    if (!multiple) setCustomAnswers((current) => current.map((answer, answerIndex) => answerIndex === index ? "" : answer))
    setAnswers((current) => current.map((answer, answerIndex) => {
      if (answerIndex !== index) return answer
      if (!multiple) return [value]
      return answer.includes(value) ? answer.filter((item) => item !== value) : [...answer, value]
    }))
  }
  const updateCustom = (index: number, value: string, multiple = false) => {
    setCustomAnswers((current) => current.map((answer, answerIndex) => answerIndex === index ? value : answer))
    if (!multiple && value) setAnswers((current) => current.map((answer, answerIndex) => answerIndex === index ? [] : answer))
  }
  const submit = async () => {
    setReplying(true)
    setReplyError(undefined)
    try { await props.onReply(resolvedAnswers) } catch (cause) { setReplyError(errorMessage(cause)) } finally { setReplying(false) }
  }
  const reject = async () => {
    setReplying(true)
    setReplyError(undefined)
    try { await props.onReject() } catch (cause) { setReplyError(errorMessage(cause)) } finally { setReplying(false) }
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
              return <button className={cn("rounded-md border border-border bg-background px-2 py-1.5 text-left hover:bg-muted", selected && "border-primary bg-accent text-accent-foreground")} key={option.label} onClick={() => update(index, option.label, question.multiple)} title={option.description} type="button">{option.label}</button>
            })}
          </div>
          {question.custom ? <input className="mt-2 h-8 w-full rounded-md border border-input bg-background px-2 outline-none focus:border-ring" onChange={(event) => updateCustom(index, event.currentTarget.value, question.multiple)} placeholder="Type another answer" value={customAnswers[index] ?? ""} /> : null}
        </div>
      ))}
      {replyError ? <div className="mt-2 text-destructive">{replyError}</div> : null}
      <div className="mt-3 flex gap-1.5">
        <Button disabled={replying || resolvedAnswers.some((answer) => answer.length === 0)} onClick={() => void submit()} size="sm">Submit</Button>
        <Button disabled={replying} onClick={() => void reject()} size="sm" variant="ghost">Cancel</Button>
      </div>
    </div>
  )
}
