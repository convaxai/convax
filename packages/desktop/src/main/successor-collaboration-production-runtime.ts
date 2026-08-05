import {
  documentScopeDigestV2,
  parseDigestV2,
  selectedSuccessorValidationArtifactSetV3,
  parseUint64V2,
  type ActorIdV2,
  type CollaborationKernelOptionsV2,
  type CollaborationKernelPortsV3,
  type DecodedCausalEditFrameV3,
  type DecodedCausalEditFrameV2,
  type DigestV2,
  type DocumentOwnerKindV2,
  type DocumentOwnerRuntimeV2,
  type DocumentScopeV2,
  type IncomingAuthorityVerificationPortV3,
  type IncomingOwnerFactResolverPortV3,
  type LocalAuthorityPortV3,
  type ValidationArtifactSetV2,
  type VerifiedProtocolAuthorityV2,
  type VerifiedProtocolAuthorityV3,
  type YjsDocumentFactoryV2,
} from "@convax/collaboration"
import { NodeCollaborationPersistenceV2 } from "@convax/project/node"

import type { CurrentLocalOwnerAuthoritySourceV3 } from "./local-owner-authority-source-v3"
import {
  createProjectCollaborationMaterializerRegistryV2,
  type ProjectCollaborationMaterializerRegistryV2,
} from "./collaboration-production-runtime"
import {
  createAcceptedCausalClosureIndexV3,
  createDurableExactBaseResolverV3,
  createProductionNodeReplicaHeadMaterializerV3,
} from "./successor-exact-base"

export interface LocalOwnerPromotionBridgeSourceV3 {
  resolveExact(input: {
    readonly scope: DocumentScopeV2
    readonly protocolDigest: DigestV2
  }): Promise<DigestV2 | "missing" | "rejected">
}

/**
 * Main adapter from Project-owned signed records to the V3 kernel port. Sequence
 * allocation is derived solely from the accepted actor head. No network, Team or
 * transport state is consulted.
 */
export function createCurrentLocalOwnerAuthorityPortV3(input: {
  readonly actorId: ActorIdV2
  readonly protocolDigest: DigestV2
  readonly source: CurrentLocalOwnerAuthoritySourceV3
  readonly promotionBridge: LocalOwnerPromotionBridgeSourceV3
  readonly validationArtifacts: ValidationArtifactSetV2
}): LocalAuthorityPortV3 {
  return Object.freeze({
    actorId: input.actorId,
    async prepareFinalFrameAuthority(request: Parameters<LocalAuthorityPortV3["prepareFinalFrameAuthority"]>[0]) {
      const evidence = await input.source.resolveCurrent({
        projectId: request.scope.projectId,
        projectEpoch: request.scope.projectEpoch,
        scope: request.scope,
        ownerSchemaDigest: request.ownerSchemaDigest,
        protocolDigest: input.protocolDigest,
      })
      if (evidence === "pending" || evidence === "rejected") return evidence
      if (evidence.authority.actorId !== input.actorId) return "rejected"

      if (request.previousActorHead !== null) {
        return Object.freeze({
          actorId: input.actorId,
          actorSequence: parseUint64V2((BigInt(request.previousActorHead.actorSequence) + 1n).toString()),
          predecessorFrameDigest: parseDigestV2(request.previousActorHead.frameDigest),
          signerAuthority: evidence.authority,
          dependencies: evidence.dependencies,
          validationArtifacts: input.validationArtifacts,
          signer: evidence.signer,
        })
      }

      const bridgeDigest = await input.promotionBridge.resolveExact({
        scope: request.scope,
        protocolDigest: input.protocolDigest,
      })
      if (bridgeDigest === "missing") return "pending"
      if (bridgeDigest === "rejected") return "rejected"
      return Object.freeze({
        actorId: input.actorId,
        actorSequence: parseUint64V2("1"),
        predecessorFrameDigest: parseDigestV2(bridgeDigest),
        signerAuthority: evidence.authority,
        dependencies: Object.freeze([
          ...evidence.dependencies,
          Object.freeze({ kind: "protocol-promotion-bridge" as const, digest: parseDigestV2(bridgeDigest) }),
        ]),
        validationArtifacts: input.validationArtifacts,
        signer: evidence.signer,
      })
    },
  })
}

