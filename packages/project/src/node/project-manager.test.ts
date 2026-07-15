import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { NodeProjectManager } from "./project-manager"

let temporaryRoot = ""
let projectRoot = ""
let manager: NodeProjectManager
let projectId = ""

beforeEach(async () => {
  temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "convax-project-"))
  projectRoot = path.join(temporaryRoot, "workspace")
  await fs.mkdir(projectRoot)
  manager = new NodeProjectManager({ registryFile: path.join(temporaryRoot, "state", "projects.json") })
  projectId = (await manager.addProject(projectRoot)).id
})

afterEach(async () => {
  await fs.rm(temporaryRoot, { force: true, recursive: true })
})

describe("NodeProjectManager registry", () => {
  test("creates project-local metadata and keeps the active canvas in user data", async () => {
    const workspace = await manager.getWorkspace({ projectId })
    expect(workspace.canvases).toHaveLength(1)
    expect(workspace.activeCanvasId).toBe("canvas-main")

    const manifest = JSON.parse(await fs.readFile(path.join(projectRoot, ".convax", "project.json"), "utf8"))
    expect(manifest).toMatchObject({
      canvases: [{ id: "canvas-main", name: "Canvas 1" }],
      projectId,
      schemaVersion: "convax.project/1",
    })
    expect(manifest.activeCanvasId).toBeUndefined()
    expect(await fs.stat(path.join(projectRoot, ".convax", "assets")).then((stat) => stat.isDirectory())).toBe(true)

    const registry = JSON.parse(await fs.readFile(path.join(temporaryRoot, "state", "projects.json"), "utf8"))
    expect(registry.projects[0]?.activeCanvasId).toBe("canvas-main")
  })

  test("persists, renames, and forgets projects without deleting their folders", async () => {
    expect((await manager.listProjects()).map((project) => project.id)).toEqual([projectId])
    expect((await manager.renameProject(projectId, "Launch board")).name).toBe("Launch board")

    const reloaded = new NodeProjectManager({ registryFile: path.join(temporaryRoot, "state", "projects.json") })
    expect((await reloaded.listProjects())[0]?.name).toBe("Launch board")
    expect(await reloaded.forgetProject(projectId)).toBe(true)
    expect(await reloaded.listProjects()).toEqual([])
    expect(await fs.stat(projectRoot).then((stat) => stat.isDirectory())).toBe(true)
  })

  test("creates a project under an explicitly selected parent", async () => {
    const created = await manager.createProject({ name: "Fresh project", parentPath: temporaryRoot })
    expect(created.name).toBe("Fresh project")
    expect(await fs.stat(path.join(temporaryRoot, "Fresh project")).then((stat) => stat.isDirectory())).toBe(true)
    expect(await fs.stat(path.join(temporaryRoot, "Fresh project", ".convax", "project.json")).then((stat) => stat.isFile())).toBe(true)
  })

  test("keeps the manifest project id when a project folder is moved and rebound", async () => {
    const movedRoot = path.join(temporaryRoot, "workspace-moved")
    await fs.rename(projectRoot, movedRoot)
    const rebound = await manager.addProject(movedRoot)
    expect(rebound.id).toBe(projectId)
    expect((await manager.listProjects()).map((project) => [project.id, project.rootPath])).toEqual([[projectId, await fs.realpath(movedRoot)]])
  })

  test("rejects a copied project id without replacing the original binding", async () => {
    const copiedRoot = path.join(temporaryRoot, "workspace-copy")
    await fs.cp(projectRoot, copiedRoot, { recursive: true })

    await expect(manager.addProject(copiedRoot)).rejects.toThrow("already bound")
    expect((await manager.listProjects()).map((project) => [project.id, project.rootPath])).toEqual([[projectId, await fs.realpath(projectRoot)]])
  })

  test("lists other bindings without eagerly parsing a corrupt project manifest", async () => {
    await fs.writeFile(path.join(projectRoot, ".convax", "project.json"), "not json")

    expect((await manager.listProjects()).map((project) => project.id)).toEqual([projectId])
    await expect(manager.getWorkspace({ projectId })).rejects.toThrow()
  })

  test("migrates the legacy single canvas document without changing its bytes", async () => {
    const legacyRoot = path.join(temporaryRoot, "legacy")
    await fs.mkdir(path.join(legacyRoot, ".convax"), { recursive: true })
    const legacyContents = "{\n  \"legacy\": true,\n  \"unicode\": \"画布\"\n}\n"
    await fs.writeFile(path.join(legacyRoot, ".convax", "canvas.json"), legacyContents)

    const legacyProject = await manager.addProject(legacyRoot)
    const workspace = await manager.getWorkspace({ projectId: legacyProject.id })
    expect(workspace.canvases.map((canvas) => canvas.id)).toEqual(["canvas-main"])
    expect(await manager.readCanvasDocument({ canvasId: "canvas-main", projectId: legacyProject.id })).toMatchObject({
      content: legacyContents,
      exists: true,
    })
    await expect(fs.access(path.join(legacyRoot, ".convax", "canvas.json"))).rejects.toThrow()
  })
})

