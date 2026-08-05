import { parseProjectIdV2, type ProjectIdV2 } from "@convax/collaboration"

import type { NodeDurableTeamAuthorityStoreV1 } from "./durable-team-authority-store"
import type { ProjectTeamCollaborationStatusV2 } from "../project-team-collaboration-contracts"

export interface ProjectSharingActivationServiceV2 {
  activateLocalProject(projectId: string): Promise<ProjectTeamCollaborationStatusV2>
  activateProject(projectId: string): Promise<ProjectTeamCollaborationStatusV2>
}

/**
 * Local durable sharing admission. A Project without a Team selector never
 * enters the factory that owns Control, Team vault, rendezvous, or PeerJS.
 * Rejected durable Team bytes stay on the shared fail-closed path and are never
 * reinterpreted as an unshared Project.
 */
export async function activateProjectSharingFromDurableBindingV2(input: {
  readonly projectId: string
  readonly sharing: Pick<NodeDurableTeamAuthorityStoreV1, "open">
  readonly service: ProjectSharingActivationServiceV2
}): Promise<ProjectTeamCollaborationStatusV2> {
  const projectId: ProjectIdV2 = parseProjectIdV2(input.projectId)
  const binding = await input.sharing.open(projectId)
  return binding === "missing"
    ? input.service.activateLocalProject(projectId)
    : input.service.activateProject(projectId)
}
