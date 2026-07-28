import { canonicalJson, sha256Hex } from "./canonical"
import { parseBuiltinBundle, type BuiltinArtifactDelivery, type BuiltinBundle } from "./schemas"

const MAX_ARCHIVE_BYTES = 128 * 1024 * 1024
const MAX_TOTAL_ENTRY_BYTES = 120 * 1024 * 1024
const MAX_ARCHIVE_ENTRIES = 512
const MAX_MANIFEST_BYTES = 1024 * 1024
const SAFE_ARCHIVE_PATH = /^([A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+$/

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index++) {
    let value = index
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    table[index] = value >>> 0
  }
  return table
})()

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function uint16(view: DataView, offset: number, label: string): number {
  if (offset < 0 || offset + 2 > view.byteLength) throw new TypeError(`Builtin ZIP ${label} is truncated`)
  return view.getUint16(offset, true)
}

function uint32(view: DataView, offset: number, label: string): number {
  if (offset < 0 || offset + 4 > view.byteLength) throw new TypeError(`Builtin ZIP ${label} is truncated`)
  return view.getUint32(offset, true)
}

function decodeName(bytes: Uint8Array): string {
  let name: string
  try {
    name = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  } catch {
    throw new TypeError("Builtin ZIP entry name is not valid UTF-8")
  }
  if (
    !name ||
    name.length > 256 ||
    !SAFE_ARCHIVE_PATH.test(name) ||
    name.split("/").some((segment) => segment === "..")
  ) {
    throw new TypeError(`Builtin ZIP entry path is unsafe: ${name}`)
  }
  return name
}

