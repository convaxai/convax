import {
  parseActorId,
  parseDigest,
  parseId128,
  parseProjectId,
  type ActorId,
  type Digest,
  type Id128,
  type ProjectId,
} from "@convax/collaboration"
import type {
  ProjectCollaborationRuntimeIdentityPort,
  ProjectCollaborationRuntimeLease,
} from "@convax/project/node"

import type { CurrentLocalReplicaAuthoritySource } from "./collaboration-authority-ports"
import {
  createLocalProjectOwnerCurrentLocalReplicaAuthoritySource,
  type LocalProjectOwnerMutationAuthority,
} from "./collaboration-production-runtime"

interface ProjectRuntimeAuthorityCacheSeed {
  readonly runtimeIdentity: object
  readonly projectId: ProjectId
  readonly projectRoot: string
  readonly projectEpoch: Id128
  readonly localActorId: ActorId
  /** Absent for a runtime whose local actor is already a Team replica. */
  readonly localOwner?: LocalProjectOwnerMutationAuthority
}

export interface ResolvedProjectRuntimeAuthorityIdentity {
  readonly projectId: ProjectId
  readonly projectEpoch: Id128
  readonly localActorId: ActorId
  readonly localOwner?: LocalProjectOwnerMutationAuthority
}

/** Binds one static authority resolution to the coordinator's opaque runtime identity. */
export function createProjectRuntimeAuthorityIdentityPort(input: {
  readonly cache: ProjectRuntimeAuthorityCache
  resolve(request: {
    readonly projectId: string
    readonly projectRoot: string
  }): Promise<ResolvedProjectRuntimeAuthorityIdentity>
}): ProjectCollaborationRuntimeIdentityPort {
  return Object.freeze({
    async resolveLocalActorId(
      { projectId, projectRoot, runtimeIdentity }:
        Parameters<ProjectCollaborationRuntimeIdentityPort["resolveLocalActorId"]>[0],
    ) {
      return input.cache.resolveRuntimeIdentity({
        runtimeIdentity,
        projectId,
        projectRoot,
        resolve: input.resolve,
      })
    },
    releaseRuntimeIdentity(
      request: Parameters<NonNullable<ProjectCollaborationRuntimeIdentityPort["releaseRuntimeIdentity"]>>[0],
    ) {
      input.cache.release(request)
    },
  })
}

interface ProjectRuntimeAuthorityEntry {
  readonly runtimeIdentity: object
  readonly projectId: ProjectId
  readonly projectRoot: string
  readonly projectEpoch: Id128
  readonly localActorId: ActorId
  readonly localOwner?: LocalProjectOwnerMutationAuthority
  localOwnerRevoked: boolean
  observedTeamState?: "missing" | "active" | "rejected"
}

/**
 * Main-only cache of immutable authority material for one open Project runtime.
 * Entries are installed only by the Project identity resolver and are explicitly
 * removed with the owning runtime identity; there is no project-global or TTL
 * lookup and a revoked local owner can never be rebuilt inside the old runtime.
 */
export class ProjectRuntimeAuthorityCache {
  private readonly entries = new Map<object, ProjectRuntimeAuthorityEntry>()
  private readonly entriesByProject = new Map<ProjectId, Set<ProjectRuntimeAuthorityEntry>>()
  private readonly pendingIdentityResolutions = new Map<ProjectId, number>()
  private readonly revocationGenerations = new Map<ProjectId, number>()
  private readonly protocolDigest: Digest
  private readonly unsubscribeLocalOwnerChanges: () => void
  private disposed = false

  constructor(private readonly options: {
    readonly protocolDigest: Digest
    readonly team: CurrentLocalReplicaAuthoritySource
    readonly localOwnerChanges: {
      subscribeCurrentChange(listener: (change: { readonly projectId: ProjectId }) => void): () => void
    }
    teamState(projectId: ProjectId): Promise<"missing" | "active" | "rejected">
  }) {
    this.protocolDigest = parseDigest(options.protocolDigest)
    this.unsubscribeLocalOwnerChanges = options.localOwnerChanges.subscribeCurrentChange(({ projectId }) => {
      this.invalidateProject(projectId)
    })
  }

  async resolveRuntimeIdentity(input: {
    readonly runtimeIdentity: object
    readonly projectId: string
    readonly projectRoot: string
    resolve(request: {
      readonly projectId: string
      readonly projectRoot: string
    }): Promise<ResolvedProjectRuntimeAuthorityIdentity>
  }): Promise<ActorId> {
    if (this.disposed) throw new Error("Project runtime authority cache is disposed")
    const projectId = parseProjectId(input.projectId)
    const generation = this.revocationGenerations.get(projectId) ?? 0
    this.pendingIdentityResolutions.set(projectId, (this.pendingIdentityResolutions.get(projectId) ?? 0) + 1)
    try {
      const resolved = await input.resolve({ projectId, projectRoot: input.projectRoot })
      if (parseProjectId(resolved.projectId) !== projectId) {
        throw new Error("Project runtime authority crossed the opened Project")
      }
      if ((this.revocationGenerations.get(projectId) ?? 0) !== generation) {
        throw new Error("Project runtime authority changed while its identity was opening")
      }
      this.seed({
        runtimeIdentity: input.runtimeIdentity,
        projectId,
        projectRoot: input.projectRoot,
        projectEpoch: resolved.projectEpoch,
        localActorId: resolved.localActorId,
        ...(resolved.localOwner ? { localOwner: resolved.localOwner } : {}),
      })
      return parseActorId(resolved.localActorId)
    } finally {
      const pending = (this.pendingIdentityResolutions.get(projectId) ?? 1) - 1
      if (pending === 0) this.pendingIdentityResolutions.delete(projectId)
      else this.pendingIdentityResolutions.set(projectId, pending)
      this.releaseUnusedGeneration(projectId)
    }
  }