describe("NodeProjectManager canvases", () => {
  test("creates, activates, renames, persists, and deletes project canvases", async () => {
    const original = await manager.getWorkspace({ projectId })
    const created = await manager.createCanvas({ name: "Storyboard / v2", projectId })
    expect(created.workspace.activeCanvasId).toBe(original.activeCanvasId)
    expect(created.canvas.id).toMatch(/^canvas_[a-z0-9]+$/)
    expect(created.canvas.name).toBe("Storyboard / v2")

    await manager.writeCanvasDocument({ canvasId: created.canvas.id, content: "canvas document", projectId })
    expect(await manager.readCanvasDocument({ canvasId: created.canvas.id, projectId })).toMatchObject({
      content: "canvas document",
      exists: true,
      path: `.convax/canvases/${created.canvas.id}/document.json`,
    })
    expect((await manager.activateCanvas({ canvasId: created.canvas.id, projectId })).activeCanvasId).toBe(created.canvas.id)
    expect((await manager.renameCanvas({ canvasId: created.canvas.id, name: "Final board", projectId })).canvas.name).toBe("Final board")

    const reloaded = new NodeProjectManager({ registryFile: path.join(temporaryRoot, "state", "projects.json") })
    expect((await reloaded.getWorkspace({ projectId })).activeCanvasId).toBe(created.canvas.id)
    const manifest = JSON.parse(await fs.readFile(path.join(projectRoot, ".convax", "project.json"), "utf8"))
    expect(manifest.activeCanvasId).toBeUndefined()
    expect(manifest.canvases.map((canvas: { name: string }) => canvas.name)).toEqual(["Canvas 1", "Final board"])

    const deleted = await reloaded.deleteCanvas({ canvasId: created.canvas.id, projectId })
    expect(deleted.workspace.activeCanvasId).toBe("canvas-main")
    expect(deleted.deleted).toBe(true)
    await expect(reloaded.readCanvasDocument({ canvasId: created.canvas.id, projectId })).rejects.toThrow("not found")
    await expect(reloaded.deleteCanvas({ canvasId: "canvas-main", projectId })).rejects.toThrow("last canvas")
  })

  test("validates canvas ownership and rejects ids that could become paths", async () => {
    await expect(manager.readCanvasDocument({ canvasId: "canvas_missing", projectId })).rejects.toThrow("not found")
    await expect(manager.writeCanvasDocument({ canvasId: "../outside", content: "bad", projectId })).rejects.toThrow("Invalid canvas id")
    await expect(manager.activateCanvas({ canvasId: "CANVAS_MAIN", projectId })).rejects.toThrow("Invalid canvas id")
  })
})

