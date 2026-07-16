import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { NodeProjectManager } from "../project-manager"
import { NodeProjectCanvasManager } from "./project-canvas-manager"

let temporaryRoot = ""
let projectRoot = ""
let projects: NodeProjectManager
let projectId = ""

beforeEach(async () => {
  temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "convax-catalog-"))
  projectRoot = path.join(temporaryRoot, "project")
  await fs.mkdir(projectRoot)
  projects = new NodeProjectManager({ registryFile: path.join(temporaryRoot, "user-data", "projects.json") })
  projectId = (await projects.addProject(projectRoot)).id
})

afterEach(async () => {
  await fs.rm(temporaryRoot, { force: true, recursive: true })
})

describe("NodeProjectCanvasManager", () => {
  test("persists catalog CRUD without storing Workbench selection", async () => {
    const manager = new NodeProjectCanvasManager(projects, projects, { now: () => 10 })
    expect(await manager.getCanvasCatalog({ projectId })).toMatchObject({ projectId })
    const created = await manager.createCanvas({ name: "Storyboard", projectId })
    await manager.renameCanvas({ canvasId: created.canvas.id, name: "Final", projectId })

    const reloaded = new NodeProjectCanvasManager(projects, projects)
    expect(await reloaded.getCanvasCatalog({ projectId })).toMatchObject({
      canvases: [{ name: "Canvas 1" }, { id: created.canvas.id, name: "Final" }],
    })
    expect(JSON.parse(await fs.readFile(path.join(projectRoot, ".convax", "project.json"), "utf8"))).toEqual({
      projectId,
      schemaVersion: "convax.project/1",
    })
    const storedCatalog = JSON.parse(await fs.readFile(path.join(projectRoot, ".convax", "canvases", "catalog.json"), "utf8"))
    expect(storedCatalog).toMatchObject({ schemaVersion: "convax.project-canvases/2" })
    expect(storedCatalog).not.toHaveProperty("activeCanvasId")

    await reloaded.deleteCanvas({ canvasId: created.canvas.id, projectId })
    expect((await reloaded.getCanvasCatalog({ projectId })).canvases.map((canvas) => canvas.id)).toEqual(["canvas-main"])
    await expect(fs.access(path.join(projectRoot, ".convax", "canvases", created.canvas.id))).rejects.toThrow()
  })

  test("reads a legacy catalog and writes the selection-free schema on the next mutation", async () => {
    await new NodeProjectCanvasManager(projects, projects).getCanvasCatalog({ projectId })
    const catalogPath = path.join(projectRoot, ".convax", "canvases", "catalog.json")
    const legacy = JSON.parse(await fs.readFile(catalogPath, "utf8"))
    await fs.writeFile(catalogPath, `${JSON.stringify({
      activeCanvasId: "canvas-main",
      canvases: legacy.canvases,
      schemaVersion: "convax.canvas-workspace/1",
    }, null, 2)}\n`)

    const manager = new NodeProjectCanvasManager(projects, projects)
    const migratedCatalog = await manager.getCanvasCatalog({ projectId })
    expect(migratedCatalog).not.toHaveProperty("activeCanvasId")
    expect(migratedCatalog.workbenchPreferenceMigration).toEqual({ canvasId: "canvas-main" })
    await manager.createCanvas({ projectId })

    const migrated = JSON.parse(await fs.readFile(catalogPath, "utf8"))
    expect(migrated.schemaVersion).toBe("convax.project-canvases/2")
    expect(migrated).not.toHaveProperty("activeCanvasId")
    expect(await new NodeProjectCanvasManager(projects, projects).getCanvasCatalog({ projectId }))
      .not.toHaveProperty("workbenchPreferenceMigration")
  })

  test("rejects a canvases directory replaced by a symlink between catalog read and create", async () => {
    await new NodeProjectCanvasManager(projects, projects).getCanvasCatalog({ projectId })
    const canvasesRoot = path.join(projectRoot, ".convax", "canvases")
    const outsideRoot = path.join(temporaryRoot, "outside-create")
    await fs.mkdir(outsideRoot)
    let armed = true
    const attackingStorage = {
      readPrivateTextFile: async (input: Parameters<typeof projects.readPrivateTextFile>[0]) => {
        const snapshot = await projects.readPrivateTextFile(input)
        if (armed) {
          armed = false
          await fs.rm(canvasesRoot, { recursive: true })
          await fs.symlink(outsideRoot, canvasesRoot)
        }
        return snapshot
      },
      writePrivateTextFile: (input: Parameters<typeof projects.writePrivateTextFile>[0]) => projects.writePrivateTextFile(input),
    }

    await expect(new NodeProjectCanvasManager(attackingStorage, projects).createCanvas({ projectId }))
      .rejects.toThrow("Symbolic links")
    expect(await fs.readdir(outsideRoot)).toEqual([])
  })

  test("rejects a symlinked delete tombstone without moving Canvas storage outside the project", async () => {
    const manager = new NodeProjectCanvasManager(projects, projects)
    await manager.getCanvasCatalog({ projectId })
    const created = await manager.createCanvas({ name: "Keep", projectId })
    const outsideRoot = path.join(temporaryRoot, "outside-delete")
    await fs.mkdir(outsideRoot)
    await fs.symlink(outsideRoot, path.join(projectRoot, ".convax", "deleted-canvases"))

    await expect(manager.deleteCanvas({ canvasId: created.canvas.id, projectId })).rejects.toThrow("Symbolic links")
    expect(await fs.stat(path.join(projectRoot, ".convax", "canvases", created.canvas.id)).then((stat) => stat.isDirectory())).toBe(true)
    expect(await fs.readdir(outsideRoot)).toEqual([])
  })

  test("rejects a symlinked legacy manifest during Canvas migration", async () => {
    const outsideRoot = path.join(temporaryRoot, "outside-migration")
    const outsideManifest = path.join(outsideRoot, "project.json")
    await fs.mkdir(outsideRoot)
    await fs.writeFile(outsideManifest, JSON.stringify({
      canvases: [{ createdAt: 1, id: "canvas-main", name: "External", updatedAt: 2 }],
      projectId,
      schemaVersion: "convax.project/1",
    }))
    const projectManifest = path.join(projectRoot, ".convax", "project.json")
    await fs.rm(projectManifest)
    await fs.symlink(outsideManifest, projectManifest)

    await expect(new NodeProjectCanvasManager(projects, projects).getCanvasCatalog({ projectId }))
      .rejects.toThrow("Symbolic links")
    expect(await fs.readFile(outsideManifest, "utf8")).toContain('"External"')
    await expect(fs.access(path.join(projectRoot, ".convax", "canvases"))).rejects.toThrow()
  })

  test("migrates legacy Canvas catalog and document as a Project Canvas concern", async () => {
    const legacyRoot = path.join(temporaryRoot, "legacy")
    await fs.mkdir(path.join(legacyRoot, ".convax"), { recursive: true })
    const legacyId = "project_legacy"
    await fs.writeFile(path.join(legacyRoot, ".convax", "project.json"), JSON.stringify({
      activeCanvasId: "canvas-secondary",
      canvases: [
        { createdAt: 1, id: "canvas-main", name: "Legacy", updatedAt: 2 },
        { createdAt: 2, id: "canvas-secondary", name: "Secondary", updatedAt: 3 },
      ],
      projectId: legacyId,
      schemaVersion: "convax.project/1",
    }))
    await fs.writeFile(path.join(legacyRoot, ".convax", "canvas.json"), "legacy bytes")
    const project = await projects.addProject(legacyRoot)
    const manager = new NodeProjectCanvasManager(projects, projects)

    const catalog = await manager.getCanvasCatalog({ projectId: project.id })
    expect(catalog.canvases[0]?.name).toBe("Legacy")
    expect(catalog.workbenchPreferenceMigration).toEqual({ canvasId: "canvas-secondary" })
    expect(await fs.readFile(path.join(legacyRoot, ".convax", "canvases", "canvas-main", "document.json"), "utf8")).toBe("legacy bytes")
    expect(JSON.parse(await fs.readFile(path.join(legacyRoot, ".convax", "project.json"), "utf8"))).toEqual({
      projectId: legacyId,
      schemaVersion: "convax.project/1",
    })
  })
})
