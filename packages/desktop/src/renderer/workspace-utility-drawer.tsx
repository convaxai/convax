import { SegmentedTabs, cn, useTemporarySurfaceFocus, type SegmentedTabItem } from "@convax/ui"
import { PanelRightClose } from "lucide-react"
import { useId, useLayoutEffect, useRef, type ComponentPropsWithoutRef, type ReactNode } from "react"
import type { WorkspaceVisiblePanelPresentation } from "./workspace-layout-model"
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
  onClose: () => void
}

export interface WorkspaceUtilityDrawerProps extends Omit<ComponentPropsWithoutRef<"aside">, "children" | "onChange"> {
  agent: (chrome: WorkspaceUtilityAgentChrome) => ReactNode
  closeLabel: string
  collapsedEntry?: ReactNode
  inspector?: ReactNode
  modal?: boolean
  mode: WorkspaceUtilityMode
  modes: readonly WorkspaceUtilityModeOption[]
  onClose: () => void
  onModeChange: (mode: WorkspaceUtilityActiveMode) => void
  presentation?: WorkspaceVisiblePanelPresentation
  resizeHandle?: ReactNode
  unavailableLabel?: string
}

/**
 * Desktop-owned composition for the existing Workbench Secondary Sidebar.
 *
 * The caller continues to own part visibility and width. Agent is deliberately
 * retained in one stable slot across modes; the Canvas-scoped Inspector mounts
 * only while active so stale content cannot outlive its scope.
 */
