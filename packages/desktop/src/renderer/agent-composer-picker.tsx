import type { AgentResource } from "@convax/agent-runtime"
import {
  ChevronRight,
  FileText,
  Folder,
  Layers3,
  LoaderCircle,
  PanelsTopLeft,
  RotateCcw,
  Sparkles,
  Square,
  X,
} from "lucide-react"
import type { AgentReferenceTreeRow } from "./agent-composer-tree"

export interface AgentComposerPickerAnchor {
  left: number
  top: number
}

export type AgentComposerPickerOption =
  | (AgentReferenceTreeRow & { optionType: "reference" })
  | {
      description?: string
      id: string
      label: string
      optionType: "skill"
      resource: Extract<AgentResource, { kind: "skill" }>
    }

export interface AgentComposerPickerProps {
  activeId?: string
  anchor: AgentComposerPickerAnchor
  error?: string
  loading?: boolean
  onClose: () => void
  onHoverChange: (id: string | undefined) => void
  onReferenceTabChange: (tab: "canvas" | "project") => void
  onRetry?: () => void
  onSelect: (option: AgentComposerPickerOption) => void
  onToggle: (option: Extract<AgentComposerPickerOption, { optionType: "reference" }>) => void
  options: readonly AgentComposerPickerOption[]
  referenceTab: "canvas" | "project"
  trigger: "reference" | "skill"
}

export function agentComposerPickerOptionId(optionId: string) {
  return `agent-composer-option-${optionId}`
}

export function AgentComposerPicker(props: AgentComposerPickerProps) {
  const skill = props.trigger === "skill"
  const pickerId = `agent-composer-${props.trigger}-picker`
  return (
    <div
      className="fixed z-50 max-h-80 w-[min(22rem,calc(100vw-1rem))] overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-xl"
      data-agent-composer-picker
      id={pickerId}
      onPointerDown={(event) => event.preventDefault()}
      onPointerLeave={() => props.onHoverChange(undefined)}
      style={{ left: props.anchor.left, top: props.anchor.top }}
    >
      <div className="flex items-center gap-2 border-b border-border px-2 py-1.5">
        {skill ? (
          <div className="flex min-w-0 flex-1 items-center gap-1.5 px-1 text-xs font-medium">
            <Sparkles aria-hidden="true" className="size-3.5 text-primary" />
            <span>Skills</span>
          </div>
        ) : (
          <div aria-label="Reference source" className="flex min-w-0 flex-1 gap-1" role="tablist">
            {(["project", "canvas"] as const).map((tab) => (
              <button
                aria-controls={`${pickerId}-${tab}`}
                aria-selected={props.referenceTab === tab}
                className={
                  props.referenceTab === tab
                    ? "rounded-md bg-accent px-2 py-1 text-xs font-medium text-accent-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                    : "rounded-md px-2 py-1 text-xs text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
                }
                key={tab}
                onClick={() => props.onReferenceTabChange(tab)}
                role="tab"
                type="button"
              >
                {tab === "project" ? "Project" : "Canvas"}
              </button>
            ))}
          </div>
        )}
        <button
          aria-label="Close suggestions"
          className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
          onClick={props.onClose}
          type="button"
        >
          <X aria-hidden="true" className="size-3.5" />
        </button>
      </div>

      <div
        className="max-h-64 overflow-y-auto p-1.5"
        id={skill ? pickerId : `${pickerId}-${props.referenceTab}`}
        role={skill ? "listbox" : "tree"}
      >
        {props.loading ? (
          <PickerStatus icon={<LoaderCircle aria-hidden="true" className="size-4 animate-spin" />}>
            Loading {skill ? "Skills" : props.referenceTab === "project" ? "Project references" : "Canvas references"}…
          </PickerStatus>
        ) : props.error ? (
          <PickerError message={props.error} onRetry={props.onRetry} />
        ) : props.options.length ? (
          props.options.map((option) =>
            option.optionType === "skill" ? (
              <SkillOption
                active={props.activeId === option.id}
                key={option.id}
                onHoverChange={props.onHoverChange}
                onSelect={props.onSelect}
                option={option}
              />
            ) : (
              <ReferenceOption
                active={props.activeId === option.id}
                key={option.id}
                onHoverChange={props.onHoverChange}
                onSelect={props.onSelect}
                onToggle={props.onToggle}
                option={option}
              />
            ),
          )
        ) : (
          <PickerStatus>{skill ? "No Skills found" : "No references found"}</PickerStatus>
        )}
      </div>
    </div>
  )
}

