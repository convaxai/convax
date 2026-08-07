import type { AgentModelCatalog } from "@convax/agent-runtime"
import type {
  GenerationToolDescription,
  GenerationToolInput,
  GenerationToolInputValue,
  GenerationToolSummary,
} from "../generation-contracts"
import { Button, SegmentedTabs, ToolInputForm, type SegmentedTabItem } from "@convax/ui"
import { Check, LoaderCircle, Settings2 } from "lucide-react"
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import {
  agentGenerationOutputs,
  agentGenerationModelDisplayTitle,
  agentGenerationToolsForOutput,
  type AgentGenerationOutput,
  type AgentGenerationToolSelection,
} from "./agent-generation-models"
import {
  createAgentComposerPickerAnchor,
  positionAgentComposerPicker,
} from "./agent-composer-picker"
import { availableAgentLlmProviders, type AgentLlmModelSelection } from "./agent-llm-models"

export type AgentModelPickerTab = AgentGenerationOutput | "llm"

export interface AgentGenerationModelPickerProps {
  activeTab: AgentModelPickerTab
  anchorElement?: HTMLElement | null
  error?: string
  loading: boolean
  llmCatalog?: AgentModelCatalog
  llmError?: string
  llmLoading?: boolean
  llmSelected?: AgentLlmModelSelection
  description?: GenerationToolDescription
  descriptionError?: string
  descriptionLoading?: boolean
  onClose(): void
  onLlmSelect(selection: AgentLlmModelSelection): void
  onOpenServices(): void
  onSelect(selection: AgentGenerationToolSelection): void
  onTabChange(tab: AgentModelPickerTab): void
  onToolInputChange(input: Record<string, GenerationToolInputValue>): void
  selected?: AgentGenerationToolSelection
  tools: readonly GenerationToolSummary[]
  toolInput: GenerationToolInput
}

const outputLabels: Record<AgentGenerationOutput, string> = {
  audio: "Audio",
  image: "Image",
  video: "Video",
}

const tabLabels: Record<AgentModelPickerTab, string> = {
  ...outputLabels,
  llm: "LLM",
}

