import {
  encodeRestrictedJcs,
  parseDigest,
  parseId128,
  type CanvasId,
  type DecodedCausalEditFrame,
  type Digest,
  type DocumentScope,
  type Id128,
  type LocalCommitResult,
  type OwnerExternalFactPort,
  type OwnerIntentConstructionContext,
  type OwnerIntentDependencies,
  type OwnerValidatedState,
  type PreparedLocalIntent,
  type ProjectId,
} from "@convax/collaboration"
import { parseProjectUri } from "@convax/uri"

import {
  constructProjectCanvasRouteActivationIntent,
  constructProjectCanvasRouteRenameIntent,
  constructProjectCanvasRouteStageIntent,
  constructProjectCanvasRouteTombstoneIntent,
  projectCanvasRouteProjection,
  projectCanvasRouteProjectionDigest,
  projectIndexCurrentBlobReferencesForFamiliesFromValidatedOwnerState,
  projectIndexCurrentBlobReferencesFromValidatedOwnerState,
  projectIndexIntentDigest,
  projectIndexIntentDependencies,
  projectIndexSnapshotFromValidatedOwnerState,
  projectIndexResourceReferenceDigest,
  projectIndexMaterializedPathForCurrentResourceFromValidatedOwnerState,
  projectProjectIndexSnapshot,
  type ProjectIndexResourceReference,
  type ProjectIndexSnapshot,
} from "../collaboration/project-index"
import type {
  ProjectIndexCurrentBlobReferencePort,
  ProjectIndexCurrentResourceProjectionEntry,
  ProjectIndexCurrentResourceProofTarget,
  ProjectIndexCurrentResourceReferenceQueryPort,
} from "../collaboration/blob-replication"
import {
  parseProjectCanvasCatalogProjection,
  validateProjectCanvasTitle,
  type ProjectCanvasCatalogProjection,
  type ProjectCanvasRouteCommandResult,
  type ProjectIndexCanvasApplicationPort,
} from "./application"

export interface ProjectIndexDocumentSessionPort {
  readonly scope: DocumentScope & { readonly docKind: "project-index" }
  query<T>(project: (state: OwnerValidatedState<"project-index">) => T): Promise<T>
  submit(input: {
    readonly operationId?: Id128
    readonly prepare: (input: {
      readonly base: OwnerValidatedState<"project-index">
      readonly context: OwnerIntentConstructionContext
      readonly signal?: AbortSignal
    }) => Promise<PreparedLocalIntent> | PreparedLocalIntent
    readonly signal?: AbortSignal
  }): Promise<LocalCommitResult>
}

export type ProjectIndexFactResolutionResult =
  | Readonly<{ status: "resolved"; port: OwnerExternalFactPort<"project-index"> }>
  | Readonly<{ status: "pending" | "rejected" }>

export interface ProjectIndexFactResolutionPort {
  resolve(input: {
    readonly dependencies: OwnerIntentDependencies<"project-index">
    readonly signal?: AbortSignal
  }): Promise<ProjectIndexFactResolutionResult>
}

export interface ProjectCanvasGenesisStagingPort {
  /** Product preflight only: avoids writing F when no author can possibly produce G. */
  preflightCanvasGenesis(input: {
    readonly projectIndexScope: DocumentScope & { readonly docKind: "project-index" }
    readonly signal?: AbortSignal
  }): Promise<"ready" | "pending" | "rejected">
  stageCanvasGenesis(input: {
    readonly scope: DocumentScope & { readonly docKind: "canvas" }
    readonly predecessor: {
      readonly frame: DecodedCausalEditFrame
      readonly acceptedFrontierDigest: Digest
    }
    readonly signal?: AbortSignal
  }): Promise<
    | Readonly<{
        readonly predecessorFrameDigest: Digest
        readonly stagedProjectIndexFrontierDigest: Digest
        readonly checkpointObjectDigest: Digest
      }>
    | "pending"
    | "rejected"
  >
}

