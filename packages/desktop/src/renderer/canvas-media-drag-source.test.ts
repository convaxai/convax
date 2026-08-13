import { describe, expect, test } from "bun:test"
import {
  createCanvasDocument,
  createCanvasSelectionActionContext,
  createMediaNode,
  createTextNode,
} from "@convax/canvas"
import { canvasProjectionResourceMetadataKey, type CanvasResourceRef } from "@convax/canvas/collaboration"
import { projectResourceReferenceKey, type ProjectResourceReference } from "@convax/project/canvas"
import type {
  CanvasExternalMediaDragPrepareRequest,
  CanvasExternalMediaDragRendererClient,
} from "../canvas-external-drag-contracts"

import { createCanvasMediaSelectionDragSource, isManagedCanvasMediaDragSelection } from "./canvas-media-drag-source"

const image = media("image", "image", managedReference("image.png", "image/png", "a"))
const video = media("video", "video", managedReference("video.mp4", "video/mp4", "b"))
const audio = media("audio", "audio", managedReference("audio.wav", "audio/wav", "c"))
const projectFileVideo = media("project-file-video", "video", {
  kind: "project-file",
  path: "Media/project-file-video.mp4",
})
const canonicalImage = createMediaNode({
  id: "canonical-image",
  position: { x: 0, y: 0 },
  resource: {
    id: "canonical-image-resource",
    kind: "image",
    metadata: { [canvasProjectionResourceMetadataKey]: canonicalImageResource() },
    state: { status: "ready", url: "convax-asset://project/canonical-image" },
  },
})
const text = createTextNode({
  id: "text",
  metadata: { [projectResourceReferenceKey]: { kind: "project-file", path: "Notes/no.md" } },
  position: { x: 30, y: 0 },
  resourceState: { status: "ready", text: "No" },
})

function managedReference(name: string, mediaType: string, digestCharacter: string) {
  return {
    kind: "managed-asset" as const,
    mediaType,
    name,
    sha256: digestCharacter.repeat(64),
  }
}

function canonicalImageResource(): CanvasResourceRef {
  const digest = "d".repeat(64)
  return {
    byteLength: "1" as never,
    contentDigest: digest as never,
    format: "convax.canvas-resource-ref",
    mediaClass: "image",
    mime: "image/png",
    ownerProofDigest: "e".repeat(64) as never,
    uri: `convax-project://project-one/epochs/AQEBAQEBAQEBAQEBAQEBAQ/entries/pf_${"a".repeat(64)}?blob=sha256%3A${digest}`,
  }
}

function media(id: string, kind: "audio" | "image" | "video", reference: ProjectResourceReference) {
  return createMediaNode({
    id,
    position: { x: 0, y: 0 },
    resource: {
      id: `${id}-resource`,
      kind,
      metadata: { [projectResourceReferenceKey]: reference },
      state: { status: "ready", url: `convax-asset://project/${id}` },
    },
  })
}

function context(
  nodeIds: string[],
  options: { edges?: string[]; nodes?: (typeof image)[]; signal?: AbortSignal } = {},
) {
  const document = {
    ...createCanvasDocument({
      id: "canvas-1",
      nodes: options.nodes ?? [image, video, audio, text],
      title: "Canvas",
    }),
    revision: 9,
  }
  return createCanvasSelectionActionContext(
    document,
    nodeIds,
    options.edges ?? [],
    options.signal ?? new AbortController().signal,
  )
}

function client(overrides: Partial<CanvasExternalMediaDragRendererClient> = {}) {
  const canceledPreparations: string[] = []
  const prepared: CanvasExternalMediaDragPrepareRequest[] = []
  const started: string[] = []
  const canceled: string[] = []
  const value: CanvasExternalMediaDragRendererClient = {
    cancel: ({ ticket }) => canceled.push(ticket),
    cancelPrepare: ({ prepareId }) => canceledPreparations.push(prepareId),
    prepare: async (request) => {
      prepared.push(request)
      return { expiresAt: Date.now() + 60_000, itemCount: request.nodeIds.length, ticket: "ticket-1" }
    },
    start: ({ ticket }) => started.push(ticket),
    ...overrides,
  }
  return { canceled, canceledPreparations, client: value, prepared, started }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, reject, resolve }
}

