import {
  ordinarySha256V2,
  parseId128V2,
  parseProjectIdV2,
  type Id128V2,
  type OwnerIntentConstructionContextV2,
  type PreparedLocalIntentV2,
  type ProjectIdV2,
  type Uint64V2,
} from "@convax/collaboration"
import { parseProjectEntryId, type ProjectEntryId, type ProjectFileId } from "@convax/project-files/identity"
import {
  constructProjectDirectoryCreateIntentV2,
  constructProjectEntryLocateIntentV2,
  constructProjectEntryTombstoneIntentV2,
  constructProjectFileCreateIntentV2,
  constructProjectFileWriteIntentV2,
  projectIndexCurrentBlobReferencesFromValidatedOwnerStateV2,
  projectEntryLocationProjectionV2,
  projectIndexIntentDependenciesV2,
  projectIndexIntentDigestV2,
  projectIndexSnapshotFromValidatedOwnerStateV2,
  projectResourceReferenceDigestV2,
  projectResourceReferenceForVersionV2,
  type ProjectBlobRefV2,
  type ProjectContentPolicyV2,
  type ProjectDirectoryIdV2,
  type ProjectIndexIntentV2,
  type ProjectIndexSnapshotV2,
  type ProjectResourceReferenceV2,
} from "../collaboration/project-index"
import type {
  ProjectIndexDocumentSessionPortV2,
  ProjectIndexFactResolutionPortV2,
} from "./project-index-application"

export interface ProjectIndexBlobPublicationPortV2 {
  admitManaged(input: {
    readonly reference: ProjectResourceReferenceV2
    readonly admission: ProjectIndexManagedBlobAdmissionV2
  }): Promise<void>
  publish(input: {
    readonly reference: ProjectResourceReferenceV2
    readonly exactBytes: Readonly<Uint8Array>
  }): Promise<void>
}

/** Main-only, process-local verified byte source. It must never enter portable state. */
export interface ProjectIndexManagedBlobAdmissionV2 {
  readonly blob: ProjectBlobRefV2
  readChunks(
    consume: (chunk: Readonly<Uint8Array>) => Promise<void>,
    signal?: AbortSignal,
  ): Promise<void>
}

export const projectIndexResourceReferenceDigestV2 = projectResourceReferenceDigestV2

export type ProjectIndexFileMutationResultV2 =
  | Readonly<{
      status: "committed"
      entryId: ProjectEntryId
      versionId: string | null
      reference?: ProjectResourceReferenceV2 | null
    }>
  | Readonly<{
      status: "partial-success"
      code: "entry-not-found" | "parent-not-found" | "path-kind-mismatch" | "blob-publication-failed" | "index-commit-failed"
    }>

export interface ProjectIndexFileApplicationPortV2 {
  createDirectory(input: { readonly projectId: ProjectIdV2; readonly path: string }): Promise<ProjectIndexFileMutationResultV2>
  admitManagedBlob(input: {
    readonly projectId: ProjectIdV2
    readonly admission: ProjectIndexManagedBlobAdmissionV2
  }): Promise<ProjectIndexFileMutationResultV2>
  publishFile(input: {
    readonly projectId: ProjectIdV2
    readonly path: string
    readonly exactBytes: Readonly<Uint8Array>
    readonly mime: string
    readonly contentPolicy: Exclude<ProjectContentPolicyV2, "none" | "immutable"> | "immutable"
    readonly provenance?: "user" | "generated"
  }): Promise<ProjectIndexFileMutationResultV2>
  relocateEntry(input: {
    readonly projectId: ProjectIdV2
    readonly currentPath: string
    readonly nextPath: string
    readonly reason: "move" | "rename"
  }): Promise<ProjectIndexFileMutationResultV2>
  tombstoneEntry(input: { readonly projectId: ProjectIdV2; readonly path: string }): Promise<ProjectIndexFileMutationResultV2>
}

export interface ProjectIndexFileMaterializationEntryV2 {
  readonly entryId: ProjectEntryId
  readonly kind: "directory" | "file"
  readonly path: string
  readonly reference: ProjectResourceReferenceV2 | null
}

export interface ProjectIndexFileMaterializationPlanV2 {
  readonly projectId: ProjectIdV2
  readonly entries: readonly ProjectIndexFileMaterializationEntryV2[]
}

/**
 * Project-owned logical projection consumed by the native Project/node
 * materializer. It deliberately exposes stable identity plus a current path and
 * hash-pinned resource; native enumeration never becomes document authority.
 */
export interface ProjectIndexFileMaterializationProjectionPortV2 {
  queryFileMaterializationPlan(input: {
    readonly projectId: ProjectIdV2
  }): Promise<ProjectIndexFileMaterializationPlanV2>
}