function SkillOption(props: {
  active: boolean
  onHoverChange: (id: string | undefined) => void
  onSelect: (option: AgentComposerPickerOption) => void
  option: Extract<AgentComposerPickerOption, { optionType: "skill" }>
}) {
  return (
    <button
      aria-selected={props.active}
      className={rowClassName(props.active)}
      data-agent-composer-option={props.option.id}
      id={agentComposerPickerOptionId(props.option.id)}
      onClick={() => props.onSelect(props.option)}
      onPointerEnter={() => props.onHoverChange(props.option.id)}
      role="option"
      type="button"
    >
      <Sparkles aria-hidden="true" className="size-4 shrink-0 text-primary" />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">${props.option.label}</span>
        {props.option.description ? (
          <span className="mt-0.5 block line-clamp-2 text-[10px] leading-4 text-muted-foreground">
            {props.option.description}
          </span>
        ) : null}
      </span>
    </button>
  )
}

function ReferenceOption(props: {
  active: boolean
  onHoverChange: (id: string | undefined) => void
  onSelect: (option: AgentComposerPickerOption) => void
  onToggle: (option: Extract<AgentComposerPickerOption, { optionType: "reference" }>) => void
  option: Extract<AgentComposerPickerOption, { optionType: "reference" }>
}) {
  const option = props.option
  return (
    <div
      aria-expanded={option.expandable ? option.expanded : undefined}
      aria-level={option.depth + 1}
      aria-selected={props.active}
      className={`flex items-center rounded-md ${props.active ? "bg-accent text-accent-foreground" : "hover:bg-muted"}`}
      data-agent-composer-option={option.id}
      id={agentComposerPickerOptionId(option.id)}
      onPointerEnter={() => props.onHoverChange(option.id)}
      role="treeitem"
      style={{ paddingLeft: `${option.depth * 14}px` }}
    >
      {option.expandable ? (
        <button
          aria-label={`${option.expanded ? "Collapse" : "Expand"} ${option.label}`}
          className="grid size-6 shrink-0 place-items-center rounded outline-none hover:bg-background/70 focus-visible:ring-2 focus-visible:ring-ring/40"
          onClick={() => props.onToggle(option)}
          type="button"
        >
          <ChevronRight
            aria-hidden="true"
            className={`size-3.5 transition-transform ${option.expanded ? "rotate-90" : ""}`}
          />
        </button>
      ) : (
        <span className="size-6 shrink-0" />
      )}
      <button className={rowClassName(false)} onClick={() => props.onSelect(option)} type="button">
        <ReferenceIcon option={option} />
        <span className="min-w-0 flex-1 text-left">
          <span className="block truncate font-medium">{option.label}</span>
          {option.description ? (
            <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">{option.description}</span>
          ) : null}
        </span>
      </button>
    </div>
  )
}

function ReferenceIcon(props: { option: Extract<AgentComposerPickerOption, { optionType: "reference" }> }) {
  const className = "size-4 shrink-0 text-muted-foreground"
  if (props.option.kind === "directory") return <Folder aria-hidden="true" className={className} />
  if (props.option.kind === "file") return <FileText aria-hidden="true" className={className} />
  if (props.option.kind === "canvas") return <PanelsTopLeft aria-hidden="true" className={className} />
  if (props.option.kind === "group") return <Layers3 aria-hidden="true" className={className} />
  return <Square aria-hidden="true" className={className} />
}

function PickerError(props: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex items-center gap-2 rounded-lg px-2.5 py-3 text-xs text-destructive">
      <span className="min-w-0 flex-1">{props.message}</span>
      {props.onRetry ? (
        <button
          className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/40"
          onClick={props.onRetry}
          type="button"
        >
          <RotateCcw aria-hidden="true" className="size-3.5" />
          Retry
        </button>
      ) : null}
    </div>
  )
}

function PickerStatus(props: { children: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-center gap-2 px-3 py-6 text-xs text-muted-foreground">
      {props.icon}
      <span>{props.children}</span>
    </div>
  )
}

function rowClassName(active: boolean) {
  return `flex w-full min-w-0 items-start gap-2 rounded-md px-2 py-1.5 text-left text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/40 ${
    active ? "bg-accent text-accent-foreground" : "hover:bg-muted"
  }`
}
