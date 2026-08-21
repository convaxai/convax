import { parseProjectId } from "@convax/collaboration"

import {
  parseProjectTeamBootstrapResult,
  parseProjectTeamInvitation,
  parseProjectTeamCollaborationStatus,
  type ProjectTeamCollaborationAttentionReason,
  type ProjectTeamBootstrapResult,
  type ProjectTeamCollaborationStatus,
  type ProjectTeamInvitationCarrier,
} from "../project-team-collaboration-contracts"

export interface ProjectTeamPeerSessionSnapshot {
  readonly state: "online" | "offline" | "viewer" | "attention"
  readonly canEdit: boolean
  readonly connectedPeerCount: number
  readonly reason: ProjectTeamCollaborationAttentionReason | null
}

/** Exact verified session capability. It owns Control renewal and the PeerJS data plane. */
export interface ProjectTeamPeerSession {
  readonly projectId: string
  snapshot(): ProjectTeamPeerSessionSnapshot
  subscribe(listener: (snapshot: ProjectTeamPeerSessionSnapshot) => void): () => void
  setOnline(online: boolean): void
  quiesce(): Promise<void>
}

export type ProjectTeamPeerSessionOpenResult =
  | Readonly<{ status: "ready"; session: ProjectTeamPeerSession }>
  | Readonly<{ status: "local-only" }>
  | Readonly<{ status: "attention"; reason: ProjectTeamCollaborationAttentionReason }>

export interface ProjectTeamPeerBootstrapOpenResult {
  readonly session: ProjectTeamPeerSessionOpenResult
  readonly invitation: ProjectTeamInvitationCarrier | null
}

/**
 * Main-only composition seam. Its implementation owns raw service DTOs,
 * user-managed signers, credential refresh, exact handshake/channel admission and
 * PeerJS.
 */
export interface ProjectTeamPeerSessionFactory {
  openExisting(input: { readonly projectId: string; readonly signal: AbortSignal }): Promise<ProjectTeamPeerSessionOpenResult>
  bootstrapTeam(input: { readonly projectId: string; readonly signal: AbortSignal }): Promise<ProjectTeamPeerBootstrapOpenResult>
  joinTeam(input: { readonly projectId: string; readonly invitation: ProjectTeamInvitationCarrier; readonly signal: AbortSignal }): Promise<ProjectTeamPeerSessionOpenResult>
}

/**
 * Serialized Project lifecycle owner around the production Control/PeerJS factory.
 * A stale open can never publish or retain a session after Project switch/forget.
 */
export class ProjectTeamCollaborationManager {
  private activeProjectId: string | null = null
  private activeGeneration: object | null = null
  private activationAbort: AbortController | null = null
  private session: ProjectTeamPeerSession | null = null
  private unsubscribeSession: (() => void) | null = null
  private online = true
  private disposed = false
  private lane: Promise<void> = Promise.resolve()
  private readonly statuses = new Map<string, ProjectTeamCollaborationStatus>()
  private readonly listeners = new Set<(status: ProjectTeamCollaborationStatus) => void>()

  constructor(private readonly factory: ProjectTeamPeerSessionFactory) {}

  /** Activates the Project shell without probing or starting any Team runtime. */
  activateLocalProject(projectIdInput: string): Promise<ProjectTeamCollaborationStatus> {
    const projectId = parseProjectId(projectIdInput)
    return this.serialize(async () => {
      this.requireLive()
      this.activeGeneration = {}
      this.activationAbort?.abort(new DOMException("Project collaboration activation was superseded", "AbortError"))
      this.activationAbort = null
      const previousProjectId = this.activeProjectId
      await this.quiesceSession()
      if (previousProjectId !== null && previousProjectId !== projectId) this.statuses.delete(previousProjectId)
      this.activeProjectId = projectId
      return this.publish(status(projectId, "local-only", false, 0, null))
    })
  }

  activateProject(projectIdInput: string): Promise<ProjectTeamCollaborationStatus> {
    const projectId = parseProjectId(projectIdInput)
    if (this.activeProjectId === projectId && this.session) return Promise.resolve(this.requireStatus(projectId))
    return this.replaceProject(projectId, (signal) => this.factory.openExisting({ projectId, signal }))
  }

