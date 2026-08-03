import { describe, expect, mock, test } from "bun:test"
import { createFolderNode, createCanvasDocument } from "@convax/canvas"
import { projectResourceReferenceKey } from "@convax/project/canvas"
import type { ProjectChangeEvent, ProjectDirectoryListing } from "@convax/project-files"
import { createProjectFolderBrowseService } from "./project-folder-browse-service"

function folderDocument() {
  return createCanvasDocument({
    id: "canvas-1",
    nodes: [
      createFolderNode({
        id: "folder-node",
        position: { x: 0, y: 0 },
        resource: {
          id: "folder",
          kind: "folder",
          metadata: {
            [projectResourceReferenceKey]: { kind: "project-directory", path: "Design" },
          },
          name: "Design",
          state: { status: "ready" },
        },
      }),
    ],
  })
}

function listing(path: string, entries: ProjectDirectoryListing["entries"]): ProjectDirectoryListing {
  return { entries, path, projectId: "project-1" }
}

describe("Project folder browse service", () => {
  test("projects the authoritative folder and nested directory as bounded opaque listings", async () => {
    const listDirectory = mock(async ({ path = "" }: { path?: string; projectId: string }) =>
      path === "Design"
        ? listing("Design", [
            {
              kind: "directory",
              modifiedAt: 1,
              name: "References",
              parentPath: "Design",
              path: "Design/References",
            },
            {
              kind: "file",
              modifiedAt: 1,
              name: "brief.pdf",
              parentPath: "Design",
              path: "Design/brief.pdf",
              size: 42,
            },
          ])
        : listing("Design/References", []),
    )
    const service = createProjectFolderBrowseService({
      currentScope: () => ({ canvasId: "canvas-1", projectId: "project-1" }),
      flush: async () => folderDocument(),
      projectFiles: { listDirectory, onDidChange: () => () => undefined },
    })

    await expect(
      service.list({
        context: { documentId: "canvas-1", selectedNodeIds: [], source: "desktop-main" },
        ownerNodeId: "folder-node",
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({
      entries: [
        { id: "Design/References", kind: "folder", label: "References" },
        { id: "Design/brief.pdf", kind: "file", label: "brief.pdf" },
      ],
      path: [{ id: "Design", label: "Design" }],
      totalCount: 2,
      truncated: false,
    })
    await expect(
      service.list({
        context: { documentId: "canvas-1", selectedNodeIds: [], source: "desktop-main" },
        directoryId: "Design/References",
        ownerNodeId: "folder-node",
        signal: new AbortController().signal,
      }),
    ).resolves.toMatchObject({
      path: [
        { id: "Design", label: "Design" },
        { id: "Design/References", label: "References" },
      ],
    })
  })

  test("rejects navigation outside the authoritative directory before reading Project Files", async () => {
    const listDirectory = mock(async () => listing("Other", []))
    const service = createProjectFolderBrowseService({
      currentScope: () => ({ canvasId: "canvas-1", projectId: "project-1" }),
      flush: async () => folderDocument(),
      projectFiles: { listDirectory, onDidChange: () => () => undefined },
    })

    await expect(
      service.list({
        context: { documentId: "canvas-1", selectedNodeIds: [], source: "desktop-main" },
        directoryId: "Other",
        ownerNodeId: "folder-node",
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow("outside the owning folder")
    expect(listDirectory).not.toHaveBeenCalled()
  })

  test("fails a stale directory response after the active Canvas changes", async () => {
    let resolveListing!: (value: ProjectDirectoryListing) => void
    const pending = new Promise<ProjectDirectoryListing>((resolve) => {
      resolveListing = resolve
    })
    let scope = { canvasId: "canvas-1", projectId: "project-1" }
    const service = createProjectFolderBrowseService({
      currentScope: () => scope,
      flush: async () => folderDocument(),
      projectFiles: { listDirectory: async () => pending, onDidChange: () => () => undefined },
    })
    const request = service.list({
      context: { documentId: "canvas-1", selectedNodeIds: [], source: "desktop-main" },
      ownerNodeId: "folder-node",
      signal: new AbortController().signal,
    })

    scope = { canvasId: "canvas-2", projectId: "project-1" }
    resolveListing(listing("Design", []))
    await expect(request).rejects.toThrow("active Canvas changed")
  })

  test("cancels after an in-flight Project Files listing without publishing entries", async () => {
    let resolveListing!: (value: ProjectDirectoryListing) => void
    const pending = new Promise<ProjectDirectoryListing>((resolve) => {
      resolveListing = resolve
    })
    const service = createProjectFolderBrowseService({
      currentScope: () => ({ canvasId: "canvas-1", projectId: "project-1" }),
      flush: async () => folderDocument(),
      projectFiles: { listDirectory: async () => pending, onDidChange: () => () => undefined },
    })
    const controller = new AbortController()
    const request = service.list({
      context: { documentId: "canvas-1", selectedNodeIds: [], source: "desktop-main" },
      ownerNodeId: "folder-node",
      signal: controller.signal,
    })

    await Promise.resolve()
    controller.abort(new DOMException("Canceled", "AbortError"))
    resolveListing(listing("Design", []))
    await expect(request).rejects.toMatchObject({ name: "AbortError" })
  })

  test("invalidates only for the active Project", () => {
    let onChange: ((event: ProjectChangeEvent) => void) | undefined
    const listener = mock(() => undefined)
    const service = createProjectFolderBrowseService({
      currentScope: () => ({ canvasId: "canvas-1", projectId: "project-1" }),
      flush: async () => folderDocument(),
      projectFiles: {
        listDirectory: async () => listing("Design", []),
        onDidChange(callback) {
          onChange = callback
          return () => undefined
        },
      },
    })
    service.subscribe?.(listener)

    onChange?.({ kind: "filesystem", projectId: "project-2" })
    onChange?.({ kind: "filesystem", path: "Design/brief.pdf", projectId: "project-1" })
    expect(listener).toHaveBeenCalledTimes(1)
  })
})
