import {
  documentScopeDigest,
  localOwnerEditAuthorizationCoreDigest,
  parseActorId,
  parseDigest,
  parseDocumentScope,
  parseReplicaId,
} from "@convax/collaboration"
import type {
  ActorId,
  CollaborationKernelPorts,
  DecodedCausalEditFrame,
  Digest,
  DocumentOwnerKind,
  DocumentOwnerRuntime,
  DocumentScope,
  IncomingOwnerFactResolverPort,
  PublicKey,
  ProjectId,
  ReplicaSignerPort,
  CurrentProtocolAuthority,
  YjsDocumentFactory,
} from "@convax/collaboration"
import { NodeCollaborationPersistence } from "@convax/project/node"
import type { NodeReplicaHeadMaterializer } from "@convax/project/node"

import {
  createCurrentLocalReplicaAuthorityPort,
  createIncomingReplicaAuthorityVerificationPort,
  type CurrentLocalReplicaAuthorityEvidence,
  type CurrentLocalReplicaAuthoritySource,
  type IncomingReplicaAuthoritySource,
} from "./collaboration-authority-ports"
import {
  createAcceptedCausalClosureIndex,
  createDurableExactBaseResolver,
  createProductionNodeReplicaHeadMaterializer,
} from "./collaboration-exact-base"

export interface OfflineReplicaSigningVault {
  openSigner(input: {
    readonly projectId: DocumentScope["projectId"]
    readonly projectEpoch: DocumentScope["projectEpoch"]
    readonly replicaId: CurrentLocalReplicaAuthorityEvidence["signerAuthority"]["replicaId"]
    readonly expectedPublicKey: PublicKey
  }): Promise<ReplicaSignerPort | "missing" | "rejected">
}

export interface DurableVerifiedLocalAuthorityCacheEntry
  extends Omit<CurrentLocalReplicaAuthorityEvidence, "signer"> {
  readonly replicaSigningPublicKey: PublicKey
}

/** Digest-addressed current control evidence persisted outside Project payload bytes. */
export interface DurableVerifiedLocalAuthorityCache {
  resolveCurrent(
    input: Parameters<CurrentLocalReplicaAuthoritySource["resolveCurrent"]>[0],
  ): Promise<DurableVerifiedLocalAuthorityCacheEntry | "pending" | "rejected">
}

/**
 * Offline edits still require a previously verified active-editor credential chain.
 * Only the signer is reopened from the user's private Desktop key file; neither
 * private key nor signer is stored in Project collaboration metadata.
 */
export function createOfflineCurrentLocalReplicaAuthoritySource(input: {
  readonly cache: DurableVerifiedLocalAuthorityCache
  readonly vault: OfflineReplicaSigningVault
}): CurrentLocalReplicaAuthoritySource {
  const source: CurrentLocalReplicaAuthoritySource = {
    async resolveCurrent(request: Parameters<CurrentLocalReplicaAuthoritySource["resolveCurrent"]>[0]) {
      const cached = await input.cache.resolveCurrent(request)
      if (cached === "pending" || cached === "rejected") return cached
      const signer = await input.vault.openSigner({
        projectId: request.scope.projectId,
        projectEpoch: request.scope.projectEpoch,
        replicaId: cached.signerAuthority.replicaId,
        expectedPublicKey: cached.replicaSigningPublicKey,
      })
      if (signer === "missing") return "pending"
      if (signer === "rejected") return "rejected"
      return Object.freeze({ ...cached, signer })
    },
  }
  return Object.freeze(source)
}

export interface LocalProjectOwnerMutationAuthority {
  readonly binding: Readonly<{
    readonly projectId: ProjectId
    readonly projectEpoch: DocumentScope["projectEpoch"]
    readonly replicaId: CurrentLocalReplicaAuthorityEvidence["signerAuthority"]["replicaId"]
    readonly actorId: ActorId
    readonly bindingDigest: Digest
    readonly protocolDigest: Digest
  }>
  readonly signer: ReplicaSignerPort
  readonly validationArtifacts: CurrentLocalReplicaAuthorityEvidence["validationArtifacts"]
}

