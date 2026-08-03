import { documentScopeDigestV2 } from "@convax/collaboration"
import type {
  ActorIdV2,
  CollaborationKernelPortsV2,
  DecodedCausalEditFrameV2,
  DigestV2,
  DocumentOwnerKindV2,
  DocumentOwnerRuntimeV2,
  DocumentScopeV2,
  IncomingOwnerFactResolverPortV2,
  PublicKeyV2,
  ReplicaSignerPortV2,
  VerifiedProtocolAuthorityV2,
  YjsDocumentFactoryV2,
} from "@convax/collaboration"
import { NodeCollaborationPersistenceV2 } from "@convax/project/node"
import type { NodeReplicaHeadMaterializerV2 } from "@convax/project/node"

import {
  createCurrentLocalReplicaAuthorityPortV2,
  createIncomingReplicaAuthorityVerificationPortV2,
  type CurrentLocalReplicaAuthorityEvidenceV2,
  type CurrentLocalReplicaAuthoritySourceV2,
  type IncomingReplicaAuthoritySourceV2,
} from "./collaboration-authority-ports"
import {
  createAcceptedCausalClosureIndexV2,
  createDurableExactBaseResolverV2,
  createProductionNodeReplicaHeadMaterializerV2,
} from "./collaboration-exact-base"

export interface OfflineReplicaSigningVaultV2 {
  openSigner(input: {
    readonly projectId: DocumentScopeV2["projectId"]
    readonly projectEpoch: DocumentScopeV2["projectEpoch"]
    readonly replicaId: CurrentLocalReplicaAuthorityEvidenceV2["signerAuthority"]["replicaId"]
    readonly expectedPublicKey: PublicKeyV2
  }): Promise<ReplicaSignerPortV2 | "missing" | "unavailable" | "rejected">
}

export interface DurableVerifiedLocalAuthorityCacheEntryV2
  extends Omit<CurrentLocalReplicaAuthorityEvidenceV2, "signer"> {
  readonly replicaSigningPublicKey: PublicKeyV2
}

/** Digest-addressed current control evidence persisted outside Project payload bytes. */
export interface DurableVerifiedLocalAuthorityCacheV2 {
  resolveCurrent(
    input: Parameters<CurrentLocalReplicaAuthoritySourceV2["resolveCurrent"]>[0],
  ): Promise<DurableVerifiedLocalAuthorityCacheEntryV2 | "pending" | "rejected">
}

/**
 * Offline edits still require a previously verified active-editor credential chain.
 * Only the signer is reopened from the OS vault; neither private key nor signer is
 * stored in Project collaboration metadata.
 */
export function createOfflineCurrentLocalReplicaAuthoritySourceV2(input: {
  readonly cache: DurableVerifiedLocalAuthorityCacheV2
  readonly vault: OfflineReplicaSigningVaultV2
}): CurrentLocalReplicaAuthoritySourceV2 {
  const source: CurrentLocalReplicaAuthoritySourceV2 = {
    async resolveCurrent(request: Parameters<CurrentLocalReplicaAuthoritySourceV2["resolveCurrent"]>[0]) {
      const cached = await input.cache.resolveCurrent(request)
      if (cached === "pending" || cached === "rejected") return cached
      const signer = await input.vault.openSigner({
        projectId: request.scope.projectId,
        projectEpoch: request.scope.projectEpoch,
        replicaId: cached.signerAuthority.replicaId,
        expectedPublicKey: cached.replicaSigningPublicKey,
      })
      if (signer === "missing" || signer === "unavailable") return "pending"
      if (signer === "rejected") return "rejected"
      return Object.freeze({ ...cached, signer })
    },
  }
  return Object.freeze(source)
}

export interface MainCollaborationProductionRuntimeV2<K extends DocumentOwnerKindV2> {
  readonly scope: DocumentScopeV2 & { readonly docKind: K }
  readonly persistence: NodeCollaborationPersistenceV2
  readonly ports: CollaborationKernelPortsV2
  dispose(): void
}

export interface ProjectCollaborationMaterializerRegistryV2 extends NodeReplicaHeadMaterializerV2 {
  register(input: {
    readonly scope: DocumentScopeV2
    readonly materializer: NodeReplicaHeadMaterializerV2
  }): () => void
}

export interface OpenProjectCollaborationDocumentV2<K extends DocumentOwnerKindV2> {
  readonly scope: DocumentScopeV2 & { readonly docKind: K }
  readonly owner: DocumentOwnerRuntimeV2<K>
  readonly incomingFacts: IncomingOwnerFactResolverPortV2
  readonly createDocument: YjsDocumentFactoryV2["createDocument"]
  readonly requiredBlobDigests: (frame: DecodedCausalEditFrameV2) => readonly DigestV2[]
  readonly prepareShard?: () => Promise<void>
}

export interface MainProjectCollaborationProductionRuntimeV2 {
  readonly persistence: NodeCollaborationPersistenceV2
  openDocument<K extends DocumentOwnerKindV2>(
    input: OpenProjectCollaborationDocumentV2<K>,
  ): Promise<MainCollaborationProductionRuntimeV2<K>>
  closeDocument(scope: DocumentScopeV2): Promise<void>
  dispose(): Promise<void>
}