export class ProjectIndexFileApplicationV2 implements ProjectIndexFileApplicationPortV2, ProjectIndexFileMaterializationProjectionPortV2 {
  constructor(private readonly options: {
    readonly session: ProjectIndexDocumentSessionPortV2
    readonly facts: ProjectIndexFactResolutionPortV2
    readonly blobs: ProjectIndexBlobPublicationPortV2
    readonly createOperationId: () => Id128V2
  }) {}

  async queryFileMaterializationPlan(input: { readonly projectId: ProjectIdV2 }): Promise<ProjectIndexFileMaterializationPlanV2> {
    this.requireProject(input.projectId)
    return this.options.session.query((state) => {
      const snapshot = requireSnapshot(state)
      const references = new Map(
        projectIndexCurrentBlobReferencesFromValidatedOwnerStateV2(state)
          .map((reference) => [reference.entryFileId, reference] as const),
      )
      const entries: ProjectIndexFileMaterializationEntryV2[] = []
      for (const entry of snapshot.entries.values()) {
        if (entry.entryId === snapshot.identity.rootDirectoryId || entry.storageClass === "managed-blob") continue
        const location = projectEntryLocationProjectionV2(snapshot, entry.entryId)
        if ((location.state !== "live-linked" && location.state !== "conflict-path") || location.portablePath === null) continue
        const reference = entry.kind === "file" ? references.get(entry.entryId as ProjectFileId) ?? null : null
        if (entry.kind === "file" && reference === null) throw new FileApplicationError("index-commit-failed")
        entries.push(Object.freeze({
          entryId: parseProjectEntryId(entry.entryId),
          kind: entry.kind,
          path: location.portablePath,
          reference,
        }))
      }
      entries.sort((left, right) => {
        const depth = left.path.split("/").length - right.path.split("/").length
        return depth === 0 ? left.path.localeCompare(right.path, "en-US") : depth
      })
      return Object.freeze({ projectId: snapshot.identity.projectId, entries: Object.freeze(entries) })
    })
  }

  async createDirectory(input: { readonly projectId: ProjectIdV2; readonly path: string }): Promise<ProjectIndexFileMutationResultV2> {
    this.requireProject(input.projectId)
    const target = parsePortablePath(input.path)
    if (target.basename === "") return { status: "partial-success", code: "path-kind-mismatch" }
    let directoryId: ProjectDirectoryIdV2 | undefined
    try {
      await this.options.session.submit({
        operationId: parseId128V2(this.options.createOperationId()),
        prepare: ({ base, context }) => {
          const snapshot = requireSnapshot(base)
          const parent = resolvePath(snapshot, target.parentPath)
          if (!parent || parent.kind !== "directory") throw new FileApplicationError("parent-not-found")
          const constructed = constructProjectDirectoryCreateIntentV2({ snapshot, context, parentDirectoryId: parent.entryId as ProjectDirectoryIdV2, basename: target.basename })
          if (constructed === "rejected") throw new FileApplicationError("index-commit-failed")
          directoryId = constructed.directoryId
          return this.prepare(context, constructed.intent)
        },
      })
      if (!directoryId) throw new FileApplicationError("index-commit-failed")
      return { status: "committed", entryId: directoryId, versionId: null, reference: null }
    } catch (error) {
      console.error("ProjectIndex directory create failed", error)
      return rejectFileMutation(error)
    }
  }

