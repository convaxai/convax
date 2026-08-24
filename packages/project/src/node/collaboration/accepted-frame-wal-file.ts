import { createHash } from "node:crypto"
import { constants, type BigIntStats } from "node:fs"
import fs from "node:fs/promises"

const HEADER_MAGIC = Buffer.from("CVXAWL01", "ascii")
const RECORD_MAGIC = Buffer.from("CVXAWREC", "ascii")
const HEADER_PREFIX_BYTES = 44
const RECORD_PREFIX_BYTES = 24
const CHECKSUM_BYTES = 32
const MAX_HEADER_BYTES = 1024 * 1024
const MAX_FRAME_BYTES = 2 * 1024 * 1024
const MAX_STATE_VECTOR_BYTES = 1024 * 1024

export interface AcceptedFrameWalFileEntry {
  readonly byteOffset: number
  readonly byteLength: number
  readonly headerBytes: Uint8Array
  readonly exactFrameByteOffset: number
  readonly exactFrameByteLength: number
  readonly stateVectorBytes: Uint8Array
  readonly checksum: string
}

export interface AcceptedFrameWalFileScan {
  readonly headerBytes: Uint8Array
  readonly headerByteLength: number
  readonly validByteLength: number
  readonly repairedTruncatedTail: boolean
  readonly entries: readonly AcceptedFrameWalFileEntry[]
}

export function encodeAcceptedFrameWalHeader(headerBytes: Readonly<Uint8Array>): Uint8Array {
  requireBoundedBytes(headerBytes, 1, MAX_HEADER_BYTES, "Accepted-frame WAL header")
  const envelope = new Uint8Array(HEADER_PREFIX_BYTES + headerBytes.byteLength)
  envelope.set(HEADER_MAGIC, 0)
  new DataView(envelope.buffer).setUint32(8, headerBytes.byteLength, false)
  envelope.set(digestBytes(headerBytes), 12)
  envelope.set(headerBytes, HEADER_PREFIX_BYTES)
  return envelope
}

export function encodeAcceptedFrameWalRecord(input: Readonly<{
  headerBytes: Readonly<Uint8Array>
  exactFrameBytes: Readonly<Uint8Array>
  stateVectorBytes: Readonly<Uint8Array>
}>): Uint8Array {
  requireBoundedBytes(input.headerBytes, 1, MAX_HEADER_BYTES, "Accepted-frame WAL record header")
  requireBoundedBytes(input.exactFrameBytes, 0, MAX_FRAME_BYTES, "Accepted-frame WAL exact frame")
  requireBoundedBytes(input.stateVectorBytes, 0, MAX_STATE_VECTOR_BYTES, "Accepted-frame WAL state vector")
  const totalLength = RECORD_PREFIX_BYTES + input.headerBytes.byteLength + input.exactFrameBytes.byteLength
    + input.stateVectorBytes.byteLength + CHECKSUM_BYTES
  const envelope = new Uint8Array(totalLength)
  envelope.set(RECORD_MAGIC, 0)
  const view = new DataView(envelope.buffer)
  view.setUint32(8, totalLength, false)
  view.setUint32(12, input.headerBytes.byteLength, false)
  view.setUint32(16, input.exactFrameBytes.byteLength, false)
  view.setUint32(20, input.stateVectorBytes.byteLength, false)
  let offset = RECORD_PREFIX_BYTES
  envelope.set(input.headerBytes, offset)
  offset += input.headerBytes.byteLength
  envelope.set(input.exactFrameBytes, offset)
  offset += input.exactFrameBytes.byteLength
  envelope.set(input.stateVectorBytes, offset)
  envelope.set(digestBytes(envelope.subarray(0, totalLength - CHECKSUM_BYTES)), totalLength - CHECKSUM_BYTES)
  return envelope
}

