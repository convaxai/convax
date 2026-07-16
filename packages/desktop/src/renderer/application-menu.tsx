import { cn } from "@convax/ui"
import { ChevronUp, Settings2, Sparkles } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { appMessage, type AppLocale } from "./app-language"

export type ApplicationMenuTarget = "general" | "capabilities"

interface ApplicationMenuProps {
  compact?: boolean
  locale: AppLocale
  onOpenSettings(target: ApplicationMenuTarget): void
}

interface MenuPosition {
  bottom: number
  left: number
}

export function ApplicationMenuPanel({
  locale,
  onOpenSettings,
  panelRef,
  position,
}: {
  locale: AppLocale
  onOpenSettings(target: ApplicationMenuTarget): void
  panelRef?: React.Ref<HTMLDivElement>
  position?: MenuPosition
}) {
  return (
    <div
      aria-label={appMessage(locale, "appMenu.open")}
      className="z-[80] w-72 overflow-hidden rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-2xl"
      ref={panelRef}
      role="menu"
      style={position ? { bottom: position.bottom, left: position.left, position: "fixed" } : undefined}
    >
      <div className="flex items-center gap-3 px-2.5 py-2.5">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary text-xs font-bold text-primary-foreground">CX</span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{appMessage(locale, "appMenu.localWorkspace")}</p>
          <p className="truncate text-[11px] text-muted-foreground">{appMessage(locale, "appMenu.localWorkspaceDescription")}</p>
        </div>
      </div>
      <div className="my-1 h-px bg-border" />
      <button
        className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-ring/40"
        onClick={() => onOpenSettings("general")}
        role="menuitem"
        type="button"
      >
        <Settings2 className="size-4 text-muted-foreground" />
        <span className="flex-1">{appMessage(locale, "appMenu.settings")}</span>
        <kbd className="text-[10px] text-muted-foreground">⌘/Ctrl ,</kbd>
      </button>
      <button
        className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-ring/40"
        onClick={() => onOpenSettings("capabilities")}
        role="menuitem"
        type="button"
      >
        <Sparkles className="size-4 text-muted-foreground" />
        <span>{appMessage(locale, "appMenu.capabilities")}</span>
      </button>
    </div>
  )
}

export function ApplicationMenu({ compact = false, locale, onOpenSettings }: ApplicationMenuProps) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<MenuPosition>({ bottom: 8, left: 8 })
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)

  const updatePosition = useCallback(() => {
    const bounds = triggerRef.current?.getBoundingClientRect()
    if (!bounds) return
    const menuWidth = 288
    const left = compact
      ? Math.min(window.innerWidth - menuWidth - 8, bounds.right + 8)
      : Math.min(window.innerWidth - menuWidth - 8, bounds.left)
    setPosition({
      bottom: compact ? Math.max(8, window.innerHeight - bounds.bottom) : Math.max(8, window.innerHeight - bounds.top + 8),
      left: Math.max(8, left),
    })
  }, [compact])

  useEffect(() => {
    if (!open) return
    updatePosition()
    const closeForOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (target && (triggerRef.current?.contains(target) || panelRef.current?.contains(target))) return
      setOpen(false)
    }
    const closeForEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      setOpen(false)
      triggerRef.current?.focus()
    }
    window.addEventListener("resize", updatePosition)
    document.addEventListener("pointerdown", closeForOutsidePointer)
    document.addEventListener("keydown", closeForEscape)
    return () => {
      window.removeEventListener("resize", updatePosition)
      document.removeEventListener("pointerdown", closeForOutsidePointer)
      document.removeEventListener("keydown", closeForEscape)
    }
  }, [open, updatePosition])

  const openSettings = (target: ApplicationMenuTarget) => {
    setOpen(false)
    onOpenSettings(target)
  }

  return (
    <>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={appMessage(locale, "appMenu.open")}
        className={cn(
          "flex items-center rounded-lg text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/40",
          compact ? "size-8 justify-center" : "w-full gap-2.5 px-2 py-1.5",
        )}
        onClick={() => {
          if (!open) updatePosition()
          setOpen((current) => !current)
        }}
        ref={triggerRef}
        title={compact ? appMessage(locale, "appMenu.localWorkspace") : undefined}
        type="button"
      >
        <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">CX</span>
        {compact ? null : (
          <>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-medium text-foreground">{appMessage(locale, "appMenu.localWorkspace")}</span>
              <span className="block truncate text-[10px] text-muted-foreground">Convax</span>
            </span>
            <ChevronUp className={cn("size-3.5 text-muted-foreground transition-transform", open && "rotate-180")} />
          </>
        )}
      </button>
      {open && typeof document !== "undefined" ? createPortal(
        <ApplicationMenuPanel locale={locale} onOpenSettings={openSettings} panelRef={panelRef} position={position} />,
        document.body,
      ) : null}
    </>
  )
}
