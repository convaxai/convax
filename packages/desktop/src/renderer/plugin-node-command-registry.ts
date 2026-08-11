import type {
  PortablePluginCanvasUiContribution,
  PortablePluginI18n,
  PortablePluginUiCommand,
  PortablePluginUiIconToken,
} from "@convax/plugin-sdk"
import { resolvePortablePluginLocalizedText } from "@convax/plugin-sdk"
import { desktopPluginHostProtocolV8 } from "../plugin-host-protocol"
import type { AppLocale } from "./app-language"
import {
  DesktopPluginFrameRegistry,
  type DesktopPluginFrameLease,
  type DesktopPluginFrameRef,
} from "./plugin-frame-registry"

export interface DesktopPluginNodeToolbarCommand {
  readonly commandId: string
  readonly enabled: boolean
  readonly icon?: PortablePluginUiIconToken
  readonly label: string
  readonly order: number
  readonly placementId: string
}

export interface DesktopPluginNodeMenuCommand extends DesktopPluginNodeToolbarCommand {
  readonly group?: string
  readonly placement: "overflow"
}

export interface DesktopPluginNodeCommandProjection {
  readonly menu: readonly DesktopPluginNodeMenuCommand[]
  readonly toolbar: readonly DesktopPluginNodeToolbarCommand[]
}

interface ProjectedCommandState {
  readonly command: PortablePluginUiCommand
  readonly frameLease?: DesktopPluginFrameLease
  readonly registry: DesktopPluginNodeCommandRegistry
}

const projectedCommandStates = new WeakMap<
  DesktopPluginNodeMenuCommand | DesktopPluginNodeToolbarCommand,
  ProjectedCommandState
>()

function comparePlacement(
  left: { readonly order: number; readonly placementId: string },
  right: { readonly order: number; readonly placementId: string },
) {
  return left.order - right.order || left.placementId.localeCompare(right.placementId)
}

function commandLabel(command: PortablePluginUiCommand, locale: AppLocale, i18n?: PortablePluginI18n) {
  return resolvePortablePluginLocalizedText(command.title, locale, i18n)
}

/**
 * Immutable projection of one Plugin's canonical command registry.
 *
 * The registry has no Host command targets. Execution can only deliver a
 * validated renderer message to the exact iframe generation captured while
 * the owning Canvas node surface was projected.
 */
export class DesktopPluginNodeCommandRegistry {
  readonly #commands: ReadonlyMap<string, PortablePluginUiCommand>
  readonly #contribution: PortablePluginCanvasUiContribution
  readonly #frames: DesktopPluginFrameRegistry
  readonly #i18n?: PortablePluginI18n
  readonly #pluginId: string

  constructor(
    pluginId: string,
    contribution: PortablePluginCanvasUiContribution,
    frames: DesktopPluginFrameRegistry,
    i18n?: PortablePluginI18n,
  ) {
    this.#pluginId = pluginId
    this.#contribution = contribution
    this.#commands = new Map(contribution.commands.map((command) => [command.id, command]))
    this.#frames = frames
    this.#i18n = i18n
  }

  project(frame: DesktopPluginFrameRef | null, locale: AppLocale): DesktopPluginNodeCommandProjection {
    if (frame !== null && frame.pluginId !== this.#pluginId) {
      throw new Error("Plugin UI commands cannot be projected onto another Plugin's Canvas node")
    }
    const frameLease = frame === null ? undefined : this.#frames.capture(frame)
    const project = (placement: { readonly command: string; readonly id: string; readonly order?: number }) => {
      const command = this.#commands.get(placement.command)
      if (!command) {
        // The SDK parser rejects this. Keep Desktop fail-closed if an internal
        // caller bypasses that canonical admission boundary.
        throw new Error(`Plugin UI placement references an unknown command: ${placement.command}`)
      }
      const projected = Object.freeze({
        commandId: command.id,
        enabled: frameLease !== undefined,
        ...(command.icon === undefined ? {} : { icon: command.icon }),
        label: commandLabel(command, locale, this.#i18n),
        order: placement.order ?? 0,
        placementId: placement.id,
      })
      projectedCommandStates.set(projected, { command, frameLease, registry: this })
      return projected
    }

    const toolbar = this.#contribution.toolbar.map(project).sort(comparePlacement)
    const menu = this.#contribution.menus
      .map((placement) => {
        const base = project(placement)
        const projected = {
          ...base,
          placement: "overflow" as const,
          ...(placement.group === undefined ? {} : { group: placement.group }),
        }
        const state = projectedCommandStates.get(base)
        // Spreading creates the final immutable menu projection; transfer the
        // unforgeable execution state to that exact object.
        const immutable = Object.freeze(projected)
        if (state) projectedCommandStates.set(immutable, state)
        return immutable
      })
      .sort(comparePlacement)
    return Object.freeze({
      menu: Object.freeze(menu),
      toolbar: Object.freeze(toolbar),
    })
  }

  execute(command: DesktopPluginNodeMenuCommand | DesktopPluginNodeToolbarCommand) {
    const state = projectedCommandStates.get(command)
    if (!state || state.registry !== this || !state.frameLease) return false
    try {
      return this.#frames.sendExact(state.frameLease, {
        command: state.command.target.message,
        protocol: desktopPluginHostProtocolV8,
        type: "command",
      })
    } catch {
      // A sandbox frame disappearing or rejecting a postMessage must not break
      // the host-owned Canvas toolbar.
      return false
    }
  }
}
