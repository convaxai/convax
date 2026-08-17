import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"

import { validateRepositorySkills } from "./repository-skill-check"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
})

async function makeRepository(
  options: {
    defaultPrompt?: string
    frontmatterName?: string
    linkReference?: boolean
    referenceTarget?: string
  } = {},
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "convax-skill-check-"))
  roots.push(root)
  const skillRoot = join(root, ".agents", "skills", "sample-skill")
  await mkdir(join(skillRoot, "agents"), { recursive: true })
  await mkdir(join(skillRoot, "references"), { recursive: true })
  await writeFile(join(root, "AGENTS.md"), "[sample](.agents/skills/sample-skill/SKILL.md)\n")
  await writeFile(
    join(skillRoot, "SKILL.md"),
    `---\nname: ${options.frontmatterName ?? "sample-skill"}\ndescription: Validate a representative repository Skill and all of its local references.\n---\n\n# Sample\n\n${options.linkReference === false ? "" : `[Guide](${options.referenceTarget ?? "references/guide.md"})`}\n`,
  )
  await writeFile(join(skillRoot, "references", "guide.md"), "# Guide\n")
  await writeFile(
    join(skillRoot, "agents", "openai.yaml"),
    `interface:\n  display_name: "Sample Skill"\n  short_description: "Validate a representative Skill"\n  default_prompt: "${options.defaultPrompt ?? "Use $sample-skill to validate the fixture."}"\n`,
  )
  return root
}

describe("repository Skill check", () => {
  test("accepts a fully indexed Skill with direct reference links", async () => {
    const result = await validateRepositorySkills(await makeRepository())
    expect(result.skills).toEqual(["sample-skill"])
    expect(result.errors).toEqual([])
  })

  test("rejects orphaned and unresolved references", async () => {
    const orphaned = await validateRepositorySkills(await makeRepository({ linkReference: false }))
    expect(orphaned.errors.some((error) => error.includes("reference must be linked directly"))).toBe(true)

    const unresolved = await validateRepositorySkills(
      await makeRepository({ referenceTarget: "references/missing.md" }),
    )
    expect(unresolved.errors.some((error) => error.includes("Markdown target does not resolve"))).toBe(true)
  })

  test("rejects mismatched frontmatter and UI invocation metadata", async () => {
    const result = await validateRepositorySkills(
      await makeRepository({ defaultPrompt: "Audit this fixture.", frontmatterName: "other-skill" }),
    )
    expect(result.errors.some((error) => error.includes("frontmatter name must match"))).toBe(true)
    expect(result.errors.some((error) => error.includes("default_prompt must mention $sample-skill"))).toBe(true)
  })
})
