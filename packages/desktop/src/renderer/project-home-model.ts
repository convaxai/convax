import type { ProjectController, ProjectControllerSnapshot } from "@convax/project"

export type ProjectStartupRoute =
  | { kind: "loading" }
  | { kind: "onboarding" }
  | {
      kind: "restore"
      projectId: string
      projectName: string
    }
  | {
      kind: "recovery"
      reason: "projects-unavailable" | "registry-error"
    }

export type ProjectHomeEntryResult =
  | { status: "canceled" }
  | { status: "entered" }
  | { message: string; status: "failed" }

export type ProjectBootstrapView =
  | { kind: "registry-loading" }
  | { kind: "onboarding" }
  | { error: string | null; kind: "recovery" }
  | { kind: "opening"; projectName: string }

/**
 * Resolves Desktop's startup surface without taking ownership of Project state.
 *
 * ProjectController chooses the persisted most-recent available Project. Desktop
 * only decides whether that Project should be restored or whether the user truly
 * has no registered Projects yet.
 */
export function resolveProjectStartup(snapshot: ProjectControllerSnapshot): ProjectStartupRoute {
  if (!snapshot.initialized) return { kind: "loading" }
  if (snapshot.projects.length === 0) {
    return snapshot.error
      ? { kind: "recovery", reason: "registry-error" }
      : { kind: "onboarding" }
  }

  const activeProject = snapshot.projects.find(
    (project) =>
      project.id === snapshot.activeProjectId &&
      project.missing !== true &&
      (!project.recovery || project.recovery.status === "current"),
  )
  if (snapshot.error && !activeProject) {
    return { kind: "recovery", reason: "registry-error" }
  }
  const project = activeProject ?? snapshot.projects.find(
    (candidate) =>
      candidate.missing !== true &&
      (!candidate.recovery || candidate.recovery.status === "current"),
  )
  return project
    ? {
        kind: "restore",
        projectId: project.id,
        projectName: project.name,
      }
    : {
        kind: "recovery",
        reason: snapshot.error ? "registry-error" : "projects-unavailable",
      }
}

export function resolveProjectBootstrapView(input: {
  entryFailure?: string | null
  recoveryError?: string | null
  registryError?: string | null
  route: ProjectStartupRoute
}): ProjectBootstrapView {
  if (input.route.kind === "loading") return { kind: "registry-loading" }
  if (input.route.kind === "onboarding") return { kind: "onboarding" }
  if (input.route.kind === "recovery" || input.entryFailure || input.recoveryError) {
    return {
      error: input.recoveryError ?? input.entryFailure ?? input.registryError ?? null,
      kind: "recovery",
    }
  }
  return { kind: "opening", projectName: input.route.projectName }
}

export function recoveryErrorAfterProjectSelection(
  result: ProjectHomeEntryResult,
  previousError: string | null,
) {
  if (result.status === "failed") return result.message
  return result.status === "canceled" ? previousError : null
}

export async function enterSelectedProjectFromHome(
  controller: ProjectController,
  selectProject: () => Promise<boolean>,
  onEnterProject: (projectId: string) => Promise<boolean | void>,
): Promise<ProjectHomeEntryResult> {
  const selected = await selectProject()
  const snapshot = controller.getSnapshot()
  if (!selected) {
    return snapshot.error
      ? { message: snapshot.error, status: "failed" }
      : { status: "canceled" }
  }
  if (!snapshot.activeProjectId) {
    return {
      message: snapshot.error ?? "Convax could not activate the selected Project.",
      status: "failed",
    }
  }

  try {
    const entered = await onEnterProject(snapshot.activeProjectId)
    return entered === false
      ? {
          message: "Convax could not restore this Project. Try opening it again.",
          status: "failed",
        }
      : { status: "entered" }
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : String(error),
      status: "failed",
    }
  }
}
