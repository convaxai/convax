import { createCanvasDocument, createGroupNode, createTextNode } from "@convax/canvas/core"
import type { ProjectEntry, ProjectEntryKind } from "@convax/project-files"
import { describe, expect, test } from "bun:test"
import {
  buildAgentCanvasReferenceTree,
  buildAgentProjectReferenceTree,
  buildAgentReferenceStatusById,
  filterAgentReferenceTree,
  moveAgentReferenceTreeActive,
} from "./agent-composer-tree"

function entry(path: string, kind: ProjectEntryKind, parentPath: string): ProjectEntry {
  return {
    kind,
    modifiedAt: 1,
    name: path.split("/").at(-1) ?? path,
    parentPath,
    path,
    ...(kind === "file" ? { size: 10 } : {}),
  }
}

function projectRows() {
  return buildAgentProjectReferenceTree({
    expandedPaths: new Set(["Assets"]),
    listings: new Map([
      ["", [entry("Assets", "directory", ""), entry("README.md", "file", "")]],
      ["Assets", [entry("Assets/cover.png", "file", "Assets")]],
    ]),
  })
}

describe("Agent composer reference trees", () => {
  test("projects only loaded directory descendants and preserves portable paths", () => {
    const rows = projectRows()

    expect(rows.map(({ depth, id, resource }) => ({ depth, id, resource }))).toEqual([
      {
        depth: 0,
        id: "project:directory:Assets",
        resource: { kind: "directory", name: "Assets", path: "Assets" },
      },
      {
        depth: 1,
        id: "project:file:Assets/cover.png",
        resource: { kind: "file", name: "cover.png", path: "Assets/cover.png" },
      },
      {
        depth: 0,
        id: "project:file:README.md",
        resource: { kind: "file", name: "README.md", path: "README.md" },
      },
    ])
  })

  test("builds Canvas group hierarchy from parentId without changing catalog order", () => {
    const group = createGroupNode({
      height: 300,
      id: "group",
      label: "Story",
      position: { x: 0, y: 0 },
      width: 400,
    })
    const child = {
      ...createTextNode({
        id: "child",
        label: "Title",
        metadata: {},
        position: { x: 10, y: 10 },
        resourceState: { status: "ready" },
      }),
      parentId: group.id,
    }
    const document = createCanvasDocument({ id: "canvas-a", nodes: [group, child] })
    const rows = buildAgentCanvasReferenceTree({
      activeCanvasId: "canvas-a",
      canvases: [
        { createdAt: 1, id: "canvas-a", name: "A", updatedAt: 1 },
        { createdAt: 2, id: "canvas-b", name: "B", updatedAt: 2 },
      ],
      documents: new Map([["canvas-a", document]]),
      expandedIds: new Set(["canvas:canvas-a", "canvas-node:canvas-a:group"]),
    })

    expect(rows.map(({ active, depth, id }) => ({ active, depth, id }))).toEqual([
      { active: true, depth: 0, id: "canvas:canvas-a" },
      { active: undefined, depth: 1, id: "canvas-node:canvas-a:group" },
      { active: undefined, depth: 2, id: "canvas-node:canvas-a:child" },
      { active: false, depth: 0, id: "canvas:canvas-b" },
    ])
  })

  test("search keeps loaded ancestors and keyboard movement uses visible rows", () => {
    const filtered = filterAgentReferenceTree(projectRows(), "cover")

    expect(filtered.map((row) => row.id)).toEqual(["project:directory:Assets", "project:file:Assets/cover.png"])
    expect(moveAgentReferenceTreeActive(filtered, filtered[0]!.id, "down")).toBe(filtered[1]!.id)
    expect(moveAgentReferenceTreeActive(filtered, filtered[1]!.id, "down")).toBe(filtered[0]!.id)
    expect(moveAgentReferenceTreeActive(filtered, filtered[1]!.id, "parent")).toBe(filtered[0]!.id)
    expect(moveAgentReferenceTreeActive(filtered, filtered[0]!.id, "child")).toBe(filtered[1]!.id)
  })

  test("maps branch-scoped inventory state without treating root loading as a tree row", () => {
    expect(
      buildAgentReferenceStatusById(
        new Set(["project:", "project:Assets", "canvas:canvas-a"]),
        new Map([
          ["project:Notes", "Notes unavailable"],
          ["canvas:canvas-b", "Canvas unavailable"],
        ]),
      ),
    ).toEqual(
      new Map([
        ["project:directory:Assets", { loading: true }],
        ["canvas:canvas-a", { loading: true }],
        ["project:directory:Notes", { error: "Notes unavailable" }],
        ["canvas:canvas-b", { error: "Canvas unavailable" }],
      ]),
    )
  })
})
