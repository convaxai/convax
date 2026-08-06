import { parseProjectId } from "@convax/collaboration"

import {
  parseProjectTeamBootstrapResult,
  parseProjectTeamCollaborationStatus,
  parseProjectTeamInvitation,
  projectTeamCollaborationIpcChannels,
  type ProjectTeamCollaborationClient,
  type ProjectTeamCollaborationStatus,
} from "../project-team-collaboration-contracts"

type StatusListener = (event: unknown, value: unknown) => void

export interface ProjectTeamCollaborationPreloadIpc {
  invoke(channel: string, input: unknown): Promise<unknown>
  on(channel: string, listener: StatusListener): void
  removeListener(channel: string, listener: StatusListener): void
}

/**
 * Keeps raw Control artifacts, Peer ids and Electron events out of the renderer.
 * Main remains the sole session owner; the renderer receives only a bounded status
 * projection and can request the two explicit enrollment transitions.
 */
export function createProjectTeamCollaborationPreloadClient(
  ipc: ProjectTeamCollaborationPreloadIpc,
): ProjectTeamCollaborationClient {
  const invokeStatus = async (channel: string, input: Readonly<Record<string, unknown>>) =>
    parseProjectTeamCollaborationStatus(await ipc.invoke(channel, input))

  const client: ProjectTeamCollaborationClient = {
    getStatus: ({ projectId }: { readonly projectId: string }) =>
      invokeStatus(projectTeamCollaborationIpcChannels.getStatus, {
        projectId: parseProjectId(projectId),
      }),
    async bootstrapTeam({ projectId }: { readonly projectId: string }) {
      const exactProjectId = parseProjectId(projectId)
      const result = parseProjectTeamBootstrapResult(
        await ipc.invoke(projectTeamCollaborationIpcChannels.bootstrapTeam, { projectId: exactProjectId }),
      )
      if (result.status.projectId !== exactProjectId) {
        throw new TypeError("Project team bootstrap response crossed Project identity")
      }
      return result
    },
    async joinTeam({ invitation, projectId }) {
      const exactProjectId = parseProjectId(projectId)
      const exactInvitation = parseProjectTeamInvitation(invitation)
      if (exactInvitation.projectId !== exactProjectId) {
        throw new TypeError("Project team invitation crossed Project identity")
      }
      return invokeStatus(projectTeamCollaborationIpcChannels.joinTeam, {
        invitation: exactInvitation,
        projectId: exactProjectId,
      })
    },
    subscribeStatus(listener: (status: ProjectTeamCollaborationStatus) => void) {
      if (typeof listener !== "function") throw new TypeError("Project team collaboration listener is required")
      const handleStatus: StatusListener = (_event, value) => {
        try {
          listener(parseProjectTeamCollaborationStatus(value))
        } catch {
          // Untrusted or stale Main events never cross the preload boundary.
        }
      }
      ipc.on(projectTeamCollaborationIpcChannels.changed, handleStatus)
      return () => ipc.removeListener(projectTeamCollaborationIpcChannels.changed, handleStatus)
    },
  }
  return Object.freeze(client)
}
