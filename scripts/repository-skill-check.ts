#!/usr/bin/env bun
import { readdir, readFile } from "node:fs/promises"
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path"

type SkillFrontmatter = {
  description?: unknown
  name?: unknown
}

type SkillValidation = {
  errors: string[]
  skills: string[]
}

const skillNamePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const markdownLinkPattern = /!?\[[^\]]*\]\(([^)]+)\)/g
const localAbsolutePathPattern = /(?:\/Users\/[^\s)`]+|[A-Za-z]:\\Users\\[^\s)`]+)/

function record(errors: string[], path: string, message: string): void {
  errors.push(`${path}: ${message}`)
}

function parseFrontmatter(source: string, path: string, errors: string[]): SkillFrontmatter | undefined {
  if (!source.startsWith("---\n")) {
    record(errors, path, "SKILL.md must start with YAML frontmatter")
    return undefined
  }
  const end = source.indexOf("\n---\n", 4)
  if (end < 0) {
    record(errors, path, "SKILL.md frontmatter must end with ---")
    return undefined
  }
  try {
    const value = Bun.YAML.parse(source.slice(4, end))
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      record(errors, path, "frontmatter must be a YAML mapping")
      return undefined
    }
    const keys = Object.keys(value).sort()
    if (keys.join(",") !== "description,name") {
      record(errors, path, "frontmatter must contain only name and description")
    }
    return value as SkillFrontmatter
  } catch (error) {
    record(errors, path, `invalid YAML frontmatter: ${String(error)}`)
    return undefined
  }
}

function localMarkdownTargets(source: string): string[] {
  const targets: string[] = []
  for (const match of source.matchAll(markdownLinkPattern)) {
    let target = match[1]?.trim() ?? ""
    if (target.startsWith("<")) {
      const close = target.indexOf(">")
      target = close >= 0 ? target.slice(1, close) : target
    } else {
      target = target.split(/\s+["']/u, 1)[0] ?? target
    }
    if (!target || target.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue
    targets.push(target.split("#", 1)[0] ?? target)
  }
  return targets.filter(Boolean)
}

function staysWithin(root: string, target: string): boolean {
  const pathFromRoot = relative(root, target)
  return pathFromRoot !== ".." && !pathFromRoot.startsWith(`..${sep}`) && !isAbsolute(pathFromRoot)
}

async function collectMarkdownFiles(directory: string): Promise<string[]> {
  const files: string[] = []
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch {
    return files
  }
  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...(await collectMarkdownFiles(path)))
    else if (entry.isFile() && entry.name.endsWith(".md")) files.push(path)
  }
  return files.sort()
}

async function readRequired(path: string, label: string, errors: string[]): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8")
  } catch {
    record(errors, label, "required file is missing or unreadable")
    return undefined
  }
}

async function validateMarkdown(
  repositoryRoot: string,
  path: string,
  source: string,
  errors: string[],
): Promise<string[]> {
  const label = relative(repositoryRoot, path)
  if (localAbsolutePathPattern.test(source)) {
    record(errors, label, "repository Skills must not depend on checkout-specific user paths")
  }
  const resolvedTargets: string[] = []
  for (const target of localMarkdownTargets(source)) {
    if (isAbsolute(target) || /^[A-Za-z]:[\\/]/.test(target)) {
      record(errors, label, `absolute Markdown target is forbidden: ${target}`)
      continue
    }
    const resolvedTarget = resolve(dirname(path), target)
    if (!staysWithin(repositoryRoot, resolvedTarget)) {
      record(errors, label, `Markdown target escapes the repository: ${target}`)
      continue
    }
    try {
      await readFile(resolvedTarget)
      resolvedTargets.push(resolvedTarget)
    } catch {
      record(errors, label, `Markdown target does not resolve: ${target}`)
    }
  }
  return resolvedTargets
}

export async function validateRepositorySkills(repositoryRoot: string): Promise<SkillValidation> {
  const errors: string[] = []
  const skillsRoot = join(repositoryRoot, ".agents", "skills")
  const rootInstructions = await readRequired(join(repositoryRoot, "AGENTS.md"), "AGENTS.md", errors)
  let entries
  try {
    entries = await readdir(skillsRoot, { withFileTypes: true })
  } catch {
    record(errors, ".agents/skills", "repository Skill directory is missing or unreadable")
    return { errors, skills: [] }
  }

  const skills = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()

  for (const skillName of skills) {
    const skillRoot = join(skillsRoot, skillName)
    const skillPath = join(skillRoot, "SKILL.md")
    const skillLabel = relative(repositoryRoot, skillPath)
    if (!skillNamePattern.test(skillName)) record(errors, skillLabel, "directory name must use lowercase hyphen-case")

    const skillSource = await readRequired(skillPath, skillLabel, errors)
    if (!skillSource) continue
    const frontmatter = parseFrontmatter(skillSource, skillLabel, errors)
    if (frontmatter?.name !== skillName) record(errors, skillLabel, "frontmatter name must match the directory")
    if (
      typeof frontmatter?.description !== "string" ||
      frontmatter.description.trim().length < 20 ||
      frontmatter.description.includes("TODO")
    ) {
      record(errors, skillLabel, "frontmatter description must be complete and informative")
    }

    const directSkillTargets = new Set(await validateMarkdown(repositoryRoot, skillPath, skillSource, errors))
    const referenceFiles = await collectMarkdownFiles(join(skillRoot, "references"))
    for (const referencePath of referenceFiles) {
      const referenceLabel = relative(repositoryRoot, referencePath)
      const referenceSource = await readRequired(referencePath, referenceLabel, errors)
      if (!referenceSource) continue
      await validateMarkdown(repositoryRoot, referencePath, referenceSource, errors)
      if (!directSkillTargets.has(referencePath)) {
        record(errors, referenceLabel, "reference must be linked directly from SKILL.md")
      }
    }

    const agentLabel = relative(repositoryRoot, join(skillRoot, "agents", "openai.yaml"))
    const agentSource = await readRequired(join(skillRoot, "agents", "openai.yaml"), agentLabel, errors)
    if (agentSource) {
      try {
        const agent = Bun.YAML.parse(agentSource) as {
          interface?: { default_prompt?: unknown; display_name?: unknown; short_description?: unknown }
        }
        if (typeof agent.interface?.display_name !== "string" || !agent.interface.display_name.trim()) {
          record(errors, agentLabel, "interface.display_name is required")
        }
        if (
          typeof agent.interface?.short_description !== "string" ||
          agent.interface.short_description.length < 25 ||
          agent.interface.short_description.length > 64
        ) {
          record(errors, agentLabel, "interface.short_description must contain 25-64 characters")
        }
        if (
          typeof agent.interface?.default_prompt !== "string" ||
          !agent.interface.default_prompt.includes(`$${skillName}`)
        ) {
          record(errors, agentLabel, `interface.default_prompt must mention $${skillName}`)
        }
      } catch (error) {
        record(errors, agentLabel, `invalid YAML: ${String(error)}`)
      }
    }

    if (!rootInstructions?.includes(`(.agents/skills/${skillName}/SKILL.md)`)) {
      record(errors, "AGENTS.md", `repository Skill index must link ${skillLabel}`)
    }
  }

  return { errors, skills }
}

if (import.meta.main) {
  const repositoryRoot = resolve(import.meta.dir, "..")
  const result = await validateRepositorySkills(repositoryRoot)
  if (result.errors.length > 0) {
    for (const error of result.errors) console.error(error)
    process.exit(1)
  }
  console.log(`repository Skill check passed: ${result.skills.length} Skills, frontmatter, index, and links valid`)
}
