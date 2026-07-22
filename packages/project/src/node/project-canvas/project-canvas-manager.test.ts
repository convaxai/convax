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
  test("strict maintenance rejects a missing catalog without creating or migrating state", async () => {
    const manager = new NodeProjectCanvasManager(projects, projects)

    await expect(manager.runCurrentCatalogMaintenance({ projectId }, async () => undefined)).rejects.toThrow(
      /catalog.*missing|missing.*catalog/i,
    )

    await expect(fs.access(path.join(projectRoot, ".convax", "canvases"))).rejects.toThrow()
    expect(JSON.parse(await fs.readFile(path.join(projectRoot, ".convax", "project.json"), "utf8"))).toEqual({
      projectId,
      schemaVersion: "convax.project/1",
    })
  })

  test("strict maintenance rejects legacy catalog bytes without migrating or touching them", async () => {
    await new NodeProjectCanvasManager(projects, projects).getCanvasCatalog({ projectId })
    const catalogPath = path.join(projectRoot, ".convax", "canvases", "catalog.json")
    const current = JSON.parse(await fs.readFile(catalogPath, "utf8"))
    const legacy = `${JSON.stringify(
      {
        activeCanvasId: "canvas-main",
        canvases: current.canvases,
        schemaVersion: "convax.canvas-workspace/1",
      },
      null,
      2,
    )}\n`
    await fs.writeFile(catalogPath, legacy)
    const before = await fs.stat(catalogPath)

    await expect(
      new NodeProjectCanvasManager(projects, projects).runCurrentCatalogMaintenance(
        { projectId },
        async () => undefined,
      ),
    ).rejects.toThrow(/schema.*supported|current.*catalog/i)

    expect(await fs.readFile(catalogPath, "utf8")).toBe(legacy)
    expect((await fs.stat(catalogPath)).mtimeMs).toBe(before.mtimeMs)
  })

  test("holds the Project queue through delete rollback before maintenance observes the catalog root", async () => {
    const bootstrap = new NodeProjectCanvasManager(projects, projects)
    await bootstrap.getCanvasCatalog({ projectId })
    const created = await bootstrap.createCanvas({ name: "Rollback", projectId })
    const entered = deferred()
    const release = deferred()
    const failingStorage = {
      readPrivateTextFile: (input: Parameters<typeof projects.readPrivateTextFile>[0]) =>
        projects.readPrivateTextFile(input),
      async writePrivateTextFile(input: Parameters<typeof projects.writePrivateTextFile>[0]) {
        entered.resolve()
        await release.promise
        throw new Error(`injected catalog publication failure: ${input.path}`)
      },
    }
    const manager = new NodeProjectCanvasManager(failingStorage, projects)

    const deleting = manager.deleteCanvas({ canvasId: created.canvas.id, projectId })
    await entered.promise
    let maintenanceEntered = false
    const maintenance = manager.runCurrentCatalogMaintenance({ projectId }, async (catalog) => {
      maintenanceEntered = true
      expect(catalog.canvases.some((canvas) => canvas.id === created.canvas.id)).toBe(true)
      expect((await fs.lstat(path.join(projectRoot, ".convax", "canvases", created.canvas.id))).isDirectory()).toBe(
        true,
      )
    })
    await Promise.resolve()
    expect(maintenanceEntered).toBe(false)

    release.resolve()
    await expect(deleting).rejects.toThrow("injected catalog publication failure")
    await maintenance
    expect(maintenanceEntered).toBe(true)
  })

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
    const storedCatalog = JSON.parse(
      await fs.readFile(path.join(projectRoot, ".convax", "canvases", "catalog.json"), "utf8"),
    )
    expect(storedCatalog).toMatchObject({ schemaVersion: "convax.project-canvases/2" })
    expect(storedCatalog).not.toHaveProperty("activeCanvasId")

    await reloaded.deleteCanvas({ canvasId: created.canvas.id, projectId })
    expect((await reloaded.getCanvasCatalog({ projectId })).canvases.map((canvas) => canvas.id)).toEqual([
      "canvas-main",
    ])
    await expect(fs.access(path.join(projectRoot, ".convax", "canvases", created.canvas.id))).rejects.toThrow()
  })

  test.each([
    [
      "legacy schema",
      (canvases: unknown) => ({
        activeCanvasId: "canvas-main",
        canvases,
        schemaVersion: "convax.canvas-workspace/1",
      }),
    ],
    [
      "extra root field",
      (canvases: unknown) => ({
        activeCanvasId: "canvas-main",
        canvases,
        schemaVersion: "convax.project-canvases/2",
      }),
    ],
    [
      "extra Canvas field",
      (canvases: Array<Record<string, unknown>>) => ({
        canvases: canvases.map((canvas) => ({ ...canvas, selected: false })),
        schemaVersion: "convax.project-canvases/2",
      }),
    ],
  ])("rejects a non-exact current catalog (%s) without changing any legacy bytes", async (_label, legacyCatalog) => {
    await new NodeProjectCanvasManager(projects, projects).getCanvasCatalog({ projectId })
    const catalogPath = path.join(projectRoot, ".convax", "canvases", "catalog.json")
    const current = JSON.parse(await fs.readFile(catalogPath, "utf8"))
    const catalogBytes = `${JSON.stringify(legacyCatalog(current.canvases), null, 2)}\n`
    const projectPath = path.join(projectRoot, ".convax", "project.json")
    const projectBytes = `${JSON.stringify(
      {
        activeCanvasId: "canvas-main",
        canvases: current.canvases,
        projectId,
        schemaVersion: "convax.project/1",
      },
      null,
      2,
    )}\n`
    const legacyDocumentPath = path.join(projectRoot, ".convax", "canvas.json")
    const legacyDocumentBytes = "legacy Canvas bytes\n"
    await Promise.all([
      fs.writeFile(catalogPath, catalogBytes),
      fs.writeFile(projectPath, projectBytes),
      fs.writeFile(legacyDocumentPath, legacyDocumentBytes),
    ])

    const manager = new NodeProjectCanvasManager(projects, projects)
    await expect(manager.getCanvasCatalog({ projectId })).rejects.toThrow(/catalog.*supported|unsupported.*catalog/i)
    expect(await fs.readFile(catalogPath, "utf8")).toBe(catalogBytes)
    expect(await fs.readFile(projectPath, "utf8")).toBe(projectBytes)
    expect(await fs.readFile(legacyDocumentPath, "utf8")).toBe(legacyDocumentBytes)
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
      writePrivateTextFile: (input: Parameters<typeof projects.writePrivateTextFile>[0]) =>
        projects.writePrivateTextFile(input),
    }

    await expect(new NodeProjectCanvasManager(attackingStorage, projects).createCanvas({ projectId })).rejects.toThrow(
      "Symbolic links",
    )
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
    expect(
      await fs
        .stat(path.join(projectRoot, ".convax", "canvases", created.canvas.id))
        .then((stat) => stat.isDirectory()),
    ).toBe(true)
    expect(await fs.readdir(outsideRoot)).toEqual([])
  })

  test("creates only a new current catalog and default Canvas when legacy Project state exists", async () => {
    const projectPath = path.join(projectRoot, ".convax", "project.json")
    const legacyDocumentPath = path.join(projectRoot, ".convax", "canvas.json")
    const projectBytes = "unsupported legacy Project manifest bytes\n"
    const legacyDocumentBytes = "legacy Canvas document bytes\n"
    await fs.writeFile(projectPath, projectBytes)
    await fs.writeFile(legacyDocumentPath, legacyDocumentBytes)
    const manager = new NodeProjectCanvasManager(projects, projects, { now: () => 10 })

    expect(await manager.getCanvasCatalog({ projectId })).toEqual({
      canvases: [{ createdAt: 10, id: "canvas-main", name: "Canvas 1", updatedAt: 10 }],
      projectId,
    })
    expect(await fs.readFile(projectPath, "utf8")).toBe(projectBytes)
    expect(await fs.readFile(legacyDocumentPath, "utf8")).toBe(legacyDocumentBytes)
    await expect(
      fs.access(path.join(projectRoot, ".convax", "canvases", "canvas-main", "document.json")),
    ).rejects.toThrow()
  })
})

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}
