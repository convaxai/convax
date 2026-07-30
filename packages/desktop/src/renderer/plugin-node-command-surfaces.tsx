import { CanvasNodeToolbarButton } from "@convax/canvas"
import type { PortablePluginUiIconToken } from "@convax/plugin-sdk"
import {
  Command,
  Download,
  Ellipsis,
  ExternalLink,
  Pencil,
  Play,
  RefreshCw,
  Settings,
  Sparkles,
  Upload,
} from "lucide-react"
import { useEffect, useRef, useState, type ReactNode } from "react"
import {
  DesktopPluginNodeCommandRegistry,
  type DesktopPluginNodeCommandProjection,
  type DesktopPluginNodeMenuCommand,
  type DesktopPluginNodeToolbarCommand,
} from "./plugin-node-command-registry"

function hostCommandIcon(token?: PortablePluginUiIconToken): ReactNode {
  switch (token) {
    case "download":
      return <Download />
    case "edit":
      return <Pencil />
    case "open":
      return <ExternalLink />
    case "play":
      return <Play />
    case "refresh":
      return <RefreshCw />
    case "settings":
      return <Settings />
    case "sparkles":
      return <Sparkles />
    case "upload":
      return <Upload />
    default:
      return <Command />
  }
}

export interface PluginNodeCommandSurfacesProps {
  /** Revalidates current Project/Canvas scope immediately before delivery. */
  canExecute: () => boolean
  moreLabel: string
  projection: DesktopPluginNodeCommandProjection
  registry: DesktopPluginNodeCommandRegistry
}

function executeProjectedCommand(
  props: PluginNodeCommandSurfacesProps,
  command: DesktopPluginNodeMenuCommand | DesktopPluginNodeToolbarCommand,
) {
  if (!props.canExecute()) return false
  return props.registry.execute(command)
}

export function PluginNodeCommandSurfaces(props: PluginNodeCommandSurfacesProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!menuOpen) return () => undefined
    const close = (event: PointerEvent) => {
      if (event.target instanceof Element && menuRef.current?.contains(event.target)) return
      setMenuOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false)
    }
    window.addEventListener("pointerdown", close)
    window.addEventListener("keydown", closeOnEscape)
    return () => {
      window.removeEventListener("pointerdown", close)
      window.removeEventListener("keydown", closeOnEscape)
    }
  }, [menuOpen])

  return (
    <>
      {props.projection.toolbar.map((command) => (
        <CanvasNodeToolbarButton
          disabled={!command.enabled}
          icon={hostCommandIcon(command.icon)}
          key={command.placementId}
          label={command.label}
          onClick={() => executeProjectedCommand(props, command)}
          visibleLabel={command.icon === undefined}
        />
      ))}
      {props.projection.menu.length > 0 ? (
        <div className="relative" ref={menuRef}>
          <CanvasNodeToolbarButton
            disabled={!props.projection.menu.some((command) => command.enabled)}
            icon={<Ellipsis />}
            label={props.moreLabel}
            onClick={() => setMenuOpen((open) => !open)}
            pressed={menuOpen}
          />
          {menuOpen ? (
            <div
              className="absolute left-0 top-full z-50 mt-1 min-w-44 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"
              data-canvas-shortcuts="ignore"
              data-plugin-node-command-menu=""
              role="menu"
            >
              {props.projection.menu.map((command, index) => {
                const previous = props.projection.menu[index - 1]
                const separated = index > 0 && previous?.group !== command.group
                return (
                  <button
                    className={`flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs hover:bg-accent disabled:opacity-50${
                      separated ? " mt-1 border-t border-border pt-2" : ""
                    }`}
                    data-plugin-command-id={command.commandId}
                    disabled={!command.enabled}
                    key={command.placementId}
                    onClick={() => {
                      executeProjectedCommand(props, command)
                      setMenuOpen(false)
                    }}
                    role="menuitem"
                    type="button"
                  >
                    <span className="[&>svg]:size-3.5">{hostCommandIcon(command.icon)}</span>
                    <span>{command.label}</span>
                  </button>
                )
              })}
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  )
}
