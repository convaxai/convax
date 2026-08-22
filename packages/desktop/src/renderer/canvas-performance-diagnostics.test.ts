import { describe, expect, mock, test } from "bun:test"
import { canvasPerformanceDiagnosticsEnabled, installCanvasLongTaskDiagnostics } from "./canvas-performance-diagnostics"

describe("Canvas performance diagnostics", () => {
  test("enables in development or through the explicit renderer switch", () => {
    expect(
      canvasPerformanceDiagnosticsEnabled({
        location: { protocol: "http:", search: "" },
        storage: { getItem: () => null },
      }),
    ).toBeTrue()
    expect(
      canvasPerformanceDiagnosticsEnabled({
        location: { protocol: "file:", search: "?canvasPerf=1" },
        storage: { getItem: () => null },
      }),
    ).toBeTrue()
    expect(
      canvasPerformanceDiagnosticsEnabled({
        location: { protocol: "file:", search: "" },
        storage: { getItem: () => null },
      }),
    ).toBeFalse()
  })

  test("records only tasks at least fifty milliseconds and disposes the observer", () => {
    let callback: PerformanceObserverCallback | undefined
    const observe = mock(() => undefined)
    const disconnect = mock(() => undefined)
    class Observer {
      static supportedEntryTypes = ["longtask"]
      constructor(next: PerformanceObserverCallback) {
        callback = next
      }
      observe = observe
      disconnect = disconnect
    }
    const log = mock(() => undefined)
    const dispose = installCanvasLongTaskDiagnostics({ enabled: true, log, observer: Observer })
    callback?.(
      {
        getEntries: () => [
          { duration: 49, name: "self", startTime: 1 },
          { duration: 75.25, name: "self", startTime: 8.25 },
        ],
      } as PerformanceObserverEntryList,
      {} as PerformanceObserver,
    )

    expect(observe).toHaveBeenCalledWith({ buffered: true, type: "longtask" })
    expect(log).toHaveBeenCalledTimes(1)
    expect(log).toHaveBeenCalledWith("[convax:canvas-longtask]", {
      durationMs: 75.3,
      name: "self",
      startTimeMs: 8.3,
    })
    dispose()
    expect(disconnect).toHaveBeenCalledTimes(1)
  })
})