/** Unshared Projects authorize edits directly from their durable local owner. */
export function createLocalProjectOwnerCurrentLocalReplicaAuthoritySource(input: {
  readonly protocolDigest: Digest
  resolveOwner(scope: DocumentScope): Promise<
    LocalProjectOwnerMutationAuthority | "missing" | "rejected"
  >
}): CurrentLocalReplicaAuthoritySource {
  const protocolDigest = parseDigest(input.protocolDigest)
  return Object.freeze({
    async resolveCurrent(request: Parameters<CurrentLocalReplicaAuthoritySource["resolveCurrent"]>[0]) {
      const scope = parseDocumentScope(request.scope)
      const owner = await input.resolveOwner(scope)
      if (owner === "missing" || owner === "rejected") return owner === "missing" ? "pending" : owner
      const binding = owner.binding
      if (
        binding.projectId !== scope.projectId ||
        binding.projectEpoch !== scope.projectEpoch ||
        parseActorId(binding.actorId) !== parseActorId(request.actorId) ||
        parseDigest(binding.protocolDigest) !== protocolDigest
      ) return "rejected"
      const authorizationCore = Object.freeze({
        format: "convax.local-owner-edit-authorization-core" as const,
        scope,
        replicaId: parseReplicaId(binding.replicaId),
        actorId: parseActorId(binding.actorId),
        ownerBindingDigest: parseDigest(binding.bindingDigest),
        protocolDigest,
        ownerSchemaDigest: parseDigest(request.ownerSchemaDigest),
        expiryPolicy: "none" as const,
      })
      const authorizationDigest = localOwnerEditAuthorizationCoreDigest(authorizationCore)
      return Object.freeze({
        scope,
        operationId: request.operationId,
        baseFrontierDigest: request.baseFrontierDigest,
        ownerSchemaDigest: request.ownerSchemaDigest,
        signerAuthority: Object.freeze({
          kind: "local-project-owner" as const,
          replicaId: authorizationCore.replicaId,
          actorId: authorizationCore.actorId,
          ownerBindingDigest: authorizationCore.ownerBindingDigest,
          ownerEditAuthorizationCoreDigest: authorizationDigest,
        }),
        dependencies: Object.freeze([
          Object.freeze({ kind: "local-owner-binding" as const, digest: authorizationCore.ownerBindingDigest }),
          Object.freeze({ kind: "local-owner-edit-authorization" as const, digest: authorizationDigest }),
        ]),
        validationArtifacts: owner.validationArtifacts,
        signer: owner.signer,
      })
    },
  })
}

/** A durable Team binding disables new local-owner writes; absence keeps local-first editing. */
export function createLocalFirstCurrentLocalReplicaAuthoritySource(input: {
  readonly team: CurrentLocalReplicaAuthoritySource
  readonly localOwner: CurrentLocalReplicaAuthoritySource
  teamState(projectId: ProjectId): Promise<"missing" | "active" | "rejected">
}): CurrentLocalReplicaAuthoritySource {
  return Object.freeze({
    async resolveCurrent(request: Parameters<CurrentLocalReplicaAuthoritySource["resolveCurrent"]>[0]) {
      const state = await input.teamState(request.scope.projectId)
      if (state === "rejected") return "rejected"
      return state === "active"
        ? input.team.resolveCurrent(request)
        : input.localOwner.resolveCurrent(request)
    },
  })
}

export interface MainCollaborationProductionRuntime<K extends DocumentOwnerKind> {
  readonly scope: DocumentScope & { readonly docKind: K }
  readonly persistence: NodeCollaborationPersistence
  readonly ports: CollaborationKernelPorts
  dispose(): void
}

export interface ProjectCollaborationMaterializerRegistry extends NodeReplicaHeadMaterializer {
  register(input: {
    readonly scope: DocumentScope
    readonly materializer: NodeReplicaHeadMaterializer
  }): () => void
}

