import {
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  cn,
} from "@convax/ui"
import { LoaderCircle, Sparkles } from "lucide-react"
import {
  type FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import {
  CanvasGenerationCatalogRequestTracker,
  assignCanvasGenerationImageRole,
  createCanvasGenerationComposerSubmission,
  isCanvasGenerationImageRole,
  projectCanvasGenerationComposer,
  reconcileCanvasGenerationImageRoles,
  resolveCanvasGenerationToolId,
  type CanvasGenerationCatalogStatus,
  type CanvasGenerationComposerSubmission,
  type CanvasGenerationImageRole,
} from "../generation-composer"
import type { CanvasGenerateService, CanvasGenerationToolSummary } from "../services"
import type { CanvasDocument } from "../types"

export interface CanvasGenerationPanelProps {
  autoFocus?: boolean
  className?: string
  disabled?: boolean
  document: CanvasDocument
  generateService: CanvasGenerateService
  initialPrompt?: string
  onSubmit: (submission: CanvasGenerationComposerSubmission) => void
  scopeId?: string
  selectedNodeIds: readonly string[]
  submitting?: boolean
}

/**
 * Canvas-owned whole-document generation composer.
 *
 * This surface owns draft and catalog discovery only. Its submit callback transfers
 * operation ownership before any Main work starts, so unmounting the panel cannot
 * implicitly cancel an accepted generation operation.
 */
export function CanvasGenerationPanel(props: CanvasGenerationPanelProps) {
  const scopeId = props.scopeId ?? ""
  const [prompt, setPrompt] = useState(props.initialPrompt ?? "")
  const [tools, setTools] = useState<readonly CanvasGenerationToolSummary[]>([])
  const [catalogStatus, setCatalogStatus] = useState<CanvasGenerationCatalogStatus>("idle")
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [catalogAttempt, setCatalogAttempt] = useState(0)
  const [selectedToolId, setSelectedToolId] = useState("")
  const [imageRoles, setImageRoles] = useState<Readonly<Record<string, CanvasGenerationImageRole>>>({})
  const catalogTrackerRef = useRef(new CanvasGenerationCatalogRequestTracker())
  const previousScopeRef = useRef({ documentId: props.document.id, scopeId })

  const projection = useMemo(
    () =>
      projectCanvasGenerationComposer({
        document: props.document,
        imageRoles,
        selectedNodeIds: props.selectedNodeIds,
        selectedToolId,
        tools,
      }),
    [imageRoles, props.document, props.selectedNodeIds, selectedToolId, tools],
  )

  useEffect(() => {
    const previous = previousScopeRef.current
    if (previous.documentId === props.document.id && previous.scopeId === scopeId) return
    previousScopeRef.current = { documentId: props.document.id, scopeId }
    setPrompt(props.initialPrompt ?? "")
    setSelectedToolId("")
    setImageRoles({})
  }, [props.document.id, props.initialPrompt, scopeId])

  useEffect(() => {
    setImageRoles((current) =>
      reconcileCanvasGenerationImageRoles(current, projection.inferredReferences),
    )
  }, [projection.inferredReferences])

  useEffect(() => {
    setSelectedToolId((current) =>
      resolveCanvasGenerationToolId(current, projection.compatibleTools),
    )
  }, [projection.compatibleTools])

  useEffect(() => {
    const request = catalogTrackerRef.current.begin({
      catalogVersion: props.generateService.catalogVersion,
      documentId: props.document.id,
      scopeId,
    })
    setCatalogStatus("loading")
    setCatalogError(null)
    void props.generateService.listTools({}, request.signal).then(
      (nextTools) => {
        if (!catalogTrackerRef.current.isCurrent(request)) return
        setTools(nextTools)
        setCatalogStatus("ready")
      },
      (error) => {
        if (!catalogTrackerRef.current.isCurrent(request)) return
        setTools([])
        setCatalogStatus("error")
        setCatalogError(error instanceof Error ? error.message : String(error))
      },
    )
    return () => catalogTrackerRef.current.cancel(request)
  }, [
    catalogAttempt,
    props.document.id,
    props.generateService,
    props.generateService.catalogVersion,
    scopeId,
  ])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (props.disabled || props.submitting) return
    const submission = createCanvasGenerationComposerSubmission({
      catalogStatus,
      document: props.document,
      projection,
      prompt,
      scopeId,
      selectedNodeIds: props.selectedNodeIds,
    })
    if (submission) props.onSubmit(submission)
  }

  const referenceImageNodes = projection.inferredReferences.filter(
    (reference) => reference.role === "reference_image",
  )
  const nodeById = new Map(props.document.nodes.map((node) => [node.id, node]))
  const selectedTool = projection.selectedTool
  const inputDisabled =
    Boolean(props.disabled) ||
    Boolean(props.submitting) ||
    catalogStatus !== "ready" ||
    !selectedTool

  return (
    <div className={cn("flex min-w-0 flex-col", props.className)}>
      <form className="flex flex-col gap-2" onSubmit={submit}>
        {catalogStatus === "loading" ? (
          <div
            className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-xs text-muted-foreground"
            role="status"
          >
            <LoaderCircle className="size-4 animate-spin" />
            Loading generation tools…
          </div>
        ) : null}
        {catalogStatus === "error" ? (
          <div
            className="flex items-center justify-between gap-3 rounded-md border border-destructive/30 px-3 py-2 text-xs text-destructive"
            role="alert"
          >
            <span className="min-w-0 truncate">
              {catalogError ?? "Could not load generation tools."}
            </span>
            <Button
              onClick={() => setCatalogAttempt((attempt) => attempt + 1)}
              size="sm"
              type="button"
              variant="outline"
            >
              Retry
            </Button>
          </div>
        ) : null}
        {referenceImageNodes.length > 0 ? (
          <div className="flex flex-col gap-2 rounded-md border border-border px-3 py-2">
            <div className="text-xs font-medium text-foreground">Image roles</div>
            {referenceImageNodes.map((reference) => (
              <div key={reference.nodeId} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                  {nodeById.get(reference.nodeId)?.data.label ?? reference.nodeId}
                </span>
                <Select
                  disabled={props.disabled || props.submitting}
                  onValueChange={(role) => {
                    if (!isCanvasGenerationImageRole(role)) return
                    setImageRoles((current) =>
                      assignCanvasGenerationImageRole(current, reference.nodeId, role),
                    )
                  }}
                  value={imageRoles[reference.nodeId] ?? "reference_image"}
                >
                  <SelectTrigger
                    aria-label={`Generation role for ${nodeById.get(reference.nodeId)?.data.label ?? reference.nodeId}`}
                    className="w-36"
                    data-canvas-shortcuts="ignore"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="reference_image">Reference</SelectItem>
                    <SelectItem value="first_frame">First frame</SelectItem>
                    <SelectItem value="last_frame">Last frame</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
        ) : null}
        {catalogStatus === "ready" && projection.compatibleTools.length > 1 ? (
          <Select
            disabled={props.disabled || props.submitting}
            onValueChange={setSelectedToolId}
            value={selectedToolId}
          >
            <SelectTrigger
              aria-label="Generation tool"
              className="w-full"
              data-canvas-shortcuts="ignore"
            >
              <SelectValue>{selectedTool?.title ?? "Choose a generation tool"}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {projection.compatibleTools.map((tool) => (
                <SelectItem key={tool.id} value={tool.id}>
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate">{tool.title}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {tool.output} · {tool.description}
                    </span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        {catalogStatus === "ready" && projection.compatibleTools.length === 1 ? (
          <div className="rounded-md border border-border px-3 py-2">
            <div className="text-sm font-medium">{projection.compatibleTools[0]?.title}</div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {projection.compatibleTools[0]?.output} · {projection.compatibleTools[0]?.description}
            </div>
          </div>
        ) : null}
        {catalogStatus === "ready" && projection.compatibleTools.length === 0 ? (
          <div
            className="rounded-md border border-border px-3 py-2 text-xs text-muted-foreground"
            role="status"
          >
            {projection.referenceError ??
              (tools.length === 0
                ? "No generation tools are installed. Install a Tool Plugin to generate content."
                : "No installed generation tool supports all selected references.")}
          </div>
        ) : null}
        <div className="flex gap-2">
          <Input
            autoFocus={props.autoFocus}
            data-canvas-shortcuts="ignore"
            disabled={inputDisabled}
            onChange={(event) => setPrompt(event.currentTarget.value)}
            placeholder="Describe what to create..."
            value={prompt}
          />
          <Button
            aria-label="Run generation"
            disabled={inputDisabled || !prompt.trim()}
            size="icon"
            type="submit"
          >
            {props.submitting ? <LoaderCircle className="animate-spin" /> : <Sparkles />}
          </Button>
        </div>
      </form>
      <div className="mt-2 text-xs text-muted-foreground">
        {projection.references.length > 0
          ? `${projection.references.length} selected reference${projection.references.length === 1 ? "" : "s"} will be used as input.`
          : "No supported reference nodes selected."}
      </div>
    </div>
  )
}
