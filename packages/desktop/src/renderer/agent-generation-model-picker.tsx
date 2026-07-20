import type {
  GenerationToolDescription,
  GenerationToolInput,
  GenerationToolInputValue,
  GenerationToolSummary,
} from "../generation-contracts"
import { SegmentedTabs, ToolInputForm, type SegmentedTabItem } from "@convax/ui"
import { Check, LoaderCircle } from "lucide-react"
import { useEffect, useId, useRef } from "react"
import {
  agentGenerationOutputs,
  agentGenerationToolsForOutput,
  type AgentGenerationOutput,
  type AgentGenerationToolSelection,
} from "./agent-generation-models"

export interface AgentGenerationModelPickerProps {
  activeOutput: AgentGenerationOutput
  error?: string
  loading: boolean
  description?: GenerationToolDescription
  descriptionError?: string
  descriptionLoading?: boolean
  onClose(): void
  onOutputChange(output: AgentGenerationOutput): void
  onSelect(selection?: AgentGenerationToolSelection): void
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

export function AgentGenerationModelPicker(props: AgentGenerationModelPickerProps) {
  const instanceId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const outputTabs = agentGenerationOutputs.map((output) => ({
    id: `${instanceId}-agent-generation-model-tab-${output}`,
    label: outputLabels[output],
    panelId: `${instanceId}-agent-generation-model-panel-${output}`,
    value: output,
  })) satisfies readonly SegmentedTabItem<AgentGenerationOutput>[]
  const tools = agentGenerationToolsForOutput(props.tools, props.activeOutput)
  const activeTab = outputTabs.find((tab) => tab.value === props.activeOutput)!

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialogRef.current?.focus({ preventScroll: true })
    return () => previousFocus?.focus({ preventScroll: true })
  }, [])

  return (
    <div
      aria-label="Generation models"
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
        <span className="text-[10px] text-muted-foreground">Installed tools</span>
      </div>
      <SegmentedTabs
        aria-label="Generation media type"
        items={outputTabs}
        onValueChange={(output) => props.onOutputChange(output)}
        value={props.activeOutput}
      />
      <div
        aria-labelledby={activeTab.id}
        className="mt-2 max-h-64 space-y-0.5 overflow-y-auto"
        id={activeTab.panelId}
        role="tabpanel"
      >
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
          ) : tools.length === 0 ? (
            <div className="px-2.5 py-3 text-xs text-muted-foreground">
              No installed {outputLabels[props.activeOutput].toLocaleLowerCase()} generation tools.
            </div>
          ) : (
            tools.map((tool) => {
              const selected = props.selected?.id === tool.id && props.selected.output === tool.output
              return (
                <button
                  aria-checked={selected}
                  aria-label={`${tool.title} by ${tool.pluginName}`}
                  className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/40"
                  key={tool.id}
                  onClick={() => props.onSelect({ id: tool.id, output: props.activeOutput })}
                  role="radio"
                  type="button"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{tool.title}</span>
                    <span className="block truncate text-[10px] text-muted-foreground">{tool.pluginName}</span>
                  </span>
                  {selected ? <Check className="size-4 shrink-0" /> : null}
                </button>
              )
            })
          )}
        </div>
      </div>
      {props.selected?.output === props.activeOutput ? (
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
