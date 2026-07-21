import { describe, expect, test } from "bun:test"
import {
  createCanvasDocument,
  createGroupNode,
  createMediaNode,
  createTextNode as createCanvasTextNode,
} from "../document"
import type { CanvasTextResource } from "../types"
import { CanvasCommandValidationError, CanvasRevisionConflictError, createCanvasNodeContentGuard } from "./commands"
import {
  CanvasStorageConflictError,
  type CanvasDocumentRepository,
  type CanvasDocumentSaveRequest,
  type CanvasDocumentSnapshot,
} from "./persistence"
import {
  CanvasResourcePartialFailureError,
  CanvasResourceBusinessService,
  type CanvasResourcePreparationRequest,
  type CanvasResourceSource,
} from "./resources"
import { CanvasApplicationService, CanvasCommandIdConflictError } from "./service"

function source(): CanvasResourceSource {
  return { kind: "host-file", path: "assets/poster.png", sourceId: "poster_source" }
}

function createTextNode(
  input: Omit<Parameters<typeof createCanvasTextNode>[0], "metadata" | "resourceState"> & {
    metadata?: Record<string, unknown>
    text?: string
  },
) {
  const { text, ...nodeInput } = input
  return createCanvasTextNode({
    ...nodeInput,
    metadata: input.metadata ?? {},
    resourceState: { status: "ready", ...(text === undefined ? {} : { text }) },
  })
}

function preparedText(text: string): CanvasTextResource {
  return { id: "prepared", kind: "text", metadata: {}, state: { status: "ready", text } }
}

