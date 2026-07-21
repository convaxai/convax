import { describe, expect, test } from "bun:test"
import { getProjectResourceReference, type ProjectResourceReference } from "../../canvas/project-resources"
import {
  ProjectCanvasResourcePreparation,
  type ProjectCanvasFilePublisher,
  type ProjectCanvasResourceHost,
} from "./project-canvas-resource-preparation"
import type { ProjectManagedAssetStore } from "./project-managed-asset-store"

const requestRef = { canvasId: "canvas_main", scopeId: "project_one" }

describe("project canvas resource preparation", () => {
  test("keeps every Project file in place", async () => {
    let assetCalls = 0
    const preparation = new ProjectCanvasResourcePreparation(
      host({
        async readFileInfo(input) {
          return { mimeType: "image/png", name: "hero.png", path: input.path, size: 42 }
        },
      }),
      unusedPublisher(),
      {
        admitExternalFile() {
          assetCalls += 1
          throw new Error("Project files must not be admitted as managed assets")
        },
      } as unknown as ProjectManagedAssetStore,
    )

    const result = await preparation.prepare({
      ...requestRef,
      sources: [{ kind: "host-file", path: "media/hero.png", sourceId: "hero" }],
    })

    expect(assetCalls).toBe(0)
    expect(getProjectResourceReference(result.items[0]!.metadata)).toEqual({
      kind: "project-file",
      path: "media/hero.png",
    })
    expect(result.items[0]).toMatchObject({
      id: "hero",
      kind: "image",
      name: "hero.png",
      state: { status: "stale" },
    })
    expect(result.items[0]).not.toHaveProperty("path")
    expect(result.items[0]).not.toHaveProperty("url")
  })

  test("reads Project text directly into runtime state", async () => {
    const readPaths: string[] = []
    const preparation = new ProjectCanvasResourcePreparation(
      host({
        async readFileInfo(input) {
          readPaths.push(input.path)
          return { mimeType: "text/markdown", name: "brief.md", path: input.path, size: 7 }
        },
        async readTextFile(input) {
          readPaths.push(input.path)
          return { content: "# Brief", contentRevision: "stable-byte-revision", exists: true, path: input.path }
        },
      }),
      unusedPublisher(),
      unusedAssets(),
    )

    const result = await preparation.prepare({
      ...requestRef,
      sources: [{ kind: "host-file", path: "docs/brief.md", sourceId: "brief" }],
    })

    expect(readPaths).toEqual(["docs/brief.md", "docs/brief.md"])
    expect(result.items[0]).toMatchObject({
      id: "brief",
      kind: "text",
      mimeType: "text/markdown",
      name: "brief.md",
      state: {
        contentRevision: "stable-byte-revision",
        status: "ready",
        text: "# Brief",
      },
    })
    expect(result.items[0]).not.toHaveProperty("format")
    expect(result.items[0]).not.toHaveProperty("text")
  })

  test("keeps Project media inspection URLs only in transient resource state", async () => {
    const inspections: unknown[] = []
    const preparation = new ProjectCanvasResourcePreparation(
      host({
        async readFileInfo(input) {
          return { mimeType: "video/mp4", name: "clip.mp4", path: input.path, size: 42 }
        },
      }),
      unusedPublisher(),
      unusedAssets(),
      {
        async inspect(input) {
          inspections.push(input)
          return { durationMs: 1_500, height: 720, posterUrl: "blob:poster", width: 1_280 }
        },
      },
    )

    const result = await preparation.prepare({
      ...requestRef,
      sources: [{ kind: "host-file", path: "media/clip.mp4", sourceId: "clip" }],
    })

    expect(inspections).toEqual([
      {
        kind: "video",
        mimeType: "video/mp4",
        name: "clip.mp4",
        path: "media/clip.mp4",
        projectId: "project_one",
      },
    ])
    expect(result.items[0]).toMatchObject({
      durationMs: 1_500,
      height: 720,
      id: "clip",
      kind: "video",
      state: { posterUrl: "blob:poster", status: "stale" },
      width: 1_280,
    })
    expect(result.items[0]).not.toHaveProperty("posterUrl")
    expect(result.items[0]).not.toHaveProperty("path")
    expect(result.items[0]).not.toHaveProperty("url")
  })

  test("publishes new text below Notes before returning a prepared item", async () => {
    const publications: unknown[] = []
    const publisher: ProjectCanvasFilePublisher = {
      async publishText(input) {
        publications.push(input)
        return { contentRevision: "revision-a", path: "Notes/Brief-a1.md" }
      },
    }
    const preparation = new ProjectCanvasResourcePreparation(host(), publisher, unusedAssets())

    const result = await preparation.prepare({
      ...requestRef,
      sources: [{ kind: "new-text", name: "Brief", sourceId: "new", text: "# Brief" }],
    })

    expect(publications).toEqual([
      {
        content: "# Brief",
        directory: "Notes",
        extension: ".md",
        name: "Brief",
        projectId: "project_one",
      },
    ])
    expect(getProjectResourceReference(result.items[0]!.metadata)).toEqual({
      kind: "project-file",
      path: "Notes/Brief-a1.md",
    })
    expect(result.items[0]).toMatchObject({
      id: "new",
      kind: "text",
      mimeType: "text/markdown",
      name: "Brief-a1.md",
      state: { contentRevision: "revision-a", status: "ready", text: "# Brief" },
    })
    expect(result.items[0]).not.toHaveProperty("format")
  })

  test("accepts only Project directories as folder references", async () => {
    const directoryRequests: unknown[] = []
    const preparation = new ProjectCanvasResourcePreparation(
      host({
        async listDirectory(input) {
          directoryRequests.push(input)
          return { entries: [], path: input.path ?? "", projectId: input.projectId }
        },
      }),
      unusedPublisher(),
      unusedAssets(),
    )

    const result = await preparation.prepare({
      ...requestRef,
      sources: [{ kind: "host-directory", path: "design/references", sourceId: "folder" }],
    })

    expect(directoryRequests).toEqual([{ path: "design/references", projectId: "project_one" }])
    expect(getProjectResourceReference(result.items[0]!.metadata)).toEqual({
      kind: "project-directory",
      path: "design/references",
    })
    expect(result.items[0]).not.toHaveProperty("path")
  })

  test("maps external admissions inside the managed-store callback without exposing source paths", async () => {
    const events: string[] = []
    const references: ProjectResourceReference[] = [
      {
        kind: "managed-asset",
        mediaType: "image/png",
        name: "outside.png",
        sha256: "a".repeat(64),
      },
    ]
    const assets = {
      async withAdmittedExternalFiles(
        _input: unknown,
        commit: (value: readonly ProjectResourceReference[]) => Promise<unknown>,
      ) {
        events.push("store:enter")
        const result = await commit(references)
        events.push("store:leave")
        return result
      },
    } as unknown as ProjectManagedAssetStore
    const preparation = new ProjectCanvasResourcePreparation(host(), unusedPublisher(), assets)

    const result = await preparation.withAdmittedExternalFiles(
      {
        files: [
          {
            mediaType: "image/png",
            name: "outside.png",
            sourceId: "outside",
            sourcePath: "/native/outside.png",
          },
        ],
        projectId: "project_one",
      },
      async (prepared) => {
        events.push("commit")
        expect(JSON.stringify(prepared)).not.toContain("/native/outside.png")
        expect(getProjectResourceReference(prepared.items[0]!.metadata)).toEqual(references[0])
        expect(prepared.items[0]).toMatchObject({
          id: "outside",
          kind: "image",
          state: { status: "stale" },
        })
        return "committed"
      },
    )

    expect(result).toBe("committed")
    expect(events).toEqual(["store:enter", "commit", "store:leave"])
  })

  test("classifies admitted managed Markdown and plain text without reading source bytes", async () => {
    for (const [name, mediaType] of [
      ["brief.md", "text/markdown"],
      ["notes.txt", undefined],
    ] as const) {
      const reference = {
        kind: "managed-asset" as const,
        mediaType,
        name,
        sha256: "b".repeat(64),
      }
      const assets = {
        async withAdmittedExternalFiles(
          _input: unknown,
          commit: (value: readonly ProjectResourceReference[]) => Promise<unknown>,
        ) {
          return commit([reference])
        },
      } as unknown as ProjectManagedAssetStore
      const preparation = new ProjectCanvasResourcePreparation(host(), unusedPublisher(), assets)

      await preparation.withAdmittedExternalFiles(
        {
          files: [
            {
              mediaType: reference.mediaType,
              name: reference.name,
              sourceId: "managed-text",
              sourcePath: `/outside/${reference.name}`,
            },
          ],
          projectId: "project_one",
        },
        async ({ items }) => {
          expect(items[0]).toMatchObject({
            id: "managed-text",
            kind: "text",
            mimeType: reference.mediaType ?? "text/plain",
            name: reference.name,
            state: { status: "stale" },
          })
          expect(items[0]).not.toHaveProperty("format")
          expect(items[0]!.state).not.toHaveProperty("text")
          expect(items[0]!.state).not.toHaveProperty("contentRevision")
        },
      )
    }
  })
})

function host(overrides: Partial<ProjectCanvasResourceHost> = {}): ProjectCanvasResourceHost {
  return {
    async listDirectory(input) {
      return { entries: [], path: input.path ?? "", projectId: input.projectId }
    },
    async readFileInfo(input) {
      return { mimeType: "application/octet-stream", name: "file.bin", path: input.path, size: 1 }
    },
    async readTextFile(input) {
      return { content: "", contentRevision: "", exists: false, path: input.path }
    },
    ...overrides,
  }
}

function unusedPublisher(): ProjectCanvasFilePublisher {
  return {
    async publishText() {
      throw new Error("Publisher must not be used")
    },
  }
}

function unusedAssets() {
  return {
    async withAdmittedExternalFiles() {
      throw new Error("Managed assets must not be used")
    },
  } as unknown as ProjectManagedAssetStore
}
