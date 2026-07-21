import type { AgentModelCatalog } from "@convax/agent-runtime"
import type {
  GenerationToolDescription,
  GenerationToolInput,
  GenerationToolInputValue,
  GenerationToolSummary,
} from "../generation-contracts"
import { SegmentedTabs, ToolInputForm, type SegmentedTabItem } from "@convax/ui"
import { Check, ChevronRight, LoaderCircle } from "lucide-react"
import { useEffect, useId, useRef } from "react"
import {
  agentGenerationOutputs,
  agentGenerationModelDisplayTitle,
  groupAgentGenerationToolsByService,
  type AgentGenerationOutput,
  type AgentGenerationToolSelection,
} from "./agent-generation-models"
import type { AgentLlmModelSelection } from "./agent-llm-models"

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
  onLlmSelect(selection?: AgentLlmModelSelection): void
  onSelect(selection?: AgentGenerationToolSelection): void
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
  const services = activeOutput ? groupAgentGenerationToolsByService(props.tools, activeOutput) : []
  const llmProviders = props.llmCatalog?.providers.filter((provider) => provider.connected) ?? []
  const selectedServiceId = services.find((service) =>
    service.models.some((model) => model.id === props.selected?.id && model.output === props.selected?.output),
  )?.id
  const selectedLlmProviderId = llmProviders.find((provider) =>
    provider.models.some(
      (model) => model.modelId === props.llmSelected?.modelId && provider.providerId === props.llmSelected?.providerId,
    ),
  )?.providerId
  const activeTab = tabs.find((tab) => tab.value === props.activeTab)!

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialogRef.current?.focus({ preventScroll: true })
    return () => previousFocus?.focus({ preventScroll: true })
  }, [])

  return (
    <div
      aria-label="Models"
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
        <span className="text-sm font-semibold">Models</span>
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
            <button
              aria-checked={!props.llmSelected}
              className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/40"
              onClick={() => props.onLlmSelect(undefined)}
              role="radio"
              type="button"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">Auto</span>
                <span className="block text-[10px] text-muted-foreground">Use the agent runtime default model</span>
              </span>
              {!props.llmSelected ? <Check className="size-4 shrink-0" /> : null}
            </button>
            {props.llmLoading ? (
              <div className="flex items-center gap-2 px-2.5 py-3 text-xs text-muted-foreground">
                <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" />
                Loading agent models…
              </div>
            ) : props.llmError ? (
              <div className="px-2.5 py-3 text-xs text-destructive">{props.llmError}</div>
            ) : llmProviders.length === 0 ? (
              <div className="px-2.5 py-3 text-xs text-muted-foreground">No connected LLM services.</div>
            ) : (
              llmProviders.map((provider) => (
                <details
                  className="group/service rounded-xl border border-transparent open:border-border/60 open:bg-muted/25"
                  key={provider.providerId}
                  open={llmProviders.length === 1 || selectedLlmProviderId === provider.providerId}
                >
                  <summary className="flex cursor-pointer list-none items-center gap-2 rounded-xl px-2.5 py-2 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/40 [&::-webkit-details-marker]:hidden">
                    <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open/service:rotate-90" />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{provider.providerName}</span>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] tabular-nums text-muted-foreground">
                      {provider.models.length}
                    </span>
                  </summary>
                  <div className="mb-1 ml-4 border-l border-border/70 pl-2">
                    {provider.models.map((model) => {
                      const selected =
                        props.llmSelected?.providerId === provider.providerId &&
                        props.llmSelected.modelId === model.modelId
                      return (
                        <button
                          aria-checked={selected}
                          aria-label={`${model.modelName} by ${provider.providerName}`}
                          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/40"
                          key={model.modelId}
                          onClick={() => props.onLlmSelect({ modelId: model.modelId, providerId: provider.providerId })}
                          role="radio"
                          type="button"
                        >
                          <span className="min-w-0 flex-1 truncate text-sm">{model.modelName}</span>
                          {selected ? <Check className="size-4 shrink-0" /> : null}
                        </button>
                      )
                    })}
                  </div>
                </details>
              ))
            )}
          </div>
        ) : (
          <div role="radiogroup">
            <button
              aria-checked={!props.selected}
              className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/40"
              onClick={() => props.onSelect(undefined)}
              role="radio"
              type="button"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">Auto</span>
                <span className="block text-[10px] text-muted-foreground">No preferred generation tool</span>
              </span>
              {!props.selected ? <Check className="size-4 shrink-0" /> : null}
            </button>
            {props.loading ? (
              <div className="flex items-center gap-2 px-2.5 py-3 text-xs text-muted-foreground">
                <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" />
                Loading installed models…
              </div>
            ) : props.error ? (
              <div className="px-2.5 py-3 text-xs text-destructive">{props.error}</div>
            ) : services.length === 0 ? (
              <div className="px-2.5 py-3 text-xs text-muted-foreground">
                No installed {outputLabels[activeOutput!].toLocaleLowerCase()} generation services.
              </div>
            ) : (
              services.map((service) => (
                <details
                  className="group/service rounded-xl border border-transparent open:border-border/60 open:bg-muted/25"
                  key={service.id}
                  open={services.length === 1 || selectedServiceId === service.id}
                >
                  <summary className="flex cursor-pointer list-none items-center gap-2 rounded-xl px-2.5 py-2 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/40 [&::-webkit-details-marker]:hidden">
                    <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open/service:rotate-90" />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{service.name}</span>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] tabular-nums text-muted-foreground">
                      {service.models.length}
                    </span>
                  </summary>
                  <div className="mb-1 ml-4 border-l border-border/70 pl-2">
                    {service.models.map((tool) => {
                      const selected = props.selected?.id === tool.id && props.selected.output === tool.output
                      const modelName = agentGenerationModelDisplayTitle(tool)
                      return (
                        <button
                          aria-checked={selected}
                          aria-label={`${modelName} by ${tool.pluginName}`}
                          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/40"
                          key={tool.id}
                          onClick={() => props.onSelect({ id: tool.id, output: activeOutput! })}
                          role="radio"
                          type="button"
                        >
                          <span className="min-w-0 flex-1 truncate text-sm">{modelName}</span>
                          {selected ? <Check className="size-4 shrink-0" /> : null}
                        </button>
                      )
                    })}
                  </div>
                </details>
              ))
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
