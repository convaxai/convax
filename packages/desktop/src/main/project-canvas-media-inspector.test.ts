import { describe, expect, test } from "bun:test"
import { createProjectCanvasMediaInspector } from "./project-canvas-media-inspector"

describe("Project Canvas media inspector", () => {
  test.each([
    ["PNG", png(1_600, 900)],
    ["JPEG", jpeg(1_600, 900)],
    ["GIF", gif(1_600, 900)],
    ["WebP VP8X", webpVp8x(1_600, 900)],
    ["WebP VP8L", webpVp8l(1_600, 900)],
    ["WebP VP8", webpVp8(1_600, 900)],
    ["BMP", bmp(1_600, 900)],
    ["top-down BMP", bmp(1_600, -900)],
  ])("reads %s dimensions from bounded metadata", async (_label, bytes) => {
    const result = await inspect(bytes, "image")

    expect(result).toEqual({ height: 900, width: 1_600 })
  })

  test("reads an MP4 tkhd after a large media-data atom without decoding it", async () => {
    const bytes = isoBmffVideo({ height: 1_080, mediaDataLength: 600_000, width: 1_920 })

    const result = await inspect(bytes, "video")

    expect(result).toEqual({ height: 1_080, width: 1_920 })
  })

  test("uses a MOV version-one tkhd transform for portrait presentation size", async () => {
    const bytes = isoBmffVideo({ height: 1_080, rotated: true, version: 1, width: 1_920 })

    const result = await inspect(bytes, "video")

    expect(result).toEqual({ height: 1_920, width: 1_080 })
  })

  test.each([
    [
      "landscape WebM",
      "video/webm",
      ebmlVideo({ height: 1_080, unknownSegmentSize: true, width: 1_920 }),
      { height: 1_080, width: 1_920 },
    ],
    [
      "portrait Matroska",
      "video/x-matroska",
      ebmlVideo({ height: 1_920, width: 1_080 }),
      { height: 1_920, width: 1_080 },
    ],
  ] as const)("reads %s Tracks/Video dimensions", async (_label, mimeType, bytes, expected) => {
    const result = await inspect(bytes, "video", mimeType)

    expect(result).toEqual(expected)
  })

  test("uses the EBML signature when the video MIME type is generic", async () => {
    const result = await inspect(ebmlVideo({ height: 720, width: 1_280 }), "video", "application/octet-stream")

    expect(result).toEqual({ height: 720, width: 1_280 })
  })

  test("uses pixel DisplayWidth and DisplayHeight for WebM presentation size", async () => {
    const result = await inspect(
      ebmlVideo({ displayHeight: 576, displayWidth: 1_024, height: 576, width: 720 }),
      "video",
      'video/webm; codecs="vp9"',
    )

    expect(result).toEqual({ height: 576, width: 1_024 })
  })

  test.each([
    concat(ebmlHeader(), new Uint8Array([0x18, 0x53, 0x80, 0x67, 0x40])),
    ebmlVideoWithTrackPayload(
      concat(
        ebmlUnsignedElement([0x83], 1),
        ebmlElement([0xe0], concat(ebmlUnsignedElement([0xb0], 1_920), new Uint8Array([0xba, 0x84, 0x04]))),
      ),
    ),
    ebmlVideoWithTrackPayload(
      concat(
        ebmlUnsignedElement([0x83], 1),
        ebmlElement(
          [0xe0],
          concat(
            ebmlUnsignedElement([0xb0], 1_920),
            ebmlElement([0xba], new Uint8Array([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff])),
          ),
        ),
      ),
    ),
  ])("fails closed for malformed EBML sizes and integers", async (bytes) => {
    expect(await inspect(bytes, "video", "video/webm")).toEqual({})
  })

  test.each([
    [4_088, { height: 1_080, width: 1_920 }],
    [4_089, {}],
  ])("bounds EBML traversal at the element-count boundary (%i leading elements)", async (voidCount, expected) => {
    const bytes = ebmlVideo({ height: 1_080, leadingVoidCount: voidCount, width: 1_920 })

    expect(await inspect(bytes, "video", "video/webm")).toEqual(expected)
  })

  test("does not scan EBML metadata beyond the bounded header window", async () => {
    const bytes = ebmlVideo({ height: 1_080, leadingVoidBytes: 512 * 1_024, width: 1_920 })

    expect(await inspect(bytes, "video", "video/webm")).toEqual({})
  })

  test.each([
    new Uint8Array(),
    new TextEncoder().encode("not an image"),
    png(0, 900),
    jpeg(1_600, 0),
    new Uint8Array([0x52, 0x49, 0x46, 0x46, 0xff, 0xff, 0xff, 0xff, 0x57, 0x45, 0x42, 0x50]),
  ])("fails closed for unknown, corrupt, or invalid image metadata", async (bytes) => {
    expect(await inspect(bytes, "image")).toEqual({})
  })

  test("does not scan JPEG metadata beyond the bounded image-header window", async () => {
    expect(await inspect(jpegAfterLargeMetadata(1_600, 900), "image")).toEqual({})
  })

  test("bounds ISO BMFF atom traversal and fails closed", async () => {
    const atoms = Array.from({ length: 4_097 }, () => atom("free", new Uint8Array()))
    atoms.push(isoBmffVideo({ height: 1_080, width: 1_920 }))

    expect(await inspect(concat(...atoms), "video")).toEqual({})
  })
})

