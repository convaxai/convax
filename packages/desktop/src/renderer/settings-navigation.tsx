import { Input, cn } from "@convax/ui"
import { Search } from "lucide-react"
import { useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react"

export interface SettingsNavigationEntry<Value extends string> {
  readonly description?: string
  readonly icon: ReactNode
  readonly label: string
  readonly value: Value
}

export interface SettingsNavigationProps<Value extends string> {
  ariaLabel: string
  className?: string
  emptyLabel: string
  items: readonly SettingsNavigationEntry<Value>[]
  onValueChange: (value: Value) => void
  searchLabel: string
  value: Value
}

export function filterSettingsNavigationItems<Value extends string>(
  items: readonly SettingsNavigationEntry<Value>[],
  query: string,
) {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  if (!normalizedQuery) return items
  return items.filter((item) => `${item.label} ${item.description ?? ""}`.toLocaleLowerCase().includes(normalizedQuery))
}

export function SettingsNavigation<Value extends string>({
  ariaLabel,
  className,
  emptyLabel,
  items,
  onValueChange,
  searchLabel,
  value,
}: SettingsNavigationProps<Value>) {
  const [query, setQuery] = useState("")
  const navigationRef = useRef<HTMLElement>(null)
  const visibleItems = useMemo(() => filterSettingsNavigationItems(items, query), [items, query])

  const moveFocus = (event: KeyboardEvent<HTMLButtonElement>, itemIndex: number) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) || visibleItems.length === 0) return
    event.preventDefault()
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? visibleItems.length - 1
          : (itemIndex + (event.key === "ArrowDown" ? 1 : -1) + visibleItems.length) % visibleItems.length
    const nextButton = navigationRef.current?.querySelectorAll<HTMLButtonElement>("[data-settings-navigation-item]")[
      nextIndex
    ]
    nextButton?.focus()
  }

  return (
    <div className={cn("min-h-0", className)}>
      <label className="relative block">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2 text-text-tertiary"
        />
        <span className="sr-only">{searchLabel}</span>
        <Input
          aria-label={searchLabel}
          className="convax-settings-search__input h-9 border-border-subtle bg-control-background text-xs text-text-primary shadow-none focus-visible:border-interactive-selected-border focus-visible:ring-[1px] focus-visible:ring-focus-ring/45"
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder={searchLabel}
          role="searchbox"
          type="text"
          value={query}
        />
      </label>
      <nav aria-label={ariaLabel} className="mt-4 space-y-0.5" ref={navigationRef}>
        {visibleItems.map((item, index) => {
          const active = item.value === value
          return (
            <button
              aria-current={active ? "page" : undefined}
              className={cn(
                "group flex min-h-10 w-full items-center gap-2.5 rounded-lg border border-transparent px-2.5 py-1.5 text-left text-sm font-medium outline-none transition-[color,background-color,transform] duration-100 active:scale-[0.98]",
                active
                  ? "border-interactive-selected-border bg-interactive-selected text-text-primary"
                  : "text-text-secondary hover:bg-interactive-hover hover:text-text-primary active:bg-interactive-pressed",
                "focus-visible:ring-2 focus-visible:ring-focus-ring/45",
              )}
              data-settings-navigation-item={item.value}
              key={item.value}
              onClick={() => onValueChange(item.value)}
              onKeyDown={(event) => moveFocus(event, index)}
              type="button"
            >
              <span
                aria-hidden="true"
                className={cn(
                  "grid size-6 shrink-0 place-items-center rounded-md [&>svg]:size-3.5",
                  active
                    ? "text-brand"
                    : "text-text-tertiary group-hover:text-text-primary",
                )}
              >
                {item.icon}
              </span>
              <span className="min-w-0 truncate">{item.label}</span>
            </button>
          )
        })}
        {visibleItems.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs leading-5 text-text-tertiary" role="status">
            {emptyLabel}
          </p>
        ) : null}
      </nav>
    </div>
  )
}
