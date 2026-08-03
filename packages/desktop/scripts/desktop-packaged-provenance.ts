import { createReadStream } from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"

export interface PackagedProvenanceFinding {
  file: string
  marker: string
}

function isOpenCodeRuntime(relativePath: string) {
  const normalized = relativePath.split(path.sep).join("/").toLowerCase()
  return (
    normalized === "contents/resources/opencode" ||
    normalized.startsWith("contents/resources/opencode/") ||
    normalized === "resources/opencode" ||
    normalized.startsWith("resources/opencode/")
  )
}

function asciiLowercase(value: Buffer) {
  const result = Buffer.from(value)
  for (let index = 0; index < result.length; index += 1) {
    const byte = result[index]!
    if (byte >= 65 && byte <= 90) result[index] = byte + 32
  }
  return result
}

function normalizeDenylist(values: readonly string[]) {
  if (values.length < 1 || values.length > 32) throw new Error("Packaged provenance denylist must contain 1-32 markers")
  const unique = [...new Set(values)]
  if (unique.length !== values.length) throw new Error("Packaged provenance denylist contains duplicate markers")
  return unique.map((value, index) => {
    if (value.length < 2 || value.length > 128 || value.includes("\0")) {
      throw new Error(`Packaged provenance marker ${index + 1} has an invalid length or NUL byte`)
    }
    return { label: `prohibited marker ${index + 1}`, value: asciiLowercase(Buffer.from(value)) }
  })
}

async function scanFile(
  filePath: string,
  relativePath: string,
  markers: ReturnType<typeof normalizeDenylist>,
  maximumMarkerLength: number,
  highWaterMark: number,
) {
  const findings: PackagedProvenanceFinding[] = []
  let carry = Buffer.alloc(0)
  for await (const chunk of createReadStream(filePath, { highWaterMark })) {
    const bytes = Buffer.concat([carry, Buffer.from(chunk)])
    const comparableBytes = asciiLowercase(bytes)
    for (const marker of markers) {
      if (comparableBytes.includes(marker.value) && !findings.some((finding) => finding.marker === marker.label)) {
        findings.push({ file: relativePath, marker: marker.label })
      }
    }
    const carryLength = Math.min(maximumMarkerLength - 1, bytes.length)
    carry = Buffer.from(bytes.subarray(bytes.length - carryLength))
  }
  return findings
}

export async function scanPackagedProvenance(root: string, denylist: readonly string[], highWaterMark = 64 * 1024) {
  const markers = normalizeDenylist(denylist)
  const maximumMarkerLength = Math.max(...markers.map((marker) => marker.value.length))
  const resolvedRoot = path.resolve(root)
  const rootStat = await fs.stat(resolvedRoot)
  if (!rootStat.isDirectory()) throw new Error(`Packaged provenance root is not a directory: ${resolvedRoot}`)

  const findings: PackagedProvenanceFinding[] = []
  const pending = [resolvedRoot]
  while (pending.length > 0) {
    const directory = pending.pop()!
    const entries = await fs.readdir(directory, { withFileTypes: true })
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name)
      const relativePath = path.relative(resolvedRoot, entryPath)
      if (isOpenCodeRuntime(relativePath)) continue
      if (entry.isDirectory()) {
        pending.push(entryPath)
      } else if (entry.isFile()) {
        findings.push(...(await scanFile(entryPath, relativePath, markers, maximumMarkerLength, highWaterMark)))
      }
    }
  }
  return findings.sort((left, right) => left.file.localeCompare(right.file) || left.marker.localeCompare(right.marker))
}

if (import.meta.main) {
  const root = Bun.argv[2]
  if (!root) throw new Error("Usage: bun desktop-packaged-provenance.ts <packaged-app-directory>")
  const encodedDenylist = process.env.CONVAX_PACKAGED_PROVENANCE_DENYLIST_B64
  if (!encodedDenylist) throw new Error("CONVAX_PACKAGED_PROVENANCE_DENYLIST_B64 is required")
  const denylist = JSON.parse(Buffer.from(encodedDenylist, "base64").toString("utf8"))
  if (!Array.isArray(denylist) || !denylist.every((value) => typeof value === "string")) {
    throw new Error("Packaged provenance denylist must decode to a JSON string array")
  }
  const findings = await scanPackagedProvenance(root, denylist)
  if (findings.length > 0) {
    for (const finding of findings) console.error(`${finding.file}: ${finding.marker}`)
    throw new Error(`Packaged application contains ${findings.length} prohibited provenance marker(s)`)
  }
  console.log(`Packaged provenance scan passed: ${path.resolve(root)}`)
}
