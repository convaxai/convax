import {
  Button,
  SegmentedTabs,
  cn,
  useTemporarySurfaceFocus,
  type SegmentedTabItem,
} from "@convax/ui"
import { X } from "lucide-react"
import { useEffect, useId, useRef, type ComponentPropsWithoutRef, type ReactNode } from "react"
import type { WorkspaceUtilityMode } from "./workspace-utility-drawer-state"

export type WorkspaceUtilityActiveMode = Exclude<WorkspaceUtilityMode, "closed">

export interface WorkspaceUtilityModeOption {
  ariaLabel?: string
  disabled?: boolean
  label: ReactNode
  value: WorkspaceUtilityActiveMode
}

export interface WorkspaceUtilityAgentChrome {
  closeLabel: string
  modeNavigation: ReactNode | null
  onClose(): void
}

export interface WorkspaceUtilityDrawerProps
  extends Omit<ComponentPropsWithoutRef<"aside">, "children" | "onChange"> {
  agent(chrome: WorkspaceUtilityAgentChrome): ReactNode
  closeLabel: string
  collapsedEntry?: ReactNode
  generate?: ReactNode
  inspector?: ReactNode
  modal?: boolean
  mode: WorkspaceUtilityMode
  modes: readonly WorkspaceUtilityModeOption[]
  onClose(): void
  onModeChange(mode: WorkspaceUtilityActiveMode): void
  resizeHandle?: ReactNode
  unavailableLabel?: string
}

/**
 * Desktop-owned composition for the existing Workbench Secondary Sidebar.
 *
 * The caller continues to own part visibility and width. Agent is deliberately
 * retained in one stable slot across modes; Canvas-scoped utilities mount only
 * while active so stale Inspector/Generate content cannot outlive its scope.
 */
