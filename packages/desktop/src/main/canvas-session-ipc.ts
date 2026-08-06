import type { CanvasDocumentRef } from "@convax/canvas/application"
import type { CanvasRendererCommandV2 } from "@convax/canvas/collaboration"
import { parseId128, type Id128 } from "@convax/collaboration"
import type { IpcMainInvokeEvent } from "electron"

import {
  canvasSessionIpcChannels,
  type CanvasRendererSessionScopeV2,
} from "../canvas-session-contracts"
import type { CanvasCollaborationSessionOwnerV2 } from "./canvas-collaboration-session-owner"

const maximumRendererSessionsPerWebContents = 128

interface CanvasSessionIpcMainV2 {
  handle(channel: string, handler: (event: IpcMainInvokeEvent, input: unknown) => unknown): void
  removeHandler(channel: string): void
}

interface RendererBindingV2 {
  readonly ref: CanvasDocumentRef
  readonly sessionId: Id128
  readonly sender: IpcMainInvokeEvent["sender"]
}

/**
 * Main IPC edge for renderer collaboration leases. Actor identity is derived
 * from trusted WebContents; renderer bytes can never select authority, Id128,
 * Yjs updates, owner facts, or a full document replacement.
 */
export function registerCanvasSessionIpcV2(
  owner: CanvasCollaborationSessionOwnerV2,
  options: {
    readonly ipcMain: CanvasSessionIpcMainV2
    readonly isTrustedSender: (event: IpcMainInvokeEvent) => boolean
    readonly resolveActiveCanvas: (event: IpcMainInvokeEvent) => Promise<Readonly<{
      readonly canvasId: string
      readonly projectId: string
    }> | null>
    readonly prepareProject: (projectId: string) => Promise<void>
  },
): () => void {
  const bindings = new Map<Id128, RendererBindingV2>()
  const senderSessions = new Map<number, Set<Id128>>()
  const watchedSenders = new Set<number>()

  const trusted = (event: IpcMainInvokeEvent) => {
    if (!options.isTrustedSender(event)) throw new Error("Canvas session IPC request came from an untrusted renderer")
  }

  options.ipcMain.handle(canvasSessionIpcChannels.open, async (event, value) => {
    trusted(event)
    const ref = requireRef(value)
    await requireActiveRef(event, ref)
    await options.prepareProject(ref.scopeId)
    await requireActiveRef(event, ref)
    const owned = senderSessions.get(event.sender.id)
    if ((owned?.size ?? 0) >= maximumRendererSessionsPerWebContents) {
      throw new Error("Canvas renderer session capacity is exhausted")
    }
    const projection = await owner.open({
      ref,
      actor: { kind: "renderer", id: `desktop:renderer:${event.sender.id}` },
    })
    try {
      await requireActiveRef(event, ref)
    } catch (error) {
      owner.close({ ref, sessionId: projection.sessionId })
      throw error
    }
    if (bindings.has(projection.sessionId)) {
      owner.close({ ref, sessionId: projection.sessionId })
      throw new Error("Canvas renderer session identity was reused")
    }
    bindings.set(projection.sessionId, { ref, sessionId: projection.sessionId, sender: event.sender })
    const sessions = owned ?? new Set<Id128>()
    sessions.add(projection.sessionId)
    senderSessions.set(event.sender.id, sessions)
    watchSender(event)
    return projection
  })

  options.ipcMain.handle(canvasSessionIpcChannels.query, async (event, value) => {
    trusted(event)
    const scope = requireScope(value)
    await requireActiveBinding(event, scope)
    return owner.queryRenderer(scope.ref, scope.sessionId)
  })

  options.ipcMain.handle(canvasSessionIpcChannels.submit, async (event, value) => {
    trusted(event)
    const input = requireSubmit(value)
    await requireActiveBinding(event, input)
    return owner.submitRenderer(input)
  })

  options.ipcMain.handle(canvasSessionIpcChannels.undo, async (event, value) => {
    trusted(event)
    const input = requireHistory(value)
    await requireActiveBinding(event, input)
    return owner.undo(input)
  })

  options.ipcMain.handle(canvasSessionIpcChannels.redo, async (event, value) => {
    trusted(event)
    const input = requireHistory(value)
    await requireActiveBinding(event, input)
    return owner.redo(input)
  })

  options.ipcMain.handle(canvasSessionIpcChannels.flush, async (event, value) => {
    trusted(event)
    const scope = requireScope(value)
    await requireActiveBinding(event, scope)
    return owner.flush(scope.ref, scope.sessionId)
  })

  options.ipcMain.handle(canvasSessionIpcChannels.close, async (event, value) => {
    trusted(event)
    const scope = requireScope(value)
    // Unmount must remain possible after Workbench scope changed. Sender and
    // exact lease binding are sufficient because close grants no document access.
    requireBinding(event, scope)
    revoke(scope.sessionId)
  })

  const unsubscribe = owner.subscribe((event) => {
    const binding = bindings.get(event.sessionId)
    if (!binding || !sameRef(binding.ref, event.ref) || binding.sender.isDestroyed()) return
    binding.sender.send(canvasSessionIpcChannels.invalidated, event)
  })

  return () => {
    unsubscribe()
    for (const channel of Object.values(canvasSessionIpcChannels)) {
      if (channel !== canvasSessionIpcChannels.invalidated) options.ipcMain.removeHandler(channel)
    }
    for (const sessionId of bindings.keys()) revoke(sessionId)
    senderSessions.clear()
    watchedSenders.clear()
  }

  function requireBinding(event: IpcMainInvokeEvent, scope: CanvasRendererSessionScopeV2): RendererBindingV2 {
    const binding = bindings.get(scope.sessionId)
    if (!binding || binding.sender.id !== event.sender.id || !sameRef(binding.ref, scope.ref)) {
      throw new Error("Canvas renderer session is stale or belongs to another renderer")
    }
    return binding
  }

  async function requireActiveBinding(
    event: IpcMainInvokeEvent,
    scope: CanvasRendererSessionScopeV2,
  ): Promise<RendererBindingV2> {
    const binding = requireBinding(event, scope)
    try {
      await requireActiveRef(event, binding.ref)
      return binding
    } catch (error) {
      revoke(binding.sessionId)
      throw error
    }
  }

  async function requireActiveRef(event: IpcMainInvokeEvent, ref: CanvasDocumentRef): Promise<void> {
    const active = await options.resolveActiveCanvas(event)
    if (!active || active.projectId !== ref.scopeId || active.canvasId !== ref.canvasId) {
      console.error("Canvas session Workbench scope mismatch", { active, requested: ref })
      throw new Error("Canvas session request does not match the invoking renderer's live Workbench scope")
    }
  }

  function watchSender(event: IpcMainInvokeEvent): void {
    const senderId = event.sender.id
    if (watchedSenders.has(senderId)) return
    watchedSenders.add(senderId)
    event.sender.once("destroyed", () => {
      for (const sessionId of senderSessions.get(senderId) ?? []) revoke(sessionId)
      senderSessions.delete(senderId)
      watchedSenders.delete(senderId)
    })
  }

  function revoke(sessionId: Id128): void {
    const binding = bindings.get(sessionId)
    if (!binding) return
    bindings.delete(sessionId)
    const sessions = senderSessions.get(binding.sender.id)
    sessions?.delete(sessionId)
    if (sessions?.size === 0) senderSessions.delete(binding.sender.id)
    try { owner.close({ ref: binding.ref, sessionId }) } catch { /* Revocation is idempotent at the IPC edge. */ }
  }
}

