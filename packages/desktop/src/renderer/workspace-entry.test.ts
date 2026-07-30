import { describe, expect, test } from "bun:test"
import {
  WorkspaceEntryCoordinator,
  waitForMountedWorkspaceTarget,
  type ProjectActivationSnapshot,
  type WorkspaceMountScheduler,
} from "./workspace-entry"

class Store<T> {
  private readonly listeners = new Set<() => void>()

  constructor(private snapshot: T) {}

  getSnapshot = () => this.snapshot

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  update(snapshot: T) {
    this.snapshot = snapshot
    for (const listener of this.listeners) listener()
  }
}

async function flushMicrotasks() {
  for (let index = 0; index < 6; index += 1) await Promise.resolve()
}

function harness(input: {
  activeProjectId?: string | null
  activate?: (projectId: string, project: Store<ProjectActivationSnapshot>) => Promise<void>
  reconcile?: (projectId: string, canvasId?: string) => Promise<boolean>
} = {}) {
  const project = new Store<ProjectActivationSnapshot>({
    activeProjectId: input.activeProjectId ?? null,
    changingActiveProject: false,
    error: null,
  })
  const catalog = new Store({
    busy: input.activeProjectId === undefined,
    error: null as string | null,
    projectId: input.activeProjectId ?? null,
  })
  const workbench = new Store({
    activeInput: input.activeProjectId
      ? { canvasId: "canvas-current", kind: "canvas", projectId: input.activeProjectId }
      : null,
    changingInput: false,
    error: null as string | null,
    projectId: input.activeProjectId ?? null,
  })
  const calls: string[] = []
  const coordinator = new WorkspaceEntryCoordinator({
    catalog,
    project: {
      ...project,
      activate: async (projectId) => {
        calls.push(`activate:${projectId}`)
        await input.activate?.(projectId, project)
      },
    },
    readLastCanvas: (projectId) => {
      calls.push(`last:${projectId}`)
      return "canvas-last"
    },
    reconcile: async (projectId, canvasId) => {
      calls.push(`reconcile:${projectId}:${canvasId ?? "none"}`)
      const reconciled = (await input.reconcile?.(projectId, canvasId)) ?? true
      if (reconciled) {
        workbench.update({
          activeInput: { canvasId: canvasId ?? "canvas-default", kind: "canvas", projectId },
          changingInput: false,
          error: null,
          projectId,
        })
      }
      return reconciled
    },
    showWorkspace: () => calls.push("show"),
    workbench,
  })
  return { calls, catalog, coordinator, project, workbench }
}

