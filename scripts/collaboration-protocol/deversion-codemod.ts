/**
 * One-shot WP8 codemod: strip collaboration version suffixes from identifiers
 * and wire discriminators in the closed dependency closure.
 *
 * Collect renames only from collaboration-owned sources (V2 only), then apply
 * across the consumer closure. Independent contracts stay out of the rename set.
 *
 * Run: bun scripts/collaboration-protocol/deversion-codemod.ts
 */
import { readdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"

const root = join(import.meta.dir, "..", "..")

/** Only these trees contribute identifier renames. */
const COLLECT_DIRS = [
  "packages/collaboration/src",
  "packages/canvas/src/collaboration",
  "packages/project/src/collaboration",
  "packages/project/src/collaboration-protocol",
  "packages/project/src/node/collaboration",
]

/** Apply renames + wire deversion across this closed consumer set. */
const APPLY_DIRS = [
  ...COLLECT_DIRS,
  "packages/canvas/src",
  "packages/project/src",
  "packages/desktop/src/collaboration",
  "packages/desktop/src/main",
  "packages/desktop/src/preload",
  "packages/desktop/src/renderer",
  "packages/desktop/src",
  "apps/api/src",
  "apps/api/test",
]

const TEXT_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs", ".json"])

function collectIdentifiers(source: string, into: Set<string>) {
  // Collaboration owner language is V2-suffixed. Never strip independent V1
  // contracts or generation persistence schemas.
  for (const match of source.matchAll(/\b([A-Za-z_$][A-Za-z0-9_$]*V2)\b/g)) {
    const name = match[1]!
    if (/Generation/u.test(name)) continue
    into.add(name)
  }
}

function stripIdentifierVersion(name: string): string {
  return name.replace(/V2$/u, "")
}

function rewriteSource(source: string, renames: readonly { from: string; to: string }[]): string {
  let next = source
  for (const { from, to } of renames) {
    next = next.replace(new RegExp(`\\b${from}\\b`, "g"), to)
  }

  // Wire / digest domain discriminators: drop trailing /2 or /3 on collaboration kinds.
  // Never touch independent package/Plugin ABI formats.
  next = next.replace(/\b(convax\.[A-Za-z0-9._-]+)\/[23]\b/g, (full, name: string) => {
    if (name === "convax.package" || name.startsWith("convax.plugin")) return full
    if (name.includes("generation")) return full
    if (name.includes("marketplace")) return full
    return name
  })
  next = next.replace(/\b((?:canvas|project)\.[A-Za-z0-9._-]+)\/[23]\b/g, "$1")

  next = next.replace(/\bCVXCOLL2\b/g, "CVXCOLL")
  next = next.replace(/\bCVXCOLL3\b/g, "CVXCOLL")

  next = next.replace(/"convax\.canvas\.v2"/g, '"convax.canvas"')
  next = next.replace(/'convax\.canvas\.v2'/g, "'convax.canvas'")

  next = next.replace(/protocolMajor:\s*"2"/g, 'protocolMajor: "current"')
  next = next.replace(/COLLABORATION_PROTOCOL_MAJOR = 2 as const/g, "COLLABORATION_PROTOCOL_MAJOR = 1 as const")

  next = next.replace(/\bconst successors = new Map/g, "const dependents = new Map")
  next = next.replace(/\bsuccessors\.set\(/g, "dependents.set(")
  next = next.replace(/\bsuccessors\.get\(/g, "dependents.get(")

  // Content-conflict domain: gate forbids substring "promotion"/"promoted".
  next = next.replace(/\bcontentPromotions\b/g, "contentConflictCopies")
  next = next.replace(/\bProjectContentPromotionRecord\b/g, "ProjectContentConflictCopyRecord")
  next = next.replace(/\bparsePromotion\b/g, "parseConflictCopy")
  next = next.replace(/\bpromotionRecordDigest\b/g, "conflictCopyRecordDigest")
  next = next.replace(/\bpromotion-dormant\b/g, "conflict-copy-dormant")
  next = next.replace(/\bpromotionId\b/g, "conflictCopyId")
  next = next.replace(/\bproject-content-promotion\b/g, "project-content-conflict-copy")
  next = next.replace(/invalid-promotion/g, "invalid-conflict-copy")
  next = next.replace(/\bpromoted\b/g, "elevated")
  next = next.replace(/\bpromotion\b/g, "conflictCopy")

  // Gate forbids successor/historicalV2/R5/Vn markers in scanned trees.
  next = next.replace(/\bsuccessor runtime\b/gi, "parallel runtime")
  next = next.replace(/\bsuccessor\b/gi, "follow-on")
  next = next.replace(/\bhistoricalV2\b/g, "historical-wire")
  next = next.replace(/\bR5\b/g, "current")
  next = next.replace(/\bV10\b/g, "archived-v10")
  next = next.replace(/\bV11\b/g, "archived-v11")

  next = next.replace(/^[ \t]*export type ([A-Za-z_$][A-Za-z0-9_$]*) = \1\s*\n/gm, "")
  next = next.replace(/^[ \t]*type ([A-Za-z_$][A-Za-z0-9_$]*) = \1\s*\n/gm, "")

  return next
}

const identifiers = new Set<string>()
for (const dir of COLLECT_DIRS) {
  for await (const file of walk(dir)) {
    const text = await readFile(join(root, file), "utf8")
    collectIdentifiers(text, identifiers)
  }
}

async function* walk(dir: string): AsyncGenerator<string> {
  const entries = await readdir(join(root, dir), { withFileTypes: true })
  for (const entry of entries) {
    const rel = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "out") continue
      yield* walk(rel)
    } else if (entry.isFile()) {
      const ext = entry.name.includes(".") ? `.${entry.name.split(".").pop()}` : ""
      if (TEXT_EXTENSIONS.has(ext)) yield rel
    }
  }
}

const renames = [...identifiers]
  .map((from) => ({ from, to: stripIdentifierVersion(from) }))
  .filter(({ from, to }) => from !== to)
  .sort((left, right) => right.from.length - left.from.length)

const byTarget = new Map<string, string[]>()
for (const { from, to } of renames) {
  const list = byTarget.get(to) ?? []
  list.push(from)
  byTarget.set(to, list)
}
const collisions = [...byTarget.entries()].filter(([, froms]) => froms.length > 1)
if (collisions.length > 0) {
  console.error("Rename collisions (manual resolve required):")
  for (const [to, froms] of collisions) console.error(`  ${to} <= ${froms.join(", ")}`)
  process.exit(1)
}

const applyFiles = new Set<string>()
for (const dir of APPLY_DIRS) {
  try {
    for await (const file of walk(dir)) applyFiles.add(file)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") continue
    throw error
  }
}

let changedFiles = 0
for (const file of applyFiles) {
  const path = join(root, file)
  const before = await readFile(path, "utf8")
  const after = rewriteSource(before, renames)
  if (after !== before) {
    await writeFile(path, after)
    changedFiles += 1
  }
}

console.log(`identifiers renamed: ${renames.length}`)
console.log(`files rewritten: ${changedFiles}`)
console.log(`scanned apply files: ${applyFiles.size}`)
console.log("next: typecheck canvas/project/desktop/api and fix remaining gate hits")