function requireHistory(value: unknown): CanvasRendererSessionScopeV2 & { readonly commandId: string } {
  const record = exactRecord(value, ["commandId", "ref", "sessionId"], "Canvas history request")
  return Object.freeze({ ...requireScopeFields(record), commandId: requireCommandId(record.commandId) })
}

function requireSubmit(value: unknown): CanvasRendererSessionScopeV2 & {
  readonly command: CanvasRendererCommandV2
  readonly commandId: string
} {
  const record = exactRecord(value, ["command", "commandId", "ref", "sessionId"], "Canvas submit request")
  return Object.freeze({
    ...requireScopeFields(record),
    commandId: requireCommandId(record.commandId),
    command: requireRendererCommand(record.command),
  })
}

function requireScope(value: unknown): CanvasRendererSessionScopeV2 {
  return Object.freeze(requireScopeFields(exactRecord(value, ["ref", "sessionId"], "Canvas session scope")))
}

function requireScopeFields(record: Record<string, unknown>): CanvasRendererSessionScopeV2 {
  return { ref: requireRef(record.ref), sessionId: parseId128(record.sessionId) }
}

function requireRef(value: unknown): CanvasDocumentRef {
  const record = exactRecord(value, ["canvasId", "scopeId"], "Canvas document reference")
  return Object.freeze({
    canvasId: requireIdentity(record.canvasId, "Canvas id"),
    scopeId: requireIdentity(record.scopeId, "Canvas scope id"),
  })
}

