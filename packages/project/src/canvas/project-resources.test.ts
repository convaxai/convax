import { describe, expect, test } from "bun:test"
import { createCanvasDocument, createFolderNode, createMediaNode, createTextNode } from "@convax/canvas/core"
import type { CanvasNode } from "@convax/canvas/core"
import {
  dehydrateProjectCanvasDocument,
  getProjectResourceReference,
  managedAssetPath,
  projectResourceReferenceKey,
  requireProjectResourceReference,
  type ProjectResourceReference,
} from "./project-resources"

const readyState = { status: "ready" as const }

describe("Project resource references", () => {
  test.each([
    { kind: "project-file", path: "Notes/brief.md" },
    { kind: "project-directory", path: "references/images" },
    { kind: "managed-asset", mediaType: "image/png", name: "hero.png", sha256: "a".repeat(64) },
  ] as const)("round trips $kind as a normalized clone", (reference) => {
    const metadata = { [projectResourceReferenceKey]: reference }
    const required = requireProjectResourceReference(reference)

    expect(getProjectResourceReference(metadata)).toEqual(reference)
    expect(required).toEqual(reference)
    expect(required).not.toBe(reference)
  })

  test.each([
    { kind: "project-file", path: ".convax/project.json" },
    { kind: "project-file", path: ".CONVAX/assets/blobs/a" },
    { kind: "project-file", path: "C:/secret.txt" },
    { kind: "project-file", path: "\\\\server\\share\\secret.txt" },
    { kind: "project-file", path: "/absolute.txt" },
    { kind: "project-file", path: "Notes\\brief.md" },
    { kind: "project-file", path: "Notes/../brief.md" },
    { kind: "project-file", path: "Notes//brief.md" },
    { kind: "project-file", path: "Notes/CON.txt" },
    { kind: "project-file", path: "Notes/brief.md:stream" },
    { kind: "project-directory", path: "../outside" },
    { kind: "project-directory", path: "assets/trailing. " },
    { kind: "managed-asset", name: "hero.png", sha256: "A".repeat(64) },
    { kind: "managed-asset", name: "hero.png", sha256: "a".repeat(63) },
    { kind: "managed-asset", name: "../hero.png", sha256: "a".repeat(64) },
    { kind: "managed-asset", name: "bad\ud800name", sha256: "a".repeat(64) },
    { kind: "managed-asset", mediaType: "image png", name: "hero.png", sha256: "a".repeat(64) },
    { kind: "managed-asset", mediaType: `${"a".repeat(255)}/b`, name: "hero.png", sha256: "a".repeat(64) },
    { extra: true, kind: "project-file", path: "Notes/brief.md" },
    { kind: "project-directory", path: "references", sha256: "a".repeat(64) },
    { kind: "managed-asset", name: "hero.png", path: "hero.png", sha256: "a".repeat(64) },
  ])("rejects unsafe or non-canonical references %#", (reference) => {
    expect(() => requireProjectResourceReference(reference)).toThrow()
  })

  test("bounds managed asset names by Unicode scalar values", () => {
    const digest = "a".repeat(64)
    expect(requireProjectResourceReference({
      kind: "managed-asset",
      name: "😀".repeat(255),
      sha256: digest,
    })).toEqual({ kind: "managed-asset", name: "😀".repeat(255), sha256: digest })
    expect(() => requireProjectResourceReference({
      kind: "managed-asset",
      name: "😀".repeat(256),
      sha256: digest,
    })).toThrow()
  })

  test("normalizes a valid managed media type", () => {
    expect(requireProjectResourceReference({
      kind: "managed-asset",
      mediaType: "IMAGE/PNG",
      name: "hero.png",
      sha256: "a".repeat(64),
    })).toEqual({
      kind: "managed-asset",
      mediaType: "image/png",
      name: "hero.png",
      sha256: "a".repeat(64),
    })
  })

  test("returns null when metadata does not contain one valid exact reference", () => {
    expect(getProjectResourceReference(null)).toBeNull()
    expect(getProjectResourceReference({ [projectResourceReferenceKey]: { kind: "project-file", path: "../bad" } })).toBeNull()
    expect(getProjectResourceReference({ [projectResourceReferenceKey]: { extra: true, kind: "project-file", path: "safe.md" } })).toBeNull()
    expect(getProjectResourceReference({ convaxProjectFile: { path: "safe.md" } })).toBeNull()
  })

  test("derives the private blob path only from a validated digest", () => {
    expect(managedAssetPath("b".repeat(64))).toBe(`.convax/assets/blobs/${"b".repeat(64)}`)
    expect(() => managedAssetPath("B".repeat(64))).toThrow()
    expect(() => managedAssetPath("b".repeat(63))).toThrow()
  })
})

