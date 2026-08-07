import {
  comparePortableStamps,
  compareUtf8,
  ordinarySha256,
  parseId128,
  parseProjectId,
  type Id128,
  type OwnerIntentConstructionContext,
  type PreparedLocalIntent,
  type ProjectId,
  type Uint64,
} from "@convax/collaboration"
import { parseProjectEntryId, type ProjectEntryId, type ProjectFileId } from "@convax/project-files/identity"
import {
  constructProjectDirectoryCreateIntent,
  constructProjectEntryLocateIntent,
  constructProjectEntryTombstoneIntent,
  constructProjectFileCreateIntent,
  constructProjectFileWriteIntent,
  projectIndexCurrentBlobReferencesFromValidatedOwnerState,
  projectEntryLocationProjection,
  projectIndexIntentDependencies,
  projectIndexIntentDigest,
  projectIndexSnapshotFromValidatedOwnerState,
  projectIndexResourceReferenceDigest,
  projectIndexResourceReferenceForVersion,
  type ProjectBlobRef,
  type ProjectContentPolicy,
  type ProjectDirectoryId,
  type ProjectEntryLocationClaim,
  type ProjectIndexIntent,
  type ProjectIndexSnapshot,
  type ProjectIndexResourceReference,
} from "../collaboration/project-index"
import type {
  ProjectIndexDocumentSessionPort,
  ProjectIndexFactResolutionPort,
} from "./project-index-application"

export interface ProjectIndexBlobPublicationPort {
  admitManaged(input: {
    readonly reference: ProjectIndexResourceReference
    readonly admission: ProjectIndexManagedBlobAdmission
  }): Promise<void>
  publish(input: {
    readonly reference: ProjectIndexResourceReference
    readonly exactBytes: Readonly<Uint8Array>
  }): Promise<void>
}

/** Main-only, process-local verified byte source. It must never enter portable state. */
export interface ProjectIndexManagedBlobAdmission {
  readonly blob: ProjectBlobRef
  readChunks(
    consume: (chunk: Readonly<Uint8Array>) => Promise<void>,
    signal?: AbortSignal,
  ): Promise<void>
}

export type ProjectIndexFileMutationResult =
  | Readonly<{
      status: "committed"
      entryId: ProjectEntryId
      versionId: string | null
      reference?: ProjectIndexResourceReference | null
    }>
  | Readonly<{
      status: "partial-success"
      code: "entry-not-found" | "parent-not-found" | "path-kind-mismatch" | "blob-publication-failed" | "index-commit-failed"
    }>

export interface ProjectIndexFileApplicationPort {
  createDirectory(input: { readonly projectId: ProjectId; readonly path: string }): Promise<ProjectIndexFileMutationResult>
  admitManagedBlob(input: {
    readonly projectId: ProjectId
    readonly admission: ProjectIndexManagedBlobAdmission
  }): Promise<ProjectIndexFileMutationResult>
  publishFile(input: {
    readonly projectId: ProjectId
    readonly path: string
    readonly exactBytes: Readonly<Uint8Array>
    readonly mime: string
    readonly contentPolicy: Exclude<ProjectContentPolicy, "none" | "immutable"> | "immutable"
    readonly provenance?: "user" | "generated"
  }): Promise<ProjectIndexFileMutationResult>
  relocateEntry(input: {
    readonly projectId: ProjectId
    readonly currentPath: string
    readonly nextPath: string
    readonly reason: "move" | "rename"
  }): Promise<ProjectIndexFileMutationResult>
  tombstoneEntry(input: { readonly projectId: ProjectId; readonly path: string }): Promise<ProjectIndexFileMutationResult>
}

export interface ProjectIndexFileMaterializationEntry {
  readonly entryId: ProjectEntryId
  readonly kind: "directory" | "file"
  readonly path: string
  readonly reference: ProjectIndexResourceReference | null
}

export interface ProjectIndexFileMaterializationPlan {
  readonly projectId: ProjectId
  readonly entries: readonly ProjectIndexFileMaterializationEntry[]
}

/**
 * Project-owned logical projection consumed by the native Project/node
 * materializer. It deliberately exposes stable identity plus a current path and
 * hash-pinned resource; native enumeration never becomes document authority.
 */
export interface ProjectIndexFileMaterializationProjectionPort {
  queryFileMaterializationPlan(input: {
    readonly projectId: ProjectId
  }): Promise<ProjectIndexFileMaterializationPlan>
}

