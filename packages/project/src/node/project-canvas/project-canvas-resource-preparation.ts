import path from "node:path"
import { getCanvasTextFileFormat, type CanvasMediaKind, type CanvasUploadItem } from "@convax/canvas/core"
import type {
  CanvasResourcePreparationPort,
  CanvasResourcePreparationRequest,
  CanvasResourcePreparationResult,
  CanvasResourceSource,
} from "@convax/canvas/application"
import type { ProjectFilesClient } from "@convax/project-files/contracts"
import {
  projectResourceReferenceKey,
  requireProjectResourceReference,
  type ProjectResourceReference,
} from "../../canvas/project-resources"
import type { ProjectManagedAssetStore } from "./project-managed-asset-store"

export type ProjectCanvasResourceHost = Pick<ProjectFilesClient, "listDirectory" | "readFileInfo" | "readTextFile">

export interface ProjectCanvasFilePublisher {
  publishText(input: {
    content: string
    directory: "Notes"
    extension: ".md"
    name?: string
    projectId: string
  }): Promise<{ contentRevision: string; path: string }>
}

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

export class ProjectCanvasResourcePreparation implements CanvasResourcePreparationPort {
  constructor(
    private readonly project: ProjectCanvasResourceHost,
    private readonly publisher: ProjectCanvasFilePublisher,
    private readonly assets: ProjectManagedAssetStore,
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

  withAdmittedExternalFiles<T>(
    input: {
      files: readonly {
        mediaType?: string
        name: string
        sourceId: string
        sourcePath: string
      }[]
      projectId: string
    },
    commit: (prepared: CanvasResourcePreparationResult) => Promise<T>,
  ): Promise<T> {
    const sourceIds = new Set<string>()
    for (const file of input.files) {
      if (typeof file.sourceId !== "string" || !file.sourceId.trim()) {
        return Promise.reject(new Error("External Canvas resource source id is required"))
      }
      if (sourceIds.has(file.sourceId)) {
        return Promise.reject(new Error(`External Canvas resource source id is duplicated: ${file.sourceId}`))
      }
      sourceIds.add(file.sourceId)
    }

    return this.assets.withAdmittedExternalFiles(
      {
        files: input.files.map(({ mediaType, name, sourcePath }) => ({ mediaType, name, sourcePath })),
        projectId: input.projectId,
      },
      async (references) => {
        if (references.length !== input.files.length) {
          throw new Error("Managed asset admission returned an unexpected reference count")
        }
        return commit({
          items: references.map((reference, index) => managedPreparedItem(input.files[index]!.sourceId, reference)),
        })
      },
    )
  }

  private async prepareSource(
    projectId: string,
    source: CanvasResourceSource,
    signal?: AbortSignal,
  ): Promise<CanvasUploadItem> {
    throwIfAborted(signal)
    if (source.kind === "new-text") {
      const published = await this.publisher.publishText({
        content: source.text,
        directory: "Notes",
        extension: ".md",
        name: source.name,
        projectId,
      })
      throwIfAborted(signal)
      const reference = requireProjectFileReference(published.path)
      return {
        id: source.sourceId,
        kind: "text",
        metadata: metadataFor(reference),
        mimeType: "text/markdown",
        name: path.posix.basename(reference.path),
        state: {
          contentRevision: published.contentRevision,
          status: "ready",
          text: source.text,
        },
      }
    }

    if (source.kind === "host-directory") {
      const reference = requireProjectDirectoryReference(source.path)
      await this.project.listDirectory({ path: reference.path, projectId })
      throwIfAborted(signal)
      return {
        id: source.sourceId,
        kind: "folder",
        metadata: metadataFor(reference),
        name: path.posix.basename(reference.path),
        state: { status: "stale" },
      }
    }

    const reference = requireProjectFileReference(source.path)
    const sourceInfo = await this.project.readFileInfo({ path: reference.path, projectId })
    throwIfAborted(signal)
    const mimeType = normalizeMimeType(sourceInfo.mimeType)
    const textFormat = getCanvasTextFileFormat(sourceInfo)
    if (textFormat) {
      const text = await this.project.readTextFile({ path: reference.path, projectId })
      throwIfAborted(signal)
      if (!text.exists) throw new Error(`Project text file was not found: ${reference.path}`)
      return {
        id: source.sourceId,
        kind: "text",
        metadata: metadataFor(reference),
        mimeType: mimeType || textMimeTypeFor(textFormat),
        name: sourceInfo.name,
        state: {
          contentRevision: text.contentRevision,
          status: "ready",
          text: text.content,
        },
      }
    }

    const kind = mediaKindForMimeType(mimeType)
    const inspection =
      kind !== "file" && this.mediaInspector
        ? await this.mediaInspector.inspect({
            kind,
            mimeType,
            name: sourceInfo.name,
            path: reference.path,
            projectId,
          })
        : undefined
    throwIfAborted(signal)
    return {
      durationMs: inspection?.durationMs,
      height: inspection?.height,
      id: source.sourceId,
      kind,
      metadata: metadataFor(reference),
      mimeType: mimeType || undefined,
      name: sourceInfo.name,
      state: {
        ...(inspection?.posterUrl === undefined ? {} : { posterUrl: inspection.posterUrl }),
        status: "stale",
      },
      width: inspection?.width,
    }
  }
}

function managedPreparedItem(
  sourceId: string,
  reference: Extract<ProjectResourceReference, { kind: "managed-asset" }>,
): CanvasUploadItem {
  const mimeType = normalizeMimeType(reference.mediaType)
  const textFormat = getCanvasTextFileFormat({ mimeType, name: reference.name })
  if (textFormat) {
    return {
      id: sourceId,
      kind: "text",
      metadata: metadataFor(reference),
      mimeType: mimeType || textMimeTypeFor(textFormat),
      name: reference.name,
      state: { status: "stale" },
    }
  }
  return {
    id: sourceId,
    kind: mediaKindForMimeType(mimeType),
    metadata: metadataFor(reference),
    mimeType: mimeType || undefined,
    name: reference.name,
    state: { status: "stale" },
  }
}

function metadataFor(reference: ProjectResourceReference) {
  return { [projectResourceReferenceKey]: reference }
}

function requireProjectFileReference(path: string): Extract<ProjectResourceReference, { kind: "project-file" }> {
  const reference = requireProjectResourceReference({ kind: "project-file", path })
  if (reference.kind !== "project-file") throw new Error("Project file reference is required")
  return reference
}

function requireProjectDirectoryReference(
  path: string,
): Extract<ProjectResourceReference, { kind: "project-directory" }> {
  const reference = requireProjectResourceReference({ kind: "project-directory", path })
  if (reference.kind !== "project-directory") throw new Error("Project directory reference is required")
  return reference
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

function textMimeTypeFor(format: "markdown" | "plain") {
  return format === "markdown" ? "text/markdown" : "text/plain"
}

function throwIfAborted(signal?: AbortSignal) {
  if (!signal?.aborted) return
  throw signal.reason ?? new DOMException("Canvas resource preparation was canceled", "AbortError")
}
