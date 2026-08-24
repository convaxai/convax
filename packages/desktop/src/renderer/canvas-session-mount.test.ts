import { describe, expect, mock, test } from "bun:test"
import { createCanvasDocument } from "@convax/canvas"
import type { CanvasDocumentRef } from "@convax/canvas/application"
import type { DesktopCanvasRendererSession } from "./canvas-collaboration-client"
import {
  mountCanvasSessionWithBackgroundReconcile,
  type CanvasSessionMountOptions,
  type CanvasSessionReconcileDiagnostic,
} from "./canvas-session-mount"

const firstRef = { canvasId: "canvas-one", scopeId: "project-one" }
const secondRef = { canvasId: "canvas-two", scopeId: "project-one" }

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, reject, resolve }
}

function fakeSession(ref: CanvasDocumentRef = firstRef) {
  const refresh = mock(async (_signal?: AbortSignal) => undefined)
  const dispose = mock(() => undefined)
  const session: DesktopCanvasRendererSession = {
    authority: "project-collaboration-application",
    canRedo: () => false,
    canUndo: () => false,
    dispose,
    drain: mock(async () => undefined),
    executeApplication: mock(async () => { throw new Error("unused") }),
    flush: mock(async () => undefined),
    getProjection: () => createCanvasDocument({ id: ref.canvasId }),
    ownsProjectionChange: () => false,
    queryResourceHierarchy: () => Object.freeze({ status: "unavailable" as const }),
    queryViewport: () => Object.freeze({ edges: Object.freeze([]), nodes: Object.freeze([]), truncated: false }),
    redo: mock(async () => null),
    ref,
    refresh,
    sessionId: "AQEBAQEBAQEBAQEBAQEBAQ" as never,
    resolveNodeEntity: () => undefined,
    runResourceMutation: mock(async () => { throw new Error("unused") }),
    submit: mock(async () => undefined),
    subscribe: () => () => undefined,
    undo: mock(async () => null),
    acceptApplicationMutation: mock(async () => { throw new Error("unused") }),
    undoModel: "project-yjs-semantic-history",
  }
  return {
    dispose,
    refresh,
    session,
  }
}

function manualTimeout() {
  let callback: (() => void) | null = null
  const cancel = mock(() => {
    callback = null
  })
  return {
    cancel,
    fire() {
      const current = callback
      callback = null
      current?.()
    },
    schedule: mock((next: () => void, _timeoutMs: number) => {
      callback = next
      return cancel
    }),
  }
}

function start(
  ref: CanvasDocumentRef,
  options: Partial<CanvasSessionMountOptions> & {
    openSession: CanvasSessionMountOptions["openSession"]
    reconcileCanvas: CanvasSessionMountOptions["reconcileCanvas"]
  },
) {
  const diagnostics: CanvasSessionReconcileDiagnostic[] = []
  const mounted: DesktopCanvasRendererSession[] = []
  const mountFailures: unknown[] = []
  const dispose = mountCanvasSessionWithBackgroundReconcile({
    onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    onMountFailure: (error) => mountFailures.push(error),
    onMounted: (session) => mounted.push(session),
    ref,
    ...options,
  })
  return { diagnostics, dispose, mounted, mountFailures }
}

async function drainMicrotasks() {
  for (let index = 0; index < 6; index += 1) await Promise.resolve()
}