export class ProjectIndexFileApplication implements ProjectIndexFileApplicationPort, ProjectIndexFileMaterializationProjectionPort {
  constructor(private readonly options: {
    readonly session: ProjectIndexDocumentSessionPort
    readonly facts: ProjectIndexFactResolutionPort
    readonly blobs: ProjectIndexBlobPublicationPort
    readonly createOperationId: () => Id128
  }) {}

  async queryFileMaterializationPlan(input: { readonly projectId: ProjectId }): Promise<ProjectIndexFileMaterializationPlan> {
    this.requireProject(input.projectId)
    return this.options.session.query((state) => {
      const snapshot = requireSnapshot(state)
      const references = new Map(
        projectIndexCurrentBlobReferencesFromValidatedOwnerState(state)
          .map((reference) => [reference.entryFileId, reference] as const),
      )
      const ordinaryPaths = createReachableOrdinaryPathIndex(snapshot)
      const entries: ProjectIndexFileMaterializationEntry[] = []
      for (const entry of snapshot.entries.values()) {
        if (entry.entryId === snapshot.identity.rootDirectoryId || entry.storageClass === "managed-blob") continue
        const ordinaryPath = entry.provenance === "content-conflict-copy"
          ? undefined
          : ordinaryPaths.pathByEntryId.get(entry.entryId)
        let materializedPath: string | null
        if (ordinaryPath !== undefined) {
          materializedPath = ordinaryPath
        } else {
          // Exceptional paths keep the complete counterfactual projection.
          // Only a live rooted path-claim winner takes the linear fast path.
          const location = projectEntryLocationProjection(snapshot, entry.entryId)
          materializedPath =
            (location.state === "live-linked" || location.state === "conflict-path")
              ? location.portablePath
              : null
        }
        if (materializedPath === null) continue
        const reference = entry.kind === "file" ? references.get(entry.entryId as ProjectFileId) ?? null : null
        if (entry.kind === "file" && reference === null) throw new FileApplicationError("index-commit-failed")
        entries.push(Object.freeze({
          entryId: parseProjectEntryId(entry.entryId),
          kind: entry.kind,
          path: materializedPath,
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

  async createDirectory(input: { readonly projectId: ProjectId; readonly path: string }): Promise<ProjectIndexFileMutationResult> {
    this.requireProject(input.projectId)
    const target = parsePortablePath(input.path)
    if (target.basename === "") return { status: "partial-success", code: "path-kind-mismatch" }
    let directoryId: ProjectDirectoryId | undefined
    try {
      await this.options.session.submit({
        operationId: parseId128(this.options.createOperationId()),
        prepare: ({ base, context }) => {
          const snapshot = requireSnapshot(base)
          const parent = createPathResolver(snapshot)(target.parentPath)
          if (!parent || parent.kind !== "directory") throw new FileApplicationError("parent-not-found")
          const constructed = constructProjectDirectoryCreateIntent({ snapshot, context, parentDirectoryId: parent.entryId as ProjectDirectoryId, basename: target.basename })
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

  async publishFile(input: Parameters<ProjectIndexFileApplicationPort["publishFile"]>[0]): Promise<ProjectIndexFileMutationResult> {
    this.requireProject(input.projectId)
    const target = parsePortablePath(input.path)
    const exactBytes = new Uint8Array(input.exactBytes)
    const blob: ProjectBlobRef = Object.freeze({
      format: "convax.blob-ref",
      algorithm: "sha256",
      digest: ordinarySha256(exactBytes),
      byteLength: String(exactBytes.byteLength) as Uint64,
      mime: input.mime,
    })
    let entryId: ProjectFileId | undefined
    let versionId: string | undefined
    let committedReference: ProjectIndexResourceReference | undefined
    try {
      await this.options.session.submit({
        operationId: parseId128(this.options.createOperationId()),
        prepare: async ({ base, context }) => {
          const snapshot = requireSnapshot(base)
          const resolvePath = createPathResolver(snapshot)
          const existing = resolvePath(target.path)
          let intent: ProjectIndexIntent
          let reference: ProjectIndexResourceReference
          if (existing === null) {
            const parent = resolvePath(target.parentPath)
            if (!parent || parent.kind !== "directory") throw new FileApplicationError("parent-not-found")
            const constructed = constructProjectFileCreateIntent({
              snapshot,
              context,
              parentDirectoryId: parent.entryId as ProjectDirectoryId,
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
            reference = projectIndexResourceReferenceForVersion(snapshot, constructed.version)
          } else {
            if (existing.kind !== "file") throw new FileApplicationError("path-kind-mismatch")
            const constructed = constructProjectFileWriteIntent({
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
            reference = projectIndexResourceReferenceForVersion(snapshot, constructed.version)
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
    input: Parameters<ProjectIndexFileApplicationPort["admitManagedBlob"]>[0],
  ): Promise<ProjectIndexFileMutationResult> {
    this.requireProject(input.projectId)
    const blob = input.admission.blob
    const existing = await this.options.session.query((state) => {
      const snapshot = requireSnapshot(state)
      return projectIndexCurrentBlobReferencesFromValidatedOwnerState(state).find((reference) => {
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
    let committedReference: ProjectIndexResourceReference | undefined
    try {
      await this.options.session.submit({
        operationId: parseId128(this.options.createOperationId()),
        prepare: async ({ base, context }) => {
          const snapshot = requireSnapshot(base)
          const constructed = constructProjectFileCreateIntent({
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
          const reference = projectIndexResourceReferenceForVersion(snapshot, constructed.version)
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

  async relocateEntry(input: Parameters<ProjectIndexFileApplicationPort["relocateEntry"]>[0]): Promise<ProjectIndexFileMutationResult> {
    this.requireProject(input.projectId)
    const currentPath = parsePortablePath(input.currentPath).path
    const next = parsePortablePath(input.nextPath)
    let entryId: ProjectEntryId | undefined
    try {
      await this.options.session.submit({
        operationId: parseId128(this.options.createOperationId()),
        prepare: ({ base, context }) => {
          const snapshot = requireSnapshot(base)
          const resolvePath = createPathResolver(snapshot)
          const current = resolvePath(currentPath)
          if (!current) throw new FileApplicationError("entry-not-found")
          const parent = resolvePath(next.parentPath)
          if (!parent || parent.kind !== "directory") throw new FileApplicationError("parent-not-found")
          const intent = constructProjectEntryLocateIntent({ snapshot, context, entryId: current.entryId, parentDirectoryId: parent.entryId as ProjectDirectoryId, basename: next.basename, reason: input.reason })
          if (intent === "rejected") throw new FileApplicationError("index-commit-failed")
          entryId = current.entryId
          return this.prepare(context, intent)
        },
      })
      if (!entryId) throw new FileApplicationError("index-commit-failed")
      return { status: "committed", entryId, versionId: null, reference: null }
    } catch (error) { return rejectFileMutation(error) }
  }

  async tombstoneEntry(input: Parameters<ProjectIndexFileApplicationPort["tombstoneEntry"]>[0]): Promise<ProjectIndexFileMutationResult> {
    this.requireProject(input.projectId)
    const path = parsePortablePath(input.path).path
    let entryId: ProjectEntryId | undefined
    try {
      await this.options.session.submit({
        operationId: parseId128(this.options.createOperationId()),
        prepare: ({ base, context }) => {
          const snapshot = requireSnapshot(base)
          const current = createPathResolver(snapshot)(path)
          if (!current) throw new FileApplicationError("entry-not-found")
          const intent = constructProjectEntryTombstoneIntent({ snapshot, context, entryId: current.entryId })
          if (intent === "rejected") throw new FileApplicationError("index-commit-failed")
          entryId = current.entryId
          return this.prepare(context, intent)
        },
      })
      if (!entryId) throw new FileApplicationError("index-commit-failed")
      return { status: "committed", entryId, versionId: null, reference: null }
    } catch (error) { return rejectFileMutation(error) }
  }

  private async prepare(context: OwnerIntentConstructionContext, typedIntent: ProjectIndexIntent): Promise<PreparedLocalIntent> {
    const dependencies = projectIndexIntentDependencies({ ...context, intentDigest: projectIndexIntentDigest(typedIntent) }, typedIntent)
    const resolved = await this.options.facts.resolve({ dependencies })
    if (resolved.status !== "resolved") throw new FileApplicationError("index-commit-failed")
    return Object.freeze({ typedIntent, externalFacts: resolved.port })
  }

  private requireProject(projectId: ProjectId): void {
    if (this.options.session.scope.projectId !== parseProjectId(projectId)) throw new TypeError("ProjectIndex session belongs to another Project")
  }
}

class FileApplicationError extends Error {
  constructor(readonly code: Exclude<ProjectIndexFileMutationResult, { status: "committed" }>["code"], options?: ErrorOptions) {
    super(code, options)
    this.name = "FileApplicationError"
  }
}

function rejectFileMutation(error: unknown): ProjectIndexFileMutationResult {
  return { status: "partial-success", code: error instanceof FileApplicationError ? error.code : "index-commit-failed" }
}

function requireSnapshot(base: Parameters<ProjectIndexDocumentSessionPort["query"]>[0] extends (state: infer S) => unknown ? S : never): ProjectIndexSnapshot {
  const snapshot = projectIndexSnapshotFromValidatedOwnerState(base)
  if (snapshot === null) throw new FileApplicationError("index-commit-failed")
  return snapshot
}

function createPathResolver(snapshot: ProjectIndexSnapshot): (
  path: string,
) => { readonly entryId: ProjectEntryId; readonly kind: "file" | "directory" } | null {
  const index = createReachableOrdinaryPathIndex(snapshot)
  return (path) => {
    if (path === "") return { entryId: snapshot.identity.rootDirectoryId, kind: "directory" }
    const winner = index.entryIdByPath.get(path)
    if (winner === undefined) return null
    const entry = snapshot.entries.get(winner)!
    // Conflict-copy activation has additional family semantics. Keep that rare
    // case on the complete projection path; ordinary path lookup remains linear.
    if (entry.provenance === "content-conflict-copy") {
      const projection = projectEntryLocationProjection(snapshot, winner)
      if (projection.state !== "live-linked" || projection.portablePath !== path) return null
    }
    return { entryId: parseProjectEntryId(entry.entryId), kind: entry.kind }
  }
}

function createReachableOrdinaryPathIndex(snapshot: ProjectIndexSnapshot): Readonly<{
  entryIdByPath: ReadonlyMap<string, ProjectEntryId>
  pathByEntryId: ReadonlyMap<string, string>
}> {
  const tombstoned = new Set([...snapshot.entryTombstones.values()].map((record) => record.entryId))
  const selectedClaims = new Map<ProjectEntryId, ProjectEntryLocationClaim>()
  for (const claim of snapshot.entryLocations.values()) {
    const selected = selectedClaims.get(claim.entryId)
    if (selected === undefined || comparePortableStamps(selected.stamp, claim.stamp) <= 0) {
      selectedClaims.set(claim.entryId, claim)
    }
  }

  const winnersBySlot = new Map<string, Readonly<{
    entryId: ProjectEntryId
    claim: ProjectEntryLocationClaim
  }>>()
  for (const [entryId, claim] of selectedClaims) {
    const entry = snapshot.entries.get(entryId)
    if (!entry || tombstoned.has(entryId) || claim.state !== "linked") continue
    const slot = `${claim.parentDirectoryId}\0${claim.basename}`
    const selected = winnersBySlot.get(slot)
    const byStamp = selected === undefined ? 1 : comparePortableStamps(claim.stamp, selected.claim.stamp)
    if (byStamp > 0 || (byStamp === 0 && selected !== undefined && compareUtf8(entryId, selected.entryId) > 0)) {
      winnersBySlot.set(slot, Object.freeze({ entryId: parseProjectEntryId(entryId), claim }))
    }
  }

  const childrenByParent = new Map<ProjectDirectoryId, Array<Readonly<{
    entryId: ProjectEntryId
    basename: string
  }>>>()
  for (const winner of winnersBySlot.values()) {
    const children = childrenByParent.get(winner.claim.parentDirectoryId) ?? []
    children.push(Object.freeze({ entryId: winner.entryId, basename: winner.claim.basename }))
    childrenByParent.set(winner.claim.parentDirectoryId, children)
  }

  const entryIdByPath = new Map<string, ProjectEntryId>()
  const pathByEntryId = new Map<string, string>()
  const queue: Array<Readonly<{ directoryId: ProjectDirectoryId; path: string }>> = [
    Object.freeze({ directoryId: snapshot.identity.rootDirectoryId, path: "" }),
  ]
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const parent = queue[cursor]!
    for (const child of childrenByParent.get(parent.directoryId) ?? []) {
      const entry = snapshot.entries.get(child.entryId)
      if (!entry) continue
      const path = parent.path === "" ? child.basename : `${parent.path}/${child.basename}`
      entryIdByPath.set(path, child.entryId)
      pathByEntryId.set(child.entryId, path)
      if (entry.kind === "directory") {
        queue.push(Object.freeze({ directoryId: child.entryId as ProjectDirectoryId, path }))
      }
    }
  }
  return Object.freeze({ entryIdByPath, pathByEntryId })
}

function parsePortablePath(input: string): { readonly path: string; readonly parentPath: string; readonly basename: string } {
  if (typeof input !== "string" || input === "" || input.startsWith("/") || input.endsWith("/") || input.includes("\\") || input.includes("//")) {
    throw new FileApplicationError("path-kind-mismatch")
  }
  const segments = input.normalize("NFC").split("/")
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) throw new FileApplicationError("path-kind-mismatch")
  return Object.freeze({ path: segments.join("/"), parentPath: segments.slice(0, -1).join("/"), basename: segments.at(-1)! })
}