describe("Canvas media external drag visibility", () => {
  test("accepts complete selections of managed assets and Project files", () => {
    expect(isManagedCanvasMediaDragSelection(context([image.id]))).toBe(true)
    expect(isManagedCanvasMediaDragSelection(context([video.id, audio.id, image.id]))).toBe(true)
    expect(isManagedCanvasMediaDragSelection(context([projectFileVideo.id], { nodes: [projectFileVideo] }))).toBe(true)
    expect(isManagedCanvasMediaDragSelection(context([canonicalImage.id], { nodes: [canonicalImage] }))).toBe(true)
  })

  test("rejects empty, mixed, incomplete, edge, remote, private, and aborted selections", () => {
    expect(isManagedCanvasMediaDragSelection(context([]))).toBe(false)
    expect(isManagedCanvasMediaDragSelection(context([image.id, text.id]))).toBe(false)
    expect(isManagedCanvasMediaDragSelection(context([image.id, "missing"]))).toBe(false)
    expect(isManagedCanvasMediaDragSelection(context([image.id], { edges: ["edge-1"] }))).toBe(false)

    const remote = createMediaNode({
      id: "remote",
      position: { x: 0, y: 0 },
      resource: {
        id: "remote-resource",
        kind: "image",
        metadata: {},
        state: { status: "ready", url: "https://example.com/image.png" },
      },
    })
    const privateMedia = media("private", "video", {
      kind: "project-file",
      path: ".convax/canvases/canvas-1/document.json",
    })
    expect(isManagedCanvasMediaDragSelection(context([remote.id], { nodes: [remote] }))).toBe(false)
    expect(isManagedCanvasMediaDragSelection(context([privateMedia.id], { nodes: [privateMedia] }))).toBe(false)

    const controller = new AbortController()
    controller.abort(new DOMException("Stale selection", "AbortError"))
    expect(isManagedCanvasMediaDragSelection(context([image.id], { signal: controller.signal }))).toBe(false)
  })
})