describe("Canvas session mount with background generation reconciliation", () => {
  test("mounts after the owner refresh and reports reconcile rejection without disposing the session", async () => {
    const events: string[] = []
    const value = fakeSession()
    value.refresh.mockImplementation(async () => {
      events.push("refresh")
    })
    const timeout = manualTimeout()
    const lifecycle = start(firstRef, {
      onDiagnostic: (diagnostic) => {
        events.push(`diagnostic:${diagnostic.code}`)
      },
      onMounted: () => events.push("mounted"),
      openSession: async () => {
        events.push("open")
        return value.session
      },
      reconcileCanvas: async () => {
        events.push("reconcile")
        throw new Error("private generation recovery diagnostic")
      },
      scheduleTimeout: timeout.schedule,
    })

    await drainMicrotasks()

    expect(events).toEqual(["open", "refresh", "mounted", "reconcile", "diagnostic:generation-reconcile-failed"])
    expect(lifecycle.mountFailures).toEqual([])
    expect(value.dispose).not.toHaveBeenCalled()
    lifecycle.dispose()
    expect(value.dispose).toHaveBeenCalledTimes(1)
  })

  test("keeps a mounted session when reconcile never completes and reports only a bounded observation timeout", async () => {
    const value = fakeSession()
    const pending = deferred()
    const timeout = manualTimeout()
    const lifecycle = start(firstRef, {
      openSession: async () => value.session,
      reconcileCanvas: () => pending.promise,
      reconcileObservationTimeoutMs: 25,
      scheduleTimeout: timeout.schedule,
    })
    await drainMicrotasks()

    expect(lifecycle.mounted).toEqual([value.session])
    expect(timeout.schedule).toHaveBeenCalledWith(expect.any(Function), 25)
    timeout.fire()
    expect(lifecycle.diagnostics).toEqual([{ code: "generation-reconcile-timed-out", ref: firstRef }])
    expect(lifecycle.mountFailures).toEqual([])
    expect(value.dispose).not.toHaveBeenCalled()
    expect(value.refresh).toHaveBeenCalledTimes(1)

    pending.resolve()
    await drainMicrotasks()
    expect(lifecycle.diagnostics).toHaveLength(1)
    expect(value.dispose).not.toHaveBeenCalled()
    expect(value.refresh).toHaveBeenCalledTimes(2)
    lifecycle.dispose()
  })

  test("aborts a pending mount and releases a session that opens after the Canvas scope is disposed", async () => {
    const value = fakeSession()
    const opening = deferred<DesktopCanvasRendererSession>()
    let signal: AbortSignal | undefined
    const reconcileCanvas = mock(async () => undefined)
    const lifecycle = start(firstRef, {
      openSession: (currentSignal) => {
        signal = currentSignal
        return opening.promise
      },
      reconcileCanvas,
    })

    lifecycle.dispose()
    expect(signal?.aborted).toBeTrue()
    opening.resolve(value.session)
    await drainMicrotasks()

    expect(value.refresh).not.toHaveBeenCalled()
    expect(value.dispose).toHaveBeenCalledTimes(1)
    expect(reconcileCanvas).not.toHaveBeenCalled()
    expect(lifecycle.mounted).toEqual([])
    expect(lifecycle.mountFailures).toEqual([])
    expect(lifecycle.diagnostics).toEqual([])
  })

  for (const outcome of ["resolve", "reject"] as const) {
    test(`ignores a late reconcile ${outcome} from the disposed Canvas without polluting the new scope`, async () => {
      const first = fakeSession()
      const second = fakeSession(secondRef)
      const late = deferred()
      const oldLifecycle = start(firstRef, {
        openSession: async () => first.session,
        reconcileCanvas: () => late.promise,
      })
      await drainMicrotasks()
      expect(oldLifecycle.mounted).toEqual([first.session])

      oldLifecycle.dispose()
      const newLifecycle = start(secondRef, {
        openSession: async () => second.session,
        reconcileCanvas: () => new Promise(() => undefined),
      })
      await drainMicrotasks()

      if (outcome === "resolve") late.resolve()
      else late.reject(new Error("late private failure"))
      await drainMicrotasks()

      expect(first.dispose).toHaveBeenCalledTimes(1)
      expect(first.refresh).toHaveBeenCalledTimes(1)
      expect(oldLifecycle.diagnostics).toEqual([])
      expect(oldLifecycle.mountFailures).toEqual([])
      expect(newLifecycle.mounted).toEqual([second.session])
      expect(newLifecycle.diagnostics).toEqual([])
      expect(second.dispose).not.toHaveBeenCalled()
      expect(second.refresh).toHaveBeenCalledTimes(1)
      newLifecycle.dispose()
    })
  }
})
