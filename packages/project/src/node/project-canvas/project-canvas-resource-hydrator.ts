import { createHash } from "node:crypto"
import path from "node:path"
import type { CanvasDocument } from "@convax/canvas/core"
import type { ProjectDirectoryListing, ProjectFileInfo, ProjectTextFileContents } from "@convax/project-files"
import {
  hydrateProjectCanvasDocument,
  requireProjectResourceReference,
  type ProjectResourceReference,
  type ProjectResourceSnapshot,
} from "../../canvas/project-resources"
import { mimeTypeForPath } from "../project-manager-helpers"
import { readStableProjectFile, readStableProjectUtf8File } from "../stable-project-file"
import type { ProjectManagedAssetStore } from "./project-managed-asset-store"

interface ProjectResourceFilePort {
  listDirectory(input: { path?: string; projectId: string }): Promise<ProjectDirectoryListing>
  readFileInfo(input: { path: string; projectId: string }): Promise<ProjectFileInfo>
  readTextFile(input: { path: string; projectId: string }): Promise<ProjectTextFileContents>
  resolveEntryPath(input: { path?: string; projectId: string }): Promise<string>
}

export interface ProjectCanvasResourceUrlInput {
  contentRevision?: string
  projectId: string
  reference: Exclude<ProjectResourceReference, { kind: "project-directory" }>
}

export type ProjectCanvasResourceUrlFactory = (input: ProjectCanvasResourceUrlInput) => string

export interface ProjectCanvasResourceHydratorOptions {
  maximumMediaBytes?: number
  maximumTextBytes?: number
}

const defaultMaximumMediaBytes = 64 * 1024 * 1024
const defaultMaximumTextBytes = 16 * 1024 * 1024

export class ProjectCanvasResourceHydrator {
  readonly #maximumMediaBytes: number
  readonly #maximumTextBytes: number

  constructor(
    private readonly files: ProjectResourceFilePort,
    private readonly assets: Pick<ProjectManagedAssetStore, "resolve">,
    private readonly createUrl: ProjectCanvasResourceUrlFactory,
    options: ProjectCanvasResourceHydratorOptions = {},
  ) {
    const maximumMediaBytes = options.maximumMediaBytes ?? defaultMaximumMediaBytes
    const maximumTextBytes = options.maximumTextBytes ?? defaultMaximumTextBytes
    if (!Number.isSafeInteger(maximumMediaBytes) || maximumMediaBytes < 1) {
      throw new Error("Project Canvas media hydration limit must be a positive integer")
    }
    if (!Number.isSafeInteger(maximumTextBytes) || maximumTextBytes < 1) {
      throw new Error("Project Canvas text hydration limit must be a positive integer")
    }
    this.#maximumMediaBytes = maximumMediaBytes
    this.#maximumTextBytes = maximumTextBytes
  }

  hydrate(input: { document: CanvasDocument; projectId: string }) {
    return hydrateProjectCanvasDocument(input.document, (reference) =>
      this.resolve({ projectId: input.projectId, reference }),
    )
  }

  async resolve(input: {
    projectId: string
    reference: ProjectResourceReference
  }): Promise<ProjectResourceSnapshot> {
    let reference: ProjectResourceReference
    try {
      reference = requireProjectResourceReference(input.reference)
    } catch {
      return { error: "Project resource reference is invalid", status: "corrupt" }
    }

    if (reference.kind === "project-directory") {
      try {
        await this.files.listDirectory({ path: reference.path, projectId: input.projectId })
        return { name: path.posix.basename(reference.path), status: "ready" }
      } catch (error) {
        return isMissing(error) ? { status: "missing" } : { error: "Project directory is unavailable", status: "corrupt" }
      }
    }

    if (reference.kind === "project-file") return this.#resolveProjectFile(input.projectId, reference)
    return this.#resolveManagedAsset(input.projectId, reference)
  }

  async #resolveProjectFile(
    projectId: string,
    reference: Extract<ProjectResourceReference, { kind: "project-file" }>,
  ): Promise<ProjectResourceSnapshot> {
    const mediaType = mimeTypeForPath(reference.path)
    const name = path.posix.basename(reference.path)
    if (isEditableTextPath(reference.path)) {
      try {
        const contents = await this.files.readTextFile({ path: reference.path, projectId })
        if (!contents.exists) return { status: "missing" }
        return {
          contentRevision: contents.contentRevision,
          editableText: true,
          mediaType,
          name,
          status: "ready",
          text: contents.content,
        }
      } catch (error) {
        if (isMissing(error)) return { status: "missing" }
        return { error: "Project text resource is corrupt", status: "corrupt" }
      }
    }

    try {
      const info = await this.files.readFileInfo({ path: reference.path, projectId })
      if (!isUrlResourceMediaType(info.mimeType)) return { status: "unsupported" }
      const absolutePath = await this.files.resolveEntryPath({ path: reference.path, projectId })
      const { bytes } = await readStableProjectFile(
        absolutePath,
        reference.path,
        this.#maximumMediaBytes,
      )
      const contentRevision = createHash("sha256").update(bytes).digest("hex")
      return {
        contentRevision,
        mediaType: info.mimeType,
        name: info.name,
        status: "ready",
        url: this.createUrl({ contentRevision, projectId, reference }),
      }
    } catch (error) {
      return isMissing(error) ? { status: "missing" } : { error: "Project resource is corrupt", status: "corrupt" }
    }
  }

  async #resolveManagedAsset(
    projectId: string,
    reference: Extract<ProjectResourceReference, { kind: "managed-asset" }>,
  ): Promise<ProjectResourceSnapshot> {
    let absolutePath: string
    try {
      absolutePath = await this.assets.resolve({ projectId, reference })
    } catch (error) {
      return isMissing(error) ? { status: "missing" } : { error: "Managed resource is corrupt", status: "corrupt" }
    }

    const mediaType = reference.mediaType ?? mimeTypeForPath(reference.name)
    if (isEditableTextPath(reference.name)) {
      try {
        const contents = await readStableProjectUtf8File(
          absolutePath,
          `managed:${reference.sha256}`,
          this.#maximumTextBytes,
        )
        if (contents.contentRevision !== reference.sha256) {
          return { error: "Managed resource is corrupt", status: "corrupt" }
        }
        return {
          contentRevision: contents.contentRevision,
          editableText: false,
          mediaType,
          name: reference.name,
          status: "ready",
          text: contents.content,
        }
      } catch {
        return { error: "Managed resource is corrupt", status: "corrupt" }
      }
    }

    if (!isUrlResourceMediaType(mediaType)) return { status: "unsupported" }
    try {
      return {
        mediaType,
        name: reference.name,
        status: "ready",
        url: this.createUrl({ projectId, reference }),
      }
    } catch {
      return { error: "Managed resource is corrupt", status: "corrupt" }
    }
  }
}

function isEditableTextPath(value: string) {
  const extension = path.posix.extname(value).toLowerCase()
  return extension === ".md" || extension === ".txt"
}

function isUrlResourceMediaType(mediaType: string) {
  return /^(?:audio|image|video)\//.test(mediaType) || mediaType === "application/pdf"
}

function isMissing(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT")
}
