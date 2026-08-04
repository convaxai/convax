import { parseProjectIdV2, parseUint64V2 } from "@convax/collaboration"

export const projectTeamCollaborationIpcChannelsV2 = Object.freeze({
  getStatus: "project:team-collaboration-status",
  bootstrapTeam: "project:team-collaboration-bootstrap",
  joinTeam: "project:team-collaboration-join",
  changed: "project:team-collaboration-changed",
})

export type ProjectTeamCollaborationStateV2 =
  | "local-only"
  | "starting"
  | "online"
  | "offline"
  | "viewer"
  | "attention"

export type ProjectTeamCollaborationAttentionReasonV2 =
  | "service-unconfigured"
  | "service-unavailable"
  | "team-authority-missing"
  | "credential-expired"
  | "authorization-revoked"
  | "protocol-rejected"
  | "transport-unavailable"
  | "floor-installation-pending"

/** Renderer-safe projection. Signed artifacts, peer ids and native state never cross IPC. */
export interface ProjectTeamCollaborationStatusV2 {
  readonly format: "convax.project-team-collaboration-status/2"
  readonly projectId: string
  readonly state: ProjectTeamCollaborationStateV2
  readonly canEdit: boolean
  readonly connectedPeerCount: number
  readonly reason: ProjectTeamCollaborationAttentionReasonV2 | null
}

/** API-owned opaque invite carrier. It is not an R5 authority or a new sealed Convax DTO. */
export interface ProjectTeamInvitationCarrierV2 {
  readonly invitationToken: string
  readonly projectId: string
  readonly initialRole: "editor" | "viewer"
  readonly expiresAtUnixMs: string
}

export interface ProjectTeamBootstrapResultV2 {
  readonly status: ProjectTeamCollaborationStatusV2
  readonly invitation: ProjectTeamInvitationCarrierV2 | null
}

export interface ProjectTeamCollaborationClientV2 {
  getStatus(input: { readonly projectId: string }): Promise<ProjectTeamCollaborationStatusV2>
  bootstrapTeam(input: { readonly projectId: string }): Promise<ProjectTeamBootstrapResultV2>
  joinTeam(input: { readonly projectId: string; readonly invitation: ProjectTeamInvitationCarrierV2 }): Promise<ProjectTeamCollaborationStatusV2>
  subscribeStatus(listener: (status: ProjectTeamCollaborationStatusV2) => void): () => void
}

export function parseProjectTeamCollaborationStatusV2(value: unknown): ProjectTeamCollaborationStatusV2 {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Project team collaboration status is invalid")
  const record = value as Record<string, unknown>
  const expected = ["canEdit", "connectedPeerCount", "format", "projectId", "reason", "state"]
  if (Object.keys(record).sort().join("\0") !== expected.join("\0")) {
    throw new TypeError("Project team collaboration status has unknown or missing fields")
  }
  if (record.format !== "convax.project-team-collaboration-status/2") throw new TypeError("Project team collaboration status format is invalid")
  if (typeof record.projectId !== "string" || record.projectId.length < 1 || record.projectId.length > 256 || record.projectId.includes("\0")) {
    throw new TypeError("Project team collaboration status Project id is invalid")
  }
  if (!isState(record.state)) throw new TypeError("Project team collaboration status state is invalid")
  if (typeof record.canEdit !== "boolean") throw new TypeError("Project team collaboration edit projection is invalid")
  if (!Number.isSafeInteger(record.connectedPeerCount) || (record.connectedPeerCount as number) < 0 || (record.connectedPeerCount as number) > 512) {
    throw new TypeError("Project team collaboration peer count is invalid")
  }
  if (record.reason !== null && !isReason(record.reason)) throw new TypeError("Project team collaboration reason is invalid")
  if ((record.state === "attention") !== (record.reason !== null)) {
    throw new TypeError("Project team collaboration attention state and reason differ")
  }
  if ((record.state === "local-only" || record.state === "starting") && (record.connectedPeerCount !== 0 || record.canEdit)) {
    throw new TypeError("Project team collaboration inactive state has impossible capabilities")
  }
  if (record.state === "viewer" && record.canEdit) throw new TypeError("Project team collaboration viewer cannot edit")
  return Object.freeze({
    format: record.format,
    projectId: record.projectId,
    state: record.state,
    canEdit: record.canEdit,
    connectedPeerCount: record.connectedPeerCount as number,
    reason: record.reason,
  })
}

export function parseProjectTeamInvitationV2(value: unknown): ProjectTeamInvitationCarrierV2 {
  const record = exactRecord(value, ["expiresAtUnixMs", "initialRole", "invitationToken", "projectId"], "Project team invitation")
  if (typeof record.invitationToken !== "string" || !/^[A-Za-z0-9_-]{21}[AQgw]$/.test(record.invitationToken)) {
    throw new TypeError("Project team invitation token is invalid")
  }
  if (record.initialRole !== "editor" && record.initialRole !== "viewer") {
    throw new TypeError("Project team invitation role is invalid")
  }
  return Object.freeze({
    invitationToken: record.invitationToken,
    projectId: parseProjectIdV2(record.projectId),
    initialRole: record.initialRole,
    expiresAtUnixMs: parseUint64V2(record.expiresAtUnixMs),
  })
}

export function parseProjectTeamBootstrapResultV2(value: unknown): ProjectTeamBootstrapResultV2 {
  const record = exactRecord(value, ["invitation", "status"], "Project team bootstrap result")
  const status = parseProjectTeamCollaborationStatusV2(record.status)
  const invitation = record.invitation === null ? null : parseProjectTeamInvitationV2(record.invitation)
  if (invitation !== null && invitation.projectId !== status.projectId) {
    throw new TypeError("Project team bootstrap result crossed Project identity")
  }
  return Object.freeze({ status, invitation })
}

function isState(value: unknown): value is ProjectTeamCollaborationStateV2 {
  return value === "local-only" || value === "starting" || value === "online" || value === "offline" ||
    value === "viewer" || value === "attention"
}

function isReason(value: unknown): value is ProjectTeamCollaborationAttentionReasonV2 {
  return value === "service-unconfigured" || value === "service-unavailable" || value === "team-authority-missing" ||
    value === "credential-expired" || value === "authorization-revoked" || value === "protocol-rejected" ||
    value === "transport-unavailable"
    || value === "floor-installation-pending"
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