export interface OpenProjectCollaborationDocument<K extends DocumentOwnerKind> {
  readonly scope: DocumentScope & { readonly docKind: K }
  readonly owner: DocumentOwnerRuntime<K>
  readonly incomingFacts: IncomingOwnerFactResolverPort
  readonly createDocument: YjsDocumentFactory["createDocument"]
  readonly requiredBlobDigests: (frame: DecodedCausalEditFrame) => readonly Digest[]
  readonly prepareShard?: () => Promise<void>
}

export interface MainProjectCollaborationProductionRuntime {
  readonly persistence: NodeCollaborationPersistence
  openDocument<K extends DocumentOwnerKind>(
    input: OpenProjectCollaborationDocument<K>,
  ): Promise<MainCollaborationProductionRuntime<K>>
  closeDocument(scope: DocumentScope): Promise<void>
  dispose(): Promise<void>
}

/** Project-scoped owner of the one native writer and every lazy document runtime. */
export async function createMainProjectCollaborationProductionRuntime(input: {
  readonly authority: CurrentProtocolAuthority
  readonly collaborationDirectory: string
  readonly actorId: ActorId
  readonly localAuthority: CurrentLocalReplicaAuthoritySource
  readonly incomingAuthority: IncomingReplicaAuthoritySource
}): Promise<MainProjectCollaborationProductionRuntime> {
  const materializers = createProjectCollaborationMaterializerRegistry()
  const persistence = await NodeCollaborationPersistence.open({
    collaborationDirectory: input.collaborationDirectory,
    localActorId: input.actorId,
    materializer: materializers,
  })
  const documents = new Map<Digest, Promise<MainCollaborationProductionRuntime<DocumentOwnerKind>>>()
  let disposed = false
  const project: MainProjectCollaborationProductionRuntime = {
    persistence,
    async openDocument<K extends DocumentOwnerKind>(document: OpenProjectCollaborationDocument<K>) {
      requireLive()
      const key = documentScopeDigest(document.scope)
      let promised = documents.get(key)
      if (!promised) {
        const creating = createMainCollaborationProductionRuntime({
          authority: input.authority,
          scope: document.scope,
          owner: document.owner,
          actorId: input.actorId,
          localAuthority: input.localAuthority,
          incomingAuthority: input.incomingAuthority,
          incomingFacts: document.incomingFacts,
          createDocument: document.createDocument,
          requiredBlobDigests: document.requiredBlobDigests,
          persistence,
          materializers,
          ...(document.prepareShard ? { prepareShard: document.prepareShard } : {}),
        }) as Promise<MainCollaborationProductionRuntime<DocumentOwnerKind>>
        documents.set(key, creating)
        void creating.catch(() => { if (documents.get(key) === creating) documents.delete(key) })
        promised = creating
      }
      const runtime = await promised
      if (documentScopeDigest(runtime.scope) !== key || runtime.scope.docKind !== document.scope.docKind) {
        throw new Error("Project collaboration runtime returned another document scope")
      }
      return runtime as MainCollaborationProductionRuntime<K>
    },
    async closeDocument(scope) {
      const key = documentScopeDigest(scope)
      const promised = documents.get(key)
      if (!promised) return
      documents.delete(key)
      const runtime = await promised.catch(() => undefined)
      runtime?.dispose()
    },
    async dispose() {
      if (disposed) return
      disposed = true
      const pending = [...documents.values()]
      documents.clear()
      for (const promised of pending) (await promised.catch(() => undefined))?.dispose()
      persistence.dispose()
    },
  }
  return Object.freeze(project)

  function requireLive(): void {
    if (disposed) throw new Error("Project collaboration runtime is disposed")
  }
}

