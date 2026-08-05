import path from "node:path"
import { parseProjectIdV2 } from "@convax/collaboration"
import { getCanvasTextFileFormat, type CanvasMediaKind, type CanvasUploadItem } from "@convax/canvas/core"
import {
  canvasResourceProofMetadataKeyV2,
  type CanvasResourceProofRefV2,
} from "@convax/canvas/collaboration"
import type {
  CanvasResourcePreparationPort,
  CanvasResourcePreparationRequest,
  CanvasResourcePreparationResult,
  CanvasResourceSource,
} from "@convax/canvas/application"
import { CanvasResourcePartialFailureError } from "@convax/canvas/application"
import type { ProjectFilesClient } from "@convax/project-files/contracts"
import {
  projectResourceReferenceDigestV2,
  type ProjectResourceReferenceV2,
} from "../../collaboration/project-index"
import type { ProjectIndexFileApplicationPortV2 } from "../../canvas/project-index-file-application"
import {
  projectResourceReferenceKey,
  requireProjectResourceReference,
  type ProjectResourceReference,
} from "../../canvas/project-resources"
import { readStableProjectUtf8File } from "../stable-project-file"
import { defaultProjectTextPublicationMaximumBytes } from "./project-file-publisher"
import type { ProjectManagedAssetStore } from "./project-managed-asset-store"

export type ProjectCanvasResourceHost = Pick<ProjectFilesClient, "listDirectory" | "readFileInfo" | "readTextFile">