export function describeAcceptedFrameWalRecord(
  exactRecordBytes: Readonly<Uint8Array>,
  byteOffset: number,
): AcceptedFrameWalFileEntry {
  requireBoundedBytes(exactRecordBytes, RECORD_PREFIX_BYTES + CHECKSUM_BYTES + 3, 5 * 1024 * 1024, "Accepted-frame WAL record")
  if (!Buffer.from(exactRecordBytes.subarray(0, 8)).equals(RECORD_MAGIC)) {
    throw new TypeError("Accepted-frame WAL record magic is invalid")
  }
  const view = new DataView(exactRecordBytes.buffer, exactRecordBytes.byteOffset, exactRecordBytes.byteLength)
  const totalLength = view.getUint32(8, false)
  const headerLength = view.getUint32(12, false)
  const frameLength = view.getUint32(16, false)
  const stateVectorLength = view.getUint32(20, false)
  if (
    totalLength !== exactRecordBytes.byteLength ||
    totalLength !== RECORD_PREFIX_BYTES + headerLength + frameLength + stateVectorLength + CHECKSUM_BYTES
  ) throw new TypeError("Accepted-frame WAL record length is invalid")
  const checksumOffset = totalLength - CHECKSUM_BYTES
  const checksum = digestBytes(exactRecordBytes.subarray(0, checksumOffset))
  if (!sameBytes(checksum, exactRecordBytes.subarray(checksumOffset))) {
    throw new TypeError("Accepted-frame WAL record checksum mismatches")
  }
  const stateVectorOffset = RECORD_PREFIX_BYTES + headerLength + frameLength
  return Object.freeze({
    byteOffset,
    byteLength: totalLength,
    headerBytes: Uint8Array.from(exactRecordBytes.subarray(RECORD_PREFIX_BYTES, RECORD_PREFIX_BYTES + headerLength)),
    exactFrameByteOffset: byteOffset + RECORD_PREFIX_BYTES + headerLength,
    exactFrameByteLength: frameLength,
    stateVectorBytes: Uint8Array.from(exactRecordBytes.subarray(stateVectorOffset, stateVectorOffset + stateVectorLength)),
    checksum: Buffer.from(checksum).toString("hex"),
  })
}

export async function createAcceptedFrameWalFile(
  target: string,
  headerBytes: Readonly<Uint8Array>,
): Promise<void> {
  const handle = await fs.open(
    target,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollowFlag(),
    0o600,
  )
  try {
    const opened = await handle.stat({ bigint: true })
    if (!opened.isFile() || opened.nlink !== 1n) throw new TypeError("Accepted-frame WAL target is not a private regular file")
    await handle.writeFile(encodeAcceptedFrameWalHeader(headerBytes))
    await handle.sync()
    await assertWalPathIdentity(target, handle, opened)
  } finally {
    await handle.close()
  }
}