/** One Project writer routes materialization by exact document scope. */
export function createProjectCollaborationMaterializerRegistry(): ProjectCollaborationMaterializerRegistry {
  const entries = new Map<Digest, NodeReplicaHeadMaterializer>()
  const registry: ProjectCollaborationMaterializerRegistry = {
    register({ scope, materializer }) {
      const key = documentScopeDigest(scope)
      if (entries.has(key)) throw new Error("Collaboration document materializer is already registered")
      entries.set(key, materializer)
      let live = true
      return () => {
        if (!live) return
        live = false
        if (entries.get(key) === materializer) entries.delete(key)
      }
    },
    inspectFrame(ref, exactBytes) {
      return requireMaterializer(ref.scope).inspectFrame(ref, exactBytes)
    },
    applyAcceptedFrame(input) {
      return requireMaterializer(input.ref.scope).applyAcceptedFrame(input)
    },
    observeAcceptedFrame(ref, exactBytes) {
      requireMaterializer(ref.scope).observeAcceptedFrame?.(ref, exactBytes)
    },
    actorHeadsDigest(actorHeads) {
      return requireMaterializer(actorHeads.scope).actorHeadsDigest(actorHeads)
    },
  }
  return Object.freeze(registry)

  function requireMaterializer(scope: DocumentScope): NodeReplicaHeadMaterializer {
    const materializer = entries.get(documentScopeDigest(scope))
    if (!materializer) throw new Error("Collaboration document materializer is not registered")
    return materializer
  }
}

/**
 * Small Main composition seam. Authority, owner semantics, user-managed identity,
 * Project sole-writer durability and causal reconstruction remain independent.
 */
export async function createMainCollaborationProductionRuntime<K extends DocumentOwnerKind>(input: {
  readonly authority: CurrentProtocolAuthority
  readonly scope: DocumentScope & { readonly docKind: K }
  readonly owner: DocumentOwnerRuntime<K>
  readonly actorId: ActorId
  readonly localAuthority: CurrentLocalReplicaAuthoritySource
  readonly incomingAuthority: IncomingReplicaAuthoritySource
  readonly incomingFacts: IncomingOwnerFactResolverPort
  readonly createDocument: YjsDocumentFactory["createDocument"]
  readonly requiredBlobDigests: (frame: DecodedCausalEditFrame) => readonly Digest[]
  /** One already-open Project-scoped sole writer shared by ProjectIndex and every Canvas. */
  readonly persistence: NodeCollaborationPersistence
  readonly materializers: ProjectCollaborationMaterializerRegistry
  /** Used only by explicit genesis/open orchestration after the scope materializer is registered. */
  readonly prepareShard?: () => Promise<void>
}): Promise<MainCollaborationProductionRuntime<K>> {
  const causalClosure = createAcceptedCausalClosureIndex({
    authority: input.authority,
    scope: input.scope,
  })
  const materializer = createProductionNodeReplicaHeadMaterializer({
    authority: input.authority,
    owner: input.owner,
    causalClosure,
    createDocument: input.createDocument,
    requiredBlobDigests: input.requiredBlobDigests,
  })
  const releaseMaterializer = input.materializers.register({ scope: input.scope, materializer })
  try {
    await input.prepareShard?.()
    const [installedBase] = await Promise.all([
      causalClosure.warm(input.persistence),
      input.persistence.warmLocalCommitCapacity(input.scope),
    ])
    const ports: CollaborationKernelPorts = Object.freeze({
      createDocument: input.createDocument,
      persistence: input.persistence,
      localAuthority: createCurrentLocalReplicaAuthorityPort({
        actorId: input.actorId,
        source: input.localAuthority,
      }),
      incomingAuthority: createIncomingReplicaAuthorityVerificationPort(input.incomingAuthority),
      incomingFacts: input.incomingFacts,
      exactBaseResolver: createDurableExactBaseResolver({
        authority: input.authority,
        scope: input.scope,
        owner: input.owner,
        store: input.persistence,
        index: causalClosure,
        installedBase,
        createDocument: input.createDocument,
      }),
      causalClosure,
      pendingInbox: input.persistence,
    })
    let disposed = false
    return Object.freeze({
      scope: input.scope,
      persistence: input.persistence,
      ports,
      dispose() {
        if (disposed) return
        disposed = true
        releaseMaterializer()
      },
    })
  } catch (error) {
    releaseMaterializer()
    throw error
  }
}
