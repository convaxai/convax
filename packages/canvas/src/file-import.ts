import type { CanvasTextFormat } from "./types"

export interface CanvasFileDescriptor {
  name: string
  mimeType?: string
  type?: string
}

const markdownExtensions = new Set(["markdown", "md"])
const markdownMimeTypes = new Set(["text/markdown", "text/x-markdown"])
const plainTextExtensions = new Set(["rtf", "text", "txt"])
const plainTextMimeTypes = new Set(["application/rtf", "text/rtf"])

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
