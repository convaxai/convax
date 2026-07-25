import {
  getCompatibleCanvasGenerationTools,
  inferCanvasGenerationReferences,
  type CanvasAssistantGenerationCapability,
  type CanvasAssistantRequest,
  type CanvasGenerateRequest,
  type CanvasGenerateResult,
  type CanvasGenerateService,
  type CanvasGenerationOutput,
  type CanvasGenerationReference,
  type CanvasGenerationToolDescription,
  type CanvasGenerationToolInput,
  type CanvasGenerationToolSummary,
  type CanvasNode,
} from "@convax/canvas"
import {
  Button,
  SegmentedTabs,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  ToolInputForm,
  createToolInputDefaultValues,
  validateToolInputValues,
  type ToolInputValue,
} from "@convax/ui"
import { ArrowUp, LoaderCircle, Sparkles } from "lucide-react"
import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react"
import { useAgentGenerationDefault } from "./agent-generation-preference"
import type { AgentGenerationToolSelection } from "./agent-generation-models"

const automaticToolToken = "automatic"
const unavailableToolToken = "unavailable"

const outputLabels: Record<CanvasGenerationOutput, string> = {
  audio: "Audio",
  image: "Image",
  text: "Text",
  video: "Video",
}

export function canvasCardGenerationOutput(
  request: Pick<CanvasAssistantRequest, "generation">,
): CanvasGenerationOutput | undefined {
  return request.generation?.output
}

export function canvasCardGenerationReferences(
  request: Pick<CanvasAssistantRequest, "document" | "mentionedNodeIds">,
): readonly CanvasGenerationReference[] {
  return inferCanvasGenerationReferences(request.document.nodes, request.mentionedNodeIds)
}

export function canvasCardAgentContextNodeIds(
  request: Pick<CanvasAssistantRequest, "mentionedNodeIds" | "mode" | "ownerNodeId">,
): readonly string[] {
  return [
    ...new Set(request.mode === "file" ? [request.ownerNodeId, ...request.mentionedNodeIds] : request.mentionedNodeIds),
  ]
}

function finiteNodeWidth(...values: unknown[]) {
  return values.find((value): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0)
}

export function canvasCardGenerationAnchor(node: CanvasNode, nodes: readonly CanvasNode[] = [node]) {
  const nodesById = new Map(nodes.map((candidate) => [candidate.id, candidate]))
  const visited = new Set<string>()
  let current: CanvasNode | undefined = node
  let x = 0
  let y = 0
  while (current && !visited.has(current.id)) {
    visited.add(current.id)
    x += current.position.x
    y += current.position.y
    current = current.parentId ? nodesById.get(current.parentId) : undefined
  }
  const width = finiteNodeWidth(node.measured?.width, node.width, node.style?.width) ?? 320
  return { x: x + width + 64, y }
}

export function compatibleCanvasCardGenerationTools(
  tools: readonly CanvasGenerationToolSummary[],
  output: CanvasGenerationOutput | undefined,
  references: readonly CanvasGenerationReference[],
) {
  return getCompatibleCanvasGenerationTools(output ? tools.filter((tool) => tool.output === output) : tools, references)
}

export function resolveCanvasCardGenerationTool(
  ownerToolId: string | undefined,
  tools: readonly CanvasGenerationToolSummary[],
  agentDefault?: AgentGenerationToolSelection,
  ownerOutput?: CanvasGenerationOutput,
) {
  const outputTools = ownerOutput ? tools.filter((tool) => tool.output === ownerOutput) : tools
  if (ownerToolId) {
    const persisted = tools.find((tool) => tool.id === ownerToolId)
    if (persisted) return outputTools.find((tool) => tool.id === persisted.id)
  }
  const inherited = agentDefault
    ? outputTools.find((tool) => tool.id === agentDefault.id && tool.output === agentDefault.output)
    : undefined
  if (inherited) return inherited
  return outputTools.length === 1 ? outputTools[0] : undefined
}

