import { describe, expect, mock, test } from "bun:test"
import type { ProjectChangeEvent } from "@convax/project-files"
import { encodeBase64url, parseId128 } from "@convax/collaboration"
import type { CanvasResourceHydrateStaleInput } from "../desktop-protocol"
import {
  hydrateCanvasResourceTargetsInBatches,
  subscribeMountedCanvasResourceInvalidation,
} from "./project-resource-invalidation"

describe("mounted Canvas resource invalidation", () => {
  test("routes every path-bearing event through the Canvas-owned exact hierarchy index", () => {
    let listener: ((event: ProjectChangeEvent) => void) | undefined
    const onDidChange = mock((next: (event: ProjectChangeEvent) => void) => {
      listener = next
      return () => {
        listener = undefined
      }
    })
    const invalidateResources = mock(async (_nodeIds?: readonly string[]) => undefined)
    const invalidateResourcesAtHierarchyKey = mock(async (_key: { readonly segments: readonly string[] }) => undefined)
    const editor = { invalidateResources, invalidateResourcesAtHierarchyKey }
    let projectId: string | null = "project-one"
    const dispose = subscribeMountedCanvasResourceInvalidation({
      currentEditor: () => editor,
      currentProjectId: () => projectId,
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
    expect(invalidateResources).not.toHaveBeenCalled()
    expect(invalidateResourcesAtHierarchyKey.mock.calls).toEqual([
      [{ segments: ["notes", "a.md"] }],
      [{ segments: ["notes"] }],
      [{ segments: ["notes2"] }],
      [{ segments: ["assets", "posters", "hero.png"] }],
      [{ segments: ["notes", "missing.md"] }],
    ])
    dispose()
    expect(listener).toBeUndefined()
  })

  test("keeps only pathless changes as explicit full invalidations", () => {
    let listener: ((event: ProjectChangeEvent) => void) | undefined
    const invalidateResources = mock(async (_nodeIds?: readonly string[]) => undefined)
    const invalidateResourcesAtHierarchyKey = mock(async (_key: { readonly segments: readonly string[] }) => undefined)
    const dispose = subscribeMountedCanvasResourceInvalidation({
      currentEditor: () => ({ invalidateResources, invalidateResourcesAtHierarchyKey }),
      currentProjectId: () => "project-one",
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

    expect(invalidateResources).toHaveBeenCalledTimes(1)
    expect(invalidateResources.mock.calls).toEqual([[]])
    expect(invalidateResourcesAtHierarchyKey).toHaveBeenCalledWith({ segments: ["notes", "external.md"] })
    dispose()
  })

  test("matches watcher paths across NFC and case-insensitive Project path forms", () => {
    let listener: ((event: ProjectChangeEvent) => void) | undefined
    const invalidateResources = mock(async (_nodeIds?: readonly string[]) => undefined)
    const invalidateResourcesAtHierarchyKey = mock(async (_key: { readonly segments: readonly string[] }) => undefined)
    const dispose = subscribeMountedCanvasResourceInvalidation({
      currentEditor: () => ({ invalidateResources, invalidateResourcesAtHierarchyKey }),
      currentProjectId: () => "project-one",
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

    expect(invalidateResources).not.toHaveBeenCalled()
    expect(invalidateResourcesAtHierarchyKey).toHaveBeenCalledWith({ segments: ["notes", "café.md"] })
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
      client: { hydrateStale },
      ref: { canvasId: "canvas-main", scopeId: "project-one" },
      sessionId,
      signal: new AbortController().signal,
      targets,
    })

    expect(hydrateStale).toHaveBeenCalledTimes(2)
    expect(hydrateStale.mock.calls.map(([input]) => input.targets.length)).toEqual([256, 1])
    expect(patches).toHaveLength(257)
  })
})
