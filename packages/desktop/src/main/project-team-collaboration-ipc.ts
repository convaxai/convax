import { parseProjectId } from "@convax/collaboration"
import type { IpcMainInvokeEvent } from "electron"

import {
  parseProjectTeamCollaborationStatusV2,
  parseProjectTeamInvitationV2,
  projectTeamCollaborationIpcChannelsV2,
  type ProjectTeamBootstrapResultV2,
  type ProjectTeamCollaborationStatusV2,
  type ProjectTeamInvitationCarrierV2,
} from "../project-team-collaboration-contracts"

export interface ProjectTeamCollaborationMainServiceV2 {
  getStatus(projectId: string): ProjectTeamCollaborationStatusV2
  bootstrapTeam(projectId: string): Promise<ProjectTeamBootstrapResultV2>
  joinTeam(input: {
    readonly projectId: string
    readonly invitation: ProjectTeamInvitationCarrierV2
  }): Promise<ProjectTeamCollaborationStatusV2>
  subscribe(listener: (status: ProjectTeamCollaborationStatusV2) => void): () => void
}

export interface ProjectTeamCollaborationIpcMainV2 {
  handle(channel: string, listener: (event: IpcMainInvokeEvent, value: unknown) => unknown): void
  removeHandler(channel: string): void
}

export interface ProjectTeamCollaborationStatusTargetV2 {
  isDestroyed(): boolean
  send(channel: string, value: ProjectTeamCollaborationStatusV2): void
}

export interface ProjectTeamCollaborationIpcRegistrationV2 {
  dispose(): void
}

/**
 * Main-only IPC edge. Renderer requests name only an active Project and the
 * bounded invitation carrier; signed Control artifacts and PeerJS ids never cross it.
 */
export function registerProjectTeamCollaborationIpcV2(input: {
  readonly ipcMain: ProjectTeamCollaborationIpcMainV2
  readonly service: ProjectTeamCollaborationMainServiceV2
  readonly getActiveProjectId: () => string | null
  readonly getStatusTarget: () => ProjectTeamCollaborationStatusTargetV2 | null
  readonly isTrustedSender: (event: IpcMainInvokeEvent) => boolean
}): ProjectTeamCollaborationIpcRegistrationV2 {
  let disposed = false

  const requireTrustedActiveProject = (event: IpcMainInvokeEvent, value: unknown) => {
    if (disposed) throw new Error("Project team collaboration IPC is disposed")
    if (!input.isTrustedSender(event)) throw new Error("Project team collaboration IPC sender is not trusted")
    const record = exactRecord(value, ["projectId"], "Project team collaboration request")
    const projectId = parseProjectId(record.projectId)
    if (input.getActiveProjectId() !== projectId) throw new Error("Project team collaboration request is stale")
    return projectId
  }

  input.ipcMain.handle(projectTeamCollaborationIpcChannelsV2.getStatus, (event, value) => {
    const projectId = requireTrustedActiveProject(event, value)
    return parseProjectTeamCollaborationStatusV2(input.service.getStatus(projectId))
  })

  input.ipcMain.handle(projectTeamCollaborationIpcChannelsV2.bootstrapTeam, async (event, value) => {
    const projectId = requireTrustedActiveProject(event, value)
    return input.service.bootstrapTeam(projectId)
  })

  input.ipcMain.handle(projectTeamCollaborationIpcChannelsV2.joinTeam, async (event, value) => {
    if (disposed) throw new Error("Project team collaboration IPC is disposed")
    if (!input.isTrustedSender(event)) throw new Error("Project team collaboration IPC sender is not trusted")
    const record = exactRecord(value, ["invitation", "projectId"], "Project team collaboration join request")
    const projectId = parseProjectId(record.projectId)
    if (input.getActiveProjectId() !== projectId) throw new Error("Project team collaboration request is stale")
    const invitation = parseProjectTeamInvitationV2(record.invitation)
    if (invitation.projectId !== projectId) throw new Error("Project team collaboration invitation crossed Project identity")
    return parseProjectTeamCollaborationStatusV2(await input.service.joinTeam({ invitation, projectId }))
  })

  const unsubscribe = input.service.subscribe((statusInput) => {
    if (disposed) return
    const status = parseProjectTeamCollaborationStatusV2(statusInput)
    if (input.getActiveProjectId() !== status.projectId) return
    const target = input.getStatusTarget()
    if (target === null || target.isDestroyed()) return
    target.send(projectTeamCollaborationIpcChannelsV2.changed, status)
  })

  return Object.freeze({
    dispose() {
      if (disposed) return
      disposed = true
      unsubscribe()
      input.ipcMain.removeHandler(projectTeamCollaborationIpcChannelsV2.getStatus)
      input.ipcMain.removeHandler(projectTeamCollaborationIpcChannelsV2.bootstrapTeam)
      input.ipcMain.removeHandler(projectTeamCollaborationIpcChannelsV2.joinTeam)
    },
  })
}

function exactRecord(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} is invalid`)
  const record = value as Record<string, unknown>
  const actual = Object.keys(record).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new TypeError(`${label} has unknown or missing fields`)
  }
  return record
}
