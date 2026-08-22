import type { ProjectCanvasMediaInspector } from "@convax/project/node"

const MAX_IMAGE_HEADER_SCAN_BYTES = 512 * 1_024
const MAX_ISO_BMFF_ATOM_COUNT = 4_096
const MAX_EBML_HEADER_SCAN_BYTES = 512 * 1_024
const MAX_EBML_ELEMENT_COUNT = 4_096

const EBML_HEADER_ID = 0x1a45dfa3
const EBML_SEGMENT_ID = 0x18538067
const EBML_TRACKS_ID = 0x1654ae6b
const EBML_TRACK_ENTRY_ID = 0xae
const EBML_TRACK_TYPE_ID = 0x83
const EBML_VIDEO_ID = 0xe0
const EBML_PIXEL_WIDTH_ID = 0xb0
const EBML_PIXEL_HEIGHT_ID = 0xba
const EBML_DISPLAY_WIDTH_ID = 0x54b0
const EBML_DISPLAY_HEIGHT_ID = 0x54ba
const EBML_DISPLAY_UNIT_ID = 0x54b2

interface ImageDimensions {
  readonly height: number
  readonly width: number
}

interface IsoBmffAtom {
  readonly dataOffset: number
  readonly end: number
  readonly type: string
}

interface EbmlElement {
  readonly dataOffset: number
  readonly end: number
  readonly id: number
  readonly unknownSize: boolean
}

interface EbmlElementState {
  elementCount: number
  readonly scanEnd: number
}

type EbmlTrackInspection = ImageDimensions | "malformed" | undefined

/** Main adapter: inspect admitted bytes without synchronously decoding the complete media. */
export function createProjectCanvasMediaInspector(): ProjectCanvasMediaInspector {
  return {
    async inspect(resource) {
      const dimensions =
        resource.kind === "video"
          ? inspectVideoDimensions(resource.bytes, resource.mimeType)
          : inspectImageDimensions(resource.bytes)
      return dimensions === undefined ? {} : Object.freeze(dimensions)
    },
  }
}

function inspectVideoDimensions(bytes: Uint8Array, mimeType: string): ImageDimensions | undefined {
  const normalizedMimeType = mimeType.split(";", 1)[0]?.trim().toLowerCase() ?? ""
  const hasEbmlSignature = bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3
  if (hasEbmlSignature || isEbmlVideoMimeType(normalizedMimeType)) {
    return inspectEbmlVideoDimensions(bytes)
  }
  return inspectIsoBmffVideoDimensions(bytes)
}

function isEbmlVideoMimeType(mimeType: string): boolean {
  return mimeType === "video/webm" || mimeType === "video/matroska" || mimeType === "video/x-matroska"
}

function inspectImageDimensions(bytes: Uint8Array): ImageDimensions | undefined {
  return inspectPng(bytes) ?? inspectJpeg(bytes) ?? inspectGif(bytes) ?? inspectWebp(bytes) ?? inspectBmp(bytes)
}

function inspectPng(bytes: Uint8Array): ImageDimensions | undefined {
  if (
    bytes.length < 24 ||
    bytes[0] !== 0x89 ||
    bytes[1] !== 0x50 ||
    bytes[2] !== 0x4e ||
    bytes[3] !== 0x47 ||
    bytes[4] !== 0x0d ||
    bytes[5] !== 0x0a ||
    bytes[6] !== 0x1a ||
    bytes[7] !== 0x0a ||
    readUint32BigEndian(bytes, 8) !== 13 ||
    !matchesAscii(bytes, 12, "IHDR")
  ) {
    return undefined
  }
  return dimensions(readUint32BigEndian(bytes, 16), readUint32BigEndian(bytes, 20))
}