export function WorkspaceUtilityDrawer({
  agent,
  className,
  closeLabel,
  collapsedEntry,
  generate,
  inspector,
  modal = false,
  mode,
  modes,
  onClose,
  onModeChange,
  resizeHandle,
  style,
  unavailableLabel = "This utility is unavailable.",
  ...props
}: WorkspaceUtilityDrawerProps) {
  const id = useId()
  const drawerRef = useRef<HTMLElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const wasOpenRef = useRef(false)
  const open = mode !== "closed"
  const activeMode: WorkspaceUtilityActiveMode | null = mode === "closed" ? null : mode
  const activeOption = activeMode ? modes.find((option) => option.value === activeMode) : undefined
  const items = modes.map(
    (option): SegmentedTabItem<WorkspaceUtilityActiveMode> => ({
      ariaLabel: option.ariaLabel,
      disabled: option.disabled,
      id: `${id}-${option.value}-tab`,
      label: option.label,
      panelId: `${id}-${option.value}-panel`,
      value: option.value,
    }),
  )
  const modeNavigation =
    activeMode && items.length > 1 ? (
      <SegmentedTabs
        aria-label="Utility mode"
        className="min-w-0 flex-1"
        items={items}
        onValueChange={onModeChange}
        tabClassName="truncate px-2 py-1"
        value={activeMode}
      />
    ) : null
  const agentChrome: WorkspaceUtilityAgentChrome = {
    closeLabel,
    modeNavigation: null,
    onClose,
  }
  const agentContent = agent(agentChrome)
  const activeContent = activeMode === "inspector" ? inspector : undefined

  useTemporarySurfaceFocus({
    containerRef: drawerRef,
    dismissOnEscape: true,
    onDismiss: onClose,
    open: open && modal,
  })

  useEffect(() => {
    if (modal || typeof document === "undefined") return undefined
    if (open && !wasOpenRef.current) {
      returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      queueMicrotask(() => {
        drawerRef.current
          ?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"], button:not([disabled])')
          ?.focus()
      })
    } else if (!open && wasOpenRef.current && returnFocusRef.current?.isConnected) {
      const target = returnFocusRef.current
      queueMicrotask(() => target.focus())
    }
    wasOpenRef.current = open
    if (!open) return undefined
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !drawerRef.current?.contains(document.activeElement)) return
      event.preventDefault()
      event.stopPropagation()
      onClose()
    }
    document.addEventListener("keydown", handleKeyDown, true)
    return () => document.removeEventListener("keydown", handleKeyDown, true)
  }, [modal, onClose, open])

  return (
    <>
      {collapsedEntry ? (
        <div className={cn(open && "hidden")} hidden={open}>
          {collapsedEntry}
        </div>
      ) : null}
      {open && modal ? (
        <button
          aria-hidden="true"
          className="fixed inset-0 z-40 cursor-default bg-backdrop"
          onClick={onClose}
          tabIndex={-1}
          type="button"
        />
      ) : null}
      <aside
        aria-label="Workspace utilities"
        aria-modal={modal || undefined}
        className={cn(
          "relative z-40 flex min-h-0 shrink-0 flex-col overflow-hidden border-l border-border-subtle bg-surface-panel text-text-primary",
          !open && "hidden",
          className,
        )}
        data-workspace-utility-drawer=""
        data-workspace-utility-mode={mode}
        hidden={!open}
        ref={drawerRef}
        role={modal ? "dialog" : undefined}
        style={style}
        {...props}
      >
        {resizeHandle}
        <WorkspaceUtilityDrawerHeader
          closeLabel={closeLabel}
          modeNavigation={modeNavigation}
          onClose={onClose}
        />
        <div
          aria-hidden={activeMode !== "agent"}
          aria-label={modeLabel(
            modes.find((option) => option.value === "agent"),
            "Agent",
          )}
          className={cn("min-h-0 flex-1", activeMode !== "agent" && "hidden")}
          data-workspace-utility-panel="agent"
          hidden={activeMode !== "agent"}
          id={`${id}-agent-panel`}
          inert={activeMode !== "agent" || undefined}
          role="tabpanel"
        >
          {agentContent}
        </div>
        {generate ? (
          <section
            aria-hidden={activeMode !== "generate"}
            aria-labelledby={`${id}-generate-tab`}
            className={cn(
              "min-h-0 flex-1 overflow-y-auto",
              activeMode !== "generate" && "hidden",
            )}
            data-workspace-utility-panel="generate"
            hidden={activeMode !== "generate"}
            id={`${id}-generate-panel`}
            inert={activeMode !== "generate" || undefined}
            role="tabpanel"
          >
            {generate}
          </section>
        ) : activeMode === "generate" ? (
          <p className="grid min-h-32 place-items-center px-5 text-center text-xs text-text-tertiary" role="status">
            {unavailableLabel}
          </p>
        ) : null}
        {activeMode === "inspector" ? (
          <section
            aria-label={modeNavigation ? undefined : modeLabel(activeOption, activeMode)}
            aria-labelledby={modeNavigation ? `${id}-${activeMode}-tab` : undefined}
            className="min-h-0 flex-1 overflow-y-auto"
            data-workspace-utility-panel={activeMode}
            id={`${id}-${activeMode}-panel`}
            role="tabpanel"
          >
            {activeContent ?? (
              <p className="grid min-h-32 place-items-center px-5 text-center text-xs text-text-tertiary" role="status">
                {unavailableLabel}
              </p>
            )}
          </section>
        ) : null}
      </aside>
    </>
  )
}

function modeLabel(option: WorkspaceUtilityModeOption | undefined, fallback: string) {
  if (option?.ariaLabel) return option.ariaLabel
  return typeof option?.label === "string" ? option.label : fallback
}

function WorkspaceUtilityDrawerHeader({
  closeLabel,
  modeNavigation,
  onClose,
}: {
  closeLabel: string
  modeNavigation: ReactNode
  onClose(): void
}) {
  return (
    <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border-subtle px-2.5">
      {modeNavigation}
      <Button
        aria-label={closeLabel}
        className="size-7 rounded-md text-text-tertiary active:scale-[0.96] [&_svg]:size-3.5"
        onClick={onClose}
        size="icon-sm"
        variant="ghost"
      >
        <X />
      </Button>
    </header>
  )
}