export interface CreateProjectIndexCanvasApplicationOptions {
  readonly session: ProjectIndexDocumentSessionPort
  readonly facts: ProjectIndexFactResolutionPort
  readonly genesis: ProjectCanvasGenesisStagingPort
  readonly createOperationId: () => Id128
  readonly createShardEpoch: () => Id128
}

class ProjectCanvasApplicationAttemptError extends Error {
  constructor(readonly code: "dependency-pending" | "rejected") {
    super(`ProjectIndex Canvas command is ${code}`)
    this.name = "ProjectCanvasApplicationAttemptError"
  }
}

/**
 * Project-owned two-phase Canvas route application.
 *
 * Create is stage(F) -> durable verified Canvas genesis(G) -> activation. A
 * failure after F deliberately leaves a staged invisible route for deterministic
 * recovery; this service never rolls it back or claims the Canvas is live.
 */
export class ProjectIndexCanvasApplication implements
  ProjectIndexCanvasApplicationPort,
  ProjectIndexCurrentBlobReferencePort,
  ProjectIndexCurrentResourceReferenceQueryPort {
  constructor(private readonly options: CreateProjectIndexCanvasApplicationOptions) {}

  async queryCatalog(input: { readonly projectId: ProjectId }): Promise<ProjectCanvasCatalogProjection> {
    this.requireProject(input.projectId)
    const snapshot = await this.options.session.query(requireProjectIndexSnapshot)
    const preflight = await this.options.genesis.preflightCanvasGenesis({
      projectIndexScope: this.options.session.scope,
    })
    return projectCanvasCatalogFromSnapshot(
      snapshot,
      preflight === "ready"
        ? "available"
        : preflight === "pending"
          ? "local-authority-unavailable"
          : "read-only-recovery-required",
    )
  }

  async queryCurrentBlobDigests(input: { readonly projectId: ProjectId }): Promise<ReadonlySet<Digest>> {
    this.requireProject(input.projectId)
    return new Set((await this.queryCurrentResources(input)).map(({ reference }) => reference.blob.digest))
  }

  async queryCurrentResourceReferences(input: {
    readonly projectId: ProjectId
  }): Promise<readonly ProjectIndexResourceReference[]> {
    this.requireProject(input.projectId)
    return this.options.session.query(projectIndexCurrentBlobReferencesFromValidatedOwnerState)
  }

  async queryCurrentResourceReferencesExact(input: {
    readonly projectId: ProjectId
    readonly targets: readonly ProjectIndexCurrentResourceProofTarget[]
  }): Promise<readonly ProjectIndexResourceReference[]> {
    this.requireProject(input.projectId)
    const targets = parseCurrentResourceProofTargets(input.targets)
    if (targets.length === 0) return Object.freeze([])
    return this.options.session.query((state) => selectExactCurrentResourceReferences(state, targets).references)
  }

  async queryCurrentResources(input: {
    readonly projectId: ProjectId
  }) {
    this.requireProject(input.projectId)
    return this.options.session.query((state) => {
      const snapshot = requireProjectIndexSnapshot(state)
      return Object.freeze(projectIndexCurrentBlobReferencesFromValidatedOwnerState(state).map((reference) =>
        projectCurrentResourceProjectionEntry(state, snapshot, reference)))
    })
  }

  async queryCurrentResourcesExact(input: {
    readonly projectId: ProjectId
    readonly targets: readonly ProjectIndexCurrentResourceProofTarget[]
  }): Promise<readonly ProjectIndexCurrentResourceProjectionEntry[]> {
    this.requireProject(input.projectId)
    const targets = parseCurrentResourceProofTargets(input.targets)
    if (targets.length === 0) return Object.freeze([])
    return this.options.session.query((state) => {
      const { snapshot, references } = selectExactCurrentResourceReferences(state, targets)
      return Object.freeze(references.map((reference) =>
        projectCurrentResourceProjectionEntry(state, snapshot, reference)))
    })
  }

  async submitRouteCommand(
    input: Parameters<ProjectIndexCanvasApplicationPort["submitRouteCommand"]>[0],
  ): Promise<ProjectCanvasRouteCommandResult> {
    this.requireProject(input.projectId)
    try {
      if (input.signal?.aborted) return { status: "rejected", code: "cancelled" }
      if (input.command.kind === "project.canvas.route.create") {
        return await this.createCanvas(input.projectId, input.command.title, input.signal)
      }
      const operationId = parseId128(this.options.createOperationId())
      const canvasId = input.command.canvasId
      await this.options.session.submit({
        operationId,
        signal: input.signal,
        prepare: async ({ base, context, signal }) => {
          const snapshot = requireProjectIndexSnapshot(base)
          const constructed = input.command.kind === "project.canvas.route.rename"
            ? constructProjectCanvasRouteRenameIntent({
                snapshot,
                context,
                canvasId,
                title: validateProjectCanvasTitle(input.command.title),
              })
            : constructProjectCanvasRouteTombstoneIntent({ snapshot, context, canvasId })
          if (constructed === "rejected") throw routeRejection(snapshot, canvasId)
          return this.prepareIntent(context, constructed, signal)
        },
      })
      return { status: "committed", canvasId, catalog: await this.queryCatalog({ projectId: input.projectId }) }
    } catch (error) {
      return this.rejection(error)
    }
  }

  private async createCanvas(
    projectId: ProjectId,
    titleInput: string,
    signal?: AbortSignal,
  ): Promise<ProjectCanvasRouteCommandResult> {
    const title = validateProjectCanvasTitle(titleInput)
    const preflight = await this.options.genesis.preflightCanvasGenesis({
      projectIndexScope: this.options.session.scope,
      signal,
    })
    if (preflight === "pending") return { status: "rejected", code: "dependency-pending" }
    if (preflight === "rejected") return { status: "rejected", code: "read-only-recovery-required" }
    if (signal?.aborted) return { status: "rejected", code: "cancelled" }
    const stageOperationId = parseId128(this.options.createOperationId())
    const shardEpoch = parseId128(this.options.createShardEpoch())
    let stagedCanvasId: CanvasId | undefined
    const staged = await this.options.session.submit({
      operationId: stageOperationId,
      signal,
      prepare: async ({ base, context, signal: attemptSignal }) => {
        const constructed = constructProjectCanvasRouteStageIntent({
          snapshot: requireProjectIndexSnapshot(base),
          context,
          shardEpoch,
          title,
        })
        if (constructed === "rejected") throw new ProjectCanvasApplicationAttemptError("rejected")
        stagedCanvasId = constructed.canvasId
        return this.prepareIntent(context, constructed.intent, attemptSignal)
      },
    })
    if (stagedCanvasId === undefined) {
      throw new ProjectCanvasApplicationAttemptError("rejected")
    }
    if (signal?.aborted) return { status: "rejected", code: "cancelled" }
    const canvasScope = Object.freeze({
      projectId: this.options.session.scope.projectId,
      projectEpoch: this.options.session.scope.projectEpoch,
      docKind: "canvas" as const,
      docId: stagedCanvasId,
      shardEpoch,
    })
    const genesis = await this.options.genesis.stageCanvasGenesis({
      scope: canvasScope,
      predecessor: { frame: staged.frame, acceptedFrontierDigest: staged.acceptedFrontierDigest },
      signal,
    })
    if (genesis === "pending") return { status: "rejected", code: "dependency-pending" }
    if (genesis === "rejected") return { status: "rejected", code: "read-only-recovery-required" }
    if (signal?.aborted) return { status: "rejected", code: "cancelled" }

    const activationOperationId = parseId128(this.options.createOperationId())
    await this.options.session.submit({
      operationId: activationOperationId,
      signal,
      prepare: async ({ base, context, signal: attemptSignal }) => {
        const snapshot = requireProjectIndexSnapshot(base)
        const intent = constructProjectCanvasRouteActivationIntent({
          snapshot,
          context,
          canvasId: stagedCanvasId!,
          projectIndexRouteDependencyFrameDigest: genesis.predecessorFrameDigest,
          canvasGenesisCheckpointObjectDigest: genesis.checkpointObjectDigest,
          stagedProjectIndexFrontierDigest: genesis.stagedProjectIndexFrontierDigest,
        })
        if (intent === "rejected") throw routeRejection(snapshot, stagedCanvasId!)
        return this.prepareIntent(context, intent, attemptSignal)
      },
    })
    return {
      status: "committed",
      canvasId: stagedCanvasId,
      catalog: await this.queryCatalog({ projectId }),
    }
  }

  private async prepareIntent(
    context: OwnerIntentConstructionContext,
    typedIntent: Parameters<typeof projectIndexIntentDependencies>[1],
    signal?: AbortSignal,
  ): Promise<PreparedLocalIntent> {
    const dependencies = projectIndexIntentDependencies(
      { ...context, intentDigest: projectIndexIntentDigest(typedIntent) },
      typedIntent,
    )
    const resolved = await this.options.facts.resolve({ dependencies, signal })
    if (resolved.status !== "resolved") {
      throw new ProjectCanvasApplicationAttemptError(
        resolved.status === "pending" ? "dependency-pending" : "rejected",
      )
    }
    return Object.freeze({ typedIntent, externalFacts: resolved.port })
  }

  private rejection(error: unknown): ProjectCanvasRouteCommandResult {
    if (isAbort(error)) return { status: "rejected", code: "cancelled" }
    if (error instanceof ProjectCanvasApplicationAttemptError) {
      if (error.code === "dependency-pending") return { status: "rejected", code: "dependency-pending" }
      return { status: "rejected", code: "read-only-recovery-required" }
    }
    if (error instanceof ProjectCanvasRouteRejection) {
      return { status: "rejected", code: error.code }
    }
    throw error
  }

  private requireProject(projectId: ProjectId): void {
    if (this.options.session.scope.projectId !== projectId) {
      throw new TypeError("ProjectIndex session belongs to another Project")
    }
  }
}