function inspectJpeg(bytes: Uint8Array): ImageDimensions | undefined {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined

  const limit = Math.min(bytes.length, MAX_IMAGE_HEADER_SCAN_BYTES)
  let offset = 2
  while (offset < limit) {
    if (bytes[offset] !== 0xff) return undefined
    while (offset < limit && bytes[offset] === 0xff) offset += 1
    if (offset >= limit) return undefined

    const marker = bytes[offset]
    offset += 1
    if (marker === undefined || marker === 0x00 || marker === 0xd9 || marker === 0xda) return undefined
    if (marker === 0x01 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) continue
    if (offset + 2 > limit) return undefined

    const segmentLength = readUint16BigEndian(bytes, offset)
    if (segmentLength === undefined || segmentLength < 2) return undefined
    const segmentEnd = offset + segmentLength
    if (segmentEnd > limit) return undefined

    if (isJpegStartOfFrame(marker)) {
      if (segmentLength < 7) return undefined
      return dimensions(readUint16BigEndian(bytes, offset + 5), readUint16BigEndian(bytes, offset + 3))
    }
    offset = segmentEnd
  }
  return undefined
}

function inspectGif(bytes: Uint8Array): ImageDimensions | undefined {
  if (bytes.length < 10 || (!matchesAscii(bytes, 0, "GIF87a") && !matchesAscii(bytes, 0, "GIF89a"))) {
    return undefined
  }
  return dimensions(readUint16LittleEndian(bytes, 6), readUint16LittleEndian(bytes, 8))
}

function inspectWebp(bytes: Uint8Array): ImageDimensions | undefined {
  if (bytes.length < 20 || !matchesAscii(bytes, 0, "RIFF") || !matchesAscii(bytes, 8, "WEBP")) {
    return undefined
  }

  const riffPayloadLength = readUint32LittleEndian(bytes, 4)
  if (riffPayloadLength === undefined || riffPayloadLength < 12) return undefined
  const declaredEnd = riffPayloadLength + 8
  if (declaredEnd > bytes.length) return undefined

  const limit = Math.min(declaredEnd, MAX_IMAGE_HEADER_SCAN_BYTES)
  let offset = 12
  while (offset + 8 <= limit) {
    const chunkLength = readUint32LittleEndian(bytes, offset + 4)
    if (chunkLength === undefined) return undefined
    const dataOffset = offset + 8
    const dataEnd = dataOffset + chunkLength
    if (dataEnd > limit) return undefined

    if (matchesAscii(bytes, offset, "VP8X")) {
      if (chunkLength < 10) return undefined
      const width = readUint24LittleEndian(bytes, dataOffset + 4)
      const height = readUint24LittleEndian(bytes, dataOffset + 7)
      return width === undefined || height === undefined ? undefined : dimensions(width + 1, height + 1)
    }
    if (matchesAscii(bytes, offset, "VP8L")) {
      if (chunkLength < 5 || bytes[dataOffset] !== 0x2f) return undefined
      const first = bytes[dataOffset + 1]
      const second = bytes[dataOffset + 2]
      const third = bytes[dataOffset + 3]
      const fourth = bytes[dataOffset + 4]
      if (first === undefined || second === undefined || third === undefined || fourth === undefined) return undefined
      return dimensions(
        1 + first + ((second & 0x3f) << 8),
        1 + ((second & 0xc0) >> 6) + (third << 2) + ((fourth & 0x0f) << 10),
      )
    }
    if (matchesAscii(bytes, offset, "VP8 ")) {
      if (
        chunkLength < 10 ||
        bytes[dataOffset + 3] !== 0x9d ||
        bytes[dataOffset + 4] !== 0x01 ||
        bytes[dataOffset + 5] !== 0x2a
      ) {
        return undefined
      }
      const encodedWidth = readUint16LittleEndian(bytes, dataOffset + 6)
      const encodedHeight = readUint16LittleEndian(bytes, dataOffset + 8)
      return encodedWidth === undefined || encodedHeight === undefined
        ? undefined
        : dimensions(encodedWidth & 0x3fff, encodedHeight & 0x3fff)
    }

    const paddedChunkLength = chunkLength + (chunkLength & 1)
    const nextOffset = dataOffset + paddedChunkLength
    if (!Number.isSafeInteger(nextOffset) || nextOffset <= offset) return undefined
    offset = nextOffset
  }
  return undefined
}

