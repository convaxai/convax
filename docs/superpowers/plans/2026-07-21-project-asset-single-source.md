# Project Asset Single-Source Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace inline/path-only Canvas content with typed Project resource references, content-addressed external assets, file-first text/generation publication, conservative watcher hydration, and delayed managed-asset GC.

**Architecture:** `@convax/canvas` keeps host-neutral resource orchestration and transient runtime state; `@convax/project/canvas` owns the concrete Project reference union and document traversal; `@convax/project/node` owns all native resolution, publication, managed blobs, locking, and GC. Desktop composes these capabilities through the existing `canvas` bridge and shared `CanvasResourceBusinessService`; old persistence is rejected without migration or dual read.

**Tech Stack:** TypeScript, Bun test runner, Electron IPC/preload, Node `fs/promises`, React, `@xyflow/react`, Tiptap Markdown.

---

## File map

### Canvas-owned generic contracts

- Modify `packages/canvas/src/types.ts`: remove persistent content fields from resource node data and introduce transient resource state.
- Modify `packages/canvas/src/document.ts`: validate/create resource-backed nodes without treating text or URLs as durable state.
- Modify `packages/canvas/src/application/persistence.ts`: write and require the `convax.canvas/2` persisted envelope.
- Modify `packages/canvas/src/application/resources.ts`: replace `inline-text`/`remote-url` with file-backed host preparation inputs.
- Modify `packages/canvas/src/application/commands.ts`: create nodes from prepared reference metadata plus transient state.
- Modify `packages/canvas/src/services.tsx`: add host-neutral resource mutation, hydration, text-save, and draft-decision ports.
- Modify `packages/canvas/src/components/canvas-editor.tsx`: route creation/drop through the shared resource mutation service and invalidate mounted resources safely.
- Modify `packages/canvas/src/components/builtin-node.tsx`: keep text drafts local and save through the resource port rather than Canvas history.
- Modify `packages/canvas/src/core.test.ts`, `packages/canvas/src/application/application.test.ts`, `packages/canvas/src/application/resources.test.ts`, `packages/canvas/src/components/canvas-editor.test.tsx`, and `packages/canvas/src/components/builtin-node.test.tsx`.

### Project-owned reference and native storage

- Replace `packages/project/src/canvas/project-resources.ts`: own `ProjectResourceReference`, validation, metadata extraction, traversal, dehydrate, and hydration application.
- Expand `packages/project/src/canvas/project-resources.test.ts`: cover all three reference kinds and forbidden persisted content.
- Create `packages/project/src/node/project-canvas/project-managed-asset-store.ts`: content-addressed admission, digest verification, resolution, one Project mutex, and staging cleanup.
- Create `packages/project/src/node/project-canvas/project-managed-asset-store.test.ts`: deduplication, concurrency, corruption, symlink, and immutable-copy tests.
- Replace `packages/project/src/node/project-canvas/project-canvas-resource-preparation.ts`: direct Project references, external admission, Notes publication, hydration, and text revision saves.
- Replace `packages/project/src/node/project-canvas/project-canvas-resource-preparation.test.ts` with new-schema cases.
- Modify `packages/project/src/node/project-canvas/project-canvas-document-repository.ts`: reject old envelopes and validate/dehydrate concrete references.
- Create `packages/project/src/node/project-canvas/project-asset-gc.ts`: rebuildable `gc.json`, full root scan, delayed delete, and staging cleanup.
- Create `packages/project/src/node/project-canvas/project-asset-gc.test.ts`: timing, fail-safe, crash-window, and mutex tests.
- Modify `packages/project/src/node/project-canvas/index.ts` and `packages/project/src/node/index.ts`: export only the narrow new Node capabilities.
- Modify `packages/project/src/node/project-manager.ts` and helpers: stop general Project Files mutations from accessing `.convax/assets`; expose only safe root resolution needed by the dedicated store.

### Desktop composition and product flows

- Modify `packages/desktop/src/desktop-protocol.ts`, `packages/desktop/src/preload/index.ts`, `packages/desktop/src/main/canvas-document-ipc.ts`, and `packages/desktop/src/main/index.ts`: add the typed `canvas.resources` bridge and bump the incompatible protocol.
- Modify `packages/desktop/src/renderer/index.tsx` and `packages/desktop/src/renderer/canvas-upload.ts`: submit project paths or opaque local-file tokens instead of copying files in renderer code.
- Modify `packages/desktop/src/main/canvas-agent-tools.ts`: expose `new-text`, `host-file`, and `host-directory` only.
- Modify `packages/desktop/resources/skills/canvas-storyboard/SKILL.md`: replace `inline-text` instructions with file-backed `new-text` sources.
- Modify `packages/desktop/src/main/generation-canvas-service.ts`: publish validated results below `Generated/` and retain published files on Canvas failure.
- Modify `packages/desktop/src/main/project-ipc.ts`: forward every Project filesystem event to mounted Canvas resource invalidation without trusting the path as completeness evidence.
- Update `packages/desktop/src/main/canvas-agent-tools.test.ts`, `packages/desktop/src/main/generation-canvas-service.test.ts`, `packages/desktop/src/main/jianying-canvas-service.test.ts`, `packages/desktop/src/main/agent-resource-preparation.test.ts`, `packages/desktop/src/renderer/canvas-upload.test.ts`, `packages/desktop/src/renderer/web-plugin-canvas.test.tsx`, `packages/desktop/src/renderer/jianying-selection-action.test.ts`, `packages/desktop/src/renderer/ffmpeg-selection-action.test.ts`, and `scripts/desktop-open-project-built-smoke.ts`.

## Task 1: Cut over the Canvas persisted envelope

**Files:**

- Modify: `packages/canvas/src/application/persistence.ts`
- Test: `packages/canvas/src/application/persistence.test.ts`
- Modify: `packages/canvas/src/application/index.ts`

- [ ] **Step 1: Write failing v2 envelope and rejection tests**

Add these cases to `packages/canvas/src/application/persistence.test.ts`:

```ts
import {
  InvalidCanvasDocumentError,
  UnsupportedCanvasDocumentVersionError,
  parseStoredCanvasDocument,
  serializeCanvasDocument,
} from "./persistence"

test("serializes the breaking Canvas v2 envelope", () => {
  const document = createCanvasDocument({ id: "canvas_v2", title: "V2" })
  expect(JSON.parse(serializeCanvasDocument(document))).toEqual({
    document,
    schemaVersion: "convax.canvas/2",
  })
})

test("rejects the former unversioned document without rewriting its bytes", () => {
  const legacy = JSON.stringify(createCanvasDocument({ id: "canvas_legacy" }))
  expect(() => parseStoredCanvasDocument(legacy, "canvas_legacy")).toThrow(UnsupportedCanvasDocumentVersionError)
  expect(legacy).toBe(JSON.stringify(createCanvasDocument({ id: "canvas_legacy" })))
})

test("distinguishes unsupported versions from malformed v2 documents", () => {
  expect(() =>
    parseStoredCanvasDocument(
      JSON.stringify({ document: createCanvasDocument({ id: "canvas" }), schemaVersion: "convax.canvas/1" }),
      "canvas",
    ),
  ).toThrow(UnsupportedCanvasDocumentVersionError)
  expect(() =>
    parseStoredCanvasDocument(
      JSON.stringify({ document: { id: "canvas" }, schemaVersion: "convax.canvas/2" }),
      "canvas",
    ),
  ).toThrow(InvalidCanvasDocumentError)
})
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
bun test packages/canvas/src/application/persistence.test.ts
```

Expected: failure because serialization still writes a naked document and `UnsupportedCanvasDocumentVersionError` does not exist.

- [ ] **Step 3: Implement the exact v2 envelope**

Replace the persistence parsing/serialization boundary with:

```ts
export const canvasDocumentSchemaVersion = "convax.canvas/2" as const

interface StoredCanvasDocumentV2 {
  document: unknown
  schemaVersion: typeof canvasDocumentSchemaVersion
}

export class UnsupportedCanvasDocumentVersionError extends Error {
  constructor(readonly schemaVersion: unknown) {
    super(`Canvas document schema is not supported: ${String(schemaVersion ?? "unversioned")}`)
    this.name = "UnsupportedCanvasDocumentVersionError"
  }
}

export function parseStoredCanvasDocument(content: string, expectedCanvasId: string) {
  let stored: unknown
  try {
    stored = JSON.parse(content)
  } catch {
    throw new InvalidCanvasDocumentError(expectedCanvasId)
  }
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) {
    throw new InvalidCanvasDocumentError(expectedCanvasId)
  }
  const envelope = stored as Partial<StoredCanvasDocumentV2>
  if (envelope.schemaVersion !== canvasDocumentSchemaVersion) {
    throw new UnsupportedCanvasDocumentVersionError(envelope.schemaVersion)
  }
  const document = parseCanvasDocument(envelope.document, expectedCanvasId)
  if (!document) throw new InvalidCanvasDocumentError(expectedCanvasId)
  return document
}

export function serializeCanvasDocument(document: CanvasDocument) {
  const parsed = parseCanvasDocument(document, document.id)
  if (!parsed) throw new InvalidCanvasDocumentError(document.id)
  const stored: StoredCanvasDocumentV2 = {
    document: parsed,
    schemaVersion: canvasDocumentSchemaVersion,
  }
  return `${JSON.stringify(stored, null, 2)}\n`
}
```