class ProjectCanvasRouteRejection extends Error {
  constructor(readonly code: "canvas-not-found" | "route-tombstoned") {
    super(code)
    this.name = "ProjectCanvasRouteRejection"
  }
}

const maximumCurrentResourceProofTargets = 4_096

function selectExactCurrentResourceReferences(
  state: OwnerValidatedState<"project-index">,
  targets: readonly ProjectIndexCurrentResourceProofTarget[],
): Readonly<{
  snapshot: ProjectIndexSnapshot
  references: readonly ProjectIndexResourceReference[]
}> {
  const snapshot = requireProjectIndexSnapshot(state)
  const requested = new Set<string>()
  const primaryFileIds = new Set<ProjectIndexResourceReference["familyPrimaryFileId"]>()
  for (const target of targets) {
    let uri: ReturnType<typeof parseProjectUri>
    try {
      uri = parseProjectUri(target.uri)
    } catch {
      continue
    }
    if (
      uri.projectId !== snapshot.identity.projectId ||
      uri.projectEpoch !== snapshot.identity.projectEpoch ||
      !uri.entryId.startsWith("pf_")
    ) {
      continue
    }
    primaryFileIds.add(uri.entryId as ProjectIndexResourceReference["familyPrimaryFileId"])
    requested.add(currentResourceProofKey(target.uri, target.ownerProofDigest))
  }
  if (primaryFileIds.size === 0) return Object.freeze({ snapshot, references: Object.freeze([]) })
  const references = projectIndexCurrentBlobReferencesForFamiliesFromValidatedOwnerState(
    state,
    Object.freeze([...primaryFileIds]),
  ).filter((reference) => requested.has(currentResourceProofKey(
    reference.canonicalUri,
    projectIndexResourceReferenceDigest(reference),
  )))
  return Object.freeze({ snapshot, references: Object.freeze(references) })
}

