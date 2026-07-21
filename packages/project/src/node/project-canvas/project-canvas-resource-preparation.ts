import { getCanvasTextFileFormat, type CanvasMediaKind, type CanvasUploadItem } from "@convax/canvas/core"
import type {
  CanvasResourcePreparationPort,
  CanvasResourcePreparationRequest,
  CanvasResourcePreparationResult,
  CanvasResourceSource,
} from "@convax/canvas/application"
import type { ProjectFileInfo, ProjectFilesClient } from "@convax/project-files/contracts"
import {
  isProjectCanvasManagedAssetPath,
  projectCanvasManagedAssetDirectory,
  projectFileReferenceKey,
  requireProjectCanvasResourcePath,
} from "../../canvas/project-resources"

const managedAssetDirectory = projectCanvasManagedAssetDirectory

export type ProjectCanvasResourceHost = Pick<
  ProjectFilesClient,
  "copyEntries" | "listDirectory" | "readFileInfo" | "readTextFile"
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
    throwIfAborted(request.signal)
    const items: CanvasUploadItem[] = []
    for (const source of request.sources) {
      items.push(await this.prepareSource(request.scopeId, source, request.signal))
      throwIfAborted(request.signal)
    }
    return { items }
  }

  private async prepareSource(
    projectId: string,
    source: CanvasResourceSource,
    signal?: AbortSignal,
  ): Promise<CanvasUploadItem> {
    throwIfAborted(signal)
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

    const sourcePath = requireProjectCanvasResourcePath(source.path)
    if (source.kind === "host-directory") {
      await this.project.listDirectory({ path: sourcePath, projectId })
      throwIfAborted(signal)
      return {
        id: source.sourceId,
        kind: "folder",
        metadata: { [projectFileReferenceKey]: { path: sourcePath } },
        name: sourcePath.split("/").at(-1)!,
        path: sourcePath,
      }
    }

    const sourceInfo = await this.project.readFileInfo({ path: sourcePath, projectId })
    throwIfAborted(signal)
    const textFormat = getCanvasTextFileFormat(sourceInfo)
    if (textFormat) {
      const text = await this.project.readTextFile({ path: sourcePath, projectId })
      throwIfAborted(signal)
      if (!text.exists) throw new Error(`Project text file was not found: ${sourcePath}`)
      return {
        format: textFormat,
        id: source.sourceId,
        kind: "text",
        metadata: { [projectFileReferenceKey]: { path: sourcePath } },
        mimeType: normalizeMimeType(sourceInfo.mimeType) || undefined,
        name: sourceInfo.name,
        text: text.content,
      }
    }

    const asset = await this.materializeAsset(projectId, sourcePath, sourceInfo, signal)
    const kind = mediaKindForMimeType(asset.mimeType)
    const inspection =
      kind !== "file" && this.mediaInspector
        ? await this.mediaInspector.inspect({
            kind,
            mimeType: asset.mimeType,
            name: asset.name,
            path: asset.path,
            projectId,
          })
        : undefined
    throwIfAborted(signal)
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
    signal?: AbortSignal,
  ): Promise<ProjectFileInfo> {
    throwIfAborted(signal)
    if (isProjectCanvasManagedAssetPath(sourcePath)) {
      return { ...sourceInfo, mimeType: normalizeMimeType(sourceInfo.mimeType), path: sourcePath }
    }

    const copied = await this.project.copyEntries({
      destinationPath: managedAssetDirectory,
      paths: [sourcePath],
      projectId,
    })
    throwIfAborted(signal)
    if (copied.targetPaths?.length !== 1) {
      throw new Error(`Project resource copy did not produce one asset: ${sourcePath}`)
    }
    const assetPath = requireProjectCanvasResourcePath(copied.targetPaths[0]!)
    if (!isProjectCanvasManagedAssetPath(assetPath)) {
      throw new Error(`Project resource copy escaped the managed asset directory: ${assetPath}`)
    }
    const assetInfo = await this.project.readFileInfo({ path: assetPath, projectId })
    throwIfAborted(signal)
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

function remoteResourceName(value: URL) {
  try {
    const name = value.pathname.split("/").filter(Boolean).at(-1)
    return name ? decodeURIComponent(name) : undefined
  } catch {
    return undefined
  }
}

function throwIfAborted(signal?: AbortSignal) {
  if (!signal?.aborted) return
  throw signal.reason ?? new DOMException("Canvas resource preparation was canceled", "AbortError")
}
