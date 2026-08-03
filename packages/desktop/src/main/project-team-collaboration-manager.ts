import { parseProjectIdV2 } from "@convax/collaboration"

import {
  parseProjectTeamBootstrapResultV2,
  parseProjectTeamInvitationV2,
  parseProjectTeamCollaborationStatusV2,
  type ProjectTeamCollaborationAttentionReasonV2,
  type ProjectTeamBootstrapResultV2,
  type ProjectTeamCollaborationStatusV2,
  type ProjectTeamInvitationCarrierV2,
} from "../project-team-collaboration-contracts"

export interface ProjectTeamPeerSessionSnapshotV2 {
  readonly state: "online" | "offline" | "viewer" | "attention"
  readonly canEdit: boolean
  readonly connectedPeerCount: number
  readonly reason: ProjectTeamCollaborationAttentionReasonV2 | null
}

/** Exact verified session capability. It owns Control renewal and the PeerJS data plane. */
export interface ProjectTeamPeerSessionV2 {
  readonly projectId: string
  snapshot(): ProjectTeamPeerSessionSnapshotV2
  subscribe(listener: (snapshot: ProjectTeamPeerSessionSnapshotV2) => void): () => void
  setOnline(online: boolean): void
  quiesce(): Promise<void>
}

export type ProjectTeamPeerSessionOpenResultV2 =
  | Readonly<{ status: "ready"; session: ProjectTeamPeerSessionV2 }>
  | Readonly<{ status: "local-only" }>
  | Readonly<{ status: "attention"; reason: ProjectTeamCollaborationAttentionReasonV2 }>

export interface ProjectTeamPeerBootstrapOpenResultV2 {
  readonly session: ProjectTeamPeerSessionOpenResultV2
  readonly invitation: ProjectTeamInvitationCarrierV2 | null
}

/**
 * Main-only composition seam. Its implementation owns raw service DTOs, OS-vault
 * signers, credential refresh, exact handshake/channel admission and PeerJS.
 */
export interface ProjectTeamPeerSessionFactoryV2 {
  openExisting(input: { readonly projectId: string; readonly signal: AbortSignal }): Promise<ProjectTeamPeerSessionOpenResultV2>
  bootstrapTeam(input: { readonly projectId: string; readonly signal: AbortSignal }): Promise<ProjectTeamPeerBootstrapOpenResultV2>
  joinTeam(input: { readonly projectId: string; readonly invitation: ProjectTeamInvitationCarrierV2; readonly signal: AbortSignal }): Promise<ProjectTeamPeerSessionOpenResultV2>
}

/**
 * Serialized Project lifecycle owner around the production Control/PeerJS factory.
 * A stale open can never publish or retain a session after Project switch/forget.
 */
export class ProjectTeamCollaborationManagerV2 {
  private activeProjectId: string | null = null
  private activeGeneration: object | null = null
  private activationAbort: AbortController | null = null
  private session: ProjectTeamPeerSessionV2 | null = null
  private unsubscribeSession: (() => void) | null = null
  private online = true
  private disposed = false
  private lane: Promise<void> = Promise.resolve()
  private readonly statuses = new Map<string, ProjectTeamCollaborationStatusV2>()
  private readonly listeners = new Set<(status: ProjectTeamCollaborationStatusV2) => void>()

  constructor(private readonly factory: ProjectTeamPeerSessionFactoryV2) {}

  activateProject(projectIdInput: string): Promise<ProjectTeamCollaborationStatusV2> {
    const projectId = parseProjectIdV2(projectIdInput)
    if (this.activeProjectId === projectId && this.session) return Promise.resolve(this.requireStatus(projectId))
    return this.replaceProject(projectId, (signal) => this.factory.openExisting({ projectId, signal }))
  }