Export the version and error from `packages/canvas/src/application/index.ts`.

- [ ] **Step 4: Run Canvas persistence and package tests**

Run:

```bash
bun test packages/canvas/src/application/persistence.test.ts
bun --cwd packages/canvas typecheck
bun --cwd packages/canvas test
```

Expected: all commands exit 0.

- [ ] **Step 5: Commit the envelope cutover**

```bash
git add packages/canvas/src/application/persistence.ts packages/canvas/src/application/persistence.test.ts packages/canvas/src/application/index.ts
git commit -m "feat(canvas): require v2 document envelope"
```

## Task 2: Introduce typed Project resource references and transient Canvas state

**Files:**

- Modify: `packages/project/src/canvas/project-resources.ts`
- Test: `packages/project/src/canvas/project-resources.test.ts`
- Modify: `packages/project/src/canvas/index.ts`
- Modify: `packages/canvas/src/types.ts`
- Modify: `packages/canvas/src/document.ts`
- Test: `packages/canvas/src/core.test.ts`
- Modify: `packages/canvas/src/application/commands.ts`
- Test: `packages/canvas/src/application/application.test.ts`

- [ ] **Step 1: Write failing Project reference tests**

Replace the path-only tests in `packages/project/src/canvas/project-resources.test.ts` with cases shaped like:

```ts
import { describe, expect, test } from "bun:test"
import { createCanvasDocument, createMediaNode, createTextNode } from "@convax/canvas/core"
import {
  dehydrateProjectCanvasDocument,
  getProjectResourceReference,
  managedAssetPath,
  projectResourceReferenceKey,
  requireProjectResourceReference,
} from "./project-resources"

describe("Project resource references", () => {
  test.each([
    { kind: "project-file", path: "Notes/brief.md" },
    { kind: "project-directory", path: "references/images" },
    { kind: "managed-asset", mediaType: "image/png", name: "hero.png", sha256: "a".repeat(64) },
  ] as const)("round trips $kind", (reference) => {
    const metadata = { [projectResourceReferenceKey]: reference }
    expect(getProjectResourceReference(metadata)).toEqual(reference)
    expect(requireProjectResourceReference(reference)).toEqual(reference)
  })

  test.each([
    { kind: "project-file", path: ".convax/project.json" },
    { kind: "project-file", path: ".CONVAX/assets/blobs/a" },
    { kind: "project-directory", path: "../outside" },
    { kind: "managed-asset", sha256: "A".repeat(64) },
    { kind: "managed-asset", sha256: "a".repeat(63) },
  ])("rejects unsafe references", (reference) => {
    expect(() => requireProjectResourceReference(reference)).toThrow()
  })

  test("derives the private blob path only from a validated digest", () => {
    expect(managedAssetPath("b".repeat(64))).toBe(`.convax/assets/blobs/${"b".repeat(64)}`)
  })
})
```

- [ ] **Step 2: Write failing transient-state/dehydrate tests**

Add a test that creates one text and one image node with transient state and verifies dehydrate strips every runtime byte while retaining the concrete references:

```ts
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
        resourceState: { contentRevision: "rev-1", status: "ready", text: "secret" },
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
          state: { posterUrl: "blob:poster", status: "ready", url: "convax-asset://runtime" },
        },
      }),
    ],
  })
  const persisted = dehydrateProjectCanvasDocument(document)
  expect(JSON.stringify(persisted)).not.toContain("secret")
  expect(JSON.stringify(persisted)).not.toContain("convax-asset:")
  expect(JSON.stringify(persisted)).not.toContain("blob:poster")
  expect(getProjectResourceReference(persisted.nodes[0]!.data.metadata)).toEqual(textReference)
  expect(getProjectResourceReference(persisted.nodes[1]!.data.metadata)).toEqual(imageReference)
})
```

- [ ] **Step 3: Run both tests and verify RED**

Run:

```bash
bun test packages/project/src/canvas/project-resources.test.ts packages/canvas/src/core.test.ts
```

Expected: failures because the typed union, metadata key, and `resourceState` do not exist.

- [ ] **Step 4: Define Canvas transient resource state**

In `packages/canvas/src/types.ts`, replace durable `text`, `richText`, `url`, `posterUrl`, and folder `path` fields with a transient state union:

```ts
export type CanvasResourceStatus = "stale" | "ready" | "missing" | "corrupt" | "unsupported" | "conflict"

export interface CanvasResourceRuntimeState {
  contentRevision?: string
  error?: string
  posterUrl?: string
  status: CanvasResourceStatus
  text?: string
  url?: string
}

export interface CanvasTextNodeData extends CanvasBaseNodeData {
  kind: "text"
  name?: string
  mimeType?: string
  metadata: Record<string, unknown>
  resourceState?: CanvasResourceRuntimeState
}

export interface CanvasMediaNodeData extends CanvasBaseNodeData {
  kind: CanvasMediaKind
  fit?: "contain" | "cover"
  name?: string
  mimeType?: string
  width?: number
  height?: number
  durationMs?: number
  metadata: Record<string, unknown>
  resourceState?: CanvasResourceRuntimeState
}

export interface CanvasFolderNodeData extends CanvasBaseNodeData {
  kind: "folder"
  name?: string
  metadata: Record<string, unknown>
  resourceState?: CanvasResourceRuntimeState
}
```

`resourceState` is optional only because a durable document intentionally omits it; every mounted resource node receives it from preparation or hydration. Make `CanvasTextResource`, `CanvasResource`, and `CanvasFolderResource` carry required `state: CanvasResourceRuntimeState` plus `metadata`, and update the three node factories to copy `state` into `resourceState`. Text nodes and text resources persist `name` plus `mimeType`, never `format`; the UI derives Markdown/plain behavior with `getCanvasTextFileFormat`. Do not add aliases for the removed durable fields, and reject persisted `format` as a legacy content shape during dehydration/load.

- [ ] **Step 5: Implement the Project reference owner**

In `packages/project/src/canvas/project-resources.ts`, define and export:

```ts
export const projectResourceReferenceKey = "convaxProjectResource"
export const managedProjectAssetBlobDirectory = ".convax/assets/blobs"

export type ProjectResourceReference =
  | { kind: "project-file"; path: string }
  | { kind: "managed-asset"; sha256: string; name: string; mediaType?: string }
  | { kind: "project-directory"; path: string }

export function managedAssetPath(sha256: string) {
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error("Managed asset digest is invalid")
  return `${managedProjectAssetBlobDirectory}/${sha256}`
}
```

`requireProjectResourceReference` must return a normalized clone, reject unknown fields, validate POSIX Project paths, reject any first segment whose normalized case is `.convax`, require lower-case SHA-256, and bound `name` to 255 Unicode scalar values. `getProjectResourceReference(metadata)` must read only `metadata[projectResourceReferenceKey]` and return `null` instead of throwing.

`dehydrateProjectCanvasDocument` must:

1. require a valid Project reference on every `text`, `image`, `video`, `audio`, `file`, and `folder` node;
2. require `project-directory` only for folder nodes and disallow it for content nodes;
3. drop `resourceState` entirely;
4. reject legacy `convaxProjectFile`, `text`, `richText`, `url`, `posterUrl`, and `path` keys;
5. leave agent, group, and Plugin-specific node state unchanged except for recursively rejecting native absolute paths and runtime URL schemes inside host-owned resource slots.

- [ ] **Step 6: Update Canvas node creation and business commands**

Change the factories in `packages/canvas/src/document.ts` and `resources.add` application command to accept the new prepared shape. A text node creation must look like:

```ts
export function createTextNode(input: {
  format?: CanvasTextFormat
  id?: string
  label?: string
  metadata: Record<string, unknown>
  position: CanvasPoint
  resourceState: CanvasResourceRuntimeState
}): CanvasNode {
  return {
    id: input.id ?? createCanvasId("node"),
    type: "file",
    position: input.position,
    data: {
      format: input.format,
      kind: "text",
      label: input.label ?? "Text",
      metadata: input.metadata,
      resourceState: input.resourceState,
    },
    style: { width: 360, height: 240 },
  }
}
```

Update test fixtures to provide explicit `{ metadata: {}, resourceState: { status: "ready", text: "..." } }`; do not keep a `text` compatibility parameter.

- [ ] **Step 7: Run Canvas and Project package gates**

Run:

```bash
bun --cwd packages/canvas typecheck
bun --cwd packages/canvas test
bun --cwd packages/project typecheck
bun --cwd packages/project test
bun run pack:check
```

Expected: all commands exit 0 and no persisted-document test contains inline resource bytes.

- [ ] **Step 8: Commit the resource model**

```bash
git add packages/canvas packages/project/src/canvas
git commit -m "feat(project): add typed canvas resource references"
```

## Task 3: Build the content-addressed managed-asset store

**Files:**

- Create: `packages/project/src/node/project-canvas/project-managed-asset-store.ts`
- Create: `packages/project/src/node/project-canvas/project-managed-asset-store.test.ts`
- Modify: `packages/project/src/node/project-canvas/index.ts`
- Modify: `packages/project/src/node/project-manager.ts`
- Modify: `packages/project/src/node/project-manager-helpers.ts`
- Test: `packages/project/src/node/project-manager.test.ts`

