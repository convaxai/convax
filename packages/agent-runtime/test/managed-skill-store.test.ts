import { describe, expect, test } from "bun:test"
import { lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { inspectAgentSkillDirectory, ManagedAgentSkillStore } from "../src/node/managed-skill-store"

const skillDocument = (name: string, description = "A managed test skill") =>
  ["---", `name: ${name}`, `description: ${description}`, "---", "", "Follow the workflow."].join("\n")

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
      const source = await setup.skill(
        "image-remix",
        [
          "---",
          "name: image-remix",
          "description: >-",
          "  Remix an image while",
          "  preserving its intent.",
          "---",
        ].join("\n"),
      )
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
      const inspection = await store.inspect("image-remix")
      expect(inspection).toMatchObject({
        description: "Remix an image while preserving its intent.",
        directory: installed.directory,
        name: "image-remix",
      })
      expect(inspection.files.map((file) => file.path).sort()).toEqual(["SKILL.md", "references/guide.md"])
      expect(await inspectAgentSkillDirectory(source)).toMatchObject({
        description: "Remix an image while preserving its intent.",
        name: "image-remix",
      })
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

      await expect(store.installFromFiles({ "SKILL.md": skillDocument("storyboard-review") })).rejects.toThrow(
        "already installed",
      )
      expect(await readFile(join(installed.directory, "references", "checklist.md"), "utf8")).toBe("check framing")
      const entries = await readdir(store.userDirectory)
      expect(entries.filter((name) => name.startsWith(".install-"))).toEqual([])
    } finally {
      await rm(setup.root, { force: true, recursive: true })
    }
  })

  test("rejects an unexpected package name before creating managed storage", async () => {
    const setup = await fixture()
    try {
      const store = new ManagedAgentSkillStore(setup.config)

      await expect(
        store.installFromFiles(
          {
            "SKILL.md": skillDocument("bundle-name"),
          },
          { expectedName: "expected-name" },
        ),
      ).rejects.toThrow("expected name")

      await expect(lstat(setup.config)).rejects.toMatchObject({ code: "ENOENT" })
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
      await expect(inspectAgentSkillDirectory(source)).rejects.toThrow("cannot contain symlinks")
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
      await expect(store.installFromFiles({ "SKILL.md": skillDocument("Not-Kebab") })).rejects.toThrow("kebab-case")

      for (const path of ["CON.txt", "COM¹.log", "references/clip:stream", "references/trailing. ", "../outside.md"]) {
        await expect(
          store.installFromFiles({
            "SKILL.md": skillDocument("windows-safe"),
            [path]: "unsafe",
          }),
        ).rejects.toThrow(/unsafe path|path is invalid/u)
      }
      await expect(
        store.installFromFiles({
          "SKILL.md": skillDocument("windows-safe"),
          "references\\outside.md": "unsafe",
        }),
      ).rejects.toThrow("path is invalid")
      await expect(
        store.installFromFiles({
          "SKILL.md": skillDocument("description-limit", "x".repeat(1_025)),
        }),
      ).rejects.toThrow("1024")
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

      await expect(
        store.installFromFiles({
          "SKILL.md": document,
          "one.txt": "1",
          "two.txt": "2",
        }),
      ).rejects.toThrow("file limit")
      await expect(
        store.installFromFiles({
          "SKILL.md": document,
          "large.txt": "1234",
        }),
      ).rejects.toThrow("total limit")

      const fileLimited = new ManagedAgentSkillStore(join(setup.root, "other-config"), {
        maxFileBytes: 3,
        maxFiles: 4,
        maxTotalBytes: 100,
      })
      await expect(fileLimited.installFromFiles({ "SKILL.md": document })).rejects.toThrow("byte file limit")
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

  test("prepares a Skill install without publishing it and rolls a published install back", async () => {
    const setup = await fixture()
    try {
      const store = new ManagedAgentSkillStore(setup.config)
      const transaction = await store.prepareInstallFromFiles({
        "SKILL.md": skillDocument("prepared-skill"),
        "references/version.txt": "prepared",
      })

      expect(transaction.skill.name).toBe("prepared-skill")
      expect(await store.list()).toEqual([])

      await transaction.publish()
      expect(await readFile(join(transaction.skill.directory, "references", "version.txt"), "utf8")).toBe("prepared")

      await transaction.rollback()
      expect(await store.list()).toEqual([])
      expect((await readdir(store.userDirectory)).filter((name) => name.startsWith(".install-"))).toEqual([])
    } finally {
      await rm(setup.root, { force: true, recursive: true })
    }
  })

  test("replaces a managed Skill only when authorized and restores the previous version on rollback", async () => {
    const setup = await fixture()
    try {
      const store = new ManagedAgentSkillStore(setup.config)
      const installed = await store.installFromFiles({
        "SKILL.md": skillDocument("replaceable-skill", "Original workflow"),
        "references/version.txt": "original",
      })

      await expect(
        store.prepareInstallFromFiles({
          "SKILL.md": skillDocument("replaceable-skill", "Updated workflow"),
        }),
      ).rejects.toThrow("already installed")

      const replacementFiles = {
        "SKILL.md": skillDocument("replaceable-skill", "Updated workflow"),
        "references/version.txt": "updated",
      }
      const rolledBack = await store.prepareInstallFromFiles(replacementFiles, { replaceExisting: true })
      expect(await readFile(join(installed.directory, "references", "version.txt"), "utf8")).toBe("original")

      await rolledBack.publish()
      expect((await store.inspect("replaceable-skill")).description).toBe("Updated workflow")
      expect(await readFile(join(installed.directory, "references", "version.txt"), "utf8")).toBe("updated")

      await rolledBack.rollback()
      expect((await store.inspect("replaceable-skill")).description).toBe("Original workflow")
      expect(await readFile(join(installed.directory, "references", "version.txt"), "utf8")).toBe("original")

      const committed = await store.prepareInstallFromFiles(replacementFiles, { replaceExisting: true })
      await committed.publish()
      await committed.commit()
      await committed.rollback()
      expect((await store.inspect("replaceable-skill")).description).toBe("Updated workflow")
      expect((await readdir(store.userDirectory)).filter((name) => name.startsWith(".install-"))).toEqual([])
    } finally {
      await rm(setup.root, { force: true, recursive: true })
    }
  })

  test("prepares a reversible uninstall and commits removal only after publication", async () => {
    const setup = await fixture()
    try {
      const store = new ManagedAgentSkillStore(setup.config)
      await store.installFromFiles({ "SKILL.md": skillDocument("transactional-removal") })

      const rolledBack = await store.prepareUninstall("transactional-removal")
      expect(rolledBack).not.toBeNull()
      expect((await store.list()).map((skill) => skill.name)).toEqual(["transactional-removal"])

      await rolledBack!.publish()
      expect(await store.list()).toEqual([])
      await rolledBack!.rollback()
      expect((await store.list()).map((skill) => skill.name)).toEqual(["transactional-removal"])

      const committed = await store.prepareUninstall("transactional-removal")
      await committed!.publish()
      await committed!.commit()
      await committed!.rollback()
      expect(await store.list()).toEqual([])
      expect(await store.prepareUninstall("transactional-removal")).toBeNull()
      expect((await readdir(store.userDirectory)).filter((name) => name.startsWith(".install-"))).toEqual([])
    } finally {
      await rm(setup.root, { force: true, recursive: true })
    }
  })

  test("recovers journaled install, replacement, and removal publications after a process restart", async () => {
    const setup = await fixture()
    try {
      const store = new ManagedAgentSkillStore(setup.config)
      const interruptedInstall = await store.prepareInstallFromFiles({
        "SKILL.md": skillDocument("recovered-skill", "First version"),
      })
      await interruptedInstall.publish()

      const restarted = new ManagedAgentSkillStore(setup.config)
      await restarted.recoverPublication(interruptedInstall.recovery, "rollback")
      expect(await restarted.list()).toEqual([])

      await restarted.installFromFiles({ "SKILL.md": skillDocument("recovered-skill", "First version") })
      const interruptedReplacement = await restarted.prepareInstallFromFiles(
        { "SKILL.md": skillDocument("recovered-skill", "Second version") },
        { replaceExisting: true },
      )
      await interruptedReplacement.publish()
      await new ManagedAgentSkillStore(setup.config).recoverPublication(interruptedReplacement.recovery, "commit")
      expect((await restarted.inspect("recovered-skill")).description).toBe("Second version")

      const interruptedRemoval = await restarted.prepareUninstall("recovered-skill")
      await interruptedRemoval!.publish()
      await new ManagedAgentSkillStore(setup.config).recoverPublication(interruptedRemoval!.recovery, "rollback")
      expect((await restarted.inspect("recovered-skill")).description).toBe("Second version")
      expect((await readdir(restarted.userDirectory)).filter((name) => name.startsWith(".install-"))).toEqual([])
    } finally {
      await rm(setup.root, { force: true, recursive: true })
    }
  })

  test("does not destroy published bytes when rollback recovery prerequisites are missing or changed", async () => {
    for (const corruption of ["missing", "changed"] as const) {
      const setup = await fixture()
      try {
        const store = new ManagedAgentSkillStore(setup.config)
        await store.installFromFiles({ "SKILL.md": skillDocument("guarded-recovery", "Original") })
        const replacement = await store.prepareInstallFromFiles(
          { "SKILL.md": skillDocument("guarded-recovery", "Replacement") },
          { replaceExisting: true },
        )
        await replacement.publish()
        const backup = join(store.userDirectory, `.install-backup-${replacement.recovery.transactionId}`)
        if (corruption === "missing") {
          await rm(backup, { recursive: true })
        } else {
          await writeFile(join(backup, "SKILL.md"), skillDocument("guarded-recovery", "Changed backup"))
        }

        await expect(store.recoverPublication(replacement.recovery, "rollback")).rejects.toThrow(
          "Managed Skill backup changed before rollback",
        )
        expect((await store.inspect("guarded-recovery")).description).toBe("Replacement")
      } finally {
        await rm(setup.root, { force: true, recursive: true })
      }
    }

    const setup = await fixture()
    try {
      const store = new ManagedAgentSkillStore(setup.config)
      const installation = await store.prepareInstallFromFiles({
        "SKILL.md": skillDocument("guarded-install", "Published installation"),
      })
      await installation.publish()
      const unexpectedBackup = join(store.userDirectory, `.install-backup-${installation.recovery.transactionId}`)
      await mkdir(unexpectedBackup)
      await writeFile(join(unexpectedBackup, "SKILL.md"), skillDocument("guarded-install", "Unexpected backup"))

      await expect(store.recoverPublication(installation.recovery, "rollback")).rejects.toThrow(
        "Unexpected managed Skill backup for an install",
      )
      expect((await store.inspect("guarded-install")).description).toBe("Published installation")
    } finally {
      await rm(setup.root, { force: true, recursive: true })
    }
  })

  test("completes journaled publications that crashed before their filesystem rename", async () => {
    const setup = await fixture()
    try {
      const store = new ManagedAgentSkillStore(setup.config)
      const interruptedInstall = await store.prepareInstallFromFiles({
        "SKILL.md": skillDocument("forward-skill", "First version"),
      })
      await new ManagedAgentSkillStore(setup.config).recoverPublication(interruptedInstall.recovery, "commit")
      expect((await store.inspect("forward-skill")).description).toBe("First version")

      const interruptedReplacement = await store.prepareInstallFromFiles(
        { "SKILL.md": skillDocument("forward-skill", "Second version") },
        { replaceExisting: true },
      )
      await new ManagedAgentSkillStore(setup.config).recoverPublication(interruptedReplacement.recovery, "commit")
      expect((await store.inspect("forward-skill")).description).toBe("Second version")

      const interruptedRemoval = await store.prepareUninstall("forward-skill")
      await new ManagedAgentSkillStore(setup.config).recoverPublication(interruptedRemoval!.recovery, "commit")
      expect(await store.list()).toEqual([])
      expect((await readdir(store.userDirectory)).filter((name) => name.startsWith(".install-"))).toEqual([])
    } finally {
      await rm(setup.root, { force: true, recursive: true })
    }
  })

  test("recovers a replacement interrupted between its two filesystem renames", async () => {
    for (const outcome of ["commit", "rollback"] as const) {
      const setup = await fixture()
      try {
        const store = new ManagedAgentSkillStore(setup.config)
        const installed = await store.installFromFiles({
          "SKILL.md": skillDocument("between-renames", "Original"),
        })
        const replacement = await store.prepareInstallFromFiles(
          { "SKILL.md": skillDocument("between-renames", "Replacement") },
          { replaceExisting: true },
        )
        const backup = join(store.userDirectory, `.install-backup-${replacement.recovery.transactionId}`)
        await rename(installed.directory, backup)

        await new ManagedAgentSkillStore(setup.config).recoverPublication(replacement.recovery, outcome)
        expect((await store.inspect("between-renames")).description).toBe(
          outcome === "commit" ? "Replacement" : "Original",
        )
        expect((await readdir(store.userDirectory)).filter((name) => name.startsWith(".install-"))).toEqual([])
      } finally {
        await rm(setup.root, { force: true, recursive: true })
      }
    }
  })

  test("cleans an abandoned hidden staging directory but never guesses away a published backup", async () => {
    const setup = await fixture()
    try {
      const store = new ManagedAgentSkillStore(setup.config)
      const abandoned = await store.prepareInstallFromFiles({
        "SKILL.md": skillDocument("abandoned-skill"),
      })
      expect((await readdir(store.userDirectory)).some((name) => name.startsWith(".install-stage-"))).toBe(true)

      await new ManagedAgentSkillStore(setup.config).cleanupAbandonedPublications()
      expect(await store.list()).toEqual([])
      expect((await readdir(store.userDirectory)).filter((name) => name.startsWith(".install-"))).toEqual([])
      await abandoned.rollback()

      await store.installFromFiles({ "SKILL.md": skillDocument("guarded-backup", "Original") })
      const replacement = await store.prepareInstallFromFiles(
        { "SKILL.md": skillDocument("guarded-backup", "Replacement") },
        { replaceExisting: true },
      )
      await replacement.publish()
      await expect(store.cleanupAbandonedPublications()).rejects.toThrow("backup has no recovery journal")
      await store.recoverPublication(replacement.recovery, "rollback")
      expect((await store.inspect("guarded-backup")).description).toBe("Original")
    } finally {
      await rm(setup.root, { force: true, recursive: true })
    }
  })
})
