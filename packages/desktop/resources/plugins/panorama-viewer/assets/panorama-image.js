export const MAX_IMAGE_FILE_BYTES = 16 * 1024 * 1024
export const ACCEPTED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"])

const MAX_IMAGE_PIXELS = 40 * 1024 * 1024
const MAX_IMAGE_DIMENSION = 16384
const MAX_TEXTURE_PIXELS = 24 * 1024 * 1024
const MAX_TEXTURE_DIMENSION = 8192

function errorMessage(error, fallback) {
  return error instanceof Error && error.message ? error.message : fallback
}

function readPngDimensions(bytes) {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (bytes.length < 24 || !signature.every(function (value, index) { return bytes[index] === value })) {
    throw new Error("PNG 文件头无效")
  }
  if (String.fromCharCode.apply(null, bytes.subarray(12, 16)) !== "IHDR") {
    throw new Error("PNG 缺少 IHDR 尺寸信息")
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return { height: view.getUint32(20), width: view.getUint32(16) }
}

function readJpegDimensions(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error("JPEG 文件头无效")
  const startOfFrameMarkers = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
    0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
  ])
  let offset = 2
  while (offset + 3 < bytes.length) {
    while (offset < bytes.length && bytes[offset] !== 0xff) offset += 1
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1
    if (offset >= bytes.length) break
    const marker = bytes[offset]
    offset += 1
    if (marker === 0xd9 || marker === 0xda) break
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
    if (offset + 1 >= bytes.length) break
    const length = bytes[offset] * 256 + bytes[offset + 1]
    if (length < 2 || offset + length > bytes.length) throw new Error("JPEG 数据段无效")
    if (startOfFrameMarkers.has(marker) && length >= 7) {
      return {
        height: bytes[offset + 3] * 256 + bytes[offset + 4],
        width: bytes[offset + 5] * 256 + bytes[offset + 6],
      }
    }
    offset += length
  }
  throw new Error("JPEG 中没有可用的尺寸信息")
}

function readWebpDimensions(bytes) {
  const ascii = function (start, end) {
    return String.fromCharCode.apply(null, bytes.subarray(start, end))
  }
  if (bytes.length < 25 || ascii(0, 4) !== "RIFF" || ascii(8, 12) !== "WEBP") {
    throw new Error("WebP 文件头无效")
  }
  const chunk = ascii(12, 16)
  if (chunk === "VP8X" && bytes.length >= 30) {
    return {
      height: 1 + bytes[27] + bytes[28] * 256 + bytes[29] * 65536,
      width: 1 + bytes[24] + bytes[25] * 256 + bytes[26] * 65536,
    }
  }
  if (chunk === "VP8L" && bytes.length >= 25 && bytes[20] === 0x2f) {
    return {
      height: 1 + ((bytes[22] >> 6) | (bytes[23] << 2) | ((bytes[24] & 0x0f) << 10)),
      width: 1 + bytes[21] + ((bytes[22] & 0x3f) << 8),
    }
  }
  if (chunk === "VP8 " && bytes.length >= 30
    && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
    return {
      height: (bytes[28] | (bytes[29] << 8)) & 0x3fff,
      width: (bytes[26] | (bytes[27] << 8)) & 0x3fff,
    }
  }
  throw new Error("WebP 中没有可用的尺寸信息")
}

function validatePanoramaDimensions(width, height) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
    throw new Error("图片尺寸无效")
  }
  if (width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION || width * height > MAX_IMAGE_PIXELS) {
    throw new Error("图片像素尺寸过大；最大支持约 40 MP、单边不超过 16384 像素")
  }
  const ratio = width / height
  if (ratio < 1.8 || ratio > 2.2) {
    throw new Error("需要约 2:1 的等距柱状投影全景图；不支持 cubemap 拆分或拼接")
  }
  return { height: height, ratio: ratio, width: width }
}

export function inspectImageBytes(bytes, mimeType) {
  const normalizedMimeType = String(mimeType).toLowerCase()
  let dimensions
  if (normalizedMimeType === "image/png") dimensions = readPngDimensions(bytes)
  else if (normalizedMimeType === "image/jpeg") dimensions = readJpegDimensions(bytes)
  else if (normalizedMimeType === "image/webp") dimensions = readWebpDimensions(bytes)
  else throw new Error("图片格式不受支持")
  return validatePanoramaDimensions(dimensions.width, dimensions.height)
}

export function inspectDataUrlImage(value, mimeType, expectedSize) {
  const normalizedMimeType = String(mimeType).toLowerCase()
  if (!ACCEPTED_IMAGE_TYPES.has(normalizedMimeType) || typeof value !== "string") {
    throw new Error("宿主返回了不受支持的图片格式")
  }
  const prefix = "data:" + normalizedMimeType + ";base64,"
  if (value.slice(0, prefix.length).toLowerCase() !== prefix) {
    throw new Error("宿主返回的图片数据无效")
  }
  const encoded = value.slice(prefix.length)
  if (!encoded || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
    throw new Error("宿主返回的图片不是有效 base64 数据")
  }
  if (encoded.length > Math.ceil(MAX_IMAGE_FILE_BYTES / 3) * 4 + 4) {
    throw new Error("连接图片超过 16 MiB 限制")
  }
  let binary
  try {
    binary = window.atob(encoded)
  } catch {
    throw new Error("宿主返回的图片不是有效 base64 数据")
  }
  if (binary.length > MAX_IMAGE_FILE_BYTES
    || (typeof expectedSize === "number" && expectedSize !== binary.length)) {
    throw new Error("连接图片大小与宿主声明不一致")
  }
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return {
    bytes: bytes,
    dimensions: inspectImageBytes(bytes, normalizedMimeType),
    mimeType: normalizedMimeType,
  }
}

function textureTargetDimensions(dimensions, gl) {
  if (!gl) throw new Error("WebGL2 尚未就绪")
  const dimensionLimit = Math.min(MAX_TEXTURE_DIMENSION, gl.getParameter(gl.MAX_TEXTURE_SIZE))
  const dimensionScale = Math.min(dimensionLimit / dimensions.width, dimensionLimit / dimensions.height, 1)
  const pixelScale = Math.min(Math.sqrt(MAX_TEXTURE_PIXELS / (dimensions.width * dimensions.height)), 1)
  const scale = Math.min(dimensionScale, pixelScale)
  return {
    height: Math.max(1, Math.floor(dimensions.height * scale)),
    width: Math.max(1, Math.floor(dimensions.width * scale)),
  }
}

export async function decodePanoramaImage(blob, dimensions, gl) {
  const target = textureTargetDimensions(dimensions, gl)
  try {
    const bitmap = await createImageBitmap(blob, {
      resizeHeight: target.height,
      resizeQuality: "high",
      resizeWidth: target.width,
    })
    if (bitmap.width !== target.width || bitmap.height !== target.height) {
      bitmap.close()
      throw new Error("图片解码尺寸与预期不一致")
    }
    return { bitmap: bitmap, target: target }
  } catch (error) {
    throw new Error(errorMessage(error, "图片无法解码或格式不受支持"))
  }
}
