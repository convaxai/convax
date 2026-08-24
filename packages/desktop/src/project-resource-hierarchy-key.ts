import { requireProjectResourceReference } from "@convax/project/canvas"

/**
 * Disposable watcher key shared by Main's Project-owned sidecar projector and
 * Renderer event matching. Durable Canvas resource identity remains pathless.
 */
export function projectResourceHierarchySegments(path: string): readonly string[] {
  const reference = requireProjectResourceReference({ kind: "project-file", path })
  if (reference.kind !== "project-file") throw new Error("Project resource hierarchy path is invalid")
  return Object.freeze(reference.path.split("/").map((segment) => segment.normalize("NFC").toLowerCase()))
}
