import type { AgentModelCatalog } from "@convax/agent-runtime"
import type {
  GenerationToolDescription,
  GenerationToolInput,
  GenerationToolInputValue,
  GenerationToolSummary,
} from "../generation-contracts"
import { Button, SegmentedTabs, ToolInputForm, type SegmentedTabItem } from "@convax/ui"
import { Check, LoaderCircle, Settings2 } from "lucide-react"
import { useEffect, useId, useRef } from "react"
import {
  agentGenerationOutputs,
  agentGenerationModelDisplayTitle,
  agentGenerationToolsForOutput,
  type AgentGenerationOutput,
  type AgentGenerationToolSelection,
} from "./agent-generation-models"
import { availableAgentLlmProviders, type AgentLlmModelSelection } from "./agent-llm-models"

export type AgentModelPickerTab = AgentGenerationOutput | "llm"

export interface AgentGenerationModelPickerProps {
  activeTab: AgentModelPickerTab
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

  return (
    <div
      aria-label="Agent models"
      className="absolute inset-x-0 bottom-full z-30 mb-2 overflow-hidden rounded-2xl border border-border/70 bg-popover p-3 text-popover-foreground shadow-xl"
      data-agent-generation-model-picker
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault()
          props.onClose()
        }
      }}
      ref={dialogRef}
      role="dialog"
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
      {activeOutput && props.selected?.output === activeOutput ? (
        <div className="mt-2 max-h-52 overflow-y-auto border-t border-border/60 px-1 pt-2">
          {props.descriptionLoading ? (
            <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
              <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" />
              Loading model options…
            </div>
          ) : props.descriptionError ? (
            <div className="py-2 text-xs text-destructive">{props.descriptionError}</div>
          ) : props.description?.toolId === props.selected.id && props.description.fields.length > 0 ? (
            <ToolInputForm
              fields={props.description.fields}
              onValuesChange={(values) => props.onToolInputChange(values)}
              values={props.toolInput}
            />
          ) : props.description?.toolId === props.selected.id ? (
            <div className="py-1 text-[10px] text-muted-foreground">This model has no additional options.</div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