- [ ] **Step 1: Write failing deduplication and immutable-copy tests**

Create `project-managed-asset-store.test.ts` with a temp Project root and these assertions:

```ts
test("deduplicates equal external bytes and never retains the source path", async () => {
  const firstSource = await writeExternal("first.png", pngBytes)
  const secondSource = await writeExternal("renamed.png", pngBytes)
  const first = await store.admitExternalFile({
    mediaType: "image/png",
    name: "first.png",
    projectId,
    sourcePath: firstSource,
  })
  const second = await store.admitExternalFile({
    mediaType: "image/png",
    name: "renamed.png",
    projectId,
    sourcePath: secondSource,
  })
  expect(first.sha256).toBe(second.sha256)
  expect(first.name).toBe("first.png")
  expect(second.name).toBe("renamed.png")
  expect(await fs.readdir(path.join(projectRoot, ".convax/assets/blobs"))).toEqual([first.sha256])
  expect(JSON.stringify([first, second])).not.toContain(externalRoot)

  await fs.writeFile(firstSource, "changed")
  expect(await fs.readFile(path.join(projectRoot, managedAssetPath(first.sha256)))).toEqual(pngBytes)
})
```

Add separate tests for concurrent equal imports, a symlink input, a directory input, an existing digest whose bytes do not hash to its filename, and a source located inside the Project.

- [ ] **Step 2: Run the store test and verify RED**

Run:

```bash
bun test packages/project/src/node/project-canvas/project-managed-asset-store.test.ts
```

Expected: module-not-found failure for the new store.

- [ ] **Step 3: Implement one mutex per Project**

Implement this internal primitive in the store file:

```ts
class ProjectAssetMutex {
  readonly #queues = new Map<string, Promise<void>>()

  async run<T>(projectId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.#queues.get(projectId) ?? Promise.resolve()
    let release!: () => void
    const current = new Promise<void>((resolve) => {
      release = resolve
    })
    const queued = previous.catch(() => undefined).then(() => current)
    this.#queues.set(projectId, queued)
    await previous.catch(() => undefined)
    try {
      return await operation()
    } finally {
      release()
      if (this.#queues.get(projectId) === queued) this.#queues.delete(projectId)
    }
  }
}
```

Use a queue implementation whose cleanup comparison refers to the exact queued promise; add a focused concurrency test proving operations for one Project serialize and different Projects may overlap.

- [ ] **Step 4: Implement streamed content-addressed admission**

Expose this narrow class API:

```ts
export interface ProjectRootResolver {
  resolveProjectRoot(input: { projectId: string }): Promise<string>
}

export class ProjectManagedAssetStore {
  constructor(
    private readonly roots: ProjectRootResolver,
    private readonly options: {
      maximumBytes?: number
      now?: () => number
      randomId?: () => string
    } = {},
  ) {}

  admitExternalFile(input: {
    mediaType?: string
    name: string
    projectId: string
    sourcePath: string
  }): Promise<Extract<ProjectResourceReference, { kind: "managed-asset" }>>

  resolve(input: {
    projectId: string
    reference: Extract<ProjectResourceReference, { kind: "managed-asset" }>
  }): Promise<string>

  withVerifiedReferences<T>(
    input: {
      projectId: string
      references: readonly Extract<ProjectResourceReference, { kind: "managed-asset" }>[]
    },
    commit: () => Promise<T>,
  ): Promise<T>

  runExclusive<T>(projectId: string, operation: () => Promise<T>): Promise<T>
}
```

Admission must run inside `runExclusive`, open the source without following a final symlink, stream into `.convax/assets/.staging/<operation-id>` with `wx`, hash actual bytes, enforce a configurable size ceiling whose v1 default is 8 GiB, fsync/close, re-hash staging, and publish to `blobs/<sha256>` with a no-replace operation. If a concurrent winner exists, verify its digest before deleting staging. Every error removes only the operation's staging file and must identify that file by the inode created by this operation rather than pathname alone. Revalidate the real staging/blob directory identities around create and publish so parent-directory replacement fails closed. Also provide `withAdmittedExternalFiles(input, commit)`; it admits all input files and invokes the supplied async `commit(references)` callback before releasing the Project mutex, so a due orphan cannot be deleted between reuse and Canvas commit. `withVerifiedReferences` similarly verifies every supplied blob and invokes `commit()` under one lock. It is the sole locking operation allowed to reuse the still-active same-store/same-Project async lock context, so an admission callback can reach repository save without self-deadlocking; all other nested locking calls remain forbidden, and an expired/escaped context must enqueue normally.

- [ ] **Step 5: Close general Project Files access to private assets**

Delete `managedAssetDirectory`, `assertCopyOrImportTarget(..., true)`, `deleteManagedAssets`, and managed branches from `copyEntries`, `importEntries`, and `writeTextFile`. Add regression tests:

```ts
for (const operation of ["copyEntries", "importEntries", "writeTextFile"] as const) {
  test(`${operation} cannot write private managed assets`, async () => {
    await expect(invoke(operation, ".convax/assets/blobs/" + "a".repeat(64))).rejects.toThrow("reserved for Convax")
  })
}
```

Keep `resolveProjectRoot`, typed private storage, and `resolvePrivatePath` available only to their dedicated Node callers. Every general renderer-safe Project Files read, listing, path-resolution, and mutation method must reject every `.convax` case variant.

- [ ] **Step 6: Run Project tests and pack check**

Run:

```bash
bun test packages/project/src/node/project-canvas/project-managed-asset-store.test.ts
bun test packages/project/src/node/project-manager.test.ts
bun --cwd packages/project typecheck
bun --cwd packages/project test
bun run pack:check
```

Expected: all commands exit 0.

- [ ] **Step 7: Commit managed storage**

```bash
git add packages/project/src/node
git commit -m "feat(project): add content-addressed managed assets"
```

## Task 4: Prepare Project resources and enforce the new repository schema

**Files:**

- Modify: `packages/canvas/src/application/resources.ts`
- Test: `packages/canvas/src/application/resources.test.ts`
- Modify: `packages/project/src/node/project-canvas/project-canvas-resource-preparation.ts`
- Test: `packages/project/src/node/project-canvas/project-canvas-resource-preparation.test.ts`
- Create: `packages/project/src/node/project-canvas/project-file-publisher.ts`
- Test: `packages/project/src/node/project-canvas/project-file-publisher.test.ts`
- Modify: `packages/project/src/node/project-canvas/project-canvas-document-repository.ts`
- Test: `packages/project/src/node/project-canvas/project-canvas-document-repository.test.ts`
- Modify: `packages/project/src/node/project-canvas/index.ts`
- Modify: `packages/project/src/canvas/project-resources.ts`
- Test: `packages/project/src/canvas/project-resources.test.ts`
- Modify: `packages/desktop/src/main/index.ts`
- Test: `packages/desktop/src/main/open-project-ipc.test.ts`

- [ ] **Step 1: Write failing business-source validation tests**

Change Canvas resource sources to these host-neutral inputs:

```ts
export type CanvasResourceSource =
  | (CanvasResourceSourceBase & {
      kind: "new-text"
      name?: string
      text: string
    })
  | (CanvasResourceSourceBase & {
      kind: "host-file"
      path: string
    })
  | (CanvasResourceSourceBase & {
      kind: "host-directory"
      path: string
    })
```

In `packages/canvas/src/application/resources.test.ts`, add:

```ts
test.each(["inline-text", "remote-url"])("rejects removed source kind %s", async (kind) => {
  await expect(
    service.addResources({
      ...request,
      sources: [{ kind, sourceId: "legacy", text: "legacy", url: "https://example.com" } as never],
    }),
  ).rejects.toThrow("Unsupported canvas resource source")
})

test("passes new text to host preparation without putting text into the command fingerprint result", async () => {
  preparation.prepare = mock(async () => ({
    items: [
      {
        id: "prepared",
        kind: "text",
        metadata: { convaxProjectResource: { kind: "project-file", path: "Notes/Untitled-a.md" } },
        mimeType: "text/markdown",
        name: "Untitled-a.md",
        state: { contentRevision: "rev-a", status: "ready", text: "Hello" },
      },
    ],
  }))
  const result = await service.addResources({
    ...request,
    sources: [{ kind: "new-text", sourceId: "draft", text: "Hello" }],
  })
  expect(result.document.nodes[0]!.data.resourceState).toEqual({
    contentRevision: "rev-a",
    status: "ready",
    text: "Hello",
  })
})
```

- [ ] **Step 2: Write failing Project preparation tests**

Replace the old copying and remote URL tests with:

