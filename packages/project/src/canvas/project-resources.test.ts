import { describe, expect, test } from "bun:test"
import { createCanvasDocument, createFolderNode, createMediaNode, createTextNode } from "@convax/canvas/core"
import type { CanvasNode } from "@convax/canvas/core"
import {
  collectProjectManagedAssetReferences,
  dehydrateProjectCanvasDocument,
  getProjectResourceReference,
  managedAssetPath,
  projectResourceBindingsKey,
  projectResourceReferenceKey,
  requireProjectResourceBindings,
  requireProjectResourceReference,
  type ProjectResourceBindings,
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
    { kind: "project-file", path: { toString: null, valueOf: null } },
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
    expect(
      requireProjectResourceReference({
        kind: "managed-asset",
        name: "😀".repeat(255),
        sha256: digest,
      }),
    ).toEqual({ kind: "managed-asset", name: "😀".repeat(255), sha256: digest })
    expect(() =>
      requireProjectResourceReference({
        kind: "managed-asset",
        name: "😀".repeat(256),
        sha256: digest,
      }),
    ).toThrow()
  })

  test("reports a stable domain error for non-string path values", () => {
    const poisoned = { toString: null, valueOf: null }
    expect(() => requireProjectResourceReference({ kind: "project-file", path: poisoned })).toThrow(
      "Invalid portable Project path",
    )
  })

  test("rejects symbol and non-enumerable fields from exact references", () => {
    const symbolExtra = {
      kind: "project-file",
      path: "Notes/brief.md",
      [Symbol("extra")]: true,
    }
    const hiddenExtra = { kind: "project-file", path: "Notes/brief.md" }
    Object.defineProperty(hiddenExtra, "extra", { value: true })
    const hiddenAllowed = { kind: "project-file" }
    Object.defineProperty(hiddenAllowed, "path", { value: "Notes/brief.md" })

    expect(() => requireProjectResourceReference(symbolExtra)).toThrow("Project resource reference")
    expect(() => requireProjectResourceReference(hiddenExtra)).toThrow("Project resource reference")
    expect(() => requireProjectResourceReference(hiddenAllowed)).toThrow("Project resource reference")
  })

  test("rejects accessor references without executing kind or path getters", () => {
    let kindReads = 0
    const accessorKind = { path: "Notes/brief.md" }
    Object.defineProperty(accessorKind, "kind", {
      enumerable: true,
      get() {
        kindReads += 1
        return "project-file"
      },
    })

    let pathReads = 0
    const accessorPath = { kind: "project-file" }
    Object.defineProperty(accessorPath, "path", {
      enumerable: true,
      get() {
        pathReads += 1
        return "Notes/brief.md"
      },
    })

    expect(() => requireProjectResourceReference(accessorKind)).toThrow("Project resource reference")
    expect(() => requireProjectResourceReference(accessorPath)).toThrow("Project resource reference")
    expect(kindReads).toBe(0)
    expect(pathReads).toBe(0)
  })

  test("normalizes a valid managed media type", () => {
    expect(
      requireProjectResourceReference({
        kind: "managed-asset",
        mediaType: "IMAGE/PNG",
        name: "hero.png",
        sha256: "a".repeat(64),
      }),
    ).toEqual({
      kind: "managed-asset",
      mediaType: "image/png",
      name: "hero.png",
      sha256: "a".repeat(64),
    })
  })

  test("returns null when metadata does not contain one valid exact reference", () => {
    expect(getProjectResourceReference(null)).toBeNull()
    expect(
      getProjectResourceReference({ [projectResourceReferenceKey]: { kind: "project-file", path: "../bad" } }),
    ).toBeNull()
    expect(
      getProjectResourceReference({
        [projectResourceReferenceKey]: { extra: true, kind: "project-file", path: "safe.md" },
      }),
    ).toBeNull()
    expect(getProjectResourceReference({ convaxProjectFile: { path: "safe.md" } })).toBeNull()
  })

  test("derives the private blob path only from a validated digest", () => {
    expect(managedAssetPath("b".repeat(64))).toBe(`.convax/assets/blobs/${"b".repeat(64)}`)
    expect(() => managedAssetPath("B".repeat(64))).toThrow()
    expect(() => managedAssetPath("b".repeat(63))).toThrow()
  })
})