function compareAscii(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function parseBuiltinBundleArchiveWithEntries(
  archive: Uint8Array,
  limits: { maxTotalEntryBytes?: number } = {},
): { bundle: BuiltinBundle; entries: ReadonlyMap<string, Uint8Array> } {
  const maxTotalEntryBytes = limits.maxTotalEntryBytes ?? MAX_TOTAL_ENTRY_BYTES
  if (
    !Number.isSafeInteger(maxTotalEntryBytes) ||
    maxTotalEntryBytes < 1 ||
    maxTotalEntryBytes > MAX_TOTAL_ENTRY_BYTES
  ) {
    throw new TypeError("Builtin ZIP aggregate byte budget must be a positive bounded integer")
  }
  if (archive.byteLength < 22 || archive.byteLength > MAX_ARCHIVE_BYTES) {
    throw new TypeError("Builtin ZIP exceeds its bounded archive size")
  }
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength)
  const eocdOffset = archive.byteLength - 22
  if (uint32(view, eocdOffset, "EOCD signature") !== 0x06054b50) {
    throw new TypeError("Builtin ZIP must end with an exact EOCD")
  }
  const disk = uint16(view, eocdOffset + 4, "disk")
  const centralDisk = uint16(view, eocdOffset + 6, "central disk")
  const diskEntries = uint16(view, eocdOffset + 8, "disk entry count")
  const entryCount = uint16(view, eocdOffset + 10, "entry count")
  const centralSize = uint32(view, eocdOffset + 12, "central size")
  const centralOffset = uint32(view, eocdOffset + 16, "central offset")
  const commentLength = uint16(view, eocdOffset + 20, "comment length")
  if (
    disk !== 0 ||
    centralDisk !== 0 ||
    diskEntries !== entryCount ||
    entryCount < 1 ||
    entryCount > MAX_ARCHIVE_ENTRIES ||
    commentLength !== 0 ||
    centralOffset + centralSize !== eocdOffset
  ) {
    throw new TypeError("Builtin ZIP has unsupported multi-disk, count, comment, or central-directory shape")
  }

  const entries = new Map<string, Uint8Array>()
  const caseFoldedPaths = new Set<string>()
  let centralCursor = centralOffset
  let localCursor = 0
  let previousName = ""
  let totalEntryBytes = 0
  for (let index = 0; index < entryCount; index++) {
    if (uint32(view, centralCursor, "central signature") !== 0x02014b50) {
      throw new TypeError("Builtin ZIP central directory is malformed")
    }
    const versionMadeBy = uint16(view, centralCursor + 4, "central version made by")
    const versionNeeded = uint16(view, centralCursor + 6, "central version needed")
    const flags = uint16(view, centralCursor + 8, "central flags")
    const method = uint16(view, centralCursor + 10, "central method")
    const modifiedTime = uint16(view, centralCursor + 12, "central modified time")
    const modifiedDate = uint16(view, centralCursor + 14, "central modified date")
    const crc = uint32(view, centralCursor + 16, "central CRC")
    const compressedSize = uint32(view, centralCursor + 20, "central compressed size")
    const size = uint32(view, centralCursor + 24, "central size")
    const nameLength = uint16(view, centralCursor + 28, "central name length")
    const extraLength = uint16(view, centralCursor + 30, "central extra length")
    const entryCommentLength = uint16(view, centralCursor + 32, "central comment length")
    const entryDisk = uint16(view, centralCursor + 34, "central disk start")
    const internalAttributes = uint16(view, centralCursor + 36, "central internal attributes")
    const externalAttributes = uint32(view, centralCursor + 38, "central external attributes")
    const localOffset = uint32(view, centralCursor + 42, "local offset")
    const centralEnd = centralCursor + 46 + nameLength + extraLength + entryCommentLength
    if (
      versionMadeBy !== 0x031e ||
      versionNeeded !== 20 ||
      flags !== 0x0800 ||
      method !== 0 ||
      modifiedTime !== 0 ||
      modifiedDate !== 33 ||
      compressedSize !== size ||
      size > MAX_ARCHIVE_BYTES ||
      nameLength < 1 ||
      extraLength !== 0 ||
      entryCommentLength !== 0 ||
      entryDisk !== 0 ||
      internalAttributes !== 0 ||
      (externalAttributes !== 0o644 << 16 && externalAttributes !== 0o755 << 16) ||
      centralEnd > eocdOffset
    ) {
      throw new TypeError("Builtin ZIP admits only bounded deterministic stored entries")
    }
    const nameBytes = archive.subarray(centralCursor + 46, centralCursor + 46 + nameLength)
    const name = decodeName(nameBytes)
    if (entries.has(name) || (previousName && compareAscii(previousName, name) >= 0)) {
      throw new TypeError("Builtin ZIP entries must be unique and canonically ordered")
    }
    const caseFoldedPath = name.toLocaleLowerCase("en-US")
    if (caseFoldedPaths.has(caseFoldedPath)) {
      throw new TypeError("Builtin ZIP entry paths must be unique on case-insensitive filesystems")
    }
    caseFoldedPaths.add(caseFoldedPath)
    previousName = name
    if (localOffset !== localCursor || uint32(view, localOffset, "local signature") !== 0x04034b50) {
      throw new TypeError("Builtin ZIP local records must be contiguous and match the central directory")
    }
    const localVersionNeeded = uint16(view, localOffset + 4, "local version needed")
    const localFlags = uint16(view, localOffset + 6, "local flags")
    const localMethod = uint16(view, localOffset + 8, "local method")
    const localModifiedTime = uint16(view, localOffset + 10, "local modified time")
    const localModifiedDate = uint16(view, localOffset + 12, "local modified date")
    const localCrc = uint32(view, localOffset + 14, "local CRC")
    const localCompressedSize = uint32(view, localOffset + 18, "local compressed size")
    const localSize = uint32(view, localOffset + 22, "local size")
    const localNameLength = uint16(view, localOffset + 26, "local name length")
    const localExtraLength = uint16(view, localOffset + 28, "local extra length")
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength
    const dataEnd = dataOffset + size
    if (
      localVersionNeeded !== versionNeeded ||
      localFlags !== flags ||
      localMethod !== method ||
      localModifiedTime !== modifiedTime ||
      localModifiedDate !== modifiedDate ||
      localCrc !== crc ||
      localCompressedSize !== compressedSize ||
      localSize !== size ||
      localNameLength !== nameLength ||
      localExtraLength !== 0 ||
      dataEnd > centralOffset
    ) {
      throw new TypeError("Builtin ZIP local entry metadata does not match its central entry")
    }
    const localName = archive.subarray(localOffset + 30, localOffset + 30 + localNameLength)
    if (!localName.every((byte, byteIndex) => byte === nameBytes[byteIndex])) {
      throw new TypeError("Builtin ZIP local entry name does not match its central entry")
    }
    const data = archive.subarray(dataOffset, dataEnd)
    if (crc32(data) !== crc) throw new TypeError(`Builtin ZIP CRC mismatch for ${name}`)
    totalEntryBytes += data.byteLength
    if (totalEntryBytes > maxTotalEntryBytes) {
      throw new TypeError("Builtin ZIP aggregate uncompressed bytes exceed the archive budget")
    }
    entries.set(name, data)
    localCursor = dataEnd
    centralCursor = centralEnd
  }
  if (centralCursor !== eocdOffset || localCursor !== centralOffset) {
    throw new TypeError("Builtin ZIP contains unindexed or trailing entry bytes")
  }
  const manifestBytes = entries.get("bundle.json")
  if (!manifestBytes || manifestBytes.byteLength > MAX_MANIFEST_BYTES) {
    throw new TypeError("Builtin ZIP must contain one bounded bundle.json")
  }
  let manifestValue: unknown
  try {
    manifestValue = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(manifestBytes))
  } catch {
    throw new TypeError("Builtin bundle.json is not valid UTF-8 JSON")
  }
  const bundle = parseBuiltinBundle(manifestValue)
  const canonicalManifestBytes = new TextEncoder().encode(`${canonicalJson(bundle)}\n`)
  if (
    manifestBytes.byteLength !== canonicalManifestBytes.byteLength ||
    !manifestBytes.every((byte, index) => byte === canonicalManifestBytes[index])
  ) {
    throw new TypeError("Builtin bundle.json must use the exact canonical JSON encoding")
  }
  const declaredPaths = new Set(["bundle.json"])
  for (const member of bundle.members) {
    const assets = [
      member.artifact,
      member.presentation.poster,
      ...(member.presentation.animation ? [member.presentation.animation] : []),
    ]
    for (const asset of assets) {
      const bytes = entries.get(asset.path)
      if (!bytes || bytes.byteLength !== asset.size || sha256Hex(bytes) !== asset.sha256) {
        throw new TypeError(`Builtin bundle asset does not match bundle.json: ${asset.path}`)
      }
      declaredPaths.add(asset.path)
    }
  }
  if (declaredPaths.size !== entries.size || [...entries.keys()].some((path) => !declaredPaths.has(path))) {
    throw new TypeError("Builtin ZIP contains assets not declared by bundle.json")
  }
  return { bundle, entries }
}

