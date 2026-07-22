import { describe, expect, mock, test } from "bun:test"
import { applyCanvasApplicationCommand } from "@convax/canvas/application"
import { createCanvasDocument, createTextNode, type CanvasDocument } from "@convax/canvas/core"
import type { CanvasRendererCommandRequest, CanvasRendererDocumentClient } from "../canvas-document-contracts"
import { createRendererCanvasPersistence } from "./canvas-command-persistence"

describe("Renderer Canvas command persistence", () => {
  test("serializes optimistic edits as revision-bound element patches against Main results", async () => {
    let authoritative = createCanvasDocument({ id: "canvas-one", title: "Canvas" })
    let releaseFirst!: () => void
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const requests: CanvasRendererCommandRequest[] = []
    const client: CanvasRendererDocumentClient = {
      async execute(request) {
        requests.push(structuredClone(request))
        if (requests.length === 1) await firstGate
        const applied = applyCanvasApplicationCommand(authoritative, request.command)
        authoritative = { ...applied.document, revision: authoritative.revision + 1 }
        return {
          affectedNodeIds: applied.affectedNodeIds,
          changed: applied.changed,
          createdNodeIds: applied.createdNodeIds,
          document: structuredClone(authoritative),
          storageVersion: `storage-${authoritative.revision}`,
          warnings: applied.warnings,
        }
      },
      async load() {
        return { document: structuredClone(authoritative), storageVersion: `storage-${authoritative.revision}` }
      },
    }
    let commandSequence = 0
    const pending = mock((_value: Promise<CanvasDocument>) => undefined)
    const persistence = createRendererCanvasPersistence({
      client,
      commandId: () => `renderer-command-${++commandSequence}`,
      dehydrate: structuredClone,
      hydrate: structuredClone,
      onSavePending: pending,
      ref: { canvasId: "canvas-one", scopeId: "project-one" },
    })
    const controller = new AbortController()
    await persistence.load("canvas-one", controller.signal)
    const firstNode = createTextNode({ id: "first", position: { x: 0, y: 0 }, text: "First" })
    const secondNode = createTextNode({ id: "second", position: { x: 20, y: 20 }, text: "Second" })
    const firstProjection = { ...authoritative, nodes: [firstNode], revision: 1 }
    const secondProjection = { ...authoritative, nodes: [firstNode, secondNode], revision: 2 }

    const firstSave = persistence.save(firstProjection, controller.signal)
    await Promise.resolve()
    await Promise.resolve()
    expect(requests).toHaveLength(1)
    const secondSave = persistence.save(secondProjection, controller.signal)
    await Promise.resolve()
    expect(requests).toHaveLength(1)

    releaseFirst()
    await expect(firstSave).resolves.toMatchObject({ revision: 1 })
    await expect(secondSave).resolves.toMatchObject({ revision: 2 })
    expect(requests).toHaveLength(2)
    expect(requests[0]).toMatchObject({
      command: { addedNodes: [{ id: "first" }], type: "document.patch" },
      expectedRevision: 0,
    })
    expect(requests[1]).toMatchObject({
      command: { addedNodes: [{ id: "second" }], type: "document.patch" },
      expectedRevision: 1,
    })
    expect(requests.some((request) => "document" in request)).toBeFalse()
    expect(authoritative.nodes.map((node) => node.id)).toEqual(["first", "second"])
    expect(pending).toHaveBeenCalledTimes(2)
  })

  test("loads Main's current document instead of persisting a stale projection", async () => {
    const authoritative = { ...createCanvasDocument({ id: "canvas-one" }), revision: 4 }
    const execute = mock(async () => {
      throw new Error("Unexpected command")
    })
    const persistence = createRendererCanvasPersistence({
      client: {
        execute,
        async load() {
          return { document: authoritative, storageVersion: "storage-4" }
        },
      },
      commandId: () => "renderer-command",
      dehydrate: structuredClone,
      hydrate: structuredClone,
      ref: { canvasId: "canvas-one", scopeId: "project-one" },
    })

    await expect(persistence.load("canvas-one", new AbortController().signal)).resolves.toMatchObject({ revision: 4 })
    expect(execute).not.toHaveBeenCalled()
  })

  test("collapses a renderer-only revision when the semantic patch is empty", async () => {
    const authoritative = { ...createCanvasDocument({ id: "canvas-one" }), revision: 4 }
    const execute = mock(async () => {
      throw new Error("An empty patch must not reach Main")
    })
    const persistence = createRendererCanvasPersistence({
      client: {
        execute,
        async load() {
          return { document: authoritative, storageVersion: "storage-4" }
        },
      },
      commandId: () => "renderer-command",
      dehydrate: structuredClone,
      hydrate: structuredClone,
      ref: { canvasId: "canvas-one", scopeId: "project-one" },
    })
    const signal = new AbortController().signal
    await persistence.load("canvas-one", signal)

    const optimisticProjection = { ...structuredClone(authoritative), revision: 5 }

    await expect(persistence.save(optimisticProjection, signal)).resolves.toEqual(authoritative)
    expect(execute).not.toHaveBeenCalled()
  })
})