export async function scanAcceptedFrameWalFile(
  target: string,
  options: Readonly<{ repairTruncatedTail: boolean }>,
): Promise<AcceptedFrameWalFileScan> {
  const opened = await openWalNoFollow(target, options.repairTruncatedTail)
  const { handle, identity } = opened
  try {
    const stat = await handle.stat()
    if (!stat.isFile() || stat.size < HEADER_PREFIX_BYTES) throw new TypeError("Accepted-frame WAL file is invalid")
    const headerPrefix = await readExact(handle, HEADER_PREFIX_BYTES, 0)
    if (!Buffer.from(headerPrefix.subarray(0, 8)).equals(HEADER_MAGIC)) {
      throw new TypeError("Accepted-frame WAL header magic is invalid")
    }
    const headerLength = new DataView(headerPrefix.buffer, headerPrefix.byteOffset, headerPrefix.byteLength).getUint32(8, false)
    if (headerLength < 1 || headerLength > MAX_HEADER_BYTES || HEADER_PREFIX_BYTES + headerLength > stat.size) {
      throw new TypeError("Accepted-frame WAL header length is invalid")
    }
    const headerBytes = await readExact(handle, headerLength, HEADER_PREFIX_BYTES)
    if (!sameBytes(digestBytes(headerBytes), headerPrefix.subarray(12, 44))) {
      throw new TypeError("Accepted-frame WAL header checksum mismatches")
    }
    const entries: AcceptedFrameWalFileEntry[] = []
    let offset = HEADER_PREFIX_BYTES + headerLength
    let truncated = false
    while (offset < stat.size) {
      const remaining = stat.size - offset
      if (remaining < RECORD_PREFIX_BYTES) {
        truncated = true
        break
      }
      const prefix = await readExact(handle, RECORD_PREFIX_BYTES, offset)
      if (!Buffer.from(prefix.subarray(0, 8)).equals(RECORD_MAGIC)) {
        throw new TypeError("Accepted-frame WAL record magic is invalid")
      }
      const view = new DataView(prefix.buffer, prefix.byteOffset, prefix.byteLength)
      const totalLength = view.getUint32(8, false)
      const recordHeaderLength = view.getUint32(12, false)
      const frameLength = view.getUint32(16, false)
      const stateVectorLength = view.getUint32(20, false)
      const expectedLength = RECORD_PREFIX_BYTES + recordHeaderLength + frameLength + stateVectorLength + CHECKSUM_BYTES
      if (
        totalLength !== expectedLength || recordHeaderLength < 1 || recordHeaderLength > MAX_HEADER_BYTES ||
        frameLength > MAX_FRAME_BYTES || stateVectorLength > MAX_STATE_VECTOR_BYTES
      ) {
        throw new TypeError("Accepted-frame WAL record lengths are invalid")
      }
      if (remaining < totalLength) {
        truncated = true
        break
      }
      const body = await readExact(handle, totalLength - RECORD_PREFIX_BYTES, offset + RECORD_PREFIX_BYTES)
      const checksumOffset = body.byteLength - CHECKSUM_BYTES
      const hashed = createHash("sha256").update(prefix).update(body.subarray(0, checksumOffset)).digest()
      if (!sameBytes(hashed, body.subarray(checksumOffset))) {
        throw new TypeError("Accepted-frame WAL record checksum mismatches")
      }
      const exactFrameByteOffset = offset + RECORD_PREFIX_BYTES + recordHeaderLength
      const vectorOffset = recordHeaderLength + frameLength
      entries.push(Object.freeze({
        byteOffset: offset,
        byteLength: totalLength,
        headerBytes: Uint8Array.from(body.subarray(0, recordHeaderLength)),
        exactFrameByteOffset,
        exactFrameByteLength: frameLength,
        stateVectorBytes: Uint8Array.from(body.subarray(vectorOffset, vectorOffset + stateVectorLength)),
        checksum: Buffer.from(body.subarray(checksumOffset)).toString("hex"),
      }))
      offset += totalLength
    }
    if (truncated && options.repairTruncatedTail) {
      await handle.truncate(offset)
      await handle.sync()
    }
    await assertWalPathIdentity(target, handle, identity)
    return Object.freeze({
      headerBytes,
      headerByteLength: HEADER_PREFIX_BYTES + headerLength,
      validByteLength: offset,
      repairedTruncatedTail: truncated && options.repairTruncatedTail,
      entries: Object.freeze(entries),
    })
  } finally {
    await handle.close()
  }
}

export async function appendAcceptedFrameWalRecord(input: Readonly<{
  target: string
  expectedByteOffset: number
  exactRecordBytes: Readonly<Uint8Array>
  beforeSync?: () => Promise<void>
  afterSync?: () => Promise<void>
  sync?: (operation: () => Promise<void>) => Promise<void>
}>): Promise<void> {
  const opened = await openWalNoFollow(input.target, true)
  const { handle, identity } = opened
  let synced = false
  let repairedBeforeSync = false
  try {
    const stat = await handle.stat()
    if (stat.size !== input.expectedByteOffset) throw new TypeError("Accepted-frame WAL tail changed before append")
    await writeExact(handle, input.exactRecordBytes, input.expectedByteOffset)
    try {
      await input.beforeSync?.()
    } catch (error) {
      await handle.truncate(input.expectedByteOffset)
      await handle.sync()
      repairedBeforeSync = true
      throw error
    }
    await (input.sync ? input.sync(() => handle.sync()) : handle.sync())
    synced = true
    await assertWalPathIdentity(input.target, handle, identity)
    await input.afterSync?.()
  } catch (error) {
    if (synced) throw error
    if (repairedBeforeSync) throw error
    try {
      // Resolve ambiguous write/fsync failures inside the atomic port. A complete
      // record is promoted by a second sync; otherwise the old valid tail is
      // restored and synced before rejection escapes.
      const stat = await handle.stat()
      if (stat.size === input.expectedByteOffset + input.exactRecordBytes.byteLength) {
        const written = await readExact(handle, input.exactRecordBytes.byteLength, input.expectedByteOffset)
        if (sameBytes(written, input.exactRecordBytes)) {
          await handle.sync()
          synced = true
          return
        }
      }
      await handle.truncate(input.expectedByteOffset)
      await handle.sync()
    } catch (recoveryError) {
      if (synced) throw error
      throw recoveryError
    }
    throw error
  } finally {
    await handle.close()
  }
}