function inspectBmp(bytes: Uint8Array): ImageDimensions | undefined {
  if (bytes.length < 26 || bytes[0] !== 0x42 || bytes[1] !== 0x4d) return undefined
  const dibHeaderLength = readUint32LittleEndian(bytes, 14)
  if (dibHeaderLength === 12) {
    return dimensions(readUint16LittleEndian(bytes, 18), readUint16LittleEndian(bytes, 20))
  }
  if (dibHeaderLength === undefined || dibHeaderLength < 40) return undefined

  const width = readInt32LittleEndian(bytes, 18)
  const encodedHeight = readInt32LittleEndian(bytes, 22)
  if (width === undefined || encodedHeight === undefined) return undefined
  return dimensions(width, Math.abs(encodedHeight))
}

function inspectEbmlVideoDimensions(bytes: Uint8Array): ImageDimensions | undefined {
  const state: EbmlElementState = {
    elementCount: 0,
    scanEnd: Math.min(bytes.length, MAX_EBML_HEADER_SCAN_BYTES),
  }
  const header = readEbmlElement(bytes, 0, bytes.length, state)
  if (header === undefined || header.id !== EBML_HEADER_ID || header.unknownSize || header.end > state.scanEnd) {
    return undefined
  }

  let offset = header.end
  while (offset < bytes.length && offset < state.scanEnd) {
    const element = readEbmlElement(bytes, offset, bytes.length, state)
    if (element === undefined) return undefined
    if (element.id === EBML_SEGMENT_ID) return inspectEbmlSegment(bytes, element, state)
    if (element.unknownSize) return undefined
    offset = element.end
  }
  return undefined
}

function inspectEbmlSegment(
  bytes: Uint8Array,
  segment: EbmlElement,
  state: EbmlElementState,
): ImageDimensions | undefined {
  let best: ImageDimensions | undefined
  let offset = segment.dataOffset
  while (offset < segment.end && offset < state.scanEnd) {
    const element = readEbmlElement(bytes, offset, segment.end, state)
    if (element === undefined) return undefined
    if (element.id === EBML_TRACKS_ID) {
      const candidate = inspectEbmlTracks(bytes, element, state)
      if (candidate === "malformed") return undefined
      if (candidate !== undefined && (best === undefined || area(candidate) > area(best))) best = candidate
    }
    offset = element.end
  }
  return best
}

function inspectEbmlTracks(bytes: Uint8Array, tracks: EbmlElement, state: EbmlElementState): EbmlTrackInspection {
  let best: ImageDimensions | undefined
  let offset = tracks.dataOffset
  while (offset < tracks.end && offset < state.scanEnd) {
    const element = readEbmlElement(bytes, offset, tracks.end, state)
    if (element === undefined) return "malformed"
    if (element.id === EBML_TRACK_ENTRY_ID) {
      const candidate = inspectEbmlTrackEntry(bytes, element, state)
      if (candidate === "malformed") return candidate
      if (candidate !== undefined && (best === undefined || area(candidate) > area(best))) best = candidate
    }
    offset = element.end
  }
  return best
}

function inspectEbmlTrackEntry(bytes: Uint8Array, track: EbmlElement, state: EbmlElementState): EbmlTrackInspection {
  let trackType: number | undefined
  let video: ImageDimensions | undefined
  let sawTrackType = false
  let sawVideo = false
  let offset = track.dataOffset
  while (offset < track.end && offset < state.scanEnd) {
    const element = readEbmlElement(bytes, offset, track.end, state)
    if (element === undefined) return "malformed"
    if (element.id === EBML_TRACK_TYPE_ID) {
      if (sawTrackType) return "malformed"
      sawTrackType = true
      trackType = readEbmlUnsignedInteger(bytes, element, state)
      if (trackType === undefined) return "malformed"
    } else if (element.id === EBML_VIDEO_ID) {
      if (sawVideo) return "malformed"
      sawVideo = true
      const candidate = inspectEbmlVideoElement(bytes, element, state)
      if (candidate === "malformed") return candidate
      video = candidate
    }
    offset = element.end
  }
  return trackType === 1 ? video : undefined
}