export interface MainCollaborationProductionRuntimeV3<K extends DocumentOwnerKindV2> {
  readonly scope: DocumentScopeV2 & { readonly docKind: K }
  readonly persistence: NodeCollaborationPersistenceV2
  readonly ports: CollaborationKernelPortsV3
  dispose(): void
}

export interface OpenProjectCollaborationDocumentV3<K extends DocumentOwnerKindV2> {
  readonly scope: DocumentScopeV2 & { readonly docKind: K }
  readonly owner: DocumentOwnerRuntimeV2<K>
  readonly incomingFacts: IncomingOwnerFactResolverPortV3
  readonly createDocument: YjsDocumentFactoryV2["createDocument"]
  readonly requiredBlobDigests: (frame: DecodedCausalEditFrameV2 | DecodedCausalEditFrameV3) => readonly DigestV2[]
  readonly prepareShard?: () => Promise<void>
}

export interface MainProjectCollaborationProductionRuntimeV3 {
  readonly protocol: "v11-r1-local-owner"
  readonly persistence: NodeCollaborationPersistenceV2
  openDocument<K extends DocumentOwnerKindV2>(
    input: OpenProjectCollaborationDocumentV3<K>,
  ): Promise<MainCollaborationProductionRuntimeV3<K>>
  closeDocument(scope: DocumentScopeV2): Promise<void>
  dispose(): Promise<void>
}

/**
 * Project-scoped V3 local runtime. This constructor has deliberately no Control,
 * Team-vault, rendezvous or PeerJS dependencies; explicit sharing owns the only
 * transition that may construct those adapters.
 */
export async function createMainProjectCollaborationProductionRuntimeV3(input: {
  readonly authority: VerifiedProtocolAuthorityV3
  readonly historicalAuthority: VerifiedProtocolAuthorityV2
  readonly collaborationDirectory: string
  readonly actorId: ActorIdV2
  readonly localAuthority: CurrentLocalOwnerAuthoritySourceV3
  readonly promotionBridge: LocalOwnerPromotionBridgeSourceV3
  readonly incomingAuthority: IncomingAuthorityVerificationPortV3
}): Promise<MainProjectCollaborationProductionRuntimeV3> {
  const materializers = createProjectCollaborationMaterializerRegistryV2()
  const persistence = await NodeCollaborationPersistenceV2.open({
    collaborationDirectory: input.collaborationDirectory,
    localActorId: input.actorId,
    materializer: materializers,
  })
  const documents = new Map<DigestV2, Promise<MainCollaborationProductionRuntimeV3<DocumentOwnerKindV2>>>()
  let disposed = false
  return Object.freeze({
    protocol: "v11-r1-local-owner" as const,
    persistence,
    async openDocument<K extends DocumentOwnerKindV2>(document: OpenProjectCollaborationDocumentV3<K>) {
      requireLive()
      const key = documentScopeDigestV2(document.scope)
      let promised = documents.get(key)
      if (!promised) {
        const creating = createMainCollaborationProductionRuntimeV3({
          authority: input.authority,
          historicalAuthority: input.historicalAuthority,
          scope: document.scope,
          owner: document.owner,
          actorId: input.actorId,
          localAuthority: input.localAuthority,
          promotionBridge: input.promotionBridge,
          incomingAuthority: input.incomingAuthority,
          incomingFacts: document.incomingFacts,
          createDocument: document.createDocument,
          requiredBlobDigests: document.requiredBlobDigests,
          persistence,
          materializers,
          ...(document.prepareShard ? { prepareShard: document.prepareShard } : {}),
        }) as Promise<MainCollaborationProductionRuntimeV3<DocumentOwnerKindV2>>
        documents.set(key, creating)
        void creating.catch(() => { if (documents.get(key) === creating) documents.delete(key) })
        promised = creating
      }
      return await promised as MainCollaborationProductionRuntimeV3<K>
    },
    async closeDocument(scope: DocumentScopeV2) {
      const key = documentScopeDigestV2(scope)
      const promised = documents.get(key)
      if (!promised) return
      documents.delete(key)
      ;(await promised.catch(() => undefined))?.dispose()
    },
    async dispose() {
      if (disposed) return
      disposed = true
      const pending = [...documents.values()]
      documents.clear()
      for (const promised of pending) (await promised.catch(() => undefined))?.dispose()
      persistence.dispose()
    },
  })

  function requireLive(): void {
    if (disposed) throw new Error("V3 Project collaboration runtime is disposed")
  }
}

