import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { CURRENT_PROTOCOL_DESCRIPTOR_FILE_NAME, parseCurrentProtocolDescriptor } from "@convax/collaboration"

const desktopRoot = fileURLToPath(new URL("..", import.meta.url))
const repositoryRoot = path.resolve(desktopRoot, "../..")
const descriptorSource = path.join(
  repositoryRoot,
  "packages",
  "collaboration",
  "protocol",
  CURRENT_PROTOCOL_DESCRIPTOR_FILE_NAME,
)
const stagingRoot = path.join(desktopRoot, ".packaging", "collaboration-protocol.next")
const publishedRoot = path.join(desktopRoot, ".packaging", "collaboration-protocol")

const descriptorBytes = new Uint8Array(await fs.readFile(descriptorSource))
parseCurrentProtocolDescriptor(descriptorBytes)

await fs.rm(stagingRoot, { force: true, recursive: true })
await fs.mkdir(stagingRoot, { recursive: true })
await fs.writeFile(path.join(stagingRoot, CURRENT_PROTOCOL_DESCRIPTOR_FILE_NAME), descriptorBytes, { mode: 0o644 })

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

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT"
}