async function inspect(bytes: Uint8Array, kind: "image" | "video", mimeType?: string) {
  return createProjectCanvasMediaInspector().inspect({
    bytes,
    kind,
    mimeType: mimeType ?? (kind === "image" ? "image/unknown" : "video/quicktime"),
    name: kind === "image" ? "hero.image" : "clip.mov",
  })
}

function png(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  writeUint32BigEndian(bytes, 8, 13)
  writeAscii(bytes, 12, "IHDR")
  writeUint32BigEndian(bytes, 16, width)
  writeUint32BigEndian(bytes, 20, height)
  return bytes
}

function jpeg(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(30)
  bytes.set([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x05, 0x45, 0x78, 0x69, 0xff, 0xc0, 0x00, 0x11, 0x08])
  writeUint16BigEndian(bytes, 14, height)
  writeUint16BigEndian(bytes, 16, width)
  return bytes
}

function jpegAfterLargeMetadata(width: number, height: number): Uint8Array {
  const segmentCount = 9
  const segmentLength = 0xffff
  const bytes = new Uint8Array(2 + segmentCount * (2 + segmentLength) + 14)
  bytes.set([0xff, 0xd8])
  let offset = 2
  for (let index = 0; index < segmentCount; index += 1) {
    bytes.set([0xff, 0xe1], offset)
    writeUint16BigEndian(bytes, offset + 2, segmentLength)
    offset += 2 + segmentLength
  }
  bytes.set([0xff, 0xc0, 0x00, 0x11, 0x08], offset)
  writeUint16BigEndian(bytes, offset + 5, height)
  writeUint16BigEndian(bytes, offset + 7, width)
  return bytes
}

function gif(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(10)
  writeAscii(bytes, 0, "GIF89a")
  writeUint16LittleEndian(bytes, 6, width)
  writeUint16LittleEndian(bytes, 8, height)
  return bytes
}

function webpVp8x(width: number, height: number): Uint8Array {
  const bytes = webpChunk("VP8X", 10)
  writeUint24LittleEndian(bytes, 24, width - 1)
  writeUint24LittleEndian(bytes, 27, height - 1)
  return bytes
}

function webpVp8l(width: number, height: number): Uint8Array {
  const bytes = webpChunk("VP8L", 5)
  const encodedWidth = width - 1
  const encodedHeight = height - 1
  bytes[20] = 0x2f
  bytes[21] = encodedWidth & 0xff
  bytes[22] = ((encodedWidth >> 8) & 0x3f) | ((encodedHeight & 0x03) << 6)
  bytes[23] = (encodedHeight >> 2) & 0xff
  bytes[24] = (encodedHeight >> 10) & 0x0f
  return bytes
}

