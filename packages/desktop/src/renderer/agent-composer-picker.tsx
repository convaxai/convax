import type { AgentResource } from "@convax/agent-runtime"
import {
  ChevronRight,
  ExternalLink,
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
import { useCallback, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import type { AgentReferenceTreeRow, AgentReferenceTreeStatus } from "./agent-composer-tree"

export interface AgentComposerPickerAnchor {
  aboveSpace: number
  aboveTop: number
  belowSpace: number
  belowTop: number
  left: number
}

interface AgentComposerPickerPosition {
  left: number
  placement: "above" | "below"
  top: number
}

export function createAgentComposerPickerAnchor(
  anchor: Pick<DOMRect, "bottom" | "height" | "left" | "top" | "width">,
  fallback: Pick<DOMRect, "bottom" | "height" | "left" | "top" | "width">,
  viewport: { height: number; width: number },
): AgentComposerPickerAnchor {
  const target = anchor.width || anchor.height ? anchor : fallback
  const gap = 8
  const pickerWidth = Math.min(352, Math.max(0, viewport.width - gap * 2))
  const left = Math.max(gap, Math.min(target.left, viewport.width - pickerWidth - gap))
  const aboveSpace = Math.max(0, target.top - gap)
  const belowSpace = Math.max(0, viewport.height - target.bottom - gap)
  return {
    aboveSpace,
    aboveTop: Math.max(gap, Math.min(target.top - gap, viewport.height - gap)),
    belowSpace,
    belowTop: Math.max(gap, Math.min(target.bottom + gap, viewport.height - gap)),
    left,
  }
}

export function positionAgentComposerPicker(
  anchor: AgentComposerPickerAnchor,
  pickerHeight: number,
): AgentComposerPickerPosition {
  const aboveFits = pickerHeight <= anchor.aboveSpace
  const belowFits = pickerHeight <= anchor.belowSpace
  const placement = aboveFits
    ? "above"
    : belowFits
      ? "below"
      : anchor.aboveSpace >= anchor.belowSpace
        ? "above"
        : "below"
  return {
    left: anchor.left,
    placement,
    top: placement === "above" ? anchor.aboveTop : anchor.belowTop,
  }
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
  onElementChange?: (element: HTMLDivElement | null) => void
  onHoverChange: (id: string | undefined) => void
  onOpenSkill: (name: string) => void | Promise<void>
  onReferenceTabChange: (tab: "canvas" | "project") => void
  onReferenceRetry: (option: Extract<AgentComposerPickerOption, { optionType: "reference" }>) => void
  onRetry?: () => void
  onSelect: (option: AgentComposerPickerOption) => void
  onToggle: (option: Extract<AgentComposerPickerOption, { optionType: "reference" }>) => void
  options: readonly AgentComposerPickerOption[]
  referenceTab: "canvas" | "project"
  referenceStatusById?: ReadonlyMap<string, AgentReferenceTreeStatus>
  trigger: "reference" | "skill"
}

export function agentComposerPickerOptionId(optionId: string) {
  return `agent-composer-option-${optionId}`
}

export function AgentComposerPicker(props: AgentComposerPickerProps) {
  const skill = props.trigger === "skill"
  const pickerId = `agent-composer-${props.trigger}-picker`
  const pickerRef = useRef<HTMLDivElement>(null)
  const [pickerHeight, setPickerHeight] = useState(0)
  const position = positionAgentComposerPicker(props.anchor, pickerHeight)
  const setPickerRef = useCallback(
    (element: HTMLDivElement | null) => {
      pickerRef.current = element
      props.onElementChange?.(element)
    },
    [props.onElementChange],
  )

  useLayoutEffect(() => {
    const picker = pickerRef.current
    if (!picker) return
    const updateHeight = () => setPickerHeight(picker.getBoundingClientRect().height)
    updateHeight()
    const observer = new ResizeObserver(updateHeight)
    observer.observe(picker)
    return () => observer.disconnect()
  }, [])

  const picker = (
    <div
      className="fixed z-50 max-h-80 w-[min(22rem,calc(100vw-1rem))] overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-xl"
      data-agent-composer-picker
      id={pickerId}
      onPointerDown={(event) => event.preventDefault()}
      onPointerLeave={() => props.onHoverChange(undefined)}
      ref={setPickerRef}
      style={{
        left: position.left,
        top: position.top,
        transform: position.placement === "above" ? "translateY(-100%)" : undefined,
      }}
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
                onOpenSkill={props.onOpenSkill}
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
                onRetry={props.onReferenceRetry}
                status={props.referenceStatusById?.get(option.id)}
              />
            ),
          )
        ) : (
          <PickerStatus>{skill ? "No Skills found" : "No references found"}</PickerStatus>
        )}
      </div>
    </div>
  )
  return typeof document === "undefined" ? picker : createPortal(picker, document.body)
}

function SkillOption(props: {
  active: boolean
  onHoverChange: (id: string | undefined) => void
  onOpenSkill: (name: string) => void | Promise<void>
  onSelect: (option: AgentComposerPickerOption) => void
  option: Extract<AgentComposerPickerOption, { optionType: "skill" }>
}) {
  return (
    <div
      aria-selected={props.active}
      className={`flex items-center rounded-md ${props.active ? "bg-accent text-accent-foreground" : "hover:bg-muted"}`}
      data-agent-composer-option={props.option.id}
      id={agentComposerPickerOptionId(props.option.id)}
      onPointerEnter={() => props.onHoverChange(props.option.id)}
      role="option"
    >
      <button className={rowClassName(false)} onClick={() => props.onSelect(props.option)} type="button">
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
      <button
        aria-label={`Open Skill ${props.option.label}`}
        className="mr-1 grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground outline-none hover:bg-background/70 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
        onClick={() => void props.onOpenSkill(props.option.label)}
        title={`Open ${props.option.label} Skill`}
        type="button"
      >
        <ExternalLink aria-hidden="true" className="size-3.5" />
      </button>
    </div>
  )
}

function ReferenceOption(props: {
  active: boolean
  onHoverChange: (id: string | undefined) => void
  onSelect: (option: AgentComposerPickerOption) => void
  onToggle: (option: Extract<AgentComposerPickerOption, { optionType: "reference" }>) => void
  onRetry: (option: Extract<AgentComposerPickerOption, { optionType: "reference" }>) => void
  option: Extract<AgentComposerPickerOption, { optionType: "reference" }>
  status?: AgentReferenceTreeStatus
}) {
  const option = props.option
  return (
    <div role="none">
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
      {option.expanded && props.status?.loading ? (
        <div
          className="flex items-center gap-2 px-2 py-1.5 text-[10px] text-muted-foreground"
          role="status"
          style={{ paddingLeft: `${(option.depth + 1) * 14 + 24}px` }}
        >
          <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />
          <span>Loading {option.label}…</span>
        </div>
      ) : option.expanded && props.status?.error ? (
        <div
          className="flex items-center gap-2 px-2 py-1.5 text-[10px] text-destructive"
          role="alert"
          style={{ paddingLeft: `${(option.depth + 1) * 14 + 24}px` }}
        >
          <span className="min-w-0 flex-1">{props.status.error}</span>
          <button
            aria-label={`Retry loading ${option.label}`}
            className="grid size-6 shrink-0 place-items-center rounded-md text-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/40"
            onClick={() => props.onRetry(option)}
            type="button"
          >
            <RotateCcw aria-hidden="true" className="size-3.5" />
          </button>
        </div>
      ) : null}
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
          aria-label="Retry loading suggestions"
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
