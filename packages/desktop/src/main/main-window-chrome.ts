export function resolveMainWindowChrome(platform: NodeJS.Platform) {
  return platform === "darwin"
    ? {
        titleBarStyle: "hiddenInset" as const,
        trafficLightPosition: { x: 14, y: 15 },
      }
    : {}
}