describe("Canvas media external drag lifecycle", () => {
  test("flushes first, prepares only scoped ids, and starts a ticket exactly once", async () => {
    const calls: string[] = []
    const adapter = client({
      prepare: async (request) => {
        calls.push("prepare")
        adapter.prepared.push(request)
        return { expiresAt: Date.now() + 60_000, itemCount: request.nodeIds.length, ticket: "ticket-prepared" }
      },
      start: ({ ticket }) => {
        calls.push(`start:${ticket}`)
        adapter.started.push(ticket)
      },
    })
    const source = createCanvasMediaSelectionDragSource({
      client: adapter.client,
      createPrepareId: () => "prepare_test_external_drag",
      flush: async () => {
        calls.push("flush")
      },
      label: "Drag outside Convax",
      mode: {
        description: "Drag selected media to another app.",
        exitLabel: "Exit",
        label: "Drag to Other Apps",
        preparingLabel: "Preparing selected media",
      },
      scopeId: "project-1",
    })

    const prepared = await source.prepare(context([audio.id, image.id]))
    expect(source.mode?.label).toBe("Drag to Other Apps")
    expect(calls).toEqual(["flush", "prepare"])
    expect(adapter.prepared).toEqual([
      {
        nodeIds: [audio.id, image.id],
        prepareId: "prepare_test_external_drag",
        ref: { canvasId: "canvas-1", scopeId: "project-1" },
      },
    ])
    expect(Object.keys(prepared).sort()).toEqual(["dispose", "expiresAt", "start"])
    expect(prepared.expiresAt).toBeGreaterThan(Date.now())

    prepared.start()
    prepared.start()
    prepared.dispose()
    expect(calls).toEqual(["flush", "prepare", "start:ticket-prepared"])
    expect(adapter.canceled).toEqual([])
  })

  test("disposes an unconsumed ticket once and makes later start a no-op", async () => {
    const adapter = client()
    const source = createCanvasMediaSelectionDragSource({
      client: adapter.client,
      createPrepareId: () => "prepare_dispose_external_drag",
      flush: async () => undefined,
      label: "Drag outside Convax",
      scopeId: "project-1",
    })
    const prepared = await source.prepare(context([video.id]))

    prepared.dispose()
    prepared.dispose()
    prepared.start()
    expect(adapter.canceled).toEqual(["ticket-1"])
    expect(adapter.started).toEqual([])
  })

  test("cancels a ticket returned after the selection aborts during prepare", async () => {
    const gate = deferred<{ expiresAt: number; itemCount: number; ticket: string }>()
    const adapter = client({ prepare: () => gate.promise })
    const controller = new AbortController()
    const source = createCanvasMediaSelectionDragSource({
      client: adapter.client,
      createPrepareId: () => "prepare_abort_external_drag",
      flush: async () => undefined,
      label: "Drag outside Convax",
      scopeId: "project-1",
    })
    const pending = source.prepare(context([image.id], { signal: controller.signal }))
    await Promise.resolve()
    const reason = new DOMException("Selection changed", "AbortError")
    controller.abort(reason)
    expect(adapter.canceledPreparations).toEqual(["prepare_abort_external_drag"])
    gate.resolve({ expiresAt: Date.now() + 60_000, itemCount: 1, ticket: "late-ticket" })

    await expect(pending).rejects.toBe(reason)
    expect(adapter.canceled).toEqual(["late-ticket"])
    expect(adapter.started).toEqual([])
  })

  test("preserves an abort that happened before preparation without flushing", async () => {
    const adapter = client()
    const reason = new DOMException("Selection is already stale", "AbortError")
    const controller = new AbortController()
    controller.abort(reason)
    let flushes = 0
    const source = createCanvasMediaSelectionDragSource({
      client: adapter.client,
      createPrepareId: () => "prepare_before_external_drag",
      flush: async () => {
        flushes += 1
      },
      label: "Drag outside Convax",
      scopeId: "project-1",
    })

    await expect(source.prepare(context([image.id], { signal: controller.signal }))).rejects.toBe(reason)
    expect(flushes).toBe(0)
    expect(adapter.prepared).toEqual([])
  })

  test("cancels a prepared ticket when the selection later becomes stale", async () => {
    const adapter = client()
    const controller = new AbortController()
    const source = createCanvasMediaSelectionDragSource({
      client: adapter.client,
      createPrepareId: () => "prepare_stale_external_drag",
      flush: async () => undefined,
      label: "Drag outside Convax",
      scopeId: "project-1",
    })
    const prepared = await source.prepare(context([audio.id], { signal: controller.signal }))

    controller.abort(new DOMException("Selection changed", "AbortError"))
    prepared.start()
    expect(adapter.canceled).toEqual(["ticket-1"])
    expect(adapter.started).toEqual([])
  })

  test("does not prepare after an abort during flush and preserves a stale prepare failure", async () => {
    const flushGate = deferred<void>()
    const adapter = client()
    const controller = new AbortController()
    const source = createCanvasMediaSelectionDragSource({
      client: adapter.client,
      createPrepareId: () => "prepare_flush_external_drag",
      flush: () => flushGate.promise,
      label: "Drag outside Convax",
      scopeId: "project-1",
    })
    const pending = source.prepare(context([image.id], { signal: controller.signal }))
    controller.abort(new DOMException("Canvas changed", "AbortError"))
    flushGate.resolve()
    await expect(pending).rejects.toMatchObject({ name: "AbortError" })
    expect(adapter.prepared).toEqual([])

    const stale = new Error("Canvas changed before native drag preparation")
    const staleAdapter = client({
      prepare: async () => {
        throw stale
      },
    })
    const staleSource = createCanvasMediaSelectionDragSource({
      client: staleAdapter.client,
      createPrepareId: () => "prepare_failure_external_drag",
      flush: async () => undefined,
      label: "Drag outside Convax",
      scopeId: "project-1",
    })
    await expect(staleSource.prepare(context([image.id]))).rejects.toBe(stale)
    expect(staleAdapter.canceled).toEqual([])
  })

  test("cancels a ticket if the preload start bridge fails synchronously", async () => {
    const failure = new Error("Preload bridge is unavailable")
    const adapter = client({
      start: () => {
        throw failure
      },
    })
    const source = createCanvasMediaSelectionDragSource({
      client: adapter.client,
      createPrepareId: () => "prepare_start_external_drag",
      flush: async () => undefined,
      label: "Drag outside Convax",
      scopeId: "project-1",
    })
    const prepared = await source.prepare(context([image.id]))

    expect(() => prepared.start()).toThrow(failure)
    expect(adapter.canceled).toEqual(["ticket-1"])
  })

  test("rejects and releases an expired or mismatched ticket response", async () => {
    const expired = client({
      prepare: async () => ({ expiresAt: Date.now() - 1, itemCount: 1, ticket: "expired-ticket" }),
    })
    const expiredSource = createCanvasMediaSelectionDragSource({
      client: expired.client,
      createPrepareId: () => "prepare_expired_external_drag",
      flush: async () => undefined,
      label: "Drag outside Convax",
      scopeId: "project-1",
    })
    await expect(expiredSource.prepare(context([image.id]))).rejects.toThrow("invalid or expired")
    expect(expired.canceled).toEqual(["expired-ticket"])

    const mismatched = client({
      prepare: async () => ({ expiresAt: Date.now() + 60_000, itemCount: 2, ticket: "mismatched-ticket" }),
    })
    const mismatchedSource = createCanvasMediaSelectionDragSource({
      client: mismatched.client,
      createPrepareId: () => "prepare_mismatch_external_drag",
      flush: async () => undefined,
      label: "Drag outside Convax",
      scopeId: "project-1",
    })
    await expect(mismatchedSource.prepare(context([image.id]))).rejects.toThrow("invalid or expired")
    expect(mismatched.canceled).toEqual(["mismatched-ticket"])
  })
})