  async publishFile(input: Parameters<ProjectIndexFileApplicationPortV2["publishFile"]>[0]): Promise<ProjectIndexFileMutationResultV2> {
    this.requireProject(input.projectId)
    const target = parsePortablePath(input.path)
    const exactBytes = new Uint8Array(input.exactBytes)
    const blob: ProjectBlobRefV2 = Object.freeze({
      format: "convax.blob-ref/2",
      algorithm: "sha256",
      digest: ordinarySha256V2(exactBytes),
      byteLength: String(exactBytes.byteLength) as Uint64V2,
      mime: input.mime,
    })
    let entryId: ProjectFileId | undefined
    let versionId: string | undefined
    let committedReference: ProjectResourceReferenceV2 | undefined
    try {
      await this.options.session.submit({
        operationId: parseId128V2(this.options.createOperationId()),
        prepare: async ({ base, context }) => {
          const snapshot = requireSnapshot(base)
          const existing = resolvePath(snapshot, target.path)
          let intent: ProjectIndexIntentV2
          let reference: ProjectResourceReferenceV2
          if (existing === null) {
            const parent = resolvePath(snapshot, target.parentPath)
            if (!parent || parent.kind !== "directory") throw new FileApplicationError("parent-not-found")
            const constructed = constructProjectFileCreateIntentV2({
              snapshot,
              context,
              parentDirectoryId: parent.entryId as ProjectDirectoryIdV2,
              basename: target.basename,
              blob,
              contentPolicy: input.contentPolicy,
              storageClass: "project-file",
              provenance: input.provenance ?? "user",
              pathHint: target.path,
            })
            if (constructed === "rejected") throw new FileApplicationError("index-commit-failed")
            entryId = constructed.fileId
            versionId = constructed.version.versionId
            intent = constructed.intent
            reference = projectResourceReferenceForVersionV2(snapshot, constructed.version)
          } else {
            if (existing.kind !== "file") throw new FileApplicationError("path-kind-mismatch")
            const constructed = constructProjectFileWriteIntentV2({
              snapshot,
              context,
              fileId: existing.entryId as ProjectFileId,
              blob,
              pathHint: target.path,
              basenameHint: target.basename,
            })
            if (constructed === "rejected") throw new FileApplicationError("path-kind-mismatch")
            entryId = existing.entryId as ProjectFileId
            versionId = constructed.version.versionId
            intent = constructed.intent
            reference = projectResourceReferenceForVersionV2(snapshot, constructed.version)
          }
          committedReference = reference
          try { await this.options.blobs.publish({ reference, exactBytes }) }
          catch (error) { throw new FileApplicationError("blob-publication-failed", { cause: error }) }
          return this.prepare(context, intent)
        },
      })
      if (!entryId || !versionId || !committedReference) throw new FileApplicationError("index-commit-failed")
      return { status: "committed", entryId, versionId, reference: committedReference }
    } catch (error) {
      console.error("ProjectIndex file publish failed", error)
      return rejectFileMutation(error)
    }
  }

  async admitManagedBlob(
    input: Parameters<ProjectIndexFileApplicationPortV2["admitManagedBlob"]>[0],
  ): Promise<ProjectIndexFileMutationResultV2> {
    this.requireProject(input.projectId)
    const blob = input.admission.blob
    const existing = await this.options.session.query((state) => {
      const snapshot = requireSnapshot(state)
      return projectIndexCurrentBlobReferencesFromValidatedOwnerStateV2(state).find((reference) => {
        const entry = snapshot.entries.get(reference.familyPrimaryFileId)
        return (
          entry?.storageClass === "managed-blob" &&
          reference.blob.digest === blob.digest &&
          reference.blob.byteLength === blob.byteLength &&
          reference.blob.mime === blob.mime
        )
      })
    })
    if (existing) {
      try {
        await this.options.blobs.admitManaged({ reference: existing, admission: input.admission })
      } catch (error) {
        return rejectFileMutation(new FileApplicationError("blob-publication-failed", { cause: error }))
      }
      return {
        status: "committed",
        entryId: existing.entryFileId,
        versionId: existing.versionId,
        reference: existing,
      }
    }

    let entryId: ProjectFileId | undefined
    let versionId: string | undefined
    let committedReference: ProjectResourceReferenceV2 | undefined
    try {
      await this.options.session.submit({
        operationId: parseId128V2(this.options.createOperationId()),
        prepare: async ({ base, context }) => {
          const snapshot = requireSnapshot(base)
          const constructed = constructProjectFileCreateIntentV2({
            snapshot,
            context,
            parentDirectoryId: null,
            basename: null,
            blob,
            contentPolicy: "immutable",
            storageClass: "managed-blob",
            provenance: "managed-admission",
          })
          if (constructed === "rejected") throw new FileApplicationError("index-commit-failed")
          entryId = constructed.fileId
          versionId = constructed.version.versionId
          const reference = projectResourceReferenceForVersionV2(snapshot, constructed.version)
          committedReference = reference
          try {
            await this.options.blobs.admitManaged({ reference, admission: input.admission })
          } catch (error) {
            throw new FileApplicationError("blob-publication-failed", { cause: error })
          }
          return this.prepare(context, constructed.intent)
        },
      })
      if (!entryId || !versionId || !committedReference) throw new FileApplicationError("index-commit-failed")
      return { status: "committed", entryId, versionId, reference: committedReference }
    } catch (error) {
      console.error("ProjectIndex managed blob publish failed", error)
      return rejectFileMutation(error)
    }
  }