export function validateCanvasCardGenerationToolInput(
  description: CanvasGenerationToolDescription,
  values: Readonly<Record<string, ToolInputValue>>,
): CanvasGenerationToolInput {
  const validation = validateToolInputValues(description.fields, values)
  if (validation.missingRequiredFieldIds.length > 0) {
    const labels = validation.missingRequiredFieldIds.map(
      (id) => description.fields.find((field) => field.id === id)?.label ?? id,
    )
    throw new Error(`Complete the required model options: ${labels.join(", ")}`)
  }
  if (validation.invalidFieldIds.length > 0) {
    throw new Error(`Review the invalid model options: ${validation.invalidFieldIds.join(", ")}`)
  }
  return validation.input
}

export function createCanvasCardGenerationRequest(input: {
  description: CanvasGenerationToolDescription
  operationId?: string
  prompt: string
  request: CanvasAssistantRequest
  signal: AbortSignal
  tool: CanvasGenerationToolSummary
  toolInput: Readonly<Record<string, ToolInputValue>>
}): CanvasGenerateRequest {
  const node = input.request.document.nodes.find((candidate) => candidate.id === input.request.ownerNodeId)
  if (!node) throw new Error("Card generation owner node is no longer in the Canvas document")
  if (input.description.toolId !== input.tool.id) {
    throw new Error("The selected generation model configuration is stale")
  }
  const ownerOutput = canvasCardGenerationOutput(input.request)
  if (!ownerOutput || node.data.kind !== ownerOutput) {
    throw new Error("Direct card generation is available only for image and video cards")
  }
  if (input.tool.output !== ownerOutput) {
    throw new Error(`The selected generation model cannot replace this ${ownerOutput} card`)
  }
  const prompt = input.prompt.trim()
  if (!prompt) throw new Error("Card generation prompt must not be empty")
  const toolInput = validateCanvasCardGenerationToolInput(input.description, input.toolInput)
  return {
    anchor: canvasCardGenerationAnchor(node, input.request.document.nodes),
    context: {
      documentId: input.request.document.id,
      selectedNodeIds: [node.id],
      source: "canvas-card",
    },
    expectedRevision: input.request.document.revision,
    operationId: input.operationId ?? globalThis.crypto.randomUUID(),
    output: ownerOutput,
    prompt,
    references: canvasCardGenerationReferences(input.request),
    resultMode: { nodeId: node.id, type: "replace-node" },
    signal: input.signal,
    toolId: input.tool.id,
    ...(Object.keys(toolInput).length > 0 ? { toolInput } : {}),
  }
}

export class CanvasCardGenerationCatalogRequestTracker {
  #generation = 0
  #scope = ""

  begin(scope: string) {
    const generation = ++this.#generation
    this.#scope = scope
    return () => this.#generation === generation && this.#scope === scope
  }

  invalidate() {
    this.#generation += 1
    this.#scope = ""
  }
}

function abortError(message: string) {
  const error = new Error(message)
  error.name = "AbortError"
  return error
}

export function generationErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(
    /^Error invoking remote method ['"]generation:generate['"]:\s*GenerationToolReportedError:\s*/,
    "",
  )
}

export async function executeCanvasCardGeneration(input: {
  generate: CanvasGenerateService["generate"]
  request: CanvasGenerateRequest
}): Promise<CanvasGenerateResult> {
  const result = await input.generate(input.request)
  if (input.request.signal.aborted) {
    throw input.request.signal.reason ?? abortError("The card generation request was cancelled")
  }
  return result
}

type ScopedLoad<T> =
  | { scope: string; status: "loading" }
  | { error: string; scope: string; status: "error" }
  | { scope: string; status: "ready"; value: T }

export interface CanvasCardGenerationPanelProps {
  catalogVersion?: string | number
  generation: CanvasAssistantGenerationCapability
  request: CanvasAssistantRequest
  service: CanvasGenerateService
}

