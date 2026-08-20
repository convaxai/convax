import type { CanvasFileKind, CanvasTextFormat } from "./types"

export interface CanvasFileDescriptor {
  name: string
  mimeType?: string
  type?: string
}

export type CanvasLocalFileKind = Exclude<CanvasFileKind, "folder">

const markdownExtensions = new Set(["markdown", "md"])
const markdownMimeTypes = new Set(["text/markdown", "text/x-markdown"])
const plainTextExtensions = new Set(["rtf", "text", "txt"])
const plainTextMimeTypes = new Set(["application/rtf", "text/rtf"])
const imageExtensions = new Set(["avif", "bmp", "gif", "heic", "heif", "jpeg", "jpg", "png", "svg", "tif", "tiff", "webp"])
const videoExtensions = new Set(["avi", "m4v", "mkv", "mov", "mp4", "webm"])
const audioExtensions = new Set(["aac", "aiff", "flac", "m4a", "mp3", "ogg", "opus", "wav", "wma"])

function fileExtension(name: string) {
  const normalized = name.trim().toLowerCase()
  const separator = normalized.lastIndexOf(".")
  return separator >= 0 ? normalized.slice(separator + 1) : ""
}

function normalizedMimeType(file: CanvasFileDescriptor) {
  const value = file.type?.trim() || file.mimeType?.trim() || ""
  return value.split(";", 1)[0].trim().toLowerCase()
}

export function getCanvasTextFileFormat(file: CanvasFileDescriptor): CanvasTextFormat | null {
  const mimeType = normalizedMimeType(file)
  const extension = fileExtension(file.name)
  if (markdownMimeTypes.has(mimeType) || markdownExtensions.has(extension)) return "markdown"
  if (mimeType.startsWith("text/") || plainTextMimeTypes.has(mimeType) || plainTextExtensions.has(extension)) {
    return "plain"
  }
  return null
}

export function classifyCanvasFileKind(file: CanvasFileDescriptor): CanvasLocalFileKind {
  if (getCanvasTextFileFormat(file)) return "text"
  const mimeType = normalizedMimeType(file)
  if (mimeType.startsWith("image/")) return "image"
  if (mimeType.startsWith("video/")) return "video"
  if (mimeType.startsWith("audio/")) return "audio"
  const extension = fileExtension(file.name)
  if (imageExtensions.has(extension)) return "image"
  if (videoExtensions.has(extension)) return "video"
  if (audioExtensions.has(extension)) return "audio"
  return "file"
}

export function canPickLocalCanvasRelinkFile(kind: string | null | undefined): kind is CanvasLocalFileKind {
  return kind === "audio" || kind === "file" || kind === "image" || kind === "text" || kind === "video"
}

function pickerAcceptFromExtensions(extensions: ReadonlySet<string>) {
  return [...extensions]
    .sort()
    .map((extension) => `.${extension}`)
    .join(",")
}

export function canvasFilePickerAccept(kind: string | null | undefined): string | undefined {
  // Chromium's macOS panel maps MIME wildcards loosely and always offers "All
  // files". Explicit extensions are the filter the OS can actually apply.
  if (kind === "image") return pickerAcceptFromExtensions(imageExtensions)
  if (kind === "video") return pickerAcceptFromExtensions(videoExtensions)
  if (kind === "audio") return pickerAcceptFromExtensions(audioExtensions)
  if (kind === "text") return pickerAcceptFromExtensions(new Set([...markdownExtensions, ...plainTextExtensions]))
  return undefined
}

export function applyCanvasFilePickerAccept(
  input: {
    accept: string
    removeAttribute?(name: string): void
    setAttribute?(name: string, value: string): void
  },
  kind: string | null | undefined,
): void {
  const accept = canvasFilePickerAccept(kind) ?? ""
  input.accept = accept
  if (accept) input.setAttribute?.("accept", accept)
  else input.removeAttribute?.("accept")
}

export function isCanvasFileCompatibleWithKind(
  file: CanvasFileDescriptor,
  kind: string | null | undefined,
): boolean {
  return canPickLocalCanvasRelinkFile(kind) && classifyCanvasFileKind(file) === kind
}