function inspectEbmlVideoElement(bytes: Uint8Array, video: EbmlElement, state: EbmlElementState): EbmlTrackInspection {
  let pixelWidth: number | undefined
  let pixelHeight: number | undefined
  let displayWidth: number | undefined
  let displayHeight: number | undefined
  let displayUnit: number | undefined
  const seen = new Set<number>()

  let offset = video.dataOffset
  while (offset < video.end && offset < state.scanEnd) {
    const element = readEbmlElement(bytes, offset, video.end, state)
    if (element === undefined) return "malformed"
    if (
      element.id === EBML_PIXEL_WIDTH_ID ||
      element.id === EBML_PIXEL_HEIGHT_ID ||
      element.id === EBML_DISPLAY_WIDTH_ID ||
      element.id === EBML_DISPLAY_HEIGHT_ID ||
      element.id === EBML_DISPLAY_UNIT_ID
    ) {
      if (seen.has(element.id)) return "malformed"
      seen.add(element.id)
      const value = readEbmlUnsignedInteger(bytes, element, state)
      if (value === undefined) return "malformed"
      if (element.id === EBML_PIXEL_WIDTH_ID) pixelWidth = value
      else if (element.id === EBML_PIXEL_HEIGHT_ID) pixelHeight = value
      else if (element.id === EBML_DISPLAY_WIDTH_ID) displayWidth = value
      else if (element.id === EBML_DISPLAY_HEIGHT_ID) displayHeight = value
      else displayUnit = value
    }
    offset = element.end
  }

  const pixelDimensions = dimensions(pixelWidth, pixelHeight)
  if (pixelDimensions === undefined) return undefined
  return displayUnit === undefined || displayUnit === 0
    ? dimensions(displayWidth ?? pixelDimensions.width, displayHeight ?? pixelDimensions.height)
    : pixelDimensions
}

function readEbmlElement(
  bytes: Uint8Array,
  offset: number,
  parentEnd: number,
  state: EbmlElementState,
): EbmlElement | undefined {
  state.elementCount += 1
  if (state.elementCount > MAX_EBML_ELEMENT_COUNT || offset < 0 || offset >= parentEnd) return undefined

  const id = readEbmlVariableInteger(bytes, offset, parentEnd, state.scanEnd, 4, true)
  if (id === undefined || id.unknown) return undefined
  const sizeOffset = offset + id.length
  const size = readEbmlVariableInteger(bytes, sizeOffset, parentEnd, state.scanEnd, 8, false)
  if (size === undefined) return undefined

  const dataOffset = sizeOffset + size.length
  const end = size.unknown ? parentEnd : dataOffset + size.value
  if (!Number.isSafeInteger(end) || end < dataOffset || end > parentEnd || end > bytes.length) return undefined
  return { dataOffset, end, id: id.value, unknownSize: size.unknown }
}

function readEbmlVariableInteger(
  bytes: Uint8Array,
  offset: number,
  parentEnd: number,
  scanEnd: number,
  maxLength: number,
  preserveMarker: boolean,
): { readonly length: number; readonly unknown: boolean; readonly value: number } | undefined {
  const limit = Math.min(bytes.length, parentEnd, scanEnd)
  const first = bytes[offset]
  if (first === undefined || offset < 0 || offset >= limit || first === 0) return undefined

  let length = 1
  let marker = 0x80
  while ((first & marker) === 0) {
    length += 1
    marker >>= 1
  }
  if (length > maxLength || offset + length > limit) return undefined

  const firstValue = first & (marker - 1)
  let allValueBitsSet = firstValue === marker - 1
  for (let index = 1; index < length; index += 1) {
    if (bytes[offset + index] !== 0xff) allValueBitsSet = false
  }
  if (!preserveMarker && allValueBitsSet) return { length, unknown: true, value: 0 }
  if (preserveMarker && allValueBitsSet) return undefined

  let value = preserveMarker ? first : firstValue
  for (let index = 1; index < length; index += 1) {
    value = value * 0x100 + (bytes[offset + index] ?? 0)
    if (!Number.isSafeInteger(value)) return undefined
  }
  return { length, unknown: false, value }
}

