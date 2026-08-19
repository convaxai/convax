import { afterEach, describe, expect, test } from "bun:test"
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { migrateLegacyAgentSkills } from "./agent-runtime-data-migration"

const roots: string[] = []

afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true }))))

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "convax-agent-migration-"))
  roots.push(root)
  return { current: join(root, "agent-runtime"), legacy: join(root, "opencode") }
}

describe("Agent runtime data migration", () => {
  test("atomically moves legacy managed Skills into the backend-neutral store", async () => {
    const paths = await fixture()
    const skill = join(paths.legacy, "skills", "user", "example")
    await mkdir(skill, { recursive: true })
    await writeFile(join(skill, "SKILL.md"), "# Example\n")

    await expect(
      migrateLegacyAgentSkills({ currentConfigDirectory: paths.current, legacyConfigDirectory: paths.legacy }),
    ).resolves.toBe("migrated")
    await expect(readFile(join(paths.current, "skills", "user", "example", "SKILL.md"), "utf8")).resolves.toBe(
      "# Example\n",
    )
    await expect(lstat(join(paths.legacy, "skills", "user"))).rejects.toMatchObject({ code: "ENOENT" })
  })

  test("never merges over a current store and rejects a legacy symlink", async () => {
    const paths = await fixture()
    await mkdir(join(paths.current, "skills", "user"), { recursive: true })
    await mkdir(join(paths.legacy, "skills"), { recursive: true })
    await symlink(paths.current, join(paths.legacy, "skills", "user"))
    await expect(
      migrateLegacyAgentSkills({ currentConfigDirectory: paths.current, legacyConfigDirectory: paths.legacy }),
    ).resolves.toBe("current-present")

    await rm(join(paths.current, "skills", "user"), { recursive: true })
    await expect(
      migrateLegacyAgentSkills({ currentConfigDirectory: paths.current, legacyConfigDirectory: paths.legacy }),
    ).rejects.toThrow("real directory")
  })
})