```ts
test("keeps every Project file in place", async () => {
  const result = await preparation.prepare({
    ...requestRef,
    sources: [{ kind: "host-file", path: "media/hero.png", sourceId: "hero" }],
  })
  expect(assetStore.admitExternalFile).not.toHaveBeenCalled()
  expect(getProjectResourceReference(result.items[0]!.metadata)).toEqual({
    kind: "project-file",
    path: "media/hero.png",
  })
})

test("publishes new text below Notes before returning a prepared item", async () => {
  const result = await preparation.prepare({
    ...requestRef,
    sources: [{ kind: "new-text", name: "Brief", sourceId: "new", text: "# Brief" }],
  })
  expect(projectFiles.publishText).toHaveBeenCalledWith({
    content: "# Brief",
    directory: "Notes",
    extension: ".md",
    name: "Brief",
    projectId: "project_one",
  })
  expect(getProjectResourceReference(result.items[0]!.metadata)).toEqual({
    kind: "project-file",
    path: expect.stringMatching(/^Notes\/Brief-[a-z0-9]+\.md$/),
  })
})

test("accepts only Project directories", async () => {
  const result = await preparation.prepare({
    ...requestRef,
    sources: [{ kind: "host-directory", path: "design/references", sourceId: "folder" }],
  })
  expect(getProjectResourceReference(result.items[0]!.metadata)).toEqual({
    kind: "project-directory",
    path: "design/references",
  })
})
```

Add a native-only test for `admitExternalFiles` that passes absolute source paths and verifies returned items contain `managed-asset` references and no source path.

- [ ] **Step 3: Run the focused tests and verify RED**

Run:

```bash
bun test packages/canvas/src/application/resources.test.ts
bun test packages/project/src/node/project-canvas/project-canvas-resource-preparation.test.ts
bun test packages/project/src/node/project-canvas/project-canvas-document-repository.test.ts
```

Expected: failures from removed-source expectations and missing file-first Project ports.

- [ ] **Step 4: Implement a narrow Project publication port**

Create these internal contracts beside `ProjectCanvasResourcePreparation`:

```ts
export interface ProjectCanvasFilePublisher {
  publishText(input: {
    content: string
    directory: "Notes"
    extension: ".md"
    name?: string
    projectId: string
  }): Promise<{ contentRevision: string; path: string }>
}

export type ProjectCanvasResourceHost = Pick<ProjectFilesClient, "listDirectory" | "readFileInfo" | "readTextFile">
```

Implement `publishText` in a focused Node file `packages/project/src/node/project-canvas/project-file-publisher.ts`. It must normalize the display stem, create `.convax/staging/<operation-id>` on the Project filesystem, write UTF-8 bytes with `wx`, atomically publish with no replace to `Notes/<stem>-<short-id>.md`, return a SHA-256 `contentRevision`, and retain the published file after return. It must never overwrite a file, directory, or symlink, and it must never pathname-unlink successful or failed Project-publication staging aliases; Task 9 reclaims them after 24 hours. Repeated directory-identity checks still fail closed on ordinary symlinks and replacements completed before a check, but portable Node cannot make parent-directory validation and `link` one atomic operation, so the publisher does not claim to resist a same-UID actor replacing current-Project directory entries—including `.convax/` or `Notes/`—between validation and the syscall; §2.2 explicitly excludes that direct-tampering case from the threat model.

- [ ] **Step 5: Implement direct preparation and external admission**

Give `ProjectCanvasResourcePreparation` this constructor and native-only method:

```ts
constructor(
  private readonly project: ProjectCanvasResourceHost,
  private readonly publisher: ProjectCanvasFilePublisher,
  private readonly assets: ProjectManagedAssetStore,
  private readonly mediaInspector?: ProjectCanvasMediaInspector,
) {}

withAdmittedExternalFiles<T>(input: {
  files: readonly { mediaType?: string; name: string; sourcePath: string; sourceId: string }[]
  projectId: string
}, commit: (prepared: CanvasResourcePreparationResult) => Promise<T>): Promise<T>
```

`host-file` must read metadata/content directly from its existing Project path and never invoke `copyEntries`. `host-directory` must call `listDirectory` and return `project-directory`. `new-text` must publish first, then return a `project-file` text item. `withAdmittedExternalFiles` must reject directories, call the managed store for regular external files only, map the returned typed references to prepared items, and invoke `commit` before releasing the Project asset mutex. Do not expose a second external-admission API that returns prepared items after releasing the lock. The old path-based media inspector must not receive a private managed-asset path; external items may remain `stale` until hydration.

- [ ] **Step 6: Make repository save validate and dehydrate atomically**

In `ProjectCanvasDocumentRepository.load`, parse the v2 envelope and then run the same strict Project-owned reference validation used for save before returning a live document. A syntactically valid Canvas document with missing, malformed, or kind-incompatible Project references must fail without touching the catalog or mutating the original bytes. Let `UnsupportedCanvasDocumentVersionError` propagate unchanged.

Move the exact managed-reference collector needed by repository admission forward from Task 9 as `collectProjectManagedAssetReferences(document)`. It must traverse only `convaxProjectResource` and the typed values below `convaxProjectResourceBindings`, validate every encountered reference, return complete `managed-asset` references rather than reconstructing them from digest strings, deduplicate by digest, and ignore opaque Plugin JSON.

In `ProjectCanvasDocumentRepository.save`, compute the durable document before writing:

```ts
const durableDocument = dehydrateProjectCanvasDocument(request.document)
const content = serializeCanvasDocument(durableDocument)
const result = await this.storage.writePrivateTextFile({
  ...storageRef(request.ref),
  content,
  expectedVersion: request.expectedStorageVersion,
})
```

Wrap the private write and catalog touch in `assets.withVerifiedReferences({ projectId: request.ref.scopeId, references }, commit)`, where `references` is the exact validated list collected from `durableDocument`. This makes every managed-reference admission—including clipboard paste and duplication—serialize with GC. Add tests that capture the original stored bytes and assert every load failure leaves them byte-for-byte unchanged, plus a barrier test proving GC cannot pass the repository save between digest verification and the committed document write. Also cover the real external-admission callback → Canvas application → repository save chain to prove the same active lock context does not self-deadlock and is not released before the document write.

- [ ] **Step 7: Hard-cut Desktop composition to one store instance**

At the Desktop composition root, construct exactly one `ProjectManagedAssetStore` for the Project manager/root resolver and inject that same instance into resource preparation and every `ProjectCanvasDocumentRepository`; retain it for the later GC scheduler. Construct and inject the concrete `ProjectFilePublisher` there as well. Update every repository/preparation test harness and Desktop constructor call in this task. Do not add optional constructor parameters, fallback stores, or old preparation signatures.

- [ ] **Step 8: Run package gates**

Run:

```bash
bun --cwd packages/canvas typecheck
bun --cwd packages/canvas test
bun --cwd packages/project typecheck
bun --cwd packages/project test
bun run pack:check
```

Expected: all commands exit 0.

- [ ] **Step 9: Commit Project resource preparation**

```bash
git add packages/canvas/src/application packages/project/src/canvas packages/project/src/node/project-canvas packages/desktop/src/main
git commit -m "feat(project): prepare file-backed canvas resources"
```

## Task 5: Route Desktop UI and Agent additions through one resource operation

**Scope correction after independent review:** This task adds only the shared resource-add path. Resource
invalidation remains in Task 8 and the real seven-day GC race remains in Task 9. Desktop is a thin,
sender-scoped composition edge; it must not become a second resource service or trust Renderer-supplied
actor/scope values.

**Files:**

- Modify: `packages/desktop/src/desktop-protocol.ts`
- Test: `packages/desktop/src/desktop-protocol.test.ts`
- Modify: `packages/desktop/src/preload/index.ts`
- Modify: `packages/desktop/src/renderer/env.d.ts`
- Modify: `packages/desktop/src/main/canvas-document-ipc.ts`
- Test: `packages/desktop/src/main/canvas-document-ipc.test.ts`
- Modify: `packages/desktop/src/main/index.ts`
- Modify: `packages/desktop/src/renderer/canvas-upload.ts`
- Test: `packages/desktop/src/renderer/canvas-upload.test.ts`
- Modify: `packages/desktop/src/renderer/index.tsx`
- Modify: `packages/desktop/src/main/canvas-agent-tools.ts`
- Test: `packages/desktop/src/main/canvas-agent-tools.test.ts`
- Modify: `packages/desktop/resources/skills/canvas-storyboard/SKILL.md`
- Modify: `packages/canvas/src/services.tsx`
- Modify: `packages/canvas/src/components/canvas-editor.tsx`
- Test: `packages/canvas/src/components/canvas-editor.test.tsx`
- Modify: `packages/canvas/src/editor-context.tsx`
- Modify: `packages/canvas/src/components/builtin-node.tsx`
- Test: `packages/canvas/src/components/builtin-node.test.tsx`

- [x] **Step 1: Write failing protocol and shared-operation tests**

Add a renderer-safe contract under `window.convax.canvas.resources`:

```ts
export interface CanvasResourceClient {
  createLocalFileToken(file: File): string
  add(input: {
    anchor: { x: number; y: number }
    canvasId: string
    commandId: string
    expectedRevision: number
    localFiles?: readonly { name: string; sourceToken: string; sourceId: string; mediaType?: string }[]
    projectId: string
    sources: readonly CanvasResourceSource[]
  }): Promise<{ createdNodeIds: readonly string[]; revision: number; warnings: readonly string[] }>
}
```

In preload-facing types, `sourceToken` remains opaque. Add token creation below `canvas.resources` rather
than reusing Project Files import. Validate the entire batch before consuming anything: duplicate or invalid
tokens and `sourceId` collisions across portable and local sources reject atomically. After an accepted IPC
attempt, every token is consumed whether the Main call succeeds or fails. In the actual
`ipcRenderer.invoke` payload, send a Main-private `sourcePath`; never expose that payload shape in
`renderer/env.d.ts`, results, or errors.

