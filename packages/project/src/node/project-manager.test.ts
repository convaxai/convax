import { createHash } from "node:crypto"
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { ProjectTextFileConflictError } from "@convax/project-files"
import { UnsupportedProjectDataError } from "./collaboration/portable-cutover"
import { NodeProjectManager } from "./project-manager"
import { copyPath } from "./project-manager-helpers"
import { ProjectPrivateStorageConflictError } from "./project-private-storage"

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
  test("creates project identity metadata without plugin-owned catalog state", async () => {
    const manifest = JSON.parse(await fs.readFile(path.join(projectRoot, ".convax", "project.json"), "utf8"))
    expect(manifest).toEqual({
      projectId,
      schemaVersion: "convax.project/1",
    })
    expect(await fs.stat(path.join(projectRoot, ".convax", "assets")).then((stat) => stat.isDirectory())).toBe(true)

    const registry = JSON.parse(await fs.readFile(path.join(temporaryRoot, "state", "projects.json"), "utf8"))
    expect(registry.projects[0]).not.toHaveProperty("activeCanvasId")
  })

  test("restores missing private storage for the same registered Project without touching ordinary files", async () => {
    await fs.writeFile(path.join(projectRoot, "keep.md"), "ordinary project data")
    await fs.rm(path.join(projectRoot, ".convax"), { force: true, recursive: true })

    const touched = await manager.touchProject(projectId)

    expect(touched.id).toBe(projectId)
    expect(JSON.parse(await fs.readFile(path.join(projectRoot, ".convax", "project.json"), "utf8"))).toEqual({
      projectId,
      schemaVersion: "convax.project/1",
    })
    expect(await fs.stat(path.join(projectRoot, ".convax", "assets")).then((stat) => stat.isDirectory())).toBe(true)
    expect(await fs.readFile(path.join(projectRoot, "keep.md"), "utf8")).toBe("ordinary project data")
  })

  test("repairs private storage only for the canonical durable registry binding", async () => {
    const otherRoot = path.join(temporaryRoot, "other-workspace")
    await fs.mkdir(otherRoot)
    await fs.rm(path.join(projectRoot, ".convax"), { force: true, recursive: true })

    await expect(
      manager.ensureRegisteredProjectPrivateStorage({ projectId, projectRoot: otherRoot }),
    ).rejects.toThrow("differs from its durable registry binding")
    await expect(fs.access(path.join(projectRoot, ".convax"))).rejects.toThrow()
    await expect(fs.access(path.join(otherRoot, ".convax"))).rejects.toThrow()
  })

  test("rejects a replaced manifest while touching a registered Project", async () => {
    const registryFile = path.join(temporaryRoot, "state", "projects.json")
    const registryBefore = await fs.readFile(registryFile)
    await fs.writeFile(
      path.join(projectRoot, ".convax", "project.json"),
      JSON.stringify({ projectId: "project_replaced", schemaVersion: "convax.project/1" }),
    )

    await expect(manager.touchProject(projectId)).rejects.toThrow("belongs to a different project")
    expect(await fs.readFile(registryFile)).toEqual(registryBefore)
  })

  test("rejects a symlinked private storage root without writing outside the project", async () => {
    const unsafeRoot = path.join(temporaryRoot, "unsafe-project")
    const outsideRoot = path.join(temporaryRoot, "outside-private-storage")
    await fs.mkdir(unsafeRoot)
    await fs.mkdir(outsideRoot)
    await fs.symlink(outsideRoot, path.join(unsafeRoot, ".convax"))

    await expect(manager.addProject(unsafeRoot)).rejects.toThrow("symbolic link")
    expect(await fs.readdir(outsideRoot)).toEqual([])
  })

  test("registers an unsupported JSON Canvas Project only as an explicit recovery candidate", async () => {
    const legacyRoot = path.join(temporaryRoot, "legacy-project")
    const legacyCatalog = path.join(legacyRoot, ".convax", "canvases", "catalog.json")
    const legacyDocument = path.join(legacyRoot, ".convax", "canvases", "canvas-main", "document.json")
    await fs.mkdir(path.dirname(legacyDocument), { recursive: true })
    await fs.writeFile(
      path.join(legacyRoot, ".convax", "project.json"),
      JSON.stringify({ projectId: "project_legacy", schemaVersion: "convax.project/1" }),
    )
    await fs.writeFile(legacyCatalog, "legacy-catalog")
    await fs.writeFile(legacyDocument, "legacy-document")
    await fs.writeFile(path.join(legacyRoot, "keep.md"), "ordinary")
    const candidate = await manager.addProject(legacyRoot)
    expect(candidate).toMatchObject({
      id: "project_legacy",
      recovery: {
        unsupportedPaths: [".convax/canvases/canvas-main/document.json", ".convax/canvases/catalog.json"],
        status: "unsupported-project-data",
      },
    })

    expect(await fs.readFile(legacyCatalog, "utf8")).toBe("legacy-catalog")
    expect(await fs.readFile(legacyDocument, "utf8")).toBe("legacy-document")
    expect(await fs.readFile(path.join(legacyRoot, "keep.md"), "utf8")).toBe("ordinary")
    expect((await manager.listProjects()).find((project) => project.id === "project_legacy")?.recovery?.status)
      .toBe("unsupported-project-data")
  })

  test("rejects an unsupported registered Project when it is opened again", async () => {
    const legacyCatalog = path.join(projectRoot, ".convax", "canvases", "catalog.json")
    const legacyDocument = path.join(projectRoot, ".convax", "canvases", "canvas-main", "document.json")
    await fs.mkdir(path.dirname(legacyDocument), { recursive: true })
    await fs.writeFile(legacyCatalog, "legacy-catalog")
    await fs.writeFile(legacyDocument, "legacy-document")
    await fs.writeFile(path.join(projectRoot, "keep.md"), "ordinary")
    const registryBefore = await fs.readFile(path.join(temporaryRoot, "state", "projects.json"))

    await expect(manager.touchProject(projectId)).rejects.toBeInstanceOf(UnsupportedProjectDataError)

    expect(await fs.readFile(legacyCatalog, "utf8")).toBe("legacy-catalog")
    expect(await fs.readFile(legacyDocument, "utf8")).toBe("legacy-document")
    expect(await fs.readFile(path.join(projectRoot, "keep.md"), "utf8")).toBe("ordinary")
    expect(await fs.readFile(path.join(temporaryRoot, "state", "projects.json"))).toEqual(registryBefore)
  })

  test("persists, renames, and forgets projects without deleting their folders", async () => {
    expect((await manager.listProjects()).map((project) => project.id)).toEqual([projectId])
    expect((await manager.renameProject(projectId, "Launch board")).name).toBe("Launch board")
    await manager.writePrivateTextFile({
      namespace: "plugin-data",
      path: "items/main/document.json",
      content: "saved plugin data",
      createParents: true,
      projectId,
    })

    const reloaded = new NodeProjectManager({ registryFile: path.join(temporaryRoot, "state", "projects.json") })
    expect((await reloaded.listProjects())[0]?.name).toBe("Launch board")
    expect(await reloaded.forgetProject(projectId)).toBe(true)
    expect(await reloaded.listProjects()).toEqual([])
    expect(await fs.stat(projectRoot).then((stat) => stat.isDirectory())).toBe(true)

    const rebound = await reloaded.addProject(projectRoot)
    expect(rebound.id).toBe(projectId)
    expect(
      await reloaded.readPrivateTextFile({ namespace: "plugin-data", path: "items/main/document.json", projectId }),
    ).toMatchObject({
      content: "saved plugin data",
      exists: true,
    })
  })

  test("atomically records a strictly ordered last-opened project only while its root is available", async () => {
    const stateRoot = path.join(temporaryRoot, "touch-state")
    const firstRoot = path.join(temporaryRoot, "touch-first")
    const secondRoot = path.join(temporaryRoot, "touch-second")
    await fs.mkdir(firstRoot)
    await fs.mkdir(secondRoot)
    const clock = 100
    const touchManager = new NodeProjectManager({
      now: () => clock,
      registryFile: path.join(stateRoot, "projects.json"),
    })
    const first = await touchManager.addProject(firstRoot)
    const second = await touchManager.addProject(secondRoot)
    expect(first.lastOpenedAt).toBe(0)
    expect(second.lastOpenedAt).toBeLessThan(first.lastOpenedAt)

    const firstTouched = await touchManager.touchProject(first.id)
    const secondTouched = await touchManager.touchProject(second.id)

    expect(firstTouched.lastOpenedAt).toBeGreaterThanOrEqual(clock)
    expect(secondTouched.lastOpenedAt).toBeGreaterThan(firstTouched.lastOpenedAt)
    expect((await touchManager.listProjects()).map((project) => project.id)).toEqual([second.id, first.id])
    expect((await touchManager.addProject(firstRoot)).lastOpenedAt).toBe(firstTouched.lastOpenedAt)
    expect((await touchManager.listProjects()).map((project) => project.id)).toEqual([second.id, first.id])

    await fs.rename(firstRoot, `${firstRoot}-missing`)
    const registryFile = path.join(stateRoot, "projects.json")
    const beforeRejectedTouch = await fs.readFile(registryFile, "utf8")
    await expect(touchManager.touchProject(first.id)).rejects.toThrow("Project folder is unavailable")
    expect(await fs.readFile(registryFile, "utf8")).toBe(beforeRejectedTouch)
    await expect(touchManager.touchProject("project_unknown")).rejects.toThrow("Project was not found")
    expect(await fs.readFile(registryFile, "utf8")).toBe(beforeRejectedTouch)
  })

  test("creates a project under a host-owned workspace that does not exist yet", async () => {
    const workspaceRoot = path.join(temporaryRoot, "Documents", "Convax")
    const created = await manager.createProject({ name: "Fresh project", parentPath: workspaceRoot })
    expect(created.name).toBe("Fresh project")
    expect(await fs.stat(path.join(workspaceRoot, "Fresh project")).then((stat) => stat.isDirectory())).toBe(true)
    expect(await fs.stat(path.join(workspaceRoot, "Fresh project", ".convax", "project.json")).then((stat) => stat.isFile())).toBe(true)
    await expect(manager.createProject({ name: "Fresh project", parentPath: workspaceRoot })).rejects.toThrow("Project already exists")
  })

  test("does not adopt or overwrite an existing workspace directory", async () => {
    const workspaceRoot = path.join(temporaryRoot, "Documents", "Convax")
    const existingRoot = path.join(workspaceRoot, "Storyboard")
    await fs.mkdir(existingRoot, { recursive: true })
    await fs.writeFile(path.join(existingRoot, "keep.txt"), "existing")

    await expect(manager.createProject({ name: "storyboard", parentPath: workspaceRoot })).rejects.toThrow("Project already exists")
    expect(await fs.readFile(path.join(existingRoot, "keep.txt"), "utf8")).toBe("existing")
  })

  test("allows only one concurrent creation for portable-equivalent project names", async () => {
    const workspaceRoot = path.join(temporaryRoot, "Documents", "Convax")
    const results = await Promise.allSettled([
      manager.createProject({ name: "Concurrent", parentPath: workspaceRoot }),
      manager.createProject({ name: "concurrent", parentPath: workspaceRoot }),
    ])

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1)
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1)
    expect((await manager.listProjects()).filter((project) => project.name.toLowerCase() === "concurrent")).toHaveLength(1)
    expect((await fs.readdir(workspaceRoot)).filter((name) => name.toLowerCase() === "concurrent")).toHaveLength(1)
  })

  test("keeps the manifest project id when a project folder is moved and rebound", async () => {
    const movedRoot = path.join(temporaryRoot, "workspace-moved")
    await fs.rename(projectRoot, movedRoot)
    const rebound = await manager.addProject(movedRoot)
    expect(rebound.id).toBe(projectId)
    expect((await manager.listProjects()).map((project) => [project.id, project.rootPath])).toEqual([
      [projectId, await fs.realpath(movedRoot)],
    ])
  })

  test("rejects a copied project id without replacing the original binding", async () => {
    const copiedRoot = path.join(temporaryRoot, "workspace-copy")
    await fs.cp(projectRoot, copiedRoot, { recursive: true })

    await expect(manager.addProject(copiedRoot)).rejects.toThrow("already bound")
    expect((await manager.listProjects()).map((project) => [project.id, project.rootPath])).toEqual([
      [projectId, await fs.realpath(projectRoot)],
    ])
  })

  test("lists other bindings without eagerly parsing a corrupt project manifest", async () => {
    await fs.writeFile(path.join(projectRoot, ".convax", "project.json"), "not json")

    expect((await manager.listProjects()).map((project) => project.id)).toEqual([projectId])
    await expect(manager.addProject(projectRoot)).rejects.toThrow()
  })
})