function webpVp8(width: number, height: number): Uint8Array {
  const bytes = webpChunk("VP8 ", 10)
  bytes.set([0x9d, 0x01, 0x2a], 23)
  writeUint16LittleEndian(bytes, 26, width)
  writeUint16LittleEndian(bytes, 28, height)
  return bytes
}

function webpChunk(kind: string, length: number): Uint8Array {
  const paddedLength = length + (length & 1)
  const bytes = new Uint8Array(20 + paddedLength)
  writeAscii(bytes, 0, "RIFF")
  writeUint32LittleEndian(bytes, 4, bytes.length - 8)
  writeAscii(bytes, 8, "WEBP")
  writeAscii(bytes, 12, kind)
  writeUint32LittleEndian(bytes, 16, length)
  return bytes
}

function bmp(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(54)
  writeAscii(bytes, 0, "BM")
  writeUint32LittleEndian(bytes, 14, 40)
  writeInt32LittleEndian(bytes, 18, width)
  writeInt32LittleEndian(bytes, 22, height)
  return bytes
}

function ebmlVideo(input: {
  displayHeight?: number
  displayWidth?: number
  height: number
  leadingVoidBytes?: number
  leadingVoidCount?: number
  unknownSegmentSize?: boolean
  width: number
}): Uint8Array {
  const videoElements = [ebmlUnsignedElement([0xb0], input.width), ebmlUnsignedElement([0xba], input.height)]
  if (input.displayWidth !== undefined) videoElements.push(ebmlUnsignedElement([0x54, 0xb0], input.displayWidth))
  if (input.displayHeight !== undefined) {
    videoElements.push(ebmlUnsignedElement([0x54, 0xba], input.displayHeight))
  }

  const track = ebmlElement(
    [0xae],
    concat(ebmlUnsignedElement([0x83], 1), ebmlElement([0xe0], concat(...videoElements))),
  )
  const leadingElements = Array.from({ length: input.leadingVoidCount ?? 0 }, () =>
    ebmlElement([0xec], new Uint8Array()),
  )
  if (input.leadingVoidBytes !== undefined) {
    leadingElements.push(ebmlElement([0xec], new Uint8Array(input.leadingVoidBytes)))
  }
  const segmentPayload = concat(...leadingElements, ebmlElement([0x16, 0x54, 0xae, 0x6b], track))
  const segment = input.unknownSegmentSize
    ? concat(new Uint8Array([0x18, 0x53, 0x80, 0x67, 0xff]), segmentPayload)
    : ebmlElement([0x18, 0x53, 0x80, 0x67], segmentPayload)
  return concat(ebmlHeader(), segment)
}

function ebmlVideoWithTrackPayload(trackPayload: Uint8Array): Uint8Array {
  return concat(
    ebmlHeader(),
    ebmlElement([0x18, 0x53, 0x80, 0x67], ebmlElement([0x16, 0x54, 0xae, 0x6b], ebmlElement([0xae], trackPayload))),
  )
}

function ebmlHeader(): Uint8Array {
  return ebmlElement([0x1a, 0x45, 0xdf, 0xa3], ebmlElement([0x42, 0x82], ascii("webm")))
}

function ebmlUnsignedElement(id: readonly number[], value: number): Uint8Array {
  let byteLength = 1
  while (byteLength < 8 && value >= 2 ** (byteLength * 8)) byteLength += 1
  const payload = new Uint8Array(byteLength)
  let remaining = value
  for (let index = byteLength - 1; index >= 0; index -= 1) {
    payload[index] = remaining % 0x100
    remaining = Math.floor(remaining / 0x100)
  }
  return ebmlElement(id, payload)
}

function ebmlElement(id: readonly number[], payload: Uint8Array): Uint8Array {
  return concat(new Uint8Array(id), encodeEbmlSize(payload.length), payload)
}

function encodeEbmlSize(value: number): Uint8Array {
  let byteLength = 1
  while (byteLength < 7 && value > 2 ** (byteLength * 7) - 2) byteLength += 1
  if (!Number.isSafeInteger(value) || value < 0 || value > 2 ** (byteLength * 7) - 2) {
    throw new Error("EBML test payload is too large")
  }

  const bytes = new Uint8Array(byteLength)
  let remaining = value
  for (let index = byteLength - 1; index >= 0; index -= 1) {
    bytes[index] = remaining % 0x100
    remaining = Math.floor(remaining / 0x100)
  }
  bytes[0] = (bytes[0] ?? 0) | (1 << (8 - byteLength))
  return bytes
}

