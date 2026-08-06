import {
  encodeRestrictedJcs,
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

import {
  constructProjectCanvasRouteActivationIntentV2,
  constructProjectCanvasRouteRenameIntentV2,
  constructProjectCanvasRouteStageIntentV2,
  constructProjectCanvasRouteTombstoneIntentV2,
  projectCanvasRouteProjectionV2,
  projectCanvasRouteProjectionDigestV2,
  projectIndexCurrentBlobReferencesFromValidatedOwnerStateV2,
  projectIndexIntentDigestV2,
  projectIndexIntentDependenciesV2,
  projectIndexSnapshotFromValidatedOwnerStateV2,
  projectEntryLocationProjectionV2,
  projectProjectIndexSnapshotV2,
  type ProjectIndexSnapshotV2,
} from "../collaboration/project-index"
import type { ProjectIndexCurrentBlobReferencePortV2 } from "../collaboration/blob-replication"
import {
  parseProjectCanvasCatalogProjectionV2,
  validateProjectCanvasTitleV2,
  type ProjectCanvasCatalogProjectionV2,
  type ProjectCanvasRouteCommandResultV2,
  type ProjectIndexCanvasApplicationPortV2,
} from "./application"

export interface ProjectIndexDocumentSessionPortV2 {
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

export type ProjectIndexFactResolutionResultV2 =
  | Readonly<{ status: "resolved"; port: OwnerExternalFactPort<"project-index"> }>
  | Readonly<{ status: "pending" | "rejected" }>

export interface ProjectIndexFactResolutionPortV2 {
  resolve(input: {
    readonly dependencies: OwnerIntentDependencies<"project-index">
    readonly signal?: AbortSignal
  }): Promise<ProjectIndexFactResolutionResultV2>
}

export interface ProjectCanvasGenesisStagingPortV2 {
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

export interface CreateProjectIndexCanvasApplicationOptionsV2 {
  readonly session: ProjectIndexDocumentSessionPortV2
  readonly facts: ProjectIndexFactResolutionPortV2
  readonly genesis: ProjectCanvasGenesisStagingPortV2
  readonly createOperationId: () => Id128
  readonly createShardEpoch: () => Id128
}

class ProjectCanvasApplicationAttemptErrorV2 extends Error {
  constructor(readonly code: "dependency-pending" | "rejected") {
    super(`ProjectIndex Canvas command is ${code}`)
    this.name = "ProjectCanvasApplicationAttemptErrorV2"
  }
}

/**
 * Project-owned two-phase Canvas route application.
 *
 * Create is stage(F) -> durable verified Canvas genesis(G) -> activation. A
 * failure after F deliberately leaves a staged invisible route for deterministic
 * recovery; this service never rolls it back or claims the Canvas is live.
 */
export class ProjectIndexCanvasApplicationV2 implements ProjectIndexCanvasApplicationPortV2, ProjectIndexCurrentBlobReferencePortV2 {
  constructor(private readonly options: CreateProjectIndexCanvasApplicationOptionsV2) {}

  async queryCatalog(input: { readonly projectId: ProjectId }): Promise<ProjectCanvasCatalogProjectionV2> {
    this.requireProject(input.projectId)
    const snapshot = await this.options.session.query(requireProjectIndexSnapshotV2)
    const preflight = await this.options.genesis.preflightCanvasGenesis({
      projectIndexScope: this.options.session.scope,
    })
    return projectCanvasCatalogFromSnapshotV2(
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

  async queryCurrentResources(input: {
    readonly projectId: ProjectId
  }) {
    this.requireProject(input.projectId)
    return this.options.session.query((state) => {
      const snapshot = requireProjectIndexSnapshotV2(state)
      return Object.freeze(projectIndexCurrentBlobReferencesFromValidatedOwnerStateV2(state).map((reference) => {
        const entry = snapshot.entries.get(reference.entryFileId)
        if (!entry || entry.kind !== "file" || entry.storageClass === null) {
          throw new Error("Current Project resource has no live file owner")
        }
        const location = projectEntryLocationProjectionV2(snapshot, reference.entryFileId)
        const materializedPath =
          entry.storageClass === "project-file" &&
          (location.state === "live-linked" || location.state === "conflict-path")
            ? location.portablePath
            : null
        return Object.freeze({ materializedPath, reference, storageClass: entry.storageClass })
      }))
    })
  }

  async submitRouteCommand(
    input: Parameters<ProjectIndexCanvasApplicationPortV2["submitRouteCommand"]>[0],
  ): Promise<ProjectCanvasRouteCommandResultV2> {
    this.requireProject(input.projectId)
    try {
      if (input.signal?.aborted) return { status: "rejected", code: "cancelled" }
      if (input.command.kind === "project.canvas.route.create/2") {
        return await this.createCanvas(input.projectId, input.command.title, input.signal)
      }
      const operationId = parseId128(this.options.createOperationId())
      const canvasId = input.command.canvasId
      await this.options.session.submit({
        operationId,
        signal: input.signal,
        prepare: async ({ base, context, signal }) => {
          const snapshot = requireProjectIndexSnapshotV2(base)
          const constructed = input.command.kind === "project.canvas.route.rename/2"
            ? constructProjectCanvasRouteRenameIntentV2({
                snapshot,
                context,
                canvasId,
                title: validateProjectCanvasTitleV2(input.command.title),
              })
            : constructProjectCanvasRouteTombstoneIntentV2({ snapshot, context, canvasId })
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
  ): Promise<ProjectCanvasRouteCommandResultV2> {
    const title = validateProjectCanvasTitleV2(titleInput)
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
        const constructed = constructProjectCanvasRouteStageIntentV2({
          snapshot: requireProjectIndexSnapshotV2(base),
          context,
          shardEpoch,
          title,
        })
        if (constructed === "rejected") throw new ProjectCanvasApplicationAttemptErrorV2("rejected")
        stagedCanvasId = constructed.canvasId
        return this.prepareIntent(context, constructed.intent, attemptSignal)
      },
    })
    if (stagedCanvasId === undefined) {
      throw new ProjectCanvasApplicationAttemptErrorV2("rejected")
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
        const snapshot = requireProjectIndexSnapshotV2(base)
        const intent = constructProjectCanvasRouteActivationIntentV2({
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
    typedIntent: Parameters<typeof projectIndexIntentDependenciesV2>[1],
    signal?: AbortSignal,
  ): Promise<PreparedLocalIntent> {
    const dependencies = projectIndexIntentDependenciesV2(
      { ...context, intentDigest: projectIndexIntentDigestV2(typedIntent) },
      typedIntent,
    )
    const resolved = await this.options.facts.resolve({ dependencies, signal })
    if (resolved.status !== "resolved") {
      throw new ProjectCanvasApplicationAttemptErrorV2(
        resolved.status === "pending" ? "dependency-pending" : "rejected",
      )
    }
    return Object.freeze({ typedIntent, externalFacts: resolved.port })
  }

  private rejection(error: unknown): ProjectCanvasRouteCommandResultV2 {
    if (isAbort(error)) return { status: "rejected", code: "cancelled" }
    if (error instanceof ProjectCanvasApplicationAttemptErrorV2) {
      if (error.code === "dependency-pending") return { status: "rejected", code: "dependency-pending" }
      return { status: "rejected", code: "read-only-recovery-required" }
    }
    if (error instanceof ProjectCanvasRouteRejectionV2) {
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

class ProjectCanvasRouteRejectionV2 extends Error {
  constructor(readonly code: "canvas-not-found" | "route-tombstoned") {
    super(code)
    this.name = "ProjectCanvasRouteRejectionV2"
  }
}

function routeRejection(snapshot: ProjectIndexSnapshotV2, canvasId: CanvasId) {
  const route = projectProjectIndexSnapshotV2(snapshot).canvasRoutes.find(
    (candidate) => candidate.canvasId === canvasId,
  )
  return new ProjectCanvasRouteRejectionV2(route?.state === "tombstoned" ? "route-tombstoned" : "canvas-not-found")
}

function projectCanvasCatalogFromSnapshotV2(
  snapshot: ProjectIndexSnapshotV2,
  creationAvailability: ProjectCanvasCatalogProjectionV2["creationAvailability"],
): ProjectCanvasCatalogProjectionV2 {
  const projection = projectProjectIndexSnapshotV2(snapshot)
  const routes = Object.freeze(projection.canvasRoutes.map((route) => Object.freeze({
    canvasId: route.canvasId,
    state: route.state as "staged" | "live" | "tombstoned",
    title: route.currentTitle,
    shardEpoch: route.currentShardEpoch,
    activationDigest: route.currentActivationDigest,
    routeProjectionDigest: projectCanvasRouteProjectionDigestV2(route),
  })))
  return parseProjectCanvasCatalogProjectionV2(Object.freeze({
    format: "convax.project-canvas-catalog-projection/2",
    creationAvailability,
    projectId: snapshot.identity.projectId,
    projectEpoch: snapshot.identity.projectEpoch,
    routes,
    visibleCanvases: Object.freeze(routes.filter((route) => route.state === "live")),
  }), snapshot.identity.projectId)
}

function requireProjectIndexSnapshotV2(state: OwnerValidatedState<"project-index">): ProjectIndexSnapshotV2 {
  const snapshot = projectIndexSnapshotFromValidatedOwnerStateV2(state)
  if (snapshot === null) throw new Error("ProjectIndex owner returned an invalid validated state")
  return snapshot
}

function isAbort(error: unknown): boolean {
  return (error instanceof DOMException && error.name === "AbortError") ||
    (typeof error === "object" && error !== null && "name" in error && error.name === "AbortError")
}
