import type { ComponentPropsWithoutRef, KeyboardEvent, ReactNode } from "react"
import { cn } from "../lib/utils"

export interface SegmentedTabItem<Value extends string> {
  /** Accessible name override for labels that are not plain text. */
  ariaLabel?: string
  disabled?: boolean
  /** Optional tab id used by an associated tab panel. */
  id?: string
  label: ReactNode
  /** Optional id of the tab panel controlled by this tab. */
  panelId?: string
  value: Value
}

export interface SegmentedTabsProps<Value extends string>
  extends Omit<ComponentPropsWithoutRef<"div">, "children" | "onChange"> {
  items: readonly SegmentedTabItem<Value>[]
  onValueChange: (value: Value) => void
  orientation?: "horizontal" | "vertical"
  tabClassName?: string
  value: Value
}

function enabledIndex<Value extends string>(
  items: readonly SegmentedTabItem<Value>[],
  start: number,
  direction: 1 | -1,
) {
  if (!items.some((item) => !item.disabled)) return -1
  let index = start
  for (let visited = 0; visited < items.length; visited += 1) {
    index = (index + direction + items.length) % items.length
    if (!items[index]?.disabled) return index
  }
  return -1
}

function edgeEnabledIndex<Value extends string>(items: readonly SegmentedTabItem<Value>[], edge: "first" | "last") {
  const start = edge === "first" ? -1 : 0
  return enabledIndex(items, start, edge === "first" ? 1 : -1)
}

/**
 * A controlled, automatically activated tab list with a compact segmented style.
 * Consumers own the associated tab panels and can link them with item `id` and
 * `panelId` values.
 */
export function SegmentedTabs<Value extends string>({
  className,
  items,
  onValueChange,
  orientation = "horizontal",
  tabClassName,
  value,
  ...props
}: SegmentedTabsProps<Value>) {
  const selectedIndex = items.findIndex((item) => item.value === value)
  const selectedEnabled = selectedIndex >= 0 && !items[selectedIndex]?.disabled
  const rovingIndex = selectedEnabled ? selectedIndex : edgeEnabledIndex(items, "first")

  const moveFocus = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let targetIndex = -1
    if (event.key === "Home") targetIndex = edgeEnabledIndex(items, "first")
    else if (event.key === "End") targetIndex = edgeEnabledIndex(items, "last")
    else if (
      (orientation === "horizontal" && event.key === "ArrowRight") ||
      (orientation === "vertical" && event.key === "ArrowDown")
    )
      targetIndex = enabledIndex(items, index, 1)
    else if (
      (orientation === "horizontal" && event.key === "ArrowLeft") ||
      (orientation === "vertical" && event.key === "ArrowUp")
    )
      targetIndex = enabledIndex(items, index, -1)
    else return

    if (targetIndex < 0) return
    event.preventDefault()
    const list = event.currentTarget.parentElement
    const tab = list?.children.item(targetIndex)
    if (tab && "focus" in tab && typeof tab.focus === "function") tab.focus()
    const target = items[targetIndex]
    if (target && target.value !== value) onValueChange(target.value)
  }

  return (
    <div
      {...props}
      aria-orientation={orientation}
      className={cn(
        "grid rounded-lg bg-surface-inset p-0.5",
        orientation === "horizontal" ? "auto-cols-fr grid-flow-col" : "grid-flow-row",
        className,
      )}
      data-slot="segmented-tabs-list"
      role="tablist"
    >
      {items.map((item, index) => {
        const selected = index === selectedIndex
        return (
          <button
            aria-controls={item.panelId}
            aria-label={item.ariaLabel}
            aria-selected={selected}
            className={cn(
              "min-w-0 rounded-md border border-transparent px-2 py-1.5 text-xs text-text-secondary outline-none hover:bg-interactive-hover hover:text-text-primary active:bg-interactive-pressed data-[state=active]:border-interactive-selected-border data-[state=active]:bg-interactive-selected data-[state=active]:font-medium data-[state=active]:text-text-primary data-[state=active]:shadow-sm focus-visible:ring-2 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-45",
              tabClassName,
            )}
            data-slot="segmented-tabs-trigger"
            data-state={selected ? "active" : "inactive"}
            data-ui-interactive=""
            disabled={item.disabled}
            id={item.id}
            key={item.value}
            onClick={() => {
              if (!item.disabled && item.value !== value) onValueChange(item.value)
            }}
            onKeyDown={(event) => moveFocus(event, index)}
            role="tab"
            tabIndex={index === rovingIndex ? 0 : -1}
            type="button"
          >
            {item.label}
          </button>
        )
      })}
    </div>
  )
}
