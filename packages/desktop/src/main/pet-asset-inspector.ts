import fs from "node:fs/promises"
import path from "node:path"

export const petAssetMaxBytes = 20 * 1024 * 1024
export const petAssetSpriteV2Width = 1_536
export const petAssetSpriteV2Height = 1_872

export interface PetAssetInspection {
  format: "png" | "webp"
  hasTransparency: boolean
  height: number
  width: number
}

export interface PetAssetInspector {
  inspect(filePath: string): Promise<PetAssetInspection>
}

interface DecodedNativeImage {
  getSize(): { height: number; width: number }
  isEmpty(): boolean
  toBitmap(options?: { scaleFactor?: number }): Buffer
}

interface NativeImageDecoder {
  createFromBuffer(buffer: Buffer): DecodedNativeImage
}

function formatFromExtension(filePath: string): PetAssetInspection["format"] {
  const extension = path.extname(filePath)
  if (extension === ".png") return "png"
  if (extension === ".webp") return "webp"
  throw new Error("Pet spritesheet must be a PNG or WebP file")
}

function formatFromSignature(bytes: Buffer): PetAssetInspection["format"] | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "png"
  }
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "webp"
  }
  return null
}

export function assertValidPetAssetInspection(
  inspection: PetAssetInspection,
  expectedFormat: PetAssetInspection["format"],
) {
  if (inspection.format !== expectedFormat) throw new Error("Pet spritesheet format does not match its filename")
  if (inspection.width !== petAssetSpriteV2Width || inspection.height !== petAssetSpriteV2Height) {
    throw new Error("Pet spritesheet must be exactly 1536 by 1872 pixels")
  }
  if (!inspection.hasTransparency) throw new Error("Pet spritesheet must contain transparency")
}

export function createElectronPetAssetInspector(nativeImage: NativeImageDecoder): PetAssetInspector {
  return {
    async inspect(filePath) {
      const expectedFormat = formatFromExtension(filePath)
      const noFollow = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0)
      const handle = await fs.open(filePath, noFollow)
      let bytes: Buffer
      try {
        const stat = await handle.stat()
        if (!stat.isFile()) throw new Error("Pet spritesheet must be a regular file")
        if (stat.size > petAssetMaxBytes) throw new Error("Pet spritesheet must not exceed 20 MiB")
        bytes = await handle.readFile()
        if (bytes.byteLength > petAssetMaxBytes) throw new Error("Pet spritesheet must not exceed 20 MiB")
      } finally {
        await handle.close()
      }

      const format = formatFromSignature(bytes)
      if (format === null || format !== expectedFormat) {
        throw new Error("Pet spritesheet signature does not match its filename")
      }
      const image = nativeImage.createFromBuffer(bytes)
      if (image.isEmpty()) throw new Error("Pet spritesheet could not be decoded")
      const { width, height } = image.getSize()
      const bitmap = image.toBitmap({ scaleFactor: 1 })
      let hasTransparency = false
      for (let offset = 3; offset < bitmap.length; offset += 4) {
        if (bitmap[offset]! < 255) {
          hasTransparency = true
          break
        }
      }
      return { format, hasTransparency, height, width }
    },
  }
}
