import {
  useDeferredValue,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react"
import { Search } from "lucide-react"
import { cn } from "../lib/utils"
import { Dialog, DialogContent } from "./dialog"

export interface CommandMenuItem {
  description?: ReactNode
  disabled?: boolean
  icon?: ReactNode
  id: string
  keywords?: readonly string[]
  label: ReactNode
  searchText?: string
  shortcut?: ReactNode
}

export interface CommandMenuProps {
  "aria-label": string
  closeOnSelect?: boolean
  defaultQuery?: string
  emptyText?: ReactNode
  items: readonly CommandMenuItem[]
  onOpenChange: (open: boolean) => void
  onQueryChange?: (query: string) => void
  onSelect: (item: CommandMenuItem) => void
  open: boolean
  placeholder?: string
  query?: string
}

function normalizedSearchText(item: CommandMenuItem) {
  if (item.searchText) return item.searchText.toLocaleLowerCase()
  const label = typeof item.label === "string" || typeof item.label === "number" ? String(item.label) : ""
  return [label, ...(item.keywords ?? [])].join(" ").toLocaleLowerCase()
}

function nextEnabledIndex(items: readonly CommandMenuItem[], start: number, direction: 1 | -1) {
  if (!items.some((item) => !item.disabled)) return -1
  let index = start
  for (let visited = 0; visited < items.length; visited += 1) {
    index = (index + direction + items.length) % items.length
    if (!items[index]?.disabled) return index
  }
  return -1
}

export function CommandMenu({
  "aria-label": ariaLabel,
  closeOnSelect = true,
  defaultQuery = "",
  emptyText = "No matching commands",
  items,
  onOpenChange,
  onQueryChange,
  onSelect,
  open,
  placeholder = "Search commands",
  query: controlledQuery,
}: CommandMenuProps) {
  const [uncontrolledQuery, setUncontrolledQuery] = useState(defaultQuery)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [composing, setComposing] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const listId = useId()
  const query = controlledQuery ?? uncontrolledQuery
  const deferredQuery = useDeferredValue(query)
  const filteredItems = useMemo(() => {
    const needle = deferredQuery.trim().toLocaleLowerCase()
    if (!needle) return items
    return items.filter((item) => normalizedSearchText(item).includes(needle))
  }, [deferredQuery, items])

  useEffect(() => {
    if (!open) return
    setActiveIndex(nextEnabledIndex(filteredItems, -1, 1))
  }, [filteredItems, open])

  const setQuery = (nextQuery: string) => {
    if (controlledQuery === undefined) setUncontrolledQuery(nextQuery)
    onQueryChange?.(nextQuery)
  }
  const select = (item: CommandMenuItem | undefined) => {
    if (!item || item.disabled) return
    onSelect(item)
    if (closeOnSelect) onOpenChange(false)
  }
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (composing || event.nativeEvent.isComposing) return
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault()
      setActiveIndex((current) =>
        nextEnabledIndex(filteredItems, current, event.key === "ArrowDown" ? 1 : -1),
      )
      return
    }
    if (event.key === "Enter") {
      event.preventDefault()
      select(filteredItems[activeIndex])
    }
  }

  return (
    <Dialog initialFocusRef={inputRef} onOpenChange={onOpenChange} open={open}>
      <DialogContent
        aria-label={ariaLabel}
        aria-labelledby={undefined}
        className="overflow-hidden p-0"
        data-slot="command-menu"
      >
        <div className="flex min-h-12 items-center gap-3 border-b border-border-subtle px-4">
          <Search aria-hidden="true" className="size-4 shrink-0 text-text-tertiary" />
          <input
            aria-activedescendant={activeIndex >= 0 ? `command-menu-item-${filteredItems[activeIndex]?.id}` : undefined}
            aria-autocomplete="list"
            aria-controls={listId}
            aria-expanded="true"
            className="h-12 min-w-0 flex-1 bg-transparent text-sm text-text-primary outline-none placeholder:text-text-tertiary"
            onChange={(event) => setQuery(event.currentTarget.value)}
            onCompositionEnd={() => setComposing(false)}
            onCompositionStart={() => setComposing(true)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            ref={inputRef}
            role="combobox"
            value={query}
          />
        </div>
        <div
          aria-label={ariaLabel}
          className="max-h-80 overflow-y-auto p-1.5"
          data-slot="command-menu-list"
          id={listId}
          role="listbox"
        >
          {filteredItems.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-text-tertiary" data-slot="command-menu-empty">
              {emptyText}
            </div>
          ) : (
            filteredItems.map((item, index) => {
              const active = index === activeIndex
              return (
                <button
                  aria-disabled={item.disabled || undefined}
                  aria-selected={active}
                  className={cn(
                    "flex min-h-10 w-full items-center gap-3 rounded-md border border-transparent px-3 py-2 text-left text-sm text-text-primary outline-none",
                    "hover:bg-interactive-hover active:bg-interactive-pressed focus-visible:ring-2 focus-visible:ring-focus-ring/40",
                    active && "border-interactive-selected-border bg-interactive-selected",
                    item.disabled && "pointer-events-none opacity-45",
                  )}
                  data-slot="command-menu-item"
                  data-ui-interactive=""
                  id={`command-menu-item-${item.id}`}
                  key={item.id}
                  onClick={() => select(item)}
                  onMouseEnter={() => {
                    if (!item.disabled) setActiveIndex(index)
                  }}
                  role="option"
                  tabIndex={-1}
                  type="button"
                >
                  {item.icon ? (
                    <span aria-hidden="true" className="grid size-5 shrink-0 place-items-center text-text-secondary">
                      {item.icon}
                    </span>
                  ) : null}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{item.label}</span>
                    {item.description ? (
                      <span className="mt-0.5 block truncate text-xs text-text-tertiary">{item.description}</span>
                    ) : null}
                  </span>
                  {item.shortcut ? (
                    <span className="shrink-0 text-[11px] text-text-tertiary">{item.shortcut}</span>
                  ) : null}
                </button>
              )
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
