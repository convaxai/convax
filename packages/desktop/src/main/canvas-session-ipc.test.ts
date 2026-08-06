import { describe, expect, mock, test } from "bun:test"
import { encodeBase64url, parseId128 } from "@convax/collaboration"
import type { IpcMainInvokeEvent } from "electron"

import { canvasSessionIpcChannels } from "../canvas-session-contracts"
import type { CanvasCollaborationSessionOwner } from "./canvas-collaboration-session-owner"
import { registerCanvasSessionIpc } from "./canvas-session-ipc"

const ref = Object.freeze({ canvasId: "canvas-one", scopeId: "project-one" })
const sessionId = parseId128(encodeBase64url(new Uint8Array(16).fill(1)))

type Handler = (event: IpcMainInvokeEvent, input: unknown) => unknown
type DestroyListener = () => void

interface TestSender {
  readonly id: number
  destroyed: boolean
  destroyListener?: DestroyListener
  isDestroyed(): boolean
  once(event: "destroyed", listener: DestroyListener): void
  send(channel: string, payload: unknown): void
}

function sender(id: number): TestSender {
  return {
    id,
    destroyed: false,
    isDestroyed() { return this.destroyed },
    once(event, listener) {
      expect(event).toBe("destroyed")
      this.destroyListener = listener
    },
    send: mock(() => undefined),
  }
}

function invoke(handler: Handler, current: TestSender, input: unknown) {
  return handler({ sender: current } as unknown as IpcMainInvokeEvent, input)
}

function projection() {
  return Object.freeze({
    format: "convax.canvas-session-projection" as const,
    ref,
    sessionId,
    document: Object.freeze({ id: ref.canvasId }),
    nodeEntities: Object.freeze([]),
    canUndo: false,
    canRedo: false,
  })
}

function ownerFixture() {
  let invalidationListener: ((event: unknown) => void) | undefined
  const owner = {
    open: mock(async () => projection()),
    close: mock(() => undefined),
    queryRenderer: mock(async () => projection()),
    submitRenderer: mock(async () => ({ operationReceipt: {}, projection: projection() })),
    undo: mock(async () => null),
    redo: mock(async () => null),
    flush: mock(async () => undefined),
    subscribe(listener: (event: unknown) => void) {
      invalidationListener = listener
      return mock(() => { invalidationListener = undefined })
    },
  }
  return {
    emit(event: unknown) { invalidationListener?.(event) },
    owner: owner as unknown as CanvasCollaborationSessionOwner,
    spies: owner,
  }
}

function register(
  owner: CanvasCollaborationSessionOwner,
  options: {
    active?: () => Readonly<{ canvasId: string; projectId: string }> | null
    prepareProject?: (projectId: string) => Promise<void>
  } = {},
) {
  const handlers = new Map<string, Handler>()
  const ipc = {
    handle(channel: string, handler: Handler) { handlers.set(channel, handler) },
    removeHandler(channel: string) { handlers.delete(channel) },
  }
  const dispose = registerCanvasSessionIpc(owner, {
    ipcMain: ipc,
    isTrustedSender: (event) => event.sender.id > 0,
    resolveActiveCanvas: async () => options.active?.() ?? { canvasId: ref.canvasId, projectId: ref.scopeId },
    prepareProject: options.prepareProject ?? (async () => undefined),
  })
  return { dispose, handlers }
}