function parseCurrentResourceProofTargets(
  value: readonly ProjectIndexCurrentResourceProofTarget[],
): readonly ProjectIndexCurrentResourceProofTarget[] {
  if (!Array.isArray(value) || value.length > maximumCurrentResourceProofTargets) {
    throw new TypeError("ProjectIndex exact current-resource targets are invalid")
  }
  const targets = new Map<string, ProjectIndexCurrentResourceProofTarget>()
  for (let index = 0; index < value.length; index += 1) {
    const candidate = value[index]
    if (!(index in value) || typeof candidate !== "object" || candidate === null) {
      throw new TypeError("ProjectIndex exact current-resource target is invalid")
    }
    if (typeof candidate.uri !== "string") {
      throw new TypeError("ProjectIndex exact current-resource URI is invalid")
    }
    const target = Object.freeze({
      uri: candidate.uri,
      ownerProofDigest: parseDigest(candidate.ownerProofDigest),
    })
    targets.set(currentResourceProofKey(target.uri, target.ownerProofDigest), target)
  }
  return Object.freeze([...targets.values()])
}

function currentResourceProofKey(uri: string, ownerProofDigest: Digest): string {
  return `${uri}\u0000${ownerProofDigest}`
}

function projectCurrentResourceProjectionEntry(
  state: OwnerValidatedState<"project-index">,
  snapshot: ProjectIndexSnapshot,
  reference: ProjectIndexResourceReference,
): ProjectIndexCurrentResourceProjectionEntry {
  const entry = snapshot.entries.get(reference.entryFileId)
  if (!entry || entry.kind !== "file" || entry.storageClass === null) {
    throw new Error("Current Project resource has no live file owner")
  }
  const materializedPath = entry.storageClass === "project-file"
    ? projectIndexMaterializedPathForCurrentResourceFromValidatedOwnerState(state, reference)
    : null
  return Object.freeze({ materializedPath, reference, storageClass: entry.storageClass })
}

