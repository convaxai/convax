export const canvasPerformanceDiagnosticsStorageKey = "convax.debug.canvasPerformance"

interface CanvasPerformanceObserverConstructor {
  readonly supportedEntryTypes?: readonly string[]
  new (callback: PerformanceObserverCallback): Pick<PerformanceObserver, "disconnect" | "observe">
}

export function canvasPerformanceDiagnosticsEnabled(input: {
  location: Pick<Location, "protocol" | "search">
  storage: Pick<Storage, "getItem">
}) {
  if (new URLSearchParams(input.location.search).get("canvasPerf") === "1") return true
  try {
    if (input.storage.getItem(canvasPerformanceDiagnosticsStorageKey) === "1") return true
  } catch {}
  return input.location.protocol === "http:" || input.location.protocol === "https:"
}

/** Development/opt-in Long Task diagnostics. It observes only timing metadata. */
export function installCanvasLongTaskDiagnostics(input: {
  enabled: boolean
  log?: (label: string, details: Readonly<Record<string, number | string>>) => void
  observer?: CanvasPerformanceObserverConstructor
}) {
  const Observer =
    input.observer ?? (globalThis.PerformanceObserver as unknown as CanvasPerformanceObserverConstructor | undefined)
  if (!input.enabled || !Observer || !Observer.supportedEntryTypes?.includes("longtask")) return () => undefined
  const log = input.log ?? ((label, details) => console.warn(label, details))
  const observer = new Observer((entries) => {
    for (const entry of entries.getEntries()) {
      if (entry.duration < 50) continue
      log("[convax:canvas-longtask]", {
        durationMs: Math.round(entry.duration * 10) / 10,
        name: entry.name,
        startTimeMs: Math.round(entry.startTime * 10) / 10,
      })
    }
  })
  observer.observe({ buffered: true, type: "longtask" })
  return () => observer.disconnect()
}