export async function readAcceptedFrameWalBytes(
  target: string,
  offset: number,
  byteLength: number,
): Promise<Uint8Array> {
  const opened = await openWalNoFollow(target, false)
  const { handle, identity } = opened
  try {
    const result = await readExact(handle, byteLength, offset)
    await assertWalPathIdentity(target, handle, identity)
    return result
  } finally {
    await handle.close()
  }
}

async function openWalNoFollow(
  target: string,
  writable: boolean,
): Promise<Readonly<{ handle: fs.FileHandle; identity: BigIntStats }>> {
  const before = await fs.lstat(target, { bigint: true })
  if (!before.isFile() || before.isSymbolicLink()) {
    throw new TypeError("Accepted-frame WAL path is not a regular file")
  }
  const handle = await fs.open(
    target,
    (writable ? constants.O_RDWR : constants.O_RDONLY) | noFollowFlag(),
  )
  try {
    const opened = await handle.stat({ bigint: true })
    const afterOpen = await fs.lstat(target, { bigint: true })
    if (
      !opened.isFile() || opened.nlink !== 1n ||
      afterOpen.isSymbolicLink() ||
      !sameIdentity(before, opened) ||
      !sameIdentity(opened, afterOpen)
    ) throw new TypeError("Accepted-frame WAL identity changed while opening")
    return Object.freeze({ handle, identity: opened })
  } catch (error) {
    await handle.close().catch(() => undefined)
    throw error
  }
}

async function assertWalPathIdentity(
  target: string,
  handle: fs.FileHandle,
  expected: BigIntStats,
): Promise<void> {
  const opened = await handle.stat({ bigint: true })
  const current = await fs.lstat(target, { bigint: true })
  if (
    !opened.isFile() || opened.nlink !== 1n ||
    current.isSymbolicLink() ||
    !sameIdentity(expected, opened) ||
    !sameIdentity(opened, current)
  ) throw new TypeError("Accepted-frame WAL path identity changed during I/O")
}

function sameIdentity(left: BigIntStats, right: BigIntStats): boolean {
  return left.dev === right.dev && left.ino === right.ino
}

function noFollowFlag(): number {
  return process.platform === "win32" ? 0 : constants.O_NOFOLLOW
}

async function readExact(handle: fs.FileHandle, byteLength: number, position: number): Promise<Uint8Array> {
  const bytes = new Uint8Array(byteLength)
  let offset = 0
  while (offset < byteLength) {
    const { bytesRead } = await handle.read(bytes, offset, byteLength - offset, position + offset)
    if (bytesRead < 1) throw new TypeError("Accepted-frame WAL ended unexpectedly")
    offset += bytesRead
  }
  return bytes
}

async function writeExact(handle: fs.FileHandle, value: Readonly<Uint8Array>, position: number): Promise<void> {
  const bytes = new Uint8Array(value)
  let offset = 0
  while (offset < bytes.byteLength) {
    const { bytesWritten } = await handle.write(bytes, offset, bytes.byteLength - offset, position + offset)
    if (bytesWritten < 1) throw new TypeError("Accepted-frame WAL write made no progress")
    offset += bytesWritten
  }
}

function requireBoundedBytes(value: Readonly<Uint8Array>, minimum: number, maximum: number, label: string): void {
  if (!(value instanceof Uint8Array) || value.byteLength < minimum || value.byteLength > maximum) {
    throw new TypeError(`${label} bytes are outside bounds`)
  }
}

function digestBytes(bytes: Readonly<Uint8Array>): Uint8Array {
  return createHash("sha256").update(bytes).digest()
}

function sameBytes(left: Readonly<Uint8Array>, right: Readonly<Uint8Array>): boolean {
  return left.byteLength === right.byteLength && left.every((value, index) => value === right[index])
}