Add tests proving:

```ts
expect(canvasResourceBusinessService.addResources).toHaveBeenCalledTimes(1)
expect(mainRequest.sources).toEqual([{ kind: "host-file", path: "media/hero.png", sourceId: "hero" }])
expect(mainRequest.externalFiles).toEqual([
  {
    mediaType: "image/png",
    name: "outside.png",
    sourceId: "outside",
    sourcePath: "/native/outside.png",
  },
])
expect(rendererResult).not.toContain("/native/outside.png")
```

- [x] **Step 2: Run protocol tests and verify RED**

Run:

```bash
bun test packages/desktop/src/desktop-protocol.test.ts
bun test packages/desktop/src/main/canvas-document-ipc.test.ts
bun test packages/desktop/src/renderer/canvas-upload.test.ts
```

Expected: failures because `canvas.resources` and the new bridge version do not exist.

- [x] **Step 3: Add the incompatible bridge atomically**

Increment `desktopProtocolVersion` by one and add only the resource-add IPC channel. Token creation is a
preload-local method that uses `webUtils` and never calls Main. Do not add an invalidate channel in this task;
Task 8 owns watcher-driven invalidation.

```ts
const canvasResourceChannels = {
  add: "canvas:resource-add",
} as const
```

The Main `add` handler must validate the trusted sender and resolve the active Project/Canvas for that exact
`event.sender`; it must not select the first mounted Renderer. Renderer-supplied Project/Canvas ids are stale
guards only, and Main injects the fixed UI actor. Convert consumed native source paths into
`ProjectCanvasResourcePreparation.withAdmittedExternalFiles` and execute the same
`CanvasResourceBusinessService` used by Agent and generation. Keep revision retry semantics in the business
service; do not duplicate placement or relation logic in IPC.

For local files, call `ProjectManagedAssetStore.withAdmittedExternalFiles` and keep its Project mutex through the resulting Canvas application commit. Refactor `CanvasResourceBusinessService` to expose a host-only `addPreparedResources(request, prepared)` method that reuses the same validation, placement, relation, conflict, and command-id logic as `addResources`. Project-path and `new-text` sources continue through `addResources`; pre-admitted external items use `addPreparedResources` inside the mutex callback.

Extend the real admission -> `addPreparedResources` -> repository-save integration test to prove the Project
mutex remains held through the commit. The seven-day orphan/GC race is tested with the real GC in Task 9,
not simulated here.

- [x] **Step 4: Replace renderer-side copying**

Delete `ensureProjectAssetsDirectory`, `copyCanvasProjectFiles`, `importCanvasFiles`, and `projectFileResource` from `packages/desktop/src/renderer/index.tsx`. Change `resolveCanvasUploadItems` so it returns transport sources rather than prepared node items:

```ts
export interface CanvasUploadSources {
  localFiles: Array<{ file: File; mediaType?: string; name: string; sourceId: string }>
  sources: CanvasResourceSource[]
}
```

Project file drags produce `host-file`; Project directory drags produce `host-directory`; local browser files
produce opaque tokens immediately before `canvas.resources.add`. Flush the mounted Canvas through the
existing view bridge before invoking Main so a stale Renderer save cannot overwrite the Main commit. Do not
call Project Files `copyEntries`, `importEntries`, `readTextFile`, or `writeTextFile` for Canvas admission.

Add a partial-success test in which `new-text` publication succeeds and Canvas commit fails. Assert the `Notes/*.md` file remains and the error contains its portable Project path.

- [x] **Step 5: Give CanvasEditor one host-neutral mutation service**

In `packages/canvas/src/services.tsx` add:

```ts
export interface CanvasResourceMutationService {
  add(input: {
    anchor: CanvasPoint
    expectedRevision: number
    files?: readonly File[]
    relation?: { anchorNodeIds: readonly string[]; direction?: "from-anchor" | "to-anchor"; mode: "connect" | "none" }
    sources: readonly CanvasResourceSource[]
    signal: AbortSignal
  }): Promise<{ createdNodeIds: readonly string[]; revision: number; warnings: readonly string[] }>
}
```

Every CanvasEditor new-text entry (toolbar, blank-canvas double click, menus, and quick-connect) must call this
service with `{ kind: "new-text", sourceId, text: "" }`; file drop must call it with selected files and portable
Project sources. Quick-connect uses the mutation relation field. On success, reload while preserving viewport.
Remove direct `addNode("text")`, direct upload-item insertion, and source-less media/file registry entries.
Until Task 8 introduces typed relink, disable/remove `replaceNodeMedia`; never implement replacement as add.

- [x] **Step 6: Remove old Agent source kinds**

Change the Agent JSON schema and parser to accept only:

```ts
{ kind: "new-text", sourceId: string, text: string, name?: string }
{ kind: "host-file", sourceId: string, path: string }
{ kind: "host-directory", sourceId: string, path: string }
```

Update `canvas-storyboard/SKILL.md` to say that `new-text` publishes Markdown under `Notes/` before adding a Canvas node. Add rejection tests for `inline-text`, `remote-url`, native paths, `.convax`, and external directories.

Agent and Renderer callers cannot supply a trusted actor or widen the current Project/Canvas. Main binds the
live scope, and external local files enter only through the opaque-token path.

- [x] **Step 7: Run Canvas/Desktop package gates**

Run:

```bash
bun --cwd packages/canvas typecheck
bun --cwd packages/canvas test
bun --cwd packages/desktop typecheck
bun --cwd packages/desktop test
bun run pack:check
```

Expected: all commands exit 0.

- [x] **Step 8: Commit shared resource insertion**

```bash
git add packages/canvas packages/desktop
git commit -m "feat(desktop): share canvas resource admission"
```

## Task 6: Hydrate resource references and make text editing file-backed

**Scope correction after independent review:** Hydration is a separate Project Node capability, not another
responsibility of resource preparation. Task 6 resolves every requested snapshot from disk without a cache;
Task 8 later adds invalidation only where mounted views need it. File compare-and-replace belongs to Project
Files; Desktop only binds a live node id to its exact typed reference. Managed editable-copy/relink is deferred
to Task 8 so no direct document rewrite is added.

**Files:**

- Modify: `packages/project/src/canvas/project-resources.ts`
- Test: `packages/project/src/canvas/project-resources.test.ts`
- Create: `packages/project/src/node/project-canvas/project-canvas-resource-hydrator.ts`
- Test: `packages/project/src/node/project-canvas/project-canvas-resource-hydrator.test.ts`
- Modify: `packages/project-files/src/contracts.ts`
- Modify: `packages/project/src/node/project-manager.ts`
- Test: `packages/project/src/node/project-manager.test.ts`
- Modify: `packages/desktop/src/desktop-protocol.ts`
- Test: `packages/desktop/src/desktop-protocol.test.ts`
- Modify: `packages/desktop/src/preload/index.ts`
- Modify: `packages/desktop/src/preload/canvas-resource-client.ts`
- Test: `packages/desktop/src/preload/canvas-resource-client.test.ts`
- Modify: `packages/desktop/src/main/canvas-document-ipc.ts`
- Test: `packages/desktop/src/main/canvas-document-ipc.test.ts`
- Modify: `packages/desktop/src/main/index.ts`
- Modify: `packages/desktop/src/renderer/index.tsx`
- Modify: `packages/canvas/src/types.ts`
- Modify: `packages/canvas/src/services.tsx`
- Modify: `packages/canvas/src/editor-context.tsx`
- Modify: `packages/canvas/src/components/canvas-editor.tsx`
- Test: `packages/canvas/src/components/canvas-editor.test.tsx`
- Modify: `packages/canvas/src/components/builtin-node.tsx`
- Test: `packages/canvas/src/components/builtin-node.test.tsx`
- Modify: `packages/project/src/controller.ts`
- Test: `packages/project/src/controller.test.ts`
- Modify: `packages/workbench/src/controller.ts`
- Test: `packages/workbench/src/controller.test.ts`

- [ ] **Step 1: Write failing hydration-state tests**

Add Project resource tests for all terminal states:

```ts
test.each([
  ["missing", { kind: "project-file", path: "missing.md" }],
  ["corrupt", { kind: "managed-asset", name: "bad.png", sha256: "d".repeat(64) }],
  ["unsupported", { kind: "project-file", path: "archive.bin" }],
] as const)("applies %s without deleting the reference", async (status, reference) => {
  const hydrated = await hydrateProjectCanvasDocument(documentFor(reference), async () => ({ status }))
  expect(hydrated.nodes[0]!.data.resourceState.status).toBe(status)
  expect(getProjectResourceReference(hydrated.nodes[0]!.data.metadata)).toEqual(reference)
})
```

Add a ready text case whose runtime state includes actual text and `contentRevision`, and a ready media case whose state includes only a custom-protocol URL.

- [ ] **Step 2: Write failing text draft/save tests**

In `builtin-node.test.tsx`, test these user-visible transitions:

