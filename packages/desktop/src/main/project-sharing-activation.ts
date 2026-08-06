import { parseProjectId, type ProjectId } from "@convax/collaboration"

import type { NodeDurableTeamAuthorityStore } from "./durable-team-authority-store"
import type { ProjectTeamCollaborationStatus } from "../project-team-collaboration-contracts"

export interface ProjectSharingActivationService {
  activateLocalProject(projectId: string): Promise<ProjectTeamCollaborationStatus>
  activateProject(projectId: string): Promise<ProjectTeamCollaborationStatus>
}

/**
 * Local durable sharing admission. A Project without a Team selector never
 * enters the factory that owns Control, Team vault, rendezvous, or PeerJS.
 * Rejected durable Team bytes stay on the shared fail-closed path and are never
 * reinterpreted as an unshared Project.
 */
export async function activateProjectSharingFromDurableBinding(input: {
  readonly projectId: string
  readonly sharing: Pick<NodeDurableTeamAuthorityStore, "open">
  readonly service: ProjectSharingActivationService
}): Promise<ProjectTeamCollaborationStatus> {
  const projectId: ProjectId = parseProjectId(input.projectId)
  const binding = await input.sharing.open(projectId)
  return binding === "missing"
    ? input.service.activateLocalProject(projectId)
    : input.service.activateProject(projectId)
}
