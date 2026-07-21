import { describe, expect, mock, test } from "bun:test"
import type { ProjectChangeEvent } from "@convax/project-files"
import { subscribeMountedCanvasResourceInvalidation } from "./project-resource-invalidation"

describe("mounted Canvas resource invalidation", () => {
  test("subscribes once and invalidates the current Project editor regardless of the event path", () => {
    let listener: ((event: ProjectChangeEvent) => void) | undefined
    const onDidChange = mock((next: (event: ProjectChangeEvent) => void) => {
      listener = next
      return () => {
        listener = undefined
      }
    })
    const invalidateResources = mock(async () => undefined)
    const relinkResource = mock(async () => undefined)
    const editor = { invalidateResources, relinkResource }
    let projectId: string | null = "project-one"
    const dispose = subscribeMountedCanvasResourceInvalidation({
      currentEditor: () => editor,
      currentProjectId: () => projectId,
      projectFiles: { onDidChange },
    })

    listener?.({ kind: "filesystem", path: "Notes/a.md", projectId: "project-one" })
    listener?.({ kind: "filesystem", projectId: "project-one" })
    listener?.({ kind: "mutation", path: "renamed/b.md", projectId: "project-one" })
    listener?.({ kind: "filesystem", path: "other.md", projectId: "project-two" })
    projectId = "project-two"
    listener?.({ kind: "filesystem", path: "late.md", projectId: "project-one" })

    expect(onDidChange).toHaveBeenCalledTimes(1)
    expect(invalidateResources).toHaveBeenCalledTimes(3)
    expect(relinkResource).not.toHaveBeenCalled()
    dispose()
    expect(listener).toBeUndefined()
  })
})