function requireRendererCommand(value: unknown): CanvasRendererCommandV2 {
  const record = exactRecord(value, ["body", "format", "kind"], "Canvas renderer command")
  if (record.format !== "convax.canvas-renderer-command/2" || record.kind !== "canvas.nodes.set-geometry/2") {
    throw new Error("Canvas renderer command kind is unsupported")
  }
  const body = exactRecord(record.body, ["updates"], "Canvas renderer command body")
  if (!Array.isArray(body.updates) || body.updates.length === 0 || body.updates.length > 4_096) {
    throw new Error("Canvas renderer geometry update set is invalid")
  }
  const updates = body.updates.map((item) => {
    const update = exactRecord(item, ["node", "position", "size"], "Canvas renderer geometry update", true)
    const node = exactRecord(update.node, ["id", "incarnation", "kind"], "Canvas renderer node reference")
    if (node.kind !== "node") throw new Error("Canvas renderer geometry target is not a node")
    const normalized: {
      node: { kind: "node"; id: string; incarnation: string }
      position: { x: number; y: number }
      size?: { width: number; height: number } | null
    } = {
      node: {
        kind: "node",
        id: requireIdentity(node.id, "Canvas renderer node id"),
        incarnation: requireIdentity(node.incarnation, "Canvas renderer node incarnation"),
      },
      position: requirePoint(update.position, "Canvas renderer position"),
    }
    if (Object.prototype.hasOwnProperty.call(update, "size")) {
      normalized.size = update.size === null ? null : requireSize(update.size)
    }
    return Object.freeze(normalized)
  })
  return Object.freeze({
    format: "convax.canvas-renderer-command/2",
    kind: "canvas.nodes.set-geometry/2",
    body: Object.freeze({ updates: Object.freeze(updates) }),
  })
}

function requirePoint(value: unknown, label: string): { x: number; y: number } {
  const record = exactRecord(value, ["x", "y"], label)
  return { x: finite(record.x, `${label} x`), y: finite(record.y, `${label} y`) }
}

function requireSize(value: unknown): { width: number; height: number } {
  const record = exactRecord(value, ["height", "width"], "Canvas renderer size")
  const width = finite(record.width, "Canvas renderer width")
  const height = finite(record.height, "Canvas renderer height")
  if (width <= 0 || height <= 0) throw new Error("Canvas renderer size is invalid")
  return { width, height }
}

function exactRecord(
  value: unknown,
  keys: readonly string[],
  label: string,
  optionalLast = false,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} is invalid`)
  const record = value as Record<string, unknown>
  const actual = Object.keys(record).sort()
  const required = optionalLast ? keys.slice(0, -1) : keys
  if (required.some((key) => !actual.includes(key)) || actual.some((key) => !keys.includes(key))) {
    throw new Error(`${label} has an invalid field set`)
  }
  return record
}

function requireCommandId(value: unknown): string {
  return requireIdentity(value, "Canvas command id")
}

function requireIdentity(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) throw new Error(`${label} is invalid`)
  return value
}

function finite(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label} is invalid`)
  return value
}

function sameRef(left: CanvasDocumentRef, right: CanvasDocumentRef): boolean {
  return left.canvasId === right.canvasId && left.scopeId === right.scopeId
}
