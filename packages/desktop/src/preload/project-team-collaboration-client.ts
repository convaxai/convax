import { parseProjectId } from "@convax/collaboration"

import {
  parseProjectTeamBootstrapResultV2,
  parseProjectTeamCollaborationStatusV2,
  parseProjectTeamInvitationV2,
  projectTeamCollaborationIpcChannelsV2,
  type ProjectTeamCollaborationClientV2,
  type ProjectTeamCollaborationStatusV2,
} from "../project-team-collaboration-contracts"

type StatusListener = (event: unknown, value: unknown) => void

export interface ProjectTeamCollaborationPreloadIpcV2 {
  invoke(channel: string, input: unknown): Promise<unknown>
  on(channel: string, listener: StatusListener): void
  removeListener(channel: string, listener: StatusListener): void
}

/**
 * Keeps raw Control artifacts, Peer ids and Electron events out of the renderer.
 * Main remains the sole session owner; the renderer receives only a bounded status
 * projection and can request the two explicit enrollment transitions.
 */
export function createProjectTeamCollaborationPreloadClientV2(
  ipc: ProjectTeamCollaborationPreloadIpcV2,
): ProjectTeamCollaborationClientV2 {
  const invokeStatus = async (channel: string, input: Readonly<Record<string, unknown>>) =>
    parseProjectTeamCollaborationStatusV2(await ipc.invoke(channel, input))

  const client: ProjectTeamCollaborationClientV2 = {
    getStatus: ({ projectId }: { readonly projectId: string }) =>
      invokeStatus(projectTeamCollaborationIpcChannelsV2.getStatus, {
        projectId: parseProjectId(projectId),
      }),
    async bootstrapTeam({ projectId }: { readonly projectId: string }) {
      const exactProjectId = parseProjectId(projectId)
      const result = parseProjectTeamBootstrapResultV2(
        await ipc.invoke(projectTeamCollaborationIpcChannelsV2.bootstrapTeam, { projectId: exactProjectId }),
      )
      if (result.status.projectId !== exactProjectId) {
        throw new TypeError("Project team bootstrap response crossed Project identity")
      }
      return result
    },
    async joinTeam({ invitation, projectId }) {
      const exactProjectId = parseProjectId(projectId)
      const exactInvitation = parseProjectTeamInvitationV2(invitation)
      if (exactInvitation.projectId !== exactProjectId) {
        throw new TypeError("Project team invitation crossed Project identity")
      }
      return invokeStatus(projectTeamCollaborationIpcChannelsV2.joinTeam, {
        invitation: exactInvitation,
        projectId: exactProjectId,
      })
    },
    subscribeStatus(listener: (status: ProjectTeamCollaborationStatusV2) => void) {
      if (typeof listener !== "function") throw new TypeError("Project team collaboration listener is required")
      const handleStatus: StatusListener = (_event, value) => {
        try {
          listener(parseProjectTeamCollaborationStatusV2(value))
        } catch {
          // Untrusted or stale Main events never cross the preload boundary.
        }
      }
      ipc.on(projectTeamCollaborationIpcChannelsV2.changed, handleStatus)
      return () => ipc.removeListener(projectTeamCollaborationIpcChannelsV2.changed, handleStatus)
    },
  }
  return Object.freeze(client)
}
