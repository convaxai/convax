import { cn } from "@convax/ui"
import { Bot, ChevronUp, Cloud, LoaderCircle, Settings2, Sparkles } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { appMessage, type AppLocale } from "./app-language"
import { desktopFeatureFlags, type DesktopFeatureFlags } from "./feature-flags"
import type { ServiceCatalogEntry, ServiceCatalogSnapshot } from "./service-catalog-controller"

export type ApplicationMenuTarget = "general" | "services" | "capabilities"

interface ApplicationMenuProps {
  compact?: boolean
  featureFlags?: DesktopFeatureFlags
  locale: AppLocale
  onOpenSettings(target: ApplicationMenuTarget): void
  services?: ServiceCatalogSnapshot
}

interface MenuPosition {
  bottom?: number
  left: number
  top?: number
}

export function resolveApplicationMenuPosition(
  bounds: Pick<DOMRect, "bottom" | "left" | "right" | "top">,
  viewport: { height: number; width: number },
  compact: boolean,
): MenuPosition {
  const menuWidth = 288
  const left = compact
    ? Math.min(viewport.width - menuWidth - 8, bounds.right + 8)
    : Math.min(viewport.width - menuWidth - 8, bounds.left)
  if (compact && bounds.top < viewport.height / 2) {
    return { left: Math.max(8, left), top: bounds.bottom + 8 }
  }
  return {
    bottom: compact ? Math.max(8, viewport.height - bounds.bottom) : Math.max(8, viewport.height - bounds.top + 8),
    left: Math.max(8, left),
  }
}

export function ApplicationMenuPanel({
  featureFlags = desktopFeatureFlags,
  locale,
  onOpenSettings,
  panelRef,
  position,
  services,
}: {
  featureFlags?: DesktopFeatureFlags
  locale: AppLocale
  onOpenSettings(target: ApplicationMenuTarget): void
  panelRef?: React.Ref<HTMLDivElement>
  position?: MenuPosition
  services?: ServiceCatalogSnapshot
}) {
  return (
    <div
      aria-label={appMessage(locale, "appMenu.open")}
      className="z-[80] w-72 overflow-hidden rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-2xl"
      data-ui-menu-surface=""
      ref={panelRef}
      role="menu"
      style={
        position
          ? {
              bottom: position.bottom,
              left: position.left,
              position: "fixed",
              top: position.top,
            }
          : undefined
      }
    >
      <div className="flex items-center gap-3 px-2.5 py-2.5">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
          CX
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{appMessage(locale, "appMenu.localWorkspace")}</p>
          <p className="truncate text-[11px] text-muted-foreground">
            {appMessage(locale, "appMenu.localWorkspaceDescription")}
          </p>
        </div>
      </div>
      <div className="my-1 h-px bg-border" />
      {featureFlags.services ? (
        <>
          <button
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-ring/40"
            onClick={() => onOpenSettings("services")}
            role="menuitem"
            type="button"
          >
            <Cloud className="size-4 text-muted-foreground" />
            <span className="flex-1">{appMessage(locale, "appMenu.services")}</span>
            {services ? (
              <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">
                {services.services.length}
              </span>
            ) : null}
          </button>
          {services?.services.length ? (
            <div className="mb-1 max-h-52 space-y-0.5 overflow-y-auto px-1" data-application-services="true">
              {services.services.map((service) => (
                <button
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left outline-none hover:bg-accent focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-ring/40"
                  key={service.serviceId}
                  onClick={() => onOpenSettings("services")}
                  role="menuitem"
                  type="button"
                >
                  <span className="grid size-6 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
                    {service.kind === "builtin" ? <Bot className="size-3.5" /> : <Cloud className="size-3.5" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium text-foreground">{service.name}</span>
                    <span className="block truncate text-[10px] text-muted-foreground">
                      {service.capabilities
                        .map((capability) => appMessage(locale, `services.capability.${capability}`))
                        .join(" · ") || appMessage(locale, "services.unknown")}
                    </span>
                  </span>
                  <CompactServiceBadge locale={locale} service={service} />
                </button>
              ))}
            </div>
          ) : services?.loading ? (
            <div className="mb-1 flex items-center gap-2 px-3 py-1.5 text-[11px] text-muted-foreground" role="status">
              <LoaderCircle className="size-3 animate-spin" />
              {appMessage(locale, "services.loading")}
            </div>
          ) : null}
        </>
      ) : null}
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
      {featureFlags.skillsAndPlugins ? (
        <button
          className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-ring/40"
          onClick={() => onOpenSettings("capabilities")}
          role="menuitem"
          type="button"
        >
          <Sparkles className="size-4 text-muted-foreground" />
          <span>{appMessage(locale, "appMenu.capabilities")}</span>
        </button>
      ) : null}
    </div>
  )
}

function compactMetric(value: number, locale: AppLocale) {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value)
}

function CompactServiceBadge({ locale, service }: { locale: AppLocale; service: ServiceCatalogEntry }) {
  let label: string
  if (service.loading) label = "…"
  else if (service.authentication === "required") label = appMessage(locale, "services.authRequired")
  else if (service.billing.kind === "credits" && service.billing.remaining !== undefined) {
    label = `${compactMetric(service.billing.remaining, locale)}${service.billing.unit ? ` ${service.billing.unit}` : ""}`
  } else if (service.billing.kind === "free") label = appMessage(locale, "services.free")
  else if (service.billing.kind === "subscription") {
    label = service.billing.name ?? appMessage(locale, "services.subscription")
  } else if (service.state === "attention") label = appMessage(locale, "services.attention")
  else
    label =
      service.state === "connected"
        ? appMessage(locale, "services.connected")
        : service.state === "disconnected"
          ? appMessage(locale, "services.disconnected")
          : appMessage(locale, "services.unknown")
  return (
    <span className="max-w-24 shrink-0 truncate rounded-full border border-border bg-background px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
      {label}
    </span>
  )
}

export function ApplicationMenu({
  compact = false,
  featureFlags = desktopFeatureFlags,
  locale,
  onOpenSettings,
  services,
}: ApplicationMenuProps) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<MenuPosition>({ bottom: 8, left: 8 })
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)

  const updatePosition = useCallback(() => {
    const bounds = triggerRef.current?.getBoundingClientRect()
    if (!bounds) return
    setPosition(
      resolveApplicationMenuPosition(bounds, { height: window.innerHeight, width: window.innerWidth }, compact),
    )
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
        <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
          CX
        </span>
        {compact ? null : (
          <>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-medium text-foreground">
                {appMessage(locale, "appMenu.localWorkspace")}
              </span>
              <span className="block truncate text-[10px] text-muted-foreground">Convax</span>
            </span>
            <ChevronUp className={cn("size-3.5 text-muted-foreground transition-transform", open && "rotate-180")} />
          </>
        )}
      </button>
      {open && typeof document !== "undefined"
        ? createPortal(
            <ApplicationMenuPanel
              featureFlags={featureFlags}
              locale={locale}
              onOpenSettings={openSettings}
              panelRef={panelRef}
              position={position}
              services={services}
            />,
            document.body,
          )
        : null}
    </>
  )
}
