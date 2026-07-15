import {
  getCanvasTextFileFormat,
  type CanvasMediaKind,
  type CanvasUploadItem,
} from "@convax/canvas/core"
import type {
  CanvasResourcePreparationPort,
  CanvasResourcePreparationRequest,
  CanvasResourcePreparationResult,
  CanvasResourceSource,
} from "@convax/canvas/application"
import type { ProjectClient, ProjectFileInfo } from "@convax/project/contracts"
import { projectFileReferenceKey } from "../project-resources"

const managedAssetDirectory = ".convax/assets"

export type ProjectCanvasResourceHost = Pick<
  ProjectClient,
  "copyEntries" | "readFileInfo" | "readTextFile"
>

export interface ProjectCanvasMediaInspection {
  durationMs?: number
  height?: number
  posterUrl?: string
  width?: number
}

export interface ProjectCanvasMediaInspector {
  inspect(input: {
    kind: Exclude<CanvasMediaKind, "file">
    mimeType: string
    name: string
    path: string
    projectId: string
  }): Promise<ProjectCanvasMediaInspection>
}

/**
 * Resolves serializable Canvas resource sources without exposing native paths.
 * The Project host remains responsible for every filesystem operation.
 */
export class ProjectCanvasResourcePreparation implements CanvasResourcePreparationPort {
  constructor(
    private readonly project: ProjectCanvasResourceHost,
    private readonly mediaInspector?: ProjectCanvasMediaInspector,
  ) {}

  async prepare(request: CanvasResourcePreparationRequest): Promise<CanvasResourcePreparationResult> {
    const items: CanvasUploadItem[] = []
    for (const source of request.sources) {
      items.push(await this.prepareSource(request.projectId, source))
    }
    return { items }
  }

  private async prepareSource(projectId: string, source: CanvasResourceSource): Promise<CanvasUploadItem> {
    if (source.kind === "inline-text") {
      return {
        format: source.format,
        id: source.sourceId,
        kind: "text",
        name: source.name,
        text: source.text,
      }
    }

    if (source.kind === "remote-url") {
      const url = new URL(source.url)
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new Error("Remote Canvas resources must use HTTP or HTTPS")
      }
      const mimeType = normalizeMimeType(source.mimeType)
      return {
        id: source.sourceId,
        kind: mediaKindForMimeType(mimeType),
        mimeType: mimeType || undefined,
        name: source.name ?? remoteResourceName(url),
        url: url.href,
      }
    }

    const sourcePath = portableProjectPath(source.path)
    const sourceInfo = await this.project.readFileInfo({ path: sourcePath, projectId })
    const textFormat = getCanvasTextFileFormat(sourceInfo)
    if (textFormat) {
      const text = await this.project.readTextFile({ path: sourcePath, projectId })
      if (!text.exists) throw new Error(`Project text file was not found: ${sourcePath}`)
      return {
        format: textFormat,
        id: source.sourceId,
        kind: "text",
        mimeType: normalizeMimeType(sourceInfo.mimeType) || undefined,
        name: sourceInfo.name,
        text: text.content,
      }
    }

    const asset = await this.materializeAsset(projectId, sourcePath, sourceInfo)
    const kind = mediaKindForMimeType(asset.mimeType)
    const inspection = kind !== "file" && this.mediaInspector
      ? await this.mediaInspector.inspect({
          kind,
          mimeType: asset.mimeType,
          name: asset.name,
          path: asset.path,
          projectId,
        })
      : undefined
    return {
      durationMs: inspection?.durationMs,
      height: inspection?.height,
      id: source.sourceId,
      kind,
      metadata: { [projectFileReferenceKey]: { path: asset.path } },
      mimeType: asset.mimeType || undefined,
      name: asset.name,
      posterUrl: inspection?.posterUrl,
      url: "",
      width: inspection?.width,
    }
  }

  private async materializeAsset(
    projectId: string,
    sourcePath: string,
    sourceInfo: ProjectFileInfo,
  ): Promise<ProjectFileInfo> {
    if (isManagedAssetPath(sourcePath)) {
      return { ...sourceInfo, mimeType: normalizeMimeType(sourceInfo.mimeType), path: sourcePath }
    }

    const copied = await this.project.copyEntries({
      destinationPath: managedAssetDirectory,
      paths: [sourcePath],
      projectId,
    })
    if (copied.targetPaths?.length !== 1) {
      throw new Error(`Project resource copy did not produce one asset: ${sourcePath}`)
    }
    const assetPath = portableProjectPath(copied.targetPaths[0]!)
    if (!isManagedAssetPath(assetPath)) {
      throw new Error(`Project resource copy escaped the managed asset directory: ${assetPath}`)
    }
    const assetInfo = await this.project.readFileInfo({ path: assetPath, projectId })
    return { ...assetInfo, mimeType: normalizeMimeType(assetInfo.mimeType), path: assetPath }
  }
}

function mediaKindForMimeType(mimeType: string): CanvasMediaKind {
  if (mimeType.startsWith("image/")) return "image"
  if (mimeType.startsWith("video/")) return "video"
  if (mimeType.startsWith("audio/")) return "audio"
  return "file"
}

function normalizeMimeType(value?: string) {
  return (value ?? "").split(";", 1)[0]!.trim().toLowerCase()
}

function isManagedAssetPath(value: string) {
  return value.startsWith(`${managedAssetDirectory}/`)
}

function remoteResourceName(value: URL) {
  try {
    const name = value.pathname.split("/").filter(Boolean).at(-1)
    return name ? decodeURIComponent(name) : undefined
  } catch {
    return undefined
  }
}

/** Normalize to the portable POSIX paths used by the Project contract. */
function portableProjectPath(value: string) {
  const input = value.replaceAll("\\", "/")
  if (!input || input.includes("\0") || input.startsWith("/") || /^[a-zA-Z]:\//.test(input)) {
    throw new Error(`Invalid portable project path: ${value}`)
  }
  const segments: string[] = []
  for (const segment of input.split("/")) {
    if (!segment || segment === ".") continue
    if (segment === "..") {
      if (!segments.length) throw new Error(`Project path escapes its root: ${value}`)
      segments.pop()
      continue
    }
    assertPortableSegment(segment)
    segments.push(segment)
  }
  if (!segments.length) throw new Error(`Invalid portable project path: ${value}`)
  if (segments[0]?.toLowerCase() === ".convax"
    && (segments[0] !== ".convax" || segments[1] !== "assets" || segments.length < 3)) {
    throw new Error(`Project private storage cannot be used as a Canvas resource: ${value}`)
  }
  return segments.join("/")
}

function assertPortableSegment(value: string) {
  const stem = value.split(".")[0]?.toUpperCase()
  if (/[\\/:*?"<>|\u0000-\u001f\u007f]/.test(value)
    || /[. ]$/.test(value)
    || stem && /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9]|CONIN\$|CONOUT\$)$/.test(stem)) {
    throw new Error(`Invalid portable project path segment: ${value}`)
  }
}
