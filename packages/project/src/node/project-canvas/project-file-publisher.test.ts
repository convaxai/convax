import { createHash } from "node:crypto"
import { appendFileSync, renameSync, symlinkSync } from "node:fs"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { requireProjectResourceReference } from "../../canvas/project-resources"
import { ProjectFilePublisher } from "./project-file-publisher"

let temporaryRoot = ""
let projectRoot = ""

beforeEach(async () => {
  temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "convax-project-publisher-"))
  projectRoot = path.join(temporaryRoot, "project")
  await fs.mkdir(path.join(projectRoot, ".convax"), { recursive: true })
})

afterEach(async () => {
  await fs.rm(temporaryRoot, { force: true, recursive: true })
})

describe("ProjectFilePublisher", () => {
  test("publishes UTF-8 text through private staging without clobbering", async () => {
    const publisher = new ProjectFilePublisher(roots(), { randomId: () => "note-a1" })

    const published = await publisher.publishText({
      content: "# 你好\n",
      directory: "Notes",
      extension: ".md",
      name: "Brief",
      projectId: "project_one",
    })

    expect(published).toEqual({
      contentRevision: createHash("sha256").update("# 你好\n", "utf8").digest("hex"),
      path: "Notes/Brief-note-a1.md",
    })
    expect(await fs.readFile(path.join(projectRoot, "Notes", "Brief-note-a1.md"), "utf8")).toBe("# 你好\n")
    expect(await fs.readdir(path.join(projectRoot, ".convax", "staging"))).toEqual(["note-a1"])
    expect(await fs.readFile(path.join(projectRoot, ".convax", "staging", "note-a1"), "utf8")).toBe("# 你好\n")
  })

  test("chooses a fresh id without overwriting an existing file, directory, or symlink", async () => {
    await fs.mkdir(path.join(projectRoot, "Notes"))
    await fs.writeFile(path.join(projectRoot, "Notes", "Brief-taken.md"), "existing")
    await fs.mkdir(path.join(projectRoot, "Notes", "Brief-directory.md"))
    await fs.symlink(
      path.join(projectRoot, "Notes", "Brief-taken.md"),
      path.join(projectRoot, "Notes", "Brief-link.md"),
    )
    const ids = ["taken", "directory", "link", "fresh"]
    const publisher = new ProjectFilePublisher(roots(), { randomId: () => ids.shift()! })

    const published = await publisher.publishText({
      content: "new",
      directory: "Notes",
      extension: ".md",
      name: "Brief",
      projectId: "project_one",
    })

    expect(published.path).toBe("Notes/Brief-fresh.md")
    expect(await fs.readFile(path.join(projectRoot, "Notes", "Brief-taken.md"), "utf8")).toBe("existing")
    expect((await fs.lstat(path.join(projectRoot, "Notes", "Brief-directory.md"))).isDirectory()).toBe(true)
    expect((await fs.lstat(path.join(projectRoot, "Notes", "Brief-link.md"))).isSymbolicLink()).toBe(true)
  })

  test("normalizes an optional display name to one portable extensionless stem", async () => {
    const publisher = new ProjectFilePublisher(roots(), { randomId: () => "portable" })

    expect(
      (
        await publisher.publishText({
          content: "named",
          directory: "Notes",
          extension: ".md",
          name: "  Project Brief.md  ",
          projectId: "project_one",
        })
      ).path,
    ).toBe("Notes/Project-Brief-portable.md")
    await expect(
      publisher.publishText({
        content: "unsafe",
        directory: "Notes",
        extension: ".md",
        name: "../CON.md",
        projectId: "project_one",
      }),
    ).rejects.toThrow(/name|stem|portable/i)
  })

  test("rejects a Windows-reserved first stem even when more extensions follow", async () => {
    const publisher = new ProjectFilePublisher(roots(), { randomId: () => "reserved" })

    await expect(
      publisher.publishText({
        content: "reserved",
        directory: "Notes",
        extension: ".md",
        name: "CON.txt.extra",
        projectId: "project_one",
      }),
    ).rejects.toThrow(/name|stem|portable/i)
    expect(await readNotesDirectory()).toEqual([])
  })

  test("rejects an isolated surrogate before publishing a Notes file", async () => {
    const publisher = new ProjectFilePublisher(roots(), { randomId: () => "surrogate" })

    await expect(
      publisher.publishText({
        content: "unsafe Unicode",
        directory: "Notes",
        extension: ".md",
        name: "Broken-\ud800-name",
        projectId: "project_one",
      }),
    ).rejects.toThrow(/name|Unicode|portable/i)
    expect(await readNotesDirectory()).toEqual([])
  })

  test.each([
    ["CJK", "界".repeat(300)],
    ["emoji", "😀".repeat(300)],
  ])("bounds a long %s name as one portable filesystem component", async (_label, name) => {
    const maximumId = "i".repeat(64)
    const publisher = new ProjectFilePublisher(roots(), { randomId: () => maximumId })

    const published = await publisher.publishText({
      content: "bounded Unicode",
      directory: "Notes",
      extension: ".md",
      name,
      projectId: "project_one",
    })
    const basename = path.posix.basename(published.path)

    expect(Buffer.byteLength(basename, "utf8")).toBeLessThanOrEqual(255)
    expect(basename.length).toBeLessThanOrEqual(255)
    expect(requireProjectResourceReference({ kind: "project-file", path: published.path })).toEqual({
      kind: "project-file",
      path: published.path,
    })
    expect(await fs.readFile(path.join(projectRoot, ...published.path.split("/")), "utf8")).toBe("bounded Unicode")
  })

  test("accepts content at the exact UTF-8 byte ceiling", async () => {
    const publisher = new ProjectFilePublisher(roots(), { maximumBytes: 4, randomId: () => "exact" })

    const published = await publisher.publishText({
      content: "😀",
      directory: "Notes",
      extension: ".md",
      projectId: "project_one",
    })

    expect(published.path).toBe("Notes/Untitled-exact.md")
    expect(await fs.readFile(path.join(projectRoot, "Notes", "Untitled-exact.md"), "utf8")).toBe("😀")
    expect(await fs.readFile(path.join(projectRoot, ".convax", "staging", "exact"), "utf8")).toBe("😀")
  })

  test("rejects oversized UTF-8 content before materializing its Buffer or creating Notes", async () => {
    const oversized = "界".repeat(1024 * 1024)
    const originalFrom = Buffer.from
    let attemptedOversizedBuffer = false
    Buffer.from = ((value: unknown, ...args: unknown[]) => {
      if (value === oversized) {
        attemptedOversizedBuffer = true
        throw new Error("oversized content was materialized")
      }
      return Reflect.apply(originalFrom, Buffer, [value, ...args])
    }) as typeof Buffer.from
    const publisher = new ProjectFilePublisher(roots(), { maximumBytes: 4, randomId: () => "oversize" })

    try {
      await expect(
        publisher.publishText({
          content: oversized,
          directory: "Notes",
          extension: ".md",
          projectId: "project_one",
        }),
      ).rejects.toThrow(/maximum|size|large/i)
    } finally {
      Buffer.from = originalFrom
    }

    expect(attemptedOversizedBuffer).toBe(false)
    expect(await readNotesDirectory()).toEqual([])
    expect(await readDirectoryIfPresent(path.join(projectRoot, ".convax", "staging"))).toEqual([])
  })

  test("rejects a staging file that grows beyond the captured publication size", async () => {
    await fs.mkdir(path.join(projectRoot, "Notes"))
    await fs.writeFile(path.join(projectRoot, "Notes", "Brief-grow.md"), "collision")
    let idCalls = 0
    const publisher = new ProjectFilePublisher(roots(), {
      randomId: () => {
        idCalls += 1
        if (idCalls === 1) return "grow"
        appendFileSync(path.join(projectRoot, ".convax", "staging", "grow"), "!")
        return "fresh"
      },
    })

    await expect(
      publisher.publishText({
        content: "new",
        directory: "Notes",
        extension: ".md",
        name: "Brief",
        projectId: "project_one",
      }),
    ).rejects.toThrow(/extra|grew|size/i)
    expect(await fs.readFile(path.join(projectRoot, ".convax", "staging", "grow"), "utf8")).toBe("new!")
    expect(await fs.readFile(path.join(projectRoot, "Notes", "Brief-fresh.md"), "utf8")).toBe("new!")
  })

  test("bounds collision retries when the id source repeats", async () => {
    await fs.mkdir(path.join(projectRoot, "Notes"))
    await fs.writeFile(path.join(projectRoot, "Notes", "Brief-repeated.md"), "existing")
    const publisher = new ProjectFilePublisher(roots(), { randomId: () => "repeated" })

    await expect(
      publisher.publishText({
        content: "new",
        directory: "Notes",
        extension: ".md",
        name: "Brief",
        projectId: "project_one",
      }),
    ).rejects.toThrow(/collision|publish|unique/i)
    expect(await fs.readFile(path.join(projectRoot, "Notes", "Brief-repeated.md"), "utf8")).toBe("existing")
    expect(await fs.readFile(path.join(projectRoot, ".convax", "staging", "repeated"), "utf8")).toBe("new")
  })

  test("rejects a resolver path replaced by a symlink without writing through it", async () => {
    const movedRoot = `${projectRoot}-moved`
    const outside = path.join(temporaryRoot, "outside-root")
    await fs.mkdir(outside)
    await fs.writeFile(path.join(outside, "foreign.txt"), "must remain")
    const publisher = new ProjectFilePublisher({
      async resolveProjectRoot() {
        renameSync(projectRoot, movedRoot)
        symlinkSync(outside, projectRoot, process.platform === "win32" ? "junction" : "dir")
        return projectRoot
      },
    })

    await expect(
      publisher.publishText({
        content: "must not escape",
        directory: "Notes",
        extension: ".md",
        projectId: "project_one",
      }),
    ).rejects.toThrow(/root|symbolic link|directory/i)
    expect(await fs.readdir(outside)).toEqual(["foreign.txt"])
    expect(await fs.readFile(path.join(outside, "foreign.txt"), "utf8")).toBe("must remain")
    expect(await fs.readdir(path.join(movedRoot, ".convax"))).toEqual([])
    expect(await readDirectoryIfPresent(path.join(movedRoot, "Notes"))).toEqual([])
  })

  test.each(["Notes", ".convax/staging"])(
    "rejects a symlinked %s directory without writing outside",
    async (directory) => {
      const outside = path.join(temporaryRoot, `outside-${directory.replaceAll("/", "-")}`)
      const target = path.join(projectRoot, ...directory.split("/"))
      await fs.mkdir(path.dirname(target), { recursive: true })
      await fs.mkdir(outside)
      await fs.symlink(outside, target, process.platform === "win32" ? "junction" : "dir")
      const publisher = new ProjectFilePublisher(roots(), { randomId: () => "unsafe" })

      await expect(
        publisher.publishText({
          content: "must stay inside",
          directory: "Notes",
          extension: ".md",
          projectId: "project_one",
        }),
      ).rejects.toThrow(/symbolic link|real directory/i)
      expect(await fs.readdir(outside)).toEqual([])
    },
  )

  test.each(["Notes", ".convax/staging"])("fails closed when %s is replaced after validation", async (directory) => {
    const target = path.join(projectRoot, ...directory.split("/"))
    const movedTarget = `${target}-moved`
    const outside = path.join(temporaryRoot, `outside-replaced-${directory.replaceAll("/", "-")}`)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.mkdir(target)
    await fs.mkdir(outside)
    const publisher = new ProjectFilePublisher(roots(), {
      randomId: () => {
        renameSync(target, movedTarget)
        symlinkSync(outside, target, process.platform === "win32" ? "junction" : "dir")
        return "replaced"
      },
    })

    await expect(
      publisher.publishText({
        content: "must not escape",
        directory: "Notes",
        extension: ".md",
        projectId: "project_one",
      }),
    ).rejects.toThrow(/changed|symbolic link|directory/i)
    expect(await fs.readdir(outside)).toEqual([])
    expect(await fs.readdir(movedTarget)).toEqual([])
  })
})

function roots() {
  return {
    async resolveProjectRoot(input: { projectId: string }) {
      if (input.projectId !== "project_one") throw new Error("Unknown Project")
      return fs.realpath(projectRoot)
    },
  }
}

async function readNotesDirectory() {
  return readDirectoryIfPresent(path.join(projectRoot, "Notes"))
}

async function readDirectoryIfPresent(directory: string) {
  try {
    return await fs.readdir(directory)
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return []
    throw error
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error
}