export function WorkspaceUtilityDrawer({
  agent,
  className,
  closeLabel,
  collapsedEntry,
  inspector,
  modal = false,
  mode,
  modes,
  onClose,
  onModeChange,
  presentation = "dock",
  resizeHandle,
  style,
  unavailableLabel = "This utility is unavailable.",
  ...props
}: WorkspaceUtilityDrawerProps) {
  const id = useId()
  const drawerRef = useRef<HTMLElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const restoreModeFocusRef = useRef(false)
  const wasOpenRef = useRef(false)
  const open = mode !== "closed"
  const activeMode: WorkspaceUtilityActiveMode | null = mode === "closed" ? null : mode
  const retainedModeRef = useRef<WorkspaceUtilityActiveMode>(activeMode ?? "agent")
  if (activeMode) retainedModeRef.current = activeMode
  const presentedMode = activeMode ?? (presentation === "dock" ? null : retainedModeRef.current)
  const activeOption = presentedMode ? modes.find((option) => option.value === presentedMode) : undefined
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
    presentedMode && items.length > 1 ? (
      <SegmentedTabs
        aria-label="Utility mode"
        className="min-w-0 flex-1"
        items={items}
        onValueChange={(nextMode) => {
          restoreModeFocusRef.current =
            document.activeElement instanceof HTMLElement &&
            document.activeElement.getAttribute("role") === "tab" &&
            Boolean(drawerRef.current?.contains(document.activeElement))
          onModeChange(nextMode)
        }}
        tabClassName="truncate px-2 py-1"
        value={presentedMode}
      />
    ) : null
  const agentChrome: WorkspaceUtilityAgentChrome = {
    closeLabel,
    modeNavigation: presentedMode === "agent" ? modeNavigation : null,
    onClose,
  }
  const agentContent = agent(agentChrome)
  const activeContent = presentedMode === "inspector" ? inspector : undefined

  useLayoutEffect(() => {
    if (typeof document === "undefined") return undefined
    if (open && !wasOpenRef.current) {
      const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null
      returnFocusRef.current = activeElement && !drawerRef.current?.contains(activeElement) ? activeElement : null
      queueMicrotask(() => {
        drawerRef.current
          ?.querySelector<HTMLElement>(
            '[data-workspace-utility-close], [role="tab"][aria-selected="true"], button:not([disabled])',
          )
          ?.focus()
      })
    } else if (!open && wasOpenRef.current) {
      const target = returnFocusRef.current
      returnFocusRef.current = null
      queueMicrotask(() => {
        if (target?.isConnected && !drawerRef.current?.contains(target)) target.focus()
      })
    }
    wasOpenRef.current = open
    if (!open || modal) return undefined
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !drawerRef.current?.contains(document.activeElement)) return
      event.preventDefault()
      event.stopPropagation()
      onClose()
    }
    document.addEventListener("keydown", handleKeyDown, true)
    return () => document.removeEventListener("keydown", handleKeyDown, true)
  }, [modal, onClose, open])

  useTemporarySurfaceFocus({
    containerRef: drawerRef,
    dismissOnEscape: true,
    onDismiss: onClose,
    open: open && modal,
    restoreFocus: false,
  })

  useLayoutEffect(() => {
    if (!restoreModeFocusRef.current) return
    restoreModeFocusRef.current = false
    drawerRef.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus()
  }, [presentedMode])

  return (
    <>
      {collapsedEntry ? (
        <div
          aria-hidden={open || undefined}
          className="workspace-utility-entry"
          data-workspace-utility-entry-state={open ? "hidden" : "visible"}
          inert={open || undefined}
        >
          {collapsedEntry}
        </div>
      ) : null}
      {open && modal ? (
        <button
          aria-hidden="true"
          className="workspace-utility-backdrop fixed inset-0 z-40 cursor-default bg-backdrop"
          onClick={onClose}
          tabIndex={-1}
          type="button"
        />
      ) : null}
      <aside
        aria-label="Workspace utilities"
        aria-modal={modal || undefined}
        className={cn(
          "workspace-utility-drawer relative z-40 flex min-h-0 shrink-0 flex-col overflow-hidden border-l border-border-subtle bg-surface-panel text-text-primary",
          presentation === "overlay" && "workspace-utility-drawer--overlay",
          presentation === "sheet" && "workspace-utility-drawer--sheet",
          !open && presentation === "dock" && "hidden",
          className,
        )}
        aria-hidden={!open || undefined}
        data-workspace-utility-drawer=""
        data-workspace-utility-mode={mode}
        data-workspace-utility-presentation={presentation}
        data-workspace-utility-state={open ? "open" : "closed"}
        hidden={!open && presentation === "dock"}
        inert={!open || undefined}
        ref={drawerRef}
        role={modal ? "dialog" : undefined}
        style={style}
        {...props}
      >
        {resizeHandle}
        <div
          aria-hidden={presentedMode !== "agent"}
          aria-label={modeLabel(
            modes.find((option) => option.value === "agent"),
            "Agent",
          )}
          className={cn("min-h-0 flex-1", presentedMode !== "agent" && "hidden")}
          data-workspace-utility-panel="agent"
          hidden={presentedMode !== "agent"}
          id={`${id}-agent-panel`}
          inert={presentedMode !== "agent" || undefined}
          role="tabpanel"
        >
          {agentContent}
        </div>
        {presentedMode === "inspector" ? (
          <section
            aria-label={modeNavigation ? undefined : modeLabel(activeOption, presentedMode)}
            aria-labelledby={modeNavigation ? `${id}-${presentedMode}-tab` : undefined}
            className="min-h-0 flex-1 overflow-y-auto"
            data-workspace-utility-panel={presentedMode}
            id={`${id}-${presentedMode}-panel`}
            role="tabpanel"
          >
            <WorkspaceUtilityContentHeader
              closeLabel={closeLabel}
              modeNavigation={modeNavigation}
              onClose={onClose}
            />
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

function WorkspaceUtilityContentHeader({
  closeLabel,
  modeNavigation,
  onClose,
}: {
  closeLabel: string
  modeNavigation: ReactNode
  onClose: () => void
}) {
  return (
    <header
      className="flex h-10 shrink-0 items-center gap-2 border-b border-border-subtle px-2.5"
      data-workspace-utility-content-header=""
    >
      {modeNavigation}
      <WorkspaceUtilityCollapseButton label={closeLabel} onClose={onClose} />
    </header>
  )
}

export function WorkspaceUtilityCollapseButton({
  label,
  onClose,
}: {
  label: string
  onClose: () => void
}) {
  return (
    <button
      aria-label={label}
      className="grid size-6 shrink-0 place-items-center rounded text-muted-foreground outline-none transition-colors duration-100 hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 motion-reduce:transition-none"
      data-workspace-utility-close=""
      onClick={onClose}
      title={label}
      type="button"
    >
      <PanelRightClose className="size-3.5" />
    </button>
  )
}
