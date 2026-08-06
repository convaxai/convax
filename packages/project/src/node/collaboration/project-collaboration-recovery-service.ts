import type {
  ProjectCollaborationRecoveryClient,
  ProjectRecoveryStatus,
  ProjectResetOutcome,
  ProjectResetPreview,
} from "../../contracts"
import {
  executePortableProjectReset,
  resolvePortableProjectData,
  planPortableProjectReset,
  PortableProjectResetError,
  runWithProjectClosedExclusiveMutationLease,
  type ExecutePortableProjectReset,
  type PortableProjectResetPlan,
} from "./portable-cutover"

export interface ProjectRecoveryRootPort {
  resolveProjectRoot(projectId: string): Promise<string>
}

export interface ProjectResetPreparedAuthority {
  readonly authorizationEvidence: unknown
  readonly authorizationKind: ExecutePortableProjectReset["authorizationKind"]
  readonly finalizePublishedReset?: (input: {
    readonly archivedConvaxDirectory: string
    readonly executionFingerprint: string
    readonly nextProjectEpoch: string
    readonly originalTreeDigest: string
    readonly privateDeletionSetDigest: string
    readonly projectId: string
    readonly publishedConvaxDirectory: string
    readonly unsupportedInventoryDigest: string
    readonly signal?: AbortSignal
  }) => Promise<void>
  readonly nextProjectEpoch: string
  readonly stageGenesis: ExecutePortableProjectReset["stageGenesis"]
  readonly verifier: ExecutePortableProjectReset["verifier"]
}

/** Control-plane/Project owner seam. Native reset code does not mint team authority or fake genesis verification. */
export interface ProjectResetAuthorityPort {
  inspectReset(input: {
    readonly plan: PortableProjectResetPlan
    readonly signal?: AbortSignal
  }): Promise<
    Readonly<{ status: "eligible" }> | Readonly<{ reason: "team-epoch-rollover-required"; status: "unavailable" }>
  >
  prepareReset(input: {
    readonly plan: PortableProjectResetPlan
    readonly signal?: AbortSignal
  }): Promise<ProjectResetPreparedAuthority>
}

/** Project lifecycle owner must synchronously unmount and serialize the exact Project before invoking the operation. */
export interface ProjectClosedMutationGate {
  runClosed<Result>(input: {
    readonly projectId: string
    readonly projectRoot: string
    readonly operation: () => Promise<Result>
  }): Promise<Result>
}

export interface NodeProjectCollaborationRecoveryServiceOptions {
  readonly authority: ProjectResetAuthorityPort
  readonly gate: ProjectClosedMutationGate
  readonly projects: ProjectRecoveryRootPort
}

/**
 * Project-scoped breaking-cutover application service.
 *
 * It exposes only cloneable previews/outcomes, re-plans under the close gate,
 * and delegates frozen genesis/authorization semantics to explicit owners.
 */
export class NodeProjectCollaborationRecoveryService implements ProjectCollaborationRecoveryClient {
  constructor(private readonly options: NodeProjectCollaborationRecoveryServiceOptions) {}

  async inspectProject(projectId: string): Promise<ProjectRecoveryStatus> {
    const projectRoot = await this.options.projects.resolveProjectRoot(projectId)
    const resolution = await resolvePortableProjectData(projectRoot)
    if (resolution.status === "current") return { status: "current" }
    if (resolution.status === "recovery-required") return { status: "recovery-required" }
    return {
      unsupportedPaths: Object.freeze([...resolution.error.unsupportedPaths]),
      status: "unsupported-project-data",
    }
  }

  async previewReset(projectId: string): Promise<ProjectResetPreview> {
    const projectRoot = await this.options.projects.resolveProjectRoot(projectId)
    const plan = await planPortableProjectReset(projectRoot)
    if (plan.projectId !== projectId) {
      throw new PortableProjectResetError("INVALID_PROJECT", "Project binding does not match portable Project identity")
    }
    const authority = await this.options.authority.inspectReset({ plan })
    if (authority.status === "unavailable") {
      throw new PortableProjectResetError(
        "VERIFICATION_REJECTED",
        "Project reset requires team epoch rollover authority",
      )
    }
    return Object.freeze({
      format: "convax.project-reset-preview/1",
      ordinaryProjectFilesPreserved: true,
      privateDeletionSetDigest: plan.privateDeletionSetDigest,
      preview: Object.freeze(plan.preview.map(({ kind, path }) => Object.freeze({ kind, path }))),
      projectId,
      token: plan.token,
      unsupportedInventoryDigest: plan.unsupportedInventoryDigest,
    })
  }

  async confirmReset(
    input: Parameters<ProjectCollaborationRecoveryClient["confirmReset"]>[0],
  ): Promise<ProjectResetOutcome> {
    const projectRoot = await this.options.projects.resolveProjectRoot(input.projectId)
    return this.options.gate.runClosed({
      projectId: input.projectId,
      projectRoot,
      operation: async () => {
        const plan = await planPortableProjectReset(projectRoot)
        if (plan.projectId !== input.projectId) {
          throw new PortableProjectResetError(
            "INVALID_PROJECT",
            "Project binding does not match portable Project identity",
          )
        }
        if (plan.token !== input.token) {
          throw new PortableProjectResetError("INVALID_CONFIRMATION", "Project reset preview is stale")
        }
        const authority = await this.options.authority.prepareReset({ plan, signal: input.signal })
        const outcome = await runWithProjectClosedExclusiveMutationLease(
          { projectId: input.projectId, projectRoot: plan.projectRoot },
          (exclusiveLease) =>
            executePortableProjectReset(plan, {
              ...authority,
              confirmationToken: plan.token,
              exclusiveLease,
              signal: input.signal,
            }),
        )
        return outcome.status === "published"
          ? { projectId: outcome.projectId, status: "published" }
          : { reason: outcome.reason, status: "staged" }
      },
    })
  }
}
