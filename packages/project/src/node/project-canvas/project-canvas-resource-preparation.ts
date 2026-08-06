import path from "node:path"
import { ordinarySha256, parseProjectId } from "@convax/collaboration"
import { getCanvasTextFileFormat, type CanvasMediaKind, type CanvasUploadItem } from "@convax/canvas/core"
import { canvasResourceProofMetadataKey, type CanvasResourceProofRef } from "@convax/canvas/collaboration"
import type {
  CanvasResourcePreparationPort,
  CanvasResourcePreparationRequest,
  CanvasResourcePreparationResult,
  CanvasResourceSource,
} from "@convax/canvas/application"
import { CanvasResourcePartialFailureError } from "@convax/canvas/application"
import type { ProjectContentPolicy } from "../../collaboration/project-index"
import type { ProjectFilesClient } from "@convax/project-files/contracts"
import { projectIndexResourceReferenceDigest, type ProjectIndexResourceReference } from "../../collaboration/project-index"
import type {
  ProjectIndexFileApplicationPort,
  ProjectIndexFileMaterializationPlan,
  ProjectIndexFileMaterializationProjectionPort,
  ProjectIndexManagedBlobAdmission,
} from "../../canvas/project-index-file-application"
import {
  projectResourceReferenceKey,
  requireProjectResourceReference,
  type ProjectResourceReference,
} from "../../canvas/project-resources"
import { readStableProjectUtf8File } from "../stable-project-file"
import { defaultProjectTextPublicationMaximumBytes } from "./project-file-publisher"
import type { ProjectManagedAssetStore } from "./project-managed-asset-store"

export type ProjectCanvasResourceHost = Pick<
  ProjectFilesClient,
  "listDirectory" | "readFile" | "readFileInfo" | "readTextFile"
