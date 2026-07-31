import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { PluginInstallationRuntime } from "./plugin-installation-runtime"

export const pluginRuntimeUnavailableMessage =
  "Plugin runtime is unavailable for this session; repair the invalid ActiveSet before changing Plugins"

export type DesktopPluginRuntimeStartupState =
  | { readonly state: "ready" }
  | { readonly errorType: string; readonly state: "quarantined" }

export interface DesktopPluginRuntimeSession {
  readonly dataDirectory: string
  readonly installations: PluginInstallationRuntime
  readonly state: DesktopPluginRuntimeStartupState
  assertMutable(): void
  dispose(): Promise<void>
}

interface DesktopPluginRuntimeStartupOptions {
  createRuntime?: (root: string) => PluginInstallationRuntime
  createTemporaryDirectory?: () => Promise<string>
  removeTemporaryDirectory?: (root: string) => Promise<void>
}

/**
 * Keeps invalid persisted Plugin state fail-closed without making Plugin
 * availability a prerequisite for the rest of Desktop.
 *
 * The persisted ActiveSet is only probed. On failure the complete Plugin
 * subsystem is unavailable for this process and every Plugin consumer receives
 * a fresh session-only runtime. The real pointer, snapshots, closures, pins and
 * recovery state remain untouched for explicit repair.
 */
export async function openDesktopPluginRuntimeSession(
  userDataDirectory: string,
  options: DesktopPluginRuntimeStartupOptions = {},
): Promise<DesktopPluginRuntimeSession> {
  const createRuntime = options.createRuntime ?? ((root: string) => new PluginInstallationRuntime(root))
  const persistent = createRuntime(join(userDataDirectory, "plugin-installations"))
  try {
    await persistent.readActive()
    return {
      dataDirectory: userDataDirectory,
      installations: persistent,
      state: { state: "ready" },
      assertMutable() {},
      async dispose() {},
    }
  } catch (error) {
    const quarantineDirectory =
      (await options.createTemporaryDirectory?.()) ??
      (await mkdtemp(join(tmpdir(), "convax-plugin-runtime-quarantine-")))
    const removeQuarantine = async () => {
      if (options.removeTemporaryDirectory) {
        await options.removeTemporaryDirectory(quarantineDirectory)
        return
      }
      await rm(quarantineDirectory, { force: true, recursive: true })
    }
    let quarantined: PluginInstallationRuntime
    try {
      quarantined = createRuntime(join(quarantineDirectory, "plugin-installations"))
      await quarantined.readActive()
    } catch (quarantineError) {
      await removeQuarantine()
      throw quarantineError
    }
    let disposed = false
    return {
      dataDirectory: quarantineDirectory,
      installations: quarantined,
      state: {
        errorType: error instanceof Error ? error.name : "UnknownError",
        state: "quarantined",
      },
      assertMutable() {
        throw new Error(pluginRuntimeUnavailableMessage)
      },
      async dispose() {
        if (disposed) return
        disposed = true
        await removeQuarantine()
      },
    }
  }
}
