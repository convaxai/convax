import type { ProjectController, ProjectControllerSnapshot, ProjectRecord } from "@convax/project"

export interface ProjectHomeProject extends ProjectRecord {
  available: boolean
  hasValidRecency: boolean
}

export interface ProjectHomeModel {
  continueProject: ProjectHomeProject | null
  empty: boolean
  initialized: boolean
  projects: ProjectHomeProject[]
}

export type ProjectHomeEntryResult =
  | { status: "canceled" }
  | { status: "entered" }
  | { message: string; status: "failed" }

export function buildProjectHomeModel(snapshot: ProjectControllerSnapshot): ProjectHomeModel {
  const projects = snapshot.projects
    .map((project): ProjectHomeProject => ({
      ...project,
      available: project.missing !== true,
      hasValidRecency: isValidTimestamp(project.lastOpenedAt),
    }))
    .sort(compareProjectRecency)
  const continueProject =
    projects.find(
      (project) => project.id === snapshot.activeProjectId && project.available,
    ) ?? null

  return {
    continueProject,
    empty: projects.length === 0,
    initialized: snapshot.initialized,
    projects,
  }
}

export async function enterProjectFromHome(
  controller: ProjectController,
  projectId: string,
  onEnterProject: (projectId: string) => Promise<boolean | void>,
): Promise<ProjectHomeEntryResult> {
  const before = controller.getSnapshot()
  const project = before.projects.find((candidate) => candidate.id === projectId)
  if (!project) return { message: "This Project is no longer registered.", status: "failed" }
  if (project.missing) {
    return { message: `Project folder is unavailable: ${project.rootPath}`, status: "failed" }
  }

  await controller.activate(projectId)
  const activated = controller.getSnapshot()
  if (activated.activeProjectId !== projectId) {
    return {
      message: activated.error ?? "Convax could not activate this Project. Try opening it again.",
      status: "failed",
    }
  }

  try {
    const entered = await onEnterProject(projectId)
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

function compareProjectRecency(left: ProjectHomeProject, right: ProjectHomeProject) {
  if (left.hasValidRecency !== right.hasValidRecency) return left.hasValidRecency ? -1 : 1
  if (left.hasValidRecency && right.hasValidRecency && left.lastOpenedAt !== right.lastOpenedAt) {
    return right.lastOpenedAt - left.lastOpenedAt
  }
  return compareStableText(left.id, right.id)
}

function compareStableText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0
}

function isValidTimestamp(value: number) {
  return Number.isFinite(value) && !Number.isNaN(new Date(value).getTime())
}