describe("canvas resource business service", () => {
  test("relinks one resource while preserving its identity, geometry, relationships, and unrelated data", async () => {
    const parent = createGroupNode({
      height: 640,
      id: "parent",
      position: { x: 30, y: 40 },
      width: 960,
    })
    const image = {
      ...createMediaNode({
        id: "image",
        label: "Pinned title",
        position: { x: 120, y: 80 },
        resource: {
          height: 720,
          id: "old-resource",
          kind: "image" as const,
          metadata: {
            convaxPluginState: { crop: "center" },
            convaxProjectResource: { kind: "project-file", path: "old.png" },
            convaxProjectResourceBindings: {
              poster: { kind: "managed-asset", name: "old-poster.jpg", sha256: "f".repeat(64) },
            },
          },
          mimeType: "image/png",
          name: "old.png",
          state: { contentRevision: "old", status: "missing" as const },
          width: 1_280,
        },
      }),
      measured: { height: 181, width: 321 },
      parentId: "parent",
      zIndex: 7,
    }
    const document = {
      ...createCanvasDocument({
        edges: [{ id: "edge", source: "image", target: "parent", type: "smoothstep" }],
        id: "canvas-main",
        nodes: [parent, image],
      }),
      revision: 4,
    }
    let snapshot: CanvasDocumentSnapshot = { document, storageVersion: "v4" }
    const business = new CanvasResourceBusinessService(
      {
        async prepare() {
          throw new Error("prepared relink must not prepare again")
        },
      },
      new CanvasApplicationService({
        async load() {
          return snapshot
        },
        async save(request) {
          snapshot = { document: request.document, storageVersion: "v5" }
          return { storageVersion: "v5" }
        },
      }),
    )

    const result = await business.relinkPreparedResource(
      {
        actor: { id: "desktop:renderer", kind: "ui" },
        canvasId: "canvas-main",
        commandId: "relink-image",
        expectedRevision: 4,
        nodeId: "image",
        metadataKeysToRemove: ["convaxProjectResourceBindings"],
        scopeId: "project-one",
      },
      {
        items: [
          {
            id: "replacement",
            kind: "image",
            metadata: { convaxProjectResource: { kind: "managed-asset", name: "new.webp", sha256: "a".repeat(64) } },
            mimeType: "image/webp",
            name: "new.webp",
            state: { status: "stale" },
          },
        ],
      },
    )

    const next = result.document.nodes.find((node) => node.id === "image")!
    expect(result).toMatchObject({ affectedNodeIds: ["image"], createdNodeIds: [], storageVersion: "v5" })
    expect(result.document).toMatchObject({ edges: document.edges, revision: 5 })
    expect(next).toMatchObject({
      id: "image",
      measured: { height: 181, width: 321 },
      parentId: "parent",
      position: { x: 120, y: 80 },
      style: image.style,
      zIndex: 7,
      data: {
        kind: "image",
        label: "Pinned title",
        metadata: {
          convaxPluginState: { crop: "center" },
          convaxProjectResource: { kind: "managed-asset", name: "new.webp", sha256: "a".repeat(64) },
        },
        mimeType: "image/webp",
        name: "new.webp",
        resourceState: { status: "stale" },
      },
    })
    expect(next.data).not.toHaveProperty("height")
    expect(next.data).not.toHaveProperty("width")
    expect(next.data).not.toHaveProperty("durationMs")
    expect(next.data.metadata).not.toHaveProperty("convaxProjectResourceBindings")
  })

  test("replaces media dimensions and duration without resizing its Canvas geometry or changing fit", async () => {
    const video = {
      ...createMediaNode({
        id: "video",
        position: { x: 40, y: 60 },
        resource: {
          durationMs: 120_000,
          height: 1_080,
          id: "old-video",
          kind: "video" as const,
          metadata: { convaxProjectResource: { kind: "project-file", path: "old.mp4" } },
          mimeType: "video/mp4",
          name: "old.mp4",
          state: { status: "missing" as const },
          width: 1_920,
        },
      }),
      height: 277,
      measured: { height: 279, width: 499 },
      style: { height: 277, width: 500 },
      width: 500,
    }
    video.data.fit = "cover"
    let snapshot: CanvasDocumentSnapshot = {
      document: { ...createCanvasDocument({ id: "canvas-video", nodes: [video] }), revision: 9 },
      storageVersion: "v9",
    }
    const business = new CanvasResourceBusinessService(
      {
        async prepare() {
          throw new Error("not used")
        },
      },
      new CanvasApplicationService({
        async load() {
          return snapshot
        },
        async save(request) {
          snapshot = { document: request.document, storageVersion: "v10" }
          return { storageVersion: "v10" }
        },
      }),
    )

    const result = await business.relinkPreparedResource(
      {
        actor: { id: "desktop:renderer", kind: "ui" },
        canvasId: "canvas-video",
        commandId: "relink-video",
        expectedRevision: 9,
        nodeId: "video",
        scopeId: "project-one",
      },
      {
        items: [
          {
            durationMs: 3_000,
            height: 360,
            id: "new-video",
            kind: "video",
            metadata: { convaxProjectResource: { kind: "project-file", path: "short.mp4" } },
            mimeType: "video/mp4",
            name: "short.mp4",
            state: { status: "stale" },
            width: 640,
          },
        ],
      },
    )

    const next = result.document.nodes[0]
    expect(next).toMatchObject({
      height: 277,
      measured: { height: 279, width: 499 },
      position: { x: 40, y: 60 },
      style: { height: 277, width: 500 },
      width: 500,
      data: { durationMs: 3_000, fit: "cover", height: 360, width: 640 },
    })
  })

  test("rejects missing nodes, stale revisions, and incompatible relink kinds", async () => {
    const image = createMediaNode({
      id: "image",
      position: { x: 0, y: 0 },
      resource: { id: "old", kind: "image", metadata: {}, state: { status: "missing" } },
    })
    const snapshot: CanvasDocumentSnapshot = {
      document: { ...createCanvasDocument({ id: "canvas-main", nodes: [image] }), revision: 2 },
      storageVersion: "v2",
    }
    let saveCalls = 0
    const business = new CanvasResourceBusinessService(
      {
        async prepare() {
          return { items: [] }
        },
      },
      new CanvasApplicationService({
        async load() {
          return snapshot
        },
        async save() {
          saveCalls += 1
          return { storageVersion: "unexpected" }
        },
      }),
    )
    const request = {
      actor: { id: "desktop:renderer", kind: "ui" },
      canvasId: "canvas-main",
      expectedRevision: 2,
      nodeId: "image",
      scopeId: "project-one",
    }
    const video = {
      id: "replacement",
      kind: "video" as const,
      metadata: {},
      name: "replacement.mp4",
      state: { status: "stale" as const },
    }

    await expect(
      business.relinkPreparedResource({ ...request, commandId: "wrong-kind" }, { items: [video] }),
    ).rejects.toThrow("cannot be relinked")
    await expect(
      business.relinkPreparedResource(
        { ...request, commandId: "missing-node", nodeId: "missing" },
        { items: [{ ...video, kind: "image" }] },
      ),
    ).rejects.toThrow("Canvas node was not found")
    await expect(
      business.relinkPreparedResource(
        { ...request, commandId: "stale", expectedRevision: 1 },
        { items: [{ ...video, kind: "image" }] },
      ),
    ).rejects.toBeInstanceOf(CanvasRevisionConflictError)
    expect(saveCalls).toBe(0)
  })

  test("merges retained labels and wraps only a final application failure", async () => {
    const commitFailure = new Error("repository save failed")
    let attempts = 0
    const business = new CanvasResourceBusinessService(
      {
        async prepare() {
          return {
            items: [preparedText("Draft")],
            retainedOnFailure: [{ label: "Notes/Draft-a.md" }],
          }
        },
      },
      {
        async execute() {
          attempts += 1
          if (attempts === 1) throw new CanvasRevisionConflictError(0, 1)
          throw commitFailure
        },
        async query() {
          return { nodes: [], revision: 1, storageVersion: "v1" }
        },
      },
    )

    let failure: unknown
    try {
      await business.addPreparedResources(
        {
          actor: { id: "ui", kind: "ui" },
          anchor: { x: 0, y: 0 },
          canvasId: "canvas-main",
          commandId: "partial-final-failure",
          expectedRevision: 0,
          scopeId: "project",
          sources: [{ kind: "new-text", sourceId: "prepared", text: "Draft" }],
        },
        {
          items: [{ ...preparedText("Second"), id: "host-prepared" }],
          retainedOnFailure: [{ label: "Notes/Second-b.md" }],
        },
      )
    } catch (error) {
      failure = error
    }

    expect(failure).toBeInstanceOf(CanvasResourcePartialFailureError)
    expect((failure as CanvasResourcePartialFailureError).cause).toBe(commitFailure)
    expect((failure as CanvasResourcePartialFailureError).retainedOnFailure).toEqual([
      { label: "Notes/Draft-a.md" },
      { label: "Notes/Second-b.md" },
    ])
    expect(attempts).toBe(2)
  })

  test("caches a typed partial failure for the same command id without preparing another Note", async () => {
    let preparationCalls = 0
    let executeCalls = 0
    const business = new CanvasResourceBusinessService(
      {
        async prepare() {
          preparationCalls += 1
          return { items: [preparedText("Draft")], retainedOnFailure: [{ label: "Notes/Draft.md" }] }
        },
      },
      {
        async execute() {
          executeCalls += 1
          throw new Error("repository save failed")
        },
        async query() {
          throw new Error("application must not query")
        },
      },
    )
    const request = {
      actor: { id: "ui", kind: "ui" as const },
      anchor: { x: 0, y: 0 },
      canvasId: "canvas-main",
      commandId: "cached-partial-failure",
      expectedRevision: 0,
      scopeId: "project",
      sources: [{ kind: "new-text" as const, sourceId: "prepared", text: "Draft" }],
    }

    let firstFailure: unknown
    let secondFailure: unknown
    try {
      await business.addResources(request)
    } catch (error) {
      firstFailure = error
    }
    try {
      await business.addResources(request)
    } catch (error) {
      secondFailure = error
    }

    expect(firstFailure).toBeInstanceOf(CanvasResourcePartialFailureError)
    expect(secondFailure).toBe(firstFailure)
    expect(preparationCalls).toBe(1)
    expect(executeCalls).toBe(1)
  })

  test("does not cache an ordinary failure without retained host resources", async () => {
    let preparationCalls = 0
    let executeCalls = 0
    const business = new CanvasResourceBusinessService(
      {
        async prepare() {
          preparationCalls += 1
          return { items: [preparedText("Draft")] }
        },
      },
      {
        async execute() {
          executeCalls += 1
          if (executeCalls === 1) throw new Error("transient failure")
          return {
            affectedNodeIds: [],
            changed: false,
            createdNodeIds: [],
            document: createCanvasDocument({ id: "canvas-main" }),
            storageVersion: "v1",
            warnings: [],
          }
        },
        async query() {
          throw new Error("application must not query")
        },
      },
    )
    const request = {
      actor: { id: "ui", kind: "ui" as const },
      anchor: { x: 0, y: 0 },
      canvasId: "canvas-main",
      commandId: "ordinary-retry",
      expectedRevision: 0,
      scopeId: "project",
      sources: [{ kind: "host-file" as const, path: "media/draft.md", sourceId: "prepared" }],
    }

    await expect(business.addResources(request)).rejects.toThrow("transient failure")
    await expect(business.addResources(request)).resolves.toMatchObject({ storageVersion: "v1" })
    expect(preparationCalls).toBe(2)
    expect(executeCalls).toBe(2)
  })

  test("propagates a typed preparation failure unchanged and wraps a failed conflict query", async () => {
    const preparationFailure = new CanvasResourcePartialFailureError(new Error("later source failed"), [
      { label: "Notes/First.md" },
    ])
    const preparationBusiness = new CanvasResourceBusinessService(
      {
        async prepare() {
          throw preparationFailure
        },
      },
      {
        async execute() {
          throw new Error("application must not run")
        },
        async query() {
          throw new Error("application must not run")
        },
      },
    )
    const request = {
      actor: { id: "ui", kind: "ui" },
      anchor: { x: 0, y: 0 },
      canvasId: "canvas-main",
      commandId: "typed-preparation-failure",
      expectedRevision: 0,
      scopeId: "project",
      sources: [{ kind: "new-text" as const, sourceId: "note", text: "Draft" }],
    }
    await expect(preparationBusiness.addResources(request)).rejects.toBe(preparationFailure)

    const queryFailure = new Error("query failed")
    const queryBusiness = new CanvasResourceBusinessService(
      {
        async prepare() {
          return { items: [preparedText("Draft")], retainedOnFailure: [{ label: "Notes/Draft.md" }] }
        },
      },
      {
        async execute() {
          throw new CanvasStorageConflictError("v0", "v1")
        },
        async query() {
          throw queryFailure
        },
      },
    )
    let failure: unknown
    try {
      await queryBusiness.addResources({ ...request, commandId: "typed-query-failure" })
    } catch (error) {
      failure = error
    }
    expect(failure).toBeInstanceOf(CanvasResourcePartialFailureError)
    expect((failure as CanvasResourcePartialFailureError).cause).toBe(queryFailure)
    expect((failure as CanvasResourcePartialFailureError).retainedOnFailure).toEqual([{ label: "Notes/Draft.md" }])
  })

  test("does not report partial failure when a retained preparation succeeds after conflict retry", async () => {
    let snapshot: CanvasDocumentSnapshot = {
      document: createCanvasDocument({ id: "canvas-main" }),
      storageVersion: "v0",
    }
    let saves = 0
    const business = new CanvasResourceBusinessService(
      {
        async prepare() {
          return { items: [preparedText("Draft")], retainedOnFailure: [{ label: "Notes/Draft.md" }] }
        },
      },
      {
        async execute(request) {
          saves += 1
          if (saves === 1) throw new CanvasRevisionConflictError(0, 1)
          const application = new CanvasApplicationService({
            async load() {
              return snapshot
            },
            async save(saveRequest) {
              snapshot = { document: saveRequest.document, storageVersion: "v2" }
              return { storageVersion: "v2" }
            },
          })
          return application.execute(request)
        },
        async query() {
          return { nodes: [], revision: 0, storageVersion: "v0" }
        },
      },
    )

    await expect(
      business.addResources({
        actor: { id: "ui", kind: "ui" },
        anchor: { x: 0, y: 0 },
        canvasId: "canvas-main",
        commandId: "retry-success-retained",
        expectedRevision: 0,
        scopeId: "project",
        sources: [{ kind: "new-text", sourceId: "prepared", text: "Draft" }],
      }),
    ).resolves.toMatchObject({ createdNodeIds: [expect.any(String)] })
    expect(saves).toBe(2)
  })

  test("wraps a command creation failure after preparation retained a host resource", async () => {
    const commandFailure = new Error("command materialization failed")
    const items = [preparedText("Draft")]
    Object.defineProperty(items, "map", {
      configurable: true,
      get() {
        throw commandFailure
      },
    })
    const business = new CanvasResourceBusinessService(
      {
        async prepare() {
          return { items, retainedOnFailure: [{ label: "Notes/Draft.md" }] }
        },
      },
      {
        async execute() {
          throw new Error("application must not run")
        },
        async query() {
          throw new Error("application must not run")
        },
      },
    )

    let failure: unknown
    try {
      await business.addResources({
        actor: { id: "ui", kind: "ui" },
        anchor: { x: 0, y: 0 },
        canvasId: "canvas-main",
        commandId: "command-creation-failure",
        expectedRevision: 0,
        scopeId: "project",
        sources: [{ kind: "new-text", sourceId: "prepared", text: "Draft" }],
      })
    } catch (error) {
      failure = error
    }

    expect(failure).toBeInstanceOf(CanvasResourcePartialFailureError)
    expect((failure as CanvasResourcePartialFailureError).cause).toBe(commandFailure)
    expect((failure as CanvasResourcePartialFailureError).retainedOnFailure).toEqual([{ label: "Notes/Draft.md" }])
  })

  test("wraps prepared-resource validation after preparation retained a host resource", async () => {
    const business = new CanvasResourceBusinessService(
      {
        async prepare() {
          return {
            items: [{ ...preparedText("Draft"), metadata: undefined } as never],
            retainedOnFailure: [{ label: "Notes/Draft.md" }],
          }
        },
      },
      {
        async execute() {
          throw new Error("application must not run")
        },
        async query() {
          throw new Error("application must not run")
        },
      },
    )

    let failure: unknown
    try {
      await business.addResources({
        actor: { id: "ui", kind: "ui" },
        anchor: { x: 0, y: 0 },
        canvasId: "canvas-main",
        commandId: "prepared-validation-failure",
        expectedRevision: 0,
        scopeId: "project",
        sources: [{ kind: "new-text", sourceId: "prepared", text: "Draft" }],
      })
    } catch (error) {
      failure = error
    }

    expect(failure).toBeInstanceOf(CanvasResourcePartialFailureError)
    expect((failure as CanvasResourcePartialFailureError).cause).toBeInstanceOf(CanvasCommandValidationError)
    expect((failure as CanvasResourcePartialFailureError).retainedOnFailure).toEqual([{ label: "Notes/Draft.md" }])
  })

  test("rejects invalid retained labels at the Canvas preparation boundary", async () => {
    expect(() => new CanvasResourcePartialFailureError(new Error("failure"), [{ label: "" }])).toThrow("retained label")
    const business = new CanvasResourceBusinessService(
      {
        async prepare() {
          return { items: [preparedText("Draft")], retainedOnFailure: [{ label: "" }] }
        },
      },
      {
        async execute() {
          throw new Error("application must not run")
        },
        async query() {
          throw new Error("application must not run")
        },
      },
    )
    await expect(
      business.addResources({
        actor: { id: "ui", kind: "ui" },
        anchor: { x: 0, y: 0 },
        canvasId: "canvas-main",
        commandId: "invalid-retained-label",
        expectedRevision: 0,
        scopeId: "project",
        sources: [{ kind: "new-text", sourceId: "prepared", text: "Draft" }],
      }),
    ).rejects.toThrow("retained label")
  })

  test.each(["inline-text", "remote-url"])("rejects removed source kind %s", async (kind) => {
    let preparationCalls = 0
    const business = new CanvasResourceBusinessService(
      {
        async prepare() {
          preparationCalls += 1
          return { items: [] }
        },
      },
      {
        async execute() {
          throw new Error("application should not run")
        },
        async query() {
          throw new Error("application should not run")
        },
      },
    )

    await expect(
      business.addResources({
        actor: { id: "ui", kind: "ui" },
        anchor: { x: 0, y: 0 },
        canvasId: "canvas",
        commandId: `removed-${kind}`,
        expectedRevision: 0,
        scopeId: "project",
        sources: [{ kind, sourceId: "legacy", text: "legacy", url: "https://example.com" } as never],
      }),
    ).rejects.toThrow("Unsupported canvas resource source")
    expect(preparationCalls).toBe(0)
  })

  test("rejects a non-string new text name before preparation", async () => {
    let preparationCalls = 0
    const business = new CanvasResourceBusinessService(
      {
        async prepare() {
          preparationCalls += 1
          return { items: [] }
        },
      },
      {
        async execute() {
          throw new Error("application should not run")
        },
        async query() {
          throw new Error("application should not run")
        },
      },
    )

    await expect(
      business.addResources({
        actor: { id: "ui", kind: "ui" },
        anchor: { x: 0, y: 0 },
        canvasId: "canvas",
        commandId: "invalid-new-text-name",
        expectedRevision: 0,
        scopeId: "project",
        sources: [{ kind: "new-text", name: { unsafe: true }, sourceId: "draft", text: "Hello" } as never],
      }),
    ).rejects.toThrow("New resource name must be a string")
    expect(preparationCalls).toBe(0)
  })

  test("keeps prepared new text only in runtime resource state", async () => {
    let snapshot: CanvasDocumentSnapshot = {
      document: createCanvasDocument({ id: "canvas-main" }),
      storageVersion: null,
    }
    const business = new CanvasResourceBusinessService(
      {
        async prepare() {
          return {
            items: [
              {
                id: "prepared",
                kind: "text",
                metadata: {
                  convaxProjectResource: { kind: "project-file", path: "Notes/Untitled-a.md" },
                },
                mimeType: "text/markdown",
                name: "Untitled-a.md",
                state: { contentRevision: "rev-a", status: "ready", text: "Hello" },
              },
            ],
          }
        },
      },
      new CanvasApplicationService({
        async load() {
          return snapshot
        },
        async save(request) {
          snapshot = { document: request.document, storageVersion: "v1" }
          return { storageVersion: "v1" }
        },
      }),
    )

    const result = await business.addResources({
      actor: { id: "ui", kind: "ui" },
      anchor: { x: 0, y: 0 },
      canvasId: "canvas-main",
      commandId: "new-text",
      expectedRevision: 0,
      scopeId: "project",
      sources: [{ kind: "new-text", sourceId: "draft", text: "Hello" }],
    })

    expect(result.document.nodes[0]!.data).not.toHaveProperty("text")
    expect(result.document.nodes[0]!.data.resourceState).toEqual({
      contentRevision: "rev-a",
      status: "ready",
      text: "Hello",
    })
    expect(result.document.nodes[0]!.data).toMatchObject({
      mimeType: "text/markdown",
      name: "Untitled-a.md",
    })
    expect(result.document.nodes[0]!.data).not.toHaveProperty("format")
  })

  test("prepares serializable sources then applies the shared sizing, placement, relation, and persistence rules", async () => {
    let snapshot: CanvasDocumentSnapshot = {
      document: createCanvasDocument({
        id: "canvas-main",
        nodes: [createTextNode({ id: "anchor", position: { x: 0, y: 0 }, text: "Anchor" })],
      }),
      storageVersion: "v1",
    }
    const saves: CanvasDocumentSaveRequest[] = []
    const repository: CanvasDocumentRepository = {
      async load() {
        return snapshot
      },
      async save(request) {
        saves.push(request)
        snapshot = { document: request.document, storageVersion: "v2" }
        return { storageVersion: "v2" }
      },
    }
    const preparations: CanvasResourcePreparationRequest[] = []
    const business = new CanvasResourceBusinessService(
      {
        async prepare(request) {
          preparations.push(request)
          return {
            items: [
              {
                height: 500,
                id: "poster_resource",
                kind: "image",
                metadata: {},
                name: "Poster.png",
                state: { status: "ready", url: "asset://poster" },
                width: 1_000,
              },
            ],
            warnings: ["metadata was normalized"],
          }
        },
      },
      new CanvasApplicationService(repository),
    )
    const request = {
      actor: { id: "agent_one", kind: "agent" as const },
      anchor: { x: 0, y: 0 },
      canvasId: "canvas-main",
      commandId: "add_poster",
      expectedRevision: 0,
      scopeId: "project-one",
      relation: { anchorNodeIds: ["anchor"], mode: "connect" as const },
      sources: [source()],
    }

    expect(() => JSON.stringify(request.sources)).not.toThrow()
    const result = await business.addResources(request)

    expect(preparations).toEqual([
      {
        canvasId: "canvas-main",
        scopeId: "project-one",
        sources: [{ kind: "host-file", path: "assets/poster.png", sourceId: "poster_source" }],
      },
    ])
    const createdNodeId = result.createdNodeIds[0]!
    expect(result.document).toMatchObject({
      edges: [{ source: "anchor", target: createdNodeId }],
      revision: 1,
    })
    expect(result.document.nodes.find((node) => node.id === createdNodeId)).toMatchObject({
      data: { kind: "image", resourceState: { status: "ready", url: "asset://poster" } },
      position: { x: 304, y: 0 },
      style: { height: 160, width: 320 },
    })
    expect(result.storageVersion).toBe("v2")
    expect(result.warnings).toEqual(["metadata was normalized"])
    expect(saves).toHaveLength(1)

    expect(await business.addResources({ ...request, conflictPolicy: "retry" })).toBe(result)
    expect(preparations).toHaveLength(1)
    await expect(business.addResources({ ...request, conflictPolicy: "reject" })).rejects.toBeInstanceOf(
      CanvasCommandIdConflictError,
    )
    await expect(
      business.addResources({
        ...request,
        sources: [{ kind: "new-text", sourceId: "different", text: "Different" }],
      }),
    ).rejects.toBeInstanceOf(CanvasCommandIdConflictError)
  })

  test("does not execute when resource preparation finishes after cancellation", async () => {
    const preparationStarted = Promise.withResolvers<void>()
    const preparationResult = Promise.withResolvers<{ items: [CanvasTextResource] }>()
    let executeCalls = 0
    let queryCalls = 0
    const business = new CanvasResourceBusinessService(
      {
        async prepare(request) {
          expect(request.signal).toBe(controller.signal)
          preparationStarted.resolve()
          return preparationResult.promise
        },
      },
      {
        async execute() {
          executeCalls += 1
          throw new Error("A canceled preparation must not execute")
        },
        async query() {
          queryCalls += 1
          throw new Error("A canceled preparation must not query")
        },
      },
    )
    const controller = new AbortController()
    const cancellation = new DOMException("Preparation canceled", "AbortError")
    const operation = business.addResources({
      actor: { id: "agent", kind: "agent" },
      anchor: { x: 0, y: 0 },
      canvasId: "canvas-main",
      commandId: "canceled-preparation",
      expectedRevision: 0,
      scopeId: "project",
      signal: controller.signal,
      sources: [{ kind: "new-text", sourceId: "prepared", text: "New resource" }],
    })

    await preparationStarted.promise
    controller.abort(cancellation)
    preparationResult.resolve({ items: [preparedText("New resource")] })

    await expect(operation).rejects.toBe(cancellation)
    expect(executeCalls).toBe(0)
    expect(queryCalls).toBe(0)
  })

  test("does not replay a resource command canceled while its conflict query is pending", async () => {
    const conflictQuery = Promise.withResolvers<{ nodes: []; revision: number; storageVersion: string }>()
    const queryStarted = Promise.withResolvers<void>()
    let executeCalls = 0
    let committed = 0
    const business = new CanvasResourceBusinessService(
      {
        async prepare() {
          return { items: [preparedText("New resource")] }
        },
      },
      {
        async execute() {
          executeCalls += 1
          if (executeCalls === 1) throw new CanvasRevisionConflictError(0, 1)
          committed += 1
          throw new Error("A canceled conflict replay must not execute")
        },
        async query() {
          queryStarted.resolve()
          return conflictQuery.promise
        },
      },
    )
    const controller = new AbortController()
    const cancellation = new DOMException("Conflict replay canceled", "AbortError")
    const operation = business.addResources({
      actor: { id: "agent", kind: "agent" },
      anchor: { x: 0, y: 0 },
      canvasId: "canvas-main",
      commandId: "canceled-conflict-replay",
      expectedRevision: 0,
      scopeId: "project",
      signal: controller.signal,
      sources: [{ kind: "new-text", sourceId: "prepared", text: "New resource" }],
    })

    await queryStarted.promise
    controller.abort(cancellation)
    conflictQuery.resolve({ nodes: [], revision: 1, storageVersion: "v1" })

    await expect(operation).rejects.toBe(cancellation)
    expect(executeCalls).toBe(1)
    expect(committed).toBe(0)
  })

  test("adds host-prepared resources through the same validation, replay, relation, and command-id path", async () => {
    const anchor = createTextNode({ id: "anchor", position: { x: 0, y: 0 }, text: "Anchor" })
    let snapshot: CanvasDocumentSnapshot = {
      document: { ...createCanvasDocument({ id: "canvas-main", nodes: [anchor] }), revision: 1 },
      storageVersion: "v1",
    }
    let preparationCalls = 0
    let saveCalls = 0
    const business = new CanvasResourceBusinessService(
      {
        async prepare() {
          preparationCalls += 1
          return { items: [preparedText("Project file")] }
        },
      },
      new CanvasApplicationService({
        async load() {
          return snapshot
        },
        async save(request) {
          saveCalls += 1
          snapshot = { document: request.document, storageVersion: "v2" }
          return { storageVersion: "v2" }
        },
      }),
    )
    const request = {
      actor: { id: "desktop:renderer", kind: "ui" as const },
      anchor: { x: 40, y: 80 },
      canvasId: "canvas-main",
      commandId: "mixed-prepared-add",
      expectedRevision: 0,
      relation: { anchorNodeIds: ["anchor"], mode: "connect" as const },
      scopeId: "project-one",
      sources: [{ kind: "host-file" as const, path: "media/project.png", sourceId: "prepared" }],
    }
    const hostPrepared = {
      items: [
        {
          id: "external",
          kind: "image" as const,
          metadata: {},
          name: "external.png",
          state: { status: "stale" as const },
          width: 800,
          height: 400,
        },
      ],
      warnings: ["external metadata normalized"],
    }

    const result = await business.addPreparedResources(request, hostPrepared)

    expect(preparationCalls).toBe(1)
    expect(saveCalls).toBe(1)
    expect(result.createdNodeIds).toHaveLength(2)
    expect(result.document.edges).toHaveLength(2)
    expect(result.warnings).toEqual([
      "external metadata normalized",
      "Canvas changed while resources were being added; replayed from revision 0 on revision 1 after 1 conflict retry.",
    ])
    expect(await business.addPreparedResources(request, hostPrepared)).toBe(result)
    expect(preparationCalls).toBe(1)
    expect(saveCalls).toBe(1)

    await expect(
      business.addPreparedResources(request, {
        ...hostPrepared,
        items: [{ ...hostPrepared.items[0]!, name: "different.png" }],
      }),
    ).rejects.toBeInstanceOf(CanvasCommandIdConflictError)
  })

  test("rejects a source id collision between ordinary and host-prepared resources before preparation", async () => {
    let preparationCalls = 0
    const business = new CanvasResourceBusinessService(
      {
        async prepare() {
          preparationCalls += 1
          return { items: [] }
        },
      },
      {
        async execute() {
          throw new Error("application should not run")
        },
        async query() {
          throw new Error("application should not run")
        },
      },
    )

    await expect(
      business.addPreparedResources(
        {
          actor: { id: "desktop:renderer", kind: "ui" },
          anchor: { x: 0, y: 0 },
          canvasId: "canvas-main",
          commandId: "source-collision",
          expectedRevision: 0,
          scopeId: "project-one",
          sources: [{ kind: "host-file", path: "media/project.png", sourceId: "duplicate" }],
        },
        { items: [{ id: "duplicate", kind: "text", metadata: {}, state: { status: "stale" } }] },
      ),
    ).rejects.toThrow("Canvas resource source id is duplicated: duplicate")
    expect(preparationCalls).toBe(0)
  })

  test("rebases a stale resource addition on the latest document without losing an unrelated concurrent edit", async () => {
    const concurrent = createTextNode({ id: "concurrent", position: { x: 0, y: 0 }, text: "Keep me" })
    let snapshot: CanvasDocumentSnapshot = {
      document: { ...createCanvasDocument({ id: "canvas-main", nodes: [concurrent] }), revision: 1 },
      storageVersion: "v1",
    }
    let preparationCalls = 0
    let saveCalls = 0
    const application = new CanvasApplicationService({
      async load() {
        return snapshot
      },
      async save(request) {
        saveCalls += 1
        snapshot = { document: request.document, storageVersion: "v2" }
        return { storageVersion: "v2" }
      },
    })
    const business = new CanvasResourceBusinessService(
      {
        async prepare() {
          preparationCalls += 1
          return { items: [preparedText("New resource")] }
        },
      },
      application,
    )

    const result = await business.addResources({
      actor: { id: "agent", kind: "agent" },
      anchor: { x: 0, y: 0 },
      canvasId: "canvas-main",
      commandId: "stale-add",
      expectedRevision: 0,
      scopeId: "project",
      sources: [{ kind: "new-text", sourceId: "prepared", text: "New resource" }],
    })

    expect(preparationCalls).toBe(1)
    expect(saveCalls).toBe(1)
    expect(result.document.revision).toBe(2)
    expect(result.document.nodes.map((node) => node.id)).toContain("concurrent")
    expect(result.createdNodeIds).toHaveLength(1)
    expect(result.document.nodes.find((node) => node.id === result.createdNodeIds[0])?.position).toEqual({
      x: 304,
      y: 0,
    })
    expect(result.warnings).toContain(
      "Canvas changed while resources were being added; replayed from revision 0 on revision 1 after 1 conflict retry.",
    )
  })

  test("prepares once and reuses generated node ids when a storage conflict requires replay", async () => {
    let snapshot: CanvasDocumentSnapshot = {
      document: createCanvasDocument({ id: "canvas-main" }),
      storageVersion: "v0",
    }
    let preparationCalls = 0
    const attemptedNodeIds: string[] = []
    let saveCalls = 0
    const application = new CanvasApplicationService({
      async load() {
        return snapshot
      },
      async save(request) {
        saveCalls += 1
        const resourceNode = request.document.nodes.find((node) => node.id !== "concurrent")
        attemptedNodeIds.push(resourceNode!.id)
        if (saveCalls === 1) {
          snapshot = {
            document: {
              ...createCanvasDocument({
                id: "canvas-main",
                nodes: [createTextNode({ id: "concurrent", position: { x: 0, y: 0 }, text: "Concurrent" })],
              }),
              revision: 1,
            },
            storageVersion: "v1",
          }
          throw new CanvasStorageConflictError(request.expectedStorageVersion, "v1")
        }
        snapshot = { document: request.document, storageVersion: "v2" }
        return { storageVersion: "v2" }
      },
    })
    const business = new CanvasResourceBusinessService(
      {
        async prepare() {
          preparationCalls += 1
          return { items: [preparedText("New resource")] }
        },
      },
      application,
    )
    const request = {
      actor: { id: "agent", kind: "agent" },
      anchor: { x: 0, y: 0 },
      canvasId: "canvas-main",
      commandId: "storage-retry",
      expectedRevision: 0,
      scopeId: "project",
      sources: [{ kind: "new-text" as const, sourceId: "prepared", text: "New resource" }],
    }

    const result = await business.addResources(request)

    expect(preparationCalls).toBe(1)
    expect(saveCalls).toBe(2)
    expect(attemptedNodeIds).toEqual([result.createdNodeIds[0], result.createdNodeIds[0]])
    expect(result.document.nodes.map((node) => node.id)).toContain("concurrent")
    expect(result.document.revision).toBe(2)
    expect(result.warnings[0]).toContain("replayed from revision 0 on revision 1")
    expect(await business.addResources(request)).toBe(result)
    expect(preparationCalls).toBe(1)
    expect(saveCalls).toBe(2)
  })

  test("creates a pending resource without preparation and marks the exact target failed after unrelated edits", async () => {
    const anchor = createTextNode({ id: "anchor", position: { x: 0, y: 0 }, text: "Source" })
    let snapshot: CanvasDocumentSnapshot = {
      document: createCanvasDocument({ id: "canvas-main", nodes: [anchor] }),
      storageVersion: "v0",
    }
    let preparationCalls = 0
    let saveCalls = 0
    const business = new CanvasResourceBusinessService(
      {
        async prepare() {
          preparationCalls += 1
          throw new Error("Pending lifecycle must not prepare a fake resource")
        },
      },
      new CanvasApplicationService({
        async load() {
          return snapshot
        },
        async save(request) {
          saveCalls += 1
          snapshot = { document: request.document, storageVersion: `v${saveCalls}` }
          return { storageVersion: `v${saveCalls}` }
        },
      }),
    )
    const createRequest = {
      actor: { id: "plugin-host", kind: "host" },
      anchor: { x: 0, y: 0 },
      canvasId: "canvas-main",
      commandId: "create-pending",
      expectedRevision: 0,
      kind: "image" as const,
      label: "Relit image",
      relation: { anchorNodeIds: [anchor.id], mode: "connect" as const },
      scopeId: "project",
    }

    const created = await business.createPendingResource(createRequest)
    const [pendingNodeId] = created.createdNodeIds
    if (!pendingNodeId) throw new Error("Pending resource node id was not returned")
    const pending = created.document.nodes.find((node) => node.id === pendingNodeId)
    if (!pending) throw new Error("Pending resource node was not created")
    expect(preparationCalls).toBe(0)
    expect(created.document.revision).toBe(1)
    expect(pending).toMatchObject({
      data: { kind: "image", label: "Relit image", status: "pending", url: "" },
      type: "file",
    })
    expect(created.document.edges).toEqual([expect.objectContaining({ source: anchor.id, target: pendingNodeId })])
    expect(await business.createPendingResource(createRequest)).toBe(created)

    snapshot = {
      document: {
        ...created.document,
        nodes: [
          ...created.document.nodes,
          createTextNode({ id: "concurrent", position: { x: 0, y: 400 }, text: "Keep me" }),
        ],
        revision: 2,
      },
      storageVersion: "concurrent-v2",
    }
    const failed = await business.failPendingResource({
      actor: createRequest.actor,
      canvasId: createRequest.canvasId,
      commandId: "fail-pending",
      expectedRevision: created.document.revision,
      expectedTarget: createCanvasNodeContentGuard(pending),
      message: "Generation could not be completed",
      scopeId: createRequest.scopeId,
      targetNodeId: pendingNodeId,
    })

    expect(failed.document.revision).toBe(3)
    expect(failed.document.nodes.map((node) => node.id)).toContain("concurrent")
    expect(failed.document.nodes.find((node) => node.id === pendingNodeId)?.data).toMatchObject({
      error: "Generation could not be completed",
      status: "error",
    })
    expect(failed.warnings[0]).toContain("replayed from revision 1 on revision 2")
    expect(preparationCalls).toBe(0)
  })

  test("does not recreate a pending node removed before a guarded failure replay", async () => {
    const pending = {
      ...createMediaNode({
        id: "pending",
        position: { x: 0, y: 0 },
        resource: { id: "pending", kind: "image" as const, url: "" },
      }),
      data: { kind: "image" as const, label: "Image", status: "pending" as const, url: "" },
    }
    let saveCalls = 0
    const business = new CanvasResourceBusinessService(
      {
        async prepare() {
          return { items: [] }
        },
      },
      new CanvasApplicationService({
        async load() {
          return {
            document: { ...createCanvasDocument({ id: "canvas-main" }), revision: 2 },
            storageVersion: "v2",
          }
        },
        async save() {
          saveCalls += 1
          throw new Error("A deleted pending node must not be recreated")
        },
      }),
    )

    await expect(
      business.failPendingResource({
        actor: { id: "plugin-host", kind: "host" },
        canvasId: "canvas-main",
        commandId: "fail-deleted",
        expectedRevision: 1,
        expectedTarget: createCanvasNodeContentGuard(pending),
        message: "Generation could not be completed",
        scopeId: "project",
        targetNodeId: pending.id,
      }),
    ).rejects.toThrow("Canvas node was not found: pending")
    expect(saveCalls).toBe(0)
  })

  test("replaces one guarded resource after an unrelated storage conflict without moving the target", async () => {
    const owner = {
      ...createMediaNode({
        id: "owner",
        position: { x: 80, y: 120 },
        resource: { id: "old", kind: "image" as const, url: "asset://old" },
      }),
      style: { height: 280, width: 440 },
    }
    let snapshot: CanvasDocumentSnapshot = {
      document: createCanvasDocument({ id: "canvas-main", nodes: [owner] }),
      storageVersion: "v0",
    }
    let preparationCalls = 0
    let saveCalls = 0
    const business = new CanvasResourceBusinessService(
      {
        async prepare() {
          preparationCalls += 1
          return {
            items: [
              {
                durationMs: 5_000,
                id: "prepared-video",
                kind: "video" as const,
                metadata: { source: "generated" },
                url: "asset://video",
              },
            ],
          }
        },
      },
      new CanvasApplicationService({
        async load() {
          return snapshot
        },
        async save(request) {
          saveCalls += 1
          if (saveCalls === 1) {
            snapshot = {
              document: {
                ...snapshot.document!,
                nodes: [
                  { ...owner, position: { x: 300, y: 220 }, style: { height: 320, width: 520 } },
                  createTextNode({ id: "concurrent", position: { x: 0, y: 0 }, text: "Keep me" }),
                ],
                revision: 1,
              },
              storageVersion: "v1",
            }
            throw new CanvasStorageConflictError(request.expectedStorageVersion, "v1")
          }
          snapshot = { document: request.document, storageVersion: "v2" }
          return { storageVersion: "v2" }
        },
      }),
    )
    const request = {
      actor: { id: "ui", kind: "ui" },
      canvasId: "canvas-main",
      commandId: "replace-owner",
      expectedRevision: 0,
      expectedTarget: createCanvasNodeContentGuard(owner),
      scopeId: "project",
      source: { kind: "host-file" as const, path: ".convax/assets/generated.mp4", sourceId: "generated" },
      targetNodeId: owner.id,
    }

    const result = await business.replaceResource(request)

    expect(preparationCalls).toBe(1)
    expect(saveCalls).toBe(2)
    expect(result.createdNodeIds).toEqual([])
    expect(result.affectedNodeIds).toEqual([owner.id])
    expect(result.document.nodes.map((node) => node.id)).toEqual([owner.id, "concurrent"])
    expect(result.document.nodes[0]).toMatchObject({
      data: { kind: "video", metadata: { source: "generated" }, url: "asset://video" },
      id: owner.id,
      position: { x: 300, y: 220 },
      style: { height: 320, width: 520 },
    })
    expect(result.warnings[0]).toContain("replayed from revision 0 on revision 1")
    expect(await business.replaceResource(request)).toBe(result)
    await expect(
      business.addResources({
        actor: request.actor,
        anchor: { x: 0, y: 0 },
        canvasId: request.canvasId,
        commandId: request.commandId,
        expectedRevision: 0,
        scopeId: request.scopeId,
        sources: [request.source],
      }),
    ).rejects.toBeInstanceOf(CanvasCommandIdConflictError)
  })

  test("rejects replacement preparation cardinality and a target edited during conflict replay", async () => {
    const owner = createTextNode({ id: "owner", position: { x: 0, y: 0 }, text: "Original" })
    const request = {
      actor: { id: "ui", kind: "ui" },
      canvasId: "canvas-main",
      commandId: "replace-owner",
      expectedRevision: 0,
      expectedTarget: createCanvasNodeContentGuard(owner),
      scopeId: "project",
      source: { kind: "inline-text" as const, sourceId: "generated", text: "Generated" },
      targetNodeId: owner.id,
    }
    const neverExecute = {
      async execute() {
        throw new Error("must not execute")
      },
      async query() {
        throw new Error("must not query")
      },
    }
    for (const items of [
      [],
      [
        { id: "one", kind: "text" as const, text: "One" },
        { id: "two", kind: "text" as const, text: "Two" },
      ],
    ]) {
      const business = new CanvasResourceBusinessService(
        {
          async prepare() {
            return { items }
          },
        },
        neverExecute,
      )
      await expect(business.replaceResource(request)).rejects.toThrow("exactly one item")
    }

    let snapshot: CanvasDocumentSnapshot = {
      document: createCanvasDocument({ id: "canvas-main", nodes: [owner] }),
      storageVersion: "v0",
    }
    let saveCalls = 0
    const changedTarget = new CanvasResourceBusinessService(
      {
        async prepare() {
          return { items: [{ id: "generated", kind: "text", text: "Generated" }] }
        },
      },
      new CanvasApplicationService({
        async load() {
          return snapshot
        },
        async save(saveRequest) {
          saveCalls += 1
          snapshot = {
            document: {
              ...snapshot.document!,
              nodes: [{ ...owner, data: { ...owner.data, text: "User edit" } }],
              revision: 1,
            },
            storageVersion: "v1",
          }
          throw new CanvasStorageConflictError(saveRequest.expectedStorageVersion, "v1")
        },
      }),
    )

    await expect(changedTarget.replaceResource(request)).rejects.toThrow("content changed")
    expect(saveCalls).toBe(1)
  })

  test.each([
    ["revision", () => new CanvasRevisionConflictError(0, 1)],
    ["storage", () => new CanvasStorageConflictError("v0", "v1")],
  ] as const)("reject policy does not replay a %s conflict", async (_kind, createConflict) => {
    let executeCalls = 0
    let queryCalls = 0
    let preparationCalls = 0
    const conflict = createConflict()
    const business = new CanvasResourceBusinessService(
      {
        async prepare() {
          preparationCalls += 1
          return { items: [preparedText("New resource")] }
        },
      },
      {
        async execute() {
          executeCalls += 1
          throw conflict
        },
        async query() {
          queryCalls += 1
          throw new Error("Reject policy must not query for a replay revision")
        },
      },
    )

    await expect(
      business.addResources({
        actor: { id: "plugin-card", kind: "ui" },
        anchor: { x: 0, y: 0 },
        canvasId: "canvas-main",
        commandId: `reject-${_kind}`,
        conflictPolicy: "reject",
        expectedRevision: 0,
        scopeId: "project",
        sources: [{ kind: "new-text", sourceId: "prepared", text: "New resource" }],
      }),
    ).rejects.toBe(conflict)
    expect(preparationCalls).toBe(1)
    expect(executeCalls).toBe(1)
    expect(queryCalls).toBe(0)
  })

  test("rejects a replay when a concurrent edit removed a required relation anchor", async () => {
    let saveCalls = 0
    let preparationCalls = 0
    const application = new CanvasApplicationService({
      async load() {
        return {
          document: { ...createCanvasDocument({ id: "canvas-main" }), revision: 1 },
          storageVersion: "v1",
        }
      },
      async save() {
        saveCalls += 1
        throw new Error("The invalid replay must not be saved")
      },
    })
    const business = new CanvasResourceBusinessService(
      {
        async prepare() {
          preparationCalls += 1
          return { items: [preparedText("New resource")] }
        },
      },
      application,
    )

    await expect(
      business.addResources({
        actor: { id: "agent", kind: "agent" },
        anchor: { x: 0, y: 0 },
        canvasId: "canvas-main",
        commandId: "deleted-anchor",
        expectedRevision: 0,
        relation: { anchorNodeIds: ["anchor"], mode: "connect" },
        scopeId: "project",
        sources: [{ kind: "new-text", sourceId: "prepared", text: "New resource" }],
      }),
    ).rejects.toThrow("Canvas node was not found: anchor")
    expect(preparationCalls).toBe(1)
    expect(saveCalls).toBe(0)
  })

  test("stops after two conflict retries", async () => {
    let snapshot: CanvasDocumentSnapshot = {
      document: createCanvasDocument({ id: "canvas-main" }),
      storageVersion: "v0",
    }
    let preparationCalls = 0
    let saveCalls = 0
    const application = new CanvasApplicationService({
      async load() {
        return snapshot
      },
      async save(request) {
        saveCalls += 1
        const current = snapshot.document!
        snapshot = {
          document: {
            ...current,
            nodes: [
              ...current.nodes,
              createTextNode({
                id: `concurrent-${saveCalls}`,
                position: { x: saveCalls * 20, y: 0 },
                text: "Concurrent",
              }),
            ],
            revision: current.revision + 1,
          },
          storageVersion: `v${saveCalls}`,
        }
        throw new CanvasStorageConflictError(request.expectedStorageVersion, snapshot.storageVersion)
      },
    })
    const business = new CanvasResourceBusinessService(
      {
        async prepare() {
          preparationCalls += 1
          return { items: [preparedText("New resource")] }
        },
      },
      application,
    )

    await expect(
      business.addResources({
        actor: { id: "agent", kind: "agent" },
        anchor: { x: 0, y: 0 },
        canvasId: "canvas-main",
        commandId: "retry-limit",
        expectedRevision: 0,
        scopeId: "project",
        sources: [{ kind: "new-text", sourceId: "prepared", text: "New resource" }],
      }),
    ).rejects.toBeInstanceOf(CanvasStorageConflictError)
    expect(preparationCalls).toBe(1)
    expect(saveCalls).toBe(3)
    expect(snapshot.document?.nodes.map((node) => node.id)).toEqual(["concurrent-1", "concurrent-2", "concurrent-3"])
  })

  test("validates sources before preparation and rejects invalid prepared resources", async () => {
    let preparationCalls = 0
    const application = {
      execute() {
        throw new Error("application should not run")
      },
      query() {
        throw new Error("application should not run")
      },
    }
    const invalidSources = new CanvasResourceBusinessService(
      {
        async prepare() {
          preparationCalls += 1
          return { items: [] }
        },
      },
      application,
    )
    await expect(
      invalidSources.addResources({
        actor: { id: "ui", kind: "ui" },
        anchor: { x: 0, y: 0 },
        canvasId: "canvas",
        commandId: "invalid_sources",
        expectedRevision: 0,
        scopeId: "project",
        sources: [
          { kind: "host-file", path: "one.png", sourceId: "duplicate" },
          { kind: "host-file", path: "two.png", sourceId: "duplicate" },
        ],
      }),
    ).rejects.toBeInstanceOf(CanvasCommandValidationError)
    expect(preparationCalls).toBe(0)

    const invalidPreparation = new CanvasResourceBusinessService(
      {
        async prepare() {
          return {
            items: [
              {
                id: "broken",
                kind: "image",
                metadata: {},
                state: { status: "ready", url: "asset://broken" },
                width: -1,
              },
            ],
          }
        },
      },
      application,
    )
    await expect(
      invalidPreparation.addResources({
        actor: { id: "ui", kind: "ui" },
        anchor: { x: 0, y: 0 },
        canvasId: "canvas",
        commandId: "invalid_preparation",
        expectedRevision: 0,
        scopeId: "project",
        sources: [source()],
      }),
    ).rejects.toBeInstanceOf(CanvasCommandValidationError)

    for (const status of [["ready"], { toString: () => "ready" }]) {
      const invalidState = new CanvasResourceBusinessService(
        {
          async prepare() {
            return {
              items: [{ id: "broken-state", kind: "text", metadata: {}, state: { status } as never }],
            }
          },
        },
        application,
      )
      await expect(
        invalidState.addResources({
          actor: { id: "ui", kind: "ui" },
          anchor: { x: 0, y: 0 },
          canvasId: "canvas",
          commandId: "invalid_state",
          expectedRevision: 0,
          scopeId: "project",
          sources: [source()],
        }),
      ).rejects.toBeInstanceOf(CanvasCommandValidationError)
    }
  })
})