```ts
test("keeps edits local until Save and never commits text to Canvas history", async () => {
  beginTextEdit()
  typeMarkdown("# Changed")
  expect(canvasEditor.commit).not.toHaveBeenCalled()
  expect(textResources.save).not.toHaveBeenCalled()

  clickToolbar("Save text")
  expect(textResources.save).toHaveBeenCalledWith({
    content: "# Changed",
    contentRevision: "rev-before",
    nodeId: "text-node",
  })
  expect(canvasEditor.commit).not.toHaveBeenCalled()
})

test("Escape discards only the in-memory draft", async () => {
  beginTextEdit()
  typeMarkdown("discard me")
  pressEscape()
  expect(textResources.save).not.toHaveBeenCalled()
  expect(screen.getByText("original")).toBeTruthy()
})

test("shows conflict when the Project file revision changed", async () => {
  textResources.save.mockRejectedValue(new CanvasTextResourceConflictError("rev-before", "rev-after"))
  beginTextEdit()
  typeMarkdown("my draft")
  clickToolbar("Save text")
  expect(screen.getByText(/changed outside Convax/i)).toBeTruthy()
  expect(screen.getByText("my draft")).toBeTruthy()
})
```

- [ ] **Step 3: Run hydration and editor tests and verify RED**

Run:

```bash
bun test packages/project/src/canvas/project-resources.test.ts
bun test packages/canvas/src/components/builtin-node.test.tsx
```

Expected: failures because hydration and file-backed text services are not implemented.

- [ ] **Step 4: Implement typed resource hydration**

Expose the following Project-owned snapshot and pure application function:

```ts
export interface ProjectResourceSnapshot {
  contentRevision?: string
  error?: string
  mediaType?: string
  name?: string
  posterUrl?: string
  status: CanvasResourceStatus
  text?: string
  url?: string
  editableText?: boolean
}

export async function hydrateProjectCanvasDocument(
  document: CanvasDocument,
  resolve: (reference: ProjectResourceReference) => Promise<ProjectResourceSnapshot>,
): Promise<CanvasDocument>
```

Implement the Node resolver as a dedicated `ProjectCanvasResourceHydrator`. It revalidates reference syntax,
Project containment, regular-file type, size, and managed digest on every call, reusing the shared
`ProjectManagedAssetStore`. A URL factory is injected by Desktop. For text it returns strict UTF-8 content
plus the raw-byte SHA-256 `contentRevision`; for media it returns metadata and a Desktop-created
`convax-asset:` URL, never a native path. Per-node failures become safe bounded states and cannot leak native
filesystem errors. Do not add a hydration cache in this task: disk remains the only content truth and Task 8
will define watcher-driven refresh before any caching policy exists.

- [ ] **Step 5: Add file-backed text read/save ports**

Add this host-neutral Canvas service:

```ts
export class CanvasTextResourceConflictError extends Error {
  constructor(
    readonly expectedRevision: string,
    readonly actualRevision: string | null,
  ) {
    super("Canvas text resource changed outside Convax")
    this.name = "CanvasTextResourceConflictError"
  }
}

export interface CanvasTextResourceService {
  save(
    input: {
      content: string
      contentRevision: string
      nodeId: string
    },
    signal: AbortSignal,
  ): Promise<{ contentRevision: string }>
}
```

Add an internal Project Files compare-and-replace port that performs bounded stable read, raw-byte SHA-256
comparison, and atomic replacement inside the existing per-file write queue. Desktop binds `nodeId` to the
live active Project/Canvas, reloads the document, extracts the exact `project-file` reference, rejects managed
assets as read-only, and calls that port. The IPC request must not accept a path or reference from Renderer.

Managed `.md`/`.txt` remains read-only in this task. Task 8 adds typed relink and then implements
`Save editable copy`; do not mutate document references directly in Desktop or Project Node code.

- [ ] **Step 6: Keep draft lifecycle out of Canvas persistence**

Add a CanvasEditor draft registry:

```ts
export interface CanvasPendingDraft {
  discard(): void
  save(): Promise<void>
}

registerPendingDraft(draft: CanvasPendingDraft): () => void
```

`prepareToLeave` must ask a host-provided decision service for `"save" | "discard" | "cancel"`; save awaits
every registered draft, discard calls each discard callback, and cancel returns `false`. Project and Workbench
before-change guards must accept that result as a clean cancellation, retain the current scope, clear their
changing state, and keep `error` null instead of surfacing a Canvas-specific exception.
Browser `beforeunload` remains guarded while any draft is registered. Abort before file commit performs no
write; after atomic commit the operation reports success and scope departure waits for it.

- [ ] **Step 7: Change BuiltinTextFileNode to explicit Save/Cancel**

Read display content from `data.resourceState.text ?? ""`. Tiptap updates only a component-local draft.
Replace “Finish editing” with separate `Save text` and `Cancel text` actions. Successful save refreshes runtime
state without calling full history hydration (which clears undo/redo), `updateCanvasNodeData`, `commit`,
`beginGesture`, or Canvas undo. Enable editing only for Project `.md`/`.txt`; managed text and every other
format remain read-only until typed relink lands in Task 8.

- [ ] **Step 8: Run package gates**

Run:

```bash
bun --cwd packages/canvas typecheck
bun --cwd packages/canvas test
bun --cwd packages/project typecheck
bun --cwd packages/project test
bun --cwd packages/desktop typecheck
bun --cwd packages/desktop test
bun run pack:check
```

Expected: all commands exit 0.

- [ ] **Step 9: Commit hydration and text editing**

```bash
git add packages/canvas packages/project packages/desktop
git commit -m "feat(canvas): save text through project files"
```

## Task 7: Publish generation output as user-visible Project files

**Files:**

- Modify: `packages/desktop/src/main/generation-canvas-service.ts`
- Test: `packages/desktop/src/main/generation-canvas-service.test.ts`
- Modify: `packages/project/src/node/project-canvas/project-file-publisher.ts`
- Test: `packages/project/src/node/project-canvas/project-file-publisher.test.ts`
- Modify: `docs/generation-tool-plugins.md`

- [x] **Step 1: Write failing media and text publication tests**

Replace managed-output assertions in `generation-canvas-service.test.ts` with:

```ts
test("publishes generated media below Generated before Canvas commit", async () => {
  const result = await service.generate(imageRequest, actor)
  expect(projectFiles.publishGenerated).toHaveBeenCalledWith(
    expect.objectContaining({
      extension: ".png",
      projectId: "project_one",
    }),
  )
  expect(resourceRequests[0]!.sources).toEqual([
    {
      kind: "host-file",
      path: expect.stringMatching(/^Generated\/generated-[a-z0-9]+\.png$/),
      sourceId: expect.any(String),
    },
  ])
  expect(result.createdNodeIds).toHaveLength(1)
})

test("publishes generated text as UTF-8 Markdown", async () => {
  await service.generate(textRequest, actor)
  expect(projectFiles.publishGenerated).toHaveBeenCalledWith(
    expect.objectContaining({
      bytes: Buffer.from("A generated paragraph", "utf8"),
      extension: ".md",
      projectId: "project_one",
    }),
  )
  expect(resourceRequests[0]!.sources[0]).toMatchObject({
    kind: "host-file",
    path: expect.stringMatching(/^Generated\/generated-[a-z0-9]+\.md$/),
  })
})

test("retains a published result when Canvas commit fails", async () => {
  resources.addResources.mockRejectedValue(new Error("Canvas conflict"))
  await expect(service.generate(imageRequest, actor)).rejects.toThrow("Canvas conflict")
  expect(projectFiles.removePublishedFile).not.toHaveBeenCalled()
  expect(await fs.readFile(publishedPath)).toEqual(generatedBytes)
})
```

Delete the former expectation that `deleteManagedAssets` runs after a commit failure.

- [x] **Step 2: Run the generation tests and verify RED**

Run:

```bash
bun test packages/desktop/src/main/generation-canvas-service.test.ts
```

Expected: failures because generation still imports into `.convax/assets` and rolls it back.

- [x] **Step 3: Add no-clobber Generated publication**

Extend `ProjectFilePublisher` with:

```ts
publishGenerated(input: {
  bytes: Uint8Array
  extension: string
  name?: string
  projectId: string
}): Promise<{ path: string }>
```

It must write to `.convax/staging/<operation-id>`, verify the byte count, fsync and close, then publish with no replace to `Generated/<safe-stem>-<short-id><extension>`. A collision chooses another short id. Existing files, directories, and symlinks are never replaced.

- [x] **Step 4: Replace generation admission and rollback**

In `GenerationCanvasProjectPort`, replace `importEntries` and `deleteManagedAssets` with `publishGenerated`. Remove `#importOutputFiles` and create one published Project path per admitted text/media result. Pass those paths as `host-file` sources into the existing shared resource business service.

The error branch after publication must preserve files and append a bounded partial-success message:

```ts
throw new GenerationPublicationPartialSuccessError({
  cause: error,
  publishedPaths,
  message: "Generation succeeded and files were saved, but they could not be added to Canvas.",
})
```

The error may expose portable `Generated/*` paths, never native paths or sidecar diagnostics.

- [x] **Step 5: Keep reference staging typed**

Update generation input staging to read `ProjectResourceReference` rather than `ProjectFileReference.path`. Project files resolve through containment checks; managed assets resolve through digest verification. Text input comes from hydrated bytes or a fresh Node read, never from persisted Canvas data. Recheck the exact reference and content revision immediately before the external call.

