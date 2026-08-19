import { lstat, mkdir, rename } from "node:fs/promises"
import { dirname, join } from "node:path"

async function entry(path: string) {
  return lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined
    throw error
  })
}

/** Moves the only reusable OpenCode-era data into the backend-neutral Skill store. */
export async function migrateLegacyAgentSkills(input: {
  currentConfigDirectory: string
  legacyConfigDirectory: string
}): Promise<"current-present" | "migrated" | "nothing-to-migrate"> {
  const source = join(input.legacyConfigDirectory, "skills", "user")
  const target = join(input.currentConfigDirectory, "skills", "user")
  const [sourceEntry, targetEntry] = await Promise.all([entry(source), entry(target)])
  if (targetEntry) {
    if (!targetEntry.isDirectory() || targetEntry.isSymbolicLink()) {
      throw new Error("Current Agent Skill store must be a real directory")
    }
    return "current-present"
  }
  if (!sourceEntry) return "nothing-to-migrate"
  if (!sourceEntry.isDirectory() || sourceEntry.isSymbolicLink()) {
    throw new Error("Legacy Agent Skill store must be a real directory")
  }
  await mkdir(dirname(target), { recursive: true })
  try {
    await rename(source, target)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST" && (await entry(target))?.isDirectory()) {
      return "current-present"
    }
    throw error
  }
  return "migrated"
}
