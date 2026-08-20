import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { migrateImmediatePredecessorCollaborationStore } from "./immediate-predecessor-cutover"

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))))

describe("immediate predecessor collaboration cutover", () => {
  test("publishes verified current and removes the temporary rollback without touching user files", async () => {
    const fixture = await setup()
    await migrateImmediatePredecessorCollaborationStore(ports(fixture.collaboration))
    expect(await fs.readFile(path.join(fixture.collaboration, "version"), "utf8")).toBe("current")
    expect(await fs.readFile(fixture.userFile, "utf8")).toBe("visible")
    expect((await fs.readdir(fixture.privateRoot)).filter((name) => name.includes("migration"))).toEqual([])
  })

  for (const hook of [
    "beforeOldRename",
    "afterOldRenameBeforeCurrentRename",
    "afterCurrentRenameBeforeParentFsync",
    "afterCurrentParentFsyncBeforeCleanup",
    "beforeRollbackCleanup",
  ] as const) {
    test(`restores a fully usable source when ${hook} faults`, async () => {
      const fixture = await setup()
      await expect(migrateImmediatePredecessorCollaborationStore({
        ...ports(fixture.collaboration),
        hooks: { [hook]: async () => { throw new Error("crash") } },
      })).rejects.toThrow("crash")
      expect(await fs.readFile(path.join(fixture.collaboration, "version"), "utf8")).toBe("old")
      expect(await fs.readFile(fixture.userFile, "utf8")).toBe("visible")
      expect((await fs.readdir(fixture.privateRoot)).filter((name) => name.includes("migration"))).toEqual([])
    })
  }

  test("unknown source fails before a marker or stage is created", async () => {
    const fixture = await setup()
    await expect(migrateImmediatePredecessorCollaborationStore({
      ...ports(fixture.collaboration),
      inspectImmediatePredecessor: async () => { throw new Error("unsupported-project-data") },
    })).rejects.toThrow("unsupported-project-data")
    expect(await fs.readFile(path.join(fixture.collaboration, "version"), "utf8")).toBe("old")
    expect((await fs.readdir(fixture.privateRoot)).filter((name) => name.includes("migration"))).toEqual([])
  })

  test("rejects a symlinked .convax boundary without writing through it", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "convax-predecessor-symlink-root-"))
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "convax-predecessor-symlink-outside-"))
    roots.push(root, outside)
    await fs.mkdir(path.join(outside, "collaboration"))
    await fs.writeFile(path.join(outside, "collaboration", "version"), "old")
    await fs.symlink(outside, path.join(root, ".convax"), "dir")

    await expect(migrateImmediatePredecessorCollaborationStore({
      ...ports(path.join(root, ".convax", "collaboration")),
      projectRoot: root,
    })).rejects.toThrow("plain directory")
    expect(await fs.readdir(outside)).toEqual(["collaboration"])
  })
})

async function setup() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "convax-predecessor-cutover-"))
  roots.push(root)
  const privateRoot = path.join(root, ".convax")
  const collaboration = path.join(privateRoot, "collaboration")
  const userFile = path.join(root, "Notes", "visible.md")
  await fs.mkdir(collaboration, { recursive: true })
  await fs.mkdir(path.dirname(userFile), { recursive: true })
  await fs.writeFile(path.join(collaboration, "version"), "old")
  await fs.writeFile(userFile, "visible")
  return { privateRoot, collaboration, userFile }
}

function ports(collaborationDirectory: string) {
  const sourceClosureDigest = "a".repeat(64)
  return {
    projectRoot: path.dirname(path.dirname(collaborationDirectory)),
    collaborationDirectory,
    inspectImmediatePredecessor: async (directory: string) => {
      if (await fs.readFile(path.join(directory, "version"), "utf8") !== "old") throw new Error("unsupported")
      return sourceClosureDigest
    },
    expectedSourceClosureDigest: sourceClosureDigest,
    expectedCurrentAuthority: {
      mode: "local-project-owner" as const,
      actorId: "actor",
      memberId: "member",
      replicaId: "replica",
      authorizationDigest: "b".repeat(64),
      authorityDigest: "c".repeat(64),
    },
    buildCurrentStore: async (directory: string) => fs.writeFile(path.join(directory, "version"), "current"),
    verifyCurrentStore: async (directory: string) => {
      if (await fs.readFile(path.join(directory, "version"), "utf8") !== "current") throw new Error("not-current")
    },
  }
}