  async relocateEntry(input: Parameters<ProjectIndexFileApplicationPortV2["relocateEntry"]>[0]): Promise<ProjectIndexFileMutationResultV2> {
    this.requireProject(input.projectId)
    const currentPath = parsePortablePath(input.currentPath).path
    const next = parsePortablePath(input.nextPath)
    let entryId: ProjectEntryId | undefined
    try {
      await this.options.session.submit({
        operationId: parseId128V2(this.options.createOperationId()),
        prepare: ({ base, context }) => {
          const snapshot = requireSnapshot(base)
          const current = resolvePath(snapshot, currentPath)
          if (!current) throw new FileApplicationError("entry-not-found")
          const parent = resolvePath(snapshot, next.parentPath)
          if (!parent || parent.kind !== "directory") throw new FileApplicationError("parent-not-found")
          const intent = constructProjectEntryLocateIntentV2({ snapshot, context, entryId: current.entryId, parentDirectoryId: parent.entryId as ProjectDirectoryIdV2, basename: next.basename, reason: input.reason })
          if (intent === "rejected") throw new FileApplicationError("index-commit-failed")
          entryId = current.entryId
          return this.prepare(context, intent)
        },
      })
      if (!entryId) throw new FileApplicationError("index-commit-failed")
      return { status: "committed", entryId, versionId: null, reference: null }
    } catch (error) { return rejectFileMutation(error) }
  }

  async tombstoneEntry(input: Parameters<ProjectIndexFileApplicationPortV2["tombstoneEntry"]>[0]): Promise<ProjectIndexFileMutationResultV2> {
    this.requireProject(input.projectId)
    const path = parsePortablePath(input.path).path
    let entryId: ProjectEntryId | undefined
    try {
      await this.options.session.submit({
        operationId: parseId128V2(this.options.createOperationId()),
        prepare: ({ base, context }) => {
          const snapshot = requireSnapshot(base)
          const current = resolvePath(snapshot, path)
          if (!current) throw new FileApplicationError("entry-not-found")
          const intent = constructProjectEntryTombstoneIntentV2({ snapshot, context, entryId: current.entryId })
          if (intent === "rejected") throw new FileApplicationError("index-commit-failed")
          entryId = current.entryId
          return this.prepare(context, intent)
        },
      })
      if (!entryId) throw new FileApplicationError("index-commit-failed")
      return { status: "committed", entryId, versionId: null, reference: null }
    } catch (error) { return rejectFileMutation(error) }
  }

  private async prepare(context: OwnerIntentConstructionContextV2, typedIntent: ProjectIndexIntentV2): Promise<PreparedLocalIntentV2> {
    const dependencies = projectIndexIntentDependenciesV2({ ...context, intentDigest: projectIndexIntentDigestV2(typedIntent) }, typedIntent)
    const resolved = await this.options.facts.resolve({ dependencies })
    if (resolved.status !== "resolved") throw new FileApplicationError("index-commit-failed")
    return Object.freeze({ typedIntent, externalFacts: resolved.port })
  }

  private requireProject(projectId: ProjectIdV2): void {
    if (this.options.session.scope.projectId !== parseProjectIdV2(projectId)) throw new TypeError("ProjectIndex session belongs to another Project")
  }
}

class FileApplicationError extends Error {
  constructor(readonly code: Exclude<ProjectIndexFileMutationResultV2, { status: "committed" }>["code"], options?: ErrorOptions) {
    super(code, options)
    this.name = "FileApplicationError"
  }
}

function rejectFileMutation(error: unknown): ProjectIndexFileMutationResultV2 {
  return { status: "partial-success", code: error instanceof FileApplicationError ? error.code : "index-commit-failed" }
}

function requireSnapshot(base: Parameters<ProjectIndexDocumentSessionPortV2["query"]>[0] extends (state: infer S) => unknown ? S : never): ProjectIndexSnapshotV2 {
  const snapshot = projectIndexSnapshotFromValidatedOwnerStateV2(base)
  if (snapshot === null) throw new FileApplicationError("index-commit-failed")
  return snapshot
}

function resolvePath(snapshot: ProjectIndexSnapshotV2, path: string): { readonly entryId: ProjectEntryId; readonly kind: "file" | "directory" } | null {
  if (path === "") return { entryId: snapshot.identity.rootDirectoryId, kind: "directory" }
  for (const entry of snapshot.entries.values()) {
    const projection = projectEntryLocationProjectionV2(snapshot, entry.entryId)
    if (projection.state === "live-linked" && projection.portablePath === path) return { entryId: parseProjectEntryId(entry.entryId), kind: entry.kind }
  }
  return null
}

function parsePortablePath(input: string): { readonly path: string; readonly parentPath: string; readonly basename: string } {
  if (typeof input !== "string" || input === "" || input.startsWith("/") || input.endsWith("/") || input.includes("\\") || input.includes("//")) {
    throw new FileApplicationError("path-kind-mismatch")
  }
  const segments = input.normalize("NFC").split("/")
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) throw new FileApplicationError("path-kind-mismatch")
  return Object.freeze({ path: segments.join("/"), parentPath: segments.slice(0, -1).join("/"), basename: segments.at(-1)! })
}