  private seed(input: ProjectRuntimeAuthorityCacheSeed): void {
    if (this.disposed) throw new Error("Project runtime authority cache is disposed")
    const projectId = parseProjectId(input.projectId)
    const projectEpoch = parseId128(input.projectEpoch)
    const localActorId = parseActorId(input.localActorId)
    if (this.entries.has(input.runtimeIdentity)) {
      throw new Error("Project runtime authority identity was already seeded")
    }
    if (input.localOwner) {
      const binding = input.localOwner.binding
      if (
        parseProjectId(binding.projectId) !== projectId ||
        parseId128(binding.projectEpoch) !== projectEpoch ||
        parseActorId(binding.actorId) !== localActorId ||
        parseDigest(binding.protocolDigest) !== this.protocolDigest
      ) {
        throw new Error("Project runtime local owner crossed the opened identity")
      }
    }
    const entry: ProjectRuntimeAuthorityEntry = {
      runtimeIdentity: input.runtimeIdentity,
      projectId,
      projectRoot: input.projectRoot,
      projectEpoch,
      localActorId,
      ...(input.localOwner ? { localOwner: input.localOwner } : {}),
      localOwnerRevoked: false,
    }
    this.entries.set(input.runtimeIdentity, entry)
    const projectEntries = this.entriesByProject.get(projectId) ?? new Set<ProjectRuntimeAuthorityEntry>()
    projectEntries.add(entry)
    this.entriesByProject.set(projectId, projectEntries)
  }

  release(input: { readonly projectId: string; readonly projectRoot: string; readonly runtimeIdentity: object }): void {
    const entry = this.entries.get(input.runtimeIdentity)
    if (!entry) return
    const crossedBinding = entry.projectId !== input.projectId || entry.projectRoot !== input.projectRoot
    entry.localOwnerRevoked = true
    this.entries.delete(input.runtimeIdentity)
    const projectEntries = this.entriesByProject.get(entry.projectId)
    projectEntries?.delete(entry)
    if (projectEntries?.size === 0) this.entriesByProject.delete(entry.projectId)
    this.releaseUnusedGeneration(entry.projectId)
    if (crossedBinding) throw new Error("Project runtime authority release crossed its opened binding")
  }

  /** Sticky revocation used by owner rotation/reset publication. */
  invalidateProject(projectIdInput: string): void {
    const projectId = parseProjectId(projectIdInput)
    const entries = this.entriesByProject.get(projectId)
    if ((entries?.size ?? 0) > 0 || (this.pendingIdentityResolutions.get(projectId) ?? 0) > 0) {
      this.revocationGenerations.set(projectId, (this.revocationGenerations.get(projectId) ?? 0) + 1)
    }
    for (const entry of entries ?? []) entry.localOwnerRevoked = true
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.unsubscribeLocalOwnerChanges()
    for (const entry of this.entries.values()) entry.localOwnerRevoked = true
    this.entries.clear()
    this.entriesByProject.clear()
    this.pendingIdentityResolutions.clear()
    this.revocationGenerations.clear()
  }

  authorityFor(project: ProjectCollaborationRuntimeLease): CurrentLocalReplicaAuthoritySource {
    if (this.disposed) throw new Error("Project runtime authority cache is disposed")
    const localOwner = createLocalProjectOwnerCurrentLocalReplicaAuthoritySource({
      protocolDigest: this.protocolDigest,
      resolveOwner: async (scope) => {
        const entry = this.liveEntry(project)
        if (
          !entry ||
          entry.localOwnerRevoked ||
          scope.projectId !== entry.projectId ||
          scope.projectEpoch !== entry.projectEpoch ||
          !entry.localOwner
        ) {
          return "rejected"
        }
        return entry.localOwner
      },
    })

    return Object.freeze({
      resolveCurrent: async (request: Parameters<CurrentLocalReplicaAuthoritySource["resolveCurrent"]>[0]) => {
        let entry = this.liveEntry(project)
        if (!entry || request.scope.projectId !== entry.projectId) return "rejected"

        const state = await this.options.teamState(entry.projectId)
        entry = this.liveEntry(project)
        if (!entry) return "rejected"
        if (state !== "missing" || (entry.observedTeamState && entry.observedTeamState !== state)) {
          entry.localOwnerRevoked = true
        }
        entry.observedTeamState = state
        if (state === "rejected") return "rejected"
        if (state === "missing") {
          return entry.localOwnerRevoked ? "rejected" : localOwner.resolveCurrent(request)
        }
        const resolved = await this.options.team.resolveCurrent(request)
        return this.liveEntry(project) ? resolved : "rejected"
      },
    })
  }

  private liveEntry(project: ProjectCollaborationRuntimeLease): ProjectRuntimeAuthorityEntry | undefined {
    try {
      project.assertLive()
    } catch {
      return undefined
    }
    const entry = this.entries.get(project.runtimeIdentity)
    if (
      !entry ||
      entry.projectId !== project.projectId ||
      entry.projectRoot !== project.projectRoot ||
      entry.localActorId !== project.localActorId
    ) {
      return undefined
    }
    return entry
  }

  private releaseUnusedGeneration(projectId: ProjectId): void {
    if (
      (this.pendingIdentityResolutions.get(projectId) ?? 0) === 0 &&
      (this.entriesByProject.get(projectId)?.size ?? 0) === 0
    ) {
      this.revocationGenerations.delete(projectId)
    }
  }
}