describe("Canvas collaboration session IPC", () => {
  test("derives renderer actor identity and binds the returned lease to that WebContents", async () => {
    const fixture = ownerFixture()
    const ipc = register(fixture.owner)
    const first = sender(7)
    const second = sender(8)

    await expect(invoke(ipc.handlers.get(canvasSessionIpcChannels.open)!, first, ref)).resolves.toMatchObject({
      ref,
      sessionId,
    })
    expect(fixture.spies.open).toHaveBeenCalledWith({
      ref,
      actor: { id: "desktop:renderer:7", kind: "renderer" },
    })
    await expect(Promise.resolve().then(() => invoke(ipc.handlers.get(canvasSessionIpcChannels.query)!, second, {
      ref,
      sessionId,
    }))).rejects.toThrow("belongs to another renderer")
    expect(fixture.spies.queryRenderer).not.toHaveBeenCalled()
    ipc.dispose()
  })

  test("rejects caller-selected authority fields before opening a session", async () => {
    const fixture = ownerFixture()
    const ipc = register(fixture.owner)
    const current = sender(7)

    await expect(Promise.resolve().then(() => invoke(ipc.handlers.get(canvasSessionIpcChannels.open)!, current, {
      ...ref,
      actorId: "caller-selected",
    }))).rejects.toThrow("field set")
    await expect(Promise.resolve().then(() => invoke(ipc.handlers.get(canvasSessionIpcChannels.open)!, sender(0), ref)))
      .rejects.toThrow("untrusted renderer")
    expect(fixture.spies.open).not.toHaveBeenCalled()
    ipc.dispose()
  })

  test("opens only the invoking renderer's live Workbench scope and prepares that Project", async () => {
    const fixture = ownerFixture()
    const prepareProject = mock(async () => undefined)
    const ipc = register(fixture.owner, {
      active: () => ({ canvasId: ref.canvasId, projectId: ref.scopeId }),
      prepareProject,
    })
    const current = sender(7)

    await expect(invoke(ipc.handlers.get(canvasSessionIpcChannels.open)!, current, {
      canvasId: "canvas-other",
      scopeId: ref.scopeId,
    })).rejects.toThrow("live Workbench scope")
    expect(prepareProject).not.toHaveBeenCalled()
    await expect(invoke(ipc.handlers.get(canvasSessionIpcChannels.open)!, current, ref)).resolves.toMatchObject({ ref })
    expect(prepareProject).toHaveBeenCalledWith(ref.scopeId)
    ipc.dispose()
  })

  test("closes a newly opened lease when the Workbench scope changes during open", async () => {
    const fixture = ownerFixture()
    let reads = 0
    const ipc = register(fixture.owner, {
      active: () => {
        reads += 1
        return reads < 3
          ? { canvasId: ref.canvasId, projectId: ref.scopeId }
          : { canvasId: "canvas-other", projectId: ref.scopeId }
      },
    })

    await expect(invoke(ipc.handlers.get(canvasSessionIpcChannels.open)!, sender(7), ref))
      .rejects.toThrow("live Workbench scope")
    expect(fixture.spies.open).toHaveBeenCalledTimes(1)
    expect(fixture.spies.close).toHaveBeenCalledWith({ ref, sessionId })
    ipc.dispose()
  })

  test("revokes an existing binding after the renderer Workbench scope changes", async () => {
    const fixture = ownerFixture()
    let active: { canvasId: string; projectId: string } = { canvasId: ref.canvasId, projectId: ref.scopeId }
    const ipc = register(fixture.owner, { active: () => active })
    const current = sender(7)
    await invoke(ipc.handlers.get(canvasSessionIpcChannels.open)!, current, ref)
    active = { canvasId: "canvas-other", projectId: ref.scopeId }

    await expect(invoke(ipc.handlers.get(canvasSessionIpcChannels.query)!, current, { ref, sessionId }))
      .rejects.toThrow("live Workbench scope")
    expect(fixture.spies.close).toHaveBeenCalledWith({ ref, sessionId })
    expect(fixture.spies.queryRenderer).not.toHaveBeenCalled()
    ipc.dispose()
  })

  test("allows the owning renderer to close its exact lease after Workbench scope changes", async () => {
    const fixture = ownerFixture()
    let active: { canvasId: string; projectId: string } = { canvasId: ref.canvasId, projectId: ref.scopeId }
    const ipc = register(fixture.owner, { active: () => active })
    const current = sender(7)
    await invoke(ipc.handlers.get(canvasSessionIpcChannels.open)!, current, ref)
    active = { canvasId: "canvas-other", projectId: ref.scopeId }

    await expect(invoke(ipc.handlers.get(canvasSessionIpcChannels.close)!, current, { ref, sessionId }))
      .resolves.toBeUndefined()
    expect(fixture.spies.close).toHaveBeenCalledWith({ ref, sessionId })
    ipc.dispose()
  })

  test("revokes renderer leases on destruction and sends invalidations only to the owning live sender", async () => {
    const fixture = ownerFixture()
    const ipc = register(fixture.owner)
    const first = sender(7)
    await invoke(ipc.handlers.get(canvasSessionIpcChannels.open)!, first, ref)

    fixture.emit({ format: "convax.canvas-session-invalidation", ref, sessionId })
    expect(first.send).toHaveBeenCalledWith(canvasSessionIpcChannels.invalidated, {
      format: "convax.canvas-session-invalidation",
      ref,
      sessionId,
    })

    first.destroyed = true
    first.destroyListener?.()
    expect(fixture.spies.close).toHaveBeenCalledWith({ ref, sessionId })
    await expect(Promise.resolve().then(() => invoke(ipc.handlers.get(canvasSessionIpcChannels.flush)!, first, {
      ref,
      sessionId,
    }))).rejects.toThrow("stale")
    ipc.dispose()
  })
})
