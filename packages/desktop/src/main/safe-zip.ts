import { inflateRawSync } from "node:zlib"

export interface SafeZipLimits {
  maxCompressionRatio?: number
  maxEntries?: number
  maxFileBytes?: number
  maxTotalBytes?: number
}

interface ResolvedSafeZipLimits {
  maxCompressionRatio: number
  maxEntries: number
  maxFileBytes: number
  maxTotalBytes: number
}

interface CentralEntry {
  compressedSize: number
  compressionMethod: number
  crc32: number
  externalAttributes: number
  flags: number
  isDirectory: boolean
  localHeaderOffset: number
  name: string
  nameBytes: Uint8Array
  uncompressedSize: number
  versionMadeBy: number
}

const defaultSafeZipLimits: ResolvedSafeZipLimits = {
  maxCompressionRatio: 200,
  maxEntries: 2_000,
  maxFileBytes: 16 * 1024 * 1024,
  maxTotalBytes: 64 * 1024 * 1024,
}

const endOfCentralDirectorySignature = 0x0605_4b50
const centralDirectorySignature = 0x0201_4b50
const localFileHeaderSignature = 0x0403_4b50
const utf8Flag = 0x0800
const dataDescriptorFlag = 0x0008
const encryptedFlag = 0x0001
const allowedGeneralPurposeFlags = utf8Flag | dataDescriptorFlag | 0x0006
const windowsReservedName = /^(CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³]|CONIN\$|CONOUT\$)$/i

const crcTable = new Uint32Array(256)
for (let index = 0; index < crcTable.length; index += 1) {
  let value = index
  for (let bit = 0; bit < 8; bit += 1) value = (value & 1) !== 0 ? 0xedb8_8320 ^ (value >>> 1) : value >>> 1
  crcTable[index] = value >>> 0
}

function crc32(bytes: Uint8Array) {
  let value = 0xffff_ffff
  for (const byte of bytes) value = crcTable[(value ^ byte) & 0xff]! ^ (value >>> 8)
  return (value ^ 0xffff_ffff) >>> 0
}

function resolveLimits(input: SafeZipLimits): ResolvedSafeZipLimits {
  const limits = { ...defaultSafeZipLimits, ...input }
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`ZIP ${name} must be a positive integer`)
  }
  if (limits.maxFileBytes > limits.maxTotalBytes) throw new Error("ZIP maxFileBytes cannot exceed maxTotalBytes")
  return limits
}

function dataView(bytes: Uint8Array) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

function checkedEnd(offset: number, length: number, boundary: number, label: string) {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0) {
    throw new Error(`${label} contains an invalid offset or length`)
  }
  const end = offset + length
  if (!Number.isSafeInteger(end) || end > boundary) throw new Error(`${label} is truncated`)
  return end
}

function findEndOfCentralDirectory(bytes: Uint8Array) {
  if (bytes.byteLength < 22) throw new Error("ZIP archive is missing its end-of-central-directory record")
  const view = dataView(bytes)
  const earliest = Math.max(0, bytes.byteLength - 22 - 0xffff)
  for (let offset = bytes.byteLength - 22; offset >= earliest; offset -= 1) {
    if (view.getUint32(offset, true) !== endOfCentralDirectorySignature) continue
    const commentLength = view.getUint16(offset + 20, true)
    if (offset + 22 + commentLength === bytes.byteLength) return offset
  }
  throw new Error("ZIP archive is missing a valid end-of-central-directory record")
}

function decodeEntryName(bytes: Uint8Array, flags: number) {
  if (bytes.byteLength === 0) throw new Error("ZIP entry name cannot be empty")
  if ((flags & utf8Flag) !== 0) {
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes)
    } catch {
      throw new Error("ZIP entry name is not valid UTF-8")
    }
  }
  if (bytes.some((byte) => byte > 0x7f)) {
    throw new Error("ZIP entry names must declare UTF-8 or contain ASCII only")
  }
  return String.fromCharCode(...bytes)
}