  async bootstrapTeam(projectIdInput: string): Promise<ProjectTeamBootstrapResultV2> {
    const projectId = parseProjectIdV2(projectIdInput)
    this.requireActiveProject(projectId)
    let invitation: ProjectTeamInvitationCarrierV2 | null = null
    const status = await this.replaceProject(projectId, async (signal) => {
      const bootstrap = await this.factory.bootstrapTeam({ projectId, signal })
      invitation = bootstrap.invitation === null ? null : parseProjectTeamInvitationV2(bootstrap.invitation)
      if (invitation !== null && invitation.projectId !== projectId) {
        throw new Error("Project team bootstrap invitation crossed Project identity")
      }
      return bootstrap.session
    })
    return parseProjectTeamBootstrapResultV2({ invitation, status })
  }

  joinTeam(input: { readonly projectId: string; readonly invitation: ProjectTeamInvitationCarrierV2 }): Promise<ProjectTeamCollaborationStatusV2> {
    const projectId = parseProjectIdV2(input.projectId)
    this.requireActiveProject(projectId)
    const invitation = parseProjectTeamInvitationV2(input.invitation)
    if (invitation.projectId !== projectId) {
      throw new Error("Project team collaboration invitation crossed Project identity")
    }
    return this.replaceProject(projectId, (signal) => this.factory.joinTeam({ projectId, invitation, signal }))
  }

  async quiesceProject(projectIdInput: string): Promise<void> {
    const projectId = parseProjectIdV2(projectIdInput)
    await this.serialize(async () => {
      if (this.activeProjectId !== projectId) return
      this.activeGeneration = null
      this.activationAbort?.abort(new DOMException("Project collaboration session was quiesced", "AbortError"))
      this.activationAbort = null
      await this.quiesceSession()
      this.activeProjectId = null
      this.statuses.delete(projectId)
    })
  }

  getStatus(projectIdInput: string): ProjectTeamCollaborationStatusV2 {
    const projectId = parseProjectIdV2(projectIdInput)
    return this.statuses.get(projectId) ?? status(projectId, "local-only", false, 0, null)
  }