export async function createMainCollaborationProductionRuntimeV3<K extends DocumentOwnerKindV2>(input: {
  readonly authority: VerifiedProtocolAuthorityV3
  readonly historicalAuthority: VerifiedProtocolAuthorityV2
  readonly scope: DocumentScopeV2 & { readonly docKind: K }
  readonly owner: DocumentOwnerRuntimeV2<K>
  readonly actorId: ActorIdV2
  readonly localAuthority: CurrentLocalOwnerAuthoritySourceV3
  readonly promotionBridge: LocalOwnerPromotionBridgeSourceV3
  readonly incomingAuthority: IncomingAuthorityVerificationPortV3
  readonly incomingFacts: IncomingOwnerFactResolverPortV3
  readonly createDocument: YjsDocumentFactoryV2["createDocument"]
  readonly requiredBlobDigests: (frame: DecodedCausalEditFrameV2 | DecodedCausalEditFrameV3) => readonly DigestV2[]
  readonly persistence: NodeCollaborationPersistenceV2
  readonly materializers: ProjectCollaborationMaterializerRegistryV2
  readonly prepareShard?: () => Promise<void>
}): Promise<MainCollaborationProductionRuntimeV3<K>> {
  const validationArtifacts = selectedSuccessorValidationArtifactSetV3(input.authority, input.historicalAuthority)
  const causalClosure = createAcceptedCausalClosureIndexV3({
    authority: input.authority,
    historicalAuthority: input.historicalAuthority,
    scope: input.scope,
  })
  const materializer = createProductionNodeReplicaHeadMaterializerV3({
    authority: input.authority,
    historicalAuthority: input.historicalAuthority,
    owner: input.owner,
    causalClosure,
    createDocument: input.createDocument,
    requiredBlobDigests: input.requiredBlobDigests,
  })
  const releaseMaterializer = input.materializers.register({ scope: input.scope, materializer })
  try {
    await input.prepareShard?.()
    const installedBase = await causalClosure.warm(input.persistence)
    const ports: CollaborationKernelPortsV3 = Object.freeze({
      createDocument: input.createDocument,
      persistence: input.persistence,
      localAuthority: createCurrentLocalOwnerAuthorityPortV3({
        actorId: input.actorId,
        protocolDigest: input.authority.protocolDigest,
        source: input.localAuthority,
        promotionBridge: input.promotionBridge,
        validationArtifacts,
      }),
      incomingAuthority: input.incomingAuthority,
      incomingFacts: input.incomingFacts,
      exactBaseResolver: createDurableExactBaseResolverV3({
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

export type PersistedProjectProtocolSelectionV3 =
  | Readonly<{ protocol: "v10-r5" }>
  | Readonly<{ protocol: "v11-r1-local-owner" }>
  | Readonly<{
      protocol: "local-authority-unavailable"
      reason: "owner-key-missing" | "evidence-corrupt" | "promotion-ambiguous"
    }>

export class LocalProjectAuthorityUnavailableErrorV3 extends Error {
  readonly code = "local-authority-unavailable" as const
  constructor(readonly reason: Extract<PersistedProjectProtocolSelectionV3, { protocol: "local-authority-unavailable" }>["reason"]) {
    super(`Local Project authority is unavailable: ${reason}`)
    this.name = "LocalProjectAuthorityUnavailableErrorV3"
  }
}

/** Closed dispatcher: only persisted protocol state selects a runtime. */
export function openSelectedProjectCollaborationRuntimeV3<TV10, TV3>(input: {
  readonly selection: PersistedProjectProtocolSelectionV3
  readonly openV10: () => Promise<TV10>
  readonly openV3Local: () => Promise<TV3>
}): Promise<TV10 | TV3> {
  switch (input.selection.protocol) {
    case "v10-r5": return input.openV10()
    case "v11-r1-local-owner": return input.openV3Local()
    case "local-authority-unavailable":
      throw new LocalProjectAuthorityUnavailableErrorV3(input.selection.reason)
  }
}