function validateSegment(segment: string) {
  const stem = segment.split(".")[0] ?? ""
  if (
    !segment ||
    segment.length > 255 ||
    segment === "." ||
    segment === ".." ||
    segment !== segment.normalize("NFC") ||
    /[\\/:*?"<>|\u0000-\u001f\u007f]/.test(segment) ||
    /[. ]$/.test(segment) ||
    windowsReservedName.test(stem)
  ) {
    throw new Error(`ZIP entry contains an unsafe portable path segment: ${segment}`)
  }
}

function validateEntryName(input: string) {
  if (input.length > 1_024 || input.includes("\\") || input.startsWith("/") || /^[A-Za-z]:/.test(input)) {
    throw new Error(`ZIP entry must use a portable relative path: ${input}`)
  }
  const isDirectory = input.endsWith("/")
  const name = isDirectory ? input.slice(0, -1) : input
  const segments = name.split("/")
  if (!name || segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error(`ZIP entry must use a portable relative path: ${input}`)
  }
  segments.forEach(validateSegment)
  return { isDirectory, name, segments }
}

function canonicalPath(segments: readonly string[]) {
  return segments.map((segment) => segment.normalize("NFC").toLocaleLowerCase("en-US")).join("/")
}

function validateUnixType(entry: CentralEntry) {
  const creatorSystem = entry.versionMadeBy >>> 8
  const dosDirectory = (entry.externalAttributes & 0x10) !== 0
  if (dosDirectory !== entry.isDirectory) {
    throw new Error(`ZIP directory attributes do not match its path: ${entry.name}`)
  }
  if (creatorSystem !== 3) return
  const unixType = (entry.externalAttributes >>> 16) & 0o170000
  if (unixType === 0) return
  if (unixType === 0o120000) throw new Error(`ZIP archive cannot contain symbolic links: ${entry.name}`)
  if (entry.isDirectory ? unixType !== 0o040000 : unixType !== 0o100000) {
    throw new Error(`ZIP archive contains an unsupported Unix file type: ${entry.name}`)
  }
}

function parseCentralEntries(bytes: Uint8Array, limits: ResolvedSafeZipLimits) {
  const view = dataView(bytes)
  const endOffset = findEndOfCentralDirectory(bytes)
  const diskNumber = view.getUint16(endOffset + 4, true)
  const centralDisk = view.getUint16(endOffset + 6, true)
  const entriesOnDisk = view.getUint16(endOffset + 8, true)
  const entryCount = view.getUint16(endOffset + 10, true)
  const centralSize = view.getUint32(endOffset + 12, true)
  const centralOffset = view.getUint32(endOffset + 16, true)
  if (diskNumber !== 0 || centralDisk !== 0 || entriesOnDisk !== entryCount) {
    throw new Error("Multi-disk ZIP archives are not supported")
  }
  if (entryCount === 0xffff || centralSize === 0xffff_ffff || centralOffset === 0xffff_ffff) {
    throw new Error("ZIP64 archives are not supported")
  }
  if (entryCount < 1 || entryCount > limits.maxEntries) throw new Error("ZIP archive exceeds the entry count limit")
  if (centralOffset + centralSize !== endOffset) throw new Error("ZIP central directory has an invalid boundary")

  const entries: CentralEntry[] = []
  let offset = centralOffset
  for (let index = 0; index < entryCount; index += 1) {
    checkedEnd(offset, 46, endOffset, "ZIP central directory entry")
    if (view.getUint32(offset, true) !== centralDirectorySignature) {
      throw new Error("ZIP central directory contains an invalid entry signature")
    }
    const flags = view.getUint16(offset + 8, true)
    if ((flags & encryptedFlag) !== 0) throw new Error("Encrypted ZIP entries are not supported")
    if ((flags & ~allowedGeneralPurposeFlags) !== 0) throw new Error("ZIP entry uses unsupported flags")
    const compressionMethod = view.getUint16(offset + 10, true)
    if (compressionMethod !== 0 && compressionMethod !== 8) {
      throw new Error(`ZIP entry uses an unsupported compression method: ${compressionMethod}`)
    }
    const compressedSize = view.getUint32(offset + 20, true)
    const uncompressedSize = view.getUint32(offset + 24, true)
    const nameLength = view.getUint16(offset + 28, true)
    const extraLength = view.getUint16(offset + 30, true)
    const commentLength = view.getUint16(offset + 32, true)
    const diskStart = view.getUint16(offset + 34, true)
    const localHeaderOffset = view.getUint32(offset + 42, true)
    if (
      compressedSize === 0xffff_ffff ||
      uncompressedSize === 0xffff_ffff ||
      localHeaderOffset === 0xffff_ffff ||
      diskStart === 0xffff
    ) {
      throw new Error("ZIP64 entries are not supported")
    }
    if (diskStart !== 0) throw new Error("Multi-disk ZIP entries are not supported")
    const entryEnd = checkedEnd(offset + 46, nameLength + extraLength + commentLength, endOffset, "ZIP central entry")
    const nameBytes = bytes.slice(offset + 46, offset + 46 + nameLength)
    const decodedName = decodeEntryName(nameBytes, flags)
    const validatedName = validateEntryName(decodedName)
    const entry: CentralEntry = {
      compressedSize,
      compressionMethod,
      crc32: view.getUint32(offset + 16, true),
      externalAttributes: view.getUint32(offset + 38, true),
      flags,
      isDirectory: validatedName.isDirectory,
      localHeaderOffset,
      name: validatedName.name,
      nameBytes,
      uncompressedSize,
      versionMadeBy: view.getUint16(offset + 4, true),
    }
    validateUnixType(entry)
    entries.push(entry)
    offset = entryEnd
  }
  if (offset !== endOffset) throw new Error("ZIP central directory entry count does not match its size")
  return { centralOffset, entries }
}

function bytesEqual(left: Uint8Array, right: Uint8Array) {
  if (left.byteLength !== right.byteLength) return false
  return left.every((value, index) => value === right[index])
}

function registerPortablePath(
  entry: CentralEntry,
  knownPaths: Map<string, { explicit: boolean; kind: "directory" | "file"; path: string }>,
) {
  const segments = entry.name.split("/")
  for (let index = 1; index <= segments.length; index += 1) {
    const path = segments.slice(0, index).join("/")
    const key = canonicalPath(segments.slice(0, index))
    const kind = index === segments.length && !entry.isDirectory ? "file" : "directory"
    const known = knownPaths.get(key)
    if (known) {
      if (known.path !== path) throw new Error(`ZIP entries collide on a case-insensitive filesystem: ${known.path}, ${path}`)
      if (known.kind !== kind) throw new Error(`ZIP entry is both a file and directory: ${path}`)
      if (index === segments.length) {
        if (kind === "file" || known.explicit) throw new Error(`ZIP archive contains a duplicate entry: ${path}`)
        known.explicit = true
      }
    } else {
      knownPaths.set(key, { explicit: index === segments.length, kind, path })
    }
  }
}

function readEntry(
  bytes: Uint8Array,
  entry: CentralEntry,
  centralOffset: number,
  ranges: Array<{ end: number; start: number }>,
) {
  const view = dataView(bytes)
  const offset = entry.localHeaderOffset
  checkedEnd(offset, 30, centralOffset, `ZIP local header for ${entry.name}`)
  if (view.getUint32(offset, true) !== localFileHeaderSignature) {
    throw new Error(`ZIP entry has an invalid local header: ${entry.name}`)
  }
  const localFlags = view.getUint16(offset + 6, true)
  const localMethod = view.getUint16(offset + 8, true)
  const nameLength = view.getUint16(offset + 26, true)
  const extraLength = view.getUint16(offset + 28, true)
  if (localFlags !== entry.flags || localMethod !== entry.compressionMethod) {
    throw new Error(`ZIP local header does not match the central directory: ${entry.name}`)
  }
  const localNameStart = offset + 30
  const dataStart = checkedEnd(localNameStart, nameLength + extraLength, centralOffset, `ZIP local header for ${entry.name}`)
  const localName = bytes.slice(localNameStart, localNameStart + nameLength)
  if (!bytesEqual(localName, entry.nameBytes)) throw new Error(`ZIP local entry name does not match: ${entry.name}`)
  if ((entry.flags & dataDescriptorFlag) === 0) {
    if (
      view.getUint32(offset + 14, true) !== entry.crc32 ||
      view.getUint32(offset + 18, true) !== entry.compressedSize ||
      view.getUint32(offset + 22, true) !== entry.uncompressedSize
    ) {
      throw new Error(`ZIP local entry sizes or checksum do not match: ${entry.name}`)
    }
  }
  const dataEnd = checkedEnd(dataStart, entry.compressedSize, centralOffset, `ZIP data for ${entry.name}`)
  ranges.push({ end: dataEnd, start: offset })
  return bytes.subarray(dataStart, dataEnd)
}

/**
 * Decode the deliberately small ZIP subset emitted by the official registry.
 * The archive is fully bounded and validated before any returned file can be
 * handed to a Plugin or Skill installer.
 */
export function unpackSafeZip(input: Uint8Array, limits: SafeZipLimits = {}): Readonly<Record<string, Uint8Array>> {
  if (!(input instanceof Uint8Array)) throw new Error("ZIP archive bytes are required")
  const resolvedLimits = resolveLimits(limits)
  const { centralOffset, entries } = parseCentralEntries(input, resolvedLimits)
  const knownPaths = new Map<string, { explicit: boolean; kind: "directory" | "file"; path: string }>()
  const ranges: Array<{ end: number; start: number }> = []
  const files: Record<string, Uint8Array> = Object.create(null) as Record<string, Uint8Array>
  let totalBytes = 0

  for (const entry of entries) {
    registerPortablePath(entry, knownPaths)
    if (entry.uncompressedSize > resolvedLimits.maxFileBytes) {
      throw new Error(`ZIP entry exceeds the per-file size limit: ${entry.name}`)
    }
    totalBytes += entry.uncompressedSize
    if (!Number.isSafeInteger(totalBytes) || totalBytes > resolvedLimits.maxTotalBytes) {
      throw new Error("ZIP archive exceeds the total expanded size limit")
    }
    if (
      entry.uncompressedSize > 0 &&
      (entry.compressedSize === 0 || entry.uncompressedSize / entry.compressedSize > resolvedLimits.maxCompressionRatio)
    ) {
      throw new Error(`ZIP entry exceeds the compression ratio limit: ${entry.name}`)
    }
    const compressed = readEntry(input, entry, centralOffset, ranges)
    if (entry.isDirectory) {
      if (entry.compressedSize !== 0 || entry.uncompressedSize !== 0 || entry.crc32 !== 0) {
        throw new Error(`ZIP directory entry must be empty: ${entry.name}`)
      }
      continue
    }
    let content: Uint8Array
    if (entry.compressionMethod === 0) {
      if (entry.compressedSize !== entry.uncompressedSize) throw new Error(`Stored ZIP entry has inconsistent sizes: ${entry.name}`)
      content = Uint8Array.from(compressed)
    } else {
      try {
        content = Uint8Array.from(inflateRawSync(compressed, { maxOutputLength: entry.uncompressedSize + 1 }))
      } catch {
        throw new Error(`ZIP entry contains invalid or oversized deflate data: ${entry.name}`)
      }
    }
    if (content.byteLength !== entry.uncompressedSize) throw new Error(`ZIP entry expanded to an unexpected size: ${entry.name}`)
    if (crc32(content) !== entry.crc32) throw new Error(`ZIP entry checksum does not match: ${entry.name}`)
    files[entry.name] = content
  }

  ranges.sort((left, right) => left.start - right.start)
  for (let index = 1; index < ranges.length; index += 1) {
    if (ranges[index]!.start < ranges[index - 1]!.end) throw new Error("ZIP local entries overlap")
  }
  if (Object.keys(files).length === 0) throw new Error("ZIP archive does not contain any files")
  return Object.freeze(files)
}