export function parseBuiltinBundleArchive(
  archive: Uint8Array,
  limits: { maxTotalEntryBytes?: number } = {},
): BuiltinBundle {
  return parseBuiltinBundleArchiveWithEntries(archive, limits).bundle
}

export function readBuiltinBundleMember(archive: Uint8Array, delivery: BuiltinArtifactDelivery): Uint8Array {
  const { bundle, entries } = parseBuiltinBundleArchiveWithEntries(archive)
  if (delivery.bundleReleaseId !== bundle.release.id) {
    throw new TypeError("Builtin delivery belongs to another bundle release")
  }
  const member = bundle.members.find(
    (candidate) =>
      candidate.artifact.path === delivery.path &&
      candidate.artifact.size === delivery.size &&
      candidate.artifact.sha256 === delivery.sha256,
  )
  if (!member) {
    const pathMatch = bundle.members.find((candidate) => candidate.artifact.path === delivery.path)
    throw new TypeError(
      pathMatch
        ? "Builtin delivery size or SHA-256 does not match its verified bundle member"
        : "Builtin delivery path does not match a verified bundle member",
    )
  }
  const bytes = entries.get(delivery.path)
  if (!bytes) throw new TypeError("Builtin delivery member bytes are missing")
  return bytes.slice()
}

export function projectBuiltinMemberDelivery(
  bundle: BuiltinBundle,
  identity: { kind: "plugin" | "skill"; id: string },
): BuiltinArtifactDelivery {
  const member = bundle.members.find((candidate) => candidate.kind === identity.kind && candidate.id === identity.id)
  if (!member) throw new TypeError(`Builtin bundle does not contain ${identity.kind}/${identity.id}`)
  return {
    kind: "builtin-artifact",
    bundleReleaseId: bundle.release.id,
    path: member.artifact.path,
    size: member.artifact.size,
    sha256: member.artifact.sha256,
  }
}