function readEbmlUnsignedInteger(bytes: Uint8Array, element: EbmlElement, state: EbmlElementState): number | undefined {
  const byteLength = element.end - element.dataOffset
  if (element.unknownSize || byteLength < 1 || byteLength > 8 || element.end > state.scanEnd) return undefined

  let value = 0
  for (let offset = element.dataOffset; offset < element.end; offset += 1) {
    value = value * 0x100 + (bytes[offset] ?? 0)
    if (!Number.isSafeInteger(value)) return undefined
  }
  return value
}

function inspectIsoBmffVideoDimensions(bytes: Uint8Array): ImageDimensions | undefined {
  const state = { atomCount: 0 }
  let best: ImageDimensions | undefined
  let offset = 0
  while (offset + 8 <= bytes.length) {
    const atom = readIsoBmffAtom(bytes, offset, bytes.length, state)
    if (atom === undefined) return best
    if (atom.type === "moov") {
      const candidate = inspectMovieAtom(bytes, atom, state)
      if (candidate !== undefined && (best === undefined || area(candidate) > area(best))) best = candidate
    }
    if (atom.end <= offset) return best
    offset = atom.end
  }
  return best
}

function inspectMovieAtom(
  bytes: Uint8Array,
  movie: IsoBmffAtom,
  state: { atomCount: number },
): ImageDimensions | undefined {
  let best: ImageDimensions | undefined
  let offset = movie.dataOffset
  while (offset + 8 <= movie.end) {
    const atom = readIsoBmffAtom(bytes, offset, movie.end, state)
    if (atom === undefined) return best
    if (atom.type === "trak") {
      const candidate = inspectTrackAtom(bytes, atom, state)
      if (candidate !== undefined && (best === undefined || area(candidate) > area(best))) best = candidate
    }
    if (atom.end <= offset) return best
    offset = atom.end
  }
  return best
}

function inspectTrackAtom(
  bytes: Uint8Array,
  track: IsoBmffAtom,
  state: { atomCount: number },
): ImageDimensions | undefined {
  let offset = track.dataOffset
  while (offset + 8 <= track.end) {
    const atom = readIsoBmffAtom(bytes, offset, track.end, state)
    if (atom === undefined) return undefined
    if (atom.type === "tkhd") return inspectTrackHeader(bytes, atom)
    if (atom.end <= offset) return undefined
    offset = atom.end
  }
  return undefined
}

function inspectTrackHeader(bytes: Uint8Array, atom: IsoBmffAtom): ImageDimensions | undefined {
  const version = bytes[atom.dataOffset]
  if (version !== 0 && version !== 1) return undefined
  const matrixOffset = atom.dataOffset + (version === 0 ? 40 : 52)
  const sizeOffset = atom.dataOffset + (version === 0 ? 76 : 88)
  if (sizeOffset + 8 > atom.end) return undefined

  const encodedWidth = readUint32BigEndian(bytes, sizeOffset)
  const encodedHeight = readUint32BigEndian(bytes, sizeOffset + 4)
  if (encodedWidth === undefined || encodedHeight === undefined) return undefined
  const measured = dimensions(encodedWidth / 65_536, encodedHeight / 65_536)
  if (measured === undefined) return undefined

  const matrixA = readInt32BigEndian(bytes, matrixOffset)
  const matrixB = readInt32BigEndian(bytes, matrixOffset + 4)
  const matrixC = readInt32BigEndian(bytes, matrixOffset + 12)
  const matrixD = readInt32BigEndian(bytes, matrixOffset + 16)
  return matrixA === 0 && matrixD === 0 && matrixB !== 0 && matrixC !== 0
    ? { height: measured.width, width: measured.height }
    : measured
}

function readIsoBmffAtom(
  bytes: Uint8Array,
  offset: number,
  parentEnd: number,
  state: { atomCount: number },
): IsoBmffAtom | undefined {
  state.atomCount += 1
  if (state.atomCount > MAX_ISO_BMFF_ATOM_COUNT || offset < 0 || offset + 8 > parentEnd) return undefined

  const size32 = readUint32BigEndian(bytes, offset)
  if (size32 === undefined) return undefined
  let headerLength = 8
  let atomLength = size32
  if (size32 === 1) {
    headerLength = 16
    atomLength = readUint64BigEndian(bytes, offset + 8) ?? Number.NaN
  } else if (size32 === 0) {
    atomLength = parentEnd - offset
  }
  const end = offset + atomLength
  if (!Number.isSafeInteger(atomLength) || atomLength < headerLength || end > parentEnd) return undefined
  return { dataOffset: offset + headerLength, end, type: readAscii(bytes, offset + 4, 4) }
}