  subscribe(listener: (status: ProjectTeamCollaborationStatusV2) => void): () => void {
    this.requireLive()
    if (typeof listener !== "function") throw new TypeError("Project team collaboration listener is required")
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  setOnline(online: boolean): void {
    if (this.disposed || this.online === online) return
    this.online = online
    this.session?.setOnline(online)
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    this.activeGeneration = null
    this.activationAbort?.abort(new DOMException("Project collaboration manager was disposed", "AbortError"))
    this.activationAbort = null
    await this.serialize(async () => {
      await this.quiesceSession()
      this.activeProjectId = null
      this.statuses.clear()
      this.listeners.clear()
    })
  }

  private replaceProject(
    projectId: string,
    open: (signal: AbortSignal) => Promise<ProjectTeamPeerSessionOpenResultV2>,
  ): Promise<ProjectTeamCollaborationStatusV2> {
    this.requireLive()
    const generation = {}
    const abort = new AbortController()
    this.activeGeneration = generation
    this.activationAbort?.abort(new DOMException("Project collaboration activation was superseded", "AbortError"))
    this.activationAbort = abort
    const opening = this.serialize(async () => {
      this.requireLive()
      if (this.activeGeneration !== generation) throw staleActivation()
      const previousProjectId = this.activeProjectId
      await this.quiesceSession()
      if (previousProjectId !== null && previousProjectId !== projectId) {
        this.statuses.delete(previousProjectId)
      }
      this.activeProjectId = projectId
      this.publish(status(projectId, "starting", false, 0, null))
      let result: ProjectTeamPeerSessionOpenResultV2
      try {
        result = await open(abort.signal)
      } catch (error) {
        if (abort.signal.aborted || this.activeGeneration !== generation) throw staleActivation()
        this.publish(status(projectId, "attention", false, 0, "service-unavailable"))
        throw error
      }
      if (this.disposed || abort.signal.aborted || this.activeGeneration !== generation || this.activeProjectId !== projectId) {
        if (result.status === "ready") await result.session.quiesce()
        throw staleActivation()
      }
      this.activationAbort = null
      if (result.status === "local-only") {
        return this.publish(status(projectId, "local-only", false, 0, null))
      }
      if (result.status === "attention") {
        return this.publish(status(projectId, "attention", false, 0, result.reason))
      }
      if (parseProjectIdV2(result.session.projectId) !== projectId) {
        await result.session.quiesce()
        this.publish(status(projectId, "attention", false, 0, "protocol-rejected"))
        throw new Error("Project team session crossed Project identity")
      }
      this.session = result.session
      result.session.setOnline(this.online)
      const apply = (snapshot: ProjectTeamPeerSessionSnapshotV2) => {
        if (this.session !== result.session || this.activeGeneration !== generation || this.activeProjectId !== projectId) return
        const next = sessionStatus(projectId, snapshot)
        this.publish(next)
        if (snapshot.state === "attention" &&
          (snapshot.reason === "credential-expired" || snapshot.reason === "authorization-revoked" || snapshot.reason === "protocol-rejected")) {
          this.unsubscribeSession?.()
          this.unsubscribeSession = null
          this.session = null
          void result.session.quiesce()
        }
      }
      this.unsubscribeSession = result.session.subscribe(apply)
      return this.publish(sessionStatus(projectId, result.session.snapshot()))
    })
    return opening
  }

  private async quiesceSession(): Promise<void> {
    this.unsubscribeSession?.()
    this.unsubscribeSession = null
    const current = this.session
    this.session = null
    if (current) await current.quiesce()
  }

  private publish(next: ProjectTeamCollaborationStatusV2): ProjectTeamCollaborationStatusV2 {
    const parsed = parseProjectTeamCollaborationStatusV2(next)
    const previous = this.statuses.get(parsed.projectId)
    if (previous && sameStatus(previous, parsed)) return previous
    this.statuses.set(parsed.projectId, parsed)
    for (const listener of this.listeners) {
      try { listener(parsed) } catch { /* Status observers never affect transport authority. */ }
    }
    return parsed
  }

  private requireStatus(projectId: string): ProjectTeamCollaborationStatusV2 {
    return this.statuses.get(projectId) ?? status(projectId, "starting", false, 0, null)
  }

  private requireActiveProject(projectId: string): void {
    this.requireLive()
    if (this.activeProjectId !== projectId) throw new Error("Project team collaboration request is stale")
  }

  private requireLive(): void {
    if (this.disposed) throw new Error("Project team collaboration manager is disposed")
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.lane.catch(() => undefined).then(operation)
    this.lane = result.then(() => undefined, () => undefined)
    return result
  }
}

function sessionStatus(projectId: string, snapshot: ProjectTeamPeerSessionSnapshotV2): ProjectTeamCollaborationStatusV2 {
  if (snapshot.state === "attention") {
    if (snapshot.reason === null) throw new TypeError("Attention session status requires a reason")
  } else if (snapshot.reason !== null) {
    throw new TypeError("Non-attention session status cannot carry a reason")
  }
  return status(projectId, snapshot.state, snapshot.canEdit, snapshot.connectedPeerCount, snapshot.reason)
}

function status(
  projectId: string,
  state: ProjectTeamCollaborationStatusV2["state"],
  canEdit: boolean,
  connectedPeerCount: number,
  reason: ProjectTeamCollaborationStatusV2["reason"],
): ProjectTeamCollaborationStatusV2 {
  return parseProjectTeamCollaborationStatusV2({
    format: "convax.project-team-collaboration-status/2",
    projectId,
    state,
    canEdit,
    connectedPeerCount,
    reason,
  })
}

function sameStatus(left: ProjectTeamCollaborationStatusV2, right: ProjectTeamCollaborationStatusV2): boolean {
  return left.projectId === right.projectId && left.state === right.state && left.canEdit === right.canEdit &&
    left.connectedPeerCount === right.connectedPeerCount && left.reason === right.reason
}

function staleActivation(): DOMException {
  return new DOMException("Project collaboration activation is stale", "AbortError")
}