/** Project-scoped owner of the one native writer and every lazy document runtime. */
export async function createMainProjectCollaborationProductionRuntimeV2(input: {
  readonly authority: VerifiedProtocolAuthorityV2
  readonly collaborationDirectory: string
  readonly actorId: ActorIdV2
  readonly localAuthority: CurrentLocalReplicaAuthoritySourceV2
  readonly incomingAuthority: IncomingReplicaAuthoritySourceV2
}): Promise<MainProjectCollaborationProductionRuntimeV2> {
  const materializers = createProjectCollaborationMaterializerRegistryV2()
  const persistence = await NodeCollaborationPersistenceV2.open({
    collaborationDirectory: input.collaborationDirectory,
    localActorId: input.actorId,
    materializer: materializers,
  })
  const documents = new Map<DigestV2, Promise<MainCollaborationProductionRuntimeV2<DocumentOwnerKindV2>>>()
  let disposed = false
  const project: MainProjectCollaborationProductionRuntimeV2 = {
    persistence,
    async openDocument<K extends DocumentOwnerKindV2>(document: OpenProjectCollaborationDocumentV2<K>) {
      requireLive()
      const key = documentScopeDigestV2(document.scope)
      let promised = documents.get(key)
      if (!promised) {
        const creating = createMainCollaborationProductionRuntimeV2({
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
        }) as Promise<MainCollaborationProductionRuntimeV2<DocumentOwnerKindV2>>
        documents.set(key, creating)
        void creating.catch(() => { if (documents.get(key) === creating) documents.delete(key) })
        promised = creating
      }
      const runtime = await promised
      if (documentScopeDigestV2(runtime.scope) !== key || runtime.scope.docKind !== document.scope.docKind) {
        throw new Error("Project collaboration runtime returned another document scope")
      }
      return runtime as MainCollaborationProductionRuntimeV2<K>
    },
    async closeDocument(scope) {
      const key = documentScopeDigestV2(scope)
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
export function createProjectCollaborationMaterializerRegistryV2(): ProjectCollaborationMaterializerRegistryV2 {
  const entries = new Map<DigestV2, NodeReplicaHeadMaterializerV2>()
  const registry: ProjectCollaborationMaterializerRegistryV2 = {
    register({ scope, materializer }) {
      const key = documentScopeDigestV2(scope)
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
    actorHeadsDigest(actorHeads) {
      return requireMaterializer(actorHeads.scope).actorHeadsDigest(actorHeads)
    },
  }
  return Object.freeze(registry)

  function requireMaterializer(scope: DocumentScopeV2): NodeReplicaHeadMaterializerV2 {
    const materializer = entries.get(documentScopeDigestV2(scope))
    if (!materializer) throw new Error("Collaboration document materializer is not registered")
    return materializer
  }
}

/**
 * Small Main composition seam. Authority, owner semantics, OS-vault identity,
 * Project sole-writer durability and causal reconstruction remain independent.
 */
export async function createMainCollaborationProductionRuntimeV2<K extends DocumentOwnerKindV2>(input: {
  readonly authority: VerifiedProtocolAuthorityV2
  readonly scope: DocumentScopeV2 & { readonly docKind: K }
  readonly owner: DocumentOwnerRuntimeV2<K>
  readonly actorId: ActorIdV2
  readonly localAuthority: CurrentLocalReplicaAuthoritySourceV2
  readonly incomingAuthority: IncomingReplicaAuthoritySourceV2
  readonly incomingFacts: IncomingOwnerFactResolverPortV2
  readonly createDocument: YjsDocumentFactoryV2["createDocument"]
  readonly requiredBlobDigests: (frame: DecodedCausalEditFrameV2) => readonly DigestV2[]
  /** One already-open Project-scoped sole writer shared by ProjectIndex and every Canvas. */
  readonly persistence: NodeCollaborationPersistenceV2
  readonly materializers: ProjectCollaborationMaterializerRegistryV2
  /** Used only by explicit genesis/open orchestration after the scope materializer is registered. */
  readonly prepareShard?: () => Promise<void>
}): Promise<MainCollaborationProductionRuntimeV2<K>> {
  const causalClosure = createAcceptedCausalClosureIndexV2({
    authority: input.authority,
    scope: input.scope,
  })
  const materializer = createProductionNodeReplicaHeadMaterializerV2({
    authority: input.authority,
    owner: input.owner,
    causalClosure,
    createDocument: input.createDocument,
    requiredBlobDigests: input.requiredBlobDigests,
  })
  const releaseMaterializer = input.materializers.register({ scope: input.scope, materializer })
  try {
    await input.prepareShard?.()
    const installedBase = await causalClosure.warm(input.persistence)
    const ports: CollaborationKernelPortsV2 = Object.freeze({
      createDocument: input.createDocument,
      persistence: input.persistence,
      localAuthority: createCurrentLocalReplicaAuthorityPortV2({
        actorId: input.actorId,
        source: input.localAuthority,
      }),
      incomingAuthority: createIncomingReplicaAuthorityVerificationPortV2(input.incomingAuthority),
      incomingFacts: input.incomingFacts,
      exactBaseResolver: createDurableExactBaseResolverV2({
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