  async bootstrapTeam(projectIdInput: string): Promise<ProjectTeamBootstrapResult> {
    const projectId = parseProjectId(projectIdInput)
    this.requireActiveProject(projectId)
    let invitation: ProjectTeamInvitationCarrier | null = null
    const status = await this.replaceProject(projectId, async (signal) => {
      const bootstrap = await this.factory.bootstrapTeam({ projectId, signal })
      invitation = bootstrap.invitation === null ? null : parseProjectTeamInvitation(bootstrap.invitation)
      if (invitation !== null && invitation.projectId !== projectId) {
        throw new Error("Project team bootstrap invitation crossed Project identity")
      }
      return bootstrap.session
    })
    return parseProjectTeamBootstrapResult({ invitation, status })
  }

  joinTeam(input: { readonly projectId: string; readonly invitation: ProjectTeamInvitationCarrier }): Promise<ProjectTeamCollaborationStatus> {
    const projectId = parseProjectId(input.projectId)
    this.requireActiveProject(projectId)
    const invitation = parseProjectTeamInvitation(input.invitation)
    if (invitation.projectId !== projectId) {
      throw new Error("Project team collaboration invitation crossed Project identity")
    }
    return this.replaceProject(projectId, (signal) => this.factory.joinTeam({ projectId, invitation, signal }))
  }

  async quiesceProject(projectIdInput: string): Promise<void> {
    const projectId = parseProjectId(projectIdInput)
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

  getStatus(projectIdInput: string): ProjectTeamCollaborationStatus {
    const projectId = parseProjectId(projectIdInput)
    return this.statuses.get(projectId) ?? status(projectId, "local-only", false, 0, null)
  }

  subscribe(listener: (status: ProjectTeamCollaborationStatus) => void): () => void {
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
    open: (signal: AbortSignal) => Promise<ProjectTeamPeerSessionOpenResult>,
  ): Promise<ProjectTeamCollaborationStatus> {
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
      let result: ProjectTeamPeerSessionOpenResult
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
      if (parseProjectId(result.session.projectId) !== projectId) {
        await result.session.quiesce()
        this.publish(status(projectId, "attention", false, 0, "protocol-rejected"))
        throw new Error("Project team session crossed Project identity")
      }
      this.session = result.session
      result.session.setOnline(this.online)
      const apply = (snapshot: ProjectTeamPeerSessionSnapshot) => {
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

  private publish(next: ProjectTeamCollaborationStatus): ProjectTeamCollaborationStatus {
    const parsed = parseProjectTeamCollaborationStatus(next)
    const previous = this.statuses.get(parsed.projectId)
    if (previous && sameStatus(previous, parsed)) return previous
    this.statuses.set(parsed.projectId, parsed)
    for (const listener of this.listeners) {
      try { listener(parsed) } catch { /* Status observers never affect transport authority. */ }
    }
    return parsed
  }

  private requireStatus(projectId: string): ProjectTeamCollaborationStatus {
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

function sessionStatus(projectId: string, snapshot: ProjectTeamPeerSessionSnapshot): ProjectTeamCollaborationStatus {
  if (snapshot.state === "attention") {
    if (snapshot.reason === null) throw new TypeError("Attention session status requires a reason")
  } else if (snapshot.reason !== null) {
    throw new TypeError("Non-attention session status cannot carry a reason")
  }
  return status(projectId, snapshot.state, snapshot.canEdit, snapshot.connectedPeerCount, snapshot.reason)
}

function status(
  projectId: string,
  state: ProjectTeamCollaborationStatus["state"],
  canEdit: boolean,
  connectedPeerCount: number,
  reason: ProjectTeamCollaborationStatus["reason"],
): ProjectTeamCollaborationStatus {
  return parseProjectTeamCollaborationStatus({
    format: "convax.project-team-collaboration-status",
    projectId,
    state,
    canEdit,
    connectedPeerCount,
    reason,
  })
}

function sameStatus(left: ProjectTeamCollaborationStatus, right: ProjectTeamCollaborationStatus): boolean {
  return left.projectId === right.projectId && left.state === right.state && left.canEdit === right.canEdit &&
    left.connectedPeerCount === right.connectedPeerCount && left.reason === right.reason
}

function staleActivation(): DOMException {
  return new DOMException("Project collaboration activation is stale", "AbortError")
}