- [x] **Step 6: Run generation and package gates**

Run:

```bash
bun test packages/desktop/src/main/generation-canvas-service.test.ts
bun --cwd packages/project typecheck
bun --cwd packages/project test
bun --cwd packages/desktop typecheck
bun --cwd packages/desktop test
```

Expected: all commands exit 0.

- [x] **Step 7: Commit file-first generation**

```bash
git add packages/project/src/node/project-canvas packages/desktop/src/main/generation-canvas-service.ts packages/desktop/src/main/generation-canvas-service.test.ts docs/generation-tool-plugins.md
git commit -m "feat(generation): publish outputs to project files"
```

## Task 8: Invalidate mounted resources conservatively on filesystem events

**Files:**

- Modify: `packages/canvas/src/services.tsx`
- Modify: `packages/canvas/src/components/canvas-editor.tsx`
- Test: `packages/canvas/src/components/canvas-editor.test.tsx`
- Modify: `packages/canvas/src/components/builtin-node.tsx`
- Test: `packages/canvas/src/components/builtin-node.test.tsx`
- Modify: `packages/project-files/src/contracts.ts`
- Test: `packages/project-files/src/controller.test.ts`
- Modify: `packages/desktop/src/renderer/index.tsx`
- Test: `packages/desktop/src/renderer/project-canvas-workbench.test.ts`

- [ ] **Step 1: Write a failing coalesced-event test**

Add a CanvasEditor test that mounts two Project resources, emits one event containing only the first path, and verifies both snapshots become stale while the path is only a priority hint:

```ts
test("invalidates every mounted resource for one coalesced Project event", async () => {
  renderEditorWithResources(["Notes/a.md", "media/b.png"])
  projectChanges.emit({ kind: "filesystem", path: "Notes/a.md", projectId: "project_one" })

  expect(resourceHydration.invalidate).toHaveBeenCalledWith({
    priorityPath: "Notes/a.md",
    reason: "filesystem",
  })
  expect(getResourceStatus("Notes/a.md")).toBe("stale")
  expect(getResourceStatus("media/b.png")).toBe("stale")
})
```

Add cases for missing path, rename-shaped events, watcher restart, another Project, and an event received after Project switch.

Add a relink test that starts with a missing `project-file`, selects a different Project file, and verifies a normal Canvas command replaces only that node's typed reference. A raw watcher rename must leave the old reference unchanged.

- [ ] **Step 2: Run watcher tests and verify RED**

Run:

```bash
bun test packages/canvas/src/components/canvas-editor.test.tsx
bun test packages/project-files/src/controller.test.ts
bun test packages/desktop/src/renderer/project-canvas-workbench.test.ts
```

Expected: failure because only file-tree refresh exists and mounted Canvas resources have no invalidation service.

- [ ] **Step 3: Add a host-neutral hydration cache contract**

Define in `packages/canvas/src/services.tsx`:

```ts
export interface CanvasResourceHydrationService {
  hydrate(input: { document: CanvasDocument; signal: AbortSignal }): Promise<CanvasDocument>
  invalidate(input: { priorityPath?: string; reason: "filesystem" | "manual" | "watcher-restart" }): void
  subscribe(listener: () => void): () => void
  version(): number
}
```

The service marks all mounted Project resource snapshots stale on every invalidation. `priorityPath` may order work but must never select the only invalidated nodes. CanvasEditor rehydrates the currently visible/accessed document without changing revision, history, selection, or viewport.

Extend `CanvasResourceMutationService` with a `relink` operation that accepts `nodeId` plus either one portable Project source or one local `File`. Desktop binds the active scope, prepares the replacement, verifies its kind is compatible with the existing node, and commits a typed `resources.relink` business command. Missing-node toolbars expose `Relink resource`; no watcher event calls this operation automatically.

- [ ] **Step 4: Wire Project events at the Desktop composition edge**

Subscribe once to `window.convax.projectFiles.onDidChange`. For an event matching the active Project, call the mounted hydration service regardless of `event.path`. Do not rewrite references, infer rename pairs, or dispatch a Canvas document mutation.

Use a generation token so an async hydration started for Project A cannot replace the mounted document after switching to Project B.

- [ ] **Step 5: Keep ProjectFilesController behavior independent**

The Project Files tree continues to debounce and refresh visible directories. Its tests should assert the original optional `path` is preserved in the event contract but does not affect which visible directories refresh. Do not put Canvas state in `ProjectFilesController`.

- [ ] **Step 6: Run Canvas, Project Files, and Desktop gates**

Run:

```bash
bun --cwd packages/canvas typecheck
bun --cwd packages/canvas test
bun --cwd packages/project-files typecheck
bun --cwd packages/project-files test
bun --cwd packages/desktop typecheck
bun --cwd packages/desktop test
```

Expected: all commands exit 0.

- [ ] **Step 7: Commit watcher invalidation**

```bash
git add packages/canvas packages/project-files packages/desktop/src/renderer
git commit -m "feat(canvas): invalidate project resources on file changes"
```

## Task 9: Implement delayed managed-asset GC

**Files:**

- Create: `packages/project/src/node/project-canvas/project-asset-gc.ts`
- Create: `packages/project/src/node/project-canvas/project-asset-gc.test.ts`
- Modify: `packages/project/src/canvas/project-resources.ts`
- Test: `packages/project/src/canvas/project-resources.test.ts`
- Modify: `packages/project/src/node/project-canvas/project-canvas-manager.ts`
- Test: `packages/project/src/node/project-canvas/project-canvas-manager.test.ts`
- Modify: `packages/desktop/src/main/index.ts`
- Test: `packages/desktop/src/main/application-lifecycle.test.ts`
- Modify: `packages/desktop/src/renderer/settings-view.tsx`
- Test: `packages/desktop/src/renderer/settings-view.test.tsx`

- [ ] **Step 1: Write failing reference-root traversal tests**

Add a pure traversal test:

```ts
test("enumerates only typed managed references", () => {
  const live = "e".repeat(64)
  const fake = "f".repeat(64)
  const document = documentWithMetadata({
    convaxProjectResource: { kind: "managed-asset", name: "live.png", sha256: live },
    convaxPluginState: { arbitrary: fake },
    log: `managed-asset:${fake}`,
  })
  expect(collectManagedAssetDigests(document)).toEqual(new Set([live]))
})
```

Add cases for a node main resource, a typed poster/resource binding, Plugin host-owned resource bindings, malformed typed fields, and opaque Plugin JSON.

- [ ] **Step 2: Write failing GC state-machine tests**

Create `project-asset-gc.test.ts` with an injected clock and filesystem harness. Cover:

```ts
test("marks on the first scan and deletes only after seven days plus a fresh full scan", async () => {
  await gc.scan(projectId)
  expect(await blobExists(orphan)).toBe(true)
  expect(await readGcEntry(orphan)).toEqual({ unreferencedSince: day(0) })

  clock.set(day(6))
  await gc.scan(projectId)
  expect(await blobExists(orphan)).toBe(true)

  clock.set(day(7))
  await gc.scan(projectId)
  expect(canvasRepository.loadAll).toHaveBeenCalledTimes(3)
  expect(await blobExists(orphan)).toBe(false)
})

test("does not unlink when gc.json publication fails", async () => {
  stateStore.failNextWrite(new Error("disk full"))
  await expect(gc.scan(projectId)).rejects.toThrow("disk full")
  expect(await blobExists(due)).toBe(true)
})

test("retains a due mark when unlink fails and retries next scan", async () => {
  unlink.failOnce(due)
  await gc.scan(projectId)
  expect(await readGcEntry(due)).toEqual({ unreferencedSince: day(0) })
  await gc.scan(projectId)
  expect(await blobExists(due)).toBe(false)
})
```

Also test corrupt/missing `gc.json`, unreadable Canvas, unsupported Canvas schema, digest mismatch, symlink entries, unknown blob names, re-reference, missing blob record pruning, active staging, and staging older than 24 hours.

- [ ] **Step 3: Run GC tests and verify RED**

Run:

```bash
bun test packages/project/src/canvas/project-resources.test.ts
bun test packages/project/src/node/project-canvas/project-asset-gc.test.ts
```

Expected: failure because the GC digest projection and GC service do not exist; the exact typed-reference traversal added in Task 4 remains green.

- [ ] **Step 4: Implement strict managed-root traversal**

Export the GC-facing projection over the Task 4 exact collector:

```ts
export function collectManagedAssetDigests(document: CanvasDocument): ReadonlySet<string>
```

`collectManagedAssetDigests` maps `collectProjectManagedAssetReferences(document)` to a digest set; it does not perform a second traversal. The underlying collector walks only the exact host-owned keys declared by the v2 schema, calls `requireProjectResourceReference` on each encountered binding, throws on malformed declared bindings, ignores ordinary strings and opaque Plugin state, and never scans JSON text heuristically.

- [ ] **Step 5: Implement rebuildable GC state**

Use this exact durable shape at `.convax/assets/gc.json`:

```ts
export interface ProjectAssetGcState {
  schemaVersion: 1
  lastSuccessfulScanAt: string
  entries: Record<string, { unreferencedSince: string }>
}
```

`ProjectAssetGc.scan(projectId)` must run inside the same `ProjectManagedAssetStore.runExclusive` mutex and perform:

