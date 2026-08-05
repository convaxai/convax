import type {
  ProjectCollaborationRecoveryClient,
  ProjectRecoveryStatusV1,
  ProjectResetOutcomeV1,
  ProjectResetPreviewV1,
} from "../../contracts"
import {
  executePortableProjectReset,
  inspectPortableProjectCutover,
  planPortableProjectReset,
  PortableProjectResetError,
  runWithProjectClosedExclusiveMutationLease,
  type ExecutePortableProjectResetV1,
  type PortableProjectResetPlanV1,
} from "./portable-cutover"

export interface ProjectRecoveryRootPortV1 {
  resolveProjectRoot(projectId: string): Promise<string>
}

export interface ProjectResetPreparedAuthorityV1 {
  readonly authorizationEvidence: unknown
  readonly authorizationKind: ExecutePortableProjectResetV1["authorizationKind"]
  readonly nextProjectEpoch: string
  readonly stageGenesis: ExecutePortableProjectResetV1["stageGenesis"]
  readonly verifier: ExecutePortableProjectResetV1["verifier"]
}

/** Control-plane/Project owner seam. Native reset code does not mint team authority or fake genesis verification. */
export interface ProjectResetAuthorityPortV1 {
  inspectReset(input: {
    readonly plan: PortableProjectResetPlanV1
    readonly signal?: AbortSignal
  }): Promise<
    Readonly<{ status: "eligible" }> | Readonly<{ reason: "team-epoch-rollover-required"; status: "unavailable" }>
  >
  prepareReset(input: {
    readonly plan: PortableProjectResetPlanV1
    readonly signal?: AbortSignal
  }): Promise<ProjectResetPreparedAuthorityV1>
}

/** Project lifecycle owner must synchronously unmount and serialize the exact Project before invoking the operation. */
export interface ProjectClosedMutationGateV1 {
  runClosed<Result>(input: {
    readonly projectId: string
    readonly projectRoot: string
    readonly operation: () => Promise<Result>
  }): Promise<Result>
}

export interface NodeProjectCollaborationRecoveryServiceOptionsV1 {
  readonly authority: ProjectResetAuthorityPortV1
  readonly gate: ProjectClosedMutationGateV1
  readonly projects: ProjectRecoveryRootPortV1
}

/**
 * Project-scoped breaking-cutover application service.
 *
 * It exposes only cloneable previews/outcomes, re-plans under the close gate,
 * and delegates frozen genesis/authorization semantics to explicit owners.
 */
export class NodeProjectCollaborationRecoveryServiceV1 implements ProjectCollaborationRecoveryClient {
  constructor(private readonly options: NodeProjectCollaborationRecoveryServiceOptionsV1) {}

  async inspectProject(projectId: string): Promise<ProjectRecoveryStatusV1> {
    const projectRoot = await this.options.projects.resolveProjectRoot(projectId)
    const inspection = await inspectPortableProjectCutover(projectRoot)
    if (inspection.status === "current") return { status: "current" }
    if (inspection.status === "recovery-required") return { status: "recovery-required" }
    return {
      legacyPaths: Object.freeze([...inspection.error.legacyPaths]),
      status: "unsupported-portable-project-version",
    }
  }

  async previewReset(projectId: string): Promise<ProjectResetPreviewV1> {
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
  ): Promise<ProjectResetOutcomeV1> {
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