function isoBmffVideo(input: {
  height: number
  mediaDataLength?: number
  rotated?: boolean
  version?: 0 | 1
  width: number
}): Uint8Array {
  const version = input.version ?? 0
  const trackHeader = new Uint8Array(version === 0 ? 84 : 96)
  trackHeader[0] = version
  const matrixOffset = version === 0 ? 40 : 52
  if (input.rotated) {
    writeInt32BigEndian(trackHeader, matrixOffset + 4, 65_536)
    writeInt32BigEndian(trackHeader, matrixOffset + 12, -65_536)
  } else {
    writeInt32BigEndian(trackHeader, matrixOffset, 65_536)
    writeInt32BigEndian(trackHeader, matrixOffset + 16, 65_536)
  }
  writeInt32BigEndian(trackHeader, matrixOffset + 32, 1 << 30)
  const sizeOffset = version === 0 ? 76 : 88
  writeUint32BigEndian(trackHeader, sizeOffset, input.width * 65_536)
  writeUint32BigEndian(trackHeader, sizeOffset + 4, input.height * 65_536)

  const ftyp = atom("ftyp", concat(ascii("isom"), new Uint8Array(4), ascii("isom")))
  const mediaData = atom("mdat", new Uint8Array(input.mediaDataLength ?? 0))
  const movie = atom("moov", atom("trak", atom("tkhd", trackHeader)))
  return concat(ftyp, mediaData, movie)
}

function atom(type: string, payload: Uint8Array): Uint8Array {
  const bytes = new Uint8Array(8 + payload.length)
  writeUint32BigEndian(bytes, 0, bytes.length)
  writeAscii(bytes, 4, type)
  bytes.set(payload, 8)
  return bytes
}

function ascii(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length)
  writeAscii(bytes, 0, value)
  return bytes
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const bytes = new Uint8Array(parts.reduce((length, part) => length + part.length, 0))
  let offset = 0
  for (const part of parts) {
    bytes.set(part, offset)
    offset += part.length
  }
  return bytes
}

function writeAscii(bytes: Uint8Array, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1) bytes[offset + index] = value.charCodeAt(index)
}

function writeUint16BigEndian(bytes: Uint8Array, offset: number, value: number) {
  bytes[offset] = (value >>> 8) & 0xff
  bytes[offset + 1] = value & 0xff
}

function writeUint16LittleEndian(bytes: Uint8Array, offset: number, value: number) {
  bytes[offset] = value & 0xff
  bytes[offset + 1] = (value >>> 8) & 0xff
}

function writeUint24LittleEndian(bytes: Uint8Array, offset: number, value: number) {
  bytes[offset] = value & 0xff
  bytes[offset + 1] = (value >>> 8) & 0xff
  bytes[offset + 2] = (value >>> 16) & 0xff
}

function writeUint32BigEndian(bytes: Uint8Array, offset: number, value: number) {
  bytes[offset] = (value >>> 24) & 0xff
  bytes[offset + 1] = (value >>> 16) & 0xff
  bytes[offset + 2] = (value >>> 8) & 0xff
  bytes[offset + 3] = value & 0xff
}

function writeUint32LittleEndian(bytes: Uint8Array, offset: number, value: number) {
  bytes[offset] = value & 0xff
  bytes[offset + 1] = (value >>> 8) & 0xff
  bytes[offset + 2] = (value >>> 16) & 0xff
  bytes[offset + 3] = (value >>> 24) & 0xff
}

function writeInt32BigEndian(bytes: Uint8Array, offset: number, value: number) {
  writeUint32BigEndian(bytes, offset, value >>> 0)
}

function writeInt32LittleEndian(bytes: Uint8Array, offset: number, value: number) {
  writeUint32LittleEndian(bytes, offset, value >>> 0)
}