describe("WorkspaceEntryCoordinator", () => {
  test("activates and verifies the Project, waits for both scopes, reconciles the requested Canvas, then shows", async () => {
    let finishActivation: (() => void) | undefined
    const activation = new Promise<void>((resolve) => {
      finishActivation = resolve
    })
    const state = harness({
      activate: async (projectId, project) => {
        project.update({ activeProjectId: null, changingActiveProject: true, error: null })
        await activation
        project.update({ activeProjectId: projectId, changingActiveProject: false, error: null })
      },
    })

    const entered = state.coordinator.enter({ canvasId: "canvas-requested", projectId: "project-1" })
    await flushMicrotasks()
    expect(state.calls).toEqual(["activate:project-1"])

    state.catalog.update({ busy: true, error: null, projectId: "project-1" })
    state.workbench.update({ activeInput: null, changingInput: false, error: null, projectId: "project-1" })
    finishActivation?.()
    await Promise.resolve()
    expect(state.calls).not.toContain("show")

    state.catalog.update({ busy: false, error: null, projectId: "project-1" })
    expect(await entered).toBe(true)
    expect(state.calls).toEqual([
      "activate:project-1",
      "reconcile:project-1:canvas-requested",
      "show",
    ])
  })

  test("uses the last Canvas preference when no Canvas was requested", async () => {
    const state = harness({ activeProjectId: "project-1" })

    await expect(state.coordinator.enter({ projectId: "project-1" })).resolves.toBe(true)
    expect(state.calls).toEqual(["last:project-1", "reconcile:project-1:canvas-last", "show"])
  })

  test("does not show the workspace when Project activation is canceled", async () => {
    const state = harness({
      activeProjectId: "project-old",
      activate: async () => undefined,
    })

    await expect(state.coordinator.enter({ projectId: "project-new" })).resolves.toBe(false)
    expect(state.calls).toEqual(["activate:project-new"])
  })

  test("propagates a scoped failure without committing the surface", async () => {
    const state = harness({ activeProjectId: "project-1" })
    state.catalog.update({ busy: false, error: "Catalog unavailable", projectId: "project-1" })

    await expect(state.coordinator.enter({ projectId: "project-1" })).rejects.toThrow("Catalog unavailable")
    expect(state.calls).not.toContain("show")
  })

  test("does not commit when reconciliation is rejected", async () => {
    const state = harness({
      activeProjectId: "project-1",
      reconcile: async () => false,
    })

    await expect(state.coordinator.enter({ projectId: "project-1" })).resolves.toBe(false)
    expect(state.calls).not.toContain("show")
  })

  test("only the latest concurrent request may commit the workspace", async () => {
    let finishFirst: ((value: boolean) => void) | undefined
    const firstReconcile = new Promise<boolean>((resolve) => {
      finishFirst = resolve
    })
    let reconciliation = 0
    const state = harness({
      activeProjectId: "project-1",
      reconcile: async () => (++reconciliation === 1 ? firstReconcile : true),
    })

    const first = state.coordinator.enter({ canvasId: "canvas-1", projectId: "project-1" })
    await flushMicrotasks()
    const second = state.coordinator.enter({ canvasId: "canvas-2", projectId: "project-1" })
    await expect(second).resolves.toBe(true)
    finishFirst?.(true)
    await expect(first).resolves.toBe(false)
    expect(state.calls.filter((call) => call === "show")).toHaveLength(1)
  })

  test("honors AbortSignal while waiting and never commits", async () => {
    const state = harness({ activeProjectId: "project-1" })
    state.catalog.update({ busy: true, error: null, projectId: "project-1" })
    const abort = new AbortController()

    const entered = state.coordinator.enter({ projectId: "project-1", signal: abort.signal })
    abort.abort(new Error("Entry canceled"))

    await expect(entered).rejects.toThrow("Entry canceled")
    expect(state.calls).not.toContain("show")
  })

  test("honors AbortSignal while reconciliation is in flight and never commits", async () => {
    let finishReconciliation: ((value: boolean) => void) | undefined
    const reconciliation = new Promise<boolean>((resolve) => {
      finishReconciliation = resolve
    })
    const state = harness({
      activeProjectId: "project-1",
      reconcile: async () => reconciliation,
    })
    const abort = new AbortController()

    const entered = state.coordinator.enter({ projectId: "project-1", signal: abort.signal })
    await flushMicrotasks()
    abort.abort(new Error("Settings opened"))
    finishReconciliation?.(true)

    await expect(entered).rejects.toThrow("Settings opened")
    expect(state.calls).not.toContain("show")
  })

  test("returns a scope-bound lease that becomes stale after a newer entry", async () => {
    const state = harness({ activeProjectId: "project-1" })
    const first = await state.coordinator.acquire({ canvasId: "canvas-1", projectId: "project-1" })
    expect(first?.validate("project")).toBe(true)
    expect(first?.validate("canvas")).toBe(true)

    await state.coordinator.enter({ canvasId: "canvas-2", projectId: "project-1" })
    expect(first?.validate("project")).toBe(false)
    expect(first?.validate("canvas")).toBe(false)
  })

  test("invalidates a Canvas lease when the live Workbench input changes", async () => {
    const state = harness({ activeProjectId: "project-1" })
    const lease = await state.coordinator.acquire({ canvasId: "canvas-1", projectId: "project-1" })

    state.workbench.update({
      activeInput: { canvasId: "canvas-2", kind: "canvas", projectId: "project-1" },
      changingInput: false,
      error: null,
      projectId: "project-1",
    })

    expect(lease?.validate("project")).toBe(true)
    expect(lease?.validate("canvas")).toBe(false)
  })
})

describe("waitForMountedWorkspaceTarget", () => {
  test("uses an injectable bounded frame scheduler and stops after timeout", async () => {
    let target: { id: string } | null = null
    let frame: (() => void) | undefined
    let timeout: (() => void) | undefined
    let clearedFrame = false
    let clearedTimeout = false
    const scheduler: WorkspaceMountScheduler = {
      clearFrame: () => {
        clearedFrame = true
      },
      clearTimeout: () => {
        clearedTimeout = true
      },
      requestFrame: (callback) => {
        frame = callback
        return "frame"
      },
      setTimeout: (callback) => {
        timeout = callback
        return "timer"
      },
    }

    const mounted = waitForMountedWorkspaceTarget({
      read: () => target,
      scheduler,
      timeoutMs: 25,
    })
    frame?.()
    timeout?.()

    await expect(mounted).rejects.toThrow("did not finish mounting")
    expect(clearedFrame).toBe(true)
    expect(clearedTimeout).toBe(true)
  })

  test("resolves the mounted target and clears its timeout", async () => {
    const target = { id: "canvas" }
    let frame: (() => void) | undefined
    let clearedTimeout = false
    const scheduler: WorkspaceMountScheduler = {
      clearFrame: () => undefined,
      clearTimeout: () => {
        clearedTimeout = true
      },
      requestFrame: (callback) => {
        frame = callback
        return "frame"
      },
      setTimeout: () => "timer",
    }
    let mountedTarget: typeof target | null = null
    const mounted = waitForMountedWorkspaceTarget({
      read: () => mountedTarget,
      scheduler,
    })
    mountedTarget = target
    frame?.()

    await expect(mounted).resolves.toBe(target)
    expect(clearedTimeout).toBe(true)
  })
})
