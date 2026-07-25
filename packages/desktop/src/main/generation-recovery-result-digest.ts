import { createHash } from "node:crypto"
import { constants, createReadStream } from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import type { McpToolCallResult } from "./stdio-mcp-client"

const maximumRecoveryArtifactBytes = 2 * 1024 * 1024 * 1024

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`
  }
  return JSON.stringify(value) ?? "null"
}

async function hashPinnedFile(filePath: string, outputDirectoryRealPath: string) {
  const realPath = await fs.realpath(filePath)
  const relative = path.relative(outputDirectoryRealPath, realPath)
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Generation recovery result escaped its output directory")
  }
  const handle = await fs.open(realPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const before = await handle.stat()
    if (!before.isFile() || before.size < 1 || before.size > maximumRecoveryArtifactBytes) {
      throw new Error("Generation recovery result file is invalid")
    }
    const digest = createHash("sha256")
    await new Promise<void>((resolve, reject) => {
      const stream = createReadStream("", { fd: handle.fd, autoClose: false, start: 0 })
      stream.on("data", (chunk) => digest.update(chunk))
      stream.once("error", reject)
      stream.once("end", resolve)
    })
    const after = await handle.stat()
    if (
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs
    ) {
      throw new Error("Generation recovery result file changed while it was verified")
    }
    return { relativePath: relative.split(path.sep).join("/"), sha256: digest.digest("hex"), size: before.size }
  } finally {
    await handle.close()
  }
}

function structuredArtifacts(value: unknown) {
  if (!isRecord(value) || !Array.isArray(value.artifacts)) return []
  return value.artifacts.flatMap((artifact) => {
    if (!isRecord(artifact) || typeof artifact.path !== "string") return []
    return [{
      mimeType: typeof artifact.mimeType === "string" ? artifact.mimeType : undefined,
      name: typeof artifact.name === "string" ? artifact.name : undefined,
      path: artifact.path,
    }]
  })
}

/**
 * Host-side digest of normalized MCP content and every staged artifact byte.
 * Sidecars declaring recovery must use the same canonical form for resultDigest.
 */
export async function generationRecoveryResultDigest(
  result: McpToolCallResult,
  outputDirectory: string,
) {
  const outputDirectoryRealPath = await fs.realpath(outputDirectory)
  const content = []
  for (const item of result.content) {
    if (item.type === "resource_link") {
      let filePath: string
      try {
        const url = new URL(item.uri)
        if (url.protocol !== "file:") throw new Error("not file")
        filePath = fileURLToPath(url)
      } catch {
        throw new Error("Generation recovery resource links must be local staged files")
      }
      content.push({
        file: await hashPinnedFile(filePath, outputDirectoryRealPath),
        mimeType: item.mimeType,
        name: item.name,
        type: item.type,
      })
    } else {
      content.push(item)
    }
  }
  const artifacts = []
  for (const artifact of structuredArtifacts(result.structuredContent)) {
    if (
      path.isAbsolute(artifact.path) ||
      artifact.path.includes("\\") ||
      artifact.path.split("/").some((segment) => !segment || segment === "." || segment === "..")
    ) {
      throw new Error("Generation recovery artifact path is invalid")
    }
    artifacts.push({
      file: await hashPinnedFile(path.join(outputDirectory, artifact.path), outputDirectoryRealPath),
      mimeType: artifact.mimeType,
      name: artifact.name,
      path: artifact.path,
    })
  }
  return createHash("sha256")
    .update(stableJson({
      content,
      ...(artifacts.length ? { artifacts } : {}),
      ...(result.isError === undefined ? {} : { isError: result.isError }),
    }))
    .digest("hex")
}