describe("Project resource bindings", () => {
  const fileReference = { kind: "project-file" as const, path: "Notes/brief.md" }

  test("normalizes and clones multiple content bindings", () => {
    const input = Object.assign(Object.create(null), {
      "plugin.input": fileReference,
      poster: {
        kind: "managed-asset",
        mediaType: "IMAGE/PNG",
        name: "poster.png",
        sha256: "d".repeat(64),
      },
    }) as ProjectResourceBindings

    const bindings = requireProjectResourceBindings(input)

    expect(bindings).toEqual({
      "plugin.input": fileReference,
      poster: {
        kind: "managed-asset",
        mediaType: "image/png",
        name: "poster.png",
        sha256: "d".repeat(64),
      },
    })
    expect(bindings).not.toBe(input)
    expect(bindings.poster).not.toBe(input.poster)
    expect(bindings["plugin.input"]).not.toBe(input["plugin.input"])
  })

  test.each([
    ["array container", []],
    ["date container", new Date(0)],
    ["boxed container", new String("runtime")],
    ["function container", () => undefined],
    ["leading-space runtime string", { poster: " blob:runtime" }],
    ["boxed string leaf", { poster: new String("blob:runtime") }],
    ["BigInt leaf", { poster: 1n }],
    ["NaN leaf", { poster: Number.NaN }],
    ["function leaf", { poster: () => undefined }],
    ["Date leaf", { poster: new Date(0) }],
    ["unknown leaf", { poster: { value: "Notes/brief.md" } }],
    ["directory leaf", { poster: { kind: "project-directory", path: "references" } }],
    ["empty slot", { "": fileReference }],
    ["leading-space slot", { " poster": fileReference }],
    ["numeric slot", { "1poster": fileReference }],
    ["oversized slot", { [`p${"x".repeat(128)}`]: fileReference }],
    ["dangerous proto slot", { ["__proto__"]: fileReference }],
    ["dangerous constructor slot", { constructor: fileReference }],
    ["dangerous prototype slot", { prototype: fileReference }],
  ] as const)("rejects non-portable %s", (_label, value) => {
    expect(() => requireProjectResourceBindings(value)).toThrow("Project resource binding")
  })

  test("rejects cyclic bindings without leaking a runtime exception", () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.poster = cyclic
    expect(() => requireProjectResourceBindings(cyclic)).toThrow("Project resource binding")
  })
})

