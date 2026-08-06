import { parseProjectId } from "@convax/collaboration"
import type { IpcMainInvokeEvent } from "electron"

import {
  parseProjectTeamCollaborationStatus,
  parseProjectTeamInvitation,
  projectTeamCollaborationIpcChannels,
  type ProjectTeamBootstrapResult,
  type ProjectTeamCollaborationStatus,
  type ProjectTeamInvitationCarrier,
} from "../project-team-collaboration-contracts"

export interface ProjectTeamCollaborationMainService {
  getStatus(projectId: string): ProjectTeamCollaborationStatus
  bootstrapTeam(projectId: string): Promise<ProjectTeamBootstrapResult>
  joinTeam(input: {
    readonly projectId: string
    readonly invitation: ProjectTeamInvitationCarrier
  }): Promise<ProjectTeamCollaborationStatus>
  subscribe(listener: (status: ProjectTeamCollaborationStatus) => void): () => void
}

export interface ProjectTeamCollaborationIpcMain {
  handle(channel: string, listener: (event: IpcMainInvokeEvent, value: unknown) => unknown): void
  removeHandler(channel: string): void
}

export interface ProjectTeamCollaborationStatusTarget {
  isDestroyed(): boolean
  send(channel: string, value: ProjectTeamCollaborationStatus): void
}

export interface ProjectTeamCollaborationIpcRegistration {
  dispose(): void
}

/**
 * Main-only IPC edge. Renderer requests name only an active Project and the
 * bounded invitation carrier; signed Control artifacts and PeerJS ids never cross it.
 */
export function registerProjectTeamCollaborationIpc(input: {
  readonly ipcMain: ProjectTeamCollaborationIpcMain
  readonly service: ProjectTeamCollaborationMainService
  readonly getActiveProjectId: () => string | null
  readonly getStatusTarget: () => ProjectTeamCollaborationStatusTarget | null
  readonly isTrustedSender: (event: IpcMainInvokeEvent) => boolean
}): ProjectTeamCollaborationIpcRegistration {
  let disposed = false

  const requireTrustedActiveProject = (event: IpcMainInvokeEvent, value: unknown) => {
    if (disposed) throw new Error("Project team collaboration IPC is disposed")
    if (!input.isTrustedSender(event)) throw new Error("Project team collaboration IPC sender is not trusted")
    const record = exactRecord(value, ["projectId"], "Project team collaboration request")
    const projectId = parseProjectId(record.projectId)
    if (input.getActiveProjectId() !== projectId) throw new Error("Project team collaboration request is stale")
    return projectId
  }

  input.ipcMain.handle(projectTeamCollaborationIpcChannels.getStatus, (event, value) => {
    const projectId = requireTrustedActiveProject(event, value)
    return parseProjectTeamCollaborationStatus(input.service.getStatus(projectId))
  })

  input.ipcMain.handle(projectTeamCollaborationIpcChannels.bootstrapTeam, async (event, value) => {
    const projectId = requireTrustedActiveProject(event, value)
    return input.service.bootstrapTeam(projectId)
  })

  input.ipcMain.handle(projectTeamCollaborationIpcChannels.joinTeam, async (event, value) => {
    if (disposed) throw new Error("Project team collaboration IPC is disposed")
    if (!input.isTrustedSender(event)) throw new Error("Project team collaboration IPC sender is not trusted")
    const record = exactRecord(value, ["invitation", "projectId"], "Project team collaboration join request")
    const projectId = parseProjectId(record.projectId)
    if (input.getActiveProjectId() !== projectId) throw new Error("Project team collaboration request is stale")
    const invitation = parseProjectTeamInvitation(record.invitation)
    if (invitation.projectId !== projectId) throw new Error("Project team collaboration invitation crossed Project identity")
    return parseProjectTeamCollaborationStatus(await input.service.joinTeam({ invitation, projectId }))
  })

  const unsubscribe = input.service.subscribe((statusInput) => {
    if (disposed) return
    const status = parseProjectTeamCollaborationStatus(statusInput)
    if (input.getActiveProjectId() !== status.projectId) return
    const target = input.getStatusTarget()
    if (target === null || target.isDestroyed()) return
    target.send(projectTeamCollaborationIpcChannels.changed, status)
  })

  return Object.freeze({
    dispose() {
      if (disposed) return
      disposed = true
      unsubscribe()
      input.ipcMain.removeHandler(projectTeamCollaborationIpcChannels.getStatus)
      input.ipcMain.removeHandler(projectTeamCollaborationIpcChannels.bootstrapTeam)
      input.ipcMain.removeHandler(projectTeamCollaborationIpcChannels.joinTeam)
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
