import type { AgentSkillInspectionFile } from "@convax/agent-runtime/node"
import type { DesktopSkillFilePreview } from "../skill-management-contracts"

const maxSkillPreviewFileBytes = 256 * 1024
const maxSkillPreviewTotalBytes = 1024 * 1024
const maxSkillDetailBundleBytes = 32 * 1024 * 1024
const maxSkillDetailEntries = 1_000
const maxSkillDetailFileBytes = 8 * 1024 * 1024
const windowsReservedName = /^(CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³]|CONIN\$|CONOUT\$)$/i
const textPreviewExtensions = new Set([
  ".bash",
  ".cjs",
  ".css",
  ".csv",
  ".go",
  ".html",
  ".htm",
  ".java",
  ".js",
  ".json",
  ".jsx",
  ".kt",
  ".md",
  ".mjs",
  ".php",
  ".ps1",
  ".py",
  ".rb",
  ".rs",
  ".sh",
  ".sql",
  ".svg",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".xml",
  ".yaml",
  ".yml",
  ".zsh",
])
const textPreviewNames = new Set(["agents.md", "authors", "changelog", "copying", "license", "notice", "readme"])

function previewExtension(path: string) {
  const fileName = path.slice(path.lastIndexOf("/") + 1).toLocaleLowerCase("en-US")
  const extensionIndex = fileName.lastIndexOf(".")
  return extensionIndex < 0 ? "" : fileName.slice(extensionIndex)
}

function isTextPreviewCandidate(path: string) {
  const fileName = path.slice(path.lastIndexOf("/") + 1).toLocaleLowerCase("en-US")
  const stem = fileName.replace(/\.[^.]+$/, "")
  return (
    textPreviewNames.has(fileName) || textPreviewNames.has(stem) || textPreviewExtensions.has(previewExtension(path))
  )
}

function assertSafePreviewPath(path: string) {
  if (!path || path.length > 1_024 || path.includes("\\") || path.startsWith("/") || /^[A-Za-z]:/.test(path)) {
    throw new Error(`Skill bundle contains an unsafe portable path: ${path}`)
  }
  for (const segment of path.split("/")) {
    const stem = segment.split(".")[0] ?? ""
    if (
      !segment ||
      segment === "." ||
      segment === ".." ||
      segment !== segment.normalize("NFC") ||
      /[\/:*?"<>|\u0000-\u001f\u007f]/.test(segment) ||
      /[. ]$/.test(segment) ||
      windowsReservedName.test(stem)
    ) {
      throw new Error(`Skill bundle contains an unsafe portable path: ${path}`)
    }
  }
}

export function createSkillFilePreviews(
  input: Readonly<Record<string, Uint8Array>> | readonly AgentSkillInspectionFile[],
) {
  const entries = Array.isArray(input) ? input.map((file) => [file.path, file.content] as const) : Object.entries(input)
  const previews: DesktopSkillFilePreview[] = []
  let totalPreviewBytes = 0
  let totalBundleBytes = 0
  if (entries.length < 1 || entries.length > maxSkillDetailEntries) {
    throw new Error("Skill bundle exceeds the detail entry limit")
  }
  for (const [path, bytes] of entries.sort(([left], [right]) => left.localeCompare(right))) {
    assertSafePreviewPath(path)
    const size = bytes.byteLength
    if (size > maxSkillDetailFileBytes) throw new Error(`Skill detail file exceeds the size limit: ${path}`)
    totalBundleBytes += size
    if (!Number.isSafeInteger(totalBundleBytes) || totalBundleBytes > maxSkillDetailBundleBytes) {
      throw new Error("Skill bundle exceeds the detail size limit")
    }
    if (
      !isTextPreviewCandidate(path) ||
      size > maxSkillPreviewFileBytes ||
      totalPreviewBytes + size > maxSkillPreviewTotalBytes
    ) {
      previews.push({ kind: "binary", path, size })
      continue
    }
    try {
      const content = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
      previews.push({ content, kind: "text", path, size })
      totalPreviewBytes += size
    } catch {
      previews.push({ kind: "binary", path, size })
    }
  }
  return previews
}