describe("Project Canvas document dehydration", () => {
  test("dehydrates resource nodes to references and view state only", () => {
    const textReference = { kind: "project-file" as const, path: "Notes/brief.md" }
    const imageReference = {
      kind: "managed-asset" as const,
      name: "hero.png",
      mediaType: "image/png",
      sha256: "c".repeat(64),
    }
    const document = createCanvasDocument({
      id: "canvas-main",
      nodes: [
        createTextNode({
          id: "text",
          metadata: { [projectResourceReferenceKey]: textReference },
          position: { x: 0, y: 0 },
          resourceState: { contentRevision: "rev-1", status: "ready", text: "secret-text" },
        }),
        createMediaNode({
          id: "image",
          position: { x: 320, y: 0 },
          resource: {
            id: "resource",
            kind: "image",
            metadata: { [projectResourceReferenceKey]: imageReference },
            mimeType: "image/png",
            name: "hero.png",
            state: { posterUrl: "blob:secret-poster", status: "ready", url: "convax-asset://secret-runtime" },
          },
        }),
      ],
    })

    const persisted = dehydrateProjectCanvasDocument(document)
    const bytes = JSON.stringify(persisted)

    expect(bytes).not.toContain("secret-text")
    expect(bytes).not.toContain("convax-asset:")
    expect(bytes).not.toContain("blob:secret-poster")
    expect(persisted.nodes[0]!.data).not.toHaveProperty("resourceState")
    expect(persisted.nodes[1]!.data).not.toHaveProperty("resourceState")
    expect(getProjectResourceReference(persisted.nodes[0]!.data.metadata)).toEqual(textReference)
    expect(getProjectResourceReference(persisted.nodes[1]!.data.metadata)).toEqual(imageReference)
  })

  test.each(["text", "image", "video", "audio", "file", "folder"] as const)(
    "requires a Project reference for %s nodes",
    (kind) => {
      const node = kind === "text"
        ? createTextNode({ metadata: {}, position: { x: 0, y: 0 }, resourceState: readyState })
        : kind === "folder"
          ? createFolderNode({
              position: { x: 0, y: 0 },
              resource: { id: "folder", kind, metadata: {}, name: "Folder", state: readyState },
            })
          : createMediaNode({
              position: { x: 0, y: 0 },
              resource: { id: kind, kind, metadata: {}, state: readyState },
            })
      expect(() => dehydrateProjectCanvasDocument(createCanvasDocument({ nodes: [node] }))).toThrow("reference")
    },
  )

  test("requires resource-kind semantics", () => {
    const text = createTextNode({
      id: "text",
      metadata: {},
      position: { x: 0, y: 0 },
      resourceState: { ...readyState, text: "runtime" },
    })
    const directoryMetadata = metadataFor({ kind: "project-directory", path: "references" })
    const contentWithDirectory = { ...text, data: { ...text.data, metadata: directoryMetadata } }
    expect(() => dehydrateProjectCanvasDocument(createCanvasDocument({ nodes: [contentWithDirectory] }))).toThrow("directory")

    const folder = createFolderNode({
      id: "folder",
      position: { x: 0, y: 0 },
      resource: {
        id: "folder-resource",
        kind: "folder",
        metadata: metadataFor({ kind: "project-file", path: "references" }),
        name: "references",
        state: readyState,
      },
    })
    expect(() => dehydrateProjectCanvasDocument(createCanvasDocument({ nodes: [folder] }))).toThrow("directory")
  })

  test.each(["text", "richText", "url", "posterUrl", "path"])("rejects legacy resource key %s", (key) => {
    const node = legacyResourceNode(key)
    expect(() => dehydrateProjectCanvasDocument(createCanvasDocument({ nodes: [node] }))).toThrow("legacy")
  })

  test("rejects legacy reference metadata while preserving opaque Plugin state", () => {
    const metadata = metadataFor({ kind: "project-file", path: "Notes/brief.md" })
    const text = createTextNode({
      id: "text",
      metadata: {
        ...metadata,
        convaxPluginState: { preview: "blob:plugin-owned", sourcePath: "/plugin/opaque/path" },
      },
      position: { x: 0, y: 0 },
      resourceState: readyState,
    })
    const persisted = dehydrateProjectCanvasDocument(createCanvasDocument({ nodes: [text] }))
    expect(persisted.nodes[0]!.data.metadata).toMatchObject({
      convaxPluginState: {
        preview: "blob:plugin-owned",
        sourcePath: "/plugin/opaque/path",
      },
    })

    const legacy = {
      ...text,
      data: { ...text.data, metadata: { ...metadata, convaxProjectFile: { path: "Notes/brief.md" } } },
    }
    expect(() => dehydrateProjectCanvasDocument(createCanvasDocument({ nodes: [legacy] }))).toThrow("legacy")
  })

  test.each([
    { poster: { url: "blob:runtime-poster" } },
    { inputs: [{ nativePath: "/Users/example/private.png" }] },
    { inputs: [{ nativePath: "C:\\Users\\example\\private.png" }] },
  ])("rejects native paths and runtime URLs in host-owned resource slots %#", (binding) => {
    const text = createTextNode({
      metadata: {
        ...metadataFor({ kind: "project-file", path: "Notes/brief.md" }),
        convaxProjectResourceBindings: binding,
      },
      position: { x: 0, y: 0 },
      resourceState: readyState,
    })
    expect(() => dehydrateProjectCanvasDocument(createCanvasDocument({ nodes: [text] }))).toThrow("host-owned")
  })
})

function metadataFor(reference: ProjectResourceReference) {
  return { [projectResourceReferenceKey]: reference }
}

function legacyResourceNode(key: string): CanvasNode {
  const node = createTextNode({
    id: `legacy-${key}`,
    metadata: metadataFor({ kind: "project-file", path: "Notes/brief.md" }),
    position: { x: 0, y: 0 },
    resourceState: readyState,
  })
  return { ...node, data: { ...node.data, [key]: key === "richText" ? { type: "doc" } : "legacy" } }
}
