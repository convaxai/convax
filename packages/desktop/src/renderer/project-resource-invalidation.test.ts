import { describe, expect, mock, test } from "bun:test"
import { createCanvasDocument, createFolderNode, createTextNode } from "@convax/canvas/core"
import type { ProjectChangeEvent } from "@convax/project-files"
import { encodeBase64url, parseId128 } from "@convax/collaboration"
import type { CanvasResourceHydrateStaleInput } from "../desktop-protocol"
import {
  hydrateCanvasResourceTargetsInBatches,
  subscribeMountedCanvasResourceInvalidation,
} from "./project-resource-invalidation"

describe("mounted Canvas resource invalidation", () => {
  test("invalidates only live Canvas nodes with an exact current Project resource path", () => {
    let listener: ((event: ProjectChangeEvent) => void) | undefined
    const onDidChange = mock((next: (event: ProjectChangeEvent) => void) => {
      listener = next
      return () => {
        listener = undefined
      }
    })
    const invalidateResources = mock(async (_nodeIds?: readonly string[]) => undefined)
    const editor = { invalidateResources }
    const projection = createCanvasDocument({
      id: "canvas-main",
      nodes: [
        createTextNode({
          id: "note-a",
          metadata: { convaxProjectResource: { kind: "project-file", path: "Notes/a.md" } },
          position: { x: 0, y: 0 },
          resourceState: { status: "ready" },
        }),
        createTextNode({
          id: "note-a-copy",
          metadata: { convaxProjectResource: { kind: "project-file", path: "Notes/a.md" } },
          position: { x: 10, y: 0 },
          resourceState: { status: "ready" },
        }),
        createTextNode({
          id: "note-b",
          metadata: { convaxProjectResource: { kind: "project-file", path: "Notes/b.md" } },
          position: { x: 20, y: 0 },
          resourceState: { status: "ready" },
        }),
        createFolderNode({
          id: "assets",
          position: { x: 30, y: 0 },
          resource: {
            id: "assets",
            kind: "folder",
            metadata: { convaxProjectResource: { kind: "project-directory", path: "Assets" } },
            name: "Assets",
            state: { status: "ready" },
          },
        }),
      ],
    })
    let projectId: string | null = "project-one"
    const dispose = subscribeMountedCanvasResourceInvalidation({
      currentEditor: () => editor,
      currentProjectId: () => projectId,
      currentSession: () => ({ getProjection: () => projection }),
      projectFiles: { onDidChange },
    })

    listener?.({ kind: "filesystem", path: "Notes/a.md", projectId: "project-one" })
    listener?.({ kind: "filesystem", path: "Notes", projectId: "project-one" })
    listener?.({ kind: "filesystem", path: "Notes2", projectId: "project-one" })
    listener?.({ kind: "filesystem", path: "Assets/posters/hero.png", projectId: "project-one" })
    listener?.({ kind: "mutation", path: "Notes/missing.md", projectId: "project-one" })
    listener?.({ kind: "filesystem", path: "other.md", projectId: "project-two" })
    projectId = "project-two"
    listener?.({ kind: "filesystem", path: "late.md", projectId: "project-one" })

    expect(onDidChange).toHaveBeenCalledTimes(1)
    expect(invalidateResources).toHaveBeenCalledTimes(3)
    expect(invalidateResources.mock.calls).toEqual([
      [["note-a", "note-a-copy"]],
      [["note-a", "note-a-copy", "note-b"]],
      [["assets"]],
    ])
    dispose()
    expect(listener).toBeUndefined()
  })

  test("keeps pathless changes and missing session projections as explicit full invalidations", () => {
    let listener: ((event: ProjectChangeEvent) => void) | undefined
    const invalidateResources = mock(async (_nodeIds?: readonly string[]) => undefined)
    const dispose = subscribeMountedCanvasResourceInvalidation({
      currentEditor: () => ({ invalidateResources }),
      currentProjectId: () => "project-one",
      currentSession: () => null,
      projectFiles: {
        onDidChange(next) {
          listener = next
          return () => {
            listener = undefined
          }
        },
      },
    })

    listener?.({ kind: "filesystem", projectId: "project-one" })
    listener?.({ kind: "filesystem", path: "Notes/external.md", projectId: "project-one" })

    expect(invalidateResources).toHaveBeenCalledTimes(2)
    expect(invalidateResources.mock.calls).toEqual([[], []])
    dispose()
  })

  test("matches watcher paths across NFC and case-insensitive Project path forms", () => {
    let listener: ((event: ProjectChangeEvent) => void) | undefined
    const invalidateResources = mock(async (_nodeIds?: readonly string[]) => undefined)
    const projection = createCanvasDocument({
      id: "canvas-main",
      nodes: [
        createTextNode({
          id: "unicode-note",
          metadata: { convaxProjectResource: { kind: "project-file", path: "Notes/Café.md" } },
          position: { x: 0, y: 0 },
          resourceState: { status: "ready" },
        }),
      ],
    })
    const dispose = subscribeMountedCanvasResourceInvalidation({
      currentEditor: () => ({ invalidateResources }),
      currentProjectId: () => "project-one",
      currentSession: () => ({ getProjection: () => projection }),
      projectFiles: {
        onDidChange(next) {
          listener = next
          return () => {
            listener = undefined
          }
        },
      },
    })

    listener?.({ kind: "filesystem", path: "notes/Cafe\u0301.md", projectId: "project-one" })

    expect(invalidateResources).toHaveBeenCalledWith(["unicode-note"])
    dispose()
  })

  test("hydrates more than one bounded target batch without widening an IPC request", async () => {
    const sessionId = parseId128(encodeBase64url(new Uint8Array(16).fill(3)))
    const targets = Array.from({ length: 257 }, (_, index) => {
      const suffix = encodeBase64url(new Uint8Array(32).fill(index % 251))
      return {
        entity: { id: `n_${suffix}`, incarnation: `ni_${suffix}`, kind: "node" as const },
        nodeId: `n_${suffix}_${index}`,
      }
    }).map((target) => ({ ...target, entity: { ...target.entity, id: target.nodeId } }))
    const hydrateStale = mock(async ({ targets: batch }: CanvasResourceHydrateStaleInput) => ({
      patches: batch.map(({ nodeId }) => ({ nodeId, state: { status: "ready" as const } })),
    }))

    const patches = await hydrateCanvasResourceTargetsInBatches({
      canvasId: "canvas-main",
      client: { hydrateStale },
      sessionId,
      signal: new AbortController().signal,
      targets,
    })

    expect(hydrateStale).toHaveBeenCalledTimes(2)
    expect(hydrateStale.mock.calls.map(([input]) => input.targets.length)).toEqual([256, 1])
    expect(patches).toHaveLength(257)
  })
})
