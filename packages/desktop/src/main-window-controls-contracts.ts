export const mainWindowControlsIpcChannel = "desktop:main-window-control"

export type MainWindowControlAction = "close" | "minimize" | "toggle-full-screen"

export type MainWindowControlsRequest =
  | { readonly action: MainWindowControlAction }
  | { readonly action: "set-custom-controls-visible"; readonly visible: boolean }

export interface MainWindowControlsClient {
  close(): Promise<void>
  minimize(): Promise<void>
  setCustomControlsVisible(visible: boolean): Promise<void>
  toggleFullScreen(): Promise<void>
}

export function isMainWindowControlAction(value: unknown): value is MainWindowControlAction {
  return value === "close" || value === "minimize" || value === "toggle-full-screen"
}

export function isMainWindowControlsRequest(value: unknown): value is MainWindowControlsRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const candidate = value as { action?: unknown; visible?: unknown }
  const keys = Object.keys(candidate)
  if (isMainWindowControlAction(candidate.action)) return keys.length === 1
  return (
    candidate.action === "set-custom-controls-visible" &&
    typeof candidate.visible === "boolean" &&
    keys.length === 2
  )
}
