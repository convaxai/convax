import { requireProjectResourceReference, type ProjectResourceReference } from "../canvas/project-resources"
import { mimeTypeForPath } from "./project-manager-helpers"
import { openStableProjectFile } from "./stable-project-file"

type ReadableProjectResourceReference = Exclude<ProjectResourceReference, { kind: "project-directory" }>
type ManagedAssetReference = Extract<ProjectResourceReference, { kind: "managed-asset" }>

interface ProjectResourceFileResolver {
  resolveEntryPath(input: { path?: string; projectId: string }): Promise<string>
}

export interface ProjectResourceReadHandle {
  readonly size: number
  close(): Promise<void>
  createReadStream(input: { end: number; signal?: AbortSignal; start: number }): ReadableStream<Uint8Array>
  digest(signal?: AbortSignal): Promise<string>
}

export interface ProjectResourceAssetResolver {
  openForRead(input: {
    projectId: string
    reference: ManagedAssetReference
    signal?: AbortSignal
  }): Promise<ProjectResourceReadHandle>
}

export interface ProjectResourceReadInput {
  contentRevision?: string
  head?: boolean
  projectId: string
  range?: string | null
  reference: ReadableProjectResourceReference
  signal?: AbortSignal
}

export interface ProjectResourceReadReady {
  body: ReadableStream<Uint8Array> | null
  contentLength: number
  contentRange?: {
    end: number
    start: number
  }
  kind: ReadableProjectResourceReference["kind"]
  mediaType: string
  size: number
  status: "ready"
}

export interface ProjectResourceRangeNotSatisfiable {
  kind: ReadableProjectResourceReference["kind"]
  mediaType: string
  size: number
  status: "range-not-satisfiable"
}

export type ProjectResourceReadResult = ProjectResourceReadReady | ProjectResourceRangeNotSatisfiable

export interface ProjectResourceReaderOptions {
  maximumProjectFileBytes?: number
}

const defaultMaximumProjectFileBytes = 64 * 1024 * 1024

export class ProjectResourceReader {
  readonly #maximumProjectFileBytes: number

  constructor(
    private readonly files: ProjectResourceFileResolver,
    private readonly assets: ProjectResourceAssetResolver,
    options: ProjectResourceReaderOptions = {},
  ) {
    this.#maximumProjectFileBytes = options.maximumProjectFileBytes ?? defaultMaximumProjectFileBytes
    if (!Number.isSafeInteger(this.#maximumProjectFileBytes) || this.#maximumProjectFileBytes < 1) {
      throw new Error("Project resource file byte limit must be a positive safe integer")
    }
  }

  async read(input: ProjectResourceReadInput): Promise<ProjectResourceReadResult> {
    input.signal?.throwIfAborted()
    const reference = requireReadableReference(input.reference)
    const expectedDigest = expectedResourceDigest(reference, input.contentRevision)
    const mediaType =
      reference.kind === "project-file"
        ? mimeTypeForPath(reference.path)
        : (reference.mediaType ?? mimeTypeForPath(reference.name))
    const label = reference.kind === "project-file" ? reference.path : `managed:${reference.sha256}`
    const opened =
      reference.kind === "project-file"
        ? await this.#openProjectFile(input.projectId, reference.path, label, input.signal)
        : await this.assets.openForRead({
            projectId: input.projectId,
            reference,
            ...(input.signal ? { signal: input.signal } : {}),
          })
    try {
      if (expectedDigest) {
        const actualDigest = await opened.digest(input.signal)
        if (actualDigest !== expectedDigest) {
          throw new Error("Project file content revision does not match the opened file")
        }
      }

      const range = parseProjectResourceRange(input.range ?? null, opened.size)
      if (range === "unsatisfiable") {
        await opened.close()
        return {
          kind: reference.kind,
          mediaType,
          size: opened.size,
          status: "range-not-satisfiable",
        }
      }

      const start = range?.start ?? 0
      const end = range?.end ?? opened.size - 1
      const contentLength = opened.size === 0 ? 0 : end - start + 1
      if (input.head || opened.size === 0) {
        await opened.close()
        return {
          body: null,
          contentLength,
          ...(range ? { contentRange: range } : {}),
          kind: reference.kind,
          mediaType,
          size: opened.size,
          status: "ready",
        }
      }

      const body = opened.createReadStream({
        end,
        ...(input.signal ? { signal: input.signal } : {}),
        start,
      })
      return {
        body,
        contentLength,
        ...(range ? { contentRange: range } : {}),
        kind: reference.kind,
        mediaType,
        size: opened.size,
        status: "ready",
      }
    } catch (error) {
      await opened.close()
      throw error
    }
  }

  async #openProjectFile(projectId: string, path: string, label: string, signal?: AbortSignal) {
    const absolutePath = await this.files.resolveEntryPath({ path, projectId })
    signal?.throwIfAborted()
    return openStableProjectFile(absolutePath, label, this.#maximumProjectFileBytes, signal)
  }
}

function requireReadableReference(value: unknown): ReadableProjectResourceReference {
  const reference = requireProjectResourceReference(value)
  if (reference.kind === "project-directory") throw new Error("Project directories cannot be read as resources")
  return reference
}

function expectedResourceDigest(reference: ReadableProjectResourceReference, contentRevision: unknown) {
  if (reference.kind === "managed-asset") {
    if (contentRevision !== undefined) throw new Error("Managed asset reads use their content digest")
    return null
  }
  if (typeof contentRevision !== "string" || !/^[a-f0-9]{64}$/.test(contentRevision)) {
    throw new Error("Project file content revision is invalid")
  }
  return contentRevision
}

function parseProjectResourceRange(
  value: string | null,
  size: number,
): { end: number; start: number } | "unsatisfiable" | null {
  if (!value) return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim())
  if (!match || (!match[1] && !match[2]) || size === 0) return "unsatisfiable"
  let start: number
  let end: number
  if (!match[1]) {
    const suffix = Number(match[2])
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return "unsatisfiable"
    start = Math.max(0, size - suffix)
    end = size - 1
  } else {
    start = Number(match[1])
    end = match[2] ? Number(match[2]) : size - 1
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) {
      return "unsatisfiable"
    }
    end = Math.min(end, size - 1)
  }
  return { end, start }
}
