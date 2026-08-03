import { describe, expect, mock, test } from "bun:test"
import { applyCanvasApplicationCommand } from "@convax/canvas/application"
import { createCanvasDocument, createMediaNode, createTextNode, type CanvasDocument } from "@convax/canvas/core"
import { dehydrateProjectCanvasDocument, projectResourceReferenceKey } from "@convax/project/canvas"
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
    const firstNode = createTextNode({
      id: "first",
      metadata: {},
      position: { x: 0, y: 0 },
      resourceState: { status: "ready", text: "First" },
    })
    const secondNode = createTextNode({
      id: "second",
      metadata: {},
      position: { x: 20, y: 20 },
      resourceState: { status: "ready", text: "Second" },
    })
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

  test("preserves renderer runtime resources when collapsing an empty durable patch", async () => {
    const hydrated = {
      ...createCanvasDocument({
        id: "canvas-one",
        nodes: [
          {
            id: "plugin-one",
            type: "file",
            position: { x: -320, y: 0 },
            data: {
              kind: "plugin.surface",
              label: "Plugin",
              metadata: { camera: "front" },
            },
          },
          createMediaNode({
            id: "image-one",
            position: { x: 0, y: 0 },
            resource: {
              id: "image-resource",
              kind: "image",
              metadata: {
                [projectResourceReferenceKey]: {
                  kind: "managed-asset",
                  mediaType: "image/png",
                  name: "image-one.png",
                  sha256: "a".repeat(64),
                },
              },
              mimeType: "image/png",
              name: "image-one.png",
              state: {
                contentRevision: "image-revision",
                status: "ready",
                url: "convax-resource://image-one",
              },
            },
          }),
          createMediaNode({
            id: "video-one",
            position: { x: 320, y: 0 },
            resource: {
              id: "video-resource",
              kind: "video",
              metadata: {
                [projectResourceReferenceKey]: {
                  kind: "managed-asset",
                  mediaType: "video/mp4",
                  name: "video-one.mp4",
                  sha256: "b".repeat(64),
                },
              },
              mimeType: "video/mp4",
              name: "video-one.mp4",
              state: {
                contentRevision: "video-revision",
                posterUrl: "convax-resource://video-one-poster",
                status: "ready",
                url: "convax-resource://video-one",
              },
            },
          }),
        ],
      }),
      revision: 4,
    }
    let mainResult: CanvasDocument | undefined
    const execute = mock(async () => {
      if (!mainResult) throw new Error("Main result was not prepared")
      return {
        affectedNodeIds: ["plugin-one"],
        changed: true,
        createdNodeIds: [],
        document: structuredClone(mainResult),
        storageVersion: "storage-5",
        warnings: [],
      }
    })
    const persistence = createRendererCanvasPersistence({
      client: {
        execute,
        async load() {
          return { document: structuredClone(hydrated), storageVersion: "storage-4" }
        },
      },
      commandId: () => "renderer-command",
      dehydrate: dehydrateProjectCanvasDocument,
      hydrate: structuredClone,
      ref: { canvasId: "canvas-one", scopeId: "project-one" },
    })
    const signal = new AbortController().signal
    const loaded = await persistence.load("canvas-one", signal)
    const firstProjection = {
      ...loaded!,
      nodes: loaded!.nodes.map((node) =>
        node.id === "plugin-one"
          ? {
              ...node,
              data: {
                ...node.data,
                metadata: { camera: "profile" },
              },
            }
          : node,
      ),
      revision: 5,
    }
    mainResult = structuredClone(firstProjection)

    const committed = await persistence.save(firstProjection, signal)
    const saved = await persistence.save(
      { ...committed, nodes: [...committed.nodes].reverse(), revision: 6 },
      signal,
    )

    expect(saved.revision).toBe(5)
    expect(saved.nodes.map((node) => node.id)).toEqual(["plugin-one", "image-one", "video-one"])
    expect(saved.nodes[0]?.data.metadata).toEqual({ camera: "profile" })
    expect(saved.nodes.slice(1).map((node) => node.data.resourceState)).toEqual([
      {
        contentRevision: "image-revision",
        status: "ready",
        url: "convax-resource://image-one",
      },
      {
        contentRevision: "video-revision",
        posterUrl: "convax-resource://video-one-poster",
        status: "ready",
        url: "convax-resource://video-one",
      },
    ])
    expect(execute).toHaveBeenCalledTimes(1)
  })
})
