import { describe, expect, test } from "bun:test"
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { ManagedAgentSkillStore } from "../src/node/managed-skill-store"

const skillDocument = (name: string, description = "A managed test skill") => [
  "---",
  `name: ${name}`,
  `description: ${description}`,
  "---",
  "",
  "Follow the workflow.",
].join("\n")

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "managed-agent-skill-"))
  return {
    config: join(root, "config"),
    root,
    async skill(name: string, document = skillDocument(name)) {
      const directory = join(root, "imports", name)
      await mkdir(directory, { recursive: true })
      await writeFile(join(directory, "SKILL.md"), document)
      return directory
    },
  }
}

describe("ManagedAgentSkillStore", () => {
  test("imports, parses, lists, and locates a bounded user Skill directory", async () => {
    const setup = await fixture()
    try {
      const source = await setup.skill("image-remix", [
        "---",
        "name: image-remix",
        "description: >-",
        "  Remix an image while",
        "  preserving its intent.",
        "---",
      ].join("\n"))
      await mkdir(join(source, "references"))
      await writeFile(join(source, "references", "guide.md"), "reference")
      const store = new ManagedAgentSkillStore(setup.config)

      const installed = await store.importFromDirectory(source)

      expect(installed).toEqual({
        description: "Remix an image while preserving its intent.",
        directory: join(setup.config, "skills", "user", "image-remix"),
        name: "image-remix",
        skillFile: join(setup.config, "skills", "user", "image-remix", "SKILL.md"),
      })
      expect(await readFile(join(installed.directory, "references", "guide.md"), "utf8")).toBe("reference")
      expect(await store.list()).toEqual([installed])
      expect(store.isManagedLocation(installed.directory)).toBe(true)
      expect(store.isManagedLocation(installed.skillFile)).toBe(true)
      expect(store.isManagedLocation(store.userDirectory)).toBe(false)
      expect(store.isManagedLocation(source)).toBe(false)
    } finally {
      await rm(setup.root, { force: true, recursive: true })
    }
  })

  test("installs built-in files atomically and rejects conflicts", async () => {
    const setup = await fixture()
    try {
      const store = new ManagedAgentSkillStore(setup.config)
      const installed = await store.installFromFiles({
        "SKILL.md": skillDocument("storyboard-review"),
        "references/checklist.md": new TextEncoder().encode("check framing"),
      })

      await expect(store.installFromFiles({ "SKILL.md": skillDocument("storyboard-review") }))
        .rejects.toThrow("already installed")
      expect(await readFile(join(installed.directory, "references", "checklist.md"), "utf8"))
        .toBe("check framing")
      const entries = await readdir(store.userDirectory)
      expect(entries.filter((name) => name.startsWith(".install-"))).toEqual([])
    } finally {
      await rm(setup.root, { force: true, recursive: true })
    }
  })

  test("rejects a symlink source or any symlink inside an imported Skill", async () => {
    const setup = await fixture()
    try {
      const store = new ManagedAgentSkillStore(setup.config)
      const source = await setup.skill("linked-skill")
      const alias = join(setup.root, "linked-alias")
      await symlink(source, alias, process.platform === "win32" ? "junction" : "dir")
      await expect(store.importFromDirectory(alias)).rejects.toThrow("not a symlink")

      const target = join(setup.root, "external-reference")
      await mkdir(target)
      await writeFile(join(target, "secret.md"), "outside")
      await symlink(target, join(source, "references"), process.platform === "win32" ? "junction" : "dir")
      await expect(store.importFromDirectory(source)).rejects.toThrow("cannot contain symlinks")
    } finally {
      await rm(setup.root, { force: true, recursive: true })
    }
  })

  test("rejects a symlink used as the managed config root", async () => {
    const setup = await fixture()
    try {
      const target = join(setup.root, "config-target")
      await mkdir(target)
      const alias = join(setup.root, "config-alias")
      await symlink(target, alias, process.platform === "win32" ? "junction" : "dir")
      const store = new ManagedAgentSkillStore(alias)

      await expect(store.list()).rejects.toThrow("config root cannot be a symlink")
    } finally {
      await rm(setup.root, { force: true, recursive: true })
    }
  })

  test("enforces kebab identifiers, matching directories, and Windows-safe package paths", async () => {
    const setup = await fixture()
    try {
      const store = new ManagedAgentSkillStore(setup.config)
      const mismatch = await setup.skill("source-name", skillDocument("manifest-name"))
      await expect(store.importFromDirectory(mismatch)).rejects.toThrow("directory name")
      await expect(store.installFromFiles({ "SKILL.md": skillDocument("Not-Kebab") }))
        .rejects.toThrow("kebab-case")

      for (const path of ["CON.txt", "COM¹.log", "references/clip:stream", "references/trailing. ", "../outside.md"]) {
        await expect(store.installFromFiles({
          "SKILL.md": skillDocument("windows-safe"),
          [path]: "unsafe",
        })).rejects.toThrow(/unsafe path|path is invalid/u)
      }
      await expect(store.installFromFiles({
        "SKILL.md": skillDocument("windows-safe"),
        "references\\outside.md": "unsafe",
      })).rejects.toThrow("path is invalid")
      await expect(store.installFromFiles({
        "SKILL.md": skillDocument("description-limit", "x".repeat(1_025)),
      })).rejects.toThrow("1024")
    } finally {
      await rm(setup.root, { force: true, recursive: true })
    }
  })

  test("rejects file count, individual file, and aggregate size overages", async () => {
    const setup = await fixture()
    try {
      const document = skillDocument("bounded-skill")
      const store = new ManagedAgentSkillStore(setup.config, {
        maxFileBytes: document.length + 2,
        maxFiles: 2,
        maxTotalBytes: document.length + 3,
      })

      await expect(store.installFromFiles({
        "SKILL.md": document,
        "one.txt": "1",
        "two.txt": "2",
      })).rejects.toThrow("file limit")
      await expect(store.installFromFiles({
        "SKILL.md": document,
        "large.txt": "1234",
      })).rejects.toThrow("total limit")

      const fileLimited = new ManagedAgentSkillStore(join(setup.root, "other-config"), {
        maxFileBytes: 3,
        maxFiles: 4,
        maxTotalBytes: 100,
      })
      await expect(fileLimited.installFromFiles({ "SKILL.md": document }))
        .rejects.toThrow("byte file limit")
    } finally {
      await rm(setup.root, { force: true, recursive: true })
    }
  })

  test("uninstalls only a named managed user Skill", async () => {
    const setup = await fixture()
    try {
      const store = new ManagedAgentSkillStore(setup.config)
      const installed = await store.installFromFiles({ "SKILL.md": skillDocument("removable-skill") })
      const outside = join(setup.root, "outside")
      await mkdir(outside)
      await writeFile(join(outside, "keep.txt"), "keep")

      await expect(store.uninstall("../outside")).rejects.toThrow()
      expect(await store.uninstall("removable-skill")).toBe(true)
      expect(await store.uninstall("removable-skill")).toBe(false)
      await expect(lstat(installed.directory)).rejects.toMatchObject({ code: "ENOENT" })
      expect(await readFile(join(outside, "keep.txt"), "utf8")).toBe("keep")
    } finally {
      await rm(setup.root, { force: true, recursive: true })
    }
  })
})