function OpenServicesPrompt(props: { error?: boolean; message: string; onOpenServices(): void }) {
  return (
    <div className="px-2.5 py-3">
      <p className={props.error ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>{props.message}</p>
      <Button className="mt-2" onClick={props.onOpenServices} size="sm" variant="outline">
        <Settings2 />
        Open Services
      </Button>
    </div>
  )
}

export function AgentGenerationModelPicker(props: AgentGenerationModelPickerProps) {
  const instanceId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const pickerSurfaceRef = useRef<HTMLDivElement>(null)
  const [pickerHeight, setPickerHeight] = useState(0)
  const modelPickerTabs: readonly AgentModelPickerTab[] = ["llm", ...agentGenerationOutputs]
  const tabs = modelPickerTabs.map((tab) => ({
    id: `${instanceId}-agent-generation-model-tab-${tab}`,
    label: tabLabels[tab],
    panelId: `${instanceId}-agent-generation-model-panel-${tab}`,
    value: tab,
  })) satisfies readonly SegmentedTabItem<AgentModelPickerTab>[]
  const activeOutput = props.activeTab === "llm" ? undefined : props.activeTab
  const generationModels = activeOutput ? agentGenerationToolsForOutput(props.tools, activeOutput) : []
  const defaultGenerationModel = generationModels[0]
  const selectedGenerationModel =
    activeOutput && props.selected?.output === activeOutput
      ? generationModels.find((model) => model.id === props.selected?.id)
      : undefined
  const llmProviders = availableAgentLlmProviders(props.llmCatalog)
  const llmModels = llmProviders.flatMap((provider) =>
    provider.models.map((model) => ({ model, providerId: provider.providerId, providerName: provider.providerName })),
  )
  const activeTab = tabs.find((tab) => tab.value === props.activeTab)!

  const anchor = props.anchorElement
    ? createAgentComposerPickerAnchor(
        props.anchorElement.getBoundingClientRect(),
        pickerSurfaceRef.current?.getBoundingClientRect() ??
          props.anchorElement.getBoundingClientRect(),
        { height: window.innerHeight, width: window.innerWidth },
      )
    : undefined
  const position = anchor ? positionAgentComposerPicker(anchor, pickerHeight) : undefined
  const setPickerSurfaceRef = useCallback(
    (element: HTMLDivElement | null) => {
      pickerSurfaceRef.current = element
      dialogRef.current = element
    },
    [],
  )

  useLayoutEffect(() => {
    if (!position) return
    const picker = pickerSurfaceRef.current
    if (!picker) return
    const updateHeight = () => setPickerHeight(picker.getBoundingClientRect().height)
    updateHeight()
    const observer = new ResizeObserver(updateHeight)
    observer.observe(picker)
    return () => observer.disconnect()
  }, [position])

  useEffect(() => {
    if (!activeOutput || props.loading || props.error || selectedGenerationModel || !defaultGenerationModel) {
      return
    }
    props.onSelect({ id: defaultGenerationModel.id, output: activeOutput })
  }, [
    activeOutput,
    defaultGenerationModel?.id,
    props.error,
    props.loading,
    props.onSelect,
    selectedGenerationModel?.id,
  ])

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialogRef.current?.focus({ preventScroll: true })
    return () => previousFocus?.focus({ preventScroll: true })
  }, [])

  const picker = (
    <div
      aria-label="Agent models"
      className="fixed z-50 overflow-hidden rounded-2xl border border-border/70 bg-popover p-3 text-popover-foreground shadow-xl"
      data-agent-generation-model-picker
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault()
          props.onClose()
        }
      }}
      ref={setPickerSurfaceRef}
      role="dialog"
      style={
        position
          ? {
              left: position.left,
              maxWidth: "min(22rem, calc(100vw - 1rem))",
              top: position.top,
              transform: position.placement === "above" ? "translateY(-100%)" : undefined,
            }
          : undefined
      }
      tabIndex={-1}
    >
      <div className="mb-2 flex items-center justify-between px-1">
        <span className="text-sm font-semibold">Agent models</span>
        <span className="text-[10px] text-muted-foreground">
          {props.activeTab === "llm" ? "Agent runtime" : "Generation services"}
        </span>
      </div>
      <SegmentedTabs
        aria-label="Model type"
        items={tabs}
        onValueChange={(tab) => props.onTabChange(tab)}
        value={props.activeTab}
      />
      <div
        aria-labelledby={activeTab.id}
        className="mt-2 max-h-64 space-y-0.5 overflow-y-auto"
        id={activeTab.panelId}
        role="tabpanel"
      >
        {props.activeTab === "llm" ? (
          <div role="radiogroup">
            {props.llmLoading ? (
              <div className="flex items-center gap-2 px-2.5 py-3 text-xs text-muted-foreground">
                <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" />
                Loading agent models…
              </div>
            ) : props.llmError ? (
              <OpenServicesPrompt error message={props.llmError} onOpenServices={props.onOpenServices} />
            ) : llmProviders.length === 0 ? (
              <OpenServicesPrompt
                message="No LLM service with an available model is connected."
                onOpenServices={props.onOpenServices}
              />
            ) : (
              llmModels.map(({ model, providerId, providerName }) => {
                const selected =
                  props.llmSelected?.providerId === providerId && props.llmSelected.modelId === model.modelId
                return (
                  <button
                    aria-checked={selected}
                    aria-label={`${model.modelName} by ${providerName}`}
                    className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/40"
                    key={`${providerId}/${model.modelId}`}
                    onClick={() => props.onLlmSelect({ modelId: model.modelId, providerId })}
                    role="radio"
                    type="button"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{model.modelName}</span>
                      <span className="block truncate text-[10px] text-muted-foreground">{providerName}</span>
                    </span>
                    {selected ? <Check className="size-4 shrink-0" /> : null}
                  </button>
                )
              })
            )}
          </div>
        ) : (
          <div role="radiogroup">
            {props.loading ? (
              <div className="flex items-center gap-2 px-2.5 py-3 text-xs text-muted-foreground">
                <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" />
                Loading available models…
              </div>
            ) : props.error ? (
              <OpenServicesPrompt error message={props.error} onOpenServices={props.onOpenServices} />
            ) : generationModels.length === 0 ? (
              <OpenServicesPrompt
                message={`No available ${outputLabels[activeOutput!].toLocaleLowerCase()} generation service provides a model.`}
                onOpenServices={props.onOpenServices}
              />
            ) : (
              generationModels.map((tool) => {
                const selected = props.selected?.id === tool.id && props.selected.output === tool.output
                const modelName = agentGenerationModelDisplayTitle(tool)
                return (
                  <button
                    aria-checked={selected}
                    aria-label={`${modelName} by ${tool.pluginName}`}
                    className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/40"
                    key={tool.id}
                    onClick={() => props.onSelect({ id: tool.id, output: activeOutput! })}
                    role="radio"
                    type="button"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{modelName}</span>
                      <span className="block truncate text-[10px] text-muted-foreground">{tool.pluginName}</span>
                    </span>
                    {selected ? <Check className="size-4 shrink-0" /> : null}
                  </button>
                )
              })
            )}
          </div>
        )}
      </div>
      {activeOutput &&
      props.selected?.output === activeOutput &&
      (props.descriptionError ||
        (props.description?.toolId === props.selected.id && props.description.fields.length > 0)) ? (
        <div className="mt-2 max-h-52 overflow-y-auto border-t border-border/60 px-1 pt-2">
          {props.descriptionError ? (
            <div className="py-2 text-xs text-destructive">{props.descriptionError}</div>
          ) : props.description?.toolId === props.selected.id ? (
            <ToolInputForm
              fields={props.description.fields}
              onValuesChange={(values) => props.onToolInputChange(values)}
              values={props.toolInput}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  )
  if (typeof document === "undefined" || !props.anchorElement) return picker
  return createPortal(picker, document.body)
}