export function CanvasCardGenerationPanel(props: CanvasCardGenerationPanelProps) {
  const agentDefault = useAgentGenerationDefault()
  const [prompt, setPrompt] = useState(props.generation.initialPrompt ?? "")
  const [catalog, setCatalog] = useState<ScopedLoad<readonly CanvasGenerationToolSummary[]>>({
    scope: "",
    status: "loading",
  })
  const [description, setDescription] = useState<ScopedLoad<CanvasGenerationToolDescription>>({
    scope: "",
    status: "loading",
  })
  const [toolInput, setToolInput] = useState<Record<string, ToolInputValue>>({})
  const [operationError, setOperationError] = useState<string>()
  const [operationMessage, setOperationMessage] = useState<string>()
  const [generating, setGenerating] = useState(false)
  const catalogRequestRef = useRef(new CanvasCardGenerationCatalogRequestTracker())
  const descriptionRequestRef = useRef(new CanvasCardGenerationCatalogRequestTracker())
  const mountedRef = useRef(false)
  const promptRef = useRef<HTMLTextAreaElement>(null)
  const references = useMemo(
    () => canvasCardGenerationReferences(props.request),
    [props.request.document.nodes, props.request.mentionedNodeIds],
  )
  const referencesRef = useRef(references)
  referencesRef.current = references
  const ownerOutput = props.generation.output
  const referenceFingerprint = JSON.stringify(references)
  const catalogVersion = props.catalogVersion ?? props.service.catalogVersion ?? ""
  const catalogScope = JSON.stringify([
    props.request.document.id,
    props.request.ownerNodeId,
    ownerOutput ?? null,
    referenceFingerprint,
    catalogVersion,
  ])
  const operationScope = JSON.stringify([props.request.document.id, props.request.ownerNodeId])
  const currentCatalog = catalog.scope === catalogScope ? catalog : undefined
  const currentTools = currentCatalog?.status === "ready" ? currentCatalog.value : []
  const ownerToolId = props.generation.ownerToolId
  const selectedOwnerTool = ownerToolId
    ? currentTools.find((tool) => tool.id === ownerToolId && (!ownerOutput || tool.output === ownerOutput))
    : undefined
  const inheritedAgentTool =
    !ownerToolId && agentDefault && (!ownerOutput || agentDefault.output === ownerOutput)
      ? currentTools.find((tool) => tool.id === agentDefault.id && tool.output === agentDefault.output)
      : undefined
  const resolvedTool = resolveCanvasCardGenerationTool(ownerToolId, currentTools, agentDefault, ownerOutput)
  const modelSelectOwnerToolId = selectedOwnerTool || !resolvedTool ? ownerToolId : undefined
  const descriptionScope = resolvedTool ? JSON.stringify([catalogScope, resolvedTool.id]) : ""
  const currentDescription = descriptionScope && description.scope === descriptionScope ? description : undefined
  const inputValidation =
    currentDescription?.status === "ready"
      ? validateToolInputValues(currentDescription.value.fields, toolInput)
      : undefined
  const canGenerate = Boolean(
    currentCatalog?.status === "ready" &&
      resolvedTool &&
      currentDescription?.status === "ready" &&
      inputValidation?.valid &&
      prompt.trim(),
  )
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      catalogRequestRef.current.invalidate()
      descriptionRequestRef.current.invalidate()
    }
  }, [])

  useEffect(() => {
    setToolInput({})
    setOperationError(undefined)
    setOperationMessage(undefined)
  }, [operationScope])

  useEffect(() => {
    const isLatest = catalogRequestRef.current.begin(catalogScope)
    const controller = new AbortController()
    setCatalog({ scope: catalogScope, status: "loading" })
    void props.service.listTools(ownerOutput ? { output: ownerOutput } : {}, controller.signal).then(
      (listed) => {
        if (!mountedRef.current || controller.signal.aborted || !isLatest()) return
        const compatible = compatibleCanvasCardGenerationTools(listed, ownerOutput, referencesRef.current)
        setCatalog({ scope: catalogScope, status: "ready", value: compatible })
      },
      (error) => {
        if (!mountedRef.current || controller.signal.aborted || !isLatest()) return
        setCatalog({ error: generationErrorMessage(error), scope: catalogScope, status: "error" })
      },
    )
    return () => {
      controller.abort(abortError("The generation tool catalog changed"))
      if (isLatest()) catalogRequestRef.current.invalidate()
    }
  }, [catalogScope, ownerOutput, props.service])

  useEffect(() => {
    setToolInput({})
    setOperationError(undefined)
    setOperationMessage(undefined)
    if (!resolvedTool || !descriptionScope) {
      descriptionRequestRef.current.invalidate()
      setDescription({ scope: "", status: "loading" })
      return undefined
    }
    const describedTool = resolvedTool
    const isLatest = descriptionRequestRef.current.begin(descriptionScope)
    const controller = new AbortController()
    setDescription({ scope: descriptionScope, status: "loading" })
    void props.service.describeTool(describedTool.id, controller.signal).then(
      (result) => {
        if (!mountedRef.current || controller.signal.aborted || !isLatest()) return
        if (result.toolId !== describedTool.id) {
          setDescription({
            error: "The generation model returned a stale configuration.",
            scope: descriptionScope,
            status: "error",
          })
          return
        }
        setToolInput(createToolInputDefaultValues(result.fields))
        setDescription({ scope: descriptionScope, status: "ready", value: result })
      },
      (error) => {
        if (!mountedRef.current || controller.signal.aborted || !isLatest()) return
        setDescription({ error: generationErrorMessage(error), scope: descriptionScope, status: "error" })
      },
    )
    return () => {
      controller.abort(abortError("The selected generation model changed"))
      if (isLatest()) descriptionRequestRef.current.invalidate()
    }
  }, [descriptionScope, props.service, resolvedTool])

  const runGeneration = (event: FormEvent) => {
    event.preventDefault()
    if (generating || !canGenerate || !resolvedTool || currentDescription?.status !== "ready") return
    const controller = new AbortController()
    let request: CanvasGenerateRequest
    try {
      request = createCanvasCardGenerationRequest({
        description: currentDescription.value,
        operationId: globalThis.crypto.randomUUID(),
        prompt,
        request: props.request,
        signal: controller.signal,
        tool: resolvedTool,
        toolInput,
      })
    } catch (error) {
      setOperationError(generationErrorMessage(error))
      return
    }
    setGenerating(true)
    setOperationError(undefined)
    setOperationMessage(undefined)
    promptRef.current?.blur()
    void executeCanvasCardGeneration({
      generate: props.service.generate,
      request,
    })
      .then(
        (result) => {
          if (!mountedRef.current || controller.signal.aborted) return
          setPrompt("")
          setOperationMessage(
            result.createdNodeIds.length > 0 ? `已添加 ${result.createdNodeIds.length} 个生成结果。` : "生成完成。",
          )
        },
        (error) => {
          if (!mountedRef.current || controller.signal.aborted) return
          setOperationError(generationErrorMessage(error))
        },
      )
      .finally(() => {
        if (!mountedRef.current) return
        setGenerating(false)
      })
  }

  const modelHint =
    currentCatalog?.status === "loading" || !currentCatalog
      ? "正在加载已安装模型…"
      : currentCatalog.status === "error"
        ? currentCatalog.error
        : currentTools.length === 0
          ? references.length
            ? "没有已安装模型支持当前卡片。"
            : "没有已安装的生成模型。"
          : ownerToolId && !selectedOwnerTool && !resolvedTool
            ? "当前节点选择的模型已不可用，请选择其他模型或改为跟随 Agent。"
            : !resolvedTool
              ? "请选择一个模型。"
              : currentDescription?.status === "loading" || !currentDescription
                ? "正在加载模型选项…"
                : currentDescription.status === "error"
                  ? currentDescription.error
                  : inputValidation && !inputValidation.valid
                    ? "请完成必填的模型选项。"
                    : undefined
  const modelHintIsError = currentCatalog?.status === "error" || currentDescription?.status === "error"

  return (
    <form
      className="flex min-h-[196px] flex-col px-3 pb-3 pt-1"
      data-canvas-card-generation-panel
      onSubmit={runGeneration}
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden" data-canvas-card-generation-surface="single">
        <textarea
          aria-label="Generation prompt"
          className="min-h-28 max-h-48 flex-1 resize-none bg-transparent px-1 pb-2 pt-2 text-[15px] leading-6 text-foreground outline-none placeholder:text-muted-foreground disabled:pointer-events-none disabled:opacity-50"
          data-canvas-shortcuts="ignore"
          disabled={generating}
          onChange={(event) => setPrompt(event.currentTarget.value)}
          placeholder="描述要生成的内容…"
          ref={promptRef}
          value={prompt}
        />
        {modelHint ? (
          <div
            className={
              modelHintIsError
                ? "px-1 pb-1 text-[10px] text-destructive"
                : "px-1 pb-1 text-[10px] text-muted-foreground"
            }
            role="status"
          >
            {modelHint}
          </div>
        ) : null}
        {operationError ? (
          <div className="px-1 pb-1 text-[10px] text-destructive" role="alert">
            {operationError}
          </div>
        ) : null}
        {operationMessage ? (
          <div className="px-1 pb-1 text-[10px] text-emerald-600" role="status">
            {operationMessage}
          </div>
        ) : null}
        <div className="flex min-w-0 shrink-0 items-center gap-1 pt-1">
          <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <ModelSelect
              disabled={generating || currentCatalog?.status !== "ready"}
              onValueChange={(toolId) => {
                props.generation.onOwnerToolIdChange?.(toolId)
                setToolInput({})
                setOperationError(undefined)
                setOperationMessage(undefined)
              }}
              inheritedTool={inheritedAgentTool}
              ownerToolId={modelSelectOwnerToolId}
              resolvedTool={resolvedTool}
              showOutput={ownerOutput === undefined}
              tools={currentTools}
            />
            {currentDescription?.status === "ready" && currentDescription.value.fields.length > 0 ? (
              <ToolInputForm
                className="shrink-0"
                disabled={generating}
                fields={currentDescription.value.fields}
                layout="inline"
                onValuesChange={setToolInput}
                values={toolInput}
              />
            ) : null}
            {references.map((reference) => {
              const node = props.request.document.nodes.find((candidate) => candidate.id === reference.nodeId)
              return node ? (
                <span
                  key={reference.nodeId}
                  className="max-w-32 shrink-0 truncate rounded-full bg-muted/50 px-2 py-1 text-[10px] text-muted-foreground"
                >
                  @ {node.data.label}
                </span>
              ) : null
            })}
          </div>
          <Button
            aria-label={generating ? "Generating" : "Generate"}
            disabled={!canGenerate || generating}
            size="icon-sm"
            type="submit"
          >
            {generating ? <LoaderCircle className="animate-spin motion-reduce:animate-none" /> : <ArrowUp />}
          </Button>
        </div>
      </div>
    </form>
  )
}