export interface ProjectCanvasFilePublisher {
  publishText(input: {
    content: string
    directory: "Notes"
    extension: ".md" | ".txt"
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
    private readonly indexFiles?: ProjectIndexFileApplicationPortV2,
  ) {}

  async prepare(request: CanvasResourcePreparationRequest): Promise<CanvasResourcePreparationResult> {
    throwIfAborted(request.signal)
    const items: CanvasUploadItem[] = []
    const retainedOnFailure: { label: string }[] = []
    try {
      for (const source of request.sources) {
        const prepared = await this.prepareSource(request.scopeId, source, request.signal)
        items.push(prepared.item)
        if (prepared.retainedOnFailure) retainedOnFailure.push(prepared.retainedOnFailure)
        throwIfAborted(request.signal)
      }
    } catch (error) {
      if (error instanceof CanvasResourcePartialFailureError) {
        if (retainedOnFailure.length === 0) throw error
        throw new CanvasResourcePartialFailureError(error.cause, [...retainedOnFailure, ...error.retainedOnFailure])
      }
      if (retainedOnFailure.length > 0) {
        throw new CanvasResourcePartialFailureError(error, retainedOnFailure)
      }
      throw error
    }
    return {
      items,
      ...(retainedOnFailure.length === 0 ? {} : { retainedOnFailure }),
    }
  }

  async prepareManagedTextEditableCopy(input: {
    projectId: string
    reference: ProjectResourceReference
    sourceId: string
  }): Promise<CanvasResourcePreparationResult> {
    if (typeof input.projectId !== "string" || !input.projectId.trim()) throw new Error("Project id is required")
    if (typeof input.sourceId !== "string" || !input.sourceId.trim()) {
      throw new Error("Managed text editable-copy source id is required")
    }
    const reference = requireProjectResourceReference(input.reference)
    if (reference.kind !== "managed-asset") {
      throw new Error("Managed text editable copy requires a managed asset reference")
    }
    const extension = managedEditableTextExtension(reference.name)
    if (!extension) throw new Error("Managed editable copy requires Markdown or plain text")
    const sourcePath = await this.assets.resolve({ projectId: input.projectId, reference })
    const contents = await readStableProjectUtf8File(
      sourcePath,
      `managed:${reference.sha256}`,
      defaultProjectTextPublicationMaximumBytes,
    )
    if (contents.contentRevision !== reference.sha256) {
      throw new Error("Managed editable-copy source digest does not match its reference")
    }
    const published = await this.publisher.publishText({
      content: contents.content,
      directory: "Notes",
      extension,
      name: reference.name,
      projectId: input.projectId,
    })
    const publishedReference = requireProjectFileReference(published.path)
    return {
      items: [
        {
          id: input.sourceId,
          kind: "text",
          metadata: metadataFor(publishedReference),
          mimeType: extension === ".md" ? "text/markdown" : "text/plain",
          name: path.posix.basename(publishedReference.path),
          state: {
            contentRevision: published.contentRevision,
            editableText: true,
            status: "ready",
            text: contents.content,
          },
        },
      ],
      retainedOnFailure: [{ label: publishedReference.path }],
    }
  }

  withAdmittedLocalFiles<T>(
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

    return this.assets.withAdmittedLocalFiles(
      {
        files: input.files.map(({ mediaType, name, sourcePath }) => ({ mediaType, name, sourcePath })),
        projectId: input.projectId,
      },
      async (references) => {
        if (references.length !== input.files.length) {
          throw new Error("Managed asset admission returned an unexpected reference count")
        }
        return commit({
          items: references.map((reference, index) => {
            if (reference.kind === "project-directory") {
              throw new Error("Local Canvas file admission returned a directory reference")
            }
            return localPreparedItem(input.files[index]!.sourceId, input.files[index]!, reference)
          }),
        })
      },
    )
  }

  private async prepareSource(
    projectId: string,
    source: CanvasResourceSource,
    signal?: AbortSignal,
  ): Promise<{ item: CanvasUploadItem; retainedOnFailure?: { label: string } }> {
    throwIfAborted(signal)
    if (source.kind === "new-text") {
      const published = await this.publisher.publishText({
        content: source.text,
        directory: "Notes",
        extension: ".md",
        name: source.name,
        projectId,
      })
      const reference = requireProjectFileReference(published.path)
      const proof = await this.publishTextProof({
        content: source.text,
        mime: "text/markdown",
        path: reference.path,
        projectId,
      })
      if (signal?.aborted) {
        throw new CanvasResourcePartialFailureError(
          signal.reason ?? new DOMException("Canvas resource preparation was canceled", "AbortError"),
          [{ label: reference.path }],
        )
      }
      return {
        item: {
          id: source.sourceId,
          kind: "text",
          metadata: metadataFor(reference, proof),
          mimeType: "text/markdown",
          name: path.posix.basename(reference.path),
          state: {
            contentRevision: published.contentRevision,
            status: "ready",
            text: source.text,
          },
        },
        retainedOnFailure: { label: reference.path },
      }
    }

    if (source.kind === "host-directory") {
      const reference = requireProjectDirectoryReference(source.path)
      await this.project.listDirectory({ path: reference.path, projectId })
      throwIfAborted(signal)
      return {
        item: {
          id: source.sourceId,
          kind: "folder",
          metadata: metadataFor(reference),
          name: path.posix.basename(reference.path),
          state: { status: "stale" },
        },
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
        item: {
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
      item: {
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
      },
    }
  }

  private async publishTextProof(input: {
    readonly content: string
    readonly mime: string
    readonly path: string
    readonly projectId: string
  }): Promise<Extract<CanvasResourceProofRefV2, { mode: "current-owner-state" }> | undefined> {
    if (!this.indexFiles) return undefined
    const projectId = parseProjectIdV2(input.projectId)
    await this.indexFiles.createDirectory({ projectId, path: path.posix.dirname(input.path) })
    const result = await this.indexFiles.publishFile({
      projectId,
      path: input.path,
      exactBytes: new TextEncoder().encode(input.content),
      mime: input.mime,
      contentPolicy: "conflict-preserving-text",
      provenance: "user",
    })
    if (result.status !== "committed" || result.reference == null) {
      throw new Error("ProjectIndex did not publish the Canvas resource")
    }
    return canvasProofForProjectReference(result.reference, "text")
  }
}

function localPreparedItem(
  sourceId: string,
  source: { mediaType?: string; name: string },
  reference: Exclude<ProjectResourceReference, { kind: "project-directory" }>,
): CanvasUploadItem {
  const name = reference.kind === "managed-asset" ? reference.name : source.name
  const mimeType = normalizeMimeType(reference.kind === "managed-asset" ? reference.mediaType : source.mediaType)
  const textFormat = getCanvasTextFileFormat({ mimeType, name })
  if (textFormat) {
    return {
      id: sourceId,
      kind: "text",
      metadata: metadataFor(reference),
      mimeType: mimeType || textMimeTypeFor(textFormat),
      name,
      state: { status: "stale" },
    }
  }
  return {
    id: sourceId,
    kind: mediaKindForMimeType(mimeType),
    metadata: metadataFor(reference),
    mimeType: mimeType || undefined,
    name,
    state: { status: "stale" },
  }
}

function metadataFor(
  reference: ProjectResourceReference,
  proof?: Extract<CanvasResourceProofRefV2, { mode: "current-owner-state" }>,
) {
  return {
    [projectResourceReferenceKey]: reference,
    ...(proof === undefined ? {} : { [canvasResourceProofMetadataKeyV2]: proof }),
  }
}

function canvasProofForProjectReference(
  reference: ProjectResourceReferenceV2,
  mediaClass: "text" | "image" | "video" | "audio" | "file",
): Extract<CanvasResourceProofRefV2, { mode: "current-owner-state" }> {
  const ownerProofDigest = projectResourceReferenceDigestV2(reference)
  const resource = Object.freeze({
    format: "convax.canvas-resource-ref/2" as const,
    uri: reference.canonicalUri,
    mediaClass,
    mime: reference.blob.mime,
    byteLength: reference.blob.byteLength,
    contentDigest: reference.blob.digest,
    ownerProofDigest,
  })
  return Object.freeze({
    format: "convax.canvas-resource-proof-ref/2" as const,
    mode: "current-owner-state" as const,
    resource,
    ownerProofDigest,
    requireCurrentLiveVersion: true as const,
  })
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

function managedEditableTextExtension(value: string): ".md" | ".txt" | null {
  const extension = path.posix.extname(value).toLowerCase()
  return extension === ".md" || extension === ".txt" ? extension : null
}