function dimensions(width: number | undefined, height: number | undefined): ImageDimensions | undefined {
  return positiveDimension(width) && positiveDimension(height) ? { height, width } : undefined
}

function area(value: ImageDimensions): number {
  return value.height * value.width
}

function isJpegStartOfFrame(marker: number): boolean {
  return (
    (marker >= 0xc0 && marker <= 0xc3) ||
    (marker >= 0xc5 && marker <= 0xc7) ||
    (marker >= 0xc9 && marker <= 0xcb) ||
    (marker >= 0xcd && marker <= 0xcf)
  )
}

function matchesAscii(bytes: Uint8Array, offset: number, expected: string): boolean {
  if (offset < 0 || offset + expected.length > bytes.length) return false
  for (let index = 0; index < expected.length; index += 1) {
    if (bytes[offset + index] !== expected.charCodeAt(index)) return false
  }
  return true
}

function readAscii(bytes: Uint8Array, offset: number, length: number): string {
  let result = ""
  for (let index = 0; index < length; index += 1) result += String.fromCharCode(bytes[offset + index] ?? 0)
  return result
}

function readUint16BigEndian(bytes: Uint8Array, offset: number): number | undefined {
  const high = bytes[offset]
  const low = bytes[offset + 1]
  return high === undefined || low === undefined ? undefined : high * 0x100 + low
}

function readUint16LittleEndian(bytes: Uint8Array, offset: number): number | undefined {
  const low = bytes[offset]
  const high = bytes[offset + 1]
  return low === undefined || high === undefined ? undefined : low + high * 0x100
}

function readUint24LittleEndian(bytes: Uint8Array, offset: number): number | undefined {
  const low = bytes[offset]
  const middle = bytes[offset + 1]
  const high = bytes[offset + 2]
  return low === undefined || middle === undefined || high === undefined
    ? undefined
    : low + middle * 0x100 + high * 0x1_0000
}

function readUint32BigEndian(bytes: Uint8Array, offset: number): number | undefined {
  const first = bytes[offset]
  const second = bytes[offset + 1]
  const third = bytes[offset + 2]
  const fourth = bytes[offset + 3]
  return first === undefined || second === undefined || third === undefined || fourth === undefined
    ? undefined
    : first * 0x1_000000 + second * 0x1_0000 + third * 0x100 + fourth
}

function readUint32LittleEndian(bytes: Uint8Array, offset: number): number | undefined {
  const first = bytes[offset]
  const second = bytes[offset + 1]
  const third = bytes[offset + 2]
  const fourth = bytes[offset + 3]
  return first === undefined || second === undefined || third === undefined || fourth === undefined
    ? undefined
    : first + second * 0x100 + third * 0x1_0000 + fourth * 0x1_000000
}

function readUint64BigEndian(bytes: Uint8Array, offset: number): number | undefined {
  const high = readUint32BigEndian(bytes, offset)
  const low = readUint32BigEndian(bytes, offset + 4)
  if (high === undefined || low === undefined) return undefined
  const value = high * 0x1_0000_0000 + low
  return Number.isSafeInteger(value) ? value : undefined
}

function readInt32BigEndian(bytes: Uint8Array, offset: number): number | undefined {
  const value = readUint32BigEndian(bytes, offset)
  return value === undefined ? undefined : value > 0x7fff_ffff ? value - 0x1_0000_0000 : value
}

function readInt32LittleEndian(bytes: Uint8Array, offset: number): number | undefined {
  const value = readUint32LittleEndian(bytes, offset)
  return value === undefined ? undefined : value > 0x7fff_ffff ? value - 0x1_0000_0000 : value
}

function positiveDimension(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && value > 0
}