function ModelSelect(props: {
  disabled: boolean
  inheritedTool?: CanvasGenerationToolSummary
  onValueChange(toolId?: string): void
  ownerToolId?: string
  resolvedTool?: CanvasGenerationToolSummary
  showOutput: boolean
  tools: readonly CanvasGenerationToolSummary[]
}) {
  const selectedIndex = props.ownerToolId ? props.tools.findIndex((tool) => tool.id === props.ownerToolId) : -1
  const selected = selectedIndex >= 0 ? props.tools[selectedIndex] : undefined
  const unavailable = Boolean(props.ownerToolId && !selected)
  const displayed = unavailable ? undefined : (selected ?? props.resolvedTool)
  return (
    <Select
      disabled={props.disabled}
      onValueChange={(value) => {
        if (value === automaticToolToken) props.onValueChange(undefined)
        else if (value === unavailableToolToken) return
        else props.onValueChange(props.tools[toolTokenIndex(value)]?.id)
      }}
      value={selectedIndex >= 0 ? toolToken(selectedIndex) : unavailable ? unavailableToolToken : automaticToolToken}
    >
      <SelectTrigger
        aria-label="Model"
        className="h-auto w-auto min-w-0 max-w-[70%] shrink-0 justify-start gap-1 border-0 bg-transparent px-1.5 py-1 text-[11px] text-muted-foreground shadow-none hover:bg-accent hover:text-accent-foreground focus-visible:border-transparent focus-visible:ring-ring/40 [&>svg]:size-3 [&>svg]:opacity-100"
        data-canvas-shortcuts="ignore"
      >
        <SelectValue className="flex items-center gap-1 text-muted-foreground">
          <Sparkles className="size-3.5 shrink-0" />
          <span className="shrink-0 font-medium text-foreground">Models</span>
          <span className="truncate">
            {unavailable
              ? "不可用"
              : displayed
                ? `${props.showOutput ? `${outputLabels[displayed.output]} · ` : ""}${displayed.title}`
                : "Auto"}
          </span>
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={automaticToolToken}>
          {props.inheritedTool
            ? `跟随 Agent · ${props.inheritedTool.title}`
            : props.resolvedTool
              ? `自动 · ${props.resolvedTool.title}`
              : "自动"}
        </SelectItem>
        {unavailable ? (
          <SelectItem disabled value={unavailableToolToken}>
            当前节点模型不可用
          </SelectItem>
        ) : null}
        {props.tools.map((tool, index) => (
          <SelectItem key={tool.id} value={toolToken(index)}>
            {props.showOutput ? `${outputLabels[tool.output]} · ` : ""}
            {tool.title}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

const toolToken = (index: number) => `tool:${index}`
const toolTokenIndex = (value: string) => Number.parseInt(value.slice("tool:".length), 10)

export interface CanvasCardConversationPanelProps extends Omit<CanvasCardGenerationPanelProps, "generation"> {
  agent: ReactNode
}

export function CanvasCardConversationPanel(props: CanvasCardConversationPanelProps) {
  const [tab, setTab] = useState<"generate" | "agent">("generate")
  const id = useId()
  const generation = props.request.generation
  if (!generation) {
    return (
      <div
        className="relative flex h-[340px] max-h-[calc(100vh-96px)] min-h-0 w-full min-w-0 flex-col overflow-hidden rounded-[28px] border border-border/70 bg-card text-card-foreground shadow-xl shadow-black/10"
        data-canvas-card-agent-only
      >
        {props.agent}
      </div>
    )
  }
  const tabs = [
    {
      id: `${id}-generate-tab`,
      label: "生成",
      panelId: `${id}-generate-panel`,
      value: "generate",
    },
    {
      id: `${id}-agent-tab`,
      label: "Agent",
      panelId: `${id}-agent-panel`,
      value: "agent",
    },
  ] as const

  return (
    <div
      className={`relative flex min-h-0 w-full min-w-0 flex-col overflow-hidden rounded-[28px] border border-border/70 bg-card text-card-foreground shadow-xl shadow-black/10 transition-[border-color,box-shadow] focus-within:border-ring/60 focus-within:shadow-2xl focus-within:shadow-black/15${tab === "agent" ? " h-[340px] max-h-[calc(100vh-96px)]" : ""}`}
      data-canvas-card-conversation-panel
    >
      <div className="shrink-0 px-3 pt-3">
        <SegmentedTabs
          aria-label="卡片对话模式"
          className="inline-grid w-fit rounded-full bg-muted/60"
          items={tabs}
          onValueChange={(value) => {
            if (value === "generate" || value === "agent") setTab(value)
          }}
          tabClassName="rounded-full px-3 py-1"
          value={tab}
        />
      </div>
      <div
        aria-labelledby={tabs[0].id}
        className="min-h-0 flex-1"
        hidden={tab !== "generate"}
        id={tabs[0].panelId}
        role="tabpanel"
      >
        <CanvasCardGenerationPanel
          catalogVersion={props.catalogVersion}
          generation={generation}
          request={props.request}
          service={props.service}
        />
      </div>
      <div
        aria-labelledby={tabs[1].id}
        className="min-h-0 flex-1"
        hidden={tab !== "agent"}
        id={tabs[1].panelId}
        role="tabpanel"
      >
        {props.agent}
      </div>
    </div>
  )
}