describe("NodeProjectManager files", () => {
  test("reads text previews with a hard 64 KiB upper bound", async () => {
    const content = "a".repeat(70 * 1024)
    await fs.writeFile(path.join(projectRoot, "large.txt"), content)
    const preview = await manager.readTextPreview({ path: "large.txt", projectId })
    expect(Buffer.byteLength(preview.content, "utf8")).toBe(64 * 1024)
    expect(preview.truncated).toBe(true)

    await fs.writeFile(path.join(projectRoot, "exact.txt"), "b".repeat(64 * 1024))
    expect(await manager.readTextPreview({ path: "exact.txt", projectId })).toMatchObject({ truncated: false })
  })

  test("uses portable names and case-folded collision checks on every platform", async () => {
    for (const name of ["bad:name.txt", "bad?.txt", "trail.", "trail ", "NUL", "con.txt", "control\u0001.txt"]) {
      await expect(manager.createEntry({ kind: "file", name, projectId })).rejects.toThrow("Invalid")
    }

    await manager.createEntry({ content: "one", kind: "file", name: "Report.txt", projectId })
    await expect(manager.createEntry({ content: "two", kind: "file", name: "report.TXT", projectId })).rejects.toThrow("already exists")
    await manager.renameEntry({ name: "report.txt", path: "Report.txt", projectId })
    expect(await fs.readFile(path.join(projectRoot, "report.txt"), "utf8")).toBe("one")

    await manager.createEntry({ content: "allowed", kind: "file", name: "..draft", projectId })
    expect((await manager.readTextPreview({ path: "..draft", projectId })).content).toBe("allowed")

    await fs.writeFile(path.join(projectRoot, "safe.txt:stream"), "hidden")
    await expect(manager.readFile({ path: "safe.txt:stream", projectId })).rejects.toThrow("Invalid")
    await expect(manager.readTextPreview({ path: "safe.txt:stream", projectId })).rejects.toThrow("Invalid")
    await expect(manager.resolveEntryPath({ path: "safe.txt:stream", projectId })).rejects.toThrow("Invalid")
  })

  test("preflights case-folded batch targets and nested imported names", async () => {
    await manager.createEntry({ kind: "directory", name: "first", projectId })
    await manager.createEntry({ kind: "directory", name: "second", projectId })
    await manager.createEntry({ kind: "directory", name: "target", projectId })
    await manager.createEntry({ content: "one", kind: "file", name: "Report.txt", parentPath: "first", projectId })
    await manager.createEntry({ content: "two", kind: "file", name: "report.TXT", parentPath: "second", projectId })
    await expect(manager.moveEntries({ destinationPath: "target", paths: ["first/Report.txt", "second/report.TXT"], projectId })).rejects.toThrow("already exists")
    expect(await fs.readFile(path.join(projectRoot, "first", "Report.txt"), "utf8")).toBe("one")
    expect(await fs.readFile(path.join(projectRoot, "second", "report.TXT"), "utf8")).toBe("two")

    const source = path.join(temporaryRoot, "portable-source")
    await fs.mkdir(source)
    await fs.writeFile(path.join(source, "bad:name.txt"), "bad")
    await expect(manager.importEntries({ projectId, sourcePaths: [source] })).rejects.toThrow("Invalid")
  })

  test("hides ignored and managed directories case-insensitively", async () => {
    await fs.mkdir(path.join(projectRoot, ".GIT"))
    await fs.mkdir(path.join(projectRoot, "NODE_MODULES"))
    await fs.writeFile(path.join(projectRoot, "visible.txt"), "visible")
    expect((await manager.listDirectory({ projectId })).entries.map((entry) => entry.name)).toEqual(["visible.txt"])
  })

  test("supports lazy listing, create, rename, move, text persistence, preview, and delete", async () => {
    await manager.createEntry({ kind: "directory", name: "assets", projectId })
    await manager.createEntry({ content: "hello", kind: "file", name: "brief.txt", projectId })
    expect((await manager.listDirectory({ projectId })).entries.map((entry) => entry.name)).toEqual(["assets", "brief.txt"])

    const renamed = await manager.renameEntry({ name: "notes.txt", path: "brief.txt", projectId })
    expect(renamed.targetPaths).toEqual(["notes.txt"])
    const moved = await manager.moveEntries({ destinationPath: "assets", paths: ["notes.txt"], projectId })
    expect(moved.targetPaths).toEqual(["assets/notes.txt"])
    expect(await manager.readTextFile({ path: "assets/notes.txt", projectId })).toMatchObject({ content: "hello", exists: true })

    await manager.writeTextFile({ content: "updated", createParents: true, path: "assets/canvas.json", projectId })
    expect(await manager.readTextFile({ path: "assets/canvas.json", projectId })).toMatchObject({ content: "updated", exists: true })
    expect((await manager.listDirectory({ projectId })).entries.map((entry) => entry.name)).toEqual(["assets"])
    expect((await manager.readFile({ path: "assets/notes.txt", projectId })).dataUrl).toBe("data:text/plain;base64,aGVsbG8=")

    await manager.deleteEntries({ paths: ["assets"], projectId })
    expect((await manager.listDirectory({ projectId })).entries).toEqual([])
  })

  test("protects the Convax namespace while allowing managed canvas assets", async () => {
    await manager.createEntry({ content: "visible", kind: "file", name: "visible.txt", projectId })
    await expect(manager.createEntry({ kind: "file", name: ".convax", projectId })).rejects.toThrow("reserved")
    await expect(manager.createEntry({ kind: "file", name: ".CONVAX", projectId })).rejects.toThrow("reserved")
    await expect(manager.renameEntry({ name: ".convax", path: "visible.txt", projectId })).rejects.toThrow("reserved")

    const externalReserved = path.join(temporaryRoot, ".convax")
    await fs.writeFile(externalReserved, "external")
    await expect(manager.importEntries({ projectId, sourcePaths: [externalReserved] })).rejects.toThrow("reserved")

    await manager.writeTextFile({ content: "", createParents: true, path: ".convax/assets/.keep", projectId })
    await expect(manager.writeTextFile({ content: "corrupt", path: ".convax/project.json", projectId })).rejects.toThrow("reserved")
    const copied = await manager.copyEntries({ destinationPath: ".convax/assets", paths: ["visible.txt"], projectId })
    expect(copied.targetPaths).toEqual([".convax/assets/visible.txt"])
    await expect(manager.deleteEntries({ paths: [".convax"], projectId })).rejects.toThrow("reserved")
    await expect(manager.moveEntries({ destinationPath: ".convax/assets", paths: ["visible.txt"], projectId })).rejects.toThrow("reserved")
    expect(await fs.readFile(path.join(projectRoot, ".convax", "assets", "visible.txt"), "utf8")).toBe("visible")
  })

  test("imports files and directories with stable collision names", async () => {
    const sourceRoot = path.join(temporaryRoot, "imports")
    await fs.mkdir(path.join(sourceRoot, "nested"), { recursive: true })
    await fs.writeFile(path.join(sourceRoot, "note.txt"), "first")
    await fs.writeFile(path.join(sourceRoot, "nested", "data.json"), "{}")

    const first = await manager.importEntries({ projectId, sourcePaths: [path.join(sourceRoot, "note.txt"), path.join(sourceRoot, "nested")] })
    const second = await manager.importEntries({ projectId, sourcePaths: [path.join(sourceRoot, "note.txt")] })
    expect(first.targetPaths).toEqual(["note.txt", "nested"])
    expect(second.targetPaths).toEqual(["note copy.txt"])
    expect(await fs.readFile(path.join(projectRoot, "nested", "data.json"), "utf8")).toBe("{}")

    await manager.createEntry({ kind: "directory", name: "managed", projectId })
    const copied = await manager.copyEntries({ destinationPath: "managed", paths: ["note.txt", "nested"], projectId })
    expect(copied.targetPaths).toEqual(["managed/note.txt", "managed/nested"])
    expect(await fs.readFile(path.join(projectRoot, "managed", "nested", "data.json"), "utf8")).toBe("{}")
  })

  test("rejects traversal, symlink escapes, and moving a directory into itself", async () => {
    const outside = path.join(temporaryRoot, "outside")
    await fs.mkdir(outside)
    await fs.writeFile(path.join(outside, "secret.txt"), "secret")
    await fs.symlink(outside, path.join(projectRoot, "linked"))
    await manager.createEntry({ kind: "directory", name: "parent", projectId })
    await manager.createEntry({ kind: "directory", name: "child", parentPath: "parent", projectId })

    await expect(manager.listDirectory({ path: "../outside", projectId })).rejects.toThrow("escapes")
    await expect(manager.readFile({ path: "linked/secret.txt", projectId })).rejects.toThrow()
    await expect(manager.moveEntries({ destinationPath: "parent/child", paths: ["parent"], projectId })).rejects.toThrow("into itself")
    expect((await manager.listDirectory({ projectId })).entries.some((entry) => entry.name === "linked")).toBe(false)
  })

  test("never follows a final symlink for writes or deletes", async () => {
    const outsideFile = path.join(temporaryRoot, "outside.txt")
    await fs.writeFile(outsideFile, "safe")
    await fs.symlink(outsideFile, path.join(projectRoot, "alias.txt"))

    await expect(manager.writeTextFile({ content: "overwritten", path: "alias.txt", projectId })).rejects.toThrow("Symbolic links")
    await expect(manager.deleteEntries({ paths: ["alias.txt"], projectId })).rejects.toThrow("Symbolic links")
    expect(await fs.readFile(outsideFile, "utf8")).toBe("safe")
    expect(await fs.lstat(path.join(projectRoot, "alias.txt")).then((stat) => stat.isSymbolicLink())).toBe(true)
  })

  test("treats a registered project root replaced by a symlink as unavailable", async () => {
    const originalRoot = `${projectRoot}-original`
    const outsideRoot = path.join(temporaryRoot, "redirected")
    await fs.mkdir(outsideRoot)
    await fs.writeFile(path.join(outsideRoot, "secret.txt"), "secret")
    await fs.rename(projectRoot, originalRoot)
    await fs.symlink(outsideRoot, projectRoot)

    expect((await manager.listProjects())[0]?.missing).toBe(true)
    await expect(manager.listDirectory({ projectId })).rejects.toThrow("unavailable")
    await expect(manager.deleteEntries({ paths: ["secret.txt"], projectId })).rejects.toThrow("unavailable")
    expect(await fs.readFile(path.join(outsideRoot, "secret.txt"), "utf8")).toBe("secret")
  })

  test("preflights a batch move before mutating and rejects recursive imports", async () => {
    await manager.createEntry({ kind: "directory", name: "first", projectId })
    await manager.createEntry({ kind: "directory", name: "second", projectId })
    await manager.createEntry({ content: "one", kind: "file", name: "same.txt", parentPath: "first", projectId })
    await manager.createEntry({ content: "two", kind: "file", name: "same.txt", parentPath: "second", projectId })

    await expect(manager.moveEntries({ paths: ["first/same.txt", "second/same.txt"], projectId })).rejects.toThrow("already exists")
    expect(await fs.readFile(path.join(projectRoot, "first", "same.txt"), "utf8")).toBe("one")
    expect(await fs.readFile(path.join(projectRoot, "second", "same.txt"), "utf8")).toBe("two")
    await expect(manager.importEntries({ projectId, sourcePaths: [projectRoot] })).rejects.toThrow("into itself")
    await expect(manager.importEntries({ projectId, sourcePaths: [""] })).rejects.toThrow("empty")
  })

  test("serializes concurrent namespace mutations without overwriting a target", async () => {
    await manager.createEntry({ content: "a", kind: "file", name: "a.txt", projectId })
    await manager.createEntry({ content: "b", kind: "file", name: "b.txt", projectId })
    const results = await Promise.allSettled([
      manager.renameEntry({ name: "target.txt", path: "a.txt", projectId }),
      manager.renameEntry({ name: "target.txt", path: "b.txt", projectId }),
    ])
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1)
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1)
    const remaining = await manager.listDirectory({ projectId })
    expect(remaining.entries.map((entry) => entry.name).sort()).toEqual(["b.txt", "target.txt"])
  })

  test("serializes text writes so the latest requested write wins", async () => {
    const first = manager.writeTextFile({ content: "first", createParents: true, path: "state/canvas.json", projectId })
    const second = manager.writeTextFile({ content: "second", createParents: true, path: "state/canvas.json", projectId })
    const concurrentRead = manager.readTextFile({ path: "state/canvas.json", projectId })
    await Promise.all([first, second])
    expect(await fs.readFile(path.join(projectRoot, "state", "canvas.json"), "utf8")).toBe("second")
    expect((await concurrentRead).content).toBe("second")
  })

  test("flushes pending project writes before forgetting the registry entry", async () => {
    const write = manager.writeTextFile({ content: "latest", createParents: true, path: "state/canvas.json", projectId })
    const forget = manager.forgetProject(projectId)
    await expect(write).resolves.toMatchObject({ operation: "write" })
    await expect(forget).resolves.toBe(true)
    expect(await fs.readFile(path.join(projectRoot, "state", "canvas.json"), "utf8")).toBe("latest")
  })

  test("reports an in-flight save failure without retaining handled errors forever", async () => {
    const limited = new NodeProjectManager({
      maxTextFileBytes: 3,
      registryFile: path.join(temporaryRoot, "state", "projects.json"),
    })
    const failedWrite = limited.writeTextFile({ content: "too large", createParents: true, path: "state/canvas.json", projectId })
    const observedWrite = failedWrite.catch((error: unknown) => error)
    const concurrentFlush = limited.flushPendingWrites()
    const observedFlush = concurrentFlush.catch((error: unknown) => error)
    expect(String(await observedWrite)).toContain("too large")
    expect(String(await observedFlush)).toContain("could not be saved")
    await expect(limited.flushPendingWrites()).resolves.toBeUndefined()
    await expect(limited.writeTextFile({ content: "ok", createParents: true, path: "state/canvas.json", projectId })).resolves.toMatchObject({ operation: "write" })
    await expect(limited.flushPendingWrites()).resolves.toBeUndefined()
  })
})
