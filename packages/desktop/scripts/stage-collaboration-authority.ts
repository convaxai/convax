import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import {
  validateAuthorityReleaseSnapshotV1,
  validateSuccessorAuthorityReleaseSnapshotV1,
} from "@convax/collaboration"
import {
  ACTIVE_AUTHORITY_POINTER_PATH,
  AUTHORITY_SNAPSHOT_PATHS,
} from "../../../scripts/collaboration-authority-release"
import {
  V11_ACTIVE_AUTHORITY_POINTER_PATH,
  V11_REVIEWED_RELEASE_PATHS,
} from "../../../scripts/collaboration-authority-v11-release"

const desktopRoot = fileURLToPath(new URL("..", import.meta.url))
const repositoryRoot = path.resolve(desktopRoot, "../..")
const stagingRoot = path.join(desktopRoot, ".packaging", "collaboration-authority.next")
const publishedRoot = path.join(desktopRoot, ".packaging", "collaboration-authority")

const activePointerBytes = new Uint8Array(await fs.readFile(path.join(repositoryRoot, ACTIVE_AUTHORITY_POINTER_PATH)))
const successorPointerBytes = new Uint8Array(await fs.readFile(path.join(repositoryRoot, V11_ACTIVE_AUTHORITY_POINTER_PATH)))
const files = await Promise.all(AUTHORITY_SNAPSHOT_PATHS.map(async (relativePath) => ({
  path: relativePath,
  bytes: new Uint8Array(await fs.readFile(path.join(repositoryRoot, relativePath))),
})))
const successorFiles = await Promise.all(V11_REVIEWED_RELEASE_PATHS.map(async (relativePath) => ({
  path: relativePath,
  bytes: new Uint8Array(await fs.readFile(path.join(repositoryRoot, relativePath))),
})))

validateAuthorityReleaseSnapshotV1({ activePointerBytes, files })
validateSuccessorAuthorityReleaseSnapshotV1({ activePointerBytes: successorPointerBytes, files: successorFiles })

await fs.rm(stagingRoot, { force: true, recursive: true })
await fs.mkdir(stagingRoot, { recursive: true })
await writeStaged(ACTIVE_AUTHORITY_POINTER_PATH, activePointerBytes)
await writeStaged(V11_ACTIVE_AUTHORITY_POINTER_PATH, successorPointerBytes)
for (const file of files) await writeStaged(file.path, file.bytes)
for (const file of successorFiles) await writeStaged(file.path, file.bytes)

const previousRoot = `${publishedRoot}.previous`
await fs.rm(previousRoot, { force: true, recursive: true })
await fs.rename(publishedRoot, previousRoot).catch((error: unknown) => {
  if (!isMissing(error)) throw error
})
try {
  await fs.rename(stagingRoot, publishedRoot)
  await fs.rm(previousRoot, { force: true, recursive: true })
} catch (error) {
  await fs.rename(previousRoot, publishedRoot).catch(() => undefined)
  throw error
}

async function writeStaged(relativePath: string, bytes: Uint8Array): Promise<void> {
  const target = path.join(stagingRoot, relativePath)
  if (!target.startsWith(`${stagingRoot}${path.sep}`)) throw new Error("Collaboration authority staging path escapes")
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.writeFile(target, bytes, { mode: 0o644 })
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT"
}