describe("Project managed asset reference collection", () => {
  test("collects exact main and binding references by digest while ignoring opaque Plugin JSON", () => {
    const primary = {
      kind: "managed-asset" as const,
      mediaType: "image/png",
      name: "hero.png",
      sha256: "a".repeat(64),
    }
    const bound = {
      kind: "managed-asset" as const,
      mediaType: "audio/mpeg",
      name: "sound.mp3",
      sha256: "b".repeat(64),
    }
    const image = createMediaNode({
      id: "image",
      position: { x: 0, y: 0 },
      resource: {
        id: "image-resource",
        kind: "image",
        metadata: { [projectResourceReferenceKey]: primary },
        state: readyState,
      },
    })
    const plugin = {
      id: "plugin",
      type: "file",
      position: { x: 0, y: 0 },
      data: {
        kind: "plugin.surface",
        label: "Plugin",
        metadata: {
          [projectResourceBindingsKey]: {
            duplicate: { ...primary, name: "duplicate-name.png" },
            input: { kind: "project-file", path: "Inputs/reference.png" },
            soundtrack: bound,
          },
          convaxPluginState: {
            fakeDigest: "c".repeat(64),
            nested: { kind: "managed-asset", name: "opaque.bin", sha256: "d".repeat(64) },
          },
        },
      },
    } as CanvasNode

    expect(collectProjectManagedAssetReferences(createCanvasDocument({ nodes: [image, plugin] }))).toEqual([
      primary,
      bound,
    ])
  })

  test.each([
    [projectResourceReferenceKey, { kind: "managed-asset", name: "bad.bin", sha256: "A".repeat(64) }],
    [projectResourceBindingsKey, { poster: { kind: "managed-asset", name: "bad.bin", sha256: "short" } }],
  ] as const)("strictly rejects malformed typed metadata in %s", (key, value) => {
    const node = {
      id: "plugin",
      type: "file",
      position: { x: 0, y: 0 },
      data: {
        kind: "plugin.surface",
        label: "Plugin",
        metadata: { [key]: value },
      },
    } as CanvasNode

    expect(() => collectProjectManagedAssetReferences(createCanvasDocument({ nodes: [node] }))).toThrow()
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
      const node =
        kind === "text"
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
    expect(() => dehydrateProjectCanvasDocument(createCanvasDocument({ nodes: [contentWithDirectory] }))).toThrow(
      "directory",
    )

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

  test.each(["format", "text", "richText", "url", "posterUrl", "path"])("rejects legacy resource key %s", (key) => {
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
    { inputs: [{ nativePath: "\\Users\\alice\\secret.png" }] },
    { inputs: [{ nativePath: "C:\\Users\\example\\private.png" }] },
  ])("rejects former untyped host-owned binding shapes %#", (binding) => {
    const text = createTextNode({
      metadata: {
        ...metadataFor({ kind: "project-file", path: "Notes/brief.md" }),
        [projectResourceBindingsKey]: binding,
      },
      position: { x: 0, y: 0 },
      resourceState: readyState,
    })
    expect(() => dehydrateProjectCanvasDocument(createCanvasDocument({ nodes: [text] }))).toThrow(
      "Project resource binding",
    )
  })

  test("normalizes and clones exact bindings during dehydration", () => {
    const bindings = {
      "plugin.input": { kind: "project-file" as const, path: "Inputs/reference.png" },
      poster: {
        kind: "managed-asset" as const,
        mediaType: "IMAGE/PNG",
        name: "poster.png",
        sha256: "e".repeat(64),
      },
    }
    const node = {
      id: "plugin",
      type: "file",
      position: { x: 0, y: 0 },
      data: {
        kind: "plugin.surface",
        label: "Plugin",
        metadata: { [projectResourceBindingsKey]: bindings },
      },
    } as CanvasNode

    const persisted = dehydrateProjectCanvasDocument(createCanvasDocument({ nodes: [node] }))
    const persistedMetadata = persisted.nodes[0]!.data.metadata as Record<string, unknown>
    const persistedBindings = persistedMetadata[projectResourceBindingsKey]

    expect(persistedBindings).toEqual({
      "plugin.input": { kind: "project-file", path: "Inputs/reference.png" },
      poster: {
        kind: "managed-asset",
        mediaType: "image/png",
        name: "poster.png",
        sha256: "e".repeat(64),
      },
    })
    expect(persistedBindings).not.toBe(bindings)
  })

  test("strips custom Plugin runtime state while normalizing bindings in the same clone", () => {
    const bindings = {
      poster: { kind: "project-file" as const, path: "Generated/poster.png" },
    }
    const node = {
      id: "plugin-runtime",
      type: "file",
      position: { x: 0, y: 0 },
      data: {
        kind: "plugin.surface",
        label: "Plugin",
        metadata: {
          [projectResourceBindingsKey]: bindings,
          convaxPluginState: { title: "Portable" },
        },
        resourceState: { status: "ready", text: "SECRET-PLUGIN-RUNTIME" },
      },
    } as CanvasNode

    const persisted = dehydrateProjectCanvasDocument(createCanvasDocument({ nodes: [node] }))
    const persistedNode = persisted.nodes[0]!
    const metadata = persistedNode.data.metadata as Record<string, unknown>

    expect(persistedNode.data).not.toHaveProperty("resourceState")
    expect(JSON.stringify(persistedNode)).not.toContain("SECRET-PLUGIN-RUNTIME")
    expect(metadata.convaxPluginState).toEqual({ title: "Portable" })
    expect(metadata[projectResourceBindingsKey]).toEqual({
      poster: { kind: "project-file", path: "Generated/poster.png" },
    })
    expect(metadata[projectResourceBindingsKey]).not.toBe(bindings)
  })

  test.each([
    ["leading-space runtime string", { poster: " blob:runtime" }],
    ["boxed string", { poster: new String("blob:runtime") }],
    ["BigInt", { poster: 1n }],
    ["Date", { poster: new Date(0) }],
    ["NaN", { poster: Number.NaN }],
    ["function", { poster: () => undefined }],
  ] as const)("rejects invalid exact bindings during dehydration: %s", (_label, bindings) => {
    const node = {
      id: "plugin",
      type: "file",
      position: { x: 0, y: 0 },
      data: {
        kind: "plugin.surface",
        label: "Plugin",
        metadata: { [projectResourceBindingsKey]: bindings },
      },
    } as CanvasNode
    expect(() => dehydrateProjectCanvasDocument(createCanvasDocument({ nodes: [node] }))).toThrow(
      "Project resource binding",
    )
  })

  test.each([
    ["plugin.surface", "file"],
    ["agent", "agent"],
    ["group", "file"],
  ] as const)("checks the exact host-owned binding slot on %s nodes", (kind, type) => {
    const node = {
      id: kind,
      type,
      position: { x: 0, y: 0 },
      data: {
        kind,
        label: kind,
        metadata: { [projectResourceBindingsKey]: { url: "blob:runtime" } },
      },
    } as CanvasNode
    expect(() => dehydrateProjectCanvasDocument(createCanvasDocument({ nodes: [node] }))).toThrow(
      "Project resource binding",
    )
  })

  test.each([
    ["plugin.surface", "file"],
    ["agent", "agent"],
    ["group", "file"],
  ] as const)("rejects the exact legacy Project file key on %s nodes", (kind, type) => {
    const node = {
      id: kind,
      type,
      position: { x: 0, y: 0 },
      data: {
        kind,
        label: kind,
        metadata: { convaxProjectFile: { path: "Notes/legacy.md" } },
      },
    } as CanvasNode
    expect(() => dehydrateProjectCanvasDocument(createCanvasDocument({ nodes: [node] }))).toThrow("legacy")
  })

  test("preserves similarly named opaque Plugin metadata", () => {
    const node = {
      id: "plugin",
      type: "file",
      position: { x: 0, y: 0 },
      data: {
        kind: "plugin.surface",
        label: "Plugin",
        metadata: {
          convaxProjectFileOpaque: { path: "/plugin/opaque/path" },
          convaxProjectResourceOpaque: { url: "blob:plugin-owned" },
        },
      },
    } as CanvasNode
    const persisted = dehydrateProjectCanvasDocument(createCanvasDocument({ nodes: [node] }))
    expect(persisted.nodes[0]!.data.metadata).toEqual(node.data.metadata)
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