>

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
    private readonly indexFiles?: ProjectIndexFileApplicationPort & ProjectIndexFileMaterializationProjectionPort,
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
    const proof = await this.publishProjectFileProof({
      exactBytes: new TextEncoder().encode(contents.content),
      mediaClass: "text",
      mime: extension === ".md" ? "text/markdown" : "text/plain",
      path: publishedReference.path,
      projectId: input.projectId,
    })
    return {
      items: [
        {
          id: input.sourceId,
          kind: "text",
          metadata: metadataFor(publishedReference, proof),
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
        const items: CanvasUploadItem[] = []
        for (const [index, reference] of references.entries()) {
          if (reference.kind === "project-directory") {
            throw new Error("Local Canvas file admission returned a directory reference")
          }
          const selectedFile = input.files[index]!
          const projectFileInfo =
            reference.kind === "project-file"
              ? await this.project.readFileInfo({ path: reference.path, projectId: input.projectId })
              : undefined
          const file = projectFileInfo
            ? { mediaType: projectFileInfo.mimeType, name: projectFileInfo.name }
            : selectedFile
          const mimeType = normalizeMimeType(
            reference.kind === "managed-asset" ? reference.mediaType : file.mediaType,
          )
          const kind = getCanvasTextFileFormat({ mimeType, name: file.name })
            ? "text"
            : mediaKindForMimeType(mimeType)
          const proof =
            reference.kind === "project-file"
              ? await this.publishProjectFileProof({
                  mediaClass: kind,
                  mime: mimeType || "application/octet-stream",
                  path: reference.path,
                  projectId: input.projectId,
                })
              : await this.publishManagedAssetProof({
                  mediaClass: kind,
                  mime: mimeType || "application/octet-stream",
                  projectId: input.projectId,
                  reference,
                })
          items.push(localPreparedItem(selectedFile.sourceId, file, reference, proof))
        }
        return commit({ items })
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
      const [publication, initialPlan] = await Promise.allSettled([
        this.publisher.publishText({
          content: source.text,
          directory: "Notes",
          extension: ".md",
          name: source.name,
          projectId,
        }),
        this.prepareProjectIndexParent(projectId, "Notes/pending.md"),
      ])
      if (publication.status === "rejected") throw publication.reason
      const published = publication.value
      if (initialPlan.status === "rejected") {
        throw new CanvasResourcePartialFailureError(initialPlan.reason, [{ label: published.path }])
      }
      const reference = requireProjectFileReference(published.path)
      let proof: Extract<CanvasResourceProofRef, { mode: "current-owner-state" }> | undefined
      try {
        proof = await this.publishTextProof({
          content: source.text,
          ...(initialPlan.value === undefined ? {} : { initialPlan: initialPlan.value }),
          mime: "text/markdown",
          path: reference.path,
          projectId,
        })
      } catch (error) {
        if (error instanceof CanvasResourcePartialFailureError) throw error
        throw new CanvasResourcePartialFailureError(error, [{ label: reference.path }])
      }
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
      const proof = await this.publishProjectFileProof({
        mediaClass: "text",
        mime: mimeType || textMimeTypeFor(textFormat),
        path: reference.path,
        projectId,
      })
      throwIfAborted(signal)
      return {
        item: {
          id: source.sourceId,
          kind: "text",
          metadata: metadataFor(reference, proof),
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
    const proof = await this.publishProjectFileProof({
      mediaClass: kind,
      mime: mimeType || "application/octet-stream",
      path: reference.path,
      projectId,
    })
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
        metadata: metadataFor(reference, proof),
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
    readonly initialPlan?: ProjectIndexFileMaterializationPlan
    readonly mime: string
    readonly path: string
    readonly projectId: string
  }): Promise<Extract<CanvasResourceProofRef, { mode: "current-owner-state" }> | undefined> {
    if (!this.indexFiles) return undefined
    const projectId = parseProjectId(input.projectId)
    return this.publishProjectFileProof({
      exactBytes: new TextEncoder().encode(input.content),
      ...(input.initialPlan === undefined ? {} : { initialPlan: input.initialPlan }),
      mediaClass: "text",
      mime: input.mime,
      path: input.path,
      projectId,
    })
  }

  private async publishProjectFileProof(input: {
    readonly exactBytes?: Uint8Array
    readonly initialPlan?: ProjectIndexFileMaterializationPlan
    readonly mediaClass: "text" | "image" | "video" | "audio" | "file"
    readonly mime: string
    readonly path: string
    readonly projectId: string
  }): Promise<Extract<CanvasResourceProofRef, { mode: "current-owner-state" }> | undefined> {
    if (!this.indexFiles) return undefined
    const projectId = parseProjectId(input.projectId)
    const contents =
      input.exactBytes === undefined
        ? await this.project.readFile({ path: input.path, projectId: input.projectId })
        : undefined
    if (
      contents &&
      (contents.path !== input.path || contents.size < 0 || normalizeMimeType(contents.mimeType) !== input.mime)
    ) {
      throw new Error("Project file identity changed during Canvas resource preparation")
    }
    const bytes = input.exactBytes ?? decodeProjectFileDataUrl(contents!.dataUrl)
    if (contents && contents.size !== bytes.byteLength) {
      throw new Error("Project file size changed during Canvas resource preparation")
    }
    let plan = input.initialPlan ?? await this.indexFiles.queryFileMaterializationPlan({ projectId })
    const existing = plan.entries.find((entry) => entry.path === input.path)
    if (existing?.kind === "directory") throw new Error("ProjectIndex path is a directory")
    if (
      existing?.reference &&
      existing.reference.blob.digest === ordinarySha256(bytes) &&
      existing.reference.blob.byteLength === String(bytes.byteLength) &&
      existing.reference.blob.mime === input.mime
    ) {
      return canvasProofForProjectReference(existing.reference, input.mediaClass)
    }

    await this.ensureProjectIndexDirectories(projectId, input.path, plan)
    const result = await this.indexFiles.publishFile({
      projectId,
      path: input.path,
      exactBytes: bytes,
      mime: input.mime,
      contentPolicy: contentPolicyForProjectFile(input.path, input.mediaClass),
      provenance: input.path === "Generated" || input.path.startsWith("Generated/") ? "generated" : "user",
    })
    if (result.status !== "committed" || result.reference == null) {
      throw new Error("ProjectIndex did not publish the Canvas resource")
    }
    return canvasProofForProjectReference(result.reference, input.mediaClass)
  }

  private async prepareProjectIndexParent(
    projectIdInput: string,
    filePath: string,
  ): Promise<ProjectIndexFileMaterializationPlan | undefined> {
    if (!this.indexFiles) return undefined
    const projectId = parseProjectId(projectIdInput)
    const plan = await this.indexFiles.queryFileMaterializationPlan({ projectId })
    return this.ensureProjectIndexDirectories(projectId, filePath, plan)
  }

  private async publishManagedAssetProof(input: {
    readonly mediaClass: "text" | "image" | "video" | "audio" | "file"
    readonly mime: string
    readonly projectId: string
    readonly reference: Extract<ProjectResourceReference, { kind: "managed-asset" }>
  }): Promise<Extract<CanvasResourceProofRef, { mode: "current-owner-state" }> | undefined> {
    if (!this.indexFiles) return undefined
    const handle = await this.assets.openForRead({ projectId: input.projectId, reference: input.reference })
    const digest = await handle.digest()
    if (digest !== input.reference.sha256) {
      await handle.close()
      throw new Error("Managed Canvas resource digest changed during owner publication")
    }
    let consumed = false
    const admission: ProjectIndexManagedBlobAdmission = Object.freeze({
      blob: Object.freeze({
        format: "convax.blob-ref" as const,
        algorithm: "sha256" as const,
        digest: input.reference.sha256 as never,
        byteLength: String(handle.size) as never,
        mime: input.mime,
      }),
      async readChunks(
        consume: Parameters<ProjectIndexManagedBlobAdmission["readChunks"]>[0],
        signal?: AbortSignal,
      ) {
        if (consumed) throw new Error("Managed Canvas resource admission was already consumed")
        consumed = true
        if (handle.size === 0) {
          await handle.close()
          return
        }
        const reader = handle.createReadStream({ start: 0, end: handle.size - 1, signal }).getReader()
        try {
          while (true) {
            const next = await reader.read()
            if (next.done) break
            await consume(next.value)
          }
        } finally {
          reader.releaseLock()
          await handle.close()
        }
      },
    })
    try {
      const result = await this.indexFiles.admitManagedBlob({
        projectId: parseProjectId(input.projectId),
        admission,
      })
      if (result.status !== "committed" || result.reference == null) {
        throw new Error("ProjectIndex did not publish the managed Canvas resource")
      }
      return canvasProofForProjectReference(result.reference, input.mediaClass)
    } finally {
      await handle.close()
    }
  }

  private async ensureProjectIndexDirectories(
    projectId: ReturnType<typeof parseProjectId>,
    filePath: string,
    initialPlan: ProjectIndexFileMaterializationPlan,
  ): Promise<ProjectIndexFileMaterializationPlan> {
    if (!this.indexFiles) return initialPlan
    let plan = initialPlan
    let current = ""
    for (const segment of path.posix.dirname(filePath).split("/").filter(Boolean)) {
      current = current ? `${current}/${segment}` : segment
      const existing = plan.entries.find((entry) => entry.path === current)
      if (existing?.kind === "file") throw new Error("ProjectIndex parent path is a file")
      if (existing?.kind === "directory") continue
      const result = await this.indexFiles.createDirectory({ projectId, path: current })
      if (result.status !== "committed") {
        plan = await this.indexFiles.queryFileMaterializationPlan({ projectId })
        if (plan.entries.find((entry) => entry.path === current)?.kind !== "directory") {
          throw new Error("ProjectIndex did not publish the Canvas resource directory")
        }
      } else {
        plan = Object.freeze({
          projectId,
          entries: Object.freeze([
            ...plan.entries,
            Object.freeze({ entryId: result.entryId, kind: "directory" as const, path: current, reference: null }),
          ]),
        })
      }
    }
    return plan
  }
}

function localPreparedItem(
  sourceId: string,
  source: { mediaType?: string; name: string },
  reference: Exclude<ProjectResourceReference, { kind: "project-directory" }>,
  proof?: Extract<CanvasResourceProofRef, { mode: "current-owner-state" }>,
): CanvasUploadItem {
  const name = reference.kind === "managed-asset" ? reference.name : source.name
  const mimeType = normalizeMimeType(reference.kind === "managed-asset" ? reference.mediaType : source.mediaType)
  const textFormat = getCanvasTextFileFormat({ mimeType, name })
  if (textFormat) {
    return {
      id: sourceId,
      kind: "text",
      metadata: metadataFor(reference, proof),
      mimeType: mimeType || textMimeTypeFor(textFormat),
      name,
      state: { status: "stale" },
    }
  }
  return {
    id: sourceId,
    kind: mediaKindForMimeType(mimeType),
    metadata: metadataFor(reference, proof),
    mimeType: mimeType || undefined,
    name,
    state: { status: "stale" },
  }
}

function contentPolicyForProjectFile(
  filePath: string,
  mediaClass: "text" | "image" | "video" | "audio" | "file",
): Exclude<ProjectContentPolicy, "none"> {
  if (filePath === "Generated" || filePath.startsWith("Generated/")) return "immutable"
  return mediaClass === "text" ? "conflict-preserving-text" : "overwritable-binary"
}

function decodeProjectFileDataUrl(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(",")
  if (comma < 0 || !dataUrl.slice(0, comma).endsWith(";base64")) {
    throw new Error("Project file data URL is invalid")
  }
  const encoded = dataUrl.slice(comma + 1)
  const bytes = Buffer.from(encoded, "base64")
  if (bytes.toString("base64") !== encoded) throw new Error("Project file data URL is not canonical base64")
  return Uint8Array.from(bytes)
}

function metadataFor(
  reference: ProjectResourceReference,
  proof?: Extract<CanvasResourceProofRef, { mode: "current-owner-state" }>,
) {
  return {
    [projectResourceReferenceKey]: reference,
    ...(proof === undefined ? {} : { [canvasResourceProofMetadataKey]: proof }),
  }
}

function canvasProofForProjectReference(
  reference: ProjectIndexResourceReference,
  mediaClass: "text" | "image" | "video" | "audio" | "file",
): Extract<CanvasResourceProofRef, { mode: "current-owner-state" }> {
  const ownerProofDigest = projectIndexResourceReferenceDigest(reference)
  const resource = Object.freeze({
    format: "convax.canvas-resource-ref" as const,
    uri: reference.canonicalUri,
    mediaClass,
    mime: reference.blob.mime,
    byteLength: reference.blob.byteLength,
    contentDigest: reference.blob.digest,
    ownerProofDigest,
  })
  return Object.freeze({
    format: "convax.canvas-resource-proof-ref" as const,
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