1. load every current v2 Canvas document and collect typed digests; abort on any failure;
2. enumerate only regular `blobs/<lowercase-sha256>` files without following symlinks;
3. verify each blob hashes to its filename;
4. clear records for live digests and add the current time for first-seen orphans;
5. retain due records in the next state and atomically publish `gc.json` first;
6. unlink due candidates only after state publication;
7. retain failed-unlink records and prune missing-blob records on the next full scan;
8. remove inactive `.convax/assets/.staging/*` and `.convax/staging/*` regular entries older than 24 hours.

If `gc.json` is absent or invalid, build a fresh state and delete nothing in that scan.

- [ ] **Step 6: Add low-frequency scheduling**

Create a Desktop-owned scheduler with constants exported from the GC module:

```ts
export const projectAssetGcGraceMs = 7 * 24 * 60 * 60 * 1_000
export const projectAssetGcMinimumIntervalMs = 24 * 60 * 60 * 1_000
export const projectAssetGcOpenDelayMs = 30 * 1_000
export const projectAssetStagingRetentionMs = 24 * 60 * 60 * 1_000
```

On Project open, schedule one idle scan only when `lastSuccessfulScanAt` is at least 24 hours old. While open, allow at most one scan per 24 hours; merge duplicate requests. Project close and App exit cancel timers and never force a scan. Limit different Projects to one background scan at a time.

Add a narrow user-triggered `canvas.resources.collectGarbage` bridge method and a Settings action labelled `Clean reclaimable assets`. It starts an immediate full scan for the active Project, still honors the seven-day grace, and reports scanned/deleted/retried counts without exposing private paths. Add a test proving repeated clicks merge into the same Project scan.

- [ ] **Step 7: Run Project and Desktop gates**

Run:

```bash
bun --cwd packages/project typecheck
bun --cwd packages/project test
bun --cwd packages/desktop typecheck
bun --cwd packages/desktop test
bun run pack:check
```

Expected: all commands exit 0.

- [ ] **Step 8: Commit GC**

```bash
git add packages/project packages/desktop/src/main
git commit -m "feat(project): garbage collect unreferenced assets"
```

## Task 10: Remove legacy paths and complete the breaking cutover

**Files:**

- Modify: `packages/project/src/canvas/project-resources.ts`
- Modify: `packages/project/src/node/project-manager.ts`
- Modify: `packages/desktop/src/renderer/index.tsx`
- Modify: `packages/desktop/src/renderer/web-plugin-canvas.tsx`
- Modify: `packages/desktop/src/main/generation-canvas-service.ts`
- Modify: `packages/desktop/src/main/jianying-canvas-service.ts`
- Modify: `packages/desktop/src/renderer/jianying-selection-action.ts`
- Modify: `packages/desktop/src/renderer/ffmpeg-selection-action.ts`
- Modify: `packages/desktop/src/main/agent-resource-preparation.ts`
- Modify: `packages/project/src/canvas/project-resources.test.ts`
- Modify: `packages/project/src/node/project-manager.test.ts`
- Modify: `packages/project/src/node/project-canvas/project-canvas-resource-preparation.test.ts`
- Modify: `packages/project/src/node/project-canvas/project-canvas-document-repository.test.ts`
- Modify: `packages/canvas/src/core.test.ts`
- Modify: `packages/canvas/src/application/application.test.ts`
- Modify: `packages/canvas/src/application/resources.test.ts`
- Modify: `packages/desktop/src/main/canvas-agent-tools.test.ts`
- Modify: `packages/desktop/src/main/generation-canvas-service.test.ts`
- Modify: `packages/desktop/src/main/jianying-canvas-service.test.ts`
- Modify: `packages/desktop/src/main/agent-resource-preparation.test.ts`
- Modify: `packages/desktop/src/renderer/canvas-upload.test.ts`
- Modify: `packages/desktop/src/renderer/web-plugin-canvas.test.tsx`
- Modify: `packages/desktop/src/renderer/jianying-selection-action.test.ts`
- Modify: `packages/desktop/src/renderer/ffmpeg-selection-action.test.ts`
- Modify: `scripts/desktop-open-project-built-smoke.ts`
- Modify: `AGENTS.md`
- Modify: `docs/architecture.md`
- Modify: `packages/project/AGENTS.md`

- [ ] **Step 1: Add a forbidden-legacy repository test**

Add a table-driven test that stores v2 envelopes containing each removed shape and expects rejection without writes:

```ts
test.each([
  ["inline text", { kind: "text", text: "legacy" }],
  ["remote URL", { kind: "image", url: "https://example.com/legacy.png" }],
  ["path-only managed", { metadata: { convaxProjectFile: { path: ".convax/assets/legacy.png" } } }],
  ["folder path", { kind: "folder", path: "legacy-folder" }],
])("rejects removed %s persistence", async (_label, data) => {
  storage.seed(v2Envelope(documentWithNodeData(data)))
  await expect(repository.load(ref)).rejects.toThrow()
  expect(storage.writePrivateTextFile).not.toHaveBeenCalled()
  expect(storage.bytes()).toBe(storage.originalBytes())
})
```

- [ ] **Step 2: Run the rejection test and verify RED**

Run:

```bash
bun test packages/project/src/node/project-canvas/project-canvas-document-repository.test.ts
```

Expected: at least one legacy shape is still accepted.

- [ ] **Step 3: Delete every legacy production symbol**

Remove these exports and code paths rather than aliasing them:

```text
projectFileReferenceKey
getProjectFileReference
isManagedProjectAssetPath
managedProjectAssetDirectory
projectCanvasManagedAssetDirectory
deleteManagedAssets
inline-text
remote-url
convaxProjectFile
```

Update JianYing, FFmpeg, Web Plugin connected-image reads, generation staging, and Agent snapshots to branch on `ProjectResourceReference.kind`. `project-file` resolves with Project containment; `managed-asset` resolves by digest; `project-directory` is never eligible as file/media input.

- [ ] **Step 4: Search for forbidden persisted forms**

Run:

```bash
rg -n "convaxProjectFile|projectFileReferenceKey|inline-text|remote-url" packages docs scripts --glob '!**/dist/**'
rg -n "\.convax/assets/|data:|blob:" packages docs scripts --glob '!**/dist/**'
```

Expected: the first command has no production hit outside explicit rejection fixtures and historical design prose. Review every second-command hit: managed storage paths must be only `blobs`, `.staging`, or `gc.json`; `data:`/`blob:` hits must be transient renderer tests, CSS, or non-Canvas protocols and must not enter Canvas persistence.

- [ ] **Step 5: Update end-to-end smoke assertions**

Extend `scripts/desktop-open-project-built-smoke.ts` to:

1. drop the same external file twice and assert two Canvas nodes reference one digest/blob;
2. drag one Project file and assert the blob count does not change;
3. create text and assert `Notes/*.md` exists while document JSON lacks its body;
4. run a generation fixture and assert `Generated/*` remains after Canvas-add failure;
5. edit/delete/recreate a Project file and observe ready/missing/ready without revision rewrite;
6. seed an old document and assert the app reports unsupported schema without changing bytes.

The smoke may use Main-owned fixture setup, but renderer-visible results must never contain native paths.

- [ ] **Step 6: Synchronize canonical documentation**

Re-read the final implementation and update only concrete names that differ from the design. Keep the following decisions unchanged: no Resource Catalog, no migration/dual read, no automatic move tracking, no URL importer, one seven-day GC grace, `gc.json` below assets, and partial success that retains user-visible files.

- [ ] **Step 7: Run the complete repository gate**

Run:

```bash
git diff --check
bun check
```

Expected: `git diff --check` exits 0; `bun check` completes lint, typecheck, all tests, package boundaries, pack smoke, Desktop build, and open-project smoke with exit 0.

- [ ] **Step 8: Request final two-stage review**

Use `superpowers:requesting-code-review` for:

1. spec compliance against `docs/superpowers/specs/2026-07-21-project-asset-single-source-design.md`;
2. code quality/security review covering symlinks, Windows paths, mutex scope, revision conflicts, IPC scope, and crash windows.

Resolve every P1/P2 finding and rerun `bun check` after the final change.

- [ ] **Step 9: Commit the completed cutover**

```bash
git add AGENTS.md docs packages scripts
git commit -m "feat(canvas): complete project asset cutover"
```

## Final acceptance checklist

- [ ] Project files and directories persist only normalized typed references.
- [ ] Project files are never copied merely because they enter Canvas.
- [ ] Equal external bytes share one immutable `blobs/<sha256>` file.
- [ ] Original external paths are absent from Canvas and Project metadata.
- [ ] Text and generation outputs publish under `Notes/` and `Generated/` before Canvas commit.
- [ ] Canvas JSON contains no text body, binary, runtime URL, or native path.
- [ ] File edits invalidate runtime state; delete/recreate transitions through missing without rewriting references.
- [ ] Managed asset GC performs a fresh all-Canvas scan, saves timing state, then deletes only seven-day orphans.
- [ ] Unsupported old documents remain byte-for-byte unchanged and outside GC roots.
- [ ] No Resource Catalog, asset rollback WAL, move WAL, automatic rename inference, or URL importer exists.
- [ ] `bun check` exits 0 on the final tree.