function routeRejection(snapshot: ProjectIndexSnapshot, canvasId: CanvasId) {
  const route = projectProjectIndexSnapshot(snapshot).canvasRoutes.find(
    (candidate) => candidate.canvasId === canvasId,
  )
  return new ProjectCanvasRouteRejection(route?.state === "tombstoned" ? "route-tombstoned" : "canvas-not-found")
}

function projectCanvasCatalogFromSnapshot(
  snapshot: ProjectIndexSnapshot,
  creationAvailability: ProjectCanvasCatalogProjection["creationAvailability"],
): ProjectCanvasCatalogProjection {
  const projection = projectProjectIndexSnapshot(snapshot)
  const routes = Object.freeze(projection.canvasRoutes.map((route) => Object.freeze({
    canvasId: route.canvasId,
    state: route.state as "staged" | "live" | "tombstoned",
    title: route.currentTitle,
    shardEpoch: route.currentShardEpoch,
    activationDigest: route.currentActivationDigest,
    routeProjectionDigest: projectCanvasRouteProjectionDigest(route),
  })))
  return parseProjectCanvasCatalogProjection(Object.freeze({
    format: "convax.project-canvas-catalog-projection",
    creationAvailability,
    projectId: snapshot.identity.projectId,
    projectEpoch: snapshot.identity.projectEpoch,
    routes,
    visibleCanvases: Object.freeze(routes.filter((route) => route.state === "live")),
  }), snapshot.identity.projectId)
}

function requireProjectIndexSnapshot(state: OwnerValidatedState<"project-index">): ProjectIndexSnapshot {
  const snapshot = projectIndexSnapshotFromValidatedOwnerState(state)
  if (snapshot === null) throw new Error("ProjectIndex owner returned an invalid validated state")
  return snapshot
}

function isAbort(error: unknown): boolean {
  return (error instanceof DOMException && error.name === "AbortError") ||
    (typeof error === "object" && error !== null && "name" in error && error.name === "AbortError")
}
