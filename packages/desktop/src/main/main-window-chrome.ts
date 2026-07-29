export function resolveMainWindowChrome(platform: NodeJS.Platform) {
  return platform === "darwin"
    ? {
        titleBarStyle: "hidden" as const,
      }
    : {}
}

export function setNativeMainWindowControlsVisible(
  platform: NodeJS.Platform,
  window: { setWindowButtonVisibility(visible: boolean): void },
  visible: boolean,
) {
  if (platform === "darwin") window.setWindowButtonVisibility(visible)
}