describe("NodeProjectManager private storage", () => {
  test("stores opaque namespaced files with content versions", async () => {
    const ref = { namespace: "plugin-data", path: "items/main/document.json", projectId }
    expect(await manager.readPrivateTextFile(ref)).toEqual({ content: "", exists: false, version: null })

    const first = await manager.writePrivateTextFile({
      ...ref,
      content: "first",
      createParents: true,
      expectedVersion: null,
    })
    expect(first.version).toHaveLength(64)
    expect(await manager.readPrivateTextFile(ref)).toEqual({ content: "first", exists: true, version: first.version })

    await expect(
      manager.writePrivateTextFile({ ...ref, content: "stale", expectedVersion: null }),
    ).rejects.toBeInstanceOf(ProjectPrivateStorageConflictError)
    const second = await manager.writePrivateTextFile({ ...ref, content: "second", expectedVersion: first.version })
    expect(second.version).not.toBe(first.version)
    expect(await manager.removePrivatePath({ namespace: "plugin-data", path: "items", projectId })).toEqual({
      removed: true,
    })
    expect(await manager.readPrivateTextFile(ref)).toMatchObject({ exists: false })
  })

  test("rejects non-portable namespaces and private paths", async () => {
    await expect(
      manager.readPrivateTextFile({ namespace: "Plugin", path: "document.json", projectId }),
    ).rejects.toThrow("Invalid project private namespace")
    await expect(
      manager.readPrivateTextFile({ namespace: "plugin-data", path: "../document.json", projectId }),
    ).rejects.toThrow("escapes its root")
    await expect(
      manager.readPrivateTextFile({ namespace: "plugin-data", path: "C:\\document.json", projectId }),
    ).rejects.toThrow("Invalid project-relative path")
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
    for (const name of [
      "bad:name.txt",
      "bad?.txt",
      "trail.",
      "trail ",
      "NUL",
      "con.txt",
      "COM¹.txt",
      "lpt³",
      "control\u0001.txt",
    ]) {
      await expect(manager.createEntry({ kind: "file", name, projectId })).rejects.toThrow("Invalid")
    }

    await manager.createEntry({ content: "one", kind: "file", name: "Report.txt", projectId })
    await expect(manager.createEntry({ content: "two", kind: "file", name: "report.TXT", projectId })).rejects.toThrow(
      "already exists",
    )
    await manager.renameEntry({ name: "report.txt", path: "Report.txt", projectId })
    expect(await fs.readFile(path.join(projectRoot, "report.txt"), "utf8")).toBe("one")

    await manager.createEntry({ content: "allowed", kind: "file", name: "..draft", projectId })
    expect((await manager.readTextPreview({ path: "..draft", projectId })).content).toBe("allowed")

    await fs.writeFile(path.join(projectRoot, "safe.txt:stream"), "hidden")
    await expect(manager.readFile({ path: "safe.txt:stream", projectId })).rejects.toThrow("Invalid")
    await expect(manager.readTextPreview({ path: "safe.txt:stream", projectId })).rejects.toThrow("Invalid")
    await expect(manager.resolveEntryPath({ path: "safe.txt:stream", projectId })).rejects.toThrow("Invalid")
  })

  test("preflights case-folded batch targets and nested reserved imported names", async () => {
    await manager.createEntry({ kind: "directory", name: "first", projectId })
    await manager.createEntry({ kind: "directory", name: "second", projectId })
    await manager.createEntry({ kind: "directory", name: "target", projectId })
    await manager.createEntry({ content: "one", kind: "file", name: "Report.txt", parentPath: "first", projectId })
    await manager.createEntry({ content: "two", kind: "file", name: "report.TXT", parentPath: "second", projectId })
    await expect(
      manager.moveEntries({ destinationPath: "target", paths: ["first/Report.txt", "second/report.TXT"], projectId }),
    ).rejects.toThrow("already exists")
    expect(await fs.readFile(path.join(projectRoot, "first", "Report.txt"), "utf8")).toBe("one")
    expect(await fs.readFile(path.join(projectRoot, "second", "report.TXT"), "utf8")).toBe("two")

    const source = path.join(temporaryRoot, "portable-source")
    await fs.mkdir(source)
    await fs.writeFile(path.join(source, ".CONVAX"), "reserved")
    await expect(manager.importEntries({ projectId, sourcePaths: [source] })).rejects.toThrow("reserved")
  })

  test.skipIf(process.platform === "win32")("rejects nested imported names that are invalid but native", async () => {
    const source = path.join(temporaryRoot, "portable-invalid-source")
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
    expect((await manager.listDirectory({ projectId })).entries.map((entry) => entry.name)).toEqual([
      "assets",
      "brief.txt",
    ])

    const renamed = await manager.renameEntry({ name: "notes.txt", path: "brief.txt", projectId })
    expect(renamed.targetPaths).toEqual(["notes.txt"])
    expect(renamed.relocations).toEqual([{ sourcePath: "brief.txt", targetPath: "notes.txt" }])
    const moved = await manager.moveEntries({ destinationPath: "assets", paths: ["notes.txt"], projectId })
    expect(moved.targetPaths).toEqual(["assets/notes.txt"])
    expect(moved.relocations).toEqual([{ sourcePath: "notes.txt", targetPath: "assets/notes.txt" }])
    expect(await manager.readTextFile({ path: "assets/notes.txt", projectId })).toMatchObject({
      content: "hello",
      contentRevision: createHash("sha256").update(Buffer.from("hello", "utf8")).digest("hex"),
      exists: true,
    })

    await manager.writeTextFile({ content: "updated", createParents: true, path: "assets/canvas.json", projectId })
    expect(await manager.readTextFile({ path: "assets/canvas.json", projectId })).toMatchObject({
      content: "updated",
      contentRevision: createHash("sha256").update(Buffer.from("updated", "utf8")).digest("hex"),
      exists: true,
    })
    expect((await manager.listDirectory({ projectId })).entries.map((entry) => entry.name)).toEqual(["assets"])
    expect((await manager.readFile({ path: "assets/notes.txt", projectId })).dataUrl).toBe(
      "data:text/plain;base64,aGVsbG8=",
    )

    await manager.deleteEntries({ paths: ["assets"], projectId })
    expect((await manager.listDirectory({ projectId })).entries).toEqual([])
  })

  test("protects the Convax namespace from every general Project Files mutation", async () => {
    await manager.createEntry({ content: "visible", kind: "file", name: "visible.txt", projectId })
    await expect(manager.createEntry({ kind: "file", name: ".convax", projectId })).rejects.toThrow("reserved")
    await expect(manager.createEntry({ kind: "file", name: ".CONVAX", projectId })).rejects.toThrow("reserved")
    await expect(manager.renameEntry({ name: ".convax", path: "visible.txt", projectId })).rejects.toThrow("reserved")

    const externalReserved = path.join(temporaryRoot, ".convax")
    await fs.writeFile(externalReserved, "external")
    await expect(manager.importEntries({ projectId, sourcePaths: [externalReserved] })).rejects.toThrow("reserved")

    const externalFile = path.join(temporaryRoot, "external-file.txt")
    await fs.writeFile(externalFile, "external")
    expect(await manager.readTextFile({ path: "missing.txt", projectId })).toEqual({
      content: "",
      contentRevision: "",
      exists: false,
      path: "missing.txt",
    })
    const digestPath = "a".repeat(64)
    for (const reservedRoot of [".convax", ".CONVAX", ".ConvAx"]) {
      const assetRoot = `${reservedRoot}/assets`
      const manifestPath = `${reservedRoot}/project.json`
      await expect(
        manager.copyEntries({
          destinationPath: assetRoot,
          paths: ["visible.txt"],
          projectId,
        }),
      ).rejects.toThrow("reserved for Convax")
      await expect(
        manager.importEntries({
          destinationPath: assetRoot,
          projectId,
          sourcePaths: [externalFile],
        }),
      ).rejects.toThrow("reserved for Convax")
      await expect(
        manager.writeTextFile({
          content: "must not be written",
          createParents: true,
          path: `${assetRoot}/blobs/${digestPath}`,
          projectId,
        }),
      ).rejects.toThrow("reserved for Convax")
      await expect(manager.deleteEntries({ paths: [assetRoot], projectId })).rejects.toThrow("reserved for Convax")
      await expect(
        manager.moveEntries({
          destinationPath: assetRoot,
          paths: ["visible.txt"],
          projectId,
        }),
      ).rejects.toThrow("reserved for Convax")
      await expect(manager.listDirectory({ path: assetRoot, projectId })).rejects.toThrow("reserved for Convax")
      await expect(manager.readTextPreview({ path: manifestPath, projectId })).rejects.toThrow("reserved for Convax")
      await expect(manager.readFile({ path: manifestPath, projectId })).rejects.toThrow("reserved for Convax")
      await expect(manager.readFileInfo({ path: manifestPath, projectId })).rejects.toThrow("reserved for Convax")
      await expect(manager.readTextFile({ path: manifestPath, projectId })).rejects.toThrow("reserved for Convax")
      await expect(manager.resolveEntryPath({ path: assetRoot, projectId })).rejects.toThrow("reserved for Convax")
    }

    expect(await fs.readdir(path.join(projectRoot, ".convax", "assets"))).toEqual([])
  })

  test("does not claim or remove a copy target that another writer already owns", async () => {
    const source = path.join(temporaryRoot, "source.txt")
    const target = path.join(temporaryRoot, "target.txt")
    await fs.writeFile(source, "ours")
    await fs.writeFile(target, "theirs")
    await expect(copyPath(source, target)).rejects.toMatchObject({ code: "EEXIST" })
    expect(await fs.readFile(target, "utf8")).toBe("theirs")
  })

  test("imports files and directories with stable collision names", async () => {
    const sourceRoot = path.join(temporaryRoot, "imports")
    await fs.mkdir(path.join(sourceRoot, "nested"), { recursive: true })
    await fs.writeFile(path.join(sourceRoot, "note.txt"), "first")
    await fs.writeFile(path.join(sourceRoot, "nested", "data.json"), "{}")

    const first = await manager.importEntries({
      projectId,
      sourcePaths: [path.join(sourceRoot, "note.txt"), path.join(sourceRoot, "nested")],
    })
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
    await expect(
      manager.moveEntries({ destinationPath: "parent/child", paths: ["parent"], projectId }),
    ).rejects.toThrow("into itself")
    expect((await manager.listDirectory({ projectId })).entries.some((entry) => entry.name === "linked")).toBe(false)
  })

  test("never follows a final symlink for writes or deletes", async () => {
    const outsideFile = path.join(temporaryRoot, "outside.txt")
    await fs.writeFile(outsideFile, "safe")
    await fs.symlink(outsideFile, path.join(projectRoot, "alias.txt"))

    await expect(manager.writeTextFile({ content: "overwritten", path: "alias.txt", projectId })).rejects.toThrow(
      "Symbolic links",
    )
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

    await expect(manager.moveEntries({ paths: ["first/same.txt", "second/same.txt"], projectId })).rejects.toThrow(
      "already exists",
    )
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
    const second = manager.writeTextFile({
      content: "second",
      createParents: true,
      path: "state/canvas.json",
      projectId,
    })
    const concurrentRead = manager.readTextFile({ path: "state/canvas.json", projectId })
    await Promise.all([first, second])
    expect(await fs.readFile(path.join(projectRoot, "state", "canvas.json"), "utf8")).toBe("second")
    expect(await concurrentRead).toMatchObject({
      content: "second",
      contentRevision: createHash("sha256").update(Buffer.from("second", "utf8")).digest("hex"),
    })
  })

  test("rejects invalid UTF-8 instead of decoding replacement text", async () => {
    await fs.writeFile(path.join(projectRoot, "invalid.txt"), Buffer.from([0xc3, 0x28]))

    await expect(manager.readTextFile({ path: "invalid.txt", projectId })).rejects.toThrow(/UTF-8/i)
  })

  test("allows only one of two concurrent compare-and-replace saves", async () => {
    await fs.writeFile(path.join(projectRoot, "brief.md"), "before")
    const expectedRevision = createHash("sha256").update("before").digest("hex")

    const results = await Promise.allSettled([
      manager.compareAndReplaceTextFile({ content: "first", expectedRevision, path: "brief.md", projectId }),
      manager.compareAndReplaceTextFile({ content: "second", expectedRevision, path: "brief.md", projectId }),
    ])

    const success = results.find((result) => result.status === "fulfilled")
    const conflict = results.find((result) => result.status === "rejected")
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1)
    expect(conflict?.status === "rejected" && conflict.reason).toBeInstanceOf(ProjectTextFileConflictError)
    const finalBytes = await fs.readFile(path.join(projectRoot, "brief.md"))
    const finalRevision = createHash("sha256").update(finalBytes).digest("hex")
    expect(success?.status === "fulfilled" && success.value.contentRevision).toBe(finalRevision)
    expect(
      conflict?.status === "rejected" && (conflict.reason as ProjectTextFileConflictError).actualRevision,
    ).toBe(finalRevision)
  })

  test("does not overwrite an external replacement staged before compare-and-replace commit", async () => {
    let stagedPath = ""
    let enterBarrier!: () => void
    let releaseBarrier!: () => void
    const barrierEntered = new Promise<void>((resolve) => {
      enterBarrier = resolve
    })
    const barrierReleased = new Promise<void>((resolve) => {
      releaseBarrier = resolve
    })
    class BarrierProjectManager extends NodeProjectManager {
      protected async beforeCompareAndReplaceCommit(input: { targetPath: string; temporaryPath: string }) {
        stagedPath = input.temporaryPath
        enterBarrier()
        await barrierReleased
      }
    }
    const racingManager = new BarrierProjectManager({
      registryFile: path.join(temporaryRoot, "state", "projects.json"),
    })
    const targetPath = path.join(projectRoot, "brief.md")
    const displacedPath = path.join(projectRoot, "brief-before-external.md")
    await fs.writeFile(targetPath, "before")
    const expectedRevision = createHash("sha256").update("before").digest("hex")

    const save = racingManager.compareAndReplaceTextFile({
      content: "convax replacement",
      expectedRevision,
      path: "brief.md",
      projectId,
    })
    const enteredBeforeSaveSettled = await Promise.race([
      barrierEntered.then(() => true),
      save.then(
        () => false,
        () => false,
      ),
    ])

    expect(enteredBeforeSaveSettled).toBeTrue()
    try {
      expect(await fs.readFile(stagedPath, "utf8")).toBe("convax replacement")
      await fs.rename(targetPath, displacedPath)
      await fs.writeFile(targetPath, "external replacement", { flag: "wx" })
    } finally {
      releaseBarrier()
    }

    await expect(save).rejects.toBeInstanceOf(ProjectTextFileConflictError)
    expect(await fs.readFile(targetPath, "utf8")).toBe("external replacement")
    expect(await fs.readFile(displacedPath, "utf8")).toBe("before")
    await expect(fs.stat(stagedPath)).rejects.toMatchObject({ code: "ENOENT" })
  })

  test("serializes compare-and-replace with ordinary Project text writes", async () => {
    await fs.writeFile(path.join(projectRoot, "brief.md"), "before")
    const expectedRevision = createHash("sha256").update("before").digest("hex")

    const compare = manager.compareAndReplaceTextFile({
      content: "compared",
      expectedRevision,
      path: "brief.md",
      projectId,
    })
    const ordinary = manager.writeTextFile({ content: "ordinary", path: "brief.md", projectId })

    await expect(compare).resolves.toEqual({
      contentRevision: createHash("sha256").update("compared").digest("hex"),
    })
    await expect(ordinary).resolves.toMatchObject({ operation: "write" })
    expect(await fs.readFile(path.join(projectRoot, "brief.md"), "utf8")).toBe("ordinary")
  })

  test("does not create a missing compare-and-replace target", async () => {
    let failure: unknown
    try {
      await manager.compareAndReplaceTextFile({
        content: "new",
        expectedRevision: "a".repeat(64),
        path: "missing.md",
        projectId,
      })
    } catch (error) {
      failure = error
    }

    expect(failure).toBeInstanceOf(ProjectTextFileConflictError)
    expect((failure as ProjectTextFileConflictError).actualRevision).toBeNull()
    await expect(fs.stat(path.join(projectRoot, "missing.md"))).rejects.toMatchObject({ code: "ENOENT" })
  })

  test("does not replace invalid UTF-8 or a symlink target", async () => {
    const invalid = Buffer.from([0xc3, 0x28])
    await fs.writeFile(path.join(projectRoot, "invalid.txt"), invalid)
    await expect(
      manager.compareAndReplaceTextFile({
        content: "replacement",
        expectedRevision: createHash("sha256").update(invalid).digest("hex"),
        path: "invalid.txt",
        projectId,
      }),
    ).rejects.toThrow(/UTF-8/i)
    expect(await fs.readFile(path.join(projectRoot, "invalid.txt"))).toEqual(invalid)

    const outside = path.join(temporaryRoot, "outside.txt")
    await fs.writeFile(outside, "outside")
    await fs.symlink(outside, path.join(projectRoot, "linked.txt"))
    await expect(
      manager.compareAndReplaceTextFile({
        content: "replacement",
        expectedRevision: createHash("sha256").update("outside").digest("hex"),
        path: "linked.txt",
        projectId,
      }),
    ).rejects.toThrow(/symbolic link/i)
    expect(await fs.readFile(outside, "utf8")).toBe("outside")
  })

  test("flushes pending project writes before forgetting the registry entry", async () => {
    const write = manager.writeTextFile({
      content: "latest",
      createParents: true,
      path: "state/canvas.json",
      projectId,
    })
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
    const failedWrite = limited.writeTextFile({
      content: "too large",
      createParents: true,
      path: "state/canvas.json",
      projectId,
    })
    const observedWrite = failedWrite.catch((error: unknown) => error)
    const concurrentFlush = limited.flushPendingWrites()
    const observedFlush = concurrentFlush.catch((error: unknown) => error)
    expect(String(await observedWrite)).toContain("too large")
    expect(String(await observedFlush)).toContain("could not be saved")
    await expect(limited.flushPendingWrites()).resolves.toBeUndefined()
    await expect(
      limited.writeTextFile({ content: "ok", createParents: true, path: "state/canvas.json", projectId }),
    ).resolves.toMatchObject({ operation: "write" })
    await expect(limited.flushPendingWrites()).resolves.toBeUndefined()
  })
})
